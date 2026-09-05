
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { offeredTiers, tierOf, toolsAtTier } from '../dist/core/probe.js';
import { armHash } from '../dist/core/catalog.js';

const tool = (name: string, tier: 'read' | 'add' | 'full') => ({ name, tier, level: 'read' as never });

const NOTION = [
  ...Array.from({ length: 14 }, (_, i) => tool(`r${i}`, 'read')),
  ...Array.from({ length: 11 }, (_, i) => tool(`a${i}`, 'add')),
  ...Array.from({ length: 3 }, (_, i) => tool(`f${i}`, 'full')),
];


test('a later tier INCLUDES the earlier ones — that is what "cumulative" means', () => {
  assert.equal(toolsAtTier(NOTION, 'read').length, 14);
  assert.equal(toolsAtTier(NOTION, 'add').length, 25);
  assert.equal(toolsAtTier(NOTION, 'full').length, 28);
});

test('each tier is a SUBSET of the one above it — no tool falls outside', () => {
  const read = new Set(toolsAtTier(NOTION, 'read'));
  const add = new Set(toolsAtTier(NOTION, 'add'));
  for (const n of read) assert.ok(add.has(n), `"${n}" is in the read tier but missing from the add tier`);
});


test('⭐ a tier that ADDS NO TOOLS must not be shown — even if it is not empty', () => {
  const allRead = Array.from({ length: 14 }, (_, i) => tool(`r${i}`, 'read'));
  assert.deepEqual(offeredTiers(allRead), [{ tier: 'read', count: 14 }]);
});

test('⭐ the server DECLARES NOTHING ⇒ only the `full` tier remains, and it is a WARNING, not a choice', () => {
  const nothing = Array.from({ length: 28 }, (_, i) => tool(`x${i}`, 'full'));
  assert.deepEqual(offeredTiers(nothing), [{ tier: 'full', count: 28 }]);
});

test('Notion declares fully ⇒ all three tiers show up, with the right counts', () => {
  assert.deepEqual(offeredTiers(NOTION), [
    { tier: 'read', count: 14 },
    { tier: 'add', count: 25 },
    { tier: 'full', count: 28 },
  ]);
});

test('no tools at all ⇒ no tiers at all — do not draw an empty picker', () => {
  assert.deepEqual(offeredTiers([]), []);
});


test('tier 2 requires BOTH flags declared; missing either one bumps it to tier 3', () => {
  assert.equal(tierOf({ readOnly: true }), 'read');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 'add');
  assert.equal(tierOf({ readOnly: false }), 'full', 'destructive missing ⇒ unknown');
  assert.equal(tierOf({ destructive: false }), 'full', 'readOnly missing ⇒ unknown');
  assert.equal(tierOf({}), 'full');
  assert.equal(tierOf(undefined), 'full');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 'full', 'contradiction ⇒ escalate');
});


test('⭐ different tier ⇒ DIFFERENT HASH — otherwise two tiers silently collide', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  const s = ['NOTION_OAUTH_A1B2C3D4'];
  const hashes = new Set([armHash(cfg, s, 'read'), armHash(cfg, s, 'add'), armHash(cfg, s, 'full')]);
  assert.equal(hashes.size, 3);
});

test('⭐ the SAME tier ⇒ the SAME HASH — A→B→A does not spawn a third entry', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.equal(armHash(cfg, ['X'], 'read'), armHash({ ...cfg }, ['X'], 'read'));
});

test('🔴 NO tier ⇒ the hash matches the pre-26/08 version exactly — no migration, no orphans', () => {
  const cfg = { command: 'npx', args: ['-y', 'pkg', 'D:\\Ho so'] };
  assert.equal(armHash(cfg, []), 'a38672f9bfb');
  assert.equal(armHash(cfg, [], undefined), armHash(cfg, []));
  assert.equal(armHash(cfg, ['A'], undefined), armHash(cfg, ['A']));
  assert.notEqual(armHash(cfg, ['A']), armHash(cfg, ['A'], 'read'));
});
