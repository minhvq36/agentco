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
 * ⚠ THERE IS NO TIMER LEFT AT ALL, and that is a change in kind, not a saving.
 * This loop used to hold a `setTimeout` chain for break-area wandering, so an
 * office where everybody was resting still woke up every 6–14 seconds, forever.
 * Resting people are bound to fixed seats now (`BREAK_SEATS`), and an idle
 * office reaches a genuine standstill: no rAF, no timer, nothing scheduled.
 */

/** World units per second. A person crossing an office, not a courier. */
const SPEED = 60;

/** Below this, "arrived". Chasing the last half-unit keeps the loop awake forever. */
const EPS = 1.2;

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
      if (this.hidden) this.pause();
      else this.wake();
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
      });
      this.paint(this.actors.get(p.id)!);
    }
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.actors.delete(id);
    }
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

  /** Stops the world. Called on unmount and whenever the tab goes away. */
  pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  destroy(): void {
    this.pause();
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
