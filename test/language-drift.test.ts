/**
 * THE HARNESS INJECTS THE MACHINE OWNER'S EMAIL INTO EVERY FIRST TURN, AND THE
 * MODEL ANSWERS IN THE LANGUAGE THAT ADDRESS LOOKS LIKE.
 * → `core/language-drift.ts` for the wire capture and the six failed wordings.
 *
 * Measured 05/09: a brand-new empty office, an English request, a prompt with
 * no non-English character anywhere — 16/19 replies came back in the language
 * of the email. Six prompt wordings scored 0/5, 4/5, 4/4, 4/4, 5/5, 5/5.
 *
 * This file guards the two halves separately, because they fail differently:
 * the comparison is pure and provable here, while "is it actually wired up"
 * is invisible to `tsc` and needs its own check.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { driftRepair, driftsFrom } from '../dist/core/language-drift.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const assistant = (): string => fs.readFileSync(path.join(SRC, 'assistant.ts'), 'utf8');

// The exact pair measured, verbatim from the transcript of `1f3eabdf`.
const HUMAN_EN =
  "I need to create 1 file. OK, lets make it simple. Just create, 'abc.txt' on D:\\Downloads\\Musics, keep the content empty";
const REPLY_VI =
  'Rất tiếc, các nhân viên hiện tại đều không có quyền ghi file ra ngoài thư mục văn phòng.'; // i18n-allow-vietnamese: the drifted reply IS the thing under test

test('🔴 the measured case: an English request, a reply in another script', () => {
  assert.equal(driftsFrom(HUMAN_EN, REPLY_VI), true);
});

test('🔴 the direction that was never broken stays untouched', () => {
  const humanVi = 'Tôi cần tạo 1 file abc.txt ở D:\\Downloads\\Musics, để trống nội dung'; // i18n-allow-vietnamese: both sides in one script is the case under test
  assert.equal(driftsFrom(humanVi, REPLY_VI), false, 'agreeing sides must never cost a repair turn');
});

test('⭐ plain English both ways is silent', () => {
  assert.equal(
    driftsFrom(HUMAN_EN, "I can't write files outside the office folder — that needs a connection."),
    false,
  );
});

/**
 * The gate has to survive the innocent cases, or it becomes a tax on correct
 * answers. Shares, not counts, is what buys this.
 */
test('🔴 ONE borrowed word does not count as switching writing system', () => {
  const reply = 'I saved it to the café folder as you asked, and the report is ready to read.'; // i18n-allow-vietnamese: one accented letter in English is the case under test
  assert.equal(
    driftsFrom(HUMAN_EN, reply),
    false,
    'a single accented loanword would make this a tax on ordinary English',
  );
});

test('🔴 a document the human named in THEIR message is evidence, so quoting it back is not drift', () => {
  const human = 'please summarise doi-tra-hang-hoa.md and chính-sách-đổi-trả.md for me'; // i18n-allow-vietnamese: a real filename in the user's own request is the case under test
  const reply = 'Đã giao cho report-writer đọc chính-sách-đổi-trả.md và tóm tắt lại giúp bạn.'; // i18n-allow-vietnamese: the reply repeating that title is the case under test
  assert.equal(driftsFrom(human, reply), false, 'they used that script first — it is theirs, not a drift');
});

test('⭐ every script-distinct pair is caught, not just the one that bit us', () => {
  assert.equal(driftsFrom(HUMAN_EN, '现在办公室里没有员工可以在办公文件夹之外写入文件。'), true);
  assert.equal(driftsFrom(HUMAN_EN, 'Сейчас ни один сотрудник не может записывать файлы вне папки.'), true);
  assert.equal(driftsFrom(HUMAN_EN, '지금은 사무실 폴더 밖에 파일을 쓸 수 있는 직원이 없습니다.'), true);
});

/**
 * ⚠ THE BLIND SPOT, WRITTEN DOWN AS A TEST rather than as a comment nobody
 * re-reads. Two languages sharing one script are invisible to this, and the
 * day someone "fixes" that by reaching for a language detector, this test
 * fails and points them at the reason it must not be done.
 * → `scripts/check-language.ts §hasVietnameseDiacritics`
 */
test('⭐ same-script pairs are INVISIBLE here — a stated limit, not a defect', () => {
  assert.equal(
    driftsFrom(HUMAN_EN, 'No puedo escribir archivos fuera de la carpeta de la oficina, lo siento.'),
    false,
    'if this ever passes, someone has added a language detector — read the box first',
  );
});

test('⭐ no evidence ⇒ no finding: an empty human sentence never fires', () => {
  assert.equal(driftsFrom('', REPLY_VI), false);
  assert.equal(driftsFrom('   ', REPLY_VI), false);
});

test('⭐ a reply too short to carry a signal is left alone', () => {
  const short = 'Xong rồi.'; // i18n-allow-vietnamese: a reply too short to judge is the case under test
  assert.equal(driftsFrom(HUMAN_EN, short), false);
});

test('🔴 a decomposed reply cannot slip through as plain ASCII', () => {
  assert.equal(
    driftsFrom(HUMAN_EN, REPLY_VI.normalize('NFD')),
    true,
    'NFD spells the same words as ASCII plus separate marks — normalise first or the gate is blind',
  );
});

/**
 * The second turn is a CHECK, not an order (user settled 05/09): `driftsFrom`
 * knows nothing about intent, and a human may have asked for that script on
 * purpose. Forcing a rewrite there spends a turn to make a right answer wrong.
 */
test('🔴 the second turn hands over the decision — it must never order a rewrite', () => {
  const p = driftRepair(HUMAN_EN);
  assert.match(p, /CHECK, NOT AN INSTRUCTION/);
  assert.match(p, /decide for yourself/i);
  assert.match(p, /UNCHANGED/, 'keeping the answer must be stated as a correct outcome, not a failure');
});

test('🔴 it QUOTES their sentence — a one-shot door has no other copy of it', () => {
  // The report and the `/clear` memory are built entirely out of plan steps
  // and receipts: "look at their message" would point at nothing there.
  assert.match(driftRepair(HUMAN_EN), /abc\.txt/, 'the evidence is described but not shown');
  // Long enough to be evidence, short enough not to re-send a whole essay.
  assert.ok(driftRepair('x'.repeat(5_000)).length < 2_000, 'an unbounded quote makes the repair cost unbounded');
  // Newlines collapsed: a pasted multi-line message must not smuggle its own
  // instruction lines into a prompt that then reads them as ours.
  assert.doesNotMatch(driftRepair('one\n\n\ntwo'), /one\n/, 'the quote must stay on one line');
});

test('🔴 it NAMES NO LANGUAGE — the office must work where we shipped no catalogue', () => {
  assert.doesNotMatch(
    driftRepair(HUMAN_EN),
    /vietnamese|english|chinese|japanese|korean|spanish|french/i,
    'naming one breaks it permanently for every language except that one → docs/CLAUDE.md §Language',
  );
});

/**
 * `tsc` cannot see "is this helper actually called". The gate could be perfect
 * and reach nothing at all — the exact failure class that made `scheduler.live`
 * always empty while everything compiled clean.
 */
test('🔴 it is WIRED: every door goes through `run`, and `run` goes through `undrift`', () => {
  const src = assistant();
  assert.match(
    src,
    /return repairing \? \{ text, usage \} : this\.undrift\(/,
    'the choke point is unguarded — `route`/`plan`/`report`/`/clear` all pass here',
  );
  assert.match(src, /this\.lastHuman = message;/, 'nothing records what the human actually typed');
});

test('🔴 `lookup` and the hidden worker are excluded — they report what a DOCUMENT says', () => {
  const src = assistant();
  assert.match(
    src,
    /if \(override \|\| !driftsFrom\(this\.lastHuman, text\)\) return \{ text, usage \};/,
    'without the `override` bail-out, a Vietnamese document read for an English question pays a turn to be made worse',
  );
});

test('🔴 the repair cannot repair itself — no unbounded loop of paid turns', () => {
  const src = assistant();
  assert.match(src, /repairing = false,/, 'no guard parameter at all');
  const call = src.indexOf('const fix = await this.run(');
  assert.ok(call > 0, 'the second turn is gone');
  assert.match(
    src.slice(call, call + 400),
    /override,\s*true,\s*\);/,
    'the second turn must pass `repairing: true`, or every hit recurses and bills for it',
  );
});
