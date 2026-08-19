/**
 * PHÉP TOÁN BỐ CỤC — module THUẦN, dùng chung server và giao diện.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO FILE NÀY TỒN TẠI                                                  │
 * │                                                                          │
 * │ Trước 19/08 phép toán này có HAI bản: `agentSlot` + toạ độ mặc định viết │
 * │ tay trong `layout.ts`, và `arrange()` trong `web/src/canvas/geometry.ts`.│
 * │ Cả hai file đều có một dòng chú thích dặn "⚠ phải khớp bên kia" — và     │
 * │ chúng đã lệch nhau:                                                      │
 * │                                                                          │
 * │   văn phòng MỚI (chưa có layout.json)   assistant 520 · kho 300/524      │
 * │   sau khi bấm "Sắp xếp lại sơ đồ"        assistant 122 · kho  26/250     │
 * │                                                                          │
 * │ Tâm dải kho là 512 còn tâm Trợ lý là 636 → lệch 124px ngay lúc văn phòng │
 * │ chưa có ai; thêm một nhân viên thì lệch ~400px. Người dùng thấy sơ đồ    │
 * │ méo, bấm "Sắp xếp lại" thì nó thẳng — tức là hệ thống tự mâu thuẫn.      │
 * │                                                                          │
 * │ Một dòng chú thích không phải là một cơ chế. Hai bên IMPORT CHUNG một    │
 * │ hàm thì lỗi này không thể xảy ra lần nữa, và không cần ai nhớ gì cả.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG import gì ngoài kiểu — kể cả `node:*`. Đây là điều kiện để `web/`
 * (chạy trong trình duyệt, build riêng bằng Vite) nạp được file này.
 */

export type NodeKind = 'assistant' | 'agent' | 'knowledge' | 'library' | 'mcp';

export interface Point {
  x: number;
  y: number;
}

/** Kích thước node. Server và client PHẢI thống nhất để tự sắp xếp khớp nhau. */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  assistant: { w: 232, h: 84 },
  agent: { w: 196, h: 88 },
  knowledge: { w: 200, h: 64 },
  library: { w: 200, h: 64 },
  mcp: { w: 168, h: 56 },
};

/** Số nhân viên mỗi hàng trước khi xuống dòng. */
export const PER_ROW = 4;

const ORIGIN_X = 140;
const ORIGIN_Y = 250;
const COL_GAP = 40;
const ROW_GAP = 60;
/** Khe giữa hai kho ở hàng dưới cùng. */
export const SHELF_GAP = 24;
/** Khoảng cách tối thiểu giữa hai node để mắt đọc ra là "hai cái". */
const CLEARANCE = 24;
const SHELF_DROP = 30;
const MAX_SLOTS = 200;

/** Ô lưới thứ `i` của hàng nhân viên. */
export function agentSlot(i: number): Point {
  return {
    x: ORIGIN_X + (i % PER_ROW) * (NODE_SIZE.agent.w + COL_GAP),
    y: ORIGIN_Y + Math.floor(i / PER_ROW) * (NODE_SIZE.agent.h + ROW_GAP),
  };
}

/**
 * Bố cục sạch cho TOÀN BỘ sơ đồ. Đây là thứ nút "Sắp xếp lại sơ đồ" chạy, và
 * cũng là thứ một văn phòng chưa có `layout.json` nhận được.
 *
 * Mọi thứ căn quanh MỘT tâm: tâm của hàng nhân viên. Trợ lý ở trên, hai kho ở
 * dưới, cả ba cùng một trục dọc — nếu không thì sơ đồ trông như bị xô lệch dù
 * không có gì sai.
 *
 * Hai kho đứng cạnh nhau, kho tri thức TRÁI và tủ tài liệu PHẢI: đây là hai
 * khái niệm dễ lẫn nhất trong sản phẩm, nên phải nhìn thấy CÙNG LÚC thì sự
 * khác biệt "hệ thống tự học" / "bạn đưa vào" mới đọc được bằng mắt.
 */
export function arrangeAll(
  nodes: readonly { id: string; kind: NodeKind }[],
): Map<string, Point> {
  const out = new Map<string, Point>();
  const agents = nodes.filter((n) => n.kind === 'agent');
  const mcps = nodes.filter((n) => n.kind === 'mcp');

  agents.forEach((n, i) => out.set(n.id, agentSlot(i)));

  const cols = Math.min(PER_ROW, Math.max(1, agents.length));
  const width = cols * (NODE_SIZE.agent.w + COL_GAP) - COL_GAP;
  const mid = ORIGIN_X + width / 2;
  const rows = Math.max(1, Math.ceil(agents.length / PER_ROW));
  const shelfY = ORIGIN_Y + rows * (NODE_SIZE.agent.h + ROW_GAP) + SHELF_DROP;
  const shelfW = NODE_SIZE.knowledge.w + SHELF_GAP + NODE_SIZE.library.w;
  const shelfX = Math.round(mid - shelfW / 2);

  for (const n of nodes) {
    if (n.kind === 'assistant') {
      out.set(n.id, { x: Math.round(mid - NODE_SIZE.assistant.w / 2), y: 40 });
    }
    if (n.kind === 'knowledge') out.set(n.id, { x: shelfX, y: shelfY });
    if (n.kind === 'library') {
      out.set(n.id, { x: shelfX + NODE_SIZE.knowledge.w + SHELF_GAP, y: shelfY });
    }
  }

  mcps.forEach((n, i) => {
    out.set(n.id, { x: Math.round(ORIGIN_X + width + 90), y: 40 + i * (NODE_SIZE.mcp.h + 34) });
  });

  return out;
}

/** Hai hình chữ nhật có chạm nhau không (đã cộng khoảng hở nhìn được). */
export function clashes(
  spot: Point,
  kind: NodeKind,
  placed: readonly { kind: NodeKind; x: number; y: number }[],
): boolean {
  const mine = NODE_SIZE[kind];
  return placed.some((n) => {
    const s = NODE_SIZE[n.kind];
    return (
      spot.x < n.x + s.w + CLEARANCE &&
      n.x < spot.x + mine.w + CLEARANCE &&
      spot.y < n.y + s.h + CLEARANCE &&
      n.y < spot.y + mine.h + CLEARANCE
    );
  });
}

/**
 * Ô lưới đầu tiên KHÔNG chạm node nào đã đặt.
 *
 * Kiểm bằng hình chữ nhật thật chứ không bằng "toạ độ có trùng nhau không":
 * người dùng kéo node đi đâu tuỳ ý, nên hai node lệch nhau 10px vẫn là chồng
 * lên nhau với con mắt. Đây là chỗ lỗi "thêm nhân viên mà không thấy gì" bị
 * chặn ở gốc — không cần ai nhớ phải gọi hàm nào.
 *
 * Có trần vòng lặp: hết ô thì trả ô cuối, thà hai node chồng nhau còn hơn treo.
 */
export function firstFreeSlot(
  placed: readonly { kind: NodeKind; x: number; y: number }[],
  kind: NodeKind = 'agent',
): Point {
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = agentSlot(i);
    if (!clashes(slot, kind, placed)) return slot;
  }
  return agentSlot(placed.length);
}
