/**
 * Test cho phép toán bố cục sơ đồ. → src/core/layout-geometry.ts
 *
 * SESSIONS_MEMORY §4 xếp `firstFreeSlot` là ứng viên test số một và ghi rõ lý
 * do: nó ĐÃ từng có bug, bug đó biên dịch sạch, và nó chỉ lộ ra khi người dùng
 * thêm nhân viên rồi thấy "không có gì xảy ra".
 *
 * Bài học 19/08 thêm một ứng viên nữa: `arrangeAll` từng có HAI bản mã (server
 * và giao diện), và chúng lệch nhau. Test ở đây chốt cái tính chất mà con mắt
 * người dùng thật sự kiểm: **mọi thứ phải căn quanh cùng một trục dọc**. Tính
 * chất đó không phụ thuộc vào con số cụ thể, nên nó không vỡ khi ta chỉnh khoảng
 * cách cho đẹp hơn.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NODE_SIZE,
  agentSlot,
  arrangeAll,
  centeredSlot,
  clashes,
  firstFreeSlot,
  type NodeKind,
} from '../dist/core/layout-geometry.js';

type Node = { id: string; kind: NodeKind };

const agents = (n: number): Node[] =>
  Array.from({ length: n }, (_, i) => ({ id: `agent:r${i}`, kind: 'agent' as const }));

const shell = (n: number): Node[] => [
  { id: 'assistant', kind: 'assistant' },
  ...agents(n),
  { id: 'knowledge', kind: 'knowledge' },
  { id: 'library', kind: 'library' },
];

/** Tâm ngang của một node đã được đặt. */
function midX(out: Map<string, { x: number; y: number }>, id: string, kind: NodeKind): number {
  const p = out.get(id);
  assert.ok(p, `thiếu node ${id}`);
  return p.x + NODE_SIZE[kind].w / 2;
}

// ─────────────────────────────────────────────────────────── arrangeAll

/**
 * ĐÂY LÀ TEST CHO ĐÚNG LỖI 19/08.
 *
 * Văn phòng mới tinh: server cấp toạ độ viết tay (Trợ lý 520, kho 300/524) còn
 * giao diện tính ra 122 / 26 / 250. Tâm Trợ lý 636 vs tâm dải kho 512 → lệch
 * 124px trước khi có bất kỳ nhân viên nào.
 */
test('arrangeAll: Trợ lý và dải kho căn CÙNG một trục — kể cả khi chưa có nhân viên', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    const out = arrangeAll(shell(n));
    const assistant = midX(out, 'assistant', 'assistant');
    const kn = out.get('knowledge')!;
    const lib = out.get('library')!;
    const shelfMid = (kn.x + lib.x + NODE_SIZE.library.w) / 2;
    // Cho phép 1px sai số làm tròn, không hơn.
    assert.ok(
      Math.abs(assistant - shelfMid) <= 1,
      `${n} nhân viên: Trợ lý ở ${assistant}, dải kho ở ${shelfMid}`,
    );
  }
});

test('arrangeAll: kho tri thức TRÁI, tủ tài liệu PHẢI, cùng một hàng', () => {
  const out = arrangeAll(shell(3));
  const kn = out.get('knowledge')!;
  const lib = out.get('library')!;
  // Thứ tự này là nội dung sản phẩm, không phải thẩm mỹ: hai khái niệm dễ lẫn
  // nhất phải nhìn thấy cùng lúc thì mới phân biệt được.
  assert.ok(kn.x < lib.x, 'kho tri thức phải đứng bên trái tủ tài liệu');
  assert.equal(kn.y, lib.y, 'hai kho phải cùng một hàng');
  assert.equal(lib.x - kn.x, NODE_SIZE.knowledge.w + 24, 'khe giữa hai kho');
});

test('arrangeAll: hàng nhân viên xuống dòng sau 4 người, và không ai chồng ai', () => {
  const out = arrangeAll(shell(6));
  assert.equal(out.get('agent:r0')!.y, out.get('agent:r3')!.y);
  assert.ok(out.get('agent:r4')!.y > out.get('agent:r0')!.y);

  const placed = [...out.entries()].map(([id, p]) => ({
    kind: (id === 'assistant' ? 'assistant' : id.startsWith('agent:') ? 'agent' : id) as NodeKind,
    ...p,
  }));
  for (let i = 0; i < placed.length; i++) {
    const mine = placed[i]!;
    const others = placed.filter((_, j) => j !== i);
    assert.equal(clashes(mine, mine.kind, others), false, `node ${i} chồng lên node khác`);
  }
});

test('arrangeAll: hai kho luôn nằm DƯỚI hàng nhân viên cuối cùng', () => {
  const out = arrangeAll(shell(5));
  const lowestAgent = Math.max(...agents(5).map((a) => out.get(a.id)!.y + NODE_SIZE.agent.h));
  assert.ok(out.get('knowledge')!.y > lowestAgent);
});

// ─────────────────────────────────────────────────────────── firstFreeSlot

/**
 * Lỗi gốc 16/08: ô được cấp theo THỨ TỰ ALPHABET của vai trò, không kiểm ô đó
 * có ai ngồi chưa. Nhân viên tên sắp trước người cũ rơi đúng lên trên người cũ.
 */
test('firstFreeSlot: không bao giờ trả về ô đã có người ngồi', () => {
  const taken = [{ kind: 'agent' as const, ...agentSlot(0) }];
  const spot = firstFreeSlot(taken);
  assert.notDeepEqual(spot, agentSlot(0));
  assert.deepEqual(spot, agentSlot(1));
});

test('firstFreeSlot: tránh cả node KHÁC LOẠI, không chỉ node agent', () => {
  // Ca thật: một node mcp hoặc một kho bị người dùng kéo vào giữa hàng nhân viên.
  const blocker = { kind: 'knowledge' as const, ...agentSlot(0) };
  assert.notDeepEqual(firstFreeSlot([blocker]), agentSlot(0));
});

test('firstFreeSlot: hai người thêm liên tiếp nhận HAI ô khác nhau', () => {
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [];
  const a = firstFreeSlot(placed);
  placed.push({ kind: 'agent', ...a });
  const b = firstFreeSlot(placed);
  assert.notDeepEqual(a, b);
});

test('firstFreeSlot: node lệch 10px vẫn tính là chồng — mắt người, không phải toạ độ', () => {
  const nudged = { kind: 'agent' as const, x: agentSlot(0).x + 10, y: agentSlot(0).y + 10 };
  assert.notDeepEqual(firstFreeSlot([nudged]), agentSlot(0));
});

test('firstFreeSlot: sơ đồ rỗng thì nhận ô đầu tiên', () => {
  assert.deepEqual(firstFreeSlot([]), agentSlot(0));
});

// ─────────────────────────────────────────────────────────── centeredSlot
//
// Lỗi 20/08 do user báo: "3 nhân viên về 1 phía, phải bấm Sắp xếp lại nó mới
// đều". Cùng lớp với lỗi 16/08 — người mới được cấp ô mà không nhìn sơ đồ đang
// có hình gì — nhưng lần này ô KHÔNG chồng lên ai, nó chỉ nằm sai chỗ.

test('centeredSlot: thứ tự lệch là 0 → +1 → −1 → +2 rồi xuống hàng', () => {
  const c = 238; // tâm cột 0
  const step = NODE_SIZE.agent.w + 40;
  assert.equal(centeredSlot(0, c).x, agentSlot(0).x);
  assert.equal(centeredSlot(1, c).x, agentSlot(0).x + step);
  assert.equal(centeredSlot(2, c).x, agentSlot(0).x - step);
  assert.equal(centeredSlot(3, c).x, agentSlot(0).x + 2 * step);
  // Người thứ năm xuống hàng dưới, và về lại đúng trục.
  assert.equal(centeredSlot(4, c).x, agentSlot(0).x);
  assert.ok(centeredSlot(4, c).y > centeredSlot(0, c).y);
});

test('centeredSlot: luôn bám ĐÚNG LƯỚI của agentSlot, kể cả khi trục lệch nửa cột', () => {
  // Trục nằm giữa hai cột (ca số nhân viên CHẴN). Không làm tròn về lưới thì ô
  // mới lệch nửa cột và chồng một nửa lên người cũ — tệ hơn hẳn lệch phải.
  const step = NODE_SIZE.agent.w + 40;
  for (const centerX of [238, 300, 356, 400, 474]) {
    const x = centeredSlot(0, centerX).x;
    assert.equal((x - agentSlot(0).x) % step, 0, `trục ${centerX} đẻ ra ô lệch lưới: ${x}`);
  }
});

/**
 * ĐÂY LÀ TEST CHO ĐÚNG CA USER MÔ TẢ, chạy y như thứ tự họ bấm.
 *
 * Người 1 thẳng dưới Trợ lý · người 2 sang phải (số chẵn thì không cân được) ·
 * người 3 phải sang TRÁI. Trợ lý ĐỨNG YÊN suốt — đó là điều kiện của bài, vì
 * `arrangeAll` chỉ chạy khi bấm "Sắp xếp lại sơ đồ".
 */
test('thêm ba nhân viên liên tiếp: người thứ ba sang TRÁI, không nối đuôi sang phải', () => {
  const tidy = arrangeAll(shell(1));
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'assistant', ...tidy.get('assistant')! },
    { kind: 'knowledge', ...tidy.get('knowledge')! },
    { kind: 'library', ...tidy.get('library')! },
  ];
  const boss = placed[0]!;
  const centerX = boss.x + NODE_SIZE.assistant.w / 2;

  const add = (): { x: number; y: number } => {
    const spot = firstFreeSlot(placed, 'agent', centerX);
    placed.push({ kind: 'agent', ...spot });
    return spot;
  };

  const one = add();
  const two = add();
  const three = add();

  assert.equal(one.x + NODE_SIZE.agent.w / 2, centerX, 'người 1 phải thẳng dọc với Trợ lý');
  assert.ok(two.x > one.x, 'người 2 sang phải');
  assert.ok(three.x < one.x, 'người 3 phải sang TRÁI, đây là chỗ bug 20/08');
  assert.equal(three.y, one.y, 'cả ba vẫn cùng một hàng');

  // Và hàng ba người phải cân quanh Trợ lý, không lệch một cột.
  const rowMid = (Math.min(three.x, one.x, two.x) + Math.max(three.x, one.x, two.x) + NODE_SIZE.agent.w) / 2;
  assert.ok(Math.abs(rowMid - centerX) <= 1, `hàng lệch: ${rowMid} vs ${centerX}`);
});

test('mọc quanh trục vẫn KHÔNG BAO GIỜ chồng lên ai — kể cả kho và mcp', () => {
  const tidy = arrangeAll(shell(1));
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'assistant', ...tidy.get('assistant')! },
    { kind: 'knowledge', ...tidy.get('knowledge')! },
    { kind: 'library', ...tidy.get('library')! },
  ];
  const centerX = placed[0]!.x + NODE_SIZE.assistant.w / 2;

  for (let i = 0; i < 8; i++) {
    const spot = firstFreeSlot(placed, 'agent', centerX);
    assert.equal(
      clashes(spot, 'agent', placed),
      false,
      `nhân viên thứ ${i + 1} rơi vào chỗ đã có người`,
    );
    placed.push({ kind: 'agent', ...spot });
  }
});

// ────────────────────────────────────── cất đi rồi đưa trở lại: CHỖ NGỒI

/**
 * Ca user hỏi 22/08: *"khôi phục thì trùng 100% toạ độ với một nhân viên đang
 * nằm sẵn ⇒ người dùng không tìm thấy"*.
 *
 * Nó KHÔNG xảy ra, và test này khoá lại lý do — vì lý do đó nằm ở hai chỗ cách
 * xa nhau trong code, tức là đúng loại dễ bị gỡ mất khi ai đó dọn dẹp:
 *
 *   1. `Office.archiveAgent(id, true)` gọi `layout.dropAgent()` → node bị XOÁ
 *      khỏi layout.json, không phải chỉ bị ẩn đi.
 *   2. Vì thế lúc đưa trở lại, `read()` thấy nó là node MỚI (`fresh`) và cấp ô
 *      bằng `firstFreeSlot` — tức là né mọi người đang ngồi.
 *
 * Nếu bước 1 đổi thành "giữ node lại cho nhớ chỗ cũ" thì bug xuất hiện ngay:
 * người mới đã được cấp đúng cái ô đó trong lúc người cũ nằm trong lưu trữ.
 */
test('cất đi rồi đưa trở lại: KHÔNG bao giờ chồng lên người đã ngồi vào chỗ cũ', () => {
  const spot = agentSlot(2);

  // "An" ngồi ô 2 rồi bị cất đi → node biến khỏi layout, ô 2 trống trên sơ đồ.
  // "Bình" được thêm sau, và `firstFreeSlot` cấp cho đúng ô đang trống đó.
  const afterArchive: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'agent', ...agentSlot(0) },
    { kind: 'agent', ...agentSlot(1) },
  ];
  const binh = firstFreeSlot(afterArchive);
  assert.deepEqual(binh, spot, 'tiền đề: chỗ của người bị cất đi ĐƯỢC cấp lại cho người mới');
  afterArchive.push({ kind: 'agent', ...binh });

  // Đưa "An" trở lại: nó là node mới với layout, nên phải được cấp ô khác.
  const an = firstFreeSlot(afterArchive);
  assert.notDeepEqual(an, binh, 'An không được rơi đúng lên Bình');
  assert.ok(!clashes(an, 'agent', afterArchive), 'và không chạm bất kỳ ai khác');
});

test('cất/đưa lại nhiều người liên tiếp: mỗi người một ô, không ai chồng ai', () => {
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [];
  for (let i = 0; i < 8; i++) {
    const s = firstFreeSlot(placed);
    assert.ok(!clashes(s, 'agent', placed), `người thứ ${i + 1} phải có ô riêng`);
    placed.push({ kind: 'agent', ...s });
  }
});
