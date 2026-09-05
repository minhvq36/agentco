/**
 * REAL MEASUREMENT: exactly WHAT `annotations` each Notion tool declares — field by field.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS NEEDS REMEASURING: a user asked on 08/26 *"why did you say       │
 * │ Notion cleanly has 3 levels when the create screen only shows 2           │
 * │ (Read-only and Full access)?"*                                           │
 * │                                                                          │
 * │ The "14 read · 11 add · 3 edit" line in the spec is an **INFERENCE**,    │
 * │ not a measurement: I took "3 tools have `destructive: true`" and         │
 * │ concluded the other 11 tools were `destructive: false`. But **absence ≠  │
 * │ false** — and `tierOf` correctly follows the one-way rule (not declared  │
 * │ ⇒ escalate), so if those 11 tools leave `destructiveHint` blank, they    │
 * │ all fall into `full` and the middle tier DISAPPEARS.                     │
 * │                                                                          │
 * │ Exactly the [[agentco-measurement-vs-conclusion]] error class, fourth    │
 * │ time: real data + one wrong inference step, then that wrong table got    │
 * │ written into the spec alongside the numbers. The UI showing 2 tiers is   │
 * │ the CORRECT behavior; the mistake was the line in the docs.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Doesn't import any vendor SDK — same rule as `core/oauth.ts`.
 *
 * Run: npx tsx scripts/spike-notion-annotations.ts   ($0 — no model turns at all)
 */

import fs from 'node:fs';
import path from 'node:path';

const MCP = 'https://mcp.notion.com/mcp';
const STORE = path.join(process.cwd(), 'company', '.state', 'secrets.json');

const raw = JSON.parse(fs.readFileSync(STORE, 'utf8')) as Record<string, unknown>;
const accounts = (raw['$oauth'] ?? {}) as Record<string, { access_token?: string; label?: string }>;
const first = Object.entries(accounts)[0];
if (!first?.[1]?.access_token) {
  console.error('No Notion account found in company/.state/secrets.json — log in through the UI first.');
  process.exit(1);
}
console.log(`Workspace: ${first[1].label ?? first[0]}\n`);

const call = async (method: string, params: unknown, id: number) => {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${first[1].access_token}`,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  const text = await res.text();
  // Streamable HTTP returns SSE: pull out the first `data:` line.
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5).trim() : text) as { result?: unknown; error?: unknown };
};

let session = '';

await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'agentco-spike', version: '1' },
}, 1);
await fetch(MCP, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${first[1].access_token}`,
    'mcp-session-id': session,
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
});

const r = await call('tools/list', {}, 2);
const tools = (r.result as { tools?: { name: string; annotations?: Record<string, unknown> }[] })?.tools ?? [];
if (!tools.length) {
  console.error('Failed to fetch the tool list:', JSON.stringify(r).slice(0, 400));
  process.exit(1);
}

/** Matches `probe.ts §tierOf` exactly — copied here so the spike has no build dependency. */
const tierOf = (a?: Record<string, unknown>) => {
  const ro = a?.['readOnlyHint'] ?? a?.['readOnly'];
  const de = a?.['destructiveHint'] ?? a?.['destructive'];
  if (ro === true && de !== true) return 'read';
  return ro === false && de === false ? 'add' : 'full';
};

const count = { read: 0, add: 0, full: 0 };
console.log('tool'.padEnd(34), 'readOnly'.padEnd(10), 'destructive'.padEnd(12), 'tier');
console.log('─'.repeat(70));
for (const t of tools.sort((x, y) => x.name.localeCompare(y.name))) {
  const a = t.annotations ?? {};
  const ro = a['readOnlyHint'] ?? a['readOnly'];
  const de = a['destructiveHint'] ?? a['destructive'];
  const tier = tierOf(a);
  count[tier]++;
  console.log(
    t.name.padEnd(34),
    String(ro ?? '(absent)').padEnd(10),
    String(de ?? '(absent)').padEnd(12),
    tier,
  );
}

console.log('─'.repeat(70));
console.log(`TOTAL ${tools.length} tools  ·  read ${count.read}  ·  add ${count.add}  ·  full ${count.full}`);
console.log(
  `\nTiers that SHOW UP in the UI (rule: "only show if it ADDS ≥1 tool over the tier below"):\n` +
    [
      ['Read-only', count.read],
      ['Read + Add', count.read + count.add],
      ['Full access', count.read + count.add + count.full],
    ]
      .filter(([, n], i, all) => (i === 0 ? (n as number) > 0 : (n as number) > (all[i - 1]![1] as number)))
      .map(([name, n]) => `  ◦ ${name} — ${n} tools`)
      .join('\n'),
);
