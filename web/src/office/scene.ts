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
   * catalogue and names no language. A renderer displays it verbatim.
   */
  say: string | null;
  /** A marker for a place with no station of its own (`web`, `shell`). */
  glyph: string;
  selected: boolean;
}

export interface SceneProps {
  room: RoomView;
  actors: ActorView[];
  onOpen(what: 'library' | 'artifacts' | 'arm'): void;
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
