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
  "answer": "",
  "artifacts": ["relative/path/you/wrote.md"],
  "lessons": [{"kind": "pitfall", "text": "..."}],
  "blocked_on": null
}
\`\`\`

- \`status\`: "done" | "failed" | "blocked" | "needs_human"
- \`say\`: ONE sentence a non-technical person understands. No file paths, no tool names, no jargon. This is shown directly in the UI.
- \`answer\`: normally \`""\`. See "Delivery" below — only tasks marked **deliver: reply** fill this in.
- \`artifacts\`: paths you actually wrote, relative to the company directory.
- \`lessons\`: OPTIONAL, at most 2. See "Lessons" below. Empty is the normal answer.
- \`blocked_on\`: short reason if status is "blocked" or "needs_human", otherwise null.

Hard rules:
- Apart from \`answer\`, the JSON object must stay under 500 words. Your manager never sees anything else you wrote, so put results in files, not in the receipt.
- Never invent an artifact path you did not write.
- If you cannot finish, return status "failed" or "blocked" with an honest \`say\`. A truthful failure is worth more than a fabricated success.
- Stay inside the office directory. Never write outside it.

## Delivery — where your result goes

Your task says **deliver: file** or **deliver: reply**. You always write your output files either way. The difference is what the human reads.

- **deliver: file** — leave \`answer\` as \`""\`. The human opens the file. Do not paste its contents anywhere.
- **deliver: reply** — the human asked a question and wants to READ the answer, not open a document. Put the complete answer in \`answer\`, written directly to them, under 300 words. Still write your output file: it is the record. But \`answer\` is what they actually see, so it must stand alone — no "see the attached file", no file paths.

\`say\` stays one short sentence in both cases. It goes to your manager, not to the human.

## Lessons — method only, never facts

A lesson records **how to work**, never **what is true**. This is a hard line, not a preference.

- ✅ "Return policy lives in library/files/doi-tra.md — grep there before answering"
- ⛔ "Items discounted over 50% cannot be returned"

The second one is already written down in a document the office owns. Copying it into a lesson creates a **second copy that nobody updates**: the day the human edits that policy, the document changes and your lesson does not — and your lesson wins, because it sits in every employee's prompt while the document has to be searched for.

So: never restate document content, never record numbers, thresholds, prices, or dates. Record the path you took, the trap you fell into, the order that worked.

Leave \`lessons\` empty unless this task actually went wrong. A task that went smoothly teaches nothing, and saying so is the correct answer.

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

## Knowledge and documents

Notes from this office's knowledge base are already in your prompt, and so is the list of documents the human uploaded. **You have no tools** — you never open a file yourself. When a task needs a document, name its path in that task's \`inputs\` and let the employee read it.

If a note and a document disagree, **the document wins** — notes are second-hand, documents are the source.

A note must never restate what a document already says. Documents are searched for free when they are needed; a copy of one lives in every employee's prompt forever, and it goes stale the day the human updates the file.

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
      "step": 0,
      "deliver": "file"
    }
  ]
}
\`\`\`

- \`steps\`: AT MOST 6. Each at most 10 words, in the user's language, written for a non-technical reader. This is what the user sees.
- **Every step must have at least one task pointing at it.** Do not write a step for something an employee already does inside another task — "save the result to a file" is part of writing it, not a step of its own. A step nobody works on is a step the user watches never finish.
- \`tasks\`: the actual work. \`step\` is the index into \`steps\`.
- \`deps\`: task_ids that must finish first. Leave empty when tasks can run in parallel — parallel is good.
- \`outputs\`: every task must write at least one file under \`artifacts/<task_id>/\`. Two tasks must NEVER write the same path. This holds for **every** task, including \`deliver: "reply"\` ones.
- Only use employee ids from the roster you were given.

## \`deliver\` — does the human want to KNOW something, or to HAVE something?

This office has a default, stated below. **Follow the default unless this particular request is clearly the other kind** — you are overriding, not deciding fresh each time.

| | the human's next action | examples |
|---|---|---|
| \`"reply"\` | **reads it**, and that is all | answering a customer's question, checking a policy, a short summary, an explanation |
| \`"file"\` | **opens · sends · edits · keeps** it | an article, a report, a table, a script, a contract |

One test that settles most cases: *does the whole result fit in a chat message they read once?*

Both kinds still write their output file. \`deliver\` only decides whether the human reads the answer in the chat or opens the document.`;

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
    /** Bảng kê tủ tài liệu — tên + hình dạng, dựng bằng code. → SPEC-library.md §8b */
    library?: string;
    language?: string;
    model?: string;
  },
): BuiltPrompt {
  const language = opts.language ?? 'Vietnamese';
  const hot = opts.hotKnowledge?.trim() ?? '';
  const memory = opts.memory?.trim() ?? '';
  const library = opts.library?.trim() ?? '';

  const blocks: string[] = [ASSISTANT_CORE];
  /**
   * MẶC ĐỊNH `deliver` của văn phòng — một dòng, nằm ngay sau lớp lõi.
   *
   * Đặt ở đây chứ không nhét vào `ASSISTANT_CORE` vì nó là cấu hình của NGƯỜI
   * DÙNG, còn lớp lõi thuộc về mã nguồn. Và đặt TRƯỚC charter vì nó là luật
   * cứng: charter mô tả văn phòng làm gì, dòng này quyết kết quả rơi xuống đâu.
   *
   * Đây là thứ thay cho lệnh `/answer` đã bị bác bỏ — nó biến một phép đoán
   * lặp lại ở MỖI tin nhắn thành một mặc định đúng sẵn, giá 0 token vì nó nằm
   * trong prefix vốn đã được cache. → SPEC-offices.md §6
   */
  blocks.push(
    `# Default delivery for this office\n\n` +
      `Unless a request is clearly the other kind, every task you create uses \`"deliver": "${office.config.assistant.default_deliver}"\`.`,
  );
  if (office.charter) blocks.push(`# About this office\n\n${office.charter}`);
  if (office.assistantSkills) blocks.push(`# How you work\n\n${office.assistantSkills}`);
  /**
   * Tủ tài liệu đứng TRƯỚC tri thức và roster, sau charter.
   *
   * Thứ tự trong khối chú thích đầu hàm là "ít đổi trước, hay đổi sau", và bảng
   * kê tủ nằm đúng giữa: đổi khi người dùng thêm/bớt tài liệu — hiếm hơn kéo
   * dây trên canvas (roster), thường hơn sửa điều lệ.
   *
   * Đây là mảnh sửa lỗ hổng lớn nhất tìm được ngày 19/08: `INDEX.md` được dựng
   * từ 17/08 để Trợ lý "biết hợp đồng 34 trang trước khi chia việc", nhưng chưa
   * bao giờ tới tay Trợ lý. Nó lập kế hoạch mù, hỏi lại những câu mà câu trả
   * lời không đổi được gì, và để `inputs` rỗng cho nhân viên tự mò.
   */
  if (library) blocks.push(library);
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
  libraryManifest = '',
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
      /**
       * `charter.md` ở gốc văn phòng — markdown THUẦN, KHÔNG frontmatter.
       *
       * Trước 17/08 nó là `knowledge/shared/_charter.md`, tức là cùng lúc vừa
       * lớp prompt vừa node tri thức: hai cửa sổ sửa cùng một file, không cửa
       * nào nhắc tới cửa kia. Người dùng xoá "node" ở ngăn kéo Tri thức (hợp
       * lý — nó trông như rác agent sinh ra) rồi sửa ở đây, và file được ghi
       * lại KHÔNG còn frontmatter → nó lặng lẽ thôi là node, mà prompt vẫn
       * chạy nên không có gì báo. → docs/SPEC-library.md §17
       */
      file: office.config.charter_file,
      /**
       * Suy ra từ ĐƯỜNG DẪN THẬT, không đóng đinh `false`.
       *
       * Sau di trú thì charter là `charter.md` thuần và cờ này là `false`. Nhưng
       * di trú CÓ THỂ hỏng (Windows khoá file, thư mục chỉ đọc, người dùng khôi
       * phục một bản sao lưu cũ) — và lúc đó file vẫn nằm trong `knowledge/`,
       * vẫn còn frontmatter, vẫn là một node. Đóng đinh `false` nghĩa là lần lưu
       * kế tiếp xoá sạch frontmatter và tái tạo đúng cái lỗi ta vừa sửa, ở đúng
       * những máy mà di trú đã không chạy được.
       */
      frontmatter: office.config.charter_file.replace(/\\/g, '/').startsWith('knowledge/'),
      limit: office.company.budgets.charter_tokens,
      text: office.charter,
      placeholder:
        `Văn phòng ${office.config.name} làm nội dung cho khách hàng nhỏ ở Việt Nam.\n` +
        'Người đọc là chủ shop, không phải dân kỹ thuật.\n' +
        'Mọi bài viết đều xưng "mình", không dùng từ Hán Việt nặng.',
      note:
        'Văn phòng này làm gì, cho ai, ràng buộc nào luôn đúng. Mọi NHÂN VIÊN đều đọc, ' +
        'ở mọi task — nên viết sự thật về công việc, đừng viết lời dặn chung chung. ' +
        'Đây là chỗ DUY NHẤT sửa nó; nó không nằm trong kho tri thức.',
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
  /**
   * Bảng kê tủ tài liệu — PHẢI hiện ở đây, không được là một khối ẩn.
   *
   * Bảng phân lớp này tồn tại để người dùng tin được con số token. Thêm một khối
   * vào prompt thật mà không thêm vào bảng thì bảng nói dối — đúng lỗi đã dẫm ở
   * §5e khi khối GHI NHỚ bị đếm hai lần: prompt vẫn đúng, nhưng cái bảng dùng
   * để kiểm tra prompt thì sai, mà cả điểm của nó là để tin được.
   */
  if (who === 'assistant' && libraryManifest.trim()) {
    add({
      id: 'library',
      title: 'Tủ tài liệu — bảng kê',
      editable: false,
      text: libraryManifest,
      note:
        'Tên và hình dạng các tài liệu BẠN đã thả vào tủ, dựng bằng code nên không tốn lượt gọi nào. ' +
        'Nhờ khối này Trợ lý biết trong tủ có gì TRƯỚC khi chia việc — nó chỉ thẳng file cho nhân viên ' +
        'thay vì để nhân viên đi mò. Cố ý KHÔNG kèm nội dung: tài liệu không bao giờ vào prompt.',
    });
  }

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

  /**
   * Hình dạng giao hàng, nói TƯỜNG MINH ở mỗi task.
   *
   * Nằm trong user message (phần biến động), KHÔNG trong systemPrompt: nó đổi
   * theo từng task, mà `deliver` đứng trong prefix thì hai task khác `deliver`
   * của cùng một vai trò sẽ dùng hai cache entry khác nhau — trả tiền ghi cache
   * hai lần cho cùng một nhân viên.
   */
  parts.push(
    brief.deliver === 'reply'
      ? `## Delivery: REPLY\nThe human asked a question. Write your files as listed, then put the complete answer in the receipt's \`answer\` field — under 300 words, addressed to them, standing on its own. Do not mention file paths.`
      : `## Delivery: FILE\nLeave \`answer\` empty. The human opens the file.`,
  );

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
