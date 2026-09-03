/**
 * ⭐ KHO TRI THỨC KHÔNG CÓ TRƯỜNG NGÔN NGỮ, VÀ `hot()` KHÔNG LỌC THEO NGÔN NGỮ.
 * → `src/knowledge/node.ts` · `src/knowledge/store.ts` · docs/CLAUDE.md
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ Ô KHOÁ MỘT **QUYẾT ĐỊNH KHÔNG LÀM GÌ**, và loại đó là loại dễ bị  │
 * │ lật lại nhất — vì không có mã nào để đọc, chỉ có một chỗ trống.          │
 * │                                                                          │
 * │ Bản nháp của đợt đa ngôn ngữ đề xuất gắn `lang?: 'vi'|'en'` cho node, suy │
 * │ ra bằng bộ dò dấu tiếng Việt. User bác, và bác đúng: bộ dò đó **nhị       │
 * │ phân**. Ghi chú tiếng Đức, Tây Ban Nha, Ả Rập đều không có dấu tiếng      │
 * │ Việt ⇒ nó lặng lẽ ghi `en`. Đó là **tín hiệu đội lốt cổng tất định**, và  │
 * │ nó ghi phán đoán **xuống đĩa, vào dữ liệu người dùng**, nơi không lần     │
 * │ đọc nào sau đó biết được giá trị ấy là đoán.                             │
 * │ → [[agentco-deterministic-vs-signal]]                                     │
 * │                                                                          │
 * │ Test này đỏ vào ngày ai đó thêm bộ dò "cho tiện", và bắt họ đọc lý do     │
 * │ trước khi đi tiếp. ĐIỀU KIỆN MỞ LẠI (một trong hai, không dựng trước):    │
 * │  ① một văn phòng thật tích được ghi chú ở ≥2 ngôn ngữ, KÈM một đầu ra     │
 * │    sai truy được về chuyện lẫn — không phải "trông kỳ kỳ";                │
 * │  ② có người thật xin lọc.                                                │
 * │ Và khi đó cơ chế đúng KHÔNG phải bộ dò: là **model tự khai** một thẻ      │
 * │ BCP-47 tự do, chỉ cho node sinh ra từ lúc đó. Node cũ để trống, và trống  │
 * │ nghĩa là KHÔNG BIẾT. → [[agentco-no-change-is-a-decision]]                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'knowledge');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

/** Bỏ chú thích: khối chú thích ở cả hai file CỐ Ý bàn về ngôn ngữ. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('🔴 `KnowledgeNode` KHÔNG có trường ngôn ngữ nào', () => {
  const code = read('node.ts');
  const iface = /export interface KnowledgeNode \{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  assert.ok(iface, 'không tìm thấy KnowledgeNode — test này đã lỗi thời');
  assert.doesNotMatch(
    withoutComments(iface),
    /^\s*(lang|language|locale)\??\s*:/m,
    'thêm trường ngôn ngữ cho node là ghi một phép đoán xuống dữ liệu người dùng — đọc khối trên',
  );
});

/**
 * `hot()` nạp top-N node vào prefix của MỌI worker. Lọc ở đó là đổi một phiền
 * toái **nhìn thấy được** (prefix lẫn hai thứ tiếng) lấy một phiền toái **im
 * lặng** (văn phòng quên mất thứ nó đã học, không ai báo). Repo này chọn cái
 * nhìn thấy được, mọi lần.
 */
test('🔴 `hot()` không nhận và không đọc tham số ngôn ngữ nào', () => {
  const code = read('store.ts');
  const hot = /\n  hot\(([\s\S]*?)\n  \}/.exec(code)?.[1] ?? '';
  assert.ok(hot, 'không tìm thấy hot() — test này đã lỗi thời');
  assert.doesNotMatch(withoutComments(hot), /\blang\b|\blanguage\b|\blocale\b/i);
});

/**
 * ⭐ Và không chỗ nào trong `knowledge/` dò dấu tiếng Việt.
 *
 * `hasVietnameseDiacritics` sống trong `scripts/check-language.ts` và chỉ đúng
 * ở đó, vì nó soi MÃ NGUỒN CỦA CHÍNH TA — thứ có đúng hai khả năng. Chĩa cùng
 * hàm đó vào văn bản người dùng là biến nó thành một phép đoán. Cái bảng dấu
 * tiếng Việt là thứ dễ "dùng lại cho tiện" nhất trong cả repo.
 */
test('⭐ không có bộ dò dấu tiếng Việt nào trong `knowledge/`', () => {
  for (const f of ['node.ts', 'store.ts']) {
    const code = withoutComments(read(f));
    assert.doesNotMatch(
      code,
      /hasVietnamese|detectLang|guessLang|sniffLang/i,
      `${f} có một bộ dò ngôn ngữ — nó là tín hiệu, không phải cổng`,
    );
    // Dải ký tự có dấu dùng làm bộ dò trông đúng như thế này. `STOPWORDS` là dữ
    // liệu từ vựng, không phải dải ký tự, nên nó không khớp mẫu dưới.
    assert.doesNotMatch(code, DIACRITIC_CLASS, `${f} có một dải ký tự dò dấu`);
  }
});

/** Dải ký tự có dấu dùng làm bộ dò trông đúng như thế này. */
const DIACRITIC_CLASS = /\[[^\]]*ạ[^\]]*ẹ[^\]]*\]/u; // i18n-allow-vietnamese: this pattern IS the shape being looked for

/**
 * ⭐ ĐỐI CHỨNG DƯƠNG — bài trên phải ĐỎ ĐƯỢC, không chỉ xanh.
 *
 * Ba assertion `doesNotMatch` ở trên đều xanh nếu mẫu của chúng không bao giờ
 * khớp thứ gì. Đó là cách một cổng xanh suốt đời mà không canh gì cả, và nó
 * không có triệu chứng. Chỗ duy nhất chứng minh được là ném vào nó đúng thứ nó
 * sinh ra để bắt. ⇒ [[agentco-free-discriminator]]
 */
test('⭐ đối chứng: mấy mẫu trên thật sự bắt được một bộ dò', () => {
  const detector = "const VI = /[àáảãạăèéẻẽẹêìíỉĩị]/;";
  assert.match(detector, DIACRITIC_CLASS, 'mẫu dải ký tự không bắt được một bộ dò thật');
  assert.match('function hasVietnameseDiacritics(s) {}', /hasVietnamese|detectLang|guessLang|sniffLang/i);
  assert.match('  lang?: string;', /^\s*(lang|language|locale)\??\s*:/m);
  assert.match('  locale: Locale;', /^\s*(lang|language|locale)\??\s*:/m);
});
