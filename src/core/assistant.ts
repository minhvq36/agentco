/**
 * Assistant — the assistant for ONE office. A long-lived session, converses
 * with the person, splits work into tasks.
 *
 * → docs/SPEC-offices.md §4
 *
 * The Assistant does NOT do hands-on work itself, does NOT read large files,
 * does NOT read a worker's raw transcript. All it sees is: the pitch of
 * roles ON DUTY, and receipts.
 *
 * The Assistant holds NO MCP connection: it resumes constantly, and MCP
 * breaks the prompt cache on resume (issue #247) → costs ~36,000 equivalent
 * tokens every turn. Any small job needing MCP goes through the hidden
 * `concierge` worker (M1) — the user only sees "the Assistant can use this
 * tool".
 */

import fs from 'node:fs';
import path from 'node:path';

import { type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from './sdk.js';
import { z } from 'zod';

import { activeOptions, findArm, folderRoots } from './catalog.js';
import { companyPaths } from './paths.js';
import { readOAuth } from './secrets.js';
import type { LoadedOffice } from './config.js';
import { noteRateLimit } from './energy.js';
import { driftRepair, driftsFrom } from './language-drift.js';
import { LOOKUP_PROMPT, buildAssistantPrompt } from './prompt.js';
import { delivered } from './scheduler.js';
import { addUsage, classifyError, sayError } from './worker.js';
import {
  DeliverSchema,
  EMPTY_USAGE,
  LessonSchema,
  RunError,
  TaskBriefSchema,
  TaskIOSchema,
  hasShell,
  type Deliver,
  type Lesson,
  type Plan,
  type PlanStep,
  type Receipt,
  type Role,
  type Tier,
  type Usage,
} from './types.js';
import { truncateToTokens } from './tokens.js';
import { t, tEn } from '../i18n/index.js';

/**
 * The planning step COULDN'T split the work, and wants to ASK BACK. →
 * SPEC-offices.md §6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE 08/20, THIS STEP HAD EXACTLY ONE EXIT — and that was the whole      │
 * │ problem.                                                                 │
 * │                                                                          │
 * │ `route()` has `intent: 'ask'`: the Assistant IS ALLOWED to ask back            │
 * │ during a conversation. `plan()` has nothing at all — the only valid           │
 * │ shape is a complete plan. So when the planner genuinely needed a piece         │
 * │ of information, it had NO VALID WAY to say so: it fell out of protocol,        │
 * │ returned prose, and we called that fall a "parse error" and blamed the         │
 * │ user's phrasing.                                                        │
 * │                                                                          │
 * │ The exact text measured 08/20 (`.state/plan-failure.log`):                    │
 * │   *"Could you tell me where the existing Vietnamese translation of              │
 * │   doc-2.md and doc-3.md is located?"*                                    │
 * │ A completely reasonable question, turned into an error by the system.         │
 * │                                                                          │
 * │ The output manifest (§2.4) fixes THAT EXACT case. This gate fixes THE          │
 * │ WHOLE CLASS: there will always be a moment the planner needs to ask, and       │
 * │ we can't predict when.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `discriminatedUnion` CANNOT be used here — the two branches share no common
 * key to distinguish them, and making the model fill in a `kind` field is
 * one more spot for it to forget. `union` tries `ask` FIRST: the plan branch
 * requires `tasks` to have at least 1 element, so the two branches can never
 * both match.
 */
const PlanAskSchema = z.object({ ask: z.string().min(1) });

const PlanTasksSchema = z.object({
  steps: z.array(z.string()).min(1).max(6),
  tasks: z
    .array(
      z.object({
        task_id: z.string(),
        role: z.string(),
        goal: z.string(),
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ 🔴 `TaskIOSchema`, NOT A SECOND COPY OF IT. (measured 05/09)        │
         * │                                                                    │
         * │ This read `z.object({ path: z.string() })` — a hand-written twin of │
         * │ `TaskIOSchema` that happened to match while `kind` had exactly one  │
         * │ possible value. The moment `connection` was added, zod did what zod │
         * │ does with an undeclared key: **stripped it, silently**. The model   │
         * │ sent `{"kind":"connection","path":"the agentco page on Notion"}`,   │
         * │ this line deleted `kind`, `buildPlan` stamped `file` back on, and   │
         * │ the plan was rejected for naming a file that does not exist — the   │
         * │ exact failure the `connection` kind had just been added to fix.     │
         * │                                                                    │
         * │ Two copies of one declaration drift, and the copy that drifts is    │
         * │ the one nobody remembers exists. The 08/19 rule, and the reason     │
         * │ `layout-geometry.ts` and `src/i18n/` are each imported rather than  │
         * │ duplicated.                                                        │
         * │                                                                    │
         * │ ⚠ It fails SILENTLY in both directions: the plan parses fine, and   │
         * │ `tsc` is happy, because the two shapes are structurally compatible. │
         * └────────────────────────────────────────────────────────────────────┘
         */
        inputs: z.array(TaskIOSchema).default([]),
        outputs: z.array(TaskIOSchema).default([]),
        constraints: z.array(z.string()).default([]),
        deps: z.array(z.string()).default([]),
        step: z.number().int().nonnegative().default(0),
        // If the model forgets to declare it, do NOT hardcode a default here
        // — `plan()` fills it in from the office's own default. Pinning
        // 'file' at this spot would make `default_deliver: reply` silently
        // useless exactly when the model forgets.
        deliver: DeliverSchema.optional(),
      }),
    )
    .min(1),
});

/**
 * ⚠ EXPORTED for the test suite alone, for the same reason `buildPlan` was
 * split out of `plan()`: what this schema DROPS is invisible from outside, and
 * a copy of it that silently deleted `kind` shipped for exactly that reason.
 * → the box on `inputs` above
 */
export const PlanOutputSchema = z.union([PlanAskSchema, PlanTasksSchema]);

/**
 * Escape hatch: an object with only `say`, missing `intent`. → `decideRoute`
 * gate 4
 *
 * ⚠ DELIBERATELY NOT `.strict()`. Real cases include
 * `{"intent":"answer","say":"…"}` — the model makes up a gate name that
 * isn't in the list. Being strict here would throw away exactly the cases
 * this gate was built to rescue.
 */
const BareSaySchema = z.object({ say: z.string().min(1) });

/**
 * A plan the model just wrote, NOT YET framed to real paths and not yet
 * carrying a `plan_id`.
 *
 * Given its own name because it passes through TWO gates: the normal
 * `plan()` step, and the escape hatch in `route()` when the model returns a
 * plan while it was supposed to be routing.
 */
export type PlanDraft = z.infer<typeof PlanTasksSchema>;

/** A finished plan, or a question asked back to the user. */
export type PlanOrAsk = { kind: 'plan'; plan: Plan } | { kind: 'ask'; say: string };

/**
 * Four routing outcomes. → SPEC-offices.md §6
 *
 * `scope` on the `task` intent decides whether the log stays readable: `new`
 * spawns an independent Plan, `refine` attaches to the currently running
 * Plan. The Assistant decides based on its own session (it has the full
 * conversation history) rather than a client-side heuristic — the client has
 * no way to know whether two messages are about the same job.
 */
const RouteSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('chat'), say: z.string().min(1) }),
  z.object({ intent: z.literal('ask'), say: z.string().min(1) }),
  /**
   * `lookup` — a HIDDEN WORKER. Reads to ANSWER, produces nothing. →
   * SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY A FOURTH GATE EXISTS, AND WHY IT ISN'T A TOOL ON THE ASSISTANT.       │
   * │                                                                          │
   * │ Case measured 08/20: *"what's the main content of doc-2.md"* → one           │
   * │ planning turn + a worker with a whole prefix (**floor ~13,200 tokens**)       │
   * │ just to read a file and report back. The user called it by its real           │
   * │ name: *"the Assistant is kind of dense"*.                                │
   * │                                                                          │
   * │ Three paths, and only the third is cheap on BOTH columns:                    │
   * │                                                                          │
   * │              costs NOW                          costs FOREVER              │
   * │   DAG        plan + floor of 13,200             0                        │
   * │   Assistant grep ~0                             file content × EVERY turn     │
   * │   lookup     1 one-shot, tiny prefix            0                        │
   * │                                                                          │
   * │ The second column is why the Assistant is NEVER given `Grep`: the           │
   * │ Assistant's context is the ONE thing that's never thrown away. A 34-page      │
   * │ PDF extracted to text landing in there means 10-20K tokens get              │
   * │ `cache_read` again on every turn until `/clear`.                           │
   * │                                                                          │
   * │ And it's NOT turned into an MCP tool the way the original `concierge`         │
   * │ draft planned: MCP breaks the prompt cache on resume (~36K/turn), and           │
   * │ `route()` resumes on EVERY message. As an INTENT it's the same idea, for        │
   * │ $0 in cache cost.                                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `paths` USED TO REQUIRE ≥1. LOOSENED 08/24 (user settled it) — and the        │
   * │ reason is PRODUCT, not architecture.                                     │
   * │                                                                          │
   * │ Old rule: *"if you can't name a file, use `ask`, don't send an agent           │
   * │ fumbling around"* — correct when the office's whole world was the             │
   * │ library. The real consequence on a brand-new office: a user asks *"what        │
   * │'s the weather today"*, *"a restaurant"*, *"the news"* and gets back            │
   * │ *"this office doesn't have a worker for that yet"*.                        │
   * │                                                                          │
   * │ The user pushed back with an unanswerable point: *"would a non-technical      │
   * │ florist go create a dedicated professional worker, or would they just ask     │
   * │ random things like restaurants, weather, the news?"*. And the log had           │
   * │ already recorded the priority order: the real risk is **no users at all         │
   * │ (~90%)**, not slightly unclean architecture (~1%). A first contact has no        │
   * │ second chance.                                                          │
   * │                                                                          │
   * │ Why NOT create a fifth intent instead: `route()` runs on EVERY message,       │
   * │ so every intent is a permanent token cost in the conversation prefix.          │
   * │ `lookup` was already the lane for *"answer a question, hand nothing            │
   * │ over"* — giving it web access WIDENS an existing lane, it doesn't open a         │
   * │ new one. All three fences stay in place: read-only tools · can't write a         │
   * │ file · session dies with the call.                                        │
   * │                                                                          │
   * │ ⚠ THE BOUNDARY HAS TO STAY SHARP, and here's the real risk of this             │
   * │ widening: **`lookup` ANSWERS, it does NOT HAND OFF.** Anything a user            │
   * │ keeps (a file, a report, a table) always comes from `task` + a worker.          │
   * │ Over-routing into this lane means they get a sentence in the chat pane          │
   * │ and **no artifact to open at all**.                                       │
   * │                                                                          │
   * │ Measured before the widening: hidden-worker prefix 2,828 → 3,820             │
   * │ (**+992 tokens**, only charged when lookup actually runs). One real web         │
   * │ question: 29.8s · $0.0827, versus $0.13-0.14 for the plan→worker path.          │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Empty `paths` = a question that requires a web lookup. Non-empty `paths`
   * = read exactly those files (they still get cross-checked against disk in
   * `Office` before anyone reads anything).
   */
  z.object({
    intent: z.literal('lookup'),
    paths: z.array(z.string()).default([]),
    question: z.string().min(1),
  }),
  z.object({
    intent: z.literal('task'),
    request: z.string().min(1),
    scope: z.enum(['new', 'refine']).default('new'),
  }),
]);
export type RouteDecision = z.infer<typeof RouteSchema>;

/**
 * Five outcomes of a routing turn — three valid gates, two escape hatches.
 *
 * `plan` and `garbled` are NOT things the model is allowed to return; they
 * are what we do when it returns something else. Kept in the same union so
 * no call site forgets to handle one — see `decideRoute`.
 */
export type RouteOutcome =
  /**
   * `salvaged` = went through a RESCUE GATE, not the main gate. Changes
   * behavior not at all — it exists purely for logging. A rescue gate that
   * leaves no trace is a quiet funnel: the model forgets `intent` forever
   * with nobody noticing, and we lose the exact signal needed to go fix it
   * at the right spot (the prompt), instead of patching it here forever.
   */
  | (RouteDecision & { salvaged?: true })
  /** The model returned an entire PLAN instead of a routing decision. */
  | { intent: 'plan'; draft: PlanDraft }
  /** Returned something unusable, AND it must never be shown to the user. */
  | { intent: 'garbled'; say: string; raw: string };

/**
 * What did the model just say? A PURE function — 0 tokens, and this is where
 * a bug once slipped through.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG FIXED (08/20): A PLAN LEAKED INTO THE CHAT PANE.                     │
 * │                                                                          │
 * │ The old version, when `RouteSchema` didn't match:                            │
 * │     `parsed ?? { intent: 'chat', say: text.trim() }`                     │
 * │ — i.e. **the model's raw text went straight to the user's face**.             │
 * │                                                                          │
 * │ Case measured on a user's machine: they asked *"give me 10 terms"*, the       │
 * │ Assistant asked back *"from which document"*, they answered *"any, random     │
 * │ is fine"* — and the chat pane spat out a raw `json` blob with                  │
 * │ `steps`/`tasks`/`deps`. The model had answered CORRECTLY IN CONTENT               │
 * │ (assigned `nguoi-dich`, pointed at the right file, `deliver: reply`) but         │
 * │ through the WRONG DOOR, so `run()` was never called and **nobody ever did       │
 * │ that job at all**. The user paid for a turn to get back a code block.          │
 * │                                                                          │
 * │ Why the model did this: `ASSISTANT_CORE` carries a "Planning output"           │
 * │ section in the prefix of EVERY turn — `route()` and `plan()` deliberately     │
 * │ share one prefix so they share one cache entry. Right after an `ask`           │
 * │ sentence, "any is fine" reads exactly like the signal *"go split the           │
 * │ work"*. This is the consequence of an already-settled trade-off, not a          │
 * │ bad model.                                                              │
 * │                                                                          │
 * │ So it's fixed with a MECHANISM, not an extra prompt instruction:               │
 * │ instructing costs tokens forever, is only a suggestion, and the 08/19          │
 * │ rule already said *don't tell the model not to do something*. Here we          │
 * │ can't stop it from writing this out — but we're ALREADY HOLDING a valid,        │
 * │ already-paid-for plan, so the right move is to USE IT.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The try order is deliberate:
 *
 *  1. `RouteSchema`   — the main gate, the usual case.
 *  2. `PlanTasksSchema` — it already planned → pick it up, don't call again.
 *  3. `PlanAskSchema`  — `{"ask":"…"}` is a valid QUESTION at the planning
 *     step; a different shape but identical in meaning to `intent: 'ask'`.
 *  4. Everything else: **is there JSON or not** is the deciding question.
 *
 * Step 4 is a new rule, and it's deliberately narrow: **prose still displays
 * as before**. If the model answers "Hi there!" and forgets to wrap it in
 * JSON, showing that sentence is still more correct than swallowing it. Only
 * JSON gets blocked — a JSON blob is NEVER a sentence meant for the user, it's
 * a protocol message that walked through the wrong door. Distinguished by
 * `JSON.parse`, i.e. by a fact, not a guess about wording.
 */
export function decideRoute(text: string): RouteOutcome {
  const routed = extractJson(text, RouteSchema);
  if (routed) return routed;

  const draft = extractJson(text, PlanTasksSchema);
  if (draft) return { intent: 'plan', draft };

  const asked = extractJson(text, PlanAskSchema);
  if (asked) return { intent: 'ask', say: asked.ask.trim() };

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 GATE 4 — `{"say": "…"}` MISSING ONLY THE WORD `intent`. (bug a user         │
   * │ caught 08/28)                                                           │
   * │                                                                          │
   * │ This is NOT a hypothesis. Exact text from `route-failure.log`, two turns     │
   * │ 29 seconds apart, right after a user disconnected the GitHub arm:             │
   * │                                                                          │
   * │   {"say":"The GitHub connection is gone now, so I can't read the                │
   * │    toeic-learning repo's README at the moment. You'll need to reconnect         │
   * │    GitHub…"}                                                             │
   * │                                                                          │
   * │ The model answered **correctly, completely, and in plain human words**.       │
   * │ We threw it away and replaced it with an apology telling the user to           │
   * │ type it again — and typing it again produced the exact same thing, because      │
   * │ the model had nothing wrong to fix. The user made all three points               │
   * │ correctly: *"that's not the LLM's fault"* · *"very dangerous for                │
   * │ multilanguage"* · *"asking again just gives the same result"*.                  │
   * │                                                                          │
   * │ `say` is a field of BOTH `chat` and `ask`, so missing `intent` genuinely        │
   * │ leaves no way to know which gate was meant. `chat` was chosen for the           │
   * │ asymmetry: `ask` promises *"I'm waiting on your answer"* — a wrong                │
   * │ promise like that is worse than making none. Both gates just print the           │
   * │ same sentence, so the user loses nothing.                                 │
   * │                                                                          │
   * │ ⚠ Same pattern as the two rescue gates right above: we're ALREADY HOLDING       │
   * │ an already-paid-for, readable answer — the right move is to USE IT, not         │
   * │ make the user pay for another turn.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const bare = extractJson(text, BareSaySchema);
  if (bare) return { intent: 'chat', say: bare.say.trim(), salvaged: true };

  const raw = text.trim();
  if (!raw) {
    return {
      intent: 'garbled',
      // `route()` also retries once for this case before the sentence below
      // reaches the user's face — an empty response is usually a transient
      // hiccup, i.e. exactly the case one more turn resolves without
      // bothering anyone.
      say: t('as.emptyReply'),
      raw: '',
    };
  }
  if (hasJsonObject(raw)) {
    return {
      intent: 'garbled',
      // Doesn't quote the model here, unlike `planFailed`. There, what the
      // model said was PROSE — readable, and itself informative. Here it's
      // JSON: pasting a code block in front of someone running a flower shop
      // adds nothing but confusion. The raw text goes into
      // `.state/route-failure.log` for whoever debugs it.
      /**
       * ⚠ THE LAST RESORT — only reached when **the repair turn inside
       * `route()` also fails**.
       *
       * The old sentence pinned here had three flaws, and all three actually
       * bit (08/28): it guessed a cause (*"my own mistake"* when the
       * connection had actually been disconnected), it pinned Vietnamese into
       * a chat line that should have followed the user's language, and it said
       * *"try messaging the exact same thing again"* — advice that's
       * **deterministically wrong**: the model had nothing wrong to fix,
       * typing it again produces the exact same thing.
       *
       * The new sentence guesses nothing and blames nobody. It states exactly
       * the two things we KNOW — this couldn't be done, and there's a
       * different way forward — because that's the entirety of what's true on
       * this branch.
       */
      say:
        t('as.noUsableAnswer'),
      raw,
    };
  }
  return { intent: 'chat', say: raw };
}

/**
 * The TEXT part the model wrote in one routing outcome. A PURE function, 0 tokens.
 *
 * Used by the post-check gate `staleArmMentions`. All three valid gates carry
 * a text field, and all three end up in front of the user or inside a plan's
 * `request` — so all three need checking.
 *
 * `garbled` returns empty ON PURPOSE: its sentence is a rescue sentence WE
 * wrote, not the model's own words. Checking it would be checking ourselves.
 * `plan` is also empty — a draft is structured data, and the roles in it are
 * already cross-checked against `assignableRoles()` by the scheduler.
 */
export function routeText(r: RouteOutcome): string {
  if (r.intent === 'chat' || r.intent === 'ask') return r.say;
  if (r.intent === 'task') return r.request;
  if (r.intent === 'lookup') return r.question;
  return '';
}

/** Is there at least one parseable JSON object in the string? A fact, not a guess. */
function hasJsonObject(text: string): boolean {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) return false;
  try {
    return typeof JSON.parse(text.slice(first, last + 1)) === 'object';
  } catch {
    return false;
  }
}

const ReportSchema = z.object({
  say: z.string().min(1),
  lessons: z.array(LessonSchema).max(2).default([]),
});

export interface AssistantResult<T> {
  value: T;
  usage: Usage;
}

/**
 * Wraps one prompt as streaming input. See the comment block on `run()`.
 *
 * Yields EXACTLY ONE message then closes: the SDK receives enough input and
 * closes the stream right away, so there's no hanging case. `session_id` is
 * left empty — the SDK fills it in itself; the real session pointer travels
 * through `options.resume`.
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
 * Is there anything to learn from this run? Decided by CODE, before asking
 * the model.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DON'T TELL THE MODEL NOT TO DO SOMETHING — DON'T GIVE IT THE CHANCE TO.    │
 * │                                                                          │
 * │ The old version ALWAYS attached a `lessons` field to every report, along      │
 * │ with the instruction "a run that went smoothly is not a lesson". Ask a         │
 * │ model "what did you learn?" and it will almost always squeeze out a            │
 * │ sentence, and the instruction doesn't stop it.                            │
 * │                                                                          │
 * │ Real case, 08/19: a run that went completely smoothly (1 job, done, not        │
 * │ blocked, no receipt repair) produced the node                                  │
 * │ `k/shared/san-pham-giam-gia-60-…`. Its content was a DISTORTED                 │
 * │ interpretation of one sentence in the user's own document: the policy           │
 * │ said "over 50% off, no returns", the node recorded "60% off USUALLY can't       │
 * │ be returned". Wrong threshold, an added word "usually" the policy never         │
 * │ had, sitting in every worker's prefix until it expires.                        │
 * │                                                                          │
 * │ The Assistant was able to write that sentence without ever reading the         │
 * │ document — it only saw ONE `say` line from the worker. That's hearsay, not      │
 * │ a lesson.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The threshold: only asks when the run **reached its destination** AND
 * there's an OBSERVABLE TRACE of trouble along the way — both are
 * observable facts, not something inferred. The "reached its destination"
 * clause is the newer one (08/29) and the more important one; the full
 * reasoning is in `learnable` right below. On a smooth run, the user's own
 * real experience still has a path into the store, and it's a better path:
 * tell the Assistant, then `/clear` → a MEMORY node at 0.9.
 *
 * ⚠ DELIBERATELY does NOT use TURN COUNT as a signal, tempting as it is.
 *
 * The first draft of this function had `usage.turns >= 8` added, and the
 * test suite rejected it immediately: the 08/19 case ran exactly **9
 * turns** — i.e. that condition would have let through the exact case it
 * was built to catch. The deeper reason is in §7: *turn count is a property
 * of the MODEL and the task's difficulty*, measured as haiku 10 turns vs.
 * sonnet 4 turns for the same job. Using it as a "trouble" signal means
 * every office running `eco` is treated as perpetually troubled, while
 * `deep` never is.
 *
 * Four signals, all MODEL-INDEPENDENT: a failed job, a blocked job, a
 * receipt needing repair, or a worker REPEATING AN ACTION.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `looped` IS THE CORRECT WAY TO CATCH "THE FLOW GOT STUCK IN A LOOP" — and  │
 * │ it is NOT turn count.                                                    │
 * │                                                                          │
 * │ Measured by REPEATED ACTIONS (rereading an already-read file, rereading a     │
 * │ file just written, calling the exact same tool again), inferred from the       │
 * │ `tool_use` stream a worker already unpacks. All three are violations of a       │
 * │ rule `CORE_PROMPT` states outright, so this isn't a new heuristic — it's        │
 * │ just measuring whether an already-stated discipline is being followed. And     │
 * │ it's model-independent: haiku or sonnet, reading something twice is still       │
 * │ reading it twice. → `worker.ts → observeCall`                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A known, accepted trade-off: a large knowledge store slows things down significantly.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FIFTH SIGNAL: HUMAN FRICTION (08/20).                                │
 * │                                                                          │
 * │ The first four signals all read from `receipts` — i.e. they measure how        │
 * │ HARD THE MACHINE'S JOB WAS. There's a whole class of case where all four        │
 * │ stay silent: the machine ran perfectly, while the human struggled.             │
 * │                                                                          │
 * │ Real case 08/20. The user: *"doc-2, doc-3 are missing the terminology           │
 * │ file"*. Four rounds back and forth — the Assistant told them to check the       │
 * │ path, then asked where the old file was, then a planning turn died               │
 * │ completely — until the user had to come up with the fix themselves:            │
 * │ *"well then you need to tell the translator to create supplementary             │
 * │ ones"*. The run after that: 2 tasks, both `done`, a spotless receipt. **0        │
 * │ lessons.**                                                               │
 * │                                                                          │
 * │ The office had just learned something genuinely valuable — *"here,               │
 * │ continuing work on an existing output means stating outright who it's           │
 * │ assigned to redo"* — and threw it away, because it never sat inside any          │
 * │ receipt.                                                                 │
 * │                                                                          │
 * │ `friction` = the count of planning turns that FAILED or HAD TO ASK BACK        │
 * │ since the most recent run that actually happened. Still an **observable         │
 * │ fact**, counted by code, 0 tokens, model-independent — the exact same rule       │
 * │ that rejected `usage.turns`.                                             │
 * │                                                                          │
 * │ And it opens up a new CLASS of lesson: experience about **how to hand work      │
 * │ over in this specific office**, not about the content of the work itself.        │
 * │ This is the only class learned straight from the user without asking them        │
 * │ a single question.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Why it does NOT count the number of messages a user types, tempting as
 * that sounds: people send multiple messages for many reasons — an added
 * thought, a change of mind, or just splitting one sentence into two lines.
 * Only **a planning turn that failed to produce a plan** is solid proof that
 * the system made the user repeat themselves.
 */
export function worthLearning(
  receipts: readonly Receipt[],
  friction = 0,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A RUN THAT STILL HAS A WARNING ISN'T YET A LESSON. (user settled            │
   * │ 08/29)                                                                   │
   * │ > *"if one job still has a warning, that means there's still a leak, it       │
   * │ >  can't be counted as a lesson"*                                        │
   * │                                                                          │
   * │ This is a RUN-level warning, something `learnable` can't see because it        │
   * │ only reads ONE receipt at a time: a promised file missing from disk           │
   * │ (`missingOutputs`) · output landing outside the office (`strays`) · a path      │
   * │ pulled back into the frame (`redirected`). All three mean *"finished, but      │
   * │ still leaking"* — and a way of working that still leaks isn't yet a way of      │
   * │ working.                                                                 │
   * │                                                                          │
   * │ ⚠ The computation ORDER used to be the broken part: `missingOutputs` used to   │
   * │ be computed AFTER the `report()` turn had already asked for lessons, so it      │
   * │ could warn the user without ever being able to block a single node. →          │
   * │ `office.ts`, where `leaked` is built                                     │
   * │                                                                          │
   * │ ⚠ Does NOT apply to the `friction` branch: that class learns about **how       │
   * │ humans hand work over**, and a file landing in the wrong place doesn't          │
   * │ make that sentence wrong.                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  leaked = false,
): boolean {
  if (friction > 0) return true;
  if (leaked) return false;
  return receipts.some(learnable);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CAN THIS RECEIPT BE USED AS A **SOURCE** FOR A LESSON. (user settled        │
 * │ 08/29)                                                                   │
 * │                                                                          │
 * │ TWO CONDITIONS, and condition ① is the NEW one — it inverts the old gate:      │
 * │   ① `delivered`   — **DELIVERED OUTPUT**. A REQUIRED condition, non-negotiable  │
 * │   ② `agentFault`  — **HIT A SNAG**. The old threshold, kept as-is: a path        │
 * │                     that was too easy also isn't necessarily worth saving        │
 * │                     (user reconfirmed).                                    │
 * │                                                                          │
 * │ ⚠ Condition ① is `delivered()`, NOT `status === 'done'`. (user settled:        │
 * │ *"done should be judged against whether the user's own goal was actually        │
 * │ met"*) `status` is the **worker's own claim**; `delivered` asks one more         │
 * │ OBSERVABLE question: *did anything actually land* (`artifacts` · `landed`).      │
 * │ This very store already recorded that exact gap in words: *"two tasks           │
 * │ reported 'job done' (Facebook, YouTube) but the system marked them              │
 * │ failed"*. Learning from an unverified claim replicates that exact lie          │
 * │ straight into the prefix. → [[agentco-deterministic-vs-signal]] ·                │
 * │ `scheduler.ts §delivered`                                                │
 * │                                                                          │
 * │ The old gate only had condition ②, so it fired **exactly when a run just         │
 * │ broke** — i.e. exactly when the evidence is weakest. The result was a           │
 * │ RATCHET: a broken run produces a lesson → `cold()` pulls it right back in         │
 * │ on the next task with the same topic → it **causes** the exact symptom that       │
 * │ produced it → produces another one.                                       │
 * │                                                                          │
 * │ MEASURED 08/29, office `canh-tay`, 21 Assistant lessons sorted by the run's       │
 * │ status that produced them:                                                │
 * │                                                                          │
 * │   blocked  12 entries  ← **all 10 entries that had blocked the browser arm      │
 * │                           sit here**                                       │
 * │   failed    3 entries  ← "already failed 3 times in a row" — the same shape      │
 * │   done      6 entries  ← all genuinely-working methods                    │
 * │                                                                          │
 * │ The single most expensive real case, two entries about the same thing:          │
 * │   from a `blocked` run 08/28: *"GitHub can't merge the branch via a PR"*         │
 * │   from a `done` run    08/28: *"create_pull_request and merge_pull_...           │
 * │   already exist"*                                                         │
 * │ ⇒ A lesson from a broken run isn't just useless — **it's WRONG**. A broken       │
 * │ run proves *"didn't finish this time"*; it **never** proves *"can't be           │
 * │ done"*. Those two statements are far apart, and the model can't tell them        │
 * │ apart.                                                                    │
 * │                                                                          │
 * │ ⚠ WHAT'S LOST, stated outright so it can be weighed: a broken run now            │
 * │ leaves **absolutely nothing** in the store. That's DELIBERATE — an                │
 * │ unresolved snag is **a message for the USER** (the `blocked_on` sentence, the     │
 * │ chat pane), not a lesson for a worker. Sending it into the prefix sends it        │
 * │ to the wrong reader, exactly the mistake `agentFault` was built to               │
 * │ classify and avoid.                                                       │
 * │                                                                          │
 * │ ⚠ Does NOT apply to the Assistant's own MEMORY (`isMemory`): its authority        │
 * │ comes from the **user**, not from a run's outcome. Gating it on a run's           │
 * │ result would throw away a human decision because of one failed task.            │
 * │ ⚠ Does NOT apply to the `friction` branch: that's a lesson about **how to      │
 * │ hand work over**, born from a CLEAN run, so it isn't caught in this ratchet.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function learnable(r: Receipt): boolean {
  return delivered(r) && agentFault(r);
}

/**
 * WAS THIS SNAG CAUSED BY AN AGENT INSIDE THE OFFICE?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE QUESTION *"WHOSE FAULT"* HAS TO BE ANSWERED BEFORE THE QUESTION            │
 * │ *"WHAT WAS LEARNED"*. (user settled 08/21)                                     │
 * │                                                                          │
 * │ The old version fired whenever `status !== 'done'` — REGARDLESS of why. Hitting   │
 * │ the cost cap counts as `failed`, so every capped turn got asked *"what did        │
 * │ you learn"*. A model that gets asked has to answer, and it has exactly one         │
 * │ thing to report: the cap. Measured in production 08/21 — two nearly                │
 * │ identical nodes:                                                          │
 * │                                                                          │
 * │   "Phan-tich-standard keeps hitting the cost cap … so raise max_usd"           │
 * │   "The CSV group+aggregate job may hit the cap … consider raising max_usd"       │
 * │                                                                          │
 * │ Three things broken at once, and the second is the expensive one:               │
 * │                                                                          │
 * │  1. WRONG READER. The lesson sits in the prefix of EVERY worker. A worker         │
 * │     can't fix `max_usd` — it has no hands to do that with. That advice is         │
 * │     meant for a HUMAN, and a human doesn't read the knowledge store; they         │
 * │     read the chat pane, where that sentence was already said. We pay              │
 * │     forever to repeat a sentence already delivered through the right door.       │
 * │  2. SELF-INFLICTED. A node enters the prefix → the prefix grows → every turn       │
 * │     gets more expensive → **hitting the cap gets EASIER**. A lesson warning        │
 * │     about hitting the cap, whose very existence increases cost. It                │
 * │     manufactures the exact problem it warns about.                             │
 * │  3. WILL BECOME WRONG. The day the user raises the cap, the node still says       │
 * │     "tends to hit the cap" — and the node WINS, because it already sits in         │
 * │     every worker's head. Exactly the failure class the rule *"record HOW TO       │
 * │     DO IT, not KNOWLEDGE"* exists to block.                                  │
 * │                                                                          │
 * │ ⚠ WHY NOT FILTER WITH A PROMPT INSTRUCTION: the prompt ALREADY forbids this,      │
 * │   with two separate lines (*"don't record numbers, thresholds, prices"* and       │
 * │   *"record HOW TO DO IT"*), and the model still produced two nodes about a          │
 * │   cost threshold. A rule that only lives in the prompt is a PROMISE. And the       │
 * │   LLM is uniquely weak at exactly this spot — it can't tell *"I did              │
 * │   something wrong"* from *"my environment blocked me"*, because both show up       │
 * │   in its context identically: a turn that didn't finish. So don't ask the         │
 * │   model that question. **We know for certain, from the data.**                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `FailureKind` splits cleanly by *who can fix it*:
 *
 * | kind | caused by | can the agent do anything |
 * |---|---|---|
 * | `budget` · `max_turns` | a cap the USER set | no — it can't edit the config |
 * | `rate_limit` · `usage_limit` | infrastructure / plan tier | no |
 * | `auth` | machine configuration | no |
 * | `stopped` | the user hit Stop | no, and that isn't a snag at all |
 * | `other` | could be its own fault | yes |
 *
 * And `reasked` (wrong output format) and `looped` (repeated actions) are
 * always the agent's own doing — observable in the stream, model-independent.
 */
export function agentFault(r: Receipt): boolean {
  // Observable in the `tool_use` stream, model-independent, always the
  // agent's own doing. Checked first because it's the most certain.
  if (r.reasked || r.looped) return true;

  /**
   * A `failure` present ⇒ the loop was cut off from OUTSIDE, and `blocked_on`
   * at that point is the SYSTEM's own sentence, not the worker's own claim.
   * This is exactly where my first fix got it wrong: I dropped `blocked_on`
   * from the signal entirely, and lost a real case — a worker that reported
   * `done` but wrote *"missing the terminology file"* on its own is the most
   * valuable lesson in the whole store. Two `blocked_on` values from
   * different sources, and `failure` is exactly what tells them apart.
   */
  if (r.failure) return r.failure === 'other';

  // No `failure` ⇒ the loop ran to completion, and everything below is the
  // WORKER'S OWN CLAIM. The account of someone who was actually there, and
  // it's worth learning from.
  return r.status !== 'done' || !!r.blocked_on;
}

/**
 * Frames every artifact path of this plan into its OWN dedicated directory.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `T-01` IS A SEQUENCE NUMBER WITHIN ONE PLAN, AND EVERY PLAN STARTS AT 1.       │
 * │                                                                          │
 * │ So `artifacts/T-01/` is a directory SHARED across every single run.          │
 * │ Measured on a user's machine: office `noi-dung` had EIGHT plans, and all         │
 * │ eight dumped into `artifacts/T-01/` — nine files jumbled in one place,          │
 * │ nothing saying which file belonged to which run.                              │
 * │                                                                          │
 * │ Nothing was lost today only because the filenames happened to differ.          │
 * │ Rerunning a request similar to a previous one means the old output gets         │
 * │ OVERWRITTEN, with no question and no warning — exactly the "lost the user's      │
 * │ work, silently" failure class in §8.                                     │
 * │                                                                          │
 * │ `Scheduler.validate` only blocks two tasks WITHIN the SAME plan from             │
 * │ overwriting each other; it knows nothing about previous plans.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Done by CODE, not instructed to the model: `plan_id` is generated right
 * here, and the model never even knows it. Asking the model to invent a
 * unique path itself would be paying money to buy back the exact uncertainty
 * just eliminated.
 *
 * ⚠ Only rewrites a path pointing to a task OF THIS EXACT PLAN. A user is
 * allowed to say "edit yesterday's file", and at that point `inputs` points
 * to an artifact of an older plan — rewriting it would point a worker at a
 * file that doesn't exist.
 */
export function artifactScoper(planId: string, taskIds: readonly string[]): (p: string) => string {
  const mine = new Set(taskIds);
  return (raw: string): string => {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = p.split('/');
    if (parts[0] !== 'artifacts' || parts.length < 2) return raw;
    // Already framed (an old path the user pasted back in) — leave it as-is.
    if (!mine.has(parts[1] ?? '')) return raw;
    return ['artifacts', planId, ...parts.slice(1)].join('/');
  };
}

/**
 * Frames a task's OUTPUT path — and KEEPS the suffix the user chose.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS SPLIT FROM `artifactScoper` (08/20).                         │
 * │                                                                          │
 * │ The two sides answer two different questions, and merging them is what           │
 * │ caused a real broken case:                                                │
 * │                                                                          │
 * │  · `artifactScoper` (an INPUT) — "does this path point to a task OF THIS         │
 * │    EXACT PLAN?" If not, LEAVE IT AS-IS, because the user is allowed to say        │
 * │    "edit yesterday's file".                                              │
 * │  · `outputScoper` (an OUTPUT) — "where does this task write to?" The answer       │
 * │    does NOT depend on the string the model wrote: it's always                    │
 * │    `artifacts/<plan>/<task>/`.                                            │
 * │                                                                          │
 * │ THE BROKEN CASE: a user said *"Save it to `artifacts/vi/doc-1.md`"*. The         │
 * │ planner wrote that exact string into `outputs`, `artifactScoper` saw `vi`         │
 * │ wasn't a task id and left it as-is — and the file fell outside the per-run        │
 * │ frame entirely, losing the guarantee that "the next run won't overwrite           │
 * │ this one". A case measured on a user's machine went down the other branch:        │
 * │ the planner dropped `vi/` on its own to follow a prompt rule, so **the           │
 * │ user's explicit request vanished with nobody saying a word**.                 │
 * │                                                                          │
 * │ Both outcomes are wrong, and both come from letting the MODEL decide             │
 * │ something that belongs to CODE. Here, code decides the frame, the model          │
 * │ keeps the suffix:                                                        │
 * │                                                                          │
 * │   artifacts/vi/doc-1.md   →  artifacts/<plan>/<task>/vi/doc-1.md         │
 * │   artifacts/T-01/x.md     →  artifacts/<plan>/T-01/x.md                  │
 * │   bao-cao.md              →  artifacts/<plan>/<task>/bao-cao.md          │
 * │                                                                          │
 * │ The user keeps the directory structure they wanted, the system keeps its         │
 * │ no-overwrite guarantee, and `whereBlock` prints the REAL path so nobody is        │
 * │ misled. → docs/SPEC-artifacts.md                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent: calling it again on its own output doesn't frame it a second layer deep.
 */
export function outputScoper(
  planId: string,
  taskId: string,
  /**
   * Called when a path outside the office gets pulled back into the frame.
   * The caller uses this to tell the user about it — see `Plan.redirected`.
   * Not passing it keeps behavior identical to the old version.
   */
  onRedirect?: (asked: string) => void,
): (p: string) => string {
  const home = `artifacts/${planId}/${taskId}`;
  return (raw: string): string => {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 AN ABSOLUTE PATH → TAKE THE BASENAME. The old version nested it         │
     * │    inside the frame too, producing an INVALID path.                    │
     * │                                                                      │
     * │ Real case 08/22 22:06, verbatim from `P-260822-2206-ajcd.plan.json`:        │
     * │                                                                      │
     * │   outputs: artifacts/P-…/T-01/ban-ke.md                               │
     * │          | artifacts/P-…/T-01/D:/Downloads/Programs Installation/…    │
     * │                                        ↑ the letters `D:` become a         │
     * │                                          DIRECTORY                       │
     * │                                                                      │
     * │ On Windows, a colon mid-segment is an invalid path, so the worker            │
     * │ burned **7 turns · $0.3158** trying to `mkdir` something that can't            │
     * │ exist, then died at the turn cap. This isn't "rejecting an unsupported          │
     * │ job" — we **made up a broken path and handed it to a worker as its             │
     * │ goal**.                                                              │
     * │                                                                      │
     * │ The POSIX branch is wrong too, just quieter: `/home/an/x.md` gets its         │
     * │ leading slashes stripped by `^\/+` and becomes                              │
     * │ `artifacts/…/home/an/x.md` — valid, but in the wrong place and silently        │
     * │ so.                                                                  │
     * │                                                                      │
     * │ ⚠ Checks BOTH OS conventions, without checking `process.platform`: an           │
     * │ office zipped from a Windows machine to a Linux one still has to read           │
     * │ the exact string written into an old plan. Same reason `SHELL_ALIASES`          │
     * │ sends both names.                                                     │
     * │                                                                      │
     * │ This is NOT the place to enforce "is writing outside allowed" — that           │
     * │ rule belongs to `officeJail`, and today's answer is NO (→ SPEC §1b, §8).        │
     * │ This function's only job: whatever we hand a worker is always a USABLE          │
     * │ path.                                                                │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) {
      // We just rewrote what the user typed. That's a FACT, and hiding it is
      // how a system lies about itself. → `Plan.redirected`
      onRedirect?.(raw);
      const base = raw.replace(/\\/g, '/').split('/').filter(Boolean).pop();
      return base ? `${home}/${base}` : `${home}/ket-qua.md`;
    }

    let rest = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (rest.startsWith('artifacts/')) rest = rest.slice('artifacts/'.length);
    // Strips layers of framing ALREADY PRESENT, in order — this is what keeps it idempotent.
    if (rest.startsWith(`${planId}/`)) rest = rest.slice(planId.length + 1);
    if (rest.startsWith(`${taskId}/`)) rest = rest.slice(taskId.length + 1);
    // `..` and `.` get dropped rather than rejected: this is a model-generated
    // string, and a path climbing back out of `artifacts/` must not exist no
    // matter what the model intended. The real gate still lives in
    // `safeJoin`; this is only the first layer.
    const tail = rest
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..')
      .join('/');
    return tail ? `${home}/${tail}` : `${home}/ket-qua.md`;
  };
}

/**
 * A plan the model just wrote → a RUNNABLE plan. A PURE function, 0 tokens, 0 calls.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS SPLIT OUT FROM `Assistant.plan()` (08/20).                   │
 * │                                                                          │
 * │ Two reasons, and the second is the real one:                            │
 * │                                                                          │
 * │  1. It's a pure function holding FOUR rules that have each had a bug           │
 * │     before — framing inputs, framing outputs, dropping steps nobody does,        │
 * │     defaulting `deliver` from the office config. Buried inside an `async`        │
 * │     method that calls the model, no test suite could ever reach it. → §4         │
 * │     technical debt, priority 0                                            │
 * │  2. **It has TWO callers.** `route()` has an escape hatch: when the model         │
 * │     returns an entire plan while it was supposed to be routing, we're            │
 * │     already holding an ALREADY-PAID-FOR plan — and the rule "a draft worth        │
 * │     fixing beats starting from scratch" forbids throwing it away just to          │
 * │     call `plan()` again.                                                  │
 * │                                                                          │
 * │ Two copies of code for the same transformation will drift — the 08/19 rule,      │
 * │ and a comment saying "⚠ must match the other side" is NOT a mechanism.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function buildPlan(
  draft: PlanDraft,
  request: string,
  planId: string,
  defaultDeliver: Deliver,
): Plan {
  const rawSteps = draft.steps;
  const rawTasks = draft.tasks.map((t) => ({ ...t, step: clampStep(t.step, rawSteps.length) }));

  /**
   * DROPS A STEP WITH NO TASK ASSIGNED TO IT.
   *
   * The model very often writes a step like "Save the results to a file"
   * then assigns no task to it — because that work is already part of the
   * previous task. A step like that can NEVER BE TICKED: it stays stuck at
   * "not done" even after everything else finishes, and the user looking at
   * it assumes the system missed something.
   *
   * Filtered by code rather than by making the model replan: cheaper than an
   * extra call, and deterministic. The prompt already asks for this too, but
   * asking is a suggestion while this is a guarantee.
   */
  const used = new Set(rawTasks.map((t) => t.step));
  const kept = rawSteps.map((title, i) => ({ title, i })).filter((s) => used.has(s.i));
  const remap = new Map(kept.map((s, newIndex) => [s.i, newIndex]));

  const steps: PlanStep[] = kept.map((s) => ({ title: s.title, status: 'pending' }));
  // INPUTS and OUTPUTS go through two different rules — see `outputScoper`.
  const scopeIn = artifactScoper(planId, rawTasks.map((t) => t.task_id));

  /** Paths outside the office that got pulled back into the frame — stated in `finish`. */
  const redirected = new Set<string>();

  const tasks = rawTasks.map((t) => {
    const scopeOut = outputScoper(planId, t.task_id, (asked) => redirected.add(asked));
    return TaskBriefSchema.parse({
      ...t,
      /**
       * ⚠ A CONNECTION IS CARRIED THROUGH UNTOUCHED — and NOT framed.
       *
       * This line used to hardcode `kind: 'file'`, which threw away what the
       * model had declared even after the schema above stopped stripping it.
       * Two places, one fact: the second is the one that keeps working after
       * the first is fixed, so both had to move. → the box on `inputs` above
       *
       * `scopeIn` frames a path into `artifacts/<plan>/<task>/…`. A connection
       * carries a NAME, in the human's own words, and framing it would turn
       * *"the agentco page on Notion"* into a path to nothing.
       */
      inputs: t.inputs.map((i) =>
        i.kind === 'connection'
          ? { kind: 'connection' as const, path: i.path }
          : { kind: 'file' as const, path: scopeIn(i.path) },
      ),
      /**
       * DEDUPLICATES AFTER FRAMING — two different strings can resolve to one.
       *
       * Case 08/22 22:06: the user said *"write it to `D:\…\ban-ke.md`"*, and
       * the Assistant declared TWO destinations (one already framed, one the
       * user's own typed path) — exactly doing its job. After `outputScoper`
       * both collapse to `…/T-01/ban-ke.md`.
       *
       * Without deduplicating, a worker gets a list telling it to write the
       * same file twice, and `validate` doesn't catch it either: the "two
       * tasks writing the same path" check compares ACROSS tasks, not within
       * one task's own list.
       *
       * ⚠ OUTPUTS STAY `file`, deliberately — a `connection` here is forced
       * back, not honoured. A worker writes into the office and nowhere else;
       * writing back into a service is a whole feature with its own approval
       * question, and it must not arrive by way of a field default.
       */
      outputs: [...new Set(t.outputs.map((o) => scopeOut(o.path)))].map((p) => ({
        kind: 'file' as const,
        path: p,
      })),
      step: remap.get(t.step) ?? 0,
      // The OFFICE's default, not the schema's default. This is the spot
      // where the deterministic lever actually has to take effect: the model
      // staying silent means following the config the user already set,
      // rather than silently falling back to 'file'.
      deliver: t.deliver ?? defaultDeliver,
    });
  });

  return {
    plan_id: planId,
    request,
    steps,
    tasks,
    ...(redirected.size ? { redirected: [...redirected] } : {}),
  };
}

/**
 * The "what is this job" sentence for a plan draft — INFERRED FROM DATA, 0 tokens.
 *
 * `PlanRecord.request` is what the user reads in `/status` and in the work
 * log. In the usual case it's written by `route()` ("rewrite the request as
 * one clear sentence"). At the escape hatch we don't have that sentence —
 * but we have each task's `goal`, which is required to have that exact same
 * shape: *one clear sentence, in the user's own words*. Reuses what's
 * already in hand instead of asking for another turn.
 *
 * ⚠ Does NOT use the exact sentence the user just typed: that sentence is
 * often *"sure, any of them is fine"* — correct but meaningless read back in
 * the log three days later.
 */
export function requestOf(draft: PlanDraft): string {
  return truncateToTokens(draft.tasks.map((t) => t.goal.trim()).filter(Boolean).join(' · '), 120);
}

/**
 * The MEANING of the `runs commands` flag, stated EXACTLY ONCE at the top of
 * the directory. → `Assistant.reach`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS SENTENCE HAS TO BE NARROW, BECAUSE A BROAD NEGATIVE IS A LIE.            │
 * │                                                                          │
 * │ The real boundary today (`types.ts §BUILTIN_TOOLS`, measured 08/22):          │
 * │                                                                          │
 * │   READ    `Read`/`Glob`/`Grep`  → NO fence, reaches ANY path                 │
 * │   WRITE   `Write`/`Edit`        → has the `officeJail` fence                 │
 * │   COMMAND `Bash`                → no fence                                 │
 * │                                                                          │
 * │ So *"no shell"* does NOT mean *"can't reach your machine"*. A bare role         │
 * │ can still open `D:\Records\contract.pdf` with `Read`. Writing a broad           │
 * │ negative teaches the Assistant to refuse work it's actually capable of —        │
 * │ a failure in the opposite direction, and quieter than case 9.3 because          │
 * │ nobody even sees the refusal happen.                                     │
 * │                                                                          │
 * │ The proof sits right inside 9.3 itself: a worker reported *"Glob only            │
 * │ returns file paths"* — meaning Glob had ALREADY successfully reached            │
 * │ `D:\Downloads`. It was missing a column, not a path.                        │
 * │                                                                          │
 * │ ⇒ States exactly what the shell adds: file metadata, and writing outside.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ WHY IT DOESN'T SAY "the shell is the ONLY way to get a file size".          │
 * │                                                                          │
 * │ The first draft of this sentence said exactly that. It's CORRECT today —        │
 * │ none of the 7 default tools return metadata — but it's a claim about the        │
 * │ WHOLE WORLD, so it **stops being true the exact day MCP shows up**: an          │
 * │ MCP filesystem server returning `size`/`mtime` turns this sentence into a         │
 * │ lie, and lies in the direction of the Assistant REFUSING work it could           │
 * │ actually do.                                                              │
 * │                                                                          │
 * │ A user caught this hole before MCP even existed yet (08/22): *"the worker        │
 * │ has no shell but has plenty of other tools, other MCPs — does the                │
 * │ Assistant just assume and block it?"*. Yes. And it would block SILENTLY.         │
 * │                                                                          │
 * │ ⇒ Replaced with an invariant that's SELF-CORRECTING: *"each person's line        │
 * │   lists EVERYTHING they can reach"*. That's a claim about FORMAT, not           │
 * │   about the world — and `reach()` enforces it literally (`[...role.mcp]`         │
 * │   goes first).                                                            │
 * │   No matter how many capabilities get added later, the sentence stays          │
 * │   correct, no edit needed.                                                │
 * │                                                                          │
 * │ ✅ THIS DEBT WAS PAID 08/26 — after a user ran straight into it.               │
 * │                                                                          │
 * │ The old debt: *"that line lists MCP servers by NAME (`notion`), not by          │
 * │ CAPABILITY. The Assistant knows 'can reach Notion', not 'can write a           │
 * │ file'."*                                                                 │
 * │                                                                          │
 * │ Real case: a user switched an arm to full access, and the Assistant still       │
 * │ refused with **the exact same old sentence**. It wasn't being stubborn —        │
 * │ it had no fact available to know otherwise.                              │
 * │                                                                          │
 * │ Solvable because `arms[].level` only started existing 08/26. `armReach`         │
 * │ now prints the tier right above the worker's own line. Missing `level`          │
 * │ (a folder arm · a hand-pasted one) ⇒ prints nothing — making up a               │
 * │ capability for something that never declared it would just rebuild this         │
 * │ exact bug.                                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const SHELL_LEGEND =
  'Every employee CAN OPEN files on the human’s machine given a full path — read the contents, ' +
  'list file names. "shell: ON" adds: running arbitrary commands or scripts on that machine, ' +
  'and writing outside the office folder.\n' +
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴🔴 THIS SENTENCE WAS A LIE, AND IT WARNED ABOUT ITSELF SINCE 08/22.          │
   * │                                                                          │
   * │ The old version: *'"runs commands: ON" adds: **file size · modified date ·      │
   * │ byte count**'*. A case a user hit 08/24, with a filesystem arm properly          │
   * │ plugged in, shell OFF:                                                    │
   * │                                                                          │
   * │   *"The worker in charge of the Musics folder has command-running turned         │
   * │    off, so it can't get the file size… Could you turn on command-running          │
   * │    for this worker?"*                                                     │
   * │                                                                          │
   * │ **Wrong, and measurably wrong.** `spike-arm-e2e` case A ran with                │
   * │ `role.tools` forced to `[]` (shell FULLY OFF) and still produced a               │
   * │ complete size table: `Programs Installation 2 · list directory with              │
   * │ sizes` → `done`. The filesystem arm has **14 tools**, and                        │
   * │ `list_directory_with_sizes` and `get_file_info` return exactly the                │
   * │ metadata this sentence claimed was the shell's exclusive privilege.              │
   * │                                                                          │
   * │ ⚠⚠ AND HERE'S THE EXPENSIVE PART: the comment block right ABOVE this             │
   * │ constant, written 08/22, had stated exactly what would happen — *"it            │
   * │ stops being true the exact day MCP shows up… lies in the direction of            │
   * │ the Assistant REFUSING work it could actually do"*. That day's fix only          │
   * │ removed the word **"ONLY"** while **keeping the causal claim intact**.           │
   * │ And there was even a test guarding the word "ONLY" — **that test stayed          │
   * │ GREEN the whole time, while the bug stayed alive**. Fixed the wording, not        │
   * │ the claim.                                                                │
   * │                                                                          │
   * │ ⇒ Rule: **never list CAPABILITIES by vendor.** State only what the shell         │
   * │   is genuinely exclusive to (running arbitrary commands · writing outside),      │
   * │   then let the last line state an invariant about FORMAT, not about the          │
   * │   world.                                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  'A connection (🔌) brings its OWN capabilities, and the employee finds out what it can call at ' +
  'the moment of doing the work. DO NOT decide on their behalf that an employee CANNOT do something ' +
  'just because "shell: OFF" — hand it over, and they will report a missing tool themselves. Each ' +
  'person’s line lists EVERY place they reach; there is nothing beyond that list.\n' +
  /**
   * The other half of the `armLine` fix, and WITHOUT IT THE OTHER HALF MAKES NO SENSE.
   *
   * Knowing the path and still asking again is exactly the case a user hit —
   * only difference is that back then the Assistant genuinely didn't know,
   * while from here on it knows but might still ask "just to be sure". One
   * unnecessary round of asking with a non-technical user is one more time
   * they conclude the product doesn't understand them.
   *
   * ⚠ This sentence has to be NARROW: it only talks about a folder ALREADY
   * PRINTED on the worker's own line. Writing it broadly as "never ask for a
   * path" would teach the Assistant to guess blindly at a path it's never
   * seen — a failure in the opposite direction, and quieter.
   */
  'A folder written after "folders:" is one that employee has ALREADY been granted. When the human ' +
  'says "the folder you have access to", or names one of the folders in that list, USE that path ' +
  'directly — do not ask them for the full path again.';

/**
 * A single role's shell flag. Split out so it's testable without building a
 * whole office — same reason `resolveInput` was once pulled out: a rule that
 * was wrong once has to be callable on its own to be guarded. See the `⚠
 * CORRECTED` block on `Assistant.reach`.
 *
 * ALWAYS returns a string, never empty. That's exactly where the old version was wrong.
 */
export function shellFlag(tools: readonly string[]): string {
  return hasShell(tools) ? 'shell: ON' : 'shell: OFF';
}

/**
 * One arm, stated in terms the Assistant NEEDS — not in terms of what we store.
 *
 * A PURE function, split out of `Assistant` for the same reason `shellFlag`
 * was once pulled out: a rule that was wrong once has to be callable on its
 * own to be guarded, not require building a whole office to test.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 A CASE A USER HIT 08/24, THREE TURNS IN A ROW, UNABLE TO ESCAPE:            │
 * │                                                                          │
 * │   — "Within the folder I've granted, find the 5 largest files…"               │
 * │   — "Could you give me the full path of the folder to look through?"           │
 * │   — "the music folder"                                                    │
 * │   — "Could you give me the full path to that Music folder?"                    │
 * │   — "your worker already knows this folder"                                │
 * │   — "I still need the full path…"                                          │
 * │                                                                          │
 * │ **The Assistant wasn't being stubborn — it genuinely DIDN'T KNOW.**            │
 * │ `role.mcp` is just an array of HASHES (`a385afc3ab6`), and the old version       │
 * │ dumped that array straight into the capability line. A hash can't say            │
 * │ where it points, so *"the folder I've granted"* was unsolvable — while           │
 * │ `company.yaml` knew perfectly well. The user was exactly right: *"your          │
 * │ worker already knows this folder"*.                                        │
 * │                                                                          │
 * │ This is debt already NAMED since 08/22 right in this file: *"that line          │
 * │ lists MCP servers by NAME, not by CAPABILITY — a server name is a CLAIM,        │
 * │ its own tool list is the TRUTH"*. This case is that debt collecting              │
 * │ interest, and luckily in the cheapest form to pay off: the folder already        │
 * │ sits in `args`, `folderRoots` already exists, 0 extra calls, ~12 tokens          │
 * │ per arm.                                                                 │
 * │                                                                          │
 * │ ⚠ Writes `folder:` rather than using an arrow or a bare colon — this line        │
 * │ sits inside a list block and has to be SELF-READABLE standing alone, same        │
 * │ rule already applied to `runs commands: OFF`.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armReach(
  arms: Record<
    string,
    { label?: string; level?: 'read' | 'add' | 'full'; catalog?: string; does?: string[] }
  >,
  servers: Record<string, unknown>,
  id: string,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE BRIDGE FROM THE NAME A USER CALLS SOMETHING → THE TOOL NAME THE MODEL       │
   * │ SEES. (user asked 08/26)                                                 │
   * │                                                                          │
   * │   *"what about a non-Latin label — the label field doesn't affect the           │
   * │    hash ⇒ that's a dead end…"*  · *"have you thought about the case of duplicate │
   * │    labels?"*                                                             │
   * │                                                                          │
   * │ Two questions, one shared hole: `armKeys` could only build a readable key       │
   * │ from a label, and a **non-Latin** label (文档 · 회계) produces an empty        │
   * │ string, while **duplicate** labels both have to fall back to the hash.          │
   * │ Both paths land in the same place: the model sees                              │
   * │ `mcp__a46a7e26403__…` again and has no idea which arm that is.                 │
   * │                                                                          │
   * │ ⇒ The way out does NOT live in the name — it lives in the **directory           │
   * │ line**. When a name can't carry information, put the information right          │
   * │ next to it:                                                              │
   * │                                                                          │
   * │     文档 — read-only · call via mcp__a46a7e26403__*                     │
   * │                                                                          │
   * │ This is NOT "adding an instruction" (something that's already lost three         │
   * │ times). It's a **mapping placed on the exact line carrying the name** —          │
   * │ exactly the pattern that already won for `runs commands: OFF` and                │
   * │ `shortcut to`. → [[agentco-prompt-rules-lose-to-examples]]                │
   * │                                                                          │
   * │ ⚠ States it ONLY when needed: when the key **can be inferred from the           │
   * │ label**, the model bridges it itself, and pasting a technical string onto        │
   * │ every single line pays tokens for something useless — while also teaching        │
   * │ the model that such strings are noise, so it skips right past the one            │
   * │ time the string actually matters.                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  toolKey?: string,
): string {
  // The hash is the LAST resort: a label the user set is what they actually recognize.
  const label = arms[id]?.label?.trim() || id;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 PAYS OFF DEBT RECORDED SINCE 08/22 — and a user just ran straight into        │
   * │ it 08/26.                                                                │
   * │                                                                          │
   * │ The debt, verbatim in `SHELL_LEGEND`: *"that line lists MCP servers by          │
   * │ NAME (`notion`), not by CAPABILITY. The Assistant knows 'can reach              │
   * │ Notion', not 'can write a file'. Not yet solved."*                             │
   * │                                                                          │
   * │ Real case: a user switched an arm to **full access**, then asked *"create        │
   * │ a Notion page for me"* — the Assistant answered with **the exact same           │
   * │ old sentence**: *"can only read Notion, can't create or write new                │
   * │ pages"*. It wasn't being stubborn: **it had no fact available to know            │
   * │ otherwise.** The directory line only recorded a name, and a name says            │
   * │ nothing about permissions.                                                │
   * │                                                                          │
   * │ ⚠ And here's where that debt costs double: the Assistant guesses **in the       │
   * │ direction of REFUSAL**. The exact same shape as the `runs commands: OFF`         │
   * │ case (§SHELL_LEGEND) — *lying in the direction that makes the Assistant           │
   * │ refuse work it could actually do*, a second time, one layer down.               │
   * │                                                                          │
   * │ Solvable NOW because `arms[].level` only started really existing 08/26 —         │
   * │ before that there was nothing to print. Three words, sitting **on the           │
   * │ worker's own exact line** — exactly the [[agentco-prompt-rules-lose-to-         │
   * │ examples]] rule: a condition has to sit at the point it loses, not as an         │
   * │ instruction added at the top of a block.                                  │
   * │                                                                          │
   * │ ⚠ Missing `level` ⇒ **prints nothing**. A folder arm and a hand-pasted           │
   * │ arm have no tier at all, and making up "full access" for them would just         │
   * │ rebuild the exact bug just fixed — guessing a capability for something           │
   * │ that never declared it.                                                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const LEVEL: Record<string, string> = {
    read: 'read only',
    add: 'read + create new, no editing or deleting',
    full: 'read + write + edit/delete',
  };
  const level = arms[id]?.level ? LEVEL[arms[id]!.level!] : undefined;
  const roots = folderRoots(servers[id]);
  /**
   * THE DIRECTORY: house name → house address. Only printed when the call site
   * passes `toolKey`, i.e. when a role has **two or more arms** — one arm has
   * nothing to confuse, and pasting a technical string onto every line pays
   * tokens for something useless.
   */
  const bridge = toolKey ? ` · call it with mcp__${toolKey}__*` : '';
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THE ACTUAL LAUNCH MODE HAS TO SIT ON THIS LINE — otherwise the               │
   * │ Assistant describes the CATALOG'S DEFAULT and calls it the user's own            │
   * │ config. (real case 08/29)                                                  │
   * │                                                                          │
   * │ A user plugged in a browser arm **with "remember sign-in" checked**, then        │
   * │ asked it to open a page to sign in on its own. The Assistant answered, four       │
   * │ turns straight, roughly *"the session isn't kept, there's no way to save          │
   * │ it"* — while the profile **was** being saved (proof: the email field                │
   * │ auto-filled, and a 142 MB profile sitting on disk).                          │
   * │                                                                          │
   * │ It wasn't making things up: the only fact it had was the **catalog             │
   * │ entry's** `blurb`, and that blurb describes the DEFAULT — *"a clean               │
   * │ browser, no sign-in kept"*. True of the catalog entry, false of the arm            │
   * │ actually plugged in.                                                      │
   * │                                                                          │
   * │ ⚠ And it was wrong **in the direction of REFUSAL**, the third time this          │
   * │ exact shape has happened (`runs commands: OFF` · a missing `level` · and          │
   * │ now the launch mode). The same fix: read from the **saved config**, print         │
   * │ it **on the worker's own exact line**.                                     │
   * │ → `catalog.ts §activeOptions` · [[agentco-prompt-rules-lose-to-examples]]       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const entry = arms[id]?.catalog ? findArm(arms[id]!.catalog!) : undefined;
  /**
   * `tEn`, not `t`: this clause lands in the assistant's PREFIX, and a prompt
   * never follows the interface switch. → `i18n/index.ts §tEn` · the two worlds
   */
  const opts = entry ? activeOptions(entry, servers[id]).map((o) => tEn(o.label).toLowerCase()) : [];
  // One list, not two sentences: the permission tier and the launch mode both
  // answer the question *"what CAN this arm do"*, so they read fine standing
  // side by side or separately — but merging them leaves no spot for either
  // half to get forgotten.
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CAPABILITIES IN PLAIN HUMAN WORDS — the other half of the debt recorded       │
   * │ 08/22. (measured 08/30, `scripts/spike-cli-arm.ts`, broke 3/3 turns)            │
   * │                                                                          │
   * │ A catalog entry's `hint` had already done this exact job since 08/29, but        │
   * │ it could only be reached **through `catalog`**. A hand-pasted arm and a           │
   * │ CLI arm have no catalog entry at all ⇒ their line is EXACTLY ONE NAME, and         │
   * │ facing a name the model has never seen before (`Command Shop`), the model         │
   * │ **fills in the gap itself**: one turn made up the result outright, another        │
   * │ wrote a brief *"via a shell command"* and the worker got blocked.               │
   * │                                                                          │
   * │ ⚠ WHY THIS DOESN'T VIOLATE §7b (*"do NOT list raw tool names"*): §7b            │
   * │ forbids pasting 15 machine tool names into the prefix of EVERY chat turn.        │
   * │ This is a HUMAN-readable sentence, has a **CAP OF 4**, and only shows up          │
   * │ for a role that has that exact arm. Absent ⇒ prints nothing ⇒ every arm            │
   * │ today stays byte-for-byte unchanged.                                       │
   * │                                                                          │
   * │ ⚠ The cap of 4 + "and N more actions" is the same discipline as               │
   * │ `reachDiff`'s constraint 2: a 20-command arm must not stuff a whole wall           │
   * │ into the prefix of every turn.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const DOES_CAP = 4;
  const all = (arms[id]?.does ?? []).map((s) => s.trim()).filter(Boolean);
  const does = all.length
    ? all.length > DOES_CAP
      ? `${all.slice(0, DOES_CAP).join(' · ')} · and ${all.length - DOES_CAP} more actions`
      : all.join(' · ')
    : undefined;
  // `does` comes AFTER `level`/`opts`: those two answer *"how far is it allowed
  // to reach"*, `does` answers *"what can it actually do"*. Permission first,
  // action second — and putting it last means every arm currently running
  // doesn't change by a single character (they have no `does`).
  const bits = [level, ...opts, does].filter(Boolean) as string[];
  const shortcut = roots.length ? ` (shortcut to ${roots.join(' · ')})` : '';
  /**
   * The catalog entry's warning sentence — LAST, after the tool-name bridge.
   *
   * Last because it's the longest sentence: an eye (and a model) reads the
   * label · permission · launch mode first, then the warning. Placing it in
   * the middle would push `call via mcp__…__*` — what the model needs to
   * **call the right tool** — behind a paragraph.
   */
  const hint = entry?.hint ? ` — ⚠ ${entry.hint}` : '';
  if (bits.length) return `${label} — ${bits.join(' · ')}${shortcut}${bridge}${hint}`;
  if (bridge || hint) return `${label}${shortcut}${bridge}${hint}`;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ "SHORTCUT TO", NOT "FOLDER". One word, and it fixes a real broken case.        │
   * │ (user settled 08/24: *"MCP is a plugged-in folder, not an onlyAllows"*)         │
   * │                                                                          │
   * │ The old version wrote `Musics (folder: D:\…\Musics)`. The Assistant read         │
   * │ that list as **the worker's total reach** and REFUSED work outside it —          │
   * │ even when that person had `runs commands: ON`, even in a totally clean            │
   * │ `/clear` session. Measured 08/24, reproduced repeatedly. But it was WRONG:        │
   * │ `SHELL_LEGEND` right at the top of the directory had already stated *"every       │
   * │ worker CAN open a file on this machine given a full path"*.                     │
   * │                                                                          │
   * │ ⇒ The prompt was NOT missing the fact — that fact **lost to position**. The       │
   * │ general sentence sits at the top of the block, a string that LOOKS like a          │
   * │ scope limit sits on the worker's OWN LINE, and the line wins. Exactly the         │
   * │ rule that has already cost us twice:                                        │
   * │ [[agentco-prompt-rules-lose-to-examples]] — *a condition has to sit on the         │
   * │ exact line carrying the example*, and the `runs commands: OFF` case (§1310)        │
   * │ had already learned this lesson.                                          │
   * │                                                                          │
   * │ So the fix does NOT add yet another instruction (the instruction already          │
   * │ existed and already lost). It changes **one word, exactly at the losing            │
   * │ spot**: `folder` → `shortcut to`. Same token cost, no new rule to remember.        │
   * │                                                                          │
   * │ ⚠ This word has to match what the system ACTUALLY does. Today an arm is a          │
   * │ genuine shortcut: `Read`/`Glob` reach any path, so does `Bash` — an MCP            │
   * │ server's allowlist only constrains ITSELF. The day §14 #1 changes (building        │
   * │ a read fence), this word has to change back to one that states a real             │
   * │ limit, in the same change.                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  return roots.length ? `${label} (shortcut to ${roots.join(' · ')})` : label;
}

/**
 * CAPABILITY DIFF between two turns — a PURE function, 0 tokens. →
 * docs/SPEC-arms.md §15f
 *
 * "Capability" covers **arms** and the **shell switch** — everything on the
 * capability line of `roster()` that the user can toggle. These two travel
 * together because they break the same way: the user changes something, the
 * prompt updates on the very next turn, and the model still answers with its
 * own old sentence.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A DIFF BEATS A GENERIC REMINDER LINE — and the reason is NOT "the           │
 * │ session remembers it".                                                  │
 * │                                                                          │
 * │ Measured 08/24, three independent cases, the same shape:                       │
 * │                                                                          │
 * │   a line APPEARS in the directory   → **wins** over history, every time         │
 * │     · spike L4: plugged in `Hoa Don` → called it by name on the very next        │
 * │       turn                                                              │
 * │     · a real case at 03:43:01: wired up `Musics` → the model **reversed          │
 * │       its own THREE consecutive refusals**, no `/clear` needed                  │
 * │   a line DISAPPEARS                  → **loses** to history (case 02:34:13)      │
 * │                                                                          │
 * │ ⇒ The asymmetry is in the SHAPE OF THE SIGNAL, not in caching and not in         │
 * │ update speed. Literally [[agentco-deterministic-vs-signal]]: *absence is         │
 * │ not a signal.*                                                          │
 * │                                                                          │
 * │ So the right move isn't a louder instruction, it's **changing the axis**:        │
 * │ turn an ABSENCE into a PRESENCE. The line `− Notion ✗ ho-tro` is a line of        │
 * │ text that *appears* — and something that appears is exactly what we just         │
 * │ measured to win.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three constraints, each blocking a different way this could break:
 *
 *  1. **A DELTA, not a changelog.** Only describes the change since the last
 *     turn, and inserts it exactly once, on the turn it happened. Fiddling
 *     with the canvas 20 times means 20 lines scattered through the
 *     transcript — acceptable; a 20-line block resent on EVERY turn after
 *     that is not, and that's exactly the permanent-bloat pattern this whole
 *     project avoids.
 *  2. **`cap`.** A single mass edit on the diagram must not stuff a whole
 *     wall into the session.
 *  3. **Trimmed down to a LABEL.** The directory right above already has the
 *     full folder path; the diff exists only to POINT, not to be a source.
 *     Pasting the exact just-trimmed path back in would hand-inject the
 *     exact string this was built to stop repeating.
 */
export function reachDiff(
  before: Map<string, readonly string[]>,
  after: Map<string, readonly string[]>,
  cap = 4,
): string[] {
  // `armReach` returns `Label (shortcut to …)`. The diff keeps only the label — constraint 3.
  const short = (s: string) => s.replace(/\s*\(shortcut to .*$/, '').trim();
  const lines: string[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = new Set(before.get(id) ?? []);
    const now = new Set(after.get(id) ?? []);
    for (const a of now) if (!was.has(a)) lines.push(`+ ${short(a)} → ${id}`);
    for (const r of was) if (!now.has(r)) lines.push(`− ${short(r)} ✗ ${id}`);
  }
  if (lines.length <= cap) return lines;
  return [...lines.slice(0, cap), `and ${lines.length - cap} more changes`];
}

/**
 * The PURE part of the post-check gate — 0 tokens, split from the class to be
 * independently testable. The three-condition rule and its boundaries live
 * in `Assistant.staleArmMentions`.
 */
export function staleMentions(input: {
  /**
   * The company's arm ledger — `label`, and the **account name** if it's an
   * OAuth arm.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `via` ADDED 08/28 BECAUSE THIS GATE HAD JUST LET A REAL CASE THROUGH.        │
   * │                                                                          │
   * │ A user disconnected the `hubot` account, and the Assistant then asked:          │
   * │   *"Is the 'focus-flow' repo under the octocat GitHub account or                │
   * │    hubot?"*                                                              │
   * │                                                                          │
   * │ The gate didn't fire, and it **didn't break any rule** — it only compared        │
   * │ against `label`, i.e. the string `"GitHub · hubot"`. The sentence above          │
   * │ doesn't contain that exact string.                                        │
   * │ Folder arms don't hit this hole because their labels are USUALLY quoted          │
   * │ verbatim (`D:\Downloads\…`); for an OAuth arm, the account name is what          │
   * │ people actually mention, while the `"GitHub · "` part gets dropped.             │
   * │                                                                          │
   * │ ⇒ A third needle: **the account name standing alone**. It's not a new field      │
   * │ — `via` already exists, looked up from `arms[].secrets` against the OAuth        │
   * │ store, and is already used in the reuse list + the canvas node. This is a         │
   * │ third place reading the same fact, not a second mechanism. →                    │
   * │ `company.ts §listArms`                                                    │
   * │                                                                          │
   * │ ⚠ THE BOUNDARY DOESN'T CHANGE: still catches NAMES, not ROUNDABOUT phrasing.     │
   * │ Still narrowed, not yet closed. [[agentco-deterministic-vs-signal]]              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  arms: Record<string, { label?: string; via?: string }>;
  /** Each arm's config — `folderRoots` reads `args` from here. */
  servers: Record<string, unknown>;
  /** Ids of arms that CURRENTLY have at least one worker wired in. */
  live: Set<string>;
  say: string;
  userText: string;
}): string[] {
  const { arms, servers, live, say, userText } = input;
  // Names/directories of arms that are STILL wired — condition 3.
  const liveText = [...live]
    .flatMap((id) => [arms[id]?.label, arms[id]?.via, ...folderRoots(servers[id])])
    .filter((s): s is string => !!s)
    .join('\n')
    .toLowerCase();

  const hay = say.toLowerCase();
  const said = userText.toLowerCase();
  const hits: string[] = [];
  for (const id of Object.keys(servers)) {
    if (live.has(id)) continue;
    /**
     * ⚠ A 4-character threshold, and it's a fence, not a nice round number: if
     * a user names an arm `A` or `Hs`, every sentence would contain that
     * string, and the gate would fire on every single turn. Better to miss a
     * two-letter label than turn the gate into noise — it's already a second
     * layer of defense.
     */
    const needles = [arms[id]?.label, arms[id]?.via, ...folderRoots(servers[id])].filter(
      (s): s is string => typeof s === 'string' && s.trim().length >= 4,
    );
    for (const n of needles) {
      const k = n.trim().toLowerCase();
      if (!hay.includes(k)) continue;
      if (said.includes(k)) continue;
      if (liveText.includes(k)) continue;
      hits.push(n.trim());
    }
  }
  return [...new Set(hits)];
}

export class Assistant {
  private sessionId: string | undefined;
  /**
   * The turn CURRENTLY IN FLIGHT — a handle for `/stop` to interrupt. →
   * SPEC-tools-approval.md §11e
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BEFORE 08/20 THERE WAS NO HANDLE AT ALL, and a user measured it on the         │
   * │ very first try.                                                          │
   * │                                                                          │
   * │ `Office.stop()` interrupts a worker (`Scheduler.interruptAll`), clears the       │
   * │ mailbox, drops deferred work — three things, exactly as §11e states. But        │
   * │ the Assistant's OWN turn (`route`/`plan`/`report`) runs inside `run()`          │
   * │ below, and there was nothing there to interrupt at all. Typing `/stop`          │
   * │ while the Assistant is mid-thought lets it finish thinking, reply, and           │
   * │ still charge money — after the screen has already said "Stopping                │
   * │ everything".                                                              │
   * │                                                                          │
   * │ This does NOT contradict the rule *"let it finish by default, don't kill        │
   * │ it"* (§11f). That rule protects a worker's ALREADY-PAID-FOR DRAFT: killing        │
   * │ it at 80% throws away 80% of the money already spent. A `route()` turn           │
   * │ produces no draft at all — interrupting it only costs one answer, exactly        │
   * │ the thing the user just said to stop.                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ `abortController`, NOT `Query.interrupt()`. This lesson already cost money
   * once at `worker.ts` (§8, both ways of interrupting via `interrupt()` are
   * broken) — copies the exact mechanism already measured to work instead of
   * retrying something already known not to.
   */
  private inflight: AbortController | undefined;
  /** Roles wired from the Assistant on the canvas. undefined = not configured = all of them. */
  private assignable: Set<string> | undefined;
  /**
   * The directory snapshot from the PREVIOUS `route` turn. → `reachMap`,
   * `SPEC-arms.md` §15
   *
   * `undefined` = hasn't routed even once in this session, so there's nothing
   * to compare against.
   */
  private reachPrev: Map<string, string[]> | undefined;

  /**
   * The human's OWN last sentence, verbatim — the only evidence of how they
   * write. → `undrift`, `core/language-drift.ts`
   *
   * Their words, never ours: our prompts are English by construction, and a
   * document they uploaded was written by someone else. Empty until they have
   * actually said something, and an empty one produces no finding rather than
   * a guess.
   */
  private lastHuman = '';
  /** HOT knowledge preloaded into the prefix. Only changes when knowledge_version bumps. */
  private hotKnowledge = '';

  constructor(private office: LoadedOffice) {}

  get session(): string | undefined {
    return this.sessionId;
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THE DIRECTORY SNAPSHOT HAS TO SURVIVE A DAEMON RESTART — bug 08/26.         │
   * │                                                                          │
   * │ `sessionId` gets SAVED TO DISK (`.state/assistant-session.json`) so the         │
   * │ conversation survives a restart. `reachPrev` used to live **ONLY IN RAM**.       │
   * │ Consequence:                                                             │
   * │                                                                          │
   * │   restart → history STAYS INTACT (including every old refusal)                 │
   * │           → `reachPrev === undefined` ⇒ **the diff turns off**                 │
   * │           → the model follows history, exactly as measured in §15f              │
   * │                                                                          │
   * │ ⇒ The mechanism built to fight *"the old sentence beats history"* gets            │
   * │ disabled **at the exact moment it's needed most**: right after a restart,        │
   * │ i.e. exactly when config is most likely to have just changed. It fails           │
   * │ silently, because silence is its own default behavior.                        │
   * │                                                                          │
   * │ Two things that travel as a pair have to persist at the same level.             │
   * │ Mismatched persistence is a failure class, not a detail.                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  resumeFrom(sessionId: string | undefined, reach?: Record<string, string[]>): void {
    this.sessionId = sessionId;
    // No snapshot ⇒ keep `undefined` (nothing to compare against). One exists
    // ⇒ rebuild the exact shape `reachMap()` returns, so `reachDiff` can
    // compare on the very first turn.
    this.reachPrev = reach ? new Map(Object.entries(reach)) : undefined;
  }

  /** The directory snapshot, saved alongside the session pointer. → `Office.saveSessionId` */
  get reachSnapshot(): Record<string, string[]> | undefined {
    return this.reachPrev ? Object.fromEntries(this.reachPrev) : undefined;
  }

  /**
   * Interrupts the in-flight turn. Returns `true` if there was actually
   * something to interrupt.
   *
   * The return value is what `Office.stop()` uses to state EXACTLY what just
   * happened — "stopping" when there was a real interrupt, and no promise at
   * all when there wasn't. Guessing at the layer above is exactly how
   * `/stop`'s reply already got it wrong once.
   */
  abort(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  /**
   * How big is the current context — measured, not estimated.
   *
   * On a WARM cache turn, `cache_read` is exactly the whole prefix + the
   * conversation record the server just reread. That's a real number, free,
   * and it's what decides when compaction is needed. Hand-counting tokens
   * sent would be both wrong and redundant.
   *
   * ⚠ Does NOT include a worker's tokens: a worker runs with
   * `persistSession: false` in its own separate `query()`, and so does the
   * planning step. Only `route()`/`report()` grow this record.
   */
  contextTokens = 0;

  /** Forgets the conversation: the next turn starts a brand-new session. */
  forget(): void {
    this.sessionId = undefined;
    this.contextTokens = 0;
    // A new session means empty history ⇒ no old sentence left to correct.
    // Keeping the old snapshot would make the new session's first turn fire
    // a meaningless diff.
    this.reachPrev = undefined;
  }

  /**
   * COMPACTS MEMORY: asks the Assistant for the one part only it knows. →
   * docs/SPEC-offices.md §4.6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `skeleton` IS BUILT BY CODE, NOT ASKED OF THE MODEL.                     │
   * │                                                                          │
   * │ Which jobs ran, where the output is, what it cost — all of that sits in         │
   * │ `tasks/index.json` and in receipts. Making the model recount it means           │
   * │ paying money to get back a copy that could be wrong. We feed in the facts,       │
   * │ and only ask for what exists NOWHERE else: what the user likes, what's           │
   * │ been decided, what's still in progress.                                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Runs ON the old session — it has to, since the whole point is reading a
   * record that's about to be discarded.
   */
  async compact(skeleton: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.askSession(
      `A new conversation is about to start. Here is the work that has run (system data — do NOT recount it):\n\n` +
        `${skeleton}\n\n` +
        Assistant.COMPACT_RULES,
    );
    return { value: text.trim(), usage };
  }

  /** After the office is reloaded from disk. Keeps the session intact. */
  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  /**
   * THE RULE BLOCK FOR A MEMORY-COMPACTION TURN — split out of the function
   * body so it can be **locked down by a test**.
   *
   * Not meant to be reused anywhere: it has exactly one call site. The reason
   * is that these rules were born from expensive real failures (08/29 · 08/31)
   * and each rule is a line of prose — the single easiest thing in the whole
   * codebase to "tidy up", and deleting it would turn **no test red**, because
   * a compaction turn's output is inherently non-deterministic.
   * → [[agentco-detect-fix-pair-scope]]: lock it down with a test, not a comment.
   */
  static readonly COMPACT_RULES: string =
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 MERGE, DON'T REWRITE FROM SCRATCH — bug fixed 08/20.                │
         * │                                                                  │
         * │ `addAssistantMemory(..., assistantMemoryIds())` makes the new             │
         * │ version `supersedes` **EVERY** currently-live memory record, then         │
         * │ `pruneNow()` → `dropSuperseded()` **PERMANENTLY DELETES** them from        │
         * │ disk.                                                             │
         * │                                                                  │
         * │ The old prompt version only said *"write down what you need to           │
         * │ remember"* and said not one word about the MEMORY block already          │
         * │ sitting in context.                                              │
         * │ So every `/clear` was a round of **summarizing the summary**:           │
         * │ anything not mentioned in the session just ended never got rewritten     │
         * │ by the model, and it **vanished permanently**. A decision the user         │
         * │ settled a month ago evaporates after three clean-ups, silently, with       │
         * │ nobody told.                                                      │
         * │                                                                  │
         * │ This is exactly the failure class `supersedes` exists to prevent, just    │
         * │ used backwards: `supersedes` is meant to **replace one stale version**,    │
         * │ not to **replace all of memory with the latest snapshot**.               │
         * │                                                                  │
         * │ The model HAS already seen the MEMORY block (it sits in this exact         │
         * │ turn's own prefix) — the only thing missing was a sentence telling it      │
         * │ to carry it forward.                                             │
         * │                                                                  │
         * │ ⚠ BUT "CARRY FORWARD" ALONE IS HALF THE RULE, and the other half is        │
         * │ just as dangerous — a user pointed this out the moment they read the       │
         * │ draft. An old decision that WAS WRONG, already replaced by a new one,       │
         * │ still gets copied forward "because it was in old memory", and now the       │
         * │ store has TWO lines contradicting each other with nobody knowing which      │
         * │ one wins. That's exactly what `supersedes` exists to block at the NODE      │
         * │ level (*"after three months the store fills with contradicting              │
         * │ decisions, worse than not compacting at all"*) — here it recurs at the      │
         * │ LINE level, inside one single node.                              │
         * │                                                                  │
         * │ So the rule has to be TWO-DIRECTIONAL and ORDERED: carrying forward is     │
         * │ the default · the newer one wins on conflict · one line per topic.        │
         * └──────────────────────────────────────────────────────────────────┘
         */
        `Your context already holds a "What the human has decided" block — that is the MEMORY SO FAR, ` +
        `and what you write now REPLACES it entirely. Five rules, in this order:\n` +
        `1. CARRY OVER every old entry that still holds. Dropping one because "this session did not ` +
        `mention it" loses a decision the human already made.\n` +
        `2. Any old entry this session CHANGED or CANCELLED gets EXACTLY ONE line stating the NEW ` +
        `position, with the old one gone. Never leave two lines contradicting each other about the ` +
        `same thing — the newer one wins, the older one disappears.\n` +
        `3. One line per topic. If you find yourself writing "it used to be X, now it is Y", keep only Y.\n\n` +
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 RULE FOUR — MEMORY ALSO MUST NOT RECORD A CONCLUSION DRAWN FROM        │
         * │ A FAILED RUN. (user settled 08/29, and caught the exact spot where I     │
         * │ had advised WRONG)                                                │
         * │                                                                  │
         * │ I had once said the MEMORY block does **not** follow the `learnable`      │
         * │ rule because *"its authority comes from the user"*. Half right, and       │
         * │ the wrong half is the expensive one: this block is NOT something the      │
         * │ user typed — it's **the Assistant compacting its own conversation**,      │
         * │ including turns where it got things wrong. In origin, it belongs to        │
         * │ the same class as `lessons`; only the name sounds like it carries          │
         * │ authority.                                                        │
         * │                                                                  │
         * │ And it's the MOST DANGEROUS of the three channels, for two reasons:       │
         * │  ① it sits in the prefix of **every `route()` turn**, i.e. before          │
         * │    planning even starts — it kills a job right at the door, without       │
         * │    a single worker having to run to reveal there's a problem;             │
         * │  ② `supersedes` makes each new version **copy forward** the old one,       │
         * │    so a wrong sentence gets **renewed at every compaction**, and           │
         * │    never expires.                                                 │
         * │                                                                  │
         * │ A REAL CASE, readable in `bo-nho-2026-08-29-mb1o`:                 │
         * │   ⛔ *"a done report from the web-browsing worker cannot be fully           │
         * │       trusted"*                                                   │
         * │   ⛔ *"…no need to hand back a 'waiting' task like this again"*           │
         * │ Measured consequence: the Assistant **refused to try** and proposed        │
         * │ a workaround on its own — while the arm had already been working           │
         * │ fine again for a while.                                           │
         * │                                                                  │
         * │ 📌 That same memory record already had the CORRECT sentence, written       │
         * │ only for GitHub:                                                  │
         * │   ✅ *"always hand over the work anyway, let the worker report a           │
         * │       missing permission itself, don't assume in advance it can't          │
         * │       be done"*                                                    │
         * │ ⇒ This rule doesn't teach it anything new; it just enforces that            │
         * │ sentence for EVERY connection. So the examples are taken verbatim          │
         * │ from this exact store — an abstract rule loses to a list of examples.      │
         * │ → [[agentco-prompt-rules-lose-to-examples]]                       │
         * │                                                                  │
         * │ ⊕ WIDENED 09/02 — "NOT AVAILABLE / NOT TRIED" also has to be blocked        │
         * │ here.                                                              │
         * │                                                                  │
         * │ A case a user reported: asked *"send it to ke-toan@congty.vn"*, the        │
         * │ Assistant answered correctly, then `/clear` recorded ⛔ *"this office        │
         * │ has no email-sending connection; only provide the path for them to          │
         * │ send it themselves"*.                                             │
         * │                                                                  │
         * │ The old rule did NOT catch this, because it was written about              │
         * │ *"times things BROKE"* — and here nothing broke at all: nothing was         │
         * │ tried, nothing stumbled. The Assistant just recorded the ABSENCE of a       │
         * │ capability.                                                        │
         * │                                                                  │
         * │ But the consequence is identical to the 08/29 case, and worse on its       │
         * │ shelf life: the arm list gets rebuilt from `company.yaml` into the         │
         * │ prefix on EVERY turn, so this sentence **adds not a single bit** — it       │
         * │ is only a frozen copy of a fact that was already live, and it turns         │
         * │ wrong the instant the user plugs in a Gmail arm. Same shape as rule 5       │
         * │ (a figure → how to fetch it), just different content: this time it's        │
         * │ a CAPABILITY.                                                      │
         * │                                                                  │
         * │ Fixed with ONE PAIR OF EXAMPLES in the existing list, not a sixth rule:     │
         * │ six rules would dilute every one of them, and `compact-rules` is             │
         * │ deliberately settled at exactly five, consecutively numbered.               │
         * │ → [[agentco-cant-vs-not-wired]] · [[agentco-deterministic-vs-signal]]        │
         * └──────────────────────────────────────────────────────────────────┘
         */
        `4. NEVER record a conclusion drawn from a FAILURE, and never record one drawn from something ` +
        `NOT PRESENT / NOT TRIED. Hard rule, the same one \`lessons\` follows:\n` +
        `   ⛔ "a done report from the browser employee cannot be fully trusted"\n` +
        `   ⛔ "this has been tried several times and always failed — no need to hand it over again"\n` +
        `   ⛔ "this office has no email connection — just give the human the path and let them send it" ` +
        `(the list of connections is rebuilt into your context on EVERY turn, so this line adds nothing — ` +
        `it only freezes something that goes wrong the day the human plugs in one more arm)\n` +
        `   ✅ "hand the work over anyway; let the employee report a missing permission rather than ` +
        `guessing in advance that it cannot be done"\n` +
        `   ✅ "for a large Notion project: list the sub-pages first, then read them one by one — this works"\n` +
        `One failure proves "that attempt did not finish". It does NOT prove "this cannot be done" — and ` +
        `the second sentence is the one you will re-read in EVERY later session and then refuse to try, ` +
        `even after the thing started working again. "This office does not have X" has an even shorter ` +
        `shelf life: it is wrong the moment the human plugs X in, and you still re-read it every session. ` +
        `Record only WAYS OF WORKING THAT WORKED, preferring the ones that took a stumble to find.\n` +
        `⚠ What the HUMAN settled still gets carried over under rule 1, even when what they settled is ` +
        `"do not do X" — that is their decision, not your conclusion. Unfinished work is recorded as ` +
        `WORK STILL TO DO, with no judgement attached about why it did not finish.\n\n` +
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 RULE FIVE — MEMORY KEEPS HOW TO FETCH IT, NOT THE FIGURE ITSELF.       │
         * │ (user settled 08/31: *"don't compact live, real-time, changeable          │
         * │  data into memory… at worst I'd rather accept the uncertainty"*)         │
         * │                                                                  │
         * │ ⚠⚠ READ THE SCOPE CAREFULLY BEFORE TRUSTING WHAT THIS RULE CLOSED.        │
         * │                                                                  │
         * │ A case measured 08/31 — the Assistant answered *"23 invoices                │
         * │ remaining"* on two turns **without calling any arm at all**, one turn      │
         * │ even claimed *"based on data from the tool"* — **it did NOT go through     │
         * │ this gate**. Grepping the whole office: the number lived in                │
         * │ `chat.jsonl` + receipts, **no memory node held it at all**. The real        │
         * │ door was `.state/assistant-session.json` → `options.resume`: three          │
         * │ different processes are still ONE conversation, and the Assistant           │
         * │ was repeating a sentence it had said itself 60 seconds earlier — which      │
         * │ is **reasonable**.                                                 │
         * │                                                                  │
         * │ ⇒ This rule closes the MEMORY channel, a real channel that already          │
         * │ cost money once (08/29). It does NOT close `resume`. Stated outright         │
         * │ so nobody reading this fix later assumes the 08/31 case was handled.        │
         * │ → [[agentco-easy-reason-beats-true-reason]]                       │
         * │                                                                  │
         * │ Why it's still worth doing even though the measured case went through       │
         * │ a different door: after `/clear`, an old figure sitting in the MEMORY       │
         * │ block enters the prefix of **every `route()` turn**, and `supersedes`       │
         * │ **renews it at every compaction** — it never expires on its own. The         │
         * │ exact two properties that made rule 4 necessary, just different            │
         * │ content: that one was a CONCLUSION, this one is a FIGURE.                   │
         * │                                                                  │
         * │ 🔑 This test was chosen because it needs NO new mechanism: *"asking          │
         * │ the same place again tomorrow — could the answer differ?"* — the            │
         * │ model can answer that itself, no receipt lookup, no new field. The           │
         * │ user already accepted the uncertainty that test carries.                    │
         * │                                                                  │
         * │ ⭐ And the rule is phrased in the direction of KEEPING, not               │
         * │ FORBIDDING: turning a figure into **how to fetch it** loses nothing —        │
         * │ the next session still knows who to ask, and asks again exactly when         │
         * │ it matters. A rule with only a "don't record" clause gets obeyed by           │
         * │ the model leaving it blank, and we lose the way back entirely.              │
         * └──────────────────────────────────────────────────────────────────┘
         */
        `5. NEVER record FIGURES or STATE fetched from a connection or a file. Record HOW TO FETCH IT, ` +
        `not what was fetched.\n` +
        `   The test: if asking the same place again tomorrow could give a different answer, it is a ` +
        `figure — do NOT record it.\n` +
        `   ⛔ "there are currently 23 unpaid invoices, totalling 41,250,000d"\n` +
        `   ⛔ "Linear has 9 issues, 3 of them In Progress" · ⛔ "repo X has 7 branches"\n` +
        `   ✅ "number of unpaid invoices: ask the Command Shop connection, do not answer from memory"\n` +
        `   ✅ "issues In Progress: call Linear's list_issues, it already returns status on each issue"\n` +
        `An old figure sitting in memory is one you will re-read in EVERY later session and answer with ` +
        `as though you had just looked it up — while it has gone stale, and the human has no way to see ` +
        `that. Recording how to fetch it loses nothing: the next session still knows who to ask, and it ` +
        `asks at the moment it matters.\n` +
        `⚠ A figure the HUMAN themselves settled still gets carried over under rule 1 ("budget per task ` +
        `is at most $0.5") — that is a decision, not a figure fetched from somewhere.\n\n` +
        `What is worth remembering in order to keep serving them:\n` +
        `- what the human likes and dislikes (voice, length, how things are laid out)\n` +
        `- what has been SETTLED and does not need discussing again\n` +
        `- work still open, and questions you asked that have no answer yet\n\n` +
        // ~500 words rather than 200: this block is the MOST VALUABLE thing in
        // the Assistant's prefix — it sits in the cache so it costs ~0.1× after
        // the first write, while losing one of the user's own decisions can't
        // be bought back with any amount of tokens. A bit longer while keeping
        // full meaning is a net gain.
        /**
         * ⚠ NAMES NO LANGUAGE, and that is the whole point of this line.
         *
         * It used to say "write bullet points in Vietnamese" — pinned in the
         * source, in the middle of a block that is the human's own memory read
         * back to them. An English speaker got Vietnamese memory; a German
         * speaker had no route to German at all.
         *
         * The conversation being compacted is right there in context, so the
         * language signal is as strong as it ever gets. → docs/CLAUDE.md
         */
        `Write bullet points in the language of the conversation, under 500 words, one reusable point ` +
        `per line. Do NOT recount the list of work already done. Do NOT write greetings or promises. ` +
        // "NOTHING" is only valid when BOTH are empty. The old version didn't
        // state this clearly, so a throwaway chat session ("hi there") could
        // return NOTHING — and while that branch writes no new node (so
        // nothing gets deleted), the instruction still has to agree with the
        // merge rule above, otherwise two sentences in the same prompt fight
        // each other.
        /**
         * ⚠ `NOTHING` IS A SENTINEL THE CODE MATCHES, not prose.
         *
         * `office.ts` tests the reply against `/^NOTHING\.?$/i` and skips
         * writing a node when it matches. It stays English in every locale for
         * the same reason a JSON field name does: it is a protocol token, and
         * translating it would silently break the "nothing to remember" branch
         * — an empty node poisoning the HOT prefix on every later turn.
         */
        `If there is NO earlier memory and nothing in this session is worth keeping, reply with exactly ` +
        `one word: NOTHING`;

  setHotKnowledge(text: string): void {
    this.hotKnowledge = text.trim();
  }

  /** The compacted memory — a dedicated block in the prefix, not merged into hot. */
  private memory = '';

  setMemory(text: string): void {
    this.memory = text.trim();
  }

  /**
   * The library manifest. → docs/SPEC-library.md §8b
   *
   * Sits in the cached prefix, NOT a tool call. Giving the Assistant a tool to
   * read the index means every read is a paid turn, and `route()` runs on
   * EVERY message — that's the busiest road in the whole product.
   */
  private library = '';

  setLibrary(text: string): void {
    this.library = text.trim();
  }

  /**
   * The OUTPUT manifest of previous runs. → docs/SPEC-artifacts.md §2.4
   *
   * FILENAMES ONLY. The Assistant still can't read a single byte of their
   * content — it only knows enough to write a path into `inputs` for a worker
   * to open. That boundary is identical to the library's, and it's what lets
   * the "artifacts are invisible" rule get bent without tearing open the exact
   * door that rule exists to close.
   */
  private artifacts = '';

  setArtifacts(text: string): void {
    this.artifacts = text.trim();
  }

  /**
   * Who gets assigned work — decided by the `Assistant → agent` edge on the canvas.
   *
   * This is where dragging one wire turns into a MEASURABLE consequence:
   * unwiring an agent makes its `pitch` disappear from the Assistant's
   * context. The cost that comes with it: the roster sits in the cached
   * prefix, so rewiring = one cache rewrite. Cheap (the roster is a few
   * hundred tokens) but NOT free — don't call this function on every mouse drag.
   */
  setAssignable(ids: Set<string> | undefined): void {
    this.assignable = ids;
  }

  /**
   * Roles the Assistant actually sees. The scheduler uses this exact list to validate.
   *
   * An ARCHIVED role is excluded here, independent of the canvas: `assignable`
   * comes from a wired edge, and an edge only exists once layout.json exists.
   * An office with no such file yet has `assignable` as undefined = "all of
   * them" — and "all of them" must never include someone archived.
   */
  assignableRoles(): Set<string> {
    const live = [...this.office.roles.keys()].filter((id) => !this.office.archivedRoles.has(id));
    if (!this.assignable) return new Set(live);
    return new Set(live.filter((id) => this.assignable!.has(id)));
  }

  /**
   * The directory — pitch + one capability line only, WITHOUT skills.
   * → docs/SPEC-tools-approval.md §1
   *
   * Capabilities are AUTO-GENERATED from the connector/MCP wired to an agent,
   * rather than making the user hand-write them into `pitch`. Without it, the
   * Assistant splits work as if nobody had any tools at all — unable to
   * decide "assign this to them because they can reach Notion".
   *
   * DELIBERATELY states only the NAME, not the schema: the Assistant needs to
   * know *what it can reach*, not *how to call it*. It never calls a tool
   * itself.
   */
  /**
   * One arm, stated in terms the Assistant NEEDS, not in terms of what we store.
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A CASE A USER HIT 08/24, THREE TURNS IN A ROW, UNABLE TO ESCAPE:        │
   * │                                                                      │
   * │   — "Within the folder I've granted, find the 5 largest files…"           │
   * │   — "Could you give me the full path of the folder to look through?"       │
   * │   — "the music folder"                                                │
   * │   — "Could you give me the full path to that Music folder?"                │
   * │   — "your worker already knows this folder"                            │
   * │   — "I still need the full path…"                                      │
   * │                                                                      │
   * │ **The Assistant wasn't being stubborn — it genuinely DIDN'T KNOW.**        │
   * │ `role.mcp` is just an array of HASHES (`a385afc3ab6`), and the old            │
   * │ version dumped that array straight into the capability line. A hash          │
   * │ can't say where it points, so *"the folder I've granted"* was unsolvable,     │
   * │ and the user assumed the system already knew (true — `company.yaml`          │
   * │ knew, only the Assistant didn't).                                       │
   * │                                                                      │
   * │ This is debt already NAMED in this exact file since 08/22: *"that line       │
   * │ lists MCP servers by NAME, not by CAPABILITY — a server name is a            │
   * │ CLAIM, its own tool list is the TRUTH"*. This case is that debt              │
   * │ collecting interest, in the cheapest form to pay off: the folder already      │
   * │ sits in `args`, `folderRoots` already exists, 0 extra calls.                │
   * │                                                                      │
   * │ ⚠ Writes `folder:` rather than using an arrow or a bare colon — this line       │
   * │ sits inside a list block and has to be SELF-READABLE standing alone, same       │
   * │ rule already applied to `runs commands: OFF`.                            │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  private reach(role: Role): string {
    /**
     * ⚠ ONLY bridges the name when a role has **TWO OR MORE arms**.
     *
     * One arm has nothing to confuse — the model calls the only one it sees.
     * Pasting a technical string onto every line pays tokens for something
     * useless, and teaches the model those strings are noise — so it skips
     * right past the one time the string actually matters.
     */
    const many = role.mcp.length > 1;
    const parts = role.mcp.map((id) =>
      armReach(this.office.company.arms, this.office.company.mcpServers, id, many ? id : undefined),
    );
    // Web is on by default for every worker (BUILTIN_TOOLS), so it's always
    // stated — this is a real capability, and not stating it means the
    // Assistant doesn't know it can assign a web lookup.
    parts.push('web');
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ `pitch` IS A CLAIM. This block is the TRUTH. Both are needed.        │
     * │                                                                      │
     * │ Case measured 08/22 (test 9.3): role `nguoi-kiem-ke` had a `pitch`         │
     * │ reading *"Run commands to get file and folder info on the machine"* —      │
     * │ but its shell switch was OFF. The Assistant read that claim, assigned       │
     * │ work, and the worker burned **4 turns · $0.1358** discovering it had no       │
     * │ hands. Then the next task collapsed too, since it depended on this one.       │
     * │                                                                      │
     * │ Nobody was lying: `pitch` is typed by the user when creating a worker,        │
     * │ and it describes INTENT. Capability lives in `tools`, and before this          │
     * │ line the Assistant **had no way at all to see `tools`**.                    │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ ⚠ CORRECTED 08/22 (re-running test 9.3) — A CLAIM-ONLY-VERSION IS         │
     * │ INEFFECTIVE.                                                          │
     * │                                                                      │
     * │ The old version only pushed `runs commands on the machine` into the list      │
     * │ WHEN shell was on, reasoning *"rule 7 already handles the negative           │
     * │ case"*. Rerunning 9.3: the Assistant **still** assigned work to                │
     * │ `nguoi-kiem-ke`, still built the full 2 steps, still spent $0.1380.          │
     * │                                                                      │
     * │ Why: NOBODY in office `kiem-ke` has shell ⇒ the string `runs commands         │
     * │ on the machine` never appears anywhere in the directory ⇒ **absence is         │
     * │ not a signal**. A claim-only signal is only readable through CONTRAST,        │
     * │ and here there's nothing to contrast against. Rule 7 couldn't fire            │
     * │ either: based on the evidence the Assistant holds, `pitch` says there IS       │
     * │ a suitable person.                                                    │
     * │                                                                      │
     * │ ⇒ The flag has to state BOTH directions (`ON`/`OFF`) so every line             │
     * │   carries information on its own, independent of whether anyone else in       │
     * │   the office has a different setup.                                     │
     * │                                                                      │
     * │ The MEANING of the flag is consolidated into `SHELL_LEGEND`, stated ONCE.       │
     * │ It's a fact about agentco itself, not a property of one worker — putting        │
     * │ it on every person's own line assigns it to the wrong layer, exactly the         │
     * │ mistake that caused this case. Breaks even in token cost around ~3               │
     * │ workers, and wins more and more from there.                               │
     * │                                                                      │
     * │ ⚠ The flag still writes `runs commands: OFF`, NOT `shell: 0` — the                │
     * │ explanation sits at the top of the block, while line 9 is far away; the          │
     * │ flag has to be self-readable standing alone. 2 tokens for something that         │
     * │ doesn't depend on distance.                                              │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    parts.push(shellFlag(role.tools));
    return ` [${parts.join(' · ')}]`;
  }

  /**
   * A DIRECTORY SNAPSHOT — who can reach what, computed by code, 0 tokens.
   * → docs/SPEC-arms.md §15
   *
   * Built from the exact `armReach` string that `roster()` sends out, so it
   * catches **every** way the directory could change: wiring/unwiring
   * (`role.mcp`), renaming an arm (`arms[id].label`), adding/archiving a
   * worker (`assignableRoles`). Compares string to string instead of
   * enumerating each case — missing a case here fails silently, not loudly.
   *
   * ⚠ The config hash (`armHash`) CANNOT be used for this: it's the identity
   * of an arm, not of the directory line. A rename leaves the hash unchanged.
   */
  private reachMap(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const id of [...this.assignableRoles()].sort()) {
      const role = this.office.roles.get(id);
      // ⚠ The EXACT SAME computation as `reach()`. One mismatch and
      // `reachDiff` reports "changed" for a line that changed nothing — a
      // false alarm on every single turn.
      const mcp = role?.mcp ?? [];
      const many = mcp.length > 1;
      const caps = mcp.map((x) =>
        armReach(this.office.company.arms, this.office.company.mcpServers, x, many ? x : undefined),
      );
      /**
       * THE SHELL SWITCH TRAVELS THE SAME PATH AS AN ARM (user settled 08/24).
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ Real case: a user turned on `Bash` for a worker then asked the             │
       * │ **exact same** question again. The Assistant answered *"I already            │
       * │ tried this before and it was blocked"* — the exact same failure class         │
       * │ as unwiring an MCP arm, just a different switch.                          │
       * │                                                                    │
       * │ `roster()` **already** changed when the switch changed (`shellFlag`         │
       * │ sits in the capability line), so the prompt was already correct. What        │
       * │ was missing was the DIFF: the old version only snapshotted                  │
       * │ `role.mcp`, so toggling shell produced no line and history won again.       │
       * └────────────────────────────────────────────────────────────────────┘
       *
       * ⚠ Only snapshots things that CAN CHANGE. `web` also sits in the
       * capability line but it's on by default for everyone with no switch —
       * including it here would be a token that never diffs, pure noise.
       */
      if (hasShell(role?.tools ?? [])) caps.push('shell');
      m.set(id, caps);
    }
    return m;
  }

  /**
   * A DETERMINISTIC POST-CHECK: does this sentence mention an arm that IS NO
   * LONGER WIRED to anyone? → docs/SPEC-arms.md §15
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THIS GATE IS NEEDED DESPITE ALREADY HAVING A PROMPT INSTRUCTION.          │
   * │                                                                          │
   * │ Case measured 08/24 (session `P a425003b`): a user typed the **exact same**    │
   * │ sentence three times around the moment of unwiring, and the Assistant           │
   * │ replied **identically, character for character**, all three times, quoting      │
   * │ `D:\Downloads\Programs Installation` verbatim — a path that was ALREADY           │
   * │ GONE from that turn's prompt (measured via the cache: turn 2 had `cache_read     │
   * │ = 0` after 15 seconds ⇒ the prefix had already been rebuilt, the directory        │
   * │ was already clean). The model was copying its OWN sentence from the `resume`      │
   * │ history, not rereading the directory.                                    │
   * │                                                                          │
   * │ A prompt instruction is a SIGNAL, not a gate — it doesn't have a zero              │
   * │ failure rate and must never be recorded in the ledger as a guarantee              │
   * │ ([[agentco-deterministic-vs-signal]]). This gate is deterministic: the             │
   * │ list of labels + root directories is FINITE and fully known, so "does it          │
   * │ mention it or not" is a string comparison, not a judgment call.                  │
   * │                                                                          │
   * │ ⚠ A BOUNDARY, this sentence has to stay exactly as stated: it catches            │
   * │ NAMES, not ROUNDABOUT PHRASING. Spike L2 is a real escape case — the model         │
   * │ dropped the folder name but still said *"the folder the installation                │
   * │ inspector is in charge of"*, with no string left to match. ***NARROWED,             │
   * │ NOT CLOSED.***                                                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Three conditions for a string to count as "stale" — all three are
   * required, and each blocks a false positive thought of before writing this:
   *
   *  1. That arm is **not** in the `role.mcp` of anyone currently on duty.
   *  2. The string is **not** present in what the user just typed — if they
   *     name the folder themselves and the Assistant answers *"nobody can
   *     reach that"*, that's CORRECT behavior.
   *  3. The string is **not** a substring of a still-live arm. If `D:\X` gets
   *     unwired while `D:\X\sub` is still wired, mentioning `D:\X` isn't wrong.
   */
  private staleArmMentions(say: string, userText: string): string[] {
    const live = new Set<string>();
    for (const id of this.assignableRoles()) {
      for (const m of this.office.roles.get(id)?.mcp ?? []) live.add(m);
    }
    const book = this.office.company.arms;
    /**
     * Adds the ACCOUNT NAME as the third needle. → `staleMentions §arms.via`
     *
     * ⚠ Reads the OAuth store CONDITIONALLY, not by default: this gate runs on
     * **every** Assistant turn, and the vast majority of offices have no
     * unwired arm at all. No candidate at all ⇒ touches no disk. Same
     * lazy-read pattern already used in `office.ts §canvas`.
     */
    const needsOauth = Object.keys(this.office.company.mcpServers).some(
      (id) => !live.has(id) && (book[id]?.secrets?.length ?? 0) > 0,
    );
    const oauth = needsOauth ? readOAuth(companyPaths(this.office.companyDir)) : {};
    const arms: Record<string, { label?: string; via?: string }> = {};
    for (const [id, meta] of Object.entries(book)) {
      const via = (meta.secrets ?? []).map((s) => oauth[s]?.label).find(Boolean);
      arms[id] = { ...(meta.label ? { label: meta.label } : {}), ...(via ? { via } : {}) };
    }
    return staleMentions({
      arms,
      servers: this.office.company.mcpServers,
      live,
      say,
      userText,
    });
  }

  private roster(): string {
    const allowed = this.assignableRoles();
    const lines = [...this.office.roles.values()]
      .filter((r) => allowed.has(r.id))
      .map(
        (r) =>
          `- ${r.id} (${r.display_name || r.id}): ${r.pitch}` +
          this.reach(r) +
          (r.not_for.length ? ` [not their job: ${r.not_for.join(', ')}]` : ''),
      );
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ AN EMPTY OFFICE: STATE WHAT'S NEEDED, DON'T LET THE MODEL MAKE UP ITS OWN    │
     * │ EXCUSE.                                                                │
     * │                                                                      │
     * │ Case 08/24 — a brand-new office, 0 workers. The user asked *"find 5           │
     * │ coffee shops in district 1 for me"*, and the Assistant answered:              │
     * │                                                                      │
     * │   *"this office has no connection for looking up outside information"*        │
     * │   *"I don't have internet access"*                                     │
     * │                                                                      │
     * │ The second half is CORRECT (the Assistant has `tools: []`). The first          │
     * │ half is **WRONG**, and wrong in the most expensive direction:                  │
     * │ `WebSearch`/`WebFetch` are part of `BUILTIN_TOOLS`, so **every worker can       │
     * │ search the web** — measured 08/24, ran for real, produced results with          │
     * │ sources. The only thing actually missing: nobody was in the office yet.        │
     * │                                                                      │
     * │ The old line `(none — nobody on duty)` only stated one fact. The model          │
     * │ filled the gap with a very plausible-sounding explanation about the             │
     * │ PRODUCT — exactly what the rule *"never let the model explain the                │
     * │ system to the user on its own"* forbids, and the result was the user             │
     * │ believing the product couldn't do something it actually could.                │
     * │                                                                      │
     * │ ⚠ This paragraph ONLY exists when the roster is empty ⇒ tokens are spent        │
     * │ exactly when they're valuable, and cost 0 in every active office.               │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (lines.length === 0) {
      /**
       * ⚠ CHANGED AT THE SAME TIME as `lookup` gaining web access (08/24) — and
       * it had to be simultaneous, otherwise it's exactly the "two surfaces
       * contradicting each other" sickness: one side can answer the question,
       * the other still claims "nothing can run".
       *
       * The old version (written the same morning) said *"No work can run until
       * the human adds one"*. At that exact moment, half wrong, ever since
       * `lookup` gained web access.
       */
      return (
        `# Employees you can assign to\n\n(none — nobody has been added to this office yet)\n\n` +
        `You can still answer questions yourself through \`lookup\` — including looking things up ` +
        `on the web. What you cannot do is **produce anything the human keeps**: a file, a report, ` +
        `a table. That needs an employee, so when they ask for one, say so plainly and point them ` +
        `at the "+ Employee" button. **Never describe this as something the product cannot do:** ` +
        `every employee can search and read the web, and open files on the machine by full path. ` +
        `What is missing is a person to assign to, not a capability.`
      );
    }
    return `# Employees you can assign to\n\n${SHELL_LEGEND}\n\n${lines.join('\n')}`;
  }

  /**
   * This Assistant's model tier. An office is allowed to override
   * `models.master`. → docs/SPEC-offices.md §4.5
   */
  get modelTier(): Tier {
    return this.office.config.assistant.model_tier ?? this.office.company.models.master;
  }

  /** The actual model that will run — so the UI can state it instead of making the user guess. */
  get model(): string {
    return this.office.company.models[this.modelTier];
  }

  private systemPrompt(): string[] {
    const built = buildAssistantPrompt(this.office, {
      roster: this.roster(),
      hotKnowledge: this.hotKnowledge,
      memory: this.memory,
      library: this.library,
      artifacts: this.artifacts,
      model: this.model,
    });
    return built.systemPrompt as string[];
  }

  /**
   * Planning — runs in its OWN ONE-SHOT query, NOT inside the Assistant's session.
   *
   * Reason: the prompt cache keys off (model, prefix). If this step ran on the
   * Assistant's session using a different model (e.g. Opus for quality), EVERY
   * model switch would miss the entire context — exactly the ~36,000 equivalent
   * tokens already warned about in the MCP case. Splitting it out lets
   * `models.planner: deep` be set freely while the session stays warm.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `planId` IS PASSED IN, NOT SELF-GENERATED — bug fixed 08/20.             │
   * │                                                                          │
   * │ The old version called `newPlanId()` right here, while `Office.run()`         │
   * │ also called `newPlanId()` for its own job record. TWO ids for ONE run.          │
   * │ Then `office.ts` overwrote `plan.plan_id` with the record's own id — but         │
   * │ by then `artifactScoper` had already framed every path using the OTHER id.       │
   * │                                                                          │
   * │ Measured consequence on a user's machine: `artifacts/P-260820-0302-ov9e/`        │
   * │ existed on disk, while `tasks/index.json` only knew about                     │
   * │ `P-260820-0301-aajq`. The output directory carried an ORPHAN id — no plan          │
   * │ pointed to it, no log file named it. The user even saw both ids in the             │
   * │ exact same result message.                                                │
   * │                                                                          │
   * │ One run = ONE id, generated in exactly one place (`Office.run`), flowing         │
   * │ down to everywhere it's needed. An id generated in two places will drift          │
   * │ apart eventually, no matter what.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * Adopts an already-built draft instead of calling the model. →
   * `decideRoute`'s escape hatch
   *
   * Deliberately thin: it only injects the office's `default_deliver` into
   * `buildPlan`. Letting `Office` call `buildPlan` itself would mean `Office`
   * has to go fetch that default on its own — and the day someone forgets,
   * `default_deliver: reply` would go silently ineffective at exactly one of
   * the two call sites. One transformation, one call site.
   */
  adopt(draft: PlanDraft, request: string, planId: string): PlanOrAsk {
    return {
      kind: 'plan',
      plan: buildPlan(draft, request, planId, this.office.config.assistant.default_deliver),
    };
  }

  /**
   * A HIDDEN WORKER — reads already-verified files, answers directly. →
   * `RouteSchema` lookup
   *
   * Three properties, all enforced by CODE rather than an instruction:
   *
   *  · `persistSession: false` — whatever it reads **dies with the call**.
   *    This is the whole reason it exists instead of handing `Grep` to the
   *    Assistant.
   *  · `tools` is read-only — it **can't write a file**, so it can't
   *    encroach on a worker's job even if the Assistant routes incorrectly.
   *    The "ask to KNOW / assign to HAVE" boundary is a CAPABILITY limit, not
   *    a promise.
   *  · `systemPrompt` is a bare `LOOKUP_PROMPT` — no charter, no knowledge
   *    store, no skills, no roster. A tiny prefix, and **nothing hidden**.
   *
   * `usage` is returned to `Office` to record under the `lookup` line item:
   * it has its own cost shape, and merging it into `route` would hide any
   * line item that's growing.
   */
  async lookup(paths: readonly string[], question: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.run(
      paths.length
        ? // ⚠ The question goes in VERBATIM. It is the user's own words, and it is
          // the language signal `LOOKUP_PROMPT` tells the model to answer in.
          `Documents to read:\n${paths.map((p) => `- ${p}`).join('\n')}\n\nQuestion: ${question}`
        : // No document named = a general lookup question. STATES that outright
          // instead of sending an empty list — an empty "Documents to read:"
          // block is something the model would have to interpret on its own,
          // and it would interpret it differently every time.
          `No document in this office is relevant to this — look it up on the web and answer.\n\nQuestion: ${question}`,
      /**
       * The ASSISTANT's OWN model tier, not `models.planner` — and deliberately
       * does NOT invent a third knob.
       *
       * To the user this IS the Assistant answering; it just doesn't keep the
       * document in its head. So it has to speak at the same quality as the
       * rest of the conversation, and the knob that decides that already
       * exists: the office's `assistant.model_tier`.
       *
       * `models.planner` would be the WRONG AXIS ENTIRELY: people set it to
       * `deep` so the planning step thinks carefully, and using it here would
       * run Opus for every "what does this file say" question.
       */
      this.model,
      false,
      {
        systemPrompt: LOOKUP_PROMPT,
        /**
         * `Read` to read, `Grep` to find the RIGHT SPOT in a long file — the
         * rule "extracted text is for SEARCHING, the original is for CLOSE
         * READING" (SPEC-library §7). `Glob` because a directory path is still
         * valid inside `paths`.
         *
         * `WebSearch`/`WebFetch` added 08/24 — measured **+992 tokens** added to
         * a lookup turn's prefix (2,828 → 3,820), and only charged when a
         * lookup actually runs.
         *
         * ⚠ All five are READ-ONLY: the hidden worker still can't write a file,
         * so the boundary *"lookup ANSWERS, does NOT HAND OFF"* is a CAPABILITY
         * limit, not an instruction — even if the Assistant routes incorrectly.
         *
         * ⚠ Has to state the part that CAN'T be blocked: `WebFetch` is an
         * OUTBOUND data path, and it's now reachable in an office with 0
         * workers, 0 config. Every worker already has it, so the added risk is
         * small — but it changes from "you have to build an office first" to
         * "open the app and it's already there". Stated outright so nobody
         * later claims it wasn't considered. → SPEC-arms §5e (threat model)
         */
        tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
      },
    );
    return { value: text.trim(), usage };
  }

  async plan(request: string, planId: string): Promise<AssistantResult<PlanOrAsk>> {
    const models = this.office.company.models;
    const { text, usage } = await this.askOneShot(
      // The request is the user's own words, verbatim — the language signal.
      `Plan for the request below. Reply with exactly one JSON object, as specified.\n\n` +
        `Request: ${request}\n\n` +
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ 🔴 THE LANGUAGE CLAUSE HAD TO SIT HERE, NEXT TO THE REQUEST. (user      │
         * │ measured 05/09, `P-260905-0100-zquw`)                                  │
         * │                                                                    │
         * │ `route()` and `report()` each carry this clause ON THE EXACT LINE       │
         * │ of the field it governs. `plan()` carried NOTHING — it leaned          │
         * │ entirely on two sentences sitting in the cached prefix (the JSON        │
         * │ template's *"in the user's language"*, and the closing line in           │
         * │ `buildAssistantPrompt`). It lost, and it lost in the worst place:       │
         * │ `plan()` runs `persistSession: false`, so unlike the other two it       │
         * │ has NO conversation history — the request quoted above is the only      │
         * │ signal it holds, against a whole `skills/assistant.md` block.           │
         * │                                                                    │
         * │ Measured: an ENGLISH request came back as a Vietnamese plan that        │
         * │ went further and wrote its own constraint *"write it in <that            │
         * │ language>"* onto T-02 — so every worker downstream inherited it.        │
         * │ One decision point, the whole chain hanging off it.                    │
         * │                                                                    │
         * │ ⚠ The second sentence is the load-bearing one. The office's own          │
         * │ skills block is an EXAMPLE written in a language; an abstract rule       │
         * │ loses to an example every time, so the clause has to say outright       │
         * │ that it OUTRANKS it rather than just restating itself louder.           │
         * │ → [[agentco-prompt-rules-lose-to-examples]] ·                           │
         * │   [[agentco-rule-must-see-what-it-governs]]                             │
         * │                                                                    │
         * │ ⚠ NAMES NO LANGUAGE — it points at the request. That is what lets       │
         * │ someone writing in a language we ship no catalogue for get a plan       │
         * │ in their own. `test/no-pinned-language.test.ts` guards it.              │
         * │                                                                    │
         * │ Costs ~40 tokens per planning turn, and this is a VOLATILE message,     │
         * │ so it never rewrites the cached prefix. Paid only because there is       │
         * │ now a measured failure — not to be safe. → SESSIONS_MEMORY §8k          │
         * └────────────────────────────────────────────────────────────────────┘
         */
        `Write \`steps\`, \`goal\`, \`constraints\` and \`ask\` in the SAME language as that request. ` +
        `That request outranks every other text in this prompt on the question of language — including ` +
        `this office's own instructions, however they happen to be written.`,
      models[models.planner],
    );

    const parsed = extractJson(text, PlanOutputSchema);
    if (!parsed) throw this.planFailed(request, text);

    // It needs one more piece of information before it can split the work.
    // This is a SENTENCE, not an error — it goes straight to the chat pane
    // and spends no worker tokens at all.
    if ('ask' in parsed) return { value: { kind: 'ask', say: parsed.ask.trim() }, usage };

    return {
      value: {
        kind: 'plan',
        plan: buildPlan(parsed, request, planId, this.office.config.assistant.default_deliver),
      },
      usage,
    };
  }

  /**
   * Planning FAILED to produce JSON — and this is the spot the system used to LIE.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG FIXED (08/20): one error sentence for TWO opposite causes.                  │
   * │                                                                          │
   * │ The old version threw the exact same sentence for every case: *"the             │
   * │ Assistant didn't understand clearly enough to split the work. Try being         │
   * │ more specific…"* — a DIAGNOSIS the code had no basis at all for making.          │
   * │ It only knew one single fact: `extractJson` returned empty.                     │
   * │                                                                          │
   * │ Measured on a user's machine 08/20: three turns in a row got this sentence,      │
   * │ while the `route()` step right before it had rewritten the request **very        │
   * │ clearly** (*"Create a separate terminology note file for doc-3.md… save at        │
   * │ artifacts/vi/…"*). The user read the error and rephrased three different          │
   * │ ways — pointlessly, because phrasing was never the problem — and finally           │
   * │ guessed *"out of money?"*. A wrong answer is worse than no answer: it              │
   * │ sends the user in the wrong direction and charges for a `route` turn every         │
   * │ time they try again.                                                      │
   * │                                                                          │
   * │ THREE real causes, each needing a different sentence:                          │
   * │   · the model returned nothing at all → an infrastructure error, rephrasing        │
   * │     won't fix it                                                          │
   * │   · the model answered with PROSE      → it's asking / refusing; the content       │
   * │     of that sentence IS the information, and the old version threw it              │
   * │     straight in the trash                                                 │
   * │   · JSON in the wrong shape             → our own bug or the model's, not the       │
   * │     user's fault                                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ It DOES quote the model, and that doesn't break the rule *"never let the
   * model explain the system to the user on its own"*. That rule forbids the
   * model **narrating a mechanism** as if it knew one. Here its sentence is
   * put in quotes and introduced as *"it said"* — a quoted PIECE OF EVIDENCE,
   * not an explanation. And what to actually do about it is still written by code.
   *
   * The full text is logged to `.state/plan-failure.log` — the chat sentence
   * has to stay short, while diagnosing a broken case needs the exact
   * original. A logging failure must NEVER swallow the underlying error: the
   * user is waiting for an answer, not a file-write error.
   */
  private planFailed(request: string, text: string): RunError {
    const raw = text.trim();
    this.logFailure('plan-failure.log', request, raw);

    if (!raw) {
      return new RunError(
        t('as.emptyReplyPlanning'),
        'other',
      );
    }
    /**
     * ⚠ THIS SENTENCE ALREADY HAD TO BE FIXED ONCE, and that's a lesson worth keeping.
     *
     * The first version (same day) advised: *"the Assistant can only see the
     * library, NOT the Output pane"*. True when written, **wrong a few hours
     * later** once the output manifest was born (SPEC-artifacts §2.4). An
     * error sentence describing a system LIMITATION is a sentence that goes
     * stale the exact day that limitation gets lifted — and no test catches
     * it, because it's just text.
     *
     * So this version only states what's **always true at runtime**: the
     * model broke protocol. Since 08/20 it HAS a valid gate to ask through
     * (`{"ask": "…"}`), so returning prose is no longer "it needed to ask" —
     * it's "it didn't use the gate that already exists".
     */
    return new RunError(
      t('as.planTextNotJson', { text: briefText(raw) }),
      'other',
    );
  }

  /**
   * The summary after the DAG finishes running. Runs ON the Assistant's
   * session — this is also how the plan (built in its own separate query)
   * ends up recorded in conversation memory, in compact form, so that when
   * the user later asks "why did you do it that way", the Assistant knows.
   *
   * Also collects SHARED LESSONS right here. The Assistant is the only side
   * allowed to write into `knowledge/shared/` (SPEC-offices.md §4.3), and
   * folding it into an already-happening call costs NO extra turn.
   */
  async report(
    steps: readonly { title: string }[],
    receipts: Receipt[],
    /** How many planning turns failed to produce a plan before this run. → `worthLearning` */
    friction = 0,
    /** Does this run still have a RUN-level warning (a promised file missing · output landed outside the frame). → `worthLearning` */
    leaked = false,
  ): Promise<AssistantResult<{ say: string; lessons: Lesson[] }>> {
    const plan = steps.map((s, i) => `${i + 1}. ${s.title}`).join(' · ');
    /**
     * ⚠ MARKS RIGHT IN THE RESULTS TABLE which job is allowed to be a lesson source.
     *
     * The `learnable` gate is deterministic and already blocks on the "should
     * it even ask" question. But a mixed run (one `done` job, one `blocked`
     * job) still opens the gate — and at that point the model sees BOTH lines,
     * and can draw a lesson from exactly the broken one. That's the exact
     * shape of the three poisoned entries measured 08/29.
     *
     * The condition has to sit **on the exact line** it governs, not inside a
     * rule sentence further down — an abstract rule loses to a list of examples.
     * → [[agentco-prompt-rules-lose-to-examples]] · [[agentco-rule-must-see-what-it-governs]]
     */
    const summary = receipts
      .map((r) => {
        const head =
          `- [${r.status}] ${r.role}: ${r.say}${r.artifacts.length ? ` → ${r.artifacts.join(', ')}` : ''}` +
          (learnable(r) ? '   ⟵ REACHED THE GOAL despite stumbling: ONLY this one may yield a lesson' : '');
        /**
         * `gist` = the EVENT a worker found. This is the **only thing** the
         * Assistant has to answer the user's question with: it can't read the
         * file (§4.7), so without this line the best closing sentence it could
         * write is still *"the result is in that file"* — and the user has to
         * go open it, at worst through a bridge.
         *
         * ⚠ A newline + indent, not appended to `say`: `gist` is allowed to be
         * bullet points (user settled 08/30), and forcing it onto one line
         * would strangle its single most useful shape.
         */
        return r.gist ? `${head}\n    RESULT: ${r.gist.replace(/\n/g, '\n    ')}` : head;
      })
      .join('\n');

    const wantLessons = worthLearning(receipts, friction, leaked);

    /**
     * A friction run asks a COMPLETELY DIFFERENT question — and being different is the whole point.
     *
     * A technical-snag run asks *"what was the trap stumbled into"*. A
     * friction run has a machine that ran cleanly, so asking that question
     * gets back "nothing" — correct, and useless. What's worth learning sits
     * on the HUMAN side: which sentence finally made the job workable, and
     * what should be asked outright next time. → `worthLearning`
     */
    const frictionAsk =
      `⚠ The human had to restate this ${friction} times before it could be handed over — on the ` +
      `earlier turns you could not split the work. The run itself was clean, so the lesson is NOT ` +
      `technical; it is about understanding each other: which of their sentences finally made it ` +
      `work, and what should you ask outright next time a request looks like this?\n\n`;

    const { text, usage } = await this.askSession(
      `The plan that just ran: ${plan}\n\nResults:\n${summary}\n\n` +
        `Reply with exactly one JSON object in a \`\`\`json block:\n` +
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ ANSWER THE QUESTION, DON'T REPORT PROGRESS. (user settled 08/30)         │
         * │                                                                    │
         * │ > *"I keep having to go into the file to see the result, which is         │
         * │ >  even worse over a bridge"* · *"it just needs to anchor to the           │
         * │ >  user's intent"*                                                 │
         * │                                                                    │
         * │ The old version only asked *"what got done, anything to watch out for"*   │
         * │ — and it produced exactly *"I saved the list to file X, open that          │
         * │ file to see it"*. That sentence was **correct** for what it was asked;     │
         * │ the question was the wrong one.                                    │
         * │                                                                    │
         * │ ⚠ THIS IS THE ONLY PLACE THAT CAN ANCHOR TO THE USER'S INTENT. A          │
         * │ worker has never seen what they typed — it only sees the task brief.       │
         * │ The Assistant still has that exact sentence in its session. So the         │
         * │ split is: **a worker supplies the EVENT, the Assistant ANCHORS it**.       │
         * │                                                                    │
         * │ ⚠ And making things up has to be forbidden right here: `gist` is the      │
         * │ ONLY source. A closing sentence that reads smoothly but adds a fact        │
         * │ nobody can verify is worse than plain "go open the file".                 │
         * └────────────────────────────────────────────────────────────────────┘
         */
        /**
         * ⚠ The language clause here used to read `<Vietnamese, …>` — a pinned
         * language sitting in the one field the human reads most often. It is
         * gone; the human's own words are in this session, so the signal is
         * already the strongest available. → docs/CLAUDE.md §Language
         */
        `{"say":"<in the language the human is writing to you in. ANSWER THEIR QUESTION DIRECTLY, ` +
        `with the figures and names taken from the RESULT lines above — that is what they asked for; ` +
        `do not make them open a file to find out. About 1-3 sentences, or a few bullets if it is a ` +
        `list. Say what they need to watch out for too. Do NOT add any fact that is not in the RESULT ` +
        `lines. If there are no RESULT lines, say plainly what was done and point at the file. No ` +
        `progress reports, no technical jargon>"` +
        (wantLessons
          ? `,\n "lessons":[{"kind":"pitfall","text":"<a reusable WAY OF WORKING for THIS office, under 25 words>"}]}\n\n` +
            (friction > 0
              ? frictionAsk
              : `Some task REACHED ITS GOAL despite stumbling on the way — \`lessons\` is where the ` +
                `ROUTE that finally worked gets recorded, at most 2, and still LEFT EMPTY if it ` +
                `teaches nothing reusable.\n` +
                `🔴 Draw ONLY from a line marked ⟵ above. A \`blocked\`/\`failed\` task must NEVER ` +
                `become a lesson, even when it is the most notable thing that happened: an ` +
                `unfinished task proves "it did not finish this time"; it does NOT prove "this ` +
                `cannot be done". Filing that sentence teaches every later employee to give up ` +
                `early — measured, on exactly that case. An unresolved snag goes in \`say\` for the ` +
                `human, who is the right reader for it.\n\n`) +
            `A lesson records a WAY OF WORKING, never KNOWLEDGE:\n` +
            `  ✅ "the returns policy is in library/files/doi-tra.md — grep there before answering"\n` +
            `  ⛔ "items discounted over 50% cannot be returned"\n` +
            `The second sentence is already in this office's documents. Copying it here creates a ` +
            `second copy THAT NOBODY UPDATES: the day the human changes the policy, the document ` +
            `changes and the lesson does not — and the lesson WINS, because it sits in every ` +
            `employee's head while the document has to be looked up.\n` +
            `Record no figures, thresholds, prices or dates. Record only the route taken and the ` +
            `trap stumbled into.`
          : `}`),
    );

    const parsed = extractJson(text, ReportSchema);
    // If it can't be parsed, there still has to be a report sentence — the user is waiting.
    const value = parsed ?? { say: text.trim() || t('as.done'), lessons: [] };
    // The final gate: no lessons wanted means none accepted, even if the model sends them anyway.
    return { value: wantLessons ? value : { ...value, lessons: [] }, usage };
  }

  /**
   * Decides what the user just said: chatting, asking a follow-up, or handing
   * over work.
   *
   * Runs ON the Assistant's session (cheap: the context is just roster +
   * charter + skills, already cached), so it remembers the whole
   * conversation. "Hi" must never turn into a DAG plan — that's an error a
   * user would hit on their very first action.
   *
   * `ask` is the single most valuable case: a vague request gets ASKED BACK
   * instead of being planned wrong and burning money. This is the product's
   * actual core pain point — a non-technical person lost, not knowing where
   * the AI is taking them.
   */
  async route(message: string, hasActivePlan: boolean): Promise<AssistantResult<RouteOutcome>> {
    /**
     * ⚠ RECORDED HERE AND NOWHERE ELSE — this is the one function that sees
     * what the human actually typed. `report()` and the `/clear` memory run
     * long after, on text nobody typed, and would otherwise have no evidence
     * to check themselves against. → `undrift`
     */
    this.lastHuman = message;
    /**
     * A DIRECTORY DIFF right after it changes — a SIGNAL, **not** a gate. → `reachDiff`
     *
     * Same mechanism as `scopeHint` right below: a conditional line, silent
     * when nothing changed. It exists because `resume` carries the old
     * conversation along, and the Assistant's own old sentence is an EXAMPLE
     * — and an example beats an abstract rule
     * ([[agentco-prompt-rules-lose-to-examples]]).
     *
     * ⚠ The first version (08/24 morning) only said *"the directory just
     * changed, reread it above"* — an instruction, and it bet on exactly the
     * thing just measured to be WEAK: telling the model to pay attention to a
     * line that had **disappeared**. This version states the change outright,
     * so the disappearance becomes a line of text that **appears**. Changing
     * the axis, not a louder instruction. The full measurement lives in
     * `reachDiff`.
     *
     * ⚠ Deliberately does NOT stuff a hash into the sentence: the user never
     * reads it, and the more unfamiliar strings the model sees, the easier it
     * is for it to make up a story about that string.
     *
     * Only fires when a session is ACTUALLY ongoing: the first turn of a new
     * session has empty history, nothing to correct, and a warning about "the
     * previous sentence" when there is no previous sentence just invites the
     * model to make one up.
     */
    const now = this.reachMap();
    const changes =
      this.sessionId !== undefined && this.reachPrev !== undefined ? reachDiff(this.reachPrev, now) : [];
    const reachHint = changes.length
      ? `\n⚠ The roster just changed: ${changes.join(' · ')}. ` +
        `The employee list above is the CORRECT one — disregard anything you said earlier about who reaches what.`
      : '';
    this.reachPrev = now;

    const scopeHint = hasActivePlan
      ? `\nThere is work already running. With intent "task", set "scope":"refine" if this message ADDS TO or CHANGES the running work; ` +
        `set "scope":"new" if it is a DIFFERENT job. When in doubt, choose "new" — two separate jobs cost one extra planning turn, ` +
        `while attaching one to the wrong running job ruins both.`
      : `\nNothing is running right now, so with intent "task" always use "scope":"new".`;

    // `let`: the post-check gate below can add a repair turn on top of this.
    let { text, usage } = await this.askSession(
      // The message is quoted VERBATIM — it is both the thing to classify and
      // the language signal for the `say` slots below.
      `The human just wrote: "${message}"\n\n` +
        `Reply with exactly one JSON object, nothing else:\n` +
        /**
         * ⚠ Both `say` slots used to pin Vietnamese. They are the two lines the
         * human reads most often in the chat box, and the human's own message
         * is quoted three lines above — there is no stronger signal anywhere in
         * the product. → docs/CLAUDE.md §Language
         */
        `{"intent":"chat","say":"<a short reply, in the language they wrote to you in>"}\n` +
        `  use when: greetings, thanks, questions about the office or about work already done, small talk.\n` +
        `{"intent":"ask","say":"<one clarifying question, in the language they wrote to you in>"}\n` +
        `  use when: it looks like a work request BUT is missing something that matters ` +
        `(who it is for, how long, what tone, based on which documents). ` +
        `Ask the ONE question that matters most. Better to ask than to guess wrong and redo it.\n` +
        `{"intent":"lookup","paths":["library/files/doc-2.md"],"question":"<the question, keeping the human's own wording>"}\n` +
        `  use when: it is a QUESTION TO KNOW something; once answered it is done, and no file has to be handed over. Two kinds:\n` +
        `   (a) WHAT IS IN A DOCUMENT — a summary, one figure, one clause, "what is this file about". ` +
        `Put the paths in "paths", taken from the two manifests above OR from what the human just typed. Do not invent a path.\n` +
        /**
         * ⚠ A LIST OF EXAMPLES BEATS AN ABSTRACT RULE — measured 08/24.
         *
         * The first version of this line listed outright *"restaurants,
         * weather, news"*, with the rule prioritizing a worker sitting four
         * lines below it. Result, on an office that HAD a `nguoi-tim-tin`
         * worker (pitch: *"browses the web, cross-checks multiple sources,
         * cites them"*):
         *
         *   "Find 5 coffee shops in district 1"   → lookup  ❌ (should be task)
         *   "Today's tech news"                    → lookup  ❌ (should be task)
         *
         * The model matched the example list and stopped, never reaching the
         * rule. ⇒ **the condition has to sit ON THE EXACT LINE carrying the
         * example**, not in a separate sentence.
         */
        `   (b) A GENERAL LOOKUP that NO employee on the roster specialises in — the weather, an ` +
        `address, a real-world figure, "what is X". Then leave "paths" as an EMPTY array.\n` +
        `       ⚠ If the roster HAS someone who researches, looks things up or browses the web, every ` +
        `lookup goes to them ("task"), restaurants and news included: they cross-check several ` +
        `sources and cite them, which "lookup" does not.\n` +
        /**
         * ⚠ THE CONDITION SITS ON THE EXACT LINE CARRYING THE EXAMPLE — the same
         * pattern that already won for `runs commands: OFF` and for branch (b)
         * above. Turning it into a rule sentence elsewhere means the model
         * matches the example and stops, never reaching it.
         * → [[agentco-prompt-rules-lose-to-examples]]
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ 🔴 A REAL CASE 08/30: a user asked *"which jobs are assigned to me?"*      │
         * │ The Assistant wrote a brief: *"…filter jobs assigned to the user with       │
         * │ email an.nguyen@gmail.com"* — an email it **had no way at all to           │
         * │ know**, and got wrong. The worker searched exactly per the brief,           │
         * │ found nobody, reported back. 6 turns, $0.1409, a useless answer.           │
         * │                                                                    │
         * │ The Assistant plans BEFORE any arm call is made, so structurally it        │
         * │ **cannot** know who the user is inside a given service. Any identifier      │
         * │ it writes is a guess — even when the guess happens to be right.            │
         * │                                                                    │
         * │ ⚠ And a NEAR-CORRECT identifier is more dangerous than an obviously        │
         * │ wrong one: this time it failed loudly (no user existed with that           │
         * │ email), but if the guess had happened to land on a different real            │
         * │ person in the workspace, *"my own work"* would return someone else's        │
         * │ work — confidently, cleanly, with a supporting file, and nobody would       │
         * │ catch it.                                                          │
         * └────────────────────────────────────────────────────────────────────┘
         */
        `{"intent":"task","request":"<the request rewritten as one clear sentence with enough context>","scope":"new"}\n` +
        `  use when: it is clear enough to hand to the team.\n` +
        `   ⚠ Keep "I"/"me"/"my" EXACTLY as they are; never swap in a name, an email or an id — ` +
        `you have no way of knowing who the human is inside that service, and a near-miss guess is ` +
        `worse than an obvious one. Write "the account signed in on that connection"; the employee ` +
        `asks the arm itself.\n` +
        `      ✅ "…filter the issues assigned to the account signed in on the Linear connection"\n` +
        `      ⛔ "…filter the issues assigned to the user with email an@example.com"\n` +
        /**
         * THE RULE THAT SPLITS `lookup` FROM `task` — one sentence, and it has
         * to sit on the right AXIS.
         *
         * The question is NOT *"who is capable of doing this"* — a translator
         * can absolutely read and summarize a document, a user has already
         * proven that on a real machine. The question is *"would the result
         * differ depending on who does it"*.
         *
         * Translating a document DOES differ: it depends on a terminology
         * table, a voice, a charter — i.e. it depends on `role`. Reporting
         * back what a document says does NOT: anyone reading it lands in the
         * same place.
         *
         * And this is also the answer to the case *"a user creates a
         * read-only worker on their own, then finds the Assistant doing
         * everything itself"*: that worker exists because they bring a
         * PERSPECTIVE (contract review, figure-checking), so any question
         * needing that perspective still goes to them under this exact rule.
         * `lookup` only takes the part where a role adds nothing at all —
         * that part was never really anyone's job to begin with.
         */
        `Telling "lookup" from "task": ask whether a DIFFERENT PERSON doing it would give a different ` +
        `result. Translating, writing, reviewing, advising — YES, different, because it turns on each ` +
        `employee's expertise and voice → "task". Reading a document and reporting what it says — ` +
        `anyone reading it lands in the same place → "lookup". ` +
        `If a FILE has to come out for the human to keep, it is always "task".\n` +
        /**
         * The PRIORITY rule, user settled 08/24: *"allow both lookup and a
         * worker, let the assistant route on its own, but favor the worker
         * when that worker is a specialist who can do the job precisely"*.
         *
         * This does NOT change the axis already stated above — it breaks a
         * tie. The axis is *"would a different person's result differ"*; when
         * both sides look equal, lean toward the worker. The reason for the
         * asymmetry: picking `task` wrongly costs extra money and time,
         * picking `lookup` wrongly means the user **loses a specialist
         * perspective they deliberately built**, and nobody notices it's
         * gone, because the answer still reads smoothly.
         */
        `When the two look equally good, LEAN TOWARDS AN EMPLOYEE: if someone on the roster has this ` +
        `as their speciality, give it to them ("task"). "lookup" is for the cases where no role adds ` +
        `anything.` +
        scopeHint +
        reachHint,
    );

    // The decision is a PURE function with its own test suite. What's left
    // here is only the side effect: logging a broken case. → `decideRoute`
    let value = decideRoute(text);

    // A rescue gate gets logged, because a silent rescue gate is a quiet
    // funnel: the model forgets `intent` forever with nobody noticing. →
    // `RouteOutcome.salvaged`
    if ('salvaged' in value && value.salvaged) {
      this.logFailure('route-salvage.log', message, text.trim());
    }

    /**
     * ┌──────────────────────────────────────────────────────────────────────────┐
     * │ 🔴 A RESCUE SENTENCE HAS TO BE WRITTEN BY THE MODEL, NOT ONE OF OUR OWN         │
     * │ CONSTANTS. (user settled 08/28)                                           │
     * │                                                                          │
     * │ > *"the fallback still needs to be parsed through the LLM so it speaks           │
     * │ >  human again, but it needs the exact right context, otherwise even a           │
     * │ >  person would struggle to understand it"*                                │
     * │                                                                          │
     * │ Three things a hardcoded string can't do, and all three had already            │
     * │ bitten:                                                                    │
     * │  ① **Language.** It was Vietnamese pinned in the source, sitting in the           │
     * │     middle of a chat line where every other sentence follows the                  │
     * │     language the user is typing in.                                        │
     * │  ② **Cause.** It guessed *"my own mistake"* when the real case was a             │
     * │     **disconnected connection** — the user read it and looked in the              │
     * │     wrong place.                                                           │
     * │  ③ **A way out.** It said *"message the exact same thing again"*, and the         │
     * │     user did exactly that and got back the exact same thing. A                    │
     * │     deterministically wrong piece of advice is worse than silence.              │
     * │                                                                          │
     * │ ⚠ BUT "let the model speak" must NOT become "let the model explain the           │
     * │ system on its own" — a rule already established in `roster()`, born from          │
     * │ the *"this office has no search connection"* case (WRONG, and sounding            │
     * │ very plausible). So this repair turn hands over **the exact text it just          │
     * │ said** and makes it RESTATE, not diagnose. That's exactly the "needs the           │
     * │ exact right context" the user described.                                   │
     * │                                                                          │
     * │ The same pattern as the `stale` gate right below: deterministic detection         │
     * │ first, call the model second, **repair exactly once**. Clean means 0 cost.        │
     * └──────────────────────────────────────────────────────────────────────────┘
     */
    if (value.intent === 'garbled') {
      this.logFailure('route-failure.log', message, value.raw);
      /**
       * ⚠ ANCHOR TO **WHAT THE USER WANTS**, not to what broke. (user 08/28)
       *
       * > *"ALWAYS STAY ANCHORED TO WHAT GOAL THE USER'S QUESTION IS TRYING TO
       * >  REACH. Example: I want to read toeic-learning → report that the
       * >  GitHub MCP connection can't be reached right now because it was
       * >  just disconnected"*
       *
       * The goal ALREADY lives in the session history (`askSession` runs on
       * the Assistant's own session). It's restated verbatim here because a
       * repair turn talking about **format** very easily pulls the model into
       * answering about the format — i.e. answering the last question it just
       * read, and that question is OUR OWN. The user is still waiting to find
       * out whether that repo can be read.
       *
       * Extra token cost? Only on the already-broken branch, and only the
       * length of the sentence they just typed.
       */
      const goal =
        `What the human wants: "${truncateToTokens(message, 200)}".\n` +
        `Your reply has to be about THAT — either it can be done, or it cannot and here is what is ` +
        `missing. Do NOT talk about formats or technical errors: the human never sees any of that.\n`;
      const repair = await this.askSession(
        value.raw
          ? `⚠ Your last turn returned something the system could NOT use. Verbatim:\n\n${value.raw}\n\n` +
              goal +
              `If that verbatim text ALREADY contains an answer for the human, REPEAT THAT EXACT ` +
              `sentence in the right format, {"intent":"chat","say":"…"}. If it does not, write a ` +
              `short one yourself.\n` +
              `⚠ Do NOT guess at a technical cause. Say only what you can READ in the roster above ` +
              `(for example: no employee is wired to the connection this needs). ` +
              `Write it in the same language the human is using.`
          : `⚠ Your last turn returned nothing at all.\n` + goal + `Answer again, in the JSON format above.`,
      );
      usage = addUsage(usage, repair.usage);
      const fixed = decideRoute(repair.text);
      // Only when the repair turn ALSO fails does it fall through to a
      // hardcoded string. That's a **last resort**, not a normal gate — and
      // by now it's rare enough that seeing it fire is itself a real signal.
      if (fixed.intent !== 'garbled') value = fixed;
      else this.logFailure('route-failure.log', `${message}\n[the repair turn failed too]`, fixed.raw);
    }

    /**
     * STEP 2 — THE POST-CHECK GATE. This is the thing that actually blocks. →
     * `staleArmMentions`
     *
     * Clean costs 0: a string comparison against a finite list. Only a HIT
     * pays for a repair turn — the same pattern as a worker's own
     * `repairReceipt` (`worker.ts:401`): deterministic detection first, call
     * the model second.
     *
     * Repairs exactly ONCE. Looping here would burn money on something
     * already known to be unclosable completely.
     */
    const stale = this.staleArmMentions(routeText(value), message);
    if (stale.length) {
      const repair = await this.askSession(
        `⚠ Your last sentence mentioned ${stale.map((s) => `"${s}"`).join(', ')} — but NO employee on ` +
          `the current roster reaches that any more. That is STALE information left over from an ` +
          `earlier conversation, not the state of things now.\n` +
          `Re-read the employee list above and answer the human again, in the JSON format above.`,
      );
      usage = addUsage(usage, repair.usage);
      const fixed = decideRoute(repair.text);
      // If the repair breaks the format, KEEP the first version: an old
      // sentence that's still readable beats one that isn't usable at all.
      // Same rule as "never expose raw JSON to the user".
      if (fixed.intent !== 'garbled') value = fixed;
      // Still mentioned ⇒ this is the gate's own escape case, and it has to
      // leave a trace. Without this line, "narrowed, not closed" would be a
      // sentence nobody could measure.
      if (this.staleArmMentions(routeText(value), message).length) {
        this.logFailure('route-stale.log', message, `${stale.join(' · ')}\n${routeText(value)}`);
      }
    }
    return { value, usage };
  }

  // `chat()` was REMOVED (08/19) — it was dead code, and wiring it back up
  // would be a bug.
  //
  // `route()` already returns `say` for both `chat` and `ask`, and
  // `handleUserBatch` emits that sentence directly. Calling a separate
  // `chat()` function after `route()` would mean TWO model turns for a single
  // greeting — on the single busiest road in the whole product. →
  // docs/SPEC-offices.md §6

  // ── internal

  /**
   * On the Assistant's session.
   *
   * The model is reread on EVERY turn, deliberately. A comment here used to
   * say "the model is FIXED — never changes mid-run", but that described a
   * limitation, not an invariant: the user is allowed to change the
   * Assistant's model, and the cost of doing so is already well understood
   * (SPEC-offices.md §4.5).
   *
   * What's ACTUALLY invariant is: changing the model must NOT touch a
   * currently running job. That's already true — `Office.applyCompanyConfig`
   * builds a NEW `LoadedOffice`, while the scheduler of a currently running
   * job keeps the old object it grabbed from the start. And the Assistant
   * only does one thing at a time (the mailbox is locked), so no turn ever
   * gets its model swapped mid-way.
   */
  /**
   * The model's raw output, for whoever debugs it. NOT for the user.
   *
   * The chat sentence has to stay short and state what to do; diagnosing a
   * broken case needs the full text. A logging failure must NEVER swallow the
   * original case: the user is waiting for an answer, not a file-write error.
   */
  private logFailure(file: string, request: string, raw: string): void {
    try {
      fs.mkdirSync(this.office.paths.state, { recursive: true });
      fs.appendFileSync(
        path.join(this.office.paths.state, file),
        `\n=== ${new Date().toISOString()}\n--- request\n${request}\n--- model returned (${raw.length} chars)\n${raw || '(EMPTY)'}\n`,
        'utf8',
      );
    } catch {
      /* Failing to write the log must still let the user get an answer. */
    }
  }

  private askSession(prompt: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, this.model, true);
  }

  /** An independent query, doesn't touch the session. Safe to switch models here. */
  private askOneShot(prompt: string, model: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, model, false);
  }

  private async run(
    prompt: string,
    model: string,
    useSession: boolean,
    /**
     * The override for the HIDDEN WORKER — deliberately EXACTLY TWO fields.
     *
     * Everything else (`abortController`, `settingSources`, `strictMcpConfig`,
     * `persistSession`) has to stay identical for every turn. Widening this
     * into a free-form options object invites someone, someday, to
     * accidentally drop `abortController` for one branch, and `/stop` would
     * silently stop working on exactly that branch — the failure class just
     * fixed this morning.
     */
    override?: { systemPrompt: string; tools: string[] },
    /**
     * Set ONLY by `undrift` on its own second turn. Without it the check would
     * run on its own repair and could loop forever — a gate that pays for a
     * turn each time round.
     */
    repairing = false,
  ): Promise<{ text: string; usage: Usage }> {
    let usage: Usage = { ...EMPTY_USAGE };
    let text = '';

    // One handle PER TURN, never reused: an `AbortController` that's already
    // aborted stays aborted forever, so reusing it means the very next turn
    // dies the instant it's created. See `inflight`.
    const controller = new AbortController();
    this.inflight = controller;
    // The conversation pointer BEFORE this turn — see the `aborted` branch in `catch`.
    const sessionBefore = this.sessionId;

    try {
      for await (const msg of query({
        /**
         * ⚠ STREAMING INPUT, NOT A PLAIN STRING — and this is the condition for
         * `canUseTool` to fire at all. Passing `prompt` as a plain string makes
         * the SDK **silently skip `canUseTool`**: no error, no warning, the
         * tool still runs, and the gate simply doesn't exist.
         *
         * Measured 08/19: the Assistant could `Grep` into the notebook of a
         * worker that had already been unwired, `gate.log` was completely
         * empty. Worse still, when asked about a file outside its allowed
         * scope it answered *"I don't have permission to view that"* — **the
         * model was narrating from the directory map in the prompt**, while
         * actually holding full access. Exactly what the rule *"never let the
         * model explain the system to the user on its own"* forbids: sounding
         * very plausible and being completely wrong.
         *
         * This generator yields ONCE then ends, so the stream closes right
         * away — the opposite of the DEADLOCK case in §8, which came from
         * KEEPING the stream open to wait for `interrupt()`.
         */
        prompt: oneShot(prompt),
        options: {
          systemPrompt: override?.systemPrompt ?? this.systemPrompt(),
          model,
          cwd: this.office.dir,
          maxTurns: 4,
          settingSources: [],
          strictMcpConfig: true,
          /**
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ `tools` RESTRICTS. `allowedTools` ONLY AUTO-APPROVES. TWO DIFFERENT     │
           * │ THINGS.                                                           │
           * │                                                                  │
           * │ The old version only set `allowedTools: []` and assumed that meant       │
           * │ "the Assistant has no tools". It didn't — that's the exact hole            │
           * │ already found in the worker on 08/16 (§5d): `allowedTools` doesn't         │
           * │ cut a tool out of context, so the DEFINITION of the entire Claude          │
           * │ Code toolset still sits in the prefix — here, `route()`'s own prefix,       │
           * │ which runs on EVERY MESSAGE the user types. The worker got fixed          │
           * │ 08/16; the Assistant got overlooked.                                │
           * │                                                                  │
           * │ `tools` has to ALWAYS be passed, even when the list is empty — and         │
           * │ here it's GENUINELY empty.                                          │
           * └──────────────────────────────────────────────────────────────────┘
           *
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ WHY THE ASSISTANT DOESN'T HAVE `Grep` — even though everyone wants it.   │
           * │                                                                  │
           * │ On 08/19 there was an attempt to grant `Grep`/`Glob` alongside a           │
           * │ directory-based blocking gate, so it couldn't read the notebook of a       │
           * │ worker that had been unwired. **Three mechanisms, none of them             │
           * │ blocked it:**                                                      │
           * │                                                                  │
           * │   `canUseTool`                     → never fired                    │
           * │   `canUseTool` + streaming input   → never fired                    │
           * │   `PreToolUse` hook (± `matcher`)  → never fired                    │
           * │                                                                  │
           * │ Measured by logging every decision to `.state/gate.log`: the file was     │
           * │ COMPLETELY EMPTY while `Grep` kept running and kept reading forbidden      │
           * │ files. Best guess: a read-only tool gets auto-approved by the CLI          │
           * │ itself and never goes through any approval path at all. Unconfirmed,       │
           * │ so **don't build anything on top of this** until it's measured again.      │
           * │                                                                  │
           * │ 🔥 And here's why it had to be REMOVED ENTIRELY rather than             │
           * │ "accepted for now": when asked about a file outside its scope, the         │
           * │ Assistant answered *"I don't have permission to view system config           │
           * │ files"* — it was NARRATING from the directory map in the prompt,           │
           * │ while actually holding full access. With no fence at all, at least          │
           * │ it's known there's none; a fake fence the model narrates back              │
           * │ confidently is far worse. Exactly the rule "never let the model            │
           * │ explain the system to the user on its own".                          │
           * │                                                                  │
           * │ A real way forward DOES exist — declaring its own MCP tool with a           │
           * │ `where` ENUM built from `assignableRoles()`, so a wrong call can't          │
           * │ even be phrased. But "the Assistant holds NO MCP connection" is a           │
           * │ hard rule: MCP breaks the prompt cache on resume (~36K tokens/turn),        │
           * │ and `route()` resumes on every message. Trading 36K tokens/turn for a       │
           * │ convenience is a heavy loss.                                        │
           * │                                                                  │
           * │ And the cost of removing it: MEASURED AT ZERO. Rerunning test 2, the        │
           * │ Assistant called no tool at all — the library manifest already in the       │
           * │ prefix was enough for it to plan correctly.                          │
           * └──────────────────────────────────────────────────────────────────┘
           */
          /**
           * `tools` RESTRICTS — so the hidden worker gets exactly three
           * read-only tools and CANNOT write a file. `allowedTools` matches it
           * so they don't trigger an approval prompt: this is a background
           * turn, with nobody there to click anything.
           */
          tools: override?.tools ?? [],
          allowedTools: override?.tools ?? [],
          abortController: controller,
          ...(useSession ? {} : { persistSession: false }),
          ...(useSession && this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const m = msg as Record<string, unknown>;
        // The account usage limit rides along the stream, FOR FREE. The
        // Assistant opens a query on EVERY message the user types, so this is
        // the densest update source — even when no worker is running at all.
        // → `core/energy.ts`
        if (m['type'] === 'rate_limit_event') noteRateLimit(m['rate_limit_info']);
        // ONLY records the session id when running ON the Assistant's own
        // session. A one-shot query (planning) also generates its own
        // session_id — overwriting with it would lose conversation memory.
        if (useSession && typeof m['session_id'] === 'string' && (m['type'] === 'result' || m['subtype'] === 'init')) {
          this.sessionId = m['session_id'];
        }
        if (m['type'] === 'result') {
          const u = (m['usage'] ?? {}) as Record<string, number>;
          // Only measured on the REAL session. A one-shot query (planning) has
          // its own separate context, so taking its numbers would measure the
          // wrong thing.
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
          /**
           * AN ERROR RESULT MUST NOT PASS THROUGH AS AN EMPTY RESULT (08/20).
           *
           * The SDK reports an error TWO ways: throwing an exception (caught
           * in the `catch` below), and — for an error occurring MID-RUN —
           * returning a `result` message carrying `is_error: true` /
           * `subtype: 'error_*'`. The second path throws nothing at all, so
           * the old version let it fall through to `text = ''` and continued
           * as if the model had finished answering with nothing to say.
           *
           * Consequence: the layer above reads an empty string, fails to
           * parse JSON, and blames the user's phrasing — while what actually
           * happened was running out of usage, a lost connection, or hitting
           * the turn cap. `classifyError` is what's supposed to decide, and
           * it can only decide if the error actually REACHES it.
           */
          const failed =
            m['is_error'] === true ||
            (typeof m['subtype'] === 'string' && m['subtype'].startsWith('error'));
          if (failed) {
            /**
             * ┌──────────────────────────────────────────────────────────────┐
             * │ 🔴 THIS IS THE SPOT WHERE A USER COULD READ THE RAW TEXT             │
             * │ `error_max_turns`. (user 08/27: *"why does it return an                │
             * │  error_max_turns that nobody understands"*)                       │
             * │                                                              │
             * │ The SDK returns `subtype: 'error_max_turns'` with an EMPTY `result`,     │
             * │ so the old line fell through to the second branch and threw the         │
             * │ **raw machine code** straight onto the screen. Not a logic bug —          │
             * │ just nobody had translated it yet.                                  │
             * │                                                              │
             * │ ⚠⚠ HAS TO CLASSIFY ON THE ORIGINAL CODE, NOT ON THE TRANSLATED           │
             * │ SENTENCE. `classifyError` matches with the regex `/max_turns/`.          │
             * │ Translating first and classifying second means the translated            │
             * │ sentence matches nothing at all ⇒ every error falls back to `other`       │
             * │ ⇒ the layer above mishandles it, **silently**. A wording fix that          │
             * │ breaks the control flow is a cost nobody sees.                      │
             * └──────────────────────────────────────────────────────────────┘
             */
            const raw =
              (typeof m['result'] === 'string' && m['result'].trim()) ||
              (typeof m['subtype'] === 'string' ? m['subtype'] : 'unknown error from Claude Code');
            const kind = classifyError(raw);
            throw new RunError(sayError(raw, kind), kind, { cause: m });
          }
          text = typeof m['result'] === 'string' ? m['result'] : '';
        }
      }
    } catch (err) {
      /**
       * A USER-REQUESTED INTERRUPT IS NOT AN ERROR — check the HANDLE, don't
       * read the error's own wording.
       *
       * The SDK throws an `AbortError` when aborted, and the natural
       * temptation is to compare the error name or scan `message` for the
       * word "abort". Both are guesses on a string generated by an outside
       * library, and will drift the day it rewords it. `controller.signal.
       * aborted` is a FACT we caused ourselves and can observe directly —
       * the exact same rule that already rejected regex-guessing in
       * `landingOf`.
       *
       * Has to come BEFORE the `RunError` branch: a `usage_limit` thrown at
       * the exact moment the user hits Stop is still, in truth, "stopped".
       */
      if (controller.signal.aborted) {
        /**
         * RETURNS THE CONVERSATION POINTER TO WHERE IT WAS.
         *
         * `sessionId` is recorded from the `init` message, i.e. RIGHT AT THE
         * START of a turn — before the model has said a single word.
         * Interrupting mid-run and keeping the new pointer means the next
         * turn's `resume` lands on a HALF-WRITTEN record, and the cost of a
         * broken record is the entire conversation memory — the most
         * expensive thing in the product.
         *
         * The old record still sits intact on disk
         * (`~/.claude/projects/`, append-only), so reverting is safe. The
         * meaning is also correct: the user hit Stop, so that turn NEVER
         * HAPPENED — no sentence was said, nothing to remember.
         */
        this.sessionId = sessionBefore;
        throw new RunError(t('as.stoppedByUser'), 'stopped', { cause: err });
      }
      // A `RunError` thrown by the loop above passes THROUGH DIRECTLY: it
      // already carries the right `kind`, and wrapping it again would run
      // `classifyError` on its own already-translated sentence and could
      // someday demote a `usage_limit` down to `other`.
      if (err instanceof RunError) throw err;
      throw new RunError(err instanceof Error ? err.message : String(err), classifyError(err), {
        cause: err,
      });
    } finally {
      // Only cleans up ITS OWN handle. The mailbox is locked so two turns
      // can never overlap, but this comparison turns that into a GUARANTEE
      // rather than an assumption — if the lock ever leaks, deleting the
      // wrong turn's handle would mean `/stop` silently stops working,
      // exactly the failure class just fixed.
      if (this.inflight === controller) this.inflight = undefined;
    }

    return repairing ? { text, usage } : this.undrift(prompt, text, usage, model, useSession, override);
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE ONE CHOKE POINT — every door the Assistant speaks through goes        │
   * │ past this line. → `core/language-drift.ts` for WHY this is code and not   │
   * │ a sentence in a prompt.                                                  │
   * │                                                                          │
   * │ `route` · `plan` · `report` · the `/clear` memory all reach the model     │
   * │ through `run()`, so guarding `run()` covers them in one place instead of  │
   * │ four prompt builders that would drift apart. Four builders is the shape   │
   * │ that has already cost this repository three times.                       │
   * │ → [[agentco-finish-completely]]                                          │
   * │                                                                          │
   * │ ⚠ `override` is set ONLY by `lookup` and the hidden worker, and both are  │
   * │ DELIBERATELY EXCLUDED: they report what a document says, so a Vietnamese  │
   * │ document answered to an English question is CORRECT, and repairing it     │
   * │ would burn a turn to make the answer worse. The exclusion rides on the    │
   * │ existing parameter rather than a new flag — there is nothing extra to     │
   * │ remember, and a future door that passes `override` opts out by itself.    │
   * │                                                                          │
   * │ ⚠ Clean costs ZERO: two string scans, no model call. Only a hit pays.     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Repairs exactly ONCE, and KEEPS THE FIRST ANSWER unless the second is
   * both non-empty and actually fixed. A sentence in the wrong writing system
   * is still readable; an empty one, or a second wrong one, is not an
   * improvement worth overwriting a real answer with. Same rule as the stale
   * gate in `route()`.
   */
  private async undrift(
    prompt: string,
    text: string,
    usage: Usage,
    model: string,
    useSession: boolean,
    override?: { systemPrompt: string; tools: string[] },
  ): Promise<{ text: string; usage: Usage }> {
    if (override || !driftsFrom(this.lastHuman, text)) return { text, usage };
    this.logFailure('language-drift.log', this.lastHuman, text);

    /**
     * A SESSION door repairs on the session — the whole exchange is already
     * there, so the turn only has to carry the correction.
     *
     * A ONE-SHOT door has no history at all, so it gets the original prompt
     * back plus the exact text it just produced, and is made to RESTATE it.
     * Handing over its own words rather than describing them is the same rule
     * the rescue turn in `route()` already runs on.
     */
    const fix = await this.run(
      useSession
        ? driftRepair(this.lastHuman)
        : `${prompt}\n\n--- You already answered this, like so:\n${text}\n\n${driftRepair(this.lastHuman)}`,
      model,
      useSession,
      override,
      true,
    );
    const merged = addUsage(usage, fix.usage);
    const better = fix.text.trim() && !driftsFrom(this.lastHuman, fix.text);
    return { text: better ? fix.text : text, usage: merged };
  }
}

function clampStep(step: number, count: number): number {
  return Math.max(0, Math.min(step, Math.max(0, count - 1)));
}

/**
 * A plan code — HUMAN-READABLE BY EYE. → docs/SPEC-artifacts.md §2.1
 *
 * ```
 * old   P-mt08w0t8-iu50     base36 of Date.now()
 * new   P-260819-1430-iu50
 * ```
 *
 * The same amount of information, differing in that a human can read it. This
 * code becomes a DIRECTORY NAME (`artifacts/<plan_id>/`) and the user is told
 * to go open it in a file explorer, so "readable" isn't a cosmetic concern.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NEEDS NO MIGRATION, and the reason is STRUCTURAL, not luck: `plan_id` is        │
 * │ NEVER PARSED ANYWHERE. It's only a key and a path segment. Old plans keep       │
 * │ their old names, new plans get new names, the two shapes coexist            │
 * │ indefinitely. Lexicographic sorting still matches chronological order for       │
 * │ both.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The four random characters stay: a minute is a coarse resolution, and two
 * plans in the same minute collide with probability 1/36⁴ ≈ 1/1,680,000.
 */
export function newPlanId(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `P-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
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
      /* try the next candidate */
    }
  }
  return undefined;
}

/** Used when logging — makes sure a whole transcript never gets dumped into a small log file. */
export function briefText(s: string): string {
  return truncateToTokens(s.replace(/\s+/g, ' ').trim(), 200);
}
