/**
 * WHAT THE SDK HANDS US — compared to what the REAL server actually declares.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `spike-notion-annotations.ts` asks Notion directly via JSON-RPC: **14    │
 * │ read · 11 add · 3 full**, all three tiers are real. But the UI only      │
 * │ shows TWO (Read-only / Full access) — user caught this on 08/26.         │
 * │                                                                          │
 * │ Those two measurements ask different questions, and the gap between      │
 * │ them is the **SDK**:                                                     │
 * │   server declares `destructiveHint: false`  →  SDK normalizes it to `?`  │
 * │                                                                          │
 * │ If the SDK drops the `false` field, `tierOf` sees `destructive ===       │
 * │ undefined` ⇒ per the one-way rule it **escalates** ⇒ all 25 write tools  │
 * │ fall into `full` ⇒ the middle tier vanishes. The one-way rule is **not   │
 * │ wrong**; it's processing a fact that already got lost along the way.     │
 * │                                                                          │
 * │ ⚠ This is exactly the question [[agentco-measurement-vs-conclusion]]     │
 * │ demands be asked: *"does this measurement travel the same path           │
 * │ production actually uses?"* — the JSON-RPC measurement does NOT:         │
 * │ production reads annotations through the SDK.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Run: npx tsx scripts/spike-sdk-annotations.ts   ($0)
 */

import fs from 'node:fs';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

const STORE = path.join(process.cwd(), 'company', '.state', 'secrets.json');
const raw = JSON.parse(fs.readFileSync(STORE, 'utf8')) as Record<string, unknown>;
const accounts = (raw['$oauth'] ?? {}) as Record<string, { access_token?: string; label?: string }>;
const acc = Object.values(accounts)[0];
if (!acc?.access_token) {
  console.error('No Notion account found — log in from the UI first.');
  process.exit(1);
}

let release: (() => void) | undefined;
const idle = async function* (): AsyncGenerator<never> {
  await new Promise<void>((r) => {
    release = r;
  });
};

const q = query({
  prompt: idle(),
  options: {
    tools: ['Read'],
    allowedTools: ['Read'],
    persistSession: false,
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {
      notion: {
        type: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: { Authorization: `Bearer ${acc.access_token}` },
      },
    },
  },
});

const drain = (async () => {
  try {
    for await (const _ of q) {
      /* */
    }
  } catch {
    /* */
  }
})();

let last;
const deadline = Date.now() + 45_000;
while (Date.now() < deadline) {
  last = await q.mcpServerStatus();
  if (last.length && last.every((s) => s.status !== 'pending')) break;
  await new Promise((r) => setTimeout(r, 500));
}

const s = last?.[0];
console.log(`status: ${s?.status}${s?.error ? ` — ${s.error}` : ''}`);
const tools = s?.tools ?? [];
console.log(`SDK returned ${tools.length} tools\n`);

const count = { read: 0, add: 0, full: 0 };
console.log('tool'.padEnd(34), 'annotations the SDK hands us');
console.log('─'.repeat(78));
for (const t of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
  const a = t.annotations as Record<string, unknown> | undefined;
  const tier =
    a?.['readOnly'] === true && a?.['destructive'] !== true
      ? 'read'
      : a?.['readOnly'] === false && a?.['destructive'] === false
        ? 'add'
        : 'full';
  count[tier as keyof typeof count]++;
  console.log(t.name.padEnd(34), JSON.stringify(a ?? null).padEnd(38), tier);
}
console.log('─'.repeat(78));
console.log(`read ${count.read} · add ${count.add} · full ${count.full}`);
console.log(
  `\n⇒ Compared to what the server declares (14 · 11 · 3): ` +
    (count.read === 14 && count.add === 11 && count.full === 3
      ? 'MATCH — the bug is somewhere else.'
      : '🔴 MISMATCH. The SDK is losing data along the way.'),
);

release?.();
await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
