/**
 * SPIKE — THE COST OF GIVING THE HIDDEN WORKER A WEB SEARCH.
 *
 * The user pushed back on my refusal with a point I couldn't argue against:
 * *"is a non-coder selling flowers going to go create a proper specialized
 * staff member, or will they just ask offhand things like restaurants,
 * weather, news?"*. Before changing the decision we need NUMBERS, because
 * every argument here is a guess about behavior.
 *
 * Three numbers needed, and the third one is what actually decides it:
 *
 *   ① today's hidden-worker prefix (`Read`/`Grep`/`Glob` + LOOKUP_PROMPT)
 *   ② prefix after adding `WebSearch`/`WebFetch`  → the COST
 *   ③ how much a single offhand question costs, compared to today's plan→worker path
 *
 * ⚠ NONCE in the system prompt on both runs: without it the second run hits
 * the first run's cache and the spike reports "0 tokens" very convincingly
 * (a trap that already cost money on 08/22).
 *
 * Run: npx tsx scripts/spike-lookup-web.ts   (~$0.03)
 */

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const LOOKUP_TOOLS = ['Read', 'Grep', 'Glob'];
const WEB_TOOLS = [...LOOKUP_TOOLS, 'WebSearch', 'WebFetch'];

/** Shortened version of `LOOKUP_PROMPT` — enough for the prefix to be the same order of magnitude. */
const BASE = 'You read documents and answer questions about them. You do not write files.';

async function* one(text: string): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' } as SDKUserMessage;
}

/**
 * Prefix = `input_tokens + cache_creation_input_tokens` of a MISS turn.
 *
 * ⚠ READ RAW `usage`, NOT `modelUsage`: the first measurement run read from
 * `modelUsage` and got **0/0** — with a prefix as small as the hidden
 * worker's, the SDK doesn't set any cache breakpoint, so every `cache*`
 * field is empty and the results table would say "web is free" very
 * convincingly. This is the OPPOSITE case from the worker's `readUsage`
 * (there, `modelUsage` is the correct source) — two measurements, two
 * fields, don't copy one for the other. → [[agentco-measurement-vs-conclusion]]
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
  if (read > 0) console.log('      ⚠ cache_read > 0 ⇒ the nonce did NOT break the cache, this number is meaningless.');
  return total;
}

console.log('\n─── ① + ② hidden-worker PREFIX ───\n');
const a = await prefixOf('Read/Grep/Glob (today)', LOOKUP_TOOLS);
const b = await prefixOf('+ WebSearch + WebFetch', WEB_TOOLS);
console.log(`\n   ⇒ web ADDS: ${b - a} tokens / lookup turn\n`);

// Part ③ costs real money — skip it when all we need is to re-measure the prefix.
if (process.argv.includes('--prefix-only')) process.exit(0);

console.log('─── ③ An offhand question, run for real at the Assistant tier (sonnet) ───\n');
const t0 = Date.now();
let cost = 0;
let text = '';
const calls: string[] = [];
for await (const msg of query({
  prompt: one("What's the weather like in Ho Chi Minh City today?"),
  options: {
    systemPrompt: `${BASE} If the question isn't covered by any document, look it up on the web and then answer briefly in Vietnamese.`,
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
console.log(`   tool: ${calls.join(', ') || '(none)'}`);
console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s · $${cost.toFixed(4)}`);
console.log(`   said: ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
console.log(
  `\n   For comparison: today's plan→worker path for an equivalent task measured\n` +
    `   $0.13-0.14 and 30-40 seconds (test 9 · arm-e2e test).`,
);
