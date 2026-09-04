/**
 * SUPPLEMENTARY SPIKE 2 — DOES `PreToolUse` FIRE FOR MCP TOOLS?
 *
 * The BLOCKING question for the "make arms work" patch: if we put
 * `mcp__<server>` into `allowedTools`, the filesystem arm will be able to
 * read/write — including `roles/*.yaml` and `<office>/.state/`, i.e. going
 * straight around the two `guardedZone` areas just built on 08/23. That
 * fence can only be widened if the hook fires for `mcp__*` names.
 *
 * `SPEC-arms` §5f notes *"matches in principle, NOT MEASURED"*. This is that
 * measurement.
 *
 * Three runs, one variable:
 *   A  no hook                      → MUST be able to read (control)
 *   B  matcher `mcp__.*` deny       → does the hook fire
 *   C  matcher `.*` deny            → in case the prefix matcher doesn't match
 *
 * Run: npx tsx scripts/spike-mcp-hook.ts  (~$0.01)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const office = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphook-'));
fs.mkdirSync(path.join(office, 'roles'), { recursive: true });
fs.writeFileSync(path.join(office, 'roles', 'nguoi-viet.yaml'), 'id: nguoi-viet\ntools: []\n');

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, office] };

const deny = async (): Promise<Record<string, unknown>> => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'TEST BLOCK — the hook fired.',
  },
});

async function ca(label: string, matcher?: string) {
  console.log(`\n── ${label}`);
  let fired = 0;
  const q = query({
    prompt: `Read the file roles/nguoi-viet.yaml in "${office}" using the files connector's tool and print its content.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Answer briefly.',
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__files'],
      mcpServers: { files: FILES },
      cwd: office,
      maxTurns: 3,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(matcher
        ? {
            hooks: {
              PreToolUse: [
                {
                  matcher,
                  hooks: [
                    async (input: Record<string, unknown>) => {
                      if (String(input['tool_name'] ?? '').startsWith('mcp__')) fired++;
                      return deny();
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    },
  });
  const calls: string[] = [];
  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'assistant') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) {
          if (b['type'] === 'tool_use') calls.push(String(b['name']));
        }
      }
      if (m['type'] === 'user') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) {
          if (b['type'] === 'tool_result') {
            console.log(`   ⇒ ${JSON.stringify(b['content']).replace(/\s+/g, ' ').slice(0, 180)}`);
          }
        }
      }
      if (m['type'] === 'result') {
        console.log(`   said: ${String(m['result'] ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
  } catch (e) {
    console.log(`   ⟨threw⟩ ${(e as Error).message.slice(0, 100)}`);
  }
  console.log(`   tools called: ${calls.join(', ') || '(none)'} · hook fired for mcp__*: ${fired}`);
}

await ca('A · NO hook (control — must be able to read)');
await ca('B · matcher "mcp__.*"', 'mcp__.*');
await ca('C · matcher ".*"', '.*');

fs.rmSync(office, { recursive: true, force: true });
console.log('\n↩ cleaned up');
