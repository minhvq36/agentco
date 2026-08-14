/**
 * Master — giám đốc. Session dài, đối thoại với người, lập kế hoạch.
 *
 * → docs/SPEC-2026-08-14-agentco.md §2, §8
 *
 * Master KHÔNG tự làm việc tay chân, KHÔNG đọc file lớn, KHÔNG đọc transcript
 * thô của worker. Nó chỉ thấy: pitch của các vai trò, và receipt.
 *
 * Master KHÔNG gắn MCP: nó resume liên tục, mà MCP phá prompt cache khi resume
 * (issue #247) → mất ~36.000 token quy đổi mỗi lượt. Việc vặt cần MCP đi qua
 * role `concierge` (M1).
 */

import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { LoadedCompany } from './config.js';
import { addUsage } from './worker.js';
import {
  EMPTY_USAGE,
  RunError,
  TaskBriefSchema,
  type Plan,
  type PlanStep,
  type Receipt,
  type Usage,
} from './types.js';
import { classifyError } from './worker.js';
import { truncateToTokens } from './tokens.js';

const MASTER_CORE = `You are the director of a small virtual company. You do NOT do the work yourself — you break a request into tasks and assign them to employees.

## Non-negotiable rules

1. You never read or write project files yourself. Employees do that.
2. When you assign a task, you pass FILE PATHS, never file contents. Employees read their own inputs.
3. You only ever see an employee's short receipt, never their working notes.
4. Prefer FEWER, BIGGER tasks. Every task carries a large fixed overhead, so splitting work into many small tasks wastes money. Split only when two tasks can genuinely run at the same time, or when they need different employees.
5. Write goals that can be done in ONE pass. Each extra step an employee takes re-sends their whole context, so a vague goal is an expensive goal. Put every decision the employee needs — tone, length, audience, format — into \`constraints\` so they never have to go looking or guess.
6. Never make an employee "review and then fix". That is two passes. Either ask for the work, or ask for a review — not both in one goal.

## Planning output

When asked to plan, reply with exactly one JSON object in a \`\`\`json block, nothing else:

\`\`\`json
{
  "steps": ["Tìm hiểu yêu cầu", "Viết nội dung"],
  "tasks": [
    {
      "task_id": "T-01",
      "role": "<employee id>",
      "goal": "<one clear sentence, in the user's language>",
      "inputs": [{"path": "artifacts/T-00/notes.md"}],
      "outputs": [{"path": "artifacts/T-01/result.md"}],
      "constraints": ["..."],
      "deps": [],
      "step": 0
    }
  ]
}
\`\`\`

- \`steps\`: AT MOST 6. Each at most 10 words, in the user's language, written for a non-technical reader. This is what the user sees.
- \`tasks\`: the actual work. \`step\` is the index into \`steps\`.
- \`deps\`: task_ids that must finish first. Leave empty when tasks can run in parallel — parallel is good.
- \`outputs\`: every task must write at least one file under \`artifacts/<task_id>/\`. Two tasks must NEVER write the same path.
- Only use employee ids from the roster you were given.`;

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

export interface MasterResult<T> {
  value: T;
  usage: Usage;
}

const RouteSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('chat'), say: z.string().min(1) }),
  z.object({ intent: z.literal('ask'), say: z.string().min(1) }),
  z.object({ intent: z.literal('task'), request: z.string().min(1) }),
]);
export type RouteDecision = z.infer<typeof RouteSchema>;

export class Master {
  private sessionId: string | undefined;

  constructor(private readonly company: LoadedCompany) {}

  get session(): string | undefined {
    return this.sessionId;
  }

  resumeFrom(sessionId: string | undefined): void {
    this.sessionId = sessionId;
  }

  /** Danh bạ nhân viên — chỉ pitch, KHÔNG kèm skills. Đây là lý do kế hoạch rẻ. */
  private roster(): string {
    const lines = [...this.company.roles.values()].map(
      (r) =>
        `- ${r.id} (${r.display_name || r.id}): ${r.pitch}` +
        (r.not_for.length ? ` [không làm: ${r.not_for.join(', ')}]` : ''),
    );
    return `# Employees you can assign to\n\n${lines.join('\n')}`;
  }

  private systemPrompt(): string[] {
    const blocks = [MASTER_CORE, this.roster()];
    if (this.company.charter) blocks.push(`# About this company\n\n${this.company.charter}`);
    return [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY];
  }

  /**
   * Lập kế hoạch — chạy ở query ONE-SHOT RIÊNG, KHÔNG nằm trong session master.
   *
   * Lý do: prompt cache đánh theo (model, prefix). Nếu bước này chạy trên
   * session master bằng một model khác (ví dụ Opus cho chất lượng) thì MỖI LẦN
   * đổi model là miss toàn bộ ngữ cảnh master — đúng cái ~36.000 token quy đổi
   * đã cảnh báo ở vụ MCP. Tách ra thì đặt `models.planner: deep` thoải mái mà
   * session master vẫn ấm nguyên.
   */
  async plan(request: string): Promise<MasterResult<Plan>> {
    const { text, usage } = await this.askOneShot(
      `Lập kế hoạch cho yêu cầu sau. Trả về đúng một object JSON như đã quy định.\n\nYêu cầu: ${request}`,
      this.company.config.models[this.company.config.models.planner],
    );

    const parsed = extractJson(text, PlanOutputSchema);
    if (!parsed) {
      throw new RunError(
        'Giám đốc chưa hiểu đủ rõ để chia việc. Thử nói cụ thể hơn: làm gì, cho ai, và cần kết quả dạng nào.',
        'other',
      );
    }

    const steps: PlanStep[] = parsed.steps.map((title) => ({ title, status: 'pending' }));
    const tasks = parsed.tasks.map((t) =>
      TaskBriefSchema.parse({
        ...t,
        inputs: t.inputs.map((i) => ({ kind: 'file' as const, path: i.path })),
        outputs: t.outputs.map((o) => ({ kind: 'file' as const, path: o.path })),
        step: Math.min(t.step, steps.length - 1),
      }),
    );

    return { value: { plan_id: `P-${Date.now().toString(36)}`, request, steps, tasks }, usage };
  }

  /**
   * Tổng kết sau khi DAG chạy xong. Chạy TRÊN session master — đây cũng là
   * cách kế hoạch (vốn lập ở query riêng) được ghi vào trí nhớ hội thoại,
   * ở dạng nén, để lần sau người dùng hỏi "sao lại làm thế" thì master biết.
   */
  async report(steps: readonly { title: string }[], receipts: Receipt[]): Promise<MasterResult<string>> {
    const plan = steps.map((s, i) => `${i + 1}. ${s.title}`).join(' · ');
    const summary = receipts
      .map((r) => `- [${r.status}] ${r.role}: ${r.say}${r.artifacts.length ? ` → ${r.artifacts.join(', ')}` : ''}`)
      .join('\n');

    const { text, usage } = await this.askSession(
      `Kế hoạch vừa chạy: ${plan}\n\nKết quả:\n${summary}\n\n` +
        `Viết 1–3 câu tiếng Việt báo cáo cho người dùng: đã xong gì, có gì cần họ để ý. ` +
        `Không liệt kê lại từng việc. Không dùng thuật ngữ kỹ thuật. Chỉ trả về văn bản, không JSON.`,
    );
    return { value: text.trim(), usage };
  }

  /**
   * Quyết định người dùng vừa nói gì: trò chuyện, hỏi thêm, hay giao việc.
   *
   * Chạy TRÊN session master (rẻ: ngữ cảnh master chỉ có roster + charter, đã
   * cache) nên nó nhớ cả cuộc hội thoại. "Chào" không được biến thành một
   * kế hoạch DAG — đó là lỗi người dùng gặp ngay thao tác đầu tiên.
   *
   * `ask` là trường hợp đáng giá nhất: yêu cầu mơ hồ thì HỎI LẠI thay vì lập
   * kế hoạch sai rồi đốt tiền. Đây đúng là nỗi đau gốc của sản phẩm —
   * người ngoại đạo hoang mang không biết AI đang dắt mình đi đâu.
   */
  async route(message: string): Promise<MasterResult<RouteDecision>> {
    const { text, usage } = await this.askSession(
      `Người dùng vừa nhắn: "${message}"\n\n` +
        `Trả về đúng một object JSON, không có gì khác:\n` +
        `{"intent":"chat","say":"<trả lời ngắn bằng tiếng Việt>"}\n` +
        `  dùng khi: chào hỏi, cảm ơn, hỏi về công ty, hỏi về việc đã làm, nói chuyện phiếm.\n` +
        `{"intent":"ask","say":"<một câu hỏi làm rõ, tiếng Việt>"}\n` +
        `  dùng khi: có vẻ là yêu cầu công việc NHƯNG thiếu thông tin quan trọng ` +
        `(làm cho ai, dài bao nhiêu, giọng thế nào, dựa trên tài liệu nào). ` +
        `Hỏi MỘT câu quan trọng nhất thôi. Thà hỏi còn hơn đoán sai rồi làm lại.\n` +
        `{"intent":"task","request":"<viết lại yêu cầu thành một câu rõ ràng, đủ ngữ cảnh>"}\n` +
        `  dùng khi: đã đủ rõ để giao cho đội.`,
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
  async chat(message: string): Promise<MasterResult<string>> {
    const { text, usage } = await this.askSession(
      `${message}\n\n(Trả lời ngắn gọn bằng tiếng Việt. Nếu đây là một yêu cầu công việc cần giao cho đội, ` +
        `nói rõ bạn sẽ lập kế hoạch chứ đừng tự làm.)`,
    );
    return { value: text.trim(), usage };
  }

  // ── nội bộ

  /** Trên session master. Model CỐ ĐỊNH — không bao giờ đổi giữa ca. */
  private askSession(prompt: string): Promise<{ text: string; usage: Usage }> {
    const cfg = this.company.config;
    return this.run(prompt, cfg.models[cfg.models.master], true);
  }

  /** Query độc lập, không đụng session master. Đổi model ở đây là an toàn. */
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
          cwd: this.company.dir,
          maxTurns: 4,
          settingSources: [],
          strictMcpConfig: true,
          // Master KHÔNG có tool: nó không tự làm việc tay chân. Đây vừa là kỷ
          // luật kiến trúc vừa là tiết kiệm — không tool thì không có vòng lặp tool.
          allowedTools: [],
          ...(useSession ? {} : { persistSession: false }),
          ...(useSession && this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const m = msg as Record<string, unknown>;
        // CHỈ ghi nhận session id khi đang chạy TRÊN session master. Query
        // one-shot (lập kế hoạch) cũng sinh ra session_id riêng — ghi đè bằng
        // nó là mất trí nhớ hội thoại của master.
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
