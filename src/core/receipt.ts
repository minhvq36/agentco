/**
 * Giao thức Receipt — hợp đồng cốt lõi giữa worker và master.
 *
 * → docs/SPEC-2026-08-14-agentco.md §4
 *
 * BẤT BIẾN: không một byte transcript thô nào của worker được đi vào context
 * của master. Master chỉ thấy đúng object này, trần 800 token.
 *
 * Cùng một cơ chế phục vụ CẢ HAI mục tiêu: tiết kiệm token, và UX
 * "đơn giản mặc định, advanced khi cần" — vì `say` do worker sinh sẵn,
 * không tốn thêm call LLM nào để dịch cho thân thiện.
 */

import { ReceiptSchema, type ReceiptBody } from './types.js';
import { estimateJsonTokens, truncateToTokens } from './tokens.js';

export interface ParseResult {
  ok: boolean;
  receipt?: ReceiptBody;
  /** Lý do parse hỏng, dùng làm prompt sửa lỗi. */
  problem?: string;
}

/**
 * Rút JSON receipt ra khỏi văn bản cuối của worker.
 * Thử nhiều chiến lược trước khi bỏ cuộc — mỗi lần bỏ cuộc là một call sửa lỗi tốn tiền.
 */
export function parseReceipt(text: string): ParseResult {
  const candidates: string[] = [];

  // 1. khối ```json ... ``` — lấy khối CUỐI (model hay ví dụ trước rồi mới thật)
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)];
  for (const m of fenced.reverse()) if (m[1]) candidates.push(m[1]);

  // 2. object JSON cân bằng ngoặc cuối cùng trong text
  const braced = lastBalancedObject(text);
  if (braced) candidates.push(braced);

  // 3. toàn bộ text
  candidates.push(text);

  for (const raw of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const parsed = ReceiptSchema.safeParse(value);
    if (parsed.success) return { ok: true, receipt: normalize(parsed.data) };
    // JSON hợp lệ nhưng sai schema — giữ lại lý do, có thể sửa được
    return {
      ok: false,
      problem: parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`).join('; '),
    };
  }

  return { ok: false, problem: 'không tìm thấy object JSON nào trong câu trả lời cuối' };
}

/**
 * Trần cho `answer` — TÍNH RIÊNG, không nằm trong `receipt_tokens`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TÁCH TRẦN, KHÔNG NỚI TRẦN CŨ.                                     │
 * │                                                                          │
 * │ `receipt_tokens` (mặc định 800) tồn tại để bảo vệ NGỮ CẢNH TRỢ LÝ. Mà    │
 * │ `answer` KHÔNG BAO GIỜ đi vào đó — nó bay thẳng ra chat cho người dùng   │
 * │ (`office.ts`). Nới trần cũ để chứa nó là nới đúng cái trần đang bảo vệ   │
 * │ thứ không cần bảo vệ, và đồng thời làm `say` (thứ THẬT SỰ vào ngữ cảnh   │
 * │ Trợ lý) được phép phình theo. Hai đường đời khác nhau thì hai cái trần.  │
 * │                                                                          │
 * │ ~450 token ≈ 300 từ tiếng Việt: vừa một bong bóng chat, vừa một tin      │
 * │ Telegram, và đủ dài cho một câu trả lời chính sách có dẫn điều kiện.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const ANSWER_TOKENS = 450;

/**
 * Trần cho `gist` — NẰM TRONG `receipt_tokens`, ngược hẳn `ANSWER_TOKENS`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Phép chia trần ở file này chỉ hỏi đúng một câu: **thứ này có đi vào ngữ   │
 * │ cảnh Trợ lý không?** `answer` KHÔNG ⇒ tách trần riêng. `gist` **CÓ** ⇒ nó │
 * │ phải cạnh tranh chỗ với `say` và `lessons`, không được miễn trừ.          │
 * │                                                                          │
 * │ ⚠ Và nó vào ngữ cảnh Trợ lý **mỗi lượt report**, rồi đi qua nén trí nhớ — │
 * │ tức nó là một hoá đơn LẶP LẠI, cùng lớp với `hint`. User chốt 30/08:      │
 * │ *"chấp nhận prefix, và gist đừng có quá bự để cả worker và assistant cùng │
 * │ mệt mỏi"*. 120 token ≈ 80 từ tiếng Việt: đủ ba câu hoặc bốn gạch đầu      │
 * │ dòng, và **không đủ** để lén trở thành một câu trả lời đầy đủ.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const GIST_TOKENS = 120;

/** Ép trần CỨNG. Vượt là cắt, không thương lượng. */
export function enforceCap(receipt: ReceiptBody, maxTokens: number): ReceiptBody {
  const out: ReceiptBody = { ...receipt };

  // `say` là thứ người dùng đọc — ưu tiên giữ, nhưng cũng phải có trần
  out.say = truncateToTokens(out.say.replace(/\s+/g, ' ').trim(), Math.floor(maxTokens * 0.25));

  /**
   * ⚠ KHÔNG gom khoảng trắng — cùng lý do `answer`: gạch đầu dòng là một phần
   * của nội dung, và user đã nói thẳng *"đôi khi là gạch đầu dòng từng ý"*.
   */
  out.gist = truncateToTokens(out.gist.trim(), GIST_TOKENS);

  /**
   * `answer` được cắt TRƯỚC, rồi TÁCH RA khỏi phép đo `estimateJsonTokens`.
   *
   * Để nó trong phép đo thì một câu trả lời dài sẽ đẩy `lessons` và `say` ra
   * ngoài trần — tức là câu trả lời cho khách đi ăn cắp chỗ của receipt, trong
   * khi hai thứ đó chạy trên hai đường hoàn toàn khác nhau.
   *
   * ⚠ KHÔNG gom khoảng trắng như `say`: đây là văn bản người đọc, xuống dòng
   * và gạch đầu dòng là một phần của nội dung. `say` thì gom được vì nó là một
   * câu duy nhất chạy trong dòng trạng thái.
   */
  const answer = truncateToTokens(out.answer.trim(), ANSWER_TOKENS);

  // lessons là thứ dễ phình nhất: model thích viết dài
  out.lessons = out.lessons.slice(0, 2).map((l) => ({
    kind: l.kind,
    text: truncateToTokens(l.text.replace(/\s+/g, ' ').trim(), 60),
  }));

  out.artifacts = out.artifacts.slice(0, 20);
  if (out.blocked_on) out.blocked_on = truncateToTokens(out.blocked_on, 80);

  // Đo phần ĐI VÀO NGỮ CẢNH TRỢ LÝ. `answer` không thuộc phần đó; `gist` thì CÓ.
  const measured = { ...out, answer: '' };
  /**
   * Thứ tự hy sinh — hỏi *"mất cái này thì mất gì"*, không hỏi cái nào to nhất:
   *
   *   ① lessons — hy sinh trước, vì bài học chỉ đáng giá ở lượt SAU, còn hai
   *      thứ dưới đây là thứ người dùng đọc ngay bây giờ.
   *   ② gist    — cắt bớt, không bỏ hẳn: một tóm tắt ngắn hơn vẫn dùng được,
   *      trong khi rỗng thì Trợ lý mất sạch sự kiện và lại phải bảo "mở file".
   *   ③ say     — chạm cuối cùng. Nó là dòng trạng thái, mất nó là màn hình câm.
   */
  if (estimateJsonTokens(measured) > maxTokens) measured.lessons = out.lessons = [];
  if (estimateJsonTokens(measured) > maxTokens) {
    measured.gist = out.gist = truncateToTokens(out.gist, Math.floor(GIST_TOKENS / 2));
  }
  if (estimateJsonTokens(measured) > maxTokens) {
    out.say = truncateToTokens(out.say, Math.floor(maxTokens * 0.5));
  }

  out.answer = answer;
  return out;
}

/** Prompt cho call sửa lỗi khi worker trả sai định dạng. Cố ý KHÔNG kèm context role — chỉ cần định dạng. */
export function repairPrompt(badText: string, problem: string): string {
  const excerpt = truncateToTokens(badText, 1_500);
  return `The text below was supposed to be a task receipt in JSON, but it is malformed (${problem}).

Convert it into exactly one valid JSON object and output nothing else — no explanation, no code fence:

{"status":"done"|"failed"|"blocked"|"needs_human","say":"<one short sentence>","gist":"<key facts, or empty>","artifacts":[],"lessons":[],"blocked_on":null}

If the text shows the work failed, use status "failed" and say so honestly. Do not invent artifact paths.

--- TEXT ---
${excerpt}`;
}

// ─────────────────────────────────────────────────────────── helpers

function normalize(r: ReceiptBody): ReceiptBody {
  return {
    ...r,
    say: r.say.trim(),
    answer: r.answer.trim(),
    gist: r.gist.trim(),
    // đường dẫn từ LLM: chuẩn hoá dấu gạch, bỏ ./ đầu, bỏ trùng
    artifacts: [...new Set(r.artifacts.map((a) => a.trim().replace(/\\/g, '/').replace(/^\.\//, '')))].filter(Boolean),
  };
}

function lastBalancedObject(text: string): string | undefined {
  const end = text.lastIndexOf('}');
  if (end === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i--) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return undefined;
}
