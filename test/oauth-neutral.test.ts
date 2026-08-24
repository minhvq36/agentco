/**
 * ⭐ ĐƯỜNG LUI PHẢI CÓ MÃ THI HÀNH, KHÔNG CHỈ CÓ MỘT CÂU TRONG SPEC.
 * → `src/core/oauth.ts` · docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ User chốt 24/08:                                                         │
 * │   *"nhớ chừa đường lui nếu sau này tôi cho phép người dùng đổi hệ thống  │
 * │    dùng codex, antigravity, groq"*                                       │
 * │                                                                          │
 * │ Một lời hứa như thế chỉ có thật khi có thứ **bắt được lúc nó bị phá**.   │
 * │ Không có test này thì `oauth.ts` sẽ import SDK vào một ngày nào đó vì     │
 * │ "tiện có sẵn kiểu ở đấy" — và không ai thấy, vì mọi thứ vẫn chạy.        │
 * │ Đường lui hỏng **không có triệu chứng** cho tới đúng ngày cần dùng nó.   │
 * │                                                                          │
 * │ OAuth là chuyện giữa agentco và **hãng dịch vụ** (Notion), không phải     │
 * │ chuyện giữa agentco và hãng **mô hình**. Nên nó không có lý do gì để      │
 * │ chạm vào SDK, và đó là thứ làm cho luật này kiểm được bằng máy.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'oauth.ts');

test('⭐ oauth.ts KHÔNG import gì ngoài `node:` — đường lui còn nguyên', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  const bad: string[] = [];
  // Bắt cả `import x from '…'` lẫn `import('…')` động — nhánh thứ hai là chỗ
  // một phụ thuộc hay lẻn vào nhất, vì nó trông như một lời gọi hàm.
  for (const m of code.matchAll(/(?:^|\s)(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1]!;
    if (!spec.startsWith('node:')) bad.push(spec);
  }
  assert.deepEqual(bad, [], `oauth.ts kéo phụ thuộc ngoài node: ${bad.join(', ')}`);
});

test('oauth.ts không nhắc tên hãng mô hình nào — kể cả trong kiểu', () => {
  const code = fs.readFileSync(SRC, 'utf8');
  // Chỉ soi phần MÃ, bỏ chú thích: khối chú thích đầu file cố ý nêu tên các
  // hãng để giải thích vì sao luật này tồn tại, và cấm cả nó là cấm nhầm.
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const vendor of ['anthropic', 'claude-agent-sdk', 'openai', 'groq']) {
    assert.equal(
      noComments.toLowerCase().includes(vendor),
      false,
      `mã của oauth.ts nhắc tới "${vendor}" — nó phải trung lập với hãng chạy agent`,
    );
  }
});
