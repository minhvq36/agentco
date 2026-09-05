
import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG, buildConfig, findArm, serverFenced } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';
import { offeredTiers, tierOf } from '../dist/core/probe.js';
import { armConfig } from '../dist/server/server.js';

const gh = findArm('github')!;


test('🔴 gateTool must be a tool that REQUIRES PUSH ACCESS — not just any read tool', () => {
  assert.equal(gh.repoScan?.gateTool, 'list_repository_collaborators');
});

test('🔴 gateTool must NOT be one of the tools measured to be BLIND', () => {
  for (const mu of ['list_branches', 'get_file_contents', 'get_commit', 'list_tags']) {
    assert.notEqual(
      gh.repoScan?.gateTool,
      mu,
      `${mu} works on a public repo the app is NOT installed on ⇒ the probe would always answer YES`,
    );
  }
});

test('⭐ the search query has the ${login} placeholder, and it is the ONLY placeholder', () => {
  const q = gh.repoScan?.searchQuery ?? '';
  assert.match(q, /\$\{login\}/, 'missing placeholder ⇒ probes someone else\'s repos');
  assert.equal(q.match(/\$\{[^}]+\}/g)?.length, 1, 'only one placeholder — another one is another place to drift');
});

test('⭐ meTool matches the identity-lookup step — same question, do not ask it two ways', () => {
  assert.equal(gh.repoScan?.meTool, gh.identity?.tool);
  assert.equal(gh.repoScan?.loginField, gh.identity?.labelField);
});

test('🔴 an entry WITHOUT `scope` must not declare `repoScan`', () => {
  for (const a of CATALOG) {
    if (a.scope) continue;
    assert.equal(a.repoScan, undefined, a.id);
  }
});


test('🔴 DISCOVERY carries no fence — otherwise the tier picker vanishes on its own', () => {
  const withFence = buildConfig(gh.spec, { folders: [], level: 'read' }) as {
    headers: Record<string, string>;
  };
  const discovery = buildConfig(gh.spec, { folders: [] }) as { headers: Record<string, string> };

  assert.equal(withFence.headers['X-MCP-Readonly'], 'true', 'the SAVED config at the read tier must carry the fence');
  assert.equal(
    discovery.headers['X-MCP-Readonly'],
    undefined,
    'the DISCOVERY config (the Try button) must not carry the fence — carrying it would truncate the answer itself',
  );
});

test('🔴🔴 `discovery` must WIN over a `level` already present in the body — the 27/08 patch broke this', () => {
  const executed = armConfig({ catalogId: 'github', level: 'read' }) as {
    headers: Record<string, string>;
  };
  const discovered = armConfig({ catalogId: 'github', level: 'read', discovery: true }) as {
    headers: Record<string, string>;
  };

  assert.equal(executed.headers['X-MCP-Readonly'], 'true');
  assert.equal(
    discovered.headers['X-MCP-Readonly'],
    undefined,
    'when `level` is set but `discovery: true`, the tier MUST be dropped — this is exactly what the /test route sends',
  );
  assert.equal(discovered.headers['X-MCP-Toolsets'], executed.headers['X-MCP-Toolsets']);
});

test('⭐ reproduces the exact trap: an all-read tool list ⇒ ONLY ONE tier left', () => {
  const readOnly = [1, 2, 3].map((i) => ({
    name: `doc_${i}`,
    level: 'read' as const,
    tier: tierOf({ readOnly: true, destructive: false }),
  }));
  assert.equal(offeredTiers(readOnly).length, 1, 'three equal tiers ⇒ one tier ⇒ nothing left to pick');

  const withWrite = [...readOnly, { name: 'write', level: 'write_external' as const, tier: 'full' as const }];
  assert.equal(offeredTiers(withWrite).length, 2, 'only once a write is visible is there a tier to choose');
});

test('🔴 an entry that is both `tiered` and server-fenced MUST be flagged for the UI', () => {
  assert.equal(serverFenced(gh), true, 'GitHub enforces tiers server-side');
  for (const a of CATALOG) {
    if (!serverFenced(a)) continue;
    assert.equal(a.tiered, true, `${a.id}: fenced by tier but no tier to pick — fencing whom?`);
  }
});


test('🔴 the blurb must NOT overstate: public repos are readable even without the app installed', () => {
  assert.doesNotMatch(t(gh.blurb), /can only touch those repos/i);
  assert.match(t(gh.blurb), /riêng tư/i, 'must clearly state that the condition applies to PRIVATE repos'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});


test('⭐ the catalog ships agentco\'s client_id, and it is PUBLIC data', () => {
  assert.match(gh.auth?.clientId ?? '', /^Iv23li/);
  assert.equal(gh.auth?.kind, 'device');
});

test('🔴 NO secret of any kind in the catalog — the device flow does not need one', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/core/catalog.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.includes('│'))
    .join('\n');
  assert.doesNotMatch(code, /client_secret\s*:/i);
  assert.doesNotMatch(code, /private_?key/i);
});
