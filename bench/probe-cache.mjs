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

const ONE_WORD = "Reply with exactly one word: ";

console.log("=== A. same prefix, 3 calls in a row (this is the cache measurement) ===");
const r1 = await run("A1 (first time)", `${ONE_WORD}green`);
await run("A2 (identical prefix)", `${ONE_WORD}red`);
await run("A3 (identical prefix)", `${ONE_WORD}yellow`);

console.log("\n=== B. change the system prompt -> it MUST miss ===");
await run("B1 (different systemPrompt)", `${ONE_WORD}purple`, {
  systemPrompt: "You are a terse assistant. Always answer with exactly one word.",
});
await run("B2 (B1 repeated)", `${ONE_WORD}brown`, {
  systemPrompt: "You are a terse assistant. Always answer with exactly one word.",
});

console.log("\n=== C. systemPrompt as an ARRAY (does it layer?) ===");
const LAYERS = [
  "You work for a virtual company.",
  "Role: content writer.",
  "Always answer with exactly one word.",
];
await run("C1 (3 layers)", `${ONE_WORD}orange`, { systemPrompt: LAYERS });
await run("C2 (identical array)", `${ONE_WORD}pink`, { systemPrompt: LAYERS });

console.log("\n=== D. shape of the result message ===");
if (r1) console.log(Object.keys(r1).join(", "));
if (r1?.modelUsage) console.log("modelUsage:", JSON.stringify(r1.modelUsage, null, 1).slice(0, 600));
