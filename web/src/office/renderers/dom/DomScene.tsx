import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { clipBubble } from '@core/office-bubble';
import { CH_H, SORTED_PIECES, WORLD, type Point } from '@core/office-floor';
import { t } from '@i18n';

import { FURNITURE, widthOf } from '../../art/furniture';
import { BODY_H, CELL, scaleFor, sitLiftFor, spriteFor } from '../../art/manifest';
import type { ActorView, SceneHandle, SceneProps } from '../../scene';
// ⚠ THERE IS NO FALLBACK DRAWING ANY MORE, AND THAT IS THE POINT.
// `Character.tsx` (a hand-drawn parametric SVG figure) and the Lottie adapter are
// both gone, deliberately and completely. Every pixel in this office is made
// in-house: no third-party runtime in the bundle, no third-party licence to comply
// with, and exactly ONE way a person can be drawn.
// → art/manifest.ts · docs/SPEC-office-art.md
import { Room } from './Room';

import './office.css';

/**
 * THE DOM ADAPTER — one way of drawing the room, and the only file that knows
 * it is being drawn with HTML and SVG. → `office/scene.ts` · SPEC §14
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO LAYERS, AND THE SPLIT IS LOAD-BEARING.                               │
 * │                                                                          │
 * │   the ROOM    an <svg>. It never moves, so it costs nothing after the    │
 * │               first paint, and vector furniture scales for free.         │
 * │   the PEOPLE  an HTML layer sitting exactly on top of it.                │
 * │                                                                          │
 * │ People are HTML because THE DRAWING IS PLUGGABLE: a bitmap sprite is an   │
 * │ ordinary DOM node, and reaching one from inside an `<svg>` would mean     │
 * │ `foreignObject` — a rendering trap already banned here for the speech     │
 * │ bubbles, for the same reason.                                            │
 * │                                                                          │
 * │ `fit()` keeps the two in register: the HTML stage is WORLD-SIZED and     │
 * │ given precisely the transform `preserveAspectRatio="xMidYMid meet"`      │
 * │ applies to the svg, so one world coordinate lands on the same pixel in   │
 * │ both — and the movement loop goes on writing plain world units, knowing  │
 * │ nothing about the window.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const DomScene = forwardRef<SceneHandle, SceneProps>(function DomScene(
  { room, actors, onOpen, onSelect },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const tokenLayer = useRef<SVGGElement | null>(null);
  /**
   * id → the elements the per-frame channel writes to. Never React state.
   *
   * `onTop` rides along because `apply()` must NOT write a `z-index` for somebody
   * who has a fixed one — the assistant. Re-deriving that from the actor list on
   * every frame would be a lookup per person per frame to answer a question that
   * changes when the roster does. → §17d
   */
  const els = useRef(new Map<string, { box: HTMLElement; art: HTMLElement; onTop: boolean }>());

  /**
   * THE PER-FRAME CHANNEL. → `scene.ts §SceneHandle`
   *
   * Everything here is a direct DOM write, called once per moving actor per
   * frame. Routing any of it through `setState` re-renders the tree sixty times
   * a second while SSE is still delivering events into it — the exact rule the
   * canvas has enforced since day one.
   */
  useImperativeHandle(
    ref,
    (): SceneHandle => ({
      apply(id, x, y, facing, walking) {
        const el = els.current.get(id);
        if (!el) return;
        // `translate3d` so each actor keeps its own compositor layer: moving
        // eight people is eight layer transforms, not eight repaints.
        el.box.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        el.art.style.transform = facing === -1 ? 'scaleX(-1)' : '';
        el.box.classList.toggle('is-walking', walking);
        /**
         * 🔴 DEPTH. → SPEC-office-animation.md §17b
         *
         * One integer, written beside the transform that was being written
         * anyway, and it settles all three of this round's occlusion questions
         * at once: a person against a desk, a person against another person, a
         * person against the chess table. Furniture in this same stage carries
         * the same number, computed from its `baseY` once at render.
         *
         * ⚠ NOT for `onTop` — the assistant holds a fixed z from React, and
         * overwriting it here would sink it behind whoever walked in front.
         */
        if (!el.onTop) el.box.style.zIndex = String(Math.round(y));
      },
      token(from, to, kind) {
        const layer = tokenLayer.current;
        if (layer) flyToken(layer, from, to, kind);
      },
    }),
    [],
  );

  /**
   * KEEPING THE TWO LAYERS IN REGISTER.
   *
   * A `ResizeObserver`, not a resize listener: the sidebar changes this
   * element's width without the window changing size at all.
   */
  const fit = useCallback(() => {
    const root = rootRef.current;
    const el = stageRef.current;
    if (!root || !el) return;
    const r = root.getBoundingClientRect();
    const k = Math.min(r.width / WORLD.w, r.height / WORLD.h);
    el.style.transform = `translate(${(r.width - WORLD.w * k) / 2}px, ${
      (r.height - WORLD.h * k) / 2
    }px) scale(${k})`;
  }, []);

  /**
   * ── THE CAMERA. → docs/SPEC-office-animation.md §17h · SPEC-office-art.md §10
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 ONE TRANSFORM ON A COMMON ANCESTOR — NOT A MULTIPLIER INSIDE `fit()`. │
   * │                                                                          │
   * │ `SPEC-office-art §10` says zoom must be applied "in `fit()` and nowhere   │
   * │ else", and the REASON it gives is the one that matters: the SVG room and  │
   * │ the HTML people must scale by exactly the same number or they drift       │
   * │ apart by the difference. `fit()` only writes the HTML stage — the svg      │
   * │ fits ITSELF with `preserveAspectRatio`, and there is no `fit()` line      │
   * │ that could multiply that.                                                 │
   * │                                                                          │
   * │ ⇒ The camera sits on `.office-cam`, which WRAPS BOTH. One element, one    │
   * │ transform, and the two layers cannot disagree because neither of them is  │
   * │ told about it. This honours the rule's reason rather than its wording.    │
   * │                                                                          │
   * │ ⚠ `transform-origin: 50% 50%` — zoom about the CENTRE of the frame, which │
   * │ is what makes `pan = 0` mean "centred" at every zoom and lets the clamp   │
   * │ below be a symmetric ±overflow rather than two different numbers.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const camRef = useRef<HTMLDivElement | null>(null);
  const cam = useRef<Cam>(loadCam());

  /**
   * How far the room can slide before its edge enters the frame, in px per axis.
   *
   * ⚠ NEGATIVE MEANS THE ROOM IS SMALLER THAN THE FRAME on that axis, which is
   * the normal case at zoom 1 — so the answer is 0 and that axis does not pan.
   * This is the whole reason fit-to-window is the FLOOR: at zoom 1 there is
   * nothing to drag, so no camera state can put a white margin back (§17h).
   */
  const overflow = useCallback((): Point => {
    const root = rootRef.current;
    if (!root) return { x: 0, y: 0 };
    const r = root.getBoundingClientRect();
    const k = Math.min(r.width / WORLD.w, r.height / WORLD.h) * cam.current.z;
    return {
      x: Math.max(0, (WORLD.w * k - r.width) / 2),
      y: Math.max(0, (WORLD.h * k - r.height) / 2),
    };
  }, []);

  const applyCam = useCallback(() => {
    const el = camRef.current;
    if (!el) return;
    const o = overflow();
    const c = cam.current;
    el.style.transform = `translate(${(c.fx * o.x).toFixed(1)}px, ${(c.fy * o.y).toFixed(
      1,
    )}px) scale(${c.z})`;
    /**
     * ⚠ THE OPEN HAND IS A CLAIM, SO IT IS ONLY MADE WHEN IT IS TRUE. At
     * `CAM_MIN` the whole room is already in frame and `onPointerDown` refuses
     * to start a drag; a `grab` cursor there would promise a gesture that does
     * nothing. Written here rather than in the pointer handlers because this is
     * the one function every zoom change already passes through.
     */
    rootRef.current?.classList.toggle('is-pannable', c.z > CAM_MIN);
  }, [overflow]);

  /**
   * ⚠ PAN IS STORED AS A FRACTION OF THE OVERFLOW, NOT AS PIXELS.
   *
   * Pixels do not survive the thing that moves this element most often — the
   * sidebar opening. A pixel offset saved in a 1400-wide frame puts the room off
   * centre when the frame becomes 1100, and the user never touched the camera.
   * A fraction re-derives against whatever the frame is now.
   */
  const setCam = useCallback(
    (next: Partial<Cam>) => {
      const z = clamp(next.z ?? cam.current.z, CAM_MIN, CAM_MAX);
      cam.current = {
        z,
        fx: clamp(next.fx ?? cam.current.fx, -1, 1),
        fy: clamp(next.fy ?? cam.current.fy, -1, 1),
      };
      applyCam();
      saveCam(cam.current);
    },
    [applyCam],
  );

  useLayoutEffect(() => {
    fit();
    applyCam();
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      fit();
      applyCam();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [fit, applyCam]);

  /**
   * ⚠ `passive: false`, and it must be a manual listener for that.
   * React's `onWheel` is registered passively, so `preventDefault()` inside it is
   * ignored and the browser zooms the whole page instead of the room. Same
   * reason `Canvas.tsx` attaches its wheel handler by hand.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // A ratio per notch, not an addition: the same wheel gesture has to feel
      // the same at 1× and at 3×, and a fixed step is twice as coarse at 3×.
      setCam({ z: cam.current.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCam]);

  /**
   * Drag to pan — and the clamp is inside `applyCam`, so a drag that runs past
   * the edge simply stops there rather than being rejected.
   *
   * ⚠ It starts only on the FLOOR. `.actor-art` and `.station` are buttons, and a
   * pan that begins on a button is a click the user meant and did not get.
   */
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (cam.current.z <= CAM_MIN) return;
    if ((e.target as Element).closest('button, [role="button"]')) return;
    drag.current = { x: e.clientX, y: e.clientY, fx: cam.current.fx, fy: cam.current.fy };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    rootRef.current?.classList.add('is-panning');
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const o = overflow();
      setCam({
        fx: o.x ? d.fx + (e.clientX - d.x) / o.x : 0,
        fy: o.y ? d.fy + (e.clientY - d.y) / o.y : 0,
      });
    },
    [overflow, setCam],
  );
  const onPointerUp = useCallback(() => {
    drag.current = null;
    rootRef.current?.classList.remove('is-panning');
  }, []);

  const bind = useCallback(
    (id: string, onTop: boolean) => (box: HTMLDivElement | null) => {
      if (!box) {
        els.current.delete(id);
        return;
      }
      const art = box.querySelector<HTMLElement>('.actor-art');
      if (art) els.current.set(id, { box, art, onTop });
    },
    [],
  );

  /**
   * ⚠ `resting` COMES FROM THE ROOM, NOT FROM THE BODIES ON SCREEN. Counting
   * `pose === 'sit'` here missed the three resting people who are on their feet
   * — two at the foosball table, one at the counter — and it would now also miss
   * everybody past the sixth seat, who is deliberately not drawn.
   */
  const working = actors.filter((a) => a.status === 'working').length;

  return (
    <div
      className="office-root"
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="office-pan">
        <div className="office-cam" ref={camRef}>
        <svg
          className="office-svg"
          viewBox={`0 0 ${WORLD.w} ${WORLD.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('office.summary', { working: String(working), resting: String(room.resting) })}
        >
          <Room armCount={room.armCount} libraryCount={room.libraryCount} onOpen={onOpen} />
          <g className="tokens" ref={tokenLayer} />
        </svg>

        {/*
          ⚠ PAINTER'S ORDER IS NO LONGER THE ORDER OF `actors`. → §17b
          Document order still decides ties, but depth is `z-index = round(y)`,
          written per frame in `apply()` — because a walking person changes depth
          and the array does not. The old comment here said the renderer must not
          re-sort, and that was right while the array was the only opinion; now
          the array is not an opinion at all.
        */}
        {/*
          ⚠ EVERY NUMBER THE STYLESHEET NEEDS ABOUT SIZE IS WRITTEN HERE, AND
          NONE OF THEM IS TYPED INTO IT.

          The stage size and `CH_H` used to be literals in `office.css`; when
          `CH_H` went 133 → 177 the furniture grew and the people did not,
          because CSS was holding its own stale copy of a core constant.

          The strip geometry went the same way on the next change. `office.css`
          carried `300 / 258` and `220 / 300` — in TWO places — with a comment
          arguing they belonged there because they "describe the strip". They
          describe `art/manifest.ts`, and when the v3 sheets landed at 480×720
          with a 690-unit figure, that argument was just the old bug wearing a
          justification.

          ⇒ `--cell-w`/`--cell-h`/`--body-h` are UNITLESS: CSS multiplies a px
          length by them, so the ratio lives here and the arithmetic lives there.
        */}
        <div
          className="office-stage"
          ref={stageRef}
          style={
            {
              width: `${WORLD.w}px`,
              height: `${WORLD.h}px`,
              '--ch-h': `${CH_H}px`,
              '--cell-w': `${CELL.w}`,
              '--cell-h': `${CELL.h}`,
              '--body-h': `${BODY_H}`,
            } as React.CSSProperties
          }
        >
          {/*
            THE SORTED FURNITURE, in the people's own layer. → §17b

            ⚠ It is INSIDE `.office-stage`, which is world-sized and scaled as a
            whole, so one world unit is one pixel in here and a prop needs no
            arithmetic beyond its own footprint. That is the same property the
            movement loop relies on, which is why it can go on writing plain
            world units.
          */}
          {SORTED_PIECES.map((p, i) => (
            <Prop key={`${p.id}-${i}`} id={p.id} x={p.x} baseY={p.baseY} />
          ))}
          {actors.map((a) => (
            <Actor key={a.id} view={a} bind={bind} onSelect={onSelect} />
          ))}
          </div>
        </div>
      </div>

      {/*
        ⚠ THE BUTTONS ARE OUTSIDE `.office-cam`, and that is not filing.
        Inside it they would zoom with the room: at 3× a "zoom out" button three
        times its own size, drifting off the corner it is anchored to.
      */}
      <div className="office-zoom">
        <button type="button" aria-label={t('office.zoomOut')} onClick={() => setCam({ z: cam.current.z / 1.4 })}>
          −
        </button>
        <button type="button" aria-label={t('office.zoomIn')} onClick={() => setCam({ z: cam.current.z * 1.4 })}>
          +
        </button>
      </div>
    </div>
  );
});

/**
 * ── THE CAMERA'S STORED STATE. → §17h
 *
 * `z` is a multiplier on fit-to-window; `fx`/`fy` are the pan as a FRACTION of
 * how far the room can slide, so they survive a resize.
 */
interface Cam {
  z: number;
  fx: number;
  fy: number;
}

/**
 * ⚠ `1`, NOT `0.75`. Fit-to-window is the FLOOR, so the letterbox that `BLEED`
 * spent a round painting out cannot come back through the camera. The art spec
 * had `0.75` and the user's call moved it. → SPEC-office-art.md §10
 */
const CAM_MIN = 1;
const CAM_MAX = 3;

/**
 * `localStorage`, per browser — beside `agentco:view`, and for the same recorded
 * reason: two tabs at two zooms is legal, and putting it on the server makes one
 * tab move the other.
 */
const CAM_KEY = 'agentco:office-cam';

function loadCam(): Cam {
  try {
    const raw = JSON.parse(localStorage.getItem(CAM_KEY) ?? 'null') as Partial<Cam> | null;
    if (!raw) return { z: CAM_MIN, fx: 0, fy: 0 };
    // ⚠ Every field is clamped on the way IN. A stored value is user-writable
    // data — `z: 40` in devtools would otherwise render a single shoe.
    return {
      z: clamp(Number(raw.z) || CAM_MIN, CAM_MIN, CAM_MAX),
      fx: clamp(Number(raw.fx) || 0, -1, 1),
      fy: clamp(Number(raw.fy) || 0, -1, 1),
    };
  } catch {
    return { z: CAM_MIN, fx: 0, fy: 0 };
  }
}

function saveCam(c: Cam): void {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify(c));
  } catch {
    // Private mode, quota, a locked-down profile. The camera still works for
    // this session; only the memory of it is lost.
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * ONE PIECE OF FURNITURE THAT SORTS AGAINST THE PEOPLE. → §17b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ `pointer-events: none` IS LOAD-BEARING, NOT TIDINESS.                  │
 * │                                                                          │
 * │ It sits over the station's hit rectangle in the `<svg>` below, so without │
 * │ it the filing desk swallows the click that opens Results — the exact trap │
 * │ `.office-front` was already caught by once. It is set on `.prop` in the   │
 * │ stylesheet rather than here so there is one place to look.                │
 * │                                                                          │
 * │ ⚠ The SHADOW is not here. It stays in the room, under the shoes.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function Prop({ id, x, baseY }: { id: keyof typeof FURNITURE; x: number; baseY: number }) {
  const p = FURNITURE[id];
  const w = widthOf(p);
  return (
    <img
      className="prop"
      src={p.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{
        left: `${x - w / 2}px`,
        top: `${baseY - p.h}px`,
        width: `${w}px`,
        height: `${p.h}px`,
        // The same integer the people carry. Constant, so it is written once here
        // rather than per frame — furniture does not move.
        zIndex: Math.round(baseY),
      }}
    />
  );
}

/**
 * One person. A ZERO-SIZED ANCHOR AT THE FEET, with everything hung off it — so
 * the loop writes one world coordinate and never has to know how tall the
 * drawing is or how wide the bubble came out.
 */
function Actor({
  view,
  bind,
  onSelect,
}: {
  view: ActorView;
  bind(id: string, onTop: boolean): (el: HTMLDivElement | null) => void;
  onSelect(id: string): void;
}) {
  const thinking = !view.say && view.status === 'working';
  const seated = view.pose === 'sit';

  return (
    <div
      ref={bind(view.id, !!view.onTop)}
      className={`actor${view.selected ? ' is-selected' : ''}${view.status ? ` is-${view.status}` : ''}`}
      /* ⚠ Per-CHARACTER, so it has to be on the actor rather than on the stage:
         `--sprite-k` is inherited by the drawing AND by the ground shadow, which
         is the only way the two stay the same size as each other. `--sit-lift` is
         inherited by the drawing ONLY — see `.sprite-art.is-seated`. → manifest.ts */
      style={
        {
          '--sprite-k': scaleFor(view.character),
          '--sit-lift': sitLiftFor(view.character),
          /**
           * 🔴 THE ASSISTANT IS NEVER BEHIND ANYBODY. → §17d
           *
           * A stated exception to `z = round(y)`, not a hole in it: the assistant
           * is the one figure the user must never have to hunt for, and it stands
           * centre-front where a worker crossing the room would otherwise pass in
           * front of it. `WORLD.h` is the largest `y` any body can have, so `+1`
           * is the smallest number that wins — a magic 9999 would be a second,
           * unrelated fact about the room.
           */
          ...(view.onTop ? { zIndex: WORLD.h + 1 } : {}),
        } as React.CSSProperties
      }
    >
      {/*
        ⚠ PAINTED BEFORE THE BUTTON so it sits UNDER the feet. It is also a status
        light and the focus ring — see `.actor-shadow` in office.css — which is why
        it is drawn here rather than baked into the artwork.
      */}
      <span className="actor-shadow" aria-hidden="true" />

      {/*
        The clickable thing is the DRAWING, not the anchor: the anchor is a
        zero-sized point and could never be hit. Only the body mirrors — a
        mirrored name is the classic mistake in this shape of scene.
      */}
      <button
        type="button"
        className="actor-art"
        aria-label={view.say ? `${view.name} — ${view.say}` : view.name}
        onClick={() => onSelect(view.id)}
      >
        {/*
          One <span> with a background image. The frame is chosen by CSS —
          `is-seated` for the last cell, and `.actor.is-walking` runs the four
          walk cells with `steps(4)`. Nothing here re-renders when somebody
          starts moving; the class on the anchor does the work.
        */}
        <span
          className={`sprite-art${seated ? ' is-seated' : ''}`}
          style={{ backgroundImage: `url(${spriteFor(view.character).src})` }}
          aria-hidden="true"
        />
        {/*
          THE GARMENT TINT. → docs/SPEC-office-art.md §11

          ┌──────────────────────────────────────────────────────────────────┐
          │ ⚠ RENDERED ONLY WHEN THERE IS A COLOUR. Not "always, sometimes    │
          │ transparent": a `mix-blend-mode` element forces a compositing     │
          │ pass for that actor on every frame it moves, whether or not it    │
          │ changes a pixel. Absent and transparent are the same picture and  │
          │ two very different machines.                                      │
          │                                                                   │
          │ ⚠ IT CARRIES THE SAME CLASSES AS THE SPRITE, and that is what     │
          │ keeps the two in step: `.sprite-art` sets the frame, `.is-seated` │
          │ picks the last cell, and `.actor.is-walking` runs the four walk   │
          │ cells. The stylesheet drives `mask-position` off exactly the same │
          │ keyframes as `background-position`, so the colour cannot slide    │
          │ off the shirt mid-stride.                                         │
          └──────────────────────────────────────────────────────────────────┘
        */}
        {view.tint && (
          <span
            className={`sprite-art tint-art${seated ? ' is-seated' : ''}`}
            style={
              {
                background: view.tint,
                '--mask': `url(${spriteFor(view.character).mask})`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        )}
      </button>

      <div className="actor-name">{view.name}</div>

      {(view.say || thinking) && (
        <div className={`bubble${view.status === 'error' ? ' is-error' : ''}`} aria-hidden="true">
          {/*
            ⚠ CLIPPED TO 18 CHARACTERS, GLYPH AND ELLIPSIS INCLUDED — the whole
            bubble, not the sentence inside it. The full text is on the button's
            `aria-label` above and in the chat panel; the picture only has to say
            that somebody is talking. → `scene.ts §clipBubble`

            Real text layout is still what draws it, because these are real DOM
            nodes: the width is not estimated from a character count, and the
            wrap stays as the safety net for a script far wider than Latin.
          */}
          <span className="bubble-body">
            {view.say ? clipBubble(`${view.glyph ? `${view.glyph} ` : ''}${view.say}`) : '…'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A token travelling from one point to another — the briefing going out, the
 * receipt coming back. → SPEC-office-animation §6d
 *
 * The Web Animations API rather than a CSS keyframe: the from/to are computed at
 * the moment it fires, and `finished` gives a place to remove the element that
 * cannot be forgotten. Skipped entirely under reduced motion — a token is pure
 * flourish, and it is the first thing that should not exist when somebody has
 * asked for less movement.
 */
function flyToken(layer: SVGGElement, from: Point, to: Point, kind: 'brief' | 'receipt'): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  el.setAttribute('class', `token token-${kind}`);
  el.setAttribute('width', '14');
  el.setAttribute('height', '10');
  el.setAttribute('rx', '2');
  el.setAttribute('x', '-7');
  el.setAttribute('y', '-5');
  layer.appendChild(el);
  const lift = 96;
  const anim = el.animate(
    [
      { transform: `translate(${from.x}px, ${from.y - lift}px) scale(0.6)`, opacity: 0 },
      {
        transform: `translate(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2 - lift - 30}px) scale(1)`,
        opacity: 1,
        offset: 0.45,
      },
      { transform: `translate(${to.x}px, ${to.y - lift}px) scale(0.6)`, opacity: 0 },
    ],
    { duration: 600, easing: 'ease-in-out' },
  );
  void anim.finished.catch(() => undefined).then(() => el.remove());
}
