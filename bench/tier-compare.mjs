/**
 * Compare model tiers on the SAME agentic job.
 *
 * The question: is the `eco` tier (Haiku) actually cheaper for work that USES
 * TOOLS? The suspicion: Haiku gropes around for more turns, and every turn
 * re-reads the whole prefix — so cheaper per token is not cheaper per job.
 *
 * Variables held still:
 *  - the SAME input files, written here, identical on every run
 *  - the SAME goal, the SAME constraints
 *  - each tier runs twice: round 1 writes the cache (cold), round 2 reuses it
 *    (warm). Only round 2 is compared with round 2; round 1 exists to warm up.
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ ⚠ THE WORKLOAD BELOW STAYS VIETNAMESE, ON PURPOSE. Source prose in this
 * │ repository is English (`docs/CLAUDE.md`), and everything here that a
 * │ developer reads — comments, labels, output — follows that rule. The
 * │ FIXTURE does not, because it is not prose: it is the thing being measured.
 * │
 * │ Vietnamese tokenises considerably worse than English, so translating this
 * │ text would quietly change the answer to the question the script asks,
 * │ while looking like a tidy-up. The tier table in
 * │ `docs/SPEC-token-economy.md` was decided on THIS workload, in the language
 * │ the users of this product actually work in.
 * │
 * │ The fixture lines carry `i18n-allow-vietnamese`, PER LINE — not a
 * │ whole-file exemption. The gate still reads every other line in this file,
 * │ so the escape hatch covers the thing under test and nothing else.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * Run: node bench/tier-compare.mjs   (needs `npm run build:all` first — it
 * drives the real `runWorker` out of `dist/`.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// On Windows a dynamic import needs a file:// URL — "D:\..." is read as scheme "d:".
const mod = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { loadCompany } = await mod('dist/core/config.js');
const { ensureDirs, paths } = await mod('dist/core/paths.js');
const { runWorker } = await mod('dist/core/worker.js');
const { TaskBriefSchema } = await mod('dist/core/types.js');

const dir = path.resolve(process.argv[2] ?? path.join(root, '.bench-company'));

// ── build a clean company
fs.rmSync(dir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'templates/company'), dir, { recursive: true });
ensureDirs(paths(dir));

// ── fixed input: two files to review, byte-identical on every run (see the box above)
const inputDir = path.join(dir, 'artifacts/INPUT');
fs.mkdirSync(inputDir, { recursive: true });
fs.writeFileSync(
  path.join(inputDir, 'facebook.md'),
  `# Bản Facebook\n\nTiệm hoa Nắng Sớm mở cửa từ 6h sáng. Chúng tôi bán hoa tươi cắt mỗi ngày.\nNắng Sớm tin rằng một bó hoa buổi sáng làm cả ngày dễ chịu hơn.\nGhé tiệm mình ở 12 Lý Thường Kiệt nhé!\n`, // i18n-allow-vietnamese
);
fs.writeFileSync(
  path.join(inputDir, 'website.md'),
  `# Bản website\n\nNắng Sớm là tiệm hoa nhỏ tại quận 1. Chúng tôi nhập hoa mỗi sáng từ Đà Lạt.\nTiệm phục vụ hoa cưới, hoa sự kiện và hoa tặng.\nChúng tôi cam kết hoa tươi 100% và giao hàng trong 2 giờ.\n`, // i18n-allow-vietnamese
);

const GOAL =
  'Soát lại hai đoạn giới thiệu tiệm hoa Nắng Sớm, chỉ ra lỗi chính tả, ' + // i18n-allow-vietnamese
  'chỗ giọng văn không nhất quán, và chỗ chưa đạt.'; // i18n-allow-vietnamese
const CONSTRAINTS = ['Tối đa 8 dòng nhận xét', 'Không tự viết lại giúp']; // i18n-allow-vietnamese

async function measure(tier, round) {
  const company = loadCompany(dir);
  const role = { ...company.roles.get('reviewer'), model_tier: tier };
  const taskId = `B-${tier}-${round}`;

  const brief = TaskBriefSchema.parse({
    task_id: taskId,
    role: 'reviewer',
    goal: GOAL,
    inputs: [{ path: 'artifacts/INPUT/facebook.md' }, { path: 'artifacts/INPUT/website.md' }],
    outputs: [{ path: `artifacts/${taskId}/nhan-xet.md` }],
    constraints: CONSTRAINTS,
  });

  const t0 = Date.now();
  let r;
  try {
    r = await runWorker({ company }, { brief, role, hotKnowledge: '', coldKnowledge: '' });
  } catch (err) {
    console.log(`  ${tier} round ${round}: FAILED — ${err.message.slice(0, 90)}`);
    return null;
  }
  const u = r.usage;
  const tokens = u.input + u.cacheRead + u.cacheWrite + u.output;
  console.log(
    `  ${tier.padEnd(9)} round ${round}  ${String(r.status).padEnd(7)} ` +
      `turns=${String(u.turns).padStart(2)}  tokens=${String(tokens).padStart(6)}  ` +
      `cr=${String(u.cacheRead).padStart(6)} cw=${String(u.cacheWrite).padStart(5)} out=${String(u.output).padStart(4)}  ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s  $${u.costUSD.toFixed(4)}`,
  );
  return { tier, round, status: r.status, turns: u.turns, tokens, cost: u.costUSD, ms: Date.now() - t0 };
}

console.log('Tier comparison on ONE review job (2 input files, same constraints)\n');
const results = [];
for (const tier of ['eco', 'standard']) {
  for (const round of [1, 2]) {
    const r = await measure(tier, round);
    if (r) results.push(r);
  }
  console.log('');
}

// Round 2 only (the cache is warm) — round 1 exists to warm the prefix.
const warm = Object.fromEntries(results.filter((r) => r.round === 2).map((r) => [r.tier, r]));
if (warm.eco && warm.standard) {
  const c = warm.eco;
  const s = warm.standard;
  const f = (a, b) => (b === 0 ? '—' : `${(a / b).toFixed(2)}×`);
  console.log('─── COMPARISON (warm cache) ───');
  console.log(`  turns   eco ${c.turns}  vs  standard ${s.turns}      → eco takes ${f(c.turns, s.turns)} the turns`);
  console.log(`  tokens  eco ${c.tokens}  vs  standard ${s.tokens}    → eco takes ${f(c.tokens, s.tokens)} the tokens`);
  console.log(`  time    eco ${(c.ms / 1000).toFixed(1)}s vs standard ${(s.ms / 1000).toFixed(1)}s → eco is ${f(c.ms, s.ms)} as slow`);
  console.log(`  MONEY   eco $${c.cost.toFixed(4)} vs standard $${s.cost.toFixed(4)} → eco costs ${f(c.cost, s.cost)}`);
  console.log('');
  console.log(
    c.cost < s.cost
      ? '  → the `eco` tier IS still cheaper in money. The tier table stands.'
      : '  → the `eco` tier is MORE EXPENSIVE for work with tools. The tier table in the spec has to be rewritten.',
  );
}
