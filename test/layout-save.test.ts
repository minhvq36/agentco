
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LayoutStore } from '../dist/core/layout.js';

process.on('warning', () => {});

/**
 * `LayoutStore.save` — the gate every diagram write goes through.
 * → docs/SPEC-office-animation.md §17k′
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE EXISTS BECAUSE A COMMENT WAS DOING THE JOB OF A TEST.          │
 * │                                                                          │
 * │ `save()` carried a box stating *"ABSENT ≠ EMPTY: the canvas PUTs         │
 * │ `{nodes, edges}` on every drag and says nothing about the cast; reading  │
 * │ that silence as 'clear it' would undress the whole office"* — and one    │
 * │ line above it, `sanitizeEdges(input.edges, …)` read exactly that silence │
 * │ as "clear it" for the EDGES. `api.ts` promised the same thing in the     │
 * │ other direction. Two comments, both right, no mechanism between them.    │
 * │                                                                          │
 * │ ⚠ THE ASSERTIONS ARE ABOUT THE THREE PLACES A WIRE LIVES, not about one: │
 * │ `layout.json` holds assistant→agent, `roles/<id>.yaml` holds an agent's  │
 * │ arms, and `office.yaml` holds the assistant's. The bug wiped all three   │
 * │ from one costume change, and a test that checked only the first would    │
 * │ have gone green while the mcp wires still vanished.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * The narrowest office `LayoutStore` will accept — the ten fields it actually
 * reads, and nothing else. A real `Office` would drag a company, a scheduler and
 * a plan store into a test about one function.
 */
function bench(): { dir: string; store: LayoutStore; read: () => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-save-'));
  fs.mkdirSync(path.join(dir, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'roles', 'writer.yaml'), 'id: writer\nmcp:\n  - files\n', 'utf8');
  // ⚠ `assistant.mcp` is EMPTY, and that is the real shape of an office: `mcp →
  // assistant` was struck off `CAN_CONNECT` on 23/08 (an assistant holding an arm
  // costs ~36 000 tokens a turn), so an arm only ever belongs to a worker.
  fs.writeFileSync(path.join(dir, 'office.yaml'), 'arms:\n  - files\nassistant:\n  mcp: []\n', 'utf8');

  const office = {
    paths: {
      layoutFile: path.join(dir, 'layout.json'),
      configFile: path.join(dir, 'office.yaml'),
      roles: path.join(dir, 'roles'),
    },
    roles: new Map([['writer', { id: 'writer', mcp: ['files'] }]]),
    archivedRoles: new Set<string>(),
    company: { mcpServers: { files: { command: 'npx', args: [] } }, arms: { files: {} } },
    config: { arms: ['files'], assistant: { mcp: [] as string[] } },
  };
  return {
    dir,
    store: new LayoutStore(office as never),
    read: () => fs.readFileSync(path.join(dir, 'roles', 'writer.yaml'), 'utf8'),
  };
}

/**
 * What the browser actually PUTs on a drag: EVERY edge on the diagram, mcp ones
 * included. Sending only the assistant wire would itself cut the arms — correctly,
 * because that is what an explicit list means — and the test would then be
 * measuring its own setup rather than the bug.
 */
const FULL = [
  { from: 'assistant', to: 'agent:writer' },
  { from: 'mcp:files', to: 'agent:writer' },
];

const wires = (store: LayoutStore): string[] =>
  store.read().layout.edges.map((e) => `${e.from}→${e.to}`).sort();

test('🔴 saving ONLY the cast does not cut a single wire — the 07/09 costume bug', () => {
  // The user's report, verbatim: "I change somebody's character or shirt colour
  // in the office and EVERY connection on the canvas is cut, the mcp ones
  // included." `setCharacter` sends `{cast}` and nothing else, on purpose.
  const { dir, store, read } = bench();
  try {
    // A first save with real edges, so there is something to lose.
    store.save({ nodes: [], edges: FULL });
    const before = wires(store);
    assert.ok(before.includes('assistant→agent:writer'), 'premise: the wire was written');
    assert.ok(before.includes('mcp:files→agent:writer'), 'premise: the arm is wired to the worker');

    const { touched } = store.save({ cast: { 'agent:writer': 2 } });

    assert.deepEqual(wires(store), before, 'a costume change moved a wire');
    // ⚠ And the yaml, which is where the mcp wires actually live. The canvas can
    // look right for one read while the file it is rebuilt from has been emptied.
    assert.match(read(), /files/, "the worker's arm was deleted out of roles/writer.yaml");
    assert.match(fs.readFileSync(path.join(dir, 'office.yaml'), 'utf8'), /arms:[\s\S]*files/);
    assert.deepEqual(touched, [], 'nothing but the cast should have been written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 saving ONLY the tint does not cut a single wire either', () => {
  // Same door, different handle — and the reason both are tested is §"patch one
  // layer and you must walk every path of that layer". `setTint` fires on every
  // pointer move of the colour picker, so this one was cutting the office
  // repeatedly, in a debounce, while the user watched the room.
  const { dir, store, read } = bench();
  try {
    store.save({ nodes: [], edges: FULL });
    const before = wires(store);
    store.save({ tint: { 'agent:writer': '#b4532a' } });
    assert.deepEqual(wires(store), before);
    assert.match(read(), /files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an EXPLICIT empty edge list still cuts every wire — absent and empty stay different', () => {
  // The other half of the rule, and the half that would silently rot: if
  // `edges: []` stopped meaning "cut them all", the Inspector's own disconnect
  // button would quietly stop working and nothing here would say so.
  const { dir, store, read } = bench();
  try {
    store.save({ nodes: [], edges: FULL });
    store.save({ edges: [] });
    assert.equal(
      wires(store).includes('assistant→agent:writer'),
      false,
      'an explicit empty list must cut the assistant wire',
    );
    assert.doesNotMatch(read(), /files/, 'and must clear the arm out of the yaml');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the cast survives a plain node drag, and the drag survives a cast change', () => {
  // The invariant stated in both directions, because the bug was the second
  // direction of a rule only ever written down for the first.
  const { dir, store } = bench();
  try {
    store.save({ nodes: [], edges: FULL });
    store.save({ cast: { 'agent:writer': 3 } });
    store.save({ nodes: [{ id: 'agent:writer', x: 640, y: 480 }], edges: FULL });
    const after = store.read().layout;
    assert.equal(after.cast?.['agent:writer'], 3, 'the drag undressed the office');
    assert.deepEqual(after.nodes.find((n) => n.id === 'agent:writer'), {
      id: 'agent:writer',
      kind: 'agent',
      role: 'writer',
      x: 640,
      y: 480,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
