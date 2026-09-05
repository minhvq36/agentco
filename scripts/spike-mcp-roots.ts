/**
 * SUPPLEMENTARY SPIKE — who does server-filesystem listen to: our `args`, or
 * the CLI's `roots`?
 *
 * Runs B/C of `spike-mcp-allow.ts` got rejected by the MCP server itself:
 *   "Access denied - path outside allowed directories: <the directory we passed>
 *    not in D:\Works\…\agentco"   ← that's `cwd`, NOT the args we sent.
 *
 * Hypothesis: the MCP protocol has `roots`; the client (Claude Code) declares
 * `cwd` as the root, and server-filesystem PRIORITIZES roots over the
 * command-line argument. If true, the "allowed directory" field in the
 * Connections dialog is DECORATIVE — the server will only allow reading the
 * office's own directory.
 *
 * Single variable: `cwd`. Same `args`, two different `cwd` values.
 * Print the `list_allowed_directories` result VERBATIM.
 *
 * Run: npx tsx scripts/spike-mcp-roots.ts  (~$0.005)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcproots-'));
const target = path.join(root, 'muc-tieu'); // what we PASS in args
const office = path.join(root, 'van-phong'); // what we set as cwd
fs.mkdirSync(target, { recursive: true });
fs.mkdirSync(office, { recursive: true });

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, target] };

async function ask(label: string, cwd: string, extra?: string[]) {
  console.log(
    `\n── ${label}\n   args → ${target}\n   cwd  → ${cwd}` +
      (extra ? `\n   additionalDirectories → ${extra.join(', ')}` : ''),
  );
  const q = query({
    prompt: 'Call the list_allowed_directories tool and print the result verbatim. Do nothing else.',
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Answer briefly.',
      tools: ['Read'],
      allowedTools: ['Read', 'mcp__files'],
      mcpServers: { files: FILES },
      cwd,
      ...(extra ? { additionalDirectories: extra } : {}),
      maxTurns: 3,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });
  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] !== 'user') continue;
      const content = (m['message'] as { content?: unknown[] })?.content ?? [];
      for (const b of content as Record<string, unknown>[]) {
        if (b['type'] === 'tool_result') {
          console.log(`   ⇒ ${JSON.stringify(b['content']).slice(0, 400)}`);
        }
      }
    }
  } catch (e) {
    console.log(`   ⟨threw⟩ ${(e as Error).message.slice(0, 120)}`);
  }
}

await ask('A · cwd = the OFFICE directory (matches a real worker)', office);
await ask('B · cwd = the TARGET directory itself', target);
await ask('C · cwd = office + additionalDirectories = target', office, [target]);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n↩ cleaned up');
