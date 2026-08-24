/**
 * SPIKE — `WebSearch`/`WebFetch` CÓ THẬT SỰ CHẠY trong bộ tool ta gửi không?
 *
 * Cả hai nằm trong `BUILTIN_TOOLS` từ đầu, nên MỌI nhân viên đã có chúng. Nhưng
 * *"có trong danh sách"* và *"gọi ra kết quả"* là hai chuyện — đúng bài học cánh
 * tay 24/08: `mcp__*` cũng nằm trong `system/init.tools` mà mọi lời gọi bị deny.
 *
 * Đo hai thứ, tách bạch:
 *   ① CLI có CẤP hai tool đó không (`system/init.tools`)
 *   ② Gọi thật có ra kết quả không — hỏi một câu mà model KHÔNG thể biết sẵn
 *
 * Chạy: npx tsx scripts/spike-web.ts   (~$0,02)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

const OFFICE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

async function ask(label: string, prompt: string) {
  console.log(`\n── ${label}`);
  const calls: string[] = [];
  let granted: string[] = [];
  let text = '';
  let cost = 0;

  const q = query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Bạn là nhân viên tra cứu. Trả lời ngắn gọn bằng tiếng Việt.',
      tools: OFFICE_TOOLS,
      allowedTools: OFFICE_TOOLS,
      maxTurns: 5,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });

  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'system' && m['subtype'] === 'init') granted = (m['tools'] as string[]) ?? [];
      if (m['type'] === 'assistant') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) if (b['type'] === 'tool_use') calls.push(String(b['name']));
      }
      if (m['type'] === 'user') {
        const c = (m['message'] as { content?: unknown[] })?.content ?? [];
        for (const b of c as Record<string, unknown>[]) {
          if (b['type'] !== 'tool_result') continue;
          const raw = JSON.stringify(b['content'] ?? '').replace(/\s+/g, ' ');
          console.log(`   ⇒ ${b['is_error'] === true ? '❌ ' : ''}${raw.slice(0, 220)}`);
        }
      }
      if (m['type'] === 'result') {
        text = typeof m['result'] === 'string' ? m['result'] : '';
        cost = (m['total_cost_usd'] as number) ?? 0;
      }
    }
  } catch (e) {
    text = `⟨ném⟩ ${(e as Error).message.slice(0, 160)}`;
  }

  console.log(`   CLI cấp: ${granted.filter((t) => t.startsWith('Web')).join(', ') || '(KHÔNG có tool Web nào)'}`);
  console.log(`   tool gọi: ${calls.join(', ') || '(không gọi tool nào)'}`);
  console.log(`   nói: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  console.log(`   $${cost.toFixed(4)}`);
}

// Câu hỏi phải là thứ model KHÔNG thể trả lời từ trí nhớ — nếu không, một câu
// trả lời trôi chảy chứng minh đúng con số 0.
await ask('① WebSearch', 'Tìm trên web: 3 quán cà phê làm việc được ở Quận 1, TP.HCM. Nêu tên và địa chỉ.');
await ask('② WebFetch', 'Đọc trang https://example.com và cho biết tiêu đề cùng nội dung chính của nó.');
