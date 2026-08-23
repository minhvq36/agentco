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

import { noteRateLimit } from './energy.js';
import { companyPaths, guardedZone, safeJoin, type GuardedZone } from './paths.js';
import { grantFor, readSecrets } from './secrets.js';
import { buildTaskMessage, buildWorkerPrompt } from './prompt.js';
import { enforceCap, parseReceipt, repairPrompt } from './receipt.js';
import { relative } from 'node:path';
import { hasShell } from './types.js';
import {
  EMPTY_USAGE,
  EXTERNAL_TOOLS,
  RunError,
  type FailureKind,
  type Landing,
  type Observed,
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

  // Hai thư mục, vì vùng cấm nằm ở CẢ HAI cấp: chìa khoá ở `company/.state/`,
  // file vai trò ở `offices/<id>/roles/`. → paths.ts §guardedZone
  const jailDirs = { companyDir: office.companyDir, officeDir: office.dir };

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
  /** Dấu vết lặp thao tác + file tủ đã chạm. Xem `LoopWatch`. */
  const watch = newLoopWatch();

  let interrupted = false;
  // Công tắc dừng THẬT. Xem khối chú thích ở `oneMessage` để biết vì sao không
  // dùng `Query.interrupt()`.
  const abortController = new AbortController();

  // Ngắt / lỗi / xong đều phải trả về cùng một bộ số đo — gói lại một chỗ để
  // không có nhánh nào lỡ trả receipt thiếu `looped`/`reads`.
  const observed = (): Observed => ({
    landed: [...landed.values()],
    looped: watch.looped,
    reads: [...watch.libraryReads].sort(),
  });

  try {
    const running = query({
      prompt: oneMessage(message),
      options: {
        abortController,
        systemPrompt: built.systemPrompt,
        model,
        cwd: office.dir,
        maxTurns: role.budget.max_turns,
        // `0` = người dùng không đặt trần → KHÔNG truyền cờ. Truyền 0 xuống SDK
        // là đặt trần bằng không, tức chặn ngay lượt đầu. → `RoleBudget.max_usd`
        ...(role.budget.max_usd > 0 ? { maxBudgetUsd: role.budget.max_usd } : {}),
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
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ LUẬT: KẾT QUẢ LUÔN SINH RA BÊN TRONG THƯ MỤC VĂN PHÒNG.            │
         * │ (user chốt 21/08) — và đây là DÒNG CODE thi hành nó.               │
         * │                                                                    │
         * │ `cwd: office.dir` KHÔNG phải một bức tường: `Write` nhận đường dẫn  │
         * │ tuyệt đối, và `tools`/`allowedTools` chỉ chặn *tool nào được dùng*, │
         * │ không chặn *ghi vào đâu*. Ca `P-260821-1818-yydi` đi thẳng qua khe  │
         * │ đó: file của người dùng rơi vào `company/artifacts/…`, ngang cấp    │
         * │ với `offices/`, nơi không văn phòng nào nhìn thấy.                  │
         * │                                                                    │
         * │ ⚠ VÌ SAO HOOK CHỨ KHÔNG PHẢI `canUseTool`: đã đo 19/08 — tool nằm   │
         * │ trong `allowedTools` thì được tự duyệt và **BỎ QUA `canUseTool`**.  │
         * │ Mà `Write` nằm trong `allowedTools` của mọi vai trò. Đặt luật vào   │
         * │ `canUseTool` là viết một luật không bao giờ chạy — đúng cái       │
         * │ "LỜI HỨA" mà nợ 0c sinh ra để đi tìm. `PreToolUse` chạy TRƯỚC tầng  │
         * │ quyền nên nó không bị `allowedTools` che.                           │
         * │                                                                    │
         * │ Chặn, KHÔNG sửa lén: `updatedInput` nắn đường dẫn về trong văn      │
         * │ phòng thì rơi vào ô `viết lại lặng lẽ` — nguy hơn `từ chối` vì      │
         * │ không ai thấy gì. `deny` kèm câu chỉ đường thì model tự ghi lại     │
         * │ đúng chỗ ngay lượt sau, và nhật ký có dấu vết.                      │
         * └────────────────────────────────────────────────────────────────────┘
         */
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit|NotebookEdit', hooks: [officeJail(jailDirs, 'write')] },
            // Nhánh ĐỌC là mới (23/08). Nó KHÔNG dựng hàng rào đọc tổng quát —
            // `Read` vẫn mở được mọi file trên máy, đúng như trước. Nó chỉ khoá
            // đúng `.state/`, tức chìa khoá và sổ công việc. → SPEC-arms.md §5d
            { matcher: 'Read|Grep|Glob', hooks: [officeJail(jailDirs, 'read')] },
          ],
        },
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

      // Hạn mức tài khoản đi kèm luồng, MIỄN PHÍ. Bắn một lần mỗi query, ngay
      // đầu — nhặt lên chứ đừng gọi thêm gì. → `core/energy.ts`
      if (m['type'] === 'rate_limit_event') noteRateLimit(m['rate_limit_info']);

      // CLI TỰ KHAI nó được cấp tool nào. Đối chiếu ngay. → `warnDroppedTools`
      if (m['type'] === 'system' && m['subtype'] === 'init') {
        warnDroppedTools(role, m['tools']);
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
          // Cùng một luồng `tool_use`, thêm hai thứ quan sát được và không tốn
          // gì: có lặp thao tác không, và đã chạm tài liệu nào trong tủ.
          observeCall(watch, call);
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
    if (interrupted) return stoppedReceipt(office, brief, role, usage, started, observed());
    /**
     * ⚠ MỌI ĐƯỜNG NÉM PHẢI MANG THEO `usage` **VÀ** `observed`.
     * → `RunError.usage`, `RunError.observed`
     *
     * Token đã tiêu rồi thì nó tồn tại dù lượt gọi kết thúc kiểu gì. Bản trước
     * ném tay không ở cả ba nhánh (`max_turns`, `budget`, còn lại) nên tiền
     * biến mất khỏi sổ — đo được ở ca `P-260820-2219-5ltb`: 9 lượt tool, sổ
     * ghi $0. Nhánh `interrupted` ngay trên đã làm đúng từ đầu; đây là bịt ba
     * đường còn lại vào cùng một hình dạng.
     *
     * `observed` vào đây ngày 21/08 vì **đúng câu chuyện đó lặp lại y hệt trên
     * một trường khác**: file đã ghi cũng tồn tại dù lượt gọi kết thúc kiểu gì,
     * mà ba nhánh này vẫn báo `landed: []`. Ca `P-260821-1827-m78h` chạm trần
     * chi phí CHÍN GIÂY SAU khi ghi xong bảng kết quả đúng và đủ, rồi nói với
     * người dùng là *"chưa ra kết quả"*.
     *
     * Gói ở MỘT chỗ chứ không rắc `{ usage }` vào từng lời gọi: thêm một nhánh
     * ném mới trong tương lai thì nó tự đúng, không cần ai nhớ. Bài học lần
     * trước dừng ở đây — lần này nó phải bao cả hai trường, và khi thêm trường
     * thứ ba thì cũng thêm vào đúng chỗ này.
     */
    const fail = (message: string, kind: FailureKind): RunError =>
      new RunError(message, kind, { cause: err, usage, observed: observed() });

    /**
     * `RunError` ném từ TRONG vòng lặp (ví dụ `error_max_budget_usd`) chưa kịp
     * biết gì cả — dựng lại, giữ nguyên câu và `kind`.
     *
     * ⚠ Điều kiện phải kiểm CẢ HAI trường. Bản trước viết `err.usage ? err : …`
     * nên một lỗi đã mang `usage` được ném thẳng qua và **không bao giờ nhận
     * được `observed`** — đúng cái cửa mà `budget` sẽ đi qua sau này.
     */
    if (err instanceof RunError) {
      throw err.usage && err.observed ? err : fail(err.message, err.kind);
    }

    const kind = classifyError(err);
    if (kind === 'max_turns') {
      // Không phải "lỗi" — là nhân viên bị cắt giữa chừng. Nói rõ sửa ở đâu.
      throw fail(
        `"${role.display_name || role.id}" hết lượt cho phép (${role.budget.max_turns}) khi làm ${brief.task_id}. ` +
          `Việc này cần nhiều bước hơn: nới max_turns trong roles/${role.id}.yaml, ` +
          `hoặc chia nhỏ yêu cầu, hoặc viết hướng dẫn rõ hơn để nhân viên bớt dò dẫm.`,
        'max_turns',
      );
    }
    throw fail(errorMessage(err), kind);
  } finally {
    release?.();
  }

  // Bị ngắt mà vòng lặp kết thúc ÊM (không ném lỗi) thì cũng phải dừng ở đây.
  // Đi tiếp là gọi thêm một lượt "sửa receipt" — tốn tiền cho một việc người
  // dùng vừa bảo dừng.
  if (interrupted) return stoppedReceipt(office, brief, role, usage, started, observed());

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
        answer: '',
        artifacts: [],
        lessons: [],
        blocked_on: `receipt không hợp lệ: ${parsed.problem ?? 'không rõ'}`,
      };

  const capped = enforceCap(body, office.company.budgets.receipt_tokens);

  /**
   * Task `file` mà nhân viên vẫn gửi kèm `answer` thì BỎ, không chuyển tiếp.
   *
   * Không phải kỷ luật vặt: `answer` bay thẳng lên chat với tư cách câu trả lời
   * cho người dùng. Một bài viết 300 từ lọt vào đó sẽ hiện nguyên trong ô chat
   * NGAY CẠNH khối "kết quả đã lưu tại" — người dùng đọc cùng một nội dung hai
   * lần, ở hai dạng, và không biết cái nào mới là bản thật.
   *
   * Chốt bằng code vì `deliver` là thứ TA đặt, không phải thứ model đoán: nó
   * không được phép tự quyết đổi hình dạng giao hàng giữa chừng.
   */
  if (brief.deliver !== 'reply') capped.answer = '';

  return {
    ...capped,
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked,
    ...observed(),
  };
}

// ───────────────────────────────────────────────────── luật: ghi trong văn phòng

/**
 * Cửa chặn ghi ra ngoài thư mục văn phòng. Xem khối `hooks` ở `runWorker`.
 *
 * Trả `deny` kèm ĐƯỜNG DẪN ĐÚNG PHẢI DÙNG, không chỉ trả lời "không". Một câu
 * từ chối trống rỗng thì model dò lại bằng một đường dẫn sai khác — mỗi lần dò
 * là một lượt trả tiền để nhận về một lời từ chối (§5 "`tools` vs
 * `allowedTools`", cái giá thứ 2). Nói luôn chỗ đúng thì nó ghi được ở lượt kế.
 */
function officeJail(dirs: JailDirs, mode: 'read' | 'write') {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const raw = (input['tool_input'] ?? {}) as Record<string, unknown>;
    // Bốn tên trường, vì bốn tool khai đường dẫn ở bốn chỗ: `Read`/`Write`/`Edit`
    // dùng `file_path`, `NotebookEdit` dùng `notebook_path`, `Grep`/`Glob` dùng
    // `path`. Sót một tên là để hở đúng một tool, và im lặng — cùng bài học
    // `SHELL_ALIASES`: một danh sách tên viết tay là chỗ lỗi quay lại.
    const target = str(raw['file_path']) || str(raw['notebook_path']) || str(raw['path']);

    const zone = guardedZone(dirs, target, mode);
    if (!zone) return {};

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: JAIL_REASON[zone](target),
      },
    };
  };
}

interface JailDirs {
  companyDir: string;
  officeDir: string;
}

/**
 * Câu từ chối, mỗi vùng một câu — và cả ba đều CHỈ ĐƯỜNG, không chỉ nói "không".
 *
 * Một câu từ chối trống rỗng thì model dò lại bằng một đường dẫn sai khác, và
 * mỗi lần dò là một lượt trả tiền để nhận về một lời từ chối (§5 "`tools` vs
 * `allowedTools`", cái giá thứ 2).
 *
 * ⚠ `config` cố ý nói ra *cách đúng để làm việc đó* thay vì chỉ cấm: yêu cầu
 * "đổi cấu hình" hầu như luôn đến từ một việc HỢP LỆ mà người dùng vừa giao.
 * Cấm mà không chỉ đường thì nhân viên báo `blocked` và người dùng không hiểu
 * vì sao — trong khi thứ họ cần chỉ là bấm một công tắc trên giao diện.
 */
const JAIL_REASON: Record<GuardedZone, (t: string) => string> = {
  secrets: (t) =>
    `"${t}" nằm trong thư mục trạng thái nội bộ (.state). Đó là nơi giữ CHÌA KHOÁ và sổ ` +
    `công việc của hệ thống — không nhân viên nào đọc hoặc ghi ở đó, kể cả khi được yêu cầu. ` +
    `Bạn không cần chìa khoá để dùng một công cụ đã được cắm sẵn: cứ gọi tool của nó.`,
  config: (t) =>
    `"${t}" là file CẤU HÌNH của văn phòng (vai trò, kỹ năng, sơ đồ, kết nối). Nó chỉ được ` +
    `đổi qua giao diện, để mỗi thay đổi có người chịu trách nhiệm và có dấu vết trong nhật ký. ` +
    `Nếu việc này cần một quyền bạn chưa có, hãy DỪNG và nói rõ bạn thiếu gì.`,
  outside: (t) =>
    `Đường dẫn "${t}" nằm ngoài thư mục văn phòng. Mọi kết quả phải ghi BÊN TRONG ` +
    `thư mục làm việc hiện tại — dùng đường dẫn tương đối như "artifacts/<...>" ` +
    `và không đi lên cấp trên bằng "..".`,
};

// ─────────────────────────────────────────── lặp thao tác & tài liệu đã chạm

/**
 * Hai thứ suy ra từ CÙNG luồng `tool_use` mà ta vốn đã bóc để dựng dòng
 * "đang làm gì". Không thêm một lượt gọi nào, không đụng một chữ prompt nào.
 */
interface LoopWatch {
  /** chữ ký `tool+tham số` đã gặp — gặp lại lần hai là lặp y nguyên */
  signatures: Set<string>;
  /** file đã ĐỌC — đọc lại lần hai là vi phạm "read each file at most once" */
  read: Set<string>;
  /** file đã GHI — đọc lại nó là vi phạm "never read back a file you just wrote" */
  written: Set<string>;
  /** file trong `library/` đã chạm → nguồn của `depends_on` */
  libraryReads: Set<string>;
  looped: boolean;
}

function newLoopWatch(): LoopWatch {
  return {
    signatures: new Set(),
    read: new Set(),
    written: new Set(),
    libraryReads: new Set(),
    looped: false,
  };
}

/**
 * CA NÀY CÓ LẶP KHÔNG — đo bằng thao tác, KHÔNG bằng số lượt.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ba dấu hiệu, và cả ba đều là VI PHẠM MỘT LUẬT `CORE_PROMPT` ĐÃ VIẾT RA.  │
 * │                                                                          │
 * │   gọi lại đúng tool với đúng tham số  →  không có luật nào cho phép      │
 * │   đọc lại file đã đọc                 →  "Read each file at most once"   │
 * │   đọc lại file vừa ghi                →  "Never read back a file you     │
 * │                                           just wrote. It saved."         │
 * │                                                                          │
 * │ Vì thế đây KHÔNG phải một heuristic mới — nó chỉ là đo xem kỷ luật ta đã │
 * │ tuyên bố có được tuân thủ không. Và nó MODEL-INDEPENDENT: haiku hay      │
 * │ sonnet, đọc hai lần vẫn là đọc hai lần.                                  │
 * │                                                                          │
 * │ ⚠ ĐỪNG thay bằng `turns >= N`. Đã thử, đã bị bộ test bác: số lượt là     │
 * │ thuộc tính của MODEL (haiku 10 vs sonnet 4 cho cùng một việc), nên nó    │
 * │ gắn cờ mọi văn phòng `eco` và bỏ sót mọi văn phòng `deep`. → types.ts    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Grep`/`Glob` CỐ Ý không tính vào "đọc": tìm nhiều lần với từ khoá khác nhau
 * là cách làm việc ĐÚNG, không phải dò dẫm. Chỉ lặp Y NGUYÊN mới bị bắt, và ca
 * đó đã nằm trong `signatures`.
 */
function observeCall(w: LoopWatch, call: ToolCall): void {
  const sig = `${call.name}|${stableJson(call.input)}`;
  if (w.signatures.has(sig)) w.looped = true;
  w.signatures.add(sig);

  const file = normalizeRel(str(call.input['file_path']) || str(call.input['notebook_path']));

  if (call.name === 'Write' || call.name === 'Edit' || call.name === 'NotebookEdit') {
    if (file) w.written.add(file);
    return;
  }

  if (call.name === 'Read' && file) {
    if (w.read.has(file) || w.written.has(file)) w.looped = true;
    w.read.add(file);
    // Chỉ tủ tài liệu mới sinh ràng buộc: kinh nghiệm rút ra từ một artifact
    // của chính ca này thì không có gì để phụ thuộc vào — artifact đó là kết
    // quả của ca, không phải nguồn sự thật người dùng đang giữ.
    if (/^library\//.test(file)) w.libraryReads.add(file);
  }
}

/** Khoá ổn định: model đảo thứ tự khoá JSON không được tính là một thao tác khác. */
function stableJson(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, Object.keys(input).sort());
  } catch {
    return '';
  }
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
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
  observed: Observed,
): Receipt {
  const written = filesOnDisk(office.dir, brief.outputs.map((o) => o.path), observed.landed);

  return {
    status: 'blocked',
    say: written.length
      ? `Đã dừng giữa chừng. Có ${written.length} file đã ghi dở, xem lại trước khi dùng.`
      : 'Đã dừng theo yêu cầu của bạn, chưa ghi gì.',
    // Người dùng vừa bấm Dừng. Đẩy một câu trả lời dở dang lên chat như thể nó
    // là kết quả hoàn chỉnh là đúng loại nói dối `stoppedReceipt` sinh ra để bỏ.
    answer: '',
    artifacts: written,
    lessons: [],
    blocked_on: 'người dùng dừng giữa chừng',
    // Người dùng bấm Dừng KHÔNG phải bài học — nhân viên không làm gì sai và
    // không có gì để rút kinh nghiệm. Thiếu dòng này thì `agentFault` đọc
    // `blocked_on` ở trên như lời khai của nhân viên và đi hỏi model "học được
    // gì" cho một việc chính người dùng vừa bảo đừng làm. → `agentFault`
    failure: 'stopped',
    task_id: brief.task_id,
    role: role.id,
    usage,
    wall_ms: Date.now() - started,
    reasked: false,
    ...observed,
  };
}

/**
 * MỚ DỞ DANG CÓ THẬT TRÊN ĐĨA — dùng chung cho MỌI đường ra.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Xuất ra và import chung, KHÔNG chép sang `scheduler.ts`.                  │
 * │                                                                          │
 * │ Luật 19/08: *"một dòng chú thích ⚠ phải khớp bên kia KHÔNG phải một cơ    │
 * │ chế — hai bản mã của cùng một phép toán sẽ lệch, hãy import chung một     │
 * │ hàm."* Phép toán ở đây là *"nhân viên để lại gì trên đĩa"*, và nó có bốn  │
 * │ nơi cần hỏi (xong · bị ngắt · chạm trần · lỗi lạ). Bốn bản chép là bốn    │
 * │ cơ hội để một nhánh lại quên.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Gộp hai nguồn: file NÓ ĐƯỢC GIAO ghi (`brief.outputs`) và file ta THẤY nó ghi
 * (`landed`). Nguồn hai bắt được cả file phụ nó tự tạo — thứ brief không biết
 * trước, và cũng là thứ dễ bị bỏ quên lại trên đĩa nhất.
 */
export function filesOnDisk(officeDir: string, promised: readonly string[], landed: readonly Landing[]): string[] {
  const candidates = [...promised, ...landed.filter((l) => l.kind === 'file').map((l) => l.ref)];
  return [...new Set(candidates)].filter((p) => {
    try {
      return fs.existsSync(safeJoin(officeDir, p));
    } catch {
      return false;
    }
  });
}

/**
 * File nhân viên ghi RA NGOÀI văn phòng, và thật sự có trên đĩa.
 *
 * Kiểm `existsSync` chứ không tin `landed` suông: `landed` chỉ chứng minh model
 * đã GỌI `Write`, không chứng minh cú ghi đó thành công. Ta chỉ nói với người
 * dùng về file ta sờ được.
 */
export function straysOnDisk(landed: readonly Landing[]): string[] {
  const out = landed.filter((l) => l.kind === 'outside').map((l) => l.ref);
  return [...new Set(out)].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
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

/**
 * SỐ TOKEN LẤY TỪ `modelUsage`, KHÔNG LẤY TỪ `usage`. → SPEC-token-economy.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỌC THẲNG TỪ `.d.ts` CỦA SDK, KHÔNG PHẢI SUY ĐOÁN (sdk.d.ts:4453):       │
 * │                                                                          │
 * │   usage: "MAIN AGENT LOOP ONLY — excludes Task subagent, sidechain, and  │
 * │           auxiliary model calls, and is PER-TURN in streaming-input      │
 * │           sessions. Prefer modelUsage for token/cost accounting."        │
 * │   total_cost_usd: "Cumulative … each result carries the running total"   │
 * │                                                                          │
 * │ Ta CHẠY streaming-input mode (`oneMessage()`), nên vế "per-turn" áp dụng  │
 * │ cho ta. Bản trước lấy token từ `usage` (MỘT LƯỢT) và tiền từ              │
 * │ `total_cost_usd` (TÍCH LUỸ) — hai đơn vị khác nhau trong cùng một dòng sổ.│
 * │                                                                          │
 * │ Đo được ở ca `P-260821-1827-m78h`: sổ ghi `out 59, cacheRead 0` bên cạnh  │
 * │ `$0.4248`. Với sonnet thì 59 token đầu ra là khoảng $0.001 — sổ lệch 14×. │
 * │ Nó lệch to nhất đúng ở ca `budget`/`max_turns`, tức ca ĐẮT NHẤT và cũng   │
 * │ là ca người dùng cần con số nhất.                                        │
 * │                                                                          │
 * │ `modelUsage` cộng dồn theo từng model VÀ có sẵn `costUSD` — nó vốn đã nằm │
 * │ trong tay ta, chỉ đang bị dùng mỗi việc lấy tên model ở `dominantModel`.  │
 * │                                                                          │
 * │ ⚠ Giữ `total_cost_usd` làm nguồn TIỀN: nó bao cả lượt phụ trợ mà          │
 * │ `modelUsage` có thể không kê hết, và trần `maxBudgetUsd` của SDK đo theo  │
 * │ chính con số này — sổ của ta phải nói cùng thứ tiếng với cái phanh.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function readUsage(result: Record<string, unknown>): Usage {
  const mu =(result['modelUsage'] ?? {}) as Record<string, Record<string, number>>;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let summed = 0;
  for (const m of Object.values(mu)) {
    input += m['inputTokens'] ?? 0;
    output += m['outputTokens'] ?? 0;
    cacheRead += m['cacheReadInputTokens'] ?? 0;
    cacheWrite += m['cacheCreationInputTokens'] ?? 0;
    summed += m['costUSD'] ?? 0;
  }

  // SDK cũ / ca crash sớm có thể không kê `modelUsage`. Rơi về `usage` còn hơn
  // ghi 0 — nhưng chỉ khi thật sự không có gì, không phải làm mặc định.
  const u = (result['usage'] ?? {}) as Record<string, number>;
  const empty = Object.keys(mu).length === 0;

  return {
    input: empty ? (u['input_tokens'] ?? 0) : input,
    output: empty ? (u['output_tokens'] ?? 0) : output,
    cacheRead: empty ? (u['cache_read_input_tokens'] ?? 0) : cacheRead,
    cacheWrite: empty ? (u['cache_creation_input_tokens'] ?? 0) : cacheWrite,
    costUSD: typeof result['total_cost_usd'] === 'number' ? result['total_cost_usd'] : summed,
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

/**
 * Đổi hoạt động của agent thành một câu tiếng người cho UI. Không tốn token.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NÓI RA THỨ TA ĐÃ CẦM TRONG TAY.                                          │
 * │                                                                          │
 * │ Bản trước trả về "đang tìm trong dự án" cho CẢ `Grep` lẫn `Glob`, không  │
 * │ kèm từ khoá, không kèm chỗ tìm. Một lượt tìm song song 4 chỗ hiện ra 4   │
 * │ dòng giống hệt nhau trong cùng một giây — người dùng đọc nhật ký và      │
 * │ không biết nhân viên đang làm gì, chỉ biết nó đang bận.                  │
 * │                                                                          │
 * │ Từ khoá và đường dẫn nằm sẵn trong `call.input`. Ta ĐANG CẦM chúng, nên  │
 * │ không nói ra là tự nguyện mù — cùng một luật với khối "kết quả nằm ở     │
 * │ đâu": thứ gì quan sát được thì đừng để người dùng phải đoán.             │
 * │                                                                          │
 * │ Và "dự án" là từ của lập trình viên. Người dùng của ta mở tiệm hoa.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function describeCall(call: ToolCall): string {
  const file = typeof call.input['file_path'] === 'string' ? basename(call.input['file_path']) : '';
  switch (call.name) {
    case 'Read':
      return file ? `đang đọc ${file}` : 'đang đọc tài liệu';
    case 'Write':
    case 'Edit':
      return file ? `đang viết ${file}` : 'đang viết kết quả';
    case 'Grep':
    case 'Glob': {
      const what = str(call.input['pattern']);
      const room = roomOf(str(call.input['path']));
      const term = what && what.length <= 40 ? ` “${what}”` : '';
      return `đang tìm${term} trong ${room}`;
    }
    case 'WebSearch':
      return 'đang tìm trên web';
    case 'WebFetch':
      return 'đang đọc một trang web';
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ NÓI RA LỆNH, KHÔNG CHỈ NÓI "CÓ CHẠY LỆNH".                           │
     * │                                                                      │
     * │ Bản trước trả đúng chuỗi `'đang chạy lệnh'` cho mọi lệnh — trong khi  │
     * │ `call.input['command']` đang nằm ngay trong tay. Đó là tự nguyện mù,  │
     * │ cùng lỗi với `landingOf` từng nuốt đường dẫn ghi ra ngoài.            │
     * │                                                                      │
     * │ Và nó nặng lên hẳn từ 22/08, khi `Bash` thành MẶC ĐỊNH BẬT: đây là    │
     * │ tool duy nhất ra được khỏi thư mục văn phòng, `officeJail` không khớp │
     * │ được nó, cổng `write_external` thì chưa cài. Dòng này là **cửa sổ duy │
     * │ nhất** người dùng có để thấy nhân viên vừa làm gì với cái máy của họ. │
     * │                                                                      │
     * │ Cắt ở 60 ký tự: dòng trạng thái chỉ có một dòng, mà một lệnh có       │
     * │ pipe dài vài trăm ký tự sẽ đẩy mọi thứ khác ra khỏi màn hình. Phần    │
     * │ đầu của lệnh là phần nói lên ý định (`git log …`, `ls …`, `curl …`).  │
     * │ Xuống dòng bị thu về dấu cách — một lệnh nhiều dòng làm vỡ bố cục.    │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    // Cả hai tên: `Bash` trên POSIX, `PowerShell` trên Windows. → types.ts
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(call.input['command']).replace(/\s+/g, ' ');
      if (!cmd) return 'đang chạy lệnh';
      return `đang chạy: ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}`;
    }
    default: {
      const server = mcpServerOf(call.name);
      return server ? `đang làm việc với ${server}` : `đang dùng ${call.name}`;
    }
  }
}

/**
 * Đường dẫn tìm kiếm → tên căn phòng mà người dùng biết.
 *
 * Người dùng không biết `library/text/` là gì, nhưng họ biết "tủ tài liệu" vì
 * họ vừa thả file vào đó. Ánh xạ thư mục → tên trên giao diện, và mặc định là
 * "văn phòng" chứ không phải "dự án".
 */
function roomOf(searchPath: string): string {
  const p = searchPath.replace(/\\/g, '/');
  if (/(^|\/)library(\/|$)/.test(p)) return 'tủ tài liệu';
  if (/(^|\/)artifacts(\/|$)/.test(p)) return 'kết quả đã có';
  if (/(^|\/)knowledge(\/|$)/.test(p)) return 'kho tri thức';
  return 'văn phòng';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

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
      // Nhốt trong thư mục văn phòng: `safeJoin` ném nếu đi ra ngoài.
      const abs = safeJoin(officeDir, raw);
      const rel = relative(officeDir, abs).replace(/\\/g, '/');
      return rel ? { kind: 'file', ref: rel } : undefined;
    } catch {
      /**
       * RA NGOÀI VĂN PHÒNG VẪN LÀ MỘT ĐIỂM ĐẾN — khai đúng tên nó.
       *
       * Bản trước trả `undefined`, tức là nói "không có điểm đến nào". Sai:
       * ta biết CHẮC nó vừa ghi, và biết CHẮC ghi ở đâu. Thứ ta không có là
       * QUYỀN gọi đó là kết quả hợp lệ của người dùng — và đó là chuyện khác.
       *
       * Nhãn `outside` giữ đúng hai nửa: sự việc thì khai, tính hợp lệ thì
       * không. `whereBlock` vẫn không liệt kê nó vào "kết quả đã lưu tại";
       * `missingOutputs` thì dùng nó để nói *"file nằm ở X"* thay vì
       * *"chưa có gì, làm lại nhé"* — câu sau bắt người dùng trả tiền lần hai.
       */
      return { kind: 'outside', ref: raw.replace(/\\/g, '/') };
    }
  }
  // `EXTERNAL_TOOLS` chứ không phải `=== 'Bash'`: tool shell mang tên khác nhau
  // theo hệ điều hành, và một điểm đến bị bỏ sót là một điểm đến bị GIẤU.
  if (EXTERNAL_TOOLS.has(call.name)) return { kind: 'command', ref: '' };
  const server = mcpServerOf(call.name);
  return server ? { kind: 'external', ref: server } : undefined;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HỎI LẠI XEM CLI NHẬN ĐƯỢC GÌ — thay vì tin là nó nhận đủ.               │
 * │                                                                          │
 * │ Đây là dòng code sinh ra từ ca 22/08: tool shell tên `PowerShell` trên   │
 * │ Windows, `Bash` trên POSIX, và `Options.tools` là allowlist theo TÊN     │
 * │ **bỏ im lặng** tên không tồn tại. Vai trò khai `Bash` trên Windows nhận  │
 * │ đúng bộ mặc định — công tắc "cho chạy lệnh" là no-op suốt SÁU NGÀY, và   │
 * │ không có một triệu chứng nào.                                            │
 * │                                                                          │
 * │ `effectiveTools` đã bịt ca đó bằng cách gửi mọi tên. Nhưng bản vá ấy     │
 * │ dựa trên một bảng tên **ta viết tay**, mà bảng tên là của SDK. Xuất hiện │
 * │ một nền tảng thứ tư với tên thứ ba thì lỗi cũ quay lại y nguyên, im      │
 * │ lặng y nguyên.                                                           │
 * │                                                                          │
 * │ Nên chốt chặn thật không phải bảng tên — mà là **phép đối chiếu này**:   │
 * │ `system/init` có trường `tools` liệt kê thứ CLI thật sự cấp. So với thứ  │
 * │ ta gửi, khác thì kêu. Nó không cần biết tên nào đúng; nó chỉ cần biết    │
 * │ "thứ tôi xin và thứ tôi nhận không khớp". Đó là bất biến bền hơn hẳn     │
 * │ một danh sách chuỗi.                                                     │
 * │                                                                          │
 * │ Cảnh báo mức TIẾN TRÌNH, không phải mức người dùng: người vận hành tiệm  │
 * │ hoa không làm gì được với câu này, còn người cài đặt hệ thống thì có.    │
 * │ Một lần cho mỗi (vai trò × bộ tool thiếu) — worker chạy liên tục, kêu    │
 * │ mỗi lượt là biến một tín hiệu thật thành nhiễu ai cũng bỏ qua.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const warned = new Set<string>();

export function warnDroppedTools(role: Role, granted: unknown): string[] {
  if (!Array.isArray(granted)) return [];
  const got = new Set(granted.filter((t): t is string => typeof t === 'string'));

  /**
   * Tên shell tính theo NHÓM, không theo từng cái. Ta cố ý gửi cả `Bash` lẫn
   * `PowerShell` và **mong** một cái bị bỏ — kêu vì cái đó là tự tạo báo động
   * giả ở mọi lượt chạy, trên mọi hệ điều hành.
   */
  const asked = effectiveTools(role.tools);
  const dropped = asked.filter((t) => !got.has(t) && !EXTERNAL_TOOLS.has(t));
  if (hasShell(role.tools) && !asked.some((t) => EXTERNAL_TOOLS.has(t) && got.has(t))) {
    dropped.push('(tool chạy lệnh)');
  }
  if (dropped.length === 0) return [];

  const key = `${role.id}:${dropped.join(',')}`;
  if (!warned.has(key)) {
    warned.add(key);
    process.emitWarning(
      `Vai trò "${role.id}" xin ${dropped.length} tool mà Claude Code không cấp: ${dropped.join(', ')}. ` +
        `CLI bỏ im lặng tên tool nó không có, nên tính năng này đang KHÔNG chạy. ` +
        `Kiểm bảng tên ở src/core/types.ts §SHELL_ALIASES.`,
    );
  }
  return dropped;
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
