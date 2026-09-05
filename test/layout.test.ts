
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NODE_SIZE,
  agentSlot,
  arrangeAll,
  centeredSlot,
  clashes,
  firstFreeSlot,
  type NodeKind,
} from '../dist/core/layout-geometry.js';

type Node = { id: string; kind: NodeKind };

const agents = (n: number): Node[] =>
  Array.from({ length: n }, (_, i) => ({ id: `agent:r${i}`, kind: 'agent' as const }));

const shell = (n: number): Node[] => [
  { id: 'assistant', kind: 'assistant' },
  ...agents(n),
  { id: 'knowledge', kind: 'knowledge' },
  { id: 'library', kind: 'library' },
];

function midX(out: Map<string, { x: number; y: number }>, id: string, kind: NodeKind): number {
  const p = out.get(id);
  assert.ok(p, `missing node ${id}`);
  return p.x + NODE_SIZE[kind].w / 2;
}


test('arrangeAll: the assistant and the store row share THE SAME axis — even with no staff yet', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    const out = arrangeAll(shell(n));
    const assistant = midX(out, 'assistant', 'assistant');
    const kn = out.get('knowledge')!;
    const lib = out.get('library')!;
    const shelfMid = (kn.x + lib.x + NODE_SIZE.library.w) / 2;
    assert.ok(
      Math.abs(assistant - shelfMid) <= 1,
      `${n} staff: assistant at ${assistant}, store row at ${shelfMid}`,
    );
  }
});

test('arrangeAll: the knowledge store on the LEFT, the library on the RIGHT, same row', () => {
  const out = arrangeAll(shell(3));
  const kn = out.get('knowledge')!;
  const lib = out.get('library')!;
  assert.ok(kn.x < lib.x, 'the knowledge store must stand to the left of the library');
  assert.equal(kn.y, lib.y, 'both stores must share one row');
  assert.equal(lib.x - kn.x, NODE_SIZE.knowledge.w + 24, 'the gap between the two stores');
});

test('arrangeAll: the staff row wraps after 4 people, and no one overlaps', () => {
  const out = arrangeAll(shell(6));
  assert.equal(out.get('agent:r0')!.y, out.get('agent:r3')!.y);
  assert.ok(out.get('agent:r4')!.y > out.get('agent:r0')!.y);

  const placed = [...out.entries()].map(([id, p]) => ({
    kind: (id === 'assistant' ? 'assistant' : id.startsWith('agent:') ? 'agent' : id) as NodeKind,
    ...p,
  }));
  for (let i = 0; i < placed.length; i++) {
    const mine = placed[i]!;
    const others = placed.filter((_, j) => j !== i);
    assert.equal(clashes(mine, mine.kind, others), false, `node ${i} overlaps another node`);
  }
});

test('arrangeAll: both stores always sit BELOW the last staff row', () => {
  const out = arrangeAll(shell(5));
  const lowestAgent = Math.max(...agents(5).map((a) => out.get(a.id)!.y + NODE_SIZE.agent.h));
  assert.ok(out.get('knowledge')!.y > lowestAgent);
});


test('firstFreeSlot: never returns a slot that is already occupied', () => {
  const taken = [{ kind: 'agent' as const, ...agentSlot(0) }];
  const spot = firstFreeSlot(taken);
  assert.notDeepEqual(spot, agentSlot(0));
  assert.deepEqual(spot, agentSlot(1));
});

test('firstFreeSlot: avoids a node of a DIFFERENT kind too, not just agent nodes', () => {
  const blocker = { kind: 'knowledge' as const, ...agentSlot(0) };
  assert.notDeepEqual(firstFreeSlot([blocker]), agentSlot(0));
});

test('firstFreeSlot: two people added back to back get TWO different slots', () => {
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [];
  const a = firstFreeSlot(placed);
  placed.push({ kind: 'agent', ...a });
  const b = firstFreeSlot(placed);
  assert.notDeepEqual(a, b);
});

test('firstFreeSlot: a node nudged 10px still counts as overlapping — the human eye, not raw coordinates', () => {
  const nudged = { kind: 'agent' as const, x: agentSlot(0).x + 10, y: agentSlot(0).y + 10 };
  assert.notDeepEqual(firstFreeSlot([nudged]), agentSlot(0));
});

test('firstFreeSlot: an empty diagram gets the first slot', () => {
  assert.deepEqual(firstFreeSlot([]), agentSlot(0));
});


const STEP = () => NODE_SIZE.agent.w + (agentSlot(1).x - agentSlot(0).x - NODE_SIZE.agent.w);

test('centeredSlot: the offset order is 0 → +1 → −1 → +2, then wraps to the next row', () => {
  const c = agentSlot(0).x + NODE_SIZE.agent.w / 2;
  const step = STEP();
  assert.equal(centeredSlot(0, c).x, agentSlot(0).x);
  assert.equal(centeredSlot(1, c).x, agentSlot(0).x + step);
  assert.equal(centeredSlot(2, c).x, agentSlot(0).x - step);
  assert.equal(centeredSlot(3, c).x, agentSlot(0).x + 2 * step);
  assert.equal(centeredSlot(4, c).x, agentSlot(0).x);
  assert.ok(centeredSlot(4, c).y > centeredSlot(0, c).y);
});

test('centeredSlot: always snaps to agentSlot\'s EXACT grid, even when the axis is off by half a column', () => {
  const step = STEP();
  const base = agentSlot(0).x + NODE_SIZE.agent.w / 2;
  for (const centerX of [base, base + step / 2, base + step, base + step * 1.5, base + 17]) {
    const x = centeredSlot(0, centerX).x;
    assert.equal((x - agentSlot(0).x) % step, 0, `axis ${centerX} produced an off-grid slot: ${x}`);
  }
});

test('adding three staff in a row: the third one goes LEFT, not tacked on further right', () => {
  const tidy = arrangeAll(shell(1));
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'assistant', ...tidy.get('assistant')! },
    { kind: 'knowledge', ...tidy.get('knowledge')! },
    { kind: 'library', ...tidy.get('library')! },
  ];
  const boss = placed[0]!;
  const centerX = boss.x + NODE_SIZE.assistant.w / 2;

  const add = (): { x: number; y: number } => {
    const spot = firstFreeSlot(placed, 'agent', centerX);
    placed.push({ kind: 'agent', ...spot });
    return spot;
  };

  const one = add();
  const two = add();
  const three = add();

  assert.equal(one.x + NODE_SIZE.agent.w / 2, centerX, 'person 1 must align vertically with the assistant');
  assert.ok(two.x > one.x, 'person 2 goes right');
  assert.ok(three.x < one.x, 'person 3 must go LEFT — this is where the 08/20 bug lived');
  assert.equal(three.y, one.y, 'all three still share one row');

  const rowMid = (Math.min(three.x, one.x, two.x) + Math.max(three.x, one.x, two.x) + NODE_SIZE.agent.w) / 2;
  assert.ok(Math.abs(rowMid - centerX) <= 1, `row off-axis: ${rowMid} vs ${centerX}`);
});

test('growing around the axis NEVER overlaps anyone — including stores and mcp', () => {
  const tidy = arrangeAll(shell(1));
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'assistant', ...tidy.get('assistant')! },
    { kind: 'knowledge', ...tidy.get('knowledge')! },
    { kind: 'library', ...tidy.get('library')! },
  ];
  const centerX = placed[0]!.x + NODE_SIZE.assistant.w / 2;

  for (let i = 0; i < 8; i++) {
    const spot = firstFreeSlot(placed, 'agent', centerX);
    assert.equal(
      clashes(spot, 'agent', placed),
      false,
      `staff member ${i + 1} landed on an occupied slot`,
    );
    placed.push({ kind: 'agent', ...spot });
  }
});


test('archiving then bringing back: NEVER overlaps someone who took the old slot', () => {
  const spot = agentSlot(2);

  const afterArchive: Array<{ kind: NodeKind; x: number; y: number }> = [
    { kind: 'agent', ...agentSlot(0) },
    { kind: 'agent', ...agentSlot(1) },
  ];
  const binh = firstFreeSlot(afterArchive);
  assert.deepEqual(binh, spot, 'premise: the slot of an archived person IS reassigned to the new one');
  afterArchive.push({ kind: 'agent', ...binh });

  const an = firstFreeSlot(afterArchive);
  assert.notDeepEqual(an, binh, 'An must not land right on top of Binh');
  assert.ok(!clashes(an, 'agent', afterArchive), 'and must not touch anyone else either');
});

test('archiving/restoring several people in a row: each gets their own slot, no overlaps', () => {
  const placed: Array<{ kind: NodeKind; x: number; y: number }> = [];
  for (let i = 0; i < 8; i++) {
    const s = firstFreeSlot(placed);
    assert.ok(!clashes(s, 'agent', placed), `person ${i + 1} must get their own slot`);
    placed.push({ kind: 'agent', ...s });
  }
});
