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

import type { CompanyPaths } from './paths.js';
import type { Usage } from './types.js';
import { t } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';

export interface UsageRecord {
  ts: string;
  /** Văn phòng nào tiêu. Sổ chi phí ở cấp công ty — một hoá đơn Claude một sổ. */
  office: string;
  /** Việc nào tiêu. Để trả lời "việc đó tốn bao nhiêu" mà không đọc lại log. */
  plan_id: string;
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

export function appendUsage(paths: CompanyPaths, rec: UsageRecord): void {
  fs.mkdirSync(path.dirname(paths.usageLog), { recursive: true });
  fs.appendFileSync(paths.usageLog, JSON.stringify(rec) + '\n', 'utf8');
}

/**
 * Bản ghi ĐỔI TÊN văn phòng — nối vào cuối sổ, KHÔNG sửa dòng nào.
 * → `Company.moveOffice`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SỔ CHI PHÍ LÀ APPEND-ONLY, VÀ ĐÓ LÀ THỨ LÀM NÓ ĐÁNG TIN.                │
 * │                                                                          │
 * │ Đổi tên thư mục `bao-cao` → `kiem-ke` làm mồ côi 315 dòng mang           │
 * │ `office: "bao-cao"` (sổ nằm ở cấp CÔNG TY nên không đi theo thư mục).    │
 * │ Cách hiển nhiên là đi sửa lại 315 dòng đó — và đó chính là cách phá cuốn │
 * │ sổ: một cuốn sổ sửa được thì hết là bằng chứng.                          │
 * │                                                                          │
 * │ Thay vào đó nối MỘT dòng nói *"từ giờ `bao-cao` chính là `kiem-ke`"*.    │
 * │ Lịch sử còn nguyên chữ nào chữ nấy, và ai đọc sổ thì đi theo chuỗi alias │
 * │ để gộp. Đổi tên ba lần thì có ba dòng, chuỗi vẫn nối được.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface RenameRecord {
  ts: string;
  kind: 'office.renamed';
  from: string;
  to: string;
}

export function appendRename(paths: CompanyPaths, from: string, to: string): void {
  fs.mkdirSync(path.dirname(paths.usageLog), { recursive: true });
  const rec: RenameRecord = { ts: new Date().toISOString(), kind: 'office.renamed', from, to };
  fs.appendFileSync(paths.usageLog, JSON.stringify(rec) + '\n', 'utf8');
}

/**
 * Bản ghi XOÁ SỔ — *"tiền của `<office>` tiêu trước `<until>` thôi được tính"*.
 * → `Company.removeOffice` · `Company.purgeGoneUsage`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO LÀ MỘT DÒNG NỐI THÊM, KHÔNG PHẢI XOÁ DÒNG.                        │
 * │                                                                          │
 * │ Cùng lý lẽ với `appendRename`: một cuốn sổ sửa được thì hết là bằng      │
 * │ chứng. Người dùng muốn *"xoá là xoá hết"* — thứ họ muốn mất là **con số  │
 * │ hiện trên màn hình và số dư mang sang văn phòng sau**, không phải mấy    │
 * │ dòng JSON trên đĩa mà họ không đọc. Cắt lúc ĐỌC cho họ đúng thứ đó, và   │
 * │ vẫn còn một đường lần ra tiền đã đi đâu khi có tranh cãi về hoá đơn.     │
 * │                                                                          │
 * │ ⚠ Nên đây KHÔNG phải cơ chế xoá dữ liệu vì riêng tư. Muốn phi tang thật  │
 * │ thì phải nén lại file — một cơ chế khác, và chưa có.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `until` là MỐC THỜI GIAN chứ không phải một cờ "office này chết rồi", và đó
 * là toàn bộ bản vá cho bug tái sinh: xoá "Nội dung" rồi lập lại "Nội dung"
 * cho ra **đúng id cũ** (`folderId` suy từ tên), nên nếu cắt theo id thì văn
 * phòng mới hoặc thừa kế sổ của người chết, hoặc không bao giờ ghi được sổ.
 * Cắt theo mốc thì dòng trước mốc là của đời trước, sau mốc là của đời này.
 */
export interface PurgeRecord {
  ts: string;
  kind: 'office.purged';
  office: string;
  until: string;
}

export function appendPurge(paths: CompanyPaths, office: string, until = new Date()): void {
  fs.mkdirSync(path.dirname(paths.usageLog), { recursive: true });
  const rec: PurgeRecord = {
    ts: new Date().toISOString(),
    kind: 'office.purged',
    office,
    until: until.toISOString(),
  };
  fs.appendFileSync(paths.usageLog, JSON.stringify(rec) + '\n', 'utf8');
}

/** Đọc sổ đúng MỘT lần, tách sẵn ba thứ mọi người đọc sổ đều cần. */
function scan(paths: CompanyPaths): {
  rows: Array<UsageRecord & { kind?: string }>;
  chain: Map<string, string>;
  cuts: Map<string, number>;
} {
  const rows: Array<UsageRecord & { kind?: string }> = [];
  const chain = new Map<string, string>();
  const cuts = new Map<string, number>();
  if (!fs.existsSync(paths.usageLog)) return { rows, chain, cuts };

  for (const line of fs.readFileSync(paths.usageLog, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      /*
        Đọc bằng một kiểu GỘP các trường có thể có, không phải
        `Partial<RenameRecord & PurgeRecord>`: hai bản ghi kia có `kind` là hai
        chuỗi literal khác nhau, nên giao chúng lại cho ra `never` và cả khối
        này thành không đọc được trường nào.
      */
      const r = JSON.parse(line) as UsageRecord & {
        kind?: string;
        from?: string;
        to?: string;
        until?: string;
      };
      if (r.kind === 'office.renamed') {
        if (!r.from || !r.to) continue;
        // Trỏ lại MỌI mắt xích cũ về đích mới, nên không ai phải lần chuỗi lúc đọc.
        for (const [k, v] of chain) if (v === r.from) chain.set(k, r.to);
        chain.set(r.from, r.to);
        continue;
      }
      if (r.kind === 'office.purged') {
        // `office` rỗng là hợp lệ: đó là khối bản ghi v0 (trước khi có văn phòng).
        if (typeof r.office !== 'string' || !r.until) continue;
        const at = Date.parse(r.until);
        if (Number.isNaN(at)) continue;
        cuts.set(r.office, Math.max(cuts.get(r.office) ?? 0, at));
        continue;
      }
      rows.push(r);
    } catch {
      /* dòng hỏng thì bỏ qua, không để log hỏng làm sập lệnh cost */
    }
  }
  return { rows, chain, cuts };
}

/**
 * Bảng `id cũ → id hiện tại`, đã đi hết chuỗi. Đổi tên nhiều lần
 * (`a → b → c`) thì cả `a` lẫn `b` đều trỏ tới `c`.
 */
export function renameChain(paths: CompanyPaths): Map<string, string> {
  return scan(paths).chain;
}

/** `id văn phòng → mốc (ms)`. Dòng của id đó có `ts` ≤ mốc thì thôi được tính. */
export function purgeCuts(paths: CompanyPaths): Map<string, number> {
  return scan(paths).cuts;
}

export function readUsage(paths: CompanyPaths, sinceMs?: number): UsageRecord[] {
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const { rows, chain, cuts } = scan(paths);
  const out: UsageRecord[] = [];

  for (const rec of rows) {
    /**
     * ⚠ Sổ chứa BA loại dòng. `appendRename`/`appendPurge` nối vào cùng file
     * (chúng phải nằm cùng chỗ để thứ tự thời gian có nghĩa), nhưng chúng
     * KHÔNG phải một lượt chạy: không `cost_usd`, không `turns`. Lọt vào đây
     * là `tasks` đếm dư và tổng tiền thành `NaN` — một cuốn sổ nói dối.
     * (`scan` đã lọc, dòng này là lưới thứ hai cho định dạng lạ về sau.)
     */
    if (rec.kind) continue;
    const at = Date.parse(rec.ts);
    if (cutoff && !(at >= cutoff)) continue;

    /**
     * Đối chiếu mốc xoá theo CẢ HAI danh tính — id ghi trong dòng, và id sau
     * khi đi hết chuỗi đổi tên.
     *
     * Chỉ so một trong hai là hở, và hở im lặng:
     *  · chỉ so id thô  ⇒ đổi tên `a→b` rồi xoá `b`: dòng mang `a`, mốc ở `b`.
     *  · chỉ so id giải ⇒ xoá `a`, lập lại `a`, đổi tên `a→c`: dòng đời trước
     *    mang `a` nay giải ra `c` ⇒ tiền người chết chảy sang văn phòng sống.
     */
    const raw = rec.office ?? '';
    const resolved = chain.get(raw) ?? raw;
    const cut = Math.max(cuts.get(raw) ?? 0, cuts.get(resolved) ?? 0);
    if (cut && at <= cut) continue;

    out.push(rec);
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

/**
 * ⚠ `padEnd(28)` COUNTS CODE UNITS, and a translated label does not have the
 * same length as the one it replaces. That is deliberate and harmless here: the
 * column only has to look straight, and every label in both catalogues is
 * plain Latin text under 28 columns. Put a label with a combining mark or an
 * emoji in the left column and this alignment silently goes wrong — that is the
 * failure mode `scripts/fix-comment-boxes.ts` exists for, in another place.
 */
export function formatReport(r: CostReport, title = t('cost.shift')): string {
  if (r.tasks === 0) return t('cost.nothingYet');

  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(x));
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push(`${title.padEnd(28)} ${t('cost.tasks', { n: String(r.tasks) })}`);
  lines.push(
    `${t('cost.totalTokens').padEnd(28)} ` +
      t('cost.tokenBreakdown', {
        input: n(r.totals.input),
        cacheRead: n(r.totals.cacheRead),
        cacheWrite: n(r.totals.cacheWrite),
        output: n(r.totals.output),
      }),
  );
  lines.push(`${t('cost.spend').padEnd(28)} ${formatUSD(r.totals.costUSD)}`);

  const ok = r.cacheHitRatio >= 0.7;
  lines.push(
    `${t('cost.cacheReuse').padEnd(28)} ${pct(r.cacheHitRatio)}  ${ok ? '✓' : `✗ ${t('cost.cacheBelow')}`}`,
  );
  lines.push(`${t('cost.tokensPerTask').padEnd(28)} ${n(r.p50Tokens)} / ${n(r.p95Tokens)}`);

  if (r.perRole.length) {
    lines.push('');
    lines.push(
      `  ${t('cost.colRole').padEnd(12)} ${t('cost.colModel').padEnd(12)} ${t('cost.colTasks').padStart(5)} ` +
        `${t('cost.colTurns').padStart(10)} ${t('cost.colTokens').padStart(11)} ${t('cost.colSeconds').padStart(10)} ` +
        `${t('cost.colCost').padStart(9)}`,
    );
    for (const p of r.perRole) {
      lines.push(
        `  ${p.role.padEnd(12)} ${p.model.replace(/claude-|-\d{8}/g, '').padEnd(12)} ${String(p.tasks).padStart(5)} ` +
          `${(p.turns / p.tasks).toFixed(1).padStart(10)} ${n(Math.round(p.tokens / p.tasks)).padStart(11)} ` +
          `${(p.ms / p.tasks / 1000).toFixed(1).padStart(10)} ${formatUSD(p.cost / p.tasks).padStart(9)}`,
      );
    }
    lines.push('');
  }

  if (r.mostExpensive) {
    lines.push(
      `${t('cost.priciest').padEnd(28)} ${r.mostExpensive.task_id} (${r.mostExpensive.role}) ` +
        `${n(r.mostExpensive.tokens)} · ${formatUSD(r.mostExpensive.cost)}`,
    );
  }
  if (r.reaskCount > 0) {
    lines.push(`${t('cost.reask').padEnd(28)} ${t('cost.reaskDetail', { n: String(r.reaskCount) })}`);
  }
  for (const s of r.suspiciousCacheWrites) {
    lines.push(
      `${t('cost.oddCacheWrites').padEnd(28)} ` +
        t('cost.oddCacheDetail', { role: s.role, writes: String(s.writes), keys: String(s.keys) }),
    );
  }
  return lines.join('\n');
}

/** Chi phí của ĐÚNG ca vừa chạy. Khác `formatReport` — cái kia là tích luỹ cả đời công ty. */
export function formatRunUsage(u: Usage, tasks: number): string {
  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}K` : String(x));
  const denominator = u.cacheRead + u.input + u.cacheWrite;
  const ratio = denominator > 0 ? u.cacheRead / denominator : 0;
  return t('cost.runLine', {
    tasks: String(tasks),
    cost: formatUSD(u.costUSD),
    breakdown: t('cost.tokenBreakdown', {
      input: n(u.input),
      cacheRead: n(u.cacheRead),
      cacheWrite: n(u.cacheWrite),
      output: n(u.output),
    }),
    reuse: `${(ratio * 100).toFixed(0)}%`,
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] ?? 0;
}
