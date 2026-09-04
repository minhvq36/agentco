
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { resolveFileRefs } from '../dist/core/commands.js';

const pair = (p: string) => ({ ref: p, open: p });
const KNOWN = [
  pair('library/files/doc-1.md'),
  pair('library/files/doc-2.md'),
  { ref: 'library/files/bao-gia.xlsx', open: 'library/text/bao-gia.xlsx.txt' },
  pair('artifacts/P-260820-0302-ov9e/T-01/doc-1.md'),
  pair('artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md'),
];


test('bare filename DUPLICATE in two libraries → STOP and list, no guessing', () => {
  const r = resolveFileRefs('dịch lại @doc-1.md giúp mình', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.ok(r.problem, 'must stop and ask');
  assert.ok(r.problem.includes('library/files/doc-1.md'));
  assert.ok(r.problem.includes('artifacts/P-260820-0302-ov9e/T-01/doc-1.md'));
  assert.equal(r.text, 'dịch lại @doc-1.md giúp mình', 'original text stays UNCHANGED when there is a problem'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('bare filename expands to an OPENABLE PATH, not the string the user typed', () => {
  const r = resolveFileRefs('xem @bao-gia.xlsx', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'xem library/text/bao-gia.xlsx.txt'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('pasting the FULL PATH from the Copy button must also resolve to an openable path', () => {
  const r = resolveFileRefs('xem @library/files/bao-gia.xlsx', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'xem library/text/bao-gia.xlsx.txt'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('typing the ALREADY-EXTRACTED path directly is also accepted — the assistant\'s listing names exactly this path', () => {
  const r = resolveFileRefs('xem @library/text/bao-gia.xlsx.txt', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'xem library/text/bao-gia.xlsx.txt'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('a document matched through TWO doors is NOT a name collision', () => {
  const r = resolveFileRefs('xem @bao-gia.xlsx', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
});


test('a path that does NOT exist → STOP, never reaches the model', () => {
  const r = resolveFileRefs('đọc @artifacts/khong-ton-tai.md nhé', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.ok(r.problem);
  assert.ok(r.problem.includes('artifacts/khong-ton-tai.md'), 'must state EXACTLY the string they typed');
});

test('a single mistyped character in a full path is also blocked — it does NOT auto-"fix" for you', () => {
  const r = resolveFileRefs('@library/files/doc-9.md', KNOWN);
  assert.ok(r.problem);
});


test('an email address is NOT treated as a file reference', () => {
  const s = 'gửi cho ke-toan@congty.vn nhé'; // i18n-allow-vietnamese: user input fixture
  assert.deepEqual(resolveFileRefs(s, KNOWN), { text: s });
});

test('text without `@` passes straight through, no extra work', () => {
  const s = 'Dịch doc-1.md trong tủ tài liệu sang tiếng Việt.'; // i18n-allow-vietnamese: user input fixture
  assert.deepEqual(resolveFileRefs(s, KNOWN), { text: s });
});


test('an exact full-path match just strips the `@`', () => {
  const r = resolveFileRefs('so @library/files/doc-2.md với bản dịch', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.text, 'so library/files/doc-2.md với bản dịch'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('MULTIPLE references in one sentence — matches what users actually type', () => {
  const r = resolveFileRefs(
    'đối chiếu @library/files/doc-2.md với @artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md', // i18n-allow-vietnamese: user input fixture
    KNOWN,
  );
  assert.equal(r.problem, undefined);
  assert.equal(
    r.text,
    'đối chiếu library/files/doc-2.md với artifacts/P-260820-0440-9a3q/T-01/vi/doc-2-thuat-ngu.md', // i18n-allow-vietnamese: expected value mirrors the input fixture
  );
});

test('ONE broken reference blocks the WHOLE sentence, no half-resolving', () => {
  const r = resolveFileRefs('so @library/files/doc-2.md với @khong-co.md', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.ok(r.problem);
  assert.ok(r.text.includes('@library/files/doc-2.md'), 'original text stays completely unchanged');
});


test('trailing punctuation does NOT break a reference', () => {
  const r = resolveFileRefs('sửa @library/files/doc-1.md, giữ nguyên phần đầu', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'sửa library/files/doc-1.md, giữ nguyên phần đầu'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('`\\` converts to `/` — Windows users copy from file explorer', () => {
  const r = resolveFileRefs('@library\\files\\doc-2.md', KNOWN);
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'library/files/doc-2.md');
});

test('a reference at the START of a sentence is still accepted', () => {
  const r = resolveFileRefs('@library/files/doc-1.md dịch giúp mình', KNOWN); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.text, 'library/files/doc-1.md dịch giúp mình'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('an EMPTY library blocks every reference, without crashing', () => {
  const r = resolveFileRefs('@doc-1.md', []);
  assert.ok(r.problem);
});


const MIX = {
  ref: 'library/files/Mix, Mingle&Meet.pptx',
  open: 'library/text/Mix, Mingle&Meet.pptx.txt',
};
const SPACED = [...KNOWN, MIX, pair('library/files/anh'), pair('library/files/bao-cao.md')];

test('🔴 a full path WITH SPACES — exactly the string the Copy button produces', () => {
  const r = resolveFileRefs(`tóm tắt nội dung file @${MIX.ref}`, SPACED); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined, 'must not report "not found"');
  assert.equal(r.text, `tóm tắt nội dung file ${MIX.open}`); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('🔴 bare filename with spaces, plus trailing text', () => {
  const r = resolveFileRefs('@Mix, Mingle&Meet.pptx tóm tắt giúp mình', SPACED); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, `${MIX.open} tóm tắt giúp mình`); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('🔴 punctuation AFTER a name with spaces still belongs to the sentence, not the filename', () => {
  const r = resolveFileRefs(`đọc @${MIX.ref}, rồi tóm tắt`, SPACED); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, `đọc ${MIX.open}, rồi tóm tắt`); // i18n-allow-vietnamese: expected value mirrors the input fixture
});

test('prefix matching must NOT swallow lowercase text — a document literally named `anh` exists', () => {
  const r = resolveFileRefs('@anh-khong-co.md xem giúp', SPACED); // i18n-allow-vietnamese: user input fixture
  assert.ok(r.problem, 'must block because of "anh-khong-co.md", must NOT expand into "anh"');
  assert.ok(r.problem.includes('anh-khong-co.md'));
});

test('when prefixes collide, take the LONGEST string', () => {
  const known = [...SPACED, pair('library/files/bao-cao.md.bak')];
  const r = resolveFileRefs('@library/files/bao-cao.md.bak', known);
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'library/files/bao-cao.md.bak');
});

test('the SAME reference typed twice gets replaced BOTH times', () => {
  const r = resolveFileRefs('@library/files/doc-1.md và @library/files/doc-1.md', SPACED); // i18n-allow-vietnamese: user input fixture
  assert.equal(r.problem, undefined);
  assert.equal(r.text, 'library/files/doc-1.md và library/files/doc-1.md'); // i18n-allow-vietnamese: expected value mirrors the input fixture
});
