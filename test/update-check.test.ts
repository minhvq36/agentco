/**
 * The update check, v1. → core/update-check.ts · docs/SPEC-packaging.md §3.6
 *
 * Every test runs against keys made here and a fake network: nothing reaches
 * agent-co.app, and the keys compiled into the app are never needed.
 */

import { strict as assert } from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { companyPaths } from '../dist/core/paths.js';
import {
  CHECK_EVERY_MS,
  checkForUpdate,
  compareVersions,
  installKind,
  readManifest,
  updateStatus,
  verifyManifest,
} from '../dist/core/update-check.js';

function keyPair(): { privateKey: crypto.KeyObject; spki: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, spki: (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64') };
}

const working = keyPair();
const backup = keyPair();
const stranger = keyPair();
const KEYS = [
  { name: 'working', spki: working.spki },
  { name: 'backup', spki: backup.spki },
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const sign = (body: string, key: { privateKey: crypto.KeyObject }): string =>
  crypto.sign(null, enc(body), key.privateKey).toString('base64');

function company() {
  return companyPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-update-')));
}

/** A fake site: answers the manifest and its `.sig`, and records every request. */
function site(body: string, sig: string, calls: string[] = []) {
  return {
    calls,
    fetchBytes: async (url: string): Promise<Uint8Array> => {
      calls.push(url);
      return enc(url.endsWith('.sig') ? sig : body);
    },
  };
}

const MANIFEST = JSON.stringify({ version: '0.1.3', released_at: '2026-09-20' });
const T0 = Date.parse('2026-09-20T10:00:00Z');

test('🔴 a manifest signed by neither key is refused, and its body is never parsed', async () => {
  // Not even JSON: if anything tried to read it before verifying, this would throw.
  const body = 'this is not a manifest {';
  const paths = company();
  const r = await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...site(body, sign(body, stranger)) });
  assert.equal(r?.outcome, 'bad-signature');
  assert.equal(r?.latest, undefined);
  assert.equal(updateStatus({ paths, enabled: true, current: '0.1.2', kind: 'npm' }).available, false);
});

test('a valid manifest signed by the working key is read', async () => {
  const paths = company();
  const r = await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...site(MANIFEST, sign(MANIFEST, working)) });
  assert.equal(r?.outcome, 'ok');
  assert.equal(r?.latest, '0.1.3');
  /*
   * ⚠ `applying: false` is part of the shape, and this `deepEqual` is why the
   * field could not be added quietly. It is the SERVER's answer to "is one
   * running right now" — the page cannot remember that across a remount, which
   * is how a button came back mid-update and got pressed twice (17/09).
   * `updateStatus` has no way to know on its own, so absent means no.
   */
  assert.deepEqual(updateStatus({ paths, enabled: true, current: '0.1.2', kind: 'packaged' }), {
    current: '0.1.2',
    kind: 'packaged',
    available: true,
    applying: false,
    latest: '0.1.3',
  });
  assert.equal(
    updateStatus({ paths, enabled: true, current: '0.1.2', kind: 'packaged', applying: true }).applying,
    true,
  );
});

test('🔴 the offline backup key is accepted too — losing the working key must not silence the channel', () => {
  assert.equal(verifyManifest(enc(MANIFEST), sign(MANIFEST, backup), KEYS), true);
  assert.equal(verifyManifest(enc(MANIFEST), sign(MANIFEST, stranger), KEYS), false);
});

test('a signature over different bytes is refused — one changed character is a different manifest', () => {
  const tampered = MANIFEST.replace('0.1.3', '9.9.9');
  assert.equal(verifyManifest(enc(tampered), sign(MANIFEST, working), KEYS), false);
});

test('something that is not a 64-byte signature is refused without throwing', () => {
  assert.equal(verifyManifest(enc(MANIFEST), 'not base64 at all!!', KEYS), false);
  assert.equal(verifyManifest(enc(MANIFEST), '', KEYS), false);
});

test('a correctly signed body that is not a manifest is malformed, not an update', async () => {
  const body = JSON.stringify({ version: 'latest' });
  const r = await checkForUpdate({ paths: company(), enabled: true, now: T0, keys: KEYS, ...site(body, sign(body, working)) });
  assert.equal(r?.outcome, 'malformed');
  assert.equal(r?.latest, undefined);
  assert.equal(readManifest(enc('[]')), undefined);
});

test('🔴 updates.check: false makes zero requests — off means off', async () => {
  const fake = site(MANIFEST, sign(MANIFEST, working));
  const paths = company();
  assert.equal(await checkForUpdate({ paths, enabled: false, now: T0, keys: KEYS, ...fake }), undefined);
  assert.deepEqual(fake.calls, []);
  assert.equal(fs.existsSync(path.join(paths.state, 'update-check.json')), false);
});

test('within 24 hours the cache answers and no request is made', async () => {
  const paths = company();
  const fake = site(MANIFEST, sign(MANIFEST, working));
  await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...fake });
  assert.equal(fake.calls.length, 2);
  await checkForUpdate({ paths, enabled: true, now: T0 + CHECK_EVERY_MS - 1, keys: KEYS, ...fake });
  assert.equal(fake.calls.length, 2, 'a restart inside the window is not a request');
  await checkForUpdate({ paths, enabled: true, now: T0 + CHECK_EVERY_MS, keys: KEYS, ...fake });
  assert.equal(fake.calls.length, 4);
});

test('🔴 `force` asks anyway — the ceiling is about background curiosity, not about a person', async () => {
  /*
   * `agentco update` read this cache and answered "already on 0.1.4, which is
   * the newest there is" on the day 0.1.5 shipped (17/09/2026). The 24-hour cap
   * exists so the DAEMON does not knock every time it starts; somebody typing a
   * command is owed a fresh answer, not a note written up to a day ago.
   * → cli/index.ts `cmdUpdate`
   */
  const paths = company();
  const fake = site(MANIFEST, sign(MANIFEST, working));
  await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...fake });
  assert.equal(fake.calls.length, 2);

  await checkForUpdate({ paths, enabled: true, now: T0 + 1, keys: KEYS, ...fake });
  assert.equal(fake.calls.length, 2, 'without force, a second look inside the window is silent');

  await checkForUpdate({ paths, enabled: true, now: T0 + 1, keys: KEYS, force: true, ...fake });
  assert.equal(fake.calls.length, 4, 'force must reach the network even one millisecond later');

  // ⚠ And `force` does not override the OFF switch. "Off means off" outranks
  // "somebody asked": an air-gapped install must be able to make no request at
  // all, whatever is typed. → SPEC-packaging §3.4
  await checkForUpdate({ paths, enabled: false, now: T0 + 2, keys: KEYS, force: true, ...fake });
  assert.equal(fake.calls.length, 4, 'updates.check: false still means no request');
});

test('an unreachable site keeps the version it last knew', async () => {
  const paths = company();
  await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...site(MANIFEST, sign(MANIFEST, working)) });
  const r = await checkForUpdate({
    paths,
    enabled: true,
    now: T0 + CHECK_EVERY_MS,
    keys: KEYS,
    fetchBytes: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(r?.outcome, 'unreachable');
  assert.equal(r?.latest, '0.1.3');
});

test('a bad signature is logged once when it starts, not again every day it continues', async () => {
  const paths = company();
  const body = MANIFEST;
  const forged = site(body, sign(body, stranger));
  await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...forged });
  await checkForUpdate({ paths, enabled: true, now: T0 + CHECK_EVERY_MS, keys: KEYS, ...forged });
  const lines = fs.readFileSync(path.join(paths.logs, 'update-check.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]!).outcome, 'bad-signature');
});

test('the banner is off when checking is off, even with a newer version cached', async () => {
  const paths = company();
  await checkForUpdate({ paths, enabled: true, now: T0, keys: KEYS, ...site(MANIFEST, sign(MANIFEST, working)) });
  assert.equal(updateStatus({ paths, enabled: false, current: '0.1.2', kind: 'npm' }).available, false);
});

test('versions compare as numbers, and a broken version sorts below every release', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.0.0', '0.1.0'), -1);
  assert.equal(compareVersions('garbage', '0.0.1'), -1);
});

test('install kind is read from the installer tree, not guessed', () => {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-install-'));
  const app = path.join(install, 'app', '0.1.2');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(path.join(install, 'runtime', 'node-v22.12.0'), { recursive: true });
  fs.writeFileSync(path.join(install, 'current'), 'app/0.1.2');
  assert.equal(installKind(app), 'packaged');

  fs.rmSync(path.join(install, 'current'));
  assert.equal(installKind(app), 'npm', 'an app/ folder alone is not the installer tree');

  const npmGlobal = path.join(install, 'lib', 'node_modules', '@agent-co-app', 'cli');
  fs.mkdirSync(npmGlobal, { recursive: true });
  assert.equal(installKind(npmGlobal), 'npm');
});
