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

  async plan(request: string): Promise<MasterResult<Plan>> {
    const { text, usage } = await this.ask(
      `Lập kế hoạch cho yêu cầu sau. Trả về đúng một object JSON như đã quy định.\n\nYêu cầu: ${request}`,
      'plan',
    );

    const parsed = extractJson(text, PlanOutputSchema);
    if (!parsed) {
      throw new RunError('Giám đốc không lập được kế hoạch đọc hiểu được.', 'other');
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

  /** Tổng kết sau khi DAG chạy xong. Chỉ nhận receipt, không nhận transcript. */
  async report(receipts: Receipt[]): Promise<MasterResult<string>> {
    const summary = receipts
      .map((r) => `- [${r.status}] ${r.role}: ${r.say}${r.artifacts.length ? ` → ${r.artifacts.join(', ')}` : ''}`)
      .join('\n');

    const { text, usage } = await this.ask(
      `Đội đã làm xong. Kết quả:\n\n${summary}\n\n` +
        `Viết 1–3 câu tiếng Việt báo cáo cho người dùng: đã xong gì, có gì cần họ để ý. ` +
        `Không liệt kê lại từng việc. Không dùng thuật ngữ kỹ thuật. Chỉ trả về văn bản, không JSON.`,
      'report',
    );
    return { value: text.trim(), usage };
  }

  /** Trò chuyện thường — không lập kế hoạch. */
  async chat(message: string): Promise<MasterResult<string>> {
    const { text, usage } = await this.ask(
      `${message}\n\n(Trả lời ngắn gọn bằng tiếng Việt. Nếu đây là một yêu cầu công việc cần giao cho đội, ` +
        `nói rõ bạn sẽ lập kế hoạch chứ đừng tự làm.)`,
      'chat',
    );
    return { value: text.trim(), usage };
  }

  // ── nội bộ

  private async ask(prompt: string, step: string): Promise<{ text: string; usage: Usage }> {
    const cfg = this.company.config;
    const tier = cfg.models.master_deep_steps.includes(step) ? 'deep' : cfg.models.master;

    let usage: Usage = { ...EMPTY_USAGE };
    let text = '';

    try {
      for await (const msg of query({
        prompt,
        options: {
          systemPrompt: this.systemPrompt(),
          model: cfg.models[tier],
          cwd: this.company.dir,
          maxTurns: 6,
          settingSources: [],
          strictMcpConfig: true,
          // Master KHÔNG có tool: nó không tự làm việc tay chân. Đây vừa là kỷ
          // luật kiến trúc vừa là tiết kiệm — không tool thì không có vòng lặp tool.
          allowedTools: [],
          ...(this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const m = msg as Record<string, unknown>;
        if (m['type'] === 'system' && m['subtype'] === 'init' && typeof m['session_id'] === 'string') {
          this.sessionId = m['session_id'];
        }
        if (m['type'] === 'result') {
          if (typeof m['session_id'] === 'string') this.sessionId = m['session_id'];
          const u = (m['usage'] ?? {}) as Record<string, number>;
          usage = addUsage(usage, {
            input: u['input_tokens'] ?? 0,
            output: u['output_tokens'] ?? 0,
            cacheRead: u['cache_read_input_tokens'] ?? 0,
            cacheWrite: u['cache_creation_input_tokens'] ?? 0,
            costUSD: typeof m['total_cost_usd'] === 'number' ? m['total_cost_usd'] : 0,
            model: cfg.models[tier],
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
