/**
 * SPIKE — WHY DOES ATTACHING AN ARM ALWAYS TAKE ~20 SECONDS, AND
 * OCCASIONALLY TIME OUT?
 *
 * `TEST-WALKTHROUGH` step 11 promises *"22.3s the first time · ~4s after
 * that"*. A user reported: **it's always slow, never seen a 4-second run**,
 * and it occasionally times out then works on retry. One of the two claims
 * is wrong — this needs measuring, not guessing.
 *
 * Split that "20 seconds" into FOUR components and time each separately:
 *
 *   ① npx resolving the package itself (even when it's already in the
 *      `_npx` cache)
 *   ② node startup + the MCP server's own initialization
 *   ③ the MCP handshake + tool listing (`mcpServerStatus`)
 *   ④ running `node <dist path>` DIRECTLY, skipping npx entirely  ← this is
 *      the proposed alternative
 *
 * ⚠ Measure MULTIPLE TIMES in a row within the same process: if runs 2 and 3
 * are still as slow as run 1, then "faster on later runs" is a FALSE claim,
 * not something specific to the user's machine.
 *
 * Run: npx tsx scripts/spike-npx-cost.ts   (0 tokens — costs only disk and time)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npxcost-'));

const ms = (t: number) => `${((Date.now() - t) / 1000).toFixed(2)}s`;

/** Measure the cost of `npx` alone: spawn it, then kill as soon as it shows signs of life. */
function timeSpawn(label: string, cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const dt = Date.now() - t0;
      try {
        p.kill();
      } catch {
        /* already dead, fine */
      }
      console.log(`   ${label.padEnd(46)} ${(dt / 1000).toFixed(2)}s`);
      resolve(dt);
    };
    // The stdio MCP server prints a line to stderr once it's ready; any byte
    // coming out at all already proves the process is ALIVE — that's what
    // we're timing here.
    p.stderr.on('data', finish);
    p.stdout.on('data', finish);
    p.on('error', finish);
    p.on('exit', finish);
    setTimeout(finish, 60_000);
  });
}

/** Path to `dist/index.js` in the `_npx` cache, if the package has already been run through npx. */
function cachedEntry(): string | undefined {
  const root = path.join(process.env['LOCALAPPDATA'] ?? os.homedir(), 'npm-cache', '_npx');
  const alt = path.join(os.homedir(), '.npm', '_npx');
  for (const base of [root, alt]) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

console.log(`\ntest dir: ${dir}\n`);

console.log('── ① + ② npx starting the server (package ALREADY in _npx cache)');
await timeSpawn('run 1', 'npx', ['-y', PKG, dir]);
await timeSpawn('run 2', 'npx', ['-y', PKG, dir]);
await timeSpawn('run 3', 'npx', ['-y', PKG, dir]);

const entry = cachedEntry();
console.log('\n── ④ node running the cached file DIRECTLY (no npx)');
if (entry) {
  console.log(`   entry: ${entry}`);
  await timeSpawn('run 1', process.execPath, [entry, dir]);
  await timeSpawn('run 2', process.execPath, [entry, dir]);
} else {
  console.log('   ✗ not found in _npx cache — skipping');
}

console.log('\n── ③ END-TO-END via `probeArm` (npx + handshake + tool listing)');
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now();
  const r = await probeArm({ files: { command: 'npx', args: ['-y', PKG, dir] } as never });
  console.log(`   probeArm run ${i}: ${r.status} · ${r.tools.length} tools · ${ms(t0)} (connectMs=${r.connectMs})`);
}

if (entry) {
  console.log('\n── ③b END-TO-END but spawning `node` directly');
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    const r = await probeArm({ files: { command: process.execPath, args: [entry, dir] } as never });
    console.log(`   probeArm run ${i}: ${r.status} · ${r.tools.length} tools · ${ms(t0)} (connectMs=${r.connectMs})`);
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n↩ cleaned up');
