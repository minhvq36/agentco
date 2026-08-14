/**
 * Kế toán token.
 *
 * → docs/SPEC-token-economy.md §5
 *
 * "Không có số đo thì không tối ưu được, và không phát hiện được chết chậm."
 * Dòng quan trọng nhất trong báo cáo là CẢNH BÁO CACHE WRITE BẤT THƯỜNG:
 * cùng một vai trò mà phải ghi cache nhiều lần trong một ca nghĩa là có gì đó
 * đang phá prefix. Đó chính xác là lỗi đã xảy ra với `claude -p`, và là lỗi
 * người dùng sẽ KHÔNG tự nhìn ra nếu không có dòng này.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Paths } from './paths.js';
import type { Usage } from './types.js';

export interface UsageRecord {
  ts: string;
  task_id: string;
  role: string;
  cache_key: string;
  model: string;
  in: number;
  cache_read: number;
  cache_write: number;
  out: number;
  cost_usd: number;
  wall_ms: number;
  /** Số lượt API. Chi phí ≈ turns × prefix × 0.1 — đây là đòn bẩy chính. */
  turns: number;
  status: string;
  reasked: boolean;
}

export function appendUsage(paths: Paths, rec: UsageRecord): void {
  fs.mkdirSync(path.dirname(paths.usageLog), { recursive: true });
  fs.appendFileSync(paths.usageLog, JSON.stringify(rec) + '\n', 'utf8');
}

export function readUsage(paths: Paths, sinceMs?: number): UsageRecord[] {
  if (!fs.existsSync(paths.usageLog)) return [];
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const out: UsageRecord[] = [];
  for (const line of fs.readFileSync(paths.usageLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as UsageRecord;
      if (!cutoff || Date.parse(rec.ts) >= cutoff) out.push(rec);
    } catch {
      /* dòng hỏng thì bỏ qua, không để log hỏng làm sập lệnh cost */
    }
  }
  return out;
}

export interface CostReport {
  tasks: number;
  totals: Usage;
  /** cache_read / (cache_read + in + cache_write). Ngưỡng cảnh báo: 0.70 */
  cacheHitRatio: number;
  p50Tokens: number;
  p95Tokens: number;
  mostExpensive?: { task_id: string; role: string; tokens: number; cost: number };
  /** Vai trò phải ghi cache >1 lần — dấu hiệu prefix đang bị phá. */
  suspiciousCacheWrites: Array<{ role: string; writes: number; keys: number }>;
  reaskCount: number;
  /** Hiệu suất theo vai trò — để so sánh tier model bằng số, không bằng cảm giác. */
  perRole: Array<RolePerf & { role: string }>;
}

export interface RolePerf {
  tasks: number;
  turns: number;
  tokens: number;
  cost: number;
  ms: number;
  model: string;
}

export function summarize(records: UsageRecord[]): CostReport {
  const totals: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUSD: 0,
    model: '',
    turns: 0,
  };
  const perTask: number[] = [];
  let worst: CostReport['mostExpensive'];
  const byRole = new Map<string, { writes: number; keys: Set<string> }>();
  const perRole = new Map<string, RolePerf>();
  let reaskCount = 0;

  for (const r of records) {
    totals.input += r.in;
    totals.output += r.out;
    totals.cacheRead += r.cache_read;
    totals.cacheWrite += r.cache_write;
    totals.costUSD += r.cost_usd;
    totals.turns += r.turns ?? 0;
    if (r.reasked) reaskCount++;

    const byR = perRole.get(r.role) ?? { tasks: 0, turns: 0, tokens: 0, cost: 0, ms: 0, model: r.model };
    byR.tasks++;
    byR.turns += r.turns ?? 0;
    byR.tokens += r.in + r.cache_read + r.cache_write + r.out;
    byR.cost += r.cost_usd;
    byR.ms += r.wall_ms;
    perRole.set(r.role, byR);

    const tokens = r.in + r.cache_read + r.cache_write + r.out;
    perTask.push(tokens);
    if (!worst || tokens > worst.tokens) {
      worst = { task_id: r.task_id, role: r.role, tokens, cost: r.cost_usd };
    }

    if (r.cache_write > 0) {
      const e = byRole.get(r.role) ?? { writes: 0, keys: new Set<string>() };
      e.writes++;
      e.keys.add(r.cache_key);
      byRole.set(r.role, e);
    }
  }

  perTask.sort((a, b) => a - b);
  const denominator = totals.cacheRead + totals.input + totals.cacheWrite;

  const report: CostReport = {
    tasks: records.length,
    totals,
    cacheHitRatio: denominator > 0 ? totals.cacheRead / denominator : 0,
    p50Tokens: percentile(perTask, 0.5),
    p95Tokens: percentile(perTask, 0.95),
    // Ghi cache nhiều lần cho CÙNG một cacheKey = prefix đang bị phá đâu đó.
    // Nhiều key khác nhau thì chỉ là có nhiều biến thể role, không đáng lo.
    suspiciousCacheWrites: [...byRole.entries()]
      .filter(([, v]) => v.writes > v.keys.size + 1)
      .map(([role, v]) => ({ role, writes: v.writes, keys: v.keys.size }))
      .sort((a, b) => b.writes - a.writes),
    reaskCount,
    perRole: [...perRole.entries()]
      .map(([role, v]) => ({ role, ...v }))
      .sort((a, b) => b.cost - a.cost),
  };
  if (worst) report.mostExpensive = worst;
  return report;
}

export function formatReport(r: CostReport, title = 'Ca làm việc'): string {
  if (r.tasks === 0) return 'Chưa có việc nào được ghi nhận.';

  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(x));
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push(`${title.padEnd(28)} ${r.tasks} việc`);
  lines.push(
    `${'Tổng token'.padEnd(28)} vào ${n(r.totals.input)} · đọc-cache ${n(r.totals.cacheRead)} · ` +
      `ghi-cache ${n(r.totals.cacheWrite)} · ra ${n(r.totals.output)}`,
  );
  lines.push(`${'Chi phí'.padEnd(28)} $${r.totals.costUSD.toFixed(4)}`);

  const ok = r.cacheHitRatio >= 0.7;
  lines.push(
    `${'Tỉ lệ dùng lại cache'.padEnd(28)} ${pct(r.cacheHitRatio)}  ${ok ? '✓' : '✗ dưới ngưỡng 70% — prefix đang bị phá'}`,
  );
  lines.push(`${'Token/việc (p50 / p95)'.padEnd(28)} ${n(r.p50Tokens)} / ${n(r.p95Tokens)}`);

  if (r.perRole.length) {
    lines.push('');
    lines.push(`  ${'vai trò'.padEnd(12)} ${'model'.padEnd(12)} ${'việc'.padStart(5)} ${'lượt/việc'.padStart(10)} ${'token/việc'.padStart(11)} ${'giây/việc'.padStart(10)} ${'$/việc'.padStart(9)}`);
    for (const p of r.perRole) {
      lines.push(
        `  ${p.role.padEnd(12)} ${p.model.replace(/claude-|-\d{8}/g, '').padEnd(12)} ${String(p.tasks).padStart(5)} ` +
          `${(p.turns / p.tasks).toFixed(1).padStart(10)} ${n(Math.round(p.tokens / p.tasks)).padStart(11)} ` +
          `${(p.ms / p.tasks / 1000).toFixed(1).padStart(10)} ${('$' + (p.cost / p.tasks).toFixed(4)).padStart(9)}`,
      );
    }
    lines.push('');
  }

  if (r.mostExpensive) {
    lines.push(
      `${'Tốn nhất'.padEnd(28)} ${r.mostExpensive.task_id} (${r.mostExpensive.role}) ` +
        `${n(r.mostExpensive.tokens)} · $${r.mostExpensive.cost.toFixed(4)}`,
    );
  }
  if (r.reaskCount > 0) {
    lines.push(
      `${'Phải hỏi lại định dạng'.padEnd(28)} ${r.reaskCount} lần  ⚠ tốn thêm — xem lại prompt của vai trò đó`,
    );
  }
  for (const s of r.suspiciousCacheWrites) {
    lines.push(
      `${'⚠ Ghi cache bất thường'.padEnd(28)} vai trò "${s.role}": ${s.writes} lần ghi cho ${s.keys} khoá — ` +
        `có ai đang sửa role/tri thức giữa ca?`,
    );
  }
  return lines.join('\n');
}

/** Chi phí của ĐÚNG ca vừa chạy. Khác `formatReport` — cái kia là tích luỹ cả đời công ty. */
export function formatRunUsage(u: Usage, tasks: number): string {
  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(x));
  const denominator = u.cacheRead + u.input + u.cacheWrite;
  const ratio = denominator > 0 ? u.cacheRead / denominator : 0;
  return (
    `Ca này: ${tasks} việc · $${u.costUSD.toFixed(4)} · ` +
    `vào ${n(u.input)} · đọc-cache ${n(u.cacheRead)} · ghi-cache ${n(u.cacheWrite)} · ra ${n(u.output)} · ` +
    `dùng lại cache ${(ratio * 100).toFixed(0)}%`
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] ?? 0;
}
