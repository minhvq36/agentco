
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NODE_SIZE,
  PARK_PER_COL,
  armSlot,
  arrangeAll,
  parkSlot,
} from '../dist/core/layout-geometry.js';

const A1 = { id: 'agent:a', kind: 'agent' as const };
const A2 = { id: 'agent:b', kind: 'agent' as const };
const BOSS = { id: 'assistant', kind: 'assistant' as const };
const KNOW = { id: 'knowledge', kind: 'knowledge' as const };
const LIB = { id: 'library', kind: 'library' as const };
const mcp = (id: string, armGroup?: string) => ({ id, kind: 'mcp' as const, ...(armGroup ? { armGroup } : {}) });

const cx = (p: { x: number }, kind: 'agent' | 'mcp') => p.x + NODE_SIZE[kind].w / 2;


test('an arm that is wired up sits BELOW its owner, not in the middle of the diagram', () => {
  const nodes = [BOSS, A1, A2, mcp('mcp:x'), KNOW, LIB];
  const p = arrangeAll(nodes, [{ from: 'mcp:x', to: 'agent:b' }]);
  const arm = p.get('mcp:x')!;
  const owner = p.get('agent:b')!;
  assert.equal(cx(arm, 'mcp'), cx(owner, 'agent'), 'the arm must align on the same axis as its owner');
  assert.ok(arm.y > owner.y, 'the arm must sit BELOW its owner');
});

test('⭐ a staff member is CENTERED over the block of their own arms', () => {
  const nodes = [BOSS, A1, mcp('m1'), mcp('m2'), mcp('m3')];
  const p = arrangeAll(nodes, ['m1', 'm2', 'm3'].map((m) => ({ from: m, to: 'agent:a' })));
  const mid = (cx(p.get('m1')!, 'mcp') + cx(p.get('m3')!, 'mcp')) / 2;
  assert.equal(cx(p.get('agent:a')!, 'agent'), mid);
});

test('⭐ ARMS ARE ORDERED BY OWNER ORDER — the condition that keeps wires from crossing', () => {
  const nodes = [BOSS, A1, A2, mcp('m-a1'), mcp('m-a2'), mcp('m-b1')];
  const p = arrangeAll(nodes, [
    { from: 'm-b1', to: 'agent:b' },
    { from: 'm-a1', to: 'agent:a' },
    { from: 'm-a2', to: 'agent:a' },
  ]);
  assert.ok(p.get('agent:a')!.x < p.get('agent:b')!.x, 'a stands left of b');
  for (const m of ['m-a1', 'm-a2']) {
    assert.ok(p.get(m)!.x < p.get('m-b1')!.x, `${m} must sit left of b's arm`);
  }
});

test('a SHARED arm belongs to the LEFTMOST owner — every second wire runs the same direction', () => {
  const nodes = [BOSS, A1, A2, mcp('m')];
  const p = arrangeAll(nodes, [
    { from: 'm', to: 'agent:b' },
    { from: 'm', to: 'agent:a' },
  ]);
  assert.equal(cx(p.get('m')!, 'mcp'), cx(p.get('agent:a')!, 'agent'));
});


test('⭐ arms NOT wired up go to the parking lot on the left, 7 per column', () => {
  const arms = Array.from({ length: 9 }, (_, i) => mcp(`m${i}`));
  const p = arrangeAll([BOSS, A1, ...arms], [{ from: 'm0', to: 'agent:a' }]);

  assert.ok(p.get('m0')!.x > 0, 'a wired-up arm must not be parked on the left');

  const parked = arms.slice(1).map((a) => p.get(a.id)!);
  assert.ok(
    parked.every((q) => q.x < 0),
    'an unwired arm must sit to the left of the origin',
  );
  const cols = new Set(parked.map((q) => q.x));
  assert.equal(cols.size, 2, '8 of them ⇒ exactly 2 columns');
  assert.equal(parked.filter((q) => q.x === Math.max(...cols)).length, PARK_PER_COL, 'the first column has exactly 7');
  assert.ok(Math.min(...cols) < Math.max(...cols));
});

test('the parking lot starts HIGHER than the assistant — a landmark the user named explicitly', () => {
  const p = arrangeAll([BOSS, A1, mcp('m')], []);
  assert.ok(parkSlot(0).y < p.get('assistant')!.y);
});

test('⭐ the parking lot is sorted by KIND: folders → services (same provider together) → self-hosted', () => {
  const nodes = [
    BOSS,
    A1,
    mcp('m-custom', '2-custom'),
    mcp('m-notion', '1-notion'),
    mcp('m-files', '0-files'),
    mcp('m-linear', '1-linear'),
  ];
  const p = arrangeAll(nodes, []);
  const order = ['m-files', 'm-linear', 'm-notion', 'm-custom'].map((id) => p.get(id)!.y);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'vertical order must match kind order');
});


test('⭐ armSlot tracks the OWNER\'S AXIS, not the staff grid — the "faraway" bug', () => {
  const first = armSlot(0, 500, 300);
  assert.equal(first.x + NODE_SIZE.mcp.w / 2, 500, 'the first slot aligns on the owner axis');
  assert.equal(first.y, 300);
  assert.ok(armSlot(1, 500, 300).x > first.x);
  assert.ok(armSlot(2, 500, 300).x < first.x);
});


test('🔴 NO edges ⇒ the OLD layout is unchanged, pixel for pixel', () => {
  const nodes = [BOSS, A1, A2, mcp('m1'), mcp('m2'), KNOW, LIB];
  const a = arrangeAll(nodes);
  const b = arrangeAll(nodes, []);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.equal(a.get('m1')!.y, a.get('m2')!.y);
});

test('⭐ a newly wired arm sits below its owner; an unwired arm goes to the parking lot instead', () => {
  const nodes = [BOSS, A1, mcp('mcp:new'), mcp('mcp:stray')];
  const p = arrangeAll(nodes, [{ from: 'mcp:new', to: 'agent:a' }]);
  assert.ok(p.get('mcp:new')!.x > 0, 'just wired ⇒ must be under its owner');
  assert.ok(p.get('mcp:stray')!.x < 0, 'not wired ⇒ parked on the left');
  assert.equal(cx(p.get('mcp:new')!, 'mcp'), cx(p.get('agent:a')!, 'agent'));
});

test('⭐ with no arms at all yet, the two stores STILL sit where they would once arms exist', () => {
  const empty = arrangeAll([BOSS, A1, KNOW, LIB], []);
  const withArm = arrangeAll([BOSS, A1, mcp('m1'), KNOW, LIB], []);
  assert.equal(
    empty.get('knowledge')!.y,
    withArm.get('knowledge')!.y,
    'the stores must sit at the same height whether or not an arm is plugged in',
  );
  assert.equal(empty.get('library')!.y, withArm.get('library')!.y);
});

test('⭐ enough room is reserved for a row of arms, without overlapping the stores', () => {
  const p = arrangeAll([BOSS, A1, mcp('m1'), KNOW, LIB], []);
  const armBottom = p.get('m1')!.y + NODE_SIZE.mcp.h;
  assert.ok(armBottom <= p.get('knowledge')!.y, `the arm (bottom ${armBottom}) must sit ABOVE the stores`);
  assert.ok(p.get('m1')!.y > p.get('agent:a')!.y + NODE_SIZE.agent.h, 'and BELOW the staff row');
});

test('the pyramid stays balanced: the assistant and both stores share an axis with the staff row', () => {
  const nodes = [BOSS, A1, A2, mcp('m1'), mcp('m2'), KNOW, LIB];
  const p = arrangeAll(nodes, [
    { from: 'm1', to: 'agent:a' },
    { from: 'm2', to: 'agent:b' },
  ]);
  const agentsMid = (cx(p.get('agent:a')!, 'agent') + cx(p.get('agent:b')!, 'agent')) / 2;
  const bossMid = p.get('assistant')!.x + NODE_SIZE.assistant.w / 2;
  const shelfMid =
    (p.get('knowledge')!.x + p.get('library')!.x + NODE_SIZE.library.w) / 2;
  assert.ok(Math.abs(bossMid - agentsMid) <= 1, `assistant off-axis: ${bossMid} vs ${agentsMid}`);
  assert.ok(Math.abs(shelfMid - agentsMid) <= 1, `stores off-axis: ${shelfMid} vs ${agentsMid}`);
  assert.ok(p.get('knowledge')!.y > p.get('m1')!.y);
});
