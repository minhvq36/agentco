/**
 * SPIKE PHỤ 2 — `PreToolUse` CÓ NỔ CHO TOOL CỦA MCP KHÔNG?
 *
 * Câu hỏi CHẶN của bản vá "cho cánh tay chạy được": nếu ta đưa `mcp__<server>`
 * vào `allowedTools`, cánh tay filesystem sẽ ghi/đọc được — kể cả `roles/*.yaml`
 * và `<office>/.state/`, tức đi vòng qua đúng hai vùng `guardedZone` vừa dựng
 * 23/08. Hàng rào đó chỉ mở rộng được nếu hook nổ cho tên `mcp__*`.
 *
 * `SPEC-arms` §5f ghi *"khớp được về nguyên tắc, CHƯA ĐO"*. Đây là phép đo.
 *
 * Ba lượt, một biến:
 *   A  không hook                      → phải ĐỌC ĐƯỢC (đối chứng)
 *   B  matcher `mcp__.*` deny          → hook có nổ không
 *   C  matcher `.*` deny               → phòng khi matcher tiền tố không khớp
 *
 * Chạy: npx tsx scripts/spike-mcp-hook.ts  (~$0,01)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const office = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphook-'));
fs.mkdirSync(path.join(office, 'roles'), { recursive: true });
fs.writeFileSync(path.join(office, 'roles', 'nguoi-viet.yaml'), 'id: nguoi-viet\ntools: []\n');

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, office] };

const deny = async (): Promise<Record<string, unknown>> => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'CHẶN THỬ — hook đã nổ.',
  },
});

async function ca(label: string, matcher?: string) {
  console.log(`\n── ${label}`);
  let fired = 0;
  const q = query({
    prompt: `Đọc file roles/nguoi-viet.yaml trong "${office}" bằng tool của kết nối files và in nội dung.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Trả lời ngắn bằng tiếng Việt.',
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__files'],
      mcpServers: { files: FILES },
      cwd: office,
      maxTurns: 3,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(matcher
        ? {
            hooks: {
              PreToolUse: [
                {
                  matcher,
                  hooks: [
                    async (input: Record<string, unknown>) => {
                      if (String(input['tool_name'] ?? '').startsWith('mcp__')) fired++;
                      return deny();
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    },
  });
  const calls: string[] = [];
  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'assistant') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) {
          if (b['type'] === 'tool_use') calls.push(String(b['name']));
        }
      }
      if (m['type'] === 'user') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) {
          if (b['type'] === 'tool_result') {
            console.log(`   ⇒ ${JSON.stringify(b['content']).replace(/\s+/g, ' ').slice(0, 180)}`);
          }
        }
      }
      if (m['type'] === 'result') {
        console.log(`   nói: ${String(m['result'] ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
  } catch (e) {
    console.log(`   ⟨ném⟩ ${(e as Error).message.slice(0, 100)}`);
  }
  console.log(`   tool gọi: ${calls.join(', ') || '(không)'} · hook nổ cho mcp__*: ${fired}`);
}

await ca('A · KHÔNG hook (đối chứng — phải đọc được)');
await ca('B · matcher "mcp__.*"', 'mcp__.*');
await ca('C · matcher ".*"', '.*');

fs.rmSync(office, { recursive: true, force: true });
console.log('\n↩ đã dọn');
