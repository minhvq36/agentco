
/**
 * Which chat line is a FILE LINK, and which is just a sentence about a file.
 * → `web/src/lib/file-line.ts` · `ChatPanel §FileLinks`
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ Reported 09/09: a whole paragraph rendered as one monospace button, and
 * │ only SOMETIMES — exactly when the assistant happened to end its sentence
 * │ on the artifact path. The match was `line.trim().endsWith(f)`, and the
 * │ model's own report ends with that very suffix.
 * └──────────────────────────────────────────────────────────────────────────
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fileLineHit } from '../web/src/lib/file-line.ts';

/** What `whereBlock` really prints, and what `files` really carries. */
const REL = 'artifacts/P-260909-0124-70qf/T-01/tom-tat-readme-test.md';
const PRINTED = `  company/offices/arms/${REL}`;
const FILES = [REL];

test('🔴 the line the CODE printed is a link', () => {
  assert.equal(fileLineHit(PRINTED, FILES), REL);
});

test('🔴 a SENTENCE ending on the same path is NOT a link — the reported bug', () => {
  const prose = `README của repo test rất sơ sài. Chi tiết đã lưu tại: ${REL}`; // i18n-allow-vietnamese: fixture — the assistant's real report line
  assert.equal(
    fileLineHit(prose, FILES),
    undefined,
    'the whole paragraph becomes one monospace button again',
  );
});

test('🔴 the second reported shape — a source, then the path', () => {
  const other = 'artifacts/P-260909-0126-mxaj/T-01/bang-gia-notion.md';
  const prose = `Nguồn: notion.com/pricing. Chi tiết đầy đủ đã lưu tại: ${other}`; // i18n-allow-vietnamese: fixture — the assistant's real report line
  assert.equal(fileLineHit(prose, [other]), undefined);
});

test('a filename containing SPACES still links — the spaces are inside the path', () => {
  const f = 'artifacts/P-1/T-01/bao cao thang 9.md';
  assert.equal(fileLineHit(`  company/offices/x/${f}`, [f]), f);
});

test('the path alone on a line, with no prefix at all, links', () => {
  assert.equal(fileLineHit(`   ${REL}  `, FILES), REL);
});

test('a prefix that is not a directory does not link', () => {
  // No space, but it does not end at a `/` — so it is not a path prefix.
  assert.equal(fileLineHit(`xem:${REL}`, FILES), undefined);
});

test('a line naming a DIFFERENT file does not borrow this one’s link', () => {
  assert.equal(fileLineHit('  company/offices/arms/artifacts/P-1/T-01/other.md', FILES), undefined);
});

test('an empty entry in `files` can never match', () => {
  // A stray '' would otherwise match every line — every sentence a button.
  assert.equal(fileLineHit('just a sentence', ['']), undefined);
});
