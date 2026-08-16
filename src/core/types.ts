/**
 * Kiểu dữ liệu dùng chung.
 *
 * Nguồn: docs/SPEC-2026-08-14-agentco.md §4 (Task/Receipt), §3 (Role)
 *        docs/SPEC-cli.md §3 (cấu hình)
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────── tier & model

export const TIERS = ['eco', 'standard', 'deep'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Tên tier cũ → tên hiện tại.
 *
 * `cheap` đổi thành `eco` ngày 15/08/2026. File `roles/*.yaml` của người dùng đã
 * viết `cheap` thì KHÔNG được vì thế mà hỏng: schema từ chối, role bị bỏ qua, và
 * nhân viên biến mất khỏi văn phòng chỉ vì ta đổi một chữ.
 *
 * Đổi tên trong schema mà không kèm bảng này là cách âm thầm nhất để làm mất
 * việc của người dùng. Bảng chỉ có một dòng hôm nay — chỗ để nó lớn lên.
 */
const TIER_ALIASES: Record<string, Tier> = { cheap: 'eco' };

export const TierSchema = z.preprocess(
  (v) => (typeof v === 'string' && TIER_ALIASES[v] ? TIER_ALIASES[v] : v),
  z.enum(TIERS),
);

// ─────────────────────────────────────────────────────────── tool

/**
 * Tool BẬT SẴN cho mọi nhân viên, không tắt được.
 * → docs/SPEC-tools-approval.md §5
 *
 * Đây là TAY của văn phòng, không phải một lựa chọn. Bắt người dùng bật
 * `WebSearch` cho một nhân viên tên "Người tìm tin" là hỏi một câu chỉ có một
 * đáp án — đó không phải lựa chọn, đó là thủ tục. Bản trước bắt mở file yaml
 * bằng tay để thêm chúng, và đó là chỗ người non-code rơi rụng.
 *
 * An toàn vì: bốn tool file chỉ chạm được `cwd` (= thư mục văn phòng) và
 * `safeJoin` chặn đi ra ngoài; hai tool web chỉ ĐỌC.
 *
 * `Bash` CỐ Ý vắng mặt — nó là thứ duy nhất chạm được ra ngoài thư mục văn
 * phòng, nên phải là một quyết định tường minh trong `roles/<id>.yaml`.
 */
export const BUILTIN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
] as const;

/** Tool mức `write_external` — sẽ phải qua cổng duyệt khi §8 được cài đặt. */
export const EXTERNAL_TOOLS = new Set(['Bash']);

/** Bộ tool thật sự trao cho một vai trò: mặc định + phần khai thêm. */
export function effectiveTools(extra: readonly string[]): string[] {
  return [...new Set<string>([...BUILTIN_TOOLS, ...extra])];
}

// ─────────────────────────────────────────────────────────── role

export const SkillLevelSchema = z.enum(['short', 'medium', 'formal']);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const RoleSchema = z.object({
  id: z.string().min(1),
  /** Bump khi sửa skills/tools — đi vào cacheKey. Sửa mà quên bump = cache trả về nội dung cũ. */
  version: z.number().int().positive().default(1),
  display_name: z.string().default(''),
  avatar: z.string().default('•'),

  /** Thứ DUY NHẤT master thấy khi lập kế hoạch. Giữ ngắn — nó nằm trong context master. */
  pitch: z.string().min(1),
  good_at: z.array(z.string()).default([]),
  not_for: z.array(z.string()).default([]),

  skill_level: SkillLevelSchema.default('medium'),
  /** map mức -> đường dẫn file skill, tương đối với thư mục công ty */
  skills: z.partialRecord(SkillLevelSchema, z.string()).prefault({}),

  /**
   * Tool THÊM ngoài bộ mặc định. → docs/SPEC-tools-approval.md §5
   *
   * Gần như luôn để trống. Bộ mặc định (`BUILTIN_TOOLS`) đã bật sẵn cho mọi
   * nhân viên và không tắt được — chúng là TAY của văn phòng, và `cwd` +
   * `safeJoin` đã nhốt chúng trong thư mục văn phòng.
   *
   * Chỗ duy nhất đáng dùng trường này là `Bash` — thứ duy nhất chạm được ra
   * ngoài thư mục văn phòng.
   */
  tools: z.array(z.string()).default([]),
  /** Tên MCP server (khai trong company.yaml). Worker mới được gắn — master thì không. */
  mcp: z.array(z.string()).default([]),
  /** Connector REST (docs/SPEC-connectors.md). Chưa dùng ở v0. */
  connectors: z.array(z.string()).default([]),

  /**
   * TÊN các bí mật vai trò này được cầm — chìa khoá vào tool/API bên ngoài.
   * Giá trị nằm ở `company/.state/secrets.json` (đã gitignore), KHÔNG ở đây.
   *
   * Đặc quyền tối thiểu theo từng người: chỉ bí mật có tên trong danh sách này
   * mới được đưa vào môi trường của MCP server mà agent chạy. Nhân viên viết bài
   * không cầm chìa vào cổng thanh toán, dù hai người ở chung một văn phòng.
   *
   * Trợ lý KHÔNG có trường này. Nó không tự cầm tool — việc cần tool đi qua
   * worker ẩn, và worker đó có vai trò riêng với secrets riêng.
   * → docs/SPEC-offices.md §5
   */
  secrets: z.array(z.string()).default([]),

  /**
   * Đã LƯU TRỮ (soft delete). → docs/SPEC-offices.md §5.1
   *
   * Chỉ là một cờ — file không đi đâu cả, kinh nghiệm trong
   * `knowledge/agents/<id>/` còn nguyên, và khôi phục thì nhân viên trở lại
   * đúng văn phòng cũ vì nó chưa bao giờ rời khỏi đó.
   *
   * Vai trò lưu trữ biến khỏi canvas VÀ khỏi roster của Trợ lý — tức là `pitch`
   * của nó rời khỏi prefix cache. Cất một người đi là tiết kiệm token thật,
   * giống hệt ngắt dây, chỉ khác là dứt khoát hơn.
   */
  archived: z.boolean().default(false),

  model_tier: TierSchema.default('standard'),

  /**
   * Dùng system prompt preset của Claude Code hay không.
   * Mặc định FALSE: preset đắt hơn ~6.300 token/call, giá gấp 5,5 lần.
   * Chỉ bật cho role thật sự cần hướng dẫn viết code.
   * → docs/FINDINGS-sdk-2026-08-14.md §2a
   */
  use_preset: z.boolean().default(false),

  budget: z
    .object({
      max_tokens: z.number().int().positive().default(60_000),
      max_turns: z.number().int().positive().default(15),
      max_usd: z.number().positive().default(0.5),
      /** Trần cho tri thức COLD (nạp theo task). HOT nằm trong prefix, tính riêng. */
      knowledge_pack: z.number().int().nonnegative().default(3_000),
    })
    .prefault({}),

  /** Số node tri thức "nóng" nhồi vào prefix được cache. */
  hot_knowledge_size: z.number().int().nonnegative().default(8),
});
export type Role = z.infer<typeof RoleSchema>;

// ─────────────────────────────────────────────────────────── company config

export const CompanyConfigSchema = z.object({
  name: z.string().default('Công ty của tôi'),

  runtime: z
    .object({
      port: z.number().int().default(7317),
      concurrency: z.number().int().positive().default(4),
      concurrency_by_tier: z
      .object({
        eco: z.number().int().positive().default(6),
        standard: z.number().int().positive().default(4),
        deep: z.number().int().positive().default(1),
      })
      .prefault({}),
      /** auto = 1h khi đang "trong ca" (UI mở / bridge bật), 5m khi chạy lẻ. */
      cache_ttl: z.enum(['auto', '5m', '1h']).default('auto'),
      /** Chờ tối đa bao lâu ở cache priming gate trước khi thả hết. */
      priming_timeout_ms: z.number().int().positive().default(20_000),
    })
    .prefault({}),

  budgets: z
    .object({
      /** Trần CỨNG. Vượt là cắt. → SPEC-token-economy.md §4 */
      receipt_tokens: z.number().int().positive().default(800),
      knowledge_node_tokens: z.number().int().positive().default(250),
      charter_tokens: z.number().int().positive().default(500),
      /**
       * Trần cho skills người dùng viết cho Assistant. Khối này nằm trong prefix
       * của MỌI lượt trò chuyện — nhỏ hơn charter là có chủ ý.
       */
      assistant_skills_tokens: z.number().int().positive().default(400),
      hot_knowledge_tokens: z.number().int().positive().default(2_000),
      cold_knowledge_tokens: z.number().int().positive().default(3_000),
      task_brief_tokens: z.number().int().positive().default(1_500),
      master_compact_at: z.number().int().positive().default(60_000),
    })
    .prefault({}),

  /**
   * ⚠ `cheap` là TÊN KHOÁ CŨ của `eco` (đổi 15/08/2026).
   *
   * `TIER_ALIASES` đã lo phần GIÁ TRỊ (`model_tier: cheap` trong roles/*.yaml)
   * nhưng bỏ sót phần KHOÁ ở đây, và hậu quả im lặng hơn hẳn: `company.yaml`
   * viết `models.cheap: <model>` thì zod bỏ qua khoá lạ, `eco` rơi về mặc định,
   * và người dùng chạy suốt một model KHÁC cái họ đã ghi ra — không lỗi, không
   * cảnh báo, chỉ có hoá đơn không khớp. Cùng một bài học, hai nửa của nó.
   */
  models: z.preprocess(
    (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      const m = { ...(v as Record<string, unknown>) };
      if (m['cheap'] !== undefined && m['eco'] === undefined) m['eco'] = m['cheap'];
      delete m['cheap'];
      return m;
    },
    z
    .object({
      eco: z.string().default('claude-haiku-4-5-20251001'),
      standard: z.string().default('claude-sonnet-5'),
      deep: z.string().default('claude-opus-5'),
      /**
       * Tier của master — session dài, đối thoại với người.
       * PHẢI CỐ ĐỊNH suốt ca. Đổi model giữa chừng là miss toàn bộ ngữ cảnh
       * master mỗi lần đổi, vì prompt cache đánh theo (model, prefix).
       */
      master: TierSchema.default('standard'),
      /**
       * Tier cho việc LẬP KẾ HOẠCH. Chạy ở query one-shot RIÊNG, không nằm
       * trong session master — nên đặt 'deep' ở đây không phá cache của master.
       * Đây là cách duy nhất dùng Opus cho khâu cần chất lượng mà không trả giá.
       */
      planner: TierSchema.default('standard'),
    })
      .prefault({}),
  ),

  librarian: z
    .object({
      every_n_tasks: z.number().int().positive().default(20),
      /**
       * Cửa sổ KHAI TỬ: ghi chú không được chọn lần nào trong N ngày thì bị dọn, mỗi lần nén
       * trí nhớ. Đặt 0 để tắt hẳn.
       *
       * Điều kiện là VÀ chứ không phải HOẶC: `hits` chỉ đáng tin khi kho đã lớn
       * hơn `hot_knowledge_size` — dưới ngưỡng đó mọi node đều được nạp mỗi lượt
       * nên `hits` gần như đồng đều, và lọc theo nó là lọc theo nhiễu.
       */
      prune_after_days: z.number().int().nonnegative().default(15),
    })
    .prefault({}),

  /**
   * MCP server khai ở cấp CÔNG TY (một chỗ cắm, mọi văn phòng thấy), nhưng
   * việc ai được DÙNG cái nào thì do cạnh nối trên canvas của từng văn phòng.
   */
  mcpServers: z.record(z.string(), z.unknown()).prefault({}),

  /**
   * Cho phép sửa lớp core prompt. MẶC ĐỊNH FALSE, và UI phải hỏi qua một dialog
   * cảnh báo trước khi bật. → SPEC-offices.md §4.1
   *
   * Core là phần thuộc về MÃ NGUỒN, không thuộc về việc vận hành doanh nghiệp.
   * Cho sửa không phải trao tự do — là trao cái bẫy: gỡ mất giao thức Receipt
   * thì kiến trúc chi phí sụp, rồi người dùng đổ lỗi cho sản phẩm chứ không cho
   * bản sửa của họ. Nhưng GIẤU nó đi thì người advanced đoán, và đoán sai thì họ
   * viết skills chống lại chính hệ thống. Nên: luôn xem được, mặc định khoá.
   */
  allow_core_prompt_edit: z.boolean().default(false),
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

// ─────────────────────────────────────────────────────────── office config

/**
 * Cấu hình một văn phòng. CỐ Ý nhỏ: mọi thứ dính tới tiền nằm ở company.yaml,
 * ở đây chỉ có "văn phòng này tên gì và Assistant của nó là ai".
 */
export const OfficeConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Văn phòng mới'),
  charter_file: z.string().default('knowledge/shared/_charter.md'),

  /**
   * Đã LƯU TRỮ (soft delete). → docs/SPEC-offices.md §3.1
   *
   * Nghĩa: **ĐÓNG BĂNG, CHỈ ĐỌC.** Không nhận việc, không trả lời chat, không
   * sửa được gì. Nhưng kết quả cũ vẫn mở ra xem được, và nó vẫn có TÊN trong sổ
   * chi phí — đó mới là lý do soft delete tồn tại: một văn phòng xoá hẳn để lại
   * những dòng tiền không ai giải thích được nữa.
   *
   * Không cho chạy là có chủ ý. "Đã xoá nhưng vẫn âm thầm tiêu tiền" là hành vi
   * không ai đoán được, và tiền là thứ duy nhất người dùng không lấy lại được.
   */
  archived: z.boolean().default(false),

  assistant: z
    .object({
      display_name: z.string().default('Trợ lý'),
      avatar: z.string().default('★'),
      /**
       * Mức model của Trợ lý VĂN PHÒNG NÀY. Bỏ trống = theo `models.master` của
       * công ty. → docs/SPEC-offices.md §4.5
       *
       * Ranh giới giữ nguyên: CÔNG TY quyết mỗi mức là model nào (đó là tiền);
       * VĂN PHÒNG quyết Trợ lý của nó chạy ở mức nào (đó là công việc). Giống
       * hệt `model_tier` của một vai trò, và vì thế không đẻ ra khái niệm mới.
       *
       * ⚠ Đổi trường này là đổi khoá cache (model, prefix). Lượt trò chuyện kế
       * tiếp phải GHI LẠI toàn bộ prefix, và vì Trợ lý chạy `resume` nên nó gửi
       * lại cả bản ghi hội thoại ở giá đầy đủ. Trí nhớ KHÔNG mất — bản ghi nằm
       * trên đĩa, độc lập với model — nhưng đây là một lần trả tiền thật.
       */
      model_tier: TierSchema.optional(),
      /**
       * MCP server mà Assistant "dùng được". Thực chất gắn cho worker ẩn
       * (concierge) — master không bao giờ tự cầm MCP vì nó resume liên tục và
       * MCP phá prompt cache khi resume (issue #247), mất ~36.000 token quy đổi
       * MỖI LƯỢT trò chuyện. → SPEC-offices.md §4.4
       */
      mcp: z.array(z.string()).default([]),
    })
    .prefault({}),
});
export type OfficeConfig = z.infer<typeof OfficeConfigSchema>;

// ─────────────────────────────────────────────────────────── task & receipt

export const TaskIOSchema = z.object({
  kind: z.enum(['file']).default('file'),
  path: z.string(),
});
export type TaskIO = z.infer<typeof TaskIOSchema>;

/**
 * Master → worker.
 *
 * BẤT BIẾN: `inputs` chỉ chứa ĐƯỜNG DẪN, không bao giờ chứa nội dung file.
 * Dán nội dung vào brief nghĩa là nội dung đó nằm trong context master vĩnh viễn
 * — đây là lỗi đốt token số 1 trong các hệ multi-agent.
 */
export const TaskBriefSchema = z.object({
  task_id: z.string(),
  role: z.string(),
  goal: z.string().min(1),
  inputs: z.array(TaskIOSchema).default([]),
  outputs: z.array(TaskIOSchema).default([]),
  constraints: z.array(z.string()).default([]),
  knowledge_refs: z.array(z.string()).default([]),
  deps: z.array(z.string()).default([]),
  /** Bước trong kế hoạch mà task này thuộc về (để UI gom nhóm). */
  step: z.number().int().nonnegative().default(0),
});
export type TaskBrief = z.infer<typeof TaskBriefSchema>;

export const LessonSchema = z.object({
  kind: z.enum(['pitfall', 'playbook', 'fact']).default('pitfall'),
  text: z.string(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * Worker → master. TRẦN CỨNG 800 token.
 *
 * `say` là câu tiếng người, hiển thị thẳng lên UI. Worker sinh sẵn nên
 * không tốn thêm call LLM nào để "dịch cho thân thiện".
 */
export const ReceiptSchema = z.object({
  status: z.enum(['done', 'failed', 'blocked', 'needs_human']),
  say: z.string().min(1),
  artifacts: z.array(z.string()).default([]),
  lessons: z.array(LessonSchema).default([]),
  blocked_on: z.string().nullable().default(null),
});
export type ReceiptBody = z.infer<typeof ReceiptSchema>;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  model: string;
  /**
   * Số lượt API. ĐÂY LÀ SỐ ĐO QUAN TRỌNG NHẤT cho chi phí: mỗi lượt đọc lại
   * TOÀN BỘ prefix, nên chi phí ≈ lượt × prefix × 0.1. Trước đây phải suy ra
   * từ cache_read, giờ lấy thẳng `num_turns` của SDK.
   */
  turns: number;
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUSD: 0,
  model: '',
  turns: 0,
};

/**
 * Kết quả của một task đã ĐI ĐÂU — QUAN SÁT được, không do model khai.
 * → docs/SPEC-offices.md §6, `worker.ts → landingOf`
 *
 * Đây là thứ khác hẳn `artifacts`: `artifacts` là lời model KỂ (có thể bịa, và
 * chỉ mô tả được file), còn cái này suy ra từ TOOL ĐÃ GỌI trong luồng.
 */
export interface Landing {
  /**
   * `file`     — ghi vào thư mục văn phòng, KIỂM ĐƯỢC bằng `existsSync`
   * `external` — gọi một MCP server (`ref` = tên server). Không kiểm được, nhưng
   *              biết chắc là đã gọi.
   * `command`  — chạy `Bash`. Ta KHÔNG biết dữ liệu đi đâu, và phải nói thế.
   */
  kind: 'file' | 'external' | 'command';
  ref: string;
}

/** Receipt đã qua validate + gắn số liệu đo được. */
export interface Receipt extends ReceiptBody {
  task_id: string;
  role: string;
  usage: Usage;
  wall_ms: number;
  /** true nếu worker trả sai schema và phải hỏi lại. Dùng để cảnh báo prompt kém. */
  reasked: boolean;
  /** Điểm đến quan sát được. Rỗng = task không tạo ra tác động nào nhìn thấy. */
  landed: Landing[];
}

// ─────────────────────────────────────────────────────────── plan

export interface PlanStep {
  /** ≤10 từ. Ràng buộc trong prompt master, không phải gợi ý. */
  title: string;
  status: 'pending' | 'running' | 'done' | 'problem' | 'waiting_human';
}

export interface Plan {
  plan_id: string;
  request: string;
  /** Tối đa 6 bước. */
  steps: PlanStep[];
  tasks: TaskBrief[];
}

/**
 * PLAN LÀ ĐƠN VỊ CÔNG VIỆC, không phải dòng chat. → SPEC-offices.md §6
 *
 * Log của v0 là một dòng chảy phẳng: không đọc được khi hai việc chạy chồng
 * nhau, và không trả lời được "việc hôm qua đã làm những gì". Mọi sự kiện giờ
 * mang `plan_id`, và đây là bản ghi mà `plan_id` trỏ tới.
 */
export type PlanStatus = 'planning' | 'running' | 'done' | 'failed' | 'paused' | 'stopped';

export interface PlanRecord {
  plan_id: string;
  office: string;
  /** Câu người dùng gõ, đã được Assistant viết lại cho rõ. */
  request: string;
  status: PlanStatus;
  started_at: string;
  ended_at?: string;
  steps: PlanStep[];
  /** Số task đã xong / tổng — để hiện tiến độ mà không phải đọc hết receipt. */
  tasks_done: number;
  tasks_total: number;
  costUSD: number;
  turns: number;
  /** Câu tổng kết của Assistant khi xong. */
  report?: string;
}

// ─────────────────────────────────────────────────────────── lỗi phân loại

/**
 * Rate limit (429) và hết hạn mức subscription là HAI loại lỗi khác nhau,
 * xử lý ngược nhau. → SPEC-2026-08-14-agentco.md §9b
 */
export type FailureKind =
  /** tạm thời, tính bằng giây → backoff + giảm concurrency */
  | 'rate_limit'
  /** đến kỳ reset, tính bằng giờ → DỪNG CA, không retry */
  | 'usage_limit'
  /** chưa đăng nhập Claude Code */
  | 'auth'
  /** chạm trần ngân sách ta tự đặt → hỏi người dùng, không tự nới */
  | 'budget'
  /** hết lượt cho phép → nói rõ sửa ở đâu, đừng báo "lỗi" chung chung */
  | 'max_turns'
  | 'other';

export class RunError extends Error {
  readonly kind: FailureKind;

  constructor(message: string, kind: FailureKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RunError';
    this.kind = kind;
  }
}

// ─────────────────────────────────────────────────────────── sự kiện (SSE)

/**
 * BẤT BIẾN 1: mọi sự kiện hướng người dùng PHẢI có `say`.
 * Không có `say` thì UI không hiện gì — ràng buộc này ép mọi thứ hiển thị
 * đều đã ở dạng tiếng người ngay từ nguồn.
 *
 * BẤT BIẾN 2 (từ 15/08): mọi sự kiện PHẢI có `office`, và mọi sự kiện thuộc về
 * một công việc PHẢI có `plan_id`. Thiếu `office` thì UI đa văn phòng hiện nhầm
 * chỗ; thiếu `plan_id` thì log không tách được hai việc chạy chồng nhau.
 * Sự kiện không thuộc việc nào (trò chuyện) mang `plan_id: null`.
 */
interface EventBase {
  office: string;
  plan_id: string | null;
}

/**
 * Thân sự kiện, chưa gắn `office`/`plan_id`.
 *
 * Tách ra vì `Omit<AgentEvent, 'office' | 'plan_id'>` trên một union sẽ RÚT GỌN
 * về các khoá chung — tức là mất sạch trường riêng của từng loại sự kiện, và
 * TypeScript im lặng chấp nhận rồi báo lỗi ở chỗ khác. Nơi phát sự kiện
 * (scheduler, office) nhận đúng kiểu này; `Office.emit` gắn hai trường kia vào.
 */
export type AgentEventBody =
  | { type: 'plan.created'; plan_id: string; request: string; steps: PlanStep[] }
  | { type: 'plan.step'; step: number; status: PlanStep['status'] }
  /**
   * Đóng sổ một công việc. CỐ Ý không có `say`: câu báo cáo đã đi bằng
   * `master.message` ngay trước đó. Mang thêm lần nữa ở đây thì nhật ký hiện
   * hai dòng y hệt nhau cạnh nhau — đây là ngoại lệ duy nhất của bất biến
   * "mọi sự kiện hướng người dùng phải có say", vì nó không hướng người dùng.
   */
  | { type: 'plan.finished'; status: PlanStatus; costUSD: number; turns: number }
  | { type: 'task.started'; task_id: string; role: string; say: string }
  | { type: 'task.progress'; task_id: string; role: string; say: string }
  | {
      type: 'task.done';
      task_id: string;
      role: string;
      say: string;
      status: ReceiptBody['status'];
      artifacts: string[];
      usage: Usage;
      }
  | { type: 'task.blocked'; task_id: string; role: string; say: string; reason: string }
  /** Tin nhắn trong luồng hội thoại. `role` = 'assistant' hoặc 'user'. */
  | { type: 'master.message'; say: string; role: 'assistant' | 'user' }
  | { type: 'office.state'; say: string; state: 'idle' | 'working' | 'paused' | 'stopped' }
  /**
   * Trợ lý bận và nhân viên bận là HAI chuyện. Giao diện phải nói được cả hai,
   * nếu không người dùng thấy im lặng và tưởng hệ thống chết.
   * → docs/SPEC-tools-approval.md §11
   */
  | {
      type: 'office.activity';
      /**
       * `planning` là trạng thái THỨ BA, và nó tồn tại vì một khoảng mù có thật:
       * `handleUserBatch` gọi `run()` KHÔNG await rồi trả về, nên hòm thư mở
       * khoá ngay và `pump()` phát ra một `office.activity` toàn số 0 — đúng lúc
       * `run()` mới bắt đầu lập kế hoạch. Giao diện tắt dòng "đang làm gì", rồi
       * 15 giây sau kế hoạch mới hiện ra.
       *
       * Người dùng thấy: "Trợ lý đang nghĩ…" → im bặt → (chờ) → kế hoạch. Khoảng
       * im bặt đó chính là chỗ họ tưởng hệ thống chết và bấm Gửi lần nữa.
       */
      assistant: 'idle' | 'thinking' | 'planning';
      workers: number;
      /** tin nhắn chờ Trợ lý đọc */
      queued: number;
      /** VIỆC chờ tới lượt chạy — hàng đợi phải nhìn thấy được, không phải mảng riêng tư */
      jobs: number;
    }
  /**
   * Hội thoại vừa được dọn (`/clear` hoặc tự nén). → docs/SPEC-offices.md §4.6
   *
   * Tách khỏi `master.message` vì nó là một MỆNH LỆNH cho bên hiển thị ("xoá
   * những gì đang hiện"), không phải một câu để đọc. Bridge như Telegram không
   * xoá được tin đã gửi nên nó bỏ qua sự kiện này và chỉ đọc câu `master.message`
   * đi ngay sau — cùng một luồng, hai bên hiển thị tự chọn cách phản ứng.
   *
   * THỨ TỰ BẮT BUỘC: `office.cleared` phát TRƯỚC, câu báo kết quả phát SAU.
   * Ngược lại thì câu vừa hiện ra bị chính lệnh xoá cuốn đi.
   */
  | { type: 'office.cleared'; say: string }
  | { type: 'cost.tick'; totals: Usage & { tasks: number } }
  | { type: 'knowledge.changed'; count: number; version: number }
  /** Hình dạng văn phòng đổi (kéo node, nối/ngắt dây, thêm/bớt nhân viên). */
  | { type: 'layout.changed'; say: string }
  /** Danh sách văn phòng đổi. `office` là cái vừa thêm/bớt. */
  | { type: 'company.offices'; say: string };

export type AgentEvent = EventBase & AgentEventBody;
