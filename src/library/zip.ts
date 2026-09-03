/**
 * Reading ZIP — just enough to extract `.docx` / `.xlsx` / `.pptx`.
 *
 * → docs/SPEC-library.md §4
 *
 * WHY HAND-WRITTEN rather than one more library: all three Office formats are
 * ZIP containers holding XML, and the only ZIP we need is "find an entry by
 * name, inflate that entry". `node:zlib` already ships `inflateRawSync`. What we
 * get back is ~150 readable lines, testable under `node --test`, and NOT ONE
 * MORE DEPENDENCY on a project that currently has three.
 *
 * (`.pdf` is the opposite — compressed content streams plus CID fonts are not
 * something to hand-write, and spec §15 says outright that it requires a real
 * library.)
 *
 * DELIBERATELY inflates only the entry that was ASKED FOR BY NAME. A 90KB .docx
 * can hold dozens of embedded images; inflating them all to throw them away is
 * paying for work nobody asked for.
 */

import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Inflation ceiling for ONE entry — the zip-bomb guard. XML compresses
 * enormously well (a 50KB entry inflating to 10MB is ordinary), so a ratio
 * cannot be the check; it has to be an absolute number. 200MB is far more than
 * `word/document.xml` of any document a person actually wrote by hand.
 */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ZipFile {
  names: string[];
  /** Inflate one entry. `undefined` when it is not there; throws when it is corrupt. */
  read(name: string): Buffer | undefined;
}

export function openZip(buf: Buffer): ZipFile {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('could not read the ZIP structure (no end-of-central-directory record)');

  const centralOffset = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);

  /**
   * ZIP64: above 4GB or 65535 entries, both fields above are set to all-ones and
   * the real numbers live in a separate record. We do not read ZIP64 — but we
   * SAY SO, rather than reading a meaningless offset and throwing an error
   * nobody can interpret.
   */
  if (centralOffset === 0xffffffff || count === 0xffff) {
    throw new Error('ZIP64 archive — too large to read');
  }
  if (centralOffset >= buf.length) throw new Error('corrupt ZIP structure');

  const entries = new Map<string, ZipEntry>();
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: [...entries.keys()],
    read(name: string): Buffer | undefined {
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`ZIP entry "${name}" is too large`);
      }

      /**
       * The name and extra lengths in the LOCAL header can DIFFER from the
       * central directory — the single most common mistake when reading ZIP by
       * hand. They have to be re-read from the local header; the `nameLen` and
       * `extraLen` above must not be reused.
       */
      const lo = e.localOffset;
      if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) {
        throw new Error(`ZIP entry "${name}" is corrupt`);
      }
      const nameLen = buf.readUInt16LE(lo + 26);
      const extraLen = buf.readUInt16LE(lo + 28);
      const start = lo + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compressedSize);

      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      throw new Error(`ZIP entry "${name}" uses an unsupported compression method (${e.method})`);
    },
  };
}

/**
 * Find the end-of-central-directory record, scanning BACKWARDS from the end.
 *
 * Jumping straight to `length - 22` does not work: ZIP allows a comment of up to
 * 65535 bytes after that record, and plenty of tools write a real one.
 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}
