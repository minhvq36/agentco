/**
 * HẠN MỨC TÀI KHOẢN CLAUDE — hai cửa sổ, hai con số phần trăm, hai mốc reset.
 * → docs/SPEC-token-economy.md §5e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐIỀU KIỆN LÀ **CLI PHẢI RẢNH**. Đó là toàn bộ bài toán, và nó đã suýt    │
 * │ bị kết luận là "không làm được".                                          │
 * │                                                                          │
 * │ `usage()` là một CONTROL REQUEST gửi xuống tiến trình Claude Code. Bốn    │
 * │ phép đo đầu (22/08) đều gọi nó TRONG LÚC CLI đang xử lý một prompt:       │
 * │                                                                          │
 * │   probe 1  gọi sau vòng lặp        → `ProcessTransport is not ready`      │
 * │   probe 2  gọi ở tin đầu           → `Query closed…` sau 601 ms           │
 * │   probe 3  gọi ở `init`, query 3 s → `Query closed…` sau 3 043 ms         │
 * │   probe 4  gọi ở `init`, query 32 s→ `Query closed…` sau **27 476 ms**    │
 * │                                                                          │
 * │ Probe 4 bác bỏ giả thuyết "thua vì query ngắn" — nó chờ gần hết đời query │
 * │ rồi chết cùng. Kết luận rút ra lúc đó: *"control request không được trả   │
 * │ lời khi vòng lặp chính đang bận"*. ĐÚNG, nhưng kết luận SAU đó thì sai:   │
 * │ *"nên không lấy được"*.                                                   │
 * │                                                                          │
 * │ Câu hỏi bỏ sót: **vì sao `/usage` gõ tay lại chạy?** Vì lúc người ta gõ   │
 * │ thì CLI đang RẢNH. Và streaming-input dựng lại được đúng trạng thái đó:   │
 * │ mở query với một generator GIỮ STREAM MỞ mà chưa gửi tin nào.             │
 * │                                                                          │
 * │   probe 5  CLI rảnh → ✅ **3 342 ms**, đủ `five_hour` + `seven_day`,      │
 * │            kèm `utilization`, `resets_at`, và `session cost = 0`.         │
 * │                                                                          │
 * │ **KHÔNG TỐN TOKEN NÀO.** Không tin nhắn nào được gửi, không lượt suy luận │
 * │ nào chạy. Cái giá là ~3,3 giây và một tiến trình CLI sống trong khoảnh    │
 * │ khắc đó.                                                                  │
 * │                                                                          │
 * │ ⚠ Bài học, và nó đắt hơn tính năng này: **"đo bốn lần đều hỏng" chứng    │
 * │ minh một CƠ CHẾ, không chứng minh một KẾT LUẬN.** Bốn phép đo đó nói      │
 * │ đúng một điều — "khi bận thì không được" — còn "nên bỏ đi" là suy rộng    │
 * │ tôi tự thêm vào. Trước khi tuyên bố một đường là chết, phải hỏi: *thứ     │
 * │ tương đương đang chạy được ở đâu đó, và nó khác ta ở chỗ nào?*            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CHỈ HAI CỬA SỔ: PHIÊN VÀ TUẦN. Không tách theo model. (user chốt 22/08)  │
 * │                                                                          │
 * │ Server trả về rất nhiều rổ — `seven_day_opus`, `seven_day_sonnet`, và cả │
 * │ một loạt tên mã (`nimbus_quill`, `iguana_necktie`, `tangelo`…) rõ ràng   │
 * │ là cờ tính năng nội bộ. Trên tài khoản đo được (`pro`) thì các rổ theo    │
 * │ model đều `null`.                                                        │
 * │                                                                          │
 * │ Lý do bỏ không phải vì chúng rỗng, mà vì **chúng không phải chuyện của    │
 * │ agentco**: hạn mức là của cả tài khoản, và người dùng có thể đã tiêu      │
 * │ phần lớn nó ở việc chẳng liên quan gì tới công ty này. Ta đang trả lời    │
 * │ đúng một câu — *"tôi còn chạy được nữa không, và tới khi nào"*. Mọi con   │
 * │ số khác là mời người dùng đi truy nguyên một thứ họ không sửa được.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

/** Ba mức server trả về. `allowed` = còn thoải mái, `rejected` = đã bị chặn. */
export type EnergyStatus = 'allowed' | 'allowed_warning' | 'rejected';

/** Đúng hai cửa sổ người dùng cần biết. Xem chú thích đầu file. */
export type WindowKind = 'session' | 'weekly';

export interface EnergyWindow {
  kind: WindowKind;
  /** 0–100. `null` khi chưa lấy được số (chưa refresh lần nào). */
  utilization: number | null;
  /** ISO 8601. */
  resetsAt: string | null;
  status: EnergyStatus;
}

export interface Energy {
  windows: EnergyWindow[];
  /** `pro` · `max` · `team` … · `null` khi chạy bằng API key. */
  plan: string | null;
  /** Lúc lấy số cuối cùng, ISO. */
  seenAt: string;
}

/** `rateLimitType` của `rate_limit_event` → cửa sổ của ta. Rổ khác: bỏ qua. */
const EVENT_KIND: Record<string, WindowKind> = {
  five_hour: 'session',
  seven_day: 'weekly',
};

const STATUSES = new Set<string>(['allowed', 'allowed_warning', 'rejected']);

/**
 * Ngưỡng đổi màu khi ta chỉ có `%` mà không có `status` từ sự kiện.
 * 80% là chỗ người dùng còn kịp đổi kế hoạch; 100% thì đã muộn.
 */
function statusOf(util: number): EnergyStatus {
  if (util >= 100) return 'rejected';
  return util >= 80 ? 'allowed_warning' : 'allowed';
}

// State ở MODULE: hạn mức thuộc về TÀI KHOẢN, không thuộc văn phòng nào.
const latest = new Map<WindowKind, EnergyWindow>();
let plan: string | null = null;
let version = 0;
let seenAt = '';

function bump(kind: WindowKind, next: EnergyWindow): void {
  const prev = latest.get(kind);
  if (
    prev &&
    prev.status === next.status &&
    prev.resetsAt === next.resetsAt &&
    prev.utilization === next.utilization
  ) {
    return; // không đổi -> đừng bump version, đừng bắn sự kiện thừa lên SSE
  }
  latest.set(kind, next);
  seenAt = new Date().toISOString();
  version++;
}

/**
 * Nhặt `rate_limit_event` từ luồng đang chạy — MIỄN PHÍ, nó đã nằm sẵn trong
 * `for await` của `worker.ts` / `assistant.ts`.
 *
 * Nó KHÔNG mang `utilization` (đo 22/08: server không gửi), nên vai trò của nó
 * hẹp và rõ: **báo đổi trạng thái NGAY GIỮA lượt chạy**. Người dùng bị chặn lúc
 * 14:03 thì phải thấy lúc 14:03, không phải chờ lần refresh kế tiếp.
 *
 * ⚠ Vì thế nó **chỉ được sửa đúng `status`**, và giữ nguyên hai trường kia:
 *
 *  · `utilization` — sự kiện không mang %, ghi đè bằng `null` là làm thanh biến
 *    mất giữa chừng, một cú giật vô cớ ngay lúc người dùng đang lo. Số của vài
 *    phút trước vẫn đúng hơn là không có số.
 *  · `resetsAt` — **hai nguồn không khớp tới từng giây**, và đây là một cái bẫy
 *    im lặng đã bắt được bằng test: sự kiện trả `1787367000` (giây tròn) còn
 *    `usage()` trả `…T02:49:59.770958Z`. Cùng một mốc, lệch 0,23 giây. Cho sự
 *    kiện ghi đè thì MỖI query lại lật qua lật lại giữa hai cách viết → `bump`
 *    thấy "có đổi" → một `energy.tick` rác bắn lên SSE ở mọi lượt gọi worker.
 *    ⇒ `usage()` là nguồn của số; sự kiện chỉ điền `resetsAt` khi ta chưa có gì.
 */
export function noteRateLimit(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as Record<string, unknown>;

  const kind = typeof r['rateLimitType'] === 'string' ? EVENT_KIND[r['rateLimitType']] : undefined;
  const status =
    typeof r['status'] === 'string' && STATUSES.has(r['status']) ? (r['status'] as EnergyStatus) : undefined;
  if (!kind || !status) return;

  /** `resetsAt` ở sự kiện là **GIÂY** Unix (đo: 1787367000), không phải mili-giây. */
  const secs = typeof r['resetsAt'] === 'number' && Number.isFinite(r['resetsAt']) ? r['resetsAt'] : 0;
  const prev = latest.get(kind);

  bump(kind, {
    kind,
    status,
    resetsAt: prev?.resetsAt ?? (secs > 0 ? new Date(secs * 1000).toISOString() : null),
    utilization: prev?.utilization ?? null,
  });
}

// ──────────────────────────────────────────────────── lấy số phần trăm

/** Một lần refresh đang chạy. Không bao giờ để hai tiến trình CLI cùng mở. */
let inflight: Promise<void> | null = null;
let lastAt = 0;

/** Không refresh dày hơn mức này. Số liệu hạn mức đổi theo phút, không theo giây. */
const MIN_GAP_MS = 60_000;
/** CLI khởi động ~2 s + `usage()` ~3,3 s. Gấp đôi cho máy chậm rồi bỏ cuộc. */
const TIMEOUT_MS = 20_000;

/**
 * Mở một CLI RẢNH, hỏi hạn mức, đóng lại. → chú thích đầu file.
 *
 * Nuốt MỌI lỗi và không bao giờ ném: đây là một ô trang trí trên header. Một
 * `usage()` hỏng không được phép làm hỏng lượt chạy của người dùng, và cũng
 * không được phép hiện một câu lỗi — người dùng không hỏi gì cả.
 *
 * `force` bỏ qua tiết lưu, dùng cho lần đầu lúc mở văn phòng.
 */
export function refreshEnergy(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve();
  lastAt = Date.now();
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(): Promise<void> {
  let release: (() => void) | undefined;

  /**
   * Generator KHÔNG BAO GIỜ yield cho tới khi ta thả — đây chính là thứ giữ
   * CLI ở trạng thái "đang chờ input", tức là RẢNH. Đổi nó thành một generator
   * có gửi tin là làm hỏng toàn bộ cơ chế: CLI bận thì `usage()` treo rồi chết
   * cùng query (đo 4 lần, xem đầu file).
   */
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      // Không truyền `model`: không lượt suy luận nào chạy nên nó vô nghĩa, và
      // ghim một model id ở đây là một chỗ nữa phải nhớ sửa khi bảng model đổi.
      tools: [],
      allowedTools: [],
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });

  // Phải TIÊU THỤ luồng, nếu không phản hồi control không được bơm ra.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* không quan tâm nội dung — chỉ cần luồng chảy */
      }
    } catch {
      /* đóng query giữa chừng thì SDK ném; đúng như thiết kế */
    }
  })();

  try {
    const res = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), TIMEOUT_MS)),
    ]);
    apply(res as Record<string, unknown>);
  } catch {
    /* không lấy được thì giữ nguyên số cũ — im lặng, đây là ô trang trí */
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
}

/**
 * Đọc PHÒNG THỦ tuyệt đối. Tên hàm nguồn tự khai `…_DO_NOT_RELY_ON_THIS_API_YET`
 * và phản hồi thật chứa cả những rổ tên mã chưa ra mắt (`nimbus_quill`,
 * `iguana_necktie`…). Ta chỉ đọc đúng hai khoá đã được khai trong `.d.ts`, và
 * một trường đổi kiểu KHÔNG được phép làm hỏng gì.
 */
export function apply(res: Record<string, unknown>): void {
  if (!res || typeof res !== 'object') return;

  if (res['rate_limits_available'] === false) return; // API key / Bedrock / Vertex
  const limits = res['rate_limits'];
  if (!limits || typeof limits !== 'object') return;

  const sub = res['subscription_type'];
  if (typeof sub === 'string' && sub) plan = sub;

  const l = limits as Record<string, unknown>;
  readWindow(l['five_hour'], 'session');
  readWindow(l['seven_day'], 'weekly');
}

function readWindow(raw: unknown, kind: WindowKind): void {
  if (!raw || typeof raw !== 'object') return;
  const w = raw as Record<string, unknown>;

  const rawUtil = w['utilization'];
  const util =
    typeof rawUtil === 'number' && Number.isFinite(rawUtil) ? Math.max(0, Math.min(100, rawUtil)) : null;
  const at = typeof w['resets_at'] === 'string' ? w['resets_at'] : '';
  const when = at ? new Date(at) : null;

  const prev = latest.get(kind);
  bump(kind, {
    kind,
    utilization: util,
    resetsAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : (prev?.resetsAt ?? null),
    /**
     * Trạng thái suy từ `%`, KHÔNG giữ trạng thái cũ từ sự kiện: `usage()` là
     * nguồn mới hơn và đầy đủ hơn. Giữ một `rejected` cũ trong khi cửa sổ đã
     * reset về 0% là để lại một cảnh báo đỏ cho một chuyện đã qua.
     */
    status: util === null ? (prev?.status ?? 'allowed') : statusOf(util),
  });
}

// ──────────────────────────────────────────────────── đọc ra

/** Tăng mỗi lần có tin MỚI THẬT. `Office.emit` so số này để biết có phải bắn không. */
export function energyVersion(): number {
  return version;
}

export function energySnapshot(): Energy | undefined {
  if (latest.size === 0) return undefined;
  // Thứ tự CỐ ĐỊNH — phiên rồi tuần. Người dùng đọc hai con số ở cùng một chỗ
  // mỗi lần liếc lên; đảo chỗ theo mức căng là bắt họ đọc lại nhãn mỗi lần.
  const order: WindowKind[] = ['session', 'weekly'];
  const windows = order.map((k) => latest.get(k)).filter((w): w is EnergyWindow => !!w);
  return { windows, plan, seenAt };
}

/** Chỉ dùng cho test — nhà nào cũng phải có cửa để dọn. */
export function resetEnergy(): void {
  latest.clear();
  plan = null;
  version = 0;
  seenAt = '';
  lastAt = 0;
}
