/**
 * TRẦN QUÉT CẮT NHẦM ĐẦU — file MỚI phải thắng file CŨ. → `core/artifacts.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA HỎNG TÌM RA 02/09 khi user hỏi *"có nên tự prune sau 15 ngày không"*.  │
 * │                                                                          │
 * │ Bản cũ:                                                                  │
 * │   walk(...)                     // DỪNG HẲN ở file thứ 500               │
 * │   return out.sort(theo mtime)   // sắp SAU khi đã cắt → cứu không kịp    │
 * │                                                                          │
 * │ Thứ rơi ra không phải file cũ nhất mà là file `readdir` chưa đọc tới. Mà │
 * │ thư mục ca tên `P-260820-0314-…` — tức theo NGÀY, cũ trước — nên trên     │
 * │ NTFS (readdir theo tên) thứ biến mất chính là **những kết quả mới nhất**. │
 * │ Im lặng: không câu báo, không log.                                       │
 * │                                                                          │
 * │ Kéo theo hai chỗ khác cùng dùng `list()`:                                │
 * │   · `removeAll()`  — "dọn sạch" chỉ xoá 500 rồi báo thành công           │
 * │   · `readablePaths()` — `@đường-dẫn` tới file cũ trả "không tìm thấy"    │
 * │     trong khi bảng kê Trợ lý hứa *"a path from an older job is valid"*   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * User chốt trục sắp xếp là **`mtime` (sửa lần cuối)**, không phải ngày tạo —
 * đúng, và không chỉ vì ngữ nghĩa: `birthtime` trên Linux tuỳ hệ thống file mà
 * có hoặc không, Node lấp chỗ trống bằng `ctime` hoặc mốc 1970. Một cái trần
 * chạy khác nhau trên ba hệ điều hành là một cái trần không kiểm được.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore, MAX_PANEL_FILES } from '../dist/core/artifacts.js';
import { officePaths } from '../dist/core/paths.js';

function tmpOffice(): { dir: string; store: ArtifactStore; paths: ReturnType<typeof officePaths> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-art-'));
  const paths = officePaths(dir);
  return { dir, store: new ArtifactStore(paths), paths };
}

/** Ghi một file kết quả kèm `mtime` ĐẶT TAY — trục sắp xếp phải là nó, không phải tên. */
function write(paths: ReturnType<typeof officePaths>, rel: string, mtime: Date): void {
  const abs = path.join(paths.artifacts, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x', 'utf8');
  fs.utimesSync(abs, mtime, mtime);
}

const T0 = new Date('2026-01-01T00:00:00Z').getTime();
/** Cách nhau HẲN một giây: `utimes` làm tròn khác nhau giữa NTFS/ext4/APFS. */
const at = (i: number): Date => new Date(T0 + i * 1000);

test('🔴 vượt trần: giữ file MỚI NHẤT, không giữ file readdir đọc trúng trước', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    /*
      Dựng đúng hình dạng gây ra ca hỏng: ca CŨ đứng trước theo thứ tự tên (và
      readdir trên NTFS trả theo tên), lại đông file hơn cả trần. Bản cũ nuốt
      hết ca cũ rồi hết chỗ, nên phần đuôi của ca mới rụng — mà đó là đúng thứ
      người dùng vừa tạo ra và đang đi tìm.
    */
    const OLD = 300;
    const NEW = 220; // 300 + 220 = 520 > 500
    for (let i = 0; i < OLD; i++) {
      write(paths, `P-260101-0000-aaaa/T-01/cu-${String(i).padStart(3, '0')}.md`, at(i));
    }
    for (let i = 0; i < NEW; i++) {
      write(paths, `P-260901-0000-zzzz/T-01/moi-${String(i).padStart(3, '0')}.md`, at(OLD + i));
    }

    const { items, capped } = store.scan();
    assert.equal(items.length, OLD + NEW, 'quét phải thấy HẾT, cắt là việc của tầng hiển thị');
    assert.equal(capped, false, '520 file thì chưa chạm trần quét');
    assert.equal(items[0]?.name, `moi-${String(NEW - 1).padStart(3, '0')}.md`, 'mới nhất lên đầu');

    // Đây là ô đỏ của bản cũ: file mới nhất nằm ở đuôi ca mới, đúng chỗ bị cắt.
    const shown = items.slice(0, MAX_PANEL_FILES).map((a) => a.name);
    assert.equal(shown.length, MAX_PANEL_FILES);
    assert.ok(shown.includes(`moi-${String(NEW - 1).padStart(3, '0')}.md`), 'file mới nhất PHẢI còn');
    assert.ok(shown.includes('moi-000.md'), 'cả ca mới phải còn nguyên');
    // Và thứ bị bỏ đúng là 20 file CŨ NHẤT, không phải một nhóm ngẫu nhiên.
    assert.ok(!shown.includes('cu-000.md'), 'cũ nhất mới là thứ rụng');
    assert.ok(!shown.includes('cu-019.md'));
    assert.ok(shown.includes('cu-020.md'), 'cắt đúng 20 cái, không cắt quá tay');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 trục sắp xếp là mtime (SỬA), không phải tên và không phải ngày tạo', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    // Tên xếp `a` trước `z`, ngày tạo cũng vậy (ghi tuần tự). Chỉ `mtime` nói
    // ngược lại — và `mtime` phải thắng: người dùng vừa sửa file cũ thì nó là
    // thứ họ đang làm dở.
    write(paths, 'P-1/T-01/a-cu-nhung-vua-sua.md', at(999));
    write(paths, 'P-1/T-01/z-moi-nhung-de-lau.md', at(1));

    const names = store.list().map((a) => a.name);
    assert.deepEqual(names, ['a-cu-nhung-vua-sua.md', 'z-moi-nhung-de-lau.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mtime BẰNG NHAU ⇒ thứ tự vẫn tất định (một ca ghi 3 file trong cùng mili giây)', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    // Không có nhánh hoà thì thứ tự phụ thuộc readdir, tức đổi theo hệ điều
    // hành — và một danh sách nhảy chỗ giữa hai lần mở là danh sách mất tin.
    const same = at(50);
    write(paths, 'P-1/T-01/c.md', same);
    write(paths, 'P-1/T-01/a.md', same);
    write(paths, 'P-1/T-01/b.md', same);

    assert.deepEqual(store.list().map((a) => a.name), ['a.md', 'b.md', 'c.md']);
    assert.deepEqual(store.list().map((a) => a.name), ['a.md', 'b.md', 'c.md'], 'gọi lại vẫn thế');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 "dọn sạch" phải xoá HẾT, kể cả khi nhiều hơn trần hiển thị', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    // Bản cũ chạy đúng một lượt `list()` đã bị cắt ở 500 ⇒ xoá 500, trả về 500,
    // giao diện báo thành công, 20 file vẫn nằm đó. Cùng lớp lỗi với cuốn sổ
    // chi phí: xoá là phải xoá hết, hoặc nói ra là chưa hết.
    const N = MAX_PANEL_FILES + 20;
    for (let i = 0; i < N; i++) {
      write(paths, `P-1/T-01/f-${String(i).padStart(4, '0')}.md`, at(i));
    }

    assert.equal(store.removeAll(), N, 'trả về đúng số file đã xoá');
    assert.equal(store.scan().items.length, 0, 'và ngăn Kết quả phải trống thật');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('`filePaths()` và `scan()` thấy CÙNG một tập file', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    /*
      Hai cửa vào cùng một sự thật: `filePaths` (rẻ, cho `readablePaths` và
      `removeAll`) và `scan` (có `stat`, cho bảng kê và panel). Lệch bộ lọc giữa
      hai bên là ca tệ nhất — `@đường-dẫn` nhận một file mà panel không hiện,
      hoặc ngược lại. Chốt bằng test vì cả hai đi qua `walk`, và "đi qua cùng
      một hàm" là thứ đúng hôm nay chứ không phải bất biến.
    */
    write(paths, 'P-1/T-01/a.md', at(3));
    write(paths, 'P-2/T-01/b.md', at(1));
    write(paths, 'P-2/T-02/sau/c.md', at(2));
    // Thư mục ẩn: cả hai cửa đều phải bỏ qua. `.state/` giữ session id.
    write(paths, '.an/d.md', at(9));

    const viaScan = store.scan().items.map((a) => a.path).sort();
    const viaPaths = [...store.filePaths().items].sort();
    assert.deepEqual(viaPaths, viaScan);
    assert.equal(viaScan.length, 3, 'và file trong thư mục ẩn không lọt cửa nào');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('thư mục artifacts/ chưa tồn tại ⇒ rỗng, không nổ', () => {
  const { dir, store } = tmpOffice();
  try {
    assert.deepEqual(store.scan(), { items: [], capped: false });
    assert.deepEqual(store.filePaths(), { items: [], capped: false });
    assert.equal(store.removeAll(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
