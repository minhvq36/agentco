/**
 * A running OFFICE — the place where everything meets.
 *
 * → docs/SPEC-offices.md
 *
 * An office is fully self-contained: its own Assistant, its own workers, its
 * own knowledge store, its own session. Never talks to another office. That's
 * why zipping up an `offices/<id>/` directory produces a template that runs
 * on another machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { activeOptions, armDirIndex, findArm, folderRoots } from './catalog.js';
import { isCliArm } from './cli-arm.js';
import { loadOffice, type LoadedOffice } from './config.js';
import { energySnapshot, energyVersion, refreshEnergy } from './energy.js';
import {
  companyPaths,
  ensureOfficeDirs,
  folderId,
  isSafeId,
  normalizeName,
  resolveInput,
  safeJoin,
  slugId,
} from './paths.js';
import { readOAuth } from './secrets.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { LibraryStore, type DocRecord } from '../library/store.js';
import { docPaths } from '../library/names.js';
import { ArtifactStore, isStale, MAX_PANEL_FILES } from './artifacts.js';
import { AuditLog } from './audit.js';
import { loginOpen } from './browser-login.js';
import { LayoutStore, ASSISTANT_NODE, agentNodeId, mcpNodeId, type LayoutNode } from './layout.js';
import { Assistant, learnable, newPlanId, requestOf, type PlanDraft } from './assistant.js';
import {
  helpText,
  parseInput,
  pickReadable,
  type ReadableRef,
  readingNote,
  resolveFileRefs,
  type ParsedInput,
} from './commands.js';
import { Mailbox, mergeUserText } from './mailbox.js';
import { PlanStore, agentHue } from './plans.js';
import { Scheduler, delivered } from './scheduler.js';
import { buildWorkerPrompt, describePrompt, type PromptLayer } from './prompt.js';
import { filesOnDisk, straysOnDisk } from './worker.js';
import { estimateTokens, truncateToTokens } from './tokens.js';
import { plural, t } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';
import {
  RunError,
  TIERS,
  type AgentEvent,
  type AgentEventBody,
  type CompanyConfig,
  EXTERNAL_TOOLS,
  SHELL_TOOL,
  hasShell,
  type Plan,
  type PlanRecord,
  type PlanStatus,
  type Receipt,
  type TaskBrief,
  type Usage,
} from './types.js';

export type OfficeState = 'idle' | 'working' | 'paused' | 'stopped';

/**
 * Cap on how many files get listed in a report sentence. A run that touches
 * 20 resumes (test 8 in TEST-WALKTHROUGH) generates dozens of files —
 * dumping all of them into chat turns the report into a wall nobody reads.
 * The overflow gets stated as a single count line.
 */
const MAX_LISTED_FILES = 8;

/**
 * Token ceiling for the work listing handed to a memory-compaction turn.
 *
 * ⚠ Belongs to `factSkeleton` / `compactMemory` ONLY — the ASSISTANT's memory.
 * It has nothing to do with a worker's HOT/COLD knowledge selection, which is
 * a different store, a different budget (`knowledge_pack`) and a different
 * question. One constant serving two purposes is how a number ends up wrong
 * for both. → [[agentco-cut-after-sort]]
 */
const SKELETON_TOKENS = 1_200;

/** How many messages get replayed when an office is opened. Enough to remember the thread, not a whole lifetime. */
const CHAT_REPLAY = 200;

/**
 * How many recent JOBS get named in the output manifest sent to the
 * Assistant.
 *
 * 5, not 1: the job a user wants to refer back to isn't always the one that
 * just finished. A real case on 08/20 needed a result from **25 minutes and
 * two jobs earlier**. Also not "all of them": the token cap is the final
 * backstop, and this is the cheap gate that runs before it. → `artifactManifest`
 */
const MANIFEST_PLANS = 5;

/** Grouping key for old files sitting directly under `artifacts/<task_id>/` (before 08/19). */
/**
 * Bucket key for artifacts written before plans carried an id.
 *
 * ⚠ NOT a catalogue key, and not a displayed string either. It exists only as a
 * `Map` key inside `manifestArtifacts`, rebuilt from `a.plan_id || LEGACY_PLAN`
 * on every call — nothing on disk holds it, and nothing compares against a
 * stored copy. Running it through `t()` would make the grouping depend on the
 * interface switch, which is how two locales end up with two different buckets
 * for the same files.
 */
const LEGACY_PLAN = '(legacy)';

/** A node with metadata attached for drawing. Nothing in here gets written to layout.json. */
export interface CanvasNode extends LayoutNode {
  label: string;
  avatar?: string;
  /** Model tier: `eco` | `standard` | `deep`. For the Assistant, this may be an inherited tier. */
  tier?: string;
  /** The actual model that will run at that tier. Stated outright so the user doesn't have to guess. */
  model?: string;
  /** Assistant: true when the tier follows the company's `models.master`, not a value set on its own. */
  tierInherited?: boolean;
  pitch?: string;
  /** Cost cap for one task. **`0` = no limit.** → `RoleBudget.max_usd` */
  maxUsd?: number;
  maxTurns?: number;
  /**
   * agent: does this role have `Bash`. → docs/SPEC-tools-approval.md §5
   *
   * The ONLY tool worth surfacing on the node, because it's the only one that
   * can be toggled on/off — and it's the boundary between "can only touch the
   * office" and "can touch the whole machine".
   */
  bash?: boolean;
  /** agent: count of its own private notebook entries · knowledge: total node count */
  count?: number;
  /**
   * mcp: PERMISSION TIER, and the detail panel draws its badge from this —
   * **not** from `label`. The label belongs to the user and can be renamed
   * freely; stuffing the permission level into the name string means a
   * rename can produce a label that lies about privilege. → §6j
   */
  level?: 'read' | 'add' | 'full';
  /** mcp: number of jobs granted — so "read-only" can be checked by eye, not taken on faith from the label. */
  toolCount?: number;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE ARM NODE'S ICON — sent from the SERVER, not looked up in the UI.     │
   * │ (user settled 08/28: *"change the plug icon to … match each MCP           │
   * │ kind"*)                                                                  │
   * │                                                                          │
   * │ `mark` = the vendor's monochrome SVG path, taken straight from            │
   * │ `brand.mark` in the catalog. `armKind` = the kind, to fall back to a      │
   * │ generic icon when a vendor has no logo.                                  │
   * │                                                                          │
   * │ ⚠ Why the canvas doesn't just look up the catalog itself: the diagram     │
   * │ draws **before** anyone opens the Connection dialog, and the catalog      │
   * │ only loads inside that dialog. Making the canvas fetch an extra round     │
   * │ trip buys a moment where the node has **no icon** every time the app      │
   * │ opens. The server already holds both facts — sending them along is free. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  mark?: string;
  /**
   * mcp: `files` · `service` · `custom` · `browser` · `cli` — **the same axis
   * the dialog classifies by** (`ArmDialog §kindOf`).
   *
   * ⚠ Adding a value here means adding it in **all three places**: this
   * union, `web/src/lib/types.ts §CanvasNode.armKind`, and `ArmIcon §ArmKind`.
   * Missing one leaves a node showing the wrong icon **with nothing turning
   * red** — exactly the `cli` case on 09/01.
   */
  armKind?: 'files' | 'service' | 'custom' | 'browser' | 'cli';
  /**
   * A credential this arm runs on was **REFUSED by the service** — carries the
   * account's label so the diagram can name it. The one condition that turns a
   * node red. → `canvas() §keyDeadOf` for what it deliberately does NOT cover
   */
  keyDead?: string;
  /** Labels of the currently-enabled checkboxes — the panel draws chips from this. */
  optionLabels?: string[];
  /** Has a persisted profile ⇒ the panel shows a button to open the sign-in window. → `browser-login.ts` */
  canLogin?: boolean;
  /**
   * mcp: the ACCOUNT NAME it's connected to, looked up from the OAuth store,
   * not read off `label`.
   *
   * The node draws it on a secondary line — this is the ONLY thing on the
   * diagram that distinguishes two arms of the same vendor on different
   * accounts, ever since the label stopped folding the account name in
   * (08/27). Absent ⇒ doesn't use OAuth, or the workspace has been
   * disconnected ⇒ nothing drawn.
   */
  via?: string;
  mcp?: string[];
  /**
   * mcp: the directory this arm reaches, verbatim as written in
   * `company.yaml`. READ-ONLY on the UI — changing the directory changes
   * `armHash`, i.e. it becomes a different arm. Empty = not a file arm
   * (Notion, GitHub…).
   */
  folders?: string[];
  /** representative color, shared with the log */
  hue?: number;
  /** roles/<id>.yaml wasn't found, or the mcp server has vanished from company.yaml */
  missing: boolean;
  /** has a wire from the Assistant → gets assigned work. No wire = "idle". */
  connected: boolean;
  /** The Assistant and the knowledge store can't be deleted. */
  removable: boolean;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: Array<{ from: string; to: string }>;
  knowledge: { shared: number; total: number };
}

export interface SayOutcome {
  intent: 'chat' | 'ask' | 'task';
  reply: string;
  plan_id?: string;
}

/**
 * The "planning broke" message sent straight to the user's face.
 *
 * `repeats` = how many times the EXACT SAME error list has now repeated (0 = first time).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FROM THE THIRD TIME ON, THE DEFAULT ADVICE BECOMES A LIE.                │
 * │                                                                          │
 * │ *"Try rephrasing your request a bit more clearly"* is good advice the     │
 * │ first time. By the third time with the same error list, we have PROOF     │
 * │ that rephrasing doesn't change the outcome — case 08/22: the user typed    │
 * │ it again twice, each time clearer, and got back the exact same string,    │
 * │ byte for byte, because the cause was two prompt rules fighting each        │
 * │ other, not their wording.                                                │
 * │                                                                          │
 * │ Repeating that advice just burns the user's own time hunting for a         │
 * │ phrasing that DOESN'T EXIST. We haven't fixed the root cause, but we do    │
 * │ know this for certain and have to say so — then redirect to something      │
 * │ they can actually do.                                                    │
 * │                                                                          │
 * │ ⚠ Do NOT hide the error list on the third time. It's still the only thing  │
 * │ that says what's actually happening, and the user can copy it elsewhere    │
 * │ to ask for help.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function planProblemsMessage(problems: readonly string[], repeats: number): string {
  const head =
    t('off.planFailedHead') + '\n' +
    problems.map((p) => `  · ${p}`).join('\n');

  if (repeats < 2) return `${head}\n${t('off.planFailedRetry')}`;
  return `${head}\n${t('off.planFailedStuck', { n: String(repeats + 1) })}`;
}

export class Office {
  loaded: LoadedOffice;
  readonly knowledge: KnowledgeStore;
  /** The library — files the user has brought in. → docs/SPEC-library.md */
  readonly library: LibraryStore;
  /** Outputs — files a worker produced. → docs/SPEC-artifacts.md */
  readonly artifacts: ArtifactStore;
  /**
   * Arm audit log — EVERY MCP call, with its arguments.
   * → `core/audit.ts` · docs/SPEC-arms.md §6k
   *
   * This is what **replaces** per-call approval (user settled 08/25), so
   * it's not a nicety: drop the gate while the log stays incomplete and
   * we've just dropped both.
   */
  readonly audit: AuditLog;
  readonly assistant: Assistant;
  readonly layout: LayoutStore;
  readonly plans: PlanStore;

  private state: OfficeState = 'idle';
  private stopRequested = false;
  private currentPlan: Plan | undefined;
  private currentRecord: PlanRecord | undefined;
  /** The scheduler for the currently running job — kept so it can be interrupted mid-run. */
  private activeScheduler: Scheduler | undefined;
  /** The Assistant's mailbox — it's ONE person, doing one thing at a time. */
  private readonly mailbox = new Mailbox();
  /** Work the user handed over while busy, finished once this job is done. */
  private deferred: Array<{ request: string; at: number }> = [];
  /** Artifacts from the job that just finished — handed off to the next queued job. */
  private lastArtifacts: string[] = [];
  /**
   * FRICTION: how many planning attempts have FAILED to produce a plan since
   * the most recent job that actually ran. Increments when the planner asks
   * a follow-up or fails to return JSON; resets to 0 when a job genuinely
   * starts. This is the only thing in the system that measures **how much a
   * human had to struggle**, not the machine. → `assistant.ts → worthLearning`
   *
   * Kept in RAM rather than on disk, deliberately: it only means anything
   * within one continuous conversation thread. Stopping and restarting the
   * daemon means the user has left and come back — the previous session's
   * friction has nothing left to teach about this one.
   */
  private planFriction = 0;

  /**
   * The fingerprint of the most recent failed `validate`, and how many times
   * it has repeated identically.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SAME REJECTION THREE TIMES IN A ROW MEANS THE SYSTEM IS LEARNING      │
   * │ NOTHING FROM ITS OWN REJECTION. (real case 08/22, user ran test 9b)      │
   * │                                                                          │
   * │ The user retyped the request twice, each time clearer — *"that file       │
   * │ doesn't exist yet, create it"*, then *"I mean read the path, THEN write    │
   * │ into that file"* — and got back **the exact same string, byte for         │
   * │ byte**. Because the cause was two prompt rules fighting each other        │
   * │ (→ TEST-WALKTHROUGH §Test 9b), NO rephrasing could escape it. An           │
   * │ infinite loop by construction.                                          │
   * │                                                                          │
   * │ We haven't fixed the root cause here, but we do know one thing for        │
   * │ certain and have to say it: **typing it again won't help.** Silently      │
   * │ repeating the same message just burns the user's time hunting for a       │
   * │ phrasing that doesn't exist.                                            │
   * │                                                                          │
   * │ In RAM, for the same reason as `planFriction`: it only means anything      │
   * │ within one continuous conversation thread.                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private lastPlanProblems = '';
  private samePlanProblemsCount = 0;

  private emitFn: (e: AgentEvent) => void = () => {};

  constructor(loaded: LoadedOffice) {
    this.loaded = loaded;
    ensureOfficeDirs(loaded.paths);
    this.knowledge = new KnowledgeStore(loaded.dir, loaded.paths);
    this.knowledge.scan();
    // Text extraction runs IN THE BACKGROUND (§10), so it needs a way to notify
    // the UI — otherwise the "reading…" line stays frozen until the user
    // happens to open the library.
    this.library = new LibraryStore(loaded.paths, () => this.emitLibrary());
    /**
     * A document stuck for LACK OF A TOOL gets retried once when the office is built.
     *
     * Restarting the daemon is the exact moment the cause just disappeared:
     * someone ran `npm install`, upgraded a version, then `stop`+`start`.
     * Making them remember to delete and re-drop each file themselves would
     * be asking them to clean up after us. → `retryUnindexed`
     */
    this.library.retryUnindexed();
    this.artifacts = new ArtifactStore(loaded.paths);
    this.audit = new AuditLog(loaded.paths.state);
    this.assistant = new Assistant(loaded);
    const saved = this.readSession();
    this.assistant.resumeFrom(saved.id, saved.reach);
    this.compactedThrough = saved.compactedThrough;
    this.layout = new LayoutStore(loaded);
    this.plans = new PlanStore(loaded.paths);
    /**
     * HEAL ZOMBIE JOBS right at construction — technical debt #2, partially paid off.
     *
     * A process that just started can have NO job actually running: any
     * record still carrying `planning`/`running` is a leftover from a
     * previous daemon dying mid-run. Left alone, the log lies forever — it
     * claims "running" for work nobody is doing, and the user sits waiting on
     * something that died a long time ago.
     *
     * This sentence goes into `report`, i.e. straight to the user's face, so
     * it has to say *what happened* + *what to do next* — the "handles errors
     * well" criterion. And it does NOT blame the system or the user: stopping
     * the daemon is normal infrastructure work (an update, a reboot), not an
     * incident.
     */
    this.plans.healStale(
      t('off.cutByShutdown'),
    );
    this.refreshAssistantContext();
  }

  get id(): string {
    return this.loaded.id;
  }

  get name(): string {
    return this.loaded.config.name;
  }

  /** The real directory on disk. So the UI can open it — see `openFolder`. */
  get dir(): string {
    return this.loaded.dir;
  }

  get currentState(): OfficeState {
    return this.state;
  }

  /** Put into archive — frozen, read-only. → docs/SPEC-offices.md §3.1 */
  get archived(): boolean {
    return this.loaded.config.archived;
  }

  /**
   * The ONE gate for "an archived office is read-only".
   *
   * Called at the top of EVERY function that changes something. One gate, one
   * sentence, instead of scattering the condition everywhere and missing a
   * spot — and the most dangerous spot to miss is one that spends money,
   * because money is the one thing a user can't get back.
   */
  private assertLive(): void {
    if (!this.archived) return;
    throw new RunError(
      t('off.officeArchivedReadOnly', { name: this.name }),
      'other',
    );
  }

  get plan(): Plan | undefined {
    return this.currentPlan;
  }

  /**
   * The company wires the bus in here. Every event automatically carries
   * `office` and `plan_id`.
   *
   * ⚠ The resume invitation fires HERE, not in the constructor — already hit
   * this on 08/20. The constructor runs before `PlanStore` is built
   * (`resumable()` blows up) AND before there's a bus, so the invitation
   * fired into the void. One wrong spot produced two symptoms, and the
   * second one was silent — the kind that only surfaces under a real run.
   */
  bindBus(fn: (e: AgentEvent) => void): void {
    this.emitFn = fn;
    this.offerResume();
    /**
     * Check the usage limit IMMEDIATELY once there's a bus. The user opens
     * the app and sees the number, instead of waiting for the first run —
     * and "can I still run anything" is usually the exact question they ask
     * BEFORE handing over work.
     *
     * `force` skips the throttle: this is the first time, and it only
     * happens once per open. No `await`: it costs ~5 seconds and nobody is
     * standing around waiting on it. → `core/energy.ts`
     */
    void refreshEnergy(true).then(() => this.emitEnergy());
  }

  emit(e: AgentEventBody & { plan_id?: string | null }): void {
    const planId = e.plan_id !== undefined ? e.plan_id : (this.currentRecord?.plan_id ?? null);
    const full = { ...e, office: this.id, plan_id: planId } as AgentEvent;
    if (planId) this.plans.append(planId, full);
    // Last-resort safety net for an EMPTY message. The real gate sits at the
    // point of emission (`reply`), but `emit` is the ONE choke point every
    // event passes through — an empty message reaching here is about to sit
    // in `chat.jsonl` forever. → bug 08/21
    if (full.type === 'master.message' && !String(full.say ?? '').trim()) return;
    if (full.type === 'master.message') this.appendChat(full);
    this.emitEnergy();
    this.emitFn(full);
  }

  /** Compares `energyVersion()` against the last time it fired. Only fires on a change. */
  private energySeen = 0;

  /**
   * The account usage limit RIDES ALONG the existing event stream — it has no
   * bus of its own. → `core/energy.ts`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY NOT PUB/SUB — even though that's the first reflex.                  │
   * │                                                                          │
   * │ `energy.ts` is MODULE-level state (the usage limit belongs to the        │
   * │ account, not to any office), while `Office` is created and destroyed     │
   * │ following the user's own actions. Having `Office` register a listener    │
   * │ takes on a lifecycle problem of its own — where it gets unregistered,     │
   * │ who unregisters it, and a leftover listener firing into an already-       │
   * │ closed SSE stream.                                                      │
   * │                                                                          │
   * │ `emit()` is already the ONE choke point every event passes through, and  │
   * │ during a run it's dense (`plan.step`, `agent.progress`, `cost.tick`).     │
   * │ And `rate_limit_event` arrives right at the START of a query — i.e.       │
   * │ right before a whole burst of events. Riding along here costs             │
   * │ millisecond-scale latency, and the number of listeners to manage is 0.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Fires straight through `emitFn`, NOT through `emit()`: recursion aside,
   * this isn't the business of any one plan, so it must not land inside
   * `plans.append`.
   */
  private emitEnergy(): void {
    if (energyVersion() === this.energySeen) return;
    this.energySeen = energyVersion();
    const energy = energySnapshot();
    if (energy) this.emitFn({ type: 'energy.tick', energy, office: this.id, plan_id: null });
  }

  /**
   * The chat stream, WRITTEN TO DISK. → docs/SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SCREEN MUST NOT LIE ABOUT WHAT THE SYSTEM STILL REMEMBERS.           │
   * │                                                                          │
   * │ The Assistant's memory lives on disk in TWO places and survives every     │
   * │ daemon restart: the pointer at `.state/assistant-session.json`, and the   │
   * │ conversation record the Claude Code CLI itself keeps under                │
   * │ `~/.claude/projects/`. But the chat pane on the UI reads from a 300-      │
   * │ event ring buffer IN MEMORY.                                             │
   * │                                                                          │
   * │ The real consequence a user hits: restart the daemon, reopen, the chat    │
   * │ pane is COMPLETELY BLANK — then type "200 words, funny" and the           │
   * │ Assistant answers exactly as if nothing had been lost. The model            │
   * │ remembers, the screen forgets. The user can no longer trust either one.    │
   * │                                                                          │
   * │ Events tied to a job were already recorded in `<plan_id>.log.jsonl`;      │
   * │ the actual gap was chat (`plan_id: null`) — something that belongs to     │
   * │ no job, so no file was catching it.                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private appendChat(e: AgentEvent): void {
    try {
      fs.mkdirSync(this.loaded.paths.state, { recursive: true });
      fs.appendFileSync(this.chatFile(), `${JSON.stringify({ ...e, ts: new Date().toISOString() })}\n`, 'utf8');
    } catch {
      /* Failing to write the chat log must NEVER break the actual reply. */
    }
  }

  /**
   * Saved chat, most recent last. Read when an office is opened.
   *
   * Trimmed to the last `CHAT_REPLAY` lines rather than reading the whole
   * file: it only exists so the user can see the thread again, not to serve
   * as the model's memory — the model's memory lives in the SDK's session and
   * never passes through here.
   */
  readChat(limit = CHAT_REPLAY): AgentEvent[] {
    try {
      const lines = fs.readFileSync(this.chatFile(), 'utf8').split('\n').filter((l) => l.trim());
      return lines.slice(-limit).flatMap((l) => {
        try {
          return [JSON.parse(l) as AgentEvent];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private chatFile(): string {
    return path.join(this.loaded.paths.state, 'chat.jsonl');
  }

  /**
   * Stops the job — the daemon stays alive. This is what a user wants 95% of
   * the time.
   *
   * Interrupts the running worker IMMEDIATELY, not just a flag set. Before,
   * the flag was only checked BETWEEN tasks, so hitting Stop still meant
   * sitting through the current task running to completion — sometimes a
   * full minute and thousands of tokens spent.
   */
  stop(): { dropped: number; cutAssistant: boolean } {
    this.stopRequested = true;
    void this.activeScheduler?.interruptAll();
    /**
     * ALSO INTERRUPT THE ASSISTANT'S OWN TURN — the fourth thing, and it got
     * forgotten until 08/20.
     *
     * §11e lists three things (worker · mailbox · deferred work) and all
     * three already ran. But `route()`/`plan()`/`report()` weren't among
     * those three, so typing `/stop` while the Assistant is mid-thought lets
     * it finish thinking and reply after the screen has already said
     * "stopping". The exact same failure class §11e itself exists to
     * block: hit Stop and the system keeps going on its own.
     */
    const cutAssistant = this.assistant.abort();
    // Stopping means stopping the WHOLE SYSTEM: interrupt the running worker,
    // drop anything still in the mailbox, drop deferred work. Keeping any of
    // it means the user hits Stop and still sees the system keep working —
    // exactly what they just said not to do.
    const dropped = this.mailbox.clear() + this.deferred.length;
    this.deferred = [];
    if (this.state === 'working') this.setState('paused', t('off.stopping'));
    this.emitActivity();
    return { dropped, cutAssistant };
  }

  // ── the single entry point

  /**
   * The ONE entry point for everything the user types. Both the UI and the
   * chat bridge use this exact function.
   *
   * Before, the UI always called `run()` directly, so typing "Hi" would kick
   * off a whole DAG and then fail — an error the user hit on their very
   * first action.
   */
  async say(message: string): Promise<SayOutcome> {
    this.assertLive();
    this.emit({ type: 'master.message', say: message, role: 'user', plan_id: null });

    /**
     * `@path` — RESOLVED BY CODE, BEFORE IT REACHES THE MODEL. →
     * docs/SPEC-library.md §8c
     *
     * Runs here, right after the user's message is recorded in the stream
     * and BEFORE any other branch: the user has to see exactly what they
     * typed in the chat pane, while the model receives an already-verified
     * version.
     */
    const refs = this.resolveRefs(message);
    if (refs.problem) {
      // Answer with CODE. A path that doesn't exist is a FACT — we're already
      // holding both stores in hand; asking the model would be paying money
      // to get back a guess.
      this.emit({ type: 'master.message', say: refs.problem, role: 'assistant', plan_id: null });
      this.emitActivity();
      return { intent: 'chat', reply: refs.problem };
    }
    message = refs.text;

    // A slash command gets caught BEFORE it reaches the model. Two reasons,
    // both mandatory: throwing "/stop" at the model is paying money for a
    // slower stop; and a string starting with "/" could be interpreted by
    // the Claude Code CLI itself as ITS OWN command. →
    // docs/SPEC-tools-approval.md §8e
    const parsed = parseInput(message);
    if (parsed.kind !== 'text') {
      const outcome = this.runCommand(parsed);
      // MANDATORY: the UI turns on the "reading your request…" line the
      // moment Send is hit, and only turns it off on receiving
      // `office.activity`. A slash command answers instantly via code, so it
      // does NOT pass through the mailbox — without this line, the three
      // dots would spin forever after every `/help`, and the user would have
      // to reload the page to clear it.
      this.emitActivity();
      return outcome;
    }

    // Placed into the mailbox instead of called directly. The Assistant is
    // ONE PERSON: two overlapping calls on the same session mean one turn
    // gets erased entirely from the conversation memory. →
    // docs/SPEC-tools-approval.md §11
    if (!this.mailbox.push({ kind: 'user', text: parsed.text, at: Date.now() })) {
      const say = t('off.mailboxFlooded', { n: String(this.mailbox.size) });
      this.emit({ type: 'master.message', say, role: 'assistant', plan_id: null });
      return { intent: 'chat', reply: say };
    }

    this.emitActivity();
    void this.pump();
    return { intent: 'chat', reply: '' };
  }

  /**
   * Resolves an `@path` the user pasted into the chat pane. →
   * docs/SPEC-library.md §8c
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY NOT RELY ON THE SDK UNDERSTANDING `@` — AND WHY WE DON'T WANT IT TO.  │
   * │                                                                          │
   * │ The Claude Code CLI has an `@file` syntax when typed by hand. Whether it  │
   * │ actually runs inside the SDK is **not measured by anyone** — `FINDINGS-  │
   * │ sdk` has no line about it, and this project already has a costly           │
   * │ precedent for building on top of an unmeasured SDK behavior (`canUseTool` │
   * │ never firing, §4.7).                                                    │
   * │                                                                          │
   * │ 🔥 But the stronger reason is: **if the SDK DID understand it, that would  │
   * │ be BAD.** Expanding `@` means stuffing a file's CONTENT into the call —   │
   * │ and the Assistant runs on a persisted session, so anything it reads sits  │
   * │ in the context of EVERY turn afterward: *read once, pay forever*. The     │
   * │ entire architecture is built on the rule "the Assistant doesn't read       │
   * │ files, only a worker does".                                              │
   * │                                                                          │
   * │ So `@` gets FULLY STRIPPED here. The model never sees that character, and │
   * │ we don't depend on any SDK behavior — measured or not.                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ The regex runs on text the USER TYPED, not text the model generated —
   * the opposite of the rule against sniffing paths out of `say`
   * (SPEC-artifacts §2.5). There the risk is the model making something up;
   * here the user is responsible for what they type, and every reference
   * still has to be CROSS-CHECKED against the real store before it's
   * accepted.
   *
   * Three shapes are accepted, and the third is why this function has to
   * exist at all:
   *
   *   @artifacts/P-…/T-01/vi/doc-2.md   a full path  → cross-check, then use
   *   @library/files/doc-1.md            a full path  → cross-check, then use
   *   @doc-1.md                          a bare name  → look up, and BLOCK on a collision
   *
   * Bare names colliding is a real case: the library has `doc-1.md` and the
   * Output pane also has `doc-1.md`. Guessing which one silently does the
   * user's job wrong — so ask back instead, by code, 0 tokens.
   */
  private resolveRefs(text: string): { text: string; problem?: string } {
    // The decision logic itself is pure and lives in `commands.ts` so the test suite can reach it.
    return resolveFileRefs(text, this.readablePaths());
  }

  /**
   * Every path a user (or the Assistant) is allowed to point to — READ FROM
   * DISK at the moment of the call, never cached.
   *
   * One single source of truth for both doors: an `@path` the user typed, and
   * the `paths` of a `lookup` turn. Two separate lists for the same question
   * would drift apart on the exact day someone adds a third store.
   */
  private readablePaths(): ReadableRef[] {
    /**
     * ⚠ EVERY DOCUMENT CARRIES TWO STRINGS, AND BOTH ARE REQUIRED. → `ReadableRef`
     *
     * `ref` = what shows in the UI and what the Copy button puts into the
     * chat pane (`library/files/hd1.docx`). `open` = the path a worker can
     * actually open (`library/text/hd1.docx.txt`). Drop `ref` and the Copy
     * button breaks immediately; drop `open` and we're back to the exact
     * 08/20 failure.
     *
     * A document that isn't usable yet (`docPaths` returns no `open`) is
     * NOT present here — `@`-ing it must get "not found", not a dead path
     * forwarded on to a worker.
     */
    const docs: ReadableRef[] = [];
    for (const d of this.library.list()) {
      const { open, original } = docPaths(d.name, d.ext, d.state);
      if (!open) continue;
      docs.push({ ref: `library/files/${d.name}`, open });
      // PDF: the original is a legitimate path in its own right, listed separately.
      if (original && original !== open) docs.push({ ref: original, open: original });
    }
    // `filePaths()`, not `list()`: only the path STRING is needed here, and
    // this function runs on every message the user types. `list()` calls
    // `stat` on every file to get `bytes`/`mtime` that we'd throw away
    // immediately — ~0.1 ms per file, see `artifacts.ts §walk`.
    return [...docs, ...this.artifacts.filePaths().items.map((p) => ({ ref: p, open: p }))];
  }

  /**
   * The mailbox pump loop. Runs one batch at a time, never two batches at once.
   *
   * The Assistant being busy does NOT mean the office is busy: workers keep
   * running in parallel underneath. The two states are independent, and
   * `emitActivity()` reports both.
   */
  private async pump(): Promise<void> {
    if (this.mailbox.isBusy) return;

    const batch = this.mailbox.take();
    if (!batch) {
      this.emitActivity();
      return;
    }

    try {
      await this.mailbox.lock(async () => {
        this.emitActivity();
        await this.handleUserBatch(mergeUserText(batch));
      });
    } catch (err) {
      // If the user hit Stop, `/stop` has ALREADY replied. Emitting another
      // line here would be two messages about the same thing — and the
      // second one would look like an error, when what just happened is
      // exactly what they asked for. → types.ts `stopped`
      if (!(err instanceof RunError && err.kind === 'stopped')) {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: err instanceof Error ? err.message : t('off.messageFailed'),
          plan_id: null,
        });
      }
    }

    this.emitActivity();
    // Keep reading if there's more mail. Recurses via a microtask, so it doesn't deepen the call stack.
    if (this.mailbox.size > 0) void this.pump();
  }

  private async handleUserBatch(text: string): Promise<void> {
    const routed = await this.assistant.route(text, this.state === 'working');
    // `route` runs on EVERY user message. The old version threw
    // `routed.usage` straight away, so the entire cost of chatting was
    // invisible to `agentco cost` — and that's exactly the part a model
    // switch would make more expensive. What isn't measured can't be
    // weighed against the price of switching models. →
    // SPEC-token-economy.md §5
    this.logAssistantUsage('route', routed.usage);
    this.saveSessionId();

    /**
     * `lookup` — a HIDDEN WORKER reads documents and answers directly. → `RouteSchema`
     *
     * NO planning, NO `Plan` created, NO touching `state`: this isn't a job,
     * it's a question whose answer sits in a file. Generating a `PlanRecord`
     * for it would fill the work log with lines that aren't work — same
     * reason `intent: 'chat'` produces no `Plan`.
     *
     * Runs INSIDE the mailbox lock (`pump` is holding it): the Assistant is
     * ONE person, and this is its turn. That's what lets `/stop` interrupt
     * it — `Assistant.run` sets `inflight` for every turn, including this one.
     */
    if (routed.value.intent === 'lookup') {
      /**
       * EMPTY `paths` = a general lookup question, no document read (08/24).
       *
       * Has to branch HERE, not by loosening `pickReadable`: that function
       * answers the question *"do the paths the model just named actually
       * exist"*, and with an empty list the correct answer is "there's
       * nothing to check" — not "no file was found". Merging the two
       * produces the error message *"I couldn't find … in the library"* for
       * a question about the weather.
       */
      const asked = routed.value.paths;
      // A path generated by the MODEL ⇒ has to be cross-checked against disk
      // before anyone reads anything. → commands.ts `pickReadable`
      const { ok, missing } = asked.length
        ? pickReadable(asked, this.readablePaths())
        : { ok: [] as string[], missing: [] as string[] };
      if (asked.length > 0 && ok.length === 0) {
        // Answer with CODE. We're already holding both stores in hand; asking
        // the model "does this file exist" is paying money to get back a guess.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say:
            t('off.refsMissing', { list: missing.map((m) => `"${m}"`).join(', ') }),
          plan_id: null,
        });
        return;
      }

      // The "Reading doc-2.md…" line — 0 tokens, and the other half of the
      // hidden worker's own honesty. `finally` so it doesn't get stuck on
      // screen if the read turn throws or gets cut by `/stop`. → `reading`
      this.reading = readingNote(ok);
      this.emitActivity();
      let found: { value: string; usage: Usage };
      try {
        found = await this.assistant.lookup(ok, routed.value.question);
      } finally {
        this.reading = null;
      }
      // A separate line item in the cost ledger: `lookup` has a completely
      // different cost shape from `route` (a tiny prefix, but reads a file so
      // output runs longer). Merged into one line item, no single line item
      // would show it ballooning. → `logAssistantUsage`
      this.logAssistantUsage('lookup', found.usage);
      this.emit({
        type: 'master.message',
        role: 'assistant',
        say:
          found.value ||
          (asked.length
            ? t('off.lookupNoAnswerFiles')
            : t('off.lookupNoAnswerWeb')),
        plan_id: null,
      });
      // ⚠ If part of what the Assistant proposed doesn't actually exist, SAY
      // SO, don't stay quiet. The answer above is based on fewer documents
      // than it thinks, and the user is the only one who can tell whether the
      // missing file would have changed the answer.
      if (missing.length > 0) {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: t('off.lookupPartial', {
            list: missing.map((m) => `"${m}"`).join(', '),
            n: String(ok.length),
          }),
          plan_id: null,
        });
      }
      return;
    }

    /**
     * ESCAPE HATCH: the Assistant returns an entire PLAN instead of a decision.
     *
     * → `Assistant.decideRoute`
     *
     * We're already holding a valid, ALREADY-PAID-FOR plan. Running it skips
     * a whole `plan()` turn — cheaper than the usual case, not more
     * expensive.
     *
     * ⚠ Does NOT downgrade to `intent: 'task'` with the exact text the user
     * just typed, even though that sounds much simpler: `plan()` runs as a
     * ONE-SHOT query, with **no conversation memory**. A message like "any,
     * random is fine" standing alone gives the planner nothing to split work
     * from — we'd pay for an extra turn just to get back a broken run. The
     * exact case measured on 08/20.
     */
    if (routed.value.intent === 'plan') {
      const draft = routed.value.draft;
      if (this.state === 'working') {
        // The draft does NOT go into the queue alongside the request text: by
        // the time it runs, the roster of available workers and the input
        // files may have changed, and an already-framed plan doesn't get
        // re-checked. Keep the more durable part — the description of the
        // work — and plan fresh when it actually runs.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: t('off.busyWillFollow'),
        });
        this.deferred.push({ request: requestOf(draft), at: Date.now() });
        return;
      }
      void this.run(requestOf(draft), draft).catch(() => {
        /* run() has already emitted the error to the UI */
      });
      return;
    }

    if (routed.value.intent === 'task') {
      // scope "refine" attaches to the running job; "new" spawns an independent Plan.
      // When unsure, the Assistant is told to pick "new" — two separate jobs
      // only cost one extra planning round, while a wrong attachment breaks
      // both.
      if (this.state === 'working') {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say:
            routed.value.scope === 'refine'
              ? t('off.addendumNoted')
              : t('off.busyWillFollow'),
        });
        this.deferred.push({ request: routed.value.request, at: Date.now() });
        return;
      }
      // NO await: the DAG runs in the background, and during that time the
      // Assistant has to stay FREE to keep talking. This is the "one person,
      // many idle gaps" spot.
      void this.run(routed.value.request).catch(() => {
        /* run() has already emitted the error to the UI */
      });
      return;
    }

    // chat, ask, or garbled — reply and stop, without spending a single
    // worker token. All three carry a sentence ALREADY APPROVED for the
    // reader: the first two are the model speaking to the user, the third is
    // a sentence CODE wrote because the model failed to produce one (the raw
    // text lives in `.state/route-failure.log`). → `Assistant.decideRoute`
    this.emit({ type: 'master.message', say: routed.value.say, role: 'assistant', plan_id: null });
  }

  /**
   * The Assistant's state and a worker's state are TWO different things. Say both.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE THREAD MUST NEVER GO SILENT.                                         │
   * │                                                                          │
   * │ From the moment the user hits Send until there's a result, there must     │
   * │ ALWAYS be a sentence describing what's happening. The old version went     │
   * │ silent for exactly one beat — between the Assistant finishing reading       │
   * │ the request and the plan showing up — because `run()` runs in the           │
   * │ background while the mailbox has already unlocked, so every number reads    │
   * │ zero.                                                                     │
   * │                                                                          │
   * │ `planning` fills exactly that beat. Read from `currentRecord.status`,      │
   * │ i.e. from the JOB RECORD — something that exists before planning even      │
   * │ starts, even when planning fails. Not inferred from the mailbox, because    │
   * │ the mailbox is exactly where it went wrong.                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * Compacting memory — a REAL STATE, not a sentence with a timer.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG FIXED: "/clear flashes once then goes silent for a very long time".   │
   * │                                                                          │
   * │ The old version emitted "Clearing…" as a `note` with a timer. But `say()` │
   * │ calls `emitActivity()` RIGHT AFTER `runCommand()` — and that activity      │
   * │ event carries no `note`, so the UI immediately clears the sentence it       │
   * │ just set. The user sees it flash for a few dozen milliseconds, then         │
   * │ complete silence for the entire model call.                              │
   * │                                                                          │
   * │ The more general lesson: **work in progress is a STATE, not a               │
   * │ notification.** A notification can be overwritten by something else and    │
   * │ has a timer to expire; a state is correct for as long as the work keeps      │
   * │ running, no matter who else fires `emitActivity()` in between.              │
   * │ Compaction takes 5-15 seconds — the longest silence in the whole            │
   * │ product, exactly what the "the thread must never go silent" rule (§6)       │
   * │ forbids.                                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private clearing = false;

  /**
   * Reading a document for a `lookup` turn — a STATE, not a notification.
   *
   * Same pattern as `clearing`, same reason: work in progress has to stay
   * correct for as long as it's running, no matter who else fires
   * `emitActivity()` in between. Turning it into a sentence with `hold_ms`
   * would recreate the exact "/clear flashes then goes silent" bug.
   *
   * This is the other half of the hidden worker's honesty: it deliberately
   * produces no Plan, so without this line the user would assume the
   * Assistant just knows the answer, when a real file-reading turn just ran.
   * → commands.ts `readingNote`
   */
  private reading: string | null = null;

  private emitActivity(): void {
    const planning = this.currentRecord?.status === 'planning';
    if (this.reading) {
      this.emit({
        type: 'office.activity',
        assistant: 'thinking',
        workers: this.activeScheduler?.runningCount ?? 0,
        queued: this.mailbox.size,
        jobs: this.deferred.length,
        // ⚠ DELIBERATELY carries no `hold_ms` — see `reading`.
        note: this.reading,
        plan_id: null,
      });
      return;
    }
    if (this.clearing) {
      // Overrides everything else: right now the Assistant isn't "thinking"
      // about any message at all, it's compacting memory. Saying "thinking…"
      // here would misdescribe what's actually running.
      this.emit({
        type: 'office.activity',
        assistant: 'thinking',
        workers: this.activeScheduler?.runningCount ?? 0,
        queued: this.mailbox.size,
        jobs: this.deferred.length,
        /**
         * States outright that it TAKES A FEW SECONDS — this is the longest
         * wait in the product where the user sees nothing running on the
         * diagram.
         *
         * ⚠ DELIBERATELY carries no `hold_ms`: this is the STATE of work in
         * progress, and has to stay correct for as long as the work runs.
         * Adding `hold_ms` here would recreate the exact silence just fixed.
         * → core/types.ts `office.activity`
         */
        note: t('off.clearing'),
        plan_id: null,
      });
      return;
    }
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : planning ? 'planning' : 'idle',
      workers: this.activeScheduler?.runningCount ?? 0,
      queued: this.mailbox.size,
      jobs: this.deferred.length,
      plan_id: this.currentRecord?.plan_id ?? null,
    });
  }

  /**
   * A TEMPORARY status sentence — shows then vanishes on its own, leaving
   * nothing behind in the chat stream.
   *
   * This is `/clear`'s (§4.6) way of speaking. It deliberately carries NO
   * busy/idle numbers: it overrides the status line, and the next
   * `emitActivity()` call reclaims control on its own — so there's no case of
   * "a temporary sentence stuck on screen forever".
   *
   * `hold_ms` is a hint for the DISPLAY SIDE, not a server-side timer: web
   * clears it after that long on its own, while Telegram keeps the edited
   * message as a divider. Same event, two outcomes — exactly the rule "each
   * display side picks its own reaction".
   */
  private emitNote(note: string, holdMs = 4_000): void {
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : 'idle',
      workers: this.activeScheduler?.runningCount ?? 0,
      queued: this.mailbox.size,
      jobs: this.deferred.length,
      note,
      hold_ms: holdMs,
      plan_id: null,
    });
  }

  /** A slash command — handled entirely by code, NO model call. 0 tokens. */
  private runCommand(parsed: Exclude<ParsedInput, { kind: 'text' }>): SayOutcome {
    /**
     * ⚠ An EMPTY `say` emits NO event at all. → bug 08/21
     *
     * A `master.message` with `say: ''` would otherwise go all the way
     * through: `appendChat` writes it to `chat.jsonl`, SSE pushes it out, and
     * the UI draws a COMPLETELY EMPTY chat bubble — the user sees a blank box
     * with no way to guess what it is.
     *
     * How it happens: a command that already replies with its OWN sentence
     * (`/resume` emits its own "resuming N jobs…" message) still has to
     * return a `SayOutcome`. It calls `reply('')` to mean *"I'm already
     * done talking"* — and `reply` would go ahead and emit yet another empty
     * message.
     *
     * Blocked HERE, not at the drawing layer: an empty message reaching
     * `chat.jsonl` sits on disk forever, and every future client (Telegram)
     * would have to remember to filter it out on its own. The drawing layer
     * has a second gate, but that's a safety net, not the actual door.
     */
    const reply = (say: string): SayOutcome => {
      if (say.trim()) {
        this.emit({ type: 'master.message', say, role: 'assistant', plan_id: null });
      }
      return { intent: 'chat', reply: say };
    };

    if (parsed.kind === 'unknown') return reply(helpText(parsed.typed));

    switch (parsed.name) {
      case 'help':
        return reply(helpText());

      case 'stop': {
        /**
         * ⚠ `mailbox.size` IS THE QUEUE, NOT "BUSY". Bug fixed 08/20.
         *
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ The old version checked `state !== 'working' && mailbox.size === 0 │
         * │ && deferred.length === 0` and concluded "idle". But while the       │
         * │ Assistant is thinking, that batch has already been `take()`n out    │
         * │ of the queue — `size` reads 0, `state` is still `idle` (no Plan       │
         * │ exists yet), and the actual running work lives in                   │
         * │ `mailbox.isBusy`, a variable NOBODY was checking.                    │
         * │                                                                    │
         * │ Measured on a user's machine, on the very first action of a          │
         * │ session: they typed "Hi, tell me about yourself", then `/stop`,        │
         * │ and got back *"Nothing is currently running."* — then the answer     │
         * │ showed up right after. The system had just lied about its own          │
         * │ state.                                                              │
         * │                                                                    │
         * │ Three states, three variables, all three have to be checked: a       │
         * │ Plan running (`state`) · the Assistant mid-turn (`isBusy`) ·          │
         * │ still-queued work (`size`/`deferred`). Compacting memory              │
         * │ (`clearing`) is also a model call in flight, and `/stop` can          │
         * │ interrupt it.                                                       │
         * └──────────────────────────────────────────────────────────────────┘
         */
        const idle =
          this.state !== 'working' &&
          !this.mailbox.isBusy &&
          !this.clearing &&
          this.mailbox.size === 0 &&
          this.deferred.length === 0;
        if (idle) return reply(t('off.nothingRunning'));
        const { dropped, cutAssistant } = this.stop();
        return reply(
          t('off.stoppingAll') +
            (cutAssistant ? ` ${t('off.stoppedAssistantTurn')}` : '') +
            (dropped ? ` ${t('off.droppedQueued', { n: String(dropped) })}` : '') +
            // Same reason as the sentence in `finish`: invite `/resume`, not "just message again".
            ` ${t('off.finishedWorkKept')}`,
        );
      }

      /**
       * Continues a job that got interrupted. 0 model turns — the plan
       * already exists and has already been paid for.
       * → `Office.resume` · SPEC-offices.md §6b
       */
      case 'resume': {
        const ready = this.resumable();
        if (!ready) {
          return reply(t('off.nothingHalfDone'));
        }
        if (this.state === 'working') {
          return reply(t('off.busyResumeLater'));
        }
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: t('off.resuming', {
            n: String(ready.left),
            of: ready.request ? t('off.resumingOf', { request: ready.request }) : '',
          }),
        });
        // `void`: the command replies IMMEDIATELY, the job runs in the background — same as the usual `run()` path.
        void this.resume().catch((err: unknown) => {
          this.emit({
            type: 'master.message',
            role: 'assistant',
            say: err instanceof Error ? err.message : t('off.resumeFailed'),
          });
        });
        return reply('');
      }

      case 'status': {
        if (!this.currentRecord) {
          const ready = this.resumable();
          if (ready) {
            // Leftover work is a STATE of the office, not a notification
            // that has already come and gone — so it has to be able to
            // answer "what's the current state".
            return reply(
              t('off.idleWithLeftovers', { n: String(ready.left), request: ready.request }),
            );
          }
          return reply(
            t('off.idle', {
              total: String(this.loaded.roles.size),
              onDuty: String(this.assistant.assignableRoles().size),
            }),
          );
        }
        const r = this.currentRecord;
        const done = r.steps.filter((s) => s.status === 'done').length;
        return reply(
          t('off.statusRunning', {
            request: r.request,
            step: String(done),
            steps: String(r.steps.length),
            done: String(r.tasks_done),
            total: String(r.tasks_total),
            turns: String(r.turns),
            cost: formatUSD(r.costUSD),
          }),
        );
      }

      case 'clear': {
        if (this.state === 'working') {
          return reply(t('off.clearBusy'));
        }
        /**
         * `/clear` EMITS NO `master.message` AT ALL. → SPEC-offices.md §4.6
         *
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ The "Clearing…" pulse was ALREADY a state pretending to be a       │
         * │ message: it always got swept away by `office.cleared` right after,  │
         * │ no branch of it ever survives. A message designed to never outlive  │
         * │ one beat IS a state — calling it by its real name is more honest.   │
         * │                                                                  │
         * │ The "Cleared" pulse was worse: it left `/clear` littering the        │
         * │ exact thing it had just cleaned up, and that line belonged to no     │
         * │ one — not the user asking, not the Assistant answering, just the    │
         * │ system talking to itself.                                          │
         * │                                                                  │
         * │ Same pattern as `…thinking` → blank: a PROCESS shows then           │
         * │ vanishes, only the RESULT stays. The durable evidence is the         │
         * │ MEMORY node in the Knowledge pane.                                  │
         * └──────────────────────────────────────────────────────────────────┘
         */
        // A STATE flag, not a sentence with a timer. `say()` fires
        // `emitActivity()` right after this function, and that function
        // reads this exact flag to describe what's actually running —
        // instead of erasing the sentence just set. See `clearing`.
        this.clearing = true;
        // NO await: reply immediately so the chat pane doesn't freeze, then
        // report the result as an event like everything else.
        void this.compactMemory()
          .then((r) => {
            this.clearing = false;
            this.emitNote(r.note);
          })
          // BAD news stays up longer than good news: people read bad news
          // more slowly, and this sentence reports something that did NOT
          // happen — the context is still intact.
          .catch(() => {
            this.clearing = false;
            this.emitNote(t('off.clearFailedKept'), 8_000);
          });
        return { intent: 'chat', reply: '' };
      }

      // The approval gate isn't built yet (SPEC-tools-approval.md §8). Reply honestly
      // instead of silence — the user typing /approve means they're waiting
      // on something we never asked, and they need to know we never asked it.
      case 'approve':
      case 'reject':
        return reply(t('off.nothingToApprove'));
    }
  }

  // ── running a request

  /**
   * `draft` — a plan that ALREADY EXISTS, no need to plan again. →
   * `Assistant.decideRoute`'s escape hatch
   *
   * Passing it in skips the `plan()` turn entirely. Every gate after that
   * (`linkDeps`, `validate`, framing the paths) runs unchanged: a plan
   * arriving through a different door still has to pass through the exact
   * same checks as a normal plan.
   */
  /**
   * `resumePlan` — a plan that ALREADY EXISTS, only the unfinished part left
   * to run. → `resume()`
   *
   * Passes through this EXACT function rather than a trimmed-down copy:
   * `linkDeps`, `validate`, `missingInputs`, the cost ledger, the report,
   * `finish` — all of it has to run identically. Two copies of the same
   * computation will drift (the 08/19 rule), and the rarer-to-run copy is the
   * one that drifts first.
   */
  async run(
    request: string,
    draft?: PlanDraft,
    resumePlan?: Plan,
  ): Promise<{ plan_id: string; report: string; usage: Usage }> {
    this.assertLive();
    if (this.state === 'working') {
      throw new RunError(t('off.officeBusyWait'), 'other');
    }

    this.stopRequested = false;
    let usage: Usage = emptyUsage();

    // The job record exists BEFORE planning even starts: if planning fails,
    // the user still has to see "there was a job, and here's where it broke".
    const record: PlanRecord = {
      // REUSE the old id when resuming: `artifacts/<plan_id>/` is the frame
      // for a whole run, so a new id would mean fresh output landing in a
      // different directory and the already-finished part becoming an
      // orphan — exactly what `resume` exists to avoid.
      plan_id: resumePlan?.plan_id ?? newPlanId(),
      office: this.id,
      request,
      status: 'planning',
      started_at: new Date().toISOString(),
      steps: [],
      tasks_done: 0,
      tasks_total: 0,
      costUSD: 0,
      turns: 0,
    };
    this.currentRecord = record;
    this.plans.upsert(record);
    // This sentence has to state EXACTLY what's happening. `/resume` never
    // calls the model — printing "planning" there would be a lie in the
    // exact spot the user is looking, and that's exactly what led us both to
    // misread the log for cases hd3/hd4.
    this.setState(
      'working',
      resumePlan ? t('off.stateResuming') : t('off.statePlanning'),
    );
    // Keep the thread alive IMMEDIATELY. `run()` gets called with `void` from
    // `handleUserBatch`, and right after that `pump()` emits an activity
    // that's all zeros — if this doesn't fire first, the status line goes
    // dark at the exact moment work is starting.
    this.emitActivity();

    try {
      /**
       * 0a. Wait for documents still being extracted — the library's ONE wait point.
       *
       * → docs/SPEC-library.md §10
       *
       * Not waiting here creates a real and silent failure: the user drops a
       * PDF and immediately asks about it, `Grep` runs before the text even
       * exists, and a worker answers "found nothing in the document" very
       * convincingly. Being wrong with nobody noticing is the worst outcome
       * of all.
       *
       * The wait is scoped as narrowly as possible: only files being
       * extracted for THIS office, with a timeout, touching no other office.
       * Stopping the whole system to wait for an index is exactly what the
       * "no exception justifies stopping everything" rule forbids.
       */
      const waitingFor = this.library.busyNames();
      if (waitingFor.length > 0) {
        this.setState('working', t('off.stateReadingDocs', { names: waitingFor.slice(0, 2).join(', ') }));
        await this.library.settled(this.loaded.company.library.extract_timeout_ms);
      }

      // 0. Nobody's on duty — don't spend a single token finding that out.
      const onDuty = this.assistant.assignableRoles();
      if (onDuty.size === 0) {
        throw new RunError(
          this.loaded.roles.size === 0
            ? t('off.noRolesAtAll')
            : t('off.noRolesWired'),
          'other',
        );
      }

      // 1. Planning — UNDER LOCK. The Assistant is one person: if the user
      // just sent something, that turn has to finish first, and must never
      // overlap this one. `record.plan_id` goes INTO the planning step,
      // rather than being written on top of its output afterward:
      // `artifactScoper` frames paths using the id it was given, so
      // overwriting it afterward would leave a results directory carrying an
      // orphaned id. → `Assistant.plan`
      // A planning call that THROWS is also a turn the user has to repeat —
      // counted HERE, not in this function's closing `catch`: that `catch`
      // also receives "no worker on duty" and "the office is busy", which are
      // configuration issues, not a case of the two sides misunderstanding
      // each other. → `planFriction`
      // A plan arriving through the escape hatch does NOT call the model
      // again — it's already been paid for in the `route()` turn that just
      // ran. `usage` was already counted there too, so it's 0 here.
      // Resuming means the plan ALREADY EXISTS and is ALREADY PAID FOR — no
      // model call at all. This is the whole point of `resume`: the most
      // expensive part of a failed run is the turns already spent, and
      // replanning would spend more on something already in hand.
      const planned = resumePlan
        ? { value: { kind: 'plan' as const, plan: resumePlan }, usage: emptyUsage() }
        : draft
          ? { value: this.assistant.adopt(draft, request, record.plan_id), usage: emptyUsage() }
          : await this.mailbox
              .lock(() => this.assistant.plan(request, record.plan_id))
              .catch((err: unknown) => {
                this.planFriction++;
                throw err;
              });
      usage = addUsage(usage, planned.usage);
      this.logAssistantUsage('plan', planned.usage);

      /**
       * 1b. Couldn't split the work because of MISSING INFORMATION → ask back,
       * NOT an error.
       *
       * → docs/SPEC-offices.md §6 · `Assistant.plan`
       *
       * This case closes as `blocked`, not `failed`: `failed` means it was
       * tried and broke, while this is not yet tried. A user reading the log
       * has to be able to tell "the system got it wrong" from "the system is
       * waiting on me" — merging the two into one status breaks the very log
       * built to be trusted.
       *
       * Spends NO worker tokens. The question goes straight to the chat pane
       * with role `assistant`, exactly like an `intent: 'ask'` turn from
       * `route()` — to the user this IS the same thing, and they don't need
       * to know which step it came from.
       */
      if (planned.value.kind === 'ask') {
        this.planFriction++;
        this.emit({ type: 'master.message', role: 'assistant', say: planned.value.say });
        // `finish` returns the office to `idle` on its own — no extra `setState` call needed here.
        this.finish(record, 'blocked', '', usage, 0);
        return { plan_id: record.plan_id, report: '', usage };
      }

      const plan = planned.value.plan;
      // Work got split successfully, so LOCK IN the friction count for this
      // run and reset it to 0 right away: a later run that goes smoothly
      // from the first sentence must not inherit this run's friction. Read
      // again in the report step below.
      const friction = this.planFriction;
      this.planFriction = 0;

      /**
       * 2. FIX what's fixable, THEN block what isn't.
       *
       * The order is deliberate, and it's the "a draft worth fixing beats
       * starting from scratch" principle applied to the plan itself:
       *
       *  · `linkDeps` — a task that reads another task's output but forgot to
       *    declare `deps` gets WIRED DIRECTLY. That relationship can be
       *    inferred from the two paths already in hand; making the model
       *    replan just to get it right is one more call spent to get back a
       *    result that could still be wrong.
       *  · `validate` — whatever's left can't be guessed, so it has to stop.
       *
       * Both run AFTER planning but BEFORE the first worker is launched: only
       * one planner turn has been spent by this point.
       *
       * The role list checked against is the roles ON DUTY, not every file
       * under `roles/` — otherwise unwiring a node on the canvas would just
       * be decoration.
       */
      const linked = Scheduler.linkDeps(plan);
      if (linked.length) {
        // Say it, don't silently fix it. A user looking at the plan strip
        // sees two tasks running one after another instead of in parallel,
        // and there has to be a line explaining why.
        this.emit({
          type: 'office.state',
          state: 'working',
          say: t('off.linkedTasks', { n: String(linked.length), list: linked.join(', ') }),
        });
      }

      // ⚠ Pass the arm table: without it, `inputs: ["Musics"]` gets blocked
      // even when a worker has an arm named Musics pointing straight at that
      // directory. → `resolveInput`
      const problems = Scheduler.validate(
        plan,
        onDuty,
        this.loaded.dir,
        armDirIndex(this.loaded.company.arms, this.loaded.company.mcpServers),
      );
      if (problems.length) {
        // The plan came out, but it can't run — to the user this is still a
        // turn they have to repeat. Counts as friction. → `planFriction`
        this.planFriction++;
        /**
         * This sentence goes straight to the user's face, so it has to state
         * WHAT TO DO — the "handles errors well" criterion. The old version
         * printed the raw technical list ("Task T-02: dependency T-05 doesn't
         * exist") for someone running a flower shop to read.
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ AND IT MUST NOT SAY "NOTHING SPENT YET" (fixed 08/20, user caught   │
         * │ it).                                                               │
         * │                                                                    │
         * │ The old version wrote *"nothing has been spent on any job yet"*.    │
         * │ The user opened the cost ledger right after and saw money spent —   │
         * │ because the `route()` turn and the `plan()` turn that just ran had  │
         * │ both already recorded charges. That reassurance was a lie, and it   │
         * │ lied in exactly the spot the user could check most easily.          │
         * │                                                                    │
         * │ What we know for certain and can say: NO worker ran — and a worker  │
         * │ is the expensive part (a worker turn floors around ~13,200 tokens,  │
         * │ compared to one Assistant turn). State that part correctly, and      │
         * │ point straight to the cost ledger for the rest, instead of putting  │
         * │ a number here: on the escape-hatch branch, `usage` at this exact     │
         * │ point reads 0 while the `route()` turn already charged money —       │
         * │ printing a number here would create a second lie.                   │
         * │ → SESSIONS_MEMORY §2 "The cost ledger must never say the wrong       │
         * │ thing"                                                              │
         * └────────────────────────────────────────────────────────────────────┘
         */
        const fingerprint = problems.join('\n');
        this.samePlanProblemsCount =
          fingerprint === this.lastPlanProblems ? this.samePlanProblemsCount + 1 : 0;
        this.lastPlanProblems = fingerprint;

        throw new RunError(planProblemsMessage(problems, this.samePlanProblemsCount), 'other');
      }

      // Passing the `validate` gate breaks the stuck loop — see `samePlanProblemsCount`.
      this.lastPlanProblems = '';
      this.samePlanProblemsCount = 0;

      this.currentPlan = plan;
      record.steps = plan.steps;
      record.tasks_total = plan.tasks.length;
      record.status = 'running';
      this.plans.upsert(record);
      this.emitActivity();

      /**
       * ⚠ THE FOUR THINGS BELOW ARE ONLY FOR A REAL PLANNING TURN.
       *
       * Fixed 08/21, after `/resume` rode along on `run()` and dragged all
       * four in with it:
       *
       *  · `savePlan` **OVERWRITES** `<plan_id>.plan.json` with the TRIMMED
       *    plan. The original 3-task plan disappears from disk — losing the
       *    forensic record, the only thing that can answer "what was this
       *    run originally supposed to do". Same class as the duplicate
       *    `plan_id` bug on 08/19.
       *  · `plan.created` fires a second time in the same log file → the log
       *    reads *"planned 3 steps"* for a turn that made NO model call.
       *  · The sentence *"I've split this into 3 jobs: 1. Split the
       *    contract…"* reads out the exact step it will NOT do — the user has
       *    no way to know this is a resume.
       *
       * `resume()` emits its own sentence (*"Continuing N unfinished
       * jobs…"*) at the command layer, so staying silent here is correct, not
       * a gap.
       */
      if (!resumePlan) {
        this.savePlan(plan);
        this.emit({ type: 'plan.created', plan_id: plan.plan_id, request, steps: plan.steps });

        // The plan has to reach the CHAT STREAM, not just sit on the diagram.
        // Over Telegram, the diagram doesn't exist — and the bridge is the
        // ultimate target. Built by code from `steps` already in hand: 0
        // tokens. Once an approval gate exists (SPEC-tools-approval.md §8b),
        // this exact message will carry the approve button.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say:
            `${plural('off.splitInto', plan.steps.length)}\n` +
            plan.steps.map((s, i) => `  ${i + 1}. ${s.title}`).join('\n') +
            `\n${t('off.startingNow')}`,
        });
      }

      // 3. Run
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ A SIGN-IN WINDOW IS OPEN ⇒ DO NOT LAUNCH WORK. → `browser-login.ts`   │
       * │                                                                      │
       * │ Chromium **locks** `user-data-dir`. A sign-in window holding the       │
       * │ profile while a worker launches means Playwright runs into a locked    │
       * │ profile ⇒ **the MCP dies at spawn** ⇒ the worker loses its tool and     │
       * │ answers from its own persona. That's exactly the silent failure that    │
       * │ once cost a user $0.03 and a whole afternoon of digging.               │
       * │                                                                      │
       * │ ⚠ Blocked HERE, not in `pickMcp`: by that point the plan is already     │
       * │ made, planning has already been paid for, and the rejection arrives     │
       * │ after the user has already waited. Blocking before launch means         │
       * │ blocking **before money is spent**.                                    │
       * │                                                                      │
       * │ The lock heals itself: the user closes the window ⇒ `exit` releases     │
       * │ it. So this sentence states **what to do**, not "try again later".      │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      if (loginOpen(this.id)) {
        throw new RunError(
          t('off.browserLoginOpen'),
          'other',
        );
      }
      const scheduler = new Scheduler({
        office: this.loaded,
        knowledge: this.knowledge,
        emit: (e) => this.onSchedulerEvent(e, plan, record),
        shouldStop: () => this.stopRequested,
        audit: this.audit,
      });
      this.activeScheduler = scheduler;

      const result = await scheduler.run(plan);
      // Trim after ONE run, not after every call: reading and rewriting the
      // whole file for every line would turn one `appendFileSync` into
      // O(n²). → `audit.ts §trim`
      this.audit.trim();
      const receipts = [...result.receipts.values()];

      /**
       * Document text, read EXACTLY ONCE for the whole run — used to block a
       * lesson that's just a copy of a document (`echoesLibrary`).
       *
       * Only read when there's actually a lesson to check. Most runs have
       * none: the `worthLearning` gate already cuts the Assistant branch, and
       * a worker usually returns `lessons: []`.
       */
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 A RUN-LEVEL WARNING HAS TO BE COMPUTED **BEFORE** BOTH LESSON       │
       * │ GATES. (user 08/29)                                                   │
       * │ > *"if one job still has a warning, that means there's still a leak,   │
       * │ >  it can't be counted as a lesson"*                                   │
       * │                                                                      │
       * │ `missingOutputs` used to be computed way down below, AFTER both the    │
       * │ worker lesson-recording loop AND the `report()` turn that already      │
       * │ asked the Assistant what it learned. So it could tell the USER            │
       * │ without ever having blocked a single node — exactly the failure         │
       * │ class *"a rule standing behind what it governs"*.                       │
       * │ → [[agentco-rule-must-see-what-it-governs]]                            │
       * │                                                                      │
       * │ Moved up here: same computation, same result, only the position         │
       * │ changed. Safe to read from disk at this point — `scheduler.run()`       │
       * │ already finished on the line above.                                    │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      /**
       * `wrote` — the outputs this run PROMISED that are really on disk.
       *
       * The second source `whereBlock` needs, and the only one that can see a
       * file produced by `Bash`/`PowerShell` or by an arm's own write tool:
       * `landingOf` recognises `Write`/`Edit`/`NotebookEdit` and nothing else,
       * so a worker that builds its report with a shell one-liner lands
       * `kind: 'command'` and the file becomes invisible to the interface.
       * Measured 05/09 — `P-260905-0100-zquw` T-01.
       *
       * Still code-owned, so it is still allowed to be clickable: these paths
       * come from `outputScoper`, not from anything the model wrote in prose,
       * and they have just passed `safeJoin` + `existsSync` above.
       */
      const { gone, landed: wrote } = this.outputStatus(plan, receipts);
      const leaked = gone.length > 0 || (plan.redirected?.length ?? 0) > 0;

      const anyLesson = receipts.some((r) => r.lessons.length > 0 && learnable(r) && !leaked);
      let docTexts: string[] | undefined = anyLesson ? this.library.texts() : undefined;

      for (const r of receipts) {
        this.saveReceipt(plan.plan_id, r);
        this.recordUsage(r);
        usage = addUsage(usage, r.usage);
        /**
         * ┌────────────────────────────────────────────────────────────────┐
         * │ 🔴 THE SECOND GATE OF THE SAME RULE. → `assistant.ts §learnable` │
         * │                                                                │
         * │ `worthLearning` guards the Assistant's door. A worker does NOT   │
         * │ pass through that gate — it self-reports `lessons` in its own    │
         * │ receipt, and before 08/29 the only thing filtering it was         │
         * │ `rejectLesson` (duplicates · copied documents · numbers). So       │
         * │ patching one door left the other one open, the same failure       │
         * │ class [[agentco-finish-completely]] had already hit three times.  │
         * │                                                                │
         * │ The real case for THIS gate, measured 08/29 — a lesson from the   │
         * │ `nguoi-soi-thu-muc` role itself, born from a job that didn't       │
         * │ finish:                                                          │
         * │   *"Before calling browser_navigate … if permission is denied,     │
         * │    stop and report blocked immediately instead of retrying"*       │
         * │ It's one of the 10 entries that had stopped the browser arm from    │
         * │ running at all.                                                  │
         * │                                                                │
         * │ ⚠ The gate sits HERE, not in `addLesson`: `addLesson` only          │
         * │ receives `text`, it never sees the `status` of the run that         │
         * │ produced that text — a rule has to stand where it can see what      │
         * │ it governs.                                                       │
         * │ → [[agentco-rule-must-see-what-it-governs]]                       │
         * └────────────────────────────────────────────────────────────────┘
         */
        // ⚠ Wraps the loop body rather than `continue`: below this there's
        // still room for other work per receipt, and a `continue` would
        // silently swallow that work too.
        if (learnable(r) && !leaked) {
          for (const lesson of r.lessons) {
            // `r.reads` = library documents THIS worker opened during this
            // run. Its lesson lives or dies with those exact files — a weak
            // entity.
            this.knowledge.addLesson(r.role, lesson.text, r.task_id, docTexts ?? [], r.reads);
          }
        }
      }

      // 4. Report
      let report: string;
      let status: PlanStatus;
      /**
       * Hoisted out of the branch below because the "saved to" block has to
       * read it — see the gate at the bottom of this method. It is the ONE
       * shape where naming the file underneath really is noise.
       */
      let soloReply = false;
      if (result.stoppedBy === 'usage_limit') {
        report =
          t('off.rateLimited', { n: String(result.pending.length) });
        status = 'paused';
      } else if (result.stoppedBy === 'auth') {
        report = t('off.notSignedIn');
        status = 'paused';
        // `stoppedBy` only gets set when the scheduler never got to launch
        // any more tasks. But when WE interrupt a running task, it returns a
        // "blocked" receipt normally and the scheduler runs its loop to
        // completion — so this has to be detected here on its own. Without
        // this line, the log would record "done" for a run the user stopped.
      } else if (result.stoppedBy === 'user' || this.stopRequested) {
        // The handoff is built by CODE, not an LLM call. The Assistant needs
        // to know how far it got so the next message continues the
        // REMAINING part instead of starting over. →
        // docs/SPEC-tools-approval.md §3b
        //
        // A clean context is FREE here: the Assistant only ever sees the
        // receipt (≤800 tokens), never a worker's transcript. It inherits
        // the RESULT, not the PROCESS.
        const finished = receipts.filter((r) => r.status === 'done');
        const left = result.pending.length + receipts.filter((r) => r.status === 'blocked').length;
        report =
          t('off.stopped', {
            done: String(finished.length),
            total: String(plan.tasks.length),
            left: String(left),
          }) +
          (finished.length
            ? `\n${t('off.stoppedHave', {
                list: finished.flatMap((r) => r.artifacts).join(', ') || t('off.resultsSaved'),
              })}`
            : '') +
          /**
           * ⚠ INVITE TOWARD THE PATH THAT'S ACTUALLY GUARDED. → SPEC-offices.md §6b
           *
           * The old version said *"message again and I'll do the rest"* —
           * i.e. it pushed the user down the REPLAN path, where the planner
           * looks at the manifest and might pick up an unfinished file as an
           * input. `/resume` instead goes through `delivered()`: any task
           * that never delivered its output gets RERUN.
           *
           * One sentence, and it completely changes the odds of which door
           * the user walks through — cheaper than any technical fence built
           * behind it.
           */
          `\n${t('off.stoppedResumeHint')}`;
        status = 'stopped';
      } else {
        /**
         * THE ANSWER GOES STRAIGHT FROM A WORKER TO THE USER. → SPEC-offices.md §6
         *
         * Doesn't pass through the Assistant, isn't part of `report()`, never
         * enters the Assistant's session. This is the "answer" half of the
         * two channels — the "say" half still runs the old path.
         *
         * Emitted BEFORE the report: the user asked a question, what they're
         * waiting for is the ANSWER, not a summary line about having answered.
         */
        const answered = receipts.filter((r) => r.answer.trim() && r.status === 'done');
        for (const r of answered) {
          this.emit({ type: 'master.message', say: r.answer.trim(), role: r.role });
        }

        /**
         * A SINGLE `reply` task SKIPS `report()` ENTIRELY — the worker's own
         * answer IS the report.
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ This is where the awkwardness ends, and it's a real savings, not     │
         * │ just tidier to look at.                                             │
         * │                                                                    │
         * │ Running `report()` here would mean the chat pane shows TWO             │
         * │ messages about the same thing: the answer for the customer, then       │
         * │ an Assistant line saying it has answered. Dropping it cuts ONE          │
         * │ ASSISTANT TURN for every question — and a customer-support office        │
         * │ is exactly where this cost shape repeats the most.                     │
         * │                                                                    │
         * │ The cost, stated plainly: the Assistant's session does NOT contain     │
         * │ that answer. On the next edit, it knows the REQUEST (it routed it       │
         * │ itself) but not WHAT WAS ANSWERED — it has to hand it back to a          │
         * │ worker to read the file. One worker turn, in exchange for the            │
         * │ Assistant's context NOT growing with every question a customer          │
         * │ asks. For a support office, that's the right trade.                    │
         * └────────────────────────────────────────────────────────────────────┘
         */
        soloReply = plan.tasks.length === 1 && answered.length === 1;
        if (soloReply) {
          // Empty `report`: `finish()` won't emit any more messages. The
          // answer just emitted above is already what the user needs to read.
          report = '';
          status = 'done';
        } else {
        const summary = await this.mailbox.lock(() =>
          this.assistant.report(plan.steps, receipts, friction, leaked),
        );
        usage = addUsage(usage, summary.usage);
        this.logAssistantUsage('report', summary.usage);
        report = summary.value.say;
        // A task that came back `blocked` must never be written into the work
        // log as a finished run. → `planStatusOf`, and the box on it
        status = planStatusOf(receipts);

        /**
         * A promised file that isn't on disk → SAY SO, and downgrade the
         * status to `failed`. A log recording "done" for a run that produced
         * no result is exactly the kind of lie `stoppedReceipt` already fixed
         * for the interrupted branch; nobody had checked the normal
         * completion branch yet.
         */
        // `gone` was already computed above — it has to run BEFORE both
        // lesson gates, see where `leaked` is built. All that's left here is
        // telling the user.
        if (gone.length) {
          status = 'failed';
          /**
           * TWO COMPLETELY DIFFERENT CASES, AND THE OLD VERSION MERGED THEM
           * INTO ONE.
           *
           *  · nothing on disk at all   → redoing it is correct
           *  · it EXISTS, but in the wrong place → redoing it charges the user
           *                                        twice for something already
           *                                        done, and leaves a stray file
           *                                        behind
           *
           * The second case actually happened (`P-260821-1818-yydi`) and the
           * old version said the sentence for the first. We can OBSERVE the
           * difference through `landed.outside` — not saying so is willful
           * blindness.
           */
          const strays = strayFilesOf(receipts);
          report += strays.length
            ? `\n\n⚠ ${t('off.wroteOutside', {
                list: `${strays.slice(0, 2).join(', ')}${strays.length > 2 ? '…' : ''}`,
              })}`
            : `\n\n⚠ ${t('off.filesMissing', {
                n: String(gone.length),
                list: `${gone.slice(0, 3).join(', ')}${gone.length > 3 ? '…' : ''}`,
              })}`;
        }
        // The Assistant is the ONLY one allowed to write into the shared
        // knowledge store (SPEC-offices.md §4.3): the shared store sits in
        // the prefix of the whole office, and letting anyone write to it
        // would make it grow exponentially with nobody accountable for it.
        if (summary.value.lessons.length > 0) docTexts ??= this.library.texts();
        for (const lesson of summary.value.lessons) {
          // A SHARED lesson depends on EVERY document this run touched: the
          // Assistant reads no files itself, so the only thing it could
          // possibly be referring to is a document a worker just read.
          // Deleting any one of those files means the lesson goes with it.
          this.knowledge.addSharedLesson(lesson.text, plan.plan_id, docTexts ?? [], readsOf(receipts));
        }
        }
      }

      if (receipts.some((r) => r.lessons.length > 0) || status === 'done') {
        this.knowledge.scan();
        this.emit({
          type: 'knowledge.changed',
          count: this.knowledge.size,
          version: this.loaded.knowledgeVersion,
        });
      }
      /**
       * Synced OUTSIDE the branch above, and that's exactly where the first
       * draft nearly got it wrong.
       *
       * The branch above only runs when there's a lesson or the run is
       * `done`. But the output manifest has to update even when the run is
       * `failed`/`stopped` — a worker may have already written a few files
       * before things broke, and those are exactly the files the user will
       * refer to in the next message ("finish the rest of it"). Tying it to
       * the knowledge store's gate would make it miss the exact run that
       * needs it most.
       */
      this.refreshAssistantContext();

      // Remember the output to hand off to whatever's queued next -- see `finish()`.
      this.lastArtifacts = receipts.flatMap((r) => r.artifacts);
      this.savePending(record.plan_id, result.pending);
      this.saveSessionId();
      /**
       * The "saved to" block is BLOCKED on two branches, for two different reasons:
       *
       *  · `stopped` — its own sentence already lists the artifacts (§11f).
       *  · a SOLO `reply` run — the user just FINISHED READING the answer.
       *    Pasting a path underneath it repeats the same thing in machine
       *    language, and drags `P-260819-1430-…` in front of someone running
       *    a flower shop. The file still sits in the Output pane for anyone
       *    who needs it.
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 THE SECOND GATE USED TO READ `receipts.filter(r => !r.answer)` —   │
       * │ i.e. it dropped the whole RECEIPT of any task that answered, not      │
       * │ just the sentence. (user caught it 05/09)                             │
       * │                                                                      │
       * │ In a MIXED run that throws away evidence: `P-260905-0100-zquw` had    │
       * │ T-01 (`deliver: file`, wrote via PowerShell ⇒ no `file` landing at    │
       * │ all) and T-02 (`deliver: reply`, landed a real `file`). The filter    │
       * │ discarded T-02's receipt for having an `answer`, T-01 had nothing to  │
       * │ give, and the run reported ZERO files while TWO sat on disk — so the  │
       * │ chat had no clickable path at all, and the only paths on screen were  │
       * │ ones the model had typed itself, which are deliberately inert.        │
       * │                                                                      │
       * │ The intent behind the gate (SPEC-offices §6) was about the run where  │
       * │ the answer IS the whole report. That is exactly `soloReply`, which    │
       * │ is now what it asks. A mixed run still prints a report, and naming    │
       * │ every file it really produced is the point of that report.            │
       * │ → [[agentco-fallback-throws-away-answers]]                            │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const quiet = status === 'stopped' || soloReply;
      this.finish(
        record,
        status,
        report,
        usage,
        receipts.length,
        quiet ? [] : receipts,
        plan.redirected ?? [],
        quiet ? [] : wrote,
      );
      return { plan_id: record.plan_id, report, usage };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      /**
       * THE USER HITTING STOP IS NOT A FAILED RUN. → types.ts `stopped`
       *
       * Real case: `/stop` while the Assistant is mid-planning. That turn
       * gets interrupted and throws, landing here — the old version closed
       * the record as `failed` using the raw error message as the report.
       * The work log recorded "the system got it wrong" for the exact thing
       * the user themself asked to stop.
       *
       * And it emits NO extra message: `/stop` has already replied (§11e).
       * `finish` skips an empty `report`, so all that's left is
       * `plan.finished` closing the books for the UI.
       */
      if (err instanceof RunError && err.kind === 'stopped') {
        this.finish(record, 'stopped', '', usage, 0);
        return { plan_id: record.plan_id, report: '', usage };
      }
      // What the user is told and what the log records are TWO different
      // things. The user needs to know WHAT TO DO NEXT; the log needs to
      // know what actually happened.
      this.finish(record, 'failed', msg, usage, 0);
      return { plan_id: record.plan_id, report: msg, usage };
    }
  }

  /**
   * The "where the output is" block, BUILT BY CODE from OBSERVED
   * destinations. 0 tokens.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY NOT INSTRUCT THE MODEL, AND WHY NOT USE `artifacts`                  │
   * │                                                                          │
   * │ First version: the model RANDOMLY mentioned a path in its summary          │
   * │ sentence. No guarantee → lost. Instructing the prompt "state the path"     │
   * │ buys back the exact uncertainty just removed, at a permanent token          │
   * │ cost, and still breaks on a model switch.                                 │
   * │                                                                          │
   * │ Second version used `receipt.artifacts` — better, but still the model's    │
   * │ own account, and it can ONLY DESCRIBE FILES. Output can live in Notion,    │
   * │ Google Sheets, a database. For those cases `artifacts` is empty and this    │
   * │ block goes silent — i.e. we're back to depending on the model's own          │
   * │ wording.                                                                  │
   * │                                                                          │
   * │ This version reads `receipt.landed`: inferred from TOOLS ACTUALLY           │
   * │ CALLED in the stream, an observed fact rather than a claim. →               │
   * │ worker.ts `landingOf`                                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Three kinds of destination, three ways of stating it — and the wording
   * matches the ACTUAL level of certainty:
   *
   *  file     checks `existsSync` before listing it → states "saved to" with confidence.
   *  external knows for certain which server was called, can't check how it
   *           saved it → says "sent to", names the server.
   *  command  does NOT know where the data went → states outright that it doesn't know.
   *
   * The last case is the remaining uncertainty, and it's BOXED IN AND
   * LABELED rather than hidden. The rest of the detail lives in the worker's
   * own `say` sentence — that's exactly `say`'s job, and nothing extra needs
   * to be instructed to get it.
   */
  /**
   * ASSEMBLY CHECK — by code, 0 tokens, 0 calls.
   *
   * The question "does the output match what was assigned" has two halves,
   * and only ONE half needs the model:
   *
   *  · *"Is the answer for the customer any good"* → requires reading the
   *    content. That belongs to a reviewing worker, decided at planning time.
   *    It does NOT belong to the Assistant: the Assistant runs on a persisted
   *    session, so anything it reads sits in the context of EVERY chat turn
   *    afterward — read once, pay forever.
   *  · *"The task claims it wrote file X — does file X exist"* → this is a
   *    FACT. Asking the model is paying money for uncertainty in return.
   *    That's the half handled here.
   *
   * A worker reporting `done` while a promised file isn't on disk is the
   * worst kind of lie: the user reads "it's done", goes to open the file, and
   * there's nothing there. `whereBlock` only lists what's REAL, so it stays
   * silent at the exact moment it most needs to speak up.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ONE LOOP, BOTH ANSWERS — `gone` AND `landed`. (05/09)                    │
   * │                                                                          │
   * │ This used to be `missingOutputs`, returning only the absent half. The     │
   * │ present half was needed too (see `whereBlock`), and writing a second      │
   * │ near-identical loop for it is the "two copies of the same computation"    │
   * │ trap: the day the `status !== 'done'` gate or the `safeJoin` guard moves, │
   * │ one copy moves and the other quietly does not. Same walk, two lists.      │
   * │ → [[agentco-detect-fix-pair-scope]]                                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private outputStatus(
    plan: Plan,
    receipts: readonly Receipt[],
  ): { gone: string[]; landed: string[] } {
    const byTask = new Map(receipts.map((r) => [r.task_id, r]));
    const gone: string[] = [];
    const landed: string[] = [];
    for (const task of plan.tasks) {
      // Only checks work that SELF-REPORTED as done. A task that was blocked
      // or interrupted mid-run having no file is normal, and it already said
      // so itself.
      if (byTask.get(task.task_id)?.status !== 'done') continue;
      for (const out of task.outputs) {
        try {
          if (fs.existsSync(safeJoin(this.loaded.dir, out.path))) landed.push(out.path);
          else gone.push(out.path);
        } catch {
          gone.push(out.path);
        }
      }
    }
    return { gone, landed };
  }

  /**
   * @param wrote promised outputs verified on disk by `outputStatus` — the
   *   second source, and the only one that sees a file written through the
   *   shell or through an arm. Both sources go through the SAME existence
   *   gate below, so neither can smuggle in a path the other would reject.
   */
  private whereBlock(
    receipts: readonly Receipt[],
    wrote: readonly string[] = [],
  ): { text: string; files: string[] } {
    const servers = new Set<string>();
    let ranCommand = false;
    const landed = receipts.flatMap((r) => r.landed ?? []);

    for (const spot of landed) {
      if (spot.kind === 'external') servers.add(spot.ref);
      else if (spot.kind === 'command') ranCommand = true;
    }

    /**
     * ⚠ `filesOnDisk`, NOT a local `existsSync` loop.
     *
     * *"Merge what was PROMISED with what we SAW written, keep only what is
     * really there"* is the same question the scheduler already asks on four
     * other exit paths, and that function is exported precisely so a fifth
     * copy never gets written — its own comment box says so. Writing the loop
     * again here is the 08/19 rule broken in the very file that cites it.
     * → `worker.ts §filesOnDisk`
     */
    const files = new Set(filesOnDisk(this.loaded.dir, wrote, landed));

    const lines: string[] = [];
    let shown: string[] = [];
    if (files.size) {
      // Path relative to the WORKING DIRECTORY, not the office directory:
      // that's where the user is standing when they open a file explorer.
      // `artifacts/T-01/x.md` alone is technically correct but useless to
      // someone hunting for it the first time.
      const base = `${path.basename(this.loaded.companyDir)}/offices/${this.id}`;
      shown = [...files].sort().slice(0, MAX_LISTED_FILES);
      lines.push(t('off.resultsSavedAt'));
      lines.push(...shown.map((p) => `  ${base}/${p}`));
      if (files.size > shown.length) {
        lines.push(`  ${plural('off.andMoreFiles', files.size - shown.length)}`);
      }
      /**
       * A sentence explaining the `P-…/T-01/` prefix, ONLY when the user
       * declared the directory themselves.
       *
       * `artifacts/<plan>/<task>/` is four segments. Deeper than that means
       * `outputScoper` just kept part of a suffix the user wrote — i.e. they
       * DID have an intended location, and are now looking at their own path
       * wrapped in two extra unfamiliar layers. That's exactly when it needs
       * explaining, and also the ONLY time it's worth explaining: pasting
       * this sentence onto every case turns an explanation into noise.
       *
       * 0 tokens — built by code from the path already in hand.
       */
      if (shown.some((p) => p.split('/').length > 4)) {
        lines.push(t('off.perShiftFolder'));
      }
    }
    if (servers.size) {
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ TWO THINGS WRONG IN ONE LINE, both fixed 08/24.                       │
       * │                                                                      │
       * │ ① It printed the HASH (`a385afc3ab6`). The user named the arm in the  │
       * │   dialog and would never see that name again. The label already sits  │
       * │   at `company.arms[id].label` — we were holding it and not saying so. │
       * │                                                                      │
       * │ ② The old sentence *"Written out via: …"* CLAIMED MORE THAN WHAT WE    │
       * │   ACTUALLY CHECK. `landingOf` records a tool CALL, not its result —   │
       * │   and 10/14 tools on the filesystem arm are READ-ONLY. A real case,    │
       * │   measured: `P-260824-0355-r3qe` was denied all three times, not a     │
       * │   single byte was written, and the report still said *"Written out    │
       * │   via: a385afc3ab6"*.                                                 │
       * │                                                                      │
       * │ The new sentence states EXACTLY what's observed — *this arm was       │
       * │ used* — then boxes the remaining uncertainty into a separate           │
       * │ sentence. Same rule as `Bash`'s `kind: 'command'`: state what you       │
       * │ know, label what you don't, never merge the two into one assertion.    │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const named = [...servers].map((id) => this.loaded.company.arms[id]?.label || id).sort();
      lines.push(t('off.usedArms', { list: named.join(', ') }));
      lines.push(t('off.armResultsMayBeOutside'));
    }
    if (ranCommand) {
      lines.push(t('off.ranShellCommands'));
    }

    return {
      text: lines.length ? `\n\n${lines.join('\n')}` : '',
      /**
       * Returns `shown` — EXACTLY the paths printed as text, not all of `files`.
       *
       * A mismatch means the UI has a clickable entry with no matching line,
       * or a text line that isn't clickable while its neighbor is. Both are
       * a UI contradicting itself. One source, two shapes.
       */
      files: shown,
    };
  }

  private finish(
    record: PlanRecord,
    status: PlanStatus,
    report: string,
    usage: Usage,
    tasks: number,
    receipts: readonly Receipt[] = [],
    /** Paths outside the office that `outputScoper` pulled back into the frame. → `Plan.redirected` */
    redirected: readonly string[] = [],
    /** Promised outputs verified on disk. → `outputStatus`, and `whereBlock`'s second source */
    wrote: readonly string[] = [],
  ): void {
    /**
     * ⚠ THE REPORT MUST NOT CONTRADICT THE STEP STRIP RIGHT NEXT TO IT. → §B
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ The user caught this on 08/21, and what they pointed out was a         │
     * │ CONTRADICTION, not missing information:                                │
     * │                                                                        │
     * │   1. ○ Split the contract into individual clauses                       │
     * │   2. ✓ …            ← then the Assistant says "Contract 4 is done!"     │
     * │                                                                        │
     * │ The information WAS already on screen — the step strip was correct.     │
     * │ But two surfaces saying opposite things is worse than either one         │
     * │ being missing: the user doesn't know which to trust, and the wrong        │
     * │ one is the one written in human words, so it's easier to believe.        │
     * │                                                                        │
     * │ Same family as "nothing spent yet" (08/20) and "export to PDF for you"    │
     * │ (08/20): the model asserts something the data IN OUR OWN HANDS can        │
     * │ refute. Three times in two days ⇒ not bad luck, a failure class.          │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * Built by CODE from `record.steps`: 0 tokens, doesn't depend on the
     * model, and there's no way for it to "forget" the way a prompt
     * instruction can.
     *
     * Only appended when the run self-reports as DONE. A `stopped`/`failed`
     * run has already said so itself — one more line here would be nagging at
     * the exact moment the user is already frustrated.
     */
    const undone = record.steps.filter((s) => s.status !== 'done');
    if (status === 'done' && undone.length > 0 && report.trim()) {
      report +=
        `\n\n⚠ ${t('off.stepsUnfinishedHead', {
          n: String(undone.length),
          total: String(record.steps.length),
        })}: ` +
        undone.map((s) => `"${s.title}"`).join(', ') +
        `. ${t('off.stepsUnfinishedTail')}`;
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ THE USER ASKED FOR A LOCATION outside THE OFFICE — SAY SO, AND POINT   │
     * │ THE WAY.                                                              │
     * │                                                                        │
     * │ Case 08/24 (`P-260824-0401-q7ma`): they asked to copy a file into        │
     * │ `D:\Downloads\Programs Installation\`. `outputScoper` pulled the           │
     * │ destination back to `artifacts/` (as designed), the Assistant noticed     │
     * │ the mismatch and wrote on its own:                                       │
     * │                                                                        │
     * │   *"…I'll try writing to that exact location if needed."*                │
     * │                                                                        │
     * │ However many times it retries, it still lands in `artifacts/`:            │
     * │ `outputScoper` runs BEFORE the worker is even launched. That's an          │
     * │ invitation into a loop with no exit, and every lap costs money.           │
     * │                                                                        │
     * │ The line below is built by CODE from the exact string `outputScoper`      │
     * │ just rewrote — 0 tokens, the model can't "forget" it, and it states       │
     * │ a REAL PATH FORWARD instead of a promise: plugging in a connection         │
     * │ that points at that directory. That's §8·0's rule stated in plain          │
     * │ words — *every way out has to be a NAMED capability* — and since           │
     * │ 08/24 it actually works (SPEC-arms §5i, case B).                          │
     * │                                                                        │
     * │ ⚠ NOT appended for a `stopped` run: someone who just hit Stop doesn't      │
     * │ need a lecture about where to put files.                                 │
     * └────────────────────────────────────────────────────────────────────┘
     */
    if (redirected.length && status !== 'stopped' && report.trim()) {
      const shownPaths = [...new Set(redirected)].slice(0, 3);
      report +=
        `\n\n${t('off.pathsMentioned', { list: shownPaths.map((p) => `"${p}"`).join(', ') })}`;
    }

    const where = this.whereBlock(receipts, wrote);
    report += where.text;
    record.status = status;
    record.ended_at = new Date().toISOString();
    record.report = report;
    record.costUSD = usage.costUSD;
    record.turns = usage.turns;
    this.plans.upsert(record);

    this.emit({ type: 'cost.tick', totals: { ...usage, tasks } });
    /**
     * A plan just finishing is the ONE moment the usage-limit number actually
     * moves — check again right here, don't set a timer. Polling while
     * nothing is running just means opening a CLI process every minute to
     * hear the same answer.
     *
     * No `await`: the user is reading the report, not standing around
     * waiting on the header widget. `refreshEnergy` throttles itself to 60
     * seconds, so three short plans in a row still open only one process. →
     * `core/energy.ts`
     */
    void refreshEnergy().then(() => this.emitEnergy());
    // The report sentence fires EXACTLY ONCE, right here. `plan.finished` is
    // a structural event (status + money) for the UI to close the books,
    // carrying NO text — it used to, and the log showed two identical lines
    // right next to each other.
    //
    // An EMPTY `report` is valid and deliberate: a single `reply` task has
    // already emitted the worker's own answer, and that IS the report.
    // Emitting another empty bubble here would recreate the exact
    // awkwardness just removed.
    // `files` rides ALONGSIDE the message, it doesn't replace the text in
    // it: any display side that doesn't read this field (Telegram) still
    // sees the full path inside `say`.
    if (report.trim()) {
      this.emit({
        type: 'master.message',
        say: report,
        role: 'assistant',
        ...(where.files.length ? { files: where.files } : {}),
      });
    }
    this.emit({ type: 'plan.finished', status, costUSD: usage.costUSD, turns: usage.turns });

    this.currentPlan = undefined;
    this.currentRecord = undefined;
    this.activeScheduler = undefined;
    this.settled.clear();
    this.emitActivity();

    // Work the user handed over while busy: now it's its turn. Only
    // continues when this run was NOT stopped — the user hitting Stop stops
    // everything, including the queue.
    const next = this.deferred.shift();
    if (next && !this.stopRequested) {
      this.emitActivity();
      // HANDOFF: queued work is usually the continuation of what just
      // finished ("make it sound even younger"). Not telling it where the
      // previous output landed means it WRITES FROM SCRATCH instead of
      // EDITING — far more expensive, and it throws away work already paid
      // for.
      //
      // Built by code from the receipt already in hand: 0 tokens.
      const done = this.lastArtifacts;
      const request = done.length
        ? // ⚠ English, hard-coded: this is glued onto the request the ASSISTANT
          // reads, so it is prompt scaffolding, not chrome. The user's own words
          // sit right above it and still set the reply language.
          `${next.request}\n\n(The previous job just finished; its results are already at: ${done.join(', ')}. ` +
          `If this request is an edit to that, EDIT the existing files — do not redo it from scratch.)`
        : next.request;
      void this.run(request).catch(() => {
        /* run() has already emitted the error */
      });
    } else {
      this.emitActivity();
    }
    // If there's still queued work, let it run first — compacting between
    // two back-to-back jobs would cut exactly where the thread is continuous.
    if (!next) this.maybeCompact();

    // `setState` also emits an `office.state` carrying `say`. Putting the
    // report sentence in there too would be a third repeat — a state only
    // needs to say the STATE.
    // `blocked` returns to `idle` like any closed run, but must NOT say "Job
    // done." — no job ever ran, and the Assistant's question just appeared
    // right above it.
    this.setState(
      status === 'paused' || status === 'stopped' ? 'paused' : 'idle',
      status === 'paused'
        ? t('off.statePaused')
        : status === 'stopped'
          ? t('off.stateStopped')
          : status === 'blocked'
            ? t('off.stateWaitingOnYou')
            : t('off.stateDone'),
    );
  }

  // ── canvas

  canvas(): CanvasState {
    const { layout, missing } = this.layout.read();
    const notes = this.knowledge.notesByRole();
    const connected = new Set(layout.edges.filter((e) => e.from === ASSISTANT_NODE).map((e) => e.to));

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ ACCOUNT NAME FOR AN ARM NODE — reads the OAuth store **LAZILY, once**. │
     * │                                                                      │
     * │ ⚠ CORRECTED 08/27. `describeNode` used to say *"do NOT look up the    │
     * │ workspace name here … because an OAuth arm's default label already     │
     * │ includes the workspace name"*. That reasoning died the same day: the    │
     * │ label stopped folding the account in, because it froze on the first     │
     * │ account and lied after a second account switch. → `ArmDialog.tsx`      │
     * │                                                                      │
     * │ The old concern is still valid and still respected: `canvas()` runs     │
     * │ on every SSE event, so **one read per node** really would be              │
     * │ expensive. The approach here:                                          │
     * │  · lazy — an office with no OAuth arm at all ⇒ **touches no disk**;     │
     * │  · once for the whole diagram — same pattern as `Company.listArms`.     │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    let oauth: ReturnType<typeof readOAuth> | null = null;
    const viaOf = (server: string): string | undefined => {
      const names = this.loaded.company.arms[server]?.secrets ?? [];
      if (!names.length) return undefined;
      oauth ??= readOAuth(companyPaths(this.loaded.companyDir));
      // Absent ⇒ doesn't use OAuth, or the workspace has been disconnected.
      // Both count as "unknown" ⇒ draw nothing, rather than making up a name.
      // (same rule as §armWorkspace)
      return names.map((s) => oauth?.[s]?.label).find(Boolean);
    };
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ THE ONE THING THE DIAGRAM MARKS RED, and the boundary is the point.   │
     * │                                                                      │
     * │ It means exactly: **a service REFUSED a credential this arm runs on**,│
     * │ so a person has to sign in again. Nothing else qualifies:             │
     * │                                                                      │
     * │  · *expiring / expired* is NOT a fault — the refresh loop renews at   │
     * │    50% of the credential's life, and marking that red would light up  │
     * │    healthy arms several times a day. A warning that is usually wrong  │
     * │    teaches people to stop reading warnings, and then the real one     │
     * │    goes unread too. → the false `folderRoots` alarm, §15i             │
     * │  · *"is the arm actually working"* is NOT knowable here: it takes a   │
     * │    handshake per arm, seconds and tokens each, on a function that     │
     * │    runs on EVERY SSE event. Red for a guess is worse than no red.     │
     * │                                                                      │
     * │ So this reads a fact we wrote ourselves (`OAuthAccount.dead`), never  │
     * │ an inference. → [[agentco-deterministic-vs-signal]]                   │
     * │                                                                      │
     * │ ⚠ Shares the same lazy `oauth` read as `viaOf` — one read for the     │
     * │ whole diagram, and an office with no OAuth arm still touches no disk. │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const keyDeadOf = (server: string): string | undefined => {
      const names = this.loaded.company.arms[server]?.secrets ?? [];
      if (!names.length) return undefined;
      oauth ??= readOAuth(companyPaths(this.loaded.companyDir));
      const dead = names.find((s) => oauth?.[s]?.dead);
      return dead ? (oauth?.[dead]?.label ?? dead) : undefined;
    };

    return {
      nodes: layout.nodes.map((n) => ({
        ...this.describeNode(n, missing.has(n.id), connected.has(n.id), notes, viaOf, keyDeadOf),
        // The layout/grouping key — computed in ONE place (`layout.ts
        // §armGroup`) and sent along, so the "Rearrange" button on the
        // browser side sorts identically to the server. Recomputing it in
        // the UI would build a second copy of the same classification rule.
        ...this.layout.armGroup(n),
      })),
      edges: layout.edges,
      knowledge: { shared: this.knowledge.countShared(), total: this.knowledge.size },
    };
  }

  saveCanvas(input: { nodes?: unknown; edges?: unknown }): CanvasState {
    this.assertLive();
    const { touched } = this.layout.save(input);
    if (touched.length) this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: t('off.layoutUpdated'), plan_id: null });
    return this.canvas();
  }

  /**
   * FULLY REMOVES an arm from this office: strips `mcp:` from every role and
   * from the Assistant. Used when the arm gets deleted at the company level.
   *
   * ⚠ Has to run EVEN WHEN the server has already vanished from
   * `company.yaml` — otherwise a role still declaring `mcp: [x]` would keep
   * an orphan node on the diagram forever, and the user clicking "Remove"
   * again would just get *"no such arm x"*. That's exactly the case a user
   * reported 08/23: the delete button errors, the node doesn't disappear.
   *
   * Returns `true` if something actually changed — the caller uses this to
   * decide whether to emit an event.
   */
  dropArm(server: string): boolean {
    let touched = false;
    // Remove PRESENCE first: skip this step and the node stays on the
    // diagram even with no wire left — the exact ghost node that took an
    // extra round to catch.
    if (this.loaded.config.arms.includes(server)) {
      this.writeYamlList(
        this.loaded.paths.configFile,
        ['arms'],
        this.loaded.config.arms.filter((s) => s !== server),
      );
      touched = true;
    }
    for (const [roleId, role] of this.loaded.roles) {
      if (!role.mcp.includes(server)) continue;
      this.writeYamlList(
        path.join(this.loaded.paths.roles, `${roleId}.yaml`),
        ['mcp'],
        role.mcp.filter((s) => s !== server),
      );
      touched = true;
    }
    const forAssistant = this.loaded.config.assistant.mcp;
    if (forAssistant.includes(server)) {
      this.writeYamlList(
        this.loaded.paths.configFile,
        ['assistant', 'mcp'],
        forAssistant.filter((s) => s !== server),
      );
      touched = true;
    }
    if (touched) this.reload();
    return touched;
  }

  /** Writes a string array into yaml, preserving comments. Removes the key entirely when empty. */
  private writeYamlList(file: string, keyPath: string[], next: string[]): void {
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (next.length) doc.setIn(keyPath, doc.createNode(next));
    else doc.deleteIn(keyPath);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
  }

  /**
   * GRANTS an arm to which workers. → docs/SPEC-arms.md §6f step 3
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS STEP IS MANDATORY, NOT OPTIONAL — and that's why it has its own      │
   * │ dedicated code instead of leaving the UI to drag the wire on its own.     │
   * │                                                                          │
   * │ A node WITH NO WIRE is a DEAD NODE: it shows up on the diagram, looks      │
   * │ finished, and nobody can use it. A non-technical user just clicked "Save"  │
   * │ and saw a ✓ — they'll never guess there's one more wire left to drag.      │
   * │ That's exactly the "system lies about its own state" failure class          │
   * │ (§5i·1).                                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The `mcp→agent` edge is the SOURCE OF TRUTH for `role.mcp` —
   * `LayoutStore.save` writes it down to `roles/<id>.yaml`, not to
   * `layout.json`. So "drag a wire" and "grant permission to use it" are
   * **the same action**, not two.
   */
  grantArm(server: string, roleIds: string[]): CanvasState {
    this.assertLive();

    /**
     * WRITE PRESENCE FIRST, wire it up second — and this step runs EVEN WHEN
     * `roleIds` is empty. That's the whole point: plugging in an arm before
     * assigning it to anyone still has to make the node appear so there's
     * something to drag a wire from. → types.ts §OfficeConfig.arms
     */
    if (!this.loaded.config.arms.includes(server)) {
      this.writeYamlList(this.loaded.paths.configFile, ['arms'], [...this.loaded.config.arms, server]);
      this.reload();
    }

    const from = mcpNodeId(server);
    const cur = this.layout.read().layout.edges;
    const have = new Set(cur.map((e) => `${e.from} ${e.to}`));

    const add = roleIds
      .filter((r) => this.loaded.roles.has(r))
      .map((r) => ({ from, to: agentNodeId(r) }))
      .filter((e) => !have.has(`${e.from} ${e.to}`));

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 A CREDENTIAL HAS TO FOLLOW THE WIRE — this half WAS COMPLETELY     │
     * │ MISSING.                                                             │
     * │                                                                    │
     * │ `pickMcp` (worker.ts) builds its env from `role.secrets`, but until    │
     * │ 08/23 **nothing anywhere WROTE `role.secrets`** during the arm-plug-in  │
     * │ flow. Consequence: plugging in an arm that needs a credential got the   │
     * │ token correctly into `.state/secrets.json`, `role.mcp` correctly set,   │
     * │ yet the MCP process launched with NO ENVIRONMENT VARIABLE AT ALL —       │
     * │ breaking at real runtime, after the UI had already shown a ✓.           │
     * │                                                                    │
     * │ The shared ledger is where "what credential name does this arm need"     │
     * │ (§6i) gets answered, so wiring it up and granting the credential are      │
     * │ now ONE operation — exactly §7a's rule from SPEC-tools-approval:          │
     * │ *"wiring it is enough, the credential follows"*.                        │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const need = this.loaded.company.arms[server]?.secrets ?? [];
    if (need.length) {
      for (const r of roleIds) {
        const role = this.loaded.roles.get(r);
        if (!role) continue;
        const next = [...new Set([...role.secrets, ...need])].sort();
        if (next.length === role.secrets.length) continue;
        this.writeYamlList(path.join(this.loaded.paths.roles, `${r}.yaml`), ['secrets'], next);
      }
      this.reload();
    }

    // Nothing to add means DO NOT write and DO NOT emit an event: an empty
    // `layout.changed` makes every tab redraw the diagram just to get back
    // exactly what it already had.
    if (!add.length) return this.canvas();
    return this.saveCanvas({ edges: [...cur, ...add] });
  }

  /**
   * Adds a worker: writes roles/<id>.yaml then wires it up from the Assistant.
   *
   * The canvas generates NOTHING beyond layout.json — except right here,
   * where it writes to a human-readable yaml file instead of a separate blob
   * of JSON.
   */
  addAgent(input: { id?: string; display_name?: string; pitch?: string; tier?: string }): string {
    this.assertLive();
    const name = (input.display_name ?? '').trim();
    // `folderId` so a non-Latin worker name doesn't die at this gate. → paths.ts
    const id = input.id?.trim() ? slugId(input.id.trim()) : folderId(name || 'nhan-vien', 'nv');
    if (!isSafeId(id)) {
      throw new RunError(t('off.roleIdShape'), 'other');
    }
    if (id === 'assistant') {
      throw new RunError(t('off.roleIdReserved'), 'other');
    }
    if (this.loaded.roles.has(id)) {
      throw new RunError(t('off.roleExists', { id }), 'other');
    }

    const tier = input.tier === 'eco' || input.tier === 'deep' ? input.tier : 'standard';
    fs.mkdirSync(this.loaded.paths.roles, { recursive: true });
    fs.writeFileSync(
      path.join(this.loaded.paths.roles, `${id}.yaml`),
      roleTemplate(id, name || id, (input.pitch ?? '').trim(), tier),
      'utf8',
    );

    this.reload();
    // `placeAgent`, not `connectAssistant`: it WRITES the position to disk
    // even when the edge already exists. The old version returned early
    // there, so the coordinates just computed never got saved. → layout.ts
    // A NEW worker gets wired up right away: adding a person and then not
    // being able to assign them work is an action with no visible result.
    this.layout.placeAgent(id, true);
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: t('off.roleAdded', { name: name || id }), plan_id: null });
    return id;
  }

  /**
   * ARCHIVES a worker (soft delete). → docs/SPEC-offices.md §5.1
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY IT NEEDS A FLAG, AND CAN'T JUST BE "REMOVED FROM THE DIAGRAM"        │
   * │                                                                          │
   * │ The old version deleted the node from layout.json while keeping the       │
   * │ yaml file — sounds right, but `layout.read()` RECONSTRUCTS the node from   │
   * │ `office.roles` on the next read. The "removed" worker comes back onto the  │
   * │ canvas at a different grid cell, only missing its wire. I.e. "removed        │
   * │ from the diagram" never actually removed anything.                        │
   * │                                                                          │
   * │ The flag in the yaml is the ONLY source of truth: the canvas, the           │
   * │ roster, and the scheduler all read it. There is no path for an archived    │
   * │ worker to receive work.                                                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The file goes nowhere. Its lessons under `knowledge/agents/<id>/` stay
   * intact, its skills stay intact — restoring it returns to the exact same
   * spot, because it never actually left. (That promise is only TRUE because
   * `pruneStale` exempts an archived worker's notebook — see
   * `KnowledgeStore.pruneStale`.)
   *
   * ⚠ RESTORING DOES NOT REWIRE IT. The node returns to the diagram, but for
   * it to receive work the user has to drag a wire themselves. See
   * `LayoutStore.placeAgent`.
   */
  archiveAgent(roleId: string, archived: boolean): CanvasState {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError(t('off.roleIdInvalid'), 'other');
    const role = this.loaded.roles.get(roleId);
    if (!role) throw new RunError(t('off.noRole', { id: roleId }), 'other');

    const file = this.roleFile(roleId);
    if (!file) throw new RunError(t('off.roleFileMissing', { id: roleId }), 'other');

    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (archived) doc.set('archived', true);
    else doc.delete('archived');
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    if (archived) this.layout.dropAgent(roleId);
    this.reload();
    // `connect: false` — bringing it back does NOT mean it can receive work again.
    if (!archived) this.layout.placeAgent(roleId, false);
    this.refreshAssistantContext();

    const name = role.display_name || roleId;
    this.emit({
      type: 'layout.changed',
      // This sentence has to state what's LEFT to do. Without it, the user
      // sees the node appear, assumes it's ready, hands it work, and the
      // Assistant says there's nobody to do it.
      say: archived
        ? t('off.roleArchived', { name })
        : t('off.roleRestored', { name }),
      plan_id: null,
    });
    return this.canvas();
  }

  /**
   * PERMANENTLY DELETES a worker: loses the yaml file, loses its skills. Can't be undone.
   *
   * The lesson notebook at `knowledge/agents/<id>/` is DELIBERATELY kept:
   * it's something the office learned, not a name's private property.
   * Deleting a person and losing their lessons with them would be losing the
   * most valuable thing in the whole directory.
   */
  removeAgent(roleId: string): void {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError(t('off.roleIdInvalid'), 'other');
    if (!this.loaded.roles.has(roleId)) throw new RunError(t('off.noRole', { id: roleId }), 'other');

    this.layout.dropAgent(roleId);
    for (const ext of ['.yaml', '.yml']) {
      fs.rmSync(path.join(this.loaded.paths.roles, `${roleId}${ext}`), { force: true });
    }
    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: t('off.roleDeleted', { id: roleId }), plan_id: null });
  }

  /** Workers currently archived — so the UI can offer to restore them. */
  archivedAgents(): Array<{ role: string; label: string; avatar: string; pitch: string; notes: number }> {
    const notes = this.knowledge.notesByRole();
    return [...this.loaded.archivedRoles]
      .map((id) => this.loaded.roles.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        role: r.id,
        label: r.display_name || r.id,
        avatar: r.avatar,
        pitch: r.pitch,
        notes: notes[r.id] ?? 0,
      }));
  }

  /**
   * Edits a worker's profile. → docs/SPEC-tools-approval.md §1
   *
   * Writes with `parseDocument` to KEEP comments the user wrote in the yaml file.
   *
   * ⚠ Editing `pitch` bumps the ASSISTANT's cacheKey (the pitch sits in the
   * roster); editing `model_tier` bumps that worker's own cacheKey. That's
   * why the UI has an explicit Save button rather than autosave — same rule
   * as skills.
   */
  editAgent(
    roleId: string,
    patch: {
      display_name?: string;
      avatar?: string;
      pitch?: string;
      not_for?: string[];
      model_tier?: string;
      /** Cost cap for one task. **`0` = no limit.** → `RoleBudget.max_usd` */
      max_usd?: number;
      max_turns?: number;
      /**
       * Toggles `Bash` for this role. → docs/SPEC-tools-approval.md §5
       *
       * The ONLY capability switch in the whole system — every other tool is
       * on by default and can't be turned off (`BUILTIN_TOOLS`). It gets its
       * own switch because it's the only one that can reach outside the
       * office directory.
       */
      bash?: boolean;
    },
  ): CanvasState {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError(t('off.roleIdInvalid'), 'other');
    const role = this.loaded.roles.get(roleId);
    if (!role) throw new RunError(t('off.noRole', { id: roleId }), 'other');

    const pitch = patch.pitch?.trim();
    if (patch.pitch !== undefined && !pitch) {
      throw new RunError(t('off.pitchEmpty'), 'other');
    }
    if (patch.model_tier !== undefined && !TIERS.includes(patch.model_tier as never)) {
      throw new RunError(t('off.tierMustBe', { tiers: TIERS.join(', ') }), 'other');
    }

    const file = this.roleFile(roleId);
    if (!file) throw new RunError(t('off.roleFileMissing', { id: roleId }), 'other');

    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (patch.display_name !== undefined) doc.set('display_name', patch.display_name.trim());
    if (patch.avatar !== undefined) doc.set('avatar', patch.avatar.trim() || '•');
    if (pitch) doc.set('pitch', pitch);
    if (patch.not_for !== undefined) {
      const list = patch.not_for.map((s) => s.trim()).filter(Boolean);
      if (list.length) doc.set('not_for', list);
      else doc.delete('not_for');
    }
    if (patch.model_tier !== undefined) doc.set('model_tier', patch.model_tier);

    /**
     * The budget lives inside a nested map — `doc.set('budget', …)` would
     * REPLACE THE WHOLE BLOCK and swallow `knowledge_pack` along with any
     * comments the user wrote inside it. `setIn` edits exactly one key. Same
     * reason as `parseDocument` at the top of this function.
     */
    if (patch.max_usd !== undefined) {
      if (!Number.isFinite(patch.max_usd) || patch.max_usd < 0) {
        throw new RunError(t('off.budgetShape'), 'other');
      }
      doc.setIn(['budget', 'max_usd'], patch.max_usd);
    }
    if (patch.max_turns !== undefined) {
      if (!Number.isInteger(patch.max_turns) || patch.max_turns < 1) {
        throw new RunError(t('off.maxTurnsShape'), 'other');
      }
      doc.setIn(['budget', 'max_turns'], patch.max_turns);
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────────┐
     * │ `Bash` — A SWITCH, NOT A TOOL-LIST INPUT FIELD.                        │
     * │ → docs/SPEC-tools-approval.md §5                                        │
     * │                                                                         │
     * │ The spec settled "one single switch in the whole system" from the         │
     * │ start, but the only way to turn it on was still opening                   │
     * │ `roles/<id>.yaml` by hand — i.e. test 9 of TEST-WALKTHROUGH has a          │
     * │ 📝 **MANDATORY** step for a product built for non-technical people.        │
     * │ This is the line of code that finally pays off that promise.              │
     * │                                                                         │
     * │ KEEPS other tools in `tools:` if an advanced user already added their      │
     * │ own: this is a switch FOR ONE TOOL, not a button that overwrites the       │
     * │ whole list. Removes the key entirely when the list is empty, so the        │
     * │ file returns to the exact template shape.                                 │
     * │                                                                         │
     * │ No need to bump `version`: `cacheKey` hashes `toolKey` itself                │
     * │ (prompt.ts §buildWorkerPrompt), so the tool set changing changes the         │
     * │ key — impossible to forget.                                               │
     * └────────────────────────────────────────────────────────────────────────┘
     */
    if (patch.bash !== undefined) {
      // Filters out EVERY platform name, writes back exactly ONE canonical
      // name: a role file has to be portable between Windows and macOS. →
      // types.ts §SHELL_ALIASES
      const rest = role.tools.filter((t) => !EXTERNAL_TOOLS.has(t));
      /**
       * WRITES `tools: []` rather than DELETING the key. `doc.delete('tools')`
       * drags along the whole comment block sitting above it — yaml attaches
       * comments to the KEY, not to the file. Measured on
       * `nguoi-kiem-ke.yaml`: toggling the switch off once permanently loses
       * the explanation "Bash = allows running commands… the one exception to
       * rule §2.6", and turning it back on leaves just a bare line.
       *
       * `[]` also reads more correctly: it says "no additional tools", as
       * opposed to "nobody has ever thought about this".
       */
      doc.set('tools', patch.bash ? [...rest, SHELL_TOOL] : rest);
    }

    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: t('off.roleUpdated', { id: roleId }), plan_id: null });
    return this.canvas();
  }

  /**
   * Renames this office's display name. → docs/SPEC-offices.md §3
   *
   * Whether the `id` (folder name) changes along with it is `Company`'s
   * decision — see `Company.renameTarget`. This function only writes the name.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `silent` — DO NOT EMIT AN EVENT CARRYING AN ID THAT'S ABOUT TO DIE. (bug   │
   * │ reported by a user 08/22)                                                │
   * │                                                                          │
   * │ When a rename also moves the directory, `Company` calls this function       │
   * │ FIRST, then `fs.renameSync`. The `layout.changed` event emitted here          │
   * │ carries `office: <OLD id>` — and reaches the browser AFTER the directory      │
   * │ has already moved.                                                       │
   * │                                                                          │
   * │ The client sees that id still matches `state.officeId`, so it handles it     │
   * │ normally: calls `refreshCanvas()` → `GET /api/office/<old id>/canvas` →       │
   * │ **404** → toast *"No such office …"*. The user just renamed something         │
   * │ SUCCESSFULLY and the screen reports an error — exactly what they reported.    │
   * │                                                                          │
   * │ So while a move is about to happen, `Company` tells it to stay silent,        │
   * │ then emits **one** `company.offices` event itself carrying the NEW id.        │
   * │ One user action ⇒ one event, and that event points to the right place.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Writes with `parseDocument` to preserve comments in office.yaml.
   */
  rename(name: string, opts?: { silent?: boolean }): string {
    this.assertLive();
    const next = normalizeName(name);
    if (!next) throw new RunError(t('off.officeNameEmpty'), 'other');
    if (next.length > 60) throw new RunError(t('co.officeNameTooLong'), 'other');
    if (next === this.loaded.config.name) return next;

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    doc.set('name', next);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    if (opts?.silent) return next;
    // The office name sits in NOBODY's prompt — nothing to invalidate in the cache.
    this.emit({ type: 'layout.changed', say: t('off.officeRenamed', { name: next }), plan_id: null });
    return next;
  }

  /**
   * Changes this office's Assistant's model tier. → docs/SPEC-offices.md §4.5
   *
   * `undefined` = removes the override, falls back to the company's `models.master`.
   *
   * Does NOT touch the session: `resume` loads the conversation record from
   * disk, and that record is independent of the model. The Assistant still
   * remembers everything it has said. What's lost is the PROMPT CACHE — the
   * (model, prefix) pair changes so the next turn rewrites the cache once,
   * and because `resume` resends the whole conversation record, that turn
   * pays full price for it. Most expensive when the conversation is already
   * long; still a ONE-TIME cost, not a per-turn one.
   */
  setAssistantTier(tier: string | undefined): { tier: string; model: string } {
    this.assertLive();
    if (tier !== undefined && !TIERS.includes(tier as never)) {
      throw new RunError(t('off.tierMustBe', { tiers: TIERS.join(', ') }), 'other');
    }

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (!doc.has('assistant')) doc.set('assistant', {});
    if (tier === undefined) doc.deleteIn(['assistant', 'model_tier']);
    else doc.setIn(['assistant', 'model_tier'], tier);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    this.refreshAssistantContext();
    this.emit({
      type: 'layout.changed',
      say: t('off.assistantTierChanged', { tier: this.assistant.modelTier }),
      plan_id: null,
    });
    return { tier: this.assistant.modelTier, model: this.assistant.model };
  }

  /**
   * Renames this office's Assistant's display name. → docs/SPEC-offices.md §4.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ DOESN'T BREAK THE CACHE, AND THAT'S WHY THIS NAME CAN BE EDITED FREELY.    │
   * │                                                                          │
   * │ `display_name` **sits in nobody's prompt at all** — not in                  │
   * │ `ASSISTANT_CORE`, not in the roster (the roster only lists WORKERS). It      │
   * │ is only the label on the diagram and in the chat bubble. So changing it       │
   * │ is as cheap as renaming the office: no cache rewrite, no lost memory,         │
   * │ no touching the session.                                                  │
   * │                                                                          │
   * │ Complete opposite of `model_tier` right above: that one is half the           │
   * │ cache key (model, prefix), so it has to carry a warning. Two actions that     │
   * │ look identical in the UI but cost completely differently — the UI has         │
   * │ to say so.                                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Writes with `parseDocument` to preserve comments the user wrote in office.yaml.
   */
  renameAssistant(name: string): string {
    this.assertLive();
    const next = normalizeName(name);
    if (!next) throw new RunError(t('off.assistantNameEmpty'), 'other');
    if (next.length > 40) throw new RunError(t('off.assistantNameTooLong'), 'other');
    if (next === this.loaded.config.assistant.display_name) return next;

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (!doc.has('assistant')) doc.set('assistant', {});
    doc.setIn(['assistant', 'display_name'], next);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    // NO `refreshAssistantContext()`: the name isn't in the prompt, so
    // there's nothing to refresh. Calling it here anyway would just rebuild
    // the prefix for no reason.
    this.emit({ type: 'layout.changed', say: t('off.assistantRenamed', { name: next }), plan_id: null });
    return next;
  }

  /**
   * Receives new company config (model change, budget change…).
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ INVARIANT: NEVER MUTATE `this.loaded` IN PLACE.                          │
   * │                                                                          │
   * │ The scheduler of a currently running job holds a REFERENCE to the exact     │
   * │ `LoadedOffice` object it received at `run()` time. Building a NEW object       │
   * │ here means a running job keeps going with the old model and config until      │
   * │ it finishes — exactly what the user wants: changing the model must not         │
   * │ change the rules mid-hand. Whereas mutating in place                          │
   * │ (`this.loaded.company = next`) would run tasks of the same plan that            │
   * │ haven't launched yet on a different model than the tasks already launched,     │
   * │ and the bill would stop making sense.                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  applyCompanyConfig(next: CompanyConfig): void {
    this.loaded = loadOffice(this.loaded.companyDir, next, this.loaded.id);
    this.assistant.rebind(this.loaded);
    this.layout.rebind(this.loaded);
    this.plans.rebind(this.loaded.paths);
    this.knowledge.rebind(this.loaded.dir, this.loaded.paths);
    this.knowledge.scan();
    this.library.rebind(this.loaded.paths);
    this.artifacts.rebind(this.loaded.paths);
    // Renaming an office moves its directory ⇒ the audit log has to follow.
    // Forgetting this line means the log keeps writing into the old
    // directory, and the UI reads the new one and finds it empty.
    this.audit.rebind(this.loaded.paths.state);
    this.refreshAssistantContext();
  }

  private roleFile(roleId: string): string | undefined {
    for (const ext of ['.yaml', '.yml']) {
      const f = path.join(this.loaded.paths.roles, `${roleId}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return undefined;
  }

  /**
   * Writes an editable prompt layer. → docs/SPEC-tools-approval.md §4
   *
   * Three safety gates, and the third is the easiest to forget:
   *  1. Only the `editable` layer can be written — the core layer refuses outright.
   *  2. The path has to sit inside the office directory (`safeJoin`).
   *  3. The charter file is a KNOWLEDGE NODE, so it carries YAML frontmatter.
   *     We only show the body for the user to edit, so writing it back has to
   *     KEEP the existing frontmatter — overwriting the whole file would wipe
   *     out id/scope/pinned and the node would vanish from the store.
   */
  savePromptLayer(who: string, layerId: string, text: string): PromptLayer[] {
    this.assertLive();
    const layer = this.describePrompt(who).find((l) => l.id === layerId);
    if (!layer) throw new RunError(t('off.noLayer', { id: layerId }), 'other');
    if (!layer.editable || !layer.file) {
      throw new RunError(
        t('off.layerReadOnly'),
        'other',
      );
    }

    const limit = layer.limit;
    if (limit && estimateTokens(text) > limit) {
      throw new RunError(
        t('off.layerTooLong', { tokens: String(estimateTokens(text)), limit: String(limit) }),
        'other',
      );
    }

    const abs = safeJoin(this.loaded.dir, layer.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    if (layer.frontmatter) {
      const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const head = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(old)?.[0] ?? '';
      fs.writeFileSync(abs, `${head}\n${text.trim()}\n`, 'utf8');
    } else {
      fs.writeFileSync(abs, `${text.trim()}\n`, 'utf8');
    }

    this.reload();
    this.refreshAssistantContext();
    /**
     * ANSWERS THE QUESTION THE USER ACTUALLY HAS: *"did it take effect?"*
     *
     * The old sentence — *"Saved. The cache will rewrite once."* — described
     * an internal mechanism nobody asked about, and **stayed silent exactly
     * where they were unsure**: do I need to restart, who already knows, does
     * this affect a running job. A user asked those exact three questions on
     * 08/21, while the docs told them to `stop`/`start` — an unnecessary step
     * that never causes a visible symptom, so it survives for a very long
     * time.
     *
     * States three things, in the exact order people worry about them: effect · scope · cost.
     */
    this.emit({
      type: 'layout.changed',
      say:
        t('off.layerSaved'),
      plan_id: null,
    });
    return this.describePrompt(who);
  }

  /**
   * Edits / deletes a knowledge node. → docs/SPEC-2026-08-14-agentco.md §5
   *
   * A 1-to-1, IMMEDIATE effect: rescans the store, rebuilds the Assistant's
   * context, and every worker launched AFTER this point uses the new version
   * (they read `hot()` while building their prompt). A running worker keeps
   * its old version — same rule as changing the model: changing the rules
   * mid-hand means no hand reads it.
   *
   * The cost has to be stated: a knowledge node sits inside a cached prefix,
   * so every edit rewrites the cache for any role that has that node in its
   * HOT section.
   */
  editKnowledge(id: string, patch: { body?: string; remove?: boolean }): void {
    this.assertLive();
    const ok = patch.remove
      ? this.knowledge.removeNode(id)
      : this.knowledge.editNode(id, patch.body ?? '');
    if (!ok) throw new RunError(t('off.noNote', { id }), 'other');

    this.knowledge.scan();
    this.refreshAssistantContext();
    this.emit({
      type: 'knowledge.changed',
      count: this.knowledge.size,
      version: this.loaded.knowledgeVersion,
      plan_id: null,
    });
  }

  /** Layered prompt, made VIEWABLE BY A PERSON. → SPEC-offices.md §4.1 */
  describePrompt(who: string): PromptLayer[] {
    const hot =
      who === 'assistant'
        ? this.assistantHot()
        : this.knowledge.hot(
            who,
            this.loaded.roles.get(who)?.hot_knowledge_size ?? 8,
            this.loaded.company.budgets.hot_knowledge_tokens,
          ).text;
    // Conversation memory only exists for the Assistant — a worker has none, and must not have any.
    const memory = who === 'assistant' ? this.knowledge.assistantMemoryText() : '';
    // Both manifests only exist for the Assistant. The library: a worker
    // searches with `Grep`. Output: a worker receives paths via `inputs`, no
    // list needed — and that's the gate keeping its prefix from growing with
    // every past run.
    const library = who === 'assistant' ? this.library.manifest() : '';
    const artifacts = who === 'assistant' ? this.artifactManifest() : '';
    return describePrompt(this.loaded, who, hot, memory, library, artifacts);
  }

  /** Each role's current cacheKey — for diagnosing a broken prefix. */
  cacheKeys(): Array<{ role: string; key: string; staticTokens: number; model: string }> {
    return [...this.loaded.roles.values()].map((r) => {
      const model = this.loaded.company.models[r.model_tier];
      const built = buildWorkerPrompt(this.loaded, r, {
        hotKnowledge: this.knowledge.hot(
          r.id,
          r.hot_knowledge_size,
          this.loaded.company.budgets.hot_knowledge_tokens,
        ).text,
        model,
      });
      return { role: r.id, key: built.cacheKey, staticTokens: built.staticTokens, model };
    });
  }

  /**
   * COMPACTS THE ASSISTANT'S MEMORY into its own dedicated store, then starts
   * a fresh conversation. → docs/SPEC-offices.md §4.6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY COMPACT PROACTIVELY, INSTEAD OF LETTING THE CLI DO IT ON ITS OWN      │
   * │                                                                          │
   * │ The Claude Code CLI DOES have auto-compact (the SDK exposes             │
   * │ `PreCompact`/`PostCompact` hooks with `trigger: 'manual' | 'auto'`).       │
   * │ Meaning compaction WILL happen whether we want it to or not.               │
   * │                                                                          │
   * │ The risk isn't running out of memory — it's that automatic compaction IS  │
   * │ A LOSS, happening at a threshold we can't see, keeping what we didn't       │
   * │ choose, into a store we can't read. The Assistant will forget some          │
   * │ decision, at some point, and nobody will know.                            │
   * │                                                                          │
   * │ Proactive compaction: at a moment WE choose (the boundary right after a     │
   * │ job finishes), into a file the user can open and read, with `supersedes`    │
   * │ so the old version leaves the prompt without losing its trail.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Goes into `knowledge/agents/assistant/`, NOT the shared store: the
   * Assistant's conversation memory is something a worker writing content
   * has no need for and no use for.
   */
  async compactMemory(): Promise<{ saved: boolean; note: string }> {
    this.assertLive();
    // No conversation to compact yet — but STILL HAS TO CLEAN UP.
    //
    // The old version returned immediately here, so a user typing `/clear` a
    // second time (with an already-clean session) got nothing at all: a
    // superseded node stayed as-is, an old note stayed as-is. Exactly while
    // they were trying to clean up, the clean-up command went silent.
    if (!this.assistant.session) {
      const swept = this.finishClear();
      return {
        saved: false,
        note: swept ? `${t('off.nothingNewToRemember')}${swept}` : t('off.nothingToRemember'),
      };
    }

    let saved = false;
    /**
     * Captured BEFORE the turn, not after: a job that finishes while the
     * compaction is in flight was not in the listing the model just read, so
     * marking it as covered would lose it.
     */
    const upTo = new Date().toISOString();
    try {
      const result = await this.mailbox.lock(() => this.assistant.compact(this.factSkeleton()));
      this.logAssistantUsage('report', result.usage);
      const body = result.value;
      // "NOTHING" is a valid answer and deserves respect: forcing an empty node
      // into the store poisons this office's own HOT prefix on every later turn.
      //
      // ⚠ The sentinel is ENGLISH in every locale — it is a protocol token the
      // prompt asks for verbatim (`Assistant.COMPACT_RULES`), not prose. Making
      // it follow the switch would break this branch the day someone flips it.
      if (body && !/^NOTHING\.?$/i.test(body)) {
        this.knowledge.addAssistantMemory(
          t('off.memoryUpTo', { date: new Date().toISOString().slice(0, 10) }),
          body,
          this.knowledge.assistantMemoryIds(),
        );
        saved = true;
      }
    } catch (err) {
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ BUG FIXED (08/20): `/clear` GETTING STUCK FOREVER, no way out.        │
       * │                                                                      │
       * │ The old version merged EVERY compaction error into one "keep the        │
       * │ conversation as-is" branch. The right instinct for a TEMPORARY error       │
       * │ (network, out of usage) — but completely wrong for a PERMANENT one.       │
       * │                                                                      │
       * │ Compaction runs `resume: <session_id>`, and that conversation record      │
       * │ lives under `~/.claude/projects/` — A DIRECTORY AGENTCO DOES NOT OWN.     │
       * │ A user cleaning it up, renaming the company directory, or moving to a     │
       * │ different machine makes the record vanish. From that moment on, every     │
       * │ `/clear` throws the same error, and the chat pane can NEVER be cleared     │
       * │ again. The product's only clean-up command dies permanently, while the     │
       * │ error message says "keeping the conversation as-is" as if that were a      │
       * │ choice.                                                                │
       * │                                                                      │
       * │ Losing the memory is ALREADY DONE at this point — once the record is       │
       * │ gone, nobody can compact it anymore. Keeping an uncleanable chat pane       │
       * │ around is just a second loss on top of the first. So: clean up, and       │
       * │ STATE HONESTLY what was lost.                                         │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      if (!sessionGone(err)) {
        // A TEMPORARY error — better to keep a long record than lose it entirely. Retry later.
        return {
          saved: false,
          note:
            t('off.compactFailed', {
              reason: err instanceof Error ? err.message : t('off.anError'),
            }),
        };
      }
      const swept = this.finishClear();
      return {
        saved: false,
        note:
          `${t('off.transcriptGone')}${swept}`,
      };
    }

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ THE MARKER MOVES ON **SUCCESS**, NOT ON "A NODE WAS WRITTEN".        │
     * │                                                                      │
     * │ My first draft tied it to `saved`, which folds `NOTHING` in with a    │
     * │ crash. The user caught what that costs: `NOTHING` repeated would      │
     * │ never advance the marker, so the window would grow without bound and  │
     * │ every later compaction would re-read a longer and longer log.        │
     * │                                                                      │
     * │ The two cases are not alike:                                         │
     * │  · a THROW — the turn never happened, nobody summarised anything, so  │
     * │    the window must stay open. Both `catch` branches return above      │
     * │    without touching the marker, including `sessionGone`: the          │
     * │    transcript is lost, but those jobs are still on disk and the NEXT  │
     * │    compaction can still record them from the facts.                  │
     * │  · `NOTHING` — the turn ran and gave its answer: *this stretch of     │
     * │    work taught nothing worth keeping*. The code already respects that │
     * │    answer by writing no node; respecting it means consuming the       │
     * │    window too, or we are just asking the same question again forever. │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    this.compactedThrough = upTo;
    // `finishClear` persists it — see the note there on why the write lives
    // inside that function and not on this line.
    const tail = this.finishClear();
    return {
      saved,
      note:
        (saved
          ? t('off.clearedWithNotebook')
          : t('off.cleared')) + tail,
    };
  }

  /**
   * The REAL clean-up: forgets the session, deletes the pointer, deletes the
   * chat log, sweeps the store, notifies the UI.
   *
   * Merged into one place because `compactMemory` has THREE paths leading
   * here — nothing to compact yet, compaction finished, and the conversation
   * record has vanished. The old version hand-wrote each path, so the
   * "nothing to compact yet" path was missing `knowledge.changed`:
   * `pruneNow()` could have just deleted a few nodes while the Knowledge pane
   * kept showing the old count until the next time it was reopened.
   *
   * Returns `pruneNow()`'s trailing sentence for the caller to append to its report.
   */
  private finishClear(): string {
    const tail = this.pruneNow();
    this.assistant.forget();
    fs.rmSync(this.sessionFile(), { force: true });
    /**
     * ⚠ REWRITES the compaction marker the file just took with it.
     *
     * The whole file is removed to drop the session pointer, but the marker is
     * NOT part of the conversation — it records how far the WORK LOG has been
     * squashed, which `/clear` does not undo. Sits here rather than at the one
     * call site that moves it, because all three callers delete this file and
     * only one of them was thinking about the marker; a second `/clear` would
     * otherwise wipe it and hand the next compaction the entire log again —
     * the exact bug this marker exists to close.
     */
    this.saveSessionId();
    this.clearChatLog();
    // Fires BEFORE the result sentence: this is the "erase what's currently
    // shown" command, so the sentence that follows it becomes the first
    // sentence of the new conversation.
    this.emit({ type: 'office.cleared', say: t('off.cleared'), plan_id: null });
    this.knowledge.scan();
    this.refreshAssistantContext();
    this.emit({
      type: 'knowledge.changed',
      count: this.knowledge.size,
      version: this.loaded.knowledgeVersion,
      plan_id: null,
    });
    return tail;
  }

  /**
   * Auto-compacts when context goes over the cap. → docs/SPEC-token-economy.md §4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHERE IT'S CHECKED AND WHY — two separate decisions:                     │
   * │                                                                          │
   * │ The THRESHOLD is `budgets.master_compact_at` (default 60,000), measured    │
   * │ against `assistant.contextTokens` — i.e. the REAL `cache_read` of the       │
   * │ most recent turn, not a hand-rolled estimate. The window is 200K, so 60K    │
   * │ still leaves plenty of room: the goal is to block BEFORE the CLI's own      │
   * │ auto-compact, not to race it. And because `cost ≈ turns × prefix × 0.1`,     │
   * │ a smaller context is cheaper on EVERY turn, not just the compacting one.     │
   * │                                                                          │
   * │ The TIMING is the boundary right after a job finishes — not "the instant    │
   * │ the threshold is crossed, compact immediately". Compacting mid-question       │
   * │ would cut exactly where the thread is continuous, and the summary would      │
   * │ come out far worse. A finished job is a natural seam.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ A WORKER's tokens don't count toward this. A worker runs with
   * `persistSession: false` in its own query, and so does the planning step —
   * only `route()` (every message) and `report()` (every run) grow this record.
   */
  private maybeCompact(): void {
    const limit = this.loaded.company.budgets.master_compact_at;
    if (this.assistant.contextTokens < limit) return;
    // Same pattern as `/clear`: a temporary status sentence, NOT a message.
    // Auto-compaction needs this even more than `/clear` does — the user
    // never typed a command at all, so a chat bubble sprouting on its own is
    // something they can't explain.
    void this.compactMemory()
      .then((r) => this.emitNote(t('off.autoCompacted', { note: r.note }), 6_000))
      .catch(() => {
        /* If compaction fails, leave things as they are — `compactMemory` doesn't forget on error. */
      });
  }

  /**
   * The FACT skeleton, built by code from `tasks/index.json`. 0 tokens.
   *
   * Fed in so the model does NOT have to recall it — and so it can't recall
   * it wrong. Which jobs ran, where the output is, what it cost are all data
   * already in hand; the only thing only the model knows is what the user
   * has said that lives in no record at all.
   */
  private factSkeleton(): string {
    return workSkeleton(this.plans.list(), this.compactedThrough);
  }

  /**
   * Sweeps the store right now, returns a trailing sentence to append to the
   * report (empty if nothing was dropped).
   *
   * `/clear` is the ONE moment the user actively says "clean up", so all the
   * cleaning is merged into that exact beat — rather than scattered across a
   * set of background timers nobody can see or check.
   */
  private pruneNow(): string {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ BUG FIXED: a superseded node stayed behind, even though it was "fixed  │
     * │ last time".                                                           │
     * │                                                                      │
     * │ TWO INDEPENDENT CAUSES — and that's exactly why the previous fix only   │
     * │ killed half of it, and everyone assumed it was done:                    │
     * │                                                                      │
     * │  1. SCANNED TOO LATE. `addAssistantMemory` WRITES the new file          │
     * │     (carrying `supersedes`) but does NOT `scan()`. The `superseded`      │
     * │     set only gets rebuilt during a scan, so right after that,             │
     * │     `pruneStale` is still holding the OLD set — the version that just     │
     * │     got superseded isn't in it. It only dies on the NEXT `/clear`, i.e.    │
     * │     the user always sees exactly one leftover node, forever.              │
     * │                                                                      │
     * │  2. BLOCKED AT THE WRONG GATE. `prune_after_days <= 0` is a valid         │
     * │     choice ("don't auto-delete my notes by age"), but it `return`ed        │
     * │     early and dragged the superseded-node cleanup down with it. But        │
     * │     deleting a superseded node is NOT aging out — it's "this version       │
     * │     has been replaced", which has nothing to do with dates, right or       │
     * │     wrong. Two different things must not share one gate.                  │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * Scans FIRST: everything below reads `superseded`, and that set is only
     * correct after disk has been reread. This is the step the old version
     * was missing.
     */
    this.knowledge.scan();

    // A superseded node: delete it IMMEDIATELY, no gate through `prune_after_days`.
    const replaced = this.knowledge.dropSuperseded();

    const days = this.loaded.company.librarian.prune_after_days;
    // An archived person's notebook is exempt — see `pruneStale`.
    const aged = days > 0 ? this.knowledge.pruneStale(days, this.loaded.archivedRoles) : [];

    if (replaced.length === 0 && aged.length === 0) return '';
    this.knowledge.scan();

    // States the two kinds SEPARATELY: "an old version got replaced" is
    // normal and reassuring; "an old note got swept away" is a real loss.
    // Merging them into one sentence leaves the user not knowing what they
    // just lost.
    const parts: string[] = [];
    if (replaced.length) parts.push(plural('off.sweptReplaced', replaced.length));
    if (aged.length) parts.push(plural('off.sweptAged', aged.length));
    return ` ${t('off.sweptAlso', { what: parts.join(t('off.sweptAnd')) })}`;
  }

  private clearChatLog(): void {
    fs.rmSync(path.join(this.loaded.paths.state, 'chat.jsonl'), { force: true });
  }

  /** Reloads from disk. Keeps the Assistant's session intact — reloading config isn't forgetting the conversation. */
  reload(): void {
    this.applyCompanyConfig(this.loaded.company);
  }

  // `readArtifact` was REMOVED (08/19). It read any file at all inside the
  // office — `roles/*.yaml`, `charter.md`, `office.yaml` — just because its
  // name sounded like it only read artifacts; and it always called
  // `readFileSync(…, 'utf8')`, so it corrupted every binary file. Replaced by
  // `ArtifactStore`, locked to `artifacts/` and streamed.
  // → src/core/artifacts.ts

  /**
   * An artifact written by a task that got INTERRUPTED MID-RUN. →
   * SPEC-artifacts.md §2.7
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE MOST DANGEROUS FAILURE FOUND SO FAR — measured 08/21.                │
   * │                                                                          │
   * │ A user hit Stop right as `Người đọc` was splitting a contract into            │ // i18n-allow-vietnamese: the real role's actual display name from the recorded incident
   * │ clauses. The contract had **5** clauses; it had managed to write **3**.      │
   * │ The receipt recorded it correctly: `status: 'blocked'`, *"Stopped mid-run.    │
   * │ 4 files were left partially written, review before use."*                    │
   * │                                                                          │
   * │ Then a later run read that directory, saw 3 files, and reported:             │
   * │   *"Reviewed ALL 3 clauses, all three are unfavorable…"* → a 16-point         │
   * │   checklist                                                             │
   * │                                                                          │
   * │ 🔥 The user got a contract review that **looks complete, missing 40%**       │
   * │ and not one line stating it was incomplete. This is exactly *"wrong with     │
   * │ nobody knowing"* — the worst outcome of all.                                 │
   * │                                                                          │
   * │ ⚠ A RUN-level `UNFINISHED` label can't rescue this: it says *"the run          │
   * │ isn't finished"*, not *"THIS file is incomplete"*. And `isStale` can't          │
   * │ either: the source hasn't changed, the file is still fresh — it's just         │
   * │ CUT SHORT. It needs to be a third label entirely.                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Observed, not guessed: each task's receipt sits on disk and carries both
   * `status` and `landed` — i.e. *"who got interrupted"* and *"which files did
   * it manage to write"*. All that's needed is joining two things already in
   * hand.
   *
   * ⚠ The label says **"redo that step"**, not "be careful with this". With a
   * cut-short file, no amount of care rescues it: the missing part is NOT in
   * the file, so no amount of careful reading will find it.
   */
  private partialIn(planId: string): Set<string> {
    const out = new Set<string>();
    let names: string[];
    try {
      names = fs.readdirSync(this.loaded.paths.tasks);
    } catch {
      return out;
    }
    const prefix = `${planId}.`;
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.receipt.json')) continue;
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(this.loaded.paths.tasks, name), 'utf8'),
        ) as Receipt;
        // ONLY a task that got cut off mid-run. A `done` task wrote exactly
        // what it meant to write; a task that never ran has no file to label.
        if (r.status === 'done') continue;
        for (const l of r.landed ?? []) {
          if (l.kind === 'file' && l.ref) out.add(l.ref);
        }
      } catch {
        /* corrupted receipt — don't guess, see `staleIn` */
      }
    }
    return out;
  }

  /**
   * Which artifacts have gone STALE: their source changed after they were
   * written. → `isStale`
   *
   * The "this file was generated from that file" relationship is NOT a
   * guess — `plan.json` records exactly what each task read (`inputs`) and
   * wrote (`outputs`). All that's needed is comparing `mtime` on both ends.
   *
   * Only runs for jobs NOT YET DONE, and only the ≤ `MANIFEST_PLANS` jobs
   * shown, so it reads at most a few small JSON files each time the prefix is
   * built. A finished job doesn't need this: with a complete result, "going
   * stale" is a concern for the next run, not a factor in deciding whether to
   * reuse an unfinished batch.
   */
  private staleIn(
    planId: string,
    paths: readonly string[],
    mtimes: ReadonlyMap<string, string>,
  ): Set<string> {
    const out = new Set<string>();
    let plan: Plan | undefined;
    try {
      const file = path.join(this.loaded.paths.tasks, `${planId}.plan.json`);
      if (!fs.existsSync(file)) return out;
      plan = JSON.parse(fs.readFileSync(file, 'utf8')) as Plan;
    } catch {
      // Failing to read the plan means DO NOT guess that it's stale. A wrong
      // warning label is worse than no label: the user learns to ignore it.
      return out;
    }

    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    const armDirs = armDirIndex(this.loaded.company.arms, this.loaded.company.mcpServers);
    for (const t of plan.tasks ?? []) {
      // An input's `mtime` read STRAIGHT from disk: the source is usually a
      // library document, and the library isn't part of the output manifest.
      const srcTimes: string[] = [];
      for (const i of t.inputs ?? []) {
        // `resolveInput`, not `safeJoin`: an input can be an ABSOLUTE path
        // outside the office, or **an arm's name** (`Musics`). Using safeJoin
        // would silently drop the "is it stale" check for any output built
        // from an outside source — the THIRD spot for the same rule. → paths.ts
        const abs = resolveInput(this.loaded.dir, i.path, armDirs);
        if (!abs) continue;
        try {
          srcTimes.push(fs.statSync(abs).mtime.toISOString());
        } catch {
          /* the source has vanished — draws no conclusion, `missingInputs` handles that case */
        }
      }
      if (srcTimes.length === 0) continue;

      const owned = new Set((t.outputs ?? []).map((o) => norm(o.path)));
      for (const p of paths) {
        const made = mtimes.get(p);
        // `outputs` can be a DIRECTORY (the "one file per clause" case), so
        // it checks both exact match and prefix — same rule as `contains` in
        // the scheduler.
        const mine = owned.has(norm(p)) || [...owned].some((o) => norm(p).startsWith(`${o}/`));
        if (mine && made && isStale(made, srcTimes)) out.add(p);
      }
    }
    return out;
  }

  /**
   * Unfinished work from an INTERRUPTED run. → SPEC-offices.md §6b
   *
   * Also accepts the old shape (a bare array, no `plan_id`) so a single
   * upgrade doesn't lose a user's pending work — but that job can't be
   * resumed, and `resumable()` states so outright instead of silently
   * skipping it.
   */
  readPending(): { plan_id: string; tasks: TaskBrief[] } {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (!fs.existsSync(file)) return { plan_id: '', tasks: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(raw)) return { plan_id: '', tasks: raw as TaskBrief[] };
      const o = raw as { plan_id?: string; tasks?: TaskBrief[] };
      return { plan_id: o.plan_id ?? '', tasks: o.tasks ?? [] };
    } catch {
      return { plan_id: '', tasks: [] };
    }
  }

  /**
   * Whether an interrupted run can be resumed — and if so, how much work is left.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS IS THE ONE `resume` CASE THAT REQUIRES NO GUESSING AT ALL (user       │
   * │ settled this 08/20 evening).                                             │
   * │                                                                          │
   * │ This run was **never replanned**: `/stop`, ran out of usage, a daemon        │
   * │ crash. It's still the exact same `plan_id`, the exact same task list, the    │
   * │ receipt sits on disk. Nothing to match, so nothing to match wrong.            │
   * │                                                                          │
   * │ Completely different from *"the user typed a similar-sounding request       │
   * │ again"* — for that case we DELIBERATELY don't auto-match, only state the      │
   * │ unfinished batch through the manifest and let the planner decide.            │
   * │ → `artifacts.ts` `isStale`                                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  resumable(): { plan_id: string; left: number; request: string } | undefined {
    const { plan_id, tasks } = this.readPending();
    if (tasks.length === 0) return undefined;
    // The old shape carries no `plan_id` ⇒ no way to know where to write the output.
    if (!plan_id) return undefined;
    if (!fs.existsSync(path.join(this.loaded.paths.tasks, `${plan_id}.plan.json`))) return undefined;
    const rec = this.plans.list().find((p) => p.plan_id === plan_id);
    return { plan_id, left: tasks.length, request: rec?.request ?? '' };
  }

  /**
   * A line inviting the user to resume, emitted when the office connects to
   * the bus. 0 tokens.
   *
   * Unfinished work is OFFERED, NOT auto-run — three reasons:
   *
   *  1. Auto-running on daemon start = one silent crash quietly spending the
   *     user's money. Same rule already settled for the Assistant's memory:
   *     don't attach meaning to the daemon stopping/starting, that's
   *     infrastructure work (an update, a crash, a reboot).
   *  2. Unfinished work usually comes from `/stop` — i.e. the user just SAID
   *     stop. Auto-resuming would overwrite a decision they just made.
   *  3. A chat line for them to respond to is a CONVERSATION, not state
   *     management — exactly what they want when they say *"be smart on your
   *     own, not a button to click"*.
   *
   * The sentence has to state all three things the user needs to decide:
   * **how much work is left**, **from which run**, and **what resuming
   * costs** — because the real worry at that moment is "will clicking this
   * cost more money". The answer is *no additional planning turn at all*,
   * and stating that turns it into an easy decision.
   */
  private offerResume(): void {
    const ready = this.resumable();
    if (!ready) return;
    this.emit({
      type: 'master.message',
      role: 'assistant',
      say:
        t('off.leftoversOnBoot', {
          n: String(ready.left),
          of: ready.request ? ` — "${ready.request}"` : '',
        }),
      plan_id: null,
    });
  }

  /**
   * Resumes unfinished work — REUSES the exact `plan_id`, only runs the tasks
   * that never ran.
   *
   * ⚠ NEVER auto-runs on daemon startup. Same reason already settled for the
   * Assistant's memory: attaching meaning to the daemon stopping/starting
   * means one silent crash quietly spending the user's money. It's OFFERED
   * in the chat pane, and the user says "yes" — that's a conversation, not
   * state management.
   */
  async resume(): Promise<{ plan_id: string; report: string; usage: Usage }> {
    const ready = this.resumable();
    if (!ready) throw new RunError(t('off.nothingToResume'), 'other');

    const file = path.join(this.loaded.paths.tasks, `${ready.plan_id}.plan.json`);
    const full = JSON.parse(fs.readFileSync(file, 'utf8')) as Plan;
    const queued = new Set(this.readPending().tasks.map((t) => t.task_id));

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ "NOT IN `pending`" ≠ "DONE". The old version assumed that, and it blew up. │
     * │                                                                      │
     * │ `pending` is *tasks that NEVER RAN AT ALL* (what the scheduler returns  │
     * │ when interrupted). A task absent from it could be: finished ✓ · broke ✗   │
     * │ · got blocked ✗ · **got cut off while it was mid-write ✗**. The old        │
     * │ version stripped `deps` pointing at every absent task outright, i.e. it     │
     * │ treated all four cases as the first one.                                  │
     * │                                                                      │
     * │ Measured 08/21, twice in a row (hd3, hd4): a user hit Stop while           │
     * │ `Người đọc` was splitting a contract (4/5 clauses done), then typed          │ // i18n-allow-vietnamese: the real role's actual display name from the recorded incident
     * │ `/resume`. T-01 was absent from `pending` because it HAD run — and           │
     * │ returned `blocked`. The `T-02 → T-01` wire got cut, `missingInputs` saw       │
     * │ the directory had 4 files and let it through, and the whole chain after       │
     * │ that ran on a contract missing 20% of its content.                        │
     * │                                                                      │
     * │ ⚠ `delivered()` exists PRECISELY to answer this question, and the old       │
     * │ version routed around it by filtering on a LIST instead of asking the       │
     * │ RECEIPT.                                                              │
     * │ → the 08/20 rule "a correct decision + a wrong premise = a time bomb"        │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * The correct rule: a task gets skipped **only when its own receipt says
     * it delivered output**. Otherwise it RERUNS — even if it already ran
     * once and left behind a partial file. Rerunning overwrites into its
     * exact own directory (`artifacts/<plan>/<task>/`), so it produces no
     * orphan fragments.
     */
    const redo = (id: string): boolean => queued.has(id) || !delivered(this.receiptOf(ready.plan_id, id));
    const run = new Set(full.tasks.filter((t) => redo(t.task_id)).map((t) => t.task_id));

    const plan: Plan = {
      ...full,
      tasks: full.tasks
        .filter((t) => run.has(t.task_id))
        // Only cuts a wire to a task that REALLY did deliver output — leaving
        // it in place would have `validate` report "dependency doesn't
        // exist" for a task that isn't in the trimmed plan, blocking the
        // exact run we're trying to rescue.
        .map((t) => ({ ...t, deps: t.deps.filter((d) => run.has(d)) })),
    };
    return this.run(plan.request, undefined, plan);
  }

  /** A task's receipt, or `undefined` if it never ran. */
  private receiptOf(planId: string, taskId: string): Receipt | undefined {
    try {
      const f = path.join(this.loaded.paths.tasks, `${planId}.${taskId}.receipt.json`);
      return JSON.parse(fs.readFileSync(f, 'utf8')) as Receipt;
    } catch {
      return undefined;
    }
  }

  // ── internal

  /**
   * Syncs the two things the Assistant needs to know: who's on duty, and
   * what's in the knowledge store.
   *
   * Both sit in the cached prefix, so this function is EXPENSIVE — call it
   * when the shape or the knowledge changes, not on every chat turn.
   */
  /**
   * A MANIFEST JUST CHANGED — reload the Assistant's prefix. → SPEC-library
   * §8b · SPEC-artifacts §2.4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG FIXED (08/20): TWO OF FOUR DOORS NEVER RELOADED.                     │
   * │                                                                          │
   * │   add a document    → `library.add()` straight from the server   ❌ did NOT reload │
   * │   delete a document → `Office.removeDocument()`                   ✅              │
   * │   produce output    → end of `Office.run()`                       ✅              │
   * │   delete output     → `artifacts.remove()` straight from the server ❌ did NOT reload │
   * │                                                                          │
   * │ The first door's consequence is the worst case: the user **just uploaded    │
   * │ a document and immediately asks about it** — the most natural action in       │
   * │ the whole product — and the Assistant says it can't find a file by that       │
   * │ name. The fourth door is the opposite: it names an output the user just       │
   * │ deleted.                                                                  │
   * │                                                                          │
   * │ The root cause is the "write/read must share one function" rule broken       │
   * │ at the HTTP layer: two routes call the store directly, two routes go          │
   * │ through `Office`. Whichever door takes a shortcut is the one that            │
   * │ forgets. So the fix isn't "add two calls" but **closing the shortcut**:       │
   * │ every operation that changes either store goes through `Office`.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  addDocument(name: string, data: Buffer, opts: { replace: boolean; maxBytes: number }): DocRecord {
    this.assertLive();
    const doc = this.library.add(name, data, opts);
    this.refreshAssistantContext();
    return doc;
  }

  /** Deletes an OUTPUT file. Routed through here so the Assistant's manifest doesn't name a file that's gone. */
  removeArtifact(rel: string): boolean {
    this.assertLive();
    if (!this.artifacts.remove(rel)) return false;
    this.refreshAssistantContext();
    return true;
  }

  /**
   * CLEARS the entire Output pane. Returns the number of files deleted.
   *
   * ⚠ `refreshAssistantContext()` here is NOT a formality — the Output
   * manifest sits in the Assistant's prefix. Skip it and the Assistant keeps
   * confidently naming dozens of files that were just deleted, and the user
   * clicks each one only to get "not found". Exactly the shortcut §3116
   * already closed once.
   */
  clearArtifacts(): number {
    this.assertLive();
    const n = this.artifacts.removeAll();
    if (n) this.refreshAssistantContext();
    return n;
  }

  private refreshAssistantContext(): void {
    this.assistant.setAssignable(this.layout.assignable());
    this.assistant.setHotKnowledge(this.assistantHot());
    this.assistant.setMemory(this.knowledge.assistantMemoryText());
    this.assistant.setLibrary(this.library.manifest());
    this.assistant.setArtifacts(this.artifactManifest());
  }

  /**
   * OUTPUT MANIFEST for the Assistant — file names, NOT content. →
   * docs/SPEC-artifacts.md §2.4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THE "ARTIFACTS ARE INVISIBLE" RULE GOT BROKEN (08/20) — and how far.     │
   * │                                                                          │
   * │ The old rule (§1) guarded the RIGHT risk: don't turn the Output pane into    │
   * │ a second store the user has to manage, and don't let old output leak into     │
   * │ a new job's context. But it picked the CRUDEST guard — total invisibility     │
   * │ — and the cost was blocking the single most natural action in the whole      │
   * │ product: "keep working on what I just finished".                            │
   * │                                                                          │
   * │ FAILURE MEASURED 08/20. The user: *"doc-2, doc-3 are missing the             │
   * │ terminology file"*. Four rounds back and forth, one planning turn died          │
   * │ because the planner asked *"where is the Vietnamese translation                │
   * │ located?"* — it had NO WAY to know. Then once it did run, the plan took         │
   * │ `inputs = library/files/doc-2.md` (the ENGLISH original), so the translator     │
   * │ **had never even seen the translation** yet still wrote out a table of          │
   * │ "terms and how they WERE translated".                                       │
   * │                                                                          │
   * │ 🔥 Result: the table recorded `Widget → "Tiện ích (widget)"`, while the       │ // i18n-allow-vietnamese: the fabricated string as it literally appeared in the incident
   * │ real translation used `Widget` verbatim and NEVER contained the word            │
   * │ "Tiện ích" at all. A document recording choices that WERE NEVER ACTUALLY        │ // i18n-allow-vietnamese: same fabricated string, quoted again
   * │ MADE — looking very professional, and wrong. Exactly the "wrong with            │
   * │ nobody knowing" failure class.                                             │
   * │                                                                          │
   * │ What was MISSING wasn't READ PERMISSION: a worker already has                  │
   * │ `Read`/`Grep` with `cwd` set to the office directory, and only needed           │
   * │ `inputs` to name the file to read it that very day. Exactly one thing was       │
   * │ missing — **the planner had no path to write into `inputs`.** This is an        │
   * │ INFORMATION gap at planning time, not a permission gap. So the fix only          │
   * │ patches exactly that spot.                                                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Five gates so it doesn't turn into noise:
   *
   *  1. ONLY names + shape. Content is already `Read`'s job, and only when
   *     `inputs` names it.
   *  2. Grouped by RUN, with a `request` line for that run. `P-260820-0314-
   *     rab5/T-01/doc-2.md` tells the model nothing; *"run: translate doc-2 to
   *     Vietnamese"* tells it everything. This is the piece that makes the
   *     manifest USABLE, not just a path.
   *  3. Only the `MANIFEST_PLANS` most recent runs, with a line stating how
   *     many older runs exist.
   *  4. A hard token cap, trimmed from the OLDEST run.
   *  5. 🔒 The Assistant ONLY. Never enters a worker's prefix — see `budgets`.
   *
   * ⚠ A known cost: this block changes after EVERY run, so the Assistant's
   * prefix gets rewritten every run. Minimized by placing it at the END of
   * the block chain (`buildAssistantPrompt`) so everything above it stays
   * warm — only the tail gets rewritten.
   */
  private artifactManifest(): string {
    const files = this.artifacts.list();
    if (files.length === 0) return '';

    // Grouped by run, keeping the newest→oldest order `list()` already sorted (by `mtime`).
    const byPlan = new Map<string, string[]>();
    for (const a of files) {
      const key = a.plan_id || LEGACY_PLAN;
      const list = byPlan.get(key) ?? [];
      list.push(a.path);
      byPlan.set(key, list);
    }

    const records = new Map(this.plans.list().map((p) => [p.plan_id, p]));
    const titles = new Map([...records].map(([id, p]) => [id, p.request]));
    const mtimes = new Map(files.map((a) => [a.path, a.mtime]));
    const groups = [...byPlan.entries()];
    const shown = groups.slice(0, MANIFEST_PLANS);

    const blocks: string[] = [];
    for (const [planId, paths] of shown) {
      /**
       * AN UNFINISHED RUN MUST SAY IT'S UNFINISHED. → SPEC-artifacts.md §2.6
       *
       * Before 08/20 the manifest only listed files, with no distinction
       * between "output from a run that completed" and "an unfinished batch
       * from a run that died mid-way". The user types the request again and
       * the Assistant redoes it from scratch — paying again for work already
       * sitting on disk — or worse, reuses a half-finished file as if it were
       * complete.
       *
       * This is the DETERMINISTIC half of the "resume" problem: we don't
       * guess *"is this old work"*, we just state what exists and let the
       * planner decide with the full context of what the user just typed. →
       * `isStale`
       */
      const rec = records.get(planId);
      const unfinished = rec && rec.status !== 'done' ? rec : undefined;
      const stale = unfinished ? this.staleIn(planId, paths, mtimes) : new Set<string>();
      /**
       * ⚠ Do NOT attach to `unfinished`. Already hit this exact trap on 08/21.
       *
       * Run `P-260821-0103-cx3a` carries `status: 'done'` — because its LATER
       * retry finished cleanly — while T-01's file is still cut short at 3/5
       * clauses. The RUN's status describes the most recent attempt;
       * incompleteness is a property of EACH TASK. Attaching it to the wrong
       * layer makes the label go silent on exactly the most dangerous case.
       */
      const partial = this.partialIn(planId);
      /**
       * The job's name is what makes a path meaningful — but SEVERELY TRIMMED.
       *
       * `request` is the sentence the Assistant rewrote "to be clear, with
       * enough context", so it's genuinely long: measured on a user's
       * machine, one sentence ran 300+ characters and ate over half the
       * manifest's whole budget. Here it does exactly one job — helping the
       * model recognize *"ah, the doc-2 translation run"* — and 30 tokens is
       * plenty for that. The detailed tail doesn't help pick a file, it just
       * pushes other runs past the cap.
       *
       * `briefText` (200 tokens) is the cap meant for the LOG, not for the prefix.
       *
       * When the name can't be found (the run fell off `index.json`, capped
       * at 200 records — or it's an artifact generated before the 08/20
       * duplicate-`plan_id` fix, carrying an orphaned id), state outright
       * that it's unknown. Making up a date-based label just costs tokens
       * without helping the model decide anything.
       */
      const title = titles.get(planId);
      // English, hard-coded: this block goes into the ASSISTANT's manifest, next
      // to the `UNFINISHED` line just below, which was already English.
      const name = title ? truncateToTokens(title, 30) : '(an older job, no longer named in the log)';
      // Stated as a STEP COUNT, not an internal status name: "2/3 steps" says
      // both *"still unfinished"* and *"how far along"*, while `status:
      // 'blocked'` says neither.
      const progress = unfinished
        ? ` — ⚠ UNFINISHED (${unfinished.steps.filter((s) => s.status === 'done').length}/${
            unfinished.steps.length
          } steps). Files below are partial results you may reuse as inputs.`
        : '';
      blocks.push(
        [
          `## ${name}${progress}`,
          // Sorted by path within ONE run: `T-01` has to come before `T-02`.
          // `list()` sorts by `mtime`, so a task that finished later floats
          // to the top, and a list with jumbled numbering is one a reader
          // has to hunt through.
          /**
           * ⚠ AN UNFINISHED FILE: HIDE THE PATH, KEEP THE COUNT. →
           * SPEC-artifacts §2.7
           *
           * ┌──────────────────────────────────────────────────────────────┐
           * │ A LABEL IS A REQUEST FOR THE MODEL TO COMPLY. REMOVE IT       │
           * │ ENTIRELY AND THERE IS NOTHING LEFT TO COMPLY WITH.            │
           * │                                                              │
           * │ The old version stuck `(INCOMPLETE — … Redo that step …)` on   │
           * │ every file. Read very convincingly — and case hd4 broke the     │
           * │ exact same way anyway. That's a PROMISE, not a mechanism: the    │
           * │ project's oldest rule.                                          │
           * │                                                              │
           * │ Without a stated path, the planner has no string to copy into    │
           * │ `inputs`, so it's forced to redo that step. No model            │
           * │ cooperation required, not even once.                           │
           * └──────────────────────────────────────────────────────────────┘
           *
           * But NOT fully hidden — keeps a count line. Hiding everything
           * would leave the user asking *"how far did that last run get?"*
           * with the Assistant blind, and that's a legitimate question to
           * ask at exactly that moment. The number answers the question
           * without handing over something to copy.
           *
           * ⚠ The model CAN GUESS the path (`artifacts/<plan>/<task>/…`
           * follows a pattern), so this is only the first fence. The hard
           * fence lives in `Scheduler.missingInputs`, which blocks it at
           * launch time.
           */
          ...[...paths]
            .filter((p) => !partial.has(p))
            .sort()
            .map((p) => (stale.has(p) ? `- ${p} (STALE — its source changed after this was written)` : `- ${p}`)),
          ...(paths.some((p) => partial.has(p))
            ? [
                `(${paths.filter((p) => partial.has(p)).length} more files here were left half-written by an ` +
                  `interrupted employee. They are NOT usable as inputs and their paths are withheld on purpose — ` +
                  `plan that step again instead. The human can still open them.)`,
              ]
            : []),
        ].join('\n'),
      );
    }

    const head = '# Results this office has already produced';
    /**
     * THE EXACT TOTAL, even when the list is trimmed. → SPEC-artifacts.md §2.4
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ The manifest DELIBERATELY lists only the `MANIFEST_PLANS` most recent   │
     * │ runs — that's a token budget, not a flaw. But it makes a very common     │
     * │ question UNANSWERABLE: *"how much output do I have?"*. The model looks    │
     * │ at the trimmed list and counts — and counts wrong.                       │
     * │                                                                      │
     * │ These two numbers are already IN OUR OWN HANDS (`files.length`,          │
     * │ `byPlan.size`). The top rule: *never let the model guess something we     │
     * │ can observe*. Cost: one line, ~15 tokens, and it turns a made-up          │
     * │ answer into a fact.                                                   │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const totals =
      `Total: ${files.length} file(s) across ${groups.length} job(s). ` +
      `These numbers are exact — use them when the human asks how much is here.`;
    const foot = [
      groups.length > shown.length
        ? `Listed above: the ${shown.length} most recent job(s) only. The older ones still exist on ` +
          `disk, so a path the human gives you from one of them is valid — never tell them a file ` +
          `is missing because it is not listed here.`
        : '',
      'These are files EMPLOYEES wrote in earlier jobs. To reuse one, put its path in a',
      "task's `inputs`, or send a `lookup` at it to find out what it says.",
    ]
      .filter(Boolean)
      .join('\n');

    /**
     * Trims from the OLDEST run when over the cap — drops from the end
     * instead of `truncateToTokens`-ing the whole block. Cutting mid-string
     * would leave a truncated path, and a truncated path is worse than no
     * path at all: the model would still put it into `inputs`.
     */
    const limit = this.loaded.company.budgets.artifacts_manifest_tokens;
    const kept = [...blocks];
    // `totals` sits RIGHT AFTER the heading and is NEVER trimmed: the loop
    // below only drops from `kept`. The token cap is allowed to shorten the
    // list, never allowed to make a number wrong.
    const render = (): string => [head, '', totals, '', ...kept, '', foot].join('\n');
    while (kept.length > 1 && estimateTokens(render()) > limit) kept.pop();
    return render();
  }

  /**
   * The output list, PAIRED WITH THE JOB NAME that produced them. →
   * docs/SPEC-artifacts.md §2.1
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A PLAN CODE MUST NEVER BE SOMETHING THE USER HAS TO READ.                │
   * │                                                                          │
   * │ The panel had already deliberately hidden `plan_id` — but what it showed    │
   * │ in its place was a fallback ("Run from 08/19 15:10") that a comment in         │
   * │ that exact file already confessed to: *"no job name yet, so state the         │
   * │ date/time"*. The job name was ALREADY THERE in `tasks/index.json`,             │
   * │ nobody had wired it up.                                                   │
   * │                                                                          │
   * │ Wired up HERE, not in `ArtifactStore`: the store scans DISK and has no        │
   * │ business knowing anything about the work log. Mixing two sources into          │
   * │ one layer is what makes someone later have to guess which one is the           │
   * │ real source of truth.                                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * A run that has fallen off `index.json` (capped at 200 records) returns
   * empty — the UI falls back to the date/time label on its own. That's a
   * graceful degradation, not a bug.
   */
  artifactList(): {
    items: Array<import('./artifacts.js').ArtifactRecord & { plan_title: string }>;
    total: number;
    capped: boolean;
  } {
    // Reads the log ONCE then looks up via a Map: `plans.list()` reads and
    // parses the whole index file, and a run touching 20 resumes produces
    // dozens of artifacts — calling it inside a loop would reread the same
    // file dozens of times on every panel open.
    const titles = new Map(this.plans.list().map((p) => [p.plan_id, p.request]));
    const { items, capped } = this.artifacts.scan();
    /**
     * TRIMMED HERE, AFTER sorting by `mtime` — and returns the REAL total
     * alongside it.
     *
     * Trimming without stating the total would rebuild the exact bug just
     * fixed, only in a different spot: the UI shows 500 lines and the user
     * has no way to know 200 more exist. These two numbers are already in our
     * own hands — the rule *"never let anyone guess something we can
     * observe"*.
     */
    return {
      items: items
        .slice(0, MAX_PANEL_FILES)
        .map((a) => ({ ...a, plan_title: titles.get(a.plan_id) ?? '' })),
      total: items.length,
      capped,
    };
  }

  /**
   * DELETES A DOCUMENT — and every lesson that depends on it. →
   * `KnowledgeNode.depends_on`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THE CASCADE DELETE HAPPENS HERE, NOT IN A PERIODIC SWEEP JOB.        │
   * │                                                                          │
   * │ A periodic sweep would mean there's a time window where an orphan node       │
   * │ still sits in every worker's prefix and still gets followed — it points        │
   * │ at a file that no longer exists, and states so very confidently. Nobody         │
   * │ can check how long that window is, and that's exactly the worst kind of         │
   * │ bug: wrong and silent.                                                    │
   * │                                                                          │
   * │ Here, the relationship is 1-to-1 with the user's own action: click            │
   * │ delete, it's gone immediately.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * States how many nodes were dropped. Silently deleting something the user
   * can see in the Knowledge pane is exactly the "lost the user's work,
   * silently" failure class (§8).
   */
  removeDocument(name: string): { removed: boolean; droppedNotes: string[] } {
    this.assertLive();
    if (!this.library.remove(name)) return { removed: false, droppedNotes: [] };

    // The path in `depends_on` is relative to the OFFICE directory — same
    // shape as `receipt.reads`, which is what generates them.
    const dropped = this.knowledge.dropDependents([`library/files/${name}`]);
    if (dropped.length) {
      this.refreshAssistantContext();
      this.emit({
        type: 'knowledge.changed',
        count: this.knowledge.size,
        version: this.loaded.knowledgeVersion,
        plan_id: null,
      });
      this.emitNote(
        t('off.docDeletedWithNotes', { name, n: String(dropped.length) }),
        6_000,
      );
    }
    return { removed: true, droppedNotes: dropped };
  }

  /** The library just changed — count and how many are being extracted. → docs/SPEC-library.md §10 */
  private emitLibrary(): void {
    // If the library changes, the MANIFEST in the Assistant's prefix has to
    // change too. Skip this line and the user drops a document then
    // immediately asks about it, and the Assistant plans as if the library
    // were still empty — the exact hole just patched, just a few seconds later.
    this.refreshAssistantContext();
    this.emit({
      type: 'library.changed',
      count: this.library.size,
      busy: this.library.busyCount(),
      plan_id: null,
    });
  }

  private assistantHot(): string {
    return this.knowledge.hot('assistant', 8, this.loaded.company.budgets.hot_knowledge_tokens).text;
  }

  private describeNode(
    n: LayoutNode,
    missing: boolean,
    connected: boolean,
    notes: Record<string, number>,
    /** Looks up an arm's account name. Lazy — see `canvas()`. */
    viaOf: (server: string) => string | undefined,
    /** Looks up a REFUSED credential on that arm. Same lazy read — see `canvas()`. */
    keyDeadOf: (server: string) => string | undefined,
  ): CanvasNode {
    const base: CanvasNode = { ...n, label: n.id, missing, connected, removable: true };
    /**
     * An arm node shows its LABEL, not the hash. `a3f9c2e1b0` is an identity,
     * not something meant to be read — a diagram full of hash strings and
     * nobody can tell what anything is. Falls back to the hash itself when
     * the ledger has no entry yet (an old config, or hand-pasted into yaml).
     */
    if (n.kind === 'mcp') {
      const meta = n.server ? this.loaded.company.arms[n.server] : undefined;
      // The catalog entry (if any) is the source for the ICON. No `catalog`
      // ⇒ the user pasted it in themselves ⇒ `custom`, exactly like
      // `ArmDialog §kindOf` — one classification axis, two places reading
      // it, and both read from the same fact.
      const entry = meta?.catalog ? findArm(meta.catalog) : undefined;
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 THE `cli` BRANCH — MISSING HERE until 09/01. (bug a user caught)     │
       * │                                                                      │
       * │ *"Created a CLI, but the canvas node still shows the custom-MCP           │
       * │ icon"* — correct: a CLI declaration has no `catalog`, so it fell into      │
       * │ the `custom` branch and carried the plug icon from the moment it was       │
       * │ plugged in.                                                           │
       * │                                                                      │
       * │ ⚠ The comment right above states *"exactly like `ArmDialog                │
       * │ §kindOf`"*, and that sentence **became false** the exact moment I           │
       * │ added `cli` to one side and forgot the other. One classification axis      │
       * │ read in two places means adding a value has to fix both — and a            │
       * │ comment claiming "these two match" does NOT guard against that.            │
       * │ → [[agentco-finish-completely]]                                       │
       * │                                                                      │
       * │ ⚠ Checks `type === 'cli'` against the **launch config** (`mcpServers`),    │
       * │ exactly like `isCliArm`. The `arms[]` half only holds label/credential/    │
       * │ tools — it has **no field at all** saying this is a command                │
       * │ declaration, so reading it there would be a guess.                        │
       * │                                                                      │
       * │ ⚠ AND IT COMES BEFORE `catalog`: true, a CLI declaration today never       │
       * │ has a catalog entry — but this ordering makes the CLI branch                │
       * │ **not depend on that fact**. The day a CLI arm ships pre-built in the        │
       * │ catalog (§8's Google roadmap), it still comes out as `>_` instead of         │
       * │ silently becoming `service`.                                          │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const cfg = n.server ? this.loaded.company.mcpServers[n.server] : undefined;
      return {
        ...base,
        label: meta?.label || n.server || n.id,
        avatar: '🔌',
        armKind: isCliArm(cfg)
        ? 'cli'
        : !meta?.catalog
        ? 'custom'
        : entry?.shape === 'browser'
          ? 'browser'
          : entry?.folders
            ? 'files'
            : 'service',
        ...(entry?.brand.mark ? { mark: entry.brand.mark } : {}),
        /**
         * CONFIG LABELS — *"look at the panel and know how it's configured"*
         * (user 08/29). Inferred from the **saved config**, not from a
         * separately stored id list: two sources for the same fact means the
         * wrong one ends up being the **displayed** one. →
         * `catalog.ts §activeOptions`
         */
        ...(() => {
          const cfg = n.server ? this.loaded.company.mcpServers?.[n.server] : undefined;
          if (!entry || !cfg) return {};
          const on = activeOptions(entry, cfg);
          /**
           * `canLogin` = the arm has a **persisted profile** to sign INTO.
           * Without `dirs`, a sign-in would be lost as soon as the run ends —
           * showing the button there would be setting a trap, not offering a
           * feature.
           */
          const login = on.some((o) => o.dirs?.length);
          return {
            ...(on.length ? { optionLabels: on.map((o) => t(o.label)) } : {}),
            ...(login ? { canLogin: true } : {}),
          };
        })(),
        connected: true,
        /**
         * PERMISSION TIER + JOB COUNT — so the detail panel draws its badge
         * **from data**, not from a name string. The label can be renamed
         * freely; this cannot. → §6j
         */
        ...(meta?.level ? { level: meta.level } : {}),
        ...(meta?.tools?.length ? { toolCount: meta.tools.length } : {}),
        /**
         * ACCOUNT NAME — the node draws it on a secondary line, replacing the
         * word "connected".
         *
         * ⚠ This used to be DELIBERATELY LEFT EMPTY, with the reasoning
         * *"the default label already includes the workspace name"*. That
         * reasoning no longer holds: the label stopped folding the account in
         * (it froze on the first account), so leaving this empty too would
         * leave the diagram with nowhere left to distinguish two arms of the
         * same vendor. → `canvas()`
         *
         * Inferred from `arms[].secrets` looked up against the OAuth store,
         * **not** read off the `label` string: the label belongs to the user
         * and changes freely; the account is a fact that belongs to the
         * config. Same rule as `Company.listArms`. → §armWorkspace
         */
        ...(() => {
          const via = n.server ? viaOf(n.server) : undefined;
          return via ? { via } : {};
        })(),
        // The only thing that paints a node red, and it is a fact we wrote
        // ourselves, never a guess. → `canvas() §keyDeadOf`
        ...(() => {
          const keyDead = n.server ? keyDeadOf(n.server) : undefined;
          return keyDead ? { keyDead } : {};
        })(),
        /**
         * The arm's REAL directory — read from `company.yaml`, NOT editable here.
         *
         * The label is something the user sets and can rename; the directory
         * is **config**, and changing it means changing `armHash` ⇒ a
         * DIFFERENT arm. So this field is read-only: wanting a different
         * directory means plugging in a different connection, per §6i.
         *
         * ⚠ Does NOT check `process.platform`, deliberately — `folderRoots`
         * accepts both `D:\…` and `/home/…` on every OS, because an office
         * zipped over from a different OS still has to display the exact
         * string written in `company.yaml`. Shown verbatim, slashes not
         * normalized: what the user cross-checks against Explorer/Finder is
         * the string they typed, not a version we rewrote.
         */
        folders: n.server ? folderRoots(this.loaded.company.mcpServers[n.server]) : [],
      };
    }
    if (n.kind === 'assistant') {
      const a = this.loaded.config.assistant;
      return {
        ...base,
        // Empty = nobody named it ⇒ the label follows the switch. → types.ts
        label: a.display_name || t('chat.assistant'),
        avatar: a.avatar,
        // This field used to carry a MODEL ID for the Assistant but a TIER
        // NAME for a worker, so the same "Model" field in the UI showed two
        // different kinds of value. Now `tier` is always the tier, `model`
        // is always the model.
        tier: this.assistant.modelTier,
        model: this.assistant.model,
        tierInherited: a.model_tier === undefined,
        count: notes['assistant'] ?? 0,
        mcp: a.mcp,
        hue: agentHue('assistant'),
        connected: true,
        removable: false,
      };
    }
    if (n.kind === 'knowledge') {
      return {
        ...base,
        label: t('off.sharedKnowledge'),
        avatar: '📚',
        count: this.knowledge.size,
        connected: true,
        removable: false,
      };
    }
    if (n.kind === 'library') {
      /**
       * `size` is read from the in-memory catalog — does NOT scan disk here.
       *
       * `describeNode` runs every time the diagram redraws (dragging a node,
       * rewiring, every SSE event). Sticking a `readdir` in here would buy a
       * disk touch on every single frame. Disk scanning only happens at `GET
       * /library`, exactly when the user opens the library to look at it. →
       * docs/SPEC-library.md §9.1
       */
      return {
        ...base,
        label: t('off.documentCabinet'),
        avatar: '🗄',
        count: this.library.size,
        connected: true,
        removable: false,
      };
    }
    const role = n.role ? this.loaded.roles.get(n.role) : undefined;
    if (!role) return { ...base, label: n.role ?? n.id, avatar: '?', missing: true };
    return {
      ...base,
      label: role.display_name || role.id,
      avatar: role.avatar,
      tier: role.model_tier,
      model: this.loaded.company.models[role.model_tier],
      pitch: role.pitch,
      maxUsd: role.budget.max_usd,
      maxTurns: role.budget.max_turns,
      bash: hasShell(role.tools),
      count: notes[role.id] ?? 0,
      mcp: role.mcp,
      hue: agentHue(role.id),
    };
  }

  /** Tasks that have finished in the current run. See `onSchedulerEvent` for why this is needed. */
  private settled = new Set<string>();

  private onSchedulerEvent(e: AgentEventBody, plan: Plan, record: PlanRecord): void {
    if (e.type === 'task.started') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) this.markStep(plan, task.step, 'running');
    }
    if (e.type === 'task.done' || e.type === 'task.blocked') {
      this.settled.add(e.task_id);
      record.tasks_done++;
      this.plans.upsert(record);
    }
    if (e.type === 'task.done') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) {
        // Counted by TASKS finished, not by a STEP's own status.
        //
        // The old version asked "are the sibling tasks part of a step that's
        // already done" — but a step is only done once all its tasks finish,
        // so the question referenced itself and was NEVER true. Consequence:
        // a step with 2+ tasks stayed stuck at "running" forever, even after
        // everything actually finished.
        const siblings = plan.tasks.filter((t) => t.step === task.step);
        const allDone = siblings.every((s) => this.settled.has(s.task_id));
        this.markStep(plan, task.step, e.status === 'done' ? (allDone ? 'done' : 'running') : 'problem');
      }
    }
    this.emit(e);
  }

  private markStep(plan: Plan, index: number, status: Plan['steps'][number]['status']): void {
    const step = plan.steps[index];
    if (!step || step.status === status) return;
    step.status = status;
    this.emit({ type: 'plan.step', step: index, status });
  }

  private setState(state: OfficeState, say: string): void {
    this.state = state;
    this.emit({ type: 'office.state', state, say, plan_id: this.currentRecord?.plan_id ?? null });
  }

  /**
   * Records one ASSISTANT turn in the cost ledger.
   *
   * The Assistant spends money too, and for an office used heavily for chat
   * it spends the majority of it. The ledger used to only hold a worker's
   * receipts, so `agentco cost` gave the wrong answer to the single most
   * important question — "how much of my usage limit is left".
   *
   * `task_id` carries a STAGE name (`route`/`plan`/`report`) rather than a
   * task id: these three stages have completely different cost shapes —
   * `route` runs on every turn and has to stay cheap; `plan` runs once per
   * job in its own query. Merged together, no single stage's growth would be
   * visible.
   */
  private logAssistantUsage(stage: 'route' | 'plan' | 'report' | 'lookup', usage: Usage): void {
    if (usage.turns === 0 && usage.costUSD === 0) return;
    this.onUsage?.({
      ts: new Date().toISOString(),
      office: this.id,
      plan_id: this.currentRecord?.plan_id ?? '',
      task_id: stage,
      role: 'assistant',
      cache_key: '',
      model: usage.model,
      in: usage.input,
      cache_read: usage.cacheRead,
      cache_write: usage.cacheWrite,
      out: usage.output,
      cost_usd: usage.costUSD,
      wall_ms: 0,
      turns: usage.turns,
      status: 'done',
      reasked: false,
    });
  }

  private recordUsage(r: Receipt): void {
    const role = this.loaded.roles.get(r.role);
    this.onUsage?.({
      ts: new Date().toISOString(),
      office: this.id,
      plan_id: this.currentRecord?.plan_id ?? '',
      task_id: r.task_id,
      role: r.role,
      cache_key: role
        ? buildWorkerPrompt(this.loaded, role, { model: this.loaded.company.models[role.model_tier] }).cacheKey
        : '',
      model: r.usage.model,
      in: r.usage.input,
      cache_read: r.usage.cacheRead,
      cache_write: r.usage.cacheWrite,
      out: r.usage.output,
      cost_usd: r.usage.costUSD,
      wall_ms: r.wall_ms,
      turns: r.usage.turns,
      status: r.status,
      reasked: r.reasked,
    });
  }

  /** The company plugs in here — the cost ledger lives at the COMPANY level, one Claude bill, one ledger. */
  onUsage?: (rec: import('./usage.js').UsageRecord) => void;

  private savePlan(plan: Plan): void {
    this.writeJson(path.join(this.loaded.paths.tasks, `${plan.plan_id}.plan.json`), plan);
  }

  /**
   * A task's receipt. The filename carries BOTH the `plan_id`.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG FIXED (08/20): three runs happened, exactly ONE receipt file             │
   * │ survived.                                                                │
   * │                                                                          │
   * │ The old version named it `${task_id}.receipt.json`. But `T-01` is a          │
   * │ sequence number WITHIN one plan, and every plan starts at 1 — so every         │
   * │ run overwrote the exact same file. Measured on a user's machine: office        │
   * │ `ban-dia-hoa` ran three translation jobs, and `tasks/` was left holding         │
   * │ exactly `T-01.receipt.json` from the LAST one. Tokens, turn count,             │
   * │ `reads`, `looped`, `lessons` for the first two jobs vanished, unrecoverable.    │
   * │                                                                          │
   * │ This is EXACTLY the bug already fixed for `artifacts/` on 08/19 (see          │
   * │ `artifactScoper`) — same root cause, same failure class. That time            │
   * │ `tasks/` got overlooked, even though `savePlan` right above it had already     │
   * │ been using `plan_id` from the start.                                     │
   * │                                                                          │
   * │ Lesson: when fixing a "non-unique id" bug, sweep EVERY spot that uses          │
   * │ that id as a filename — not just the one a user just reported.               │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Old files are NOT migrated: no code anywhere reads a receipt back (this
   * is a forensic record for a person to open and read), so renaming going
   * forward is enough. An old `T-01.receipt.json` sits there harmlessly.
   */
  private saveReceipt(planId: string, r: Receipt): void {
    this.writeJson(path.join(this.loaded.paths.tasks, `${planId}.${r.task_id}.receipt.json`), r);
  }

  /**
   * Tasks that never ran — so they can be resumed instead of redone from
   * scratch. → SPEC-offices §6b
   *
   * ⚠ MUST be saved together with `plan_id`. The old version stored a bare
   * `TaskBrief` array, and missing that exact piece meant it couldn't be
   * resumed: `artifacts/<plan_id>/` is the frame for a whole run, so without
   * it there's no way to know which run's new output would land in a
   * different directory, orphaning the old unfinished batch — exactly what
   * `resume` exists to avoid.
   */
  private savePending(planId: string, pending: TaskBrief[]): void {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (pending.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    this.writeJson(file, { plan_id: planId, tasks: pending });
  }

  private sessionFile(): string {
    return path.join(this.loaded.paths.state, 'assistant-session.json');
  }

  /**
   * ⚠ Reads the ROSTER SNAPSHOT too, not just the session pointer. →
   * `Assistant.resumeFrom`
   *
   * These two are A PAIR: the old conversation (which holds old rejections)
   * and the snapshot to tell what changed in the config. Save one, forget
   * the other, and after a restart the history stays intact while the
   * correction signal is lost — and the model follows the history.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HOW FAR THE WORK LOG HAS ALREADY BEEN SQUASHED INTO MEMORY. (user 05/09) │
   * │                                                                          │
   * │ Lives HERE, next to the session pointer, for one specific reason: it must │
   * │ survive the user DELETING their memory. Deleting is them saying *"forget  │
   * │ every task up to now"* — if the marker lived in the memory node, deleting │
   * │ it would reset the marker, `factSkeleton` would re-read the whole log,    │
   * │ and the next compaction would rebuild exactly what they just deleted.     │
   * │ That is the bug this field exists to close.                              │
   * │                                                                          │
   * │ ⚠ Deliberately NOT cleared by `forget()`. `/clear` starts a new           │
   * │ conversation; it does not un-summarise work already recorded.            │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private compactedThrough: string | undefined;

  private readSession(): {
    id?: string;
    reach?: Record<string, string[]>;
    compactedThrough?: string;
  } {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionFile(), 'utf8')) as {
        session_id?: string;
        reach?: Record<string, string[]>;
        compacted_through?: string;
      };
      return { id: raw.session_id, reach: raw.reach, compactedThrough: raw.compacted_through };
    } catch {
      return {};
    }
  }

  /**
   * ⚠ Writes when there is a session **or** a marker.
   *
   * The old early-return assumed the file only ever holds a session pointer.
   * After `/clear` there is no session — and that is EXACTLY the moment the
   * marker has just moved, so returning early there would drop the one write
   * that matters and hand the next compaction the whole log again.
   */
  private saveSessionId(): void {
    if (!this.assistant.session && !this.compactedThrough) return;
    const reach = this.assistant.reachSnapshot;
    this.writeJson(this.sessionFile(), {
      ...(this.assistant.session ? { session_id: this.assistant.session } : {}),
      ...(reach ? { reach } : {}),
      ...(this.compactedThrough ? { compacted_through: this.compactedThrough } : {}),
      saved: new Date().toISOString(),
    });
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  }
}

/**
 * A conversation record has VANISHED — `resume` will never be able to run
 * again.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE BOUNDARY BETWEEN "RETRYABLE" AND "RETRYING IS POINTLESS".      │
 * │                                                                          │
 * │ Doesn't use `classifyError` (worker.ts): that classifies by the cost of      │
 * │ the failure (out of usage, rate limit, auth) to decide whether to retry.       │
 * │ Here the question is completely different — not "can I wait and try           │
 * │ again" but "does the thing I meant to read still exist". A network error       │
 * │ is `other`, a deleted session is also `other`; merging them loses exactly       │
 * │ the information needed here.                                            │
 * │                                                                          │
 * │ ⚠ DEFAULTS TO `false` — an uncertain pattern match is treated as a            │
 * │ TEMPORARY error. Mistaking a network error for "session gone" throws away      │
 * │ a memory compaction that might have been rescuable; the opposite mistake       │
 * │ only makes the user type `/clear` one more time. Errs on the side of           │
 * │ keeping data.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Matches on the error TEXT because the SDK exposes no structured error code
 * for this case. The pattern is deliberately loose: an SDK update rewording
 * its message must not make `/clear` get stuck again. → `Office.compactMemory`
 */
function sessionGone(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no conversation found|session[^.]{0,24}not found|no such session|could not find[^.]{0,24}session|ENOENT/i.test(
    msg,
  );
}

/**
 * Every library document this run touched — merged from all receipts, deduplicated.
 *
 * Used as `depends_on` for a SHARED lesson: the Assistant reads no file
 * itself, so the only thing it could possibly be referring to is a document
 * a worker just opened.
 */
function readsOf(receipts: readonly Receipt[]): string[] {
  return [...new Set(receipts.flatMap((r) => r.reads))].sort();
}

/**
 * What the WORK LOG records for a finished run, from the receipts it produced.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `blocked` USED TO FALL THROUGH TO `done`. (user caught it 05/09)       │
 * │                                                                          │
 * │ The old expression asked only about `failed`, so a run whose ONLY task    │
 * │ came back `blocked` was written into the log as **done**.                │
 * │                                                                          │
 * │ Measured, `P-260905-0237-oq34`:                                          │
 * │   receipt → status "blocked", blocked_on "No file-system access to the   │
 * │             human's local machine (D:\Downloads\Musics)…"                │
 * │   log     → status "done"                                                │
 * │   request → "Create an empty file named abc.txt in D:\Downloads\Musics"  │
 * │                                                                          │
 * │ That line then sits in the results listing, inside the prefix of EVERY   │
 * │ `route()` turn, reading `- [done] Create an empty file named abc.txt…`.  │
 * │ The user asked for the file again and was told *"it was already created  │
 * │ last time"*. The model invented nothing — it read a status WE wrote      │
 * │ wrong, and had no way to know better.                                    │
 * │                                                                          │
 * │ ⚠ Neither existing guard could see it. `missingOutputs` asks *"is the    │
 * │ promised file on disk"* and the answer was YES: the worker dutifully     │
 * │ wrote `result.md` holding its explanation of why it could not do the     │
 * │ job. **A file existing is not a goal being met.**                        │
 * │                                                                          │
 * │ Same failure class the note on `missingOutputs` already names — *"the    │
 * │ worst kind of lie"* — one level up, at the RUN, where nobody was         │
 * │ looking. And this one SELF-PROPAGATES: a false fact in the log is read   │
 * │ by every later turn, and the next compaction would squash it into        │
 * │ memory, where `supersedes` renews it forever.                            │
 * │ → [[agentco-experience-ratchet]]                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Says nothing about `stopped` or `paused` on purpose: an interrupted or
 * rate-limited run never reaches this function — those branches are decided
 * earlier, from `result.stoppedBy`, and folding them in here would give one
 * function two different questions to answer.
 */
export function planStatusOf(
  receipts: readonly { status: string }[],
): 'failed' | 'blocked' | 'done' {
  if (receipts.some((r) => r.status === 'failed')) return 'failed';
  if (receipts.some((r) => r.status === 'blocked' || r.status === 'needs_human')) return 'blocked';
  return 'done';
}

/**
 * The work listing handed to a memory-compaction turn. PURE, so it can be tested.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ONLY THE JOBS NOT YET SQUASHED INTO MEMORY. (user 05/09)              │
 * │                                                                          │
 * │ This used to read `list().slice(0, 12)` — the last twelve jobs, however   │
 * │ many of them memory already covered. Two consequences, and the second is  │
 * │ the real defect:                                                         │
 * │                                                                          │
 * │  ① job #13 fell off the end and was NEVER recorded anywhere, with not     │
 * │    one line saying so. `whereBlock`, in this same file, cuts at 8 and     │
 * │    always prints "…and N more". Same shape, one of them honest.          │
 * │  ② A user who EDITS or DELETES their memory is correcting the machine —   │
 * │    that is the whole point of that pane being editable. But the deleted   │
 * │    content came straight back at the next `/clear`, rebuilt from a log    │
 * │    they have no door to. The edit pane was promising an authority it did  │
 * │    not have. → [[agentco-scope-of-door-vs-data]]                         │
 * │                                                                          │
 * │ The recursion was always meant to be                                     │
 * │     memory(n) = compact( session(n) + memory(n-1) )                      │
 * │ with memory(n-1) — already in this very prompt, carried over by           │
 * │ COMPACT_RULES rule 1 — as the truth for everything older. The skeleton's  │
 * │ job is only the part memory CANNOT hold yet: what has run since. Feeding  │
 * │ it the whole log made it a second, staler copy of memory, overwriting the │
 * │ copy the user is allowed to correct.                                     │
 * │                                                                          │
 * │ ⚠ Belongs to the ASSISTANT's memory alone. Nothing here touches a         │
 * │ worker's HOT/COLD knowledge — different store, different budget,          │
 * │ different question. `factSkeleton` is its only caller.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Split out of `Office` for the same reason `buildPlan` was: it holds rules
 * that each cost something to learn — the window, the unfinished-job
 * exception, the stated overflow — and buried inside a method that awaits the
 * model, no test can reach any of them. → `assistant.ts §buildPlan`
 */
export function workSkeleton(
  plans: readonly { status: string; request: string; report?: string; ended_at?: string }[],
  since: string | undefined,
): string {
  /**
   * ⚠ A job with no `ended_at` is KEPT whatever the marker says: unfinished
   * work is exactly what memory should keep carrying forward, and it stops
   * repeating by itself the moment the job finishes.
   */
  const fresh = plans.filter((p) => !since || !p.ended_at || p.ended_at > since);
  if (fresh.length === 0) return '(no jobs have run since the last memory was written)';

  /**
   * Bounded by TOKENS, not by a job count — and the overflow is STATED.
   *
   * No arbitrary cap: the marker already makes this exactly one stretch of
   * work, so the number is right by construction instead of by a guess. This
   * ceiling is the safety valve for the one pathological session that ran
   * hundreds of jobs, where the listing would otherwise eat the budget of the
   * very turn meant to summarise it. `list()` is newest-first, so what gets
   * dropped is the oldest — and the model is TOLD, because a summary that
   * silently covers part of a window is worse than one that says which part.
   */
  const lines: string[] = [];
  let spent = 0;
  for (const p of fresh) {
    const line = `- [${p.status}] ${p.request}${p.report ? `\n  → ${p.report.split('\n')[0]}` : ''}`;
    const cost = estimateTokens(line);
    if (spent + cost > SKELETON_TOKENS && lines.length > 0) break;
    lines.push(line);
    spent += cost;
  }
  const dropped = fresh.length - lines.length;
  if (dropped > 0) lines.push(`- (+${dropped} older job(s) in this window, not listed here)`);
  return lines.join('\n');
}

/**
 * Files this run wrote OUTSIDE the office directory, that really exist on disk.
 *
 * Used in exactly one spot: choosing which sentence to say when a promised
 * file is missing. Never flows into `whereBlock` — "your output is here" is
 * only ever stated about a place the system actually manages. →
 * `worker.ts → landingOf`, the `outside` label
 */
function strayFilesOf(receipts: readonly Receipt[]): string[] {
  return straysOnDisk(receipts.flatMap((r) => r.landed ?? []));
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUSD: a.costUSD + b.costUSD,
    model: a.model || b.model,
    turns: a.turns + b.turns,
  };
}

/**
 * ⚠ NO COMMENTS. → the box on `companyTemplate` in `src/cli/index.ts`
 *
 * This file used to carry a paragraph above `tools:` and above each budget
 * number, on the grounds that it is the first file an advanced user opens and
 * ought to explain itself. It still ought to — but not from here, because a
 * comment written at creation time is never rewritten and quietly rots against
 * the code. `tools: [Bash]` in particular is the ONE exception to "results
 * always stay inside the office folder", and that warning has to be somewhere
 * it stays true: the employee detail panel and docs/SPEC-artifacts.md §2.6.
 *
 * ⚠ `pitch` is the only thing the assistant sees when planning, so it is never
 * left blank — an empty pitch means the assistant has nothing to route on.
 */
function roleTemplate(id: string, displayName: string, pitch: string, tier: string): string {
  return `id: ${id}
version: 1
display_name: ${JSON.stringify(displayName)}
avatar: "•"

pitch: ${JSON.stringify(pitch || t('seed.rolePitchDefault', { name: displayName }))}
good_at: []
not_for: []

skill_level: medium
skills: {}

tools: [Bash]
model_tier: ${tier}
use_preset: false

budget:
  max_turns: ${tier === 'eco' ? 20 : tier === 'deep' ? 10 : 15}
  max_usd: ${tier === 'eco' ? '2.0' : tier === 'deep' ? '10.0' : '5.0'}
  knowledge_pack: 3000
`;
}
