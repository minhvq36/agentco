/**
 * Smoke test: một worker thật, đầu-cuối.
 *
 * Kiểm ba thứ rủi ro nhất trước khi xây tiếp:
 *  1. Receipt protocol có ép được model trả JSON đúng schema không
 *  2. SYSTEM_PROMPT_DYNAMIC_BOUNDARY có cho cache hit giữa hai call không
 *  3. Worker có thật sự GHI FILE thay vì dán nội dung vào câu trả lời không
 *
 * Chạy: npx tsx scripts/smoke-worker.ts <company-dir>
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadCompany } from '../src/core/config.js';
import { ensureDirs, paths } from '../src/core/paths.js';
import { runWorker } from '../src/core/worker.js';
import { TaskBriefSchema } from '../src/core/types.js';

const dir = path.resolve(process.argv[2] ?? 'company');
ensureDirs(paths(dir));
const company = loadCompany(dir);
const role = company.roles.get('writer');
if (!role) throw new Error('không có role writer');

console.log(`Công ty: ${company.config.name}  ·  vai trò: ${role.id} v${role.version}`);

async function once(label: string, goal: string, out: string) {
  const brief = TaskBriefSchema.parse({
    task_id: label,
    role: 'writer',
    goal,
    outputs: [{ path: out }],
    constraints: ['Tối đa 60 từ'],
  });

  const t0 = Date.now();
  const r = await runWorker(
    { company, onProgress: (say) => console.log(`      · ${say}`) },
    { brief, role: role!, hotKnowledge: '', coldKnowledge: '' },
  );

  const u = r.usage;
  console.log(
    `\n[${label}] ${r.status}  ${Date.now() - t0}ms  ${r.reasked ? '(PHẢI HỎI LẠI)' : ''}\n` +
      `      say: ${r.say}\n` +
      `      artifacts: ${r.artifacts.join(', ') || '(không có)'}\n` +
      `      in=${u.input} cw=${u.cacheWrite} cr=${u.cacheRead} out=${u.output} $${u.costUSD.toFixed(5)}`,
  );

  for (const a of r.artifacts) {
    const f = path.join(dir, a);
    console.log(`      file ${a}: ${fs.existsSync(f) ? `${fs.statSync(f).size} bytes ✓` : 'KHÔNG TỒN TẠI ✗'}`);
  }
  return r;
}

const a = await once('T-smoke-1', 'Viết một đoạn giới thiệu ngắn về quán cà phê tên "Gió Mùa".', 'artifacts/T-smoke-1/intro.md');
const b = await once('T-smoke-2', 'Viết một đoạn giới thiệu ngắn về tiệm bánh tên "Mật Ong".', 'artifacts/T-smoke-2/intro.md');

console.log('\n─── KẾT LUẬN ───');
console.log(`Receipt hợp lệ ngay lần đầu: ${!a.reasked && !b.reasked ? 'CÓ ✓' : 'KHÔNG ✗'}`);
const ratio = b.usage.cacheRead / Math.max(1, b.usage.cacheRead + b.usage.input + b.usage.cacheWrite);
console.log(`Cache hit ở call thứ 2: ${(ratio * 100).toFixed(1)}%  ${ratio > 0.6 ? '✓' : '✗ prefix đang bị phá'}`);
console.log(`Ghi file thay vì dán nội dung: ${a.artifacts.length > 0 && b.artifacts.length > 0 ? 'CÓ ✓' : 'KHÔNG ✗'}`);
