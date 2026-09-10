import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/**
 * 🔴 ONE DOOR TO `query()`. → `src/core/sdk.ts` · docs/SPEC-packaging.md §2
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ `pathToClaudeCodeExecutable` has to reach EVERY call, or that code path
 * │ does nothing on a customer's machine. There were six call sites across
 * │ five modules, so the option is injected in one wrapper rather than
 * │ remembered six times.
 * │
 * │ ⚠ THIS TEST EXISTS BECAUSE THE FORGETTING IS INVISIBLE WHERE IT IS
 * │ WRITTEN. On a developer machine the SDK finds its own optional package in
 * │ `node_modules`, so a call that skipped the wrapper behaves identically —
 * │ every test passes, the app runs, and the defect ships. It only appears on
 * │ a machine that has no `node_modules`, i.e. every customer's.
 * │
 * │ A convention cannot catch that. A gate can.
 * └──────────────────────────────────────────────────────────────────────────
 */

const SRC = path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src');

/** Every `.ts` under `src/`, as [relative path, contents]. */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push([path.relative(SRC, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(SRC);
  return out;
}

test('premise: the wrapper exists and does inject the path', () => {
  const wrapper = fs.readFileSync(path.join(SRC, 'core', 'sdk.ts'), 'utf8');
  assert.match(wrapper, /pathToClaudeCodeExecutable: found\.path/);
  // …and it must not override a caller who asked for a specific one.
  assert.match(wrapper, /if \(options\.pathToClaudeCodeExecutable\) return sdkQuery\(input\)/);
});

test('🔴 only core/sdk.ts imports `query` from the SDK', () => {
  const offenders: string[] = [];
  for (const [rel, text] of sources()) {
    if (rel === 'core/sdk.ts') continue;
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@anthropic-ai\/claude-agent-sdk'/g)) {
      // `type` imports are fine — they carry no behaviour and no options.
      const named = m[1]!
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('type '));
      if (named.some((n) => n === 'query' || n.startsWith('query as'))) offenders.push(rel);
    }
    // The dynamic form too — `cmdDoctor` used it, and it is the easiest to miss.
    if (/await import\('@anthropic-ai\/claude-agent-sdk'\)/.test(text)) offenders.push(`${rel} (dynamic)`);
  }
  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [],
    'these bypass the wrapper, so they run without pathToClaudeCodeExecutable',
  );
});

test('premise: something actually goes through the wrapper', () => {
  // A gate that guards an empty set passes forever and proves nothing — the
  // shape `office-view.test.ts` had to be repaired for. Assert the door is used.
  const users = sources().filter(([rel, text]) => rel !== 'core/sdk.ts' && /from '\.\/sdk\.js'/.test(text));
  assert.ok(users.length >= 3, `only ${users.length} modules import the wrapper — is it still wired up?`);
});
