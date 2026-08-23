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
/**
 * ⚠ Thu nhỏ 23/08 (user chốt). Sơ đồ cũ hết chỗ rất nhanh: bốn nhân viên là đã
 * chiếm 944px ngang, và mỗi hàng thêm vào đẩy hai kho xuống 148px nữa.
 *
 * Node nhỏ hơn KHÔNG làm mất thông tin nào — chữ trong node vốn đã bị cắt
 * (`cut(node.label, 17)`), thứ chiếm chỗ là khoảng đệm.
 */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  assistant: { w: 200, h: 72 },
  agent: { w: 168, h: 76 },
  knowledge: { w: 184, h: 58 },
  library: { w: 184, h: 58 },
  mcp: { w: 152, h: 52 },
};

/** Số nhân viên mỗi hàng trước khi xuống dòng. */
export const PER_ROW = 4;

const ORIGIN_X = 140;
const ORIGIN_Y = 210;
const COL_GAP = 34;
const ROW_GAP = 44;
/** Khe giữa hai kho ở hàng dưới cùng. */
export const SHELF_GAP = 24;
/** Khoảng cách tối thiểu giữa hai node để mắt đọc ra là "hai cái". */
const CLEARANCE = 24;
const SHELF_DROP = 30;
const MAX_SLOTS = 200;

/** Bước lưới. Mọi ô nhân viên — kể cả ô mọc sang trái — đều nằm trên lưới này. */
const COL_STEP = NODE_SIZE.agent.w + COL_GAP;
const ROW_STEP = NODE_SIZE.agent.h + ROW_GAP;

/** Ô lưới thứ `i` của hàng nhân viên, đếm từ TRÁI sang. */
export function agentSlot(i: number): Point {
  return {
    x: ORIGIN_X + (i % PER_ROW) * COL_STEP,
    y: ORIGIN_Y + Math.floor(i / PER_ROW) * ROW_STEP,
  };
}

/**
 * Ô thứ `i` khi hàng nhân viên MỌC QUANH MỘT TRỤC, không nối đuôi sang phải.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG DÙNG `agentSlot` CHO NGƯỜI MỚI (20/08).                     │
 * │                                                                          │
 * │ `agentSlot` đếm từ trái sang, nên thêm người thứ ba là nó rơi vào ô thứ   │
 * │ ba — bên phải người thứ hai. Trợ lý thì ĐỨNG YÊN (nó chỉ được căn lại     │
 * │ lúc bấm "Sắp xếp lại sơ đồ"), nên sơ đồ nghiêng hẳn sang phải và người    │
 * │ dùng phải bấm Sắp xếp lại mới thấy nó cân. Một thao tác sửa lỗi của hệ    │
 * │ thống không được nằm ở tay người dùng.                                    │
 * │                                                                          │
 * │ Thứ tự ở đây là thứ tự người dùng tự mô tả khi báo lỗi:                    │
 * │                                                                          │
 * │   người 1 → thẳng dưới Trợ lý     (lệch 0)                               │
 * │   người 2 → bên phải người 1      (lệch +1, số chẵn thì không cân được)   │
 * │   người 3 → bên TRÁI người 1      (lệch −1, hàng cân trở lại)             │
 * │   người 4 → +2 … rồi xuống hàng                                          │
 * │                                                                          │
 * │ Vẫn ĐÚNG LƯỚI của `agentSlot`, chỉ khác THỨ TỰ duyệt: `kc` là chỉ số cột  │
 * │ chứa trục, làm tròn về lưới. Không bám lưới thì ô mới lệch nửa cột và     │
 * │ chồng một nửa lên người cũ — tệ hơn hẳn lệch phải.                        │
 * │                                                                          │
 * │ Mỗi hàng vẫn chỉ `PER_ROW` cột (lệch −1…+2), nên sơ đồ không nở ngang     │
 * │ vô hạn: người thứ năm xuống hàng dưới, thẳng trục, y như `arrangeAll`.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function centeredSlot(i: number, centerX: number): Point {
  const kc = Math.round((centerX - (ORIGIN_X + NODE_SIZE.agent.w / 2)) / COL_STEP);
  const j = i % PER_ROW;
  // 0, +1, −1, +2 — `PER_ROW` cột đầu của dãy toả ra từ giữa.
  const off = j === 0 ? 0 : j % 2 === 1 ? Math.ceil(j / 2) : -(j / 2);
  return { x: ORIGIN_X + (kc + off) * COL_STEP, y: ORIGIN_Y + Math.floor(i / PER_ROW) * ROW_STEP };
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

  /**
   * BỐN TẦNG, và thứ tự này là một CÂU đọc từ trên xuống:
   *
   *   Trợ lý      chia việc
   *   nhân viên   làm việc
   *   cánh tay    ← ngay dưới người dùng nó, dây ngắn nhất có thể
   *   hai kho     đáy, vì chúng là NỀN của cả văn phòng
   *
   * ⚠ Bản 23/08 sáng đặt cánh tay DƯỚI hai kho. User bác: *"2 kho ở tầng dưới
   * cùng"*. Và ngoài chuyện thứ bậc, nó còn sai về hình: dây từ cánh tay lên
   * nhân viên phải vòng qua hai kho, nên nó vẽ ra một cái vòng kỳ cục.
   */
  const armRow = mcps.length ? NODE_SIZE.mcp.h + SHELF_DROP : 0;
  const armY = ORIGIN_Y + rows * (NODE_SIZE.agent.h + ROW_GAP) + SHELF_DROP;
  const shelfY = armY + armRow;
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

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CÁNH TAY XẾP THÀNH MỘT HÀNG DƯỚI CÙNG, CĂN GIỮA. (đổi 23/08, user chốt)  │
   * │                                                                          │
   * │ Bản trước xếp chúng thành một CỘT bên phải, chạy từ y=40 xuống. Hai cái   │
   * │ sai cùng lúc, và user bắt được cả hai ngay lượt test đầu:                 │
   * │                                                                          │
   * │  1. Nó cắt ngang trục dọc mà cả sơ đồ đang căn theo. Trợ lý trên, nhân   │
   * │     viên giữa, hai kho dưới — rồi một cột lạ mọc ra bên hông.            │
   * │  2. **Sai CHIỀU DÒNG CHẢY.** Cạnh là `mcp → agent`, tức cánh tay NUÔI    │
   * │     nhân viên. Đặt nó ngang vai nhân viên thì sợi dây đi ngang, và mắt   │
   * │     không đọc ra ai cấp gì cho ai.                                       │
   * │                                                                          │
   * │ Đặt dưới cùng thì ngữ pháp của cả sơ đồ thành một câu đọc được:          │
   * │ **việc đi từ trên xuống, tài nguyên đẩy từ dưới lên.** Hai kho và cánh   │
   * │ tay cùng nằm ở tầng dưới vì chúng cùng là thứ nhân viên VỚI TỚI.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (mcps.length) {
    const armStep = NODE_SIZE.mcp.w + COL_GAP;
    const armW = mcps.length * armStep - COL_GAP;
    const armX = Math.round(mid - armW / 2);
    mcps.forEach((n, i) => out.set(n.id, { x: armX + i * armStep, y: armY }));
  }

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
 * `centerX` = tâm ngang của TRỤC (thực tế: node Trợ lý). Có trục thì ô mọc toả
 * ra hai bên (`centeredSlot`); không có thì rơi về đếm-từ-trái. Hai đường dùng
 * CHUNG một lưới nên trộn lẫn cũng không sinh ra node lệch nửa cột.
 *
 * Có trần vòng lặp: hết ô thì trả ô cuối, thà hai node chồng nhau còn hơn treo.
 */
export function firstFreeSlot(
  placed: readonly { kind: NodeKind; x: number; y: number }[],
  kind: NodeKind = 'agent',
  centerX?: number,
): Point {
  const slotAt = (i: number): Point =>
    centerX === undefined ? agentSlot(i) : centeredSlot(i, centerX);
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slotAt(i);
    if (!clashes(slot, kind, placed)) return slot;
  }
  return slotAt(placed.length);
}
