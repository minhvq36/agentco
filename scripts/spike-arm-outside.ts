
import fs from 'node:fs';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { fastLaunch } from '../src/core/armexec.js';
import { folderRoots } from '../src/core/catalog.js';
import { loadCompanyConfig } from '../src/core/config.js';

const companyDir = path.resolve('company');
const officeDir = path.join(companyDir, 'offices', 'canh-tay');

const ARM = 'a385afc3ab6';
const OUTSIDE = 'D:\\Works\\Ho so ca nhan\\CV.pdf';

const cfg = loadCompanyConfig(companyDir);
const declared = cfg.mcpServers[ARM] as Record<string, unknown> | undefined;
if (!declared) throw new Error(`Arm ${ARM} not found in company.yaml`);

const launched = fastLaunch(declared as never) as McpServerConfig;
console.log(`\narm       : ${cfg.arms[ARM]?.label ?? ARM}`);
console.log(`declared  : ${JSON.stringify((declared as { args?: unknown }).args)}`);
console.log(`actual    : ${JSON.stringify((launched as { args?: unknown }).args)}`);
console.log(`cwd       : ${officeDir}`);
console.log(`asking about : ${OUTSIDE}\n`);

const armDirs = folderRoots(launched).filter((d) => {
  try {
    return fs.statSync(d).isDirectory();
  } catch {
    return false;
  }
});
console.log(`additionalDirectories: ${JSON.stringify(armDirs)}\n`);

async function ask(label: string, prompt: string, useArm: boolean) {
  console.log(`── ${label}`);
  const q = query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Call the requested tool. Answer as briefly as possible.',
      tools: useArm ? [] : ['Read', 'Glob'],
      allowedTools: useArm ? [`mcp__${ARM}`] : ['Read', 'Glob'],
      ...(useArm ? { mcpServers: { [ARM]: launched }, additionalDirectories: armDirs } : {}),
      cwd: officeDir,
      maxTurns: 4,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });
  let said = '';
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;
    if (m['type'] === 'result') said = String(m['result'] ?? '');
    if (m['type'] !== 'user') continue;
    const content = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const b of content as Record<string, unknown>[]) {
      if (b['type'] === 'tool_result') console.log(`   ⇒ ${JSON.stringify(b['content']).slice(0, 420)}`);
    }
  }
  console.log(`   said: ${said.slice(0, 200)}\n`);
}

await ask(
  'A · ARM, exact real-worker config',
  `Do exactly two things: 1) call list_allowed_directories. 2) call get_file_info with path = "${OUTSIDE}".`,
  true,
);
await ask(
  'B · BUILTIN, no arm at all — this is where "measured how" lives',
  `State the exact SIZE (bytes or KB) of file "${OUTSIDE}". Only use Read/Glob.`,
  false,
);

console.log(
  `HOW TO READ THIS:\n` +
    `  A · get_file_info returns SIZE     ⇒ allowlist has a hole — §1d loses its premise\n` +
    `  A · get_file_info is DENIED        ⇒ allowlist holds\n` +
    `  B · returns the CORRECT number     ⇒ builtin can measure size ⇒ §14 #1 is broader than we thought\n` +
    `  B · no result / wrong number       ⇒ the size in the real case comes from somewhere else, keep digging\n`,
);
