import { NODE_SIZE, type CanvasNode, type NodeKind } from '@/lib/types';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export function sizeOf(kind: NodeKind): { w: number; h: number } {
  return NODE_SIZE[kind];
}

/** Cổng vào ở giữa cạnh trên, cổng ra ở giữa cạnh dưới. */
export function anchor(node: { kind: NodeKind; x: number; y: number }, dir: 'in' | 'out'): Point {
  const s = sizeOf(node.kind);
  return { x: node.x + s.w / 2, y: dir === 'out' ? node.y + s.h : node.y };
}

/** Bézier dọc. `dy` co giãn theo khoảng cách để dây gần không bị phồng. */
export function curve(a: Point, b: Point): string {
  const dy = Math.max(45, Math.abs(b.y - a.y) / 2);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy} ${b.x} ${b.y - dy} ${b.x} ${b.y}`;
}

export function screenToWorld(ev: { clientX: number; clientY: number }, rect: DOMRect, view: Viewport): Point {
  return { x: (ev.clientX - rect.left - view.x) / view.k, y: (ev.clientY - rect.top - view.y) / view.k };
}

/**
 * Tự sắp xếp. PHẢI khớp `agentSlot` trong `src/core/layout.ts` — hai bên lệch
 * nhau thì node mới do server tạo sẽ rơi chồng lên node cũ do client sắp.
 */
export function arrange(nodes: readonly CanvasNode[]): Map<string, Point> {
  const out = new Map<string, Point>();
  const perRow = 4;
  const agents = nodes.filter((n) => n.kind === 'agent');
  const mcps = nodes.filter((n) => n.kind === 'mcp');

  agents.forEach((n, i) => {
    out.set(n.id, {
      x: 140 + (i % perRow) * (NODE_SIZE.agent.w + 40),
      y: 250 + Math.floor(i / perRow) * (NODE_SIZE.agent.h + 60),
    });
  });

  const cols = Math.min(perRow, Math.max(1, agents.length));
  const width = cols * (NODE_SIZE.agent.w + 40) - 40;
  const mid = 140 + width / 2;
  const rows = Math.max(1, Math.ceil(agents.length / perRow));

  for (const n of nodes) {
    if (n.kind === 'assistant') out.set(n.id, { x: Math.round(mid - NODE_SIZE.assistant.w / 2), y: 40 });
    if (n.kind === 'knowledge') {
      out.set(n.id, {
        x: Math.round(mid - NODE_SIZE.knowledge.w / 2),
        y: 250 + rows * (NODE_SIZE.agent.h + 60) + 30,
      });
    }
  }
  mcps.forEach((n, i) => {
    out.set(n.id, { x: Math.round(140 + width + 90), y: 40 + i * (NODE_SIZE.mcp.h + 34) });
  });

  return out;
}

/** Khung bao mọi node, để tính "vừa khung". */
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
 * Ngưỡng phân biệt CLICK với KÉO.
 *
 * Trình duyệt bắn một `mousemove` ngay cả khi con trỏ đứng yên, và tay người
 * rung một pixel. Không có ngưỡng thì gần như MỌI cú click vào node đều bị hiểu
 * thành cú kéo, và bảng chi tiết không bao giờ mở ra.
 */
export const DRAG_THRESHOLD = 4;
