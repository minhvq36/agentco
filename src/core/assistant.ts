/**
 * Assistant — trợ lý của MỘT văn phòng. Session dài, đối thoại với người, chia việc.
 *
 * → docs/SPEC-offices.md §4
 *
 * Assistant KHÔNG tự làm việc tay chân, KHÔNG đọc file lớn, KHÔNG đọc transcript
 * thô của worker. Nó chỉ thấy: pitch của các vai trò ĐANG TRỰC, và receipt.
 *
 * Assistant KHÔNG gắn MCP: nó resume liên tục, mà MCP phá prompt cache khi resume
 * (issue #247) → mất ~36.000 token quy đổi mỗi lượt. Việc vặt cần MCP đi qua
 * worker ẩn `concierge` (M1) — người dùng chỉ thấy "Trợ lý dùng được tool này".
 */

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { LoadedOffice } from './config.js';
import { buildAssistantPrompt } from './prompt.js';
import { addUsage, classifyError } from './worker.js';
import {
  EMPTY_USAGE,
  LessonSchema,
  RunError,
  TaskBriefSchema,
  type Lesson,
  type Plan,
  type PlanStep,
  type Receipt,
  type Role,
  type Tier,
  type Usage,
} from './types.js';
import { truncateToTokens } from './tokens.js';

const PlanOutputSchema = z.object({
  steps: z.array(z.string()).min(1).max(6),
  tasks: z
    .array(
      z.object({
        task_id: z.string(),
        role: z.string(),
        goal: z.string(),
        inputs: z.array(z.object({ path: z.string() })).default([]),
        outputs: z.array(z.object({ path: z.string() })).default([]),
        constraints: z.array(z.string()).default([]),
        deps: z.array(z.string()).default([]),
        step: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
});

/**
 * Bốn kết quả định tuyến. → SPEC-offices.md §6
 *
 * `scope` trên intent `task` là thứ quyết định log đọc được hay không: `new`
 * sinh một Plan độc lập, `refine` gắn vào Plan đang chạy. Assistant quyết trên
 * session của nó (nó có cả lịch sử hội thoại) chứ không suy ra bằng heuristic
 * ở client — client không biết hai câu có cùng một việc hay không.
 */
const RouteSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('chat'), say: z.string().min(1) }),
  z.object({ intent: z.literal('ask'), say: z.string().min(1) }),
  z.object({
    intent: z.literal('task'),
    request: z.string().min(1),
    scope: z.enum(['new', 'refine']).default('new'),
  }),
]);
export type RouteDecision = z.infer<typeof RouteSchema>;

const ReportSchema = z.object({
  say: z.string().min(1),
  lessons: z.array(LessonSchema).max(2).default([]),
});

export interface AssistantResult<T> {
  value: T;
  usage: Usage;
}

/**
 * Bọc một lượt hỏi thành streaming input. Xem khối chú thích ở `run()`.
 *
 * Yield đúng MỘT tin rồi kết thúc: SDK nhận đủ đầu vào và đóng stream ngay, nên
 * không có ca treo nào. `session_id` để rỗng — SDK tự điền; con trỏ session
 * thật đi qua `options.resume`.
 */
async function* oneShot(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;
}

/**
 * Ca này có gì để học không? Quyết bằng CODE, trước khi hỏi model.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỪNG DẶN MODEL ĐỪNG LÀM — ĐỪNG CHO NÓ CƠ HỘI LÀM.                        │
 * │                                                                          │
 * │ Bản trước LUÔN kèm trường `lessons` vào mọi báo cáo, kèm câu dặn "Việc    │
 * │ chạy trơn tru không phải bài học". Hỏi một model "bạn học được gì?" thì   │
 * │ nó gần như luôn nặn ra một câu, và lời dặn không cản được.                │
 * │                                                                          │
 * │ Ca thật, 19/08: một ca chạy trơn tru hoàn toàn (1 việc, done, không       │
 * │ blocked, không sửa receipt) đẻ ra node `k/shared/san-pham-giam-gia-60-…`. │
 * │ Nội dung của nó là bản diễn giải LỆCH của một câu trong tài liệu người    │
 * │ dùng: chính sách viết "trên 50% không đổi trả", node ghi "giảm 60%        │
 * │ THƯỜNG không được đổi trả". Sai ngưỡng, thêm chữ "thường" mà chính sách   │
 * │ không có, và nằm trong prefix của mọi nhân viên cho tới khi hết hạn.      │
 * │                                                                          │
 * │ Trợ lý viết được câu đó mà chưa từng đọc tài liệu nào — nó chỉ nhìn thấy  │
 * │ MỘT dòng `say` của nhân viên. Đó là nghe kể lại, không phải bài học.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ngưỡng: chỉ hỏi khi ca có DẤU VẾT trục trặc — thứ quan sát được, không phải
 * thứ suy đoán. Ca êm đẹp thì kinh nghiệm thật của người dùng vẫn có đường vào
 * kho, và là đường tốt hơn: nói với Trợ lý rồi `/clear` → node GHI NHỚ 0.9.
 *
 * ⚠ CỐ Ý KHÔNG dùng SỐ LƯỢT làm dấu hiệu, dù rất cám dỗ.
 *
 * Bản nháp đầu của hàm này có thêm `usage.turns >= 8`, và bộ test đã bác bỏ nó
 * ngay: ca 19/08 chạy đúng **9 lượt** — tức là điều kiện đó cho qua đúng cái ca
 * nó sinh ra để chặn. Lý do sâu hơn nằm ở §7: *số lượt là thuộc tính của MODEL
 * và độ khó việc*, đo được là haiku 10 lượt vs sonnet 4 lượt cho cùng một việc.
 * Lấy nó làm tín hiệu "có trục trặc" nghĩa là mọi văn phòng chạy `eco` đều bị
 * coi là đang trục trặc, còn `deep` thì không bao giờ.
 *
 * Ba dấu hiệu còn lại đều KHÔNG phụ thuộc model: việc hỏng, việc bị chặn, hoặc
 * receipt phải sửa lại.
 *
 * Đánh đổi đã biết và chấp nhận: kho tri thức lớn chậm hẳn lại.
 */
export function worthLearning(receipts: readonly Receipt[]): boolean {
  return receipts.some((r) => r.status !== 'done' || r.reasked || !!r.blocked_on);
}

/**
 * Đóng khung mọi đường dẫn artifact của kế hoạch này vào thư mục RIÊNG của nó.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `T-01` LÀ SỐ THỨ TỰ TRONG MỘT KẾ HOẠCH, VÀ MỌI KẾ HOẠCH ĐỀU BẮT ĐẦU TỪ 1.│
 * │                                                                          │
 * │ Nên `artifacts/T-01/` là thư mục dùng CHUNG cho mọi lần chạy. Đo được    │
 * │ trên máy người dùng: văn phòng `noi-dung` có TÁM kế hoạch, cả tám cùng   │
 * │ đổ vào `artifacts/T-01/` — chín file lẫn lộn một chỗ, không có gì cho    │
 * │ biết file nào của lần chạy nào.                                          │
 * │                                                                          │
 * │ Hôm nay chưa mất gì vì tên file tình cờ khác nhau. Chạy lại một yêu cầu  │
 * │ giống lần trước là kết quả cũ bị GHI ĐÈ, không hỏi, không báo — đúng lớp │
 * │ lỗi "mất việc của người dùng, im lặng" ở §8.                             │
 * │                                                                          │
 * │ `Scheduler.validate` chỉ chặn hai task trong CÙNG một kế hoạch ghi đè    │
 * │ nhau; nó không biết gì về các kế hoạch trước.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Làm bằng CODE, không dặn model: `plan_id` được sinh ra ở đây, model không hề
 * biết nó. Hỏi model tự đặt đường dẫn duy nhất là trả tiền để mua lại đúng sự
 * bất định ta vừa loại bỏ.
 *
 * ⚠ CHỈ viết lại đường dẫn trỏ tới task CỦA CHÍNH KẾ HOẠCH NÀY. Người dùng có
 * quyền nói "sửa lại file hôm qua", và lúc đó `inputs` trỏ tới artifact của một
 * kế hoạch cũ — viết lại nó là chỉ nhân viên tới một file không tồn tại.
 */
export function artifactScoper(planId: string, taskIds: readonly string[]): (p: string) => string {
  const mine = new Set(taskIds);
  return (raw: string): string => {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = p.split('/');
    if (parts[0] !== 'artifacts' || parts.length < 2) return raw;
    // Đã được đóng khung rồi (đường dẫn cũ do người dùng dán lại) — để nguyên.
    if (!mine.has(parts[1] ?? '')) return raw;
    return ['artifacts', planId, ...parts.slice(1)].join('/');
  };
}

export class Assistant {
  private sessionId: string | undefined;
  /** Vai trò có dây nối từ Assistant trên canvas. undefined = chưa cấu hình = tất cả. */
  private assignable: Set<string> | undefined;
  /** Tri thức HOT nạp sẵn vào prefix. Chỉ đổi khi bump knowledge_version. */
  private hotKnowledge = '';

  constructor(private office: LoadedOffice) {}

  get session(): string | undefined {
    return this.sessionId;
  }

  resumeFrom(sessionId: string | undefined): void {
    this.sessionId = sessionId;
  }

  /**
   * Ngữ cảnh hiện tại to bao nhiêu — đo được, không phải ước.
   *
   * Ở một lượt cache ẤM, `cache_read` chính là toàn bộ prefix + bản ghi hội
   * thoại mà server vừa đọc lại. Đó là con số thật, miễn phí, và là thứ quyết
   * định khi nào phải nén. Đếm tay số token đã gửi thì vừa sai vừa thừa.
   *
   * ⚠ KHÔNG bao gồm token của nhân viên: worker chạy `persistSession: false` ở
   * một `query()` riêng, và khâu lập kế hoạch cũng vậy. Chỉ `route()`/`report()`
   * làm phình bản ghi này.
   */
  contextTokens = 0;

  /** Quên hội thoại: lượt sau bắt đầu một session mới tinh. */
  forget(): void {
    this.sessionId = undefined;
    this.contextTokens = 0;
  }

  /**
   * NÉN TRÍ NHỚ: hỏi Trợ lý phần duy nhất chỉ nó biết. → docs/SPEC-offices.md §4.6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `skeleton` DO CODE DỰNG, KHÔNG HỎI MODEL.                                │
   * │                                                                          │
   * │ Việc đã chạy, kết quả ở đâu, tốn bao nhiêu — tất cả nằm trong            │
   * │ `tasks/index.json` và trong receipt. Bắt model kể lại là trả tiền để     │
   * │ nhận về một bản sao có thể sai. Ta đưa sự thật vào, và chỉ hỏi thứ       │
   * │ KHÔNG có ở đâu khác: người dùng thích gì, đã chốt gì, đang dở gì.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Chạy TRÊN session cũ — phải thế, vì cả điểm của nó là đọc bản ghi sắp bỏ.
   */
  async compact(skeleton: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.askSession(
      `Sắp bắt đầu một cuộc trò chuyện mới. Đây là những việc đã chạy (dữ liệu hệ thống, KHÔNG cần kể lại):\n\n` +
        `${skeleton}\n\n` +
        `Hãy viết lại NHỮNG THỨ KHÔNG CÓ TRONG DỮ LIỆU TRÊN mà bạn cần nhớ để phục vụ tiếp:\n` +
        `- người dùng thích gì, không thích gì (giọng văn, độ dài, cách trình bày)\n` +
        `- những gì đã CHỐT và không cần bàn lại\n` +
        `- việc đang dở, câu hỏi bạn đã hỏi mà chưa có trả lời\n\n` +
        // ~500 từ chứ không phải 200: khối này là thứ ĐẮT GIÁ NHẤT trong prefix
        // của Trợ lý — nó nằm trong cache nên trả ~0.1× sau lần ghi đầu, mà mất
        // một quyết định của người dùng thì không mua lại được bằng token nào.
        // Dài hơn một chút mà giữ được đủ ý là lãi.
        `Viết gạch đầu dòng tiếng Việt, dưới 500 từ, mỗi dòng một ý dùng lại được. ` +
        `KHÔNG kể lại danh sách việc đã làm. KHÔNG viết lời chào hay lời hứa. ` +
        `Nếu thật sự không có gì đáng nhớ thì trả về đúng một chữ: KHÔNG`,
    );
    return { value: text.trim(), usage };
  }

  /** Sau khi nạp lại văn phòng từ đĩa. Giữ nguyên session. */
  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  setHotKnowledge(text: string): void {
    this.hotKnowledge = text.trim();
  }

  /** Bản nén trí nhớ — khối riêng trong prefix, không trộn vào hot. */
  private memory = '';

  setMemory(text: string): void {
    this.memory = text.trim();
  }

  /**
   * Bảng kê tủ tài liệu. → docs/SPEC-library.md §8b
   *
   * Nằm trong prefix được cache, KHÔNG phải một lượt gọi tool. Cho Trợ lý một
   * tool để đi đọc mục lục thì mỗi lần đọc là một lượt, mà `route()` chạy ở MỖI
   * tin nhắn — đó là đường đông người qua lại nhất của sản phẩm.
   */
  private library = '';

  setLibrary(text: string): void {
    this.library = text.trim();
  }

  /**
   * Ai được giao việc — do cạnh `Assistant → agent` trên canvas quyết định.
   *
   * Đây là chỗ kéo một sợi dây thành hậu quả ĐO ĐƯỢC: agent bị ngắt thì `pitch`
   * của nó biến khỏi ngữ cảnh Assistant. Cái giá đi kèm: roster nằm trong prefix
   * được cache, nên đổi dây = ghi lại cache một lần. Rẻ (roster vài trăm token)
   * nhưng KHÔNG miễn phí — đừng gọi hàm này mỗi lần kéo chuột.
   */
  setAssignable(ids: Set<string> | undefined): void {
    this.assignable = ids;
  }

  /**
   * Vai trò Assistant thật sự thấy. Scheduler dùng đúng danh sách này để validate.
   *
   * Vai trò đã LƯU TRỮ bị loại ở đây, không phụ thuộc vào canvas: `assignable`
   * đến từ cạnh nối, mà cạnh nối chỉ tồn tại khi có layout.json. Văn phòng chưa
   * có file đó thì `assignable` là undefined = "tất cả" — và "tất cả" phải
   * không bao gồm người đã cất đi.
   */
  assignableRoles(): Set<string> {
    const live = [...this.office.roles.keys()].filter((id) => !this.office.archivedRoles.has(id));
    if (!this.assignable) return new Set(live);
    return new Set(live.filter((id) => this.assignable!.has(id)));
  }

  /**
   * Danh bạ — chỉ pitch + một dòng khả năng, KHÔNG kèm skills.
   * → docs/SPEC-tools-approval.md §1
   *
   * Khả năng TỰ SINH từ connector/MCP đang nối vào agent, không bắt người dùng
   * viết tay vào `pitch`. Thiếu nó thì Trợ lý chia việc như thể không ai có
   * tool nào — không thể quyết "giao cho người này vì nó với tới được Notion".
   *
   * CỐ Ý chỉ nêu TÊN, không nêu schema: Trợ lý cần biết *với tới được cái gì*,
   * không cần biết *gọi thế nào*. Nó không gọi tool nào cả.
   */
  private reach(role: Role): string {
    const parts = [...role.mcp];
    // Web bật sẵn cho mọi nhân viên (BUILTIN_TOOLS) nên luôn nêu — đây là khả
    // năng thật, và không nêu thì Trợ lý không biết mà giao việc tra cứu.
    parts.push('web');
    return parts.length ? ` [với tới: ${parts.join(', ')}]` : '';
  }

  private roster(): string {
    const allowed = this.assignableRoles();
    const lines = [...this.office.roles.values()]
      .filter((r) => allowed.has(r.id))
      .map(
        (r) =>
          `- ${r.id} (${r.display_name || r.id}): ${r.pitch}` +
          this.reach(r) +
          (r.not_for.length ? ` [không làm: ${r.not_for.join(', ')}]` : ''),
      );
    if (lines.length === 0) {
      return `# Employees you can assign to\n\n(none — this office has nobody on duty)`;
    }
    return `# Employees you can assign to\n\n${lines.join('\n')}`;
  }

  /**
   * Mức model của Trợ lý này. Văn phòng có quyền ghi đè `models.master`.
   * → docs/SPEC-offices.md §4.5
   */
  get modelTier(): Tier {
    return this.office.config.assistant.model_tier ?? this.office.company.models.master;
  }

  /** Model thật sự sẽ chạy — để giao diện nói ra thay vì bắt người dùng đoán. */
  get model(): string {
    return this.office.company.models[this.modelTier];
  }

  private systemPrompt(): string[] {
    const built = buildAssistantPrompt(this.office, {
      roster: this.roster(),
      hotKnowledge: this.hotKnowledge,
      memory: this.memory,
      library: this.library,
      model: this.model,
    });
    return built.systemPrompt as string[];
  }

  /**
   * Lập kế hoạch — chạy ở query ONE-SHOT RIÊNG, KHÔNG nằm trong session Assistant.
   *
   * Lý do: prompt cache đánh theo (model, prefix). Nếu bước này chạy trên session
   * Assistant bằng một model khác (ví dụ Opus cho chất lượng) thì MỖI LẦN đổi model
   * là miss toàn bộ ngữ cảnh — đúng cái ~36.000 token quy đổi đã cảnh báo ở vụ MCP.
   * Tách ra thì đặt `models.planner: deep` thoải mái mà session vẫn ấm nguyên.
   */
  async plan(request: string): Promise<AssistantResult<Plan>> {
    const models = this.office.company.models;
    const { text, usage } = await this.askOneShot(
      `Lập kế hoạch cho yêu cầu sau. Trả về đúng một object JSON như đã quy định.\n\nYêu cầu: ${request}`,
      models[models.planner],
    );

    const parsed = extractJson(text, PlanOutputSchema);
    if (!parsed) {
      throw new RunError(
        'Trợ lý chưa hiểu đủ rõ để chia việc. Thử nói cụ thể hơn: làm gì, cho ai, và cần kết quả dạng nào.',
        'other',
      );
    }

    const rawSteps = parsed.steps;
    const rawTasks = parsed.tasks.map((t) => ({ ...t, step: clampStep(t.step, rawSteps.length) }));

    /**
     * BỎ BƯỚC KHÔNG CÓ TASK NÀO.
     *
     * Model rất hay viết một bước kiểu "Lưu kết quả vào file" rồi không giao
     * task nào cho nó — vì việc đó đã nằm trong task trước. Bước như thế KHÔNG
     * AI TICK ĐƯỢC: nó đứng nguyên ở "chưa làm" kể cả khi mọi việc đã xong, và
     * người dùng nhìn vào tưởng hệ thống bỏ sót.
     *
     * Lọc bằng code chứ không bằng cách bắt model lập lại kế hoạch: rẻ hơn một
     * lượt gọi, và deterministic. Prompt cũng đã dặn thêm, nhưng dặn là gợi ý
     * còn cái này là bảo đảm.
     */
    const used = new Set(rawTasks.map((t) => t.step));
    const kept = rawSteps.map((title, i) => ({ title, i })).filter((s) => used.has(s.i));
    const remap = new Map(kept.map((s, newIndex) => [s.i, newIndex]));

    const steps: PlanStep[] = kept.map((s) => ({ title: s.title, status: 'pending' }));
    const plan_id = newPlanId();
    const scope = artifactScoper(plan_id, rawTasks.map((t) => t.task_id));

    const tasks = rawTasks.map((t) =>
      TaskBriefSchema.parse({
        ...t,
        inputs: t.inputs.map((i) => ({ kind: 'file' as const, path: scope(i.path) })),
        outputs: t.outputs.map((o) => ({ kind: 'file' as const, path: scope(o.path) })),
        step: remap.get(t.step) ?? 0,
      }),
    );

    return { value: { plan_id, request, steps, tasks }, usage };
  }

  /**
   * Tổng kết sau khi DAG chạy xong. Chạy TRÊN session Assistant — đây cũng là
   * cách kế hoạch (vốn lập ở query riêng) được ghi vào trí nhớ hội thoại, ở dạng
   * nén, để lần sau người dùng hỏi "sao lại làm thế" thì Assistant biết.
   *
   * Thu luôn BÀI HỌC CHUNG ở đây. Assistant là bên duy nhất được ghi vào
   * `knowledge/shared/` (SPEC-offices.md §4.3), và gộp vào lượt gọi sẵn có nên
   * KHÔNG tốn thêm lượt nào.
   */
  async report(
    steps: readonly { title: string }[],
    receipts: Receipt[],
  ): Promise<AssistantResult<{ say: string; lessons: Lesson[] }>> {
    const plan = steps.map((s, i) => `${i + 1}. ${s.title}`).join(' · ');
    const summary = receipts
      .map((r) => `- [${r.status}] ${r.role}: ${r.say}${r.artifacts.length ? ` → ${r.artifacts.join(', ')}` : ''}`)
      .join('\n');

    const wantLessons = worthLearning(receipts);

    const { text, usage } = await this.askSession(
      `Kế hoạch vừa chạy: ${plan}\n\nKết quả:\n${summary}\n\n` +
        `Trả về đúng một object JSON trong khối \`\`\`json:\n` +
        `{"say":"<1–3 câu tiếng Việt báo cáo cho người dùng: đã xong gì, có gì cần họ để ý. ` +
        `Không liệt kê lại từng việc, không dùng thuật ngữ kỹ thuật>"` +
        (wantLessons
          ? `,\n "lessons":[{"kind":"pitfall","text":"<bài học dùng lại được cho VĂN PHÒNG này, dưới 25 từ>"}]}\n\n` +
            `Ca này có trục trặc, nên \`lessons\` là chỗ ghi lại thứ giúp lần sau tránh được — ` +
            `tối đa 2, và vẫn ĐỂ TRỐNG nếu trục trặc đó không dạy được gì dùng lại. ` +
            `Viết về CÁCH LÀM VIỆC, đừng chép lại nội dung tài liệu.`
          : `}`),
    );

    const parsed = extractJson(text, ReportSchema);
    // Không đọc được thì vẫn phải có câu báo cáo — người dùng đang chờ.
    const value = parsed ?? { say: text.trim() || 'Đã xong.', lessons: [] };
    // Chốt cuối: không hỏi thì không nhận, kể cả model tự ý gửi kèm.
    return { value: wantLessons ? value : { ...value, lessons: [] }, usage };
  }

  /**
   * Quyết định người dùng vừa nói gì: trò chuyện, hỏi thêm, hay giao việc.
   *
   * Chạy TRÊN session Assistant (rẻ: ngữ cảnh chỉ có roster + charter + skills,
   * đã cache) nên nó nhớ cả cuộc hội thoại. "Chào" không được biến thành một
   * kế hoạch DAG — đó là lỗi người dùng gặp ngay thao tác đầu tiên.
   *
   * `ask` là trường hợp đáng giá nhất: yêu cầu mơ hồ thì HỎI LẠI thay vì lập
   * kế hoạch sai rồi đốt tiền. Đây đúng là nỗi đau gốc của sản phẩm — người
   * ngoại đạo hoang mang không biết AI đang dắt mình đi đâu.
   */
  async route(message: string, hasActivePlan: boolean): Promise<AssistantResult<RouteDecision>> {
    const scopeHint = hasActivePlan
      ? `\nĐang có một công việc chạy dở. Với intent "task", đặt "scope":"refine" nếu câu này BỔ SUNG hoặc SỬA cho việc đang chạy; ` +
        `đặt "scope":"new" nếu đây là một việc KHÁC HẲN. Khi phân vân, chọn "new" — hai việc tách rời chỉ tốn thêm một lần lập kế hoạch, ` +
        `còn gắn nhầm vào việc đang chạy thì làm hỏng cả hai.`
      : `\nHiện không có việc nào đang chạy, nên với intent "task" luôn dùng "scope":"new".`;

    const { text, usage } = await this.askSession(
      `Người dùng vừa nhắn: "${message}"\n\n` +
        `Trả về đúng một object JSON, không có gì khác:\n` +
        `{"intent":"chat","say":"<trả lời ngắn bằng tiếng Việt>"}\n` +
        `  dùng khi: chào hỏi, cảm ơn, hỏi về văn phòng, hỏi về việc đã làm, nói chuyện phiếm.\n` +
        `{"intent":"ask","say":"<một câu hỏi làm rõ, tiếng Việt>"}\n` +
        `  dùng khi: có vẻ là yêu cầu công việc NHƯNG thiếu thông tin quan trọng ` +
        `(làm cho ai, dài bao nhiêu, giọng thế nào, dựa trên tài liệu nào). ` +
        `Hỏi MỘT câu quan trọng nhất thôi. Thà hỏi còn hơn đoán sai rồi làm lại.\n` +
        `{"intent":"task","request":"<viết lại yêu cầu thành một câu rõ ràng, đủ ngữ cảnh>","scope":"new"}\n` +
        `  dùng khi: đã đủ rõ để giao cho đội.` +
        scopeHint,
    );

    const parsed = extractJson(text, RouteSchema);
    // Không đọc được thì coi là trò chuyện — an toàn hơn nhiều so với việc
    // lỡ khởi động cả một DAG tốn tiền vì hiểu nhầm.
    const value: RouteDecision = parsed ?? {
      intent: 'chat',
      say: text.trim() || 'Mình chưa hiểu ý bạn, nói rõ hơn giúp mình nhé.',
    };
    return { value, usage };
  }

  /** Trò chuyện thường — không lập kế hoạch. */
  async chat(message: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.askSession(
      `${message}\n\n(Trả lời ngắn gọn bằng tiếng Việt. Nếu đây là một yêu cầu công việc cần giao cho đội, ` +
        `nói rõ bạn sẽ lập kế hoạch chứ đừng tự làm.)`,
    );
    return { value: text.trim(), usage };
  }

  // ── nội bộ

  /**
   * Trên session Assistant.
   *
   * Model đọc lại ở MỖI lượt, cố ý. Trước đây chú thích ở đây ghi "model CỐ
   * ĐỊNH — không bao giờ đổi giữa ca", nhưng đó là mô tả một giới hạn chứ không
   * phải một bất biến: người dùng có quyền đổi model của Trợ lý, và cái giá của
   * việc đó đã biết rõ (SPEC-offices.md §4.5).
   *
   * Thứ THẬT SỰ bất biến là: đổi model KHÔNG được chạm vào việc đang chạy. Điều
   * đó đã đúng sẵn — `Office.applyCompanyConfig` dựng một `LoadedOffice` MỚI,
   * còn Scheduler của ca đang chạy giữ nguyên bản cũ nó cầm từ đầu. Trợ lý thì
   * mỗi lúc chỉ làm một việc (hòm thư khoá), nên không có lượt nào bị đổi model
   * giữa chừng.
   */
  private askSession(prompt: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, this.model, true);
  }

  /** Query độc lập, không đụng session. Đổi model ở đây là an toàn. */
  private askOneShot(prompt: string, model: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, model, false);
  }

  private async run(
    prompt: string,
    model: string,
    useSession: boolean,
  ): Promise<{ text: string; usage: Usage }> {
    let usage: Usage = { ...EMPTY_USAGE };
    let text = '';

    try {
      for await (const msg of query({
        /**
         * ⚠ STREAMING INPUT, KHÔNG PHẢI CHUỖI — và đây là điều kiện để
         * `canUseTool` chạy. Truyền `prompt` là một chuỗi thì SDK **im lặng bỏ
         * qua `canUseTool`**: không lỗi, không cảnh báo, tool vẫn chạy, cổng
         * chặn không tồn tại.
         *
         * Đã đo 19/08: Trợ lý `Grep` được vào sổ tay của một nhân viên đã bị
         * ngắt dây, `gate.log` rỗng tuyệt đối. Tệ hơn nữa, khi bị hỏi về một
         * file ngoài vùng cho phép nó trả lời *"mình không có quyền xem"* —
         * **model tự diễn theo bản đồ thư mục trong prompt**, trong khi thực
         * tế nó có toàn quyền. Đúng thứ luật *"đừng để model tự giải thích hệ
         * thống cho người dùng"* đã cấm: nghe rất hợp lý và sai hoàn toàn.
         *
         * Generator này yield MỘT lần rồi kết thúc, nên stream đóng ngay — khác
         * hẳn ca DEADLOCK ở §8, vốn do GIỮ MỞ stream để chờ `interrupt()`.
         */
        prompt: oneShot(prompt),
        options: {
          systemPrompt: this.systemPrompt(),
          model,
          cwd: this.office.dir,
          maxTurns: 4,
          settingSources: [],
          strictMcpConfig: true,
          /**
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ `tools` GIỚI HẠN. `allowedTools` CHỈ TỰ-DUYỆT. HAI THỨ KHÁC NHAU.│
           * │                                                                  │
           * │ Bản trước chỉ đặt `allowedTools: []` và tưởng thế là "Trợ lý      │
           * │ không có tool". Không phải — đó chính xác là con rò đã tìm ra ở   │
           * │ worker ngày 16/08 (§5d): `allowedTools` không cắt tool khỏi ngữ   │
           * │ cảnh, nên ĐỊNH NGHĨA của toàn bộ bộ tool Claude Code vẫn nằm      │
           * │ trong prefix — ở đây là prefix của `route()`, thứ chạy ở MỖI TIN  │
           * │ NHẮN người dùng gõ. Worker được vá 16/08; Trợ lý bị bỏ quên.      │
           * │                                                                  │
           * │ `tools` phải LUÔN được truyền, kể cả khi danh sách rỗng — và ở    │
           * │ đây nó rỗng THẬT.                                                 │
           * └──────────────────────────────────────────────────────────────────┘
           *
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ VÌ SAO TRỢ LÝ KHÔNG CÓ `Grep` — dù ai cũng muốn nó có.           │
           * │                                                                  │
           * │ Ngày 19/08 đã thử trao `Grep`/`Glob` kèm một cổng chặn theo thư  │
           * │ mục, để nó không đọc được sổ tay của nhân viên đã bị ngắt dây.   │
           * │ **Ba cơ chế, không cơ chế nào chặn được:**                        │
           * │                                                                  │
           * │   `canUseTool`                     → không nổ lần nào             │
           * │   `canUseTool` + streaming input   → không nổ lần nào             │
           * │   hook `PreToolUse` (± `matcher`)  → không nổ lần nào             │
           * │                                                                  │
           * │ Đo bằng cách ghi mọi quyết định ra `.state/gate.log`: file RỖNG   │
           * │ TUYỆT ĐỐI trong khi `Grep` vẫn chạy và vẫn đọc được file cấm.     │
           * │ Suy đoán tốt nhất: tool chỉ-đọc được CLI tự duyệt và không đi qua │
           * │ đường phê duyệt nào cả. Chưa xác nhận được, nên **đừng xây gì lên │
           * │ phần này** cho tới khi đo lại.                                    │
           * │                                                                  │
           * │ 🔥 Và đây là lý do phải BỎ HẲN chứ không "tạm chấp nhận": khi bị │
           * │ hỏi về một file ngoài vùng, Trợ lý trả lời *"mình không có quyền  │
           * │ xem file cấu hình hệ thống"* — nó DIỄN theo bản đồ thư mục trong  │
           * │ prompt, trong khi thực tế có toàn quyền. Không hàng rào thì còn   │
           * │ biết là không có; một hàng rào giả được model thuật lại đầy tự    │
           * │ tin thì tệ hơn hẳn. Đúng luật "đừng để model tự giải thích hệ     │
           * │ thống cho người dùng".                                            │
           * │                                                                  │
           * │ Đường ra CÓ tồn tại — tự khai một tool MCP với `where` là ENUM    │
           * │ dựng từ `assignableRoles()`, thì thao tác sai không diễn đạt      │
           * │ được. Nhưng "Trợ lý KHÔNG gắn MCP" là luật cứng: MCP phá prompt   │
           * │ cache khi resume (~36K token/lượt), mà `route()` resume ở mọi tin │
           * │ nhắn. Đổi 36K token/lượt lấy một tiện ích là lỗ nặng.             │
           * │                                                                  │
           * │ Và cái giá của việc bỏ: ĐO ĐƯỢC LÀ BẰNG KHÔNG. Trong lần chạy    │
           * │ lại bài 2, Trợ lý không gọi tool nào — bảng kê tủ tài liệu trong  │
           * │ prefix đã đủ để nó lập kế hoạch đúng.                             │
           * └──────────────────────────────────────────────────────────────────┘
           */
          tools: [],
          allowedTools: [],
          ...(useSession ? {} : { persistSession: false }),
          ...(useSession && this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const m = msg as Record<string, unknown>;
        // CHỈ ghi nhận session id khi đang chạy TRÊN session Assistant. Query
        // one-shot (lập kế hoạch) cũng sinh session_id riêng — ghi đè bằng nó
        // là mất trí nhớ hội thoại.
        if (useSession && typeof m['session_id'] === 'string' && (m['type'] === 'result' || m['subtype'] === 'init')) {
          this.sessionId = m['session_id'];
        }
        if (m['type'] === 'result') {
          const u = (m['usage'] ?? {}) as Record<string, number>;
          // Chỉ đo trên session THẬT. Query one-shot (lập kế hoạch) có ngữ cảnh
          // riêng, lấy số của nó là đo nhầm người.
          if (useSession) {
            this.contextTokens = (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0);
          }
          usage = addUsage(usage, {
            input: u['input_tokens'] ?? 0,
            output: u['output_tokens'] ?? 0,
            cacheRead: u['cache_read_input_tokens'] ?? 0,
            cacheWrite: u['cache_creation_input_tokens'] ?? 0,
            costUSD: typeof m['total_cost_usd'] === 'number' ? m['total_cost_usd'] : 0,
            model,
            turns: typeof m['num_turns'] === 'number' ? m['num_turns'] : 0,
          });
          text = typeof m['result'] === 'string' ? m['result'] : '';
        }
      }
    } catch (err) {
      throw new RunError(err instanceof Error ? err.message : String(err), classifyError(err), {
        cause: err,
      });
    }

    return { text, usage };
  }
}

function clampStep(step: number, count: number): number {
  return Math.max(0, Math.min(step, Math.max(0, count - 1)));
}

export function newPlanId(): string {
  return `P-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function extractJson<T>(text: string, schema: z.ZodType<T>): T | undefined {
  const candidates: string[] = [];
  for (const m of [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)].reverse()) {
    if (m[1]) candidates.push(m[1]);
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const raw of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw.trim()));
      if (parsed.success) return parsed.data;
    } catch {
      /* thử ứng viên tiếp theo */
    }
  }
  return undefined;
}

/** Dùng khi ghi log — đảm bảo không bao giờ đổ nguyên transcript vào file log nhỏ. */
export function briefText(s: string): string {
  return truncateToTokens(s.replace(/\s+/g, ' ').trim(), 200);
}
