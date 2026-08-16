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
