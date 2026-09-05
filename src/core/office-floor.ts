/**
 * THE FLOOR PLAN, AND THE RULE THAT DECIDES WHO STANDS WHERE.
 * → docs/SPEC-office-animation.md §5 · §6e · §14
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS LIVES IN `core/` AND NOT IN THE INTERFACE.                      │
 * │                                                                          │
 * │ Two reasons, and the second is the heavier one:                          │
 * │                                                                          │
 * │  1. It is PURE — no DOM, no React, no drawing. Same as                   │
 * │     `layout-geometry.ts`, which the interface already imports through    │
 * │     `@core` for exactly this reason: two copies of one table drift.      │
 * │                                                                          │
 * │  2. 🔴 `direct()` IS THE HONESTY LAYER, and it was living inside a       │
 * │     `useEffect`. A rule that decides *"this worker walks to the          │
 * │     bookshelf"* is a rule that can state something that never happened,  │
 * │     and it was sitting in the one place `node --test` cannot reach.      │
 * │     This repository has already written that lesson down once —          │
 * │     *"when an important rule lives in a function no test can touch, the  │
 * │     real debt is the SHAPE OF THE CODE, not the missing test"* (the      │
 * │     `buildPlan` case). Same shape, same fix.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE — no `node:*`, no disk, no `process`.
 */

import { hash32 } from './cast.js';
import type { WorkPlace } from './types.js';

export interface Point {
  x: number;
  y: number;
}

export const WORLD = { w: 1600, h: 900 };

/**
 * Feet-to-head. EVERYTHING else in the room is sized against this.
 *
 * ⚠ It went 70 → 133 when the cast stopped being chibi, and the furniture had
 * to follow in the same change. A 70-unit person in a 1600-unit room is
 * twenty-three people wide — that is a warehouse, and it is why the first cut
 * read as toys scattered on a floor rather than as an office.
 */
export const CH_H = 133;

/** The back wall meets the floor here. Anything against the wall has its base on it. */
export const HORIZON = 360;

export type StationId = 'library' | 'artifacts' | 'arm';

export interface Station {
  id: StationId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY EACH STATION IS WHERE IT IS — none of it is decoration.              │
 * │                                                                          │
 * │ BOOKSHELF back-LEFT   the least dynamic station, and the left edge is    │
 * │                       what the sidebar overlays (§11b)                   │
 * │ ARM BENCH  back-RIGHT the only station that reaches OUTSIDE the office;  │
 * │                       against the back wall, farthest from the viewer    │
 * │ FILING DESK mid-right within a short walk of the assistant, because the  │
 * │                       hand-off beat between them is the one moment a     │
 * │                       worker really does report back (§6d)               │
 * │ ASSISTANT  centre-front, facing the viewer: its counterpart is the USER, │
 * │                       not the workers. It never walks — with three tasks │
 * │                       running at once it would have to be in three       │
 * │                       places, and the person you talk to must not be     │
 * │                       something you have to hunt for.                    │
 * │ BREAK AREA front-right, the only place with chairs                       │
 * │                                                                          │
 * │ The shared knowledge store is DELIBERATELY not a station. It has no      │
 * │ wires on the diagram for the same reason — it is the environment, not a  │
 * │ relationship — and a shelf nobody ever walks to would teach the opposite.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const STATIONS: Record<StationId, Station> = {
  library: { id: 'library', x: 96, y: 152, w: 262, h: HORIZON - 152 },
  arm: { id: 'arm', x: 1108, y: 226, w: 312, h: HORIZON - 226 },
  artifacts: { id: 'artifacts', x: 930, y: 432, w: 268, h: 116 },
};

/** Centre-front. The assistant stands here and does not leave. */
export const ASSISTANT_SPOT: Point = { x: 596, y: 838 };

export const BREAK_AREA = { x: 1016, y: 588, w: 546, h: 296 };

/**
 * Which station a place sends somebody to. → SPEC-office-animation §6e
 *
 * ⚠ Three places map to NO STATION on purpose:
 *  · `knowledge` — the shared store is the environment, not an object.
 *  · `web` / `shell` — real, and both reach OUTSIDE the office. The arm bench
 *    means "a connection the user plugged in and can unplug", which these are
 *    not; and inventing a window would teach a symbol that appears nowhere
 *    else in the product. They work from where they stand, with a glyph.
 */
export const STATION_OF: Record<WorkPlace, StationId | undefined> = {
  library: 'library',
  artifacts: 'artifacts',
  arm: 'arm',
  knowledge: undefined,
  desk: undefined,
  web: undefined,
  shell: undefined,
};

/**
 * Where somebody stands at a station: a RING of slots in front and to the
 * sides — never behind, so nobody ever turns their back to the viewer.
 */
export function ringSlots(s: Station): Point[] {
  const cx = s.x + s.w / 2;
  const foot = s.y + s.h + 34;
  return [
    { x: cx, y: foot + 10 },
    { x: cx - 92, y: foot },
    { x: cx + 92, y: foot },
    { x: s.x - 44, y: foot + 34 },
    { x: s.x + s.w + 44, y: foot + 34 },
    { x: cx, y: foot + 78 },
  ];
}

/**
 * Picks the free slot NEAREST to where the walker is standing right now.
 *
 * Nearest, not first: it makes the approach direction depend on where somebody
 * came from, so the same trip never looks identically choreographed twice — and
 * it costs one comparison. Every slot taken ⇒ stop at the ring's edge rather
 * than stack two people on one spot.
 */
export function nearestFreeSlot(s: Station, from: Point, taken: readonly Point[]): Point {
  const slots = ringSlots(s);
  let best: Point | undefined;
  let bestD = Infinity;
  for (const slot of slots) {
    if (taken.some((p) => Math.abs(p.x - slot.x) < 1 && Math.abs(p.y - slot.y) < 1)) continue;
    const d = (slot.x - from.x) ** 2 + (slot.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return best ?? { x: s.x + s.w / 2, y: s.y + s.h + 96 };
}

/**
 * ⚠ Sized against `CH_H`, not chosen by eye. A column narrower than a person is
 * wide, or a row shorter than a person is tall, and the arc turns into a pile.
 */
const PER_ROW = 4;
const COL = 178;
const ROW = 152;

/**
 * A worker's own spot on the floor — where they stand when they are working but
 * not at any station, and where they return to when released.
 *
 * ⚠ A LOOSE ARC WITH SEEDED JITTER, NOT A GRID. A row of evenly spaced people
 * reads as furniture. The jitter is seeded from the id rather than random, so
 * nobody teleports between two paints — a random offset per render is a person
 * who cannot stand still.
 */
export function ownSpot(index: number, total: number, seed: string): Point {
  const row = Math.floor(index / PER_ROW);
  const inRow = index % PER_ROW;
  const wide = Math.min(PER_ROW, total - row * PER_ROW);
  const x = 520 - ((wide - 1) * COL) / 2 + inRow * COL;
  const y = 546 + row * ROW;
  const h = hash32(`spot:${seed}`);
  // A shallow arc: the middle of a row stands a little further back, so the row
  // curves toward the viewer at its ends instead of ruling a straight line.
  const arc = wide > 1 ? Math.cos((inRow / (wide - 1) - 0.5) * Math.PI) * 26 : 0;
  return { x: x + ((h % 41) - 20), y: y - arc + (((h >> 8) % 25) - 12) };
}

/**
 * A loitering spot inside the break area.
 *
 * `step` advances every time somebody picks a new place to stand, so the same
 * person moves around rather than oscillating between two points — and it stays
 * seeded, so a reload puts everybody back exactly where they were.
 */
export function breakSpot(seed: string, step: number): Point {
  const h = hash32(`break:${seed}:${step}`);
  const pad = 46;
  return {
    x: BREAK_AREA.x + pad + (h % (BREAK_AREA.w - pad * 2)),
    y: BREAK_AREA.y + pad + ((h >> 9) % (BREAK_AREA.h - pad * 2)),
  };
}

/** Which of the four games this person plays. Stable, so the room has a memory. */
export function breakGame(seed: string): 0 | 1 | 2 | 3 {
  return (hash32(`game:${seed}`) % 4) as 0 | 1 | 2 | 3;
}

/** How long until this person wanders again: 6–14s, seeded so nobody moves in lockstep. */
export function idleDelay(seed: string, step: number): number {
  return 6000 + (hash32(`wait:${seed}:${step}`) % 8000);
}

// ────────────────────────────────────────────────────────────── the director

/** What the room knows about one person. Deliberately NOT a `CanvasNode`. */
export interface DirectAgent {
  /** The node id — the identity the whole scene uses. */
  id: string;
  /** The role id, which is what `live` is keyed by. */
  role: string;
  /** Wired from the assistant ⇒ gets given work. No wire ⇒ resting. */
  connected: boolean;
}

/** The live state of one person, narrowed to what placement actually reads. */
export interface DirectLive {
  status: 'working' | 'done' | 'error';
  /** WHERE the last tool call landed. `undefined` = no place was observed. */
  at?: WorkPlace;
  /** Files the finished task produced. Only meaningful with `status: 'done'`. */
  artifacts?: number;
}

export interface DirectInput {
  /** Absent only in the moment before the office has loaded. */
  assistantId?: string;
  /** ⚠ MUST already be in a stable order — the arc of standing spots follows it. */
  agents: readonly DirectAgent[];
  live: Readonly<Record<string, DirectLive>>;
  /** The assistant's hidden worker, if it is running. */
  reading: 'library' | 'web' | null;
  /**
   * Where somebody is standing RIGHT NOW, so a ring can pick the slot nearest
   * to them. Absent ⇒ they have not been placed yet and their home is used.
   */
  at(id: string): Point | undefined;
}

export interface Placement {
  id: string;
  target: Point;
  /** Wander around the break area on a timer rather than standing still. */
  loiter: boolean;
  /** Chairs exist only in the break area, so this is the only place `sit` comes from. */
  pose: 'stand' | 'sit';
}

/**
 * WHO SHOULD BE WHERE — the whole placement rule, as one pure function.
 * → docs/SPEC-office-animation.md §6e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING HERE IS INFERRED FROM TEXT. Every branch reads a field a machine  │
 * │ wrote: `at` from the tool call, `artifacts` from the receipt, `connected` │
 * │ from the wire, `reading` from the office. `say` is never consulted — it   │
 * │ has two authors and it goes through i18n, so a rule that reads it works   │
 * │ in exactly the language it was written in.                               │
 * │                                                                          │
 * │ ⚠ `at: undefined` MEANS NO PLACE, never a default place. A turn that      │
 * │ called no tool must leave somebody exactly where they are; substituting   │
 * │ a station would make the picture claim something nobody observed.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function direct(input: DirectInput): Placement[] {
  const out: Placement[] = [];
  const taken: Point[] = [];

  const slot = (id: StationId, from: Point): Point => {
    const p = nearestFreeSlot(STATIONS[id], from, taken);
    taken.push(p);
    return p;
  };

  if (input.assistantId) {
    const from = input.at(input.assistantId) ?? ASSISTANT_SPOT;
    /**
     * The assistant walks for EXACTLY ONE reason: its hidden worker is reading
     * documents. Everything else — thinking, planning, searching the web,
     * reporting — happens at centre-front, facing the viewer. §6d
     */
    out.push({
      id: input.assistantId,
      target: input.reading === 'library' ? slot('library', from) : ASSISTANT_SPOT,
      loiter: false,
      pose: 'stand',
    });
  }

  input.agents.forEach((agent, i) => {
    const state = input.live[agent.role];
    const home = ownSpot(i, input.agents.length, agent.id);
    const from = input.at(agent.id) ?? home;

    // Resting = on the diagram but not wired, and not currently working. The
    // same source the diagram already prints the word "resting" from, so the
    // two views cannot disagree.
    if (!agent.connected && !state) {
      out.push({ id: agent.id, target: breakSpot(agent.id, 0), loiter: true, pose: 'sit' });
      return;
    }

    if (state?.status === 'working') {
      const station = STATION_OF[state.at ?? 'desk'];
      out.push({
        id: agent.id,
        target: station ? slot(station, from) : home,
        loiter: false,
        pose: 'stand',
      });
      return;
    }

    /**
     * The hand-off beat: a finished task WITH files to show walks them to the
     * filing desk and puts them down. With nothing to put down (a
     * `deliver: reply` task) it hands off from where it stands.
     *
     * No timer ends the beat — the display clears `done` on its own after a few
     * seconds, and the next call of this function sends them home. One
     * lifetime, one owner.
     */
    if (state?.status === 'done' && (state.artifacts ?? 0) > 0) {
      out.push({ id: agent.id, target: slot('artifacts', from), loiter: false, pose: 'stand' });
      return;
    }

    out.push({ id: agent.id, target: home, loiter: false, pose: 'stand' });
  });

  return out;
}
