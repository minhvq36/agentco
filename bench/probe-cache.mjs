import { query } from "@anthropic-ai/claude-agent-sdk";

const baseOpts = {
  systemPrompt: { type: "preset", preset: "claude_code", excludeDynamicSections: true },
  allowedTools: [],
  persistSession: false,
  maxTurns: 1,
  model: "haiku",
};

async function run(label, prompt, extraOpts = {}) {
  const t0 = Date.now();
  let result = null;
  try {
    for await (const m of query({ prompt, options: { ...baseOpts, ...extraOpts } })) {
      if (m.type === "result") result = m;
    }
  } catch (e) {
    console.log(`${label}: ERROR ${e.message}`);
    return;
  }
  if (!result) { console.log(`${label}: no result message`); return; }
  const u = result.usage ?? {};
  console.log(
    `${label.padEnd(28)} in=${String(u.input_tokens ?? "?").padStart(6)} ` +
    `cw=${String(u.cache_creation_input_tokens ?? "?").padStart(6)} ` +
    `cr=${String(u.cache_read_input_tokens ?? "?").padStart(7)} ` +
    `out=${String(u.output_tokens ?? "?").padStart(5)} ` +
    `$${(result.total_cost_usd ?? 0).toFixed(5)} ` +
    `${Date.now() - t0}ms`
  );
  return result;
}

console.log("=== A. cùng prefix, 3 call liên tiếp (đo cache) ===");
const r1 = await run("A1 (lần đầu)", "Trả lời đúng một từ: xanh");
await run("A2 (prefix giống hệt)", "Trả lời đúng một từ: đỏ");
await run("A3 (prefix giống hệt)", "Trả lời đúng một từ: vàng");

console.log("\n=== B. đổi system prompt -> phải miss ===");
await run("B1 (systemPrompt khác)", "Trả lời đúng một từ: tím", {
  systemPrompt: "Bạn là trợ lý ngắn gọn. Luôn trả lời bằng đúng một từ.",
});
await run("B2 (lặp lại B1)", "Trả lời đúng một từ: nâu", {
  systemPrompt: "Bạn là trợ lý ngắn gọn. Luôn trả lời bằng đúng một từ.",
});

console.log("\n=== C. systemPrompt dạng MẢNG (thử phân tầng) ===");
await run("C1 (mảng 3 tầng)", "Trả lời đúng một từ: cam", {
  systemPrompt: ["Bạn là nhân viên của một công ty ảo.", "Vai trò: người viết nội dung.", "Luôn trả lời bằng đúng một từ."],
});
await run("C2 (mảng giống hệt)", "Trả lời đúng một từ: hồng", {
  systemPrompt: ["Bạn là nhân viên của một công ty ảo.", "Vai trò: người viết nội dung.", "Luôn trả lời bằng đúng một từ."],
});

console.log("\n=== D. shape của result message ===");
if (r1) console.log(Object.keys(r1).join(", "));
if (r1?.modelUsage) console.log("modelUsage:", JSON.stringify(r1.modelUsage, null, 1).slice(0, 600));
