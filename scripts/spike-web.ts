/**
 * SPIKE — DO `WebSearch`/`WebFetch` ACTUALLY WORK within the tool set we send?
 *
 * Both have been in `BUILTIN_TOOLS` from the start, so EVERY staff member
 * already has them. But *"is in the list"* and *"actually returns a result"*
 * are two different things — the exact lesson from the 08/24 arm case:
 * `mcp__*` was also in `system/init.tools` while every call was being denied.
 *
 * Measure two things, kept separate:
 *   ① Does the CLI actually GRANT those two tools (`system/init.tools`)
 *   ② Does calling them for real return a result — ask something the model
 *      COULDN'T already know
 *
 * Run: npx tsx scripts/spike-web.ts   (~$0.02)
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
      systemPrompt: 'You are a lookup assistant. Answer briefly.',
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
    text = `⟨threw⟩ ${(e as Error).message.slice(0, 160)}`;
  }

  console.log(`   CLI granted: ${granted.filter((t) => t.startsWith('Web')).join(', ') || '(NO Web tools at all)'}`);
  console.log(`   tools called: ${calls.join(', ') || '(no tool called)'}`);
  console.log(`   said: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  console.log(`   $${cost.toFixed(4)}`);
}

// The question must be something the model CANNOT answer from memory — otherwise
// a fluent-sounding answer would be proof of exactly nothing.
await ask('① WebSearch', 'Search the web: 3 cafes good for working in District 1, Ho Chi Minh City. Give names and addresses.');
await ask('② WebFetch', 'Read the page https://example.com and tell me its title and main content.');
