/**
 * MỘT LƯỢT ĐỌC KHÔNG ĐƯỢC PHÁT SỰ KIỆN ĐỔI. → `library/store.ts §scan · §pump`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG USER BÁO 02/09 — hộp thoại prompt "nháy chớp liên tục".              │
 * │                                                                          │
 * │ Repro: mở ngăn Tủ tài liệu → bấm Trợ lý → Xem prompt phân lớp.           │
 * │                                                                          │
 * │ `pump()` gọi `renderIndex() + onChange()` VÔ ĐIỀU KIỆN, kể cả khi không   │
 * │ bóc file nào. Mà `pump()` chạy ở mỗi `GET /library` (qua `scan()`), nên:  │
 * │                                                                          │
 * │   GET /library → scan → pump → `library.changed`                         │
 * │     → store: libraryVersion+1 và refreshCanvas()                         │
 * │     → LibraryPanel useEffect(reload, [reload, libraryVersion])           │
 * │     → GET /library → …  (vòng lặp vô hạn)                                │
 * │                                                                          │
 * │ Vòng lặp này KHÔNG có triệu chứng nào cho tới khi có thứ khác đọc         │
 * │ `canvas` — lúc đó nó mới lộ ra thành một hộp thoại nháy. Nghĩa là nó đã   │
 * │ chạy sẵn ở mọi phiên có mở tủ tài liệu, im lặng, đốt CPU và băng thông.   │
 * │                                                                          │
 * │ Đây là chốt cho vế TẤT ĐỊNH của bản vá. Vế giao diện (deps của            │
 * │ `PromptDialog`) không có bộ chạy DOM nên không test được ở đây.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LibraryStore } from '../dist/library/store.js';
import { officePaths } from '../dist/core/paths.js';

/** `pump()` chạy ngầm (`void this.pump()`) — nhường vài nhịp cho nó xong. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function tmpOffice(): { dir: string; paths: ReturnType<typeof officePaths> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-lib-'));
  return { dir, paths: officePaths(dir) };
}

test('🔴 tủ RỖNG: quét hai lần liên tiếp ⇒ KHÔNG phát một sự kiện nào', async () => {
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    lib.scan();
    await settle();
    lib.scan();
    await settle();

    assert.equal(calls, 0, 'đọc một cái tủ không đổi thì không có gì để báo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 CÓ tài liệu, không đổi gì: lần quét THỨ HAI phải im — đây là vòng lặp 02/09', async () => {
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    fs.mkdirSync(paths.libraryFiles, { recursive: true });
    fs.writeFileSync(path.join(paths.libraryFiles, 'ghi-chu.txt'), 'xin chào', 'utf8');

    lib.scan(); // file mới ⇒ có việc để làm ⇒ ĐƯỢC phép báo
    await settle();
    const afterFirst = calls;
    assert.ok(afterFirst > 0, 'thả file vào thì phải báo, nếu không giao diện đứng im');

    lib.scan(); // y hệt lần trước ⇒ phải IM
    await settle();
    assert.equal(calls, afterFirst, 'không có gì đổi ⇒ không thêm một sự kiện nào');

    // Và lần thứ ba, thứ tư… vẫn im. Vòng lặp cũ chỉ cần MỘT sự kiện thừa mỗi
    // lượt đọc là đã tự nuôi được chính nó.
    lib.scan();
    await settle();
    lib.scan();
    await settle();
    assert.equal(calls, afterFirst, 'đọc bao nhiêu lần cũng không đẻ ra sự kiện');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 ngược chiều: file bị xoá NGOÀI app ⇒ vẫn PHẢI báo (đừng vá quá tay)', async () => {
  /*
    Nửa còn lại của bất biến. Bản vá làm `pump()` im khi không bóc gì — nhưng ca
    "người dùng xoá file bằng Explorer" cũng không có gì để bóc, mà catalog thì
    vừa đổi thật và `INDEX.md` đang nêu tên một tài liệu đã chết. Im ở đây là
    đổi một bug ồn ào lấy một bug im lặng.
  */
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    fs.mkdirSync(paths.libraryFiles, { recursive: true });
    const file = path.join(paths.libraryFiles, 'ghi-chu.txt');
    fs.writeFileSync(file, 'xin chào', 'utf8');
    lib.scan();
    await settle();
    const before = calls;

    fs.rmSync(file);
    lib.scan();
    await settle();

    assert.ok(calls > before, 'catalog đổi thật ⇒ phải báo');
    assert.equal(lib.size, 0, 'và tài liệu phải rời khỏi catalog');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
