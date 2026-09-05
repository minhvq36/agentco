/**
 * SPIKE — DOES THE BROWSER ARM WORK INSIDE **THE EXACT OPTIONS THE WORKER USES**?
 *
 * Open bug (SESSIONS_MEMORY §"MCP DYING AT SPAWN HAS NO ALARM"):
 * given the task *"open youtube, watch the first video"* → the staff member
 * answers in persona voice (*"I don't see a file or folder specified by the
 * user"*), and the audit log **shows zero MCP calls**.
 *
 * `spike-arm-outside` already proved the config itself works — but it ran
 * with `tools: []` + `allowedTools: ['mcp__<hash>']`, i.e. **NOT** the
 * worker's actual option set. There are three things the worker has that
 * that measurement didn't, and all three sit right between "daemon builds
 * the config" and "MCP starts up":
 *
 *   ① `tools: [...builtin, 'ToolSearch']`   — MCP tool schemas are **deferred**
 *   ② `allowedTools: [...22 individual tool names]`   — instead of granting
 *      the whole server
 *   ③ the role's `systemPrompt`             — the "reads files and folders" persona
 *
 * This measurement asks what's DETERMINISTIC first, and the model second:
 *   A. What does `system.init` declare? (`mcp_servers[].status` · is
 *      `browser_navigate` in `tools`) — no model needed, no output tokens spent.
 *   B. Then hand it the actual real task and see which tool it calls.
 *
 * The CLI process's stderr is printed VERBATIM — that's the one piece of
 * this bug nobody has read yet.
 *
 * Run: npx tsx scripts/spike-worker-mcp-init.ts [A|B]   (A ~$0.003 · B ~$0.05)
 */

import fs from 'node:fs';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { fastLaunch } from '../src/core/armexec.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';
import { companyPaths, officePaths } from '../src/core/paths.js';
import { grantFor, injectSecrets, readSecrets } from '../src/core/secrets.js';
import { effectiveTools, TaskBriefSchema } from '../src/core/types.js';
import { KnowledgeStore } from '../src/knowledge/store.js';
import { armRoots, runWorker } from '../src/core/worker.js';

const companyDir = path.resolve('company');
const officeDir = path.join(companyDir, 'offices', 'canh-tay');
const ARM = 'a8906fe5850';
/** The exact role that gave the wrong answer, with the exact tool set declared in `roles/…yaml`. */
const ROLE_TOOLS = ['Bash'];
const ROLE_SECRETS = [
  'GITHUB_OAUTH_8D3C1087',
  'GITHUB_OAUTH_C153D5DA',
  'NOTION_ACCESS_TOKEN',
  'NOTION_OAUTH_084F6A58',
  'NOTION_OAUTH_AFAFBCD6',
];
/** The exact task the user gave at 17:29 and 17:49. */
const TASK = 'Open YouTube and tell me the title of the first video';

const cfg = loadCompanyConfig(companyDir);
const declared = cfg.mcpServers[ARM] as Record<string, unknown> | undefined;
if (!declared) throw new Error(`Arm ${ARM} not found in company.yaml`);

// ── build EXACTLY as `pickMcp` does ─────────────────────────────────────────
const { env, missing } = grantFor(readSecrets(companyPaths(companyDir)), ROLE_SECRETS);
const oPaths = officePaths(officeDir);
const withEnv = injectSecrets(declared, env, { officeState: path.join(oPaths.state, 'browser') });
const launched = fastLaunch(withEnv as Record<string, unknown>) as McpServerConfig;
const mcpServers = { [ARM]: launched };

// ── build EXACTLY as `armGrants` does ───────────────────────────────────────
const subset = cfg.arms?.[ARM]?.tools;
const armGrants = subset?.length ? subset.map((t) => `mcp__${ARM}__${t}`) : [`mcp__${ARM}`];
const searchTools = armGrants.length ? ['ToolSearch'] : [];
const armDirs = armRoots(
  { id: 'nguoi-soi-thu-muc', mcp: [ARM] } as never,
  { [ARM]: declared } as never,
);

console.log(`\narm        : ${cfg.arms[ARM]?.label ?? ARM}`);
console.log(`missing key: ${missing.length ? missing.join(', ') : '(none)'}`);
console.log(`actual run : ${JSON.stringify((launched as { command?: string }).command)} ${JSON.stringify((launched as { args?: unknown }).args)}`);
console.log(`cwd        : ${officeDir}`);
console.log(`armGrants  : ${armGrants.length} name(s) — has browser_navigate: ${armGrants.includes(`mcp__${ARM}__browser_navigate`)}`);
console.log(`armDirs    : ${JSON.stringify(armDirs)}`);
const profile = path.join(oPaths.state, 'browser', 'profile');
console.log(`profile    : ${fs.existsSync(profile) ? 'EXISTS' : 'not yet'} ${profile}\n`);

const mode = (process.argv[2] ?? 'A').toUpperCase();

/**
 * ── B · GO THROUGH THE ACTUAL PRODUCT PATH ──────────────────────────────────
 * Stop hand-building the options: call `runWorker` directly, the exact same
 * `buildWorkerPrompt` · same `pickMcp` · same hooks · same model tier the
 * daemon uses. Differs from the daemon in exactly ONE way: stderr and
 * `onArmCall` are printed to screen.
 */
if (mode === 'B') {
  const office = loadOffice(companyDir, cfg, 'canh-tay');
  const role = office.roles.get('nguoi-soi-thu-muc');
  if (!role) throw new Error('role nguoi-soi-thu-muc not found');
  console.log(`role      : ${role.display_name} · model_tier=${role.model_tier} → ${cfg.models[role.model_tier]}`);
  console.log(`tools     : ${JSON.stringify(role.tools)} · mcp: ${JSON.stringify(role.mcp)}\n`);

  /** The exact brief the Assistant built at 17:48 (`P-260829-1748-ihhb.plan.json`). */
  const brief = TaskBriefSchema.parse({
    task_id: 'T-01',
    role: role.id,
    goal:
      'Open youtube.com in a web browser, watch the first video shown on the home page ' +
      '(no login needed, no need to read any file or folder) and report the title of that video.',
    constraints: [
      'Use a real web browser to open youtube.com, do not use WebFetch/WebSearch',
      'Only report the title of the first video shown on the home page, no further analysis needed',
      'State the browser\'s current login status at the time of viewing (each task opens a fresh session, which may not be logged in)',
      'Answer briefly',
    ],
    outputs: [{ kind: 'file', path: 'artifacts/P-260829-1748-ihhb/T-01/youtube-video-title.md' }],
    deliver: 'reply',
  });

  /**
   * 🔑 THE VARIABLE UNDER TEST. The previous run passed `hotKnowledge: ''`
   * and it WORKED — so office knowledge is a suspect, and it must be computed
   * exactly the way `scheduler.execute` computes it, not estimated.
   */
  const store = new KnowledgeStore(companyDir, office.paths);
  store.scan();
  /** `''` = as in production · `nohot` = no knowledge at all · `hotonly` · `coldonly`. */
  const which = process.argv[3] ?? '';
  const none = { text: '', ids: [] as string[] };
  const realHot = store.hot(role.id, role.hot_knowledge_size, cfg.budgets.hot_knowledge_tokens);
  const realCold = store.cold(
    role.id,
    `${brief.goal} ${brief.constraints.join(' ')}`,
    Math.min(role.budget.knowledge_pack, cfg.budgets.cold_knowledge_tokens),
    realHot.ids,
  );
  let hot = which === 'nohot' || which === 'coldonly' ? none : realHot;
  let cold = which === 'nohot' || which === 'hotonly' ? none : realCold;
  /**
   * `drop:<chunk id>,<chunk id>` — drop specific chunks from COLD, then
   * rebuild the text exactly like `render()` does (`## <title>\n<body>`,
   * joined by a blank line). This is how to isolate "which chunk" without
   * touching the user's real knowledge folder.
   */
  if (which.startsWith('drop:')) {
    const pats = which.slice(5).split(',').filter(Boolean);
    const keep = realCold.ids.filter((id) => !pats.some((p) => id.includes(p)));
    const blocks = keep.map((id) => {
      const rel = id.replace(/^k\//, '');
      const file = path.join(office.paths.knowledge, `${rel}.md`);
      const raw = fs.readFileSync(file, 'utf8');
      const title = /^title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? id;
      const body = raw.split(/^---$/m).slice(2).join('---').trim();
      return `## ${title}\n${body}`;
    });
    console.log(`DROPPED: ${realCold.ids.length - keep.length} chunk(s) matching ${JSON.stringify(pats)}`);
    hot = realHot;
    cold = { text: blocks.join('\n\n'), ids: keep };
  }
  console.log(`mode : ${which || '(as in production)'}`);
  console.log(`HOT  : ${hot.ids.length} chunk(s) · ${hot.text.length} characters`);
  for (const id of hot.ids) console.log(`   · ${id}`);
  console.log(`COLD : ${cold.ids.length} chunk(s) · ${cold.text.length} characters`);
  for (const id of cold.ids) console.log(`   · ${id}`);
  console.log('');

  const t0 = Date.now();
  const r = await runWorker(
    {
      office,
      onProgress: (say) => console.log(`   · ${say}`),
      onArmCall: (c) => console.log(`   → ARM ${c.server}__${c.tool} ${JSON.stringify(c.args).slice(0, 160)}`),
    },
    { brief, role, hotKnowledge: hot.text, coldKnowledge: cold.text },
  );
  console.log(`\n[${r.status}] ${Date.now() - t0}ms · $${r.usage.costUSD.toFixed(5)}`);
  console.log(`say: ${r.say}`);
  console.log(`\nHOW TO READ THIS:\n  a "→ ARM" line appears  ⇒ the arm works, the bug is elsewhere\n  no such line at all     ⇒ the model NEVER CALLED it — bug is in the prompt/persona, NOT the MCP layer\n`);
  process.exit(0);
}

const q = query({
  // A: cheapest question, needs no tool. B: the actual real task.
  prompt: mode === 'B' ? TASK : 'Answer with exactly one word: ok',
  options: {
    // ⚠ The three lines below are what `spike-arm-outside` does NOT have — they're the variable under test.
    tools: [...effectiveTools(ROLE_TOOLS), ...searchTools],
    allowedTools: [...effectiveTools(ROLE_TOOLS), ...searchTools, ...armGrants],
    systemPrompt:
      mode === 'B'
        ? '# Your role: Folder Scanner\nReads files and folders the user points to, and summarizes the contents.'
        : 'Answer as briefly as possible.',
    model: 'claude-haiku-4-5-20251001',
    mcpServers,
    ...(armDirs.length ? { additionalDirectories: armDirs } : {}),
    cwd: officeDir,
    maxTurns: mode === 'B' ? 8 : 1,
    persistSession: false,
    settingSources: [],
    strictMcpConfig: true,
    // 🔑 THE PIECE NOBODY HAS READ YET: the CLI process's stderr, verbatim.
    stderr: (d: string) => process.stderr.write(`[stderr] ${d}`),
  },
});

let said = '';
for await (const msg of q) {
  const m = msg as Record<string, unknown>;
  if (m['type'] === 'system' && m['subtype'] === 'init') {
    const tools = (m['tools'] ?? []) as string[];
    const servers = (m['mcp_servers'] ?? []) as { name: string; status: string }[];
    console.log('── A · WHAT THE SDK DECLARES AT STARTUP ─────────────────────');
    console.log(`mcp_servers : ${JSON.stringify(servers)}`);
    console.log(`tools       : ${tools.length} total`);
    const arm = tools.filter((t) => t.startsWith('mcp__'));
    console.log(`  · MCP tools exposed   : ${arm.length}${arm.length ? ` (${arm.slice(0, 3).join(', ')}…)` : ''}`);
    console.log(`  · has browser_navigate: ${tools.includes(`mcp__${ARM}__browser_navigate`)}`);
    console.log(`  · has ToolSearch      : ${tools.includes('ToolSearch')}`);
    console.log(`  · builtin             : ${tools.filter((t) => !t.startsWith('mcp__')).join(', ')}`);
    console.log('──────────────────────────────────────────────────────────────\n');
  }
  if (m['type'] === 'assistant') {
    const content = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const b of content as Record<string, unknown>[]) {
      if (b['type'] === 'tool_use') console.log(`   → calling ${b['name']} ${JSON.stringify(b['input']).slice(0, 160)}`);
    }
  }
  if (m['type'] === 'user') {
    const content = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const b of content as Record<string, unknown>[]) {
      if (b['type'] === 'tool_result') console.log(`   ⇐ ${JSON.stringify(b['content']).slice(0, 300)}`);
    }
  }
  if (m['type'] === 'result') {
    said = String(m['result'] ?? '');
    console.log(`\ncost: $${Number(m['total_cost_usd'] ?? 0).toFixed(5)} · turns: ${m['num_turns']}`);
  }
}
console.log(`\nsaid: ${said.slice(0, 600)}\n`);
