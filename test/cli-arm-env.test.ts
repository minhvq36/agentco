import { strict as assert } from 'node:assert';
import test from 'node:test';
import os from 'node:os';

import { runCommand } from '../dist/core/cli-arm.js';

/**
 * 🔴 WHAT A CLI COMMAND ACTUALLY RECEIVES. → `cli-arm.ts §childEnv` · SPEC-cli §6.1
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ IT ASKS THE CHILD, IT DOES NOT READ THE SOURCE.
 * │
 * │ The thing being guarded is an allowlist of exactly one variable, and the
 * │ way it breaks is somebody replacing it with `{ ...process.env, ...env }`
 * │ because that is shorter and "obviously the same". Read as source, that
 * │ edit looks harmless. Read off the wire — by printing the child's own
 * │ `process.env` — it is a key leak, immediately.
 * │
 * │ ⚠ The sentinel is set on THIS process, not asserted against a fixed list
 * │ of platform variables: libuv injects a few of its own on Windows, so
 * │ "the child env has exactly N keys" would be a test about Windows. A
 * │ variable that exists here and must not exist there is a question with one
 * │ answer on every platform.
 * └──────────────────────────────────────────────────────────────────────────
 */

const SENTINEL = 'AGENTCO_TEST_SECRET_SENTINEL';

/** Run node and have it print the environment it was actually handed. */
async function childEnvOf(env: Record<string, string>): Promise<Record<string, string>> {
  const r = await runCommand({
    argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.env))'],
    cwd: os.tmpdir(),
    env,
    timeoutMs: 20_000,
  });
  assert.equal(r.ok, true, `the probe command did not run: ${r.stderr} (door: ${r.door})`);
  return JSON.parse(r.stdout) as Record<string, string>;
}

test('🔴 PATH reaches the child — without it POSIX cannot find the binary at all', async () => {
  // ⚠ This assertion passes on Windows even with the fix reverted: measured
  // 10/09, `CreateProcess` searches the CALLING process's PATH, so a bare
  // `node` resolves with `env: {}`. The value of the test is the OTHER
  // platforms, where `execvp` reads PATH out of the environ it was handed and
  // falls back to `/bin:/usr/bin` when there is none.
  const child = await childEnvOf({ SOME_DECLARED_KEY: 'x' });
  assert.ok(child['PATH'], 'the child was handed no PATH');
  assert.equal(child['PATH'], process.env['PATH'], 'it must be the daemon PATH, verbatim');
  // …and the declared keys still arrive. This is what secrets travel in.
  assert.equal(child['SOME_DECLARED_KEY'], 'x');
});

test('🔴 NOTHING ELSE crosses — the daemon\'s own keys must not reach a CLI command', async () => {
  /**
   * The failure this exists for: `{ ...process.env, ...declared }`. The daemon
   * holds `ANTHROPIC_API_KEY`, `AGENTCO_TOKEN` and OAuth material, and whoever
   * declares a CLI command is not necessarily whoever owns those keys. The
   * leak is silent — nothing on screen, nothing in the audit log.
   */
  process.env[SENTINEL] = 'this must not travel';
  try {
    const child = await childEnvOf({ SOME_DECLARED_KEY: 'x' });
    assert.equal(
      child[SENTINEL],
      undefined,
      'an ambient variable reached the child — the allowlist has been widened to a spread',
    );
  } finally {
    delete process.env[SENTINEL];
  }
});

test('a DECLARED PATH wins over the ambient one', async () => {
  // Somebody writing `env: { PATH: … }` in their declaration is answering this
  // exact question deliberately; the ambient value must not overrule them.
  // ⚠ The probe is addressed by ABSOLUTE path (`process.execPath`), so it still
  // runs even though the PATH we hand it points nowhere useful.
  const child = await childEnvOf({ PATH: 'C:\\nowhere-at-all' });
  assert.equal(child['PATH'], 'C:\\nowhere-at-all');
});
