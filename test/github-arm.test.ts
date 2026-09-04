
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CATALOG, armHash, buildConfig, catalogForUi, findArm, needsOAuth } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';

const gh = findArm('github')!;
const cfg = (input: Parameters<typeof buildConfig>[1]): { headers?: Record<string, string> } =>
  buildConfig(gh.spec, input) as { headers?: Record<string, string> };


test('⭐ GitHub logs in via DEVICE CODE, and client_id is public data', () => {
  assert.equal(gh.auth?.kind, 'device');
  assert.match(gh.auth?.clientId ?? '', /^Iv23li/, 'GitHub App client_id');
  assert.equal(gh.price, 'login', 'the user does not type any key');
  assert.deepEqual(gh.secrets, [], 'the key comes from the login flow, not from an input field');
});

test('🔴 NO client secret or private key anywhere in the catalog', () => {
  const src = readFileSync(new URL('../src/core/catalog.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.includes('│'))
    .join('\n');
  assert.doesNotMatch(code, /client_secret\s*:/i);
  assert.doesNotMatch(code, /private_?key/i);
  assert.doesNotMatch(code, /-----BEGIN/);
});

test('⭐ GitHub needs login — derived from the ${OAUTH} placeholder, not hardcoded', () => {
  assert.equal(needsOAuth(gh), true);
  assert.equal(catalogForUi().find((a) => a.id === 'github')?.needsLogin, true);
});

test('⭐ there is an IDENTITY LOOKUP step — because GitHub does not return a name in the token response', () => {
  assert.equal(gh.identity?.tool, 'get_me');
  assert.equal(gh.identity?.idField, 'id', 'must be a key that does NOT change when the user renames themselves');
  assert.equal(gh.identity?.labelField, 'login');
});

test('⭐ Notion has NO auth/identity — these two fields are the EXCEPTION, not the norm', () => {
  const notion = findArm('notion')!;
  assert.equal(notion.auth, undefined, 'Notion has DCR ⇒ no need to ship a client_id');
  assert.equal(notion.identity, undefined, 'Notion returns workspace_id right in the token response');
});


test('🔴 THE CARD MUST STATE the condition — "private repo" without saying the app must be installed is a half-truth', () => {
  assert.match(t(gh.blurb), /cài agentco vào/i); // i18n-allow-vietnamese: matches the real (still-Vietnamese) catalog blurb text
});

test('⭐ THERE IS A DOOR to GitHub\'s consent screen — without it the arm "works" but everything 404s', () => {
  assert.match(gh.scope?.url ?? '', /^https:\/\/github\.com\/apps\/[\w-]+\/installations\/new$/);
  assert.ok(gh.scope?.say, 'the button must have text');
  /*
    Removed 09/02: the old assertion required `scope.help` to match a "GitHub keeps this" phrase. The
    `help` field has been removed from the catalog (user's call — the app is now
    all-text), so that assertion was locking in specific wording, not an invariant.

    The real invariant still holds in the two lines above: **there is a door to
    GitHub's consent screen**. The "who holds this scope" statement is now surfaced
    at a more relevant point instead — `repoScan` (§5h·7o) and the runtime 404
    translation (§5h·7f-bis), both of which have their own tests.
  */
});

test('⭐ ONLY ONE repo fence, and it belongs to GitHub — we do not build a second one', () => {
  assert.equal((gh as Record<string, unknown>)['limitTo'], undefined);
  assert.ok(gh.repoScan, 'but it must be possible to QUERY the installation — a checkmark alone does not prove reach');
});


test('🔴 groups must be SORTED before joining — the same ticks ⇒ the same hash', () => {
  const a = cfg({ folders: [], groups: ['repos', 'context'] });
  const b = cfg({ folders: [], groups: ['context', 'repos'] });
  assert.equal(a.headers?.['X-MCP-Toolsets'], 'context,repos');
  assert.deepEqual(a, b);
  assert.equal(armHash(a, ['G'], 'read'), armHash(b, ['G'], 'read'), 'tick order must not produce a second arm');
});

test('⭐ different groups ⇒ different ARM (it changes both capability and billing)', () => {
  const hep = armHash(cfg({ folders: [], groups: ['context'] }), ['G'], 'read');
  const rong = armHash(cfg({ folders: [], groups: ['context', 'repos'] }), ['G'], 'read');
  assert.notEqual(hep, rong);
});

test('⭐ no group ticked ⇒ NO header — the whole server is not enabled by default', () => {
  assert.equal(cfg({ folders: [] }).headers?.['X-MCP-Toolsets'], undefined);
  assert.equal(cfg({ folders: [], groups: [] }).headers?.['X-MCP-Toolsets'], undefined);
});

test('⭐ the empty ${OAUTH} placeholder is still substituted correctly, without touching the group header', () => {
  const c = cfg({ folders: [], account: 'GITHUB_OAUTH_A1B2C3D4', groups: ['repos'] });
  assert.equal(c.headers?.['Authorization'], 'Bearer ${GITHUB_OAUTH_A1B2C3D4}');
  assert.equal(c.headers?.['X-MCP-Toolsets'], 'repos');
});

test('🔴 groups must NOT borrow the ${…} placeholder syntax used by keys', () => {
  const c = cfg({ folders: [], account: 'GITHUB_OAUTH_A1B2C3D4', groups: ['repos'] });
  const con = JSON.stringify(c).match(/\$\{[^}]+\}/g) ?? [];
  assert.deepEqual(con, ['${GITHUB_OAUTH_A1B2C3D4}'], 'only the KEY placeholder may remain');
});


test('🔴 the `read` level adds the SERVER-SIDE FENCE header to the config', () => {
  assert.equal(cfg({ folders: [], groups: ['repos'], level: 'read' }).headers?.['X-MCP-Readonly'], 'true');
});

test('⭐ the `full` level does NOT have that header', () => {
  assert.equal(cfg({ folders: [], groups: ['repos'], level: 'full' }).headers?.['X-MCP-Readonly'], undefined);
});

test('⭐ changing level ⇒ different hash ⇒ other workspaces are NOT changed along with it', () => {
  const doc = cfg({ folders: [], groups: ['repos'], level: 'read' });
  const toan = cfg({ folders: [], groups: ['repos'], level: 'full' });
  assert.notEqual(armHash(doc, ['G'], 'read'), armHash(toan, ['G'], 'full'));
});

test('⭐ an entry that does NOT declare readOnlyHeaders leaves the `read` level not changing the config', () => {
  const notion = findArm('notion')!;
  const a = buildConfig(notion.spec, { folders: [], level: 'read' });
  const b = buildConfig(notion.spec, { folders: [], level: 'full' });
  assert.deepEqual(a, b);
});


test('⭐ every catalog entry still serializes — no function sneaks in', () => {
  for (const arm of CATALOG) {
    const lai = JSON.parse(JSON.stringify(arm)) as unknown;
    assert.deepEqual(lai, arm, `entry "${arm.id}" lost data going through JSON`);
  }
});

test('⭐ the GitHub entry enables the CHEAP group by default, not the whole server', () => {
  const on = (gh.groups ?? []).filter((g) => g.on).map((g) => g.id);
  assert.deepEqual(on, ['context', 'repos']);
  assert.ok(on.length < (gh.groups ?? []).length, 'must not enable everything by default');
});
