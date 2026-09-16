/**
 * The update check, v1: notice a newer version, never install one.
 * → docs/SPEC-packaging.md §3.4, §3.6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 VERIFY, THEN READ.                                                    │
 * │                                                                          │
 * │ The manifest's bytes are checked against the release keys compiled into  │
 * │ this build BEFORE a single field is parsed. A body with a bad signature  │
 * │ is not "an update we could not check" — it is treated as an attack:      │
 * │ nothing is read from it, the banner stays silent, and it is logged.      │
 * │                                                                          │
 * │ The protocol is the one thing an installed copy can never be taught      │
 * │ later, which is why v1 verifies even though it only shows a number.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 Nothing here decides what the banner says or where it points — that is
 * `update-links.ts`, compiled in.
 *
 * ⚠ FAILURE IS SILENCE. An unreachable site is Tuesday on a corporate network,
 * not an error state; the last version known stays known.
 *
 * ⚠ A plain anonymous GET: no query string, no identifier, no version in the
 * path (§3.3). The update check must never become the licence check.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CompanyPaths } from './paths.js';
import { RELEASE_PUBLIC_KEYS } from './release-keys.js';
import { MANIFEST_URL, type InstallKind, type UpdateView } from './update-links.js';
import { appVersion } from './version.js';

export const SIGNATURE_URL = `${MANIFEST_URL}.sig`;

/**
 * Where to ask. `AGENTCO_MANIFEST_URL` moves it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE URL WAS NEVER THE FENCE, AND OPENING IT COSTS NOTHING.            │
 * │                                                                          │
 * │ Two things guard this channel and neither is an address:                 │
 * │                                                                          │
 * │   · nothing is read from a manifest until it verifies against a key      │
 * │     COMPILED INTO THIS BUILD (§3.2) — so a different URL can only ever   │
 * │     serve something we signed ourselves;                                 │
 * │   · nothing is applied that is not NEWER than what is running, so an     │
 * │     old-but-genuine manifest cannot be replayed as a downgrade.          │
 * │                                                                          │
 * │ What it buys: the apply path (§3.7) can be run end to end against a      │
 * │ local manifest and a local layer, on a real packaged install, without    │
 * │ publishing a version to test with. Before this, proving the button meant │
 * │ cutting a release whose only purpose was to be a target.                 │
 * │                                                                          │
 * │ ⚠ Somebody who can set environment variables on the machine already owns │
 * │ the machine. This is not the weakest link and pretending it is would     │
 * │ cost a real capability — an air-gapped or VPS install pointing at an     │
 * │ internal mirror wants exactly this. → SPEC-deploy                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function manifestUrls(env: NodeJS.ProcessEnv = process.env): {
  manifest: string;
  signature: string;
} {
  const base = env['AGENTCO_MANIFEST_URL']?.trim() || MANIFEST_URL;
  return { manifest: base, signature: `${base}.sig` };
}

/** §3.4: at most once per 24 h — enforced by the cache, so a restart is not a request. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** Off the startup path: the daemon is serving well before anyone looks for updates. */
export const UPDATE_FIRST_CHECK_MS = 30_000;
/** How often the daemon asks the cache whether 24 h have passed. */
export const UPDATE_TICK_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10_000;
/** A manifest is a few hundred bytes. Anything large is not one, and is not read into memory. */
const MAX_BYTES = 64 * 1024;

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export interface ReleaseKey {
  readonly name: string;
  /** Base64 DER SubjectPublicKeyInfo of an Ed25519 key. */
  readonly spki: string;
}

/**
 * `ok` verified and read · `unreachable` no answer, a non-2xx or a timeout ·
 * `bad-signature` signed by neither key — an attack, not a glitch ·
 * `malformed` correctly signed, but not a manifest this version understands.
 */
export type Outcome = 'ok' | 'unreachable' | 'bad-signature' | 'malformed';

export interface UpdateCache {
  checked_at: string;
  outcome: Outcome;
  latest?: string;
}

/**
 * True when `signature` (base64) is an Ed25519 signature over exactly `body`
 * by ANY of `keys` — the working key or the offline backup (§3.6).
 */
export function verifyManifest(
  body: Uint8Array,
  signature: string,
  keys: readonly ReleaseKey[] = RELEASE_PUBLIC_KEYS,
): boolean {
  const sig = Buffer.from(signature.trim(), 'base64');
  // An Ed25519 signature is exactly 64 bytes; anything else is not one.
  if (sig.length !== 64) return false;
  return keys.some((k) => {
    try {
      const key = crypto.createPublicKey({ key: Buffer.from(k.spki, 'base64'), format: 'der', type: 'spki' });
      return crypto.verify(null, body, key, sig);
    } catch {
      return false;
    }
  });
}

/** One downloadable layer of an install. → SPEC-packaging §3.5 */
export interface Layer {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

export interface Manifest {
  version: string;
  /** Absent in a v1 manifest, and on any install that only knows how to notify. */
  layers?: { app?: Layer };
}

/**
 * ⚠ Only ever called on bytes `verifyManifest` accepted.
 *
 * 🔴 `version` IS THE ONLY REQUIRED FIELD, AND THAT IS A PROMISE, NOT AN
 * OVERSIGHT. §3.5: the manifest is append-only forever, because the reader is
 * already installed on somebody else's machine and cannot be fixed. So a v1
 * manifest read here yields a version and no layers; a v2 manifest read by a
 * v1 copy yields a version and its `layers` are never looked at. Four cases,
 * every one degrading to the previous behaviour instead of to an error.
 *
 * ⚠ A MALFORMED `layers` IS NOT A MALFORMED MANIFEST. Dropping the whole answer
 * because an optional block is wrong would turn "cannot update automatically"
 * into "cannot even tell you a version exists" — strictly worse, and for the
 * copies least able to do anything about it.
 */
export function readManifest(body: Uint8Array): Manifest | undefined {
  try {
    const m = JSON.parse(Buffer.from(body).toString('utf8')) as {
      version?: unknown;
      layers?: unknown;
    };
    if (typeof m.version !== 'string' || !VERSION.test(m.version)) return undefined;

    const app = readLayer((m.layers as { app?: unknown } | undefined)?.app);
    return app ? { version: m.version, layers: { app } } : { version: m.version };
  } catch {
    return undefined;
  }
}

/**
 * ⚠ Every field checked, including `size`. The size is what lets a download be
 * refused before it is read into memory rather than after — a manifest is a few
 * hundred bytes and anything claiming otherwise is not one. → `fetchBytes`
 */
function readLayer(raw: unknown): Layer | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const l = raw as Partial<Layer>;
  return typeof l.version === 'string' &&
    VERSION.test(l.version) &&
    typeof l.url === 'string' &&
    l.url.startsWith('https://') &&
    typeof l.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(l.sha256) &&
    typeof l.size === 'number' &&
    Number.isInteger(l.size) &&
    l.size > 0
    ? { version: l.version, url: l.url, sha256: l.sha256, size: l.size }
    : undefined;
}

/**
 * `-1 | 0 | 1`. A string that is not `x.y.z` counts as `0.0.0`, which sorts
 * below every release — the same safe direction as `appVersion()`'s fallback:
 * a broken install is offered an update rather than told it is current.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => VERSION.exec(v)?.slice(1).map(Number) ?? [0, 0, 0];
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return 0;
}

/** `dist/core/update-check.js` → the package root, the folder holding `package.json`. */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

/**
 * Read from STRUCTURE, not guessed: the installer's tree is
 * `<install>/app/<version>/` beside `<install>/runtime/` and `<install>/current`
 * (`scripts/package.ts`). Anything else — a global npm install, a source
 * checkout — is `npm`.
 */
export function installKind(
  root: string = packageRoot(),
  exists: (p: string) => boolean = fs.existsSync,
): InstallKind {
  const layer = path.dirname(root);
  const install = path.dirname(layer);
  return path.basename(layer) === 'app' &&
    exists(path.join(install, 'runtime')) &&
    exists(path.join(install, 'current'))
    ? 'packaged'
    : 'npm';
}

function cacheFile(paths: CompanyPaths): string {
  return path.join(paths.state, 'update-check.json');
}

export function readUpdateCache(paths: CompanyPaths): UpdateCache | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(paths), 'utf8')) as Partial<UpdateCache>;
    return typeof c.checked_at === 'string' && typeof c.outcome === 'string' ? (c as UpdateCache) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('response too large');
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error('response too large');
  return body;
}

/**
 * One check, if 24 h have passed since the last. Returns the cache as it now
 * stands, or `undefined` when checking is switched off — and then NO request
 * was made at all (§3.4: off means off).
 *
 * Every dependency with a side effect is a parameter, so a test can hand it a
 * fake network, a fake clock and its own keys.
 */
export async function checkForUpdate(o: {
  paths: CompanyPaths;
  enabled: boolean;
  now?: number;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  keys?: readonly ReleaseKey[];
}): Promise<UpdateCache | undefined> {
  if (!o.enabled) return undefined;

  const now = o.now ?? Date.now();
  const previous = readUpdateCache(o.paths);
  if (previous && now - Date.parse(previous.checked_at) < CHECK_EVERY_MS) return previous;

  const get = o.fetchBytes ?? fetchBytes;
  let outcome: Outcome;
  let latest: string | undefined;
  try {
    const urls = manifestUrls();
    const [body, sig] = await Promise.all([get(urls.manifest), get(urls.signature)]);
    if (!verifyManifest(body, Buffer.from(sig).toString('utf8'), o.keys)) {
      outcome = 'bad-signature';
    } else {
      const manifest = readManifest(body);
      outcome = manifest ? 'ok' : 'malformed';
      latest = manifest?.version;
    }
  } catch {
    outcome = 'unreachable';
    // Not hearing is not being told otherwise: what was known stays known.
    latest = previous?.latest;
  }

  const next: UpdateCache = {
    checked_at: new Date(now).toISOString(),
    outcome,
    ...(latest ? { latest } : {}),
  };
  fs.mkdirSync(o.paths.state, { recursive: true });
  fs.writeFileSync(cacheFile(o.paths), JSON.stringify(next, null, 2), 'utf8');

  // Logged when the outcome CHANGES — a site down for a week is one line, not seven.
  if (outcome !== 'ok' && outcome !== previous?.outcome) {
    try {
      fs.mkdirSync(o.paths.logs, { recursive: true });
      fs.appendFileSync(
        path.join(o.paths.logs, 'update-check.jsonl'),
        JSON.stringify({ at: next.checked_at, outcome }) + '\n',
        'utf8',
      );
    } catch {
      /* a log that cannot be written must not break the check */
    }
  }
  return next;
}

/** What `GET /api/update` answers — from the cache only, never the network. */
export function updateStatus(o: {
  paths: CompanyPaths;
  enabled: boolean;
  current?: string;
  kind?: InstallKind;
}): UpdateView {
  const current = o.current ?? appVersion();
  const kind = o.kind ?? installKind();
  const latest = o.enabled ? readUpdateCache(o.paths)?.latest : undefined;
  return {
    current,
    kind,
    available: latest !== undefined && compareVersions(latest, current) > 0,
    ...(latest ? { latest } : {}),
  };
}
