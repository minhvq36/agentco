/**
 * SDK ĐƯA CHO TA CÁI GÌ — so với thứ server THẬT SỰ khai.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `spike-notion-annotations.ts` hỏi thẳng Notion bằng JSON-RPC: **14 read ·│
 * │ 11 add · 3 full**, cả ba nấc đều có thật. Nhưng giao diện chỉ hiện HAI    │
 * │ (Chỉ đọc / Toàn quyền) — user bắt 26/08.                                 │
 * │                                                                          │
 * │ Hai phép đo đó hỏi hai thứ khác nhau, và khoảng giữa chúng là **SDK**:    │
 * │   server khai `destructiveHint: false`  →  SDK chuẩn hoá thành `?`       │
 * │                                                                          │
 * │ Nếu SDK bỏ trường `false` đi thì `tierOf` thấy `destructive === undefined`│
 * │ ⇒ theo luật một chiều nó **leo thang** ⇒ 25 tool ghi rơi hết vào `full` ⇒ │
 * │ nấc giữa biến mất. Luật một chiều **không sai**; nó đang xử lý một dữ     │
 * │ kiện đã bị mất trên đường.                                               │
 * │                                                                          │
 * │ ⚠ Đây đúng câu hỏi [[agentco-measurement-vs-conclusion]] bắt phải hỏi:   │
 * │ *"phép đo này có đi qua đúng con đường production đi không?"* — phép đo   │
 * │ JSON-RPC thì KHÔNG: production đọc annotations qua SDK.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npx tsx scripts/spike-sdk-annotations.ts   ($0)
 */

import fs from 'node:fs';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

const STORE = path.join(process.cwd(), 'company', '.state', 'secrets.json');
const raw = JSON.parse(fs.readFileSync(STORE, 'utf8')) as Record<string, unknown>;
const accounts = (raw['$oauth'] ?? {}) as Record<string, { access_token?: string; label?: string }>;
const acc = Object.values(accounts)[0];
if (!acc?.access_token) {
  console.error('Chưa có tài khoản Notion — đăng nhập ở giao diện trước.');
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
console.log(`SDK trả ${tools.length} tool\n`);

const count = { read: 0, add: 0, full: 0 };
console.log('tool'.padEnd(34), 'annotations SDK đưa cho ta');
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
  `\n⇒ So với thứ server khai (14 · 11 · 3): ` +
    (count.read === 14 && count.add === 11 && count.full === 3
      ? 'KHỚP — lỗi nằm ở chỗ khác.'
      : '🔴 LỆCH. SDK làm mất dữ kiện trên đường.'),
);

release?.();
await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
