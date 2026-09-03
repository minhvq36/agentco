/**
 * Token estimation.
 *
 * A heuristic ON PURPOSE, not an API token count: counting exactly costs one
 * network round-trip per budget check, and we check constantly — every knowledge
 * node, every receipt, every brief. A ±15% error is fine because this is only
 * ever used to ENFORCE A CEILING, never to compute money.
 *
 * Real money always comes from the `usage`/`modelUsage` the API returns, which
 * is exact.
 */

/**
 * Accented Vietnamese costs noticeably more tokens than English — the diacritics
 * usually split into tokens of their own. Roughly 2.6 chars/token for Vietnamese
 * against ~4 for English. Interpolate on the ratio of non-ASCII characters.
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

/** Trim text down to a token ceiling (estimated), leaving a visible cut marker. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const marker = '…[cut]';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (estimateTokens(text.slice(0, mid) + marker) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + marker;
}
