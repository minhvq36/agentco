/**
 * The one archive format the updater speaks: `.tar.gz`, through the `tar` the
 * operating system already ships. → docs/SPEC-packaging.md §3.7.3
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 RESOLVED BY ABSOLUTE PATH, NEVER THROUGH `PATH`.                      │
 * │                                                                          │
 * │ On this project's own development machine `tar` resolves to              │
 * │ `…\Git\usr\bin\tar.exe` — GNU tar, arriving with Git for Windows, which  │
 * │ a customer does not have. That is the same trap that has already been    │
 * │ paid for with `echo` and `date`: a tool present on the machine writing   │
 * │ the code and absent on the machine running it, with everything green in  │
 * │ between. Windows ships its own at `System32\tar.exe` (bsdtar) from        │
 * │ 10/1803 onward; POSIX has had one forever.                              │
 * │                                                                          │
 * │ ⚠ NOT A SHELL. `spawn` on the binary directly — three operating systems  │
 * │ disagree about quoting and none of them has to be consulted here.        │
 * │                                                                          │
 * │ ⚠ The flags used (`-xzf`, `-czf`, `-C`) are the intersection of bsdtar    │
 * │ and GNU tar. Anything cleverer is a difference waiting to be discovered  │
 * │ on somebody else's machine.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TarSearch {
  found?: string;
  /** Every path looked at, in order — printed when nothing was found. */
  tried: string[];
}

/**
 * ⚠ THE `tried` LIST IS A FEATURE. "tar not found" is unactionable; four paths
 * with an explanation is something a person can check. Same shape as
 * `core/claude-code.ts`, and for the same reason.
 */
export function findTar(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): TarSearch {
  const tried: string[] = [];
  const candidates =
    platform === 'win32'
      ? [path.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')]
      : ['/usr/bin/tar', '/bin/tar'];

  for (const c of candidates) {
    tried.push(c);
    if (exists(c)) return { found: c, tried };
  }
  return { tried };
}

function run(bin: string, args: string[]): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    // A missing binary arrives as an EVENT, not a throw — `try/catch` catches
    // none of it and the process dies instead. → SESSIONS_MEMORY §7
    child.on('error', (e) => resolve({ code: null, err: e.message }));
    child.on('exit', (code) => resolve({ code, err }));
  });
}

/**
 * Unpack `archive` so that its contents land directly inside `into`.
 *
 * ⚠ The archive is built with `-C <dir> .`, so it holds `./dist`, `./web` and
 * so on — no top-level version directory. The caller decides where that is,
 * which is what lets the updater write `app/<new>/` beside `app/<old>/`.
 */
export async function extractTarGz(archive: string, into: string): Promise<void> {
  const tar = findTar();
  if (!tar.found) throw new Error(`no tar on this system — looked at: ${tar.tried.join(', ')}`);
  fs.mkdirSync(into, { recursive: true });
  const r = await run(tar.found, ['-xzf', archive, '-C', into]);
  if (r.code !== 0) throw new Error(`tar exited ${r.code}: ${r.err.trim() || '(no output)'}`);
}

/** The other direction, used when a release is built. */
export async function createTarGz(fromDir: string, archive: string): Promise<void> {
  const tar = findTar();
  if (!tar.found) throw new Error(`no tar on this system — looked at: ${tar.tried.join(', ')}`);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const r = await run(tar.found, ['-czf', archive, '-C', fromDir, '.']);
  if (r.code !== 0) throw new Error(`tar exited ${r.code}: ${r.err.trim() || '(no output)'}`);
}
