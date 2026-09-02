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

import { ensureInstalled, fillArm, finishArm } from './armexec.js';
import { missingSecretRefs } from './secrets.js';
import { isCliArm } from './cli-arm.js';
import { isAccountName } from './oauth.js';
import { httpTarget, rawAnnotations } from './mcp-http.js';
import { t } from '../i18n/index.js';

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
  /** Nấc quyền tối thiểu để việc này được cấp. → `tierOf` */
  tier: Tier;
}

export interface ProbeResult {
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverName?: string;
  serverVersion?: string;
  /** NGUYÊN VĂN câu lỗi của server. Là chuỗi duy nhất người dùng copy đi hỏi được. */
  error?: string;
  tools: ProbedTool[];
  /**
   * Nấc quyền ĐÁNG hiện ra, kèm số việc. Tính ở ĐÂY chứ không ở giao diện.
   *
   * ⚠ Luật *"chỉ hiện nếu thêm ≥1 việc so với nấc dưới"* là một quyết định sản
   * phẩm có ca biên tinh tế (server toàn tool đọc ⇒ ba nấc đều bằng nhau ⇒ hai
   * nấc dưới là noise). Để giao diện tự suy là dựng bản thứ hai của luật đó, và
   * bản thứ hai luôn là bản quên mất một điều kiện. → `offeredTiers`
   */
  tiers?: { tier: Tier; count: number }[];
  /** Token cánh tay này cộng vào prefix mỗi lượt. `undefined` = chưa đo được. */
  tokens?: number;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NỐI ĐƯỢC MÀ 0 VIỆC — hỏng, và hỏng KHÔNG có câu lỗi nào. → §5h·7e        │
   * │                                                                          │
   * │ Đo 26/08: gõ sai tên nhóm trong `X-MCP-Toolsets` ⇒ GitHub trả **0 việc   │
   * │ và không báo lỗi gì**. Bắt tay ✓, `status: 'connected'` ✓, và cánh tay    │
   * │ hoàn toàn vô dụng. Đúng họ [[agentco-silent-allowlist]]: allowlist im     │
   * │ lặng bỏ tên lạ, ở đây là allowlist của HÃNG.                              │
   * │                                                                          │
   * │ ⚠ CỐ Ý KHÔNG hỏi *"nhóm nào bị bỏ"*. Server không echo lại danh sách nó  │
   * │ nhận, nên câu đó không trả lời được — và một cơ chế chỉ chạy khi hãng     │
   * │ chịu echo là một cơ chế không chạy. Triệu chứng thì TẤT ĐỊNH và không     │
   * │ cần biết tên hãng nào: **nối được mà không có việc nào**. Một câu hỏi rẻ  │
   * │ hơn, đúng cho mọi server, và không có tên hãng nào trong mã.              │
   * │ → [[agentco-count-mechanisms]] · [[agentco-deterministic-vs-signal]]      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  warn?: string;
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
export function levelOf(a: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined) {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MỘT CHIỀU: KHÔNG BIẾT ⇒ LEO THANG. KHÔNG BAO GIỜ HẠ CẤP. (user 25/08)    │
   * │                                                                          │
   * │   *"đảm bảo nếu 0 biết gì thì nó ở nấc cao hơn, đừng kiểu khai chỉ đọc   │
   * │    mà đến lúc nó thêm/xoá/sửa được là chết dở. Nói tóm lại KHÔNG ĐƯỢC    │
   * │    NÓI DỐI — khi ta không biết, nói toàn quyền là không nói dối."*       │
   * │                                                                          │
   * │ Không khai gì ⇒ `write_external`. Ca này CÓ THẬT: `create_directory` của │
   * │ `filesystem` không mang annotation nào.                                  │
   * │                                                                          │
   * │ 🔴 VÀ ĐÂY LÀ LỖ VỪA VÁ 25/08 — ca **KHAI MÂU THUẪN**:                    │
   * │                                                                          │
   * │      { readOnly: true, destructive: true }                               │
   * │                                                                          │
   * │ Bản cũ chỉ hỏi `readOnly === true` ⇒ xếp nó vào **`read`**, tức một tool │
   * │ tự khai là phá huỷ được cấp dưới nhãn *"chỉ đọc"*. Không cần server nói  │
   * │ dối: chỉ cần nó khai **ẩu**, và một trường mâu thuẫn là dấu hiệu rõ nhất │
   * │ của khai ẩu. Ta đọc lời khai đó theo nghĩa **nặng hơn**, luôn luôn.      │
   * │                                                                          │
   * │ Nó KHÔNG phải giả thuyết: `arms[băm].tools` của cánh tay "chỉ đọc" sinh  │
   * │ ra từ đúng hàm này, và đó là thứ đi thẳng vào `allowedTools` lúc chạy.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
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
   * → SPEC-arms.md §8a-bis · §6j
   */
  const readable = a?.readOnly === true && a?.destructive !== true;
  return readable ? ('read' as const) : ('write_external' as const);
}

/** Ba nấc quyền người dùng chọn lúc cắm. → docs/SPEC-arms.md §6j */
export type Tier = 'read' | 'add' | 'full';

/** Thứ tự lũy tiến. Nấc sau **bao gồm** nấc trước — đó là ý nghĩa của "lũy tiến". */
export const TIERS: readonly Tier[] = ['read', 'add', 'full'];

/**
 * Một việc thuộc nấc nào — **cùng luật một chiều với `levelOf`, cùng một file**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NẤC 2 ĐÒI **ĐỦ HAI** LỜI KHAI TƯỜNG MINH. (user chốt 25/08)             │
 * │                                                                          │
 * │   *"khi chúng ta không biết, chúng ta nói toàn quyền là không nói dối —  │
 * │    điều tương tự cũng đúng với nấc 2"*                                   │
 * │                                                                          │
 * │ Chỗ dễ sai nhất: `destructive: false` đứng MỘT MÌNH trông như một lời    │
 * │ hứa. Nhưng theo spec MCP, `destructiveHint` **chỉ có nghĩa khi            │
 * │ `readOnlyHint` là false** — thiếu vế kia thì nó không nói được điều ta    │
 * │ cần biết ⇒ **không biết** ⇒ nấc 3.                                       │
 * │                                                                          │
 * │ Đặt cạnh `levelOf` chứ không ở file khác: hai hàm trả lời cùng một câu    │
 * │ hỏi ở hai độ phân giải, và để chúng xa nhau là để chúng lệch nhau.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function tierOf(a: { readOnly?: boolean; destructive?: boolean } | undefined): Tier {
  if (levelOf(a) === 'read') return 'read';
  return a?.readOnly === false && a?.destructive === false ? 'add' : 'full';
}

/** Việc được cấp ở một nấc — LŨY TIẾN: `add` gồm cả `read`, `full` gồm tất. */
export function toolsAtTier(tools: readonly ProbedTool[], tier: Tier): string[] {
  const max = TIERS.indexOf(tier);
  return tools.filter((t) => TIERS.indexOf(t.tier) <= max).map((t) => t.name);
}

/**
 * Nấc nào ĐÁNG hiện ra — user chốt 25/08: *"tầng nào 0 việc thì đừng cho chọn,
 * không để một thứ không ý nghĩa hoặc chỉ mang noisy mà không lợi ích gì tồn tại"*.
 *
 * ⚠ Phép kiểm là **`đếm(nấc) > đếm(nấc dưới)`**, KHÔNG phải `> 0`. Một server
 * toàn tool đọc cho ra ba nấc **đều 14 việc** — hai nấc dưới không rỗng nên lọt
 * luật "0 việc", trong khi chúng **hứa thêm quyền mà không đưa gì**.
 */
export function offeredTiers(tools: readonly ProbedTool[]): { tier: Tier; count: number }[] {
  const out: { tier: Tier; count: number }[] = [];
  let prev = 0;
  for (const tier of TIERS) {
    const count = toolsAtTier(tools, tier).length;
    if (count > prev) out.push({ tier, count });
    prev = count;
  }
  return out;
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
  /**
   * Đích của ô trống `<OFFICE_STATE>`. Phải truyền, cùng lý do `env` phải truyền:
   * nút "Thử ngay" mà không điền ô trống thì nó kiểm một cấu hình **khác** thứ sẽ
   * chạy — và ở đây cái khác đó rất cụ thể: trình duyệt sẽ đẻ một thư mục tên
   * `<OFFICE_STATE>` ngay trong thư mục làm việc của daemon.
   */
  dirs?: { officeState: string; officeDir: string },
): Promise<ProbeResult> {
  /**
   * ⚠ CÙNG MỘT HÀM `pickMcp` DÙNG — `armexec.ts §prepareArm`. Đây là bất biến,
   * không phải tiện tay: nút "Thử ngay" phải kiểm **đúng cấu hình sẽ chạy**.
   * Bản cũ ở đây bỏ qua server HTTP (lỗ §5a) ⇒ một cánh tay HTTP cần chìa sẽ
   * báo ✓ ở đây rồi 401 lúc nhân viên đầu tiên dùng nó.
   *
   * 🔴 MỘT LƯỢT, KHÔNG PHẢI HAI. Bản trước gọi `injectSecrets` **hai lần** — một
   * lượt cho `dirs`, một lượt cho `env` — nên cấu hình đi qua hai đường khác
   * nhau tuỳ ô nào được truyền. Với tờ khai CLI thì đó là bẫy chết người: bước
   * biên dịch phải chạy **sau khi đã điền xong hết**, mà "xong hết" không xác
   * định được nếu còn một lượt điền nữa ở phía sau.
   */
  /**
   * ⚠ CHỈ BƯỚC ① Ở ĐÂY. Bước ② (biên dịch) nằm SAU phép kiểm ô trống bên dưới —
   * xem khối chú thích ở `armexec.ts §fillArm`: một cấu hình đã biên dịch chở
   * `McpServer` sống, và `missingSecretRefs` soi bằng `JSON.stringify`.
   */
  const filled: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    filled[name] = fillArm(cfg, env ?? {}, dirs);
    servers[name] = filled[name] as McpServerConfig;
  }
  /**
   * Nhớ **TRƯỚC KHI BIÊN DỊCH** đây có phải tờ khai CLI không: sau bước ② nó đã
   * thành `{type:'sdk'}` và không còn phân biệt được với một MCP bình thường.
   * Câu trả lời chỉ tồn tại ở đây — hỏi muộn hơn là hỏi một vật khác.
   */
  const hasCli = Object.values(filled).some((c) => isCliArm(c));
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CÒN Ô TRỐNG ⇒ DỪNG Ở ĐÂY. Không bắt tay, không chờ 20 giây, không 401.  │
   * │                                                                          │
   * │ Bug user báo 25/08: *"chìa thiếu (để trắng) nó cũng báo câu lệnh y hệt   │
   * │ [chìa sai] mà? Tôi hiểu sai chỗ nào"*. Không sai chỗ nào — cả hai ca đều │
   * │ đi tới cùng một câu 401 của server, mà 401 chỉ nói được *"chìa này sai"*.│
   * │ Server không có cách nào biết ta **chưa từng điền chìa**; ta thì biết.   │
   * │                                                                          │
   * │ Đặt ở đây chứ không ở route HTTP: `probeArm` là cửa CHUNG của nút "Thử   │
   * │ ngay", của `readOnlyTools` lúc bấm Xong, và của mọi phép đo. Đặt ở route │
   * │ là vá một cửa rồi để ba cửa kia giữ nguyên hành vi cũ — đúng lớp lỗi     │
   * │ "hai bản của cùng một luật" đã đốt dự án này nhiều lần.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const missing = missingSecretRefs(servers);
  if (missing.length) {
    /**
     * ⚠ HAI CÂU KHÁC HẲN NHAU, vì hai việc người dùng phải làm khác hẳn nhau.
     * (user bắt 26/08: *"Notion làm gì có chìa nào, human đọc sẽ rất khó hiểu"*)
     *
     *   chìa gõ tay  → "điền vào ô đó"
     *   tài khoản    → "bấm Đăng nhập" — **không có ô nào để điền**
     *
     * Câu cũ gộp cả hai thành *"Thiếu chìa: NOTION_OAUTH_AFAFBCD6"*, tức bảo
     * người ta đi tìm một thứ không tồn tại. Đúng lớp lỗi §5m mà chính câu này
     * sinh ra để chữa — chỉ là ở một cửa khác.
     */
    const accounts = missing.filter((n) => isAccountName(n));
    const keys = missing.filter((n) => !isAccountName(n));
    const parts: string[] = [];
    if (accounts.length) {
      parts.push(
        t('probe.noAccount'),
      );
    }
    if (keys.length) {
      parts.push(t('probe.missingKeys', { keys: keys.join(', ') }));
    }
    return {
      status: 'failed',
      tools: [],
      connectMs: 0,
      error:
        t('probe.notSentBecause', { parts: parts.join(' ') }),
    };
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
  /**
   * BƯỚC ②+③ — biên dịch tờ khai CLI rồi bỏ `npx`. Đứng ở đây, **sau** phép kiểm
   * ô trống ở trên, vì bản đã biên dịch không `JSON.stringify` được.
   * → `armexec.ts §fillArm`
   */
  for (const [name, cfg] of Object.entries(servers)) {
    servers[name] = finishArm(name, cfg, env ?? {}, dirs) as McpServerConfig;
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
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 HỎI THẲNG SERVER VỀ `annotations` — SDK LÀM MẤT MỌI GIÁ TRỊ `false`│
       * │ (đo 26/08, `spike-sdk-annotations.ts`)                               │
       * │                                                                      │
       * │   Notion khai `{readOnlyHint:false, destructiveHint:false}`          │
       * │   SDK đưa ta `{}` ⇒ `tierOf` thấy "không biết" ⇒ leo thang           │
       * │                                                                      │
       * │ Hậu quả: 11/28 tool Notion vốn **chỉ tạo mới** bị xếp vào *toàn       │
       * │ quyền*, nấc giữa vĩnh viễn rỗng, và người dùng muốn *"cho tạo trang,  │
       * │ đừng cho sửa trang cũ"* buộc phải cấp cả sửa lẫn xoá. Đó là **hồi     │
       * │ quy đặc quyền tối thiểu**, không phải chuyện đếm nấc.                 │
       * │                                                                      │
       * │ ⚠ Luật một chiều KHÔNG sai — nó đang xử lý một dữ kiện đã mất trên    │
       * │ đường. Nên bản vá không đụng `tierOf`; nó đi lấy lại dữ kiện.         │
       * │                                                                      │
       * │ Hỏng ⇒ `raw` rỗng ⇒ rơi về annotations của SDK, tức đúng hành vi      │
       * │ trước 26/08: tệ hơn nhưng **không sai** (leo thang = an toàn).        │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const target = out.status === 'connected' ? httpTarget(Object.values(servers)[0]) : undefined;
      const raw = target ? await rawAnnotations(target.url, target.headers) : new Map();

      out.tools = (s.tools ?? []).map((t) => {
        // Thô đè SDK khi có — nó là bản ĐẦY ĐỦ hơn của cùng một thứ. Không có
        // thì dùng bản SDK, không trộn nửa nọ nửa kia (trộn là tạo ra một bộ
        // annotations chưa server nào từng khai).
        const a = raw.get(t.name);
        const ann = a
          ? { readOnly: a.readOnlyHint, destructive: a.destructiveHint, openWorld: a.openWorldHint }
          : t.annotations;
        return {
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          level: levelOf(ann),
          tier: tierOf(ann),
        };
      });
      /**
       * ⚠ CÁNH TAY CLI KHÔNG CÓ NẤC — user chốt 30/08, và ở đây phải THI HÀNH
       * chứ không chỉ ghi trong spec.
       *
       * `annotations` của tool CLI là do CHÍNH TA dựng từ ô `read_only`, nên
       * `offeredTiers` sẽ ngoan ngoãn chào ra `read`/`full`. Bộ chọn nấc hiện
       * lên là hứa một hàng rào **không có gì thi hành**: `addArm` cho CLI
       * không truyền `level`, `pickMcp` cấp trọn danh sách việc trong tờ khai.
       * Đúng loại lời hứa §14 đã mất công gỡ một lần ở bài 11.
       *
       * ⇒ Cổng của CLI là hai cái khác: **ai được nối dây** + `confirm` từng
       * action. Nói thật là "toàn quyền" thì người dùng còn cân nhắc; chào ra
       * ba nấc giả thì họ yên tâm nhầm.
       */
      if (out.tools.length && !hasCli) out.tiers = offeredTiers(out.tools);
    }

    // Chỉ đo token khi đã nối được: hỏi lúc `pending` là đo một prefix chưa có
    // tool, tức một con số 0 rất thuyết phục và hoàn toàn vô nghĩa.
    if (out.status === 'connected' && baseline !== undefined) {
      const ctx = (await q.getContextUsage()) as { totalTokens: number };
      out.tokens = Math.max(0, ctx.totalTokens - baseline);
    }

    // Nối được mà rỗng — xem khối chú thích ở `ProbeResult.warn`. Đặt sau cùng
    // để nó thấy `out.tools` ở trạng thái cuối, không phải giữa chừng.
    if (out.status === 'connected' && out.tools.length === 0) {
      out.warn = t('probe.zeroTools');
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
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), 20_000)),
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
