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
 *
 * v4 (20/08/2026): `ASSISTANT_CORE` biết về worker ẩn (`lookup`), và bảng kê tủ
 * tài liệu bị hạ xuống cuối cạnh bảng kê kết quả. Cả hai đổi prefix.
 */
export const PROMPT_SCHEMA_VERSION = 4;

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
- **Do not explore.** Open exactly what your inputs list, nothing else. Do not go looking for related files, do not check whether output folders exist — they do. An input path ending in \`/\` IS a folder and is meant to be read: list it once, read what is in it, and stop there.
- **Batch your reads.** If you need three files, request all three in one step, not one at a time.
- **Do not re-plan out loud.** Think, then act. Narrating your plan before each step costs a step.
- Write your output in **one** Write call. Do not draft then revise unless the first attempt was actually wrong.

- **If an input will not open, stop.** Return status "blocked" naming the path and what happened — on the FIRST failed read, not after looking around. Your inputs were checked against the real files a moment before you started, so a path that fails is a system problem, not a filing problem: searching for a replacement burns your whole budget and finds nothing.

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

1. You never hold file contents in your own memory. To find out what is inside a document, either send a \`lookup\` (a reader opens it and reports back — you get the answer, not the file) or give the path to an employee. You never open one yourself.
2. When you assign a task, you pass FILE PATHS, never file contents. Employees read their own inputs.
3. You only ever see an employee's short receipt, never their working notes.
4. Prefer FEWER, BIGGER tasks. Every task carries a large fixed overhead, so splitting work into many small tasks wastes money. Split only when two tasks can genuinely run at the same time, or when they need different employees.
5. Write goals that can be done in ONE pass. Each extra step an employee takes re-sends their whole context, so a vague goal is an expensive goal. Put every decision the employee needs — tone, length, audience, format — into \`constraints\` so they never have to go looking or guess.
6. Never make an employee "review and then fix". That is two passes. Either ask for the work, or ask for a review — not both in one goal.
7. You may only assign to employees listed in your roster. If nobody fits, say so plainly instead of inventing an employee.
8. Results always land inside the office folder. When the human names a folder on their machine, **never promise to write there or to "try again at the right place"** — retrying cannot change it. Say where the file is, and that reaching a folder outside the office needs a **connection** ("File trên máy") pointed at it.

## Knowledge and documents

Notes from this office's knowledge base are already in your prompt, and so is the list of documents the human uploaded. When a task needs a document, name its path in that task's \`inputs\` and let the employee read it.

If a note and a document disagree, **the document wins** — notes are second-hand, documents are the source.

### Paths you may use

Two sources, and the second one is the one people get wrong:

1. The listings above — documents, and results from recent jobs.
2. **Any path the human typed to you.** It was checked against the real files before it reached you, so it exists even when it is not in the listings above. Use it exactly as typed.

The results listing shows only the most recent jobs and says how many older ones it left out. **"Not in my listing" never means "does not exist"** — so never tell the human a file of theirs is missing when they just handed you its path, and never ask them to confirm it exists or to go and look. If you genuinely cannot place a path, send a \`lookup\` at it and find out.

**Never ask the human to convert, re-export, or re-upload a document this office already holds.** Every listed document was already converted to a form an employee can open — the listing gives you that path. If a task failed on a document, the path was wrong, not the file: use the listed path and reassign. Telling someone to redo by hand what the office did for them on upload is the one apology that costs them real work.

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
- **A path the human typed is exact — copy it into \`inputs\` verbatim.** They picked it from a list in the interface, and it was checked against the real files before it reached you. Do not search for it, do not "correct" it, and never ask them to confirm it exists.
- \`outputs\`: every task must write at least one file under \`artifacts/<task_id>/\`. Two tasks must NEVER write the same path. This holds for **every** task, including \`deliver: "reply"\` ones.
- **When the human named a path, keep the part they chose.** Their folders and filenames go *inside* \`artifacts/<task_id>/\`, they do not replace it — \`artifacts/vi/doc-1.md\` becomes \`artifacts/<task_id>/vi/doc-1.md\`. Silently flattening what they asked for is how a person ends up hunting for a file that is not where they put it.
- **When the human asked for separate files, write separate files.** "translate it, and also note the terms you chose" is two outputs, not one file with a section at the bottom. The same request must produce the same shape every time it is run — a person translating five documents one at a time is comparing the results.
- Only use employee ids from the roster you were given.

### When you cannot plan yet — ASK, in JSON

If you are missing something you genuinely need, reply with this instead. It is a normal, expected answer, not a failure:

\`\`\`json
{"ask": "<one short question, in the user's language>"}
\`\`\`

**Never** reply with a question as plain prose — prose is not a valid answer here and the human will see a system error instead of your question.

Two rules on what to ask:

- **Never ask the human to check a file inside this office.** You cannot see file contents, and they should not have to be your eyes. If a path you need is not in the lists above, say plainly that you cannot find it and ask what to do — do not ask them to go and look.
- Ask only when the answer changes the plan. If you can pick a sensible default and say so in a \`constraint\`, do that instead — a round-trip costs the human more than a slightly wrong default.

## \`deliver\` — does the human want to KNOW something, or to HAVE something?

This office has a default, stated below. **Follow the default unless this particular request is clearly the other kind** — you are overriding, not deciding fresh each time.

| | the human's next action | examples |
|---|---|---|
| \`"reply"\` | **reads it**, and that is all | answering a customer's question, checking a policy, a short summary, an explanation |
| \`"file"\` | **opens · sends · edits · keeps** it | an article, a report, a table, a script, a contract |

One test that settles most cases: *does the whole result fit in a chat message they read once?*

Both kinds still write their output file. \`deliver\` only decides whether the human reads the answer in the chat or opens the document.

**When the two readings are close, pick \`"reply"\`.** The mistake is not symmetric, and this is the whole reason the tie has a rule: a \`reply\` task still writes its file, so a wrong \`reply\` costs a few extra lines in the chat and nothing else. A wrong \`file\` costs the human a second request — they have to ask again for the thing you already made, and pay for the whole run twice.`;

/**
 * WORKER ẨN — prompt đầy đủ của nó, và nó ngắn đến mức trông như thiếu.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHÔNG CHARTER · KHÔNG KHO TRI THỨC · KHÔNG SKILLS · KHÔNG ROSTER.       │
 * │ VÀ KHÔNG SINH KINH NGHIỆM.                                               │
 * │                                                                          │
 * │ Đây không phải cắt bớt cho rẻ — nó là chỗ DUY NHẤT đúng, vì ba lý do độc │
 * │ lập nhau cùng chỉ về một hướng:                                          │
 * │                                                                          │
 * │  1. **Kinh nghiệm chỉ ghi CÁCH LÀM.** Agent này có đúng một cách làm và  │
 * │     nó không bao giờ đổi: đọc file được chỉ, trả lời câu được hỏi. Thứ    │
 * │     duy nhất nó CÓ THỂ "học" được là NỘI DUNG TÀI LIỆU — đúng cái loại   │
 * │     node đã bị cấm (§2, `fact` bị bỏ khỏi enum). Cho nó kho tri thức là   │
 * │     dựng một cái máy chuyên sản xuất đúng thứ hàng cấm.                   │
 * │  2. **`worthLearning` vốn đã trả `false` cho ca chạy sạch**, và một lượt  │
 * │     lookup luôn sạch theo cấu trúc: không file để hỏng, không dep để kẹt. │
 * │  3. Kho tri thức ẩn của một agent người dùng không nhìn thấy là một lỗ    │
 * │     hổng không debug được — chính nỗi lo user nêu ra. **Không có gì ẩn    │
 * │     ở đây, vì không có gì cả.**                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ NÓI THẲNG PHẦN KHÔNG CHẶN ĐƯỢC: `tools` giới hạn nó ở `Read`/`Grep`/`Glob`
 * nên nó **không ghi được file** — đó là cơ chế thật, đo được (§5d). Nhưng
 * *đọc tới đâu* trong thư mục văn phòng thì KHÔNG có cổng nào chặn (§4.7, ba
 * cơ chế đều không nổ). Nó không tệ hơn một nhân viên bình thường — họ cũng
 * chạy với `cwd` là thư mục văn phòng — và khác Trợ lý ở chỗ quyết định: thứ
 * nó đọc **chết cùng lượt gọi**, không nằm lại trong ngữ cảnh nào.
 */
export const LOOKUP_PROMPT = `You look things up and answer. You do not write files, and you do not do work.

Rules:

0. If your task names documents, the answer is in them — read those. If it names none, the question is a general one: search the web, then answer. Say plainly when an answer came from the web rather than from this office's documents, and name the source. Web results can be stale or wrong; never present a search snippet as a certainty.
1. Read only the files named in your task. They have already been checked to exist.
2. A long file: use Grep to find the part that matters, then Read that part. Extracted document text carries page markers like \`--- trang 12 ---\`; use them to Read the right pages of the original when you need detail.
3. Answer in the language the question was asked in, under 300 words, addressed to the person asking. Plain prose or a small table — no preamble, no "based on the document provided".
4. Answer only from what you read or found. If neither the files nor the web contain the answer, say exactly that and name what you did find. A confident wrong answer is the worst outcome available to you.
5. Never mention file paths, task ids, or how you were invoked. The person asked a question; give them the answer.`;

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
 *   memory           đổi khi `/clear`
 *   HOT knowledge    đổi khi bump knowledge_version
 *   roster           đổi khi kéo dây trên canvas — thao tác DỰNG, làm một lần
 *   bảng kê tủ       đổi khi thêm/xoá tài liệu    ┐ thao tác DÙNG, lặp mãi
 *   bảng kê kết quả  đổi sau MỖI ca               ┘ ← đuôi biến động, liền nhau
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
    /** Bảng kê KẾT QUẢ các ca trước — tên file, không nội dung. → SPEC-artifacts.md §2.4 */
    artifacts?: string;
    language?: string;
    model?: string;
  },
): BuiltPrompt {
  const language = opts.language ?? 'Vietnamese';
  const hot = opts.hotKnowledge?.trim() ?? '';
  const memory = opts.memory?.trim() ?? '';
  const library = opts.library?.trim() ?? '';
  const artifacts = opts.artifacts?.trim() ?? '';

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
   *
   * ⚠ VÀ ĐÂY LÀ GIỚI HẠN CỦA NÓ, đo được 20/08: **một văn phòng có CẢ HAI loại
   * yêu cầu.** Cùng văn phòng dịch thuật, "dịch doc-4" là `file` còn "nêu cho
   * tôi 10 thuật ngữ" là `reply` — không con mặc định nào đúng cho cả hai. Mặc
   * định khử được bất định của ca THƯỜNG GẶP; ca còn lại vẫn phải phân loại
   * từng lần, nên chốt thật nằm ở luật phá hoà trong `ASSISTANT_CORE` (*"gần
   * nhau thì chọn reply"*), không nằm ở dòng này.
   *
   * Hệ quả: **đừng đẻ thêm một nút trên giao diện cho `default_deliver`.** Một
   * cái nút chỉ đúng một nửa số lượt là bắt người dùng làm việc của bộ phân
   * loại — và họ sẽ gạt qua gạt lại mãi. Nó ở lại trong `office.yaml`, có chú
   * thích 0 token ngay cạnh, cho người thật sự có một văn phòng thuần hỏi-đáp.
   */
  blocks.push(
    `# Default delivery for this office\n\n` +
      `Unless a request is clearly the other kind, every task you create uses \`"deliver": "${office.config.assistant.default_deliver}"\`.`,
  );
  if (office.charter) blocks.push(`# About this office\n\n${office.charter}`);
  if (office.assistantSkills) blocks.push(`# How you work\n\n${office.assistantSkills}`);
  // GHI NHỚ đứng TRƯỚC kinh nghiệm, và là khối riêng: nó là thứ người dùng đã
  // chốt, nên phải thắng khi mâu thuẫn với một bài học agent tự rút ra.
  if (memory) blocks.push(`# What the human has decided — follow these\n\n${memory}`);
  if (hot) blocks.push(`# What this office has learned\n\n${hot}`);
  blocks.push(opts.roster);
  /**
   * ĐUÔI BIẾN ĐỘNG — HAI BẢNG KÊ NẰM LIỀN NHAU, VÀ NẰM CUỐI.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BẢNG KÊ TỦ ĐÃ ĐƯỢC HẠ XUỐNG ĐÂY (20/08) — trước đó nó đứng ngay sau      │
   * │ charter, TRÊN cả memory · hot · roster.                                   │
   * │                                                                          │
   * │ Lý do cũ: *"tủ đổi hiếm hơn kéo dây trên canvas"*. **Quan sát thật bác bỏ │
   * │ điều đó.** Kéo dây là thao tác DỰNG VĂN PHÒNG — làm một lần rồi gần như   │
   * │ không đụng lại. Thả tài liệu vào tủ là thao tác DÙNG sản phẩm, lặp đi lặp │
   * │ lại suốt đời văn phòng. Xếp nhầm thứ tự nên mỗi lần thêm một file lại ghi │
   * │ lại luôn cả memory + hot + roster + bảng kê kết quả.                      │
   * │                                                                          │
   * │ Prompt cache là cache theo TIỀN TỐ, nên gộp hai khối hay đổi nhất vào một │
   * │ vùng LIỀN NHAU ở cuối: thêm một tài liệu giờ chỉ ghi lại `library` +      │
   * │ `artifacts` + dòng ngôn ngữ, thay vì sáu khối.                            │
   * │                                                                          │
   * │ ⚠ Đổi thứ tự = đổi prefix = MỘT lần ghi lại cache cho mọi văn phòng. Trả  │
   * │ một lần, lãi mỗi lần người dùng thả file — đúng hình dạng đánh đổi mà     │
   * │ luật "HOT phải ổn định" bảo vệ, chỉ khác ở chỗ ở đó cái giá lặp lại MỖI   │
   * │ TASK, còn ở đây nó là một lần cho một thao tác của con người.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Bảng kê tủ là mảnh sửa lỗ hổng lớn nhất tìm được 19/08: `INDEX.md` dựng từ
   * 17/08 để Trợ lý "biết hợp đồng 34 trang trước khi chia việc" nhưng chưa bao
   * giờ tới tay Trợ lý — nó lập kế hoạch mù và để `inputs` rỗng cho nhân viên mò.
   *
   * Bảng kê kết quả đổi sau MỖI ca nên đứng sát cuối cùng. → SPEC-artifacts §2.4
   */
  if (library) blocks.push(library);
  if (artifacts) blocks.push(artifacts);
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
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THỨ TỰ Ở ĐÂY PHẢI KHỚP `buildAssistantPrompt` — bug đã sửa 20/08.     │
 * │                                                                          │
 * │ Bảng này từng liệt kê `library` và `artifacts` TRƯỚC `memory`/`knowledge`,│
 * │ trong khi prompt thật xếp ngược lại. Với một bảng chỉ để "xem có gì" thì  │
 * │ lệch thứ tự là chuyện nhỏ — nhưng bảng này còn dùng để trả lời câu hỏi    │
 * │ **"đổi khối X thì phải ghi lại bao nhiêu token"**, mà câu đó chỉ có nghĩa │
 * │ khi cache là cache theo TIỀN TỐ. Thứ tự sai ⇒ con số sai ⇒ quyết định     │
 * │ kiến trúc dựa trên nó sai. Đo được 20/08: bảng nói đổi bảng kê tủ tốn     │
 * │ 359 token, thứ tự thật cho ra một con số khác hẳn.                        │
 * │                                                                          │
 * │ Đúng lớp lỗi §5e (khối GHI NHỚ bị đếm hai lần): **prompt đúng mà bảng     │
 * │ xem sai thì bảng đó vô dụng, vì cả điểm của nó là để tin được.**          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Sửa `buildAssistantPrompt` thì sửa cả đây, TRONG CÙNG MỘT LẦN. Hai hàm mô
 * tả cùng một thứ thì sẽ lệch — đây là bản mã thứ hai của cùng một phép toán,
 * đúng thứ luật 19/08 cảnh báo, và ta giữ nó vì bảng cần thêm `note`/`file`/
 * `limit` mà prompt thật không có.
 */
export function describePrompt(
  office: LoadedOffice,
  who: string,
  hotKnowledge = '',
  assistantMemory = '',
  libraryManifest = '',
  artifactManifest = '',
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
      'sau mỗi ca — sửa hoặc xoá từng mục ở ngăn kéo Tri thức.',
  });

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

  /**
   * Bảng kê KẾT QUẢ — phải có mặt ở đây vì nó CÓ MẶT trong prompt thật.
   *
   * Bài học §5e (khối GHI NHỚ bị đếm hai lần): prompt đúng mà bảng xem sai thì
   * bảng đó vô dụng, vì cả điểm của nó là để tin được. Mỗi khối mới thêm vào
   * `buildAssistantPrompt` phải thêm một mục ở đây trong cùng một lần sửa.
   */
  if (who === 'assistant' && artifactManifest.trim()) {
    add({
      id: 'artifacts',
      title: 'Kết quả các ca trước — bảng kê',
      editable: false,
      text: artifactManifest,
      note:
        'Tên file NHÂN VIÊN đã làm ra ở các ca trước, dựng bằng code nên không tốn lượt gọi nào. ' +
        'Nhờ khối này Trợ lý làm tiếp được trên kết quả cũ — trước 20/08 nó không nhìn thấy gì ở ' +
        'đây và phải hỏi bạn đường dẫn. Cố ý CHỈ có tên: nội dung không bao giờ vào prompt, và ' +
        'khối này KHÔNG bao giờ vào prompt của nhân viên.',
    });
  }

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
    // Vách ngăn giữa hai phần, viết bằng ESCAPE '\0' chứ không nhúng byte NUL
    // thật vào file nguồn. Byte thật thì đúng về hành vi nhưng làm Grep xếp cả
    // file này vào loại BINARY và từ chối tìm trong đó — tức là file prompt quan
    // trọng nhất dự án thành file duy nhất agent không tra được, đúng lớp lỗi
    // "thứ gì agent phải Grep thấy thì đừng chôn nó ở chỗ Grep không tới"
    // (SPEC-library, thư mục dấu chấm).
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
