/**
 * Prompt layering + cache key. THIS IS THE HEART OF THE COST ARCHITECTURE.
 *
 * → docs/SPEC-token-economy.md §2
 *
 *   ┌─ FROZEN — cross-session cache ────────────────────┐
 *   │ L0  CORE (immutable, not editable)                │
 *   │ L1  Role card                                     │
 *   │ L2  User skills (editable)                        │
 *   │ L3  Company charter (pinned)                       │
 *   │ L4  HOT knowledge                                  │
 *   └────── ◄── SYSTEM_PROMPT_DYNAMIC_BOUNDARY ─────────┘
 *   ┌─ VOLATILE — paid in full, must stay small ────────┐
 *   │ L5  COLD knowledge  ┐ lives in the user message,   │
 *   │ L6  TaskBrief       ┘ not in systemPrompt           │
 *   └──────────────────────────────────────────────────┘
 */

import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';

import type { LoadedOffice } from './config.js';
import { loadSkill, skillFileFor } from './config.js';
import type { Role, TaskBrief } from './types.js';
import { estimateTokens, truncateToTokens } from './tokens.js';
/**
 * ⚠ `t()` IS ONLY FOR `describePrompt`, the layer table drawn in the interface.
 *
 * Nothing that goes into a prompt may call it: the catalogue follows the
 * interface switch, and a prompt that follows the switch is exactly the wire
 * the language rule forbids. `test/settings-language.test.ts` locks that by
 * comparing `cacheKey` across both locales.
 */
import { t } from '../i18n/index.js';

/**
 * Bump this when CORE_PROMPT or how the prompt is built changes. Feeds into the cacheKey.
 *
 * v3 (16/08/2026): added `Options.tools` to ACTUALLY TRIM the tool set, not
 * just self-restrict via `allowedTools`. Tool definitions sit BEFORE the
 * system prompt in the cached prefix, so a changed tool set = a changed
 * prefix — must bump, or the priming gate thinks the cache is still warm
 * while it's actually gone cold. → worker.ts
 *
 * v4 (20/08/2026): `ASSISTANT_CORE` now knows about the hidden worker
 * (`lookup`), and the document cabinet listing was moved down next to the
 * results listing. Both change the prefix.
 *
 * v5 (03/09/2026): no prompt names a language any more. `BuildPromptOpts.language`
 * is gone, the `roleCard` line and the assistant's closing line say "the language
 * of your task brief" / "the language they are writing to you in", and the layered
 * prompt text itself is English throughout.
 *
 * ⚠ This is ONE re-write of the cache, not one per language switch: no locale ever
 * reaches the hashed content, so flipping the interface language costs zero
 * `cache_write`. `test/settings-language.test.ts` locks exactly that.
 */
export const PROMPT_SCHEMA_VERSION = 6;

/**
 * L0 — THE CORE LAYER. NOT editable by the user.
 *
 * The core/user boundary (SPEC §3): anything enforcing an invariant from
 * SPEC-token-economy.md is core. Allowing edits wouldn't be granting
 * freedom — it would be handing over a trap: strip out the Receipt and the
 * whole cost architecture collapses, and the user blames the product instead of their own edit.
 *
 * DELIBERATELY written in English: this block sits in the prefix of EVERY
 * agent, and accented Vietnamese text costs noticeably more tokens (~2.6 vs
 * ~4 chars/token). The parts the user reads and edits (skills, charter) are
 * written in whatever language they like.
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
  "gist": "The 3 facts that answer the task. Numbers and names, not narration.",
  "artifacts": ["relative/path/you/wrote.md"],
  "lessons": [{"kind": "pitfall", "text": "..."}],
  "blocked_on": null
}
\`\`\`

- \`status\`: "done" | "failed" | "blocked" | "needs_human"
- \`say\`: ONE sentence a non-technical person understands. No file paths, no tool names, no jargon. This is shown directly in the UI.
- \`answer\`: normally \`""\`. See "Delivery" below — only tasks marked **deliver: reply** fill this in.
- \`gist\`: the FINDINGS, in under 80 words. See "Gist" below. Fill it whenever you produced a result.
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

## Gist — the findings, so nobody has to open the file

Your manager **cannot read files**. Without \`gist\` the only thing it can tell the human is "the result is in this file" — so they have to go open it, which is worst over a chat bridge.

\`gist\` is what you found. Your manager will rewrite it for the human, so write **facts, not sentences about yourself**:

- ✅ \`"3 in progress: ENG-3 slow list page, ENG-7 login retry, ENG-9 export timeout. 4 more in backlog."\`
- ⛔ \`"I searched Linear and compiled the list of in-progress issues into the output file."\`

Rules:

- **Under 80 words.** Bullets are fine. It is a headline, not a report — the file holds the detail.
- **Answer the task.** If the task asked "how many", the number goes in. If it asked "which ones", the names go in. A gist that does not contain the answer is worthless no matter how tidy it reads.
- **Never repeat a path.** Your manager already has \`artifacts\`.
- **Never narrate.** No "I did", "I found", "successfully". The facts alone.
- Leave it \`""\` only when there is genuinely nothing to report — \`failed\` or \`blocked\` with no partial result. If you got partway, say what you did establish; that is often the most useful thing you produce.
- On **deliver: reply** tasks you may leave it \`""\` — \`answer\` already reaches the human.

## Lessons — method only, never facts

A lesson records **how to work**, never **what is true**. This is a hard line, not a preference.

- ✅ "Return policy lives in library/files/doi-tra.md — grep there before answering"
- ⛔ "Items discounted over 50% cannot be returned"

The second one is already written down in a document the office owns. Copying it into a lesson creates a **second copy that nobody updates**: the day the human edits that policy, the document changes and your lesson does not — and your lesson wins, because it sits in every employee's prompt while the document has to be searched for.

So: never restate document content, never record numbers, thresholds, prices, or dates. Record the path you took, the trap you fell into, the order that worked.

**A lesson requires that you FINISHED.** Record one only when you are returning \`status: "done"\` AND you had to recover from something along the way — then the lesson is the route that finally worked. Leave \`lessons\` empty in every other case, and \`[]\` is the normal answer:

- Returning \`failed\`, \`blocked\` or \`needs_human\` ⇒ \`lessons\` MUST be \`[]\`. A task you did not finish proves "this attempt did not work". It never proves "this cannot be done" — and that second sentence is what a lesson turns into once it sits in every employee's prompt. Say what stopped you in \`blocked_on\`; that reaches the human, who is the one who can fix it.
- Finished with no trouble at all ⇒ also \`[]\`. A smooth path teaches nothing.

⚠ Never write a lesson that says a tool, connector or site "cannot" do something. You saw one attempt, not the capability. Employees who read it will stop before trying — which has already cost this office a working browser connector for two hours.

## What you already have

Relevant notes from the office knowledge base are already in your prompt — selected for you before you started. Do not go looking for a knowledge folder; there is nothing there you have not been given.`;

/**
 * The ASSISTANT's L0 — the core layer, not editable by the user (by default)
 * but ALWAYS VIEWABLE. → docs/SPEC-offices.md §4.1
 *
 * This is the "wiring spec": how the Assistant talks to workers, the Receipt
 * protocol, and the rules for delegating work. It belongs to the source
 * code, not to running the business — the user runs their own company, they don't edit the protocol.
 *
 * Also written in English for the same reason as CORE_PROMPT: this block
 * sits in the prefix of every single conversation turn, and accented
 * Vietnamese text costs noticeably more tokens.
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
8. Results always land inside the office folder. When the human names a folder on their machine, **never promise to write there or to "try again at the right place"** — retrying cannot change it. Say where the file is, and that reaching a folder outside the office needs a **connection** (the "Files on this machine" one) pointed at it.

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
  "steps": ["Understand the request", "Write the content"],
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
 * THE HIDDEN WORKER — its complete prompt, short enough to look incomplete.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO CHARTER · NO KNOWLEDGE STORE · NO SKILLS · NO ROSTER.                     │
 * │ AND NO LESSONS PRODUCED.                                                  │
 * │                                                                          │
 * │ This isn't trimmed down to save money — it's the ONE correct shape, for       │
 * │ three independent reasons that all point the same direction:                    │
 * │                                                                          │
 * │  1. **A lesson only ever records HOW TO WORK.** This agent has exactly one       │
 * │     way of working and it never changes: read the file it's pointed at,          │
 * │     answer the question it's asked. The ONLY thing it COULD "learn" is           │
 * │     DOCUMENT CONTENT — exactly the node type already banned (§2, `fact`           │
 * │     removed from the enum). Giving it a knowledge store would be building         │
 * │     a machine purpose-built to manufacture exactly the forbidden good.           │
 * │  2. **`worthLearning` already returns `false` for a clean run**, and a           │
 * │     lookup turn is clean by construction: no file to break, no dependency         │
 * │     to get stuck on.                                                            │
 * │  3. A hidden knowledge store for an agent the user can't see would be an          │
 * │     undebuggable hole — exactly the worry the user raised. **There's             │
 * │     nothing hidden here, because there's nothing at all.**                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ STATING THE PART THAT CAN'T BE BLOCKED: `tools` restricts it to
 * `Read`/`Grep`/`Glob`, so it **cannot write a file** — that's a real,
 * measured mechanism (§5d). But *how far it reads* inside the office
 * directory has NO gate blocking it (§4.7, all three mechanisms fired
 * blank). It's no worse than an ordinary worker — those also run with `cwd`
 * set to the office directory — and it differs from the Assistant in one
 * decisive way: what it reads **dies with the same call**, never lingering in any context.
 */
export const LOOKUP_PROMPT = `You look things up and answer. You do not write files, and you do not do work.

Rules:

0. If your task names documents, the answer is in them — read those. If it names none, the question is a general one: search the web, then answer. Say plainly when an answer came from the web rather than from this office's documents, and name the source. Web results can be stale or wrong; never present a search snippet as a certainty.
1. Read only the files named in your task. They have already been checked to exist.
2. A long file: use Grep to find the part that matters, then Read that part. Extracted document text carries page markers like \`--- page 12 ---\`; use them to Read the right pages of the original when you need detail.
3. Answer in the language the question was asked in, under 300 words, addressed to the person asking. Plain prose or a small table — no preamble, no "based on the document provided".
4. Answer only from what you read or found. If neither the files nor the web contain the answer, say exactly that and name what you did find. A confident wrong answer is the worst outcome available to you.
5. Never mention file paths, task ids, or how you were invoked. The person asked a question; give them the answer.`;

export interface BuiltPrompt {
  /** Passed into the SDK's Options.systemPrompt. */
  systemPrompt: string[] | { type: 'preset'; preset: 'claude_code'; append: string; excludeDynamicSections: true };
  /**
   * The cache key. Hashes the static CONTENT itself — stronger than the
   * spec's tuple (software_version, role_id, role_version,
   * knowledge_version), since identical content is guaranteed to land on
   * the same cache entry, and different content is guaranteed not to. Can't
   * go wrong from forgetting to bump a version.
   */
  cacheKey: string;
  /** Estimated tokens for the static part — used to warn when the prefix bloats. */
  staticTokens: number;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THERE IS NO `language` FIELD HERE, AND ADDING ONE IS THE BUG.            │
 * │                                                                          │
 * │ It used to exist, defaulting to `'Vietnamese'`, and it was wired to the  │
 * │ interface switch in `company.yaml`. That switch answers *"what do I want │
 * │ to SEE"*; it cannot answer *"what language is this person speaking"*.    │
 * │ A Vietnamese user who prefers an English interface is a normal case, and │
 * │ the wire forced English answers on exactly that person.                  │
 * │                                                                          │
 * │ Naming no language is also what makes the product work in languages we   │
 * │ have never shipped a catalogue for: a Chinese user gets Chinese replies  │
 * │ because nothing anywhere names a language. "Reply in X" would break that │
 * │ permanently, for every language except X.                                │
 * │                                                                          │
 * │ Every runner has a signal already — the assistant has the message just   │
 * │ typed, a worker has its task brief, `lookup` has the question verbatim.  │
 * │ `test/no-pinned-language.test.ts` fails the day this comes back.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface BuildPromptOpts {
  /** Content of the HOT knowledge nodes (already selected, sits INSIDE the cached prefix). */
  hotKnowledge?: string;
  /**
   * The model that will run. MUST feed into the cacheKey: prompt caching is
   * keyed on (model, prefix) — two roles with an identical prompt but a
   * different model do NOT share a cache entry. Without this, the priming
   * gate thinks the cache is already warm when it isn't, and we pay for a
   * `cache_write` while believing we're saving money.
   */
  model?: string;
}

export function buildWorkerPrompt(
  office: LoadedOffice,
  role: Role,
  opts: BuildPromptOpts = {},
): BuiltPrompt {
  const model = opts.model ?? office.company.models[role.model_tier];

  const roleCard = [
    `# Your role: ${role.display_name || role.id}`,
    role.pitch,
    role.good_at.length ? `Good at: ${role.good_at.join(', ')}` : '',
    role.not_for.length ? `Not your job: ${role.not_for.join(', ')}` : '',
    /**
     * ⚠ NAMES NO LANGUAGE, and deliberately still covers only `say`.
     *
     * This used to read "in Vietnamese", fed from the interface switch. The
     * switch is gone; the scope is not widened at the same time, on purpose.
     *
     * A receipt carries four prose fields (`say` · `answer` · `gist` ·
     * `lessons`) plus the output files, and only `say` has ever been specified
     * — yet the other four come out right today. That is either the model
     * being good or every signal happening to point the same way, and until
     * this migration nothing could tell those apart: prompt, charter, skills
     * and brief were all Vietnamese together. The English prompt over a
     * Vietnamese brief is the case that separates them, and it has not been
     * measured yet.
     *
     * ⇒ Widening this line to cover all five is a real option, written out in
     * `docs/SPEC-token-economy.md`, but it costs tokens on EVERY worker turn
     * forever. It gets added only if the measurement shows a layer slipping —
     * not to be safe. → SESSIONS_MEMORY "don't patch with an instruction line"
     *
     * The brief is the only language signal a worker can observe: the
     * assistant wrote it, and the assistant was following the human.
     */
    '\nWrite the `say` field in the language of your task brief.',
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
   * tools/MCP do NOT sit inside systemPrompt, but tool definitions sit
   * BEFORE the system prompt in the prefix Anthropic caches. A changed tool set = a changed prefix.
   *
   * Missing them here is the exact same bug already fixed for `model`: the
   * cache priming gate thinks the cache is warm when it isn't, and we pay
   * for a cache_write while believing we're saving. The canvas lets someone
   * wire up an MCP with the mouse, so this bug would be hit for real.
   */
  const toolKey = `tools:${[...role.tools].sort().join(',')}|mcp:${[...role.mcp].sort().join(',')}`;

  if (role.use_preset) {
    // Claude Code's preset: ~6,300 tokens/call more expensive (FINDINGS §2a).
    // Only used for roles that genuinely need coding instructions.
    // excludeDynamicSections: strips cwd/auto-memory/git status out of the
    // system prompt so the prefix stays identical across machines and sessions.
    const append = blocks.join('\n\n---\n\n');
    return {
      systemPrompt: { type: 'preset', preset: 'claude_code', append, excludeDynamicSections: true },
      cacheKey: hashKey(['preset', model, String(PROMPT_SCHEMA_VERSION), toolKey, append]),
      staticTokens,
    };
  }

  // The marker must be ITS OWN ARRAY ELEMENT. Every block before it gets
  // cached cross-session; anything after does not. No marker = no opt-in
  // into the global cache scope.
  return {
    systemPrompt: [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    cacheKey: hashKey([model, String(PROMPT_SCHEMA_VERSION), toolKey, ...blocks]),
    staticTokens,
  };
}

/**
 * The Assistant's prompt. Same layered structure as a worker's, same cache breakpoint.
 *
 * The order is DELIBERATE — most stable first, most volatile last, so a
 * small change doesn't throw away the entire prefix:
 *
 *   ASSISTANT_CORE   changes on a software upgrade
 *   charter          changes rarely
 *   skills           changes when the user clicks Save
 *   memory           changes on `/clear`
 *   HOT knowledge    changes when knowledge_version bumps
 *   roster           changes when a wire gets dragged on the canvas — a BUILD action, done once
 *   library listing  changes on adding/removing a document   ┐ a USE action, repeats forever
 *   results listing  changes after EVERY run                 ┘ ← the volatile tail, adjacent
 */
export function buildAssistantPrompt(
  office: LoadedOffice,
  opts: {
    roster: string;
    hotKnowledge?: string;
    /** The compressed conversation memory. Its OWN block, never merged into hot. */
    memory?: string;
    /** Document cabinet listing — name + shape, built in code. → SPEC-library.md §8b */
    library?: string;
    /** Listing of RESULTS from previous runs — file names, not content. → SPEC-artifacts.md §2.4 */
    artifacts?: string;
    /** ⚠ No `language`. → the box on `BuildPromptOpts` */
    model?: string;
  },
): BuiltPrompt {
  const hot = opts.hotKnowledge?.trim() ?? '';
  const memory = opts.memory?.trim() ?? '';
  const library = opts.library?.trim() ?? '';
  const artifacts = opts.artifacts?.trim() ?? '';

  const blocks: string[] = [ASSISTANT_CORE];
  /**
   * The office's `deliver` DEFAULT — one line, sitting right after the core layer.
   *
   * Placed here rather than folded into `ASSISTANT_CORE` because it's the
   * USER's own configuration, while the core layer belongs to the source
   * code. And placed BEFORE the charter because it's a hard rule: the
   * charter describes what the office does, this line decides where the
   * result lands.
   *
   * This replaces the `/answer` command that was rejected — it turns a
   * guess repeated on EVERY message into a correct-by-default answer, at 0
   * tokens since it sits inside a prefix that's already cached. → SPEC-offices.md §6
   *
   * ⚠ AND HERE IS ITS LIMIT, measured 20/08: **one office can have BOTH kinds
   * of request.** Within the same translation office, "translate doc-4" is
   * `file` while "list me 10 terms" is `reply` — no single default is
   * correct for both. The default removes ambiguity for the COMMON case; the
   * remaining case still has to be classified every time, so the real
   * decision lives in the tie-breaking rule inside `ASSISTANT_CORE` (*"when
   * close, pick reply"*), not in this line.
   *
   * Consequence: **don't add another interface toggle for
   * `default_deliver`.** A toggle that's only right half the time makes the
   * user do the classifier's job — and they'd flip it back and forth
   * forever. It stays in `office.yaml`, with a 0-token comment right next to
   * it, for someone who genuinely runs a pure Q&A office.
   */
  blocks.push(
    `# Default delivery for this office\n\n` +
      `Unless a request is clearly the other kind, every task you create uses \`"deliver": "${office.config.assistant.default_deliver}"\`.`,
  );
  if (office.charter) blocks.push(`# About this office\n\n${office.charter}`);
  if (office.assistantSkills) blocks.push(`# How you work\n\n${office.assistantSkills}`);
  // MEMORY sits BEFORE lessons, and is its own block: it's something the
  // user has already decided, so it must win over any lesson the agent inferred on its own.
  if (memory) blocks.push(`# What the human has decided — follow these\n\n${memory}`);
  if (hot) blocks.push(`# What this office has learned\n\n${hot}`);
  blocks.push(opts.roster);
  /**
   * THE VOLATILE TAIL — TWO LISTINGS SITTING NEXT TO EACH OTHER, AT THE VERY END.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE CABINET LISTING GOT MOVED DOWN HERE (20/08) — it used to sit right         │
   * │ after the charter, ABOVE memory · hot · roster.                              │
   * │                                                                          │
   * │ The old reasoning: *"the cabinet changes less often than dragging a wire on       │
   * │ the canvas"*. **Real observation disproves that.** Dragging a wire is a          │
   * │ BUILDING-THE-OFFICE action — done once and almost never touched again.          │
   * │ Dropping a document into the cabinet is a USING-THE-PRODUCT action, repeated       │
   * │ over and over for the office's entire lifetime. The wrong order meant every       │
   * │ added file also rewrote memory + hot + roster + the results listing.             │
   * │                                                                          │
   * │ Prompt caching is a PREFIX cache, so grouping the two most-frequently-changing      │
   * │ blocks into one ADJACENT region at the end means: adding a document now only        │
   * │ rewrites `library` + `artifacts` + the language line, instead of six blocks.        │
   * │                                                                          │
   * │ ⚠ Changing the order = changing the prefix = ONE cache rewrite for every           │
   * │ office. Paid once, in exchange for savings on every file the user drops in           │
   * │ afterward — the exact same trade-off shape the "HOT must stay stable" rule           │
   * │ protects, just that there the cost repeats on EVERY TASK, while here it's one         │
   * │ cost for one human action.                                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The cabinet listing is the fix for the largest hole found on 19/08:
   * `INDEX.md` was built on 17/08 so the Assistant would "know about the
   * 34-page contract before delegating work", but it never actually reached
   * the Assistant — it planned blind and left `inputs` empty for a worker to grope around.
   *
   * The results listing changes after EVERY run, so it sits at the very
   * end. → SPEC-artifacts §2.4
   */
  if (library) blocks.push(library);
  if (artifacts) blocks.push(artifacts);
  /**
   * Names no language — same rule as `roleCard`, same reason. The assistant is
   * the one runner that always has the human's own words in context, so it has
   * the strongest signal of anyone and needs the least instruction.
   */
  blocks.push('Always speak to the human in the language they are writing to you in.');

  return {
    systemPrompt: [...blocks, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    // `model` MUST sit inside the key: prompt caching is keyed on (model,
    // prefix). Changing the Assistant's model without changing the key
    // makes every diagnostic tool report "cache still warm" while the next
    // turn actually pays the full cache-write price.
    cacheKey: hashKey(['assistant', opts.model ?? '', String(PROMPT_SCHEMA_VERSION), ...blocks]),
    staticTokens: blocks.reduce((n, b) => n + estimateTokens(b), 0),
  };
}

/** One prompt layer, as the UI displays it. → SPEC-offices.md §8 `/api/office/:id/prompt/:who` */
export interface PromptLayer {
  id: string;
  title: string;
  /** Whether it's editable. The core layer is always false unless allow_core_prompt_edit is on. */
  editable: boolean;
  /** The file holding it, if editable. */
  file?: string;
  text: string;
  tokens: number;
  /**
   * Placeholder text in the input field when this layer is EMPTY — a REAL example of what to write.
   *
   * This is the right place for an example, and the reason is very
   * specific: a file's default content goes into the cached prefix of every
   * call, so a generic instruction line like "write a few sentences about
   * this office" would be a tax collected forever to say something to the
   * MODEL that only makes sense to a PERSON. A placeholder is never saved,
   * never enters the prompt → 0 tokens. → SPEC-offices.md §4.1
   */
  placeholder?: string;
  /** This layer's token ceiling, if it has one. The UI warns when typing goes over. */
  limit?: number;
  /** This file is a knowledge node (has YAML frontmatter that must be preserved on write). */
  frontmatter?: boolean;
  note: string;
}

/**
 * Breaks the prompt into layers so a PERSON CAN SEE THEM.
 *
 * This isn't a side feature. An advanced user needs to *see* the core layer
 * to trust it; hide it and they'll guess, and a wrong guess means they
 * write skills that fight the system itself.
 * → SPEC-offices.md §4.1
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE ORDER HERE MUST MATCH `buildAssistantPrompt` — a bug fixed 20/08.       │
 * │                                                                          │
 * │ This table used to list `library` and `artifacts` BEFORE `memory`/`knowledge`,   │
 * │ while the real prompt orders them the other way around. For a table that's       │
 * │ only for "seeing what's there", a mismatched order is a small thing — but this    │
 * │ table is also used to answer the question **"how many tokens get rewritten if     │
 * │ block X changes"**, and that question only has meaning when the cache is a         │
 * │ PREFIX cache. Wrong order ⇒ wrong number ⇒ an architecture decision made on         │
 * │ top of it is wrong. Measured 20/08: this table claimed changing the cabinet         │
 * │ listing costs 359 tokens; the real order produces a completely different number.    │
 * │                                                                          │
 * │ Exactly the §5e failure class (the MEMORY block counted twice): **a correct        │
 * │ prompt with a wrong viewing table makes the table useless, since its whole          │
 * │ point is to be trustworthy.**                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Editing `buildAssistantPrompt` means editing this too, IN THE SAME
 * CHANGE. Two functions describing the same thing will drift apart — this
 * is a second copy of the same computation, exactly what the 19/08 rule
 * warns against, and it's kept anyway because the table needs
 * `note`/`file`/`limit` fields the real prompt doesn't carry.
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
      title: t('promptLayer.assistantCoreTitle'),
      editable: coreEditable,
      text: ASSISTANT_CORE,
      note: t('promptLayer.assistantCoreNote'),
    });
    add({
      id: 'charter',
      title: t('promptLayer.charterTitle'),
      editable: true,
      /**
       * `charter.md` at the office root — PLAIN markdown, NO frontmatter.
       *
       * Before 17/08 it was `knowledge/shared/_charter.md`, meaning it was
       * simultaneously a prompt layer AND a knowledge node: two editing
       * windows for the same file, neither aware of the other. A user
       * deletes the "node" in the Knowledge drawer (reasonably — it looks
       * like agent-generated clutter), then edits it here, and the file
       * gets saved back WITHOUT frontmatter → it silently stops being a
       * node, while the prompt keeps working, so nothing reports it. → docs/SPEC-library.md §17
       */
      file: office.config.charter_file,
      /**
       * Inferred from the REAL PATH, never hard-coded `false`.
       *
       * After migration, the charter is a plain `charter.md` and this flag
       * is `false`. But migration CAN fail (Windows file locking, a
       * read-only directory, the user restoring an old backup) — and in
       * that case the file still sits in `knowledge/`, still carries
       * frontmatter, is still a node. Hard-coding `false` would mean the
       * next save strips the frontmatter completely and recreates the exact
       * bug just fixed, on exactly the machines where migration failed to run.
       */
      frontmatter: office.config.charter_file.replace(/\\/g, '/').startsWith('knowledge/'),
      limit: office.company.budgets.charter_tokens,
      text: office.charter,
      placeholder: t('promptLayer.charterPlaceholder', { office: office.config.name }),
      note: t('promptLayer.charterNote'),
    });
    add({
      id: 'skills',
      title: t('promptLayer.skillsTitle'),
      editable: true,
      file: 'skills/assistant.md',
      limit: office.company.budgets.assistant_skills_tokens,
      text: office.assistantSkills,
      placeholder: t('promptLayer.assistantSkillsPlaceholder'),
      note: t('promptLayer.assistantSkillsNote'),
    });
  } else {
    const role = office.roles.get(who);
    if (!role) return [];
    add({
      id: 'core',
      title: t('promptLayer.workerCoreTitle'),
      editable: coreEditable,
      text: CORE_PROMPT,
      note: '',
    });
    add({
      id: 'skills',
      title: t('promptLayer.skillsTitle'),
      editable: true,
      // ⚠ MUST be the exact same file `loadSkill` reads back. Declaring two
      // different paths for the same thing = click Save and the content vanishes. → config.ts
      file: skillFileFor(office, role),
      text: loadSkill(office, role),
      placeholder: t('promptLayer.roleSkillsPlaceholder'),
      note: t('promptLayer.roleSkillsNote'),
    });
  }

  /**
   * MEMORY is separated from LESSONS — the same store, two different views.
   * → docs/SPEC-offices.md §4.6
   *
   * Sharing `knowledge/` for storage reuses `supersedes`, aging, budgets and
   * the Librarian — not for convenience. But to the user these are two
   * entirely different things, and merging them into one line loses the more important one:
   *
   *   a lesson — the AGENT figured it out on its own  (confidence 0.6)
   *   a memory — the USER has already decided it       (confidence 0.9)
   *
   * A user must be able to find "what does the system remember about me"
   * without digging through the whole store. That's why it's its own layer
   * here, rather than its own store at the storage layer.
   */
  /**
   * The document cabinet listing — MUST show up here, cannot be a hidden block.
   *
   * This layer-viewing table exists so the user can trust the token count.
   * Adding a block to the real prompt without adding it here makes the
   * table lie — exactly the bug hit at §5e when the MEMORY block got counted
   * twice: the prompt itself was correct, but the table used to verify the
   * prompt was wrong, and the table's whole point is to be trustworthy.
   */
  if (who === 'assistant' && assistantMemory.trim()) {
    add({
      id: 'memory',
      title: t('promptLayer.memoryTitle'),
      editable: false,
      text: assistantMemory,
      note: t('promptLayer.memoryNote'),
    });
  }

  add({
    id: 'knowledge',
    title: t('promptLayer.knowledgeTitle'),
    editable: false,
    text: hotKnowledge,
    note: t('promptLayer.knowledgeNote'),
  });

  if (who === 'assistant' && libraryManifest.trim()) {
    add({
      id: 'library',
      title: t('promptLayer.libraryTitle'),
      editable: false,
      text: libraryManifest,
      note: t('promptLayer.libraryNote'),
    });
  }

  /**
   * The RESULTS listing — has to be present here because it IS present in the real prompt.
   *
   * The §5e lesson (the MEMORY block counted twice): a correct prompt with
   * a wrong viewing table makes the table useless, since its whole point is
   * to be trustworthy. Every new block added to `buildAssistantPrompt` must
   * add an entry here in the same change.
   */
  if (who === 'assistant' && artifactManifest.trim()) {
    add({
      id: 'artifacts',
      title: t('promptLayer.artifactsTitle'),
      editable: false,
      text: artifactManifest,
      note: t('promptLayer.artifactsNote'),
    });
  }

  return layers;
}

/**
 * The VOLATILE part: brief + COLD knowledge. Lives in the user message, not
 * in systemPrompt, so it never touches the cache prefix.
 *
 * INVARIANT: only ever hands over the PATH of an input, never the file's content.
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
   * The delivery shape, stated EXPLICITLY on every task.
   *
   * Lives in the user message (the volatile part), NOT in systemPrompt: it
   * changes per task, and if `deliver` sat in the prefix, two tasks with
   * different `deliver` values for the same role would use two different
   * cache entries — paying for a cache write twice for the same worker.
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
    // A separator between two parts, written as the ESCAPE '\0' rather than
    // embedding a real NUL byte into the source file. A real byte would
    // behave correctly but would make Grep classify this entire file as
    // BINARY and refuse to search inside it — turning the single most
    // important prompt file in the project into the one file an agent
    // cannot look up. Exactly the failure class "anything an agent must be
    // able to Grep shouldn't be buried where Grep can't reach it"
    // (SPEC-library, dot-directories).
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
