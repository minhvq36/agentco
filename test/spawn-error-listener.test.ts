import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

/**
 * 🔴 A FIRE-AND-FORGET `spawn` WITHOUT AN `'error'` LISTENER KILLS THE DAEMON.
 * → `cli/daemonfile.ts §reveal` · `core/cli-arm.ts §runCommand` · SPEC-cli §1
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ THE `try/catch` AROUND A `spawn` CATCHES NOTHING THAT MATTERS.
 * │
 * │ A missing binary is reported ASYNCHRONOUSLY, as an `'error'` event. The
 * │ `try` block has long since returned by then, and an `'error'` event with
 * │ no listener is re-thrown by EventEmitter as an uncaught exception — which
 * │ ends the process.
 * │
 * │ ⚠ WHERE IT BITES IS A HEADLESS VPS. `reveal()` runs `xdg-open`, which a
 * │ minimal Linux server image simply does not carry — the normal state of a
 * │ server, not a broken machine. So `agentco start` printed its URL and then
 * │ the daemon died, and the only thing standing between a customer and that
 * │ was remembering to set `AGENTCO_HEADLESS=1`. A safe default that depends
 * │ on somebody knowing a flag is not a safe default.
 * │
 * │ ⚠ AND IT CANNOT BE CAUGHT BY TESTING THE FUNCTION ITSELF. `reveal` picks
 * │ its command from `process.platform`, and on the machine running this test
 * │ that command (`cmd` / `open` / `xdg-open`) is present — the very reason
 * │ the bug survived. So this file does two things instead: it proves the
 * │ MECHANISM against a name that cannot exist anywhere, and it reads the two
 * │ call sites as text to check they still carry the listener.
 * └──────────────────────────────────────────────────────────────────────────
 */

const SRC = path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'src');
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('🔴 premise: an unlistened spawn error really does end the process', async () => {
  // The premise this whole file rests on, asserted rather than assumed — and
  // asserted in BOTH directions, so a future Node that stops re-throwing turns
  // this test red instead of leaving it passing against nothing.
  const run = (listen: boolean): Promise<number | null> =>
    new Promise((resolve) => {
      const code = `
        const { spawn } = require('node:child_process');
        try {
          const c = spawn('agentco-no-such-binary-xyz', []);
          ${listen ? "c.on('error', () => {});" : ''}
          c.unref();
        } catch (e) { console.log('caught synchronously'); }
        setTimeout(() => process.exit(0), 400);
      `;
      const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', windowsHide: true });
      child.on('error', () => resolve(null));
      child.on('close', (c) => resolve(c));
    });

  assert.equal(await run(false), 1, 'without a listener the process should die — the bug');
  assert.equal(await run(true), 0, 'with a listener it should survive — the fix');
});

test("🔴 `reveal` attaches an 'error' listener before unref", () => {
  const src = read('cli/daemonfile.ts');
  assert.ok(/function reveal\(/.test(src), 'premise: `reveal` is no longer in daemonfile.ts');
  // The listener has to be on the child, i.e. the spawn result must be held in
  // a variable. `spawn(...).unref()` throws the handle away and there is then
  // nowhere left to attach one.
  assert.ok(
    /const child = spawn\(cmd, args, opts\);/.test(src),
    'the spawn result must be kept, or there is nothing to listen on',
  );
  assert.ok(
    /child\.on\('error',/.test(src),
    "reveal() must listen for 'error' — a machine with no desktop is not an error",
  );
});

test("🔴 the taskkill fallback attaches an 'error' listener too", () => {
  // Same shape, worse place: it runs inside a timeout handler in a LIVE daemon,
  // so an uncaught throw there takes down a company that is mid-job.
  const src = read('core/cli-arm.ts');
  const m = /spawn\('taskkill'[\s\S]{0,400}/.exec(src);
  assert.ok(m, 'premise: the Windows taskkill fallback is no longer in cli-arm.ts');
  assert.ok(
    /\.on\(\s*\n?\s*'error',/.test(m[0]) || /\.on\('error',/.test(m[0]),
    "the taskkill spawn must listen for 'error'",
  );
});
