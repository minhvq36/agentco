/**
 * Ba câu user hỏi khi test bài 11, mà tôi KHÔNG biết câu trả lời:
 *
 *   A. Thư mục có DẤU CÁCH trong tên — có cần nháy `"` không?
 *   B. Truyền một FILE (không phải thư mục) làm gốc — server nhận không?
 *   C. Truyền NHIỀU thư mục cùng lúc — nhận không?
 *
 * Câu A quan trọng nhất: trực giác "phải bọc nháy" đến từ SHELL, còn `args` đi
 * vào `spawn` dạng MẢNG. Nếu đúng là mảng thì thêm nháy sẽ BIẾN DẤU NHÁY THÀNH
 * MỘT PHẦN CỦA ĐƯỜNG DẪN — tức làm đúng thứ nó định tránh. Phải đo, không đoán.
 *
 * Chạy: npx tsx scripts/spike-fsargs.ts
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsargs-'));

const spaced = path.join(root, 'thu muc co dau cach');
const plain = path.join(root, 'thuong');
fs.mkdirSync(spaced, { recursive: true });
fs.mkdirSync(plain, { recursive: true });
const oneFile = path.join(plain, 'mot-file.txt');
fs.writeFileSync(oneFile, 'noi dung', 'utf8');

const arm = (...args: string[]) => ({ files: { command: 'npx', args: ['-y', PKG, ...args] } as never });

async function ca(label: string, args: string[]) {
  const r = await probeArm(arm(...args));
  const line = `${label.padEnd(34)} ${r.status.padEnd(10)} tools=${String(r.tools.length).padStart(2)}`;
  console.log(r.error ? `${line}\n     └─ ${r.error.split('\n')[0]}` : line);
  return r;
}

console.log(`gốc thử: ${root}\n`);

console.log('── A · dấu cách trong tên thư mục');
await ca('trần (không nháy)', [spaced]);
await ca('bọc dấu nháy kép', [`"${spaced}"`]);

console.log('\n── B · truyền một FILE làm gốc');
await ca('một file .txt', [oneFile]);

console.log('\n── C · nhiều thư mục');
await ca('hai thư mục', [plain, spaced]);

console.log('\n── D · dấu gạch chéo kiểu POSIX trên Windows');
await ca('dùng "/" thay "\\"', [spaced.replace(/\\/g, '/')]);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n↩ đã dọn thư mục thử');
