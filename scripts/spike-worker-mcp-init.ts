/**
 * SPIKE — CÁNH TAY TRÌNH DUYỆT CÓ SỐNG BÊN TRONG **ĐÚNG BỘ OPTION CỦA WORKER** KHÔNG?
 *
 * Bug đang mở (SESSIONS_MEMORY §"MCP CHẾT LÚC SPAWN THÌ KHÔNG CÓ CHUÔNG"):
 * giao *"mở youtube xem video đầu tiên"* → nhân viên trả lời bằng giọng persona
 * (*"chưa thấy người dùng chỉ định file hoặc thư mục nào"*), nhật ký kiểm toán
 * **không có một lời gọi MCP nào**.
 *
 * `spike-arm-outside` đã chứng minh cấu hình chạy được — nhưng nó chạy với
 * `tools: []` + `allowedTools: ['mcp__<băm>']`, tức **KHÔNG phải** bộ option của
 * worker. Ba thứ worker có mà phép đo kia không có, và cả ba đều nằm đúng giữa
 * "daemon dựng cấu hình" và "MCP khởi động":
 *
 *   ① `tools: [...builtin, 'ToolSearch']`   — schema tool MCP bị **hoãn**
 *   ② `allowedTools: [...22 tên tool lẻ]`   — thay vì cấp cả server
 *   ③ `systemPrompt` của vai trò            — persona "đọc file và thư mục"
 *
 * Phép đo này hỏi TẤT ĐỊNH trước, hỏi model sau:
 *   A. `system.init` khai gì? (`mcp_servers[].status` · có `browser_navigate`
 *      trong `tools` không) — không cần model, không tốn token đầu ra.
 *   B. Rồi mới giao đúng câu việc thật và xem nó gọi tool nào.
 *
 * stderr của tiến trình CLI được in NGUYÊN VĂN — đó chính là mẩu duy nhất chưa
 * đọc được của bug này.
 *
 * Chạy: npx tsx scripts/spike-worker-mcp-init.ts [A|B]   (A ~$0,003 · B ~$0,05)
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
/** Đúng vai trò đã trả lời sai, đúng bộ tool khai trong `roles/…yaml`. */
const ROLE_TOOLS = ['Bash'];
const ROLE_SECRETS = [
  'GITHUB_OAUTH_8D3C1087',
  'GITHUB_OAUTH_C153D5DA',
  'NOTION_ACCESS_TOKEN',
  'NOTION_OAUTH_084F6A58',
  'NOTION_OAUTH_AFAFBCD6',
];
/** Nguyên văn câu việc user giao lúc 17:29 và 17:49. */
const TASK = 'Mở YouTube xem tiêu đề video đầu tiên';

const cfg = loadCompanyConfig(companyDir);
const declared = cfg.mcpServers[ARM] as Record<string, unknown> | undefined;
if (!declared) throw new Error(`Không thấy cánh tay ${ARM} trong company.yaml`);

// ── dựng CHÍNH XÁC như `pickMcp` ────────────────────────────────────────────
const { env, missing } = grantFor(readSecrets(companyPaths(companyDir)), ROLE_SECRETS);
const oPaths = officePaths(officeDir);
const withEnv = injectSecrets(declared, env, { officeState: path.join(oPaths.state, 'browser') });
const launched = fastLaunch(withEnv as Record<string, unknown>) as McpServerConfig;
const mcpServers = { [ARM]: launched };

// ── dựng CHÍNH XÁC như `armGrants` ──────────────────────────────────────────
const subset = cfg.arms?.[ARM]?.tools;
const armGrants = subset?.length ? subset.map((t) => `mcp__${ARM}__${t}`) : [`mcp__${ARM}`];
const searchTools = armGrants.length ? ['ToolSearch'] : [];
const armDirs = armRoots(
  { id: 'nguoi-soi-thu-muc', mcp: [ARM] } as never,
  { [ARM]: declared } as never,
);

console.log(`\ncánh tay   : ${cfg.arms[ARM]?.label ?? ARM}`);
console.log(`chìa thiếu : ${missing.length ? missing.join(', ') : '(không)'}`);
console.log(`chạy thật  : ${JSON.stringify((launched as { command?: string }).command)} ${JSON.stringify((launched as { args?: unknown }).args)}`);
console.log(`cwd        : ${officeDir}`);
console.log(`armGrants  : ${armGrants.length} tên — có browser_navigate: ${armGrants.includes(`mcp__${ARM}__browser_navigate`)}`);
console.log(`armDirs    : ${JSON.stringify(armDirs)}`);
const profile = path.join(oPaths.state, 'browser', 'profile');
console.log(`hồ sơ      : ${fs.existsSync(profile) ? 'CÓ' : 'chưa có'} ${profile}\n`);

const mode = (process.argv[2] ?? 'A').toUpperCase();

/**
 * ── B · ĐI ĐÚNG ĐƯỜNG SẢN PHẨM ──────────────────────────────────────────────
 * Không dựng lại option bằng tay nữa: gọi thẳng `runWorker`, tức cùng
 * `buildWorkerPrompt` · cùng `pickMcp` · cùng hook · cùng model tier mà daemon
 * dùng. Khác daemon đúng MỘT thứ: stderr và `onArmCall` in ra màn hình.
 */
if (mode === 'B') {
  const office = loadOffice(companyDir, cfg, 'canh-tay');
  const role = office.roles.get('nguoi-soi-thu-muc');
  if (!role) throw new Error('không có vai trò nguoi-soi-thu-muc');
  console.log(`vai trò   : ${role.display_name} · model_tier=${role.model_tier} → ${cfg.models[role.model_tier]}`);
  console.log(`tools     : ${JSON.stringify(role.tools)} · mcp: ${JSON.stringify(role.mcp)}\n`);

  /** Nguyên văn brief mà Trợ lý đã dựng lúc 17:48 (`P-260829-1748-ihhb.plan.json`). */
  const brief = TaskBriefSchema.parse({
    task_id: 'T-01',
    role: role.id,
    goal:
      'Mở trang youtube.com bằng trình duyệt web, xem video đầu tiên hiển thị trên trang chủ ' +
      '(không cần đăng nhập, không cần đọc file hay thư mục nào) và cho biết tiêu đề của video đó.',
    constraints: [
      'Dùng trình duyệt web thật để mở youtube.com, không dùng WebFetch/WebSearch',
      'Chỉ cần nêu tiêu đề video đầu tiên hiển thị trên trang chủ, không cần phân tích thêm',
      'Ghi rõ trạng thái đăng nhập hiện tại của trình duyệt lúc xem (vì mỗi lượt việc mở phiên mới, có thể chưa đăng nhập)',
      'Trả lời ngắn gọn bằng tiếng Việt',
    ],
    outputs: [{ kind: 'file', path: 'artifacts/P-260829-1748-ihhb/T-01/tieu-de-video-youtube.md' }],
    deliver: 'reply',
  });

  /**
   * 🔑 BIẾN CỦA PHÉP ĐO. Lần chạy trước tôi truyền `hotKnowledge: ''` và nó
   * CHẠY ĐƯỢC — nên kinh nghiệm office là nghi phạm, và phải tính đúng cách
   * `scheduler.execute` tính, không được ước lượng.
   */
  const store = new KnowledgeStore(companyDir, office.paths);
  store.scan();
  /** `''` = như thật · `nohot` = không kinh nghiệm · `hotonly` · `coldonly`. */
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
   * `drop:<mảnh id>,<mảnh id>` — bỏ đúng vài mẩu khỏi COLD rồi dựng lại text y
   * hệt `render()` (`## <title>\n<body>`, nối bằng dòng trống). Đây là cách tách
   * "mẩu nào" mà không phải đụng vào thư mục knowledge thật của người dùng.
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
    console.log(`BỎ   : ${realCold.ids.length - keep.length} mẩu khớp ${JSON.stringify(pats)}`);
    hot = realHot;
    cold = { text: blocks.join('\n\n'), ids: keep };
  }
  console.log(`chế độ: ${which || '(như thật)'}`);
  console.log(`HOT  : ${hot.ids.length} mẩu · ${hot.text.length} ký tự`);
  for (const id of hot.ids) console.log(`   · ${id}`);
  console.log(`COLD : ${cold.ids.length} mẩu · ${cold.text.length} ký tự`);
  for (const id of cold.ids) console.log(`   · ${id}`);
  console.log('');

  const t0 = Date.now();
  const r = await runWorker(
    {
      office,
      onProgress: (say) => console.log(`   · ${say}`),
      onArmCall: (c) => console.log(`   → CÁNH TAY ${c.server}__${c.tool} ${JSON.stringify(c.args).slice(0, 160)}`),
    },
    { brief, role, hotKnowledge: hot.text, coldKnowledge: cold.text },
  );
  console.log(`\n[${r.status}] ${Date.now() - t0}ms · $${r.usage.costUSD.toFixed(5)}`);
  console.log(`say: ${r.say}`);
  console.log(`\nCÁCH ĐỌC:\n  có dòng "→ CÁNH TAY"  ⇒ cánh tay sống, bug nằm chỗ khác\n  không có dòng nào    ⇒ model KHÔNG GỌI — bug ở prompt/persona, KHÔNG ở MCP\n`);
  process.exit(0);
}

const q = query({
  // A: câu rẻ nhất không cần tool. B: đúng câu việc thật.
  prompt: mode === 'B' ? TASK : 'Trả lời đúng một từ: ok',
  options: {
    // ⚠ Ba dòng dưới là thứ `spike-arm-outside` KHÔNG có — chúng là biến của phép đo.
    tools: [...effectiveTools(ROLE_TOOLS), ...searchTools],
    allowedTools: [...effectiveTools(ROLE_TOOLS), ...searchTools, ...armGrants],
    systemPrompt:
      mode === 'B'
        ? '# Your role: Người soi thư mục\nĐọc file và thư mục người dùng chỉ định, tóm tắt nội dung.'
        : 'Trả lời cực ngắn.',
    model: 'claude-haiku-4-5-20251001',
    mcpServers,
    ...(armDirs.length ? { additionalDirectories: armDirs } : {}),
    cwd: officeDir,
    maxTurns: mode === 'B' ? 8 : 1,
    persistSession: false,
    settingSources: [],
    strictMcpConfig: true,
    // 🔑 MẨU CHƯA AI ĐỌC ĐƯỢC: stderr của tiến trình CLI, nguyên văn.
    stderr: (d: string) => process.stderr.write(`[stderr] ${d}`),
  },
});

let said = '';
for await (const msg of q) {
  const m = msg as Record<string, unknown>;
  if (m['type'] === 'system' && m['subtype'] === 'init') {
    const tools = (m['tools'] ?? []) as string[];
    const servers = (m['mcp_servers'] ?? []) as { name: string; status: string }[];
    console.log('── A · SDK KHAI GÌ LÚC KHỞI ĐỘNG ─────────────────────────────');
    console.log(`mcp_servers : ${JSON.stringify(servers)}`);
    console.log(`tools       : ${tools.length} cái`);
    const arm = tools.filter((t) => t.startsWith('mcp__'));
    console.log(`  · tool MCP hiện ra    : ${arm.length}${arm.length ? ` (${arm.slice(0, 3).join(', ')}…)` : ''}`);
    console.log(`  · có browser_navigate : ${tools.includes(`mcp__${ARM}__browser_navigate`)}`);
    console.log(`  · có ToolSearch       : ${tools.includes('ToolSearch')}`);
    console.log(`  · builtin             : ${tools.filter((t) => !t.startsWith('mcp__')).join(', ')}`);
    console.log('──────────────────────────────────────────────────────────────\n');
  }
  if (m['type'] === 'assistant') {
    const content = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const b of content as Record<string, unknown>[]) {
      if (b['type'] === 'tool_use') console.log(`   → gọi ${b['name']} ${JSON.stringify(b['input']).slice(0, 160)}`);
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
    console.log(`\nchi phí: $${Number(m['total_cost_usd'] ?? 0).toFixed(5)} · lượt: ${m['num_turns']}`);
  }
}
console.log(`\nnói: ${said.slice(0, 600)}\n`);
