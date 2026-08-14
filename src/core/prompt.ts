/**
 * Phân tầng prompt + cache key. ĐÂY LÀ TRÁI TIM CỦA KIẾN TRÚC CHI PHÍ.
 *
 * → docs/SPEC-token-economy.md §2
 *
 *   ┌─ ĐÓNG BĂNG — cache cross-session ────────────────┐
 *   │ L0  CORE (bất biến, không sửa được)              │
 *   │ L1  Role card                                    │
 *   │ L2  User skills (sửa được)                       │
 *   │ L3  Charter công ty (pinned)                     │
 *   │ L4  HOT knowledge                                │
 *   └────── ◄── SYSTEM_PROMPT_DYNAMIC_BOUNDARY ────────┘
 *   ┌─ BIẾN ĐỘNG — trả giá đầy đủ, phải nhỏ ───────────┐
 *   │ L5  COLD knowledge  ┐ nằm trong user message,    │
 *   │ L6  TaskBrief       ┘ không nằm trong systemPrompt│
 *   └──────────────────────────────────────────────────┘
 */

import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedCompany } from './config.js';
import { loadSkill } from './config.js';
import type { Role, TaskBrief } from './types.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

/** Bump khi CORE_PROMPT hoặc cách dựng prompt thay đổi. Đi vào cacheKey. */
export const PROMPT_SCHEMA_VERSION = 1;

/**
 * L0 — LỚP CORE. Người dùng KHÔNG sửa được.
 *
 * Ranh giới core/user (SPEC §3): thứ gì đang thi hành một bất biến trong
 * SPEC-token-economy.md thì là core. Cho sửa không phải trao tự do —
 * là trao cái bẫy: gỡ mất Receipt thì kiến trúc chi phí sụp, rồi người dùng
 * đổ lỗi cho sản phẩm chứ không cho bản sửa của họ.
 *
 * CỐ Ý viết bằng tiếng Anh: khối này nằm trong prefix của MỌI agent, và
 * tiếng Việt có dấu tốn nhiều token hơn đáng kể (~2.6 vs ~4 char/token).
 * Phần người dùng đọc và sửa (skills, charter) thì viết tiếng Việt thoải mái.
 */
const CORE_PROMPT = `You are an employee of a small virtual company. You do one assigned task, then stop.

## How you work

1. Read only what you need. Prefer targeted reads (Grep/Glob) over reading whole files.
2. Do the work.
3. Write every substantial output to the files listed in "outputs". Never paste file contents back in your reply.
4. Finish by emitting your receipt (below). Nothing after it.

## Your receipt — the only thing your manager sees

Your final message MUST be exactly one JSON object inside a \`\`\`json fenced block, and nothing else:

\`\`\`json
{
  "status": "done",
  "say": "one short sentence, plain human language",
  "artifacts": ["relative/path/you/wrote.md"],
  "lessons": [{"kind": "pitfall", "text": "..."}],
  "blocked_on": null
}
\`\`\`

- \`status\`: "done" | "failed" | "blocked" | "needs_human"
- \`say\`: ONE sentence a non-technical person understands. No file paths, no tool names, no jargon. This is shown directly in the UI.
- \`artifacts\`: paths you actually wrote, relative to the company directory.
- \`lessons\`: OPTIONAL, at most 2. Only durable insights worth reusing on future tasks — not "the task went fine". Each under 25 words.
- \`blocked_on\`: short reason if status is "blocked" or "needs_human", otherwise null.

Hard rules:
- The whole JSON object must stay under 500 words. Your manager never sees anything else you wrote, so put results in files, not in the receipt.
- Never invent an artifact path you did not write.
- If you cannot finish, return status "failed" or "blocked" with an honest \`say\`. A truthful failure is worth more than a fabricated success.
- Stay inside the company directory. Never write outside it.`;

export interface BuiltPrompt {
  /** Truyền vào Options.systemPrompt của SDK. */
  systemPrompt: string[] | { type: 'preset'; preset: 'claude_code'; append: string; excludeDynamicSections: true };
  /**
   * Khoá cache. Băm chính NỘI DUNG tĩnh — mạnh hơn tuple
   * (software_version, role_id, role_version, knowledge_version) trong spec,
   * vì nội dung giống nhau thì chắc chắn cùng cache entry, khác thì chắc chắn khác.
   * Không thể sai do quên bump version.
   */
  cacheKey: string;
  /** Token ước lượng của phần tĩnh — để cảnh báo prefix phình. */
  staticTokens: number;
}

export interface BuildPromptOpts {
  /** Nội dung các node tri thức HOT (đã chọn sẵn, nằm TRONG prefix cache). */
  hotKnowledge?: string;
  /** Ngôn ngữ cho trường `say`. Mặc định tiếng Việt. */
  language?: string;
}

export function buildWorkerPrompt(
  company: LoadedCompany,
  role: Role,
  opts: BuildPromptOpts = {},
): BuiltPrompt {
  const language = opts.language ?? 'Vietnamese';

  const roleCard = [
    `# Your role: ${role.display_name || role.id}`,
    role.pitch,
    role.good_at.length ? `Good at: ${role.good_at.join(', ')}` : '',
    role.not_for.length ? `Not your job: ${role.not_for.join(', ')}` : '',
    `\nWrite the \`say\` field in ${language}.`,
  ]
    .filter(Boolean)
    .join('\n');

  const skills = loadSkill(company, role);
  const charter = company.charter;
  const hot = opts.hotKnowledge?.trim() ?? '';

  const blocks: string[] = [CORE_PROMPT, roleCard];
  if (skills) blocks.push(`# Your working instructions\n\n${skills}`);
  if (charter) blocks.push(`# About this company\n\n${charter}`);
  if (hot) blocks.push(`# What the company has learned\n\n${hot}`);

  const staticTokens = blocks.reduce((n, b) => n + estimateTokens(b), 0);

  if (role.use_preset) {
    // Preset của Claude Code: đắt hơn ~6.300 token/call (FINDINGS §2a).
    // Chỉ dùng cho role thật sự cần hướng dẫn viết code.
    // excludeDynamicSections: bỏ cwd/auto-memory/git status khỏi system prompt
    // để prefix đứng yên giữa các máy và các phiên.
    const append = blocks.join('\n\n---\n\n');
    return {
      systemPrompt: { type: 'preset', preset: 'claude_code', append, excludeDynamicSections: true },
      cacheKey: hashKey(['preset', String(PROMPT_SCHEMA_VERSION), append]),
      staticTokens,
    };
  }

  // Marker phải là MỘT PHẦN TỬ RIÊNG của mảng. Mọi block trước nó được
  // cache cross-session; sau nó thì không. Không có marker = không opt-in
  // vào global cache scope.
  return {
    systemPrompt: [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    cacheKey: hashKey([String(PROMPT_SCHEMA_VERSION), ...blocks]),
    staticTokens,
  };
}

/**
 * Phần BIẾN ĐỘNG: brief + tri thức COLD. Nằm trong user message, không nằm
 * trong systemPrompt, nên không đụng tới cache prefix.
 *
 * BẤT BIẾN: chỉ đưa ĐƯỜNG DẪN của input, tuyệt đối không đưa nội dung file.
 */
export function buildTaskMessage(
  brief: TaskBrief,
  coldKnowledge: string,
  maxBriefTokens: number,
): string {
  const parts: string[] = [];

  if (coldKnowledge.trim()) {
    parts.push(`# Relevant notes\n\n${coldKnowledge.trim()}`);
  }

  parts.push(`# Your task (${brief.task_id})\n\n${brief.goal}`);

  if (brief.inputs.length) {
    parts.push(
      `## Inputs — read these files yourself\n${brief.inputs.map((i) => `- ${i.path}`).join('\n')}`,
    );
  }
  if (brief.outputs.length) {
    parts.push(
      `## Outputs — you MUST write these files\n${brief.outputs.map((o) => `- ${o.path}`).join('\n')}`,
    );
  }
  if (brief.constraints.length) {
    parts.push(`## Constraints\n${brief.constraints.map((c) => `- ${c}`).join('\n')}`);
  }

  parts.push('When done, emit your receipt as specified. Nothing after it.');

  return truncateToTokens(parts.join('\n\n'), maxBriefTokens);
}

function hashKey(parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update(' ');
  }
  return h.digest('hex').slice(0, 16);
}
