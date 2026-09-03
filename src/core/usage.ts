/**
 * Token accounting.
 *
 * → docs/SPEC-token-economy.md §5
 *
 * "Without measurement you cannot optimise, and you cannot detect a slow death."
 * The most important line in the report is the ODD CACHE-WRITE WARNING: one role
 * writing cache several times within a shift means something is breaking the
 * prefix. That is exactly the failure that happened with `claude -p`, and it is
 * one a user will NOT spot on their own without this line.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CompanyPaths } from './paths.js';
import type { Usage } from './types.js';
import { t } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';

export interface UsageRecord {
  ts: string;
  /** Which office spent it. The ledger is company-level — one Claude bill, one ledger. */
  office: string;
  /** Which job spent it. Answers "what did that cost" without re-reading the log. */
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
  /** API turns. Cost ≈ turns × prefix × 0.1 — this is the main lever. */
  turns: number;
  status: string;
  reasked: boolean;
}

export function appendUsage(paths: CompanyPaths, rec: UsageRecord): void {
  fs.mkdirSync(path.dirname(paths.usageLog), { recursive: true });
  fs.appendFileSync(paths.usageLog, JSON.stringify(rec) + '\n', 'utf8');
}

/**
 * An office RENAME record — appended to the ledger, EDITING NOTHING.
 * → `Company.moveOffice`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE LEDGER IS APPEND-ONLY, AND THAT IS WHAT MAKES IT TRUSTWORTHY.        │
 * │                                                                          │
 * │ Renaming the folder `bao-cao` → `kiem-ke` orphans 315 rows carrying      │
 * │ `office: "bao-cao"` (the ledger is COMPANY-level, so it does not travel  │
 * │ with the folder). The obvious move is to go and edit those 315 rows —    │
 * │ and that is precisely how you destroy a ledger: one that can be edited   │
 * │ stops being evidence.                                                    │
 * │                                                                          │
 * │ Instead, append ONE row saying *"from now on `bao-cao` IS `kiem-ke`"*.   │
 * │ History stays word for word, and whoever reads the ledger follows the    │
 * │ alias chain to merge. Rename three times and there are three rows; the   │
 * │ chain still joins up.                                                    │
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
 * A PURGE record — *"money `<office>` spent before `<until>` stops counting"*.
 * → `Company.removeOffice` · `Company.purgeGoneUsage`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY AN APPENDED ROW RATHER THAN DELETED ROWS.                            │
 * │                                                                          │
 * │ Same reasoning as `appendRename`: a ledger that can be edited stops      │
 * │ being evidence. The user wants *"deleted means gone"* — what they want   │
 * │ gone is THE NUMBER ON THE SCREEN and the balance carried into the next   │
 * │ office, not JSON rows on disk they never read. Cutting AT READ TIME      │
 * │ gives them exactly that, and still leaves a trail for where the money    │
 * │ went when a bill is disputed.                                            │
 * │                                                                          │
 * │ ⚠ So this is NOT a privacy deletion mechanism. Genuinely erasing would   │
 * │ mean compacting the file — a different mechanism, and one we do not have.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `until` is A TIMESTAMP, not a "this office is dead" flag, and that is the whole
 * fix for the reincarnation bug: deleting "Content" and creating "Content" again
 * produces THE SAME ID (`folderId` is derived from the name), so cutting by id
 * would make the new office either inherit the dead one's ledger or never be
 * able to write to it at all. Cutting by timestamp means rows before the mark
 * belong to the previous life and rows after it to this one.
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

/** Read the ledger exactly ONCE, splitting out the three things every reader needs. */
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
        Read through a type that UNIONS the possible fields, not
        `Partial<RenameRecord & PurgeRecord>`: those two records have `kind` set
        to two different string literals, so intersecting them yields `never`
        and this whole block can read no field at all.
      */
      const r = JSON.parse(line) as UsageRecord & {
        kind?: string;
        from?: string;
        to?: string;
        until?: string;
      };
      if (r.kind === 'office.renamed') {
        if (!r.from || !r.to) continue;
        // Repoint EVERY earlier link at the new target, so no reader walks a chain.
        for (const [k, v] of chain) if (v === r.from) chain.set(k, r.to);
        chain.set(r.from, r.to);
        continue;
      }
      if (r.kind === 'office.purged') {
        // An empty `office` is valid: that is the v0 block, from before offices existed.
        if (typeof r.office !== 'string' || !r.until) continue;
        const at = Date.parse(r.until);
        if (Number.isNaN(at)) continue;
        cuts.set(r.office, Math.max(cuts.get(r.office) ?? 0, at));
        continue;
      }
      rows.push(r);
    } catch {
      /* skip a corrupt line; a broken log must not take down `cost` */
    }
  }
  return { rows, chain, cuts };
}

/**
 * A map `old id → current id`, chain already walked. Renamed several times
 * (`a → b → c`) and both `a` and `b` point at `c`.
 */
export function renameChain(paths: CompanyPaths): Map<string, string> {
  return scan(paths).chain;
}

/** `office id → cut-off (ms)`. Rows for that id with `ts` ≤ the mark stop counting. */
export function purgeCuts(paths: CompanyPaths): Map<string, number> {
  return scan(paths).cuts;
}

export function readUsage(paths: CompanyPaths, sinceMs?: number): UsageRecord[] {
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const { rows, chain, cuts } = scan(paths);
  const out: UsageRecord[] = [];

  for (const rec of rows) {
    /**
     * ⚠ The ledger holds THREE kinds of row. `appendRename`/`appendPurge` write
     * into the same file (they have to share it for chronological order to
     * mean anything), but they are NOT runs: no `cost_usd`, no `turns`. Letting
     * one through here overcounts `tasks` and turns the total into `NaN` — a
     * ledger that lies. (`scan` already filters; this is a second net for
     * shapes added later.)
     */
    if (rec.kind) continue;
    const at = Date.parse(rec.ts);
    if (cutoff && !(at >= cutoff)) continue;

    /**
     * Check the purge mark against BOTH identities — the id written in the row,
     * and the id after walking the rename chain.
     *
     * Checking only one leaves a hole, and a silent one:
     *  · raw id only      ⇒ rename `a→b` then purge `b`: rows carry `a`, the mark is on `b`.
     *  · resolved id only ⇒ purge `a`, recreate `a`, rename `a→c`: rows from the
     *    previous life carry `a`, which now resolves to `c` ⇒ a dead office's
     *    spending flows into a living one.
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
  /** cache_read / (cache_read + in + cache_write). Warning threshold: 0.70 */
  cacheHitRatio: number;
  p50Tokens: number;
  p95Tokens: number;
  mostExpensive?: { task_id: string; role: string; tokens: number; cost: number };
  /** Roles that wrote cache more than once — a sign the prefix is being broken. */
  suspiciousCacheWrites: Array<{ role: string; writes: number; keys: number }>;
  reaskCount: number;
  /** Per-role performance — so model tiers get compared by numbers, not by feel. */
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
    // Several cache writes for the SAME cacheKey = something is breaking the
    // prefix. Many different keys just means several role variants; harmless.
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

/** The cost of THIS shift alone. Unlike `formatReport`, which is the company's lifetime total. */
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
