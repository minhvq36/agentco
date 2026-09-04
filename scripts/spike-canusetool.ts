
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const office = fs.mkdtempSync(path.join(os.tmpdir(), 'canuse-'));
fs.writeFileSync(path.join(office, 'ghi-chu.txt'), 'ban dau\n');

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, office] };

const BASE = ['Read', 'Glob', 'Grep'];

interface Ca {
  label: string;
  allow: string[];
  cb?: 'allow' | 'deny';
  via: 'mcp' | 'builtin';
}

async function chay(ca: Ca) {
  console.log(`\n── ${ca.label}`);
  const fired: string[] = [];
  const calls: string[] = [];
  let ketQua = '';

  const q = query({
    prompt:
      ca.via === 'mcp'
        ? `Use the "files" connection's tool to overwrite file ghi-chu.txt in directory "${office}" with the string "DA GHI". Do exactly that and nothing else.`
        : `Overwrite file "${path.join(office, 'ghi-chu.txt')}" with the string "DA GHI". Do exactly that and nothing else.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Answer as briefly as possible, in Vietnamese.',
      tools: ca.via === 'builtin' ? [...BASE, 'Write'] : BASE,
      allowedTools: ca.allow,
      ...(ca.via === 'mcp' ? { mcpServers: { files: FILES } } : {}),
      cwd: office,
      maxTurns: 3,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(ca.cb
        ? {
            canUseTool: async (toolName: string, input: Record<string, unknown>) => {
              fired.push(toolName);
              return ca.cb === 'allow'
                ? ({ behavior: 'allow', updatedInput: input } as never)
                : ({ behavior: 'deny', message: 'TEST DENIAL — the callback fired.' } as never);
            },
          }
        : {}),
    },
  });

  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'assistant') {
        for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
          if (b['type'] === 'tool_use') calls.push(String(b['name']));
        }
      }
      if (m['type'] === 'user') {
        for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
          if (b['type'] === 'tool_result') {
            ketQua = JSON.stringify(b['content']).replace(/\s+/g, ' ').slice(0, 160);
          }
        }
      }
    }
  } catch (e) {
    ketQua = `⟨threw⟩ ${(e as Error).message.slice(0, 120)}`;
  }

  const tren_dia = fs.readFileSync(path.join(office, 'ghi-chu.txt'), 'utf8').trim();
  fs.writeFileSync(path.join(office, 'ghi-chu.txt'), 'ban dau\n');

  console.log(`   tool model called : ${calls.join(', ') || '(none)'}`);
  console.log(`   canUseTool fired  : ${fired.length ? `✅ ${fired.length}x → ${fired.join(', ')}` : '❌ NO'}`);
  console.log(`   tool result       : ${ketQua || '(none)'}`);
  console.log(`   FILE ON DISK      : "${tren_dia}" ${tren_dia === 'DA GHI' ? '⇒ ACTUALLY WRITTEN' : '⇒ unchanged'}`);
}

const CA: Ca[] = [
  { label: 'A · mcp INSIDE allowedTools · NO callback  (control)', allow: [...BASE, 'mcp__files'], via: 'mcp' },
  { label: 'B · mcp INSIDE allowedTools · HAS callback',            allow: [...BASE, 'mcp__files'], cb: 'allow', via: 'mcp' },
  { label: 'C · mcp OUTSIDE allowedTools · HAS callback   ⭐',      allow: BASE,                    cb: 'allow', via: 'mcp' },
  { label: 'D · builtin Write OUTSIDE allowedTools · HAS callback', allow: BASE,                    cb: 'allow', via: 'builtin' },
  { label: 'E · mcp OUTSIDE allowedTools · callback DENIES  ⭐',    allow: BASE,                    cb: 'deny',  via: 'mcp' },
];

const chi = process.argv.slice(2).map((s) => s.toUpperCase());
for (const ca of CA) if (!chi.length || chi.includes(ca.label[0]!)) await chay(ca);

fs.rmSync(office, { recursive: true, force: true });
console.log('\n↩ cleaned up');
