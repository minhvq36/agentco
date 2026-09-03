/**
 * Types that mirror the backend. The source of truth is `src/core/types.ts` and
 * `src/core/office.ts` — this file is a hand-written copy, not generated.
 *
 * The duplication is accepted because the two sides build separately and cannot
 * import across. Change the other side and you must change this one; the web
 * `npm run typecheck` will not catch it for you.
 */

// Node sizes and the layout maths are SHARED with the backend — no hand-written
// copy any more. → src/core/layout-geometry.ts
export { NODE_SIZE } from '@core/layout-geometry';
export type { NodeKind } from '@core/layout-geometry';

// Same reasoning one step further: the locale union is shared, not copied, so a
// third language cannot exist on one side of the wire only. → src/i18n/
import type { Locale } from '@i18n';
export type { Locale };

import type { NodeKind } from '@core/layout-geometry';

export type OfficeState = 'idle' | 'working' | 'paused' | 'stopped';
export type StepStatus = 'pending' | 'running' | 'done' | 'problem' | 'waiting_human';
export type PlanStatus =
  | 'planning'
  | 'running'
  | 'done'
  | 'failed'
  /** Never ATTEMPTED: the assistant lacked information and asked back. Not `failed` (tried and broke). */
  | 'blocked'
  | 'paused'
  | 'stopped';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  model: string;
  turns: number;
}

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  role?: string;
  server?: string;
  /**
   * The sort key for the arm parking area (`0-files` · `1-<entry>` · `2-custom`).
   * Computed by the server — see `layout.ts §armGroup`. The interface only
   * compares strings and does **not** reclassify. → `canvas/geometry.ts §arrange`
   */
  armGroup?: string;
  label: string;
  avatar?: string;
  /** Model tier: `eco` | `standard` | `deep`. */
  tier?: string;
  /** The model that tier will actually run, e.g. `claude-sonnet-5`. */
  model?: string;
  /** Assistant only: the tier is inherited from the company's `models.master`, not set here. */
  tierInherited?: boolean;
  pitch?: string;
  /** The per-job cost ceiling, in USD. **`0` = no limit.** */
  maxUsd?: number;
  maxTurns?: number;
  /**
   * Employee: does it have `Bash`.
   *
   * ⚠ Do NOT describe it as *"the only tool that can leave the office"* (the old
   * wording). For reading, `Read`/`Glob`/`Grep` can leave too, and for writing
   * `outputScoper` always pulls output back into `artifacts/`, so `Bash` has never
   * been able to point outward. What it really has exclusively: **file metadata**
   * (size · modified date) and running scripts.
   * → SPEC-tools-approval.md §1a
   */
  bash?: boolean;
  count?: number;
  /** Arm: the access level — the badge is drawn from this, **NOT** from `label`. → §6j */
  level?: 'read' | 'add' | 'full';
  /** Arm: how many tools were granted, so the "read only" label can be checked by eye. */
  toolCount?: number;
  /** Arm: the WORKSPACE name it connects to — looked up in the OAuth store, never read off `label`. */
  via?: string;
  /**
   * Arm: the vendor logo's SVG path plus its kind — so the node draws **the same
   * mark** as the Connect dialog. The server sends it along (`office.ts §mark`)
   * rather than the canvas consulting the catalogue: the diagram is drawn before
   * anyone opens the dialog, and a node with no mark on every app launch is not a
   * price worth paying.
   */
  mark?: string;
  /** ⚠ The same union as `office.ts §armKind` and `ArmIcon §ArmKind` — change all three. */
  armKind?: 'files' | 'service' | 'custom' | 'browser' | 'cli';
  /** Labels of the checkboxes that are on — the panel draws its chips from this. */
  optionLabels?: string[];
  /** There is a browser profile ⇒ the panel shows the "open sign-in window" button. */
  canLogin?: boolean;
  mcp?: string[];
  /**
   * Arm: the directories it reaches, **verbatim** as written in `company.yaml`.
   *
   * READ ONLY. Changing a directory changes `armHash`, which makes it a different
   * arm, so the right path is plugging in a new connection rather than editing
   * this field. Empty = not a file arm (Notion, GitHub…) — and in that case draw
   * no field at all, because an empty field lies that the config is incomplete.
   */
  folders?: string[];
  hue?: number;
  missing: boolean;
  connected: boolean;
  removable: boolean;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  knowledge: { shared: number; total: number };
}

export interface OfficeSummary {
  id: string;
  name: string;
  avatar: string;
  state: OfficeState;
  agents: number;
  onDuty: number;
  knowledge: number;
  /** Archived — frozen, read-only, restorable. */
  archived: boolean;
  plan_id: string | null;
  error?: string;
}

/** An employee in the archive. Restoring returns them to the same office. */
export interface ArchivedAgent {
  role: string;
  label: string;
  avatar: string;
  pitch: string;
  notes: number;
}

export type Tier = 'eco' | 'standard' | 'deep';

/** Which tier runs which model — COMPANY-level config (one bill, one place to tighten). */
export interface CompanyModels {
  eco: string;
  standard: string;
  deep: string;
  /** The default assistant tier for every office. An office can override it. */
  master: Tier;
  /** The tier for planning — it runs in its own query, so it cannot break the assistant's cache. */
  planner: Tier;
}

export interface CompanyView {
  name: string;
  offices: OfficeSummary[];
  allowCorePromptEdit: boolean;
  models: CompanyModels;
  /**
   * INTERFACE language only. → docs/CLAUDE.md §Language
   *
   * ⚠ Not the language the assistant replies in. That follows whatever the user
   * types, and no setting anywhere controls it — a Vietnamese user with an
   * English interface still gets Vietnamese answers, on purpose.
   */
  language: Locale;
}

export interface PlanStep {
  title: string;
  status: StepStatus;
}

export interface PlanRecord {
  plan_id: string;
  office: string;
  request: string;
  status: PlanStatus;
  started_at: string;
  ended_at?: string;
  steps: PlanStep[];
  tasks_done: number;
  tasks_total: number;
  costUSD: number;
  turns: number;
  report?: string;
}

export interface PromptLayer {
  id: string;
  title: string;
  editable: boolean;
  file?: string;
  text: string;
  tokens: number;
  /** A REAL example, shown greyed while the layer is empty. Never saved → 0 tokens. */
  placeholder?: string;
  /** The token ceiling — the UI warns past it, the server refuses to save. */
  limit?: number;
  frontmatter?: boolean;
  note: string;
}

export interface KnowledgeEntry {
  id: string;
  file: string;
  title: string;
  tags: string[];
  scope: string;
  tokens: number;
  hits: number;
  pinned: boolean;
  confidence: number;
  /** Superseded by a newer node — the file is still there, but it enters nobody's prompt. */
  superseded: boolean;
  body: string;
  updated: string;
}

/**
 * One document in the library. → docs/SPEC-library.md
 *
 * MUST match `DocRecord` in `src/library/store.ts`.
 */
export type DocState = 'pending' | 'extracting' | 'ready' | 'image-only' | 'unindexed' | 'failed';

export interface LibraryDoc {
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  state: DocState;
  /** "34 pages" · "3 sheets: July, Totals" — assembled in code, never by a model. */
  shape?: string;
  preview?: string;
  tokens?: number;
  pages?: number;
  /** The explanation whenever `state` is not `ready`. Always names what to do about it. */
  note?: string;
  extracted_at?: string;
}

/**
 * One artifact an employee produced. → docs/SPEC-artifacts.md
 *
 * MUST match `ArtifactRecord` in `src/core/artifacts.ts`.
 */
export type ArtifactView = 'text' | 'markdown' | 'csv' | 'code' | 'image' | 'pdf' | 'video' | 'download';

export interface ArtifactRecord {
  path: string;
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  /** Empty for older artifacts, written before paths were scoped by plan. */
  plan_id: string;
  task_id: string;
  view: ArtifactView;
  /**
   * THE JOB NAME that produced this file — `PlanRecord.request`, looked up by the
   * server.
   *
   * Empty when the plan has dropped off `tasks/index.json` (a 200-row cap), or for
   * older artifacts not scoped by plan. The interface falls back to a date-and-time
   * label — graceful degradation, not an error. → docs/SPEC-artifacts.md §2.1
   */
  plan_title: string;
}

export interface OfficeDetail {
  id: string;
  name: string;
  state: OfficeState;
  plan: { plan_id: string; request: string; steps: PlanStep[] } | null;
  pending: number;
  knowledge: number;
  /** The conversation read from disk — it survives every daemon restart. */
  chat?: AgentEvent[];
  /** The daemon's in-memory ring buffer: LIVE state, lost when the daemon stops. */
  history: AgentEvent[];
}

interface EventBase {
  office: string;
  plan_id: string | null;
  /** Present only on events read from the log file, absent on events arriving over SSE. */
  ts?: string;
}

export type AgentEvent = EventBase &
  (
    | { type: 'plan.created'; plan_id: string; request: string; steps: PlanStep[] }
    | { type: 'plan.step'; step: number; status: StepStatus }
    /**
     * ⚠ DELIBERATELY no `say` — it must match `AgentEventBody` in
     * `src/core/types.ts`.
     *
     * The server NEVER sends that field (`office.ts` → `finish()`): the closing
     * sentence already went out as a `master.message` immediately before.
     * Declaring `say` here is a kind of LIE — TypeScript would nod at `e.say`, and
     * at run time it is `undefined`.
     */
    | { type: 'plan.finished'; status: PlanStatus; costUSD: number; turns: number }
    | { type: 'task.started'; task_id: string; role: string; say: string }
    | { type: 'task.progress'; task_id: string; role: string; say: string }
    | {
        type: 'task.done';
        task_id: string;
        role: string;
        say: string;
        status: 'done' | 'failed' | 'blocked' | 'needs_human';
        artifacts: string[];
        usage: Usage;
      }
    | { type: 'task.blocked'; task_id: string; role: string; say: string; reason: string }
    /**
     * `role` = 'user' · 'assistant' · **or AN EMPLOYEE's id**.
     *
     * The third case is a `deliver: reply` task: the answer goes straight from the
     * employee to the user, not through the assistant. `say` never contains the
     * speaker's name — the display side looks it up. → docs/SPEC-offices.md §6
     */
    /**
     * `files` — verified artifact paths, as DATA. → core/types.ts
     *
     * Present only on messages `whereBlock` assembles in code. This is the ONLY
     * list allowed to become clickable: sniffing paths out of `say` with a regex
     * lends a sentence the model invented the interface's authority.
     */
    | { type: 'master.message'; say: string; role: string; files?: string[] }
    | { type: 'office.state'; say: string; state: OfficeState }
    | {
        type: 'office.activity';
        assistant: 'idle' | 'thinking' | 'planning';
        workers: number;
        queued: number;
        jobs: number;
        /**
         * A TEMPORARY status sentence, overriding the line built from the numbers
         * above. It clears itself after `hold_ms`. This is how `/clear` speaks,
         * replacing the two messages it used to send. → docs/SPEC-offices.md §4.6
         */
        note?: string;
        hold_ms?: number;
      }
    | { type: 'office.cleared'; say: string }
    | { type: 'cost.tick'; totals: Usage & { tasks: number } }
    /** The ACCOUNT limit changed — not cleared on an office switch. See `Energy`. */
    | { type: 'energy.tick'; energy: Energy }
    | { type: 'knowledge.changed'; count: number; version: number }
    | { type: 'library.changed'; count: number; busy: number }
    | { type: 'layout.changed'; say: string }
    | { type: 'company.offices'; say: string }
  );

/**
 * The wiring rules — A COPY of `CAN_CONNECT` in `src/core/layout.ts`.
 *
 * On the client its job is to make the wrong action IMPOSSIBLE TO PERFORM (an
 * illegal wire cannot be drawn). The server is where the rule is actually
 * enforced — any client can POST directly.
 *
 * `agent` is deliberately absent: agents talking directly to agents is the single
 * largest token burner in every multi-agent system.
 */
/**
 * ⚠ MUST MATCH `src/core/layout.ts §CAN_CONNECT` — the server is where it is
 * enforced; this table only stops the interface drawing what the server will
 * refuse.
 *
 * `mcp → assistant` was REMOVED on 23/08: that wire did nothing (`assistant.mcp`
 * was only written and read back to draw it), and had it ever really run, an
 * assistant holding an MCP costs ~36,000 tokens per conversational turn. Details
 * in `layout.ts`.
 */
export const CAN_CONNECT: Partial<Record<NodeKind, readonly NodeKind[]>> = {
  assistant: ['agent'],
  mcp: ['agent'],
};

export function canConnect(from: CanvasNode, to: CanvasNode, edges: readonly CanvasEdge[]): boolean {
  if (from.id === to.id) return false;
  if (!CAN_CONNECT[from.kind]?.includes(to.kind)) return false;
  return !edges.some((e) => e.from === from.id && e.to === to.id);
}

// ────────────────────────────────────────────────────────── the account limit

/**
 * The limit on the Claude ACCOUNT, not on the company.
 * → src/core/energy.ts · docs/SPEC-token-economy.md §5e
 *
 * The same quota the user's own Claude Code and claude.ai are spending. Which is
 * why it is NOT cleared on an office switch — unlike `cost`.
 */
export interface EnergyWindow {
  /** Two only — not split by model. See the note in `energy.ts`. */
  kind: 'session' | 'weekly';
  status: 'allowed' | 'allowed_warning' | 'rejected';
  /** ISO 8601, or null when the server sends none. */
  resetsAt: string | null;
  /**
   * 0-100. `null` when the number could not be fetched. With no number, **draw no
   * bar** — a 0% bar lies about something we do not know.
   */
  utilization: number | null;
}

export interface Energy {
  /** A FIXED order: session, then weekly. */
  windows: EnergyWindow[];
  /** `pro` · `max` … · `null` when running on an API key. */
  plan: string | null;
  seenAt: string;
}

// ─────────────────────────────────────────────────────────────── arms (MCP)
// → docs/SPEC-arms.md §4e · §6

/** A catalogue entry — the thing a user "pulls out and uses right away". */
export interface CatalogArm {
  id: string;
  name: string;
  /** OUR NEUTRAL icon, not a third-party logo. → SPEC-arms.md §11c */
  icon: string;
  blurb: string;
  /**
   * The card's sub-line states THE PRICE, not the features: people choose by the
   * EFFORT it costs them, not by the vendor's name.
   */
  price: 'none' | 'keys' | 'login';
  transport: 'stdio' | 'http';
  secrets: { name: string; label: string; help: string }[];
  /** This arm needs a list of permitted directories. That list IS the allowlist. */
  folders?: { label: string; help: string };
  /** Offer the access-level picker while plugging in (Read only / +Add / Full). → §6j */
  tiered?: boolean;
  /**
   * Level wording overridden by **the catalogue entry**. The HELP text only; it
   * never renames a level.
   *
   * It exists because the default wording for the `add` level (*"can create new
   * pages/items…"*) is **wrong for Linear**: `save_issue` is an upsert, so opening
   * an issue falls into `full`, and the `add` level there opens no issue at all.
   * The full reasoning and this field's boundary: `core/catalog.ts §tierSay`. Not
   * declared ⇒ the default `TIER_SAY` is used.
   */
  tierSay?: Partial<Record<'read' | 'add' | 'full', string>>;
  /**
   * The endpoint's hostname (`http` entries only). It lets us recognise which
   * vendor a URL pasted down the custom path belongs to ⇒ we can point at the
   * right path instead of returning something generic.
   * → `catalog.ts §catalogForUi` · `ArmDialog §catalogMatch`
   */
  host?: string;
  /** Needs a SIGN-IN rather than a typed key. Derived from `spec` on the server, never declared by hand. */
  needsLogin?: boolean;
  /**
   * Signing in with a **device code** instead of opening a tab and waiting for it.
   *
   * The two flows differ in exactly what the user sees, so the interface has to
   * know: the web flow tells them *"finish in the other tab and this updates
   * itself"*; the device code shows **a code right here** and polls. Showing the
   * wrong flow tells someone to wait for a tab that will never report back.
   * → SPEC-arms §5h·7
   */
  deviceLogin?: boolean;
  /**
   * Task groups for the user to tick. Absent ⇒ plug in the whole server. → §5h·7e
   *
   * `label` keeps **the vendor's own name** (findable in their docs); `help` says
   * what it can do. Do not merge the two roles into one string.
   * → `catalog.ts §ArmGroup`
   */
  groups?: { id: string; label: string; help?: string; on?: boolean }[];
  /** The shape used to pick the icon — see `catalog.ts` §shape. */
  shape?: 'browser';
  /**
   * **How it runs** checkboxes — independent of each other, asked at every level.
   * → `catalog.ts §ArmOption`
   *
   * `loopbackOnly` = shown only when the browser and the daemon are on the same
   * machine (a browser window opening on the machine running the daemon). The
   * interface hides it; **the real gate is on the server**.
   */
  options?: { id: string; label: string; help: string; on?: boolean; loopbackOnly?: boolean }[];
  /**
   * THE OUTER FENCE — the scope THE VENDOR holds; we only open the door.
   * → `catalog.ts §scope`
   * Absent ⇒ this entry has no consent screen to send anyone to.
   */
  scope?: { say: string; url: string };
  /**
   * AUTOMATIC APP-INSTALLATION LOOKUP. → `catalog.ts §repoScan` · SPEC-arms §5h·7o
   *
   * Its presence means this entry can answer a question `tools/list` cannot:
   * *"which repos does the vendor let this arm touch"*. The interface only needs
   * to know WHETHER it can — the tool name lives on the server, where it is
   * called.
   */
  repoScan?: Record<string, never> | object;
  /**
   * This vendor cuts capability **at its own server**, by access level.
   * → `catalog.ts §serverFenced`
   *
   * The interface needs to know because the measured token figure is a **ceiling**:
   * the probe deliberately runs without the fence (with it, the level picker would
   * never appear), so a lower level really costs less than the number shown. Not
   * saying so leaves the user reading a number that is correct for a config they
   * did not choose.
   */
  serverFence?: boolean;
  /**
   * The brand record — and **the logo lives inside it**. → `catalog.ts §brand`
   *
   * `mark` is a monochrome 24×24 SVG path. It sits next to `checkedOn` so that
   * rule §11c (*"guidelines unread ⇒ no logo"*) can still see the thing it governs
   * — keep the logo table off in the web directory and the rule becomes a promise.
   */
  brand: {
    owner: string | null;
    guidelineUrl: string | null;
    checkedOn: string | null;
    mark?: string;
  };
}

/**
 * A linked workspace. **Names and labels, never a token.**
 *
 * "Workspace", not "account": Notion's architecture is 1 account ⇄ N workspaces,
 * and each OAuth grant is tied to **one** workspace.
 */
/**
 * ONE MCP call that happened. → `core/audit.ts` · SPEC-arms §6k
 *
 * An **audit** record, not a progress record: it carries `args`, and `args` is
 * the entire reason it exists. Without the arguments the log line only says
 * *"called update_page"* — exactly what we already had, and that was measurably
 * not enough.
 */
export interface ArmCall {
  ts: string;
  server: string;
  tool: string;
  role: string;
  plan_id?: string;
  task_id?: string;
  args: string;
  /** The arguments were truncated for length — say so, do not let a reader think that was all. */
  truncated?: boolean;
}

export interface OAuthAccount {
  name: string;
  label?: string;
  expiresAt?: number;
  /** The arms using this key. Empty ⇒ it can be forgotten right away, no server round-trip. */
  usedBy: string[];
  /**
   * The key is dead — it needs **signing in again**; waiting will not fix it. The
   * reason, verbatim.
   *
   * Without this field the only symptom is an arm silently 401-ing while an
   * employee is mid-task — far from the cause, and a 401 says *"wrong key"*, not
   * *"dead key"*.
   */
  dead?: string;
}

/**
 * One entry in the company's SHARED LEDGER. → docs/SPEC-arms.md §6i
 *
 * `id` is a **hash of the config**, not a name — it never reaches the screen.
 * `label` is what the user reads and can change.
 */
export interface InstalledArm {
  id: string;
  label: string;
  catalog?: string;
  config: unknown;
  /**
   * Key NAMES, never values. The values live in COMPANY-level
   * `.state/secrets.json` and never travel over HTTP — which is exactly why
   * "reuse" in another office requires filling nothing in again.
   * → `company.ts §reuseArm`
   */
  secrets: string[];
  /**
   * The access level. The interface draws **the badge** from this, NOT from the
   * name string.
   *
   * ⚠ Put the level into `label` and one rename can produce *"Notion (writable)"*
   * on a read-only arm — a label lying about privilege. → §6j
   */
  level?: 'read' | 'add' | 'full';
  /**
   * The WORKSPACE name this arm connects to — the server resolves it from
   * `arms[].secrets` against the OAuth store. It never reads the `label` string:
   * the label belongs to the user and changes freely, while the workspace is a
   * fact about the config. Absent ⇒ either no OAuth, or the workspace was
   * forgotten; both mean "unknown" ⇒ draw nothing.
   */
  via?: string;
  /** How many tools were granted — shown beside the badge so the label can be checked by eye. */
  toolCount: number;
  usedBy: { office: string; role: string }[];
  /**
   * No office holds it any more — including the "sits on a diagram but is not
   * wired" case. Only such an entry gets the **delete for good** button.
   * ⚠ Do not infer this from `usedBy`: that counts wires only, so a node waiting
   * on a diagram would look orphaned.
   */
  orphan: boolean;
}

/**
 * The result of a handshake. `status` has FIVE values, not two — `needs-auth` is
 * NOT an error, it means "press the sign-in button". → SPEC-arms.md §6c
 */
export interface ProbeResult {
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /**
   * The access levels WORTH showing, with their tool counts — **computed on the
   * server**, never re-derived here.
   *
   * ⚠ The rule *"show it only if it adds ≥1 tool over the level below"* has a
   * subtle edge case (an all-read server ⇒ all three levels equal ⇒ the lower two
   * are noise). Building a second copy of that rule in the interface builds one
   * that will forget a condition.
   */
  tiers?: { tier: 'read' | 'add' | 'full'; count: number }[];
  serverName?: string;
  serverVersion?: string;
  /** The server's error, VERBATIM — the one string that can be copied and asked about elsewhere. */
  error?: string;
  tools: { name: string; description?: string; level: 'read' | 'write_external' }[];
  /** Tokens added to the prefix on every turn. `undefined` = not measured, and the field stays EMPTY. */
  tokens?: number;
  /**
   * Connected, but the server granted no tools — broken, and broken WITH NO error
   * message. Measured case: a mistyped group name in `X-MCP-Toolsets`.
   * → `probe.ts §ProbeResult.warn`
   */
  warn?: string;
  connectMs: number;
}
