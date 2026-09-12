
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BUBBLE_MAX, clipBubble } from '../dist/core/office-bubble.js';

/**
 * WHAT FITS IN A SPEECH BUBBLE. → docs/SPEC-office-art.md §12
 *
 * The cap is a number the user stated ("18 characters, the ellipsis included"),
 * and a number stated in a comment is a promise. These are the four ways it can
 * be broken without anything failing to compile.
 */

const len = (s: string): number => Array.from(s).length;

test('🔴 THE ELLIPSIS IS INSIDE THE BUDGET — 18 means 18, marker and all', () => {
  // A cap that appends its marker to the limit is not a cap; it is the limit
  // plus whatever the marker costs. Nothing may ever come out longer than 18.
  const long = 'x'.repeat(200);
  assert.equal(len(clipBubble(long)), BUBBLE_MAX);
  assert.ok(clipBubble(long).endsWith('…'));
  for (let n = 0; n < 60; n++) {
    assert.ok(len(clipBubble('a'.repeat(n))) <= BUBBLE_MAX, `${n} characters overflowed`);
  }
});

test('a message that already fits is returned untouched — no ellipsis, no padding', () => {
  assert.equal(clipBubble('Reading notes.md'), 'Reading notes.md');
  assert.equal(clipBubble('a'.repeat(BUBBLE_MAX)), 'a'.repeat(BUBBLE_MAX));
  // One over is the only interesting boundary, and it is the one an off-by-one
  // lands on: 19 in, 17 plus the marker out.
  assert.equal(len(clipBubble('a'.repeat(BUBBLE_MAX + 1))), BUBBLE_MAX);
});

test('🔴 CODE POINTS, NOT CODE UNITS — the cut never lands inside a character', () => {
  // A tone mark is its own code point in NFD, and `String.slice` will happily
  // leave one behind with nothing to sit on. An emoji is a surrogate pair, and
  // half of one renders as a replacement box.
  //
  // Written as escapes deliberately: this is `e` + U+0301, the DECOMPOSED form,
  // and a source file showing it precomposed would be testing something else.
  const decomposed = 'e\u0301'.repeat(20);
  const out = clipBubble(decomposed);
  assert.equal(len(out), BUBBLE_MAX);
  assert.ok(!out.includes('�'), 'a broken character shows as a replacement box');
  const emoji = '\u{1f310}'.repeat(30);
  assert.equal(len(clipBubble(emoji)), BUBBLE_MAX);
  assert.ok(!clipBubble(emoji).includes('�'));
});

test('🔴 NEWLINES ARE COLLAPSED BEFORE THE CUT, NOT AFTER', () => {
  // The failure this whole rule exists for: a `git status` summary arrived as
  // eighteen LINES of `say` and the bubble covered the window, the whiteboard
  // and half the floor. Capping after the collapse is what stops eighteen
  // characters from still being four lines tall.
  const slab = 'line one\n\nline two\n\tline three';
  assert.equal(clipBubble(slab).includes('\n'), false);
  assert.equal(clipBubble('a\nb'), 'a b');
  assert.equal(clipBubble('   spaced   out   '), 'spaced out');
});

test('the glyph the room prefixes is inside the budget too', () => {
  // `DomScene` composes `"<glyph> <say>"` and clips the WHOLE string, so a place
  // marker eats into the message rather than widening the box past the cap.
  const withGlyph = clipBubble('\u{1f310} searching for a supplier');
  assert.ok(len(withGlyph) <= BUBBLE_MAX);
  assert.ok(withGlyph.startsWith('\u{1f310} '));
  assert.ok(withGlyph.endsWith('…'));
});
