/**
 * Scheduler: runs a task DAG in parallel.
 *
 * → docs/SPEC-2026-08-14-agentco.md §7, §9b
 */

import fs from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * ⚠ Imported under other names ON PURPOSE. This file already binds `t` to a task
 * in a dozen loops and `say` to a receipt line, and shadowing either of them
 * would make `t('key')` compile as a call on a task object. The repo convention
 * is `t` / `plural`; this is the one file where the names were already taken.
 */
import { plural as pluralOf, t as phrase } from '../i18n/index.js';
import { CachePrimingGate } from './gate.js';
import { buildWorkerPrompt } from './prompt.js';
import { existsOnDisk, isUrlInput, resolveInput, safeJoin } from './paths.js';
import { armDirIndex } from './catalog.js';
import { addUsage, filesOnDisk, runWorker, straysOnDisk, type WorkerHandle } from './worker.js';
import type { LoadedOffice } from './config.js';
import type { KnowledgeStore } from '../knowledge/store.js';
import {
  RunError,
  type AgentEventBody,
  type FailureKind,
  type Plan,
  type Receipt,
  type TaskBrief,
  type Tier,
  type Usage,
} from './types.js';

/** A task that spends no tokens. Defined in one place, reused by three receipts. */
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUSD: 0,
  model: '',
  turns: 0,
};

export interface SchedulerDeps {
  office: LoadedOffice;
  knowledge: KnowledgeStore;
  emit(event: AgentEventBody): void;
  /** Checked between tasks — the user clicking Stop exits cleanly. */
  shouldStop?(): boolean;
  /**
   * Arm audit log. Absent ⇒ don't write (test runs, one-off runs).
   *
   * ⚠ Deliberately optional: losing the log **must not** break a run in
   * progress. Same rule as `appendChat` — see `core/audit.ts §append`.
   */
  audit?: { append(call: Record<string, unknown> & { server: string; tool: string; role: string; args: unknown }): void };
}

export interface RunResult {
  receipts: Map<string, Receipt>;
  /** Tasks that never ran because of the budget cap / being stopped. Kept for `agentco resume`. */
  pending: TaskBrief[];
  stoppedBy?: 'usage_limit' | 'user' | 'auth';
  /**
   * Tokens from turns that WERE SPENT but no receipt carries — a turn that
   * failed with a 429 and got retried from scratch. Without this field, every
   * rate limit hit is an invisible cost, and the exact case that hits 429
   * often is the one where the user most needs to see the number.
   * → `RunError.usage`
   */
  wasted: Usage;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Cap on the number of continuations. **1** (user settled 08/27) — and       │
 * │ this number IS SURFACED.                                                │
 * │                                                                          │
 * │ Why a cap exists even though "must show progress" is already required:     │
 * │ progress can be **real but very slow** (one line added per turn), and       │
 * │ **deterministic does NOT mean cheap** — every continuation is a FULL         │
 * │ worker turn, running all the way to its own turn cap. A cap of 3 means         │
 * │ one task can cost up to **4×** its budget.                                 │
 * │                                                                          │
 * │ ⚠ WHY 1 AND NOT 3: nobody has measured how many rounds a genuinely long     │
 * │ case needs. Picking 3 would be guessing a number — exactly the shape of      │
 * │ the 2,000-token cap that "blocked the very first arm" (§9b). When you        │
 * │ don't know, **the safe direction is LOW**, because the two failure modes      │
 * │ aren't symmetric:                                                        │
 * │                                                                          │
 * │   too low  → the task fails after 2 turns, **with a message, the user       │
 * │              sees it right away**, and they raise `max_turns` or break        │
 * │              the request into smaller pieces — a clear path forward          │
 * │   too high → burns money **silently** on a task that will never finish       │
 * │                                                                          │
 * │ ⇒ Raise it once there's **one genuinely long, measured case**, not on a       │
 * │ hunch. → [[agentco-safe-default-direction]]                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const MAX_CONTINUE = 1;

/**
 * A continuation = **THE SAME task**, plus exactly one added instruction.
 *
 * ⚠ Do NOT stuff a part number or "start from part 4" in here. We don't know
 * how far it got — and guessing rebuilds the exact bug just fixed (the
 * Assistant splitting *"items 1–3, 4–6"* for a list it never actually read).
 * Where to pick up has to be inferred from **what's already on disk**, and
 * the only thing that knows that is the worker itself, when it opens its own
 * output folder.
 */
/**
 * WHETHER TO CONTINUE — a pure function, and pure **on purpose**.
 *
 * This decision sitting inside a `.catch` in the middle of `run()` would be
 * untestable without standing up a real office. And this is exactly the spot
 * that **must** have a test: its two guards block two different kinds of
 * money-burning, and both fail silently when broken.
 */
export function shouldContinue(p: { kind: FailureKind; tried: number; landed: number }): boolean {
  if (p.kind !== 'max_turns') return false;
  // ① Nothing new was produced ⇒ continuing would just loop on a task that
  //    isn't moving.
  if (p.landed <= 0) return false;
  // ② Progress can be REAL but very slow. Without a cap, a poorly-scoped task
  //    would crawl on forever, and the customer is the one paying for it.
  return p.tried < MAX_CONTINUE;
}

/**
 * ⚠ ENGLISH, and not through `t()`: this is appended to a task BRIEF, which an
 * employee reads. Prompt scaffolding follows the source-language rule, never the
 * interface switch. The employee's own reply still follows whatever language the
 * rest of the brief is written in. → docs/CLAUDE.md §Language
 */
const CONTINUE_NOTE =
  'This task was left half-done on the previous turn. Look at the files already in this task’s own ' +
  'output folder, then FINISH WHAT IS MISSING — do not start again from scratch.';

export function continueBrief(brief: TaskBrief): TaskBrief {
  /**
   * ⚠ ADD ONCE, NOT ONCE PER ROUND. (caught by a test)
   *
   * A second round appending an identical line breaks two things at once:
   * inflates the worker's prefix for nothing, and **three identical lines
   * teach the model that line doesn't matter** — exactly the mechanism that
   * makes an instruction stop working.
   */
  if (brief.constraints.includes(CONTINUE_NOTE)) return brief;
  return { ...brief, constraints: [...brief.constraints, CONTINUE_NOTE] };
}

export class Scheduler {
  private readonly gate: CachePrimingGate;
  /** How many times each has been continued, by `task_id`. → `MAX_CONTINUE` */
  private readonly continued = new Map<string, number>();
  /** AIMD: halve on a 429, add 1 after 10 tasks run smoothly. */
  private concurrency: number;
  private readonly maxConcurrency: number;
  private smoothRun = 0;
  /** The plan code for the currently running session — used only to tag the audit log. */
  private planId: string | undefined;
  private readonly runningByTier = new Map<Tier, number>();
  /**
   * Handles of the workers CURRENTLY running. Without this, `stop()` would
   * only be a flag checked BETWEEN tasks — a user clicking Stop would still
   * have to sit and wait for the current task to run to completion, sometimes
   * a whole minute and thousands of tokens.
   * → docs/SPEC-tools-approval.md §3b
   */
  private readonly live = new Set<WorkerHandle>();

  constructor(private readonly deps: SchedulerDeps) {
    const rt = deps.office.company.runtime;
    this.maxConcurrency = rt.concurrency;
    this.concurrency = rt.concurrency;
    this.gate = new CachePrimingGate(ttlMs(rt.cache_ttl), rt.priming_timeout_ms);
  }

  /**
   * LINK MISSING WIRES — fix it, don't report an error. Runs BEFORE `validate`.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A TASK READING ANOTHER TASK'S OUTPUT WITHOUT DECLARING `deps` = A RACE,    │
   * │ AND IT'S SILENT.                                                        │
   * │                                                                          │
   * │ An empty `deps` means "can run in parallel" — so T-02 gets launched at      │
   * │ the same time as T-01, then reads a file T-01 hasn't finished writing        │
   * │ yet. The worker doesn't report an error: it sees an empty/missing file,        │
   * │ improvises, and returns a result that still looks reasonable. Exactly       │
   * │ the kind of costly "conflict" nobody sees.                                 │
   * │                                                                          │
   * │ This relationship is INFERABLE: the same path, one side declares            │
   * │ `outputs`, the other declares `inputs`. We already hold both. Forcing        │
   * │ the model to declare it correctly is paying for uncertainty; fixing it       │
   * │ directly is deterministic and 0 tokens.                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Returns the wires that got auto-linked, so the log can say so instead of
   * silently patching things.
   *
   * Safe against loops: if linking produces a cycle (T-01 also reads T-02's
   * output), `validate` running right after this will catch it — that's why
   * this function must run BEFORE, not after.
   */
  static linkDeps(plan: Plan): string[] {
    const producer = new Map<string, string>();
    for (const t of plan.tasks) for (const o of t.outputs) producer.set(norm(o.path), t.task_id);

    const linked: string[] = [];
    for (const t of plan.tasks) {
      for (const i of t.inputs) {
        const want = norm(i.path);
        // Exact match first; if none, ask "is anyone CURRENTLY WRITING INTO
        // this directory". A directory can have multiple writers, so link ALL
        // of them — missing one wire means a task reads the directory while
        // only half its files exist.
        const exact = producer.get(want);
        const from = exact ? [exact] : producersInto(producer, want);
        for (const d of from) {
          if (d === t.task_id || t.deps.includes(d)) continue;
          t.deps.push(d);
          linked.push(`${t.task_id} → ${d}`);
        }
      }
    }
    return linked;
  }

  /**
   * Reject a broken DAG RIGHT AT PLANNING TIME, without waiting for it to blow
   * up at runtime. Much cheaper: only costs one planning turn, no worker has
   * launched yet.
   *
   * `officeDir` is used to check whether `inputs` actually exist on disk. Not
   * passed ⇒ skip that check — the function still works in tests without
   * standing up a directory.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ REMOVED 08/22: the "wrote outside without shell" gate — DEAD CODE.       │
   * │                                                                          │
   * │ It checked `isAbsolute(o.path)` on `outputs`. But `buildPlan` runs           │
   * │ `outputScoper` over the outputs of EVERY prior task (`assistant.ts:591`),      │
   * │ and that function always returns `artifacts/<plan>/<task>/…` — no branch       │
   * │ for an absolute path. ⇒ the condition was NEVER true in production.          │
   * │                                                                          │
   * │ Its 9 tests still passed because they called `validate` directly with a       │
   * │ hand-built plan, **routing around `buildPlan`**. Proving the mechanism         │
   * │ runs when called directly, then concluding it protects production —           │
   * │ [[agentco-measurement-vs-conclusion]] for the third time in one session.       │
   * │                                                                          │
   * │ And it was also WRONG under the new design: the settled boundary is           │
   * │ *"the office + wherever the user typed"*, enforced in `officeJail` by            │
   * │ string ORIGIN. Writing outward there uses `Write` — **no shell needed**.        │
   * │ A gate that only fires with-shell-required-to-write blocks in the wrong           │
   * │ direction.                                                               │
   * │ → docs/TEST-WALKTHROUGH.md §Test 9b                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  static validate(
    plan: Plan,
    knownRoles: ReadonlySet<string>,
    officeDir?: string,
    /** Arm name → real directory. Missing ⇒ "Musics" gets blocked. → `catalog.ts §armDirIndex` */
    armDirs?: Record<string, string>,
    /**
     * Roles holding at least one connection. The ONLY thing that makes a
     * `kind: "connection"` input believable. → the `connection` branch below
     */
    rolesWithArms?: ReadonlySet<string>,
  ): string[] {
    const problems: string[] = [];
    const ids = new Set(plan.tasks.map((t) => t.task_id));
    const writers = new Map<string, string>();
    const produced = new Set<string>();
    for (const t of plan.tasks) for (const o of t.outputs) produced.add(norm(o.path));

    for (const t of plan.tasks) {
      if (!knownRoles.has(t.role)) problems.push(phrase('plan.noSuchRole', { task: t.task_id, role: t.role }));
      for (const d of t.deps) {
        if (!ids.has(d)) problems.push(phrase('plan.noSuchDep', { task: t.task_id, dep: d }));
      }
      for (const o of t.outputs) {
        const prev = writers.get(o.path);
        if (prev) problems.push(phrase('plan.twoWriters', { task: t.task_id, other: prev, path: o.path }));
        else writers.set(o.path, t.task_id);
      }

      /**
       * AN INPUT POINTING AT NOTHING — checkable, so it must be checked.
       *
       * The Assistant mistyping one character in a document's name means a
       * worker gets a dead path. It doesn't report an error: it goes
       * SEARCHING, spends turns, and either returns `blocked` or, worse,
       * answers with something it made up. The cost is an entire task.
       *
       * Only flags when the path is NOT on disk AND no task produces it.
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ TWO KINDS OF PATHS, TWO CHECKS. (fixed 08/22, a real case)          │
       * │                                                                    │
       * │ The previous version had just ONE check — `safeJoin(officeDir,        │
       * │ path)` — so it carried the built-in premise *"every input lives          │
       * │ inside the office"*. That premise was true until `Bash` shipped            │
       * │ enabled by default, and then it became false.                            │
       * │                                                                    │
       * │ Measured case: a user typed *"Take inventory of the folder                │
       * │ D:\Downloads\..."*. `safeJoin` threw (correctly, that's its job),          │
       * │ the `catch` turned that throw into `exists = false`, and the whole         │
       * │ plan got blocked with **"that file doesn't exist, and no task              │
       * │ produces it"** — while the folder was right there, and the worker           │
       * │ had `Bash` to read it.                                                    │
       * │                                                                    │
       * │ Worse: the Assistant did the RIGHT thing. `ASSISTANT_CORE` instructs        │
       * │ *"a path the human typed is exact — copy it into `inputs`                   │
       * │ verbatim"*. It followed instructions and got blocked for following          │
       * │ them. The bug sat at the validation layer, not the planning layer —          │
       * │ and a `catch` swallowing the error is exactly where it hides.               │
       * │                                                                    │
       * │ ⚠ Split by `isAbsolute`, NOT by "did safeJoin throw". A RELATIVE           │
       * │ path that climbs outside (`../../etc/passwd`) also makes `safeJoin`          │
       * │ throw, but that's a traversal attempt, not something a user typed —          │
       * │ and running `existsSync` on it would measure it against the                 │
       * │ daemon's `cwd`, a root with nothing to do with anyone. It must stay          │
       * │ in the error branch.                                                       │
       * └────────────────────────────────────────────────────────────────────┘
       */
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ A CONNECTION IS NOT A FILE — and it is checked on a DIFFERENT       │
       * │ question. (05/09) → `types.ts §TaskIOSchema`                        │
       * │                                                                    │
       * │ There is nothing on disk to look for, so the file check below would │
       * │ always reject it. What IS checkable, and the only thing worth       │
       * │ checking, is whether the worker this was handed to actually holds a │
       * │ connection at all.                                                  │
       * │                                                                    │
       * │ ⚠ THIS CONDITION IS LOAD-BEARING, not politeness. Without it the    │
       * │ model has a one-word escape hatch out of the file gate: mark a real │
       * │ mistyped path `kind: "connection"` and every check stops. That is   │
       * │ precisely the direction `isUrlInput` refused to guess in —          │
       * │ *"a real filename treated as a URL ⇒ the gate silently turns off"*. │
       * │ Tying it to `role.mcp` makes the lie impossible to tell: a worker   │
       * │ with no connection cannot have meant one.                          │
       * │ → [[agentco-safe-default-direction]]                                │
       * │                                                                    │
       * │ ⚠ It does NOT check that the named thing exists inside that         │
       * │ service. We cannot know without calling the arm, and calling it     │
       * │ here would cost a network round trip at planning time to answer a   │
       * │ question the worker answers for free while doing the work.          │
       * └────────────────────────────────────────────────────────────────────┘
       */
      for (const i of t.inputs) {
        if (i.kind !== 'connection') continue;
        if (!rolesWithArms || rolesWithArms.has(t.role)) continue;
        problems.push(phrase('plan.connectionNoArm', { task: t.task_id, role: t.role, path: i.path }));
      }

      if (officeDir) {
        for (const i of t.inputs) {
          // Not a path — handled by the loop above, on its own question.
          if (i.kind === 'connection') continue;
          const want = norm(i.path);
          // A directory another task is currently writing into also counts as
          // "will exist" — see `contains`.
          if (produced.has(want) || [...produced].some((p) => contains(want, p))) continue;

          // A web address is not a FILE dependency — nothing to exist on disk,
          // and no task "produces" it. → `paths.ts §isUrlInput`
          if (isUrlInput(i.path)) continue;

          const abs = resolveInput(officeDir, i.path, armDirs);
          if (abs && existsOnDisk(abs)) continue;

          // Two different messages for two different problems. "No task
          // produces it" is meaningless for a folder on the user's own
          // machine — it suggests fixing the plan, when what needs fixing is
          // the path they just typed.
          problems.push(
            isAbsolute(i.path)
              ? phrase('plan.inputMissingOnDisk', { task: t.task_id, path: i.path })
              : phrase('plan.inputMissingUnwritten', { task: t.task_id, path: i.path }),
          );
        }
      }
    }

    // cycles
    const state = new Map<string, 0 | 1 | 2>();
    const byId = new Map(plan.tasks.map((t) => [t.task_id, t]));
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) {
        problems.push(phrase('plan.cycle', { trail: [...trail, id].join(' → ') }));
        return;
      }
      state.set(id, 1);
      for (const d of byId.get(id)?.deps ?? []) visit(d, [...trail, id]);
      state.set(id, 2);
    };
    for (const t of plan.tasks) visit(t.task_id, []);

    return problems;
  }

  // ────────────────────────────────────────────────────────────
  //
  // (`norm` at the end of the file: a path must compare equal to itself
  //  whether the model writes `./artifacts/x.md`, `artifacts\x.md`, or
  //  `artifacts/x.md`.)

  async run(plan: Plan): Promise<RunResult> {
    /**
     * The plan code for the CURRENTLY running session — used only to tag the
     * audit log.
     *
     * `TaskBrief` deliberately doesn't carry `plan_id` (it's a task-level
     * unit, not a session-level one), so a worker doesn't know it. Kept here,
     * where it IS known, instead of adding a new field to the brief just to
     * pass a string through. → `core/audit.ts`
     */
    this.planId = plan.plan_id;
    const receipts = new Map<string, Receipt>();
    const remaining = new Map(plan.tasks.map((t) => [t.task_id, t]));
    const failed = new Set<string>();
    const running = new Set<Promise<void>>();
    let stoppedBy: RunResult['stoppedBy'];
    let wasted: Usage = ZERO_USAGE;

    while (remaining.size > 0 && !stoppedBy) {
      if (this.deps.shouldStop?.()) {
        stoppedBy = 'user';
        break;
      }

      const ready = [...remaining.values()].filter((t) =>
        t.deps.every((d) => receipts.has(d) || failed.has(d)),
      );

      // A dependency that hasn't delivered means the child task doesn't run —
      // but WITHOUT silently marking it failed; return a "blocked" receipt so
      // the user sees why.
      for (const t of ready) {
        const stale = unmetDeps(t, receipts, failed);
        if (stale.length) {
          remaining.delete(t.task_id);
          failed.add(t.task_id);
          const blocked: Receipt = {
            status: 'blocked',
            say: phrase('plan.blockedPrevUnfinished'),
            answer: '',
            /**
             * A receipt built by CODE, not run by any worker ⇒ no event to
             * anchor it to. An empty `gist` is the correct answer, and the
             * Assistant will fall back to its own *"no RESULT line"* branch.
             * Making up a sentence here would hand it something that sounds
             * like a fact nobody measured. → `types.ts §gist`
             */
            gist: '',
            artifacts: [],
            lessons: [],
            blocked_on: reasonFor(stale, receipts),
            task_id: t.task_id,
            role: t.role,
            usage: ZERO_USAGE,
            wall_ms: 0,
            reasked: false,
            landed: [],
            looped: false,
            reads: [],
          };
          receipts.set(t.task_id, blocked);
          this.deps.emit({
            type: 'task.blocked',
            task_id: t.task_id,
            role: t.role,
            say: blocked.say,
            reason: blocked.blocked_on ?? '',
          });
        }
      }

      // A global cap AND a per-tier cap. The per-tier cap matters because an
      // expensive model (deep/Opus) eats the subscription budget far faster —
      // running 4 Opus in parallel would burn through a user's plan quickly.
      const launchable: TaskBrief[] = [];
      const perTier = new Map(this.runningByTier);
      for (const t of ready) {
        if (!remaining.has(t.task_id)) continue;
        if (running.size + launchable.length >= this.concurrency) break;
        const tier = this.deps.office.roles.get(t.role)?.model_tier ?? 'standard';
        const cap = this.deps.office.company.runtime.concurrency_by_tier[tier];
        const used = perTier.get(tier) ?? 0;
        if (used >= cap) continue;
        perTier.set(tier, used + 1);
        launchable.push(t);
      }

      if (launchable.length === 0) {
        if (running.size === 0) break; // deadlock, or nothing left to do
        await Promise.race(running);
        continue;
      }

      for (const brief of launchable) {
        remaining.delete(brief.task_id);

        /**
         * INPUTS MUST ACTUALLY EXIST — CHECK RIGHT BEFORE LAUNCH, 0 TOKENS.
         *
         * This is exactly `validate`'s check, but run at the RIGHT TIME.
         * `validate` runs at planning time, while a previous step's files
         * haven't been produced yet, so it's forced to skip every "will
         * exist" path. By now every prior step has finished and the question
         * becomes answerable.
         *
         * Measured 08/20: without this guard, a worker receives a dead path
         * and GOES SEARCHING — `nguoi-soi` took 6 turns (5 of them Glob),
         * `nguoi-gop` took 9 tool turns and then hit `max_turns`. Both landed
         * on exactly what we already knew for free.
         */
        const gone = this.missingInputs(brief);
        if (gone.length) {
          failed.add(brief.task_id);
          receipts.set(brief.task_id, this.blockedReceipt(brief, gone));
          continue;
        }

        // A file that EXISTS on disk but was written by a task that got cut
        // off mid-way — more dangerous than a missing file, because every
        // "does it exist" check passes and a worker genuinely can read it.
        // What's missing lives outside the file. → `interruptedInputs`
        const halfDone = this.interruptedInputs(brief);
        if (halfDone.length) {
          failed.add(brief.task_id);
          receipts.set(
            brief.task_id,
            this.blockedReceipt(
              brief,
              halfDone,
              phrase('plan.blockedPrevCut'),
              phrase('plan.whyHalfWritten'),
            ),
          );
          continue;
        }

        const tier = this.deps.office.roles.get(brief.role)?.model_tier ?? 'standard';
        this.runningByTier.set(tier, (this.runningByTier.get(tier) ?? 0) + 1);
        const p = this.execute(brief)
          .then((receipt) => {
            receipts.set(brief.task_id, receipt);
            if (receipt.status === 'failed') failed.add(brief.task_id);
            this.onSuccess();
          })
          .catch((err: unknown) => {
            const kind = err instanceof RunError ? err.kind : 'other';
            if (kind === 'usage_limit') {
              // Budget exhausted: STOP THE SESSION, no retry. Un-run tasks stay put.
              stoppedBy = 'usage_limit';
              remaining.set(brief.task_id, brief);
              return;
            }
            if (kind === 'auth') {
              stoppedBy = 'auth';
              remaining.set(brief.task_id, brief);
              return;
            }
            /**
             * ┌────────────────────────────────────────────────────────────────┐
             * │ HITTING THE TURN CAP WHILE MAKING PROGRESS ⇒ CONTINUE, DON'T       │
             * │ REPORT FAILURE. (user approved 08/27)                             │
             * │                                                                │
             * │ The case that created this: a task has **N parts**, and **N is       │
             * │ only knowable AFTER the task starts**. The Assistant is forced to      │
             * │ guess N at planning time ⇒ either overestimates (08/27: 3 of 4         │
             * │ tasks empty, $0.12 for three *"the list only has 1 page"*                 │
             * │ replies) or underestimates (a task burns through its cap).             │
             * │ **Both errors are two ends of the same stick.**                        │
             * │                                                                │
             * │ ⚠ WHY NOT LET THE ASSISTANT RECONSIDER: it would have to pay for         │
             * │ another model turn, with FAR LESS information than the worker            │
             * │ just had (it only sees one `say` line, not those other 15                 │
             * │ turns). A "try a different approach" mechanism at that layer is           │
             * │ **guessing**, and guessing at the planning layer spawns more              │
             * │ tasks. Here it's the opposite: **0 tokens for the decision**,             │
             * │ and where to pick up reads from a FILE THAT ACTUALLY EXISTS ON            │
             * │ DISK. → [[agentco-deterministic-vs-signal]]                       │
             * │                                                                │
             * │ TWO GUARDS, missing either one spawns a money-burning loop:              │
             * │   ① there must be PROGRESS (`landed` non-empty) — without it,            │
             * │      continuing is an infinite loop on a task that isn't moving          │
             * │   ② capped at 3 continuations, and that number IS SURFACED to             │
             * │      the user                                                          │
             * └────────────────────────────────────────────────────────────────┘
             */
            {
              const alreadyContinued = this.continued.get(brief.task_id) ?? 0;
              const progressed = err instanceof RunError ? (err.observed?.landed.length ?? 0) : 0;
              if (shouldContinue({ kind, tried: alreadyContinued, landed: progressed })) {
                this.continued.set(brief.task_id, alreadyContinued + 1);
                // ⚠ RECORD BEFORE CONTINUING — same reason as the `rate_limit`
                // branch: the turn that just got cut off spent real tokens, and
                // `max_turns` is by definition the MOST EXPENSIVE failure mode
                // (it runs all the way to its turn cap).
                if (err instanceof RunError && err.usage) wasted = addUsage(wasted, err.usage);
                this.deps.emit({
                  type: 'task.progress',
                  task_id: brief.task_id,
                  role: brief.role,
                  say: phrase('plan.continuing', { n: String(alreadyContinued + 1), max: String(MAX_CONTINUE) }),
                });
                remaining.set(brief.task_id, continueBrief(brief));
                return;
              }
              // No progress, or already continued the full 3 times ⇒ report a
              // REAL failure, and `worker.ts`'s own message already covers the
              // *"something outside may have changed"* part when an arm was
              // involved.
            }
            if (kind === 'rate_limit') {
              this.onRateLimit();
              // ⚠ RECORD BEFORE RETRYING. The turn that just failed spent real
              // tokens; the task retries from scratch and spends more. Without
              // recording it here, every 429 hit is an invisible cost, and the
              // exact case that hits 429 often is the one where the user most
              // needs to see the number. → `RunError.usage`
              if (err instanceof RunError && err.usage) wasted = addUsage(wasted, err.usage);
              remaining.set(brief.task_id, brief); // retry next round
              return;
            }
            failed.add(brief.task_id);
            receipts.set(brief.task_id, this.errorReceipt(brief, err, kind));
          })
          .finally(() => {
            running.delete(p);
            this.runningByTier.set(tier, Math.max(0, (this.runningByTier.get(tier) ?? 1) - 1));
          });
        running.add(p);
      }

      if (running.size >= this.concurrency) await Promise.race(running);
    }

    await Promise.allSettled(running);

    const result: RunResult = { receipts, pending: [...remaining.values()], wasted };
    if (stoppedBy) result.stoppedBy = stoppedBy;
    return result;
  }

  /**
   * `inputs` not present on disk. Empty = safe to launch. → `run()`
   *
   * ⚠ Must use the EXACT SAME `resolveInput` that `validate` uses. This is the
   * second gate enforcing the same rule, run right before launching a worker
   * — if the two gates understand "valid input" differently, a plan clears
   * gate one and then dies at gate two, and the user gets a rejection for
   * something the system just approved.
   */
  private missingInputs(brief: TaskBrief): string[] {
    // ⚠ THE SAME arm table that `validate` uses. A mismatch here means a plan
    // clears gate one and dies at gate two — exactly what the comment block
    // above warns about.
    const armDirs = armDirIndex(this.deps.office.company.arms, this.deps.office.company.mcpServers);
    const out: string[] = [];
    for (const i of brief.inputs) {
      // ⚠ THE SAME exclusions that `validate` uses — otherwise a plan clears
      // gate one and dies at gate two, exactly what the comment block above
      // warns about. A connection names a thing inside a service; there is no
      // path, so "is it on disk" is not a question about it.
      if (i.kind === 'connection') continue;
      if (isUrlInput(i.path)) continue;
      const abs = resolveInput(this.deps.office.dir, i.path, armDirs);
      if (!abs || !existsOnDisk(abs)) out.push(i.path);
    }
    return out;
  }

  /**
   * `inputs` pointing at the output of a task that GOT CUT OFF MID-WAY.
   * → SPEC-offices §6b
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A HARD GUARD. Hiding the path in the roster is a SOFT one — a model can       │
   * │ still guess it, because `artifacts/<plan>/<task>/…` follows a clear             │
   * │ pattern. And a user can paste an old path directly with `@`.                    │
   * │                                                                          │
   * │ This gate needs no roster, no model cooperation: it READS BACKWARD from        │
   * │ the path itself. `artifacts/P-…/T-01/x.md` declares which plan and              │
   * │ which task on its own, so looking up that task's receipt is enough.             │
   * │ Deterministic, 0 tokens.                                                 │
   * │                                                                          │
   * │ Measured 08/21, twice in a row (hd3 3/5, hd4 4/5): without this gate, an        │
   * │ entire downstream chain runs on a contract missing 20–40% and returns a         │
   * │ review that looks flawless.                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Only blocks when the receipt EXPLICITLY says delivery failed. No receipt
   * ⇒ do NOT block: the file could come from a session old enough to have been
   * swept out of `tasks/`, and blocking something we know nothing about turns
   * a safety gate into a roadblock.
   */
  private interruptedInputs(brief: TaskBrief): string[] {
    const out: string[] = [];
    for (const i of brief.inputs) {
      const parts = norm(i.path).split('/');
      // `artifacts/<plan_id>/<task_id>/…` — shorter than that doesn't point at
      // any task's output (the document cabinet, a root file), skip it.
      if (parts[0] !== 'artifacts' || parts.length < 4) continue;
      const receipt = this.receiptOnDisk(parts[1]!, parts[2]!);
      if (receipt && !delivered(receipt)) out.push(i.path);
    }
    return out;
  }

  /**
   * Any task's receipt, even from a different session. The filename carries
   * both ids, so no index is needed — read it directly, `undefined` if absent.
   *
   * ⚠ `task_id` comes from a path generated by the model ⇒ must go through
   * `safeJoin`, or it's an arbitrary-file-read hole disguised as a receipt
   * filename.
   */
  private receiptOnDisk(planId: string, taskId: string): Receipt | undefined {
    try {
      const dir = this.deps.office.paths.tasks;
      return JSON.parse(
        fs.readFileSync(safeJoin(dir, `${planId}.${taskId}.receipt.json`), 'utf8'),
      ) as Receipt;
    } catch {
      return undefined;
    }
  }

  /** A task that didn't run because its input wasn't usable. 0 turns, $0, and SAYS WHY. */
  private blockedReceipt(
    brief: TaskBrief,
    missing: readonly string[],
    sayLine = phrase('plan.blockedMissingInput'),
    why = phrase('plan.whyNotOnDisk'),
  ): Receipt {
    const blocked: Receipt = {
      status: 'blocked',
      say: sayLine,
      answer: '',
      // Built by code, nobody ran ⇒ no event. → `types.ts §gist`
      gist: '',
      artifacts: [],
      lessons: [],
      blocked_on: `${why}: ${missing.join(', ')}`,
      task_id: brief.task_id,
      role: brief.role,
      usage: ZERO_USAGE,
      wall_ms: 0,
      reasked: false,
      landed: [],
      looped: false,
      reads: [],
    };
    this.deps.emit({
      type: 'task.blocked',
      task_id: brief.task_id,
      role: brief.role,
      say: blocked.say,
      reason: blocked.blocked_on ?? '',
    });
    return blocked;
  }

  gateStats() {
    return this.gate.snapshot();
  }

  /** Number of workers CURRENTLY running — the UI shows "2 workers active". */
  get runningCount(): number {
    return this.live.size;
  }

  /** Interrupt EVERY running worker IMMEDIATELY. Called from `Esc` / `/stop`. */
  async interruptAll(): Promise<void> {
    await Promise.allSettled([...this.live].map((h) => h.interrupt()));
  }

  // ── internal

  private async execute(brief: TaskBrief): Promise<Receipt> {
    const { office, knowledge } = this.deps;
    const role = office.roles.get(brief.role);
    if (!role) throw new RunError(phrase('plan.roleGone', { role: brief.role }), 'other');

    // HOT: sits in the prefix cache, scoped per role, NOT per task.
    const hot = knowledge.hot(role.id, role.hot_knowledge_size, office.company.budgets.hot_knowledge_tokens);
    // COLD: selected by task content, sits after the breakpoint, pays full price.
    const cold = knowledge.cold(
      role.id,
      `${brief.goal} ${brief.constraints.join(' ')}`,
      Math.min(role.budget.knowledge_pack, office.company.budgets.cold_knowledge_tokens),
      hot.ids,
    );

    /**
     * ⚠ INVARIANT: `say` NEVER contains the SPEAKER'S NAME.
     *
     * The event already carries `role`, and every display spot looks up the
     * name from that on its own (`labelFor`, in both the log and the status
     * line). Baking the name in here means a user reads "Writer: Writer:
     * Write 3 paragraphs…" — the name shows up twice, in both places.
     *
     * This rule belongs to the protocol, not aesthetics: a future Telegram
     * bridge is also a display spot, and it needs to decide its own way of
     * attaching a name (bold, an emoji, or none at all). Baking the name
     * into the string strips that choice from every future client.
     */
    this.deps.emit({
      type: 'task.started',
      task_id: brief.task_id,
      role: role.id,
      say: brief.goal,
    });

    let handle: WorkerHandle | undefined;
    let receipt: Receipt;
    try {
      receipt = await runWorker(
        {
          office,
          acquireCacheSlot: (key) => this.gate.acquire(key),
          onProgress: (say) =>
            this.deps.emit({ type: 'task.progress', task_id: brief.task_id, role: role.id, say }),
          /**
           * EVERY MCP call goes to the audit log, with its arguments.
           * → `core/audit.ts`
           *
           * ⚠ `plan_id` is attached HERE, not inside the worker: a worker only
           * holds a `TaskBrief`, and a brief deliberately doesn't carry the
           * plan code. Attaching it where it's known avoids adding a field
           * just to pass a string through.
           */
          onArmCall: (c) =>
            this.deps.audit?.append({ ...c, ...(this.planId ? { plan_id: this.planId } : {}) }),
          /**
           * An oversized result gets spilled HERE — the same directory this
           * task's own files land in. → `core/spill.ts`
           *
           * ⚠ Attached here for the exact same reason as `plan_id` right above:
           * a worker only holds a `TaskBrief`, and a brief deliberately
           * doesn't carry the plan code. Building the path where it's KNOWN
           * avoids adding a field just to pass it through.
           */
          ...(this.planId
            ? { outDir: join(office.paths.artifacts, this.planId, brief.task_id) }
            : {}),
          // Register the handle so `stop()` can reach the CURRENTLY running worker.
          onStart: (h) => {
            handle = h;
            this.live.add(h);
          },
        },
        { brief, role, hotKnowledge: hot.text, coldKnowledge: cold.text },
      );
    } finally {
      if (handle) this.live.delete(handle);
    }

    /**
     * ⚠ ONLY counts COLD hits. Counting HOT too creates a CLOSED LOOP that
     * can't self-correct.
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ The previous version: `recordHits([...hot.ids, ...cold.ids])`.       │
     * │                                                                    │
     * │  · a HOT node got +1 on EVERY task, just for being in HOT             │
     * │  · `hot()` then ranks nodes using that same `hits`                    │
     * │  · `cold()` EXCLUDES HOT nodes from the competition                   │
     * │    (`excludeIds: hot.ids`)                                          │
     * │                                                                    │
     * │ ⇒ getting into HOT once meant staying there FOREVER. A node outside     │
     * │ HOT only got +1 on a keyword match, and could never catch up. Real       │
     * │ user data showed exactly that: three HOT nodes had hits of 6/3/2,        │
     * │ every other node sat at exactly 0.                                    │
     * │                                                                    │
     * │ And it drained `hits` of all meaning: it measured "how long have you    │
     * │ been in HOT", not "are you actually useful".                          │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * Counting only COLD gives `hits` exactly one meaning: **how many times
     * the keyword selector has seen this node match a REAL task.** A
     * self-correcting loop: a COLD node climbs → earns a spot in HOT → the
     * weakest HOT node falls out → it competes in COLD again and climbs back
     * if it's genuinely useful.
     *
     * This is also what makes the aging window in `pruneStale` meaningful.
     *
     * Uses `cold.matched`, not `cold.ids`: `matched` is EVERY node that
     * matched the task, including one already sitting in HOT (excluded from
     * rendering because it's already in the prefix, but it still needs to be
     * credited as useful). → store.ts
     */
    knowledge.recordHits(cold.matched);

    this.deps.emit({
      type: 'task.done',
      task_id: brief.task_id,
      role: role.id,
      say: receipt.say,
      status: receipt.status,
      artifacts: receipt.artifacts,
      usage: receipt.usage,
    });

    return receipt;
  }

  /** Lets the cacheKey be checked before running — used by `agentco status`. */
  cacheKeyFor(roleId: string): string | undefined {
    const role = this.deps.office.roles.get(roleId);
    if (!role) return undefined;
    return buildWorkerPrompt(this.deps.office, role, {
      model: this.deps.office.company.models[role.model_tier],
    }).cacheKey;
  }

  private onRateLimit(): void {
    this.smoothRun = 0;
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
  }

  private onSuccess(): void {
    if (++this.smoothRun >= 10 && this.concurrency < this.maxConcurrency) {
      this.concurrency++;
      this.smoothRun = 0;
    }
  }

  private errorReceipt(brief: TaskBrief, err: unknown, kind: string): Receipt {
    const msg = err instanceof Error ? err.message : String(err);

    /**
     * READ THE DISK BEFORE SAYING "NO RESULT YET". → `RunError.observed`
     *
     * A turn that fails on turn N doesn't erase what turns 1..N-1 already
     * wrote. Case `P-260821-1827-m78h` hit the cost cap NINE SECONDS AFTER
     * finishing a complete, correct results table — the previous version
     * hard-coded `landed: []` here, so the user got invited to run it again
     * (and pay again) for something already sitting on disk.
     */
    const observed = err instanceof RunError ? err.observed : undefined;
    const promised = brief.outputs.map((o) => o.path);
    const written = observed ? filesOnDisk(this.deps.office.dir, promised, observed.landed) : [];
    const strays = observed ? straysOnDisk(observed.landed) : [];

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ FULL DELIVERY ⇒ NOT `failed`. (user settled 08/21)                     │
     * │                                                                      │
     * │ Measured the same day, three turns in a row: `m78h` · `i9h2` · `yap2`     │
     * │ all wrote complete files — `i9h2` got exactly **56/56 groups, not one       │
     * │ number wrong** — then hit the cost cap AFTERWARD and got labeled            │
     * │ "failed".                                                              │
     * │                                                                      │
     * │ A cap stops the call loop; it doesn't undo a file already on disk.          │
     * │ Using the signal *"the allowed money ran out"* as the label for *"did       │
     * │ the task finish"* is measuring one question with the ruler of a               │
     * │ different one.                                                        │
     * │                                                                      │
     * │ The real cost isn't one ugly word. That same day the system cried            │
     * │ WOLF four times and stayed silent exactly when it needed to speak up            │
     * │ (`d6v9` got 45/51 groups wrong, labeled ✅). An alarm that's wrong 80%          │
     * │ of the time gets learned to be ignored — and then the real fire has no          │
     * │ listener. For a non-technical user trusting the system, that's the           │
     * │ product's entire reserve of credibility.                              │
     * │                                                                      │
     * │ ⚠ We're NOT promising the content is correct — still declaring exactly     │
     * │   what `existsSync` knows, the same as on the success path. Not one         │
     * │   more lie added.                                                     │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const deliveredAll = promised.length > 0 && promised.every((p) => written.includes(p));

    // Says WHAT HAPPENED + WHAT TO DO NEXT. A generic "an error occurred" is
    // useless to a non-technical user — they don't know what to fix.
    const cause =
      kind === 'max_turns'
        ? phrase('plan.causeMaxTurns', { role: brief.role })
        : kind === 'budget'
          ? phrase('plan.causeBudget', { role: brief.role })
          : phrase('plan.causeError');

    /**
     * The "what got written" sentence comes BEFORE "why it stopped".
     *
     * A non-technical user reads the first sentence and decides from there.
     * Burying *"but the file's already there"* at the end of a sentence that
     * opens with "blocked" means they'll have already clicked retry before
     * reading that far. The order of these sentences is a product decision,
     * not a formatting choice.
     */
    const say = deliveredAll
      ? // Full delivery: report DONE, and just a GENTLE note about cost. This
        // is a note, not a warning — the task already has a result, the user
        // doesn't need to do anything.
        `${phrase('plan.doneWrote', {
          what: written.length > 1 ? pluralOf('plan.fileCount', written.length) : (written[0] ?? ''),
        })} ` +
        (kind === 'budget'
          ? phrase('plan.asideOverBudget', { role: brief.role })
          : phrase('plan.asideMaxTurns', { role: brief.role }))
      : written.length
        ? `${phrase('plan.partialWrote', {
            n: String(written.length),
            list: written.slice(0, 3).join(', ') + (written.length > 3 ? '…' : ''),
          })} ${cause}`
        : cause;

    return {
      // Full delivery → `done`. Some but not all → `blocked` (unfinished,
      // needs your call). Nothing → `failed`. Three tiers, inferred from disk,
      // never inferred from how the loop died.
      status: deliveredAll ? 'done' : written.length ? 'blocked' : 'failed',
      say,
      answer: '',
      /**
       * ⚠ EMPTY even when `deliveredAll` — and this is the easiest place to
       * get wrong of the four spots that build a receipt in code. Here we
       * know **which files landed**, but not **what's inside them**: the loop
       * died before the worker could write a receipt, so nobody read the
       * content. Inferring a summary sentence from a filename would be making
       * it up. `say` above already says exactly what we know.
       * → `types.ts §gist`
       */
      gist: '',
      // Real files on disk, even though this case closes as `failed`.
      // Declaring it empty would be lying that the disk is clean — exactly
      // the failure class `stoppedReceipt` fixed for the interrupted branch.
      artifacts: written,
      lessons: [],
      /**
       * ⚠ On full delivery `blocked_on` must be EMPTY, not just `status`
       * changed.
       *
       * `worthLearning` reads `!!blocked_on` as its own independent hiccup
       * signal. Changing only `status` and leaving a "hit the cap" message
       * here means the ask-for-a-lesson gate still fires, and we'd spawn
       * exactly the junk nodes that had to be cleaned up. This is the other
       * half of the same patch — fixing one branch means asking *"is there
       * another branch shaped like this one?"*.
       */
      blocked_on: deliveredAll
        ? null
        : strays.length
          ? `${msg.slice(0, 160)} · ${phrase('plan.wroteOutsideOffice', { list: strays.slice(0, 2).join(', ') })}`
          : msg.slice(0, 200),
      task_id: brief.task_id,
      role: brief.role,
      // The failure kind as DATA, so `agentFault()` can decide "whose fault"
      // without matching strings against display text. Full delivery means
      // there's no failure kind at all — the task is done. → `Receipt.failure`
      ...(deliveredAll ? {} : { failure: kind as FailureKind }),
      // Tokens ACTUALLY SPENT before the error hit, not a convenient 0. The
      // previous version hard-coded 0 here, and that's where money vanished
      // from the ledger — `max_turns` runs all the way to its turn cap and
      // then reports $0. → `RunError.usage`
      usage:
        err instanceof RunError && err.usage
          ? err.usage
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
      wall_ms: 0,
      reasked: false,
      // Only empty when the task blew up BEFORE running anything at all
      // (`observed` undefined) — no operation was observed, so it can't be
      // declared as looping either. A task that blew up MID-WAY carries
      // exactly what it managed to do.
      landed: observed?.landed ?? [],
      looped: observed?.looped ?? false,
      reads: observed?.reads ?? [],
    };
  }
}

/**
 * A 1-hour TTL while "in a session": a user thinking for 7 minutes between two
 * messages is normal, and a 5-minute TTL would lose the cache entirely.
 * Writing the cache with a 1h TTL costs ~1.6× more but saves the entire pause.
 */
function ttlMs(setting: 'auto' | '5m' | '1h'): number {
  if (setting === '5m') return 5 * 60_000;
  return 60 * 60_000;
}

/**
 * Normalize a path for COMPARISON — not for opening a file.
 *
 * T-01's `outputs` and T-02's `inputs` are written by the model in two
 * different spots of the same JSON block, so it writing `artifacts/x.md` here
 * and `./artifacts/x.md` there is completely normal. Comparing raw strings
 * would treat those as two different files, and the whole auto-linking
 * mechanism would silently fail to run.
 *
 * ⚠ A TRAILING SLASH IS ANOTHER CASE LIKE THIS, and it actually happened
 * (08/20). A contract case: T-01 declares `outputs: artifacts/T-01/dieu-khoan/`,
 * T-02 declares `inputs:` the exact same string. But `outputScoper` strips the
 * trailing slash (it splits the string and drops the empty segment) while
 * `artifactScoper` doesn't — so the two sides enter `norm` with `…/dieu-khoan`
 * and `…/dieu-khoan/`, don't match, and the user gets *"no task produces it"*
 * for a directory T-01 is literally creating.
 */
function norm(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * Is `dir` the DIRECTORY THAT CONTAINS `file` (both already normalized).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A TASK CAN'T KNOW IN ADVANCE HOW MANY FILES IT WILL PRODUCE — AND THAT'S       │
 * │ A REAL CASE.                                                            │
 * │                                                                          │
 * │ *"Split the contract by clause, one file per clause"*: the file count            │
 * │ equals the clause count, and the clause count is only knowable after            │
 * │ reading it. So the planner writes `outputs: […/dieu-khoan/dieu-01.md]`             │
 * │ and then the next step's `inputs` points at the WHOLE DIRECTORY — that's           │
 * │ the most accurate declaration it has, not a mistake.                         │
 * │                                                                          │
 * │ Comparing with `===` would mean a directory never matches a file,               │
 * │ `validate` blocks the whole plan, and the user has to rephrase a request           │
 * │ that was already clear.                                                  │
 * │                                                                          │
 * │ Compares by prefix + `/`, not a bare `startsWith`: `dieu-khoan` is a             │
 * │ string prefix of `dieu-khoan-cu.md` but is NOT the directory containing it.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function contains(dir: string, file: string): boolean {
  return dir.length > 0 && file.startsWith(`${dir}/`);
}


/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A DEPENDENCY IS ONLY CONSIDERED DONE WHEN IT ACTUALLY DELIVERED.               │
 * │                                                                          │
 * │ The previous version propagated via `failed`, but `Scheduler.run` only          │
 * │ does `failed.add` when `receipt.status === 'failed'`. A task returning           │
 * │ **`blocked`** goes into `receipts` and NOT into `failed` ⇒ it counted as         │
 * │ "the dependency is done".                                               │
 * │                                                                          │
 * │ Measured 08/20, case `P-260820-2219-5ltb`: T-01 returned `blocked` at            │
 * │ 22:20:21 (couldn't read the `.docx`, produced no file) and T-02 launched          │
 * │ at **22:20:21 — the same second**. Then T-03. Both went searching for            │
 * │ files the system already knew for certain didn't exist. T-02 even                │
 * │ correctly self-diagnosed, on the user's dime: *"the entire artifacts             │
 * │ directory is empty"*.                                                    │
 * │                                                                          │
 * │ ⚠ Keeping `blocked` ≠ `failed` separate is CORRECT and must stay — the log        │
 * │ has to distinguish "the system broke" from "waiting on you". The mistake         │
 * │ was using `failed` as the PROPAGATION SIGNAL. The correct, observable            │
 * │ signal: **did it actually deliver.**                                    │
 * │                                                                          │
 * │ And "delivered" is stronger than `status === 'done'`: a task that                │
 * │ declares itself done while `outputs` has nothing landed still leaves the         │
 * │ next step reading nothing. `missingOutputs` catches that case, but it            │
 * │ runs AFTER the whole DAG finishes — too late to stop a child task from            │
 * │ launching.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A PURE function, deliberately: this is the most expensive rule in `run()`,
 * and `run()` calls `runWorker` directly, so no test suite can reach it.
 * → SESSIONS_MEMORY §4
 */
export function delivered(receipt: Receipt | undefined): boolean {
  if (!receipt || receipt.status !== 'done') return false;
  // Promise nothing, owe nothing. A `deliver: reply` task still has to
  // declare `outputs` per the prompt, but this rule must not break if an
  // exception ever shows up.
  if (receipt.artifacts.length === 0 && receipt.landed.length === 0) return true;
  return receipt.landed.length > 0 || receipt.artifacts.length > 0;
}

/** Which of `t`'s `deps` haven't delivered. Empty = safe to launch. */
export function unmetDeps(
  t: TaskBrief,
  receipts: ReadonlyMap<string, Receipt>,
  failed: ReadonlySet<string>,
): string[] {
  return t.deps.filter((d) => failed.has(d) || !delivered(receipts.get(d)));
}

/**
 * The explanation, SPLIT INTO TWO IDEAS. "The prior step failed" and "the
 * prior step produced no file" lead to two completely different fixes —
 * merging them into one sentence forces the user to guess which one applies.
 */
function reasonFor(stale: readonly string[], receipts: ReadonlyMap<string, Receipt>): string {
  const empty = stale.filter((d) => receipts.get(d)?.status === 'done');
  const broke = stale.filter((d) => !empty.includes(d));
  const parts: string[] = [];
  if (broke.length) parts.push(phrase('plan.stalePrevUnfinished', { list: broke.join(', ') }));
  if (empty.length) parts.push(phrase('plan.stalePrevEmpty', { list: empty.join(', ') }));
  return parts.join(' · ');
}

/** Every task that writes a file INSIDE `dir`. Order preserved, no duplicates. */
function producersInto(producer: ReadonlyMap<string, string>, dir: string): string[] {
  const out: string[] = [];
  for (const [path, task] of producer) {
    if (contains(dir, path) && !out.includes(task)) out.push(task);
  }
  return out;
}
