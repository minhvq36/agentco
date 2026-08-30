/**
 * BỐ CỤC CÁNH TAY — khối theo chủ, và bãi đỗ cho hàng chưa dùng.
 * → `src/core/layout-geometry.ts` · docs/SPEC-canvas.md
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Hai lỗi user báo 31/08, và chúng là HAI lỗi khác nhau:                   │
 * │                                                                          │
 * │  ① thêm một cánh tay mới → nó bay ra tận rìa sơ đồ, thay vì nằm dưới      │
 * │    nhân viên vừa được nối dây (`armSlot` vá)                             │
 * │  ② bấm "Sắp xếp lại sơ đồ" → mọi cánh tay dồn vào MỘT hàng căn giữa,      │
 * │    không phân biệt đã nối dây hay chưa, dây cắt chéo nhau (`arrangeAll`)  │
 * │                                                                          │
 * │ ⚠ Không có cạnh ⇒ **hành vi CŨ y nguyên**. Đó là điều kiện để bản vá này  │
 * │ không đụng vào mọi chỗ gọi cũ và mọi test cũ.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NODE_SIZE,
  PARK_PER_COL,
  armSlot,
  arrangeAll,
  parkSlot,
} from '../dist/core/layout-geometry.js';

const A1 = { id: 'agent:a', kind: 'agent' as const };
const A2 = { id: 'agent:b', kind: 'agent' as const };
const BOSS = { id: 'assistant', kind: 'assistant' as const };
const KNOW = { id: 'knowledge', kind: 'knowledge' as const };
const LIB = { id: 'library', kind: 'library' as const };
const mcp = (id: string, armGroup?: string) => ({ id, kind: 'mcp' as const, ...(armGroup ? { armGroup } : {}) });

const cx = (p: { x: number }, kind: 'agent' | 'mcp') => p.x + NODE_SIZE[kind].w / 2;

// ───────────────────────────────────────────── ② nút "Sắp xếp lại sơ đồ"

test('cánh tay đã nối dây nằm DƯỚI chủ của nó, không phải giữa sơ đồ', () => {
  const nodes = [BOSS, A1, A2, mcp('mcp:x'), KNOW, LIB];
  const p = arrangeAll(nodes, [{ from: 'mcp:x', to: 'agent:b' }]);
  const arm = p.get('mcp:x')!;
  const owner = p.get('agent:b')!;
  assert.equal(cx(arm, 'mcp'), cx(owner, 'agent'), 'cánh tay phải thẳng trục với chủ');
  assert.ok(arm.y > owner.y, 'cánh tay phải nằm DƯỚI chủ');
});

test('⭐ nhân viên được CĂN LÊN GIỮA khối cánh tay của mình', () => {
  // Ba cánh tay cho một người ⇒ khối rộng hơn người ⇒ người phải dịch sang cho
  // cân, chứ không phải cánh tay lệch đi. Đây là vế user nhấn mạnh:
  // *"Các worker phải cân đối với các mcp của mình"*.
  const nodes = [BOSS, A1, mcp('m1'), mcp('m2'), mcp('m3')];
  const p = arrangeAll(nodes, ['m1', 'm2', 'm3'].map((m) => ({ from: m, to: 'agent:a' })));
  const mid = (cx(p.get('m1')!, 'mcp') + cx(p.get('m3')!, 'mcp')) / 2;
  assert.equal(cx(p.get('agent:a')!, 'agent'), mid);
});

test('⭐ THỨ TỰ CÁNH TAY THEO THỨ TỰ CHỦ — điều kiện để dây không cắt nhau', () => {
  // *"thứ tự sắp xếp phải theo worker (để tránh vướng dây chằng chéo lên nhau)"*
  const nodes = [BOSS, A1, A2, mcp('m-a1'), mcp('m-a2'), mcp('m-b1')];
  const p = arrangeAll(nodes, [
    // cố ý khai LỘN XỘN: cánh tay của người phải khai trước
    { from: 'm-b1', to: 'agent:b' },
    { from: 'm-a1', to: 'agent:a' },
    { from: 'm-a2', to: 'agent:a' },
  ]);
  assert.ok(p.get('agent:a')!.x < p.get('agent:b')!.x, 'a đứng trái b');
  for (const m of ['m-a1', 'm-a2']) {
    assert.ok(p.get(m)!.x < p.get('m-b1')!.x, `${m} phải nằm trái cánh tay của b`);
  }
});

test('cánh tay dùng CHUNG thuộc về chủ TRÁI NHẤT — mọi dây thứ hai đi cùng chiều', () => {
  const nodes = [BOSS, A1, A2, mcp('m')];
  const p = arrangeAll(nodes, [
    { from: 'm', to: 'agent:b' },
    { from: 'm', to: 'agent:a' },
  ]);
  assert.equal(cx(p.get('m')!, 'mcp'), cx(p.get('agent:a')!, 'agent'));
});

// ───────────────────────────────────────────────────────── bãi đỗ bên trái

test('⭐ cánh tay KHÔNG nối dây ra bãi đỗ bên trái, 7 mỗi cột', () => {
  const arms = Array.from({ length: 9 }, (_, i) => mcp(`m${i}`));
  const p = arrangeAll([BOSS, A1, ...arms], [{ from: 'm0', to: 'agent:a' }]);

  // m0 có dây ⇒ KHÔNG ở bãi đỗ
  assert.ok(p.get('m0')!.x > 0, 'cánh tay có dây không được đỗ bên trái');

  const parked = arms.slice(1).map((a) => p.get(a.id)!);
  assert.ok(
    parked.every((q) => q.x < 0),
    'cánh tay không dây phải nằm bên trái gốc toạ độ',
  );
  const cols = new Set(parked.map((q) => q.x));
  assert.equal(cols.size, 2, '8 cái ⇒ đúng 2 cột');
  assert.equal(parked.filter((q) => q.x === Math.max(...cols)).length, PARK_PER_COL, 'cột đầu đúng 7');
  // cột thứ hai mở ra bên TRÁI, không phải bên phải
  assert.ok(Math.min(...cols) < Math.max(...cols));
});

test('bãi đỗ bắt đầu CAO HƠN Trợ lý — mốc user nêu đích danh', () => {
  const p = arrangeAll([BOSS, A1, mcp('m')], []);
  assert.ok(parkSlot(0).y < p.get('assistant')!.y);
});

test('⭐ bãi đỗ sắp theo LOẠI: thư mục → dịch vụ (cùng hãng cạnh nhau) → tự dán', () => {
  const nodes = [
    BOSS,
    A1,
    mcp('m-custom', '2-custom'),
    mcp('m-notion', '1-notion'),
    mcp('m-files', '0-files'),
    mcp('m-linear', '1-linear'),
  ];
  const p = arrangeAll(nodes, []);
  const order = ['m-files', 'm-linear', 'm-notion', 'm-custom'].map((id) => p.get(id)!.y);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'thứ tự dọc phải đúng thứ tự loại');
});

// ─────────────────────────────────────────── ① ô cho một cánh tay MỚI

test('⭐ armSlot bám TRỤC CHỦ, không phải lưới nhân viên — bug "faraway"', () => {
  // Lưới nhân viên bước 202×120 quá thô cho một node 152×52, nên ô trống đầu
  // tiên trên lưới ấy rơi ra tận rìa. Lưới riêng thì ô đầu nằm ngay dưới chủ.
  const first = armSlot(0, 500, 300);
  assert.equal(first.x + NODE_SIZE.mcp.w / 2, 500, 'ô đầu thẳng trục chủ');
  assert.equal(first.y, 300);
  // toả ra hai bên, không nối đuôi một chiều
  assert.ok(armSlot(1, 500, 300).x > first.x);
  assert.ok(armSlot(2, 500, 300).x < first.x);
});

// ──────────────────────────────────── 🔴 KHÔNG được làm hỏng hành vi cũ

test('🔴 KHÔNG có cạnh ⇒ bố cục CŨ y nguyên, từng pixel', () => {
  // Chống hỏng lây: mọi chỗ gọi cũ (và mọi test cũ) truyền một tham số duy nhất.
  const nodes = [BOSS, A1, A2, mcp('m1'), mcp('m2'), KNOW, LIB];
  const a = arrangeAll(nodes);
  const b = arrangeAll(nodes, []);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  // và cánh tay vẫn nằm thành MỘT hàng căn giữa như trước
  assert.equal(a.get('m1')!.y, a.get('m2')!.y);
});

/**
 * 🔴 CẠNH SẮP GHI PHẢI TÍNH — bug user bắt 31/08, và nó là bug của bản vá 30/08.
 *
 * `grantArm` ghi `office.arms` → **đặt chỗ cho node** → mới ghi `role.mcp`. Nên
 * lúc chọn chỗ, `role.mcp` còn rỗng ⇒ không tìm ra chủ ⇒ đỗ tận bên trái, và vì
 * toạ độ đã lưu nên nó nằm đó vĩnh viễn.
 *
 * Bản vá 30/08 đúng về HÌNH HỌC và sai về THỜI ĐIỂM — nó hỏi một nguồn sự thật
 * chưa kịp thành sự thật. Test này khoá đúng cái thời điểm đó.
 * ⇒ Cùng lớp §3a: *thứ đo được không phải trạng thái, là THỜI ĐIỂM HỎI*.
 */
test('⭐ cánh tay vừa nối dây nằm dưới chủ; cánh tay chưa nối thì mới ra bãi đỗ', () => {
  // ⚠ Hai cánh tay trong CÙNG một lượt gọi — đó mới là ngữ cảnh thật lúc cắm
  // thêm một cái mới vào văn phòng đã có hàng chưa dùng. Truyền `edges: []` là
  // nhánh **hành vi cũ** (không có bãi đỗ), nên nó không đo được ca này.
  const nodes = [BOSS, A1, mcp('mcp:moi'), mcp('mcp:le')];
  const p = arrangeAll(nodes, [{ from: 'mcp:moi', to: 'agent:a' }]);
  assert.ok(p.get('mcp:moi')!.x > 0, 'vừa nối dây ⇒ phải ở dưới chủ');
  assert.ok(p.get('mcp:le')!.x < 0, 'chưa nối dây ⇒ đỗ bên trái');
  assert.equal(cx(p.get('mcp:moi')!, 'mcp'), cx(p.get('agent:a')!, 'agent'));
});

/**
 * 🔴 VĂN PHÒNG MỚI PHẢI CHỪA SẴN CHỖ CHO HÀNG CÁNH TAY. (user bắt 31/08)
 *
 * Văn phòng chưa cắm gì ⇒ hai kho ngồi ngay dưới hàng nhân viên ⇒ cắm cánh tay
 * đầu tiên là **không còn chỗ**, nó trèo ra rìa; bấm "Sắp xếp lại" mới vừa. Tức
 * hệ thống tự mâu thuẫn — đúng bệnh cả file này sinh ra để chữa.
 */
test('⭐ chưa có cánh tay nào, hai kho VẪN phải ngồi đúng chỗ của lúc đã có', () => {
  const trong = arrangeAll([BOSS, A1, KNOW, LIB], []);
  const day = arrangeAll([BOSS, A1, mcp('m1'), KNOW, LIB], []);
  assert.equal(
    trong.get('knowledge')!.y,
    day.get('knowledge')!.y,
    'kho phải ở cùng độ cao dù đã cắm cánh tay hay chưa',
  );
  assert.equal(trong.get('library')!.y, day.get('library')!.y);
});

test('⭐ chỗ chừa sẵn đủ cho một hàng cánh tay, không đè lên kho', () => {
  const p = arrangeAll([BOSS, A1, mcp('m1'), KNOW, LIB], []);
  const armBottom = p.get('m1')!.y + NODE_SIZE.mcp.h;
  assert.ok(armBottom <= p.get('knowledge')!.y, `cánh tay (đáy ${armBottom}) phải nằm TRÊN kho`);
  assert.ok(p.get('m1')!.y > p.get('agent:a')!.y + NODE_SIZE.agent.h, 'và nằm DƯỚI nhân viên');
});

test('kim tự tháp vẫn cân: Trợ lý và hai kho cùng một trục với hàng nhân viên', () => {
  const nodes = [BOSS, A1, A2, mcp('m1'), mcp('m2'), KNOW, LIB];
  const p = arrangeAll(nodes, [
    { from: 'm1', to: 'agent:a' },
    { from: 'm2', to: 'agent:b' },
  ]);
  const agentsMid = (cx(p.get('agent:a')!, 'agent') + cx(p.get('agent:b')!, 'agent')) / 2;
  const bossMid = p.get('assistant')!.x + NODE_SIZE.assistant.w / 2;
  const shelfMid =
    (p.get('knowledge')!.x + p.get('library')!.x + NODE_SIZE.library.w) / 2;
  assert.ok(Math.abs(bossMid - agentsMid) <= 1, `Trợ lý lệch: ${bossMid} vs ${agentsMid}`);
  assert.ok(Math.abs(shelfMid - agentsMid) <= 1, `kho lệch: ${shelfMid} vs ${agentsMid}`);
  // hai kho phải nằm DƯỚI cánh tay
  assert.ok(p.get('knowledge')!.y > p.get('m1')!.y);
});
