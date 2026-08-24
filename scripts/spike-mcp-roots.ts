/**
 * SPIKE PHỤ — server-filesystem NGHE AI: `args` của ta, hay `roots` của CLI?
 *
 * Lượt B/C của `spike-mcp-allow.ts` bị chính MCP server từ chối:
 *   "Access denied - path outside allowed directories: <thư mục ta truyền>
 *    not in D:\Works\…\agentco"   ← đó là `cwd`, KHÔNG phải args ta gửi.
 *
 * Giả thuyết: giao thức MCP có `roots`; client (Claude Code) khai `cwd` làm
 * root, và server-filesystem ƯU TIÊN roots hơn tham số dòng lệnh. Nếu đúng thì
 * ô "thư mục cho phép" trong hộp thoại + Kết nối là TRANG TRÍ — server sẽ chỉ
 * cho đọc đúng thư mục văn phòng.
 *
 * Biến duy nhất: `cwd`. Cùng một `args`, hai `cwd` khác nhau.
 * In NGUYÊN VĂN kết quả `list_allowed_directories`.
 *
 * Chạy: npx tsx scripts/spike-mcp-roots.ts  (~$0,005)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcproots-'));
const target = path.join(root, 'muc-tieu'); // thứ ta TRUYỀN vào args
const office = path.join(root, 'van-phong'); // thứ ta đặt làm cwd
fs.mkdirSync(target, { recursive: true });
fs.mkdirSync(office, { recursive: true });

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, target] };

async function ask(label: string, cwd: string, extra?: string[]) {
  console.log(
    `\n── ${label}\n   args → ${target}\n   cwd  → ${cwd}` +
      (extra ? `\n   additionalDirectories → ${extra.join(', ')}` : ''),
  );
  const q = query({
    prompt: 'Gọi tool list_allowed_directories và in nguyên văn kết quả. Không làm gì khác.',
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Trả lời ngắn.',
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
    console.log(`   ⟨ném⟩ ${(e as Error).message.slice(0, 120)}`);
  }
}

await ask('A · cwd = thư mục VĂN PHÒNG (giống worker thật)', office);
await ask('B · cwd = chính thư mục MỤC TIÊU', target);
await ask('C · cwd = văn phòng + additionalDirectories = mục tiêu', office, [target]);

fs.rmSync(root, { recursive: true, force: true });
console.log('\n↩ đã dọn');
