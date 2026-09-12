import type { ForwardRefExoticComponent, RefAttributes } from 'react';

import type { Point } from '@core/office-floor';

/**
 * THE RENDERER PORT. → docs/SPEC-office-animation.md §14
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE CONTRACT, N WAYS OF DRAWING. This file is the whole reason the art    │
 * │ decision is a PLUG rather than a rewrite.                                │
 * │                                                                          │
 * │ Everything above this line — the floor plan, who should be where, the     │
 * │ movement loop, the three backend fields — is drawing-agnostic and does    │
 * │ not change when the art does. Everything below it is one adapter.         │
 * │                                                                          │
 * │ Two rounds of the drawing being thrown out cost nothing above this line.  │
 * │ That is not luck; it is what the port is for, and the one place it        │
 * │ LEAKED (the loop held DOM elements) is exactly where a third adapter      │
 * │ would have broken it — a 3D scene has no `<div>` per person.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ TWO CHANNELS, AND THE SPLIT IS THE PERFORMANCE RULE ITSELF.            │
 * │                                                                          │
 * │   PROPS  what changes rarely — who exists, their name, their bubble.     │
 * │          Goes through React, costs a render, happens on an SSE event.    │
 * │   HANDLE what changes every frame — position, facing, walking.           │
 * │          NEVER goes through React. One imperative call per actor.        │
 * │                                                                          │
 * │ Collapsing these into one is how a diagram that held 60fps under load    │
 * │ becomes a room that re-renders the tree sixty times a second while SSE   │
 * │ is still delivering events into it.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** What the room itself needs to draw. Counts, not nodes — the scene is read-only. */
export interface RoomView {
  armCount: number;
  libraryCount: number;
  /**
   * 🔴 HOW MANY PEOPLE ARE RESTING — **including the ones not drawn**.
   *
   * The break area seats six and the seventh is hidden, so a renderer that
   * counted the bodies it drew would under-report the office it is describing.
   * It would also have been wrong before any of that: it counted `pose: 'sit'`,
   * which misses the two people at the foosball table and the one at the
   * counter, all three of whom are resting on their feet.
   */
  resting: number;
}

/** One person, as the renderer sees them. Everything here changes rarely. */
export interface ActorView {
  /** The node id. The identity the loop, the director and the renderer all share. */
  id: string;
  /** The name the USER typed. Cast members deliberately have no names of their own. */
  name: string;
  /** Index into `CAST`, resolved by the server. */
  character: number;
  pose: 'stand' | 'sit';
  status?: 'working' | 'done' | 'error';
  /**
   * The bubble. ⚠ PRODUCT-WORLD TEXT: this is `say`, which passes through no
   * catalogue and names no language.
   *
   * ⚠ HELD IN FULL, CLIPPED ONLY WHEN DRAWN — see `clipBubble`. The whole
   * sentence is what the button's accessible name carries, so shortening it
   * here would take the sentence away from the one reader who cannot see the
   * picture at all.
   */
  say: string | null;
  /**
   * The colour of this person's recolourable garment, `#rrggbb`, or absent.
   * → `@core/cast §assignTints` · docs/SPEC-office-art.md §11
   *
   * ⚠ ABSENT means the artwork's own colour and NO TINT LAYER — see `DomScene`.
   */
  tint?: string;
  /** A marker for a place with no station of its own (`web`, `shell`). */
  glyph: string;
  selected: boolean;
  /*
   * 🔴 `onTop` WAS HERE AND IS GONE (08/09). → SPEC-office-animation.md §17d′
   *
   * It drew the assistant above every body and every piece of furniture, on
   * the reasoning that *"the one figure you must never have to hunt for"*
   * should never be behind anybody. The user's verdict after using it: a
   * worker standing NEARER the viewer than the assistant, drawn behind it,
   * reads as wrong — and the exception bought nothing, because the thing it
   * was protecting against was two bodies standing 39 units apart, which no
   * stacking order fixes.
   *
   * ⚠ DELETED, NOT LEFT UNSET. A flag nobody sets is how the exception comes
   * back in six months, wired by somebody who found an unused boolean.
   */
}

export interface SceneProps {
  room: RoomView;
  actors: ActorView[];
  /**
   * ⚠ `'arm'` IS GONE FROM THIS UNION, and narrowing the port is the point.
   * The bench was a door that had to guess which of N connections the user meant.
   * Leaving the case in the type would keep a branch nothing can reach — and the
   * day somebody re-adds the click, `tsc` says nothing. → SPEC-office-animation §17i
   */
  onOpen(what: 'library' | 'artifacts'): void;
  onSelect(id: string): void;
}

/** The per-frame channel. Anything here is called from the movement loop. */
export interface SceneHandle {
  /**
   * Put somebody at a world coordinate. Called for every moving actor, every
   * frame — so it must do the cheapest possible thing and MUST NOT touch React.
   */
  apply(id: string, x: number, y: number, facing: 1 | -1, walking: boolean): void;
  /** A token travelling between two points: the brief going out, the receipt coming back. */
  token(from: Point, to: Point, kind: 'brief' | 'receipt'): void;
}

export type SceneComponent = ForwardRefExoticComponent<SceneProps & RefAttributes<SceneHandle>>;
