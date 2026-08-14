/**
 * So sánh tier model trên CÙNG một việc agentic.
 *
 * Câu hỏi: tier `cheap` (Haiku) có thật sự rẻ hơn cho việc CÓ TOOL không?
 * Nghi vấn: Haiku dò dẫm nhiều lượt hơn, mà mỗi lượt đọc lại toàn bộ prefix,
 * nên rẻ trên mỗi token chưa chắc rẻ trên mỗi việc.
 *
 * Kiểm soát biến:
 *  - CÙNG file input (tạo sẵn, giống hệt nhau)
 *  - CÙNG mục tiêu, CÙNG ràng buộc
 *  - Mỗi tier chạy 2 lần: lần 1 ghi cache (lạnh), lần 2 dùng lại (ấm).
 *    Chỉ so lần 2 với lần 2 — lần 1 chỉ để làm ấm.
 *
 * Chạy: node bench/tier-compare.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Trên Windows, dynamic import cần file:// URL — đường dẫn "D:\..." bị coi là scheme "d:"
const mod = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { loadCompany } = await mod('dist/core/config.js');
const { ensureDirs, paths } = await mod('dist/core/paths.js');
const { runWorker } = await mod('dist/core/worker.js');
const { TaskBriefSchema } = await mod('dist/core/types.js');

const dir = path.resolve(process.argv[2] ?? path.join(root, '.bench-company'));

// ── dựng công ty sạch
fs.rmSync(dir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'templates/company'), dir, { recursive: true });
ensureDirs(paths(dir));

// ── input cố định: hai file để soát, giống hệt nhau ở mọi lần chạy
const inputDir = path.join(dir, 'artifacts/INPUT');
fs.mkdirSync(inputDir, { recursive: true });
fs.writeFileSync(
  path.join(inputDir, 'facebook.md'),
  `# Bản Facebook\n\nTiệm hoa Nắng Sớm mở cửa từ 6h sáng. Chúng tôi bán hoa tươi cắt mỗi ngày.\nNắng Sớm tin rằng một bó hoa buổi sáng làm cả ngày dễ chịu hơn.\nGhé tiệm mình ở 12 Lý Thường Kiệt nhé!\n`,
);
fs.writeFileSync(
  path.join(inputDir, 'website.md'),
  `# Bản website\n\nNắng Sớm là tiệm hoa nhỏ tại quận 1. Chúng tôi nhập hoa mỗi sáng từ Đà Lạt.\nTiệm phục vụ hoa cưới, hoa sự kiện và hoa tặng.\nChúng tôi cam kết hoa tươi 100% và giao hàng trong 2 giờ.\n`,
);

const GOAL =
  'Soát lại hai đoạn giới thiệu tiệm hoa Nắng Sớm, chỉ ra lỗi chính tả, ' +
  'chỗ giọng văn không nhất quán, và chỗ chưa đạt.';
const CONSTRAINTS = ['Tối đa 8 dòng nhận xét', 'Không tự viết lại giúp'];

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
    console.log(`  ${tier} lần ${round}: LỖI — ${err.message.slice(0, 90)}`);
    return null;
  }
  const u = r.usage;
  const tokens = u.input + u.cacheRead + u.cacheWrite + u.output;
  console.log(
    `  ${tier.padEnd(9)} lần ${round}  ${String(r.status).padEnd(7)} ` +
      `lượt=${String(u.turns).padStart(2)}  token=${String(tokens).padStart(6)}  ` +
      `cr=${String(u.cacheRead).padStart(6)} cw=${String(u.cacheWrite).padStart(5)} out=${String(u.output).padStart(4)}  ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s  $${u.costUSD.toFixed(4)}`,
  );
  return { tier, round, status: r.status, turns: u.turns, tokens, cost: u.costUSD, ms: Date.now() - t0 };
}

console.log('So sánh tier trên CÙNG một việc soát lỗi (2 file input, cùng ràng buộc)\n');
const results = [];
for (const tier of ['cheap', 'standard']) {
  for (const round of [1, 2]) {
    const r = await measure(tier, round);
    if (r) results.push(r);
  }
  console.log('');
}

// Chỉ so lần 2 (cache đã ấm) — lần 1 chỉ để làm ấm prefix.
const warm = Object.fromEntries(results.filter((r) => r.round === 2).map((r) => [r.tier, r]));
if (warm.cheap && warm.standard) {
  const c = warm.cheap;
  const s = warm.standard;
  const f = (a, b) => (b === 0 ? '—' : `${(a / b).toFixed(2)}×`);
  console.log('─── SO SÁNH (cache đã ấm) ───');
  console.log(`  lượt      cheap ${c.turns}  vs  standard ${s.turns}      → cheap dùng ${f(c.turns, s.turns)} số lượt`);
  console.log(`  token     cheap ${c.tokens}  vs  standard ${s.tokens}    → cheap dùng ${f(c.tokens, s.tokens)} token`);
  console.log(`  thời gian cheap ${(c.ms / 1000).toFixed(1)}s vs standard ${(s.ms / 1000).toFixed(1)}s → cheap chậm ${f(c.ms, s.ms)}`);
  console.log(`  TIỀN      cheap $${c.cost.toFixed(4)} vs standard $${s.cost.toFixed(4)} → cheap tốn ${f(c.cost, s.cost)}`);
  console.log('');
  console.log(
    c.cost < s.cost
      ? '  → tier `cheap` VẪN rẻ hơn về tiền. Giữ nguyên bảng tier.'
      : '  → tier `cheap` ĐẮT HƠN cho việc có tool. Phải viết lại bảng tier trong spec.',
  );
}
