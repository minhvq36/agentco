/**
 * Chạy một worker: MỘT LẦT query one-shot, xong là chết.
 *
 * → docs/SPEC-2026-08-14-agentco.md §2, §8
 *
 * Agent là hàm stateless: đến, làm, ghi file, chết. Trí nhớ nằm ở đồ thị
 * tri thức chứ không nằm trong context window. Đây là lý do dùng
 * persistSession:false — session chỉ tồn tại trong RAM suốt lời gọi.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedCompany } from './config.js';
import { buildTaskMessage, buildWorkerPrompt } from './prompt.js';
import { enforceCap, parseReceipt, repairPrompt } from './receipt.js';
import {
  EMPTY_USAGE,
  RunError,
  type FailureKind,
  type Receipt,
  type Role,
  type TaskBrief,
  type Tier,
  type Usage,
} from './types.js';

export interface WorkerDeps {
  company: LoadedCompany;
  /** Gọi trước khi bắn request; scheduler dùng để chặn cache priming gate. */
  acquireCacheSlot?(cacheKey: string): Promise<() => void>;
  onProgress?(say: string): void;
}

export interface WorkerInput {
  brief: TaskBrief;
  role: Role;
  hotKnowledge: string;
  coldKnowledge: string;
}

export async function runWorker(deps: WorkerDeps, input: WorkerInput): Promise<Receipt> {
  const { company } = deps;
  const { brief, role } = input;
  const started = Date.now();

  const built = buildWorkerPrompt(company, role, { hotKnowledge: input.hotKnowledge });
  const message = buildTaskMessage(brief, input.coldKnowledge, company.config.budgets.task_brief_tokens);

  const release = await deps.acquireCacheSlot?.(built.cacheKey);

  let usage: Usage = { ...EMPTY_USAGE };
  let finalText = '';
  let firstTokenSeen = false;

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        systemPrompt: built.systemPrompt,
        model: modelFor(company, role.model_tier),
        cwd: company.dir,
        maxTurns: role.budget.max_turns,
        maxBudgetUsd: role.budget.max_usd,
        // Session chỉ trong RAM — worker stateless, không rác trên đĩa.
        persistSession: false,
        // Không nạp CLAUDE.md / settings của người dùng: chúng thay đổi theo máy
        // và theo thời gian, sẽ phá prefix cache.
        settingSources: [],
        strictMcpConfig: true,
        ...(role.tools.length ? { allowedTools: role.tools } : {}),
        ...(role.mcp.length ? { mcpServers: pickMcp(company, role.mcp) } : {}),
      },
    })) {
      const m = msg as Record<string, unknown>;

      // Cache prefix đã được ghi ngay khi bắt đầu stream — thả các task
      // cùng cacheKey đang chờ ở priming gate, không đợi call này kết thúc.
      if (!firstTokenSeen) {
        firstTokenSeen = true;
        release?.();
      }

      if (m['type'] === 'assistant') {
        const say = describeAssistant(m);
        if (say) deps.onProgress?.(say);
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
    if (err instanceof RunError) throw err;
    throw new RunError(errorMessage(err), classifyError(err), { cause: err });
  } finally {
    release?.();
  }

  // ── receipt
  let parsed = parseReceipt(finalText);
  let reasked = false;

  if (!parsed.ok) {
    // Call sửa lỗi: model rẻ nhất, system prompt tối giản, KHÔNG kèm context role.
    // Sửa định dạng không cần biết gì về vai trò — kèm vào chỉ tốn tiền.
    reasked = true;
    const repaired = await repairReceipt(company, finalText, parsed.problem ?? 'không rõ');
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
    ...enforceCap(body, company.config.budgets.receipt_tokens),
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked,
  };
}

// ─────────────────────────────────────────────────────────── nội bộ

async function repairReceipt(
  company: LoadedCompany,
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
        model: company.config.models.cheap,
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

export function modelFor(company: LoadedCompany, tier: Tier): string {
  return company.config.models[tier];
}

type McpServers = NonNullable<Options['mcpServers']>;

function pickMcp(company: LoadedCompany, names: string[]): McpServers {
  const out: Record<string, unknown> = {};
  for (const n of names) {
    const cfg = company.config.mcpServers[n];
    if (cfg) out[n] = cfg;
    else process.emitWarning(`MCP server "${n}" chưa khai trong company.yaml`);
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
  };
}

/** Đổi hoạt động của agent thành một câu tiếng người cho UI. Không tốn token. */
function describeAssistant(m: Record<string, unknown>): string | undefined {
  const content = ((m['message'] as Record<string, unknown> | undefined)?.['content'] ?? []) as Array<
    Record<string, unknown>
  >;
  if (!Array.isArray(content)) return undefined;

  for (const block of content) {
    if (block['type'] !== 'tool_use') continue;
    const name = String(block['name'] ?? '');
    const inp = (block['input'] ?? {}) as Record<string, unknown>;
    const file = typeof inp['file_path'] === 'string' ? basename(inp['file_path']) : '';
    switch (name) {
      case 'Read':
        return file ? `đang đọc ${file}` : 'đang đọc tài liệu';
      case 'Write':
      case 'Edit':
        return file ? `đang viết ${file}` : 'đang viết kết quả';
      case 'Grep':
      case 'Glob':
        return 'đang tìm trong dự án';
      case 'WebSearch':
        return `đang tìm trên web`;
      case 'WebFetch':
        return 'đang đọc một trang web';
      case 'Bash':
        return 'đang chạy lệnh';
      default:
        return `đang dùng ${name}`;
    }
  }
  return undefined;
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
