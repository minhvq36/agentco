import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { WORLD, type Point } from '@core/office-floor';
import { t } from '@i18n';

import { SPRITES } from '../../art/manifest';
import type { ActorView, SceneHandle, SceneProps } from '../../scene';
import { Character, CharacterDefs, TOTAL_H } from './Character';
// ⚠ The Lottie adapter and `lottie-web` are GONE, deliberately and completely.
// Every pixel and every line in this office is now made in-house: there is no
// third-party runtime to keep in the bundle and no third-party licence to comply
// with. → art/manifest.ts · docs/SPEC-office-art.md
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
  /** id → the two elements the per-frame channel writes to. Never React state. */
  const els = useRef(new Map<string, { box: HTMLElement; art: HTMLElement }>());

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

  useLayoutEffect(() => {
    fit();
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [fit]);

  const bind = useCallback(
    (id: string) => (box: HTMLDivElement | null) => {
      if (!box) {
        els.current.delete(id);
        return;
      }
      const art = box.querySelector<HTMLElement>('.actor-art');
      if (art) els.current.set(id, { box, art });
    },
    [],
  );

  const working = actors.filter((a) => a.status === 'working').length;
  const resting = actors.filter((a) => a.pose === 'sit').length;

  return (
    <div className="office-root" ref={rootRef}>
      <div className="office-pan">
        <svg
          className="office-svg"
          viewBox={`0 0 ${WORLD.w} ${WORLD.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('office.summary', { working: String(working), resting: String(resting) })}
        >
          <CharacterDefs />
          <Room armCount={room.armCount} libraryCount={room.libraryCount} onOpen={onOpen} />
          <g className="tokens" ref={tokenLayer} />
        </svg>

        {/*
          PAINTER'S ORDER is the ORDER OF `actors`. The scene hands them over
          back-to-front, and the renderer must not re-sort — sorting here would
          be a second opinion about depth, and the two would disagree.
        */}
        <div className="office-stage" ref={stageRef}>
          {actors.map((a) => (
            <Actor key={a.id} view={a} bind={bind} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
});

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
  bind(id: string): (el: HTMLDivElement | null) => void;
  onSelect(id: string): void;
}) {
  const thinking = !view.say && view.status === 'working';
  const seated = view.pose === 'sit';

  return (
    <div
      ref={bind(view.id)}
      className={`actor${view.selected ? ' is-selected' : ''}${view.status ? ` is-${view.status}` : ''}`}
    >
      {/*
        The clickable thing is the DRAWING, not the anchor: the anchor is a
        zero-sized point and could never be hit. Only the body mirrors — a
        mirrored name is the classic mistake in this shape of scene.
      */}
      <button
        type="button"
        className={`actor-art${SPRITES ? ' is-sprite' : ''}`}
        aria-label={view.say ? `${view.name} — ${view.say}` : view.name}
        onClick={() => onSelect(view.id)}
      >
        {SPRITES ? (
          /*
            One <span> with a background image. The frame is chosen by CSS —
            `is-seated` for the last cell, and `.actor.is-walking` runs the
            four walk cells with `steps(4)`. Nothing here re-renders when
            somebody starts moving; the class on the anchor does the work.
          */
          <span
            className={`sprite-art${seated ? ' is-seated' : ''}`}
            style={{ backgroundImage: `url(${SPRITES[view.character % SPRITES.length]!.src})` }}
            aria-hidden="true"
          />
        ) : (
          /*
            The built-in drawing — used whenever no asset is plugged in. It is
            the fallback, not the plan: `art/manifest.ts` is the socket.
          */
          <svg className="ch-svg" viewBox={`-40 ${-TOTAL_H - 8} 80 ${TOTAL_H + 16}`} aria-hidden="true">
            <CharacterDefs />
            <Character cast={view.character} pose={seated ? 'sit' : 'front'} />
          </svg>
        )}
      </button>

      <div className="actor-name">{view.name}</div>

      {(view.say || thinking) && (
        <div className={`bubble${view.status === 'error' ? ' is-error' : ''}`} aria-hidden="true">
          {/*
            Real text layout, because these are real DOM nodes: the width is not
            estimated from a character count, and a long sentence wraps instead
            of running out of its box.
          */}
          <span className="bubble-body">
            {view.say ? `${view.glyph ? `${view.glyph} ` : ''}${view.say}` : '…'}
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
