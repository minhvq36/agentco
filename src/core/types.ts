/**
 * Kiểu dữ liệu dùng chung.
 *
 * Nguồn: docs/SPEC-2026-08-14-agentco.md §4 (Task/Receipt), §3 (Role)
 *        docs/SPEC-cli.md §3 (cấu hình)
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────── tier & model

export const TIERS = ['cheap', 'standard', 'deep'] as const;
export type Tier = (typeof TIERS)[number];

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

  tools: z.array(z.string()).default([]),
  /** Tên MCP server (khai trong company.yaml). Worker mới được gắn — master thì không. */
  mcp: z.array(z.string()).default([]),
  /** Connector REST (docs/SPEC-connectors.md). Chưa dùng ở v0. */
  connectors: z.array(z.string()).default([]),

  model_tier: z.enum(TIERS).default('standard'),

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
  charter_file: z.string().default('knowledge/shared/_charter.md'),

  runtime: z
    .object({
      port: z.number().int().default(7317),
      concurrency: z.number().int().positive().default(4),
      concurrency_by_tier: z
        .object({
          cheap: z.number().int().positive().default(6),
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
      hot_knowledge_tokens: z.number().int().positive().default(2_000),
      cold_knowledge_tokens: z.number().int().positive().default(3_000),
      task_brief_tokens: z.number().int().positive().default(1_500),
      master_compact_at: z.number().int().positive().default(60_000),
    })
    .prefault({}),

  models: z
    .object({
      cheap: z.string().default('claude-haiku-4-5-20251001'),
      standard: z.string().default('claude-sonnet-5'),
      deep: z.string().default('claude-opus-5'),
      /**
       * Tier của master — session dài, đối thoại với người.
       * PHẢI CỐ ĐỊNH suốt ca. Đổi model giữa chừng là miss toàn bộ ngữ cảnh
       * master mỗi lần đổi, vì prompt cache đánh theo (model, prefix).
       */
      master: z.enum(TIERS).default('standard'),
      /**
       * Tier cho việc LẬP KẾ HOẠCH. Chạy ở query one-shot RIÊNG, không nằm
       * trong session master — nên đặt 'deep' ở đây không phá cache của master.
       * Đây là cách duy nhất dùng Opus cho khâu cần chất lượng mà không trả giá.
       */
      planner: z.enum(TIERS).default('standard'),
    })
    .prefault({}),

  master: z
    .object({
      /**
       * Gắn MCP vào master hay không. Mặc định FALSE.
       * Master là session dài, resume liên tục; MCP phá prompt cache khi resume
       * (issue #247) → mất ~36.000 token quy đổi mỗi lượt.
       * Việc vặt cần MCP đi qua tool quick_action (role concierge, M1).
       */
      mcp: z.boolean().default(false),
    })
    .prefault({}),

  librarian: z
    .object({
      every_n_tasks: z.number().int().positive().default(20),
    })
    .prefault({}),

  mcpServers: z.record(z.string(), z.unknown()).prefault({}),
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

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
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUSD: 0,
  model: '',
};

/** Receipt đã qua validate + gắn số liệu đo được. */
export interface Receipt extends ReceiptBody {
  task_id: string;
  role: string;
  usage: Usage;
  wall_ms: number;
  /** true nếu worker trả sai schema và phải hỏi lại. Dùng để cảnh báo prompt kém. */
  reasked: boolean;
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
 * BẤT BIẾN: mọi sự kiện hướng người dùng PHẢI có `say`.
 * Không có `say` thì UI không hiện gì — ràng buộc này ép mọi thứ hiển thị
 * đều đã ở dạng tiếng người ngay từ nguồn.
 */
export type AgentEvent =
  | { type: 'plan.created'; plan_id: string; request: string; steps: PlanStep[] }
  | { type: 'plan.step'; step: number; status: PlanStep['status'] }
  | { type: 'task.started'; task_id: string; role: string; say: string }
  | { type: 'task.progress'; task_id: string; role: string; say: string }
  | { type: 'task.done'; task_id: string; role: string; say: string; status: ReceiptBody['status']; artifacts: string[]; usage: Usage }
  | { type: 'task.blocked'; task_id: string; role: string; say: string; reason: string }
  | { type: 'master.message'; say: string }
  | { type: 'company.state'; say: string; state: 'idle' | 'working' | 'paused' | 'stopped' }
  | { type: 'cost.tick'; totals: Usage & { tasks: number } }
  | { type: 'knowledge.changed'; count: number; version: number };
