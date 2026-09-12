import { NODE_SIZE, type CanvasNode, type NodeKind } from '@/lib/types';
import { arrangeAll, wireCurve, type Point } from '@core/layout-geometry';

export type { Point };

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export function sizeOf(kind: NodeKind): { w: number; h: number } {
  return NODE_SIZE[kind];
}

/**
 * Where a wire attaches to a node.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY NODE HAS TWO INBOUND PORTS, NOT ONE. (changed 23/08, user caught)  │
 * │                                                                          │
 * │ Before: `in` = middle of the TOP edge, `out` = middle of the BOTTOM edge,│
 * │ regardless of which wire it was. So the wire from the assistant and the  │
 * │ wire from an arm entered at the SAME POINT on an employee's top edge —   │
 * │ two entirely different relationships through one port.                   │
 * │                                                                          │
 * │ Those two run in opposite directions, and that is exactly what has to be │
 * │ visible:                                                                 │
 * │   assistant → employee   HANDS OUT WORK      flows downward              │
 * │   arm → employee         GRANTS CAPABILITY   pushes upward               │
 * │                                                                          │
 * │ ⇒ The port follows the wire's DIRECTION, not the node. `up` = going up.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function anchor(
  node: { kind: NodeKind; x: number; y: number },
  dir: 'in' | 'out',
  up = false,
): Point {
  const s = sizeOf(node.kind);
  // An upward wire flips both ends: the source leaves from the TOP edge, the
  // target receives on the BOTTOM edge.
  const bottom = up ? dir === 'in' : dir === 'out';
  return { x: node.x + s.w / 2, y: bottom ? node.y + s.h : node.y };
}

/**
 * The `d` attribute of a wire — FORMATTING ONLY. → `@core §wireCurve`
 *
 * ⚠ THE CONTROL POINTS MOVED TO `core`, and the reason is `nearWire`: as soon as
 * something other than the renderer had to know where the wire actually runs,
 * the alternative was a second copy of these two points beside the distance
 * maths. That is the exact pair of copies `layout-geometry.ts` was created to
 * delete. This function now knows how to write a path and nothing else.
 */
export function curve(a: Point, b: Point, up = false): string {
  const [p0, c1, c2, p3] = wireCurve(a, b, up);
  return `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`;
}

export function screenToWorld(ev: { clientX: number; clientY: number }, rect: DOMRect, view: Viewport): Point {
  return { x: (ev.clientX - rect.left - view.x) / view.k, y: (ev.clientY - rect.top - view.y) / view.k };
}

/**
 * Auto-layout — the "Rearrange diagram" button.
 *
 * A thin shell over `arrangeAll` in `src/core/layout-geometry.ts`, i.e. THE SAME
 * function the server uses when placing nodes that have no coordinates yet. This
 * used to be a second implementation, and the two drifted: a new office rendered
 * a crooked diagram, and pressing this button straightened it out.
 */
export function arrange(
  nodes: readonly CanvasNode[],
  /**
   * The canvas edges. Only `mcp → agent` edges matter — `arrangeAll` filters.
   *
   * ⚠ MUST BE PASSED. Without it the "Rearrange diagram" button takes the OLD
   * branch (every arm on one centred row, wired or not) — which is the interface
   * and the server producing two different layouts again, the exact class of bug
   * the whole of `layout-geometry.ts` exists to close.
   */
  edges: readonly { from: string; to: string }[] = [],
): Map<string, Point> {
  return arrangeAll(nodes, edges);
}

/** Bounding box of every node, for "fit to view". */
export function bounds(nodes: readonly CanvasNode[], live: Map<string, Point>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const p = live.get(n.id) ?? n;
    const s = sizeOf(n.kind);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function fitViewport(
  nodes: readonly CanvasNode[],
  live: Map<string, Point>,
  rect: { width: number; height: number },
  pad = 70,
): Viewport {
  if (nodes.length === 0) return { x: 0, y: 0, k: 1 };
  const b = bounds(nodes, live);
  const k = Math.max(
    0.35,
    Math.min(1.15, Math.min((rect.width - pad * 2) / b.w, (rect.height - pad * 2) / b.h)),
  );
  return {
    k,
    x: (rect.width - b.w * k) / 2 - b.minX * k,
    y: (rect.height - b.h * k) / 2 - b.minY * k,
  };
}

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2;
/**
 * The threshold that separates a CLICK from a DRAG.
 *
 * Browsers fire a `mousemove` even when the pointer is still, and a human hand
 * shakes by a pixel. Without a threshold, almost EVERY click on a node reads as
 * a drag, and the detail panel never opens.
 */
export const DRAG_THRESHOLD = 4;
