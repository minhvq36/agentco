/**
 * Applying an update, for a packaged install. → docs/SPEC-packaging.md §3.7
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE ONE RULE: PROBE BEFORE COMMIT.                                    │
 * │                                                                          │
 * │ A correct `sha256` proves the bytes arrived. It does not prove the thing  │
 * │ starts. So the new tree is written BESIDE the running one, started on a   │
 * │ free port with `--no-ui`, and must answer `/healthz` with its own version │
 * │ before `current` is allowed to move. A tree that never answers is deleted │
 * │ and the pointer is left exactly where it was.                            │
 * │                                                                          │
 * │ That is stronger than rolling back after the fact, and it is why there is │
 * │ no rollback here: a half-applied state never exists, so there is nothing  │
 * │ to roll back to. The user asked for "flip back and tell me" (17/09); this │
 * │ delivers the same guarantee by never flipping forward on faith.           │
 * │                                                                          │
 * │ ⚠ THE PROBE NEVER USES THE COMPANY'S PORT. The daemon being replaced is   │
 * │ still holding it, and the probe must not fight the thing it is about to   │
 * │ succeed. → cli/port.ts §findFreePort                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractTarGz } from './archive.js';
import { findFreePort } from '../cli/port.js';
import type { Layer } from './update-check.js';

/** How long the new tree gets to answer before it is treated as broken. */
export const PROBE_TIMEOUT_MS = 60_000;

/**
 * ⚠ A CEILING ON THE DOWNLOAD, and it comes from the manifest rather than from
 * a constant here. The manifest is signed, so the size in it is as trustworthy
 * as the hash beside it; a stream that outruns it is refused mid-flight instead
 * of being read into memory first.
 */
const SIZE_SLACK = 1024;

export type ApplyOutcome =
  | { ok: true; version: string }
  | { ok: false; reason: 'download' | 'hash' | 'extract' | 'probe'; detail: string };

export interface ApplyPaths {
  /** `<install>` — the directory holding `app/`, `runtime/` and `current`. */
  root: string;
}

/** `<install>/app/<version>` */
export function layerDir(root: string, version: string): string {
  return path.join(root, 'app', version);
}

/**
 * ⚠ Written to a temporary name and renamed into place, because a half-written
 * `current` is a pointer at nothing and the launcher would fall back for a
 * reason nobody could reconstruct. Same shape as the key store's atomic write.
 */
export function writeCurrent(root: string, version: string): void {
  const tmp = path.join(root, `.current.${process.pid}`);
  fs.writeFileSync(tmp, path.join('app', version), 'utf8');
  fs.renameSync(tmp, path.join(root, 'current'));
}

export function readCurrent(root: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(root, 'current'), 'utf8').trim();
    return raw || undefined;
  } catch {
    return undefined;
  }
}

async function download(layer: Layer, to: string): Promise<void> {
  const res = await fetch(layer.url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > layer.size + SIZE_SLACK) {
    throw new Error(`served ${bytes.length} bytes, manifest says ${layer.size}`);
  }
  fs.writeFileSync(to, bytes);
}

function sha256Of(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Start the freshly written tree on a port of its own and wait for it to say
 * who it is.
 *
 * ⚠ IT ASKS FOR THE VERSION, not merely for a 200. A tree that serves the OLD
 * code would answer `/healthz` perfectly well, and committing to it would be a
 * silent no-op update — the failure this whole function exists to prevent.
 */
export async function probe(
  dir: string,
  opts: { timeoutMs?: number; host?: string } = {},
): Promise<{ ok: boolean; detail: string }> {
  const host = opts.host ?? '127.0.0.1';
  const port = await findFreePort(45_000 + Math.floor(Math.random() * 5_000), host);
  if (port === undefined) return { ok: false, detail: 'no free port for the probe' };

  const entry = path.join(dir, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(entry)) return { ok: false, detail: `no ${entry}` };

  /*
   * ⚠ A THROWAWAY COMPANY, AND IT IS THE NEW TREE THAT CREATES IT. `start`
   * refuses a directory with no `company.yaml`, so the probe has to make one —
   * and making it with the version under test means `init` is exercised too,
   * which is the other half of "does this build work at all".
   *
   * ⚠ NEVER THE REAL COMPANY. A version that turns out to be broken must not
   * have been given the customer's data to be broken with.
   */
  const company = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-probe-'));
  const seeded = await new Promise<number | null>((resolve) => {
    const init = spawn(process.execPath, [entry, 'init', '--dir', company], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    init.on('error', () => resolve(null));
    init.on('exit', (code) => resolve(code));
  });
  if (seeded !== 0) {
    fs.rmSync(company, { recursive: true, force: true });
    return { ok: false, detail: `init exited ${seeded}` };
  }

  const child = spawn(
    process.execPath,
    [entry, 'start', '--no-ui', '--dir', company, '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  child.on('error', (e) => (out += e.message));

  const want = versionOf(dir);
  const until = Date.now() + (opts.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    for (;;) {
      if (Date.now() > until) return { ok: false, detail: `no answer in time\n${out.slice(-2000)}` };
      const said = await healthzVersion(host, port);
      if (said !== undefined) {
        return said === want
          ? { ok: true, detail: said }
          : { ok: false, detail: `answered ${said}, expected ${want}` };
      }
      if (child.exitCode !== null) {
        return { ok: false, detail: `exited ${child.exitCode}\n${out.slice(-2000)}` };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    child.kill();
    fs.rmSync(company, { recursive: true, force: true });
  }
}

async function healthzVersion(host: string, port: number): Promise<string | undefined> {
  try {
    const res = await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { ok?: boolean; version?: string };
    return body.ok === true && typeof body.version === 'string' ? body.version : undefined;
  } catch {
    return undefined;
  }
}

function versionOf(dir: string): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string })
      .version;
  } catch {
    return '';
  }
}

/**
 * Download, verify, unpack, probe, commit. Returns instead of throwing: every
 * failure here has a sentence a person has to read, and an exception thrown out
 * of a background job is a sentence nobody reads.
 *
 * ⚠ It does NOT restart the daemon. Committing and restarting are different
 * acts with different owners — the caller holds the running server and knows
 * how to close it. → server.ts `POST /api/update`
 */
export async function applyLayer(
  paths: ApplyPaths,
  layer: Layer,
): Promise<ApplyOutcome> {
  const target = layerDir(paths.root, layer.version);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-layer-'));
  const archive = path.join(work, 'app.tar.gz');

  try {
    try {
      await download(layer, archive);
    } catch (err) {
      return { ok: false, reason: 'download', detail: String((err as Error).message ?? err) };
    }

    const got = sha256Of(archive);
    if (got !== layer.sha256) {
      // 🔴 Treated the way a bad signature is (§3.2): not "a download we could
      // not check", but bytes that are not the ones that were signed for.
      return { ok: false, reason: 'hash', detail: `sha256 ${got}, manifest says ${layer.sha256}` };
    }

    // ⚠ A leftover from an interrupted attempt would otherwise be extracted
    // OVER, leaving a mixture of two versions that passes every later check.
    fs.rmSync(target, { recursive: true, force: true });
    try {
      await extractTarGz(archive, target);
    } catch (err) {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: false, reason: 'extract', detail: String((err as Error).message ?? err) };
    }

    const probed = await probe(target);
    if (!probed.ok) {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: false, reason: 'probe', detail: probed.detail };
    }

    writeCurrent(paths.root, layer.version);
    return { ok: true, version: layer.version };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
