/**
 * SPIKE — DO MCP TOOLS GET AUTO-APPROVED?
 *
 * Born from test 9, run 08/24 (`P-260824-0355-r3qe`): the `nguoi-kiem-ke`
 * (inventory-clerk) role HAS a filesystem arm pointed straight at
 * `D:\Downloads\Programs Installation`, called the tool three times, and got
 * *"permission denied"* all three times. $0.0948 for 0 results.
 *
 * Hypothesis: `worker.ts` sends `allowedTools = effectiveTools(role.tools)` —
 * just the 7 office tools (+ shell). MCP tool names (`mcp__<server>__<tool>`)
 * are NOT in that list ⇒ the SDK treats them as "needs asking" ⇒ no
 * `canUseTool` ⇒ **deny**.
 *
 * If true: every arm plugged in costs ~2,185 tokens/turn (measured 08/23) for
 * a toolset that can NEVER actually be used. Paying for an arm that's tied down.
 *
 * Three conditions, one variable changed each time:
 *   A  allowedTools = 7 tools          (matches production today)
 *   B  allowedTools += `mcp__files`    (SERVER-level prefix)
 *   C  allowedTools += full names      (`mcp__files__list_directory`, …)
 *
 * Print what's OBSERVED before what's INFERRED: `system/init.tools`, each
 * `tool_use`, each `tool_result` with its `is_error`. → [[agentco-measurement-vs-conclusion]]
 *
 * Run: npx tsx scripts/spike-mcp-allow.ts   (~$0.01, haiku, 3 turns)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const OFFICE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

// Test directory with a SPACE in its name — exactly like the user's real case.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpallow-'));
const dir = path.join(root, 'Programs Installation');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'setup-lon.exe'), 'x'.repeat(4096));
fs.writeFileSync(path.join(dir, 'ghi-chu.txt'), 'y'.repeat(64));

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, dir] };

type Row = {
  label: string;
  granted: string[];
  calls: string[];
  denied: number;
  ok: number;
  text: string;
  cost: number;
};

async function run(label: string, allowed: string[]): Promise<Row> {
  const row: Row = { label, granted: [], calls: [], denied: 0, ok: 0, text: '', cost: 0 };

  const q = query({
    prompt:
      `List the files in the directory "${dir}" along with each file's size. ` +
      `Use whatever tool is available. Answer briefly.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'You are a file-inventory clerk.',
      tools: OFFICE_TOOLS,
      allowedTools: allowed,
      mcpServers: { files: FILES },
      maxTurns: 4,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });

  try {
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;

    if (m['type'] === 'system' && m['subtype'] === 'init') {
      row.granted = (m['tools'] as string[]) ?? [];
    }

    if (m['type'] === 'assistant') {
      const content = (m['message'] as { content?: unknown[] })?.content ?? [];
      for (const b of content as Record<string, unknown>[]) {
        if (b['type'] === 'tool_use') row.calls.push(String(b['name']));
      }
    }

    // tool_result travels inside a `user` message — this is the ONLY place denials show up.
    if (m['type'] === 'user') {
      const content = (m['message'] as { content?: unknown[] })?.content ?? [];
      for (const b of content as Record<string, unknown>[]) {
        if (b['type'] !== 'tool_result') continue;
        const raw = JSON.stringify(b['content'] ?? '');
        const bad = b['is_error'] === true || /permission|denied|haven't granted|requested permis/i.test(raw);
        if (bad) {
          row.denied++;
          if (row.denied === 1) console.log(`     └─ tool_result: ${raw.slice(0, 200)}`);
        } else row.ok++;
      }
    }

    if (m['type'] === 'result') {
      row.text = typeof m['result'] === 'string' ? m['result'] : '';
      row.cost = (m['total_cost_usd'] as number) ?? 0;
    }
  }
  } catch (e) {
    // Hitting the turn cap / an error result ⇒ the SDK throws. That's DATA, not a crash.
    row.text = `⟨threw⟩ ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 140)}`;
  }
  return row;
}

const rows: Row[] = [];

console.log(`\ntest directory: ${dir}\n`);

console.log('── A · allowedTools = the 7 office tools (matches production today)');
rows.push(await run('A · 7 tools', OFFICE_TOOLS));

console.log('\n── B · allowedTools += "mcp__files" (SERVER-level prefix)');
rows.push(await run('B · + mcp__files', [...OFFICE_TOOLS, 'mcp__files']));

console.log('\n── C · allowedTools += full tool names');
const full = rows[0]?.granted.filter((t) => t.startsWith('mcp__files__')) ?? [];
rows.push(await run('C · + full names', [...OFFICE_TOOLS, ...full]));

console.log('\n═══ RESULTS ═══\n');
console.log('CLI-granted (system/init) on run A:');
console.log(`   ${rows[0]?.granted.length} tools total, of which mcp__files__* = ${full.length}`);
console.log(`   ${full.slice(0, 6).join(', ')}${full.length > 6 ? ', …' : ''}\n`);

for (const r of rows) {
  console.log(
    `${r.label.padEnd(20)} calls ${String(r.calls.length).padStart(2)} · deny ${String(r.denied).padStart(2)} · ok ${String(r.ok).padStart(2)} · $${r.cost.toFixed(4)}`,
  );
  console.log(`   tools called: ${r.calls.join(', ') || '(none called)'}`);
  console.log(`   said: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}\n`);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ test directory cleaned up');
