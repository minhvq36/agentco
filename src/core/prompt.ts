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

import type { LoadedOffice } from './config.js';
import { loadSkill, skillFileFor } from './config.js';
import type { Role, TaskBrief } from './types.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

/**
 * Bump khi CORE_PROMPT hoặc cách dựng prompt thay đổi. Đi vào cacheKey.
 *
 * v3 (16/08/2026): thêm `Options.tools` để CẮT THẬT bộ tool, không chỉ tự-duyệt
 * bằng `allowedTools`. Định nghĩa tool đứng TRƯỚC system prompt trong prefix
 * được cache, nên bộ tool đổi = prefix đổi — phải bump, nếu không priming gate
 * tưởng cache còn ấm trong khi nó đã nguội. → worker.ts
 */
export const PROMPT_SCHEMA_VERSION = 3;

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
export const CORE_PROMPT = `You are an employee of a small virtual company. You do one assigned task, then stop.

## How you work

1. Read only what you need. Prefer targeted reads (Grep/Glob) over reading whole files.
2. Do the work.
3. Write every substantial output to the files listed in "outputs". Never paste file contents back in your reply.
4. Finish by emitting your receipt (below). Nothing after it.

## Step discipline — this matters as much as the work itself

Every step you take re-sends your whole context. Ten steps cost ten times one step.
A careful worker who finishes in 3 steps beats a thorough one who takes 9.

- **Read each file at most once.** You already have it; do not read it again.
- **Never read back a file you just wrote** to check it saved. It saved.
- **Do not explore.** Open exactly the files listed in your inputs. Do not list directories, do not go looking for related files, do not check whether output folders exist — they do.
- **Batch your reads.** If you need three files, request all three in one step, not one at a time.
- **Do not re-plan out loud.** Think, then act. Narrating your plan before each step costs a step.
- Write your output in **one** Write call. Do not draft then revise unless the first attempt was actually wrong.

If you genuinely cannot finish within your step budget, stop and return status "blocked" explaining what you still needed. That is cheaper and more honest than flailing.

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
- Stay inside the office directory. Never write outside it.

## What you already have

Relevant notes from the office knowledge base are already in your prompt — selected for you before you started. Do not go looking for a knowledge folder; there is nothing there you have not been given.`;

/**
 * L0 của ASSISTANT — lớp core, người dùng không sửa được (mặc định) nhưng
 * LUÔN XEM ĐƯỢC. → docs/SPEC-offices.md §4.1
 *
 * Đây là "quy cách kết nối": cách Assistant nói chuyện với nhân viên, giao thức
 * Receipt, và luật chia việc. Nó thuộc về mã nguồn, không thuộc về việc vận hành
 * doanh nghiệp — người dùng điều hành công ty của họ, họ không sửa giao thức.
 *
 * Cũng viết bằng tiếng Anh vì cùng lý do như CORE_PROMPT: khối này nằm trong
 * prefix của mọi lượt trò chuyện, và tiếng Việt có dấu tốn nhiều token hơn đáng kể.
 */
export const ASSISTANT_CORE = `You are the assistant running one office of a small virtual company. You talk to the human, and you assign work to the office's employees. You do NOT do the work yourself.

## Non-negotiable rules

1. You never read or write project files yourself. Employees do that.
2. When you assign a task, you pass FILE PATHS, never file contents. Employees read their own inputs.
3. You only ever see an employee's short receipt, never their working notes.
4. Prefer FEWER, BIGGER tasks. Every task carries a large fixed overhead, so splitting work into many small tasks wastes money. Split only when two tasks can genuinely run at the same time, or when they need different employees.
5. Write goals that can be done in ONE pass. Each extra step an employee takes re-sends their whole context, so a vague goal is an expensive goal. Put every decision the employee needs — tone, length, audience, format — into \`constraints\` so they never have to go looking or guess.
6. Never make an employee "review and then fix". That is two passes. Either ask for the work, or ask for a review — not both in one goal.
7. You may only assign to employees listed in your roster. If nobody fits, say so plainly instead of inventing an employee.

## Knowledge

Notes from this office's knowledge base are already in your prompt. When a run finishes you may record what the office learned — durable insights only, never "the task went fine".

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
- **Every step must have at least one task pointing at it.** Do not write a step for something an employee already does inside another task — "save the result to a file" is part of writing it, not a step of its own. A step nobody works on is a step the user watches never finish.
- \`tasks\`: the actual work. \`step\` is the index into \`steps\`.
- \`deps\`: task_ids that must finish first. Leave empty when tasks can run in parallel — parallel is good.
- \`outputs\`: every task must write at least one file under \`artifacts/<task_id>/\`. Two tasks must NEVER write the same path.
- Only use employee ids from the roster you were given.`;

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
  /**
   * Model sẽ chạy. BẮT BUỘC đưa vào cacheKey: prompt cache đánh theo
   * (model, prefix) — hai vai trò prompt giống hệt nhau nhưng khác model thì
   * KHÔNG dùng chung cache. Thiếu nó thì priming gate tưởng cache đã ấm
   * trong khi thực ra chưa, và ta trả cache_write mà cứ nghĩ là đang tiết kiệm.
   */
  model?: string;
}

export function buildWorkerPrompt(
  office: LoadedOffice,
  role: Role,
  opts: BuildPromptOpts = {},
): BuiltPrompt {
  const language = opts.language ?? 'Vietnamese';
  const model = opts.model ?? office.company.models[role.model_tier];

  const roleCard = [
    `# Your role: ${role.display_name || role.id}`,
    role.pitch,
    role.good_at.length ? `Good at: ${role.good_at.join(', ')}` : '',
    role.not_for.length ? `Not your job: ${role.not_for.join(', ')}` : '',
    `\nWrite the \`say\` field in ${language}.`,
  ]
    .filter(Boolean)
    .join('\n');

  const skills = loadSkill(office, role);
  const charter = office.charter;
  const hot = opts.hotKnowledge?.trim() ?? '';

  const blocks: string[] = [CORE_PROMPT, roleCard];
  if (skills) blocks.push(`# Your working instructions\n\n${skills}`);
  if (charter) blocks.push(`# About this office\n\n${charter}`);
  if (hot) blocks.push(`# What this office has learned\n\n${hot}`);

  const staticTokens = blocks.reduce((n, b) => n + estimateTokens(b), 0);

  /**
   * tools/MCP KHÔNG nằm trong systemPrompt, nhưng định nghĩa tool đứng TRƯỚC
   * system prompt trong prefix mà Anthropic đánh cache. Đổi tool = đổi prefix.
   *
   * Thiếu chúng ở đây là đúng con bug đã sửa cho `model`: cache priming gate
   * tưởng cache ấm trong khi chưa, rồi ta trả cache_write mà cứ nghĩ đang
   * tiết kiệm. Canvas cho phép cắm MCP bằng chuột nên bug này sẽ gặp thật.
   */
  const toolKey = `tools:${[...role.tools].sort().join(',')}|mcp:${[...role.mcp].sort().join(',')}`;

  if (role.use_preset) {
    // Preset của Claude Code: đắt hơn ~6.300 token/call (FINDINGS §2a).
    // Chỉ dùng cho role thật sự cần hướng dẫn viết code.
    // excludeDynamicSections: bỏ cwd/auto-memory/git status khỏi system prompt
    // để prefix đứng yên giữa các máy và các phiên.
    const append = blocks.join('\n\n---\n\n');
    return {
      systemPrompt: { type: 'preset', preset: 'claude_code', append, excludeDynamicSections: true },
      cacheKey: hashKey(['preset', model, String(PROMPT_SCHEMA_VERSION), toolKey, append]),
      staticTokens,
    };
  }

  // Marker phải là MỘT PHẦN TỬ RIÊNG của mảng. Mọi block trước nó được
  // cache cross-session; sau nó thì không. Không có marker = không opt-in
  // vào global cache scope.
  return {
    systemPrompt: [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    cacheKey: hashKey([model, String(PROMPT_SCHEMA_VERSION), toolKey, ...blocks]),
    staticTokens,
  };
}

/**
 * Prompt của Assistant. Cùng cấu trúc phân tầng với worker, cùng cache breakpoint.
 *
 * Thứ tự CÓ CHỦ Ý — ổn định nhất lên trước, hay đổi nhất xuống sau, để một thay
 * đổi nhỏ không vứt toàn bộ prefix:
 *
 *   ASSISTANT_CORE   đổi khi nâng phần mềm
 *   charter          đổi hiếm
 *   skills           đổi khi người dùng bấm Lưu
 *   HOT knowledge    đổi khi bump knowledge_version
 *   roster           đổi khi kéo dây trên canvas   ← hay đổi nhất, để cuối
 */
export function buildAssistantPrompt(
  office: LoadedOffice,
  opts: {
    roster: string;
    hotKnowledge?: string;
    /** Bản nén trí nhớ hội thoại. Khối RIÊNG, không trộn vào hot. */
    memory?: string;
    language?: string;
    model?: string;
  },
): BuiltPrompt {
  const language = opts.language ?? 'Vietnamese';
  const hot = opts.hotKnowledge?.trim() ?? '';
  const memory = opts.memory?.trim() ?? '';

  const blocks: string[] = [ASSISTANT_CORE];
  if (office.charter) blocks.push(`# About this office\n\n${office.charter}`);
  if (office.assistantSkills) blocks.push(`# How you work\n\n${office.assistantSkills}`);
  // GHI NHỚ đứng TRƯỚC kinh nghiệm, và là khối riêng: nó là thứ người dùng đã
  // chốt, nên phải thắng khi mâu thuẫn với một bài học agent tự rút ra.
  if (memory) blocks.push(`# What the human has decided — follow these\n\n${memory}`);
  if (hot) blocks.push(`# What this office has learned\n\n${hot}`);
  blocks.push(opts.roster);
  blocks.push(`Always speak to the human in ${language}.`);

  return {
    systemPrompt: [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    // `model` BẮT BUỘC nằm trong khoá: prompt cache đánh theo (model, prefix).
    // Đổi model của Trợ lý mà khoá không đổi thì mọi công cụ chẩn đoán sẽ báo
    // "cache vẫn ấm" trong khi thực tế lượt kế tiếp trả nguyên giá ghi cache.
    cacheKey: hashKey(['assistant', opts.model ?? '', String(PROMPT_SCHEMA_VERSION), ...blocks]),
    staticTokens: blocks.reduce((n, b) => n + estimateTokens(b), 0),
  };
}

/** Một lớp prompt như UI hiển thị nó. → SPEC-offices.md §8 `/api/office/:id/prompt/:who` */
export interface PromptLayer {
  id: string;
  title: string;
  /** Sửa được không. Lớp core luôn false trừ khi bật allow_core_prompt_edit. */
  editable: boolean;
  /** File chứa nó, nếu sửa được. */
  file?: string;
  text: string;
  tokens: number;
  /**
   * Chữ mờ trong ô nhập khi lớp này TRỐNG — một ví dụ THẬT về nội dung nên viết.
   *
   * Đây là chỗ đúng cho ví dụ, và lý do rất cụ thể: nội dung mặc định của file
   * đi vào prefix cache của mọi lượt gọi, nên một dòng hướng dẫn kiểu "hãy viết
   * vài dòng về văn phòng này" là khoản thuế thu mãi mãi để nói với MODEL một
   * câu chỉ có nghĩa với NGƯỜI. Placeholder không bao giờ được lưu, không bao
   * giờ đi vào prompt → 0 token. → SPEC-offices.md §4.1
   */
  placeholder?: string;
  /** Trần token của lớp này, nếu có. UI cảnh báo khi gõ vượt. */
  limit?: number;
  /** File này là node tri thức (có YAML frontmatter phải giữ nguyên khi ghi). */
  frontmatter?: boolean;
  note: string;
}

/**
 * Bóc prompt thành từng lớp để NGƯỜI XEM ĐƯỢC.
 *
 * Đây không phải tính năng phụ. Người dùng advanced cần *thấy* lớp core mới tin;
 * giấu đi thì họ đoán, và đoán sai thì họ viết skills chống lại chính hệ thống.
 * → SPEC-offices.md §4.1
 */
export function describePrompt(
  office: LoadedOffice,
  who: string,
  hotKnowledge = '',
  assistantMemory = '',
): PromptLayer[] {
  const coreEditable = office.company.allow_core_prompt_edit;
  const layers: PromptLayer[] = [];
  const add = (l: Omit<PromptLayer, 'tokens'>): void => {
    layers.push({ ...l, tokens: estimateTokens(l.text) });
  };

  if (who === 'assistant') {
    add({
      id: 'core',
      title: 'Quy cách kết nối (lõi)',
      editable: coreEditable,
      text: ASSISTANT_CORE,
      note:
        'Cách Trợ lý nói chuyện với nhân viên và giao thức nhận kết quả. Thuộc về mã nguồn, ' +
        'không thuộc về việc vận hành doanh nghiệp. Sửa được sẽ phá kiến trúc chi phí.',
    });
    add({
      id: 'charter',
      title: 'Giới thiệu văn phòng',
      editable: true,
      file: office.config.charter_file,
      frontmatter: true,
      limit: office.company.budgets.charter_tokens,
      text: office.charter,
      placeholder:
        `Văn phòng ${office.config.name} làm nội dung cho khách hàng nhỏ ở Việt Nam.\n` +
        'Người đọc là chủ shop, không phải dân kỹ thuật.\n' +
        'Mọi bài viết đều xưng "mình", không dùng từ Hán Việt nặng.',
      note:
        'Văn phòng này làm gì, cho ai, ràng buộc nào luôn đúng. Mọi NHÂN VIÊN đều đọc, ' +
        'ở mọi task — nên viết sự thật về công việc, đừng viết lời dặn chung chung.',
    });
    add({
      id: 'skills',
      title: 'Kỹ năng — bạn viết',
      editable: true,
      file: 'skills/assistant.md',
      limit: office.company.budgets.assistant_skills_tokens,
      text: office.assistantSkills,
      placeholder:
        '- Xưng "mình", gọi người dùng là "bạn". Nói ngắn, không khách sáo.\n' +
        '- Yêu cầu mơ hồ thì hỏi lại đúng MỘT câu quan trọng nhất.\n' +
        '- Báo cáo bằng lời người thường, không nhắc tên tool hay số token.',
      note:
        'Tính cách, giọng điệu, thói quen của riêng Trợ lý. Để trắng cũng được. Nằm trong ' +
        'prefix của mọi lượt trò chuyện nên mỗi dòng thừa là một khoản thuế thu suốt ca.',
    });
  } else {
    const role = office.roles.get(who);
    if (!role) return [];
    add({
      id: 'core',
      title: 'Quy cách làm việc (lõi)',
      editable: coreEditable,
      text: CORE_PROMPT,
      note:
        'Giao thức Receipt, kỷ luật số lượt, luật ghi ra file thay vì dán nội dung. ' +
        'Đây là thứ giữ cho chi phí không phình.',
    });
    add({
      id: 'skills',
      title: 'Kỹ năng — bạn viết',
      editable: true,
      // ⚠ PHẢI là đúng file mà `loadSkill` sẽ đọc lại. Khai hai đường dẫn khác
      // nhau cho cùng một thứ = bấm Lưu xong nội dung biến mất. → config.ts
      file: skillFileFor(office, role),
      text: loadSkill(office, role),
      placeholder:
        'Ví dụ:\n' +
        '- Luôn viết ở ngôi thứ hai, câu ngắn.\n' +
        '- Mở đầu bằng kết luận, đừng dẫn dắt.\n' +
        '- Không dùng emoji.',
      note:
        'Cách làm việc của riêng vai trò này. Để TRỐNG là bình thường: cắm MCP là ' +
        'agent đã biết nó có thêm cánh tay. Chỉ viết ở đây thứ đúng với MỌI task ' +
        '— tri thức riêng của từng việc thuộc về kho tri thức.',
    });
  }

  /**
   * GHI NHỚ tách khỏi KINH NGHIỆM — cùng một kho, hai cách nhìn.
   * → docs/SPEC-offices.md §4.6
   *
   * Lưu chung `knowledge/` là để dùng lại `supersedes`, lão hoá, ngân sách và
   * Librarian — không phải để tiện. Nhưng với người dùng đây là hai thứ khác
   * hẳn nhau, và gộp làm một dòng thì thứ quan trọng hơn bị lẫn mất:
   *
   *   kinh nghiệm — AGENT tự rút ra sau khi làm  (confidence 0.6)
   *   ghi nhớ     — NGƯỜI DÙNG đã chốt           (confidence 0.9)
   *
   * Người dùng phải tìm thấy được "hệ thống đang nhớ gì về tôi" mà không phải
   * lục kho. Đó là lý do nó là một lớp riêng ở đây, chứ không phải một kho riêng
   * ở tầng lưu trữ.
   */
  if (who === 'assistant' && assistantMemory.trim()) {
    add({
      id: 'memory',
      title: 'Ghi nhớ từ trò chuyện',
      editable: false,
      text: assistantMemory,
      note:
        'Những gì BẠN đã chốt, Trợ lý nén lại mỗi khi dọn cuộc trò chuyện (`/clear`). ' +
        'Sửa hoặc xoá ở ngăn kéo Tri thức — bản mới tự đè bản cũ, bản cũ vẫn còn file.',
    });
  }

  add({
    id: 'knowledge',
    title: 'Kinh nghiệm nạp sẵn',
    editable: false,
    text: hotKnowledge,
    note:
      'Tự động chọn từ kho tri thức bằng code, KHÔNG tốn token. Đây là thứ agent TỰ RÚT RA ' +
      'sau khi làm việc. Sửa ở ngăn kéo Tri thức, không sửa ở đây.',
  });
  return layers;
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
