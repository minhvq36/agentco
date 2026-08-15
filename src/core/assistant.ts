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

import { query } from '@anthropic-ai/claude-agent-sdk';
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

  /** Sau khi nạp lại văn phòng từ đĩa. Giữ nguyên session. */
  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  setHotKnowledge(text: string): void {
    this.hotKnowledge = text.trim();
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

  /** Vai trò Assistant thật sự thấy. Scheduler dùng đúng danh sách này để validate. */
  assignableRoles(): Set<string> {
    const all = new Set(this.office.roles.keys());
    if (!this.assignable) return all;
    return new Set([...all].filter((id) => this.assignable!.has(id)));
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

  private systemPrompt(): string[] {
    const built = buildAssistantPrompt(this.office, {
      roster: this.roster(),
      hotKnowledge: this.hotKnowledge,
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
    const tasks = rawTasks.map((t) =>
      TaskBriefSchema.parse({
        ...t,
        inputs: t.inputs.map((i) => ({ kind: 'file' as const, path: i.path })),
        outputs: t.outputs.map((o) => ({ kind: 'file' as const, path: o.path })),
        step: remap.get(t.step) ?? 0,
      }),
    );

    return { value: { plan_id: newPlanId(), request, steps, tasks }, usage };
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

    const { text, usage } = await this.askSession(
      `Kế hoạch vừa chạy: ${plan}\n\nKết quả:\n${summary}\n\n` +
        `Trả về đúng một object JSON trong khối \`\`\`json:\n` +
        `{"say":"<1–3 câu tiếng Việt báo cáo cho người dùng: đã xong gì, có gì cần họ để ý. ` +
        `Không liệt kê lại từng việc, không dùng thuật ngữ kỹ thuật>",\n` +
        ` "lessons":[{"kind":"pitfall","text":"<bài học dùng lại được cho VĂN PHÒNG này, dưới 25 từ>"}]}\n\n` +
        `\`lessons\` tối đa 2, và ĐỂ TRỐNG nếu ca này không rút ra được gì đáng nhớ. ` +
        `"Việc chạy trơn tru" không phải bài học.`,
    );

    const parsed = extractJson(text, ReportSchema);
    // Không đọc được thì vẫn phải có câu báo cáo — người dùng đang chờ.
    const value = parsed ?? { say: text.trim() || 'Đã xong.', lessons: [] };
    return { value, usage };
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

  /** Trên session Assistant. Model CỐ ĐỊNH — không bao giờ đổi giữa ca. */
  private askSession(prompt: string): Promise<{ text: string; usage: Usage }> {
    const models = this.office.company.models;
    return this.run(prompt, models[models.master], true);
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
        prompt,
        options: {
          systemPrompt: this.systemPrompt(),
          model,
          cwd: this.office.dir,
          maxTurns: 4,
          settingSources: [],
          strictMcpConfig: true,
          // Assistant KHÔNG có tool: nó không tự làm việc tay chân. Đây vừa là kỷ
          // luật kiến trúc vừa là tiết kiệm — không tool thì không có vòng lặp tool.
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
