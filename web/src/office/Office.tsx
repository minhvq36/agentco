import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ASSISTANT_SPOT,
  ownSpot,
  breakSpot,
  direct,
  type DirectAgent,
  type DirectLive,
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

  /** The people the loop should know about, and where each starts. */
  const roster = useMemo(() => {
    const list = agents.map((n, i) => ({ id: n.id, home: ownSpot(i, agents.length, n.id) }));
    return assistant ? [...list, { id: assistant.id, home: ASSISTANT_SPOT }] : list;
  }, [agents, assistant]);

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
    return direct({
      ...(assistant ? { assistantId: assistant.id } : {}),
      agents: directAgents,
      live: directLive,
      reading,
      at: (id) => st?.positionOf(id),
    });
  }, [agents, assistant, live, reading]);

  // ── hand the placement over to the loop.
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    st.sync(roster);
    for (const p of placements) {
      st.setLoiter(p.id, p.loiter);
      /**
       * Somebody already loitering keeps wandering: re-targeting them on every
       * render would restart the walk and nobody would ever arrive. Everyone
       * else is aimed at whatever the director just decided.
       */
      if (p.loiter && st.positionOf(p.id)) continue;
      st.setTarget(p.id, p.target);
    }
  }, [roster, placements]);

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

  const poseOf = useMemo(() => new Map(placements.map((p) => [p.id, p.pose])), [placements]);

  /**
   * ⚠ BACK-TO-FRONT. `ownSpot` gives a larger `y` as the index grows, so the
   * agent list is already ordered by depth, and the assistant — the closest
   * thing in the room — comes last. The renderer must not re-sort: a second
   * opinion about depth is a second opinion that can disagree.
   */
  const actors: ActorView[] = useMemo(() => {
    const view = (id: string, name: string, character: number, say: string | null, st?: LiveAgent): ActorView => ({
      id,
      name,
      character,
      pose: poseOf.get(id) ?? 'stand',
      ...(st?.status ? { status: st.status } : {}),
      say,
      glyph: placeGlyph(st?.at),
      selected: selected === id,
    });
    const list = agents.map((n) => {
      const role = n.role ?? '';
      const st = live[role];
      const say = recentReply?.role === role ? recentReply.text : (st?.say ?? null);
      return view(n.id, labelFor(role || n.id), n.character ?? 0, say, st);
    });
    if (assistant) list.push(view(assistant.id, assistant.label, assistant.character ?? 0, activity));
    return list;
  }, [agents, assistant, live, activity, recentReply, selected, poseOf]);

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
      room={{ armCount: arms.length, libraryCount: library?.count ?? 0 }}
      actors={actors}
      onOpen={(what) => {
        if (what === 'library') actions.showPanel('library');
        else if (what === 'artifacts') actions.showPanel('artifacts');
        else if (arms[0]) actions.select(arms[0].id);
      }}
      onSelect={actions.select}
    />
  );
}

const REPLY_HOLD = 9_000;

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
  if (place === 'web') return '🌐';
  if (place === 'shell') return '›_';
  return '';
}

/** Re-exported so the fallback drawing's home is reachable from one place. */
export { breakSpot };
