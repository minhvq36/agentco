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

export type CommandName = 'stop' | 'approve' | 'reject' | 'status' | 'help' | 'clear';

export interface CommandSpec {
  name: CommandName;
  /** Dạng gõ được, kể cả viết tắt. Tất cả đều tiếng Anh. */
  aliases: readonly string[];
  help: string;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: 'stop', aliases: ['stop', 'cancel', 's'], help: 'Ngắt việc đang chạy' },
  { name: 'approve', aliases: ['approve', 'ok', 'y'], help: 'Duyệt thứ đang chờ bạn' },
  { name: 'reject', aliases: ['reject', 'no', 'n'], help: 'Từ chối thứ đang chờ bạn' },
  { name: 'status', aliases: ['status', 'st'], help: 'Đang chạy gì, đã tốn bao nhiêu' },
  /**
   * Cùng TÊN với `/clear` của Claude Code là có chủ ý: người dùng đã quen phản
   * xạ đó, và ý nghĩa ở đây khớp. Nhưng nó KHÔNG bao giờ đi tới CLI — danh sách
   * trắng ở `parseInput` chặn mọi chuỗi gạch chéo, và ta xử lý bằng code.
   *
   * Khác một điểm quan trọng so với `/clear` của Claude Code: ta NÉN TRƯỚC KHI
   * QUÊN. Bản nén đi vào sổ tay riêng của Trợ lý, đọc lại được ở ngăn Tri thức.
   */
  { name: 'clear', aliases: ['clear'], help: 'Dọn cuộc trò chuyện, cất những gì đã chốt vào sổ tay' },
  { name: 'help', aliases: ['help', 'h', '?'], help: 'Xem danh sách lệnh này' },
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
 * Câu trả lời cho `/help` và cho lệnh không nhận ra. Tiếng Việt, 0 token.
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
    const alias = short.length ? `   (hoặc ${short.map((a) => `/${a}`).join(', ')})` : '';
    return `/${c.aliases[0]}${alias}\n    ${c.help}`;
  });

  const head = unknown
    ? `Không có lệnh "/${unknown}". Các lệnh dùng được:`
    : 'Các lệnh dùng được:';

  return `${head}\n\n${blocks.join('\n\n')}\n\nMuốn nhắn một câu bắt đầu bằng dấu "/" thì gõ hai dấu: //`;
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
 * ⚠ Regex này chạy trên chữ NGƯỜI DÙNG GÕ, không phải chữ model sinh — khác
 * hẳn luật cấm dò đường dẫn trong `say` (SPEC-artifacts §2.5). Ở đó rủi ro là
 * model bịa ra một đường dẫn nghe rất thật; ở đây người dùng tự chịu trách
 * nhiệm cho thứ họ gõ, VÀ mọi tham chiếu vẫn phải đối chiếu với `known` — danh
 * sách đường dẫn có thật, đọc từ đĩa — trước khi được công nhận.
 *
 * Ba dạng nhận được, và dạng thứ ba là lý do hàm này phải tồn tại:
 *
 *   @artifacts/P-…/T-01/vi/doc-2.md   đường dẫn đủ  → đối chiếu rồi dùng
 *   @library/files/doc-1.md            đường dẫn đủ  → đối chiếu rồi dùng
 *   @doc-1.md                          tên trần      → tra, và CHẶN nếu trùng
 *
 * Tên trần trùng nhau là ca CÓ THẬT và hai kho được phép trùng: tủ tài liệu có
 * `doc-1.md`, ngăn Kết quả cũng có `doc-1.md`. Đoán bừa một bên là làm sai việc
 * của người dùng một cách im lặng — nên hỏi lại, bằng code, 0 token.
 */
export function resolveFileRefs(
  text: string,
  known: readonly string[],
): { text: string; problem?: string } {
  // `@` phải đứng đầu chuỗi hoặc sau khoảng trắng — `ten@mail.com` không phải
  // tham chiếu file. Dừng ở khoảng trắng: tên có dấu cách thì dùng đường dẫn
  // đủ, mà nút Chép vốn luôn cho đường dẫn đủ.
  const found = [...text.matchAll(/(^|\s)@([^\s@]+)/g)];
  if (found.length === 0) return { text };

  let out = text;
  for (const m of found) {
    // Bỏ dấu câu dính đuôi: người ta gõ "sửa @a/b.md, giữ nguyên phần đầu".
    //
    // ⚠ Phần bị bỏ phải được TRẢ LẠI vào câu. Bản đầu thay cả `m[0]` bằng
    // đường dẫn sạch, và dấu phẩy biến mất khỏi câu của người dùng — sửa chữ
    // họ viết mà không nói là chuyện nhỏ ở đây nhưng là một thói quen sai:
    // ta chỉ được phép bóc `@`, không được phép biên tập.
    const typed = m[2]!.replace(/\\/g, '/');
    const tail = /[.,;:)\]}]+$/.exec(typed)?.[0] ?? '';
    const raw = tail ? typed.slice(0, -tail.length) : typed;
    let hit = known.find((p) => p === raw);
    if (!hit) {
      const matches = known.filter((p) => p.split('/').pop() === raw);
      if (matches.length > 1) {
        return {
          text,
          problem:
            `Có ${matches.length} file tên "${raw}", mình không đoán bạn muốn cái nào:\n` +
            matches.map((p) => `  ${p}`).join('\n') +
            `\nDán lại đường dẫn đầy đủ nhé — nút Chép ở ngăn Tủ tài liệu và Kết quả cho đúng chuỗi đó.`,
        };
      }
      hit = matches[0];
    }
    if (!hit) {
      return {
        text,
        problem:
          `Mình không tìm thấy "${raw}" trong tủ tài liệu hay ngăn Kết quả. ` +
          `Kiểm lại tên giúp mình, hoặc dùng nút Chép ở hai ngăn đó để lấy đúng đường dẫn.`,
      };
    }
    // Bỏ `@`, giữ đường dẫn đã xác minh. Model nhận một chuỗi khớp CHÍNH XÁC
    // thứ nó đã thấy trong bảng kê, nên nó chỉ việc chép sang `inputs`.
    out = out.replace(m[0], `${m[1]}${hit}${tail}`);
  }
  return { text: out };
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
  known: readonly string[],
): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];

  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!p) continue;
    const exact = known.find((k) => k === p);
    if (exact) {
      if (!ok.includes(exact)) ok.push(exact);
      continue;
    }
    // Tên trần: chỉ nhận khi có ĐÚNG MỘT ứng viên. Hai file cùng tên ở hai kho
    // thì đoán bừa là đọc nhầm tài liệu rồi trả lời rất thuyết phục — kết cục
    // tệ nhất trong mọi kết cục.
    const byName = known.filter((k) => k.split('/').pop() === p);
    if (byName.length === 1) {
      if (!ok.includes(byName[0]!)) ok.push(byName[0]!);
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
  const names = paths.map((p) => p.split('/').pop() ?? p);
  const head = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return `Đang đọc ${head}${rest > 0 ? ` và ${rest} file nữa` : ''}…`;
}
