/**
 * NHẬT KÝ KIỂM TOÁN CHO CÁNH TAY — mọi lời gọi MCP, **kèm tham số**.
 * → docs/SPEC-arms.md §6k
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO NÓ TỒN TẠI, và ca thật đã chứng minh nó không phải chuyện lý thuyết│
 * │                                                                          │
 * │ Ca 26/08: một lượt chạy chạm `max_turns` GIỮA CHỪNG. Nhật ký cho thấy nó  │
 * │ đã gọi `notion-update-page` (một lời gọi GHI) trước khi bị cắt, nhưng báo │
 * │ cáo cuối nói *"chưa xoá được"*. Với file trong văn phòng thì câu đó vô     │
 * │ hại; với **Notion của người dùng** thì nó sai về THẾ GIỚI BÊN NGOÀI.      │
 * │                                                                          │
 * │ Và ta **không tra lại được** nó đã ghi gì — nhật ký cũ chỉ giữ `calls[0]` │
 * │ mỗi lượt, không giữ tham số. Nên câu hỏi *"hôm qua nó đã ghi gì vào       │
 * │ Notion của tôi"* là câu **không trả lời được**, ở đúng nơi hậu quả nằm    │
 * │ ngoài tầm với của ta.                                                    │
 * │                                                                          │
 * │ ⚠ Đây là thứ THAY cho cổng duyệt từng lần, không phải bổ sung cho nó.    │
 * │ User chốt 25/08 bỏ tầng 2 (*"mỗi mcp cắm cho nó chính là sandbox, cùng    │
 * │ lắm thì có log"*). Bỏ cổng thì log **phải đủ**, nếu không ta vừa bỏ cả    │
 * │ hai. → §6k                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ghi vào `.state/mcp-audit.jsonl` của TỪNG văn phòng — cùng chỗ, cùng luật với
 * `chat.jsonl`. Không nằm ở cấp công ty: câu hỏi luôn là *"văn phòng này đã làm
 * gì"*, và gộp mọi văn phòng vào một file là bắt người đọc tự lọc.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ArmCall {
  /** ISO. Thứ tự trong file đã là thứ tự thời gian, nhưng dòng phải TỰ ĐỌC ĐƯỢC. */
  ts: string;
  /** Băm cánh tay. Giao diện tra ra nhãn — băm không bao giờ lên màn hình. */
  server: string;
  /** Tên việc, đã bỏ tiền tố `mcp__<server>__`. */
  tool: string;
  /** Ai gọi. `''` = không rõ (không nên xảy ra, nhưng đừng bịa). */
  role: string;
  plan_id?: string;
  task_id?: string;
  /**
   * THAM SỐ — đây là **toàn bộ lý do** file này tồn tại.
   *
   * ⚠ Ghi tham số là ghi NỘI DUNG người dùng (đoạn văn sắp dán vào Notion, tên
   * file sắp đọc). Đó là chủ ý: không có nó thì dòng log chỉ nói *"đã gọi
   * update_page"*, tức đúng bằng thứ ta đã có và đã thấy là không đủ.
   */
  args: string;
  /** Tham số bị cắt bớt vì quá dài — nói ra, đừng để người đọc tưởng đó là tất cả. */
  truncated?: boolean;
}

/**
 * Trần một dòng. Rộng tay có chủ ý — một đoạn văn dán vào Notion dài hơn hẳn
 * một đường dẫn file, và cắt nó đi là làm mất đúng thứ ta cần khi đi truy.
 */
const MAX_ARGS = 2_000;

/**
 * Trần số dòng giữ lại. `chat.jsonl` không có trần; file này thì cần, vì nó ghi
 * MỖI LỜI GỌI chứ không phải mỗi lượt trò chuyện — một ca chạm 20 trang Notion
 * sinh 20 dòng, và một văn phòng chạy vài tháng thì file phình không có đáy.
 */
const MAX_LINES = 2_000;

export class AuditLog {
  constructor(private stateDir: string) {}

  rebind(stateDir: string): void {
    this.stateDir = stateDir;
  }

  private file(): string {
    return path.join(this.stateDir, 'mcp-audit.jsonl');
  }

  /**
   * Ghi một lời gọi. **KHÔNG BAO GIỜ được ném** — nó chạy giữa một ca đang làm
   * việc, và làm hỏng một ca vì không ghi được nhật ký là đổi một mất mát nhỏ
   * lấy một mất mát lớn. Cùng luật với `appendChat`.
   */
  append(call: Omit<ArmCall, 'ts' | 'args'> & { args: unknown }): void {
    try {
      let args = JSON.stringify(call.args ?? {});
      const truncated = args.length > MAX_ARGS;
      if (truncated) args = `${args.slice(0, MAX_ARGS)}…`;
      const line: ArmCall = {
        ts: new Date().toISOString(),
        server: call.server,
        tool: call.tool,
        role: call.role,
        ...(call.plan_id ? { plan_id: call.plan_id } : {}),
        ...(call.task_id ? { task_id: call.task_id } : {}),
        args,
        ...(truncated ? { truncated: true } : {}),
      };
      fs.mkdirSync(this.stateDir, { recursive: true });
      fs.appendFileSync(this.file(), `${JSON.stringify(line)}\n`, 'utf8');
    } catch {
      /* Không ghi được nhật ký KHÔNG được làm hỏng ca đang chạy. */
    }
  }

  /**
   * Đọc, MỚI NHẤT LÊN ĐẦU. `server` để lọc theo một cánh tay.
   *
   * ⚠ Dòng hỏng thì BỎ QUA dòng đó, không bỏ cả file: một lần ghi bị cắt giữa
   * chừng (daemon chết) không được xoá sổ lịch sử của mọi lời gọi trước nó.
   */
  list(opts: { server?: string; limit?: number } = {}): ArmCall[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file(), 'utf8');
    } catch {
      return [];
    }
    const out: ArmCall[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as ArmCall;
        if (opts.server && rec.server !== opts.server) continue;
        out.push(rec);
      } catch {
        /* dòng hỏng — bỏ qua đúng dòng đó */
      }
    }
    out.reverse();
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /**
   * Cắt bớt phần cũ khi file vượt trần. Gọi sau mỗi ca, không phải sau mỗi dòng:
   * đọc-ghi cả file cho từng lời gọi là biến một `appendFileSync` thành O(n²).
   */
  trim(): void {
    try {
      const lines = fs.readFileSync(this.file(), 'utf8').split('\n').filter((l) => l.trim());
      if (lines.length <= MAX_LINES) return;
      fs.writeFileSync(this.file(), `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
    } catch {
      /* không dọn được thì thôi — file to hơn mong muốn vẫn tốt hơn mất log */
    }
  }
}

/** `mcp__<server>__<tool>` → hai mảnh. `undefined` = không phải lời gọi MCP. */
export function splitArmTool(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice('mcp__'.length);
  const cut = rest.indexOf('__');
  // `mcp__files` (cấp cả server, không có tên việc) vẫn là một lời gọi hợp lệ
  // ở dạng khai báo quyền, nhưng KHÔNG bao giờ là tên một lời gọi thật.
  if (cut < 0) return undefined;
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) };
}
