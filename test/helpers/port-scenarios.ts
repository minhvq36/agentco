/**
 * The four port scenarios, acted out for `test/port.test.ts`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 WHY THIS IS A SEPARATE PROCESS AND NOT JUST MORE TEST CODE.           │
 * │                                                                          │
 * │ Every scenario opens a socket and closes it, so the event loop reaches    │
 * │ zero handles between steps. Node 22.12's test runner treats a drained     │
 * │ loop with a pending test as "Promise resolution is still pending but the  │
 * │ event loop has already resolved" and CANCELS the test — while the summary │
 * │ still reads `# fail 0`. Cancelled is not passed, and the file passed      │
 * │ three times in a row on timing alone before that was understood. Holding  │
 * │ a ref'd timer stops the cancelling and STALLS the runner instead.         │
 * │                                                                          │
 * │ Outside the runner none of that exists: a drained loop just means the     │
 * │ script is done. So the sockets live here, the assertions live there, and  │
 * │ the test process never opens one — which also makes that file fully       │
 * │ synchronous, with no gap of its own to fall into.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Prints one JSON object of OBSERVATIONS. It judges nothing: every assertion
 * is in the test file, so a scenario that silently stops doing its job cannot
 * also decide it passed.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const HOST = '127.0.0.1';

const ENV = { ...process.env };
delete ENV['AGENTCO_COMPANY_DIR'];

function agentco(args: string[]): { out: string; code: number | null } {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: ENV, encoding: 'utf8', timeout: 60_000 });
  return { out: r.stdout + r.stderr, code: r.status };
}

/**
 * 🔴 ASYNC, FOR ANY RUN THAT MUST BE ANSWERED BY A SERVER IN THIS PROCESS.
 *
 * `spawnSync` blocks this event loop, so a `/healthz` fixture living here
 * cannot reply while it runs. The daemon's probe then times out, reads the port
 * as a stranger's, and heals past the very thing the scenario set up — a green
 * run of the wrong experiment. It cost one 60-second timeout to notice.
 */
function agentcoAsync(args: string[]): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: ENV });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const guard = setTimeout(() => child.kill(), 60_000);
    child.on('exit', (code) => {
      clearTimeout(guard);
      resolve({ out, code });
    });
  });
}

function newCompany(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-port-'));
  const r = agentco(['init', '--dir', dir]);
  if (r.code !== 0) throw new Error(`init failed: ${r.out}`);
  return dir;
}

function yamlFile(dir: string): string {
  return path.join(dir, 'company.yaml');
}

function portInYaml(dir: string): number {
  const m = /^\s*port:\s*(\d+)\s*$/m.exec(fs.readFileSync(yamlFile(dir), 'utf8'));
  if (!m) throw new Error(`company.yaml has no runtime.port in ${dir}`);
  return Number(m[1]);
}

/**
 * ⚠ The company is pointed at a port THIS PROCESS holds, never at the default.
 * Binding 7317 to force a collision would fight whatever the developer running
 * the suite has open on it, and fail for a reason unrelated to the mechanism.
 */
function setPortInYaml(dir: string, port: number): void {
  const yaml = fs.readFileSync(yamlFile(dir), 'utf8');
  fs.writeFileSync(yamlFile(dir), yaml.replace(/^(\s*port:\s*)\d+\s*$/m, `$1${port}`), 'utf8');
}

/**
 * A squatter: it takes the port and answers nothing.
 *
 * ⚠ TWO LINES IN THE CONNECTION HANDLER, BOTH LOAD-BEARING. `start` probes the
 * occupied port with `fetch`, so a connection always arrives.
 *   · `destroy()` — without it the socket stays open, `server.close()` waits
 *     for it forever, and the script dies on "unsettled top-level await".
 *   · the 'error' handler — destroying makes the peer reset, and an unhandled
 *     'error' on a socket is an uncaught exception that kills the process.
 * Resetting is also the right answer to imitate: a squatter is not an agentco,
 * and `agentcoOnPort` should learn that immediately rather than after a timeout.
 */
function hold(): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.destroy();
    });
    server.once('error', reject);
    server.once('listening', () => resolve(server));
    server.listen(0, HOST);
  });
}

function portOf(server: net.Server | http.Server): number {
  return (server.address() as net.AddressInfo).port;
}

/**
 * ⚠ `closeAllConnections()` FIRST. `server.close()` stops accepting and then
 * waits for the connections it already has — and the daemon's `fetch` leaves a
 * keep-alive socket behind on the HTTP one. Waiting for that is a script that
 * never ends, reported as "unsettled top-level await" and no output at all.
 */
function close(server: net.Server | http.Server): Promise<void> {
  return new Promise((resolve) => {
    if ('closeAllConnections' in server) server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function waitFor<T>(probe: () => T | undefined, ms: number): Promise<T | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const hit = probe();
    if (hit !== undefined) return hit;
    if (Date.now() > until) return undefined;
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ── 1. `init` writes the default and does not go looking: `start` heals, so a
//       search here would be a second mechanism for one problem.
const initPort = portInYaml(newCompany());

// ── 2. Bindability is answered by BINDING. A refused connection says nothing
//       about a port held by another user's process.
const probe = await hold();
const busy = portOf(probe);
const { isPortFree, findFreePort } = await import('../../dist/cli/port.js');
const busyReadsFree = await isPortFree(busy, HOST);
const stepped = await findFreePort(busy, HOST, 5);
await close(probe);
const freedReadsFree = await isPortFree(busy, HOST);

// ── 3. 🔴 THE HEAL, observed on the FILE. Serving on another port while
//       company.yaml still named the old one is the drift this exists to avoid,
//       and the printed line looks identical either way.
const healDir = newCompany();
const healHolder = await hold();
const healWanted = portOf(healHolder);
setPortInYaml(healDir, healWanted);

const child = spawn(process.execPath, [CLI, 'start', '--dir', healDir, '--no-ui'], { env: ENV });
let healOut = '';
child.stdout.on('data', (d: Buffer) => (healOut += d.toString()));
child.stderr.on('data', (d: Buffer) => (healOut += d.toString()));
const healMoved = await waitFor(() => {
  const now = portInYaml(healDir);
  return now === healWanted ? undefined : now;
}, 30_000);
child.kill();
await close(healHolder);

// ── 4. 🔴 An explicit `--port` is never moved and never edits the file.
const askedDir = newCompany();
const askedHolder = await hold();
const askedPort = portOf(askedHolder);
const asked = agentco(['start', '--dir', askedDir, '--no-ui', '--port', String(askedPort)]);
const askedFilePort = portInYaml(askedDir);
await close(askedHolder);

// ── 5. 🔴 An agentco that will not say WHICH company it serves (anything before
//       0.1.3) is refused, not moved past. Moving and being wrong means two
//       daemons over one key store, silently; refusing and being wrong means a
//       sentence and `--port`.
const oldDir = newCompany();
const fake = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: '0.1.2', offices: 1 }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => fake.listen(0, HOST, resolve));
const oldPort = portOf(fake);
setPortInYaml(oldDir, oldPort);
const oldRun = await agentcoAsync(['start', '--dir', oldDir, '--no-ui']);
const oldFilePort = portInYaml(oldDir);
await close(fake);

console.log(
  JSON.stringify({
    initPort,
    busy,
    busyReadsFree,
    stepped,
    freedReadsFree,
    heal: { wanted: healWanted, moved: healMoved ?? null, out: healOut },
    asked: { port: askedPort, code: asked.code, out: asked.out, filePort: askedFilePort },
    old: { port: oldPort, code: oldRun.code, out: oldRun.out, filePort: oldFilePort },
  }),
);
