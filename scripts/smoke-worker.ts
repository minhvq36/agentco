
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
if (!role) throw new Error('no writer role');

console.log(`Company: ${company.config.name}  ·  role: ${role.id} v${role.version}`);

async function once(label: string, goal: string, out: string) {
  const brief = TaskBriefSchema.parse({
    task_id: label,
    role: 'writer',
    goal,
    outputs: [{ path: out }],
    constraints: ['Max 60 words'],
  });

  const t0 = Date.now();
  const r = await runWorker(
    { company, onProgress: (say) => console.log(`      · ${say}`) },
    { brief, role: role!, hotKnowledge: '', coldKnowledge: '' },
  );

  const u = r.usage;
  console.log(
    `\n[${label}] ${r.status}  ${Date.now() - t0}ms  ${r.reasked ? '(HAD TO RE-ASK)' : ''}\n` +
      `      say: ${r.say}\n` +
      `      artifacts: ${r.artifacts.join(', ') || '(none)'}\n` +
      `      in=${u.input} cw=${u.cacheWrite} cr=${u.cacheRead} out=${u.output} $${u.costUSD.toFixed(5)}`,
  );

  for (const a of r.artifacts) {
    const f = path.join(dir, a);
    console.log(`      file ${a}: ${fs.existsSync(f) ? `${fs.statSync(f).size} bytes ✓` : 'DOES NOT EXIST ✗'}`);
  }
  return r;
}

const a = await once('T-smoke-1', 'Write a short intro paragraph for a coffee shop called "Gio Mua".', 'artifacts/T-smoke-1/intro.md');
const b = await once('T-smoke-2', 'Write a short intro paragraph for a bakery called "Mat Ong".', 'artifacts/T-smoke-2/intro.md');

console.log('\n─── CONCLUSION ───');
console.log(`Valid receipt on the first try: ${!a.reasked && !b.reasked ? 'YES ✓' : 'NO ✗'}`);
const ratio = b.usage.cacheRead / Math.max(1, b.usage.cacheRead + b.usage.input + b.usage.cacheWrite);
console.log(`Cache hit on the 2nd call: ${(ratio * 100).toFixed(1)}%  ${ratio > 0.6 ? '✓' : '✗ prefix is being broken'}`);
console.log(`Writes a file instead of pasting content: ${a.artifacts.length > 0 && b.artifacts.length > 0 ? 'YES ✓' : 'NO ✗'}`);
