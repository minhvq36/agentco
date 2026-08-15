/**
 * Theo dõi daemon đang chạy.
 *
 * → docs/SPEC-cli.md §1
 *
 * `agentco start` phải IDEMPOTENT: daemon đã chạy thì mở trình duyệt vào nó
 * thay vì báo lỗi port. Nghĩa là double-click shortcut LUÔN dẫn tới UI chạy
 * được, dù daemon đang sống hay đã chết.
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

/** Trả về daemon ĐANG SỐNG THẬT, tự dọn file cũ nếu tiến trình đã chết. */
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

  // PID còn sống chưa chắc là daemon của ta (PID bị tái sử dụng) — hỏi /healthz.
  try {
    const res = await fetch(`${info.url}/healthz`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) throw new Error('healthz không ok');
    const body = (await res.json()) as { ok?: boolean };
    if (!body.ok) throw new Error('healthz trả về không ok');
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
    // EPERM = tiến trình tồn tại nhưng khác quyền -> vẫn coi là sống
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function openBrowser(url: string): void {
  if (process.env['AGENTCO_HEADLESS'] === '1') return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* không mở được thì thôi, URL đã in ra terminal rồi */
  }
}
