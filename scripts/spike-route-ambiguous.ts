/**
 * SPIKE — AMBIGUOUS QUERIES: `lookup` OR A STAFF MEMBER? (user filed 08/24)
 *
 * The priority rule just settled on: *"allow both, let the Assistant route
 * itself, but prefer a staff member when that staff member is a specialist
 * who does exactly that job"*. This script builds the hardest case for that
 * rule: **a staff member who specializes in browsing the web and finding
 * news**, then asks the kind of questions `lookup` could also handle.
 *
 * If `lookup` swallows everything ⇒ the user loses the specialist viewpoint
 * they deliberately built, **and nobody notices it's gone**, because the
 * answer still reads fine. That's a failure in the OPPOSITE direction, and
 * far quieter than the reverse case.
 *
 * ⚠ Builds a TEMPORARY company in a temp directory — never touches the
 *   user's real company.
 * ⚠ This measures model BEHAVIOR, not a deterministic gate. A clean table
 *   doesn't prove the rule always holds; it only shows whether the new door
 *   swallows the old one in these specific cases.
 *
 * Run: npx tsx scripts/spike-route-ambiguous.ts   (~$0.15)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Assistant } from '../src/core/assistant.js';
import { Company } from '../src/core/company.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-amb-'));
const companyDir = path.join(root, 'company');

// Exactly what `agentco init` does: copy the company template as-is. Hand-building
// `company.yaml` here would just produce a second, drifting copy of the template.
fs.cpSync(path.resolve('templates/company'), companyDir, { recursive: true });

const company = Company.open(companyDir);
const office = company.createOffice({ name: 'News' });
const officeId = office.id;

// A staff member who SPECIALIZES in browsing the web — exactly what makes the question ambiguous.
fs.writeFileSync(
  path.join(companyDir, 'offices', officeId, 'roles', 'news-finder.yaml'),
  [
    'id: news-finder',
    'version: 1',
    'display_name: "News Finder"',
    'avatar: "🔎"',
    'pitch: "Browses the web, finds and cross-checks information from multiple sources, and writes it up as a sourced summary."',
    'good_at: []',
    'not_for: []',
    'skill_level: medium',
    'skills: {}',
    'model_tier: standard',
    'use_preset: false',
    'tools: []',
    'mcp: []',
    'budget:',
    '  max_turns: 8',
    '  max_usd: 1.0',
    '',
  ].join('\n'),
  'utf8',
);

const loaded = loadOffice(companyDir, loadCompanyConfig(companyDir), officeId);
const assistant = new Assistant(loaded);

console.log(`\ntemp company: ${companyDir}`);
console.log(`staff       : ${[...loaded.roles.keys()].join(', ')}\n`);

/** `expect` = the CORRECT door per the priority rule, so reading the table doesn't require guessing. */
const cases: { msg: string; expect: 'task' | 'lookup' | 'chat'; why: string }[] = [
  {
    msg: 'Find me 5 cafes good for working in District 1',
    expect: 'task',
    why: 'there is a staff member who SPECIALIZES in finding info — exactly their job',
  },
  {
    msg: "What's notable in tech news today?",
    expect: 'task',
    why: 'also web browsing + cross-referencing sources = their job',
  },
  {
    // ⚠ MY EXPECTATION WAS WRONG ON THE FIRST MEASUREMENT, NOT THE SYSTEM.
    // I wrote `lookup`, but it actually came out `chat` and answered correctly
    // right in the chat bubble. `chat` is the CHEAPEST correct door: no web,
    // no staff member needed. Keeping this case because it guards against the
    // new `lookup` door swallowing questions that were already free.
    msg: 'What day is it today?',
    expect: 'chat',
    why: 'needs no web, no staff member — the cheapest door must win',
  },
  {
    msg: 'Compile rose prices from 3 shops in District 3 and write it to a file for me',
    expect: 'task',
    why: 'needs a FILE to persist ⇒ always a task',
  },
];

let correct = 0;
for (const c of cases) {
  const r = await assistant.route(c.msg, false);
  const v = r.value as Record<string, unknown>;
  const got = String(v['intent']);
  const hit = got === c.expect;
  if (hit) correct++;
  const extra = got === 'lookup' ? ` paths=${JSON.stringify(v['paths'])}` : got === 'task' ? ` → ${v['scope']}` : '';
  console.log(`${hit ? '✅' : '❌'} "${c.msg.slice(0, 46)}"`);
  console.log(`     got: ${got}${extra}   ·   expected: ${c.expect} (${c.why})   ·   $${r.usage.costUSD.toFixed(4)}`);
  if (got === 'ask' || got === 'chat') console.log(`     say: ${String(v['say']).slice(0, 120)}`);
}

console.log(`\n⇒ ${correct}/${cases.length} routed correctly\n`);

/**
 * ══════════ THE OPPOSITE DIRECTION — JUST AS IMPORTANT AS THE ABOVE ══════════
 *
 * Pushing the priority rule too far means an office with NO lookup specialist
 * would push every casual question to `task`, and a non-technical user gets
 * *"no staff member is assigned to this"* — the exact case that caused this
 * fix in the first place. Two offices, same set of questions.
 */
async function oppositeDirection(label: string, roles: { id: string; pitch: string }[]) {
  const oid = company.createOffice({ name: label }).id;
  for (const r of roles) {
    fs.writeFileSync(
      path.join(companyDir, 'offices', oid, 'roles', `${r.id}.yaml`),
      `id: ${r.id}\nversion: 1\ndisplay_name: "${r.id}"\navatar: "•"\npitch: "${r.pitch}"\n` +
        `skill_level: medium\nskills: {}\nmodel_tier: standard\ntools: []\nmcp: []\n` +
        `budget:\n  max_turns: 8\n  max_usd: 1.0\n`,
      'utf8',
    );
  }
  const a = new Assistant(loadOffice(companyDir, loadCompanyConfig(companyDir), oid));
  console.log(`── ${label} (${roles.map((r) => r.id).join(', ') || 'NOBODY on staff'})`);
  for (const msg of ['Find me 5 cafes good for working in District 1', "What's in tech news today?"]) {
    const r = await a.route(msg, false);
    const v = r.value as Record<string, unknown>;
    const ok = v['intent'] === 'lookup';
    console.log(`   ${ok ? '✅' : '❌'} "${msg.slice(0, 40)}" → ${v['intent']}   (expected: lookup)`);
    if (!ok) console.log(`        say: ${String(v['say'] ?? '').slice(0, 140)}`);
  }
}

await oppositeDirection('Empty office', []);
await oppositeDirection('Translator only', [
  { id: 'translator', pitch: 'Translates documents English–Vietnamese, keeping specialized terminology accurate.' },
]);

console.log(
  `\n⚠ Boundary: this measures model BEHAVIOR, not a deterministic gate. A clean\n` +
    `  table only shows that the new door doesn't swallow the old one in the\n` +
    `  most obvious cases.`,
);

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ temp company removed');
