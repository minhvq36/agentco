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
import os from 'node:os';
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
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 A FULL DISK TAKES THE COMMAND AWAY AND LEAVES NOTHING TO PUT IT BACK. │
 * │ (measured on a real machine, 18/09/2026)                                 │
 * │                                                                          │
 * │ `npm install -g` is NOT a transaction. It removes the old tree and its    │
 * │ shims, then writes the new ones. The disk filled between those two steps: │
 * │                                                                          │
 * │   npm warn tar TAR_ENTRY_ERROR ENOSPC: no space left on device, write     │
 * │                                                                          │
 * │ and the result was the package present at the new version with NO         │
 * │ `agentco`, `agentco.cmd` or `agentco.ps1` anywhere under the prefix:      │
 * │                                                                          │
 * │   D:\> agentco start                                                      │
 * │   'agentco' is not recognized as an internal or external command          │
 * │                                                                          │
 * │ ⚠ AND THERE IS NO WAY BACK FROM INSIDE. npm deleted the old copy, so      │
 * │ there is nothing to roll back to — and the thing that would offer to      │
 * │ repair it is the very binary that just vanished. The packaged door does   │
 * │ better (`core/update-apply.ts` probes a new layer before moving           │
 * │ `current`, so a half-applied state never exists), but that shape is not   │
 * │ available here: npm owns the install and offers no pointer to flip.       │
 * │                                                                          │
 * │ ⇒ THE ONLY LEVER IS BEFORE. We cannot have "all", so we protect           │
 * │ "nothing": refuse while everything is still untouched. This belongs with  │
 * │ `findNpmCli` under the rule at the top of this file — one more fact that  │
 * │ is knowable a second before the daemon is stopped.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ 2 GiB, from a measurement rather than a feeling: the installed global tree
 * is **1,268 MB** (of which `@agent-co-app/cli` is 408 MB — Claude Code's SDK
 * arrives as an optional dependency and is most of it), and npm holds parts of
 * the old and new trees at once. Erring toward refusing is the safe direction,
 * and the two consequences are not symmetric: refusing when there WAS room
 * costs an annoyed person who frees space; allowing when there was NOT costs
 * them their command line.
 */
const UPDATE_NEEDS_BYTES = 2 * 1024 * 1024 * 1024;

export interface SpaceVerdict {
  ok: boolean;
  /** Free bytes on the volume holding `dir`, or `undefined` when unreadable. */
  free?: number;
  needed: number;
  dir: string;
}

/**
 * Is there room to install into `dir`?
 *
 * ⚠ UNREADABLE ⇒ `ok`. `statfs` can fail on a network share, an unusual
 * filesystem, or a path that does not exist yet, and a check that cannot read
 * the disk must not become a check that blocks the update. Absence of an
 * answer is not an answer. → [[agentco-deterministic-vs-signal]]
 */
export function checkSpace(dir: string, needed: number = UPDATE_NEEDS_BYTES): SpaceVerdict {
  try {
    const s = fs.statfsSync(dir);
    const free = s.bavail * s.bsize;
    return { ok: free >= needed, free, needed, dir };
  } catch {
    return { ok: true, needed, dir };
  }
}

/** How many update directories survive a sweep. → `sweepOldUpdateDirs` */
const KEEP_UPDATE_DIRS = 3;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 EVERY UPDATE LEFT A DIRECTORY BEHIND, FOREVER. (counted 18/09/2026:    │
 * │ 421 of them, the oldest from 15/09 — three days)                         │
 * │                                                                          │
 * │ The user's words, and they are the right standard: *an app that keeps     │
 * │ making files it never removes is not meaningfully different from a virus; │
 * │ somebody who deletes the app must not be leaving things behind.*         │
 * │                                                                          │
 * │ ⚠ IT CANNOT CLEAN UP AFTER ITSELF, and that is why it was missed. The     │
 * │ helper RUNS FROM this directory and deliberately outlives the process     │
 * │ that created it — there is no later moment in that process to delete it,  │
 * │ and the helper deleting its own running script is a fight with Windows    │
 * │ file locking nobody wins. `update-apply.ts` has no such problem and       │
 * │ cleans up in a `finally`; this one is genuinely a different shape.        │
 * │                                                                          │
 * │ ⇒ The NEXT run sweeps. The only process that can safely remove one is one │
 * │ that is not using it.                                                    │
 * │                                                                          │
 * │ ⚠ KEEPS THE NEWEST FEW, on purpose. A failed update writes its only       │
 * │ record into `update.log` there, and that log is the single place the      │
 * │ reason can be read — a full disk said `ENOSPC` into exactly such a file.  │
 * │ Sweeping to zero would tidy away the evidence for the one case where      │
 * │ somebody needs it.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ NEVER THROWS. A directory another helper is still running from will refuse
 * to be removed on Windows, and housekeeping must not be able to stop an
 * update. Same rule as `audit.append`.
 */
export function sweepOldUpdateDirs(
  /**
   * ⚠ A PARAMETER so a test gets its own sandbox. Reading `os.tmpdir()` inside
   * would make the test delete the real machine's directories and read whatever
   * else happened to be there — the same trap the installer tests hit with the
   * Uninstall key. → [[agentco-installer-tests-share-globals]]
   */
  tmp: string = os.tmpdir(),
  keep: number = KEEP_UPDATE_DIRS,
): void {
  try {
    const mine = fs
      .readdirSync(tmp, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('agentco-update-'))
      .map((e) => {
        const full = path.join(tmp, e.name);
        let at = 0;
        try {
          at = fs.statSync(full).mtimeMs;
        } catch {
          /* vanished between readdir and stat — treat as oldest */
        }
        return { full, at };
      })
      .sort((a, b) => b.at - a.at);

    for (const old of mine.slice(keep)) {
      try {
        fs.rmSync(old.full, { recursive: true, force: true });
      } catch {
        /* in use, or not ours to remove — leave it and carry on */
      }
    }
  } catch {
    /* no temp directory to read is not a reason to refuse an update */
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

// ⚠ \`windowsHide\` on everything this helper starts. The helper itself is
// already hidden, and a child of a process with no console is exactly what
// Windows answers by opening a new one. → the no-flashing-console rule
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, ...opts });
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
  /*
   * 🔴 IT USED TO SAY "Nothing was replaced", WHICH IT CANNOT KNOW. Measured
   * 18/09/2026: the disk filled mid-install, npm had already swapped the tree
   * and never wrote the shims, and this line cheerfully told somebody to run a
   * command that no longer existed.
   *
   * So ASK THE DISK instead of asserting. The shim is the one thing that
   * decides whether the install is still usable, and its two shapes are known:
   * \`<prefix>/agentco.cmd\` on Windows, \`<prefix>/bin/agentco\` on POSIX.
   * This is the last moment anything of ours is alive to say it — after this
   * the binary may be gone, and with it every way we have of speaking.
   */
  let alive = true;
  if (prefix) {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    alive =
      existsSync(join(prefix, 'agentco.cmd')) ||
      existsSync(join(prefix, 'agentco')) ||
      existsSync(join(prefix, 'bin', 'agentco'));
  }
  console.error(
    alive
      ? '\\nagentco update: npm exited ' + code + '. The old version is still there — run \`agentco start\` to carry on.'
      : '\\nagentco update: npm exited ' + code + ', and the install is now BROKEN — \`agentco\` is gone from ' +
        prefix +
        '.\\nRepair it with:  npm i -g ' + pkg + '\\n(a full disk is the usual cause; \`npm cache clean --force\` frees the most)',
  );
  process.exit(code);
}

// 🔴 PUT THINGS BACK AS THEY WERE, which means not starting a company that was
// not running. Restarting unconditionally turns \`agentco update\` typed in some
// unrelated directory into "and now a company is running here" — or, with no
// company.yaml anywhere near, into an error about a thing nobody asked for.
if (restart) {
  // Detached so this helper can exit while the company keeps running, exactly
  // as \`agentco start\` behaves when a person runs it themselves.
  // ⚠ \`ignore\`, not \`inherit\`: inheriting would hand the restarted daemon this
  // helper's log file and hold it open for the life of the company. The daemon
  // has its own way of being watched. → the same trap one level up
  const started = spawn(process.execPath, [packageRoot + '/dist/cli/index.js', 'start', '--dir', companyDir], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  started.on('error', (err) => console.error('agentco update: could not restart — ' + err.message));
  started.unref();
} else {
  console.log('agentco update: done. Nothing was running, so nothing was started.');
}
`;
}
