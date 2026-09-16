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
 * The npm prefix that THIS copy lives in, derived from where it is.
 *
 * 🔴 `npm install --global` ALONE UPDATES THE WRONG COPY. `--global` resolves
 * the prefix from npm's own config — which is the default one, not necessarily
 * the one the running copy was installed into. Anybody with nvm, volta or an
 * `--prefix` of their own would watch the command succeed and nothing change,
 * with a second copy quietly updated somewhere else. The prefix is not a
 * preference here; it is a fact about the file that is executing.
 *
 * ⚠ Walk up to `node_modules` rather than counting path segments: a scoped name
 * is two directories deep and an unscoped one is one, and the day the package
 * is renamed the count is wrong with no test to notice.
 *
 * ⚠ The two layouts differ by one level — POSIX keeps `node_modules` under
 * `lib/`, Windows does not — so the parent is checked by NAME, not by platform.
 */
export function globalPrefixFor(root: string): string | undefined {
  let dir = path.resolve(root);
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    if (path.basename(dir) === 'node_modules') {
      return path.basename(parent) === 'lib' ? path.dirname(parent) : parent;
    }
    dir = parent;
  }
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

const [npmCli, pkg, target, packageRoot, companyDir, prefix, restart, waitUrl] = process.argv.slice(2);

/**
 * 🔴 WAIT FOR THE DAEMON TO ACTUALLY BE GONE BEFORE npm TOUCHES THE PACKAGE.
 *
 * When a person types \`agentco update\` the CLI has already stopped it and left.
 * When the BUTTON sends this, the daemon is answering the very request that
 * spawned us and is only on its way out — npm replacing files under a live
 * process is the hazard this whole helper exists to avoid, and starting half a
 * second early would walk straight into it.
 *
 * ⚠ A ceiling, then proceed anyway: a daemon that will not die is a worse
 * problem than a racy install, and hanging here forever would leave somebody
 * staring at a page that never comes back with nothing written anywhere.
 */
if (waitUrl) {
  const until = Date.now() + 30_000;
  for (;;) {
    let alive = false;
    try {
      const r = await fetch(waitUrl, { signal: AbortSignal.timeout(1_000) });
      alive = r.ok;
    } catch {
      alive = false;
    }
    if (!alive || Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 300));
  }
}

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

// --prefix pins the install to the tree this copy is running from. Without it
// \`--global\` means "npm's default prefix", which is a different place for
// anyone using nvm, volta or a prefix of their own.
const args = [npmCli, 'install', '--global', pkg + '@' + target, '--no-audit', '--no-fund'];
if (prefix) args.push('--prefix', prefix);
const code = await run(args);
if (code !== 0) {
  console.error('\\nagentco update: npm exited ' + code + '. Nothing was replaced — run \`agentco start\` to carry on.');
  process.exit(code);
}

// 🔴 PUT THINGS BACK AS THEY WERE, which means not starting a company that was
// not running. Restarting unconditionally turns \`agentco update\` typed in some
// unrelated directory into "and now a company is running here" — or, with no
// company.yaml anywhere near, into an error about a thing nobody asked for.
if (restart) {
  // Detached so this helper can exit while the company keeps running, exactly
  // as \`agentco start\` behaves when a person runs it themselves.
  const started = spawn(process.execPath, [packageRoot + '/dist/cli/index.js', 'start', '--dir', companyDir], {
    detached: true,
    stdio: 'inherit',
  });
  started.on('error', (err) => console.error('agentco update: could not restart — ' + err.message));
  started.unref();
} else {
  console.log('agentco update: done. Nothing was running, so nothing was started.');
}
`;
}
