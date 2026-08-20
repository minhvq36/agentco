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

/** Canh cột, đọc từ dòng phân cách: `:---` `:--:` `---:`. */
export type Align = 'left' | 'center' | 'right';

export type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; head: string[]; rows: string[][]; align: Align[] }
  /**
   * Danh sách việc cần làm — `- [ ]` / `- [x]`. → SPEC-ui.md
   *
   * Có kiểu RIÊNG chứ không nhét vào `text`, vì đây đúng là thứ bài 6 sinh ra
   * ("gộp thành một checklist ngắn") và in nó ra dạng `- [ ] …` nguyên văn thì
   * người dùng nhận về ký tự thay vì một danh sách đọc được bằng mắt.
   *
   * `done` là thứ QUAN SÁT ĐƯỢC từ chữ trong file, không phải trạng thái ta
   * giữ: ô này không bấm được, và đó là chủ ý — file kết quả là thứ nhân viên
   * viết ra, ngăn Kết quả là cửa sổ ĐỌC. Cho bấm là mở một đường ghi thứ hai
   * vào cùng một file, và sớm muộn nó lệch với thứ agent vừa ghi.
   */
  | { kind: 'tasks'; items: { done: boolean; text: string }[] }
  | { kind: 'text'; text: string };

/** Một mẩu trong dòng: code span, hoặc văn bản thường. */
export type Token = { code: boolean; text: string };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
/**
 * `- [ ] việc` · `* [x] việc` · `+ [X] việc`, thụt lề tuỳ ý.
 *
 * ⚠ BẮT BUỘC có khoảng trắng sau `]`. Thiếu nó thì `- [x]abc` cũng khớp, mà
 * chuỗi đó trong văn xuôi kỹ thuật là một tham chiếu, không phải một việc.
 *
 * ⚠ Và nội dung phải MỞ ĐẦU BẰNG KÝ TỰ THẬT (`\S`), không phải `.+` — `.` khớp
 * cả khoảng trắng, nên `- [ ]` kèm vài dấu cách thừa ở cuối vẫn lọt và đẻ ra
 * một việc RỖNG. Test bắt đúng ca đó ở vòng đầu, và nó là ca có thật: model
 * xuống dòng sau `]` là chuyện thường.
 */
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(\S.*)$/;

/**
 * Dòng phân cách của bảng: `|---|:--:|---:|`. Đây là thứ ĐỊNH NGHĨA một bảng.
 *
 * Một dòng chỉ có dấu `|` thì chưa phải bảng — người dùng gõ "a | b" trong câu
 * là chuyện bình thường. Chỉ khi dòng NGAY SAU là dòng phân cách hợp lệ thì
 * khối đó mới là bảng, đúng luật GFM.
 */
const DELIM_CELL = /^:?-{1,}:?$/;

/** Số cột tối đa. Bảng rộng hơn thế gần như chắc chắn là văn bản bị hiểu nhầm. */
const MAX_COLS = 24;
/** Số hàng tối đa cho một bảng. Vượt thì cắt — bong bóng chat không phải bảng tính. */
const MAX_ROWS = 500;

/**
 * Cắt một dòng bảng thành các ô.
 *
 * Bỏ đúng MỘT dấu `|` ở hai đầu (viết `| a | b |` hay `a | b` đều hợp lệ trong
 * GFM), và tôn trọng `\|` — dấu gạch đứng đã thoát là NỘI DUNG, không phải vách
 * ngăn. Thiếu luật thoát đó thì một ô chứa `a\|b` tự tách làm đôi và cả hàng
 * lệch cột so với hàng tiêu đề — tức là cả bảng bị vứt đi ở khâu kiểm cột.
 */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  // Cắt `|` cuối, nhưng KHÔNG cắt nếu nó đã được thoát (`\|`).
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Dòng này có phải dòng phân cách với ĐÚNG `cols` cột không?
 *
 * ⚠ ĐÒI CÓ `|` TRONG CHÍNH DÒNG PHÂN CÁCH, và đó không phải thừa. Không có luật
 * này thì hai dòng vô hại sau đây thành một cái bảng một cột:
 *
 *   chọn cà phê | trà sữa
 *   ---
 *
 * `---` đứng một mình là gạch ngang / tiêu đề kiểu setext — hai thứ bộ phân
 * tích này CỐ Ý không hỗ trợ, nên hôm nay chúng hiện nguyên văn và phải tiếp
 * tục như thế. Luật này miễn phí: bảng từ hai cột trở lên thì dòng phân cách
 * BẮT BUỘC đã có `|` rồi.
 */
function delimAlign(line: string, cols: number): Align[] | undefined {
  if (!line.includes('-') || !line.includes('|')) return undefined;
  const cells = splitCells(line);
  if (cells.length !== cols) return undefined;
  if (!cells.every((c) => DELIM_CELL.test(c))) return undefined;
  return cells.map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : 'left';
  });
}

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
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BẢNG: "TRỌN BẢNG HOẶC KHÔNG GÌ CẢ" (20/08).                             │
 * │                                                                          │
 * │ Nhận diện bảng đòi BA điều kiện, thiếu một là rơi thẳng về `text` và      │
 * │ hiện nguyên văn y như trước khi có luật này:                              │
 * │                                                                          │
 * │   1. dòng hiện tại có `|`                                                │
 * │   2. dòng NGAY SAU là dòng phân cách (`|---|:--:|`)                      │
 * │   3. số cột của hai dòng đó KHỚP NHAU                                    │
 * │                                                                          │
 * │ Vì sao khắt khe: một bảng vẽ ra mà lệch cột, thiếu ô, hay nuốt mất hàng   │
 * │ cuối là một LỜI KHẲNG ĐỊNH SAI về dữ liệu — người đọc tin vào cái bảng    │
 * │ hơn hẳn tin vào một đống dấu `|`. Hiện nguyên văn thì xấu nhưng không     │
 * │ nói dối, và người dùng nhìn ra ngay là "chỗ này chưa dựng được".          │
 * │                                                                          │
 * │ Hàng THÂN thì ngược lại — được nới: GFM cho phép hàng thiếu ô (đệm rỗng)  │
 * │ và thừa ô (cắt bớt). Ràng buộc chặt đặt ở chỗ QUYẾT ĐỊNH "đây có phải     │
 * │ bảng không"; sau khi đã quyết rồi thì một hàng lệch không đáng để vứt cả  │
 * │ bảng đi.                                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
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

    // BẢNG — kiểm trước khi gom vào văn bản, nhưng chỉ khi cả ba điều kiện đủ.
    // Không đủ thì `continue` KHÔNG chạy và dòng rơi xuống `text.push` như cũ.
    if (line.includes('|')) {
      const head = splitCells(line);
      // Bảng MỘT CỘT là hợp lệ và có thật (một danh sách có tiêu đề). Cửa chặn
      // ca giả nằm ở `delimAlign`, không nằm ở số cột.
      const align =
        head.length <= MAX_COLS ? delimAlign(lines[i + 1] ?? '', head.length) : undefined;
      if (align) {
        flush();
        const rows: string[][] = [];
        let j = i + 2;
        // Ăn tới dòng đầu tiên KHÔNG có `|`. Dòng trắng cũng dừng — nó là ranh
        // giới đoạn văn, và một bảng nối qua dòng trắng là hai bảng khác nhau.
        for (; j < lines.length && rows.length < MAX_ROWS; j++) {
          const row = lines[j]!;
          if (!row.includes('|') || !row.trim()) break;
          const cells = splitCells(row);
          // Đệm/cắt về đúng số cột của tiêu đề — xem khối chú thích ở trên.
          while (cells.length < head.length) cells.push('');
          rows.push(cells.slice(0, head.length));
        }
        out.push({ kind: 'table', head, rows, align });
        i = j - 1;
        continue;
      }
    }

    /**
     * DANH SÁCH VIỆC — gom các dòng `- [ ]` / `- [x]` LIỀN NHAU thành một khối.
     *
     * Kiểm SAU bảng và SAU heading: một dòng `- [x]` không chứa `|` và không bắt
     * đầu bằng `#`, nên thứ tự ở đây không tranh chấp — nhưng giữ nó cuối cùng
     * để mọi cấu trúc "mạnh" hơn vẫn được xét trước.
     *
     * Dừng ở dòng đầu tiên KHÔNG phải việc cần làm, kể cả dòng trắng: một danh
     * sách nối qua dòng trắng là hai danh sách khác nhau — cùng luật với bảng.
     */
    const firstTask = TASK.exec(line);
    if (firstTask) {
      flush();
      const items: { done: boolean; text: string }[] = [];
      let j = i;
      for (; j < lines.length && items.length < MAX_ROWS; j++) {
        const m = TASK.exec(lines[j]!);
        if (!m) break;
        items.push({ done: m[1]!.toLowerCase() === 'x', text: m[2]!.trim() });
      }
      out.push({ kind: 'tasks', items });
      i = j - 1;
      continue;
    }

    text.push(line);
  }

  flush();
  return out;
}

/**
 * Tin nhắn này có bảng dựng được không?
 *
 * Ô chat dùng nó để chọn bề rộng bong bóng: bảng là thứ DUY NHẤT trong markdown
 * mà bề rộng mang thông tin, nên tin có bảng được nới ra hết panel còn tin
 * thường vẫn giữ 92% (một bong bóng full width cho câu "Đã xong." trông sai).
 *
 * Đi qua ĐÚNG `blocksOf`, không phải một regex riêng: hai cách nhận diện song
 * song thì kiểu gì cũng có ngày lệch nhau — bong bóng nới rộng cho một "bảng"
 * mà tầng vẽ lại quyết định hiện nguyên văn. Phân tích lại một tin nhắn chat là
 * vài chục micro giây, rẻ hơn nhiều so với một lớp lỗi.
 */
export function hasTable(src: string): boolean {
  return blocksOf(src).some((b) => b.kind === 'table');
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
