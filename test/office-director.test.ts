
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ASSISTANT_SPOT,
  BREAK_AREA,
  BREAK_CAPACITY,
  BREAK_PIECES,
  BREAK_SEATS,
  STATIONS,
  WORLD,
  direct,
  ownSpot,
  ringSlots,
  type DirectAgent,
  type DirectLive,
} from '../dist/core/office-floor.js';
import { MAX_SIT_LIFT } from '../dist/core/cast.js';

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

/** Is a point on the rug? The one question that catches a piece drawn off the floor. */
function inArea(p: { x: number; y: number }): boolean {
  return (
    p.x >= BREAK_AREA.x &&
    p.x <= BREAK_AREA.x + BREAK_AREA.w &&
    p.y >= BREAK_AREA.y &&
    p.y <= BREAK_AREA.y + BREAK_AREA.h
  );
}

test('resting = ON THE DIAGRAM BUT NOT WIRED, and it is the only place anybody sits', () => {
  const p = run([A('a', false)]).get('agent:a')!;
  assert.equal(p.pose, 'sit');
  assert.ok(inArea(p.target), 'a resting person belongs in the break area');
  // Everybody else stands. Chairs exist in exactly one place.
  assert.equal(run([A('a')]).get('agent:a')!.pose, 'stand');
});

test('🔴 an unwired person WITH WORK IN FLIGHT is not resting', () => {
  // Cutting the wire stops NEW work; it does not abandon a task already
  // running. Sending them to the coffee table mid-task would contradict the
  // status line still ticking beside them.
  const p = run([A('a', false)], { a: { status: 'working', at: 'library' } }).get('agent:a')!;
  assert.equal(p.pose, 'stand');
  assert.ok(onRing(p.target, 'library'));
});

test('🔴 EVERY BREAK SEAT AND EVERY PIECE IS ON THE RUG — the gate the drift got past', () => {
  // The pieces were literals in `Room.tsx` and the seats literals in core, both
  // written against the old 546-wide corner rug. After the area moved, the chess
  // set was drawn at x 1590 in a 1600-unit world and its seat sat at 1460: a
  // person resting beside furniture that had walked off the floor. Nothing was
  // red, because nothing was asking.
  BREAK_SEATS.forEach((s, i) => assert.ok(inArea(s), `seat ${i} is off the rug: ${JSON.stringify(s)}`));
  BREAK_PIECES.forEach((p, i) => {
    assert.ok(inArea({ x: p.x, y: p.baseY }), `piece ${i} (${p.id}) is off the rug: ${p.x},${p.baseY}`);
    assert.ok(p.x > 0 && p.x < WORLD.w, `piece ${i} (${p.id}) is off the world`);
  });
});

test('the six seats are six DIFFERENT places, and the pose belongs to the seat', () => {
  assert.equal(BREAK_SEATS.length, 6);
  assert.equal(new Set(BREAK_SEATS.map((s) => `${s.x},${s.y}`)).size, 6, 'two people on one cushion');
  // Sofa and chess seat; the counter and the foosball ends stand. A pose carried
  // on the PERSON is how somebody ends up sitting in mid-air beside a table.
  assert.deepEqual(
    BREAK_SEATS.map((s) => s.pose),
    ['sit', 'sit', 'sit', 'stand', 'stand', 'stand'],
  );
});

test('resting people fill the seats IN ORDER, one each', () => {
  const p = run([A('a', false), A('b', false), A('c', false)]);
  const got = ['agent:a', 'agent:b', 'agent:c'].map((id) => p.get(id)!);
  got.forEach((g, i) => {
    assert.deepEqual(g.target, { x: BREAK_SEATS[i].x, y: BREAK_SEATS[i].y }, `seat ${i}`);
    assert.equal(g.pose, BREAK_SEATS[i].pose);
  });
});

test('🔴 SIX AT MOST — the seventh rester is marked off screen, never dropped', () => {
  // The user's call (06/09): the break area shows six and no more. The cost is
  // real — absence looks like non-existence — so the thing that must not also be
  // lost is the DATUM. A placement that simply disappeared from the list would
  // make "resting, off screen" and "not in this office" the same shape of data.
  const nine = Array.from({ length: 9 }, (_, i) => A(`r${i}`, false));
  const out = direct({ assistantId: 'assistant', agents: nine, live: {}, reading: null, at: () => undefined });
  assert.equal(out.length, 10, 'everybody still gets exactly one placement');
  const drawn = out.filter((p) => p.id !== 'assistant' && p.rest !== 'offscreen');
  assert.equal(drawn.length, BREAK_CAPACITY);
  assert.equal(out.filter((p) => p.rest).length, 9, 'all nine are still counted as resting');
  // And the six that ARE drawn are the six seats, in order — not an arbitrary six.
  drawn.forEach((p, i) => assert.deepEqual(p.target, { x: BREAK_SEATS[i].x, y: BREAK_SEATS[i].y }));
});

test('`rest` is set for resting people ONLY — it is not a synonym for `pose`', () => {
  // A person at the foosball table or the counter is resting on their feet, and
  // a person walking to the bookshelf is not resting at all. Reading `pose` to
  // answer "how many are resting" was the old bug: it counted three of six.
  const p = run([A('a', false), A('b', false), A('c', false), A('d', false)]);
  assert.deepEqual(
    ['agent:a', 'agent:b', 'agent:c', 'agent:d'].map((id) => [p.get(id)!.pose, p.get(id)!.rest]),
    [
      ['sit', 'seated'],
      ['sit', 'seated'],
      ['sit', 'seated'],
      ['stand', 'seated'],
    ],
  );
  assert.equal(run([A('a')]).get('agent:a')!.rest, undefined);
  assert.equal(run([A('a', false)], { a: { status: 'working' } }).get('agent:a')!.rest, undefined);
});

test('a seat is DERIVED from the piece it belongs to, never typed twice', () => {
  // The sofa's two cushions have to sit on the sofa, and the chess seat on the
  // far stool. Both come from the same constants `BREAK_PIECES` is built from,
  // so this asserts the wiring rather than the numbers.
  const sofa = BREAK_PIECES.find((p) => p.id === 'sofa')!;
  assert.deepEqual([BREAK_SEATS[0].y, BREAK_SEATS[1].y], [sofa.baseY, sofa.baseY]);
  assert.equal((BREAK_SEATS[0].x + BREAK_SEATS[1].x) / 2, sofa.x, 'the cushions straddle the sofa');
  const stools = BREAK_PIECES.filter((p) => p.id === 'stool');
  assert.equal(stools.length, 2, 'the chess table needs a seat on each side');
  assert.equal(BREAK_SEATS[2].x, stools[0].x);
  // FORWARD of the far stool, not on its base — a person plants their feet in
  // front of the legs, and the seated sprite is raised off the anchor by up to
  // `MAX_SIT_LIFT`. Between the two, feet placed at the stool's own base ended up
  // drawn on the chess pieces. → `core/office-floor §CHESS_SEAT`
  const forward = BREAK_SEATS[2].y - stools[0].baseY;
  assert.ok(forward > MAX_SIT_LIFT, `the seat must clear the lift: ${forward} <= ${MAX_SIT_LIFT}`);
  assert.ok(forward < 60, 'but still be ON the stool, not standing beside it');
});

test('🔴 exactly ONE object is drawn in front of the people, and it is the chess set', () => {
  // A front layer sorts by nothing: every piece in it beats every person whatever
  // their `y`. That is right for a table only ever approached from behind and
  // wrong for anything somebody can walk in front of — put the sofa in here and
  // a person crossing the room vanishes behind its backrest.
  const front = BREAK_PIECES.filter((p) => p.front);
  assert.deepEqual(
    front.map((p) => p.id),
    ['table-chess', 'stool'],
  );
  // And the near stool comes after the table, or it is drawn inside it.
  assert.ok(front[1]!.baseY > front[0]!.baseY, 'the near stool is nearer than the table');
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
