/**
 * Chạy một worker: MỘT LẦT query one-shot, xong là chết.
 *
 * → docs/SPEC-2026-08-14-agentco.md §2, §8
 *
 * Agent là hàm stateless: đến, làm, ghi file, chết. Trí nhớ nằm ở đồ thị
 * tri thức chứ không nằm trong context window. Đây là lý do dùng
 * persistSession:false — session chỉ tồn tại trong RAM suốt lời gọi.
 */

import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedOffice } from './config.js';
import fs from 'node:fs';

import { companyPaths, safeJoin } from './paths.js';
import { grantFor, readSecrets } from './secrets.js';
import { buildTaskMessage, buildWorkerPrompt } from './prompt.js';
import { enforceCap, parseReceipt, repairPrompt } from './receipt.js';
import { relative } from 'node:path';
import {
  EMPTY_USAGE,
  RunError,
  type FailureKind,
  type Landing,
  type Receipt,
  type Role,
  type TaskBrief,
  type Tier,
  type Usage,
} from './types.js';
import { effectiveTools } from './types.js';

export interface WorkerDeps {
  office: LoadedOffice;
  /** Gọi trước khi bắn request; scheduler dùng để chặn cache priming gate. */
  acquireCacheSlot?(cacheKey: string): Promise<() => void>;
  onProgress?(say: string): void;
  /**
   * Trao tay cầm để NGẮT GIỮA CHỪNG. Scheduler giữ nó, `Esc` / `/stop` gọi tới.
   * → docs/SPEC-tools-approval.md §3b
   */
  onStart?(handle: WorkerHandle): void;
}

export interface WorkerHandle {
  /** Ngắt ngay lời gọi đang chạy. Chỉ hoạt động ở streaming input mode. */
  interrupt(): Promise<void>;
}

/**
 * Nguồn tin nhắn kiểu stream — yield một tin rồi ĐÓNG.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÃ ĐO, ĐỪNG THỬ LẠI: hai cách ngắt qua `Query.interrupt()` đều hỏng.     │
 * │                                                                          │
 * │ (a) Stream đóng ngay (bản này): `interrupt()` gọi vào chỗ trống. Bấm     │
 * │     Dừng xong cả ba task vẫn chạy hết — đo được $0.36 tiêu sau khi dừng. │
 * │ (b) Stream GIỮ MỞ để `interrupt()` có chỗ bám: worker ghi file xong rồi  │
 * │     KHÔNG BAO GIỜ trả `result` — SDK ngồi chờ thêm đầu vào. DEADLOCK,    │
 * │     đo được: quá 90 giây không có sự kiện nào, phải kill daemon.         │
 * │                                                                          │
 * │ Nên công tắc dừng THẬT là `abortController` bên dưới, không phải         │
 * │ `interrupt()`. Giữ streaming input mode vì nó vô hại và là nền sẵn cho   │
 * │ lúc SDK/CLI hỗ trợ đủ.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function* oneMessage(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;
}

export interface WorkerInput {
  brief: TaskBrief;
  role: Role;
  hotKnowledge: string;
  coldKnowledge: string;
}

export async function runWorker(deps: WorkerDeps, input: WorkerInput): Promise<Receipt> {
  const { office } = deps;
  const { brief, role } = input;
  const started = Date.now();

  const model = modelFor(office, role.model_tier);
  // model PHẢI đi vào cacheKey: prompt cache đánh theo (model, prefix).
  const built = buildWorkerPrompt(office, role, { hotKnowledge: input.hotKnowledge, model });
  const message = buildTaskMessage(brief, input.coldKnowledge, office.company.budgets.task_brief_tokens);

  const release = await deps.acquireCacheSlot?.(built.cacheKey);

  let usage: Usage = { ...EMPTY_USAGE };
  let finalText = '';
  let firstTokenSeen = false;
  /** Điểm đến quan sát được từ tool đã gọi. Xem `landingOf`. */
  const landed = new Map<string, Landing>();

  let interrupted = false;
  // Công tắc dừng THẬT. Xem khối chú thích ở `oneMessage` để biết vì sao không
  // dùng `Query.interrupt()`.
  const abortController = new AbortController();

  try {
    const running = query({
      prompt: oneMessage(message),
      options: {
        abortController,
        systemPrompt: built.systemPrompt,
        model,
        cwd: office.dir,
        maxTurns: role.budget.max_turns,
        maxBudgetUsd: role.budget.max_usd,
        // Session chỉ trong RAM — worker stateless, không rác trên đĩa.
        persistSession: false,
        // Không nạp CLAUDE.md / settings của người dùng: chúng thay đổi theo máy
        // và theo thời gian, sẽ phá prefix cache.
        settingSources: [],
        strictMcpConfig: true,
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ `tools` GIỚI HẠN, `allowedTools` CHỈ TỰ-DUYỆT. HAI THỨ KHÁC NHAU.  │
         * │                                                                    │
         * │ Bản trước chỉ đặt `allowedTools` và tưởng thế là giới hạn. `.d.ts`  │
         * │ nói rõ: allowedTools = "auto-allowed without prompting… To restrict │
         * │ which tools are available, use the `tools` option instead."         │
         * │                                                                    │
         * │ Hậu quả ĐÃ ĐO: nhân viên `nguoi-viet` (không khai tool nào ngoài bộ │
         * │ mặc định) gặp file chỉ-đọc → thử `PowerShell` BỐN LẦN. Nó thấy tool │
         * │ đó trong ngữ cảnh vì ta chưa bao giờ cắt đi. Ba cái giá cùng lúc:   │
         * │                                                                    │
         * │  1. TOKEN — định nghĩa của MỌI tool Claude Code nằm trong prefix    │
         * │     được cache của MỌI lời gọi worker, vĩnh viễn.                   │
         * │  2. LƯỢT — mỗi lần thử một tool bị từ chối là một lượt trả tiền để  │
         * │     nhận về một lời từ chối.                                        │
         * │  3. KIẾN TRÚC — SPEC-tools-approval §5 nói `Bash` phải là quyết      │
         * │     định tường minh trong roles/<id>.yaml. Điều đó CHƯA từng được   │
         * │     thi hành: vai trò không khai `Bash` vẫn với tay tới shell được. │
         * └────────────────────────────────────────────────────────────────────┘
         */
        tools: effectiveTools(role.tools),
        allowedTools: effectiveTools(role.tools),
        ...(role.mcp.length ? { mcpServers: pickMcp(office, role) } : {}),
      },
    });

    deps.onStart?.({
      async interrupt() {
        interrupted = true;
        abortController.abort();
        // Vẫn gọi `interrupt()` sau — vô hại, và nếu CLI hỗ trợ thì nó dừng
        // sạch hơn abort. Nuốt lỗi: người dùng đã bấm Dừng, đừng ném một lỗi
        // kỹ thuật lên mặt họ.
        await running.interrupt().catch(() => undefined);
      },
    });

    for await (const msg of running) {
      const m = msg as Record<string, unknown>;

      // Cache prefix đã được ghi ngay khi bắt đầu stream — thả các task
      // cùng cacheKey đang chờ ở priming gate, không đợi call này kết thúc.
      if (!firstTokenSeen) {
        firstTokenSeen = true;
        release?.();
      }

      if (m['type'] === 'assistant') {
        const calls = toolCalls(m);
        // Một tin nhắn có thể chứa nhiều tool_use. Dòng trạng thái chỉ hiện cái
        // ĐẦU (nhiều hơn thì nhấp nháy vô nghĩa), nhưng ĐIỂM ĐẾN thì ghi hết —
        // đây là chỗ ta biết kết quả thật sự đã đi đâu.
        if (calls[0]) deps.onProgress?.(describeCall(calls[0]));
        for (const call of calls) {
          const spot = landingOf(office.dir, call);
          if (spot) landed.set(`${spot.kind}:${spot.ref}`, spot);
        }
      }

      if (m['type'] === 'result') {
        usage = readUsage(m);
        finalText = typeof m['result'] === 'string' ? m['result'] : '';
        if (m['subtype'] === 'error_max_budget_usd') {
          throw new RunError(`Task ${brief.task_id} chạm trần ngân sách $${role.budget.max_usd}`, 'budget');
        }
      }
    }
  } catch (err) {
    // Ngắt theo yêu cầu người dùng KHÔNG phải lỗi. SDK ném ra khi bị interrupt,
    // và biến nó thành "task failed" là nói dối trong nhật ký.
    if (interrupted) return stoppedReceipt(office, brief, role, usage, started, [...landed.values()]);
    if (err instanceof RunError) throw err;
    const kind = classifyError(err);
    if (kind === 'max_turns') {
      // Không phải "lỗi" — là nhân viên bị cắt giữa chừng. Nói rõ sửa ở đâu.
      throw new RunError(
        `"${role.display_name || role.id}" hết lượt cho phép (${role.budget.max_turns}) khi làm ${brief.task_id}. ` +
          `Việc này cần nhiều bước hơn: nới max_turns trong roles/${role.id}.yaml, ` +
          `hoặc chia nhỏ yêu cầu, hoặc viết hướng dẫn rõ hơn để nhân viên bớt dò dẫm.`,
        'max_turns',
        { cause: err },
      );
    }
    throw new RunError(errorMessage(err), kind, { cause: err });
  } finally {
    release?.();
  }

  // Bị ngắt mà vòng lặp kết thúc ÊM (không ném lỗi) thì cũng phải dừng ở đây.
  // Đi tiếp là gọi thêm một lượt "sửa receipt" — tốn tiền cho một việc người
  // dùng vừa bảo dừng.
  if (interrupted) return stoppedReceipt(office, brief, role, usage, started, [...landed.values()]);

  // ── receipt
  let parsed = parseReceipt(finalText);
  let reasked = false;

  if (!parsed.ok) {
    // Call sửa lỗi: model rẻ nhất, system prompt tối giản, KHÔNG kèm context role.
    // Sửa định dạng không cần biết gì về vai trò — kèm vào chỉ tốn tiền.
    reasked = true;
    const repaired = await repairReceipt(office, finalText, parsed.problem ?? 'không rõ');
    usage = addUsage(usage, repaired.usage);
    parsed = parseReceipt(repaired.text);
  }

  const body = parsed.ok
    ? parsed.receipt!
    : {
        status: 'failed' as const,
        say: 'Nhân viên trả về kết quả không đọc được. Xem nhật ký chi tiết.',
        artifacts: [],
        lessons: [],
        blocked_on: `receipt không hợp lệ: ${parsed.problem ?? 'không rõ'}`,
      };

  return {
    ...enforceCap(body, office.company.budgets.receipt_tokens),
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked,
    landed: [...landed.values()],
  };
}

// ─────────────────────────────────────────────────────────── nội bộ

/**
 * Ngắt theo yêu cầu người dùng KHÔNG phải lỗi — đừng ghi "failed" vào nhật ký.
 *
 * NHƯNG phải nói ra "mớ dở dang": worker bị giết giữa chừng có thể đã ghi được
 * một phần các file nó được giao. Bản trước trả `artifacts: []` — tức là nói
 * dối rằng không có gì trên đĩa, rồi lần chạy sau ghi đè lên mà không ai biết.
 *
 * Ta KHÔNG xoá chúng: file dở vẫn có thể dùng được, và xoá thứ người dùng chưa
 * kịp nhìn là quyết định của họ chứ không phải của ta. Chỉ liệt kê ra.
 */
function stoppedReceipt(
  office: LoadedOffice,
  brief: TaskBrief,
  role: Role,
  usage: Usage,
  started: number,
  landed: Landing[] = [],
): Receipt {
  // Gộp hai nguồn: file NÓ ĐƯỢC GIAO ghi (brief.outputs) và file ta THẤY nó ghi
  // (landed). Nguồn hai bắt được cả file phụ nó tự tạo — thứ brief không biết
  // trước, và cũng là thứ dễ bị bỏ quên lại trên đĩa nhất.
  const candidates = [...brief.outputs.map((o) => o.path), ...landed.filter((l) => l.kind === 'file').map((l) => l.ref)];
  const written = [...new Set(candidates)].filter((p) => {
    try {
      return fs.existsSync(safeJoin(office.dir, p));
    } catch {
      return false;
    }
  });

  return {
    status: 'blocked',
    say: written.length
      ? `Đã dừng giữa chừng. Có ${written.length} file đã ghi dở, xem lại trước khi dùng.`
      : 'Đã dừng theo yêu cầu của bạn, chưa ghi gì.',
    artifacts: written,
    lessons: [],
    blocked_on: 'người dùng dừng giữa chừng',
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked: false,
    landed,
  };
}

async function repairReceipt(
  office: LoadedOffice,
  badText: string,
  problem: string,
): Promise<{ text: string; usage: Usage }> {
  let usage: Usage = { ...EMPTY_USAGE };
  let text = '';
  try {
    for await (const msg of query({
      prompt: repairPrompt(badText, problem),
      options: {
        systemPrompt: 'You convert malformed text into strict JSON. You output JSON only.',
        model: office.company.models.eco,
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        allowedTools: [],
      },
    })) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'result') {
        usage = readUsage(m);
        text = typeof m['result'] === 'string' ? m['result'] : '';
      }
    }
  } catch {
    // Sửa hỏng thì thôi — caller sẽ đánh failed. Không để lỗi sửa lỗi làm sập task.
  }
  return { text, usage };
}

export function modelFor(office: LoadedOffice, tier: Tier): string {
  return office.company.models[tier];
}

type McpServers = NonNullable<Options['mcpServers']>;

/**
 * MCP server của một vai trò, đã tiêm ĐÚNG những chìa vai trò đó được cầm.
 *
 * Giá trị bí mật đi vào biến môi trường của tiến trình MCP, KHÔNG vào prompt —
 * model không đọc được chúng, chỉ dùng được tool đã mở khoá sẵn. Đó là khác biệt
 * giữa "agent có quyền" và "agent biết mật khẩu".
 */
function pickMcp(office: LoadedOffice, role: Role): McpServers {
  const { env, missing } = grantFor(readSecrets(companyPaths(office.companyDir)), role.secrets);
  if (missing.length) {
    process.emitWarning(
      `Vai trò "${role.id}" khai secrets ${missing.join(', ')} nhưng chưa có trong ` +
        `.state/secrets.json. Tool cần chìa đó sẽ hỏng — thêm bằng \`agentco secret set <TÊN>\`.`,
    );
  }

  const out: Record<string, unknown> = {};
  for (const n of role.mcp) {
    const cfg = office.company.mcpServers[n];
    if (!cfg) {
      process.emitWarning(`MCP server "${n}" chưa khai trong company.yaml`);
      continue;
    }
    // Chỉ tiêm vào server chạy bằng tiến trình con (có `command`). Server kiểu
    // http/sse nhận xác thực theo cách khác, tiêm env vào là vô nghĩa.
    const isProcess = typeof (cfg as { command?: unknown }).command === 'string';
    out[n] =
      isProcess && Object.keys(env).length
        ? { ...(cfg as object), env: { ...((cfg as { env?: object }).env ?? {}), ...env } }
        : cfg;
  }
  // Hình dạng do người dùng khai trong company.yaml — SDK tự validate lúc khởi tạo.
  return out as McpServers;
}

function readUsage(result: Record<string, unknown>): Usage {
  const u = (result['usage'] ?? {}) as Record<string, number>;
  return {
    input: u['input_tokens'] ?? 0,
    output: u['output_tokens'] ?? 0,
    cacheRead: u['cache_read_input_tokens'] ?? 0,
    cacheWrite: u['cache_creation_input_tokens'] ?? 0,
    costUSD: typeof result['total_cost_usd'] === 'number' ? result['total_cost_usd'] : 0,
    model: dominantModel(result['modelUsage']),
    turns: typeof result['num_turns'] === 'number' ? result['num_turns'] : 0,
  };
}

/**
 * Một task thường chạm NHIỀU model: model ta yêu cầu, cộng thêm Haiku mà
 * Claude Code dùng cho việc phụ trợ nội bộ. Lấy `Object.keys(...)[0]` là sai —
 * nó hay trả về model phụ và làm báo cáo chi phí đánh lừa chính mình.
 * Lấy model tiêu thụ nhiều token nhất.
 */
function dominantModel(raw: unknown): string {
  const mu = (raw ?? {}) as Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number }>;
  let best = '';
  let bestTokens = -1;
  for (const [name, m] of Object.entries(mu)) {
    const t = (m.inputTokens ?? 0) + (m.outputTokens ?? 0) + (m.cacheReadInputTokens ?? 0);
    if (t > bestTokens) {
      bestTokens = t;
      best = name;
    }
  }
  return best;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUSD: a.costUSD + b.costUSD,
    model: a.model || b.model,
    turns: a.turns + b.turns,
  };
}

/** Xuất ra để kiểm được bằng test — đây là hàm quyết định "kết quả đi đâu". */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Bóc mọi khối `tool_use` trong một tin nhắn của model. Không tốn token. */
function toolCalls(m: Record<string, unknown>): ToolCall[] {
  const content = ((m['message'] as Record<string, unknown> | undefined)?.['content'] ?? []) as Array<
    Record<string, unknown>
  >;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b['type'] === 'tool_use')
    .map((b) => ({
      name: String(b['name'] ?? ''),
      input: (b['input'] ?? {}) as Record<string, unknown>,
    }));
}

/** Đổi hoạt động của agent thành một câu tiếng người cho UI. Không tốn token. */
function describeCall(call: ToolCall): string {
  const file = typeof call.input['file_path'] === 'string' ? basename(call.input['file_path']) : '';
  switch (call.name) {
    case 'Read':
      return file ? `đang đọc ${file}` : 'đang đọc tài liệu';
    case 'Write':
    case 'Edit':
      return file ? `đang viết ${file}` : 'đang viết kết quả';
    case 'Grep':
    case 'Glob':
      return 'đang tìm trong dự án';
    case 'WebSearch':
      return 'đang tìm trên web';
    case 'WebFetch':
      return 'đang đọc một trang web';
    case 'Bash':
      return 'đang chạy lệnh';
    default: {
      const server = mcpServerOf(call.name);
      return server ? `đang làm việc với ${server}` : `đang dùng ${call.name}`;
    }
  }
}

/** `mcp__notion__create_page` → `notion`. Quy ước đặt tên tool của SDK. */
export function mcpServerOf(name: string): string | undefined {
  const parts = name.split('__');
  return parts[0] === 'mcp' && parts[1] ? parts[1] : undefined;
}

/**
 * KẾT QUẢ ĐÃ ĐI ĐÂU — suy từ TOOL ĐÃ GỌI, không từ lời model kể.
 *
 * → docs/SPEC-offices.md §6 "Kết quả nằm ở đâu"
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG DÙNG `receipt.artifacts`, VÀ KHÔNG SỬA PROMPT               │
 * │                                                                          │
 * │ `artifacts` là thứ model KHAI. Nó có thể bịa một đường dẫn chưa từng     │
 * │ viết, và nó chỉ mô tả được FILE — trong khi kết quả có thể nằm ở Notion, │
 * │ Google Sheets, một database. Dặn prompt "hãy nói rõ kết quả ở đâu" thì   │
 * │ mua lại đúng sự bất định vừa bỏ đi, bằng token vĩnh viễn.                 │
 * │                                                                          │
 * │ Nhưng ta ĐÃ ĐỌC từng khối `tool_use` trong luồng để dựng dòng "đang làm  │
 * │ gì" — chỉ là vứt đi sau khi ghép câu. Tool đã gọi là SỰ VIỆC QUAN SÁT    │
 * │ ĐƯỢC, không phải lời kể. Giữ lại là xong, 0 token, không đụng prompt.    │
 * │                                                                          │
 * │ Giới hạn phải nói thẳng: `Bash` có thể đẩy dữ liệu đi bất cứ đâu và ta   │
 * │ KHÔNG biết đâu. Ca đó ta chỉ khai "có chạy lệnh" — nói đúng thứ mình     │
 * │ biết, phần còn lại để câu `say` của nhân viên kể. Bất định còn lại được  │
 * │ KHOANH VÙNG và DÁN NHÃN, không bị giấu đi.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function landingOf(officeDir: string, call: ToolCall): Landing | undefined {
  if (call.name === 'Write' || call.name === 'Edit' || call.name === 'NotebookEdit') {
    const raw = call.input['file_path'] ?? call.input['notebook_path'];
    if (typeof raw !== 'string' || !raw) return undefined;
    try {
      // Nhốt trong thư mục văn phòng: `safeJoin` ném nếu đi ra ngoài. Một đường
      // dẫn ra ngoài thì ta không khai là "kết quả của bạn nằm ở đây".
      const abs = safeJoin(officeDir, raw);
      const rel = relative(officeDir, abs).replace(/\\/g, '/');
      return rel ? { kind: 'file', ref: rel } : undefined;
    } catch {
      return undefined;
    }
  }
  if (call.name === 'Bash') return { kind: 'command', ref: '' };
  const server = mcpServerOf(call.name);
  return server ? { kind: 'external', ref: server } : undefined;
}

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Phân loại lỗi. Rate limit và hết hạn mức subscription là HAI thứ khác nhau,
 * xử lý ngược nhau → docs/SPEC-2026-08-14-agentco.md §9b
 */
export function classifyError(err: unknown): FailureKind {
  const msg = errorMessage(err);

  for (const prefix of USAGE_LIMIT_PREFIXES) {
    if (msg.includes(prefix)) return 'usage_limit';
  }
  if (/maximum number of turns|max_turns/i.test(msg)) return 'max_turns';
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return 'rate_limit';
  if (/not logged in|unauthor|authentic|invalid api key|no credentials/i.test(msg)) return 'auth';
  return 'other';
}

/**
 * Lấy từ SDK khi có; giữ bản dự phòng để một lần đổi SDK không làm hệ thống
 * nhầm "hết hạn mức" thành "lỗi lạ" rồi retry vô ích.
 */
const USAGE_LIMIT_PREFIXES: readonly string[] = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  'Your org is out of usage',
  "Your seat type doesn't include usage",
  'Your usage allocation has been disabled',
  "You're out of extra usage",
];
