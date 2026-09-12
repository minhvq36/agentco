
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { placeOf, describeCall } from '../dist/core/worker.js';
import {
  BODY_HALF_W,
  BODY_TALL,
  CH_H,
  COOLER,
  DESK_PIECES,
  PLANT,
  STATIONS,
  usedFrom,
} from '../dist/core/office-floor.js';
import {
  CAST,
  CAST_COUNT,
  FACE_COUNT,
  GARMENT_TINTS,
  assignCast,
  assignTints,
  castOf,
  isCastId,
} from '../dist/core/cast.js';
import { pruneCast, pruneTint, readCast, readTint } from '../dist/core/layout.js';

/**
 * The office view's deterministic half. → docs/SPEC-office-animation.md §6
 *
 * Everything here answers one question: does the room state something that was
 * actually OBSERVED. A wrong place is not a cosmetic bug — it is the animation
 * claiming an employee read the user's documents when it never opened one.
 */

// ──────────────────────────────────────── core's numbers vs the actual art

/**
 * 🔴 THE TWO FILES `core/office-floor.ts` SAYS ARE CHECKED HERE. → §17f①
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THEY WERE NOT. The comment beside `BODY_HALF_W` read *"these two are a    │
 * │ measurement written down, not a computation, and `test/office-view.test`  │
 * │ is where the two are held against each other"* — and this file had never  │
 * │ mentioned them. That is the failure class this repository has paid for    │
 * │ more than any other: a sentence naming a real file, which does a real     │
 * │ job, and protects something else entirely. `PLANT.halfW` and              │
 * │ `COOLER.halfW` arrived carrying the same claim, so the claim is made      │
 * │ true rather than repeated.                                                │
 * │                                                                           │
 * │ ⚠ IT READS THE SOURCE AS TEXT, and that is not a shortcut — it is the     │
 * │ only door. `core` is pure and the manifest imports PNGs, so `node --test` │
 * │ cannot import either art module; the numbers, however, are plain decimal  │
 * │ literals in a file this process can open. A regex over one declaration is │
 * │ a narrow reader, and it fails loudly (`premise` below) if the shape it is │
 * │ reading ever changes.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const WEB = path.join(url.fileURLToPath(new URL('..', import.meta.url)), 'web', 'src', 'office', 'art');
const src = (f: string): string => fs.readFileSync(path.join(WEB, f), 'utf8');

/** `'plant': { src: f_plant, h: 146, ar: 0.5038 }` → the drawn width in world units. */
function furnitureWidth(id: string): number {
  const row = new RegExp(`'${id}':\\s*\\{[^}]*\\bh:\\s*([0-9.]+)[^}]*\\bar:\\s*([0-9.]+)`).exec(
    src('furniture.ts'),
  );
  assert.ok(row, `premise: no '${id}' row of the expected shape in art/furniture.ts`);
  return Number(row[1]) * Number(row[2]);
}

const num = (file: string, re: RegExp): number => {
  const m = re.exec(src(file));
  assert.ok(m, `premise: ${re} found nothing in art/${file}`);
  return Number(m[1]);
};

test('🔴 PLANT.halfW and COOLER.halfW are the ARTWORK, not two numbers somebody liked', () => {
  // They decide where a person stands beside each piece (`office-floor §VISIBLE`),
  // so a re-cut PNG that changes an aspect ratio moves the object and leaves the
  // person pointing at nothing.
  //
  // ⚠ ROUNDED UP, and the direction is asserted rather than a symmetric
  // tolerance: a `halfW` bigger than the drawing stands somebody a unit further
  // out than they had to be, while a smaller one hands the sliver rule a piece
  // narrower than the one on screen and quietly eats the margin it just bought.
  for (const [what, half] of [
    ['plant', PLANT.halfW],
    ['cooler', COOLER.halfW],
  ] as const) {
    const measured = furnitureWidth(what) / 2;
    assert.ok(half >= measured, `${what}: core says halfW ${half}, the art measures ${measured.toFixed(2)}`);
    assert.ok(half - measured < 1, `${what}: halfW ${half} has drifted off the art's ${measured.toFixed(2)}`);
  }
});

/**
 * 🔴 THE ROOM IS ALWAYS LIT — AND A HAND-KEPT LIST CANNOT KNOW THAT. (08/09)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE BLACK BUBBLE. `.office-root` pins the app's colour tokens to their    │
 * │ light values, because the room does not follow the app theme. The pin     │
 * │ was written by walking the tokens somebody thought of, and                │
 * │ `--color-danger-soft` was not one of them — it is used by exactly one     │
 * │ rule, the ERROR bubble, so it stayed invisible until a task failed on     │
 * │ the dark theme: `#40201a` behind `#232019` text, over a light floor.      │
 * │                                                                          │
 * │ ⚠ THE RULE EXISTED AND THE MECHANISM DID NOT. This reads both halves out  │
 * │ of the stylesheet — every `var(--color-…)` the office subtree mentions,   │
 * │ and every token the pin declares — so a token that arrives LATER is       │
 * │ caught by the file that introduces it rather than by whoever next looks   │
 * │ at a bubble.                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 every app colour the office uses is PINNED to its light value', () => {
  const office = path.join(
    url.fileURLToPath(new URL('..', import.meta.url)),
    'web',
    'src',
    'office',
  );
  const files = ['renderers/dom/office.css', 'renderers/dom/Room.tsx', 'renderers/dom/DomScene.tsx'];
  const used = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(office, f), 'utf8').matchAll(/var\((--color-[a-z-]+)/g)) {
      used.add(m[1]!);
    }
  }
  assert.ok(used.size > 5, 'premise: the regex found no tokens at all — it is reading the wrong thing');

  const css = fs.readFileSync(path.join(office, 'renderers/dom/office.css'), 'utf8');
  const block = /\.office-root,\s*\.office-light\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(block, 'premise: the pin block is no longer where this test looks for it');
  const pinned = new Set([...block[1]!.matchAll(/(--color-[a-z-]+)\s*:/g)].map((m) => m[1]!));

  const loose = [...used].filter((t) => !pinned.has(t)).sort();
  assert.deepEqual(
    loose,
    [],
    `these flip with the app theme inside a room that never does: ${loose.join(', ')}`,
  );
});

/**
 * 🔴 THE PERSON AT THE ARM BENCH — A CONSTRAINT THAT SPANS TWO FILES. → §17f′
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "BEHIND THE DESK" IS ONLY TRUE IF THE DESK IS DRAWN THERE, AND IS TALL   │
 * │ ENOUGH.                                                                  │
 * │                                                                          │
 * │ `core` picks the standing point from a RECTANGLE (312 wide); the desk    │
 * │ that has to cover the legs is a PNG (161 wide) whose size lives in       │
 * │ `art/furniture.ts`. Get it wrong in the cheap direction — a re-cut sheet │
 * │ with a different aspect ratio — and nothing is out of place on screen:   │
 * │ a person simply stands in a gap of floor behind a desk that no longer    │
 * │ reaches them, which reads as a rendering bug and will be looked for in   │
 * │ the image file. Same arrangement as `CHESS_SEAT`, one desk over.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
test('🔴 the arm bench standing point is inside the desk that is DRAWN, and covered by it', () => {
  const bench = STATIONS.arm;
  const at = usedFrom(bench);
  assert.ok(at, 'premise: the arm bench declares where it is used from');

  const desk = DESK_PIECES.find((p) => p.id === 'desk-laptop');
  assert.ok(desk, 'premise: the arm bench desk is a sorted piece with its own row');

  const w = furnitureWidth('desk-laptop');
  const h = num('furniture.ts', /'desk-laptop':\s*\{[^}]*\bh:\s*([0-9.]+)/);

  // Inside the drawn top, with a body's shoulder-width of margin either side —
  // half a person hanging past the end of the desk is not standing at it.
  assert.ok(
    Math.abs(at.x - desk.x) < w / 2 - BODY_HALF_W / 2,
    `standing at x ${at.x} on a desk drawn ${w.toFixed(0)} wide, centred on ${desk.x}`,
  );

  const back = desk.baseY - at.y;
  assert.ok(back > 0, 'in front of the desk is standing NEAR the laptop, not AT it');
  assert.ok(
    h > back,
    `the desk is ${h} tall and the person stands ${back} behind it — nothing would cover them`,
  );
  // …and not so far back that the desk swallows the knees. Half the art's height
  // is the shin; past that the figure starts reading as a bust on a shelf.
  assert.ok(back < h / 2 + 20, `${back} behind a ${h}-tall desk hides too much of the body`);
});

test('🔴 BODY_HALF_W and BODY_TALL still describe the sheets they were measured off', () => {
  // The safe area is a law about BOUNDING BOXES, and this is the box. Re-cut the
  // cast at a different cell size, or give a sheet a bigger `scale`, and every
  // edge of the safe area is quietly wrong by the difference.
  const cell = {
    w: num('manifest.ts', /CELL\s*=\s*\{\s*w:\s*([0-9.]+)/),
    h: num('manifest.ts', /CELL\s*=\s*\{[^}]*\bh:\s*([0-9.]+)/),
  };
  const bodyH = num('manifest.ts', /BODY_H\s*=\s*([0-9.]+)/);
  const scales = [...src('manifest.ts').matchAll(/\bscale:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(scales.length > 0, 'premise: at least one sheet declares a scale');
  const maxScale = Math.max(1, ...scales);

  // Feet to the top of the tallest hair: the figure fills `CH_H`, times the
  // largest per-sheet render scale.
  const tall = CH_H * maxScale;
  // A cell rendered so the FIGURE lands on `CH_H`, times the fraction of the
  // cell's width the drawing actually fills (~87%, the margin the sheets were
  // authored with).
  const wide = ((CH_H * cell.h) / bodyH) * maxScale * (cell.w / cell.h) * 0.87;

  // ⚠ ROUNDED UP, NEVER DOWN, and asserted in that direction. An over-estimate
  // keeps somebody a couple of units further from a wall than they need to be;
  // an under-estimate puts their shoulder inside it.
  assert.ok(BODY_TALL >= tall, `BODY_TALL ${BODY_TALL} is under the measured ${tall.toFixed(1)}`);
  assert.ok(BODY_TALL - tall <= 6, `BODY_TALL ${BODY_TALL} has drifted above ${tall.toFixed(1)}`);
  assert.ok(
    BODY_HALF_W >= wide / 2,
    `BODY_HALF_W ${BODY_HALF_W} is under the measured ${(wide / 2).toFixed(1)}`,
  );
  assert.ok(BODY_HALF_W - wide / 2 <= 8, `BODY_HALF_W ${BODY_HALF_W} has drifted above ${(wide / 2).toFixed(1)}`);
});

// ───────────────────────────────────────────────────────────────── placeOf

test('placeOf: a file operation names the room the path is in', () => {
  assert.deepEqual(placeOf({ name: 'Read', input: { file_path: 'library/text/a.md' } }), { at: 'library' });
  assert.deepEqual(placeOf({ name: 'Write', input: { file_path: 'artifacts/P-1/T-01/x.md' } }), { at: 'artifacts' });
  assert.deepEqual(placeOf({ name: 'Edit', input: { file_path: 'knowledge/shared/n.md' } }), { at: 'knowledge' });
  // Anywhere else in the office is a REAL answer, not a shrug: they work from
  // where they stand rather than walking to a station nobody observed.
  assert.deepEqual(placeOf({ name: 'Read', input: { file_path: 'office.yaml' } }), { at: 'desk' });
});

test('placeOf: an absolute path in `pattern` is NOT the library — the 08/24 trap, one level down', () => {
  // `describeCall` already had to learn this: the model often puts an absolute
  // path in `pattern` and leaves `path` empty. Outside the office is not a
  // station, so nobody walks anywhere.
  assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: 'D:/library/*' } }), { at: 'desk' });
  assert.deepEqual(placeOf({ name: 'Grep', input: { pattern: 'x', path: '/home/me/library' } }), { at: 'desk' });
  // A relative path still names its room.
  assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: '*.md', path: 'library/text' } }), { at: 'library' });
});

test('placeOf: the shell is matched by CAPABILITY, not by the name `Bash`', () => {
  // `PowerShell` on Windows, `Bash` on POSIX — the same tool wearing two display
  // names. Matching one name means the room goes blind on one operating system,
  // which is the failure class this repo has already paid for five times.
  assert.deepEqual(placeOf({ name: 'Bash', input: { command: 'ls' } }), { at: 'shell' });
  assert.deepEqual(placeOf({ name: 'PowerShell', input: { command: 'ls' } }), { at: 'shell' });
});

test('placeOf: web tools are their own place, and an arm names WHICH arm', () => {
  assert.deepEqual(placeOf({ name: 'WebSearch', input: {} }), { at: 'web' });
  assert.deepEqual(placeOf({ name: 'WebFetch', input: { url: 'https://x' } }), { at: 'web' });
  assert.deepEqual(placeOf({ name: 'mcp__notion__create_page', input: {} }), { at: 'arm', arm: 'notion' });
});

test('🔴 placeOf: an UNKNOWN tool has NO place, and that is an answer', () => {
  // A tool nobody classified must produce no movement at all. Substituting a
  // default here turns "we did not observe a place" into "they went to the
  // desk" — the display stating something that never happened.
  assert.equal(placeOf({ name: 'TodoWrite', input: {} }), undefined);
  assert.equal(placeOf({ name: 'SomeFutureBuiltin', input: {} }), undefined);
});

test('🔴 placeOf and describeCall never disagree about the room', () => {
  // They read ONE set of regexes (`roomKindOf`). Two copies would drift on the
  // day somebody adds a fourth store, and they would drift silently: the
  // sentence would say one room while a character walked to another.
  const cases: Array<[string, string]> = [
    ['library/text/a.md', 'library'],
    ['artifacts/P/T/x.md', 'artifacts'],
    ['knowledge/shared/n.md', 'knowledge'],
    ['whatever.txt', 'desk'],
  ];
  for (const [path, at] of cases) {
    assert.deepEqual(placeOf({ name: 'Glob', input: { pattern: '*', path } }), { at });
    // The sentence must be non-empty for the same call — one read, two halves.
    assert.ok(describeCall({ name: 'Glob', input: { pattern: '*', path } }).length > 0);
  }
});

// ───────────────────────────────────────────────────────────────────── cast

test('castOf: stable, in range, and never shifted by anybody else', () => {
  for (let i = 0; i < 200; i++) {
    const n = castOf('office-a', `agent:r${i}`);
    assert.ok(Number.isInteger(n) && n >= 0 && n < CAST_COUNT, `out of range: ${n}`);
    assert.equal(n, castOf('office-a', `agent:r${i}`), 'must be deterministic');
  }
  // Hiring or firing must not restyle anybody already standing there — the same
  // property `agentHue` buys by hashing rather than storing.
  assert.equal(castOf('office-a', 'agent:writer'), castOf('office-a', 'agent:writer'));
});

test('castOf: two offices do not line up character-for-character', () => {
  const a = Array.from({ length: 12 }, (_, i) => castOf('office-a', `agent:r${i}`));
  const b = Array.from({ length: 12 }, (_, i) => castOf('office-b', `agent:r${i}`));
  assert.notDeepEqual(a, b, 'the office id has to be part of the seed');
});

test('CAST ids are their own index — the array order IS stored data', () => {
  // Reordering this array renames everybody in every office that ever picked a
  // character by hand. Append only.
  CAST.forEach((m, i) => assert.equal(m.id, i));
});

test('isCastId: refuses anything that does not name a character that exists', () => {
  assert.equal(isCastId(0), true);
  assert.equal(isCastId(CAST_COUNT - 1), true);
  assert.equal(isCastId(CAST_COUNT), false);
  assert.equal(isCastId(-1), false);
  assert.equal(isCastId(1.5), false);
  assert.equal(isCastId('2'), false);
  assert.equal(isCastId(null), false);
  assert.equal(isCastId(undefined), false);
});

// ──────────────────────────────────────────────────────── dealing the faces

const people = (n: number): string[] => Array.from({ length: n }, (_, i) => `agent:r${i}`);
const faces = (m: Record<string, number>): number[] => Object.values(m).map((c) => c % FACE_COUNT);

test('🔴 NO TWO ALIKE WHILE A FACE IS STILL FREE — the twins the user saw', () => {
  // A pure hash gave five employees a 3.8% chance of coming out all different
  // (`5!/5⁵`), and the room showed two identical people with three faces unused.
  // Every office size up to the basket must now be collision-free.
  for (let n = 1; n <= FACE_COUNT; n++) {
    for (const office of ['office-a', 'office-b', 'office-zzz']) {
      const got = faces(assignCast(office, people(n)));
      assert.equal(new Set(got).size, n, `${office} with ${n} people: ${got.join(',')}`);
    }
  }
});

test('🔴 the count is over DRAWINGS, not over `CAST` rows', () => {
  // `CAST` is ten rows and there are five strips, so character 2 and character 7
  // are the same picture. A deal that spread ten distinct cast ids would look
  // exactly as wrong as the hash did, and would pass any test that only checked
  // the ids were different.
  assert.ok(FACE_COUNT < CAST_COUNT, 'this test is meaningless if they are equal');
  const got = Object.values(assignCast('office-a', people(FACE_COUNT)));
  assert.equal(new Set(got.map((c) => c % FACE_COUNT)).size, FACE_COUNT);
});

test('past the basket it REFILLS — the sixth starts a fresh round', () => {
  // Not "everybody after five gets face 4". Eleven people over five faces must
  // come out 3/2/2/2/2, never 2/2/2/2/3 with a pile on the last one.
  const got = faces(assignCast('office-a', people(11)));
  const tally = new Map<number, number>();
  for (const f of got) tally.set(f, (tally.get(f) ?? 0) + 1);
  assert.equal(tally.size, FACE_COUNT);
  assert.equal(Math.max(...tally.values()) - Math.min(...tally.values()), 1);
});

test('🔴 a HAND-PICKED face takes its seat first, and is never overwritten', () => {
  // The one door the user controls must not be the door the twin comes back
  // through: if a pick were dealt around instead of reserved, somebody could be
  // handed the face the user had just claimed for someone else.
  const out = assignCast('office-a', people(FACE_COUNT), { 'agent:r0': 3, 'agent:r1': 1 });
  assert.equal(out['agent:r0'], 3);
  assert.equal(out['agent:r1'], 1);
  assert.equal(new Set(faces(out)).size, FACE_COUNT, 'the rest fill the gaps');
});

test('🔴 ONE PICK MUST MOVE ONE PERSON — and a sparse payload moves up to six', () => {
  /**
   * The user's report, 07/09: *"I change one person's character and the whole
   * break area moves. I expected only that character to change."*
   *
   * MEASURED, an office of 12 on 5 faces, ONE hand pick sent as `{stored ∪ pick}`:
   * up to **6 of the other 11** came out on a different face. A reserved face is
   * seated before the rest are dealt, so reserving one cascades through everybody
   * the probe walks past — and a different face is a different per-sheet `scale`
   * and a different `sitLift`, so a SEATED figure visibly jumps.
   *
   * ⇒ `setCharacter` freezes the RESOLVED cast and changes one entry in it. This
   * test is the invariant that makes that work, and the premise below is what
   * makes it worth having.
   */
  const ids = ['assistant', ...people(11)];
  const resolved = assignCast('office-a', ids);

  // The premise: a SPARSE payload really does drag other people around.
  let dragged = 0;
  for (const who of ids) {
    const sparse = assignCast('office-a', ids, { [who]: (resolved[who]! + 2) % FACE_COUNT });
    dragged = Math.max(dragged, ids.filter((i) => i !== who && resolved[i] !== sparse[i]).length);
  }
  assert.ok(dragged >= 3, `premise: a sparse pick only moved ${dragged} others — nothing to fix`);

  // The invariant: hand the whole resolved map back with one entry changed, and
  // NOBODY else moves. Every office, every person, every target face.
  for (const office of ['office-a', 'office-b', 'office-zzz']) {
    const base = assignCast(office, ids);
    for (const who of ids) {
      for (let face = 0; face < FACE_COUNT; face++) {
        const frozen = { ...base, [who]: face };
        const after = assignCast(office, ids, frozen);
        assert.deepEqual(after, frozen, `${office}: picking ${face} for ${who} moved somebody else`);
      }
    }
  }
});

test('a frozen cast survives a HIRE — the newcomer takes what is free', () => {
  // The other half of "nobody moves unless I move them": once an office is
  // dressed, adding somebody must not restyle the people already in the room.
  const ids = ['assistant', ...people(7)];
  const frozen = assignCast('office-a', ids);
  const after = assignCast('office-a', [...ids, 'agent:new'], frozen);
  for (const id of ids) assert.equal(after[id], frozen[id], `${id} was restyled by a hire`);
  assert.ok(after['agent:new'] !== undefined);
});

test('a stored pick outside the drawings is honoured but still counted once', () => {
  // `layout.cast` legitimately holds 0…9 — `CAST` is append-only and a user may
  // have picked 7 before there were five strips. It draws as face 2, so it must
  // occupy face 2 in the deal rather than letting somebody else have it too.
  const out = assignCast('office-a', people(FACE_COUNT), { 'agent:r0': 7 });
  assert.equal(out['agent:r0'], 7, 'the stored value survives verbatim');
  assert.equal(new Set(faces(out)).size, FACE_COUNT);
});

test('the deal does not depend on the ORDER the caller holds its nodes in', () => {
  // `layout.nodes` is rewritten wholesale by the browser on every canvas drag,
  // so its order is not something a rule may be built on.
  const ids = people(FACE_COUNT);
  const forward = assignCast('office-a', ids);
  const backward = assignCast('office-a', [...ids].reverse());
  assert.deepEqual(forward, backward);
});

test('the assistant is dealt from the same basket as everybody else', () => {
  // It is a face on screen. Leaving it out is how the assistant ends up wearing
  // the same shirt as an employee standing four metres away.
  const out = assignCast('office-a', ['assistant', ...people(FACE_COUNT - 1)]);
  assert.equal(new Set(faces(out)).size, FACE_COUNT);
});

// ──────────────────────────────────────────────────────── the garment tint

test('🔴 NOBODY IS TINTED UNTIL TWO PEOPLE SHARE A FACE', () => {
  // The colour exists to separate two employees who look alike. Painting the
  // first five as well would be five compositing passes a frame buying nothing —
  // and it would take away the artwork's own colour, which is the one everybody
  // is designed in.
  for (let n = 1; n <= FACE_COUNT; n++) {
    assert.deepEqual(assignTints(assignCast('office-a', people(n))), {}, `${n} people`);
  }
});

test('🔴 the SIXTH person gets a colour, and the first five still do not', () => {
  const faceMap = assignCast('office-a', people(FACE_COUNT + 1));
  const out = assignTints(faceMap);
  assert.equal(Object.keys(out).length, 1, 'exactly one person is the second on a face');
  const [id, hex] = Object.entries(out)[0]!;
  assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.ok(GARMENT_TINTS.includes(hex), 'an auto colour comes from the palette');
  // And it is the LATER of the two on that face, in sorted order — the person
  // who was already there keeps the drawing they were made in.
  const twins = Object.keys(faceMap).filter((k) => faceMap[k] === faceMap[id]);
  assert.equal(twins.sort()[1], id);
});

test('🔴 TWO PEOPLE ON ONE FACE NEVER SHARE A COLOUR — the twins bug, one layer down', () => {
  // Measured in the live room on 07/09 BEFORE this was dealt from a basket: two
  // of seven tinted people came out `#5c6b3f`. A plain `hash % 10` collides at
  // exactly the rate the birthday problem says, and a collision here is two
  // employees who look alike AND wear the same colour — the precise state the
  // colour exists to prevent.
  for (const office of ['office-a', 'office-b', 'office-zzz']) {
    for (let n = 1; n <= 30; n++) {
      const faceMap = assignCast(office, people(n));
      const tints = assignTints(faceMap);
      const perFace = new Map<number, string[]>();
      for (const [id, hex] of Object.entries(tints)) {
        const f = faceMap[id]! % FACE_COUNT;
        perFace.set(f, [...(perFace.get(f) ?? []), hex]);
      }
      for (const [f, list] of perFace) {
        assert.equal(new Set(list).size, list.length, `${office}/${n}: face ${f} has ${list.join(',')}`);
      }
    }
  }
});

// ───────────────────────────────── who KEEPS the colour they were drawn in

/**
 * 🔴 THE ORDER INSIDE A FACE GROUP — the user's report, 07/09. → §17k″
 *
 * `agent:…` versus `assistant`: `'g' < 's'`, so a worker sorted first in EVERY
 * clash and the assistant was the one put in a costume, every single time. The
 * user found it the obvious way and named it exactly: *"I pick a character for
 * employee 5, it happens to be the assistant's, and now the ASSISTANT is not in
 * its own colour — that makes no sense."*
 */
const ANCHOR = { anchor: 'assistant' };

test('🔴 the ASSISTANT never loses its own colour to a worker', () => {
  // The one figure the room is drawn around and the one the user must never have
  // to hunt for (§17d) — and by plain id order it was the guaranteed loser.
  let clashed = false;
  for (const office of ['office-a', 'office-b', 'office-zzz']) {
    for (let n = FACE_COUNT; n <= 24; n++) {
      const faceMap = assignCast(office, ['assistant', ...people(n)]);
      const face = faceMap['assistant']! % FACE_COUNT;
      // ⚠ The premise, asserted rather than assumed: a gate that never meets the
      // case it guards is a gate nobody knows is running.
      if (Object.entries(faceMap).some(([id, f]) => id !== 'assistant' && f % FACE_COUNT === face)) {
        clashed = true;
      }
      assert.equal(
        assignTints(faceMap, {}, ANCHOR)['assistant'],
        undefined,
        `${office} with ${n} workers tinted the assistant`,
      );
    }
  }
  assert.ok(clashed, 'premise: the assistant never actually shared a face — the test proved nothing');
});

test('🔴 a HAND-PICKED face dresses the PICKER, not the person already wearing it', () => {
  // The general rule the assistant case is a special case of: a change lands on
  // whoever caused it. Somebody who has been on screen for an hour must not
  // change colour because a colleague chose their look.
  const faces = { 'agent:early': 2, 'agent:picker': 2 };
  const out = assignTints(faces, {}, { picked: { 'agent:picker': 2 } });
  assert.equal(out['agent:early'], undefined, 'the incumbent was recoloured');
  assert.ok(out['agent:picker'], 'the picker should be the one tinted');

  // ⚠ Without the hint it is plain id order, and `early` < `picker` — so this
  // pair would have come out the same way by luck. Reversed names prove the rule
  // is the PICK and not the alphabet.
  const flipped = { 'agent:zzz': 2, 'agent:aaa': 2 };
  const out2 = assignTints(flipped, {}, { picked: { 'agent:aaa': 2 } });
  assert.equal(out2['agent:zzz'], undefined);
  assert.ok(out2['agent:aaa']);
});

test('a stored pick of 7 IS a pick of face 2 — the picker still yields', () => {
  // `layout.cast` legitimately holds 0…9 while there are five drawings, so
  // reading the value raw would let the picker quietly keep the original.
  const out = assignTints({ 'agent:a': 2, 'agent:b': 2 }, {}, { picked: { 'agent:a': 7 } });
  assert.equal(out['agent:b'], undefined, 'the non-picker keeps the original');
  assert.ok(out['agent:a']);
});

test('the anchor outranks a pick, and two pickers fall back to id order', () => {
  // Stated because both are decisions, not accidents. The assistant keeps its
  // colour even when the clash came from its own picker; and when everybody in
  // the group asked for the face there is no "cause" left to land on.
  const both = assignTints({ assistant: 1, 'agent:a': 1 }, {}, { ...ANCHOR, picked: { assistant: 1 } });
  assert.equal(both['assistant'], undefined);
  assert.ok(both['agent:a']);

  const tie = assignTints({ 'agent:a': 3, 'agent:b': 3 }, {}, { picked: { 'agent:a': 3, 'agent:b': 3 } });
  assert.equal(tie['agent:a'], undefined);
  assert.ok(tie['agent:b']);
});

test('two people on DIFFERENT faces may share a colour — that is not a clash', () => {
  // The colour is not an identifier. It separates people who look alike; two
  // people who already look nothing alike do not need it to differ, and forcing
  // that would run the palette out at eleven employees for no gain.
  let shared = false;
  for (let n = 6; n <= 40 && !shared; n++) {
    const seen = new Set(Object.values(assignTints(assignCast('office-a', people(n)))));
    if (seen.size < Object.keys(assignTints(assignCast('office-a', people(n)))).length) shared = true;
  }
  assert.ok(shared, 'no two people anywhere shared a colour — the rule is stricter than intended');
});

test('assignTints is STABLE — it does not re-roll on every read', () => {
  // A random pick would make the room flicker through colours while nothing
  // about the office changed. `canvas()` runs on every SSE event.
  const faceMap = assignCast('office-a', people(9));
  const a = assignTints(faceMap);
  for (let i = 0; i < 20; i++) assert.deepEqual(assignTints(faceMap), a);
});

test('a hand-picked colour wins, even for somebody who would not be tinted', () => {
  // The auto rule answers "two people look alike"; a person choosing a colour is
  // answering something else, and the choice must not be overruled by a count.
  const faceMap = assignCast('office-a', people(2));
  const out = assignTints(faceMap, { 'agent:r0': '#123456' });
  assert.equal(out['agent:r0'], '#123456');
  assert.equal(out['agent:r1'], undefined, 'the other one is still untinted');
});

test('a junk stored colour is dropped, never forwarded to the stylesheet', () => {
  // This is the gate a client-supplied string passes on its way to becoming a
  // CSS colour. Anything that is not `#rrggbb` must not reach the page.
  for (const junk of ['red', '#12345', 'url(x)', '#gggggg', 42, null, '#123456;background:red']) {
    const out = assignTints(assignCast('office-a', people(2)), {
      'agent:r0': junk as unknown as string,
    });
    assert.equal(out['agent:r0'], undefined, `${String(junk)} survived`);
  }
});

test('the deal of colours does not depend on the ORDER of the map', () => {
  const ids = people(8);
  const forward = assignCast('office-a', ids);
  const backward = Object.fromEntries(Object.entries(forward).reverse());
  assert.deepEqual(assignTints(backward), assignTints(forward));
});

test('readTint / pruneTint: the same two gates the cast has, on the same events', () => {
  assert.deepEqual(readTint({ 'agent:a': '#b4532a', 'agent:b': 'red', '../x': '#000000' }), {
    'agent:a': '#b4532a',
  });
  assert.deepEqual(readTint('nope'), {});
  // ⚠ THE PRUNE IS WHY DELETING SOMEBODY DOES NOT DRESS THEIR REPLACEMENT. Delete
  // an employee for good, create one with the same name, and the node id is
  // identical — a surviving entry would hand over the dead one's colour.
  assert.deepEqual(pruneTint({ 'agent:a': '#b4532a', 'agent:gone': '#000000' }, ['agent:a']), {
    'agent:a': '#b4532a',
  });
});

test('every palette colour is MID-LIGHTNESS, or the picker offers colours that do nothing', () => {
  // `mix-blend-mode: color` keeps the artwork's luminance and takes only hue and
  // saturation from the tint, so a near-black or near-white entry is a swatch
  // that visibly changes nothing. This is a property of the LIST, so it is
  // checkable — unlike the same sentence written as a comment.
  for (const hex of GARMENT_TINTS) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lum = 0.299 * r! + 0.587 * g! + 0.114 * b!;
    assert.ok(lum > 60 && lum < 190, `${hex} sits at luminance ${Math.round(lum)}`);
  }
});

// ─────────────────────────────────────────────────────────── stored choices

test('readCast: a hand-edited or outdated character falls back rather than blanking', () => {
  const out = readCast({ assistant: 3, 'agent:a': 99, 'agent:b': -1, 'agent:c': 'x', 'agent:d': 2 });
  assert.deepEqual(out, { assistant: 3, 'agent:d': 2 });
});

test('readCast: refuses a key that is not shaped like a node id', () => {
  const out = readCast({ '../../etc': 1, 'agent:ok': 2, 'AGENT:Bad': 3, __proto__: 4 });
  assert.deepEqual(Object.keys(out), ['agent:ok']);
});

test('readCast: junk of the wrong shape is empty, never a crash', () => {
  assert.deepEqual(readCast(undefined), {});
  assert.deepEqual(readCast(null), {});
  assert.deepEqual(readCast([1, 2]), {});
  assert.deepEqual(readCast('nope'), {});
});

test('🔴 pruneCast: a deleted person does NOT dress the next person with their name', () => {
  // Delete an employee for good, create a new one with the same name, and the
  // node id is identical (`agent:<slug>`). A surviving entry would put the dead
  // person's costume on the new one — the same shape as an office id that comes
  // back and inherits a dead office's ledger.
  const before = { assistant: 1, 'agent:writer': 7, 'agent:reviewer': 4 };
  const after = pruneCast(before, ['assistant', 'agent:reviewer']);
  assert.deepEqual(after, { assistant: 1, 'agent:reviewer': 4 });
});

test('pruneCast: the survivors keep exactly what they had', () => {
  const kept = pruneCast({ assistant: 5 }, ['assistant', 'agent:a', 'library']);
  assert.deepEqual(kept, { assistant: 5 });
});
