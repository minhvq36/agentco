/**
 * SPIKE — DOES A MID-SESSION CONFIG CHANGE REACH THE ASSISTANT? (user filed 08/24)
 *
 * The real case the user measured: ask a question, the Assistant asks back
 * *"which folder should I look in: Programs Installation or Musics?"*.
 * Unplug the Installation arm → ask **the exact same question** again →
 * **the exact same answer**. Delete the arm from the office entirely →
 * **still the same answer**. Attach a brand-new arm → still not showing up.
 *
 * Suspect #1 the user named: *"a cache-protection mechanism means add/remove
 * isn't real-time"*. Suspect #2: **`resume` carries the whole conversation
 * history**, and the Assistant's own earlier answer is sitting in it — the
 * model is echoing what it just said instead of re-reading the roster.
 *
 * THESE TWO SUSPECTS CAN BE SEPARATED BY EXACTLY ONE MEASUREMENT — and that's
 * this script:
 *
 *   turn 2  ask the EXACT SAME question    → both suspects predict "still sees it"
 *   turn 3  SAME MEANING, DIFFERENT WORDS   → non-realtime cache: still sees it
 *                                              history anchoring:   no longer sees it
 *   turn 5  a NEW session, same config      → separates "config is wrong" from
 *                                              "history is the culprit"
 *
 * ⚠ The config is printed at EVERY turn (`armReach` — the exact function that
 *   builds the capability line in the roster), so the table below can compare
 *   "what we SENT" against "what the model SAID". Skip that column and you've
 *   just measured a behavior and then drawn a conclusion about a mechanism you
 *   never actually looked at.
 *
 * ⚠ Builds a TEMPORARY company in a temp directory — never touches the user's
 *   real company.
 * ⚠ The arm uses `command: node` (not `npx`), so it installs NO package and
 *   starts NO process: the Assistant never actually holds an MCP connection
 *   here — this script only measures the text in the roster.
 *
 * Run: npx tsx scripts/spike-resume-roster.ts   (~$0.08)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { Assistant, armReach } from '../src/core/assistant.js';
import { armHash } from '../src/core/catalog.js';
import { Company } from '../src/core/company.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-roster-'));
const companyDir = path.join(root, 'company');
fs.cpSync(path.resolve('templates/company'), companyDir, { recursive: true });

const company = Company.open(companyDir);
const officeId = company.createOffice({ name: 'Arms' }).id;
const officeDir = path.join(companyDir, 'offices', officeId);
const rolesDir = path.join(officeDir, 'roles');

// ── two arms, two folders, exactly the shape of the real case ───────────────
const cfgA = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Musics'] };
const cfgB = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Programs Installation'] };
const cfgC = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Invoices'] };
const A = armHash(cfgA);
const B = armHash(cfgB);
const C = armHash(cfgC);

function writeCompanyArms(entries: [string, Record<string, unknown>, string][]): void {
  const file = path.join(companyDir, 'company.yaml');
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  doc.set('mcpServers', doc.createNode(Object.fromEntries(entries.map(([id, cfg]) => [id, cfg]))));
  doc.set(
    'arms',
    doc.createNode(Object.fromEntries(entries.map(([id, , label]) => [id, { label, secrets: [] }]))),
  );
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
}

function writeRole(id: string, name: string, pitch: string, mcp: string[]): void {
  fs.writeFileSync(
    path.join(rolesDir, `${id}.yaml`),
    `id: ${id}\nversion: 1\ndisplay_name: "${name}"\navatar: "•"\npitch: "${pitch}"\n` +
      `good_at: []\nnot_for: []\nskill_level: medium\nskills: {}\nmodel_tier: standard\n` +
      `use_preset: false\ntools: []\n` +
      (mcp.length ? `mcp:\n${mcp.map((m) => `  - ${m}\n`).join('')}` : 'mcp: []\n') +
      `budget:\n  max_turns: 6\n  max_usd: 1.0\n  knowledge_pack: 3000\n`,
    'utf8',
  );
}

// The template ships with a few prebuilt roles — wipe them so the roster only holds what this script builds.
for (const f of fs.readdirSync(rolesDir)) fs.rmSync(path.join(rolesDir, f));

writeCompanyArms([
  [A, cfgA, 'Musics'],
  [B, cfgB, 'Programs Installation'],
]);
writeRole('music-scanner', 'Music Scanner', 'Reads files and folders the user points to, and summarizes the contents.', [A]);
writeRole('installer-scanner', 'Installer Scanner', 'Reads files and folders the user points to, and summarizes the contents.', [B]);

const reload = () => loadOffice(companyDir, loadCompanyConfig(companyDir), officeId);
let loaded = reload();
const assistant = new Assistant(loaded);

/** The exact capability line that `Assistant.roster()` builds — what we ACTUALLY send. */
function whatWeSend(): string {
  return [...loaded.roles.values()]
    .map((r) => `${r.id}: [${r.mcp.map((m) => armReach(loaded.company.arms, loaded.company.mcpServers, m)).join(' · ') || '—'}]`)
    .join('\n           ');
}

const ORIGINAL_Q = 'In the folder you have access to, find the 5 largest files and summarize what that folder contains.';
const REWORDED_Q = 'Can you list the 5 heaviest files in the place the staff member has access to, then describe what that place holds?';

let total = 0;
async function ask(label: string, q: string, a = assistant): Promise<void> {
  const r = await a.route(q, false);
  const v = r.value as Record<string, unknown>;
  total += r.usage.costUSD;
  console.log(`\n── ${label}`);
  console.log(`   sent    : ${whatWeSend()}`);
  console.log(`   asked   : "${q.slice(0, 58)}…"`);
  console.log(`   out     : ${v['intent']}  ·  $${r.usage.costUSD.toFixed(4)}  ·  context ${a.contextTokens} tokens`);
  // Print ALL THREE text fields: `ask`/`chat` use `say`, `task` uses `request`,
  // `lookup` uses `question`. The earlier version forgot `question`, so `lookup`
  // turns printed as empty — and an empty cell reads as "said nothing" when it
  // actually did say something. → §3a
  console.log(`   said    : ${String(v['say'] ?? v['request'] ?? v['question'] ?? '').slice(0, 200)}`);
}

console.log(`\ntemp company: ${companyDir}`);
console.log(`A=${A} (Musics) · B=${B} (Programs Installation) · C=${C} (Invoices)`);

// ── L1 · baseline: two arms, two roles ───────────────────────────────────────
await ask('L1 · baseline (2 arms, NEW session)', ORIGINAL_Q);
console.log(`   session : ${assistant.session}`);

// ── L2 · UNPLUG B, ask the EXACT SAME question ───────────────────────────────
writeRole('installer-scanner', 'Installer Scanner', 'Reads files and folders the user points to, and summarizes the contents.', []);
loaded = reload();
assistant.rebind(loaded);
await ask('L2 · UNPLUGGED B — asking the EXACT SAME question', ORIGINAL_Q);

// ── L3 · same config, DIFFERENT WORDS ────────────────────────────────────────
await ask('L3 · same config as L2 — SAME MEANING, DIFFERENT WORDS', REWORDED_Q);

// ── L4 · attach C on top, ask the EXACT SAME question ────────────────────────
writeCompanyArms([
  [A, cfgA, 'Musics'],
  [B, cfgB, 'Programs Installation'],
  [C, cfgC, 'Invoices'],
]);
writeRole('installer-scanner', 'Installer Scanner', 'Reads files and folders the user points to, and summarizes the contents.', [C]);
loaded = reload();
assistant.rebind(loaded);
await ask('L4 · ATTACHED C (Invoices) on top — asking the EXACT SAME question', ORIGINAL_Q);

// ── L5 · CONTROL: BRAND-NEW session, same config as L4 ───────────────────────
const clean = new Assistant(loaded);
await ask('L5 · CONTROL — BRAND-NEW session, config identical to L4', ORIGINAL_Q, clean);

console.log(`\n⇒ total $${total.toFixed(4)}`);
console.log(
  `\nHOW TO READ THE TABLE:\n` +
    `  L2 mentions B  +  L3 does NOT mention B    ⇒ CONVERSATION HISTORY is anchoring it; config changes DO reach the model\n` +
    `  L2 mentions B  +  L3 STILL mentions B      ⇒ config changes do NOT reach a resumed session\n` +
    `  L5 differs from L4                          ⇒ proves the config is correct; the bug is in the session\n` +
    `  L5 matches L4                                ⇒ the bug is in the config layer, not the session\n`,
);

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ temp company removed');
