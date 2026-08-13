import { query } from "@anthropic-ai/claude-agent-sdk";

// Mỗi biến thể dùng một chuỗi salt riêng => chắc chắn COLD => cw = kích thước prefix thật
const salt = Date.now();

async function cold(label, opts) {
  let r = null;
  try {
    for await (const m of query({
      prompt: "Trả lời đúng một từ: ok",
      options: { persistSession: false, maxTurns: 1, model: "haiku", ...opts },
    })) { if (m.type === "result") r = m; }
  } catch (e) { console.log(`${label}: ERROR ${e.message}`); return; }
  const u = r?.usage ?? {};
  const prefix = (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  console.log(
    `${label.padEnd(34)} prefix≈${String(prefix).padStart(6)}  ` +
    `cw=${String(u.cache_creation_input_tokens ?? 0).padStart(6)} ` +
    `cr=${String(u.cache_read_input_tokens ?? 0).padStart(6)}  $${(r?.total_cost_usd ?? 0).toFixed(5)}`
  );
}

const MINI = `[s${salt}] Bạn là nhân viên công ty ảo. Trả lời cực ngắn.`;

await cold("1. preset claude_code (đầy đủ)", {
  systemPrompt: { type: "preset", preset: "claude_code", append: `[s${salt}a]` },
});
await cold("2. preset + excludeDynamicSections", {
  systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true, append: `[s${salt}b]` },
});
await cold("3. custom mini, allowedTools mặc định", { systemPrompt: MINI + "c" });
await cold("4. custom mini, allowedTools: []", { systemPrompt: MINI + "d", allowedTools: [] });
await cold("5. custom mini, chỉ Read+Write", { systemPrompt: MINI + "e", allowedTools: ["Read", "Write"] });
await cold("6. custom mini, disallow tất cả MCP", {
  systemPrompt: MINI + "f", allowedTools: ["Read", "Write"], mcpServers: {}, settingSources: [],
});
