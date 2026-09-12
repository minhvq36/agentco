
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  NODE_SIZE,
  WIRE_REACH,
  agentSlot,
  arrangeAll,
  centeredSlot,
  clashes,
  firstFreeSlot,
  nearWire,
  wireCurve,
  type NodeKind,
  type Point,
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

// ─────────────────────────────────────── the shape of a wire, and its reach

/**
 * ⚠ THE CUBIC IS EVALUATED INDEPENDENTLY HERE, on purpose.
 *
 * `nearWire` samples the curve; a test that asked `wireCurve` to sample it too
 * would assert the code equals itself. This is the textbook Bernstein form,
 * written from the definition rather than from the implementation.
 */
function at(ps: readonly Point[], t: number): Point {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: ps.reduce((s, p, i) => s + w[i]! * p.x, 0),
    y: ps.reduce((s, p, i) => s + w[i]! * p.y, 0),
  };
}

const dot = (p: Point, v: Point, w: Point): number => {
  const dx = w.x - v.x;
  const dy = w.y - v.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - v.x) * dx + (p.y - v.y) * dy) / len));
  return Math.hypot(p.x - (v.x + t * dx), p.y - (v.y + t * dy));
};

test('wireCurve: the ends are the ends, and `up` flips BOTH control points', () => {
  // Leaving one unflipped is how the curve knots in the middle — it bulges
  // downward while both ends travel up. Stated in the source; asserted here.
  const a = { x: 10, y: 20 };
  const b = { x: 300, y: 420 };
  const down = wireCurve(a, b, false);
  assert.deepEqual(down[0], a);
  assert.deepEqual(down[3], b);
  assert.ok(down[1]!.y > a.y, 'the first control leaves downward');
  assert.ok(down[2]!.y < b.y, 'the second arrives from above');

  const up = wireCurve(a, b, true);
  assert.ok(up[1]!.y < a.y && up[2]!.y > b.y, 'both controls flip together');
});

test('wireCurve: a SHORT wire still bulges — `dy` has a floor', () => {
  // Without the floor a wire between two nearly-level ports is a straight line
  // and reads as an accident of the layout rather than as a connection.
  const [, c1] = wireCurve({ x: 0, y: 0 }, { x: 200, y: 4 }, false);
  assert.equal(c1!.y, 45);
});

test('🔴 nearWire: EVERY point on the curve is on the curve', () => {
  // The gate on the sampling itself. `nearWire` walks 24 CHORDS; comparing
  // against the 25 points instead would leave a spot halfway between two of
  // them on a long wire reading as "far away", and the wire would drop under a
  // moving pointer for one frame — which is how a defect gets blamed on the
  // browser rather than on this function.
  //
  // ⚠ 1, AND IT IS A MEASUREMENT. Worst chord deviation across these wires:
  // 2.23 at N=24, 1.27 at 32, 0.58 at 48. The first version of this test asked
  // for 1 against N=24 and went red — the test was wrong, not the code.
  //
  // 🔴 THE ASSERTION BELOW IS THE POINT, not the constant: what makes N enough
  // is its share of `WIRE_REACH`, so tuning the corridor DOWN (48 → 20, by hand)
  // silently made the old N too coarse. This test is what said so.
  const SLOP = 1;
  assert.ok(SLOP < WIRE_REACH / 12, 'the sampling error must be small against the corridor it sits in');
  const a = { x: 40, y: 60 };
  const b = { x: 700, y: 640 };
  for (const up of [false, true]) {
    const ps = wireCurve(a, b, up);
    for (let i = 0; i <= 200; i++) {
      const p = at(ps, i / 200);
      assert.ok(nearWire(a, b, up, p, SLOP), `${up ? 'up' : 'down'} wire: t=${i / 200} read as off it`);
    }
  }
});

test('🔴 nearWire follows the CURVE, not the straight line between the ends', () => {
  // The discriminating case, and the premise is asserted first: a point that is
  // genuinely on the wire while being further from the chord than the reach. A
  // chord-based implementation passes every other test in this file and fails
  // the user in exactly the place the wire bends.
  const a = { x: 0, y: 0 };
  const b = { x: 600, y: 600 };
  const p = at(wireCurve(a, b, false), 0.25);
  assert.ok(
    dot(p, a, b) > WIRE_REACH,
    `premise: this point is only ${Math.round(dot(p, a, b))} from the chord — it proves nothing`,
  );
  assert.equal(nearWire(a, b, false, p), true);
});

test('nearWire: far away is far away, in both axes', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 400 };
  assert.equal(nearWire(a, b, false, { x: 0, y: 200 }), true, 'dead on it');
  assert.equal(nearWire(a, b, false, { x: WIRE_REACH - 2, y: 200 }), true, 'inside the corridor');
  assert.equal(nearWire(a, b, false, { x: WIRE_REACH + 4, y: 200 }), false, 'outside it');
  assert.equal(nearWire(a, b, false, { x: 0, y: -WIRE_REACH - 4 }), false, 'past the start');
  assert.equal(nearWire(a, b, false, { x: 0, y: 400 + WIRE_REACH + 4 }), false, 'past the end');
});

test('🔴 WIRE_REACH is narrower than the node it runs into', () => {
  // The corridor is what KEEPS a lit wire, so a wide one would hold on across
  // half the diagram and the highlight would stop meaning "this one". Half a
  // node's width is the bound with a reason: two wires are only ever that close
  // where they are already converging on the same box, and there the pointer is
  // inside the box rather than in the corridor.
  assert.ok(WIRE_REACH < NODE_SIZE.agent.w / 2, `${WIRE_REACH} is wider than half an employee`);
  // And wider than the 16-unit hit path, or it would take nothing back.
  assert.ok(WIRE_REACH > 16);
});
