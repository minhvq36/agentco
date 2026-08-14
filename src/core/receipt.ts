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

/** Ép trần CỨNG. Vượt là cắt, không thương lượng. */
export function enforceCap(receipt: ReceiptBody, maxTokens: number): ReceiptBody {
  const out: ReceiptBody = { ...receipt };

  // `say` là thứ người dùng đọc — ưu tiên giữ, nhưng cũng phải có trần
  out.say = truncateToTokens(out.say.replace(/\s+/g, ' ').trim(), Math.floor(maxTokens * 0.25));

  // lessons là thứ dễ phình nhất: model thích viết dài
  out.lessons = out.lessons.slice(0, 2).map((l) => ({
    kind: l.kind,
    text: truncateToTokens(l.text.replace(/\s+/g, ' ').trim(), 60),
  }));

  out.artifacts = out.artifacts.slice(0, 20);
  if (out.blocked_on) out.blocked_on = truncateToTokens(out.blocked_on, 80);

  // vẫn quá thì bỏ lessons trước, vì artifacts và say quan trọng hơn
  if (estimateJsonTokens(out) > maxTokens) out.lessons = [];
  if (estimateJsonTokens(out) > maxTokens) {
    out.say = truncateToTokens(out.say, Math.floor(maxTokens * 0.5));
  }
  return out;
}

/** Prompt cho call sửa lỗi khi worker trả sai định dạng. Cố ý KHÔNG kèm context role — chỉ cần định dạng. */
export function repairPrompt(badText: string, problem: string): string {
  const excerpt = truncateToTokens(badText, 1_500);
  return `The text below was supposed to be a task receipt in JSON, but it is malformed (${problem}).

Convert it into exactly one valid JSON object and output nothing else — no explanation, no code fence:

{"status":"done"|"failed"|"blocked"|"needs_human","say":"<one short sentence>","artifacts":[],"lessons":[],"blocked_on":null}

If the text shows the work failed, use status "failed" and say so honestly. Do not invent artifact paths.

--- TEXT ---
${excerpt}`;
}

// ─────────────────────────────────────────────────────────── helpers

function normalize(r: ReceiptBody): ReceiptBody {
  return {
    ...r,
    say: r.say.trim(),
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
