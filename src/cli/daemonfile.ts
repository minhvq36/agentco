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
  /**
   * ┌──────────────────────────────────────────────────────────────────────────
   * │ 🔴 WINDOWS OPENS THROUGH `explorer.exe`, AND BOTH OBVIOUS ANSWERS WERE
   * │ WRONG. Two bugs, one line. → SPEC-cli.md §1
   * │
   * │ ① `cmd /c start` + `detached: true` — the original. A black console
   * │   window flashes before the browser appears. The user's words: it looks
   * │   like something leaked out of the app, right after an icon was clicked.
   * │
   * │ ② `cmd /c start` + `windowsHide: true` — the repair, and it BROKE OPENING
   * │   THE BROWSER AT ALL on the one path that matters. Reported from a real
   * │   desktop: with the daemon already running, clicking the icon a second
   * │   time did nothing. Measured, parent exiting immediately, marker on disk:
   * │
   * │       detached           LAUNCHED
   * │       windowsHide        nothing        ← the repair
   * │       both               LAUNCHED
   * │       neither            nothing
   * │
   * │   `detached` is what lets the grandchild outlive a parent that exits in
   * │   milliseconds — and `cmdStart`'s already-running branch does exactly
   * │   that: it opens a browser and returns, with no server holding the loop
   * │   alive. The other branch runs forever, which is why only one broke.
   * │
   * │   ⚠ AND THE FIRST PROBE MISSED IT by sleeping 2.5s after the spawn — it
   * │   measured a shape the real code does not have.
   * │   [[agentco-measurement-vs-conclusion]]
   * │
   * │ ⇒ THE FIX IS NOT A FLAG. It is not launching a CONSOLE program at all.
   * │ Read out of the PE headers rather than assumed:
   * │
   * │       cmd.exe        subsystem 3 = CONSOLE   ← can always be given a window
   * │       explorer.exe   subsystem 2 = GUI       ← cannot have one, ever
   * │
   * │ A GUI-subsystem process cannot be handed a console by any combination of
   * │ flags, so the flash is impossible BY CONSTRUCTION rather than suppressed
   * │ by an option whose interaction nobody can predict. `detached` stays and
   * │ keeps the survival guarantee it always had.
   * │
   * │ ⚠ `explorer.exe` opens a URL in the default browser and a path in the
   * │ file manager — exactly the two jobs `openBrowser` and `openFolder` need.
   * │ It always exits non-zero; nothing here reads its exit code.
   * └──────────────────────────────────────────────────────────────────────────
   */
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['explorer.exe', [target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  try {
    // ⚠ `unref()` below is what lets `agentco start` end — an un-unref'd child
    // keeps the event loop alive. `detached` is what lets the OPENED thing
    // survive us; removing it is the bug that came back. See the box above.
    const opts: SpawnOptions = { detached: true, windowsHide: true, stdio: 'ignore' };
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
