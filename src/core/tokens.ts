/**
 * Ước lượng token.
 *
 * CỐ Ý dùng heuristic, không gọi API đếm token: đếm chính xác tốn một round-trip
 * mạng cho mỗi lần kiểm tra ngân sách, mà ta kiểm rất nhiều (mỗi node tri thức,
 * mỗi receipt, mỗi brief). Sai số ±15% là chấp nhận được vì đây chỉ dùng để
 * ÉP TRẦN, không dùng để tính tiền.
 *
 * Số tiền thật luôn lấy từ `usage`/`modelUsage` do API trả về — chính xác tuyệt đối.
 */

/**
 * Tiếng Việt có dấu tốn nhiều token hơn tiếng Anh đáng kể (dấu phụ thường
 * tách thành token riêng). Hệ số ~2.6 char/token cho tiếng Việt so với
 * ~4 char/token cho tiếng Anh. Đếm theo tỉ lệ ký tự ngoài ASCII.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++;
  }
  const ratio = nonAscii / text.length;
  const charsPerToken = 4 - 1.4 * Math.min(ratio * 2, 1);
  return Math.ceil(text.length / charsPerToken);
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}

/** Cắt text về đúng trần token (ước lượng), thêm dấu hiệu bị cắt. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const marker = '…[cắt]';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (estimateTokens(text.slice(0, mid) + marker) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + marker;
}
