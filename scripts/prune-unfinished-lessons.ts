/**
 * RATCHET CLEANUP — remove lessons that were born from runs that DID NOT REACH THE GOAL.
 * → `assistant.ts §learnable` · SESSIONS_MEMORY §"EXPERIENCE RATCHET"
 *
 * The new gate (added 08/29) only blocks going forward. The existing knowledge
 * store had already accumulated entries that gate would have blocked — and nine
 * of them are currently causing the "Web browser" arm to stop working. This
 * script applies **that exact same rule** to the existing store.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DO NOT HAND-TYPE THE LIST. Every node records `source: <plan_id>`, and    │
 * │ that plan's receipt still lives under `.state/tasks/`. So the question    │
 * │ *"did this run reach the goal"* can be answered from **data**, the same   │
 * │ way the new gate answers it at runtime. A hand-typed list is correct once │
 * │ and wrong forever after.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * WARNING: goes through the daemon's API when the daemon is running. Deleting
 * files out from under a daemon that keeps the index in RAM leaves disk and
 * memory out of sync, and it will keep feeding the deleted entry into prompts
 * until the next scan — a textbook silent failure.
 *
 * WARNING: does NOT touch the Assistant's MEMORY node (`source: compact`): its
 * authority comes from the USER, not from the outcome of a run.
 * WARNING: does NOT touch role nodes (`source: T-01`): they don't record which
 * plan produced them, so there is NO DATA to judge by — the script reports
 * them, it does not guess.
 *
 * Run:  npx tsx scripts/prune-unfinished-lessons.ts <office-id> [--apply]
 * Without `--apply` it only prints, it deletes nothing.
 */

import fs from 'node:fs';
import path from 'node:path';

import { agentFault } from '../src/core/assistant.js';
import { loadCompanyConfig } from '../src/core/config.js';
import { companyPaths, officePaths } from '../src/core/paths.js';

const companyDir = path.resolve('company');
const officeId = process.argv[2];
if (!officeId) throw new Error('missing <office-id>, e.g. canh-tay');
const apply = process.argv.includes('--apply');

const oPaths = officePaths(path.join(companyPaths(companyDir).offices, officeId));

/** `learnable` from `assistant.ts`, applied to a receipt read off disk. */
const learnableReceipt = (r: Record<string, unknown>): boolean =>
  r['status'] === 'done' && agentFault(r as never);

/**
 * Whether this plan's lesson should still be kept — THREE outcomes, and the
 * second one is the easiest to drop by accident:
 *
 *   'yes'      a task REACHED THE GOAL but hit friction along the way → `learnable`
 *   'friction' EVERY task is `done` and CLEAN                          → `worthLearning`'s friction branch
 *   'no'       everything else
 *
 * WARNING: `friction` doesn't live on disk (it lives in RAM, tied to the
 * conversation), so it can't be read directly. But it CAN be inferred with
 * certainty: a run that finished clean and still produced a lesson could only
 * have gotten there through the friction branch. Dropping this case would
 * delete exactly the LAYER of lessons learned from the user themselves — the
 * most valuable thing in the store, and the one the 08/29 rule deliberately
 * left untouched.
 */
function planLearnable(planId: string): 'yes' | 'friction' | 'no' | 'unknown' {
  let files: string[];
  try {
    files = fs.readdirSync(oPaths.tasks).filter((f) => f.startsWith(`${planId}.`) && f.endsWith('.receipt.json'));
  } catch {
    return 'unknown';
  }
  if (!files.length) return 'unknown'; // receipts have already been cleaned up — no data to judge from
  const rs: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      rs.push(JSON.parse(fs.readFileSync(path.join(oPaths.tasks, f), 'utf8')));
    } catch {
      return 'unknown'; // corrupt receipt => not enough data, and "unknown" means DO NOT delete
    }
  }
  if (rs.some(learnableReceipt)) return 'yes';
  if (rs.every((r) => r['status'] === 'done' && !agentFault(r as never))) return 'friction';
  return 'no';
}

const front = (raw: string, key: string): string =>
  new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(raw)?.[1]?.trim() ?? '';

interface Row {
  id: string;
  file: string;
  source: string;
  verdict: 'yes' | 'friction' | 'no' | 'unknown' | 'memory' | 'role';
  title: string;
}

const rows: Row[] = [];
function walk(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.isFile() && e.name.endsWith('.md')) {
      const raw = fs.readFileSync(abs, 'utf8');
      const id = front(raw, 'id');
      const source = front(raw, 'source');
      if (!id) continue;
      const verdict: Row['verdict'] = !source
        ? 'unknown'
        : source === 'compact'
          ? 'memory'
          : source.startsWith('P-')
            ? planLearnable(source)
            : 'role';
      rows.push({ id, file: abs, source, verdict, title: front(raw, 'title') });
    }
  }
}
walk(oPaths.knowledge);

const drop = rows.filter((r) => r.verdict === 'no');
const keep = rows.filter((r) => r.verdict === 'yes');
const fric = rows.filter((r) => r.verdict === 'friction');
const skip = rows.filter((r) => r.verdict === 'role' || r.verdict === 'memory' || r.verdict === 'unknown');

const say = (label: string, rs: Row[]) => {
  console.log(`\n${label} (${rs.length})`);
  for (const r of rs) console.log(`  ${r.source.padEnd(19)} ${r.title.slice(0, 62)}`);
};
say('KEEP — a task reached the goal but hit friction', keep);
say('KEEP — FRICTION branch: a clean run whose lesson is about how the task was handed off', fric);
say('NO VERDICT — user memory / role lessons (no plan_id recorded)', skip);
say('DROP — born from a run that did NOT reach the goal', drop);

if (!apply) {
  console.log(`\n(dry run — nothing deleted. Add --apply to delete ${drop.length} entries.)\n`);
  process.exit(0);
}

const daemonFile = companyPaths(companyDir).daemonFile;
const base = fs.existsSync(daemonFile)
  ? (JSON.parse(fs.readFileSync(daemonFile, 'utf8')) as { url?: string }).url
  : undefined;

if (!base) {
  throw new Error(
    'daemon.json not found. This script deliberately does NOT delete straight from disk: the ' +
      'daemon keeps its index in RAM, and deleting out from under it would leave disk and memory ' +
      'out of sync. Start the daemon and run this again.',
  );
}

let done = 0;
for (const r of drop) {
  const res = await fetch(`${base}/api/office/${encodeURIComponent(officeId)}/knowledge`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: r.id, remove: true }),
  });
  if (!res.ok) {
    console.log(`  ✗ ${r.id}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    continue;
  }
  done++;
}
console.log(`\nDeleted ${done}/${drop.length} entries via the daemon API (${base}).\n`);
