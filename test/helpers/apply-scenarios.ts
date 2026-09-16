/**
 * The apply path, acted out for `test/update-apply.test.ts`.
 *
 * Sockets and child processes live here, and the assertions live there — the
 * runner cancels a pending test whenever the event loop drains, and this file
 * drains it constantly. → `test/helpers/port-scenarios.ts` has the full story.
 *
 * It builds two tiny fake "app layers" on disk and serves them over HTTP:
 *
 *   good  — answers `/healthz` with its own version, so it may be committed
 *   bad   — exits immediately, so it must NOT be committed and must be deleted
 *
 * ⚠ A fake layer rather than a real build: what is under test is the DECISION
 * (probe, then commit or delete), and a 78 MB tree would test `tar` and npm
 * instead. The real archive is round-tripped once by `pack-layer.ts` and that
 * is a different claim. → SPEC-packaging §3.7.6
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createTarGz } from '../../dist/core/archive.js';
import { applyLayer, readCurrent, writeCurrent } from '../../dist/core/update-apply.js';

const HOST = '127.0.0.1';

/**
 * A stand-in for `dist/cli/index.js`: `start` serves `/healthz` with the
 * version from its own package.json, exactly as the real one does. `--port` is
 * the flag the probe passes, and honouring it is part of what is under test.
 */
const GOOD_ENTRY = `
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, '$1'));
const version = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).version;
http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version, offices: 0 }));
    return;
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1');
`;

/** The version that will not start. The probe must catch this. */
const BAD_ENTRY = `process.exit(3);\n`;

function makeLayer(version: string, entry: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-fake-layer-'));
  fs.mkdirSync(path.join(dir, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'cli', 'index.js'), entry, 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version, type: 'module' }), 'utf8');
  return dir;
}

async function archiveOf(dir: string): Promise<{ file: string; sha256: string; size: number }> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-fake-tgz-')), 'layer.tar.gz');
  await createTarGz(dir, file);
  const bytes = fs.readFileSync(file);
  return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

/** An install root with `current` already pointing at a version that exists. */
function installRoot(currentVersion: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-root-'));
  fs.mkdirSync(path.join(root, 'app', currentVersion), { recursive: true });
  writeCurrent(root, currentVersion);
  return root;
}

const good = await archiveOf(makeLayer('9.9.9', GOOD_ENTRY));
const bad = await archiveOf(makeLayer('9.9.8', BAD_ENTRY));

// One server for both, so the URLs differ only in which file they name.
const files = new Map<string, string>([
  ['/good.tar.gz', good.file],
  ['/bad.tar.gz', bad.file],
]);
const server = http.createServer((req, res) => {
  const file = files.get(req.url ?? '');
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'application/gzip' });
  res.end(fs.readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, HOST, r));
const base = `http://${HOST}:${(server.address() as net.AddressInfo).port}`;

// ── 1. A layer that starts is committed: `current` moves, the tree stays.
const okRoot = installRoot('1.0.0');
const okOutcome = await applyLayer(
  { root: okRoot },
  { version: '9.9.9', url: `${base}/good.tar.gz`, sha256: good.sha256, size: good.size },
);

// ── 2. 🔴 A layer that does NOT start is refused: `current` must not move and
//       the half-written tree must be gone.
const badRoot = installRoot('1.0.0');
const badOutcome = await applyLayer(
  { root: badRoot },
  { version: '9.9.8', url: `${base}/bad.tar.gz`, sha256: bad.sha256, size: bad.size },
);

// ── 3. A wrong hash is never extracted at all.
const hashRoot = installRoot('1.0.0');
const hashOutcome = await applyLayer(
  { root: hashRoot },
  { version: '9.9.9', url: `${base}/good.tar.gz`, sha256: 'f'.repeat(64), size: good.size },
);

server.closeAllConnections();
await new Promise<void>((r) => server.close(() => r()));

console.log(
  JSON.stringify({
    ok: {
      outcome: okOutcome,
      current: readCurrent(okRoot),
      treeExists: fs.existsSync(path.join(okRoot, 'app', '9.9.9', 'dist', 'cli', 'index.js')),
    },
    bad: {
      outcome: badOutcome,
      current: readCurrent(badRoot),
      treeExists: fs.existsSync(path.join(badRoot, 'app', '9.9.8')),
    },
    hash: {
      outcome: hashOutcome,
      current: readCurrent(hashRoot),
      treeExists: fs.existsSync(path.join(hashRoot, 'app', '9.9.9')),
    },
  }),
);
