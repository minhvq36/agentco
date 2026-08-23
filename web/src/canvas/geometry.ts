import { NODE_SIZE, type CanvasNode, type NodeKind } from '@/lib/types';
import { arrangeAll, type Point } from '@core/layout-geometry';

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
 * Cổng của một node trên một sợi dây.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỖI NODE CÓ HAI CỔNG VÀO, KHÔNG PHẢI MỘT. (đổi 23/08, user bắt được)     │
 * │                                                                          │
 * │ Bản trước: `in` = giữa cạnh TRÊN, `out` = giữa cạnh DƯỚI, không phụ thuộc │
 * │ vào sợi dây nào. Nên dây từ Trợ lý và dây từ cánh tay **chui vào CÙNG một │
 * │ điểm** trên đỉnh nhân viên — hai quan hệ khác hẳn nhau, một cái cổng.     │
 * │                                                                          │
 * │ Hai quan hệ đó ngược chiều nhau, và đó chính là thứ phải nhìn thấy:       │
 * │   Trợ lý → nhân viên   GIAO VIỆC       đi từ trên xuống                  │
 * │   cánh tay → nhân viên CẤP NĂNG LỰC    đẩy từ dưới lên                   │
 * │                                                                          │
 * │ ⇒ Cổng suy từ CHIỀU của sợi dây, không từ node. `up` = dây đi lên.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function anchor(
  node: { kind: NodeKind; x: number; y: number },
  dir: 'in' | 'out',
  up = false,
): Point {
  const s = sizeOf(node.kind);
  // Dây đi lên thì đảo cả hai đầu: nguồn nhả ra ở CẠNH TRÊN, đích nhận ở CẠNH DƯỚI.
  const bottom = up ? dir === 'in' : dir === 'out';
  return { x: node.x + s.w / 2, y: bottom ? node.y + s.h : node.y };
}

/**
 * Bézier dọc. `dy` co giãn theo khoảng cách để dây gần không bị phồng.
 *
 * `up` phải đảo cả hai điểm điều khiển. Giữ nguyên chúng cho dây đi lên thì
 * đường cong thắt nút ở giữa — nó cố phồng xuống trong khi hai đầu đi lên.
 */
export function curve(a: Point, b: Point, up = false): string {
  const dy = Math.max(45, Math.abs(b.y - a.y) / 2);
  const s = up ? -1 : 1;
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy * s} ${b.x} ${b.y - dy * s} ${b.x} ${b.y}`;
}

export function screenToWorld(ev: { clientX: number; clientY: number }, rect: DOMRect, view: Viewport): Point {
  return { x: (ev.clientX - rect.left - view.x) / view.k, y: (ev.clientY - rect.top - view.y) / view.k };
}

/**
 * Tự sắp xếp — nút "Sắp xếp lại sơ đồ".
 *
 * Chỉ là lớp vỏ mỏng quanh `arrangeAll` ở `src/core/layout-geometry.ts`, tức là
 * ĐÚNG hàm server dùng khi cấp chỗ cho node chưa có toạ độ. Trước đây đây là
 * bản mã thứ hai, và hai bản đã lệch nhau: văn phòng mới hiện sơ đồ méo, bấm
 * nút này thì nó thẳng lại.
 */
export function arrange(nodes: readonly CanvasNode[]): Map<string, Point> {
  return arrangeAll(nodes);
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
