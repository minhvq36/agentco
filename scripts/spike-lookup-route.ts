/**
 * SPIKE — does web-searching `lookup` WORK END-TO-END, and does the Assistant
 * route to the right door?
 *
 * Two questions, and the second one is the hard one:
 *
 *   A. `assistant.lookup([], "…")` — does the hidden worker do a real web search?
 *   B. `assistant.route("what's the weather today")` — does it pick `lookup` or `task`?
 *      And does a staff member's OWN AREA OF EXPERTISE still stay theirs?
 *      (the user-priority rule locked in 08/24 — if `lookup` gets too broad and
 *      swallows `task`, that's a failure in the OPPOSITE DIRECTION, and a
 *      quieter one: nobody checks a fluent-sounding answer.)
 *
 * ⚠ Runs against the user's REAL office, but WRITES NOTHING: only `route` (one
 * conversation turn) and `lookup` (one-shot, `persistSession: false`).
 * ⚠ `route` runs ON the Assistant session ⇒ it does leave a turn in that
 * office's conversation history. Use the `canh-tay` office (the scratch office
 * from test 11).
 *
 * Run: npx tsx scripts/spike-lookup-route.ts [office-id]   (~$0.15)
 */

import { Assistant } from '../src/core/assistant.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const officeId = process.argv[2] ?? 'canh-tay';
const companyConfig = loadCompanyConfig('company');
const office = loadOffice('company', companyConfig, officeId);
const assistant = new Assistant(office);

console.log(`\noffice: ${officeId}`);
console.log(`staff: ${[...office.roles.keys()].join(', ') || '(none)'}\n`);

// ── A · does the hidden worker do a real web search ────────────────────────
console.log('── A · lookup([], …) — hidden worker does a web search');
const t0 = Date.now();
const a = await assistant.lookup([], 'Find 3 coworking-friendly cafes in District 1, Ho Chi Minh City. List their names and addresses.');
console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s · $${a.usage.costUSD.toFixed(4)} · ${a.usage.turns} turns`);
console.log(`   said: ${a.value.replace(/\s+/g, ' ').slice(0, 300)}\n`);

// ── B · which door does the Assistant pick ──────────────────────────────────
console.log('── B · route() — which door for which message');
const cases: [string, string][] = [
  ["what's the weather like in Ho Chi Minh City today?", 'lookup (general lookup, nobody adds anything to this)'],
  ['what tech news is there today?', 'lookup'],
  ['write me a 300-word intro blurb for a flower shop', 'task (needs FILES + domain expertise)'],
];

for (const [msg, expected] of cases) {
  const r = await assistant.route(msg, false);
  const v = r.value as Record<string, unknown>;
  const extra =
    v['intent'] === 'lookup' ? ` paths=${JSON.stringify(v['paths'])}` : v['intent'] === 'task' ? ` scope=${v['scope']}` : '';
  console.log(`   "${msg.slice(0, 42)}…"`);
  console.log(`      → ${String(v['intent']).padEnd(7)}${extra}   $${r.usage.costUSD.toFixed(4)}`);
  console.log(`      expected: ${expected}`);
}

console.log(
  `\n⚠ Boundary: this is model BEHAVIOR, not a hard guardrail. One correct turn\n` +
    `  does not prove the priority rule always holds — it only proves the new\n` +
    `  door doesn't swallow the old one in the most obvious case.`,
);
