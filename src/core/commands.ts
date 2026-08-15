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

export type CommandName = 'stop' | 'approve' | 'reject' | 'status' | 'help';

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

/** Câu trả lời cho `/help` và cho lệnh không nhận ra. Tiếng Việt, 0 token. */
export function helpText(unknown?: string): string {
  const lines = COMMANDS.map((c) => `  /${c.aliases[0]}  —  ${c.help}`);
  const head = unknown
    ? `Không có lệnh "/${unknown}". Các lệnh dùng được:`
    : 'Các lệnh dùng được:';
  return `${head}\n${lines.join('\n')}\n\nMuốn nhắn một câu bắt đầu bằng dấu "/" thì gõ hai dấu: //`;
}
