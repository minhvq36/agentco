
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

import { companyPaths } from '../dist/core/paths.js';
import {
  readClients,
  readOAuth,
  readSecrets,
  saveClient,
  saveOAuth,
  writeSecrets,
} from '../dist/core/secrets.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-clients-'));
const paths = (): ReturnType<typeof companyPaths> => companyPaths(dir);

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(paths().secretsFile, { force: true });
});

const KEY = 'https://mcp.notion.com|http://127.0.0.1:7317/api/oauth/callback';

const ACC = {
  client_id: 'client-cu',
  access_token: 'at',
  refresh_token: 'rt',
  token_type: 'bearer',
  mcp_url: 'https://mcp.notion.com/mcp',
  issuer: 'https://mcp.notion.com',
};

test('⭐ client_id is written to DISK — survives a daemon restart', () => {
  saveClient(paths(), KEY, 'client-1');
  assert.equal(readClients(paths())[KEY], 'client-1');
});

test('⭐ the key includes redirect_uri — a different port ⇒ a different app, never reused by mistake', () => {
  saveClient(paths(), KEY, 'client-1');
  const khac = 'https://mcp.notion.com|http://127.0.0.1:9999/api/oauth/callback';
  assert.equal(readClients(paths())[khac], undefined);
  saveClient(paths(), khac, 'client-2');
  assert.equal(readClients(paths())[KEY], 'client-1', 'registering the new port must not overwrite the old one');
});

test('🔴 PLUGGING IN ONE ARM MUST NOT WIPE $clients (the half easiest to lose)', () => {
  saveClient(paths(), KEY, 'client-1');
  saveOAuth(paths(), 'NOTION_OAUTH_A1B2C3D4', ACC as never);

  writeSecrets(paths(), { ...readSecrets(paths()), SHOP_TOKEN: 'abc' });

  assert.equal(readClients(paths())[KEY], 'client-1', '$clients wiped ⇒ next time it registers a NEW app');
  assert.ok(readOAuth(paths())['NOTION_OAUTH_A1B2C3D4'], '$oauth must still be there (old regression)');
  assert.equal(readSecrets(paths())['SHOP_TOKEN'], 'abc');
});

test('⭐ an empty store ⇒ does not create an empty key in the file', () => {
  writeSecrets(paths(), { A: 'x' });
  const raw = JSON.parse(fs.readFileSync(paths().secretsFile, 'utf8')) as Record<string, unknown>;
  assert.equal('$clients' in raw, false, 'an empty key only makes the file harder to read');
  assert.equal('$oauth' in raw, false);
});

test('⭐ an account\'s secret is NOT mixed up with the app\'s identity', () => {
  saveClient(paths(), KEY, 'client-1');
  saveOAuth(paths(), 'NOTION_OAUTH_A1B2C3D4', ACC as never);
  const s = readSecrets(paths());
  assert.deepEqual(Object.keys(s), ['NOTION_OAUTH_A1B2C3D4']);
});
