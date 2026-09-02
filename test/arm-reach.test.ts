/**
 * Test cho DỌN KẾT NỐI KHI KHÔNG CÒN VĂN PHÒNG NÀO. → docs/SPEC-arms.md §6k
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG USER BÁO 02/09 — thế kẹt ba tầng.                                    │
 * │                                                                          │
 * │   workspace ←chặn bởi─ cánh tay ←chặn bởi─ văn phòng                     │
 * │                                                                          │
 * │ Triệu chứng: xoá hết văn phòng xong thì Notion/Linear/GitHub không gỡ    │
 * │ được nữa. Cái hỏng nằm ở GIAO DIỆN (cửa vào sổ chung là Toolbar của      │
 * │ canvas, mà 0 văn phòng ⇒ 0 canvas), nên phần lớn bản vá là UI và không   │
 * │ test tự động được ở đây.                                                 │
 * │                                                                          │
 * │ Thứ test được, và là thứ giao diện DỰA VÀO để hiện nút 🗑: cờ `orphan`   │
 * │ phải đúng khi công ty **không có văn phòng nào**. Sai ở đây thì cửa mới  │
 * │ mở ra cũng không có nút nào để bấm.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Company } from '../dist/core/company.js';

/** Công ty rỗng + một cánh tay ghi thẳng vào `company.yaml`, KHÔNG văn phòng nào. */
function tmpCompany(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-reach-'));
  fs.mkdirSync(path.join(dir, 'offices'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'company.yaml'),
    [
      'models: {}',
      'mcpServers:',
      '  a354ff2bb34:',
      '    type: http',
      '    url: https://mcp.notion.com/mcp',
      'arms:',
      '  a354ff2bb34:',
      '    label: Notion · Minh Vu Quoc',
      '    secrets: [NOTION_OAUTH_52BA79B8]',
      '    tools: [notion-search, notion-fetch]',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

test('🔴 0 văn phòng ⇒ cánh tay là MỒ CÔI (giao diện dựa vào cờ này để hiện nút xoá)', () => {
  const dir = tmpCompany();
  try {
    const company = Company.open(dir);
    assert.equal(company.size, 0, 'tiền đề: công ty không có văn phòng nào');

    const arms = company.listArms();
    assert.equal(arms.length, 1);
    assert.equal(arms[0]?.orphan, true, 'không văn phòng nào giữ ⇒ phải mồ côi');
    assert.deepEqual(arms[0]?.usedBy, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 0 văn phòng ⇒ `forgetArm` CHẠY ĐƯỢC, và chỉ xoá khỏi sổ', () => {
  // Đây là vế "không còn thế kẹt": lõi chưa bao giờ chặn ca này, cái thiếu là
  // một cửa gọi tới nó. Test khoá lõi để bản vá UI không bị rút chân về sau.
  const dir = tmpCompany();
  try {
    const company = Company.open(dir);
    company.forgetArm('a354ff2bb34');

    assert.equal(company.listArms().length, 0, 'đã rời sổ chung');
    const yaml = fs.readFileSync(path.join(dir, 'company.yaml'), 'utf8');
    assert.ok(!yaml.includes('a354ff2bb34'), 'cả `mcpServers` lẫn `arms` đều sạch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 xoá kết nối KHÔNG đụng tới CHÌA — phần đắt là đi lấy chìa, không phải cấu hình', () => {
  const dir = tmpCompany();
  try {
    // Kho chìa có thật, và có đúng cái chìa mà cánh tay sắp bị xoá đang khai.
    const keyFile = path.join(dir, '.state', 'secrets.json');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, JSON.stringify({ NOTION_OAUTH_52BA79B8: 'ntn_gia-de-test' }), 'utf8');
    const before = fs.readFileSync(keyFile, 'utf8');

    const company = Company.open(dir);
    assert.deepEqual(
      company.listArms()[0]?.secrets,
      ['NOTION_OAUTH_52BA79B8'],
      'tiền đề: cánh tay đang khai đúng tên chìa đó',
    );

    company.forgetArm('a354ff2bb34');

    // `forgetArm` chỉ được sửa `company.yaml`. Xoá theo cả chìa là lấy mất cái
    // đắt (lượt OAuth ở trang của hãng) để dọn cái rẻ (ba cú bấm từ danh mục).
    assert.equal(fs.readFileSync(keyFile, 'utf8'), before, 'kho chìa phải y nguyên từng byte');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
