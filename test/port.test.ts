/**
 * 🔴 EVERY COMPANY WAS BORN ON 7317, SO THE SECOND ONE ON A MACHINE COULD NEVER
 * START. Found 16/09/2026 by installing from npm while the packaged app was
 * already running: `listen EADDRINUSE: address already in use 127.0.0.1:7317`,
 * raw, with nothing said about what was holding it or what to do next.
 *
 * Two mechanisms, and the last two tests ask the CHILD PROCESS about both
 * rather than calling the functions — the bug was never inside a function, it
 * was that `cmdStart` had no `catch` at all and `companyTemplate` wrote a
 * literal.
 *
 *   `init`  picks a free port ONCE and writes it down  → cli/port.ts
 *   `start` explains a port it cannot have             → cli/index.ts
 *
 * ⚠ The `start` test also asserts the RAW text is GONE. Asserting only that the
 * friendly sentence appears would stay green if both were printed, which is the
 * state this change exists to leave behind.
 *
 * ⚠ NOTHING HERE CALLS `agentcoOnPort` DIRECTLY, and that is not an oversight.
 * It uses `fetch`, and on Node 22.12 a failed fetch leaves undici holding no
 * handle at all — so the event loop drains while the runner still has tests
 * pending, which it reports as "Promise resolution is still pending but the
 * event loop has already resolved" and then CANCELS the rest. The summary still
 * says `# fail 0`: cancelled is not passed, and that is a very quiet way to be
 * wrong. Plain `net` does not do this.
 *
 * The function is covered anyway, and better, by the last test: the port there
 * is held by something that is not agentco, so `agentcoOnPort` returning
 * "cannot say" is exactly what makes the printed error the short version.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_PORT, findFreePort, isPortFree } from '../dist/cli/port.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const HOST = '127.0.0.1';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-port-'));
}

/**
 * Hold a port for the duration of a test. Resolves `undefined` when it was
 * already taken — and closes the half-built server in that case, so a listener
 * that never listened is not left behind for the runner to wait on.
 */
function hold(port: number): Promise<net.Server | undefined> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => server.close(() => resolve(undefined)));
    server.once('listening', () => resolve(server));
    server.listen(port, HOST);
  });
}

function close(server: net.Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return void setImmediate(resolve);
    server.close(() => setImmediate(resolve));
  });
}

function agentco(args: string[]): { out: string; code: number | null } {
  const env = { ...process.env };
  delete env['AGENTCO_COMPANY_DIR'];
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  return { out: r.stdout + r.stderr, code: r.status };
}

function portInYaml(dir: string): number {
  const yaml = fs.readFileSync(path.join(dir, 'company.yaml'), 'utf8');
  const m = /^\s*port:\s*(\d+)\s*$/m.exec(yaml);
  assert.ok(m, `company.yaml has no runtime.port:\n${yaml}`);
  return Number(m[1]);
}

test('a held port is not free, findFreePort steps over it, and both change back on release', async () => {
  const server = await hold(0);
  assert.ok(server, 'could not bind an ephemeral port');
  const taken = (server.address() as net.AddressInfo).port;

  // Bindability, answered by binding: a refused connection would say nothing
  // about a port held by another user's process.
  assert.equal(await isPortFree(taken, HOST), false);

  const found = await findFreePort(taken, HOST, 5);
  assert.notEqual(found, taken);
  assert.ok(found !== undefined && found > taken && found < taken + 5);

  await close(server);
  assert.equal(await isPortFree(taken, HOST), true);
  assert.equal(await findFreePort(taken, HOST, 5), taken);
});

test('🔴 `init` does not write a port that is already taken', async () => {
  /*
   * ⚠ A failed `hold` is not a failed test: it means something ELSE already has
   * the default port, which is the very condition under test. Either way the
   * port is busy while `init` runs.
   */
  const holder = await hold(DEFAULT_PORT);
  try {
    const dir = tmpdir();
    const r = agentco(['init', '--dir', dir]);
    assert.equal(r.code, 0, r.out);
    assert.notEqual(portInYaml(dir), DEFAULT_PORT);
  } finally {
    await close(holder);
  }
});

test('🔴 `start` on a taken port explains it, and does not leak the raw listen error', async () => {
  const dir = tmpdir();
  assert.equal(agentco(['init', '--dir', dir]).code, 0);
  const port = portInYaml(dir);

  const holder = await hold(port);
  assert.ok(holder, 'the port init just chose was taken by somebody else');
  try {
    const r = agentco(['start', '--dir', dir, '--no-ui']);

    assert.equal(r.code, 2, r.out);
    assert.match(r.out, new RegExp(String(port)));
    assert.match(r.out, /--port/);
    assert.doesNotMatch(r.out, /EADDRINUSE/);
  } finally {
    await close(holder);
  }
});
