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

export interface ArrangeNode {
  id: string;
  kind: NodeKind;
  /**
   * Khoá SẮP XẾP cho cánh tay ở bãi đỗ — chuỗi, so bằng `localeCompare`.
   *
   * ⚠ Do **chỗ gọi** tính, không phải file này. Hình học không được biết
   * "Notion" hay "Linear" là gì; phân loại hãng là **dữ liệu của danh mục**.
   * Quy ước hiện dùng: `0-files` · `1-<mục danh mục>` · `2-custom`
   * ⇒ filesystem trước, rồi provider (các provider cùng hãng đứng cạnh nhau vì
   * cùng tiền tố), rồi hàng tự dán. → `layout.ts §armGroup`
   */
  armGroup?: string;
}

export interface ArrangeEdge {
  from: string;
  to: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BÃI ĐỖ CHO CÁNH TAY KHÔNG NỐI DÂY — bên trái, ngoài sơ đồ. (user 31/08)  │
 * │                                                                          │
 * │ Các hằng số dưới đây **lấy từ chính bố cục user đã tự kéo tay** trong     │
 * │ `offices/canh-tay/layout.json`, không phải bịa ra:                        │
 * │                                                                          │
 * │   cột 1  x ≈ −133…−139      cột 2  x ≈ −309…−312   ⇒ bước ≈ 177          │
 * │   y      0 · 72 · 143 · 217 · 292 · 376 · 459      ⇒ bước ≈ 72, ĐÚNG 7   │
 * │   y bắt đầu = 0, **cao hơn Trợ lý** (y=40) — user nêu đích danh mốc này  │
 * │                                                                          │
 * │ Lấy số từ thứ người dùng đã tự làm thì "sắp xếp lại" không giật cục: nó   │
 * │ dọn về gần đúng chỗ họ vốn để.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const PARK_PER_COL = 7;
/** Khe nhìn thấy giữa hai node ở bãi đỗ. Mọi bước dưới đây suy ra từ nó. */
const PARK_GAP = 20;
const PARK_ROW_STEP = NODE_SIZE.mcp.h + PARK_GAP; // 72 — đúng bước user đã tự kéo
const PARK_COL_STEP = NODE_SIZE.mcp.w + PARK_GAP; // 172
/**
 * 🔴 KHE NGANG giữa bãi đỗ và sơ đồ chính. **Đây là số cần sửa nếu còn xa/gần.**
 *
 * User 31/08: *"gap x hiện tại đang hơi xa, cho nó gần lại với đáy dưới của tam
 * giác, chắc gap x = gap y nhỉ, cỡ đó"*.
 *
 * Trước: cột đầu ở `x = -133` ⇒ mép phải = 19, mà mép trái sơ đồ là `ORIGIN_X`
 * = 140 ⇒ khe **121px**. Giờ đặt bằng đúng MỘT nhịp dọc của bãi đỗ (72) —
 * "gap x = gap y" theo nghĩa cùng một bước lưới. Khe 20 (bằng khe giữa hai node)
 * thì bãi đỗ dính vào sơ đồ và mắt đọc ra là **cùng một hàng**, mất luôn ý
 * "hàng chưa dùng để riêng một chỗ".
 */
const PARK_CLEAR = PARK_ROW_STEP;
const PARK_X = ORIGIN_X - PARK_CLEAR - NODE_SIZE.mcp.w;
const PARK_Y = 0;

/** Ô thứ `i` của bãi đỗ: đầy một cột (7) rồi mở cột mới **sang trái**. */
export function parkSlot(i: number): Point {
  return {
    x: PARK_X - Math.floor(i / PARK_PER_COL) * PARK_COL_STEP,
    y: PARK_Y + (i % PARK_PER_COL) * PARK_ROW_STEP,
  };
}

/**
 * Ô cho một cánh tay MỚI, bám theo chủ của nó.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BUG user bắt 31/08: *"cứ thêm 1 MCP mới, địa điểm nó chọn rất tệ…      │
 * │ nó chọn faraway"*.                                                       │
 * │                                                                          │
 * │ Thủ phạm: `firstFreeSlot` đi trên **lưới NHÂN VIÊN** cho mọi loại node.   │
 * │ Bước lưới đó là 202×120 — quá thô cho một node 152×52 — nên nó nhảy qua   │
 * │ hết mọi khe trống thật rồi rơi ra tận rìa sơ đồ. Với bố cục user đang có  │
 * │ (nhân viên, hai kho, và một bãi đỗ tự kéo bên trái) thì ô trống đầu tiên  │
 * │ trên lưới ấy nằm rất xa.                                                  │
 * │                                                                          │
 * │ ⇒ Cánh tay phải có LƯỚI RIÊNG: bước bằng chính cỡ nó, quét NGANG ngay     │
 * │ dưới chủ của nó, toả ra hai bên rồi mới xuống hàng.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armSlot(i: number, centerX: number, topY: number): Point {
  const step = NODE_SIZE.mcp.w + COL_GAP;
  const perRow = 7;
  const j = i % perRow;
  // 0, +1, −1, +2, −2… — toả ra từ trục, cùng khuôn `centeredSlot`.
  const off = j === 0 ? 0 : j % 2 === 1 ? Math.ceil(j / 2) : -(j / 2);
  return {
    x: Math.round(centerX - NODE_SIZE.mcp.w / 2 + off * step),
    y: topY + Math.floor(i / perRow) * (NODE_SIZE.mcp.h + ROW_GAP),
  };
}

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
  nodes: readonly ArrangeNode[],
  /**
   * Cạnh `mcp → agent`. Không truyền ⇒ hành vi CŨ (mọi cánh tay xếp một hàng
   * căn giữa) — mọi chỗ gọi cũ và mọi test cũ giữ nguyên kết quả.
   */
  edges: readonly ArrangeEdge[] = [],
): Map<string, Point> {
  const out = new Map<string, Point>();
  const agents = nodes.filter((n) => n.kind === 'agent');
  const mcps = nodes.filter((n) => n.kind === 'mcp');

  const { owned, parked } = groupArms(agents, mcps, edges);
  const blocks = edges.length > 0;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HÀNG CÁNH TAY QUYẾT ĐỊNH CHIỀU NGANG, KHÔNG PHẢI NGƯỢC LẠI. (user 31/08) │
   * │                                                                          │
   * │   *"Các worker phải cân đối với các mcp của mình"* ·                     │
   * │   *"thứ tự sắp xếp phải theo worker (để tránh vướng dây chằng chéo)"*    │
   * │                                                                          │
   * │ Bản cũ đặt nhân viên lên lưới trước, rồi rải TẤT CẢ cánh tay thành một   │
   * │ hàng căn giữa toàn sơ đồ. Hệ quả: cánh tay của người ngoài cùng bên trái │
   * │ có thể rơi sang phải, và mọi sợi dây cắt chéo qua nhau.                  │
   * │                                                                          │
   * │ Đảo lại: mỗi nhân viên có một KHỐI cánh tay của riêng mình, các khối xếp │
   * │ liền nhau theo đúng thứ tự nhân viên, rồi **nhân viên được căn lên giữa  │
   * │ khối của mình**. Dây thành những chùm song song, không sợi nào cắt sợi   │
   * │ nào — vì thứ tự ngang của cánh tay CHÍNH LÀ thứ tự ngang của chủ nó.     │
   * │                                                                          │
   * │ ⚠ Vẫn giữ đúng 4 tầng (user chốt: *"mô hình 4 hàng vẫn đúng"*). Quá      │
   * │ `PER_ROW` nhân viên thì mỗi HÀNG nhân viên có hàng cánh tay riêng ngay   │
   * │ dưới nó — đó là cách duy nhất giữ "cánh tay nằm dưới chủ nó" mà không    │
   * │ để hai hàng đè lên nhau.                                                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const rowsOf: ArrangeNode[][] = [];
  for (let i = 0; i < agents.length; i += PER_ROW) rowsOf.push(agents.slice(i, i + PER_ROW));
  if (!rowsOf.length) rowsOf.push([]);

  const armStep = NODE_SIZE.mcp.w + COL_GAP;
  /** Bề ngang khối của một nhân viên: rộng bằng cái rộng hơn giữa người và đám cánh tay. */
  const blockW = (a: ArrangeNode): number => {
    const n = blocks ? (owned.get(a.id)?.length ?? 0) : 0;
    return Math.max(NODE_SIZE.agent.w, n ? n * armStep - COL_GAP : 0);
  };

  /** Bề ngang của hàng rộng nhất — cái này định nghĩa trục giữa của cả sơ đồ. */
  let widest = 0;
  for (const row of rowsOf) {
    const w = row.reduce((s, a) => s + blockW(a), 0) + Math.max(0, row.length - 1) * COL_GAP;
    widest = Math.max(widest, w);
  }
  if (!widest) widest = NODE_SIZE.agent.w;
  const mid = ORIGIN_X + widest / 2;

  // Đặt từng hàng: khối liền khối, cả hàng căn vào trục giữa.
  let y = ORIGIN_Y;
  for (const row of rowsOf) {
    const rowW = row.reduce((s, a) => s + blockW(a), 0) + Math.max(0, row.length - 1) * COL_GAP;
    let x = Math.round(mid - rowW / 2);
    for (const a of row) {
      const w = blockW(a);
      out.set(a.id, { x: Math.round(x + w / 2 - NODE_SIZE.agent.w / 2), y });
      const mine = blocks ? (owned.get(a.id) ?? []) : [];
      if (mine.length) {
        const armW = mine.length * armStep - COL_GAP;
        const armX = Math.round(x + w / 2 - armW / 2);
        const armY = y + NODE_SIZE.agent.h + ROW_GAP + SHELF_DROP;
        mine.forEach((m, i) => out.set(m.id, { x: armX + i * armStep, y: armY }));
      }
      x += w + COL_GAP;
    }
    y += NODE_SIZE.agent.h + ROW_GAP + (blocks ? NODE_SIZE.mcp.h + SHELF_DROP + ROW_GAP : 0);
  }

  /**
   * CÁNH TAY KHÔNG NỐI DÂY → BÃI ĐỖ BÊN TRÁI. (user chốt 31/08)
   *
   * *"Các mcp không dùng thì xếp thành các hàng dọc bên tay trái xa nhất, mỗi
   * cột 7 mcp tối đa… sắp xếp theo type (filesystem, provider, custom), trong
   * provider thì cũng sắp xếp theo provider."*
   *
   * ⚠ Thứ tự lấy từ `armGroup` — một chuỗi do **chỗ gọi** tính, không phải ở đây.
   * File này không được biết "Notion" hay "Linear" là gì: nó là hình học thuần,
   * còn phân loại hãng là **dữ liệu của danh mục**. Trộn vào là đúng cái
   * `arms/index.ts` đã dựng hàng rào để chặn.
   */
  parked
    .slice()
    .sort((a, b) => (a.armGroup ?? '~').localeCompare(b.armGroup ?? '~') || a.id.localeCompare(b.id))
    .forEach((n, i) => out.set(n.id, parkSlot(i)));

  const rows = rowsOf.length;

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
  /**
   * Đáy của hai kho: dưới hàng cuối cùng đã đặt.
   *
   * Ở chế độ KHỐI, `y` đã chạy qua mọi hàng (mỗi hàng gồm nhân viên + cánh tay
   * của họ), nên nó chính là mép dưới — không tính lại theo `rows` được nữa.
   * Chế độ cũ thì giữ nguyên công thức cũ, từng ký tự.
   */
  const shelfY = blocks ? y - ROW_GAP + SHELF_DROP : armY + armRow;
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
  // ⚠ CHỈ chạy ở chế độ cũ (không có cạnh). Có cạnh thì cánh tay đã được đặt
  // theo khối ở trên, và chạy lại vòng này là xoá sạch việc đó.
  if (!blocks && mcps.length) {
    const oneRow = NODE_SIZE.mcp.w + COL_GAP;
    const armW = mcps.length * oneRow - COL_GAP;
    const armX = Math.round(mid - armW / 2);
    mcps.forEach((n, i) => out.set(n.id, { x: armX + i * oneRow, y: armY }));
  }

  return out;
}

/**
 * Cánh tay nào thuộc về nhân viên nào — và cái nào **không của ai**.
 *
 * ⚠ CHỦ CHÍNH = người đứng TRÁI NHẤT trong số những người cầm nó. Một cánh tay
 * dùng chung phải chọn đúng một chỗ đứng; chọn người trái nhất thì sợi dây thứ
 * hai luôn đi sang PHẢI, cùng chiều với mọi sợi khác — thay vì có sợi rẽ trái,
 * sợi rẽ phải, và chúng cắt nhau ngay dưới hàng nhân viên.
 */
function groupArms(
  agents: readonly ArrangeNode[],
  mcps: readonly ArrangeNode[],
  edges: readonly ArrangeEdge[],
): { owned: Map<string, ArrangeNode[]>; parked: ArrangeNode[] } {
  const order = new Map(agents.map((a, i) => [a.id, i]));
  const holders = new Map<string, string[]>();
  for (const e of edges) {
    if (!order.has(e.to)) continue;
    const list = holders.get(e.from);
    if (list) list.push(e.to);
    else holders.set(e.from, [e.to]);
  }
  const owned = new Map<string, ArrangeNode[]>();
  const parked: ArrangeNode[] = [];
  for (const m of mcps) {
    const hs = holders.get(m.id);
    if (!hs?.length) {
      parked.push(m);
      continue;
    }
    const boss = hs.reduce((best, h) => (order.get(h)! < order.get(best)! ? h : best));
    const list = owned.get(boss);
    if (list) list.push(m);
    else owned.set(boss, [m]);
  }
  return { owned, parked };
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
