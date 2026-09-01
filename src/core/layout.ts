/**
 * Canvas: HÌNH DẠNG của một VĂN PHÒNG. → docs/SPEC-canvas.md, SPEC-offices.md §2
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BẤT BIẾN SỐ 1: layout.json chỉ chứa TOẠ ĐỘ + CẠNH NỐI, không chứa       │
 * │ NỘI DUNG. `cacheKey` băm nội dung role — nhét toạ độ vào roles/*.yaml   │
 * │ thì MỖI CÚ KÉO CHUỘT vứt ~20K cache_write. Tách file ra thì lỗi đó      │
 * │ KHÔNG THỂ xảy ra, không cần kỷ luật gì.                                 │
 * │                                                                         │
 * │ Phép thử: xoá layout.json mà văn phòng vẫn chạy y nguyên = ranh giới    │
 * │ đúng. Đó là lý do `assignable()` trả về undefined (= tất cả) khi thiếu  │
 * │ file, và lý do cạnh mcp→agent được ghi vào roles/*.yaml chứ không vào   │
 * │ đây.                                                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Cạnh `assistant → agent` CÓ NGHĨA: "Trợ lý được phép giao việc cho người này".
 * Nó điều khiển trực tiếp `roster()` trong assistant.ts → ngắt dây = bớt `pitch`
 * khỏi ngữ cảnh Trợ lý = tiết kiệm token THẬT. Kéo dây là hành động có hậu quả
 * đo được, không phải trang trí.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import type { LoadedOffice } from './config.js';
import {
  NODE_SIZE,
  SHELF_GAP,
  agentSlot,
  armSlot,
  arrangeAll,
  clashes,
  firstFreeSlot,
  parkSlot,
  type NodeKind,
  type Point,
} from './layout-geometry.js';

/** Khe giữa đáy nhân viên và đỉnh cánh tay của họ. Khớp `arrangeAll`. */
const ARM_DROP = 74;
import { findArm } from './catalog.js';
import { isSafeId } from './paths.js';

export { NODE_SIZE };
export type { NodeKind };

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** chỉ với kind=agent — trỏ tới roles/<role>.yaml */
  role?: string;
  /** chỉ với kind=mcp — tên server khai trong company.yaml */
  server?: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutFile {
  version: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export const ASSISTANT_NODE = 'assistant';
export const KNOWLEDGE_NODE = 'knowledge';
/**
 * Tủ tài liệu. Đứng CẠNH kho tri thức trên sơ đồ, và đó là cả điểm của nó:
 * hai thứ dễ lẫn nhất trong sản phẩm, nên phải nhìn thấy cùng lúc để phân biệt
 * được — thứ NGƯỜI DÙNG đưa vào, và thứ hệ thống ĐÃ HỌC.
 * → docs/SPEC-library.md §1
 */
export const LIBRARY_NODE = 'library';
export const agentNodeId = (roleId: string): string => `agent:${roleId}`;
export const mcpNodeId = (server: string): string => `mcp:${server}`;

const COORD_LIMIT = 20_000;
const MAX_NODES = 200;

/** Node kind nào được phép nối RA đâu. Agent cố tình KHÔNG có mặt ở đây. */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `mcp → assistant` ĐÃ GỠ (23/08). Nó là một SỢI DÂY KHÔNG LÀM GÌ CẢ.   │
 * │                                                                          │
 * │ Cạnh đó từng được nhận với lý do "việc vặt Trợ lý tự xử lý, cần           │
 * │ concierge (M1) mới chạy". Nhưng đi soi thì `assistant.mcp` chỉ được GHI   │
 * │ rồi ĐỌC LẠI ĐỂ VẼ — không mảnh nào nạp nó vào phiên Trợ lý. Concierge     │
 * │ chưa tồn tại. Nên nó là một lời hứa nữa không có mã nguồn thi hành.       │
 * │                                                                          │
 * │ Và nếu có ai nối nó vào thật thì còn tệ hơn im lặng: `types.ts:499` ghi   │
 * │ Trợ lý KHÔNG BAO GIỜ được cầm MCP — MCP phá prompt cache lúc `resume`,    │
 * │ mà `route()` resume ở MỌI tin nhắn ⇒ ~36 000 token mỗi lượt trò chuyện.   │
 * │                                                                          │
 * │ ⇒ Một cạnh vô hại-vì-chưa-nối-gì, dẫn thẳng tới một cái bẫy đắt nhất hệ.  │
 * │ Từ khi cắm cánh tay rẻ đi (§6), người dùng SẼ kéo thử. Gỡ khỏi bảng này   │
 * │ là chặn bằng cấu trúc; ngày concierge có thật thì thêm lại, kèm mã chạy.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Bảng này có BẢN THỨ HAI ở `web/src/lib/types.ts §CAN_CONNECT`. Hai bản của
 * cùng một luật đã đốt dự án này một lần (`agentSlot` vs `arrange`) — sửa một
 * bên thì phải sửa bên kia, và về lâu dài nên nhập chúng lại làm một.
 */
const CAN_CONNECT: Partial<Record<NodeKind, ReadonlySet<NodeKind>>> = {
  assistant: new Set<NodeKind>(['agent']),
  mcp: new Set<NodeKind>(['agent']),
};

export class LayoutStore {
  constructor(private office: LoadedOffice) {}

  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  private get file(): string {
    return this.office.paths.layoutFile;
  }

  /** File đã từng được ghi chưa. Phân biệt "chưa ai đụng" với "đã ngắt hết dây". */
  get exists(): boolean {
    return fs.existsSync(this.file);
  }

  /**
   * Hình dạng hiện tại, đã đối chiếu với roles/ và company.yaml.
   *
   * TỰ PHỤC HỒI: có file yaml mà thiếu node → thêm node vào chỗ trống (người
   * dùng thả file vào tay vẫn thấy nó xuất hiện). Có node mà thiếu file yaml →
   * GIỮ LẠI node, đánh dấu `missing` để canvas hiện đỏ, không xoá âm thầm.
   */
  /**
   * `pending` = cạnh `mcp → agent` **sắp được ghi**, do `save()` đưa xuống.
   *
   * Chỉ dùng để CHỌN CHỖ cho node chưa có toạ độ. Nó không đi vào file, không
   * đổi cạnh nào — nguồn sự thật của cạnh mcp vẫn là `roles/*.yaml`.
   * Vì sao cần: xem khối chú thích trong `spotFor`.
   */
  read(pending: readonly { from: string; to: string }[] = []): {
    layout: LayoutFile;
    missing: Set<string>;
  } {
    const raw = this.readRaw();
    const stored = new Map(raw.nodes.map((n) => [n.id, n]));

    /**
     * LƯỢT 0 — danh sách node PHẢI có mặt, chưa cần toạ độ.
     *
     * Tách hẳn bước "có những ai" khỏi bước "ai ngồi đâu". Bản trước trộn hai
     * việc vào một vòng lặp, và đó là lý do toạ độ mặc định phải viết tay từng
     * con số: lúc đặt Trợ lý thì còn chưa biết văn phòng có bao nhiêu nhân viên
     * để căn giữa theo.
     */
    const wanted: LayoutNode[] = [{ id: ASSISTANT_NODE, kind: 'assistant', x: 0, y: 0 }];
    for (const roleId of this.office.roles.keys()) {
      if (this.office.archivedRoles.has(roleId)) continue;
      wanted.push({ id: agentNodeId(roleId), kind: 'agent', role: roleId, x: 0, y: 0 });
    }
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ CÁNH TAY CHỈ HIỆN Ở VĂN PHÒNG ĐANG DÙNG NÓ. (đổi 23/08)            │
     * │                                                                    │
     * │ Bản trước dựng node cho MỌI khoá trong `company.mcpServers`, ở MỌI  │
     * │ văn phòng — đúng với ý *"một chỗ cắm, mọi văn phòng thấy"*. Ý đó    │
     * │ viết khi cắm một MCP tốn 9 bước và không ai có quá một cái.         │
     * │                                                                    │
     * │ Hộp thoại `+ Kết nối` làm việc cắm rẻ đi ⇒ TIỀN ĐỀ ĐÓ HẾT ĐÚNG.     │
     * │ User bắt được ngay lượt test đầu: cắm một cánh tay ở văn phòng này  │
     * │ thì nó mọc lên sơ đồ của cả sáu văn phòng kia, không dây nào, không │
     * │ việc gì.                                                           │
     * │                                                                    │
     * │ ⇒ Ranh giới đọc được bằng mắt: **cái gì đã cắm** là của CÔNG TY     │
     * │ (hiện ở khối "đã cắm ở văn phòng khác" trong hộp thoại), **ai được  │
     * │ dùng** là của VĂN PHÒNG (sợi dây trên sơ đồ này).                   │
     * │                                                                    │
     * │ ⚠ Duyệt theo `role.mcp` chứ KHÔNG theo `company.mcpServers`: một    │
     * │ vai trò còn khai một server đã bị rút phải vẫn thấy node đó — ở     │
     * │ trạng thái mồ côi, báo đỏ. Gộp hai chuyện *"văn phòng này không     │
     * │ dùng"* và *"không còn khai trong company.yaml"* là đúng lỗi         │
     * │ `catch { exists = false }` — hai sự việc khác hẳn nhau, một nhãn.   │
     * └────────────────────────────────────────────────────────────────────┘
     */
    // `office.arms` = CÓ MẶT trên sơ đồ (kể cả chưa nối dây ai).
    // `role.mcp`    = AI ĐƯỢC DÙNG. Hợp hai tập, vì một cánh tay còn dây mà
    // thiếu trong `office.arms` (dữ liệu cũ) vẫn phải hiện. → types.ts §arms
    const inUse = new Set<string>([...this.office.config.arms, ...this.office.config.assistant.mcp]);
    for (const [roleId, role] of this.office.roles) {
      if (this.office.archivedRoles.has(roleId)) continue;
      for (const s of role.mcp) inUse.add(s);
    }
    for (const server of inUse) {
      wanted.push({ id: mcpNodeId(server), kind: 'mcp', server, x: 0, y: 0 });
    }
    // Hai kho đứng cạnh nhau ở hàng dưới cùng: TRÁI = kho tri thức (hệ thống tự
    // học), PHẢI = tủ tài liệu (người dùng đưa vào). Thứ tự này giờ do
    // `arrangeAll` giữ, không còn là hai hằng số phải nhớ khớp nhau.
    wanted.push({ id: KNOWLEDGE_NODE, kind: 'knowledge', x: 0, y: 0 });
    wanted.push({ id: LIBRARY_NODE, kind: 'library', x: 0, y: 0 });

    /**
     * Bố cục sạch, tính bằng ĐÚNG hàm mà nút "Sắp xếp lại sơ đồ" chạy.
     *
     * ⚠ Cạnh dựng từ `role.mcp` — **nguồn sự thật là yaml**, không phải cạnh
     * trong `layout.json` (chúng còn chưa được dựng ở đoạn này, và kể cả có thì
     * cạnh `mcp→agent` cố ý không được lưu ở đó). Cùng dữ liệu mà `arrangeAll`
     * cần để biết cánh tay nào thuộc về ai.
     */
    const links: { from: string; to: string }[] = [];
    for (const [roleId, role] of this.office.roles) {
      if (this.office.archivedRoles.has(roleId)) continue;
      for (const s of role.mcp) links.push({ from: mcpNodeId(s), to: agentNodeId(roleId) });
    }
    // Cạnh sắp ghi cũng vào bố cục sạch — nếu không, `tidy` và `spotFor` nhìn
    // hai sự thật khác nhau về cùng một cánh tay trong cùng một lời gọi.
    for (const e of pending) if (!links.some((l) => l.from === e.from && l.to === e.to)) links.push(e);
    const tidy = arrangeAll(wanted.map((n) => ({ ...n, ...this.armGroup(n) })), links);

    const nodes: LayoutNode[] = [];
    const seen = new Set<string>();
    const keep = (n: LayoutNode): void => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      nodes.push(n);
    };

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ Ô CHO NODE MỚI PHẢI LÀ Ô TRỐNG THẬT, KHÔNG PHẢI Ô THỨ i.           │
     * │                                                                    │
     * │ Bản trước dùng `agentSlot(i)` với `i` = thứ tự ALPHABET của vai     │
     * │ trò, không kiểm ô đó đã có ai ngồi chưa. Thêm một nhân viên tên sắp │
     * │ xếp TRƯỚC người cũ thì nó rơi ĐÚNG lên trên người cũ, và người dùng │
     * │ thấy "bấm Thêm mà không có gì xảy ra".                              │
     * │                                                                    │
     * │ ⚠ HAI LƯỢT, và đây là nửa dễ làm sai: phải đặt xong MỌI node đã có  │
     * │ toạ độ rồi mới cấp ô cho node mới. Duyệt một lượt theo alphabet thì │
     * │ node mới tên "ai-do" được cấp ô TRƯỚC khi "nguoi-viet" kịp vào danh │
     * │ sách — và ta lại kiểm va chạm với một danh sách còn rỗng.           │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const fresh: LayoutNode[] = [];
    for (const n of wanted) {
      const prev = stored.get(n.id);
      if (prev) keep({ ...n, x: prev.x, y: prev.y });
      else fresh.push(n);
    }

    /**
     * Node mồ côi: file yaml / mcp server đã biến mất. Giữ lại + báo đỏ.
     *
     * Xếp TRƯỚC lượt hai chứ không phải sau: chúng đang chiếm chỗ thật trên sơ
     * đồ, nên node mới phải tránh chúng. Bản trước nối chúng vào cuối, tức là
     * `firstFreeSlot` không nhìn thấy chúng và có thể đặt người mới đè lên.
     *
     * ⚠ Vai trò đã LƯU TRỮ không phải mồ côi. File của nó còn nguyên, chỉ là
     * người dùng bảo cất đi. Đưa nó vào đây là "cất xong nó hiện lại, màu đỏ" —
     * tệ hơn cả không cho cất.
     */
    const missing = new Set<string>();
    for (const n of raw.nodes) {
      if (seen.has(n.id)) continue;
      if (n.kind !== 'agent' && n.kind !== 'mcp') continue;
      if (n.role && this.office.archivedRoles.has(n.role)) continue;
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 NODE MCP ĐÃ RÚT HẲN THÌ BIẾN MẤT, KHÔNG "MỒ CÔI VĨNH VIỄN".     │
       * │                                                                    │
       * │ Bug user báo 23/08: xoá kết nối xong node `🔌 files` vẫn nằm trên   │
       * │ sơ đồ với nhãn "không còn cắm", và **không nút nào gỡ được nó** —   │
       * │ bấm Xoá lần nữa cũng thế, vì `company.yaml` và `roles/*.yaml` đều   │
       * │ đã sạch từ lâu.                                                    │
       * │                                                                    │
       * │ Thủ phạm là chính vòng lặp này: `layout.json` còn lưu node, vòng    │
       * │ lặp thấy nó "không được muốn nữa" nên **giữ lại + báo đỏ**, rồi     │
       * │ `save()` ghi `current.nodes` trở lại đĩa ⇒ nó tự tái sinh mãi mãi.  │
       * │                                                                    │
       * │ Với AGENT thì giữ lại là ĐÚNG: file `roles/x.yaml` biến mất là một  │
       * │ sự cố, người dùng cần thấy để còn khôi phục. Với MCP thì không có   │
       * │ gì để khôi phục — không khai ở công ty, không vai trò nào trỏ tới,  │
       * │ tức là nó **đã bị rút xong**, và cái node chỉ còn là rác nhìn thấy.  │
       * │                                                                    │
       * │ Mồ côi THẬT của MCP là ca khác, và nó vẫn được giữ ở vòng lặp dưới:│
       * │ vai trò CÒN khai `mcp: [x]` mà `company.yaml` đã sạch.              │
       * └────────────────────────────────────────────────────────────────────┘
       */
      if (n.kind === 'mcp' && n.server && !inUse.has(n.server)) continue;
      missing.add(n.id);
      keep(n);
    }
    /**
     * Mồ côi KIỂU THỨ HAI, và nó chỉ xuất hiện từ 23/08: một vai trò còn khai
     * `mcp: [x]` trong khi `x` đã bị rút khỏi `company.yaml`.
     *
     * Vòng lặp trên không bắt được nó — nó bắt node CÒN TRONG `layout.json` mà
     * không còn được muốn; ca này thì ngược lại, node ĐANG được muốn (vì role
     * khai) nhưng thứ nó trỏ tới đã biến mất. Hai hình dạng khác nhau, và gộp
     * chúng vào một vòng lặp là cách chắc chắn nhất để sót một cái.
     */
    for (const server of inUse) {
      if (!(server in this.office.company.mcpServers)) missing.add(mcpNodeId(server));
    }

    // LƯỢT HAI: giờ mọi node đã có chỗ đều nằm trong `nodes`, cấp ô cho node mới.
    for (const n of fresh) keep({ ...n, ...this.spotFor(n, nodes, tidy, pending) });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Chưa có file = mọi nhân viên đều được giao việc. Đây là phép thử
    // "xoá layout.json mà văn phòng chạy y nguyên".
    const edges = this.exists
      ? sanitizeEdges(raw.edges, byId)
      : this.activeRoleIds().map((r) => ({ from: ASSISTANT_NODE, to: agentNodeId(r) }));

    // Cạnh mcp→agent KHÔNG được lưu ở đây — nó sống trong roles/<id>.yaml.
    // Dựng lại lúc đọc để canvas vẽ đúng, nhưng nguồn sự thật vẫn là yaml.
    const seenEdge = new Set(edges.map((e) => `${e.from} ${e.to}`));
    for (const [roleId, role] of this.office.roles) {
      for (const server of role.mcp) {
        const from = mcpNodeId(server);
        const key = `${from} ${agentNodeId(roleId)}`;
        if (!byId.has(from) || seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from, to: agentNodeId(roleId) });
      }
    }
    // Cạnh mcp→assistant cũng là NỘI DUNG: nó sống trong office.yaml.
    for (const server of this.office.config.assistant.mcp) {
      const from = mcpNodeId(server);
      const key = `${from} ${ASSISTANT_NODE}`;
      if (!byId.has(from) || seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ from, to: ASSISTANT_NODE });
    }

    return { layout: { version: 1, nodes, edges }, missing };
  }

  /**
   * Khoá SẮP XẾP cho cánh tay ở bãi đỗ. → `layout-geometry.ts §ArrangeNode`
   *
   *   `0-files`      thư mục trên máy      — nhóm riêng, đứng đầu
   *   `1-<mục>`      dịch vụ có sẵn        — cùng hãng thì cùng tiền tố ⇒ đứng cạnh nhau
   *   `2-custom`     tự dán, không có mục
   *
   * ⚠ Phân loại bằng `entry.folders` chứ không bằng **tên mục**: đúng cùng luật
   * `ArmDialog §kindOf` đang dùng cho icon. Một trục phân loại, hai chỗ đọc —
   * thêm một hãng thư mục nữa thì cả hai tự đúng, không ai phải nhớ gì.
   */
  armGroup(n: { kind: NodeKind; server?: string }): { armGroup?: string } {
    if (n.kind !== 'mcp' || !n.server) return {};
    const cat = this.office.company.arms[n.server]?.catalog;
    if (!cat) return { armGroup: '2-custom' };
    return { armGroup: findArm(cat)?.folders ? '0-files' : `1-${cat}` };
  }

  /**
   * Chỗ ngồi cho một node CHƯA TỪNG có toạ độ. Ba nước, dừng ở nước đầu chạy được.
   *
   * 1. **Chưa có `layout.json`** = văn phòng mới tinh, chưa ai kéo gì → dùng
   *    nguyên bố cục sạch. Đây là chỗ sửa lỗi "tạo văn phòng mới thì canvas
   *    lệch": trước đây nhánh này là ba hằng số viết tay không căn theo nhau.
   *
   * 2. **Kho mọc thêm vào sơ đồ đã có** — ca thật đang nằm trên đĩa: văn phòng
   *    lưu `layout.json` từ trước khi có node Tủ tài liệu. Bố cục sạch tính
   *    theo số nhân viên, còn kho anh em thì người dùng đã kéo đi chỗ khác →
   *    hai kho rơi ra hai nơi, lệch cả hàng. Bám theo ANH EM của nó thì hàng
   *    dưới luôn thẳng, dù người dùng đã kéo nó đi đâu.
   *
   * 3. **Nhân viên mới** — mọc TOẢ RA hai bên Trợ lý, không nối đuôi sang phải.
   *    Bố cục sạch ở đây vô dụng: nó căn theo SỐ nhân viên, mà Trợ lý thì đứng
   *    yên cho tới lúc ai đó bấm "Sắp xếp lại". Bám vào nó thì người thứ ba rơi
   *    bên phải người thứ hai và sơ đồ nghiêng hẳn — người dùng phải bấm Sắp
   *    xếp lại mới thấy cân, tức là hệ thống bắt họ dọn hộ mình. → `centeredSlot`
   *
   * 4. Còn lại: chỗ sạch nếu chỗ đó trống, không thì ô lưới trống đầu tiên.
   */
  private spotFor(
    node: LayoutNode,
    placed: readonly LayoutNode[],
    tidy: ReadonlyMap<string, Point>,
    pending: readonly { from: string; to: string }[] = [],
  ): Point {
    if (!this.exists) return tidy.get(node.id) ?? agentSlot(0);

    if (node.kind === 'library' || node.kind === 'knowledge') {
      const twinKind = node.kind === 'library' ? 'knowledge' : 'library';
      const twin = placed.find((n) => n.kind === twinKind);
      if (twin) {
        const step = NODE_SIZE.knowledge.w + SHELF_GAP;
        const spot = { x: node.kind === 'library' ? twin.x + step : twin.x - step, y: twin.y };
        if (!clashes(spot, node.kind, placed)) return spot;
      }
    }

    if (node.kind === 'agent') {
      // Trợ lý LUÔN nằm trong `placed` khi tới lượt nhân viên: `wanted` xếp nó
      // đầu tiên, nên nó được cấp chỗ trước. Vẫn kiểm — thiếu nó thì rơi về
      // đếm-từ-trái chứ không được ném.
      const boss = placed.find((n) => n.kind === 'assistant');
      const centerX = boss ? boss.x + NODE_SIZE.assistant.w / 2 : undefined;
      return firstFreeSlot(placed, 'agent', centerX);
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 CÁNH TAY MỚI BÁM THEO CHỦ CỦA NÓ. (bug user bắt 31/08)          │
     * │                                                                    │
     * │   *"cứ thêm 1 MCP kết nối mới: địa điểm nó chọn rất tệ: thay vì     │
     * │    ngay dưới worker được kết nối còn 1 vài khoảng trống, nó chọn    │
     * │    faraway"*                                                       │
     * │                                                                    │
     * │ Hai lý do chồng nhau, và phải sửa cả hai:                          │
     * │  ① `tidy` tính cho bố cục SẠCH, mà người dùng đã kéo mọi thứ đi     │
     * │     chỗ khác ⇒ ô đó gần như luôn `clashes` ⇒ rơi xuống nước hai.    │
     * │  ② nước hai là `firstFreeSlot` — lưới NHÂN VIÊN, bước 202×120. Quá  │
     * │     thô cho một node 152×52, nên nó nhảy qua hết khe trống thật.    │
     * │                                                                    │
     * │ ⇒ Đi tìm CHỦ trước (`role.mcp` là nguồn sự thật, không phải cạnh    │
     * │ trong layout.json), rồi quét lưới riêng của cánh tay ngay dưới họ.  │
     * │ Không ai cầm ⇒ nó là hàng chưa dùng ⇒ **bãi đỗ bên trái**, đúng chỗ │
     * │ user đã tự kéo chúng tới.                                          │
     * └────────────────────────────────────────────────────────────────────┘
     */
    if (node.kind === 'mcp' && node.server) {
      const owners = new Set<string>();
      for (const [roleId, role] of this.office.roles) {
        if (role.mcp.includes(node.server)) owners.add(agentNodeId(roleId));
      }
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 SỢI DÂY SẮP ĐƯỢC GHI CŨNG TÍNH. (bug user bắt 31/08)            │
       * │                                                                    │
       * │   *"node mcp vừa kết nối lại canvas, nó lại mọc rất xa ở farleft,  │
       * │    trong khi nó chỉ cần nối thẳng xuống"*                          │
       * │                                                                    │
       * │ Thứ tự trong `grantArm` là: ghi `office.arms` → **đặt chỗ cho node**│
       * │ → mới ghi sợi dây (`role.mcp`). Nên đúng lúc `spotFor` chạy,        │
       * │ `role.mcp` **còn rỗng** ⇒ không tìm ra chủ ⇒ coi là hàng chưa dùng  │
       * │ ⇒ **đỗ bên trái**. Và vì toạ độ đã lưu, `spotFor` không chạy lại    │
       * │ lần nào nữa: nó nằm đó vĩnh viễn.                                  │
       * │                                                                    │
       * │ Bản vá 30/08 đúng về hình học và sai về THỜI ĐIỂM — nó hỏi một      │
       * │ nguồn sự thật chưa kịp thành sự thật. Cùng lớp §3a: *thứ đo được   │
       * │ không phải trạng thái, là THỜI ĐIỂM HỎI*.                          │
       * │                                                                    │
       * │ ⇒ `save()` đưa xuống chính danh sách cạnh nó **sắp ghi**. Không có │
       * │ cạnh nào (cắm mà chưa giao cho ai) thì vẫn đỗ bên trái — đúng.     │
       * └────────────────────────────────────────────────────────────────────┘
       */
      for (const e of pending) {
        if (e.from === node.id) owners.add(e.to);
      }
      const anchors = placed.filter((n) => owners.has(n.id));
      if (anchors.length) {
        // Trục = tâm của chủ TRÁI NHẤT. Cùng luật `groupArms`: mọi sợi dây thứ
        // hai đi sang phải, không sợi nào cắt sợi nào.
        const boss = anchors.reduce((a, b) => (a.x <= b.x ? a : b));
        const centerX = boss.x + NODE_SIZE.agent.w / 2;
        const topY = Math.max(...anchors.map((a) => a.y + NODE_SIZE.agent.h)) + ARM_DROP;
        for (let i = 0; i < 40; i++) {
          const spot = armSlot(i, centerX, topY);
          if (!clashes(spot, 'mcp', placed)) return spot;
        }
      } else {
        const parked = placed.filter((n) => n.kind === 'mcp');
        for (let i = 0; i < 40; i++) {
          const spot = parkSlot(i);
          if (!clashes(spot, 'mcp', parked)) return spot;
        }
      }
    }

    const want = tidy.get(node.id);
    if (want && !clashes(want, node.kind, placed)) return want;
    return firstFreeSlot(placed, node.kind);
  }

  /**
   * Vai trò Trợ lý ĐƯỢC PHÉP giao việc. `undefined` = tất cả.
   *
   * undefined chứ không phải "toàn bộ danh sách" là có chủ ý: assistant.ts phân
   * biệt "chưa cấu hình" với "cấu hình cho phép tất cả", và chỉ trường hợp đầu
   * mới được im lặng bỏ qua khi layout.json vắng mặt.
   */
  assignable(): Set<string> | undefined {
    if (!this.exists) return undefined;
    const { layout } = this.read();
    const out = new Set<string>();
    for (const e of layout.edges) {
      if (e.from !== ASSISTANT_NODE) continue;
      const node = layout.nodes.find((n) => n.id === e.to);
      if (node?.kind === 'agent' && node.role) out.add(node.role);
    }
    return out;
  }

  /**
   * Ghi hình dạng mới.
   *
   * Cạnh từ node mcp KHÔNG nằm trong layout.json — "agent này dùng được tool
   * nào" là NỘI DUNG, không phải hình dạng. Nó đã có nhà rồi: `mcp:` trong
   * roles/<id>.yaml (hoặc office.yaml với Trợ lý). Ghi hai nơi = hai nguồn sự
   * thật = sớm muộn cũng lệch nhau.
   *
   * Trả về danh sách file đã sửa, để caller biết có phải nạp lại không.
   */
  save(input: { nodes?: unknown; edges?: unknown }): { touched: string[] } {
    /**
     * ⭐ ĐƯA CẠNH SẮP GHI XUỐNG `read()` — xem khối chú thích ở `spotFor`.
     *
     * Quét thô, KHÔNG qua `sanitizeEdges`: hàm đó cần `byId`, mà `byId` lại đến
     * từ chính `read()` này — vòng tròn. Ở đây chỉ cần một **gợi ý chỗ ngồi**,
     * nên một cạnh rác lọt vào cũng chỉ là gợi ý bị bỏ qua, không ghi ra đâu cả.
     */
    const hint = Array.isArray(input.edges)
      ? (input.edges as { from?: unknown; to?: unknown }[])
          .filter((e) => typeof e?.from === 'string' && typeof e?.to === 'string')
          .map((e) => ({ from: e.from as string, to: e.to as string }))
      : [];
    const current = this.read(hint).layout;
    const byId = new Map(current.nodes.map((n) => [n.id, n]));

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ "NODE HIỆN RA" ≠ "ĐẦU DÂY HỢP LỆ" — và gộp hai cái là một VÒNG LẶP │
     * │ tự khoá. (bắt được lúc kiểm đầu-cuối 23/08, ngay sau khi viết)      │
     * │                                                                    │
     * │ Từ 23/08 `read()` chỉ dựng node mcp cho server ĐANG ĐƯỢC DÙNG ở văn │
     * │ phòng này (`role.mcp`). Nhưng `role.mcp` lại được ghi TỪ cạnh nối, │
     * │ mà cạnh nối thì `sanitizeEdges` lọc theo node đang có ⇒ cắm một     │
     * │ cánh tay mới và giao cho ai đó thì:                                 │
     * │                                                                    │
     * │   chưa ai dùng → không có node → cạnh bị loại → không ghi `mcp:`    │
     * │   → vẫn không ai dùng. Kẹt vĩnh viễn, và **im lặng**.               │
     * │                                                                    │
     * │ Hai tập vốn khác nhau và giờ nói ra: HIỆN RA = đang có dây ở văn    │
     * │ phòng này (chuyện của sơ đồ). HỢP LỆ = có khai trong `company.yaml`  │
     * │ (chuyện của công ty). Node bù ở đây chỉ sống trong lời gọi này để   │
     * │ thẩm định cạnh — nó KHÔNG bao giờ vào `layout.json`, vì cạnh mcp    │
     * │ vốn không được lưu ở đó.                                           │
     * └────────────────────────────────────────────────────────────────────┘
     */
    for (const server of Object.keys(this.office.company.mcpServers)) {
      const id = mcpNodeId(server);
      if (!byId.has(id)) byId.set(id, { id, kind: 'mcp', server, x: 0, y: 0 });
    }

    // Toạ độ: chỉ nhận node đã biết. Client không được tự sinh node bằng PUT.
    if (Array.isArray(input.nodes)) {
      for (const raw of input.nodes.slice(0, MAX_NODES)) {
        const n = raw as Partial<LayoutNode>;
        if (typeof n.id !== 'string') continue;
        const node = byId.get(n.id);
        if (!node) continue;
        node.x = clampCoord(n.x);
        node.y = clampCoord(n.y);
      }
    }

    const wanted = sanitizeEdges(input.edges, byId);

    // ── tách hai loại cạnh: hình dạng vào layout.json, tool vào yaml
    const mcpByRole = new Map<string, string[]>();
    const mcpForAssistant: string[] = [];
    for (const e of wanted) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (from?.kind !== 'mcp' || !from.server) continue;
      if (to?.kind === 'assistant') {
        mcpForAssistant.push(from.server);
      } else if (to?.kind === 'agent' && to.role) {
        const list = mcpByRole.get(to.role) ?? [];
        list.push(from.server);
        mcpByRole.set(to.role, list);
      }
    }

    this.writeRaw({ version: 1, nodes: current.nodes, edges: wanted });

    const touched: string[] = [];
    for (const [roleId, role] of this.office.roles) {
      // Vai trò đã lưu trữ KHÔNG có node trên canvas, nên không có cạnh nào trỏ
      // tới nó. Không bỏ qua ở đây thì mỗi lần ghi sơ đồ là một lần xoá sạch
      // danh sách `mcp:` của nó — người dùng cất một nhân viên đi rồi khôi phục
      // lại thấy nó mất hết tool, mà không có thao tác nào nói rằng sẽ mất.
      if (this.office.archivedRoles.has(roleId)) continue;
      const next = [...new Set(mcpByRole.get(roleId) ?? [])].sort();
      if (sameList(next, role.mcp)) continue;
      if (this.writeYamlKey(this.roleFile(roleId), ['mcp'], next)) touched.push(`roles/${roleId}`);
    }
    const nextAssistant = [...new Set(mcpForAssistant)].sort();
    if (!sameList(nextAssistant, this.office.config.assistant.mcp)) {
      if (this.writeYamlKey(this.office.paths.configFile, ['assistant', 'mcp'], nextAssistant)) {
        touched.push('office');
      }
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ SỰ CÓ MẶT CHỈ ĐƯỢC THÊM Ở ĐÂY, KHÔNG BAO GIỜ BỚT.                  │
     * │                                                                    │
     * │ Bug user báo 23/08: cắt sợi dây cuối cùng thì node cánh tay BIẾN    │
     * │ MẤT khỏi sơ đồ. Họ muốn nó ở lại như nhân viên "đang nghỉ" — còn    │
     * │ đó, chưa nối, nối lại lúc nào cũng được.                            │
     * │                                                                    │
     * │ `office.arms` là chỗ ghi sự có mặt, và nó CHỈ bị bớt bởi `dropArm`  │
     * │ — tức một thao tác XOÁ có chủ ý. Cắt dây là đổi *ai được dùng*,     │
     * │ không phải đổi *có mặt hay không*: hai chuyện khác nhau, hai chỗ    │
     * │ ghi, và giờ chúng không còn dẫm lên nhau.                          │
     * │                                                                    │
     * │ Thêm ở đây cũng TỰ CHỮA dữ liệu cũ: cánh tay cắm trước khi có       │
     * │ `office.arms` chỉ tồn tại trong `role.mcp`, nên cắt dây là chúng    │
     * │ bốc hơi. Lần ghi sơ đồ đầu tiên đưa chúng vào sổ, một lần, im lặng. │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const present = new Set(this.office.config.arms);
    for (const list of mcpByRole.values()) for (const s of list) present.add(s);
    for (const s of mcpForAssistant) present.add(s);
    const nextArms = [...present].sort();
    if (!sameList(nextArms, this.office.config.arms)) {
      if (this.writeYamlKey(this.office.paths.configFile, ['arms'], nextArms)) touched.push('office');
    }

    return { touched };
  }

  /** Vai trò chưa bị lưu trữ. Đây là danh sách canvas và roster nhìn thấy. */
  private activeRoleIds(): string[] {
    return [...this.office.roles.keys()].filter((id) => !this.office.archivedRoles.has(id));
  }

  /**
   * Đưa một nhân viên lên sơ đồ: đặt vào ô trống, GHI ĐĨA.
   *
   * Luôn `writeRaw`, kể cả khi không có gì để thêm. Bản trước gọi
   * `connectAssistant` và nó `return` sớm nếu cạnh đã tồn tại — mà cạnh LUÔN tồn
   * tại khi chưa có layout.json (lúc đó `read()` tự sinh cạnh cho mọi vai trò).
   * Kết quả: vị trí vừa tính ra không bao giờ được lưu, và mỗi lần đọc lại nó
   * được tính lại từ đầu.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `connect` PHẢI LÀ QUYẾT ĐỊNH CỦA NGƯỜI GỌI, KHÔNG PHẢI MẶC ĐỊNH.        │
   * │                                                                          │
   * │ Nhân viên MỚI thì nối: thêm một người rồi không giao được việc cho họ là │
   * │ một thao tác không có kết quả, và người dùng không đoán ra là còn thiếu  │
   * │ một sợi dây.                                                             │
   * │                                                                          │
   * │ Nhân viên KHÔI PHỤC từ lưu trữ thì KHÔNG nối. Ba lý do:                  │
   * │  1. Nối dây = vào roster = vào prefix được cache của MỌI lượt trò chuyện.│
   * │     Một cú bấm "đưa trở lại" không được phép âm thầm bật lại một khoản   │
   * │     chi thu suốt ca.                                                     │
   * │  2. "Đưa trở lại" và "cho nhận việc" là HAI ý định. Một nút không được   │
   * │     làm hai việc, nhất là khi việc thứ hai tốn tiền.                     │
   * │  3. Người dùng có thể đã CỐ Ý ngắt dây trước khi cất. Tự nối lại là ghi  │
   * │     đè lên một quyết định họ đã ra — và ghi đè im lặng.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  placeAgent(roleId: string, connect: boolean): void {
    const { layout } = this.read();
    const to = agentNodeId(roleId);
    if (!layout.nodes.some((n) => n.id === to)) return;
    if (connect && !layout.edges.some((e) => e.from === ASSISTANT_NODE && e.to === to)) {
      layout.edges.push({ from: ASSISTANT_NODE, to });
    }
    this.writeRaw(layout);
  }

  /** Bỏ node khỏi layout (file yaml có bị xoá hay không là quyết định của caller). */
  dropAgent(roleId: string): void {
    if (!this.exists) return;
    const raw = this.readRaw();
    const id = agentNodeId(roleId);
    this.writeRaw({
      version: 1,
      nodes: raw.nodes.filter((n) => n.id !== id),
      edges: raw.edges.filter((e) => e.from !== id && e.to !== id),
    });
  }

  // ── nội bộ

  private readRaw(): LayoutFile {
    if (!this.exists) return { version: 1, nodes: [], edges: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<LayoutFile>;
      return {
        version: 1,
        nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isNodeShape).slice(0, MAX_NODES) : [],
        edges: Array.isArray(raw.edges) ? raw.edges.filter(isEdgeShape) : [],
      };
    } catch {
      // layout.json hỏng KHÔNG được làm sập văn phòng — nó chỉ là view state.
      process.emitWarning('layout.json không đọc được, canvas sẽ tự sắp xếp lại.');
      return { version: 1, nodes: [], edges: [] };
    }
  }

  /**
   * Chốt chặn DUY NHẤT ghi ra đĩa. Cạnh từ node mcp bị lọc ở đây, nên không có
   * đường nào để nó lọt vào layout.json dù caller quên — bất biến "một sự thật
   * một nơi ở" được giữ bằng cấu trúc, không bằng kỷ luật.
   */
  private writeRaw(layout: LayoutFile): void {
    const kindOf = new Map(layout.nodes.map((n) => [n.id, n.kind]));
    const payload: LayoutFile = {
      version: 1,
      nodes: layout.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: Math.round(n.x),
        y: Math.round(n.y),
        ...(n.role ? { role: n.role } : {}),
        ...(n.server ? { server: n.server } : {}),
      })),
      edges: layout.edges.filter((e) => kindOf.get(e.from) !== 'mcp').map((e) => ({ from: e.from, to: e.to })),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  /**
   * Sửa đúng một khoá trong một file yaml.
   *
   * Dùng parseDocument chứ không parse+stringify: ghi đè cả file sẽ NUỐT MẤT
   * chú thích người dùng viết — mà "yaml sửa tay được, git diff đọc được" là
   * một trong hai lý do không nhét tất cả vào một cục JSON như n8n.
   */
  private writeYamlKey(file: string | undefined, keyPath: string[], value: string[]): boolean {
    if (!file || !fs.existsSync(file)) return false;
    try {
      const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
      if (value.length) doc.setIn(keyPath, value);
      else doc.deleteIn(keyPath);
      // lineWidth 0: đừng ngắt dòng lại những giá trị ta không đụng tới. Cắm một
      // MCP mà git diff nhảy 8 dòng thì người dùng mất niềm tin vào việc
      // "file của tôi vẫn là của tôi".
      fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
      return true;
    } catch {
      process.emitWarning(`Không ghi được ${keyPath.join('.')} vào ${path.basename(file)}`);
      return false;
    }
  }

  private roleFile(roleId: string): string | undefined {
    if (!isSafeId(roleId)) return undefined;
    for (const ext of ['.yaml', '.yml']) {
      const f = path.join(this.office.paths.roles, `${roleId}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────── helpers

/**
 * Luật nối dây, thi hành ở SERVER.
 *
 * Canvas làm cho agent→agent BẤT KHẢ THI về mặt vật lý (node agent không có
 * cổng ra). Nhưng UI là client — ai cũng POST thẳng được. Luật kinh tế
 * (agent nói chuyện với agent = nguồn đốt token lớn nhất) phải được giữ ở đây
 * mới thật sự là luật.
 */
function sanitizeEdges(raw: unknown, byId: ReadonlyMap<string, LayoutNode>): LayoutEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isEdgeShape(item)) continue;
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    if (!from || !to || from.id === to.id) continue;
    if (!CAN_CONNECT[from.kind]?.has(to.kind)) continue;
    const key = `${from.id} ${to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: from.id, to: to.id });
  }
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(' ') === [...b].sort().join(' ');
}

function clampCoord(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)));
}

function isNodeShape(v: unknown): v is LayoutNode {
  const n = v as Partial<LayoutNode>;
  return (
    !!n &&
    typeof n.id === 'string' &&
    n.id.length > 0 &&
    n.id.length < 200 &&
    (n.kind === 'assistant' ||
      n.kind === 'agent' ||
      n.kind === 'knowledge' ||
      n.kind === 'library' ||
      n.kind === 'mcp')
  );
}

function isEdgeShape(v: unknown): v is LayoutEdge {
  const e = v as Partial<LayoutEdge>;
  return !!e && typeof e.from === 'string' && typeof e.to === 'string';
}
