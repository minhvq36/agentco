
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readOAuth, readSecrets, saveOAuth, writeSecrets } from '../dist/core/secrets.js';
import { applyToken, needsRefresh } from '../dist/core/oauth.js';

function paths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-oauth-'));
  return { secretsFile: path.join(dir, '.state', 'secrets.json') } as never;
}

const ACC = {
  client_id: 'c1',
  access_token: 'at-1',
  refresh_token: 'rt-1',
  token_type: 'Bearer',
  mcp_url: 'https://mcp.notion.com/mcp',
  issuer: 'https://mcp.notion.com',
  label: "Alex's workspace",
};


test('static secrets still read/write exactly as before — no migration involved', () => {
  const p = paths();
  writeSecrets(p, { A: '1', B: '2' });
  assert.deepEqual(readSecrets(p), { A: '1', B: '2' });
});

test('a missing file returns empty, does not throw', () => {
  assert.deepEqual(readSecrets(paths()), {});
  assert.deepEqual(readOAuth(paths()), {});
});


test('an OAuth account flattens to access_token under the CORRECT secret name', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  assert.equal(readSecrets(p)['NOTION_OAUTH_A1B2'], 'at-1');
});

test('OAuth WINS over a static secret with the same name — this direction is intentional', () => {
  const p = paths();
  writeSecrets(p, { NOTION_OAUTH_A1B2: 'old-hand-pasted' });
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  assert.equal(readSecrets(p)['NOTION_OAUTH_A1B2'], 'at-1');
});

test('a half-broken OAuth record is DROPPED, not flattened into undefined', () => {
  const p = paths();
  saveOAuth(p, 'X', { client_id: 'c' } as never);
  assert.deepEqual(readOAuth(p), {});
  assert.equal('X' in readSecrets(p), false);
});


test('⭐ writeSecrets KEEPS the OAuth account — plugging in an arm must not erase a login', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  writeSecrets(p, { ...readSecrets(p), GITHUB_TOKEN: 'ghp_x' });
  assert.equal(readOAuth(p)['NOTION_OAUTH_A1B2']?.refresh_token, 'rt-1');
  assert.equal(readSecrets(p)['GITHUB_TOKEN'], 'ghp_x');
});

test('⭐ writeSecrets does NOT bake a static copy of a self-refreshing secret', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  writeSecrets(p, readSecrets(p));
  const onDisk = JSON.parse(fs.readFileSync((p as { secretsFile: string }).secretsFile, 'utf8')) as Record<string, unknown>;
  assert.equal('NOTION_OAUTH_A1B2' in onDisk, false, 'access_token got baked into a static secret');
  assert.ok(onDisk['$oauth'], 'the $oauth section must still be there');
});

test('saveOAuth(null) removes exactly one account, leaves the other untouched', () => {
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  saveOAuth(p, 'B', { ...ACC, access_token: 'at-b' } as never);
  saveOAuth(p, 'A', null);
  assert.deepEqual(Object.keys(readOAuth(p)), ['B']);
});

test('multiple accounts at once — two Notion workspaces live side by side', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_AAAA', { ...ACC, access_token: 'at-a', label: 'Personal' } as never);
  saveOAuth(p, 'NOTION_OAUTH_BBBB', { ...ACC, access_token: 'at-b', label: 'Company' } as never);
  const s = readSecrets(p);
  assert.equal(s['NOTION_OAUTH_AAAA'], 'at-a');
  assert.equal(s['NOTION_OAUTH_BBBB'], 'at-b');
});


test('⭐ applyToken REPLACES refresh_token when the server sends a new one', () => {
  const next = applyToken(ACC as never, { access_token: 'at-2', refresh_token: 'rt-2' } as never);
  assert.equal(next.refresh_token, 'rt-2');
  assert.equal(next.access_token, 'at-2');
});

test('⭐ applyToken KEEPS the old refresh_token when the server does NOT send one', () => {
  const next = applyToken(ACC as never, { access_token: 'at-2' } as never);
  assert.equal(next.refresh_token, 'rt-1');
});

test('applyToken preserves identity (client_id · mcp_url · issuer · label) across every refresh', () => {
  const next = applyToken(ACC as never, { access_token: 'at-2' } as never);
  assert.equal(next.client_id, 'c1');
  assert.equal(next.mcp_url, 'https://mcp.notion.com/mcp');
  assert.equal(next.issuer, 'https://mcp.notion.com');
  assert.equal(next.label, "Alex's workspace");
});

test('applyToken converts expires_in into an ABSOLUTE timestamp', () => {
  const t0 = Date.now();
  const next = applyToken(ACC as never, { access_token: 'a', expires_in: 28800 } as never);
  assert.ok(next.expires_at! >= t0 + 28800_000 - 50 && next.expires_at! <= Date.now() + 28800_000);
});


test('needsRefresh: refreshes at 50% of lifetime, does not wait until the last second', () => {
  const now = Date.now();
  const at = (msLeft: number) => ({ ...ACC, expires_at: now + msLeft }) as never;
  assert.equal(needsRefresh(at(7 * 3600_000), now), false, '7 hours left is not yet due');
  assert.equal(needsRefresh(at(3 * 3600_000), now), true, '3 hours left triggers a refresh');
  assert.equal(needsRefresh(at(-1), now), true, 'already expired');
});

test('needsRefresh: NO expiry declared ⇒ false — do not throw away a secret that is working fine', () => {
  assert.equal(needsRefresh({ ...ACC, expires_at: undefined } as never), false);
});


test('⭐ the old file is NOT truncated on write — losing half the file loses the WHOLE store', () => {
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  for (let i = 0; i < 20; i++) {
    writeSecrets(p, { [`K${i}`]: `v${i}` });
    const onDisk = JSON.parse(fs.readFileSync((p as { secretsFile: string }).secretsFile, 'utf8'));
    assert.ok(onDisk['$oauth']?.['A'], `lost the account on iteration ${i}`);
  }
});

test('⭐ leaves no temp file behind once the write finishes', () => {
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  const dir = path.dirname((p as { secretsFile: string }).secretsFile);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), []);
});

test('⭐ needsRefresh: a PERMANENTLY dead grant ⇒ stop retrying', () => {
  const dead = { ...ACC, expires_at: Date.now() - 1, dead: { at: 'x', why: 'invalid_grant' } };
  assert.equal(needsRefresh(dead as never), false);
  const deadButFresh = { ...ACC, expires_at: Date.now() + 3600_000, dead: { at: 'x', why: 'y' } };
  assert.equal(needsRefresh(deadButFresh as never), false);
});

test('needsRefresh: no refresh token available ⇒ false, even if already expired', () => {
  const dead = { ...ACC, refresh_token: undefined, expires_at: Date.now() - 1 };
  assert.equal(needsRefresh(dead as never), false);
});
