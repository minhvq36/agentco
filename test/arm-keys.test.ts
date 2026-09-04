
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { armReach } from '../dist/core/assistant.js';

const SRV = { a1: { type: 'http', url: 'https://x' }, a2: { type: 'http', url: 'https://y' } };

test('⭐ TWO arms ⇒ each line states how to call it, and the two lines DIFFER', () => {
  const arms = { a1: { label: 'Acme' }, a2: { label: 'Notion2' } };
  const l1 = armReach(arms, SRV, 'a1', 'a1');
  const l2 = armReach(arms, SRV, 'a2', 'a2');
  assert.match(l1, /Acme/);
  assert.match(l1, /mcp__a1__/);
  assert.match(l2, /mcp__a2__/);
  assert.notEqual(l1, l2, 'if the two lines were identical, reachDiff would see nothing either');
});

test('⭐ a NON-LATIN label still gets bridged — what the name cannot carry goes next to it', () => {
  const arms = { a1: { label: '文档', level: 'read' as const }, a2: { label: '회계' } };
  const line = armReach(arms, SRV, 'a1', 'a1');
  assert.match(line, /文档/, 'the user-chosen name must be preserved as-is');
  assert.match(line, /mcp__a1__/);
  assert.match(line, /read only/, 'the permission level must not get swallowed by the bridge');
});

test('⭐ DUPLICATE labels still stay distinguishable — the bridge goes through the HASH, not the name', () => {
  const arms = { a1: { label: 'Notion' }, a2: { label: 'Notion' } };
  const l1 = armReach(arms, SRV, 'a1', 'a1');
  const l2 = armReach(arms, SRV, 'a2', 'a2');
  assert.notEqual(l1, l2);
  assert.match(l1, /mcp__a1__/);
  assert.match(l2, /mcp__a2__/);
});

test('ONE arm ⇒ NO bridge line is attached', () => {
  assert.equal(armReach({ a1: { label: 'Musics' } }, SRV, 'a1'), 'Musics');
});

test('the bridge does NOT clobber a line that has BOTH a permission level and a folder', () => {
  const arms = { a1: { label: 'Kho', level: 'full' as const } };
  const line = armReach(arms, { a1: { args: ['D:\\Kho'] } }, 'a1', 'a1');
  assert.match(line, /edit\/delete/);
  assert.match(line, /D:\\Kho/);
  assert.match(line, /mcp__a1__/);
});

test('the bridge uses the EXACT string the model sees in the tool name', () => {
  const line = armReach({ a1: { label: 'X' } }, SRV, 'ad95f16558d', 'ad95f16558d');
  assert.ok(line.includes('mcp__ad95f16558d__'), line);
});
