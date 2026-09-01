/**
 * LOẠI CÁNH TAY — **một trục phân loại, BA bản khai**, và chúng phải khớp nhau.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT, 01/09 — và nó là lý do file này tồn tại.                        │
 * │                                                                          │
 * │ User: *"Tạo CLI, nhưng node ở canvas vẫn là icon của custom MCP"*.       │
 * │                                                                          │
 * │ Tôi thêm `'cli'` vào `ArmDialog §kindOf` và `ArmIcon §ArmKind`, rồi quên  │
 * │ `office.ts §armKind` — chỗ SERVER quyết định hình cho node trên sơ đồ.   │
 * │ Tờ khai CLI không có `catalog` nên nó rơi vào nhánh `custom` và mang     │
 * │ **hình phích cắm** suốt từ lúc cắm.                                      │
 * │                                                                          │
 * │ ⚠ Điều đáng nhớ: ngay phía trên dòng sai có một chú thích khai *"y hệt   │
 * │ `ArmDialog §kindOf`"*. **Chú thích khai hai chỗ giống nhau KHÔNG canh     │
 * │ được chuyện hai chỗ lệch nhau** — nó chỉ ghi lại ý định lúc viết. Không   │
 * │ test nào đỏ, không build nào gãy, node mang hình sai và im lặng.          │
 * │ → [[agentco-finish-completely]] · [[agentco-detect-fix-pair-scope]]       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Bài này đọc **mã nguồn**, không chạy hàm — cố ý: thứ cần khoá là một bất biến
 * giữa ba KHAI BÁO KIỂU, mà kiểu thì bốc hơi lúc chạy. Đây là chỗ duy nhất phép
 * so ấy còn tồn tại được.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');

/** Bóc các chuỗi trong một union kiểu, từ dòng khớp `re`. */
function union(src: string, re: RegExp, where: string): string[] {
  const m = re.exec(src);
  assert.ok(m, `không tìm thấy khai báo loại cánh tay ở ${where} — đổi tên rồi?`);
  const found = [...m![1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]!);
  assert.ok(found.length >= 2, `${where}: đọc ra ${found.length} giá trị, chắc chắn sai`);
  return found;
}

const PLACES: { where: string; values: string[] }[] = [
  {
    where: 'src/core/office.ts §armKind (server quyết hình cho node trên sơ đồ)',
    values: union(read('src/core/office.ts'), /armKind\?:\s*([^;]+);/, 'office.ts'),
  },
  {
    where: 'web/src/lib/types.ts §CanvasNode.armKind (kiểu phía trình duyệt)',
    values: union(read('web/src/lib/types.ts'), /armKind\?:\s*([^;]+);/, 'types.ts'),
  },
  {
    where: 'web/src/components/ArmIcon.tsx §ArmKind (chỗ CHỌN hình)',
    values: union(read('web/src/components/ArmIcon.tsx'), /type ArmKind\s*=\s*([^;]+);/, 'ArmIcon.tsx'),
  },
];

test('ba bản khai loại cánh tay khớp nhau từng giá trị', () => {
  const [first, ...rest] = PLACES;
  for (const p of rest) {
    assert.deepEqual(
      [...p.values].sort(),
      [...first!.values].sort(),
      `lệch nhau:\n  ${first!.where}\n    → ${first!.values.join(' | ')}\n  ${p.where}\n    → ${p.values.join(' | ')}`,
    );
  }
});

test("'cli' có mặt ở cả ba — đây chính là giá trị đã bị bỏ sót 01/09", () => {
  for (const p of PLACES) assert.ok(p.values.includes('cli'), `thiếu 'cli' ở ${p.where}`);
});

test('🔴 server THẬT SỰ gán `cli`, không chỉ khai kiểu', () => {
  /**
   * Bài trên khoá chuyện ba union khớp nhau; bài này khoá chuyện **có mã thi
   * hành**. Union đủ giá trị mà không ai gán thì node vẫn mang hình sai — đúng
   * nấc ba của cái thang *spec nói xong · mã có mặt · ĐÃ CÓ AI GỌI CHƯA*.
   * → [[agentco-spec-says-done]]
   */
  const src = read('src/core/office.ts');
  assert.match(src, /armKind:\s*isCliArm\(/, 'office.ts không gán `cli` cho tờ khai CLI');
  assert.match(src, /import \{ isCliArm \} from '\.\/cli-arm\.js'/, 'thiếu import — sẽ gãy lúc build');
});
