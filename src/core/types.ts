/**
 * Kiểu dữ liệu dùng chung.
 *
 * Nguồn: docs/SPEC-2026-08-14-agentco.md §4 (Task/Receipt), §3 (Role)
 *        docs/SPEC-cli.md §3 (cấu hình)
 */

import { z } from 'zod';

// Chỉ KIỂU, và `energy.ts` không import ngược lại đây — không có vòng.
import type { Energy } from './energy.js';

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
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ ĐÍNH CHÍNH 22/08 — KHỐI NÀY TỪNG GHI MỘT ĐIỀU KHÔNG ĐÚNG.              │
 * │                                                                          │
 * │ Câu cũ: *"bốn tool file chỉ chạm được `cwd` (= thư mục văn phòng) và     │
 * │ `safeJoin` chặn đi ra ngoài"*. **Sai.** `safeJoin` là hàm CỦA TA, chạy   │
 * │ trong mã CỦA TA — nó chưa bao giờ đứng giữa model và tool `Read`.         │
 * │                                                                          │
 * │ Đo được: một vai trò chỉ có bộ mặc định (KHÔNG `Bash`) đọc trọn vẹn một  │
 * │ file nằm ở thư mục tạm khác, chỉ bằng một đường dẫn tuyệt đối. `cwd`     │
 * │ **không phải một bức tường** — nó là thư mục làm việc mặc định.          │
 * │                                                                          │
 * │ Ranh giới THẬT hôm nay:                                                  │
 * │                                                                          │
 * │   GHI   `Write`/`Edit`/`NotebookEdit` → CÓ hàng rào (`officeJail`)       │
 * │   ĐỌC   `Read`/`Glob`/`Grep`          → KHÔNG có hàng rào nào            │
 * │   WEB   `WebFetch`/`WebSearch`        → chỉ đọc, nhưng GỬI RA ĐƯỢC       │
 * │   LỆNH  `Bash`                        → không hàng rào, và bật sẵn       │
 * │                                                                          │
 * │ ⇒ `Read` + `WebFetch` là một đường dữ liệu đi ra, **không cần `Bash`**.  │
 * │   Hàng rào đọc DỰNG ĐƯỢC (đã đo: `PreToolUse` nổ cho `Read` và `deny`    │
 * │   chặn thật) nhưng CHƯA DỰNG — đang chờ quyết định. → SPEC §5            │
 * │                                                                          │
 * │ Bài học: một bất biến chỉ có thật khi có mã nguồn thi hành nó. Câu cũ    │
 * │ đọc rất thuyết phục vì nó NÊU TÊN một hàm có thật — chỉ là hàm đó ở      │
 * │ nhầm tầng.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Bash` vắng mặt ở đây để nó vẫn là một DÒNG THẤY ĐƯỢC trong `roles/<id>.yaml`
 * và có công tắc riêng — dù từ 22/08 `roleTemplate` ghi sẵn nó cho nhân viên mới.
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

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 TOOL SHELL ĐỔI TÊN THEO HỆ ĐIỀU HÀNH — và đó là lý do công tắc        │
 * │    "cho chạy lệnh" KHÔNG chạy suốt từ 16/08 tới 22/08/2026.              │
 * │                                                                          │
 * │ Đo bằng cách hỏi thẳng CLI (`system/init` có trường `tools`):            │
 * │                                                                          │
 * │   không truyền `tools` → 29 tool, và trong đó là **`PowerShell`**,       │
 * │                          KHÔNG hề có `Bash`  (máy Windows)               │
 * │   `tools: ['Bash']`    → CLI cấp **0 tool**                              │
 * │                                                                          │
 * │ `tools` là allowlist theo TÊN. Tên không tồn tại trên nền tảng này bị    │
 * │ **bỏ im lặng** — không lỗi, không cảnh báo. Nên vai trò khai `Bash` trên │
 * │ Windows nhận đúng bộ mặc định, y như chưa khai gì.                       │
 * │                                                                          │
 * │ Dấu vết đã nằm sẵn trong spec suốt sáu ngày mà không ai đọc ra: ca       │
 * │ 16/08 ghi *"`nguoi-viet` … với tay sang **PowerShell** BỐN LẦN"*. Cái    │
 * │ tên đúng nằm ngay trong bằng chứng của một bug khác.                     │
 * │                                                                          │
 * │ ⇒ CONFIG dùng MỘT tên chuẩn (`Bash`) để một văn phòng zip lại vẫn chạy   │
 * │   được ở máy khác hệ điều hành. Việc dịch sang tên nền tảng làm ở đây,   │
 * │   bằng cách gửi **CẢ HAI** tên xuống SDK: cái nào không tồn tại thì CLI  │
 * │   tự bỏ. Đo được: gửi thừa một tên tốn **0 token**, vì nó bị bỏ trước    │
 * │   khi vào prefix.                                                        │
 * │                                                                          │
 * │ Không dò `process.platform`: Claude Code trên Windows CÓ Git Bash có thể │
 * │ đặt tên khác, mà ta thì không kiểm soát bảng tên đó. Gửi cả hai là để    │
 * │ SDK trả lời câu hỏi của chính nó — không có tiền đề nào để sai.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const SHELL_TOOL = 'Bash';

/** Mọi tên mà tool shell có thể mang. Gửi hết, SDK tự bỏ cái không có. */
export const SHELL_ALIASES = ['Bash', 'PowerShell'] as const;

/** Vai trò này có tool shell không — khai bằng bất kỳ tên nào cũng tính. */
export function hasShell(tools: readonly string[]): boolean {
  return tools.some((t) => (SHELL_ALIASES as readonly string[]).includes(t));
}

/** Tool mức `write_external` — sẽ phải qua cổng duyệt khi §8 được cài đặt. */
export const EXTERNAL_TOOLS = new Set<string>(SHELL_ALIASES);

/**
 * Bộ tool thật sự trao cho một vai trò: mặc định + phần khai thêm.
 *
 * Khai shell bằng MỘT tên thì nhận được MỌI tên — xem khối trên. Đây là chỗ
 * duy nhất biết chuyện đó, nên `roles/*.yaml` giữ nguyên `tools: [Bash]` dù
 * máy đang chạy là gì.
 */
export function effectiveTools(extra: readonly string[]): string[] {
  const out = new Set<string>([...BUILTIN_TOOLS, ...extra]);
  if (hasShell(extra)) for (const alias of SHELL_ALIASES) out.add(alias);
  return [...out];
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
      /**
       * Trần chi phí một task. **`0` = KHÔNG GIỚI HẠN**, và đó là mặc định.
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ TRẦN LÀ CÁI PHANH CỦA NGƯỜI DÙNG, KHÔNG PHẢI CÁI THƯỚC CỦA TA.     │
       * │ (user chốt 21/08)                                                  │
       * │                                                                    │
       * │ Bản trước mặc định $0.5 ở schema và $0.4 ở template sinh vai trò.  │
       * │ Đo được cùng ngày: đúng việc mà `pitch` của vai trò quảng cáo      │
       * │ (*"đọc CSV, tính tổng hợp theo nhóm"*) tốn **$0.425 · $0.448 ·     │
       * │ $0.516** trên tier `standard`. Tức mặc định của TA nằm DƯỚI giá    │
       * │ của công việc mà vai trò đó tồn tại để làm — nó bắn trên đường     │
       * │ hạnh phúc, mọi lần, và người dùng đọc chữ "hỏng" cho một việc      │
       * │ chạy đúng.                                                         │
       * │                                                                    │
       * │ Một con số cho cả hai tier cũng sai: cùng việc, `eco` tiêu         │
       * │ $0.157–0.179 còn `standard` $0.425–0.516 (~2,7×). Một trần chung   │
       * │ thì vừa quá lỏng cho tier này vừa quá chặt cho tier kia.           │
       * │                                                                    │
       * │ ⇒ Mặc định KHÔNG chặn; `newRoleYaml` ghi sẵn một số RỘNG theo tier │
       * │   để người dùng thấy và tự siết. Việc khó thì phải cho nó đủ chỗ   │
       * │   mà làm xong — chặn giữa chừng là mất trắng số tiền đã tiêu.      │
       * └────────────────────────────────────────────────────────────────────┘
       */
      max_usd: z.number().nonnegative().default(0),
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
      /**
       * Trần cho BẢNG KÊ KẾT QUẢ trong prefix Trợ lý. → SPEC-artifacts.md §2.4
       *
       * Nhỏ có chủ ý, và nó là trần DUY NHẤT chống được việc kho kết quả lớn
       * dần vô hạn còn ngữ cảnh thì không. Vượt trần là cắt từ CA CŨ NHẤT — kết
       * quả cũ ít khả năng được nhắc lại hơn kết quả vừa xong.
       *
       * ⚠ Khối này KHÔNG bao giờ vào prefix của nhân viên. Nhân viên nhận đường
       * dẫn qua `inputs`; nhét bảng kê vào đó là trả tiền ở MỌI lượt của MỌI
       * người để mua một thứ họ không dùng.
       */
      artifacts_manifest_tokens: z.number().int().positive().default(600),
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
   * Tủ tài liệu. → docs/SPEC-library.md §12
   *
   * Nằm ở cấp CÔNG TY dù tủ nằm ở cấp văn phòng: đây là mấy con số về giới hạn
   * máy móc, không phải chuyện "văn phòng này làm nghề gì". Cùng lý do với
   * `budgets`.
   */
  library: z
    .object({
      /**
       * Trần một file. 50MB phủ gần hết PDF có lớp chữ (sách 300 trang chỉ
       * 1–5MB) và phần lớn PDF nhiều hình. Trên mức này gần như chắc chắn là
       * bản chụp — thứ ta nhận được nhưng không tìm bằng từ khoá được.
       */
      max_file_mb: z.number().positive().default(50),
      /**
       * Chờ tối đa bao lâu cho tài liệu đang bóc trước khi chạy việc mà không
       * có văn bản. Timeout là bắt buộc: một file hỏng theo cách chưa lường
       * được không được phép treo cả văn phòng. → SPEC-library.md §10
       */
      extract_timeout_ms: z.number().int().positive().default(30_000),
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
 * KẾT QUẢ RƠI XUỐNG ĐÂU — trục thứ hai, độc lập với `intent`.
 * → docs/SPEC-offices.md §6 "`deliver`"
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `intent` quyết AI LÀM. `deliver` quyết KẾT QUẢ RƠI XUỐNG ĐÂU.            │
 * │                                                                          │
 * │ Trước 19/08 trục này bị đóng đinh `file` trong prompt, nên nó VÔ HÌNH —  │
 * │ và mọi nỗ lực sửa đều đi nhầm sang trục `intent`. Ca thật: khách hỏi     │
 * │ *"shop bảo hành bao lâu?"*, hệ thống trả lời *"đã lưu tại artifacts/     │
 * │ P-mt08w0t8-iu50/T-01/tra-loi.md"*. Định tuyến ĐÚNG (Trợ lý không có     │
 * │ tool, phải có nhân viên đọc tài liệu) — chỉ là task chỉ có đúng một      │
 * │ hình dạng giao hàng.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `reply` — người ta muốn BIẾT một điều. Đọc xong là thôi.
 * `file`  — người ta muốn CÓ một thứ. Mở · gửi · sửa · lưu.
 */
export const DeliverSchema = z.enum(['reply', 'file']);
export type Deliver = z.infer<typeof DeliverSchema>;

/**
 * Cấu hình một văn phòng. CỐ Ý nhỏ: mọi thứ dính tới tiền nằm ở company.yaml,
 * ở đây chỉ có "văn phòng này tên gì và Assistant của nó là ai".
 */
export const OfficeConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Văn phòng mới'),
  /**
   * Giới thiệu văn phòng — markdown THUẦN, không frontmatter, ở gốc văn phòng.
   *
   * ⚠ Trước 17/08 file này nằm ở `knowledge/shared/_charter.md`, tức là nó vừa
   * là một lớp prompt vừa là một node tri thức. Hai cửa sổ, hai đường ghi, không
   * liên kết — và người dùng gặp đủ ba hậu quả: node ma trong ngăn kéo Tri thức,
   * xoá node đó rồi sửa lớp prompt là file mất frontmatter và lặng lẽ thôi là
   * node, và nó dự thi COLD nên thân charter bị gửi HAI lần mỗi task (một lần
   * trong prefix đã cache, một lần ở giá đầy đủ).
   *
   * → docs/SPEC-library.md §17. `migrateCharters()` tự dời, không hỏi.
   */
  charter_file: z.string().default('charter.md'),

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
       * Kết quả của văn phòng này MẶC ĐỊNH rơi xuống đâu. → SPEC-offices.md §6
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ ĐÂY LÀ CẦN GẠT TẤT ĐỊNH THAY CHO LỆNH `/answer` ĐÃ BỊ BÁC BỎ.       │
       * │                                                                      │
       * │ Chat hay file KHÔNG phải chuyện của từng tin nhắn — nó là thuộc tính │
       * │ của VĂN PHÒNG, ổn định hàng tháng. `ho-tro-khach` sinh ra để đẻ câu  │
       * │ trả lời; `noi-dung` sinh ra để đẻ file. Đặt đúng mặc định ở đây thì  │
       * │ Trợ lý không còn phải tung đồng xu ở mỗi lượt — nó chỉ ghi đè khi ca │
       * │ này thật sự khác thường.                                             │
       * │                                                                      │
       * │ Giá: 0 token. Nó là một chữ nằm trong prefix vốn đã được cache.      │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      default_deliver: DeliverSchema.default('file'),

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

  /**
   * Kết quả task này rơi xuống đâu. Mặc định `file` — hình dạng cũ, không đổi
   * hành vi của văn phòng nào chưa khai `default_deliver`.
   *
   * ⚠ Task `reply` VẪN GHI FILE như thường. Nó chỉ thôi được RAO LÊN: file là
   * mỏ neo cho lần sửa sau và là dấu vết kiểm lại, gần như miễn phí. Thứ đổi là
   * người dùng đọc CÂU TRẢ LỜI trong chat thay vì đọc một đường dẫn.
   */
  deliver: DeliverSchema.default('file'),
});
export type TaskBrief = z.infer<typeof TaskBriefSchema>;

/**
 * ⚠ `'fact'` ĐÃ BỊ BỎ KHỎI ENUM NÀY (19/08) — và đó là chốt chặn, không phải dọn dẹp.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KINH NGHIỆM CHỈ ĐƯỢC GHI *CÁCH LÀM*, KHÔNG ĐƯỢC GHI *KIẾN THỨC*.        │
 * │                                                                          │
 * │ `fact` chính là cái ô để chép kiến thức vào. Còn ô đó thì model sẽ dùng  │
 * │ nó — bỏ ô đi rẻ hơn và chắc hơn mọi câu dặn. Đúng luật §4.3: đừng dặn    │
 * │ model đừng làm, đừng cho nó cơ hội làm.                                  │
 * │                                                                          │
 * │   ✅ "chính sách đổi trả nằm ở library/files/doi-tra.md, grep ở đó"      │
 * │   ⛔ "sản phẩm giảm 60% thường không được đổi trả"                       │
 * │                                                                          │
 * │ Vì sao ranh giới nằm đúng chỗ này: câu TRÊN vẫn đúng khi người dùng sửa  │
 * │ chính sách; câu DƯỚI thành lời nói dối ngay hôm đó, và nó THẮNG tài liệu │
 * │ vì nó nằm sẵn trong prefix của mọi nhân viên còn tài liệu thì phải đi     │
 * │ tìm. Weak-entity (`depends_on`) chỉ cứu được ca file BỊ XOÁ; ca file BỊ  │
 * │ SỬA thì chỉ luật này cứu được.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `NodeType` vẫn giữ `'fact'`: bản GHI NHỚ của Trợ lý dùng nó, và thứ NGƯỜI
 * DÙNG tự chốt thì đúng là fact. Chỉ KINH NGHIỆM AGENT TỰ RÚT mất ô đó.
 */
export const LessonSchema = z.object({
  kind: z.enum(['pitfall', 'playbook']).default('pitfall'),
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

  /**
   * CÂU TRẢ LỜI ĐẦY ĐỦ cho người dùng — chỉ có ở task `deliver: reply`.
   * → docs/SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HAI KÊNH, KHÔNG KÊNH NÀO CHỞ LẠI CHỮ CỦA KÊNH KIA.                      │
   * │                                                                          │
   * │   answer  →  thẳng ra chat, role = NHÂN VIÊN                             │
   * │             ⛔ KHÔNG BAO GIỜ đi vào session Trợ lý                       │
   * │   say     →  report() y như cũ                                           │
   * │             ✅ thứ DUY NHẤT Trợ lý nhìn thấy                             │
   * │                                                                          │
   * │ Nhờ tách đôi mà bất biến chi phí còn nguyên: ngữ cảnh Trợ lý vẫn chỉ    │
   * │ nhận MỘT CÂU cho mỗi task, dù câu trả lời cho khách dài 300 từ.         │
   * │                                                                          │
   * │ Nỗi lo "Trợ lý đọc file rồi truyền lại nội dung hai lần" KHÔNG xảy ra    │
   * │ được: nó đòi Trợ lý phải đọc được file, mà §4.7 đã cấm cứng có số đo.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Trần riêng, KHÔNG nằm trong trần 500 từ của `say` — xem `enforceCap`.
   */
  answer: z.string().default(''),

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
   * `outside`  — ghi ra NGOÀI thư mục văn phòng (`ref` = đường dẫn thô model gõ).
   *              Xem khối dưới: đây là nhãn cho một sự việc ta biết chắc.
   */
  kind: 'file' | 'external' | 'command' | 'outside';
  ref: string;
}

/**
 * ĐIỂM ĐẾN NGOÀI VĂN PHÒNG PHẢI CÓ TÊN — ĐO ĐƯỢC 21/08.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ca `P-260821-1818-yydi`: nhân viên `Write` một đường dẫn trỏ lên hai cấp, │
 * │ file rơi vào `company/artifacts/…` thay vì `offices/<mã>/artifacts/…`.    │
 * │ `landingOf` gọi `safeJoin`, `safeJoin` ném đúng như thiết kế, và cái      │
 * │ `catch { return undefined }` **nuốt luôn sự việc**.                       │
 * │                                                                          │
 * │ Hậu quả: `landed` rỗng → hệ thống nói *"không thấy file trên đĩa, nhắn    │
 * │ mình làm lại"* trong khi bảng kết quả 4236 byte nằm nguyên vẹn cách đó    │
 * │ hai thư mục. Người dùng được mời trả tiền lần thứ hai cho thứ họ đã có.   │
 * │                                                                          │
 * │ Đây là cột KIỂU HỎNG của nợ 0c, ô `bỏ qua lặng lẽ` — và nó nguy hơn ô     │
 * │ `từ chối` đúng như đã dự đoán: từ chối thì có câu báo lỗi, bỏ qua thì     │
 * │ không có gì cả. `undefined` ở đây nghĩa là "không có điểm đến nào", mà sự │
 * │ thật là "có điểm đến, và nó nằm ngoài chỗ ta cho phép". Hai câu khác hẳn  │
 * │ nhau; trả về cùng một giá trị là mất một nửa.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Thứ QUAN SÁT ĐƯỢC trong một lượt worker — độc lập hoàn toàn với việc lượt đó
 * kết thúc kiểu gì.
 *
 * Gói thành một kiểu riêng vì nó phải đi theo **mọi** đường ra (xong · bị ngắt ·
 * chạm trần · hết lượt · lỗi lạ). Cùng hình dạng với `RunError.usage`, và vì
 * cùng một lý do: token đã tiêu thì tồn tại dù lượt gọi kết thúc thế nào, và
 * file đã ghi thì nằm trên đĩa dù lượt gọi kết thúc thế nào.
 */
export interface Observed {
  landed: Landing[];
  looped: boolean;
  reads: string[];
}

/** Receipt đã qua validate + gắn số liệu đo được. */
export interface Receipt extends ReceiptBody {
  task_id: string;
  role: string;
  usage: Usage;
  wall_ms: number;
  /** true nếu worker trả sai schema và phải hỏi lại. Dùng để cảnh báo prompt kém. */
  reasked: boolean;

  /**
   * VÌ SAO lượt chạy kết thúc sớm — kiểu hỏng, không phải câu chữ.
   * `undefined` = vòng lặp chạy hết bình thường.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CÓ ĐỂ TRẢ LỜI CÂU "LỖI NÀY CỦA AI" BẰNG CODE, KHÔNG BẰNG SUY ĐOÁN.       │
   * │                                                                          │
   * │ `blocked_on` đã mang thông tin này rồi — nhưng dưới dạng một câu tiếng   │
   * │ Việt. Muốn quyết định gì dựa trên nó thì phải khớp chuỗi, mà khớp chuỗi   │
   * │ trên câu chữ hiển thị là thứ sẽ vỡ đúng hôm ai đó sửa lại câu cho hay hơn.│
   * │                                                                          │
   * │ Người đọc trường này là `agentFault()` — cửa quyết định CÓ HỎI model      │
   * │ "học được gì" hay không. Xem khối ở đó để biết vì sao câu hỏi *"của ai"*  │
   * │ phải được trả lời trước câu hỏi *"học được gì"*.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  failure?: FailureKind;
  /** Điểm đến quan sát được. Rỗng = task không tạo ra tác động nào nhìn thấy. */
  landed: Landing[];

  /**
   * Nhân viên có LẶP LẠI thao tác không — tín hiệu "ca này có trục trặc".
   * → `worker.ts → detectLoop`, `assistant.ts → worthLearning`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ "LOOP" KHÔNG PHẢI "NHIỀU LƯỢT". ĐỪNG BAO GIỜ TRỘN HAI THỨ NÀY.          │
   * │                                                                          │
   * │ Số lượt là thuộc tính của MODEL, không phải của ca chạy: đo được haiku   │
   * │ 10 lượt vs sonnet 4 lượt cho CÙNG một việc. Lấy nó làm tín hiệu trục     │
   * │ trặc thì mọi văn phòng `eco` luôn "đang hỏng" còn `deep` thì không bao   │
   * │ giờ. Bản nháp `turns >= 8` đã bị bộ test bác bỏ: ca 19/08 chạy đúng 9    │
   * │ lượt, tức nó CHO QUA đúng cái ca nó sinh ra để chặn.                     │
   * │                                                                          │
   * │ Lặp thao tác thì ngược lại — nó MODEL-INDEPENDENT, và nó là vi phạm     │
   * │ một kỷ luật `CORE_PROMPT` đã tuyên bố thành lời ("Read each file at most │
   * │ once", "Never read back a file you just wrote"). Đọc lại file đã đọc,    │
   * │ đọc lại file vừa ghi, gọi lại đúng một tool với đúng tham số cũ — cả ba  │
   * │ đều quan sát được trong luồng `tool_use` mà `worker.ts` đã bóc sẵn.      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  looped: boolean;

  /**
   * File TỦ TÀI LIỆU nhân viên thật sự chạm vào — QUAN SÁT ĐƯỢC, không do model khai.
   *
   * Đây là nguồn của `depends_on` trên node tri thức: kinh nghiệm rút ra sau khi
   * đọc `library/files/doi-tra.md` thì SỐNG CHẾT theo file đó. Người dùng xoá
   * tài liệu là kinh nghiệm đi theo — thực thể yếu, xoá 1-1, không có node mồ côi
   * nào nói về một file không còn tồn tại. → `KnowledgeStore.dropDependents`
   */
  reads: string[];
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
/**
 * `blocked` (20/08) — CHƯA THỬ vì còn thiếu thông tin, khác hẳn `failed` (ĐÃ
 * thử và hỏng). Khâu lập kế hoạch hỏi ngược lại người dùng thì ca dừng ở đây.
 *
 * Tách ra là để nhật ký công việc không nói dối: người dùng phải phân biệt được
 * *"hệ thống làm sai"* với *"hệ thống đang chờ mình"*, và gộp hai thứ đó vào một
 * trạng thái là làm hỏng chính cái nhật ký sinh ra để tin. → SPEC-offices.md §6
 */
export type PlanStatus =
  | 'planning'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'paused'
  | 'stopped';

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
  /**
   * Người dùng bấm Dừng. KHÔNG PHẢI MỘT LỖI — và đó là cả lý do nó có tên riêng.
   *
   * Không có nhãn này thì một lượt Trợ lý bị ngắt trông y hệt một lượt hỏng: ca
   * đóng ở `failed`, nhật ký ghi "hệ thống làm sai" cho một việc người dùng tự
   * bảo đừng làm nữa. Đúng lớp lỗi mà `blocked` đã tách ra khỏi `failed`
   * (SPEC-offices §6) — nhật ký phải phân biệt được ba chuyện khác hẳn nhau:
   * *ta hỏng* · *ta đang chờ bạn* · *bạn bảo dừng*.
   *
   * Không bao giờ retry: thứ duy nhất có thể xảy ra là làm lại đúng việc vừa bị
   * huỷ.
   */
  | 'stopped'
  | 'other';

export class RunError extends Error {
  readonly kind: FailureKind;
  /**
   * Token ĐÃ TIÊU trước khi lỗi nổ. → SPEC-token-economy.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIẾU TRƯỜNG NÀY LÀ TIỀN BIẾN MẤT KHỎI SỔ — ĐO ĐƯỢC 20/08.              │
   * │                                                                          │
   * │ Ca `P-260820-2219-5ltb`: `nguoi-gop` gọi 9 lượt tool trong 29 giây rồi   │
   * │ chạm `max_turns`. `worker.ts` ném `RunError` và **vứt biến `usage`** đã  │
   * │ cộng dồn, nên `usage.jsonl` ghi `0 lượt, $0`. Người dùng trả tiền thật   │
   * │ cho một dòng ghi $0.                                                     │
   * │                                                                          │
   * │ Và nó rơi đúng chỗ đau nhất: `max_turns` theo định nghĩa là kiểu hỏng    │
   * │ ĐẮT NHẤT — nó chạy tới kịch trần lượt. Cùng lớp với `budget` và          │
   * │ `rate_limit` (nhánh này còn trả task về hàng đợi rồi chạy lại từ đầu).   │
   * │                                                                          │
   * │ Nhánh bị NGẮT vốn đã làm đúng (`stoppedReceipt(…, usage, …)`) — nên đây  │
   * │ không phải một cơ chế mới, chỉ là bịt ba đường còn lại vào cùng một chỗ. │
   * │ → SESSIONS_MEMORY §2 "Sổ chi phí không được nói sai câu nào"             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readonly usage: Usage | undefined;

  /**
   * File ĐÃ GHI trước khi lỗi nổ. → `Observed`, SPEC-artifacts.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CÙNG MỘT BÀI HỌC VỚI `usage` NGAY TRÊN — VÀ LẦN TRƯỚC CHỈ HỌC MỘT NỬA.   │
   * │                                                                          │
   * │ Ca `P-260821-1827-m78h`: worker ghi xong bảng kết quả 4474 byte lúc      │
   * │ 18:30:01, đúng chỗ, đủ 56/56 nhóm và **không sai một con số nào**. Chín  │
   * │ giây sau, `error_max_budget_usd` nổ. `worker.ts` ném, `observed()` bị bỏ │
   * │ lại trong hàm, `errorReceipt` ghi cứng `landed: []` — và người dùng đọc  │
   * │ được câu *"chưa ra kết quả"* cho một việc đã xong và đã trả tiền.        │
   * │                                                                          │
   * │ Chua nhất: `stoppedReceipt` đã mô tả đúng con bug này từ trước           │
   * │ (*"Bản trước trả `artifacts: []` — tức là nói dối rằng không có gì trên  │
   * │ đĩa"*) rồi sửa cho ĐÚNG MỘT trên bốn nhánh ném. Ngay bên cạnh, `usage`   │
   * │ được gói vào hàm `fail()` kèm lời tự dặn *"thêm một nhánh ném mới trong  │
   * │ tương lai thì nó tự đúng"*. Hai trường, cùng một khối `catch`, cùng một  │
   * │ lý lẽ — một trường đi hết bốn nhánh, trường kia đi một.                  │
   * │                                                                          │
   * │ ⇒ VÁ MỘT TẦNG THÌ PHẢI ĐI HẾT MỌI ĐƯỜNG CỦA TẦNG ĐÓ. Sửa xong một nhánh │
   * │   thì câu hỏi tiếp theo luôn là *"còn nhánh nào cùng hình dạng?"*        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readonly observed: Observed | undefined;

  constructor(
    message: string,
    kind: FailureKind,
    options?: { cause?: unknown; usage?: Usage; observed?: Observed },
  ) {
    super(message, options);
    this.name = 'RunError';
    this.kind = kind;
    this.usage = options?.usage;
    this.observed = options?.observed;
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
  /**
   * Tin nhắn trong luồng hội thoại.
   *
   * `role` = `'user'` · `'assistant'` · **hoặc id một NHÂN VIÊN** — nhánh thứ ba
   * mở ra 19/08 cho task `deliver: reply`: câu trả lời đi THẲNG từ nhân viên tới
   * người dùng, không qua Trợ lý, nên nó phải mang tên người thật sự viết ra nó.
   *
   * ⚠ `say` KHÔNG BAO GIỜ chứa tên người nói (§6). Bên hiển thị tự tra tên từ
   * `role` — nướng sẵn tên vào chuỗi là tước quyền đó của mọi client tương lai,
   * và trên giao diện hiện tại thì tên sẽ hiện HAI lần.
   */
  /**
   * `files` — đường dẫn kết quả ĐÃ ĐƯỢC XÁC MINH, kèm theo tin nhắn dưới dạng
   * DỮ LIỆU chứ không phải chữ. → docs/SPEC-ui.md · SPEC-artifacts.md §2.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO KHÔNG ĐỂ GIAO DIỆN TỰ DÒ ĐƯỜNG DẪN TRONG `say`.                  │
   * │                                                                          │
   * │ `say` là chuỗi hướng người đọc, và một phần các tin nhắn trong luồng do  │
   * │ MODEL viết (`answer` của nhân viên ở task `deliver: reply`). Dò đường    │
   * │ dẫn bằng regex trên đó nghĩa là: nhân viên bịa ra một đường dẫn nghe rất │
   * │ thật, giao diện biến nó thành một cái nút bấm được, và người dùng tin    │
   * │ tưởng bấm vào. Đó là lấy uy tín của giao diện cho một câu model đoán.    │
   * │                                                                          │
   * │ Ở đây thì ngược lại: `files` CHỈ được điền bởi `whereBlock`, và mỗi      │
   * │ đường dẫn trong đó đã qua BA cửa — suy từ `receipt.landed` (tool ĐÃ GỌI, │
   * │ không phải `receipt.artifacts` do model khai), `safeJoin` chặn ra ngoài  │
   * │ thư mục văn phòng, và `existsSync` ngay trước khi phát.                  │
   * │                                                                          │
   * │ Hệ quả là một luật gọn: **chỉ đường dẫn do CHÍNH CODE đặt vào mới bấm    │
   * │ được.** Model không có đường nào làm một chữ trở nên bấm được.           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Đường dẫn ở đây tính từ THƯ MỤC VĂN PHÒNG (`artifacts/…`), còn trong `say`
   * thì có tiền tố `company/offices/<id>/` cho người mở file explorer. Hai hệ
   * quy chiếu khác nhau vì hai người dùng khác nhau, và bên hiển thị ghép lại
   * bằng cách so ĐUÔI chuỗi — không regex, không đoán.
   *
   * ⚠ Vắng mặt là bình thường và là mặc định. Bên hiển thị không đọc `files`
   * (Telegram) thì hiện `say` nguyên văn như hôm nay — đường dẫn vẫn nằm trong
   * đó, chỉ là không bấm được. Cùng một sự kiện, hai kết cục, đúng luật "mỗi
   * bên hiển thị tự chọn cách phản ứng".
   */
  | { type: 'master.message'; say: string; role: string; files?: string[] }
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
      /**
       * Câu trạng thái TẠM, đè lên dòng dựng từ các con số trên. → §4.6
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ ĐÂY LÀ CHỖ `/clear` NÓI CHUYỆN, THAY VÌ PHÁT `master.message`.       │
       * │                                                                      │
       * │ Nhịp "Đang dọn…" VỐN ĐÃ là trạng thái giả dạng tin nhắn — nó luôn bị │
       * │ chính `office.cleared` ngay sau đó cuốn đi, không nhánh nào nó sống   │
       * │ sót. Một tin nhắn được thiết kế để không tồn tại quá một nhịp thì nó  │
       * │ LÀ trạng thái. Còn nhịp "Đã dọn xong" thì tệ hơn: nó khiến `/clear`  │
       * │ để lại rác cho đúng thứ nó vừa dọn.                                  │
       * │                                                                      │
       * │ Cùng khuôn với `…thinking` → trắng: QUÁ TRÌNH thì hiện rồi biến, chỉ │
       * │ KẾT QUẢ mới ở lại. `/clear` không có kết quả nào thuộc về ô chat —   │
       * │ bằng chứng bền là node GHI NHỚ trong ngăn Tri thức.                  │
       * └──────────────────────────────────────────────────────────────────────┘
       *
       * `hold_ms` = bên hiển thị giữ câu này bao lâu rồi tự xoá. Tin xấu giữ lâu
       * hơn tin tốt: người ta đọc tin xấu chậm hơn.
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ ⚠ VẮNG `hold_ms` = GIỮ CHO TỚI SỰ KIỆN KẾ TIẾP. KHÔNG có mặc định.   │
       * │                                                                      │
       * │ BUG ĐÃ SỬA (20/08): "/clear vẫn khựng 3–5 giây không báo gì".        │
       * │                                                                      │
       * │ Hai loại `note` đi chung một trường nhưng có VÒNG ĐỜI ngược nhau:    │
       * │                                                                      │
       * │   `emitNote()`            KẾT QUẢ đã xong → hiện rồi biến  (có hold) │
       * │   nhánh `clearing`        VIỆC ĐANG CHẠY  → giữ tới khi xong (không) │
       * │                                                                      │
       * │ Bản trước ở web đọc "vắng mặt" thành `?? 4_000`. Mà nén trí nhớ mất  │
       * │ 5–15 giây — nên dòng "Đang dọn…" **tự tắt lúc 4 giây trong khi việc  │
       * │ vẫn đang chạy**, để lại đúng khoảng im lặng mà cả cơ chế này sinh ra  │
       * │ để lấp. Người dùng nhìn màn hình đứng im và tưởng app treo.          │
       * │                                                                      │
       * │ 🔥 Cay ở chỗ: chú thích `clearing` bên `office.ts` đã viết ra chính  │
       * │ bài học đó — *"thông báo thì có kẻ khác ghi đè được và CÓ HẸN GIỜ ĐỂ │
       * │ HẾT HẠN; trạng thái thì đúng chừng nào việc còn chạy"*. Server được  │
       * │ sửa thành trạng thái, client thì vẫn đặt hẹn giờ. **Lỗi không chết,  │
       * │ nó chuyển nhà.** Sửa một bất biến ở một tầng thì phải rà cả đường đi │
       * │ của nó — hai đầu cùng đọc một trường thì phải hiểu nó giống nhau.    │
       * │                                                                      │
       * │ An toàn: luôn có bên kết thúc — `office.cleared` xoá dòng trạng thái,│
       * │ và cả nhánh `.then` lẫn `.catch` của `/clear` đều phát `emitNote`.   │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      note?: string;
      hold_ms?: number;
    }
  /**
   * Hội thoại vừa được dọn (`/clear` hoặc tự nén). → docs/SPEC-offices.md §4.6
   *
   * Tách khỏi `master.message` vì nó là một MỆNH LỆNH cho bên hiển thị ("xoá
   * những gì đang hiện"), không phải một câu để đọc. Mỗi bên hiển thị tự chọn
   * cách phản ứng: web xoá sạch `messages`, bridge Telegram bỏ qua.
   *
   * ⚠ Lý do Telegram bỏ qua KHÔNG phải "không xoá được" (Bot API có
   * `deleteMessage`, bot xoá được tin của chính nó trong 48 giờ). Lý do là
   * KHÔNG NÊN: trên Telegram khung chat chính là bản lưu của người dùng, không
   * phải một khung nhìn vẽ lại được.
   *
   * THỨ TỰ BẮT BUỘC: `office.cleared` phát TRƯỚC, câu báo kết quả phát SAU.
   * Ngược lại thì câu vừa hiện ra bị chính lệnh xoá cuốn đi.
   */
  | { type: 'office.cleared'; say: string }
  | { type: 'cost.tick'; totals: Usage & { tasks: number } }
  /**
   * Hạn mức TÀI KHOẢN Claude đổi. → `core/energy.ts`
   *
   * ⚠ Khác `cost.tick` ở đúng chỗ dễ nhầm nhất, và giao diện phải xử khác:
   * `cost.tick` là tiền của MỘT VĂN PHÒNG trong phiên này — đổi văn phòng là
   * dọn sạch. `energy.tick` là hạn mức của cả TÀI KHOẢN, dùng chung với Claude
   * Code và claude.ai của chính người dùng. Dọn nó khi đổi văn phòng là xoá một
   * sự thật vẫn còn đúng.
   */
  | { type: 'energy.tick'; energy: Energy }
  | { type: 'knowledge.changed'; count: number; version: number }
  /**
   * Tủ tài liệu đổi. → docs/SPEC-library.md §10
   *
   * Việc bóc văn bản chạy NGẦM, có thể mất vài giây cho một PDF dày. Không có
   * sự kiện này thì dòng "đang đọc…" đứng im cho tới lần người dùng tự bấm mở
   * tủ — tức là đúng lúc họ cần biết nhất thì màn hình im lặng.
   *
   * `busy` là số tài liệu đang bóc, KHÔNG phải cờ: giao diện cần nói được "còn
   * 3 file" chứ không chỉ "đang bận".
   */
  | { type: 'library.changed'; count: number; busy: number }
  /** Hình dạng văn phòng đổi (kéo node, nối/ngắt dây, thêm/bớt nhân viên). */
  | { type: 'layout.changed'; say: string }
  /** Danh sách văn phòng đổi. `office` là cái vừa thêm/bớt. */
  | { type: 'company.offices'; say: string };

export type AgentEvent = EventBase & AgentEventBody;
