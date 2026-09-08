import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ASSISTANT_SPOT,
  dealOpeningSpots,
  dealSeats,
  direct,
  pickIdleSpot,
  releasedFromRest,
  walkersAtOpen,
  type DirectAgent,
  type DirectLive,
  type Placement,
  type Point,
} from '@core/office-floor';

import { actions, labelFor, useApp, type LiveAgent } from '@/lib/store';
import type { WorkPlace } from '@/lib/types';

import { Stage } from './motion';
import { DomScene } from './renderers/dom/DomScene';
import type { ActorView, SceneHandle } from './scene';

/**
 * THE OFFICE VIEW — the same office, drawn as a room.
 * → docs/SPEC-office-animation.md
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IS AN ORCHESTRATOR. IT DRAWS NOTHING.                          │
 * │                                                                          │
 * │   the STORE      says what is true          (SSE, already deterministic) │
 * │   `direct()`     says who should be where   (pure, in core, TESTED)      │
 * │   `Stage`        moves them there           (no DOM, no React)           │
 * │   a RENDERER     draws it                   (one adapter, swappable)     │
 * │                                                                          │
 * │ Four boxes, one direction of travel, and only the last one knows what a  │
 * │ pixel is. Two rounds of the art being thrown out cost nothing above that │
 * │ line — which is the whole reason the line is drawn here.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ READ-ONLY FOR THE SHAPE, CLICKABLE FOR THE DOORS. (§10)                  │
 * │                                                                          │
 * │ Nothing here adds, deletes, wires or drags — the rule that makes         │
 * │ agent→agent impossible is expressed by PORTS, and there is no honest way │
 * │ to draw that in a room full of people. But every object opens the panel  │
 * │ it stands for, through handlers that already exist.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export default function Office() {
  const canvas = useApp((s) => s.canvas);
  const live = useApp((s) => s.live);
  const reading = useApp((s) => s.assistantReading);
  const activity = useApp((s) => s.activity);
  const selected = useApp((s) => s.selected);
  const messages = useApp((s) => s.messages);

  const scene = useRef<SceneHandle | null>(null);
  const stage = useRef<Stage | null>(null);
  if (!stage.current) stage.current = new Stage();

  useEffect(() => {
    const st = stage.current;
    return () => st?.destroy();
  }, []);

  const nodes = canvas?.nodes ?? [];
  const assistant = nodes.find((n) => n.kind === 'assistant');
  /**
   * Sorted by id so the arc of standing spots is stable: hiring somebody must
   * not shuffle everyone already standing there. The same reasoning as hashing
   * a colour rather than storing one. `direct()` relies on this order.
   */
  const agents = useMemo(
    () => nodes.filter((n) => n.kind === 'agent').sort((a, b) => a.id.localeCompare(b.id)),
    [nodes],
  );
  const arms = useMemo(() => nodes.filter((n) => n.kind === 'mcp'), [nodes]);
  const library = nodes.find((n) => n.kind === 'library');

  /**
   * An answer a worker sent STRAIGHT to the user (`deliver: reply`) belongs in
   * THAT worker's bubble, not the assistant's. It is the one visible difference
   * between the two delivery shapes, and it costs nothing — the message is
   * already in the stream, carrying the employee's own id as `role`.
   */
  const [replyTick, setReplyTick] = useState(0);
  const recentReply = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user' || last.role === 'assistant') return null;
    if (Date.now() - last.at > REPLY_HOLD) return null;
    return { role: last.role, text: last.text };
    // `replyTick` is the timer that makes this expire — see the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, replyTick]);

  useEffect(() => {
    if (!recentReply) return;
    const id = setTimeout(() => setReplyTick((n) => n + 1), REPLY_HOLD + 60);
    return () => clearTimeout(id);
  }, [recentReply]);

  /**
   * 🔴 WHO GETS A BREAK SEAT — DEALT ONCE PER MOUNT. → SPEC §17c
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ A REF, NOT STATE, AND THE MUTATION SITS INSIDE A `useMemo`.            │
   * │                                                                          │
   * │ That is normally the wrong shape, so here is why it is right: the deal   │
   * │ is IDEMPOTENT given what it has already dealt. `dealSeats` keeps every   │
   * │ prior entry and only fills what is empty, so a second call — React's     │
   * │ StrictMode double-invoke, a re-render, anything — returns the same map.  │
   * │ Randomness enters exactly once per person, the first time they need a    │
   * │ seat, and never again.                                                   │
   * │                                                                          │
   * │ ⚠ `Math.random`, NOT a hash of the roster. A hash would look random and  │
   * │ be constant forever: the same six faces on every reload, for the life of │
   * │ the office. → `core/office-floor.ts §dealSeats`                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const seatsRef = useRef<Record<string, number>>({});

  /**
   * 🔴 WHERE THE IDLE START, THIS TIME THE VIEW WAS OPENED. → SPEC §17l
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A RELOAD IS THE ARC; A TOGGLE IS A FRESH DEAL. THE USER SET BOTH HALVES. │
   * │                                                                          │
   * │ *"I do not want every toggle to go back to the default line-up … but F5  │
   * │ is default."* Those are two different answers to one question, so the    │
   * │ code has to be able to tell the two events apart — and the only          │
   * │ difference between them is that a reload throws this MODULE away.        │
   * │ `OPENED` is therefore the whole mechanism: false exactly once per page   │
   * │ load, true for every toggle after it. No storage, nothing to expire.     │
   * │                                                                          │
   * │ ⚠ IN DEV, STRICTMODE SPENDS THE FIRST OPEN. It mounts, unmounts and      │
   * │ mounts again, so the reload after a `dev:web` refresh takes the TOGGLE   │
   * │ branch and the room opens scattered. Production builds do not double-    │
   * │ mount. Stated rather than worked around: the workaround would be a       │
   * │ second flag whose only job is to be wrong in the other environment.      │
   * │                                                                          │
   * │ ⚠ THE REF IS FILLED DURING RENDER, and the guard is what makes that      │
   * │ safe — exactly the argument `seatsRef` above already makes. The deal is  │
   * │ taken once and every later invocation reads the same map, so a           │
   * │ re-render cannot move somebody who is already standing somewhere.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const openRef = useRef<Record<string, Point> | null>(null);

  const placements = useMemo(() => {
    const st = stage.current;
    const directAgents: DirectAgent[] = agents.map((n) => ({
      id: n.id,
      role: n.role ?? '',
      connected: n.connected,
    }));
    const directLive: Record<string, DirectLive> = {};
    for (const [role, l] of Object.entries(live)) {
      directLive[role] = { status: l.status, ...(l.at ? { at: l.at } : {}), artifacts: l.artifacts ?? 0 };
    }
    // ⚠ The same test `direct()` applies: on the diagram, not wired, and not
    // currently working. Two definitions of "resting" would seat somebody the
    // director then sends to a station.
    const resting = agents.filter((n) => !n.connected && !live[n.role ?? '']).map((n) => n.id);
    seatsRef.current = dealSeats(
      agents.map((n) => n.id),
      resting,
      seatsRef.current,
      Math.random,
    );
    const out = direct({
      ...(assistant ? { assistantId: assistant.id } : {}),
      agents: directAgents,
      live: directLive,
      reading,
      seats: seatsRef.current,
      at: (id) => st?.positionOf(id),
    });

    /**
     * ⚠ THE DEAL IS TAKEN ON THE FIRST PASS AND NEVER AGAIN, and `roam` is what
     * it is taken over: `direct()` already answers *"is this person free to
     * stand anywhere"*, so asking the same question a second way here would be
     * a second opinion that can disagree with the director.
     *
     * On a reload `openRef` stays an empty map — every roamer keeps the arc
     * position `direct()` gave them, which is the default the user asked to see
     * after F5.
     */
    // ⚠ `out.length > 0`: the first pass can legitimately see an office with
    // nobody in it yet, and spending the one-per-page-load flag on that pass
    // would make every real reload take the TOGGLE branch.
    if (!openRef.current && out.length > 0) {
      const first = !OPENED;
      OPENED = true;
      openRef.current = first
        ? {}
        : dealOpeningSpots(
            out.filter((p) => p.roam).map((p) => p.id),
            Math.random,
          );
    }
    const opening = openRef.current ?? {};
    return out.map((p): Placement =>
      p.roam && opening[p.id] ? { ...p, target: opening[p.id]! } : p,
    );
  }, [agents, assistant, live, reading]);

  /**
   * The people the loop should know about, and where each STARTS.
   *
   * ⚠ HOME IS THE PLACEMENT, NOT `ownSpot`. `Stage.sync` puts somebody at their
   * home the first time it sees them — deliberately, so nobody animates an
   * arrival that never happened — and with `ownSpot` as home, six resting people
   * appeared on the working floor and then walked into the break area every time
   * the view was opened. A resting person's home IS their seat. → §17c
   */
  const roster = useMemo(() => placements.map((p) => ({ id: p.id, home: p.target })), [placements]);

  // ── hand the placement over to the loop.
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    st.sync(roster);
    /**
     * ⚠ NO `setLoiter` ANY MORE, AND NO "leave the wanderers alone" BRANCH.
     * Every placement is now a fixed point — a break seat is as fixed as a ring
     * slot — so re-targeting somebody who is already there is a no-op the loop
     * absorbs, and there is nothing left to make an exception for.
     */
    // ⚠ Nobody off screen is given a target. They stay in the loop's map so they
    // come back where they left, but re-aiming a body nothing draws would spin
    // the rAF for an animation with no viewer — the one cost an idle office is
    // not allowed to have.
    for (const p of placements) {
      if (p.rest === 'offscreen') continue;
      /**
       * ⚠ ROAMING AND A TARGET ARE MUTUALLY EXCLUSIVE, EVERY TIME.
       *
       * `setRoam(false)` cancels the pending trip and pins the body where it is,
       * so the `setTarget` beside it is the only thing that can move them —
       * which is §17e: a worker handed a task stops on the spot. Setting a
       * target on somebody still roaming would leave two owners of one
       * destination, and the timer would win a second later.
       */
      st.setRoam(p.id, !!p.roam);
      if (!p.roam) st.setTarget(p.id, p.target);
    }
  }, [roster, placements]);

  /**
   * WHERE A WANDERING WORKER GOES NEXT. → SPEC-office-animation.md §17f⑤
   *
   * Three owners, and the split is deliberate: `direct()` says WHETHER somebody
   * may wander, `Stage` says WHEN, and this hands the loop the one pure function
   * that says WHERE. The choice is the rule that can put a body inside a wall,
   * so it lives in `core` where `node --test` can reach it — the same debt
   * `direct()` itself was moved out of a `useEffect` to pay.
   */
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    st.idleSpot = (id) => pickIdleSpot(id, st.world(), Math.random);
    return () => {
      st.idleSpot = undefined;
    };
  }, []);

  /**
   * 🔴 A FEW PEOPLE ARE ALREADY ON THE MOVE WHEN THE ROOM OPENS. → SPEC §17l
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ IT MUST RUN AFTER THE EFFECT ABOVE, AND THAT IS WHY IT IS BELOW IT.    │
   * │                                                                          │
   * │ `nudge` asks `st.idleSpot` where to go, and `idleSpot` is installed by   │
   * │ the effect above. React runs effects in declaration order, so writing    │
   * │ this one first would give every opening walker `undefined` — no target,  │
   * │ no walk, and nothing to say so. The dependency is real; the ordering is  │
   * │ the only thing expressing it.                                            │
   * │                                                                          │
   * │ ⚠ IT WAITS FOR SOMEBODY TO BE FREE. `once` is only spent once there IS   │
   * │ at least one roamer, so an office whose employees are all mid-task when  │
   * │ the view opens still gets its opening walk the moment one of them is     │
   * │ released — rather than silently skipping it because the first placement  │
   * │ happened to arrive busy.                                                 │
   * │                                                                          │
   * │ ⚠ A SHUFFLED PREFIX, NOT A DIE PER PERSON. `walkersAtOpen` returns a     │
   * │ COUNT; rolling one-in-five per head would produce an office that is      │
   * │ sometimes completely still, which is the outcome this exists to prevent. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const opened = useRef(false);
  useEffect(() => {
    const st = stage.current;
    if (!st || opened.current) return;
    const free = placements.filter((p) => p.roam).map((p) => p.id);
    if (free.length === 0) return;
    opened.current = true;
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j]!, free[i]!];
    }
    for (const id of free.slice(0, walkersAtOpen(free.length))) st.nudge(id);
  }, [placements]);

  /**
   * 🔴 A WIRE JUST PLUGGED IN ⇒ THAT PERSON LEAVES THE BREAK AREA NOW.
   * → `core/office-floor §releasedFromRest`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ IT MUST RUN AFTER THE TWO EFFECTS ABOVE, AND THAT IS WHY IT IS BELOW   │
   * │ THEM — the same dependency the opening walk already has, one step        │
   * │ longer. `nudge` refuses anybody not roaming, and `roam` is set by the    │
   * │ placement effect; it also asks `st.idleSpot`, which the effect after     │
   * │ that one installs. Declared first, this would silently do nothing at     │
   * │ all: no target, no walk, and nothing to say so.                          │
   * │                                                                          │
   * │ ⚠ REDUCED MOTION IS SILENT HERE THROUGH THE SAME GATE, not a second      │
   * │ check: `setRoam` refuses to set `roam` at all, so `nudge` returns.       │
   * │                                                                          │
   * │ ⚠ AND `nudge` IS ALL IT DOES. The trip is the ordinary idle trip — same  │
   * │ chooser, same cadence afterwards — because "the room found them a place  │
   * │ to stand" and "the room walked them out of the break area" are the same  │
   * │ event, and giving the second one its own kind of walk is the second      │
   * │ mechanism this loop has already deleted once (`breakSpot`).              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const wasResting = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    const { go, resting } = releasedFromRest(wasResting.current, placements);
    wasResting.current = resting;
    for (const id of go) st.nudge(id);
  }, [placements]);

  /**
   * THE TWO TOKENS, fired off STATE TRANSITIONS — no new events needed.
   *
   * `task.done` is the ONE moment a worker really reports to the assistant: the
   * receipt. The architecture forbids agents talking to agents, so there is no
   * stream to draw, only this beat. → §6d
   */
  const prevLive = useRef<Record<string, LiveAgent>>({});
  useEffect(() => {
    const st = stage.current;
    const sc = scene.current;
    if (!st || !sc || !assistant) {
      prevLive.current = live;
      return;
    }
    const at = st.positionOf(assistant.id) ?? ASSISTANT_SPOT;
    for (const node of agents) {
      const role = node.role ?? '';
      const before = prevLive.current[role]?.status;
      const now = live[role]?.status;
      if (before === now) continue;
      const here = st.positionOf(node.id);
      if (!here) continue;
      if (now === 'working' && before === undefined) sc.token(at, here, 'brief');
      if (now === 'done' || now === 'error') sc.token(here, at, 'receipt');
    }
    prevLive.current = live;
  }, [live, agents, assistant]);

  /**
   * WHO IS WALKING — tracked in React **only when a renderer needs telling**.
   *
   * A drawing that swings its legs from a CSS class never involves React, which
   * is what keeps an idle office at zero renders. A player that must be told
   * which clip to run pays one re-render per trip. Wiring this unconditionally
   * would make the cheap path pay for a feature it does not use.
   */
  const [, setWalkTick] = useState(0);
  useEffect(() => {
    const st = stage.current;
    if (!st || !NEEDS_WALK_STATE) return;
    st.onWalk = () => setWalkTick((n) => n + 1);
    return () => {
      st.onWalk = undefined;
    };
  }, []);

  /**
   * ⚠ THE PLACEMENT IS THE ONLY AUTHORITY ON WHO APPEARS. `direct()` hands back
   * one entry per person and marks the seventh resting employee `hidden`, so
   * this map answers both *what pose* and *are they drawn at all* from one read.
   * Deciding the second question here from `pose` or from a count would be a
   * second opinion, and two opinions disagree. → `core/office-floor §BREAK_CAPACITY`
   */
  const placed = useMemo(
    () => new Map(placements.filter((p) => p.rest !== 'offscreen').map((p) => [p.id, p.pose])),
    [placements],
  );
  /** Resting INCLUDING the ones not drawn — the summary describes the office, not the picture. */
  const resting = useMemo(() => placements.filter((p) => p.rest).length, [placements]);

  /**
   * ⚠ BACK-TO-FRONT. `ownSpot` gives a larger `y` as the index grows, so the
   * agent list is already ordered by depth, and the assistant — the closest
   * thing in the room — comes last. The renderer must not re-sort: a second
   * opinion about depth is a second opinion that can disagree.
   */
  const actors: ActorView[] = useMemo(() => {
    const view = (
      id: string,
      name: string,
      character: number,
      say: string | null,
      tint: string | undefined,
      st?: LiveAgent,
    ): ActorView => ({
      id,
      name,
      character,
      // ⚠ Spread conditionally: `tint: undefined` and no key at all are the same
      // to a reader and not to `exactOptionalPropertyTypes`.
      ...(tint ? { tint } : {}),
      pose: placed.get(id) ?? 'stand',
      ...(st?.status ? { status: st.status } : {}),
      say,
      glyph: placeGlyph(st?.at),
      selected: selected === id,
    });
    const list = agents
      // Everybody past the sixth break seat is left out of the picture entirely.
      // They are still on the diagram, still counted as resting in the summary —
      // this is the one view that stops at six. → `BREAK_CAPACITY`
      .filter((n) => placed.has(n.id))
      .map((n) => {
        const role = n.role ?? '';
        const st = live[role];
        const say = recentReply?.role === role ? recentReply.text : (st?.say ?? null);
        return view(n.id, labelFor(role || n.id), n.character ?? 0, say, n.tint, st);
      });
    // ⚠ The assistant is LAST, and that is now the whole of its privilege: it
    // sorts by `y` like everybody else (§17d′ removed `onTop`), and being last
    // only breaks a tie between two bodies standing on the same line.
    if (assistant) {
      list.push(view(assistant.id, assistant.label, assistant.character ?? 0, activity, assistant.tint));
    }
    return list;
  }, [agents, assistant, live, activity, recentReply, selected, placed]);

  useEffect(() => {
    // A renderer that just mounted knows nobody's position yet. One repaint
    // rather than waiting for the next thing to move — otherwise everybody
    // stands at the origin until somebody happens to get a task.
    stage.current?.repaint();
  }, [actors.length]);

  if (!canvas) return null;

  return (
    <DomScene
      ref={(h) => {
        scene.current = h;
        if (stage.current) stage.current.sink = h;
        stage.current?.repaint();
      }}
      room={{ armCount: arms.length, libraryCount: library?.count ?? 0, resting }}
      actors={actors}
      onOpen={(what) => actions.showPanel(what === 'library' ? 'library' : 'artifacts')}
      onSelect={actions.select}
    />
  );
}

const REPLY_HOLD = 9_000;

/**
 * 🔴 HAS THE ROOM BEEN OPENED YET, THIS PAGE LOAD? → SPEC §17l · `openRef`
 *
 * The one bit that separates *"the user came back from the diagram"* from *"the
 * user reloaded"*, and it is deliberately the cheapest thing that can tell them
 * apart: module state dies with the page and survives a toggle, which is exactly
 * the shape of the question. Anything durable — `sessionStorage`, the server —
 * would survive F5 too and answer the wrong one.
 */
let OPENED = false;

/**
 * Does the active renderer have to be TOLD when somebody starts walking?
 *
 * The DOM renderer does not — the loop toggles a class and CSS does the rest.
 * A player driven by clips does. Declared here as one constant so the cheap
 * path stays measurably cheap. → `motion.ts §onWalk`
 */
const NEEDS_WALK_STATE = false;

/** A glyph for the two places that have no station of their own. */
function placeGlyph(place: WorkPlace | undefined): string {
  if (place === 'web') return '';
  if (place === 'shell') return '›_';
  return '';
}

