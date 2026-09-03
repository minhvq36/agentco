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
import { spawn } from 'node:child_process';

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
   * ⚠ Windows goes through `cmd /c start` with an EMPTY second argument — that
   * slot is the window title, and leaving it out makes `start` read a quoted
   * path as the title and open nothing at all.
   */
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* could not open it — the interface still shows the path to copy by hand */
  }
}
