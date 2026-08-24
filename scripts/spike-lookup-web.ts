/**
 * SPIKE — CÁI GIÁ CỦA VIỆC CHO WORKER ẨN TRA WEB.
 *
 * User phản biện lời từ chối của tôi bằng một câu không cãi được: *"một người
 * non-code bán hoa có vào tạo nhân viên chuyên nghiệp không, hay họ sẽ hỏi vu vơ
 * kiểu quán ăn, thời tiết, tin tức?"*. Trước khi đổi quyết định thì phải có SỐ,
 * vì mọi lý lẽ ở đây đều là suy đoán về hành vi.
 *
 * Ba con số cần, và cái thứ ba mới quyết:
 *
 *   ① prefix của worker ẩn hôm nay (`Read`/`Grep`/`Glob` + LOOKUP_PROMPT)
 *   ② prefix sau khi thêm `WebSearch`/`WebFetch`  → cái GIÁ
 *   ③ một câu hỏi vu vơ chạy hết bao nhiêu, so với đường plan→worker hôm nay
 *
 * ⚠ NONCE ở system prompt cả hai lượt: không có nó thì lượt hai ăn cache lượt
 * một và spike báo "0 token" một cách rất thuyết phục (bẫy đã trả tiền 22/08).
 *
 * Chạy: npx tsx scripts/spike-lookup-web.ts   (~$0,03)
 */

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const LOOKUP_TOOLS = ['Read', 'Grep', 'Glob'];
const WEB_TOOLS = [...LOOKUP_TOOLS, 'WebSearch', 'WebFetch'];

/** Bản rút gọn của `LOOKUP_PROMPT` — đủ để prefix có cùng bậc độ lớn. */
const BASE = 'You read documents and answer questions about them. You do not write files.';

async function* one(text: string): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' } as SDKUserMessage;
}

/**
 * Prefix = `input_tokens + cache_creation_input_tokens` của một lượt MISS.
 *
 * ⚠ ĐỌC `usage` THÔ, KHÔNG đọc `modelUsage`: lượt đo đầu lấy theo `modelUsage`
 * và nhận **0/0** — với prefix nhỏ như của worker ẩn, SDK không đặt điểm cắt
 * cache nào, nên mọi trường `cache*` đều rỗng và bảng kết quả sẽ nói "web miễn
 * phí" một cách rất thuyết phục. Đây là ca NGƯỢC với `readUsage` của worker
 * (ở đó `modelUsage` mới là nguồn đúng) — hai phép đo, hai trường, đừng chép
 * lẫn. → [[agentco-measurement-vs-conclusion]]
 */
async function prefixOf(label: string, tools: string[]): Promise<number> {
  const nonce = Math.random().toString(36).slice(2);
  let input = 0;
  let write = 0;
  let read = 0;
  for await (const msg of query({
    prompt: one('ok'),
    options: {
      systemPrompt: `${BASE} [nonce ${nonce}]`,
      model: 'claude-haiku-4-5-20251001',
      tools,
      allowedTools: tools,
      maxTurns: 1,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  })) {
    const m = msg as Record<string, unknown>;
    if (m['type'] === 'result') {
      const u = (m['usage'] ?? {}) as Record<string, number>;
      input = u['input_tokens'] ?? 0;
      write = u['cache_creation_input_tokens'] ?? 0;
      read = u['cache_read_input_tokens'] ?? 0;
    }
  }
  const total = input + write;
  console.log(
    `   ${label.padEnd(30)} input ${String(input).padStart(5)} + cache_write ${String(write).padStart(5)}` +
      ` = ${String(total).padStart(5)}   (cache_read ${read})`,
  );
  if (read > 0) console.log('      ⚠ cache_read > 0 ⇒ nonce KHÔNG phá được cache, số này vô nghĩa.');
  return total;
}

console.log('\n─── ① + ② PREFIX của worker ẩn ───\n');
const a = await prefixOf('Read/Grep/Glob (hôm nay)', LOOKUP_TOOLS);
const b = await prefixOf('+ WebSearch + WebFetch', WEB_TOOLS);
console.log(`\n   ⇒ web THÊM VÀO: ${b - a} token / lượt lookup\n`);

// Phần ③ tốn tiền thật — bỏ qua khi chỉ cần đo lại prefix.
if (process.argv.includes('--prefix-only')) process.exit(0);

console.log('─── ③ Một câu hỏi vu vơ, chạy thật ở tier của Trợ lý (sonnet) ───\n');
const t0 = Date.now();
let cost = 0;
let text = '';
const calls: string[] = [];
for await (const msg of query({
  prompt: one('Thời tiết TP.HCM hôm nay thế nào?'),
  options: {
    systemPrompt: `${BASE} Nếu câu hỏi không nằm trong tài liệu nào, hãy tra trên web rồi trả lời ngắn gọn bằng tiếng Việt.`,
    model: 'claude-sonnet-5',
    tools: WEB_TOOLS,
    allowedTools: WEB_TOOLS,
    maxTurns: 4,
    persistSession: false,
    settingSources: [],
    strictMcpConfig: true,
  },
})) {
  const m = msg as Record<string, unknown>;
  if (m['type'] === 'assistant') {
    const c = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const x of c as Record<string, unknown>[]) if (x['type'] === 'tool_use') calls.push(String(x['name']));
  }
  if (m['type'] === 'result') {
    cost = (m['total_cost_usd'] as number) ?? 0;
    text = typeof m['result'] === 'string' ? m['result'] : '';
  }
}
console.log(`   tool: ${calls.join(', ') || '(không)'}`);
console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s · $${cost.toFixed(4)}`);
console.log(`   nói: ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
console.log(
  `\n   Đối chiếu: đường plan→worker hôm nay cho một việc tương đương đo được\n` +
    `   $0,13–0,14 và 30–40 giây (ca 9 · ca arm-e2e).`,
);
