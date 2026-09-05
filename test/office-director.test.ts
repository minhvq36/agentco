
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ASSISTANT_SPOT,
  BREAK_AREA,
  STATIONS,
  direct,
  ownSpot,
  ringSlots,
  type DirectAgent,
  type DirectLive,
} from '../dist/core/office-floor.js';

/**
 * WHO STANDS WHERE. → docs/SPEC-office-animation.md §6e
 *
 * This rule used to live inside a `useEffect`, where no test could reach it —
 * and it is the layer that decides whether the picture STATES SOMETHING TRUE.
 * A wrong station is the animation claiming an employee read the user's
 * documents when it never opened one. Same shape as the `buildPlan` debt: when
 * an important rule sits in an untestable function, the debt is the shape of
 * the code.
 */

const A = (id: string, connected = true): DirectAgent => ({ id: `agent:${id}`, role: id, connected });

function run(
  agents: DirectAgent[],
  live: Record<string, DirectLive> = {},
  reading: 'library' | 'web' | null = null,
) {
  const out = direct({ assistantId: 'assistant', agents, live, reading, at: () => undefined });
  return new Map(out.map((p) => [p.id, p]));
}

function onRing(p: { x: number; y: number }, id: 'library' | 'artifacts' | 'arm'): boolean {
  return ringSlots(STATIONS[id]).some((s) => Math.abs(s.x - p.x) < 1 && Math.abs(s.y - p.y) < 1);
}

// ─────────────────────────────────────────────────────────────── assistant

test('the assistant stands centre-front and does NOT walk for ordinary work', () => {
  // Three tasks can run at once; an assistant that walked would have to be in
  // three places. And it is the thing the user talks to — it must not move.
  const p = run([A('a'), A('b')], { a: { status: 'working' }, b: { status: 'working' } });
  assert.deepEqual(p.get('assistant')!.target, ASSISTANT_SPOT);
});

test('the assistant walks to the bookshelf ONLY for a document lookup', () => {
  assert.ok(onRing(run([], {}, 'library').get('assistant')!.target, 'library'));
  // A web lookup is a real thing that happens somewhere else. Sending them to
  // the shelf for it would be the room describing the wrong action.
  assert.deepEqual(run([], {}, 'web').get('assistant')!.target, ASSISTANT_SPOT);
  assert.deepEqual(run([], {}, null).get('assistant')!.target, ASSISTANT_SPOT);
});

// ──────────────────────────────────────────────────────────── the stations

test('a working person walks to the station their tool call landed in', () => {
  const p = run([A('a')], { a: { status: 'working', at: 'library' } });
  assert.ok(onRing(p.get('agent:a')!.target, 'library'));
  assert.ok(onRing(run([A('a')], { a: { status: 'working', at: 'artifacts' } }).get('agent:a')!.target, 'artifacts'));
  assert.ok(onRing(run([A('a')], { a: { status: 'working', at: 'arm' } }).get('agent:a')!.target, 'arm'));
});

test('🔴 NO PLACE IS NOT A PLACE — a turn with no tool call moves nobody', () => {
  // `at: undefined` means "we did not observe where this went". Substituting a
  // station turns that into "they went to the desk", which is the display
  // stating something nobody saw.
  const home = ownSpot(0, 1, 'agent:a');
  assert.deepEqual(run([A('a')], { a: { status: 'working' } }).get('agent:a')!.target, home);
});

test('🔴 A WIRED ARM IS NOT A VISIT — only a real call sends anybody to the bench', () => {
  // The user's own correction: a worker with a connection plugged in does not
  // necessarily use it. `connected` is a capability; `at: "arm"` is an event.
  // The room draws the second only.
  const p = run([A('a')], { a: { status: 'working', at: 'library' } });
  assert.equal(onRing(p.get('agent:a')!.target, 'arm'), false);
});

test('knowledge, web and shell have no station — they work from where they stand', () => {
  const home = ownSpot(0, 1, 'agent:a');
  for (const at of ['knowledge', 'web', 'shell', 'desk'] as const) {
    assert.deepEqual(
      run([A('a')], { a: { status: 'working', at } }).get('agent:a')!.target,
      home,
      `${at} must not become a station`,
    );
  }
});

test('two people at one station take DIFFERENT slots', () => {
  const p = run([A('a'), A('b')], {
    a: { status: 'working', at: 'library' },
    b: { status: 'working', at: 'library' },
  });
  const x = p.get('agent:a')!.target;
  const y = p.get('agent:b')!.target;
  assert.ok(onRing(x, 'library') && onRing(y, 'library'));
  assert.notDeepEqual(x, y, 'two people must not stand on one spot');
});

// ─────────────────────────────────────────────────────────── the hand-off

test('a finished task WITH files walks them to the results desk', () => {
  const p = run([A('a')], { a: { status: 'done', artifacts: 2 } });
  assert.ok(onRing(p.get('agent:a')!.target, 'artifacts'));
});

test('a finished task with NOTHING to put down hands off where it stands', () => {
  // A `deliver: reply` task answers and lands no file. Walking to the desk
  // empty-handed would invent a delivery that never happened.
  const home = ownSpot(0, 1, 'agent:a');
  assert.deepEqual(run([A('a')], { a: { status: 'done', artifacts: 0 } }).get('agent:a')!.target, home);
  assert.deepEqual(run([A('a')], { a: { status: 'error', artifacts: 0 } }).get('agent:a')!.target, home);
});

// ────────────────────────────────────────────────────────── resting people

test('resting = ON THE DIAGRAM BUT NOT WIRED, and it is the only place anybody sits', () => {
  const p = run([A('a', false)]).get('agent:a')!;
  assert.equal(p.loiter, true);
  assert.equal(p.pose, 'sit');
  assert.ok(
    p.target.x > BREAK_AREA.x && p.target.x < BREAK_AREA.x + BREAK_AREA.w,
    'a resting person belongs in the break area',
  );
  // Everybody else stands. Chairs exist in exactly one place.
  assert.equal(run([A('a')]).get('agent:a')!.pose, 'stand');
  assert.equal(run([A('a')]).get('agent:a')!.loiter, false);
});

test('🔴 an unwired person WITH WORK IN FLIGHT is not resting', () => {
  // Cutting the wire stops NEW work; it does not abandon a task already
  // running. Sending them to the coffee table mid-task would contradict the
  // status line still ticking beside them.
  const p = run([A('a', false)], { a: { status: 'working', at: 'library' } }).get('agent:a')!;
  assert.equal(p.loiter, false);
  assert.equal(p.pose, 'stand');
  assert.ok(onRing(p.target, 'library'));
});

// ─────────────────────────────────────────────────────────────── the shape

test('everybody gets exactly one placement, assistant included', () => {
  const out = direct({
    assistantId: 'assistant',
    agents: [A('a'), A('b'), A('c')],
    live: {},
    reading: null,
    at: () => undefined,
  });
  assert.equal(out.length, 4);
  assert.equal(new Set(out.map((p) => p.id)).size, 4);
});

test('no assistant yet ⇒ no assistant placement, and nothing throws', () => {
  const out = direct({ agents: [A('a')], live: {}, reading: 'library', at: () => undefined });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'agent:a');
});

test('the nearest free slot follows where somebody is standing NOW', () => {
  // Two runs, same office, different current positions ⇒ different approach.
  const far = { x: 1500, y: 850 };
  const near = { x: 100, y: 400 };
  const pick = (from: { x: number; y: number }) =>
    direct({
      agents: [A('a')],
      live: { a: { status: 'working', at: 'library' } },
      reading: null,
      at: () => from,
    })[0]!.target;
  assert.notDeepEqual(pick(far), pick(near), 'the ring must be entered from the nearer side');
});
