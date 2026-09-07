
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ASSISTANT_SPOT,
  ASSISTANT_WAIT,
  BREAK_AREA,
  BREAK_CAPACITY,
  BREAK_PIECES,
  BREAK_SEATS,
  BODY_HALF_W,
  COOLER,
  HOME_SPOTS,
  HORIZON,
  IDLE_SPOTS,
  NAME_DROP,
  PLANT,
  SAFE,
  SORTED_PIECES,
  STATIONS,
  WORLD,
  clampSafe,
  dealOpeningSpots,
  dealSeats,
  direct,
  ownSpot,
  pickIdleSpot,
  ringSlots,
  walkersAtOpen,
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

/**
 * ⚠ THE SEATING DEAL IS AN INPUT NOW, AND THE TESTS DEAL IT DETERMINISTICALLY.
 *
 * `direct()` stopped counting seats out in roster order (§17c): who sits where is
 * decided once per mount, with a random source, and handed in.
 *
 * ⚠ `NO_SHUFFLE` is `0.999999`, NOT `0`. Fisher–Yates picks `j = floor(rnd × (i+1))`,
 * so zero swaps every element with the head and comes out ROTATED — the tests
 * below were written for the identity permutation and would have been asserting
 * against a quietly different order. A value just under 1 gives `j === i`, which
 * is the swap that does nothing.
 */
const NO_SHUFFLE = (): number => 0.999999;

const dealFor = (agents: DirectAgent[], live: Record<string, DirectLive>): Record<string, number> =>
  dealSeats(
    agents.map((a) => a.id),
    agents.filter((a) => !a.connected && !live[a.role]).map((a) => a.id),
    {},
    NO_SHUFFLE,
  );

function run(
  agents: DirectAgent[],
  live: Record<string, DirectLive> = {},
  reading: 'library' | 'web' | null = null,
) {
  const out = direct({
    assistantId: 'assistant',
    agents,
    live,
    reading,
    seats: dealFor(agents, live),
    at: () => undefined,
  });
  return new Map(out.map((p) => [p.id, p]));
}

function onRing(p: { x: number; y: number }, id: 'library' | 'artifacts' | 'arm'): boolean {
  return ringSlots(STATIONS[id]).some((s) => Math.abs(s.x - p.x) < 1 && Math.abs(s.y - p.y) < 1);
}

// ─────────────────────────────────────────────────────────────── assistant

test('the assistant WAITS BY THE FILING DESK while any task is running', () => {
  // Three tasks can run at once, so it still does not follow a worker — it stands
  // at the door the work comes back through. → §17d
  const p = run([A('a'), A('b')], { a: { status: 'working' }, b: { status: 'working' } });
  assert.deepEqual(p.get('assistant')!.target, ASSISTANT_WAIT);
});

test('🔴 with nothing running the assistant STAYS PUT — it does not walk home', () => {
  // The user's rule, and it is the one a tidy-minded change would undo: walking
  // back to centre-front reports nothing, and movement is this room's only word
  // for work. Home is where the next MOUNT puts it, not where a timer does.
  const here = { x: 900, y: 700 };
  const out = direct({
    assistantId: 'assistant',
    agents: [A('a')],
    live: {},
    reading: null,
    seats: {},
    at: (id) => (id === 'assistant' ? here : undefined),
  });
  assert.deepEqual(out.find((p) => p.id === 'assistant')!.target, here);
});

test('an assistant nobody has placed yet starts at centre-front', () => {
  // `at()` returns undefined before the first paint, and the fallback IS the
  // mount rule — there is no second branch saying "on mount, go home".
  assert.deepEqual(run([], {}, null).get('assistant')!.target, ASSISTANT_SPOT);
});

test('the assistant walks to the bookshelf ONLY for a document lookup', () => {
  assert.ok(onRing(run([], {}, 'library').get('assistant')!.target, 'library'));
  // A web lookup is a real thing that happens somewhere else. Sending them to
  // the shelf for it would be the room describing the wrong action.
  assert.deepEqual(run([], {}, 'web').get('assistant')!.target, ASSISTANT_SPOT);
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
  const out = direct({
    assistantId: 'assistant',
    agents: nine,
    live: {},
    reading: null,
    seats: dealFor(nine, {}),
    at: () => undefined,
  });
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

test('🔴 the SORTED layer holds the chess set and the two desks, and nothing else', () => {
  // Sorting a piece costs a DOM node in the actor layer, so it is not for
  // everything — only for a piece somebody can legitimately stand BEHIND. The
  // plant, the cooler and the bookshelf are objects §17f forbids standing behind,
  // so sorting them would answer a question that cannot be asked.
  assert.deepEqual(SORTED_PIECES.map((p) => p.id), [
    'desk-files',
    'desk-laptop',
    'table-chess',
    'stool',
  ]);
  // The near stool comes after the table in the break list, or it is drawn inside
  // it — document order is still what breaks a tie between two equal `baseY`.
  const chess = SORTED_PIECES.filter((p) => p.id === 'table-chess' || p.id === 'stool');
  assert.ok(chess[1]!.baseY > chess[0]!.baseY, 'the near stool is nearer than the table');
});

test('🔴 a desk piece is DERIVED from its station, so the picture cannot drift from the ring', () => {
  // These two were literals in the JSX (`x + w / 2`, `y + h`). One copy of a
  // layout is fine; a second one is what drifted the break area by 130 units.
  for (const [id, s] of [
    ['desk-files', STATIONS.artifacts],
    ['desk-laptop', STATIONS.arm],
  ] as const) {
    const piece = SORTED_PIECES.find((p) => p.id === id)!;
    assert.equal(piece.x, s.x + s.w / 2);
    assert.equal(piece.baseY, s.y + s.h);
  }
});

// ──────────────────────────────────────────────────────── the location map

/**
 * ⚠ THE OBJECTS NOBODY MAY STAND BEHIND, RE-STATED HERE ON PURPOSE.
 *
 * A gate that imports the very table it is checking asserts that the code equals
 * itself. These four rows are the USER'S rule written independently — *"the
 * plant, the filing cabinet, the water cooler, the skirting board: never climbed
 * and never stood behind"* — so the test fails if the map moves and the rule did
 * not.
 */
const NO_BEHIND: Array<{ what: string; x0: number; x1: number; baseY: number }> = [
  { what: 'plant', x0: 27, x1: 101, baseY: HORIZON + 74 },
  { what: 'bookcase', x0: 194, x1: 282, baseY: STATIONS.library.y + STATIONS.library.h },
  { what: 'cabinet', x0: 298, x1: 362, baseY: STATIONS.library.y + STATIONS.library.h },
  { what: 'cooler', x0: 1081, x1: 1119, baseY: HORIZON + 34 },
];

test('🔴 every idle spot keeps the whole BODY inside the safe area', () => {
  // Every rule anybody writes by hand is written about FEET, and every rule that
  // matters is about the box. That gap is how a figure ends up half inside the
  // wall while its coordinate is perfectly legal.
  assert.ok(IDLE_SPOTS.length >= 20, 'the map should not have quietly shrunk');
  for (const [i, p] of IDLE_SPOTS.entries()) {
    assert.ok(p.x - BODY_HALF_W >= 0, `spot ${i} hangs off the left edge: ${p.x}`);
    assert.ok(p.x + BODY_HALF_W <= BREAK_AREA.x, `spot ${i} reaches the break area: ${p.x}`);
    assert.ok(p.y >= HORIZON, `spot ${i} has its feet in the wall: ${p.y}`);
    assert.ok(p.y <= WORLD.h, `spot ${i} is past the bottom of the frame: ${p.y}`);
    assert.equal(inArea({ x: p.x, y: p.y }), false, `spot ${i} is ON the break rug`);
  }
});

test('🔴 THE NAME LABEL FITS INSIDE THE FRAME — the figure is not only the body', () => {
  // The user's report: the front row's names ran off the bottom while every
  // measurement said the room was legal, because `SAFE.y1` was derived from the
  // DRAWING and `.actor-name` hangs below the anchor. A rule about a figure has
  // to be about the whole figure. → `office-floor §NAME_DROP`
  assert.ok(NAME_DROP > 0, 'premise: the label really does hang below the feet');
  assert.ok(SAFE.y1 + NAME_DROP <= WORLD.h, `a name at y ${SAFE.y1 + NAME_DROP} falls off a ${WORLD.h} world`);
  for (const [i, p] of IDLE_SPOTS.entries()) {
    assert.ok(p.y + NAME_DROP <= WORLD.h, `spot ${i}'s name is cut off: ${p.y + NAME_DROP}`);
  }
  // And the people the director actually places, which is the table the last
  // round's gate was NOT pointed at.
  for (let total = 1; total <= 14; total++) {
    for (const p of run(Array.from({ length: total }, (_, i) => A(`w${i}`))).values()) {
      assert.ok(p.target.y + NAME_DROP <= WORLD.h, `${total} people: a name at ${p.target.y + NAME_DROP}`);
    }
  }
});

test('🔴 nobody stands squarely in front of the plant or the cooler', () => {
  // Both of the user's reports were one sentence about two objects: *"shift the
  // spot at the plant to the right"*, *"shift the one at the cooler to the
  // left"*. A body is 124 units wide; the plant is 74 and the cooler 39, so
  // dead-centre erases them entirely.
  //
  // ⚠ THE ASSERTION IS ABOUT THE SLIVER LEFT SHOWING, not about the offset, and
  // that distinction is the bug this caught: *"stand 24 past the object's edge"*
  // leaves 36 units of the plant visible and 2 units of the cooler. A rule
  // stated as an offset gives the narrowest object the least protection — which
  // is backwards. → `office-floor §VISIBLE`
  // ⚠ THE SET IS DEFINED BY THE FLOOR, NOT BY INTENT: every spot standing in the
  // strip of floor immediately in front of the object. That is what "at this
  // object" means physically, and it needs no table saying which spot was placed
  // for what. Somebody two rows further forward is a different picture — they
  // are in the room, not at the plant — and §17f② already governs that case.
  const AT = 60;
  for (const o of [
    { what: 'plant', ...PLANT },
    { what: 'cooler', ...COOLER },
  ]) {
    const at = IDLE_SPOTS.filter((p) => p.y > o.baseY && p.y - o.baseY <= AT);
    // Shifting somebody out of the way is only right if they still stand AT the
    // thing, so the count is asserted before the geometry.
    assert.ok(at.length > 0, `nobody stands at the ${o.what} any more`);
    for (const p of at) {
      // How much of the object sticks out past the body's box on the far side.
      const showing = Math.abs(p.x - o.x) + o.halfW - BODY_HALF_W;
      assert.ok(
        showing >= 20,
        `a body at x ${p.x} leaves ${Math.round(showing)} units of the ${o.what} showing`,
      );
    }
  }
});

test('🔴 no idle spot stands BEHIND the plant, the cabinet or the cooler', () => {
  for (const [i, p] of IDLE_SPOTS.entries()) {
    for (const o of NO_BEHIND) {
      const overlaps = p.x + BODY_HALF_W > o.x0 && p.x - BODY_HALF_W < o.x1;
      if (!overlaps) continue;
      assert.ok(p.y > o.baseY, `spot ${i} (${p.x},${p.y}) stands behind the ${o.what}`);
    }
  }
});

test('the filing desk carries EIGHT places, three of them behind it', () => {
  // The only object in the room with places on both sides — which is the whole
  // reason depth became `z-index = round(baseY)` (§17b). "Behind" is not a flag
  // anywhere; it is simply a smaller `y`.
  const desk = SORTED_PIECES.find((p) => p.id === 'desk-files')!;
  const want = [
    ...[-106, 0, 106].map((dx) => ({ x: desk.x + dx, y: desk.baseY + 40, side: 'front' })),
    ...[-106, 0, 106].map((dx) => ({ x: desk.x + dx, y: desk.baseY - 48, side: 'behind' })),
    ...[-190, 190].map((dx) => ({ x: desk.x + dx, y: desk.baseY, side: 'end' })),
  ];
  assert.equal(want.length, 8);
  // ⚠ THROUGH `clampSafe`, and the right-hand end place is the one it actually
  // moves: 190 units right of the desk centre is x 1126, and the break area
  // starts at 1170, so the body's right edge would be 18 units onto the rug. The
  // safe area wins over the layout — which is the point of having one — and this
  // test states that rather than asserting the number somebody wished for.
  for (const w of want) {
    const c = clampSafe(w);
    assert.ok(
      IDLE_SPOTS.some((p) => Math.abs(p.x - c.x) < 1 && Math.abs(p.y - c.y) < 1),
      `the desk's ${w.side} place at ${c.x},${c.y} is missing from the map`,
    );
  }
  assert.equal(clampSafe(want[7]!).x, SAFE.x1, 'the right-hand end place is the one the clamp moves');
  assert.equal(want.filter((w) => w.y < desk.baseY).length, 3, 'three of them stand behind it');
});

test('🔴 NOBODY EVER STANDS OUTSIDE THE SAFE AREA — up to a full office', () => {
  // Measured in the live room on 07/09 with eleven employees: `vvv` stood at
  // y = 946 in a 900-unit world and `d` had its left edge at x = −12. Both were
  // `ownSpot` doing exactly what it says, and the gate at the time was pointed at
  // `HOME_SPOTS` — the idle MAP — while `direct()` handed out the unclamped one.
  // A gate on the copy is a gate watching the wrong door.
  for (let total = 1; total <= 14; total++) {
    const agents = Array.from({ length: total }, (_, i) => A(`w${i}`));
    for (const p of run(agents).values()) {
      assert.ok(p.target.x - BODY_HALF_W >= 0, `${total} people: someone's left edge is at ${p.target.x - BODY_HALF_W}`);
      assert.ok(p.target.x + BODY_HALF_W <= BREAK_AREA.x, `${total} people: someone reaches the break area`);
      assert.ok(p.target.y >= HORIZON, `${total} people: feet in the wall at ${p.target.y}`);
      assert.ok(p.target.y <= WORLD.h, `${total} people: standing under the floor at ${p.target.y}`);
    }
  }
});

test('🔴 the ten default spots are here and the ELEVENTH is not', () => {
  // At `PER_ROW = 5` index 10 opens a third row at y = 950 in a 900-unit world.
  // The user saw it; this is the gate that keeps it seen.
  assert.equal(HOME_SPOTS.length, 10);
  assert.ok(ownSpot(10, 11, 'x').y > WORLD.h, 'premise: the eleventh really is off the floor');
  for (const p of HOME_SPOTS) assert.ok(IDLE_SPOTS.some((q) => q.x === p.x && q.y === p.y));
});

test('the assistant\'s two places are NOT on the map — nobody goes looking for it', () => {
  for (const a of [ASSISTANT_SPOT, ASSISTANT_WAIT]) {
    assert.ok(
      !IDLE_SPOTS.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 40),
      `a worker can claim the assistant's place at ${a.x},${a.y}`,
    );
  }
});

// ─────────────────────────────────────────────────────────── picking a spot

const world = (at: Record<string, { x: number; y: number }>, standing: string[] = []) => ({
  at,
  to: at,
  standing,
});

test('pickIdleSpot: an empty floor offers a spot, and it is one of the map\'s', () => {
  const p = pickIdleSpot('me', world({ me: { x: 500, y: 700 } }), Math.random)!;
  assert.ok(p);
  assert.ok(IDLE_SPOTS.some((q) => q.x === p.x && q.y === p.y), 'not a mapped spot');
});

test('🔴 pickIdleSpot never offers a spot somebody is standing on OR walking to', () => {
  // "Taken" has to include intent. Two people who each pick the spot the other
  // is halfway to arrive together and stand inside each other.
  const target = IDLE_SPOTS[4]!;
  const w = { at: { other: { x: 20, y: 880 } }, to: { other: target }, standing: [] as string[] };
  for (let i = 0; i < 60; i++) {
    const p = pickIdleSpot('me', w, Math.random);
    if (p) assert.ok(Math.hypot(p.x - target.x, p.y - target.y) >= 90, 'walked into an occupied spot');
  }
});

test('pickIdleSpot: it does not offer the spot you are already standing on', () => {
  const here = IDLE_SPOTS[7]!;
  for (let i = 0; i < 40; i++) {
    const p = pickIdleSpot('me', world({ me: here }), Math.random);
    if (p) assert.ok(Math.hypot(p.x - here.x, p.y - here.y) > 0.5);
  }
});

test('🔴 pickIdleSpot: a PAIR may form, a group of three may not', () => {
  // The user's rule, and it is the one that needs a definition rather than a
  // feeling: "already has company" and "too crowded to stand here" are the same
  // radius, so they cannot disagree.
  const alone = { x: 600, y: 700 };
  let paired = false;
  for (let i = 0; i < 400 && !paired; i++) {
    const p = pickIdleSpot('me', world({ mate: alone }, ['mate']), Math.random);
    if (p && Math.hypot(p.x - alone.x, p.y - alone.y) < 130) paired = true;
  }
  assert.ok(paired, 'nobody was ever offered a place beside a colleague standing alone');

  // Now the same person has company. Nobody may make it three.
  const busy = world({ a: { x: 600, y: 700 }, b: { x: 712, y: 700 } }, ['a', 'b']);
  for (let i = 0; i < 400; i++) {
    const p = pickIdleSpot('me', busy, Math.random);
    if (!p) continue;
    assert.ok(
      Math.hypot(p.x - 600, p.y - 700) >= 90 && Math.hypot(p.x - 712, p.y - 700) >= 90,
      `made a group of three at ${p.x},${p.y}`,
    );
  }
});

test('pickIdleSpot: a body in the break area is never joined', () => {
  // Resting people do not have company come and stand next to them: the break
  // area is where the room is STILL, and the working floor is where it moves.
  const rester = { x: BREAK_AREA.x + 100, y: BREAK_AREA.y + 150 };
  for (let i = 0; i < 200; i++) {
    const p = pickIdleSpot('me', world({ r: rester }, ['r']), Math.random);
    if (p) assert.equal(inArea({ x: p.x, y: p.y }), false);
  }
});

test('pickIdleSpot: everywhere taken ⇒ null, which means STAY PUT', () => {
  // Not "somewhere, anywhere". A fallback that always answers walks somebody
  // into a colleague to avoid returning nothing.
  const at: Record<string, { x: number; y: number }> = {};
  let n = 0;
  for (let x = SAFE.x0; x <= SAFE.x1; x += 40) {
    for (let y = SAFE.y0; y <= SAFE.y1; y += 40) at[`o${n++}`] = { x, y };
  }
  assert.equal(pickIdleSpot('me', world(at), Math.random), null);
});

test('🔴 pickIdleSpot spreads — it does not settle on one favourite', () => {
  // Nearest-free would be correct-looking and turn the map into a rut: the spot
  // next to where you already are is always the nearest one.
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = pickIdleSpot('me', world({ me: { x: 500, y: 700 } }), Math.random);
    if (p) seen.add(`${p.x},${p.y}`);
  }
  assert.ok(seen.size > 8, `two hundred picks landed on ${seen.size} places`);
});

// ──────────────────────────────────────────────── opening the view (§17l)

test('🔴 dealOpeningSpots: nobody is put on top of anybody dealt before them', () => {
  // The whole reason it deals against ITSELF: pick each spot in a world that
  // already holds everybody placed so far, or every person is placed against an
  // empty floor and the entire office can land on one point.
  for (let n = 1; n <= 10; n++) {
    const ids = Array.from({ length: n }, (_, i) => `agent:w${i}`);
    const out = dealOpeningSpots(ids, Math.random);
    const placed = Object.values(out);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.y - placed[j]!.y);
        assert.ok(d >= 90, `${n} people: two of them are ${Math.round(d)} apart`);
      }
    }
  }
});

test('dealOpeningSpots: every place it hands out is inside the safe area', () => {
  for (let round = 0; round < 40; round++) {
    for (const p of Object.values(dealOpeningSpots(['a', 'b', 'c', 'd', 'e', 'f'], Math.random))) {
      assert.ok(p.x - BODY_HALF_W >= 0 && p.x + BODY_HALF_W <= BREAK_AREA.x, `x ${p.x}`);
      assert.ok(p.y >= SAFE.y0 && p.y + NAME_DROP <= WORLD.h, `y ${p.y}`);
    }
  }
});

test('🔴 dealOpeningSpots: a miss is an ABSENT entry, never a guessed point', () => {
  // `pickIdleSpot` answers `null` when everywhere is taken, and the caller's
  // fallback is the person's own spot — the arc this replaces. A deal that
  // always answered would degrade to bodies inside each other instead of to the
  // old picture.
  const many = Array.from({ length: 400 }, (_, i) => `agent:w${i}`);
  const out = dealOpeningSpots(many, Math.random);
  assert.ok(Object.keys(out).length < many.length, 'the floor cannot really hold four hundred people');
  for (const id of many) if (out[id]) assert.ok(Number.isFinite(out[id]!.x));
});

test('dealOpeningSpots: it does NOT deal the same hand twice', () => {
  // This is the whole point of the change — a toggle must not re-form the same
  // parade line. Two deals in a row landing identically means the randomness is
  // decorative.
  const ids = ['a', 'b', 'c', 'd'];
  const key = (m: Record<string, { x: number; y: number }>): string =>
    ids.map((i) => `${m[i]?.x},${m[i]?.y}`).join(' ');
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(key(dealOpeningSpots(ids, Math.random)));
  assert.ok(seen.size > 5, `forty deals produced ${seen.size} arrangements`);
});

test('🔴 walkersAtOpen: one idle worker still produces ONE walker, and none produces none', () => {
  // The user's number and the user's rounding: *"about one in five, minimum one
  // (if there is at least one employee) ⇒ ceil"*. An empty floor is the one case
  // that must stay still — there is nobody to move, and inventing motion is what
  // §17g exists to forbid.
  assert.equal(walkersAtOpen(0), 0);
  assert.equal(walkersAtOpen(1), 1);
  assert.equal(walkersAtOpen(4), 1);
  assert.equal(walkersAtOpen(5), 1);
  assert.equal(walkersAtOpen(6), 2);
  assert.equal(walkersAtOpen(10), 2);
  assert.equal(walkersAtOpen(11), 3);
  // Never everybody at once: an office where the whole floor sets off together
  // reads as an evacuation, not as work.
  for (let n = 2; n <= 40; n++) assert.ok(walkersAtOpen(n) < n, `${n} idle ⇒ ${walkersAtOpen(n)} walking`);
});

// ────────────────────────────────────────────────────────── the seating deal

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `agent:${i}`);

test('dealSeats: at most six get a seat, and every seat is different', () => {
  const all = ids(9);
  const got = dealSeats(all, all, {}, Math.random);
  const seats = Object.values(got);
  assert.equal(seats.length, BREAK_CAPACITY);
  assert.equal(new Set(seats).size, BREAK_CAPACITY, 'two people on one cushion');
  for (const s of seats) assert.ok(s >= 0 && s < BREAK_CAPACITY);
});

test('🔴 dealSeats: a seat, once dealt, is that person\'s even while they are WORKING', () => {
  // The whole point. The old rule counted the resting out in roster order, so the
  // moment one person got a task everybody behind them shifted up a seat AND
  // WALKED TO IT — six people crossing a corner because one of them started work.
  const all = ids(6);
  const first = dealSeats(all, all, {}, Math.random);
  // `agent:2` stops resting. Nobody else is offered its cushion.
  const second = dealSeats(all, all.filter((id) => id !== 'agent:2'), first, Math.random);
  assert.deepEqual(second, first);
});

test('dealSeats: somebody hired mid-session takes a seat that is genuinely free', () => {
  const five = ids(5);
  const first = dealSeats(five, five, {}, Math.random);
  const six = [...five, 'agent:new'];
  const second = dealSeats(six, six, first, Math.random);
  for (const id of five) assert.equal(second[id], first[id], `${id} was moved`);
  assert.ok(second['agent:new'] !== undefined, 'the sixth cushion was free and went unused');
  assert.equal(new Set(Object.values(second)).size, 6);
});

test('dealSeats: an employee who is gone loses their seat, or the deal leaks forever', () => {
  const all = ids(6);
  const first = dealSeats(all, all, {}, Math.random);
  const left = all.filter((id) => id !== 'agent:0');
  const second = dealSeats(left, left, first, Math.random);
  assert.equal(second['agent:0'], undefined);
  assert.equal(Object.keys(second).length, 5);
});

test('🔴 dealSeats: WHICH six is random — not the first six by id', () => {
  // A hash of the roster would look random and be constant forever: the same six
  // faces every reload, for the life of the office. That is the thing this
  // replaces, so the test has to be about the source of the randomness.
  const all = ids(12);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    seen.add(Object.keys(dealSeats(all, all, {}, Math.random)).sort().join(','));
  }
  assert.ok(seen.size > 1, 'forty deals produced one line-up — the source is not random');
});

test('🔴 dealSeats: WHERE each of them sits is random too — the half that was constant', () => {
  // The defect this replaces, and it is invisible from any test that only asked
  // "did everybody get a different seat". Only the QUEUE was shuffled and the
  // free seats were handed out in ascending order, so four resting people always
  // came out on seats 0,1,2,3 — both sofa cushions, the chess stool, the counter
  // — every deal, every reload. The foosball table only ever had anybody at it
  // at exactly six. Randomised line-up, constant layout.
  for (const n of [1, 2, 3, 4, 5]) {
    const all = ids(n);
    const reached = new Set<number>();
    for (let i = 0; i < 300; i++) {
      for (const s of Object.values(dealSeats(all, all, {}, Math.random))) reached.add(s);
    }
    assert.equal(
      reached.size,
      BREAK_CAPACITY,
      `${n} resting reached only seats ${[...reached].sort().join(',')}`,
    );
  }
});

test('dealSeats: at full capacity the mapping is a permutation, not a fixed order', () => {
  /**
   * ⚠ THIS ONE DOES NOT CATCH THE BUG ABOVE, AND SAYING SO IS THE POINT.
   *
   * At exactly six resting the two shuffles are INDISTINGUISHABLE: six people
   * into six seats is a permutation either way, so this test stays green with
   * the seat shuffle deleted — verified by deleting it. The discriminating case
   * is FEWER people than seats, which is the test above; this one is here to
   * hold the capacity case, and it is labelled so nobody reads it as the gate.
   */
  const all = ids(6);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    seen.add(all.map((id) => dealSeats(all, all, {}, Math.random)[id]).join(','));
  }
  assert.ok(seen.size > 100, `four hundred deals produced ${seen.size} arrangements`);
});

test('dealSeats: a seat held from a PRIOR deal is never re-shuffled', () => {
  // The shuffle is over the FREE seats only. Re-dealing the held ones would be
  // the every-event reshuffle this whole function exists to prevent — six people
  // sliding across a corner because a seventh started resting.
  const all = ids(6);
  const held = { 'agent:0': 4, 'agent:1': 1 };
  for (let i = 0; i < 200; i++) {
    const got = dealSeats(all, all, held, Math.random);
    assert.equal(got['agent:0'], 4);
    assert.equal(got['agent:1'], 1);
    assert.equal(new Set(Object.values(got)).size, 6, 'somebody was dealt a held cushion');
  }
});

test('dealSeats: a corrupt prior entry is dropped, never doubled up', () => {
  const all = ids(3);
  const got = dealSeats(all, all, { 'agent:0': 2, 'agent:1': 2, 'agent:2': 99 }, () => 0);
  assert.equal(got['agent:0'], 2);
  assert.notEqual(got['agent:1'], 2);
  assert.ok((got['agent:2'] ?? -1) >= 0 && (got['agent:2'] ?? -1) < BREAK_CAPACITY);
  assert.equal(new Set(Object.values(got)).size, 3);
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
