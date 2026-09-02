/**
 * Lệnh chữ trong ô chat. → docs/SPEC-tools-approval.md §8e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO PHẢI CHẶN Ở ĐÂY, KHÔNG PHẢI Ở UI                                 │
 * │                                                                          │
 * │ Chuỗi ta đưa vào `query({ prompt })` đi tới chính CLI Claude Code, mà    │
 * │ CLI đó CÓ bộ lệnh gạch chéo riêng (`/clear`, `/compact`, `/model`…).     │
 * │ Một câu bắt đầu bằng `/` có thể bị nó hiểu là lệnh của nó — `/clear`     │
 * │ lọt qua là mất trắng ngữ cảnh hội thoại của Trợ lý mà không ai biết      │
 * │ vì sao.                                                                  │
 * │                                                                          │
 * │ Nên: DANH SÁCH TRẮNG. Cái gì không phải lệnh của ta thì không đi tiếp.   │
 * │ Ta không cần biết Claude Code có những lệnh gì, hôm nay hay năm sau.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Lệnh viết bằng TIẾNG ANH dù người dùng là ai — dự án đi ra thế giới, và một
 * bộ lệnh là một giao diện lập trình, không phải một câu văn. Câu TRẢ LỜI thì
 * vẫn theo ngôn ngữ người dùng.
 *
 * Cùng bộ lệnh này chạy ở giao diện và ở Telegram, vì cả hai đều đi qua
 * `office.say()`.
 */

import { plural, t, type MessageKey } from '../i18n/index.js';

export type CommandName = 'stop' | 'approve' | 'reject' | 'status' | 'help' | 'clear' | 'resume';

export interface CommandSpec {
  name: CommandName;
  /** Dạng gõ được, kể cả viết tắt. Tất cả đều tiếng Anh. */
  aliases: readonly string[];
  /**
   * A CATALOGUE KEY, not a sentence.
   *
   * `COMMANDS` is a module-level constant, so a resolved string here would be
   * frozen at import to whichever language the process started in and would
   * never follow the switch afterwards. Holding the key defers the lookup to
   * `helpText()`, which runs per request. → docs/CLAUDE.md §Language
   */
  help: MessageKey;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: 'stop', aliases: ['stop', 'cancel', 's'], help: 'cmd.stop' },
  { name: 'approve', aliases: ['approve', 'ok', 'y'], help: 'cmd.approve' },
  { name: 'reject', aliases: ['reject', 'no', 'n'], help: 'cmd.reject' },
  { name: 'status', aliases: ['status', 'st'], help: 'cmd.status' },
  /**
   * Chạy tiếp ca bị NGẮT — không lập kế hoạch lại, không tốn một lượt model.
   *
   * Là một LỆNH chứ không phải một nút, vì nó phải chạy được cả qua Telegram
   * (bridge là mục tiêu tối thượng, và ở đó sơ đồ không tồn tại). Và nó phải là
   * hành động TƯỜNG MINH của người dùng: tự chạy tiếp lúc bật daemon nghĩa là
   * một lần crash âm thầm tiêu tiền của họ. → SPEC-offices.md §6b
   */
  { name: 'resume', aliases: ['resume', 'tiep'], help: 'cmd.resume' },
  /**
   * Cùng TÊN với `/clear` của Claude Code là có chủ ý: người dùng đã quen phản
   * xạ đó, và ý nghĩa ở đây khớp. Nhưng nó KHÔNG bao giờ đi tới CLI — danh sách
   * trắng ở `parseInput` chặn mọi chuỗi gạch chéo, và ta xử lý bằng code.
   *
   * Khác một điểm quan trọng so với `/clear` của Claude Code: ta NÉN TRƯỚC KHI
   * QUÊN. Bản nén đi vào sổ tay riêng của Trợ lý, đọc lại được ở ngăn Tri thức.
   */
  { name: 'clear', aliases: ['clear'], help: 'cmd.clear' },
  { name: 'help', aliases: ['help', 'h', '?'], help: 'cmd.help' },
];

export type ParsedInput =
  /** Lệnh của ta — xử lý bằng code, KHÔNG gọi model, 0 token. */
  | { kind: 'command'; name: CommandName; arg: string }
  /** Bắt đầu bằng "/" nhưng không phải của ta — CHẶN, không chuyển xuống SDK. */
  | { kind: 'unknown'; typed: string }
  /** Văn bản thường (đã gỡ dấu thoát "//" nếu có). */
  | { kind: 'text'; text: string };

/**
 * Phân loại một câu người dùng gõ. Gọi ở NGAY ĐẦU `office.say()`, trước mọi
 * thứ khác.
 *
 * Ba nhánh, và nhánh `unknown` là nhánh giữ an toàn: bất cứ thứ gì bắt đầu
 * bằng "/" mà ta không nhận ra đều dừng lại ở đây.
 */
export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();

  // "//" là cửa thoát cho người thật sự muốn bắt đầu câu bằng dấu gạch chéo.
  if (text.startsWith('//')) return { kind: 'text', text: text.slice(1) };
  if (!text.startsWith('/')) return { kind: 'text', text };

  const body = text.slice(1);
  const space = body.search(/\s/);
  const word = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const arg = space === -1 ? '' : body.slice(space + 1).trim();

  for (const c of COMMANDS) {
    if (c.aliases.includes(word)) return { kind: 'command', name: c.name, arg };
  }
  return { kind: 'unknown', typed: word };
}

/**
 * Câu trả lời cho `/help` và cho lệnh không nhận ra. 0 token — dựng bằng code.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO XUỐNG DÒNG THAY VÌ CĂN CỘT                                        │
 * │                                                                          │
 * │ Bản trước xếp `/lệnh — mô tả` trên MỘT dòng. Khung chat rộng ~330px, và  │
 * │ cùng bộ lệnh này sẽ chạy qua Telegram — cả hai đều hẹp. Một dòng dài bị  │
 * │ ngắt tự động ở chỗ ngẫu nhiên, và phần mô tả rơi xuống thẳng hàng với    │
 * │ tên lệnh kế tiếp: người đọc không còn phân biệt được đâu là lệnh.        │
 * │                                                                          │
 * │ Căn cột bằng khoảng trắng cũng không cứu được — nó chỉ đúng với font     │
 * │ đơn cách, mà bong bóng chat dùng font thường.                            │
 * │                                                                          │
 * │ Nên: tên lệnh một dòng, mô tả thụt vào ở dòng dưới. Đọc được ở mọi bề    │
 * │ rộng, kể cả trên điện thoại.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Chuỗi này có ký tự xuống dòng thật. Bên hiển thị PHẢI giữ chúng
 * (`white-space: pre-wrap`), nếu không HTML gộp hết thành một dòng.
 */
export function helpText(unknown?: string): string {
  const blocks = COMMANDS.map((c) => {
    // Viết tắt là thứ người dùng chỉ cần biết MỘT lần, nên nó đi cùng dòng tên
    // lệnh chứ không chiếm dòng riêng.
    const short = c.aliases.slice(1).filter((a) => a.length <= 2);
    const alias = short.length
      ? `   ${t('cmd.orAlias', { list: short.map((a) => `/${a}`).join(', ') })}`
      : '';
    return `/${c.aliases[0]}${alias}\n    ${t(c.help)}`;
  });

  const head = unknown ? t('cmd.noSuch', { typed: unknown }) : t('cmd.available');

  return `${head}\n\n${blocks.join('\n\n')}\n\n${t('cmd.escapeHint')}`;
}

/**
 * `@đường-dẫn` trong ô chat → đường dẫn ĐÃ XÁC MINH. → docs/SPEC-library.md §8c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG TRÔNG CHỜ SDK HIỂU `@` — VÀ VÌ SAO TA KHÔNG MUỐN NÓ HIỂU.   │
 * │                                                                          │
 * │ CLI Claude Code có cú pháp `@file` khi gõ tay. Nó CÓ chạy trong SDK hay  │
 * │ không thì **chưa ai đo** — `FINDINGS-sdk` không có một dòng nào về nó, và │
 * │ dự án này đã trả giá một lần cho việc xây lên một hành vi SDK chưa đo     │
 * │ (`canUseTool` không nổ lần nào, SPEC-offices §4.7).                       │
 * │                                                                          │
 * │ 🔥 Nhưng lý do thật mạnh hơn nhiều: **nếu SDK có hiểu thì đó là chuyện    │
 * │ XẤU.** Mở rộng `@` nghĩa là nhét NỘI DUNG file vào lượt gọi — mà Trợ lý   │
 * │ chạy trên session được persist, nên mọi thứ nó đọc nằm trong ngữ cảnh của │
 * │ MỌI lượt sau đó: *đọc một lần, trả tiền mãi mãi*. Cả kiến trúc dựng trên  │
 * │ luật "Trợ lý không đọc file, nhân viên mới đọc".                          │
 * │                                                                          │
 * │ Nên `@` bị BÓC HẾT ở đây, trước khi chuỗi tới model. Ta không phụ thuộc   │
 * │ vào bất kỳ hành vi SDK nào — đo hay chưa đo cũng vậy.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Cửa này chạy trên chữ NGƯỜI DÙNG GÕ, không phải chữ model sinh — khác
 * hẳn luật cấm dò đường dẫn trong `say` (SPEC-artifacts §2.5). Ở đó rủi ro là
 * model bịa ra một đường dẫn nghe rất thật; ở đây người dùng tự chịu trách
 * nhiệm cho thứ họ gõ, VÀ mọi tham chiếu vẫn phải đối chiếu với `known` — danh
 * sách đường dẫn có thật, đọc từ đĩa — trước khi được công nhận.
 *
 * Bốn dạng nhận được:
 *
 *   @artifacts/P-…/T-01/vi/doc-2.md      đường dẫn đủ → đối chiếu rồi dùng
 *   @library/files/doc-1.md               đường dẫn đủ → đối chiếu rồi dùng
 *   @doc-1.md                             tên trần     → tra, và CHẶN nếu trùng
 *   @library/files/Mix, Mingle&Meet.pptx  CÓ DẤU CÁCH  → khớp chuỗi dài nhất
 *
 * Dạng thứ ba là lý do hàm này phải tồn tại; dạng thứ tư là lý do nó không được
 * cắt ở khoảng trắng. → `typables`
 *
 * Tên trần trùng nhau là ca CÓ THẬT và hai kho được phép trùng: tủ tài liệu có
 * `doc-1.md`, ngăn Kết quả cũng có `doc-1.md`. Đoán bừa một bên là làm sai việc
 * của người dùng một cách im lặng — nên hỏi lại, bằng code, 0 token.
 */
/**
 * Một tài liệu, nhìn từ HAI phía. → SPEC-library.md §4.4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NGƯỜI DÙNG GÕ TÊN HỌ NHÌN THẤY; MODEL PHẢI NHẬN ĐƯỜNG MỞ ĐƯỢC.           │
 * │                                                                          │
 * │ Nút Chép ở ngăn Tủ tài liệu đưa `library/files/hd1.docx` — đúng thứ họ    │
 * │ thấy trên màn hình. Nhưng `.docx` là file nén, không tool nào mở trực     │
 * │ tiếp; đường mở được là `library/text/hd1.docx.txt`. Trước 20/08 hai thứ   │
 * │ này là MỘT chuỗi, nên cái nào cũng sai một phía.                          │
 * │                                                                          │
 * │ ⚠ User chốt và nói rõ đây KHÔNG phải phá luật *"đường dẫn người dùng gõ  │
 * │ là chính xác, chép nguyên văn"* mà là **SỬA luật**: thứ họ chỉ đích danh  │
 * │ là một TÀI LIỆU, không phải một chuỗi byte. Giữ nguyên văn cái chuỗi mà   │
 * │ đánh mất tài liệu thì mới là làm sai ý họ.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ReadableRef {
  /** Chuỗi người dùng (hoặc model) được phép gõ — thứ hiện trên giao diện. */
  ref: string;
  /** Chuỗi đi tới model. Bằng `ref` với mọi thứ vốn đã mở được. */
  open: string;
}

/** Tên file, bỏ phần thư mục. */
function base(p: string): string {
  return p.split('/').pop() ?? p;
}

/**
 * MỌI CHUỖI NGƯỜI TA ĐƯỢC PHÉP GÕ SAU `@`, DÀI TRƯỚC NGẮN SAU.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG USER BÁO 02/09 — `@library/files/Mix, Mingle&Meet.pptx` báo *"không   │
 * │ tìm thấy library/files/Mix"*.                                            │
 * │                                                                          │
 * │ Bản cũ cắt tham chiếu ở KHOẢNG TRẮNG (`@([^\s@]+)`), dựa trên một tiền đề │
 * │ ghi thẳng trong chú thích: *"tên có dấu cách thì dùng đường dẫn đủ, mà    │
 * │ nút Chép vốn luôn cho đường dẫn đủ"*. Tiền đề đó SAI: đường dẫn đủ cũng   │
 * │ chứa đúng cái dấu cách ấy. Nên nút Chép — lối thoát mà chính câu báo lỗi  │
 * │ mời người dùng bấm — đưa ra một chuỗi bộ giải không đọc nổi.              │
 * │                                                                          │
 * │ Cách sửa KHÔNG phải là nghĩ ra một quy ước trích dẫn (`@"…"`) rồi bắt     │
 * │ người dùng học, và cũng không phải là ép tên file phải sạch — tài liệu là │
 * │ của họ, `Mix, Mingle&Meet.pptx` là một cái tên hợp lệ. Ta đang CẦM danh   │
 * │ sách đường dẫn có thật đọc từ đĩa, nên không cần đoán ranh giới: khớp     │
 * │ chuỗi dài nhất trong `known` mà đoạn sau `@` bắt đầu bằng nó. Dấu cách,   │
 * │ dấu phẩy, `&`, tiếng Việt có dấu — không ký tự nào còn là ranh giới.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Dài trước ngắn sau vì một tên có thể là tiền tố của tên khác: có cả `bao-cao.md`
 * lẫn `bao-cao.md.bak` thì `@bao-cao.md.bak` phải ra cái thứ hai.
 */
function typables(known: readonly ReadableRef[]): string[] {
  const set = new Set<string>();
  for (const k of known) {
    set.add(k.ref);
    set.add(k.open);
    set.add(base(k.ref));
    set.add(base(k.open));
  }
  set.delete('');
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * Ký tự đứng ngay sau một tham chiếu khớp đủ.
 *
 * ⚠ Không có hàng rào này thì khớp-tiền-tố nuốt cả chữ thường: một tài liệu tên
 * `a` sẽ làm `@anh xem giúp` khớp thành `a`. Hết chuỗi, khoảng trắng, hoặc dấu
 * câu — ngoài ra là chữ của người ta, không phải tên file.
 */
function endsRef(next: string | undefined): boolean {
  return next === undefined || /[\s.,;:)\]}]/.test(next);
}

/** Tra một chuỗi người ta gõ về đúng một tài liệu. Tên trần trùng → `undefined`. */
function lookupRef(
  raw: string,
  known: readonly ReadableRef[],
): { hit?: ReadableRef; clash?: ReadableRef[] } {
  // Khớp đủ trước, cả hai phía: họ có thể dán đường hiển thị (nút Chép) HOẶC
  // đường mở được (bảng kê trong prefix Trợ lý nêu đường này).
  const exact = known.find((k) => k.ref === raw || k.open === raw);
  if (exact) return { hit: exact };

  const matches = known.filter((k) => base(k.ref) === raw || base(k.open) === raw);
  // Cùng một tài liệu khớp qua hai cửa thì KHÔNG phải trùng lặp.
  const distinct = [...new Map(matches.map((k) => [k.open, k])).values()];
  if (distinct.length > 1) return { clash: distinct };
  return distinct[0] ? { hit: distinct[0] } : {};
}

export function resolveFileRefs(
  text: string,
  known: readonly ReadableRef[],
): { text: string; problem?: string } {
  // `@` phải đứng đầu chuỗi hoặc sau khoảng trắng — `ten@mail.com` không phải
  // tham chiếu file.
  if (!/(^|\s)@/.test(text)) return { text };

  const names = typables(known);

  // Dựng lại câu bằng CHỈ SỐ, không phải `String.replace`. `replace` thay chỗ
  // xuất hiện ĐẦU TIÊN trong cả câu, nên "@a.md rồi lại @a.md" trước đây sửa
  // hai lần cùng một chỗ và bỏ sót chỗ thứ hai.
  let out = '';
  let cursor = 0; // đã ghi ra tới đâu — cũng là mốc "đoạn này đã bị nuốt"
  const re = /(^|\s)@/g;

  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[1]!.length; // vị trí của chính dấu `@`
    if (at < cursor) continue; // `@` nằm bên trong một tham chiếu vừa nuốt
    // `\` → `/` ngay từ đầu: dán từ Explorer là ca thường trên Windows. Thay
    // một-ăn-một nên mọi chỉ số bên dưới vẫn trỏ đúng vào `text`.
    const rest = text.slice(at + 1).replace(/\\/g, '/');

    // KHỚP ĐỦ TRƯỚC: chuỗi dài nhất trong `known` mà `rest` bắt đầu bằng nó.
    // Đây là cửa duy nhất nhận được tên có dấu cách. → `typables`
    let raw = names.find((n) => rest.startsWith(n) && endsRef(rest[n.length]));
    let tail = '';

    if (!raw) {
      // Không khớp cái nào ⇒ cắt tới khoảng trắng như cũ, để câu báo lỗi vẫn
      // nêu đúng thứ người ta gõ khi họ gõ sai thật.
      const typed = /^[^\s@]+/.exec(rest)?.[0] ?? '';
      if (!typed) continue; // `@` trơ trọi, hoặc `@@` — không phải tham chiếu
      // Bỏ dấu câu dính đuôi: người ta gõ "sửa @a/b.md, giữ nguyên phần đầu".
      //
      // ⚠ Phần bị bỏ phải được TRẢ LẠI vào câu. Bản đầu thay cả cụm bằng đường
      // dẫn sạch, và dấu phẩy biến mất khỏi câu của người dùng — sửa chữ họ
      // viết mà không nói là chuyện nhỏ ở đây nhưng là một thói quen sai: ta
      // chỉ được phép bóc `@`, không được phép biên tập.
      tail = /[.,;:)\]}]+$/.exec(typed)?.[0] ?? '';
      raw = tail ? typed.slice(0, -tail.length) : typed;
      if (!raw) continue;
    }

    const { hit, clash } = lookupRef(raw, known);
    if (clash) {
      return {
        text,
        problem: t('cmd.refClash', {
          n: String(clash.length),
          name: raw,
          list: clash.map((k) => `  ${k.ref}`).join('\n'),
        }),
      };
    }
    if (!hit) {
      return {
        text,
        problem: t('cmd.refMissing', { name: raw }),
      };
    }

    // Bỏ `@`, thay bằng đường NHÂN VIÊN MỞ ĐƯỢC — không nhất thiết là chuỗi họ
    // vừa gõ. `@hd1.docx` ra `library/text/hd1.docx.txt`, vì `.docx` gốc không
    // tool nào mở được và một đường dẫn chết là cách đắt nhất để tôn trọng
    // nguyên văn. → `ReadableRef`
    out += text.slice(cursor, at) + hit.open + tail;
    cursor = at + 1 + raw.length + tail.length;
  }

  if (cursor === 0) return { text };
  return { text: out + text.slice(cursor) };
}

/**
 * Đường dẫn Trợ lý ĐỀ NGHỊ đọc → đường dẫn CÓ THẬT. → SPEC-offices.md §6 `lookup`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ CHỖ "WORKER ẨN" TRỞ THÀNH MỘT CƠ CHẾ CHỨ KHÔNG PHẢI MỘT LỜI HỨA. │
 * │                                                                          │
 * │ Chuỗi vào là do MODEL sinh, nên nó bịa được — và luật SPEC-artifacts §2.5 │
 * │ cấm cho một đường dẫn model đoán mượn uy tín của hệ thống. Ở đây mọi      │
 * │ đường dẫn phải khớp `known` (đọc từ đĩa ngay lúc đó) mới đi tiếp; thứ     │
 * │ không khớp KHÔNG bị đoán hộ, nó được NÓI RA.                             │
 * │                                                                          │
 * │ Khác `resolveFileRefs` ở một điểm quan trọng: ở đó một đường dẫn hỏng là  │
 * │ lỗi của người dùng nên phải dừng cả câu. Ở đây model đề nghị ba file mà   │
 * │ hai file có thật thì **đọc hai file đó** — nó chỉ đoán sai một chỗ, và    │
 * │ bắt người dùng gõ lại vì thế là phạt nhầm người.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nhận cả tên trần (`doc-1.md`) như `resolveFileRefs`, và cũng CHẶN khi trùng —
 * tủ tài liệu và ngăn Kết quả được phép có cùng một tên file.
 */
export function pickReadable(
  paths: readonly string[],
  known: readonly ReadableRef[],
): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];

  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!p) continue;
    // Tên trần chỉ nhận khi có ĐÚNG MỘT ứng viên — hai file cùng tên ở hai kho
    // thì đoán bừa là đọc nhầm tài liệu rồi trả lời rất thuyết phục, kết cục tệ
    // nhất trong mọi kết cục. `lookupRef` giữ luật đó cho cả hai cửa.
    const { hit } = lookupRef(p, known);
    // Đường MỞ ĐƯỢC, y như cửa `@`: worker ẩn `lookup` cũng chỉ có `Read`/`Grep`,
    // nên đưa nó một `.docx` là đưa một file nó không mở nổi.
    if (hit) {
      if (!ok.includes(hit.open)) ok.push(hit.open);
      continue;
    }
    if (!missing.includes(p)) missing.push(p);
  }

  return { ok, missing };
}

/**
 * Dòng trạng thái của một lượt `lookup`. → SPEC-offices.md §6 `lookup`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NỬA SỰ THẬT CÒN LẠI, GIÁ 0 TOKEN.                                        │
 * │                                                                          │
 * │ Worker ẩn cố ý KHÔNG sinh Plan: một tin *"mình chia thành 1 việc để đọc  │
 * │ file"* cho một câu hỏi tra cứu tốn hai tin nhắn chỉ để báo rằng sắp trả   │
 * │ lời — đúng cái "ngơ" mà cửa này sinh ra để bỏ. Nhưng trả lời với vai      │
 * │ `assistant` mà không nói gì thêm thì người dùng tưởng Trợ lý tự biết,     │
 * │ trong khi có một lượt đọc file thật sự vừa chạy.                          │
 * │                                                                          │
 * │ Một dòng trạng thái nói ĐỌC FILE NÀO là đủ: người dùng thấy có việc đọc   │
 * │ đang diễn ra và đọc cái gì. Không plan, không bước, không tin thừa nằm    │
 * │ lại trong luồng chat.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chỉ nêu TÊN FILE, không nêu đường dẫn: `library/files/doc-2.md` trên một dòng
 * trạng thái là ngôn ngữ của máy. Cắt ở 2 tên vì dòng này bị `truncate` trong
 * giao diện — cùng cách `office.run()` nói "Đang đọc tài liệu X, Y…".
 */
export function readingNote(paths: readonly string[]): string {
  // Không có file nào = câu hỏi tra cứu chung (24/08). Dòng trạng thái phải nói
  // ĐÚNG việc đang chạy: "Đang đọc …" cho một lượt tra web là nói dối về một
  // chuyện quan sát được, và người dùng sẽ đi tìm cái file không tồn tại đó.
  if (paths.length === 0) return t('cmd.lookingUpWeb');
  const names = paths.map((p) => p.split('/').pop() ?? p);
  const head = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return rest > 0
    ? plural('cmd.readingMore', rest, { names: head })
    : t('cmd.reading', { names: head });
}
