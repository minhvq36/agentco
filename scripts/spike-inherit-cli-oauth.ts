/**
 * THE ONLY QUESTION: for an HTTP MCP server that **the user's Claude Code CLI**
 * has already logged into via OAuth — can the process spawned by the **Agent
 * SDK** reuse that same key, while we still keep `strictMcpConfig: true` +
 * `settingSources: []` as in `worker.ts §324-325`?
 *
 * Why this matters: Figma's gateway filters by `client_name` at dynamic
 * registration time (measured 08/29: `agentco` -> 403 empty body ·
 * `Claude Code` -> 200). If the CLI's key can be reused, agentco **doesn't
 * need** Figma's approval — Claude Code is already on the allowlist, and the
 * one who logged in is the user, not us.
 *
 * WARNING: MEASURE WITH GOOGLE DRIVE, NOT FIGMA. Same shape (HTTP + OAuth
 * stored in the CLI), but Drive is **already logged in** on this machine so
 * it can be measured right away, with no Figma account and no one needing to
 * click consent. What's being measured is the **key inheritance mechanism**,
 * not Figma.
 *
 * Run: npx tsx scripts/spike-inherit-cli-oauth.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

type InitInfo = { name: string; status: string }[];

const DRIVE = { type: 'http' as const, url: 'https://drivemcp.googleapis.com/mcp/v1' };
const FIGMA = { type: 'http' as const, url: 'https://mcp.figma.com/mcp' };

async function probe(
  label: string,
  opts: Record<string, unknown>,
): Promise<void> {
  const t0 = Date.now();
  let seen: InitInfo | null = null;
  const errs: string[] = [];
  try {
    for await (const m of query({
      prompt: 'ok',
      options: {
        maxTurns: 1,
        persistSession: false,
        allowedTools: [],
        systemPrompt: 'Reply with one word.',
        stderr: (s: string) => {
          const line = s.trim();
          if (line && /mcp|oauth|auth|401|403/i.test(line)) errs.push(line.slice(0, 300));
        },
        ...opts,
      },
    } as never)) {
      const msg = m as { type?: string; subtype?: string; mcp_servers?: InitInfo };
      if (msg.type === 'system' && msg.subtype === 'init') {
        seen = msg.mcp_servers ?? [];
        break; // only need the handshake, no need to run the full turn
      }
    }
  } catch (e) {
    errs.push(`THROW ${(e as Error).message.slice(0, 300)}`);
  }
  console.log(`\n── ${label}   (${Date.now() - t0}ms)`);
  console.log('   mcp_servers:', seen === null ? '(no system.init seen)' : JSON.stringify(seen));
  for (const e of errs.slice(0, 6)) console.log('   stderr:', e);
}

async function main(): Promise<void> {
  // ① The exact shape worker.ts uses today.
  await probe('A · drive · strictMcpConfig:true · settingSources:[]  ← worker.ts shape', {
    strictMcpConfig: true,
    settingSources: [],
    mcpServers: { drive: DRIVE },
  });

  // ② Relax `settingSources` — if A fails but B works, the key follows settings.
  await probe('B · drive · strictMcpConfig:true · settingSources:["user"]', {
    strictMcpConfig: true,
    settingSources: ['user'],
    mcpServers: { drive: DRIVE },
  });

  // ③ Declare nothing at all — does the CLI auto-load the user's server or not.
  await probe('C · NO mcpServers declared · settingSources:["user"] · strict:false', {
    settingSources: ['user'],
  });

  // ④ Control: Figma is NOT logged in. Must differ from A if A truly reuses the key.
  await probe('D · figma (not logged in) · strictMcpConfig:true · settingSources:[]', {
    strictMcpConfig: true,
    settingSources: [],
    mcpServers: { figma: FIGMA },
  });
}

void main();
