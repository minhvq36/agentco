/**
 * Test cho `ArtifactStore.removeAll` — nút **Xoá tất cả** (user yêu cầu 25/08).
 * → `src/core/artifacts.ts` · `src/core/office.ts §clearArtifacts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Nút này xoá HÀNG LOẠT và không có bước hoàn tác. Thứ đáng test không     │
 * │ phải "nó có xoá không" — mà là **nó có xoá QUÁ TAY không**.              │
 * │                                                                          │
 * │ `removeAll` cố ý đi qua `remove()` từng file thay vì `rm -rf` cả thư mục:│
 * │ `resolve()` là chỗ DUY NHẤT biết luật "chỉ trong `artifacts/`, không     │
 * │ thư mục ẩn, không theo symlink ra ngoài". Một đường tắt ở đây là bản     │
 * │ thứ hai của luật đó, và bản thứ hai luôn là bản quên một điều kiện.      │
 * │ Test dưới đây canh đúng chuyện ấy bằng cách đặt mồi ở cả hai bên hàng rào.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore } from '../dist/core/artifacts.js';

function fixture(): { store: ArtifactStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-art-'));
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(artifacts, 'P-1', 'T-01'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'P-1', 'T-01', 'bao-cao.md'), '# xin chào', 'utf8');
  fs.writeFileSync(path.join(artifacts, 'P-1', 'ghi-chu.txt'), 'abc', 'utf8');
  fs.mkdirSync(path.join(artifacts, 'P-2'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'P-2', 'so-lieu.csv'), 'a,b\n1,2\n', 'utf8');
  return { store: new ArtifactStore({ root, artifacts } as never), root };
}

test('xoá hết và trả về ĐÚNG SỐ file — con số đó lên thẳng màn hình', () => {
  const { store } = fixture();
  assert.equal(store.list().length, 3);
  assert.equal(store.removeAll(), 3);
  assert.deepEqual(store.list(), []);
});

test('dọn luôn thư mục rỗng còn lại — không để lại cái vỏ cho người dùng tự hỏi', () => {
  const { store, root } = fixture();
  store.removeAll();
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'P-1')), false);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'P-2')), false);
  // Nhưng CHÍNH `artifacts/` phải còn: nhân viên kế tiếp ghi vào đó ngay.
  assert.equal(fs.existsSync(path.join(root, 'artifacts')), true);
});

/**
 * ⭐ Ô ĐẮT NHẤT FILE NÀY. Ngăn "Kết quả" nằm BÊN TRONG thư mục văn phòng, cạnh
 * `roles/`, `office.yaml`, và `.state/` (nơi giữ session id). Một `removeAll`
 * quét theo thư mục cha thay vì theo danh sách của `list()` sẽ xoá cả công ty.
 */
test('KHÔNG chạm gì ngoài `artifacts/` — hàng rào của `resolve()` vẫn đứng', () => {
  const { store, root } = fixture();
  fs.writeFileSync(path.join(root, 'office.yaml'), 'name: thử', 'utf8');
  fs.mkdirSync(path.join(root, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'roles', 'nguoi-viet.yaml'), 'id: nguoi-viet', 'utf8');
  fs.mkdirSync(path.join(root, 'artifacts', '.state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', '.state', 'session.json'), '{}', 'utf8');

  store.removeAll();

  assert.equal(fs.existsSync(path.join(root, 'office.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'roles', 'nguoi-viet.yaml')), true);
  // Thư mục ẩn: `resolve()` từ chối nó, nên `list()` không thấy và `removeAll`
  // không chạm. Đây là hàng rào có sẵn — test này giữ nó khỏi bị đi vòng.
  assert.equal(fs.existsSync(path.join(root, 'artifacts', '.state', 'session.json')), true);
});

test('ngăn đã rỗng thì trả 0, không ném — nút bấm nhầm lần hai phải im', () => {
  const { store } = fixture();
  store.removeAll();
  assert.equal(store.removeAll(), 0);
});
