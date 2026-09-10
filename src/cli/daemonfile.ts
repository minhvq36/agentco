/**
 * Tracking the running daemon.
 *
 * → docs/SPEC-cli.md §1
 *
 * `agentco start` has to be IDEMPOTENT: when the daemon is already up, open a
 * browser onto it rather than reporting a port conflict. That means
 * double-clicking the shortcut ALWAYS lands on a working interface, whether the
 * daemon was alive or dead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';

import type { CompanyPaths } from '../core/paths.js';

export interface DaemonInfo {
  pid: number;
  port: number;
  url: string;
  version: string;
  started_at: string;
}

export function writeDaemonFile(paths: CompanyPaths, info: DaemonInfo): void {
  fs.mkdirSync(path.dirname(paths.daemonFile), { recursive: true });
  fs.writeFileSync(paths.daemonFile, JSON.stringify(info, null, 2), 'utf8');
}

export function clearDaemonFile(paths: CompanyPaths): void {
  fs.rmSync(paths.daemonFile, { force: true });
}

/** The daemon that is GENUINELY ALIVE; clears a stale file when the process is gone. */
export async function liveDaemon(paths: CompanyPaths): Promise<DaemonInfo | undefined> {
  if (!fs.existsSync(paths.daemonFile)) return undefined;

  let info: DaemonInfo;
  try {
    info = JSON.parse(fs.readFileSync(paths.daemonFile, 'utf8')) as DaemonInfo;
  } catch {
    clearDaemonFile(paths);
    return undefined;
  }

  if (!processAlive(info.pid)) {
    clearDaemonFile(paths);
    return undefined;
  }

  // A live PID is not proof it is OUR daemon — PIDs get reused. Ask /healthz.
  try {
    const res = await fetch(`${info.url}/healthz`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) throw new Error('healthz did not return ok');
    const body = (await res.json()) as { ok?: boolean };
    if (!body.ok) throw new Error('healthz body was not ok');
    return info;
  } catch {
    clearDaemonFile(paths);
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process exists but under different permissions -> still alive
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function openBrowser(url: string): void {
  reveal(url);
}

/**
 * Open a FOLDER in the operating system's file manager.
 * → docs/SPEC-offices.md §3
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE ESCAPE HATCH FOR "AN OFFICE CODE DOES NOT FOLLOW ITS NAME".  │
 * │                                                                          │
 * │ `id` is the folder name and deliberately does NOT change when someone    │
 * │ renames the office — changing it would move `artifacts/`, `tasks/`,      │
 * │ `.state/` and every path already written into old receipts, all to alter │
 * │ a label. But the consequence is real: a user renames "Reports" to        │
 * │ "Stocktake", then goes looking for a `kiem-ke/` folder that is not       │
 * │ there. With a non-Latin name it is worse — the folder is `vp-ee6fd8`.    │
 * │                                                                          │
 * │ The cheapest way to reconcile those two is not to rename the folder but  │
 * │ to REMOVE THE NEED TO KNOW ITS NAME: one button that opens it. Nobody    │
 * │ ever has to type, remember or guess the id again — and we move not one   │
 * │ byte.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function openFolder(dir: string): void {
  reveal(dir);
}

function reveal(target: string): void {
  if (process.env['AGENTCO_HEADLESS'] === '1') return;
  const win = process.platform === 'win32';
  /**
   * ⚠ Windows goes through `cmd /c start` with an EMPTY second argument — that
   * slot is the window title, and leaving it out makes `start` read a quoted
   * path as the title and open nothing at all.
   */
  const [cmd, args]: [string, string[]] = win
    ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin'
      ? ['open', [target]]
      : ['xdg-open', [target]];
  try {
    /**
     * ┌──────────────────────────────────────────────────────────────────────
     * │ 🔴 THE BLACK WINDOW THAT FLASHED BEFORE THE BROWSER OPENED. (user, 10/09)
     * │
     * │ `agentco start` prints its lines, then a console window appears for a
     * │ fraction of a second, and only then does the browser come up. It is
     * │ this spawn: `cmd.exe` is a CONSOLE application, and the two options it
     * │ was given on Windows are exactly the ones that guarantee it gets a
     * │ window of its own.
     * │
     * │ `detached: true` becomes `DETACHED_PROCESS` in libuv, which means the
     * │ child inherits NO console — so cmd allocates itself a fresh one, and
     * │ an allocated console is a visible window. `windowsHide` is the flag
     * │ for this (`CREATE_NO_WINDOW`: a console with no window), but the two
     * │ CONFLICT — with `DETACHED_PROCESS` set there is no console for
     * │ `CREATE_NO_WINDOW` to describe, and it is ignored. Passing both fixes
     * │ nothing, which is why this looks like a flag that does not work.
     * │
     * │ ⇒ ON WINDOWS, DROP `detached`. Nothing is lost: `start` hands the URL
     * │ to the shell and exits immediately, so the browser is not our child
     * │ and does not die with us — and Windows kills no process group on exit
     * │ the way POSIX does. `detached` STAYS on macOS and Linux, where `open`
     * │ and especially `xdg-open` can outlive the call and would otherwise be
     * │ signalled along with the CLI.
     * │
     * │ ⚠ `unref()` on both, and it is what actually lets `agentco start` end:
     * │ an un-unref'd child keeps the event loop alive.
     * └──────────────────────────────────────────────────────────────────────
     */
    const opts: SpawnOptions = win
      ? { windowsHide: true, stdio: 'ignore' }
      : { detached: true, stdio: 'ignore' };
    const child = spawn(cmd, args, opts);
    /**
     * ┌──────────────────────────────────────────────────────────────────────
     * │ 🔴 THIS LINE IS WHY THE DAEMON DOES NOT DIE ON A HEADLESS VPS. (10/09)
     * │
     * │ The `try/catch` around this spawn catches NOTHING that matters. A
     * │ missing binary is reported ASYNCHRONOUSLY, as an `'error'` event — and
     * │ an `'error'` event with no listener is re-thrown by EventEmitter, as
     * │ an uncaught exception, which ends the process.
     * │
     * │ MEASURED: spawning a name that does not exist, in exactly the shape
     * │ this function used, exits the process with code 1. The catch block ran
     * │ zero times.
     * │
     * │ ⚠ AND THE PLACE IT HAPPENS IS A MINIMAL LINUX SERVER, where `xdg-open`
     * │ is simply not installed — the normal state, not a broken machine. So
     * │ `agentco start` printed its URL and then died, and the only thing that
     * │ prevented it was an operator remembering `AGENTCO_HEADLESS=1`. A safe
     * │ default that depends on somebody knowing a flag is not a safe default.
     * │
     * │ ⇒ NO DESKTOP IS NOT AN ERROR. There is nothing to report and nothing
     * │ to retry: the interface already prints the URL for the operator to
     * │ open themselves, which on a VPS is what they were going to do anyway.
     * └──────────────────────────────────────────────────────────────────────
     */
    child.on('error', () => {
      /* no desktop here (a server, a container) — the URL is already on screen */
    });
    child.unref();
  } catch {
    /* could not open it — the interface still shows the path to copy by hand */
  }
}
