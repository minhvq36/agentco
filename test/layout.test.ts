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
