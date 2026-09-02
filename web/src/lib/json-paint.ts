/**
 * TÔ MÀU + IN LẠI KHỐI JSON NGƯỜI DÙNG DÁN. → `ArmDialog.tsx §pane 'paste'`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO CÓ FILE NÀY, VÀ VÌ SAO NÓ RẺ                                      │
 * │                                                                          │
 * │ Đường B là *"dán khối JSON từ README"*, và hôm nay ô dán là một textarea  │
 * │ trần: một khối chữ đen 12px, không xuống dòng, không thụt lề. Người không │
 * │ code nhìn vào đó không phân biệt được **cái tên** với **giá trị**, và một │
 * │ dấu ngoặc thiếu thì không có gì chỉ chỗ.                                  │
 * │                                                                          │
 * │ JSON là ngôn ngữ nhỏ nhất còn được gọi là ngôn ngữ: một bộ tách token đủ  │
 * │ dùng là **một biểu thức chính quy**. Không thư viện, không AST, chạy trên │
 * │ chuỗi vài trăm byte. Đây không phải chỗ tốn hiệu năng.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * ⚠⚠ MÀU KHÔNG CHỈ RA ĐƯỢC ĐIỂM LỖI — và đây là chỗ dễ tin nhầm.
 *
 * User hỏi: *"paste 1 chuỗi không phải json, thì cái màu parse giúp khách hàng
 * nhận thấy ngay điểm lỗi?"* — **Không.** Tô màu là một phép **đoán từng token**;
 * nó vẫn tô đẹp một chuỗi sai cú pháp, vì nó không hề biết cấu trúc.
 *
 * Thứ BIẾT điểm lỗi là `JSON.parse`: nó ném kèm **vị trí**. Nên phân vai:
 *   · màu    → đọc dễ hơn (tên/giá trị/số/chuỗi khác nhau)
 *   · `fault`→ **chỉ đúng chỗ hỏng**, bằng dòng/cột và một câu tiếng người
 * Trông cậy vào màu để báo lỗi là đúng lớp *"câu lỗi chỉ sai cửa"*.
 */

import { t } from '@i18n';

export interface JsonFault {
  /** Chỉ số ký tự, 0-based. `-1` = không xác định được. */
  at: number;
  line: number;
  col: number;
  say: string;
}

/** `null` = đọc được. Ngược lại: hỏng ở đâu, và nói bằng tiếng người. */
export function fault(text: string): JsonFault | null {
  const s = text.trim();
  if (!s) return null;
  try {
    JSON.parse(s);
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    /**
     * V8 in vị trí theo hai kiểu tuỳ phiên bản (`at position N` và
     * `at line L column C`). Bắt cả hai, và **không có thì vẫn phải trả lời** —
     * `at: -1` để chỗ gọi biết là không trỏ được, chứ không im lặng bỏ qua.
     */
    const pos = Number(/position (\d+)/.exec(msg)?.[1] ?? -1);
    const at = Number.isFinite(pos) && pos >= 0 ? Math.min(pos, s.length) : -1;
    const before = at >= 0 ? s.slice(0, at) : '';
    const line = at >= 0 ? before.split('\n').length : 0;
    const col = at >= 0 ? at - before.lastIndexOf('\n') : 0;
    return { at, line, col, say: humanise(msg, s, at) };
  }
}

/**
 * Dịch câu lỗi của máy sang câu người dùng làm được gì với nó.
 *
 * ⚠ Không cố dịch mọi câu: chỉ những ca **thật sự hay gặp khi dán từ README**,
 * và ca nào không chắc thì trả một câu trung tính kèm vị trí. Đoán bừa một
 * nguyên nhân rồi nói chắc nịch là tệ hơn nói *"chỗ này"*.
 */
function humanise(msg: string, s: string, at: number): string {
  /**
   * ⚠⚠ THỨ TỰ Ở ĐÂY LÀ TOÀN BỘ CHẤT LƯỢNG CỦA HÀM. (sửa 31/08 sau khi đo)
   *
   * Bản đầu đọc văn của V8 trước, và **sai 3/5 ca thử**: V8 hiện đại gộp rất
   * nhiều lỗi khác nhau vào cùng một câu *"Expected property name or '}'"* —
   * khối bị cắt giữa chừng, thừa dấu phẩy, và tên trường không nháy đều ra
   * chung câu đó. Nhánh `/property name/` nuốt cả ba.
   *
   * ⇒ Hỏi **sự thật tự đếm được** trước, văn của V8 sau cùng. Đếm ngoặc là của
   * ta, tất định, và không đổi theo phiên bản Node.
   */
  const open = count(s, '{') - count(s, '}');
  const brk = count(s, '[') - count(s, ']');

  // ① Không phải JSON ngay từ ký tự đầu — nói thẳng, đừng nói về ngoặc.
  if (!/^[[{]/.test(s)) return t('jsonHint.notJson');

  // ② Lệch ngoặc ⇒ dán thiếu. Bắt được ca này KHÔNG cần V8 nói gì.
  if (open > 0) return t('jsonHint.missingBrace', { n: open });
  if (brk > 0) return t('jsonHint.missingBracket', { n: brk });
  if (open < 0) return t('jsonHint.extraBrace', { n: -open });
  if (brk < 0) return t('jsonHint.extraBracket', { n: -brk });
  if (count(s, '"') % 2 === 1) return t('jsonHint.unclosedQuote');

  // ③ Nhìn thẳng vào ký tự ở chỗ hỏng, và ký tự có nghĩa đứng ngay trước nó.
  const here = at >= 0 ? (s[at] ?? '') : '';
  const before = at >= 0 ? s.slice(0, at).trimEnd().slice(-1) : '';
  if (here === "'" || before === "'") {
    return t('jsonHint.singleQuote');
  }
  if (before === ',' && (here === '}' || here === ']')) {
    return t('jsonHint.trailingComma');
  }

  // ④ Giờ mới tới văn của V8, và tới đây nó đã hết mơ hồ.
  if (/property name/.test(msg)) return t('jsonHint.propName');
  if (/after property name|Expected ':'/.test(msg)) return t('jsonHint.missingColon');
  if (/Expected ',' /.test(msg)) return t('jsonHint.missingComma');
  return here ? t('jsonHint.badChar', { char: here }) : t('jsonHint.unreadable');
}

const count = (s: string, ch: string): number => s.split(ch).length - 1;

/** In lại cho dễ đọc. `null` = chưa hợp lệ nên **không đụng vào chữ của họ**. */
export function pretty(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  try {
    const out = JSON.stringify(JSON.parse(s), null, 2);
    return out === text ? null : out;
  } catch {
    // ⚠ KHÔNG in lại được một khối sai cú pháp — không có cây nào để đi.
    // Trả `null` để chỗ gọi giữ NGUYÊN VĂN thứ người dùng gõ. Tự ý "sửa hộ"
    // một khối hỏng là cách chắc chắn nhất để họ mất chỗ đang dở.
    return null;
  }
}

export type Tok = { t: 'key' | 'str' | 'num' | 'lit' | 'punc' | 'ws'; v: string };

/**
 * Tách token để tô màu. Cố ý **KHÔNG** kiểm cú pháp — nó phải chạy được trên
 * chuỗi đang gõ dở, nếu không thì màu nhấp nháy mỗi lần gõ một ký tự.
 *
 * `key` = chuỗi đứng ngay trước dấu `:` — đó là toàn bộ mẹo, và nó đủ đúng cho
 * JSON thật vì trong JSON chỉ có chuỗi mới làm tên trường được.
 */
export function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'punc', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'str', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'num', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'lit', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'punc', v: m[4] });
    else out.push({ t: 'ws', v: m[5]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'punc', v: text.slice(last) });

  // Lượt hai: chuỗi nào đứng trước `:` thì là TÊN TRƯỜNG.
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.t !== 'str') continue;
    let j = i + 1;
    while (j < out.length && out[j]!.t === 'ws') j++;
    if (out[j]?.v === ':') out[i]!.t = 'key';
  }
  return out;
}
