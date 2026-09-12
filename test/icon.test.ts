import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/**
 * 🔴 THE ICON, READ BACK OFF DISK. → `scripts/icon.ts` · docs/SPEC-packaging.md §9
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ The .ico is generated, so the thing worth guarding is not the generator's
 * │ source — it is the FILE, because every failure here is silent and visual:
 * │
 * │  · a white margin left in ⇒ the mark floats in a pale box on the dark
 * │    taskbar, which is exactly what the user asked to be cut off
 * │  · a missing size ⇒ Windows scales a neighbour and the small icon turns
 * │    to mush, on the surface people see most
 * │  · a broken header ⇒ the shell falls back to a generic icon and nobody
 * │    connects it to a build step
 * │
 * │ None of those fail a build, and none of them are visible from a
 * │ non-interactive session. So they are asserted here instead.
 * └──────────────────────────────────────────────────────────────────────────
 */

const ROOT = url.fileURLToPath(new URL('..', import.meta.url));
const ICO = path.join(ROOT, 'installer', 'agentco.ico');

interface Entry {
  size: number;
  bpp: number;
  bytes: number;
  offset: number;
}

function directory(): Entry[] {
  const b = fs.readFileSync(ICO);
  assert.equal(b.readUInt16LE(0), 0, 'premise: not an icon file (reserved word)');
  assert.equal(b.readUInt16LE(2), 1, 'premise: type is not 1 = icon');
  const n = b.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const at = 6 + i * 16;
    return {
      // 0 in the byte means 256 — the field cannot hold the number itself.
      size: b[at] === 0 ? 256 : b[at]!,
      bpp: b.readUInt16LE(at + 6),
      bytes: b.readUInt32LE(at + 8),
      offset: b.readUInt32LE(at + 12),
    };
  });
}

test('🔴 every size Windows asks for is present, at 32 bits', () => {
  const got = directory();
  assert.deepEqual(
    got.map((e) => e.size).sort((a, b) => a - b),
    [16, 32, 48, 256],
    'a size is missing — Windows will scale a neighbour and it will look like mush',
  );
  for (const e of got) assert.equal(e.bpp, 32, `${e.size}px is not 32-bit, so it has no alpha`);
});

test('🔴 each entry is exactly as long as its own pixels claim', () => {
  // A wrong length is the failure that makes the shell fall back to a generic
  // icon — no error anywhere, just the wrong picture.
  const b = fs.readFileSync(ICO);
  for (const e of directory()) {
    const maskRow = Math.ceil(e.size / 32) * 4;
    const expected = 40 + e.size * e.size * 4 + maskRow * e.size;
    assert.equal(e.bytes, expected, `${e.size}px entry is ${e.bytes} bytes, expected ${expected}`);
    assert.ok(e.offset + e.bytes <= b.length, `${e.size}px entry runs past the end of the file`);
    // ⚠ The height field must be DOUBLE the width: the format describes the
    // colour rows and the AND mask as one image. Get it right and nothing
    // happens; get it wrong and the icon renders as its own top half.
    assert.equal(b.readInt32LE(e.offset + 4), e.size, `${e.size}px header width`);
    assert.equal(b.readInt32LE(e.offset + 8), e.size * 2, `${e.size}px header height must be doubled`);
  }
});

test('🔴 THE WHITE BORDER IS GONE — no opaque near-white pixel on any edge', () => {
  /**
   * The user's note on the supplied artwork: careful, it has a white border —
   * cut it off. Measured on the source: 1254px in, 755px out, 499px of margin.
   *
   * This checks the RESULT rather than the crop logic, because what matters is
   * the file the shell loads. A margin that survives puts the mark in a pale
   * box on every dark surface it lands on.
   */
  const b = fs.readFileSync(ICO);
  for (const e of directory()) {
    const px = e.offset + 40;
    const at = (x: number, y: number): { r: number; g: number; bl: number; a: number } => {
      const row = e.size - 1 - y; // BMP rows are stored bottom-up
      const i = px + (row * e.size + x) * 4;
      return { bl: b[i]!, g: b[i + 1]!, r: b[i + 2]!, a: b[i + 3]! };
    };
    let white = 0;
    for (let i = 0; i < e.size; i++) {
      for (const p of [at(i, 0), at(i, e.size - 1), at(0, i), at(e.size - 1, i)]) {
        if (p.a > 200 && p.r > 240 && p.g > 240 && p.bl > 240) white++;
      }
    }
    assert.equal(white, 0, `${e.size}px still has ${white} opaque near-white edge pixels`);
  }
});

test('🔴 the mark actually fills the tile — the crop did not overshoot into padding', () => {
  /**
   * The opposite failure, and it is just as silent: crop too little and the
   * artwork sits small inside a transparent frame, so the icon looks shrunken
   * beside every other icon on the taskbar. At least one pixel on each edge of
   * the 32px render has to belong to the artwork.
   */
  const b = fs.readFileSync(ICO);
  const e = directory().find((x) => x.size === 32)!;
  const px = e.offset + 40;
  const alpha = (x: number, y: number): number => b[px + ((e.size - 1 - y) * e.size + x) * 4 + 3]!;
  const edgeHasInk = (pts: Array<[number, number]>): boolean => pts.some(([x, y]) => alpha(x, y) > 32);
  const n = e.size;
  const idx = Array.from({ length: n }, (_, i) => i);
  assert.ok(edgeHasInk(idx.map((i) => [i, 0] as [number, number])), 'nothing on the top edge');
  assert.ok(edgeHasInk(idx.map((i) => [i, n - 1] as [number, number])), 'nothing on the bottom edge');
  assert.ok(edgeHasInk(idx.map((i) => [0, i] as [number, number])), 'nothing on the left edge');
  assert.ok(edgeHasInk(idx.map((i) => [n - 1, i] as [number, number])), 'nothing on the right edge');
});

test('the source artwork is still beside the generator', () => {
  // `icon.ts` decodes 8-bit RGBA PNG only, and refuses anything else rather
  // than guessing — so a replacement in another format fails loudly at build
  // time. This just checks the file is there to be read at all.
  const png = path.join(ROOT, 'installer', 'logo.png');
  assert.ok(fs.existsSync(png), 'installer/logo.png is missing — the icon cannot be rebuilt');
  assert.equal(
    fs.readFileSync(png).subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    'logo.png is not a PNG',
  );
});
