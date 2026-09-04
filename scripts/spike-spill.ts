/**
 * SPIKE — SPILL LARGE RESULTS TO A FILE INSTEAD OF MAKING THE MODEL SWALLOW THEM. 📖 → ✅ or ❌
 * → docs/SPEC-arms.md §9 · SPEC-connectors §7 (*"trim the raw response"*, written 08/14, not yet built)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CASE THAT CAUSED THIS (08/27): `notion-fetch` returned **64,146       │
 * │ characters** ≈ 16,000 tokens in ONE call — **7 times** the entire Notion  │
 * │ arm's schema (2,185 tokens/turn). The staff member swallowed it, ran out │
 * │ of turns, wandered off into `Grep`-ing the disk, then reported *"too      │
 * │ many steps"*.                                                            │
 * │                                                                          │
 * │ 📖 The `.d.ts` says exactly what we need, and it's **general to ANY      │
 * │ tool**, not MCP-specific:                                                │
 * │                                                                          │
 * │   PostToolUseHookSpecificOutput.updatedToolOutput?: unknown               │
 * │     "Replaces the tool output **before it is sent to the model**"         │
 * │                                                                          │
 * │ ⚠⚠ BUT 📖 IS NOT ✅. There's an expensive precedent in this very project:  │
 * │ `canUseTool` was once a *very convincing* 📖 read and **never fired even  │
 * │ once** for six days — because `allowedTools` shadowed it, and the arm    │
 * │ is ALWAYS in there. The same trap could repeat here.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * FIVE QUESTIONS, and question 4 can kill the whole direction:
 *
 *   Q1  Does `PostToolUse` fire for MCP tools at all?
 *   Q2  Does `updatedToolOutput` ACTUALLY replace what the model sees?
 *   Q3  What shape is `tool_response`? What shape must the replacement be?
 *   Q4  🔴 Was the ORIGINAL already counted toward tokens BEFORE the hook ran?
 *       — if so, we're only hiding the text from the model's eyes, NOT from
 *         the bill, and direction B dies right here.
 *   Q5  Does the hook see the full 64 KB, or is it already truncated before
 *       it reaches us?
 *
 * MEASUREMENT FOR Q4: run TWO otherwise-identical turns, differing in exactly
 * one variable (whether the hook replaces the output or not), then compare
 * `usage.input_tokens` on the final turn. If replacing doesn't lower the
 * token count ⇒ the original was already on the bill.
 *
 * ⚠ A NONCE forces a cache miss on both runs — without it, run two reads run
 * one's cache and every number is meaningless. (Lesson from §9b, paid for once
 * already.)
 *
 * Run:  npx tsx scripts/spike-spill.ts
 * Cost: ~$0.05 · Deliberately uses NO shell: the read path is `Read`, not
 * `Bash` — the `file_path`-matching gate only applies when the path goes
 * through that field.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { readOAuth } from '../dist/core/secrets.js';
import { companyPaths } from '../dist/core/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = path.join(HERE, '..', 'company');
const SAN = path.join(HERE, '..', '.state-spike', 'spill');

/** Page measured on 08/27: 64,146 characters. Reused as-is so numbers stay comparable. */
const PAGE_ID = '347cf455-8531-80fc-96a5-c9918a9d51e4';
const MCP_URL = 'https://mcp.notion.com/mcp';

/** Context cap. 16 KB ≈ 4,000 tokens — the number `SPEC-connectors` §7 settled on. */
const CAP = 16_000;

interface Result {
  fired: number;
  firedMcp: number;
  shape: string;
  size: number;
  inputTokens: number;
  cost: number;
  say: string;
  file?: string;
  /** Path the CLI saved on its own — for comparing which path the model actually followed. */
  orig?: string;
  /** Hit the turn cap — this is exactly the symptom being investigated, so it's DATA. */
  outOfTurns?: boolean;
  /**
   * Path the model ACTUALLY opened. This is the test for Q2, and it's the ONLY
   * test that can't lie: the model only knows our path if the replacement
   * really reached it.
   */
  opened: string[];
}

/**
 * Extract the text out of `tool_response` WITHOUT guessing the shape.
 *
 * MCP returns `{content:[{type:'text',text}]}`; builtin tools return a plain
 * string; and some things return a completely different object. Three cases,
 * one function — guessing the shape wrong is a silent failure, the exact
 * bug class already paid for in `postToken`.
 */
function textOf(resp: unknown): { text: string; shape: string } {
  if (typeof resp === 'string') return { text: resp, shape: 'string' };
  if (resp && typeof resp === 'object') {
    const c = (resp as { content?: unknown[] }).content;
    if (Array.isArray(c)) {
      const text = c
        .map((b) => (b && typeof b === 'object' ? String((b as { text?: unknown }).text ?? '') : ''))
        .join('\n');
      return { text, shape: `{content:[${c.length}]}` };
    }
    return { text: JSON.stringify(resp), shape: `object{${Object.keys(resp).join(',')}}` };
  }
  return { text: String(resp), shape: typeof resp };
}

async function run(label: string, replace: boolean, nonce: string): Promise<Result> {
  console.log(`\n── ${label}`);
  fs.mkdirSync(SAN, { recursive: true });

  const acc = Object.values(readOAuth(companyPaths(COMPANY))).find((a) => !a.dead);
  if (!acc) throw new Error('No live Notion account left — log in again first.');

  const result: Result = { fired: 0, firedMcp: 0, shape: '—', size: 0, inputTokens: 0, cost: 0, say: '', opened: [] };

  const q = query({
    // NONCE lives in the prompt to force a cache miss — see the header block.
    /**
     * ⚠ THE QUESTION MUST FORCE READING THE CONTENT, and not be answerable
     * from the title alone.
     *
     * An earlier run asked *"what's the page title"* and the model answered
     * correctly — but `focus-flow` was already sitting right in the pointer
     * question itself, so the measurement **couldn't prove it had opened the
     * file**. A question answerable without reaching the thing you're trying
     * to measure measures nothing.
     */
    prompt:
      `[${nonce}] Use the notion-fetch tool with id ${PAGE_ID}. ` +
      `Then tell me in EXACTLY ONE sentence: within that page's content, how is "Delta" defined?`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Answer as briefly as possible, in English.',
      // Deliberately DOES include `Read`: if the replacement is a pointer to a
      // file, the model needs a way to follow it. The product's own
      // `BUILTIN_TOOLS` always includes `Read` too.
      tools: ['Read', 'Grep'],
      allowedTools: ['Read', 'Grep', 'mcp__notion'],
      mcpServers: {
        notion: { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${acc.access_token}` } },
      },
      cwd: SAN,
      /**
       * ⚠ The FIRST run hit the default turn cap of 6 — and that's not a
       * misconfiguration, it's **exactly the symptom being investigated**:
       * swallow 64 KB and the model runs out of turns. Raised to 12 so the
       * measurement can actually run to completion; the product's real turn
       * cap (eco 20 · standard 15 · deep 10) is a separate matter, to discuss
       * once we have numbers.
       */
      maxTurns: 12,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      hooks: {
        PostToolUse: [
          {
            hooks: [
              async (input: Record<string, unknown>) => {
                result.fired++;
                const name = String(input['tool_name'] ?? '');
                if (!name.startsWith('mcp__')) return {};
                result.firedMcp++;

                const { text, shape } = textOf(input['tool_response']);
                result.shape = shape;
                result.size = Math.max(result.size, text.length);
                /**
                 * ⚠ PRINT THE RAW START OF THE STRING, NOT JUST ITS LENGTH.
                 *
                 * The first run showed `1,608 characters` and I nearly read
                 * that as *"the hook got handed an already-truncated
                 * version"*. But a short number has at least three possible
                 * meanings: truncated · wrong tool called · **the server
                 * returned an ERROR**. Without printing the raw content, all
                 * three look identical — the same lesson from spike 1 (print
                 * raw state, not just a conclusion).
                 */
                console.log(`   ⇢ ${name} · ${text.length} characters`);
                console.log(`     ${text.replace(/\s+/g, ' ').slice(0, 400)}`);

                // Capture the CLI's own saved path BEFORE the `replace` branch
                // — otherwise the control run has nothing to compare against,
                // and the Q5 summary line prints `❓` for something that was
                // actually measured. (The 08/27 run hit exactly this.)
                result.orig = text.match(/saved to\s+(.+?\.txt)/i)?.[1];
                if (!replace) return {};

                /**
                 * ┌──────────────────────────────────────────────────────────┐
                 * │ THE CLI ALREADY SPILLED THE FILE FOR US — we only        │
                 * │ RELOCATE it and REWRITE the message.                     │
                 * │                                                          │
                 * │ Measured 08/27: the 64,138-character result never even   │
                 * │ entered the context. Claude Code saves it on its own to  │
                 * │ `…/<session-uuid>/tool-results/` and returns a short     │
                 * │ sentence instead. So don't build a second cap of our own │
                 * │ (two copies of the same rule) — just patch the four      │
                 * │ places it lands wrong:                                  │
                 * │   ① outside the office  ② under a session-uuid that      │
                 * │   changes every run  ③ invisible to the user  ④ opens    │
                 * │   with "Error:"                                          │
                 * │                                                          │
                 * │ ④ is the most expensive and cheapest fix at once: a turn │
                 * │ that SUCCEEDED at getting the data gets read as a        │
                 * │ FAILURE, and the model goes into recovery mode — exactly │
                 * │ the 10 wandering turns from the 08/27 morning case.      │
                 * └──────────────────────────────────────────────────────────┘
                 */
                const spilled = text.match(/saved to\s+(.+?\.txt)/i)?.[1];
                if (!spilled) {
                  // CLI didn't spill ⇒ result is small enough ⇒ leave it alone. Do NOT spill it ourselves.
                  return {};
                }
                const store = path.join(SAN, 'artifacts');
                fs.mkdirSync(store, { recursive: true });
                const f = path.join(store, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`);
                fs.copyFileSync(spilled, f);
                result.file = f;
                result.orig = spilled;

                /**
                 * ⚠ A POINTER MUST DESCRIBE ITSELF AND SAY WHAT TO DO NEXT.
                 * The condition belongs on the same line as the example — a
                 * rule stated at the top of the prompt loses to an example
                 * here. → [[agentco-prompt-rules-lose-to-examples]]
                 */
                const kb = Math.round(fs.statSync(f).size / 1024);
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    // ⚠ No "Error" wording. This turn SUCCEEDED — it's just long.
                    updatedToolOutput:
                      `Data retrieved. Content is ${kb} KB long, so it was saved to the working directory:\n` +
                      `artifacts/${path.basename(f)}\n` +
                      `Use Read (with offset/limit) or Grep on that file to read it in parts.`,
                  },
                };
              },
            ],
          },
        ],
      },
    },
  });

  /**
   * ⚠ HITTING THE TURN CAP MUST NOT LOSE THE MEASUREMENT.
   *
   * The SDK **throws** when turns run out, and "ran out of turns" is exactly
   * the phenomenon being measured — letting it throw uncaught would discard
   * the single most valuable number. Catch it, record it, and report it in
   * the result.
   */
  try {
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;
    if (m['type'] === 'assistant') {
      // Record EVERY path the model opens — this is the evidence for Q2.
      for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
        if (b['type'] === 'tool_use' && /^(Read|Grep)$/.test(String(b['name']))) {
          const inp = b['input'] as { file_path?: string; path?: string };
          const p = inp?.file_path ?? inp?.path;
          if (p) result.opened.push(String(p));
        }
      }
      const u = (m['message'] as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } })?.usage;
      if (u) {
        // The LAST turn carries the full context total — take the max seen.
        result.inputTokens = Math.max(
          result.inputTokens,
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        );
      }
    }
    if (m['type'] === 'result') {
      result.cost = Number(m['total_cost_usd'] ?? 0);
      result.say = String(m['result'] ?? '').replace(/\s+/g, ' ').slice(0, 120);
    }
  }
  } catch (e) {
    result.say = `⚠ ${(e as Error).message.slice(0, 100)}`;
    result.outOfTurns = /maximum number of turns/i.test((e as Error).message);
  }

  console.log(`   hook fired       ${result.fired} times (MCP: ${result.firedMcp})`);
  console.log(`   tool_response    ${result.shape} · ${result.size.toLocaleString('en-US')} characters`);
  console.log(`   input tokens     ${result.inputTokens.toLocaleString('en-US')}`);
  console.log(`   cost             $${result.cost.toFixed(4)}`);
  console.log(`   hit turn cap     ${result.outOfTurns ? '🔴 YES' : 'no'}`);
  console.log(`   model said       ${result.say}`);
  if (result.file) console.log(`   spilled to       ${path.basename(result.file)}`);
  return result;
}

async function main(): Promise<void> {
  const nonce = `n${Math.floor(Date.now() / 1000)}`;

  const A = await run('A · NO replacement — control, model swallows it whole', false, `${nonce}a`);
  const B = await run('B · WITH replacement — spilled to a file, returns a pointer', true, `${nonce}b`);

  console.log('\n━━ CONCLUSION\n');
  console.log(`Q1 · Does PostToolUse fire for MCP tools?     ${A.firedMcp > 0 ? '✅ YES' : '🔴 NO'}`);
  console.log(`Q3 · tool_response shape                      ${A.shape}`);
  console.log(
    `Q5 · Does the CLI spill the file on its own?  ${A.orig ?? (A.size > 60_000 ? '🔴 NO — the full 64 KB entered the context' : '❓')}`,
  );

  /**
   * ⚠ THE TEST FOR Q2 IS **THE PATH THE MODEL OPENS**, not the token count.
   *
   * The model only knows OUR path if the replacement really reached it —
   * there's no way for it to guess. The token count, on the other hand,
   * **can't tell the two runs apart**, since both only carry a short
   * sentence: the CLI already truncated it before we ever got a chance to
   * step in.
   */
  const followedOurs = B.opened.some((p) => B.file && p.replace(/\\/g, '/').includes(path.basename(B.file)));
  const followedCli = B.opened.some((p) => B.orig && p.replace(/\\/g, '/').includes(path.basename(B.orig)));
  console.log(`Q2 · Does updatedToolOutput actually replace it?  ${followedOurs ? '✅ YES — model opened OUR file' : followedCli ? '🔴 NO — model still followed the CLI\'s path' : '❓ model opened no file at all'}`);
  console.log(`     model opened:                     ${B.opened.map((p) => path.basename(p)).join(', ') || '(nothing)'}`);
  console.log(`Q4 · tokens — CANNOT be compared here      A ${A.inputTokens.toLocaleString('en-US')} vs B ${B.inputTokens.toLocaleString('en-US')}`);
  console.log(`     (the CLI already truncated it BEFORE the hook ⇒ neither run swallowed 64 KB. Q4 is moot here.)`);
  console.log(`\nA said: ${A.say}`);
  console.log(`B said: ${B.say}`);
  console.log(`cost: A $${A.cost.toFixed(4)} · B $${B.cost.toFixed(4)}\n`);
}

main().catch((e) => {
  console.error(`\n🔴 ${(e as Error).message}\n`);
  process.exit(1);
});
