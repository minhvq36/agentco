/**
 * The canvas: the SHAPE of an OFFICE. → docs/SPEC-canvas.md, SPEC-offices.md §2
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANT #1: layout.json holds only COORDINATES + EDGES, never CONTENT.       │
 * │ `cacheKey` hashes a role's content — putting coordinates inside                │
 * │ roles/*.yaml would mean EVERY MOUSE DRAG throws away ~20K worth of                │
 * │ cache_write. Splitting the file out makes that bug IMPOSSIBLE, with no             │
 * │ discipline required at all.                                                    │
 * │                                                                         │
 * │ The test: delete layout.json and the office still runs identically = the         │
 * │ boundary is correct. That's why `assignable()` returns undefined (= everyone)     │
 * │ when the file is missing, and why the `mcp→agent` edge is written into            │
 * │ roles/*.yaml rather than here.                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * An `assistant → agent` edge MEANS SOMETHING: "the Assistant is allowed to
 * delegate work to this person". It directly drives `roster()` in
 * assistant.ts → unwiring it = dropping `pitch` out of the Assistant's own
 * context = a REAL token saving. Dragging a wire is an action with a
 * measurable consequence, not decoration.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import type { LoadedOffice } from './config.js';
import {
  NODE_SIZE,
  SHELF_GAP,
  agentSlot,
  armSlot,
  arrangeAll,
  clashes,
  firstFreeSlot,
  parkSlot,
  type NodeKind,
  type Point,
} from './layout-geometry.js';

/** Gap between the bottom of a worker and the top of their arm. Must match `arrangeAll`. */
const ARM_DROP = 74;
import { findArm } from './catalog.js';
import { isCastId } from './cast.js';
import { isSafeId } from './paths.js';

export { NODE_SIZE };
export type { NodeKind };

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** only for kind=agent — points at roles/<role>.yaml */
  role?: string;
  /** only for kind=mcp — server name declared in company.yaml */
  server?: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutFile {
  version: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /**
   * WHICH CHARACTER a node looks like in the office view, when somebody has
   * chosen one by hand. `nodeId → CastMember.id`.
   * → `core/cast.ts` · docs/SPEC-office-animation.md §6c③
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ IT LIVES HERE AND NOT IN `roles/<id>.yaml`, AND THAT IS THE WHOLE POINT.  │
   * │                                                                          │
   * │ `roles/*.yaml` feeds `cacheKey`. A costume stored there would throw away  │
   * │ that agent's prompt cache and pay ~20K `cache_write` for a haircut — the  │
   * │ exact bug the shape/content split exists to make impossible (§2 of        │
   * │ SPEC-canvas). A character is pure view state, so it belongs in the file   │
   * │ that is defined as pure view state: delete `layout.json` and the office   │
   * │ runs identically, it just re-casts itself from the hash.                  │
   * │                                                                          │
   * │ ⚠ ABSENT IS THE NORMAL CASE. No entry ⇒ `castOf()` hashes one, so an     │
   * │ office that has never touched this still has a full, stable cast.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  cast?: Record<string, number>;
}

export const ASSISTANT_NODE = 'assistant';
export const KNOWLEDGE_NODE = 'knowledge';
/**
 * The document cabinet. Sits NEXT TO the knowledge shelf on the diagram, and
 * that's the entire point: the two easiest things to confuse in the
 * product, so they must be visible at the same time to tell apart — what
 * the USER put in, versus what the system HAS LEARNED.
 * → docs/SPEC-library.md §1
 */
export const LIBRARY_NODE = 'library';
export const agentNodeId = (roleId: string): string => `agent:${roleId}`;
export const mcpNodeId = (server: string): string => `mcp:${server}`;

const COORD_LIMIT = 20_000;
const MAX_NODES = 200;

/** Which node kind is allowed to connect OUT to which. Agent is deliberately ABSENT here. */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `mcp → assistant` REMOVED (23/08). It was a WIRE THAT DID NOTHING AT ALL.    │
 * │                                                                          │
 * │ That edge was originally accepted with the reasoning "small tasks the           │
 * │ Assistant handles itself, needs a concierge (M1) to actually run". But going       │
 * │ and checking, `assistant.mcp` was only ever WRITTEN and then READ BACK TO         │
 * │ DRAW — no code anywhere loaded it into the Assistant's own session. The           │
 * │ concierge doesn't exist yet. So it was one more promise with no code enforcing     │
 * │ it.                                                                        │
 * │                                                                          │
 * │ And if anyone actually wired it up for real, it would be worse than doing         │
 * │ nothing: `types.ts:499` states the Assistant must NEVER hold an MCP — an MCP       │
 * │ breaks the prompt cache on `resume`, and `route()` resumes on EVERY message ⇒       │
 * │ ~36,000 tokens on every conversation turn.                                    │
 * │                                                                          │
 * │ ⇒ An edge that's harmless-because-nothing's-wired-to-it leads straight to the      │
 * │ single most expensive trap in the system. Since connecting an arm got cheaper       │
 * │ (§6), a user WILL try dragging this. Removing it from this table blocks it          │
 * │ structurally; the day a real concierge exists, add it back with code that runs.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ This table has a SECOND COPY at `web/src/lib/types.ts §CAN_CONNECT`. Two
 * copies of one rule have already burned this project once (`agentSlot` vs
 * `arrange`) — edit one side and the other must also change, and long-term they should merge into one.
 */
const CAN_CONNECT: Partial<Record<NodeKind, ReadonlySet<NodeKind>>> = {
  assistant: new Set<NodeKind>(['agent']),
  mcp: new Set<NodeKind>(['agent']),
};

export class LayoutStore {
  constructor(private office: LoadedOffice) {}

  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  private get file(): string {
    return this.office.paths.layoutFile;
  }

  /** Whether the file has ever been written. Tells "nobody's touched this yet" apart from "every wire was cut". */
  get exists(): boolean {
    return fs.existsSync(this.file);
  }

  /**
   * The current shape, reconciled against roles/ and company.yaml.
   *
   * SELF-HEALING: a yaml file exists but its node is missing → add the node
   * into a free slot (a user who hand-drops a file still sees it appear).
   * A node exists but its yaml file is missing → KEEP the node, flag it
   * `missing` so the canvas shows it red, never silently delete it.
   */
  /**
   * `pending` = `mcp → agent` edges **about to be written**, passed down from `save()`.
   *
   * Only used to CHOOSE A SLOT for a node with no coordinates yet. It never
   * enters the file, never changes any edge — the source of truth for mcp
   * edges is still `roles/*.yaml`.
   * Why this is needed: see the comment block inside `spotFor`.
   */
  read(pending: readonly { from: string; to: string }[] = []): {
    layout: LayoutFile;
    missing: Set<string>;
  } {
    const raw = this.readRaw();
    const stored = new Map(raw.nodes.map((n) => [n.id, n]));

    /**
     * PASS 0 — the list of nodes that MUST exist, no coordinates needed yet.
     *
     * Fully splits the "who exists" step from the "who sits where" step. The
     * earlier version mixed both into one loop, and that's why default
     * coordinates had to be hand-written numbers: placing the Assistant
     * happened before it was even known how many workers the office had to center against.
     */
    const wanted: LayoutNode[] = [{ id: ASSISTANT_NODE, kind: 'assistant', x: 0, y: 0 }];
    for (const roleId of this.office.roles.keys()) {
      if (this.office.archivedRoles.has(roleId)) continue;
      wanted.push({ id: agentNodeId(roleId), kind: 'agent', role: roleId, x: 0, y: 0 });
    }
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ AN ARM ONLY SHOWS IN THE OFFICE THAT'S USING IT. (changed 23/08)         │
     * │                                                                    │
     * │ The earlier version built a node for EVERY key in `company.mcpServers`,     │
     * │ in EVERY office — following the idea *"connect it once, every office sees   │
     * │ it"*. That idea was written when connecting one MCP took 9 steps and no      │
     * │ one had more than one.                                                 │
     * │                                                                    │
     * │ The `+ Connect` dialog made connecting cheap ⇒ THAT PREMISE STOPPED HOLDING. │
     * │ The user caught it on the very first test run: connecting an arm in this      │
     * │ office made it sprout onto the diagrams of six other offices too, with no      │
     * │ wire, doing nothing.                                                    │
     * │                                                                    │
     * │ ⇒ A visually readable boundary: **what's connected** belongs to the           │
     * │ COMPANY (shown in the "already connected in another office" block in the      │
     * │ dialog), **who gets to use it** belongs to the OFFICE (the wire on this        │
     * │ diagram).                                                                │
     * │                                                                    │
     * │ ⚠ Traverses `role.mcp`, NOT `company.mcpServers`: a role that still           │
     * │ declares a server that's since been disconnected must still see that node      │
     * │ — in an orphaned state, flagged red. Conflating *"this office isn't using       │
     * │ it"* with *"no longer declared in company.yaml"* is exactly the `catch {         │
     * │ exists = false }` failure — two entirely different facts under one label.       │
     * └────────────────────────────────────────────────────────────────────┘
     */
    // `office.arms` = PRESENT on the diagram (even if wired to no one).
    // `role.mcp`    = WHO GETS TO USE IT. Both sets combined, since an arm
    // still wired but missing from `office.arms` (old data) must still show. → types.ts §arms
    const inUse = new Set<string>([...this.office.config.arms, ...this.office.config.assistant.mcp]);
    for (const [roleId, role] of this.office.roles) {
      if (this.office.archivedRoles.has(roleId)) continue;
      for (const s of role.mcp) inUse.add(s);
    }
    for (const server of inUse) {
      wanted.push({ id: mcpNodeId(server), kind: 'mcp', server, x: 0, y: 0 });
    }
    // The two shelves sit next to each other on the bottom row: LEFT =
    // knowledge (self-taught by the system), RIGHT = document cabinet
    // (fed in by the user). This order is now maintained by `arrangeAll`, no longer two constants that must be kept in sync by hand.
    wanted.push({ id: KNOWLEDGE_NODE, kind: 'knowledge', x: 0, y: 0 });
    wanted.push({ id: LIBRARY_NODE, kind: 'library', x: 0, y: 0 });

    /**
     * A clean layout, computed with the EXACT function the "Re-arrange
     * diagram" button runs.
     *
     * ⚠ Edges built from `role.mcp` — **the yaml is the source of truth**,
     * not edges in `layout.json` (they haven't even been built at this
     * point, and even if they had, `mcp→agent` edges are deliberately never
     * saved there). The same data `arrangeAll` needs to know which arm belongs to whom.
     */
    const links: { from: string; to: string }[] = [];
    for (const [roleId, role] of this.office.roles) {
      if (this.office.archivedRoles.has(roleId)) continue;
      for (const s of role.mcp) links.push({ from: mcpNodeId(s), to: agentNodeId(roleId) });
    }
    // Edges about to be written also go into the clean layout — otherwise
    // `tidy` and `spotFor` see two different truths about the same arm within the same call.
    for (const e of pending) if (!links.some((l) => l.from === e.from && l.to === e.to)) links.push(e);
    const tidy = arrangeAll(wanted.map((n) => ({ ...n, ...this.armGroup(n) })), links);

    const nodes: LayoutNode[] = [];
    const seen = new Set<string>();
    const keep = (n: LayoutNode): void => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      nodes.push(n);
    };

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ THE SLOT FOR A NEW NODE MUST BE A GENUINELY EMPTY SLOT, NOT SLOT #i.       │
     * │                                                                    │
     * │ The earlier version used `agentSlot(i)` with `i` = the ALPHABETICAL order    │
     * │ of the role, never checking whether that slot was already occupied.       │
     * │ Adding a worker whose name sorts BEFORE an existing one drops them RIGHT     │
     * │ on top of the existing one, and the user sees "clicked Add and nothing        │
     * │ happened".                                                                │
     * │                                                                    │
     * │ ⚠ TWO PASSES, and this is the half that's easy to get wrong: every node       │
     * │ that already has coordinates must be placed FIRST, before any new node gets    │
     * │ a slot assigned. Doing it in one alphabetical pass means a new node named       │
     * │ "ai-do" gets its slot assigned BEFORE "nguoi-viet" has even made it into        │
     * │ the list — and the collision check runs against a list that's still empty.     │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const fresh: LayoutNode[] = [];
    for (const n of wanted) {
      const prev = stored.get(n.id);
      if (prev) keep({ ...n, x: prev.x, y: prev.y });
      else fresh.push(n);
    }

    /**
     * Orphaned nodes: the yaml file / mcp server has disappeared. Kept + flagged red.
     *
     * Placed BEFORE the second pass, not after: they occupy real space on
     * the diagram, so new nodes must avoid them. The earlier version
     * appended them at the end, meaning `firstFreeSlot` never saw them and
     * could place a new person right on top.
     *
     * ⚠ An ARCHIVED role is not an orphan. Its file is intact, the user
     * just told it to be put away. Including it here would mean "archive
     * it and it reappears, in red" — worse than not allowing archiving at all.
     */
    const missing = new Set<string>();
    for (const n of raw.nodes) {
      if (seen.has(n.id)) continue;
      if (n.kind !== 'agent' && n.kind !== 'mcp') continue;
      if (n.role && this.office.archivedRoles.has(n.role)) continue;
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 A FULLY-DISCONNECTED MCP NODE DISAPPEARS, IT DOES NOT BECOME A            │
       * │ "PERMANENT ORPHAN".                                                    │
       * │                                                                    │
       * │ Bug the user reported, 23/08: after removing a connection, the `🔌 files`         │
       * │ node stayed on the diagram labeled "no longer connected", and **no button           │
       * │ could remove it** — clicking Delete again did nothing, since both                  │
       * │ `company.yaml` and `roles/*.yaml` had already been clean for a while.               │
       * │                                                                    │
       * │ The culprit was this exact loop: `layout.json` still stored the node, the loop        │
       * │ saw it as "no longer wanted" so it **kept it + flagged it red**, then `save()`         │
       * │ wrote `current.nodes` right back to disk ⇒ it kept resurrecting itself forever.        │
       * │                                                                    │
       * │ For an AGENT, keeping it is CORRECT: a missing `roles/x.yaml` file is an              │
       * │ incident, the user needs to see it to recover it. For an MCP there's nothing            │
       * │ to recover — not declared at the company, no role points at it, meaning it's           │
       * │ **already been fully disconnected**, and the node is now purely visible clutter.        │
       * │                                                                    │
       * │ A REAL MCP orphan is a different case, still caught by the loop below: a role           │
       * │ that STILL declares `mcp: [x]` while `company.yaml` has gone clean.                    │
       * └────────────────────────────────────────────────────────────────────┘
       */
      if (n.kind === 'mcp' && n.server && !inUse.has(n.server)) continue;
      missing.add(n.id);
      keep(n);
    }
    /**
     * A SECOND KIND of orphan, and it only appears as of 23/08: a role still
     * declares `mcp: [x]` while `x` has since been removed from `company.yaml`.
     *
     * The loop above doesn't catch this — it catches a node STILL IN
     * `layout.json` that's no longer wanted; this case is the reverse, the
     * node IS wanted (a role declares it) but what it points at has
     * disappeared. Two different shapes, and folding them into one loop is
     * the surest way to miss one of them.
     */
    for (const server of inUse) {
      if (!(server in this.office.company.mcpServers)) missing.add(mcpNodeId(server));
    }

    // PASS TWO: every node that already had a spot is now in `nodes`, assign slots to new nodes.
    for (const n of fresh) keep({ ...n, ...this.spotFor(n, nodes, tidy, pending) });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    // No file yet = every worker gets delegated to. This is the "delete
    // layout.json and the office runs identically" test.
    const edges = this.exists
      ? sanitizeEdges(raw.edges, byId)
      : this.activeRoleIds().map((r) => ({ from: ASSISTANT_NODE, to: agentNodeId(r) }));

    // mcp→agent edges are NOT saved here — they live in roles/<id>.yaml.
    // Rebuilt at read time so the canvas draws correctly, but the source of truth stays the yaml.
    const seenEdge = new Set(edges.map((e) => `${e.from} ${e.to}`));
    for (const [roleId, role] of this.office.roles) {
      for (const server of role.mcp) {
        const from = mcpNodeId(server);
        const key = `${from} ${agentNodeId(roleId)}`;
        if (!byId.has(from) || seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from, to: agentNodeId(roleId) });
      }
    }
    // mcp→assistant edges are also CONTENT: they live in office.yaml.
    for (const server of this.office.config.assistant.mcp) {
      const from = mcpNodeId(server);
      const key = `${from} ${ASSISTANT_NODE}`;
      if (!byId.has(from) || seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ from, to: ASSISTANT_NODE });
    }

    return { layout: { version: 1, nodes, edges, cast: raw.cast ?? {} }, missing };
  }

  /**
   * The SORT key for an arm in the parking area. → `layout-geometry.ts §ArrangeNode`
   *
   *   `0-files`      a local folder      — its own group, sorts first
   *   `1-<entry>`     a catalog service   — same vendor ⇒ same prefix ⇒ sit next to each other
   *   `2-custom`      pasted by hand, no catalog entry
   *
   * ⚠ Classified by `entry.folders`, not by **the entry's name**: the exact
   * same rule `ArmDialog §kindOf` already uses for the icon. One
   * classification axis, two places reading it — add one more folder
   * vendor and both stay correct automatically, with nothing to remember.
   */
  armGroup(n: { kind: NodeKind; server?: string }): { armGroup?: string } {
    if (n.kind !== 'mcp' || !n.server) return {};
    const cat = this.office.company.arms[n.server]?.catalog;
    if (!cat) return { armGroup: '2-custom' };
    return { armGroup: findArm(cat)?.folders ? '0-files' : `1-${cat}` };
  }

  /**
   * A spot for a node that has NEVER had coordinates. Three moves, stopping at the first one that works.
   *
   * 1. **No `layout.json` yet** = a brand-new office, nobody's dragged
   *    anything → use the clean layout as-is. This is the fix for "the
   *    canvas is lopsided when creating a new office": this branch used to
   *    be three hand-written constants that weren't aligned with each other.
   *
   * 2. **A shelf grows into an existing diagram** — a real case sitting on
   *    disk right now: an office saved `layout.json` before the Document
   *    cabinet node existed. The clean layout is computed from the worker
   *    count, but the user has already dragged the sibling shelf somewhere
   *    else → the two shelves land in two different places, the whole row
   *    misaligned. Anchoring to its SIBLING keeps the bottom row straight, wherever the user dragged it.
   *
   * 3. **A new worker** — grows FANNING OUT on both sides of the Assistant,
   *    not chaining rightward. The clean layout is useless here: it's
   *    centered on the worker COUNT, while the Assistant stays put until
   *    someone clicks "Re-arrange". Anchoring to it means the third person
   *    lands to the right of the second and the diagram visibly tilts — the
   *    user has to click Re-arrange just to see it balanced, meaning the
   *    system makes them clean up after it. → `centeredSlot`
   *
   * 4. Otherwise: the clean spot if it's free, else the first free grid slot.
   */
  private spotFor(
    node: LayoutNode,
    placed: readonly LayoutNode[],
    tidy: ReadonlyMap<string, Point>,
    pending: readonly { from: string; to: string }[] = [],
  ): Point {
    if (!this.exists) return tidy.get(node.id) ?? agentSlot(0);

    if (node.kind === 'library' || node.kind === 'knowledge') {
      const twinKind = node.kind === 'library' ? 'knowledge' : 'library';
      const twin = placed.find((n) => n.kind === twinKind);
      if (twin) {
        const step = NODE_SIZE.knowledge.w + SHELF_GAP;
        const spot = { x: node.kind === 'library' ? twin.x + step : twin.x - step, y: twin.y };
        if (!clashes(spot, node.kind, placed)) return spot;
      }
    }

    if (node.kind === 'agent') {
      // The Assistant is ALWAYS in `placed` by the time a worker's turn
      // comes: `wanted` lists it first, so it gets a slot first. Still
      // checked — if it's missing, fall back to counting-from-the-left rather than throwing.
      const boss = placed.find((n) => n.kind === 'assistant');
      const centerX = boss ? boss.x + NODE_SIZE.assistant.w / 2 : undefined;
      return firstFreeSlot(placed, 'agent', centerX);
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 A NEW ARM ANCHORS TO ITS OWNER. (bug the user caught, 31/08)             │
     * │                                                                    │
     * │   *"every time I add 1 new MCP connection: the spot it picks is terrible:     │
     * │    instead of right below the connected worker where there's a bit of open     │
     * │    space, it picks somewhere faraway"*                                       │
     * │                                                                    │
     * │ Two reasons stacked on top of each other, and both had to be fixed:            │
     * │  ① `tidy` is computed for the CLEAN layout, but the user has already dragged     │
     * │     everything elsewhere ⇒ that slot almost always `clashes` ⇒ falls through to    │
     * │     the second move.                                                       │
     * │  ② the second move is `firstFreeSlot` — the WORKER grid, step 202×120. Far too    │
     * │     coarse for a 152×52 node, so it skips right over every real open gap.        │
     * │                                                                    │
     * │ ⇒ Look for the OWNER first (`role.mcp` is the source of truth, not an edge in     │
     * │ layout.json), then scan the arm's own grid right below them. Nobody holds it ⇒     │
     * │ it's an unused row ⇒ **the parking area on the left**, exactly where the user       │
     * │ had already dragged them.                                                    │
     * └────────────────────────────────────────────────────────────────────┘
     */
    if (node.kind === 'mcp' && node.server) {
      const owners = new Set<string>();
      for (const [roleId, role] of this.office.roles) {
        if (role.mcp.includes(node.server)) owners.add(agentNodeId(roleId));
      }
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ WIRES ABOUT TO BE WRITTEN COUNT TOO. (bug the user caught, 31/08)          │
       * │                                                                    │
       * │   *"the mcp node I just connected on the canvas grows way out on the         │
       * │    farleft, when it should just connect straight down"*                     │
       * │                                                                    │
       * │ The order inside `grantArm` is: write `office.arms` → **place the node** →     │
       * │ only then write the wire (`role.mcp`). So exactly when `spotFor` runs,          │
       * │ `role.mcp` **is still empty** ⇒ no owner found ⇒ treated as an unused row ⇒       │
       * │ **parked on the left**. And since the coordinates get saved, `spotFor` never      │
       * │ runs again for it: it sits there permanently.                                  │
       * │                                                                    │
       * │ The 30/08 patch was geometrically correct and wrong about TIMING — it asked      │
       * │ a source of truth before it had become true yet. Same class as §3a: *what's       │
       * │ measured isn't a state, it's THE MOMENT ASKED*.                                │
       * │                                                                    │
       * │ ⇒ `save()` passes down the exact list of edges it's **about to write**. No       │
       * │ edge at all (connected but not yet delegated to anyone) still parks on the left    │
       * │ — correctly.                                                                  │
       * └────────────────────────────────────────────────────────────────────┘
       */
      for (const e of pending) {
        if (e.from === node.id) owners.add(e.to);
      }
      const anchors = placed.filter((n) => owners.has(n.id));
      if (anchors.length) {
        // Axis = the center of the LEFTMOST owner. Same rule as
        // `groupArms`: every subsequent wire runs rightward, none crossing another.
        const boss = anchors.reduce((a, b) => (a.x <= b.x ? a : b));
        const centerX = boss.x + NODE_SIZE.agent.w / 2;
        const topY = Math.max(...anchors.map((a) => a.y + NODE_SIZE.agent.h)) + ARM_DROP;
        for (let i = 0; i < 40; i++) {
          const spot = armSlot(i, centerX, topY);
          if (!clashes(spot, 'mcp', placed)) return spot;
        }
      } else {
        const parked = placed.filter((n) => n.kind === 'mcp');
        for (let i = 0; i < 40; i++) {
          const spot = parkSlot(i);
          if (!clashes(spot, 'mcp', parked)) return spot;
        }
      }
    }

    const want = tidy.get(node.id);
    if (want && !clashes(want, node.kind, placed)) return want;
    return firstFreeSlot(placed, node.kind);
  }

  /**
   * The roles the Assistant IS ALLOWED to delegate to. `undefined` = everyone.
   *
   * `undefined` rather than "the entire list" is deliberate: assistant.ts
   * distinguishes "not configured yet" from "configured to allow everyone",
   * and only the first case gets silently substituted when layout.json is absent.
   */
  assignable(): Set<string> | undefined {
    if (!this.exists) return undefined;
    const { layout } = this.read();
    const out = new Set<string>();
    for (const e of layout.edges) {
      if (e.from !== ASSISTANT_NODE) continue;
      const node = layout.nodes.find((n) => n.id === e.to);
      if (node?.kind === 'agent' && node.role) out.add(node.role);
    }
    return out;
  }

  /**
   * Writes a new shape.
   *
   * Edges from an mcp node do NOT live in layout.json — "which tools can
   * this agent use" is CONTENT, not shape. It already has a home: `mcp:`
   * inside roles/<id>.yaml (or office.yaml for the Assistant). Writing it
   * in two places = two sources of truth = drifting apart sooner or later.
   *
   * Returns the list of files that changed, so the caller knows whether it needs to reload.
   */
  save(input: { nodes?: unknown; edges?: unknown; cast?: unknown }): { touched: string[] } {
    /**
     * ⭐ PASSES THE SOON-TO-BE-WRITTEN EDGE DOWN TO `read()` — see the
     * comment block at `spotFor`.
     *
     * Scanned raw, WITHOUT going through `sanitizeEdges`: that function
     * needs `byId`, and `byId` itself comes from this exact `read()` call —
     * circular. All that's needed here is a **placement hint**, so a
     * garbage edge slipping in is just a hint that gets ignored, never written anywhere.
     */
    const hint = Array.isArray(input.edges)
      ? (input.edges as { from?: unknown; to?: unknown }[])
          .filter((e) => typeof e?.from === 'string' && typeof e?.to === 'string')
          .map((e) => ({ from: e.from as string, to: e.to as string }))
      : [];
    const current = this.read(hint).layout;
    const byId = new Map(current.nodes.map((n) => [n.id, n]));

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ "THE NODE EXISTS" ≠ "A VALID EDGE ENDPOINT" — and conflating the two is a       │
     * │ SELF-LOCKING LOOP. (caught during end-to-end testing 23/08, right after           │
     * │ writing it)                                                              │
     * │                                                                    │
     * │ Since 23/08 `read()` only builds an mcp node for a server CURRENTLY IN USE in      │
     * │ this office (`role.mcp`). But `role.mcp` itself gets written FROM the connecting     │
     * │ edge, and the edge gets filtered by `sanitizeEdges` against the nodes that           │
     * │ currently exist ⇒ connecting a new arm and delegating it to someone means:            │
     * │                                                                    │
     * │   nobody uses it yet → no node exists → the edge gets dropped → `mcp:` never          │
     * │   gets written → still nobody uses it. Stuck forever, and **silently**.              │
     * │                                                                    │
     * │ Two sets that were always different, now stated explicitly: EXISTS = currently        │
     * │ wired in this office (a diagram fact). VALID = declared in `company.yaml` (a          │
     * │ company fact). The node added back in here lives only for this one call, to           │
     * │ validate the edge — it NEVER enters `layout.json`, since mcp edges were never          │
     * │ saved there to begin with.                                                        │
     * └────────────────────────────────────────────────────────────────────┘
     */
    for (const server of Object.keys(this.office.company.mcpServers)) {
      const id = mcpNodeId(server);
      if (!byId.has(id)) byId.set(id, { id, kind: 'mcp', server, x: 0, y: 0 });
    }

    // Coordinates: only accepted for known nodes. A client can't spawn a new node via PUT.
    if (Array.isArray(input.nodes)) {
      for (const raw of input.nodes.slice(0, MAX_NODES)) {
        const n = raw as Partial<LayoutNode>;
        if (typeof n.id !== 'string') continue;
        const node = byId.get(n.id);
        if (!node) continue;
        node.x = clampCoord(n.x);
        node.y = clampCoord(n.y);
      }
    }

    const wanted = sanitizeEdges(input.edges, byId);

    // ── splits two kinds of edges: shape goes into layout.json, tools go into yaml
    const mcpByRole = new Map<string, string[]>();
    const mcpForAssistant: string[] = [];
    for (const e of wanted) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (from?.kind !== 'mcp' || !from.server) continue;
      if (to?.kind === 'assistant') {
        mcpForAssistant.push(from.server);
      } else if (to?.kind === 'agent' && to.role) {
        const list = mcpByRole.get(to.role) ?? [];
        list.push(from.server);
        mcpByRole.set(to.role, list);
      }
    }

    /**
     * ⚠ ABSENT ≠ EMPTY. The canvas `PUT`s `{nodes, edges}` on every drag and
     * says nothing about the cast; reading that silence as "clear it" would
     * make dragging one node undress the whole office. Present ⇒ replace (that
     * is the only way to UNSET a character); absent ⇒ leave it alone.
     */
    const cast = input.cast === undefined ? current.cast : readCast(input.cast);
    this.writeRaw({ version: 1, nodes: current.nodes, edges: wanted, ...(cast ? { cast } : {}) });

    const touched: string[] = [];
    for (const [roleId, role] of this.office.roles) {
      // An archived role has NO node on the canvas, so no edge points at it.
      // Without skipping it here, every diagram save would wipe its `mcp:`
      // list clean — a user archives a worker, restores them, and finds all
      // their tools gone, with no action ever saying that would happen.
      if (this.office.archivedRoles.has(roleId)) continue;
      const next = [...new Set(mcpByRole.get(roleId) ?? [])].sort();
      if (sameList(next, role.mcp)) continue;
      if (this.writeYamlKey(this.roleFile(roleId), ['mcp'], next)) touched.push(`roles/${roleId}`);
    }
    const nextAssistant = [...new Set(mcpForAssistant)].sort();
    if (!sameList(nextAssistant, this.office.config.assistant.mcp)) {
      if (this.writeYamlKey(this.office.paths.configFile, ['assistant', 'mcp'], nextAssistant)) {
        touched.push('office');
      }
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ PRESENCE IS ONLY EVER ADDED HERE, NEVER REMOVED.                             │
     * │                                                                    │
     * │ Bug the user reported, 23/08: cutting the last wire made the arm's node          │
     * │ VANISH from the diagram. They wanted it to stay, like a worker who's "on          │
     * │ leave" — still there, unwired, reconnectable anytime.                         │
     * │                                                                    │
     * │ `office.arms` is where presence gets recorded, and it can ONLY be reduced by       │
     * │ `dropArm` — a deliberate DELETE action. Cutting a wire changes *who gets to         │
     * │ use it*, not *whether it exists*: two different things, two different places        │
     * │ that record them, and now they no longer step on each other.                     │
     * │                                                                    │
     * │ Adding it here also SELF-HEALS old data: an arm connected before                  │
     * │ `office.arms` existed lived only inside `role.mcp`, so cutting the wire made        │
     * │ it evaporate. The first diagram save from now on records it into the registry,      │
     * │ once, silently.                                                              │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const present = new Set(this.office.config.arms);
    for (const list of mcpByRole.values()) for (const s of list) present.add(s);
    for (const s of mcpForAssistant) present.add(s);
    const nextArms = [...present].sort();
    if (!sameList(nextArms, this.office.config.arms)) {
      if (this.writeYamlKey(this.office.paths.configFile, ['arms'], nextArms)) touched.push('office');
    }

    return { touched };
  }

  /** Roles that aren't archived. This is the list the canvas and roster see. */
  private activeRoleIds(): string[] {
    return [...this.office.roles.keys()].filter((id) => !this.office.archivedRoles.has(id));
  }

  /**
   * Adds a worker to the diagram: places it in a free slot, WRITES TO DISK.
   *
   * Always calls `writeRaw`, even when there's nothing new to add. The
   * earlier version called `connectAssistant`, which returned early if the
   * edge already existed — and the edge ALWAYS exists when there's no
   * layout.json yet (at that point `read()` auto-generates an edge for
   * every role). Result: the position just computed was never saved, and
   * got recomputed from scratch on every read.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `connect` MUST BE THE CALLER'S OWN DECISION, NEVER A DEFAULT.                  │
   * │                                                                          │
   * │ A NEW worker gets wired: adding a person and then being unable to delegate       │
   * │ work to them is an action with no outcome, and the user has no way to guess       │
   * │ a wire is missing.                                                          │
   * │                                                                          │
   * │ A worker RESTORED from the archive does NOT get wired. Three reasons:            │
   * │  1. Wiring = joining the roster = entering the cached prefix of EVERY               │
   * │     conversation turn. Clicking "restore" must never silently re-enable a            │
   * │     cost that repeats for the entire run.                                        │
   * │  2. "Restore" and "allow taking work" are TWO different intents. One button        │
   * │     must not do both, especially when the second one costs money.                 │
   * │  3. The user may have DELIBERATELY unwired them before archiving. Auto-              │
   * │     rewiring would overwrite a decision they already made — and overwrite it       │
   * │     silently.                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  placeAgent(roleId: string, connect: boolean): void {
    const { layout } = this.read();
    const to = agentNodeId(roleId);
    if (!layout.nodes.some((n) => n.id === to)) return;
    if (connect && !layout.edges.some((e) => e.from === ASSISTANT_NODE && e.to === to)) {
      layout.edges.push({ from: ASSISTANT_NODE, to });
    }
    this.writeRaw(layout);
  }

  /** Removes a node from the layout (whether the yaml file itself gets deleted is the caller's decision). */
  dropAgent(roleId: string): void {
    if (!this.exists) return;
    const raw = this.readRaw();
    const id = agentNodeId(roleId);
    this.writeRaw({
      version: 1,
      nodes: raw.nodes.filter((n) => n.id !== id),
      edges: raw.edges.filter((e) => e.from !== id && e.to !== id),
      // Handed over whole; `writeRaw` drops the entry because the node is gone.
      // The deletion is not repeated here on purpose — one gate, one rule.
      ...(raw.cast ? { cast: raw.cast } : {}),
    });
  }

  // ── internal

  private readRaw(): LayoutFile {
    if (!this.exists) return { version: 1, nodes: [], edges: [], cast: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<LayoutFile>;
      return {
        version: 1,
        nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isNodeShape).slice(0, MAX_NODES) : [],
        edges: Array.isArray(raw.edges) ? raw.edges.filter(isEdgeShape) : [],
        cast: readCast(raw.cast),
      };
    } catch {
      // A broken layout.json must NOT crash the office — it's only view state.
      process.emitWarning('layout.json is unreadable; the canvas will lay itself out again.');
      return { version: 1, nodes: [], edges: [], cast: {} };
    }
  }

  /**
   * The ONE gate that writes to disk. Edges from an mcp node get filtered
   * here, so there's no way for one to slip into layout.json even if a
   * caller forgets — the "one fact, one home" invariant is held by structure, not discipline.
   */
  private writeRaw(layout: LayoutFile): void {
    const kindOf = new Map(layout.nodes.map((n) => [n.id, n.kind]));
    /**
     * ⚠ THE CAST IS PRUNED TO NODES THAT STILL EXIST, HERE, IN THE ONE GATE.
     *
     * Not in `dropAgent`. The same reasoning already written above this
     * function for mcp edges: a rule enforced at the single choke point cannot
     * be forgotten by a caller, while a rule enforced at each caller will be.
     *
     * What it prevents is not tidiness — it is a costume coming back from the
     * dead. Delete an employee for good, create a new one with the SAME NAME,
     * and the node id is identical (`agent:<slug>`); a surviving entry would
     * dress the new person as the old one. Same family as an office id that can
     * come back and inherit a dead office's ledger (`SPEC-offices.md` §3b).
     */
    const cast = pruneCast(layout.cast, kindOf.keys());
    const payload: LayoutFile = {
      version: 1,
      nodes: layout.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: Math.round(n.x),
        y: Math.round(n.y),
        ...(n.role ? { role: n.role } : {}),
        ...(n.server ? { server: n.server } : {}),
      })),
      edges: layout.edges.filter((e) => kindOf.get(e.from) !== 'mcp').map((e) => ({ from: e.from, to: e.to })),
      // Written only when somebody has actually chosen — an empty object in
      // every office's layout.json is noise in a file people read by hand.
      ...(Object.keys(cast).length ? { cast } : {}),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  /**
   * Edits exactly one key inside a yaml file.
   *
   * Uses parseDocument rather than parse+stringify: overwriting the whole
   * file would SWALLOW any comments the user wrote — and "yaml is hand-
   * editable, git diff stays readable" is one of the two reasons everything
   * isn't dumped into one JSON blob like n8n does.
   */
  private writeYamlKey(file: string | undefined, keyPath: string[], value: string[]): boolean {
    if (!file || !fs.existsSync(file)) return false;
    try {
      const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
      if (value.length) doc.setIn(keyPath, value);
      else doc.deleteIn(keyPath);
      // lineWidth 0: don't re-wrap values that weren't touched. Connecting
      // one MCP and having git diff jump 8 lines would break the user's
      // trust that "my file is still my file".
      fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
      return true;
    } catch {
      process.emitWarning(`Could not write ${keyPath.join('.')} into ${path.basename(file)}`);
      return false;
    }
  }

  private roleFile(roleId: string): string | undefined {
    if (!isSafeId(roleId)) return undefined;
    for (const ext of ['.yaml', '.yml']) {
      const f = path.join(this.office.paths.roles, `${roleId}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────── helpers

/**
 * The wiring rule, enforced on the SERVER.
 *
 * The canvas makes agent→agent PHYSICALLY IMPOSSIBLE (an agent node has no
 * outgoing port). But the UI is just a client — anyone can POST directly.
 * The economic rule (agent talking to agent = the single biggest token
 * sink) is only actually a rule once it's enforced here.
 */
function sanitizeEdges(raw: unknown, byId: ReadonlyMap<string, LayoutNode>): LayoutEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isEdgeShape(item)) continue;
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    if (!from || !to || from.id === to.id) continue;
    if (!CAN_CONNECT[from.kind]?.has(to.kind)) continue;
    const key = `${from.id} ${to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: from.id, to: to.id });
  }
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(' ') === [...b].sort().join(' ');
}

function clampCoord(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)));
}

function isNodeShape(v: unknown): v is LayoutNode {
  const n = v as Partial<LayoutNode>;
  return (
    !!n &&
    typeof n.id === 'string' &&
    n.id.length > 0 &&
    n.id.length < 200 &&
    (n.kind === 'assistant' ||
      n.kind === 'agent' ||
      n.kind === 'knowledge' ||
      n.kind === 'library' ||
      n.kind === 'mcp')
  );
}

function isEdgeShape(v: unknown): v is LayoutEdge {
  const e = v as Partial<LayoutEdge>;
  return !!e && typeof e.from === 'string' && typeof e.to === 'string';
}

/**
 * Drops every character choice whose node is gone. → `writeRaw`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS PREVENTS IS A COSTUME COMING BACK FROM THE DEAD.               │
 * │                                                                          │
 * │ Delete an employee for good, create a new one with the SAME NAME, and    │
 * │ the node id is identical (`agent:<slug>`). A surviving entry would dress  │
 * │ the new person as the old one — the same family as an office id that can │
 * │ come back and inherit a dead office's ledger (`SPEC-offices.md` §3b).    │
 * │                                                                          │
 * │ It is a named function rather than three lines inside `writeRaw` so that │
 * │ the rule can be TESTED rather than described. A rule locked by a comment │
 * │ is a rule that gets edited out.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function pruneCast(
  cast: Record<string, number> | undefined,
  alive: Iterable<string>,
): Record<string, number> {
  const live = new Set(alive);
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(cast ?? {})) {
    if (live.has(id) && isCastId(v)) out[id] = v;
  }
  return out;
}

/**
 * The stored cast, filtered to entries that name a character that EXISTS.
 * → `core/cast.ts §isCastId`
 *
 * A hand-edited `99`, or a row removed from `CAST` in a later version, must
 * fall back to the hash rather than render nothing: this is view state, and a
 * blank where a person should stand is worse than a face nobody picked.
 * Capped at `MAX_NODES` for the same reason the node list is.
 */
export function readCast(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(v as Record<string, unknown>).slice(0, MAX_NODES)) {
    if (isSafeNodeId(id) && isCastId(value)) out[id] = value;
  }
  return out;
}

/**
 * A node id shaped the way this file writes them (`assistant`, `agent:<role>`,
 * `mcp:<hash>`). Guards the ONE place where a client-supplied string becomes an
 * object KEY — `writeRaw` then prunes anything that does not match a real node,
 * so this is the belt to that brace, not the only line of defence.
 */
function isSafeNodeId(id: string): boolean {
  return id.length <= 80 && /^[a-z]+(:[a-z0-9][a-z0-9_-]*)?$/.test(id);
}
