import { hash32 } from '@core/cast';
import { type Point } from '@core/office-floor';

import type { SceneHandle } from './scene';

/**
 * THE MOVEMENT LOOP. → docs/SPEC-office-animation.md §7 · §12
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT KNOWS NOTHING ABOUT DRAWING, AND THAT IS THE POINT.                   │
 * │                                                                          │
 * │ It used to hold an `SVGGElement` per actor and write `transform` onto it. │
 * │ That worked for two adapters and would have broken the third: a 3D scene  │
 * │ has no element per person. The leak is closed — the loop owns POSITIONS   │
 * │ and hands them to a `SceneHandle`, which is the only thing that knows     │
 * │ what a position means on screen. → `scene.ts`                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AND IT SLEEPS. That is the difference between an office that feels alive │
 * │ and a laptop fan that never stops.                                       │
 * │                                                                          │
 * │  · nothing moving        ⇒ the rAF is CANCELLED, not left spinning       │
 * │  · tab hidden            ⇒ everything stops                              │
 * │  · reduced motion        ⇒ no walking; positions are set directly        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 A TIMER CAME BACK, AND THE REASON IT WAS REMOVED STILL STANDS.        │
 * │ → docs/SPEC-office-animation.md §17g                                     │
 * │                                                                          │
 * │ This loop used to hold a `setTimeout` chain for BREAK-AREA wandering: a  │
 * │ random point re-rolled every 6–14 s, so an office where everybody was    │
 * │ resting still woke up forever. It was deleted because it spent the       │
 * │ room's only vocabulary for WORK on nothing — an idle office looked busy. │
 * │                                                                          │
 * │ What is different this time, and it is the whole difference:             │
 * │                                                                          │
 * │  · ⚠ RESTING PEOPLE NEVER GET A TIMER. The break area stays completely   │
 * │    still — seats are dealt once and nobody in one ever moves (§17c). An  │
 * │    office where everybody is resting still reaches a genuine standstill. │
 * │  · only a WIRED worker with no task roams, i.e. somebody the office      │
 * │    genuinely has on the floor waiting for work                           │
 * │  · 45 s, not 6–14: the user's number, and it is quiet enough that a trip │
 * │    still reads as an event rather than as background churn               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** World units per second. A person crossing an office, not a courier. */
const SPEED = 60;

/** Below this, "arrived". Chasing the last half-unit keeps the loop awake forever. */
const EPS = 1.2;

/**
 * How long an idle worker holds still before moving. The user's number.
 *
 * ⚠ AND THE TRIP HAS NO DURATION OF ITS OWN — *"it depends on the distance from
 * source to destination"*. That is the rule `SPEED` has always carried for the
 * walk; this is the same rule applied to the thing that schedules it.
 */
const IDLE_HOLD = 45_000;

interface Actor {
  id: string;
  /** Hash seed — the id, so a reload puts everybody back where they were. */
  seed: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  walking: boolean;
  /** Wired, no task: free to wander. → `core/office-floor §Placement.roam` */
  roam: boolean;
  /** The pending idle trip. 0 = nothing scheduled. */
  timer: number;
  /** Has this person already made one idle trip? Decides the FIRST delay. */
  moved: boolean;
}

export class Stage {
  private readonly actors = new Map<string, Actor>();
  private raf = 0;
  private last = 0;
  private reduced = false;
  private hidden = false;
  private detach: Array<() => void> = [];

  /** Where positions go. Set by the scene once it has mounted its renderer. */
  sink: SceneHandle | null = null;

  /**
   * Somebody started or stopped walking.
   *
   * ⚠ SET ONLY WHEN AN EXTERNAL PLAYER NEEDS IT. A drawing that walks from a
   * CSS class never involves React, which is what keeps an idle office at zero
   * renders. A player that must be TOLD which clip to run pays one re-render
   * per trip; leaving this `undefined` keeps the cheap path cheap.
   */
  onWalk?: (id: string, walking: boolean) => void;

  /**
   * Where should this idle person go next? → `core/office-floor §pickIdleSpot`
   *
   * ⚠ THE LOOP DOES NOT CHOOSE. It owns WHEN, `core` owns WHERE, and `direct()`
   * owns WHETHER. Putting the choice in here would bury the one rule that can
   * put somebody inside a wall in the one file `node --test` cannot reach — the
   * `direct()` lesson, one layer down.
   *
   * `null` ⇒ everywhere is taken. Stay put and try again after the next hold.
   */
  idleSpot?: (id: string) => Point | null;

  constructor() {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = mq.matches;
    const onMq = (): void => {
      this.reduced = mq.matches;
      this.wake();
    };
    mq.addEventListener('change', onMq);
    this.detach.push(() => mq.removeEventListener('change', onMq));

    const onVis = (): void => {
      this.hidden = document.hidden;
      if (this.hidden) {
        this.pause();
        // ⚠ THE TIMERS GO TOO, not just the rAF. "A background tab must cost
        // nothing" is the budget (§12), and a per-person timer firing every 45 s
        // into a tab nobody is looking at is a room walking about in the dark.
        for (const a of this.actors.values()) {
          if (a.timer) clearTimeout(a.timer);
          a.timer = 0;
        }
        return;
      }
      for (const a of this.actors.values()) if (a.roam && !a.timer) this.schedule(a);
      this.wake();
    };
    document.addEventListener('visibilitychange', onVis);
    this.detach.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  /**
   * Makes sure exactly these people exist, ALREADY STANDING at their home.
   *
   * Not "walks in from off screen": somebody appears because the diagram gained
   * a node or the page reloaded, and animating that would claim an arrival that
   * never happened.
   */
  sync(people: readonly { id: string; home: Point }[]): void {
    const seen = new Set<string>();
    for (const p of people) {
      seen.add(p.id);
      if (this.actors.has(p.id)) continue;
      this.actors.set(p.id, {
        id: p.id,
        seed: p.id,
        x: p.home.x,
        y: p.home.y,
        tx: p.home.x,
        ty: p.home.y,
        facing: 1,
        walking: false,
        roam: false,
        timer: 0,
        moved: false,
      });
      this.paint(this.actors.get(p.id)!);
    }
    for (const id of [...this.actors.keys()]) {
      if (seen.has(id)) continue;
      // ⚠ Clear the timer before dropping the actor, or a scheduled trip fires
      // against a `Map` entry that no longer exists — silently, five seconds
      // after somebody was deleted.
      const gone = this.actors.get(id);
      if (gone?.timer) clearTimeout(gone.timer);
      this.actors.delete(id);
    }
  }

  /**
   * 🔴 IS THIS PERSON FREE TO WANDER? → SPEC-office-animation.md §17f · §17g
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ TURNING IT OFF DOES NOT MOVE ANYBODY, AND THAT IS THE POINT.           │
   * │                                                                          │
   * │ It cancels the pending trip and leaves the body exactly where it is —    │
   * │ which is the whole of §17e: *"when the assistant hands work to a worker, │
   * │ the worker stops right there"*. The caller then sets whatever target the │
   * │ new work implies. There is no separate "stop" signal, because a second   │
   * │ mechanism for stopping is a second mechanism that can be missed.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  setRoam(id: string, on: boolean): void {
    const a = this.actors.get(id);
    if (!a) return;
    // ⚠ Reduced motion means NO IDLE WANDERING AT ALL. Somebody who has asked
    // for less movement must not be given movement that reports nothing.
    const want = on && !this.reduced;
    if (a.roam === want) return;
    a.roam = want;
    if (!want) {
      if (a.timer) clearTimeout(a.timer);
      a.timer = 0;
      // ⚠ The target is pinned to where the body actually is. Left pointing at
      // the abandoned spot, the next `wake()` — a colleague starting to walk —
      // would resume the trip nobody asked for any more.
      a.tx = a.x;
      a.ty = a.y;
      return;
    }
    this.schedule(a);
  }

  /**
   * ⚠ THE FIRST DELAY IS SEEDED, EVERY LATER ONE IS RANDOM.
   *
   * At a mount everybody arrives in the same paint, so a fixed hold would have
   * eight people set off on the same frame, forever, in lockstep. The hash
   * spreads the first trip across the whole window; after that the walks
   * themselves have already pulled the phases apart and a plain ±30 % is enough.
   */
  private schedule(a: Actor): void {
    if (a.timer) clearTimeout(a.timer);
    const delay = a.moved
      ? IDLE_HOLD * (0.7 + Math.random() * 0.6)
      : hash32(`idle:${a.seed}`) % IDLE_HOLD;
    a.timer = window.setTimeout(() => {
      a.timer = 0;
      if (!a.roam) return;
      a.moved = true;
      const p = this.idleSpot?.(a.id) ?? null;
      // Nowhere free: hold, and ask again after the next window. Walking
      // somebody into a colleague to avoid doing nothing is worse than nothing.
      if (p) this.setTarget(a.id, p);
      this.schedule(a);
    }, delay);
  }

  /**
   * 🔴 SEND THIS PERSON NOW, INSTEAD OF WAITING OUT THE HOLD. → §17l
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ IT IS THE SAME TRIP `schedule()` WOULD HAVE MADE, NOT A SECOND KIND.   │
   * │                                                                          │
   * │ It asks `idleSpot` for a target and re-arms the ordinary cadence, so     │
   * │ there is one code path for "an idle worker walks somewhere" and one      │
   * │ place that can put somebody inside a wall. A separate opening walk would │
   * │ be a second mechanism that has to be kept in step with the first — and   │
   * │ this loop has already deleted one of those (`breakSpot`).                │
   * │                                                                          │
   * │ ⚠ IT REFUSES ANYBODY NOT ROAMING, which is what keeps it honest: a       │
   * │ worker with a task, and every resting person, are unreachable from here. │
   * │ The room may look busier when it opens; it may not CLAIM anything that   │
   * │ is not happening. Reduced motion never sets `roam`, so it is silent      │
   * │ there too, through the same gate rather than a second check.             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  nudge(id: string): void {
    const a = this.actors.get(id);
    if (!a?.roam) return;
    // ⚠ `moved` BEFORE the walk, not after: it is what makes the NEXT hold the
    // ordinary randomised 45 s rather than the seeded first-trip spread, which
    // this trip has just spent.
    a.moved = true;
    const p = this.idleSpot?.(a.id) ?? null;
    if (p) this.setTarget(a.id, p);
    this.schedule(a);
  }

  /** Re-sends every position. Called when a renderer mounts, so it starts in sync. */
  repaint(): void {
    for (const a of this.actors.values()) this.paint(a);
  }

  /**
   * A trip is an INTENTION, and intentions expire. → SPEC-office-animation §7b
   *
   * A new target REWRITES the old one in place: the actor re-aims from wherever
   * it currently stands, never finishes the abandoned trip first and never snaps
   * back to restart. There is deliberately no queue — a queue would replay a
   * history the office has already left behind, walking somebody to a bookshelf
   * for a read that finished four seconds ago.
   */
  setTarget(id: string, p: Point): void {
    const a = this.actors.get(id);
    if (!a) return;
    if (Math.abs(a.tx - p.x) < EPS && Math.abs(a.ty - p.y) < EPS) return;
    a.tx = p.x;
    a.ty = p.y;
    if (this.reduced) {
      // No walking at all. The renderer cross-fades so the change still reads
      // as a change rather than as a glitch.
      a.x = p.x;
      a.y = p.y;
      a.walking = false;
      this.paint(a);
      return;
    }
    this.wake();
  }

  /** Where somebody is standing right now — the ring picks its nearest slot from this. */
  positionOf(id: string): Point | undefined {
    const a = this.actors.get(id);
    return a ? { x: a.x, y: a.y } : undefined;
  }

  /**
   * Everybody's position and destination, plus who is standing still.
   *
   * ⚠ ONE SNAPSHOT, NOT THREE GETTERS. `pickIdleSpot` has to see all three
   * against the same instant: a colleague read as "standing" from one call and
   * as "already gone" from the next is how two people end up walking to the same
   * cushion. → `core/office-floor §IdleWorld`
   */
  world(): { at: Record<string, Point>; to: Record<string, Point>; standing: string[] } {
    const at: Record<string, Point> = {};
    const to: Record<string, Point> = {};
    const standing: string[] = [];
    for (const a of this.actors.values()) {
      at[a.id] = { x: a.x, y: a.y };
      to[a.id] = { x: a.tx, y: a.ty };
      if (!a.walking) standing.push(a.id);
    }
    return { at, to, standing };
  }

  /** Stops the world. Called on unmount and whenever the tab goes away. */
  pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  destroy(): void {
    this.pause();
    for (const a of this.actors.values()) if (a.timer) clearTimeout(a.timer);
    for (const off of this.detach) off();
    this.detach = [];
    this.actors.clear();
    this.sink = null;
  }

  wake(): void {
    if (this.raf || this.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private paint(a: Actor): void {
    this.sink?.apply(a.id, a.x, a.y, a.facing, a.walking);
  }

  private frame = (now: number): void => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    let moving = false;

    for (const a of this.actors.values()) {
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < EPS) {
        if (a.walking) {
          a.walking = false;
          this.onWalk?.(a.id, false);
          this.paint(a);
        }
        continue;
      }

      moving = true;
      if (!a.walking) {
        a.walking = true;
        this.onWalk?.(a.id, true);
      }
      /**
       * A short trip must not look like a lunge, so the SPEED is constant and
       * the DURATION follows the distance — never the other way round. The ease
       * only softens the last stretch, where a hard stop reads as a stumble.
       */
      const ease = dist < 26 ? 0.45 + (dist / 26) * 0.55 : 1;
      const step = Math.min(dist, SPEED * ease * dt);
      a.x += (dx / dist) * step;
      a.y += (dy / dist) * step;
      // Only a real sideways component turns somebody: walking straight down
      // must not make them pivot on a pixel of horizontal noise.
      if (Math.abs(dx) > 6) a.facing = dx < 0 ? -1 : 1;
      this.paint(a);
    }

    if (moving) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    // Nothing left to move: let go of the frame loop entirely. Nothing is
    // scheduled to take its place — the next `setTarget` calls `wake()`. This is
    // the line that makes an idle office cost zero.
    this.raf = 0;
    this.last = 0;
  };
}
