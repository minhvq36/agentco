/**
 * Markdown tối giản — PHẦN THUẦN. Không React, không DOM, không phụ thuộc.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TÁCH KHỎI `markdown.tsx`: ĐỂ KIỂM ĐƯỢC.                          │
 * │                                                                          │
 * │ Đây là mảnh code duy nhất trong giao diện có LOGIC PHÂN TÍCH thật, và là │
 * │ mảnh người dùng đã nêu đích danh là "hay bị lỗi, nhất là backtick lồng   │
 * │ nhau". Thứ vừa dễ sai vừa sai âm thầm thì phải có bộ test — mà bộ test   │
 * │ không dựng được nếu logic bị trộn vào file JSX.                          │
 * │                                                                          │
 * │ Phần render (`markdown.tsx`) thì ngược lại: nó chỉ ánh xạ khối → thẻ,    │
 * │ không có nhánh nào đáng sai, và nhìn bằng mắt là đủ.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * → `test/markdown.test.ts` · `web/src/lib/markdown.tsx`
 */

export type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string };

/** Một mẩu trong dòng: code span, hoặc văn bản thường. */
export type Token = { code: boolean; text: string };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;

/**
 * LƯỢT KHỐI — quét theo DÒNG.
 *
 * Fence phải xong hẳn TRƯỚC khi bất kỳ luật inline nào chạy. Đây là thứ tự
 * quyết định cả bài toán: làm ngược lại thì `**` nằm trong khối code sẽ bị bôi
 * đậm, và đó đúng là lớp lỗi mà cách viết "nối nhiều .replace()" luôn dẫm phải.
 *
 * ⚠ CỐ Ý KHÔNG hỗ trợ khối code thụt 4 dấu cách, và không hỗ trợ danh sách.
 * `helpText()` thụt mô tả lệnh đúng 4 dấu cách; dải bước kế hoạch dùng `  1. `.
 * Bật hai luật đó lên là biến những câu backend dựng sẵn thành khối code xám và
 * danh sách đánh số lại — hỏng đúng thứ đang chạy tốt.
 */
export function blocksOf(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let text: string[] = [];

  const flush = (): void => {
    // Khối CHỈ CÓ khoảng trắng thì bỏ hẳn, đừng đẩy xuống cho tầng render tự lo.
    //
    // Chuỗi rỗng `''.split('\n')` ra `['']` — tức là văn bản rỗng vẫn sinh một
    // khối. Tầng render hiện đang lọc nó, nhưng bắt MỌI người gọi phải nhớ điều
    // đó là cách để một ngày nào đó ai đó quên, rồi một bong bóng chat trống
    // trơn hiện ra mà không ai giải thích được nó từ đâu.
    const joined = text.join('\n');
    if (joined.trim()) out.push({ kind: 'text', text: joined });
    text = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);

    if (fence) {
      flush();
      const marker = fence[2]!;
      const body: string[] = [];
      i++;
      // Fence KHÔNG ĐÓNG thì nuốt tới hết văn bản — đúng hành vi CommonMark, và
      // đúng thứ ta muốn ở đây: model bị cắt giữa chừng hay để hở một fence, mà
      // coi nó là văn bản thường thì cả phần đuôi hiện sai kiểu.
      for (; i < lines.length; i++) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]!);
        if (close && close[1]!.length >= marker.length && close[1]![0] === marker[0]) break;
        body.push(lines[i]!);
      }
      out.push({ kind: 'code', lang: (fence[3] ?? '').toLowerCase(), text: body.join('\n') });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]!.trim() });
      continue;
    }

    text.push(line);
  }

  flush();
  return out;
}

/**
 * LƯỢT INLINE 1 — bóc code span ra khỏi văn bản. Chạy TRƯỚC bold.
 *
 * Luật CommonMark: mở bằng một run **N** backtick thì đóng bằng một run **đúng
 * N** — run dài hơn KHÔNG tính là đóng. Nhờ đúng một luật này mà ca "lồng nhau"
 * tự chạy đúng, không cần trường hợp riêng nào:
 *
 *   `` `a` ``   → hai backtick mở, `a` bên trong là VĂN BẢN, hai backtick đóng
 *
 * ⚠ Run không tìm được cặp đóng thì in NGUYÊN VĂN rồi đi tiếp. Đây là ca hỏng
 * hay gặp nhất trong các bản tự viết khác: chúng coi backtick lẻ là mở rồi nuốt
 * sạch phần còn lại vào một khối code — người dùng thấy "lệch format từ đó trở đi".
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let buf = '';
  let i = 0;

  const flush = (): void => {
    if (buf) out.push({ code: false, text: buf });
    buf = '';
  };

  while (i < src.length) {
    if (src[i] !== '`') {
      buf += src[i];
      i++;
      continue;
    }

    let n = 0;
    while (src[i + n] === '`') n++;

    // Tìm run đóng có ĐỘ DÀI ĐÚNG BẰNG n.
    let j = i + n;
    let close = -1;
    while (j < src.length) {
      if (src[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (src[j + m] === '`') m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }

    if (close === -1) {
      buf += '`'.repeat(n);
      i += n;
      continue;
    }

    flush();
    // CommonMark bỏ đúng MỘT dấu cách hai đầu — đó là cách viết một backtick
    // trần (`` ` ``) mà không bị hiểu nhầm thành dấu mở.
    let inner = src.slice(i + n, close);
    if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ')) inner = inner.slice(1, -1);
    out.push({ code: true, text: inner });
    i = close + n;
  }

  flush();
  return out;
}

/** Một mẩu đã ghép xong `**`: `bold` cho biết có bọc `<strong>` không. */
export interface Span {
  code: boolean;
  bold: boolean;
  text: string;
}

/**
 * LƯỢT INLINE 2 — ghép `**` TRÊN CHUỖI TOKEN, không phải trên chuỗi ký tự.
 *
 * Nhờ chạy trên token mà hai ca cùng đúng một lúc:
 *
 *   **xem `bao-hanh.md` nhé**   → đậm ôm trọn cả code span bên trong   ✅
 *   `a ** b`                    → `**` nằm trong code, không tới đây   ✅
 *
 * `**` lẻ in nguyên văn: người dùng gõ "2**3", hay một câu trả lời bị cắt giữa
 * chừng, không được làm hỏng phần còn lại của tin nhắn.
 *
 * Trả về danh sách phẳng để tầng render chỉ việc ánh xạ 1-1 sang thẻ — mọi
 * quyết định đã chốt xong ở đây, nơi kiểm được.
 */
export function spansOf(src: string): Span[] {
  const tokens = tokenize(src);
  const out: Span[] = [];
  const push = (code: boolean, bold: boolean, text: string): void => {
    if (text) out.push({ code, bold, text });
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (tok.code) {
      push(true, false, tok.text);
      continue;
    }

    let rest = tok.text;
    let guard = 0;
    while (guard++ < 500) {
      const open = rest.indexOf('**');
      if (open === -1) break;

      // Cặp đóng nằm trong CÙNG token — ca thường gặp nhất.
      const same = rest.indexOf('**', open + 2);
      if (same !== -1) {
        push(false, false, rest.slice(0, open));
        push(false, true, rest.slice(open + 2, same));
        rest = rest.slice(same + 2);
        continue;
      }

      // Không có ở đây — tìm ở token VĂN BẢN phía sau, ôm trọn mọi code span
      // nằm giữa. Đây là ca `**xem `x.md` nhé**`.
      let end = -1;
      for (let u = t + 1; u < tokens.length; u++) {
        const nxt = tokens[u]!;
        if (!nxt.code && nxt.text.includes('**')) {
          end = u;
          break;
        }
      }
      if (end === -1) break; // `**` lẻ → để nguyên văn ở nhánh dưới

      push(false, false, rest.slice(0, open));
      push(false, true, rest.slice(open + 2));
      for (let u = t + 1; u < end; u++) {
        const mid = tokens[u]!;
        push(mid.code, true, mid.text);
      }
      const tail = tokens[end]!.text;
      const cut = tail.indexOf('**');
      push(false, true, tail.slice(0, cut));
      rest = tail.slice(cut + 2);
      t = end;
    }

    push(false, false, rest);
  }

  return out;
}
