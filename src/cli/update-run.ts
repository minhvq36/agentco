/**
 * The moving parts of `agentco update`. → docs/SPEC-packaging.md §3.7
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 EVERYTHING THAT CAN FAIL IS RESOLVED BEFORE THE DAEMON IS STOPPED.    │
 * │                                                                          │
 * │ `findNpmCli` runs first for that reason alone. Stopping a working        │
 * │ company and THEN discovering there is no npm to call leaves somebody      │
 * │ worse off than when they started, for a fact that was knowable a second  │
 * │ earlier. The order is the feature.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * npm's own JavaScript entry point, beside the Node that is running us.
 *
 * 🔴 NOT `spawn('npm')`. Node cannot start a `.cmd` without a shell — it fails
 * with EINVAL on Windows — and going through a shell drags in three different
 * sets of quoting rules for one command. `node <npm-cli.js>` is the same
 * program with none of that. → SESSIONS_MEMORY §7
 *
 * ⚠ Two layouts, because the installers disagree: Windows keeps npm beside
 * `node.exe`; POSIX keeps it under `<prefix>/lib/`. Both are checked rather
 * than picked by `process.platform`, so a tree assembled the other way round —
 * a bundled runtime, a version manager — still resolves.
 */
export function findNpmCli(
  execPath: string = process.execPath,
  exists: (p: string) => boolean = fs.existsSync,
): string | undefined {
  const binDir = path.dirname(execPath);
  const candidates = [
    path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(binDir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(binDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.map((p) => path.normalize(p)).find(exists);
}

/**
 * The script that outlives us.
 *
 * ⚠ IT IS WRITTEN TO A TEMP DIRECTORY, NOT SHIPPED IN THE PACKAGE — because the
 * package is what npm is about to delete. A file inside it would be the one
 * thing guaranteed to vanish mid-run.
 *
 * ⚠ IT RESTARTS BY PATH, NOT BY NAME. After the install, `<packageRoot>/dist/
 * cli/index.js` is the NEW code at the SAME path, so there is nothing to look
 * up on a PATH that may not have been refreshed in this shell yet.
 *
 * ⚠ It says what it is doing and what failed. Nobody is reading a log file: the
 * person is watching the terminal they typed `agentco update` into.
 */
export function updateScript(): string {
  return `// Written by \`agentco update\`. Safe to delete.
import { spawn } from 'node:child_process';

const [npmCli, pkg, target, packageRoot, companyDir] = process.argv.slice(2);

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', ...opts });
    child.on('error', (err) => {
      console.error('agentco update: ' + err.message);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const code = await run([npmCli, 'install', '--global', pkg + '@' + target, '--no-audit', '--no-fund']);
if (code !== 0) {
  console.error('\\nagentco update: npm exited ' + code + '. Nothing was replaced — run \`agentco start\` to carry on.');
  process.exit(code);
}

// Detached so this helper can exit while the company keeps running, exactly as
// \`agentco start\` behaves when a person runs it themselves.
const started = spawn(process.execPath, [packageRoot + '/dist/cli/index.js', 'start', '--dir', companyDir], {
  detached: true,
  stdio: 'inherit',
});
started.on('error', (err) => console.error('agentco update: could not restart — ' + err.message));
started.unref();
`;
}
