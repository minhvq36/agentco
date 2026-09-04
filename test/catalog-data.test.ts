
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CATALOG,
  FILES_ARM,
  GITHUB_ARM,
  NOTION_ARM,
  buildConfig,
  catalogForUi,
  findArm,
  transportOf,
} from '../dist/core/catalog.js';


test('every catalog entry SERIALIZES CLEANLY — no function slips in', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), CATALOG);
});

test('catalogForUi drops no field, and adds `transport`', () => {
  const ui = catalogForUi();
  assert.equal(ui.length, CATALOG.length);
  for (const [i, a] of CATALOG.entries()) {
    for (const k of Object.keys(a)) assert.ok(k in ui[i]!, `UI is missing field "${k}"`);
    assert.equal(ui[i]!.transport, transportOf(a));
  }
});

test('every entry has what the user needs to READ before clicking', () => {
  for (const a of CATALOG) {
    assert.ok(a.blurb.trim(), `"${a.id}" is missing a blurb — the card does not say what it does`);
    for (const s of a.secrets) assert.ok(s.help.trim(), `"${a.id}/${s.name}" is missing help text`);
  }
});


test('stdio: appendFolders appends the folder at the END of args', () => {
  assert.deepEqual(
    buildConfig({ kind: 'stdio', command: 'npx', args: ['-y', 'pkg'], appendFolders: true }, { folders: ['D:\\A', '/b'] }),
    { command: 'npx', args: ['-y', 'pkg', 'D:\\A', '/b'] },
  );
});

test('stdio: WITHOUT appendFolders, folders are skipped, never mixed into args', () => {
  assert.deepEqual(
    buildConfig({ kind: 'stdio', command: 'x', args: ['-y'] }, { folders: ['D:\\A'] }),
    { command: 'x', args: ['-y'] },
  );
});

test('stdio: does not mutate the catalog entry\'s original `args`', () => {
  const spec = { kind: 'stdio' as const, command: 'npx', args: ['-y', 'pkg'], appendFolders: true };
  buildConfig(spec, { folders: ['D:\\A'] });
  assert.deepEqual(spec.args, ['-y', 'pkg']);
});

test('http: keeps the ${…} placeholder as-is, does NOT substitute here', () => {
  assert.deepEqual(
    buildConfig({ kind: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }, { folders: [] }),
    { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } },
  );
});

test('http: no headers means no empty key gets created', () => {
  assert.deepEqual(buildConfig({ kind: 'http', url: 'https://x/mcp' }, { folders: [] }), {
    type: 'http',
    url: 'https://x/mcp',
  });
});


test('Notion: HTTP hosted, LOGIN required, and has all three permission tiers', () => {
  const notion = findArm('notion');
  assert.ok(notion);
  assert.equal(transportOf(notion), 'http');
  assert.equal(notion.price, 'login');
  assert.equal(notion.tiered, true);
  assert.deepEqual(notion.secrets, []);
});

test('Notion: the `${OAUTH}` placeholder is replaced with the CORRECT account name, no misses', () => {
  const notion = findArm('notion');
  assert.ok(notion);
  const cfg = buildConfig(notion.spec, { folders: [], account: 'NOTION_OAUTH_A1B2C3D4' }) as {
    headers: Record<string, string>;
  };
  const used = Object.values(cfg.headers).flatMap((v) =>
    [...v.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!),
  );
  assert.deepEqual(used, ['NOTION_OAUTH_A1B2C3D4']);
  assert.equal(JSON.stringify(cfg).includes('${OAUTH}'), false, 'placeholder was left unreplaced');
});

test('Notion: with NO account selected the placeholder STAYS AS-IS, no name is made up', () => {
  const notion = findArm('notion');
  const cfg = buildConfig(notion!.spec, { folders: [] });
  assert.ok(JSON.stringify(cfg).includes('${OAUTH}'));
});

test('Notion no longer depends on any npm package — zero supply-chain risk', () => {
  const notion = findArm('notion');
  assert.equal(JSON.stringify(notion?.spec).includes('npx'), false);
});


test('`arms/index.ts` must collect EVERY entry — dropping one fails silently', () => {
  for (const arm of [FILES_ARM, NOTION_ARM, GITHUB_ARM]) {
    assert.ok(
      CATALOG.includes(arm),
      `${arm.id} has its own file but is NOT in CATALOG — it just vanished from the UI`,
    );
  }
  assert.equal(CATALOG.length, new Set(CATALOG.map((a) => a.id)).size, 'ids must be unique');
});


test('every group must have `help` — a group name alone leaves non-coders guessing', () => {
  for (const a of CATALOG) {
    for (const g of a.groups ?? []) {
      assert.ok(g.help && g.help.trim().length > 10, `${a.id}/${g.id} is missing an explanation`);
    }
  }
});


test('`brand.mark` is an SVG PATH, not markup', () => {
  for (const a of CATALOG) {
    const m = a.brand.mark;
    if (!m) continue;
    assert.match(m, /^[Mm]/, `${a.id}: the path must start with a moveto command`);
    assert.doesNotMatch(m, /[<>]/, `${a.id}: this is the "d" attribute, not markup`);
    assert.ok(m.length > 40, `${a.id}: path is unusually short — likely truncated`);
  }
});

test('`catalogForUi` carries `brand.mark` through to the UI', () => {
  const gh = catalogForUi().find((a) => a.id === 'github');
  assert.ok(gh?.brand.mark, 'missing => the GitHub node on the diagram falls back to a plug icon');
});
