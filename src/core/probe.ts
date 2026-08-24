/**
 * BẮT TAY THỬ MỘT CÁNH TAY — nguồn của nút "Thử ngay", của dòng năng lực, và
 * của con số token hiện trên node. → docs/SPEC-arms.md §3a · §6c · §7 · §9b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BA THỨ ĐO ĐƯỢC 23/08 (`scripts/spike-mcp.ts`) MÀ FILE NÀY DỰNG TRÊN.     │
 * │                                                                          │
 * │ ① CONTROL REQUEST CHỈ CHẠY KHI CLI RẢNH. Phải mở query bằng generator    │
 * │   GIỮ STREAM MỞ mà không gửi tin nào, và VẪN phải tiêu thụ luồng để phản │
 * │   hồi được bơm ra. Khuôn gốc: `core/energy.ts §refresh`. Đo hỏng 4/4 lần │
 * │   trước khi ai hiểu ra (§5n ⑤).                                          │
 * │                                                                          │
 * │ ② `pending` LÀ TRẠNG THÁI CÓ THẬT, KÉO DÀI NHIỀU GIÂY.                   │
 * │                                                                          │
 * │   ⚠ ĐÍNH CHÍNH 24/08 (`scripts/spike-npx-cost.ts`, 10 lượt): câu cũ ghi  │
 * │   *"4 s sau khi cache npx ấm, 17,7 s lần đầu"*. Số thật với gói ĐÃ cache │
 * │   là **7,7–9,2 s, và lần đầu bằng lần thứ ba** — "lần sau nhanh hơn" là  │
 * │   một mệnh đề chưa ai đo, sinh từ ĐÚNG MỘT lần bấm giờ thuận lợi rồi     │
 * │   được chép vào ba chỗ. ~3,2 s là phí tự thân của `npx`: chạy thẳng      │
 * │   `node <file đã cache>` chỉ mất 0,8 s.                                  │
 * │                                                                          │
 * │   Hỏi MỘT LẦN rồi kết luận                                               │
 * │   là đo THỜI ĐIỂM HỎI chứ không đo cái server — lần đo đầu của spike đã  │
 * │   ra "0 tool, không có annotations" theo đúng cách đó.                   │
 * │                                                                          │
 * │ ③ `getContextUsage()` và HOÁ ĐƠN LỆCH 27%, và không đo cùng một thứ.     │
 * │   File này trả số của `getContextUsage` vì nó phân rã tới TỪNG TOOL —     │
 * │   đúng thứ giao diện cần. Đừng đem con số này đi tính tiền.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Không tốn token: không tin nhắn nào được gửi, không lượt suy luận nào chạy.
 * Giá của nó là ĐĨA và THỜI GIAN.
 */

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { ensureInstalled, fastLaunch } from './armexec.js';

/** Đúng bộ `effectiveTools([])` của một vai trò trần — để số token so sánh được. */
const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

/** Lần đầu `npx` phải tải gói: đo được 17,7 s. Trần phải rộng hơn thế hẳn. */
const CONNECT_TIMEOUT_MS = 45_000;
const POLL_MS = 500;

export interface ProbedTool {
  name: string;
  description?: string;
  /**
   * Mức duyệt suy từ `annotations`. → SPEC-arms.md §8a-bis
   *
   * ⚠ MỘT CHIỀU: chỉ LEO THANG, không bao giờ HẠ CẤP. `annotations` là **gợi ý
   * của server**, không phải bảo đảm — một server viết ẩu (hoặc cố ý) khai
   * `readOnly: true` cho một tool xoá dữ liệu.
   */
  level: 'read' | 'write_external';
}

export interface ProbeResult {
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverName?: string;
  serverVersion?: string;
  /** NGUYÊN VĂN câu lỗi của server. Là chuỗi duy nhất người dùng copy đi hỏi được. */
  error?: string;
  tools: ProbedTool[];
  /** Token cánh tay này cộng vào prefix mỗi lượt. `undefined` = chưa đo được. */
  tokens?: number;
  /** Mili-giây từ lúc mở query tới lúc rời `pending`. Để giao diện biết nên chờ. */
  connectMs: number;
}

/**
 * ⚠ `destructive: true` ⇒ `write_external`, KHÔNG phải `irreversible`.
 *
 * Đo 23/08: `filesystem` gắn `destructive` cho `write_file`/`edit_file`/`move_file`.
 * Map chúng vào `irreversible` thì MỌI lần ghi một file đều phải hỏi người dùng —
 * trong khi `irreversible` được định nghĩa là *"gửi đi · xoá · trả tiền · đăng
 * công khai"*, tức RỜI KHỎI thế giới của người dùng. Ghi file lên đĩa của chính
 * họ không phải chuyện đó.
 *
 * ⇒ `irreversible` KHÔNG suy được từ annotations. Nó phải đến từ danh mục ta
 * curate hoặc từ người dùng bấm — cả hai đều có chủ thể chịu trách nhiệm.
 * → SPEC-arms.md §8a-bis
 */
function levelOf(a: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined) {
  // Không khai gì ⇒ `write_external`. AN TOÀN KHI KHÔNG BIẾT, và ca này CÓ THẬT:
  // `create_directory` của `filesystem` không có annotation nào.
  return a?.readOnly === true ? ('read' as const) : ('write_external' as const);
}

/**
 * Mở một phiên RỖNG chỉ để bắt tay với `servers`, rồi đóng. Không gửi tin nào.
 *
 * `baseline` = kết quả của một lần probe KHÔNG có MCP; truyền vào thì `tokens`
 * là phần CHÊNH LỆCH (thứ cánh tay này thật sự cộng thêm). Thiếu nó thì `tokens`
 * là tổng cửa sổ ngữ cảnh — một con số đúng nhưng trả lời câu hỏi khác.
 */
export async function probeArm(
  servers: Record<string, McpServerConfig>,
  baseline?: number,
  /**
   * Chìa tiêm vào tiến trình MCP — PHẢI là đúng bộ mà `pickMcp` sẽ tiêm lúc
   * chạy thật. Thiếu nó thì nút "Thử ngay" kiểm một cấu hình KHÔNG CÓ CHÌA rồi
   * báo ✓, và cánh tay hỏng ở lần đầu một nhân viên dùng nó.
   */
  env?: Record<string, string>,
): Promise<ProbeResult> {
  if (env && Object.keys(env).length) {
    for (const [name, cfg] of Object.entries(servers)) {
      // Chỉ server chạy bằng tiến trình con mới có `env`. Server HTTP nhận chìa
      // qua `headers` — chưa nối, và §5a đã ghi đó là một lỗ còn mở.
      if (cfg && typeof cfg === 'object' && 'command' in cfg) {
        servers[name] = { ...cfg, env: { ...(cfg as { env?: Record<string, string> }).env, ...env } };
      }
    }
  }
  /**
   * CÀI SẴN NGAY Ở ĐÂY, và đây là chỗ ĐÚNG để chờ nó.
   *
   * Nút "Thử ngay" là lúc DUY NHẤT người dùng còn đứng đó và biết mình đang chờ
   * một cánh tay mới. Đẩy lần cài sang lượt chạy đầu tiên là dời khoản chờ vào
   * giữa một việc đang chạy, lúc họ đã bỏ đi — đúng lý lẽ đã dùng để GIỮ phép
   * thử này (§6c). Nên trả nó ở đây, một lần, rồi mọi lượt sau nhanh mãi.
   *
   * Hỏng thì đi tiếp: `fastLaunch` trả về `npx` như cũ và phép thử vẫn đúng.
   */
  for (const cfg of Object.values(servers)) {
    await ensureInstalled(cfg as Record<string, unknown>);
  }
  for (const [name, cfg] of Object.entries(servers)) {
    servers[name] = fastLaunch(cfg as Record<string, unknown>) as McpServerConfig;
  }

  const t0 = Date.now();
  let release: (() => void) | undefined;

  // Generator KHÔNG BAO GIỜ yield — đây chính là thứ giữ CLI ở trạng thái "đang
  // chờ input", tức RẢNH. Đổi nó thành generator có gửi tin là làm hỏng cả cơ chế.
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      tools: BASE_TOOLS,
      allowedTools: BASE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: servers,
    },
  });

  // Phải TIÊU THỤ luồng, nếu không phản hồi control không được bơm ra.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* chỉ cần luồng chảy */
      }
    } catch {
      /* đóng giữa chừng thì SDK ném — đúng thiết kế */
    }
  })();

  const out: ProbeResult = { status: 'pending', tools: [], connectMs: 0 };

  try {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let last;
    while (Date.now() < deadline) {
      last = await q.mcpServerStatus();
      if (last.length && last.every((s) => s.status !== 'pending')) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    out.connectMs = Date.now() - t0;

    const s = last?.[0];
    if (s) {
      out.status = s.status;
      out.serverName = s.serverInfo?.name;
      out.serverVersion = s.serverInfo?.version;
      if (s.error) out.error = s.error;
      out.tools = (s.tools ?? []).map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        level: levelOf(t.annotations),
      }));
    }

    // Chỉ đo token khi đã nối được: hỏi lúc `pending` là đo một prefix chưa có
    // tool, tức một con số 0 rất thuyết phục và hoàn toàn vô nghĩa.
    if (out.status === 'connected' && baseline !== undefined) {
      const ctx = (await q.getContextUsage()) as { totalTokens: number };
      out.tokens = Math.max(0, ctx.totalTokens - baseline);
    }
  } catch (e) {
    out.status = 'failed';
    out.error = (e as Error).message;
    out.connectMs = Date.now() - t0;
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }

  return out;
}

/**
 * Prefix của một vai trò TRẦN, không cánh tay nào. Mốc để trừ ra phần của MCP.
 *
 * Nhớ trong tiến trình: nó không đổi giữa hai lần hỏi trong cùng một phiên
 * daemon, và mỗi lần hỏi tốn vài trăm mili-giây.
 */
let baselineCache: number | undefined;

export async function baselineTokens(): Promise<number | undefined> {
  if (baselineCache !== undefined) return baselineCache;

  let release: (() => void) | undefined;
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };
  const q = query({
    prompt: idle(),
    options: {
      tools: BASE_TOOLS,
      allowedTools: BASE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* */
      }
    } catch {
      /* */
    }
  })();

  try {
    const ctx = (await Promise.race([
      q.getContextUsage(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('quá hạn')), 20_000)),
    ])) as { totalTokens: number };
    baselineCache = ctx.totalTokens;
  } catch {
    // Không lấy được thì thôi — `tokens` sẽ là `undefined` và giao diện phải
    // chịu được chuyện đó. Một ô trống thành thật hơn một con số bịa.
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
  return baselineCache;
}
