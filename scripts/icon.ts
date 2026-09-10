/**
 * BUILD THE APP ICON from `installer/logo.png`. → docs/SPEC-packaging.md §9
 *
 *   node --experimental-strip-types scripts/icon.ts
 *
 * Writes `installer/agentco.ico` — the icon on the installer, the launcher, the
 * shortcut and the taskbar.
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ WHY IT DECODES A PNG INSTEAD OF DRAWING SHAPES.
 * │
 * │ The first version drew the mark from its own geometry, so no rasteriser was
 * │ needed. The mark was then rejected — it looked too much like Asana — and
 * │ replaced by a real piece of artwork, which cannot be reduced to three
 * │ circles. So this decodes the PNG instead.
 * │
 * │ ⚠ It is still dependency-free: PNG is `zlib` plus five row filters, and
 * │ `node:zlib` is in the standard library. An .ico needs the same picture at
 * │ four sizes, which is a box filter. Neither is worth a build dependency on
 * │ every machine that ever cuts a release.
 * │
 * │ ⚠ NO SVG. Converting artwork with soft gradients and bevels into vectors
 * │ produces something that looks nothing like it — the user's own call, and
 * │ the right one. The PNG is the source of truth.
 * └──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.dirname(url.fileURLToPath(new URL('..', import.meta.url + '/')));
const SRC = path.join(ROOT, 'installer', 'logo.png');
const OUT = path.join(ROOT, 'installer', 'agentco.ico');

/** Sizes Windows asks for: list view, desktop, large icons, and the preview one. */
const SIZES = [16, 32, 48, 256];

interface Image {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel, top-down. */
  px: Buffer;
}

// ────────────────────────────────────────────────────────────── decode PNG

/**
 * A PNG decoder for exactly the shape we ship: 8-bit RGBA, non-interlaced.
 *
 * ⚠ It REFUSES anything else rather than guessing. A palette or 16-bit file
 * would decode to nonsense colours, and an icon that is subtly wrong is worse
 * than a build that stops and says why.
 */
function decodePng(file: string): Image {
  const b = fs.readFileSync(file);
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`);

  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  let off = 8;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.subarray(off + 4, off + 8).toString('ascii');
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8]!, data[9]!, data[10]!, data[11]!, data[12]!];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(`${file}: need 8-bit RGBA non-interlaced, got depth ${depth} colour ${color} interlace ${interlace}`);
      }
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  const stride = w * 4;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    const row = raw.subarray(p, p + stride);
    p += stride;
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4]! : 0;
      const bb = prev ? prev[x]! : 0;
      const c = prev && x >= 4 ? prev[x - 4]! : 0;
      let v = row[x]!;
      // The five PNG row filters, straight out of the spec.
      if (filter === 1) v += a;
      else if (filter === 2) v += bb;
      else if (filter === 3) v += (a + bb) >> 1;
      else if (filter === 4) {
        const pp = a + bb - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - bb);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      } else if (filter !== 0) throw new Error(`unknown PNG row filter ${filter}`);
      out[x] = v & 0xff;
    }
  }
  return { w, h, px };
}

// ─────────────────────────────────────────────────────────────────── crop

/**
 * Trim the empty margin. → the user's note: the artwork has a white border,
 *
 * ⚠ IT TRIMS TRANSPARENT **AND** NEAR-WHITE EDGES. The supplied artwork is
 * transparent around the tile, but a PNG exported from a different tool would
 * be white there instead, and the same margin would then survive — leaving the
 * mark floating in a pale box on every dark surface it lands on.
 *
 * ⚠ AND IT ONLY EVER TRIMS A CONTIGUOUS BORDER. Scanning inwards from each edge
 * cannot bite into the artwork, whatever the artwork contains.
 */
function crop(img: Image): Image {
  const isMargin = (x: number, y: number): boolean => {
    const i = (y * img.w + x) * 4;
    const a = img.px[i + 3]!;
    if (a < 8) return true;
    return img.px[i]! > 247 && img.px[i + 1]! > 247 && img.px[i + 2]! > 247 && a > 247;
  };
  const rowIsMargin = (y: number): boolean => {
    for (let x = 0; x < img.w; x++) if (!isMargin(x, y)) return false;
    return true;
  };
  const colIsMargin = (x: number): boolean => {
    for (let y = 0; y < img.h; y++) if (!isMargin(x, y)) return false;
    return true;
  };

  let top = 0;
  let bottom = img.h - 1;
  let left = 0;
  let right = img.w - 1;
  while (top < bottom && rowIsMargin(top)) top++;
  while (bottom > top && rowIsMargin(bottom)) bottom--;
  while (left < right && colIsMargin(left)) left++;
  while (right > left && colIsMargin(right)) right--;

  /**
   * ⚠ SQUARED OFF, CENTRED. An .ico entry is square; cropping to a non-square
   * box and then scaling to 16×16 would stretch the artwork. Growing the short
   * side back out keeps the proportions and the padding stays symmetrical.
   */
  let w = right - left + 1;
  let h = bottom - top + 1;
  const side = Math.max(w, h);
  left -= Math.floor((side - w) / 2);
  top -= Math.floor((side - h) / 2);
  w = side;
  h = side;

  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = left + x;
      const sy = top + y;
      const d = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue; // stays transparent
      img.px.copy(px, d, (sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4);
    }
  }
  return { w, h, px };
}

// ──────────────────────────────────────────────────────────────── resize

/**
 * Box filter, averaging in PREMULTIPLIED alpha.
 *
 * ⚠ Averaging straight RGBA is the classic way to get a dark halo: a fully
 * transparent pixel still carries some colour, and mixing it in at full weight
 * drags the edge towards it. Weighting each sample by its own alpha is what
 * keeps the edges of the artwork clean at 16px.
 */
function resize(img: Image, size: number): Image {
  const px = Buffer.alloc(size * size * 4);
  const sx = img.w / size;
  const sy = img.h / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < img.h; yy++) {
        for (let xx = x0; xx < x1 && xx < img.w; xx++) {
          const i = (yy * img.w + xx) * 4;
          const al = img.px[i + 3]!;
          r += img.px[i]! * al;
          g += img.px[i + 1]! * al;
          b += img.px[i + 2]! * al;
          a += al;
          n++;
        }
      }
      const d = (y * size + x) * 4;
      if (a > 0) {
        px[d] = Math.round(r / a);
        px[d + 1] = Math.round(g / a);
        px[d + 2] = Math.round(b / a);
      }
      px[d + 3] = Math.round(a / Math.max(1, n));
    }
  }
  return { w: size, h: size, px };
}

// ───────────────────────────────────────────────────────────────── write

/** One ICO entry: BITMAPINFOHEADER with doubled height, BGRA bottom-up, then the AND mask. */
function bmpEntry(img: Image): Buffer {
  const size = img.w;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  // ⚠ HEIGHT IS DOUBLED. The format describes the colour rows and the AND mask
  // as one image; every reader assumes it, and a correct height here renders
  // the icon as its own top half.
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const body = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // ⚠ BOTTOM-UP: a BMP stores its last row first.
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = (row * size + x) * 4;
      body[d] = img.px[s + 2]!;
      body[d + 1] = img.px[s + 1]!;
      body[d + 2] = img.px[s]!;
      body[d + 3] = img.px[s + 3]!;
    }
  }

  // Unused for 32-bit icons (alpha does the work) but required, padded to 4 bytes a row.
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, body, mask]);
}

const source = decodePng(SRC);
const cropped = crop(source);
console.log(`source   ${source.w}×${source.h}`);
console.log(`cropped  ${cropped.w}×${cropped.h}   (margin removed: ${source.w - cropped.w}px)`);

const entries = SIZES.map((s) => ({ size: s, data: bmpEntry(resize(cropped, s)) }));

const dir = Buffer.alloc(6 + entries.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // 1 = icon
dir.writeUInt16LE(entries.length, 4);

let offset = dir.length;
entries.forEach((e, i) => {
  const at = 6 + i * 16;
  // 256 is written as 0 — the field is one byte and 256 does not fit.
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, at);
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
  dir.writeUInt16LE(1, at + 4);
  dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(e.data.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += e.data.length;
});

fs.writeFileSync(OUT, Buffer.concat([dir, ...entries.map((e) => e.data)]));
console.log(`${OUT}  ${SIZES.join(' · ')}px  ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
