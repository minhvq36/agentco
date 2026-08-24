/**
 * SPIKE — TOOL CỦA MCP CÓ ĐƯỢC TỰ DUYỆT KHÔNG?
 *
 * Sinh ra từ ca 9 chạy 24/08 (`P-260824-0355-r3qe`): vai trò `nguoi-kiem-ke` CÓ
 * cánh tay filesystem trỏ đúng `D:\Downloads\Programs Installation`, gọi tool ba
 * lần, và cả ba lần nhận *"permission denied"*. $0,0948 cho 0 kết quả.
 *
 * Giả thuyết: `worker.ts` gửi `allowedTools = effectiveTools(role.tools)` — chỉ
 * 7 tool văn phòng (+ shell). Tên tool MCP (`mcp__<server>__<tool>`) KHÔNG nằm
 * trong đó ⇒ SDK coi chúng là "cần hỏi" ⇒ không có `canUseTool` ⇒ **deny**.
 *
 * Nếu đúng: mỗi cánh tay cắm vào tốn ~2 185 token/lượt (đo 23/08) cho một bộ
 * tool KHÔNG BAO GIỜ dùng được. Trả tiền cho một cánh tay bị trói.
 *
 * Ba điều kiện, một biến mỗi lần:
 *   A  allowedTools = 7 tool          (đúng production hôm nay)
 *   B  allowedTools += `mcp__files`   (tiền tố cấp SERVER)
 *   C  allowedTools += tên đầy đủ     (`mcp__files__list_directory`, …)
 *
 * In ra thứ THẤY trước thứ SUY: `system/init.tools`, từng `tool_use`, từng
 * `tool_result` kèm `is_error`. → [[agentco-measurement-vs-conclusion]]
 *
 * Chạy: npx tsx scripts/spike-mcp-allow.ts   (~$0,01, haiku, 3 lượt)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const OFFICE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

// Thư mục thử có DẤU CÁCH trong tên — giống hệt ca thật của user.
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
      `Liệt kê các file trong thư mục "${dir}" kèm kích thước từng file. ` +
      `Dùng công cụ đang có. Trả lời ngắn gọn bằng tiếng Việt.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Bạn là nhân viên kiểm kê file.',
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

    // tool_result đi trong tin `user` — đây là chỗ DUY NHẤT thấy được deny.
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
    // Chạm trần lượt / kết quả lỗi ⇒ SDK ném. Đó là DỮ LIỆU, không phải sự cố.
    row.text = `⟨ném⟩ ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 140)}`;
  }
  return row;
}

const rows: Row[] = [];

console.log(`\nthư mục thử: ${dir}\n`);

console.log('── A · allowedTools = 7 tool văn phòng (ĐÚNG production hôm nay)');
rows.push(await run('A · 7 tool', OFFICE_TOOLS));

console.log('\n── B · allowedTools += "mcp__files" (tiền tố cấp SERVER)');
rows.push(await run('B · + mcp__files', [...OFFICE_TOOLS, 'mcp__files']));

console.log('\n── C · allowedTools += tên tool đầy đủ');
const full = rows[0]?.granted.filter((t) => t.startsWith('mcp__files__')) ?? [];
rows.push(await run('C · + tên đầy đủ', [...OFFICE_TOOLS, ...full]));

console.log('\n═══ KẾT QUẢ ═══\n');
console.log('CLI cấp (system/init) ở lượt A:');
console.log(`   tổng ${rows[0]?.granted.length} tool, trong đó mcp__files__* = ${full.length}`);
console.log(`   ${full.slice(0, 6).join(', ')}${full.length > 6 ? ', …' : ''}\n`);

for (const r of rows) {
  console.log(
    `${r.label.padEnd(20)} gọi ${String(r.calls.length).padStart(2)} · deny ${String(r.denied).padStart(2)} · ok ${String(r.ok).padStart(2)} · $${r.cost.toFixed(4)}`,
  );
  console.log(`   tool đã gọi: ${r.calls.join(', ') || '(không gọi tool nào)'}`);
  console.log(`   nói: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}\n`);
}

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ đã dọn thư mục thử');
