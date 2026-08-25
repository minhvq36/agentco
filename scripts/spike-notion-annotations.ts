/**
 * ĐO THẬT: mỗi tool của Notion khai `annotations` GÌ — từng trường một.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO CẦN ĐO LẠI: user hỏi 26/08 *"sao bạn nói Notion viết sạch có 3     │
 * │ level mà lúc tạo chỉ có 2 (Chỉ đọc và Toàn quyền)?"*                     │
 * │                                                                          │
 * │ Câu "14 đọc · 11 thêm · 3 sửa" trong spec là một **SUY LUẬN**, không phải │
 * │ số đo: tôi lấy "3 tool có `destructive: true`" rồi kết luận 11 tool còn   │
 * │ lại là `destructive: false`. Nhưng **vắng mặt ≠ false** — và `tierOf` xử  │
 * │ đúng theo luật một chiều (không khai ⇒ leo thang), nên nếu 11 tool đó bỏ  │
 * │ trống `destructiveHint` thì chúng rơi hết vào `full` và nấc giữa BIẾN MẤT.│
 * │                                                                          │
 * │ Đúng lớp lỗi [[agentco-measurement-vs-conclusion]], lần thứ tư: số liệu   │
 * │ thật + một bước suy sai, rồi bảng suy sai đó được viết vào spec kèm số.   │
 * │ Giao diện nói 2 nấc là giao diện ĐÚNG; cái sai là dòng trong tài liệu.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Không import SDK hãng nào — cùng luật với `core/oauth.ts`.
 *
 * Chạy: npx tsx scripts/spike-notion-annotations.ts   ($0 — không lượt suy luận nào)
 */

import fs from 'node:fs';
import path from 'node:path';

const MCP = 'https://mcp.notion.com/mcp';
const STORE = path.join(process.cwd(), 'company', '.state', 'secrets.json');

const raw = JSON.parse(fs.readFileSync(STORE, 'utf8')) as Record<string, unknown>;
const accounts = (raw['$oauth'] ?? {}) as Record<string, { access_token?: string; label?: string }>;
const first = Object.entries(accounts)[0];
if (!first?.[1]?.access_token) {
  console.error('Chưa có tài khoản Notion nào trong company/.state/secrets.json — đăng nhập ở giao diện trước.');
  process.exit(1);
}
console.log(`Workspace: ${first[1].label ?? first[0]}\n`);

const call = async (method: string, params: unknown, id: number) => {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${first[1].access_token}`,
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  const text = await res.text();
  // Streamable HTTP trả SSE: bóc dòng `data:` đầu tiên.
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5).trim() : text) as { result?: unknown; error?: unknown };
};

let session = '';

await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'agentco-spike', version: '1' },
}, 1);
await fetch(MCP, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${first[1].access_token}`,
    'mcp-session-id': session,
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
});

const r = await call('tools/list', {}, 2);
const tools = (r.result as { tools?: { name: string; annotations?: Record<string, unknown> }[] })?.tools ?? [];
if (!tools.length) {
  console.error('Không lấy được danh sách tool:', JSON.stringify(r).slice(0, 400));
  process.exit(1);
}

/** Đúng luật `probe.ts §tierOf` — chép ở đây để spike không phụ thuộc build. */
const tierOf = (a?: Record<string, unknown>) => {
  const ro = a?.['readOnlyHint'] ?? a?.['readOnly'];
  const de = a?.['destructiveHint'] ?? a?.['destructive'];
  if (ro === true && de !== true) return 'read';
  return ro === false && de === false ? 'add' : 'full';
};

const count = { read: 0, add: 0, full: 0 };
console.log('tool'.padEnd(34), 'readOnly'.padEnd(10), 'destructive'.padEnd(12), 'nấc');
console.log('─'.repeat(70));
for (const t of tools.sort((x, y) => x.name.localeCompare(y.name))) {
  const a = t.annotations ?? {};
  const ro = a['readOnlyHint'] ?? a['readOnly'];
  const de = a['destructiveHint'] ?? a['destructive'];
  const tier = tierOf(a);
  count[tier]++;
  console.log(
    t.name.padEnd(34),
    String(ro ?? '(vắng)').padEnd(10),
    String(de ?? '(vắng)').padEnd(12),
    tier,
  );
}

console.log('─'.repeat(70));
console.log(`TỔNG ${tools.length} tool  ·  read ${count.read}  ·  add ${count.add}  ·  full ${count.full}`);
console.log(
  `\nNấc HIỆN RA trên giao diện (luật "chỉ hiện nếu THÊM ≥1 việc so với nấc dưới"):\n` +
    [
      ['Chỉ đọc', count.read],
      ['Đọc + Thêm', count.read + count.add],
      ['Toàn quyền', count.read + count.add + count.full],
    ]
      .filter(([, n], i, all) => (i === 0 ? (n as number) > 0 : (n as number) > (all[i - 1]![1] as number)))
      .map(([name, n]) => `  ◦ ${name} — ${n} việc`)
      .join('\n'),
);
