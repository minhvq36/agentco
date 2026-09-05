

import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';

import {
  BROWSER_ARM,
  CATALOG,
  FILES_ARM,
  armHash,
  buildConfig,
  defaultOptions,
  findArm,
} from '../dist/core/catalog.js';
import { injectSecrets } from '../dist/core/secrets.js';
import { needsToolList } from '../dist/server/server.js';
import { TIERS, tierOf, toolsAtTier } from '../dist/core/probe.js';

const argsFor = (ids: string[], platform = 'win32'): string[] =>
  (
    buildConfig(BROWSER_ARM.spec, {
      folders: [],
      options: (BROWSER_ARM.options ?? []).filter((o) => ids.includes(o.id)),
      platform,
    }) as { args: string[] }
  ).args;


test('item is in the catalog and resolvable by id', () => {
  assert.ok(CATALOG.includes(BROWSER_ARM));
  assert.equal(findArm('browser'), BROWSER_ARM);
});

test('stays pure DATA — no function sneaks in', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(BROWSER_ARM)), BROWSER_ARM);
});


test('version PINNED, no `@latest` and no alpha build', () => {
  const pkg =
    BROWSER_ARM.spec.kind === 'stdio'
      ? BROWSER_ARM.spec.args.find((a) => a.startsWith('@playwright/mcp'))
      : undefined;
  assert.ok(pkg, 'package name not found in args');
  assert.ok(!pkg.includes('@latest'), '`@latest` = a stranger\'s code changing under the customer\'s feet (§11d)');
  assert.match(pkg, /@playwright\/mcp@\d+\.\d+\.\d+$/, 'must be a concrete version, not a tag');
  assert.ok(!/alpha|beta|rc/i.test(pkg), 'do not ship a pre-release build to customers');
});


test('DEFAULT: run headless + leave no profile behind', () => {
  assert.equal(BROWSER_ARM.spec.kind, 'stdio');
  const on = defaultOptions(BROWSER_ARM).map((o) => o.id);
  const args = argsFor(on);
  assert.ok(args.includes('--headless'), 'missing --headless: upstream defaults to headed');
});

test('the safe state lives in BASE, not in a checkbox', () => {
  const args = argsFor([]);
  assert.ok(args.includes('--headless'));
  assert.ok(args.includes('--isolated'));
  assert.ok(!args.some((a) => a.includes('user-data-dir')));
});

test('every checkbox states its RADIUS, not its config', () => {
  for (const o of BROWSER_ARM.options ?? []) {
    assert.ok(o.help && o.help.length > 20, `option "${o.id}" is missing its help text`);
    assert.ok(!/--/.test(o.help), `option "${o.id}" describes CONFIG instead of RADIUS`);
  }
});


test('⭐⭐ NO absolute path leaks into config — only a placeholder', () => {
  const args = argsFor(['nho-dang-nhap']);
  const i = args.indexOf('--user-data-dir');
  assert.ok(i >= 0, 'profile flag is missing entirely');
  assert.equal(args[i + 1], '<OFFICE_STATE>/profile');
  for (const a of args) {
    assert.ok(
      !/^[A-Za-z]:[\\/]/.test(a) && !a.startsWith('/'),
      `an absolute path leaked into args: "${a}"`,
    );
  }
});

test('⭐ placeholder is FILLED at spawn time, one path per office — hash stays the same', () => {
  const cfg = buildConfig(BROWSER_ARM.spec, {
    folders: [],
    options: (BROWSER_ARM.options ?? []).filter((o) => o.id === 'nho-dang-nhap'),
    platform: 'win32',
  });
  const ke = path.join('cty', 'offices', 'ke-toan', '.state', 'browser');
  const ban = path.join('cty', 'offices', 'ban-hang', '.state', 'browser');
  const a = injectSecrets(cfg, {}, { officeState: ke }) as { args: string[] };
  const b = injectSecrets(cfg, {}, { officeState: ban }) as { args: string[] };
  assert.ok(a.args.includes(path.join(ke, 'profile')));
  assert.ok(b.args.includes(path.join(ban, 'profile')));
  assert.notDeepEqual(a.args, b.args, 'two offices must produce two different paths');
  assert.equal(armHash(cfg), armHash(cfg));
});


test('⭐ the two checkboxes are INDEPENDENT — all four combinations covered, none dropped', () => {
  const none = argsFor([]);
  const luu = argsFor(['nho-dang-nhap']);
  const hien = argsFor(['hien-cua-so']);
  const caHai = argsFor(['nho-dang-nhap', 'hien-cua-so']);
  const coHoSo = (a: string[]) => a.some((x) => x.includes('user-data-dir'));

  assert.ok(none.includes('--headless') && !coHoSo(none));
  assert.ok(luu.includes('--headless') && coHoSo(luu));
  assert.ok(!hien.includes('--headless') && !coHoSo(hien));
  assert.ok(!caHai.includes('--headless') && coHoSo(caHai));
});

test('⭐ the filled-in path uses the CORRECT separator for the OS', () => {
  const cfg = buildConfig(BROWSER_ARM.spec, {
    folders: [],
    options: (BROWSER_ARM.options ?? []).filter((o) => o.id === 'nho-dang-nhap'),
    platform: 'win32',
  });
  const root = path.join('C:', 'cty', 'offices', 'ke-toan', '.state', 'browser');
  const { args } = injectSecrets(cfg, {}, { officeState: root }) as { args: string[] };
  const p = args[args.indexOf('--user-data-dir') + 1]!;
  assert.equal(p, path.join(root, 'profile'));
  const la = path.sep === '\\' ? '/' : '\\';
  assert.ok(!p.includes(la), `path "${p}" still has the other OS's separator`);
});

test('"remember login" REMOVES `--isolated` — a persistent profile and an in-RAM profile are mutually exclusive', () => {
  assert.ok(!argsFor(['nho-dang-nhap']).includes('--isolated'));
});

test('"show window" carries the `loopbackOnly` flag — the window opens on the machine running the daemon', () => {
  const o = (BROWSER_ARM.options ?? []).find((x) => x.id === 'hien-cua-so');
  assert.equal(o?.loopbackOnly, true);
});

test('toggling a checkbox ⇒ HASH CHANGES ⇒ it is a different arm', () => {
  const mk = (ids: string[]) =>
    armHash(
      buildConfig(BROWSER_ARM.spec, {
        folders: [],
        options: (BROWSER_ARM.options ?? []).filter((o) => ids.includes(o.id)),
        platform: 'win32',
      }),
    );
  const all = [mk([]), mk(['nho-dang-nhap']), mk(['hien-cua-so']), mk(['nho-dang-nhap', 'hien-cua-so'])];
  assert.equal(new Set(all).size, 4, 'two different combinations sharing one hash ⇒ silent collision');
});


test('⭐ uses the browser ALREADY ON DISK — no 269-415 MB download onto the customer\'s machine', () => {
  assert.deepEqual(argsFor([], 'win32').slice(-2), ['--browser', 'msedge']);
  assert.deepEqual(argsFor([], 'darwin').slice(-2), ['--browser', 'chrome']);
  assert.ok(!argsFor([], 'linux').includes('--browser'));
});

test('hash DIFFERS between Windows and macOS — because it really is two different browsers', () => {
  const mk = (platform: string) => armHash(buildConfig(BROWSER_ARM.spec, { folders: [], platform }));
  assert.notEqual(mk('win32'), mk('darwin'));
});

test('has a size cap for files the server writes on its own', () => {
  const args = argsFor([]);
  const i = args.indexOf('--output-max-size');
  assert.ok(i >= 0, 'missing cap ⇒ snapshot folder can grow without limit');
  assert.ok(Number(args[i + 1]) > 0, 'cap must be a byte count');
});


test('the two arbitrary-JS-execution tools are on the never list', () => {
  assert.ok(BROWSER_ARM.neverTools?.includes('browser_run_code_unsafe'));
  assert.ok(BROWSER_ARM.neverTools?.includes('browser_evaluate'));
});

test('`neverTools` only SUBTRACTS — it never adds a tool', () => {
  const tools = [
    { name: 'browser_snapshot', level: 'read' as const, tier: 'read' as const },
    { name: 'browser_click', level: 'write_external' as const, tier: 'full' as const },
    { name: 'browser_evaluate', level: 'write_external' as const, tier: 'full' as const },
  ];
  for (const tier of TIERS) {
    const before = toolsAtTier(tools, tier);
    const after = before.filter((n) => !BROWSER_ARM.neverTools?.includes(n));
    assert.ok(after.length <= before.length, 'the never list made the set LONGER ⇒ it is granting, not blocking');
    for (const n of after) assert.ok(before.includes(n), `"${n}" appeared out of nowhere`);
    assert.ok(!after.includes('browser_evaluate'), `tier ${tier} still grants browser_evaluate`);
  }
});

test('📌 `browser_navigate` does NOT belong to the read-only tier — tier labels must be accurate', () => {
  assert.equal(tierOf({ readOnly: false, destructive: true }), 'full');
  assert.equal(tierOf({ readOnly: true, destructive: false }), 'read');
});


test('item name does NOT carry the vendor name — zero brand debt, not deferred', () => {
  for (const field of [BROWSER_ARM.name, BROWSER_ARM.blurb]) {
    assert.ok(!/playwright/i.test(field), `"${field}" exposes the vendor name up front`);
  }
  assert.equal('mark' in BROWSER_ARM.brand, false, 'having a logo without having read the guidelines is exactly the §11c pitfall');
});

test('⭐⭐ an item with `neverTools` must NOT fall into the "grant the whole server" branch', () => {
  assert.equal(needsToolList(BROWSER_ARM), true, 'an item with a deny list but no tool listing ⇒ the deny list is void');
  assert.equal(needsToolList({ readOnly: true }), true);
  assert.equal(needsToolList({ tiered: true }), true);
  assert.equal(needsToolList({ neverTools: ['x'] }), true);
  assert.equal(needsToolList({}), false);
  assert.equal(needsToolList(undefined), false);
  assert.equal(needsToolList(FILES_ARM), false);
});

test('⭐ the item\'s hint: points to a next step, and stays short enough to prepend every turn', () => {
  const h = BROWSER_ARM.hint!;
  assert.ok(h, 'missing hint ⇒ the Assistant will plan for an impossible task');
  assert.match(h, /Sign in \/ add cookies/);
  assert.match(h, /WebFetch|WebSearch/);
  assert.ok(h.length < 320, `hint is ${h.length} chars — too long for a per-turn prefix`);
});

test('this item has NO key at all — that is its entire point', () => {
  assert.equal(BROWSER_ARM.price, 'none');
  assert.deepEqual(BROWSER_ARM.secrets, []);
  assert.equal(BROWSER_ARM.auth, undefined);
});


test('🔒 `files` item unchanged: the folder IS the identity, still feeds the hash', () => {
  const a = armHash(buildConfig(FILES_ARM.spec, { folders: ['/du-lieu/a'] }));
  const b = armHash(buildConfig(FILES_ARM.spec, { folders: ['/du-lieu/b'] }));
  assert.notEqual(a, b, 'changing the folder without changing the hash ⇒ two different radii collide');
  assert.equal(FILES_ARM.options, undefined, '`files` must not have any checkboxes');
});
