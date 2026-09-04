
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { Assistant } from '../dist/core/assistant.js';

const R: string = Assistant.COMPACT_RULES;

test('has all FIVE rules, numbered contiguously — dropping one rule breaks here', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.ok(new RegExp(`(^|\\n)${n}\\.`, 'm').test(R), `missing rule ${n}`);
  }
  assert.match(R, /Five rules/, 'the rule count stated up top does not match the actual count');
});

test('rules 1-3: KEEP is the default, the newer one wins, one line per topic', () => {
  assert.match(R, /CARRY OVER every old entry that still holds/);
  assert.match(R, /the newer one wins/);
  assert.match(R, /One line per topic/);
});

test('rule 4: does NOT record a conclusion drawn from a FAILURE, with a ⛔/✅ example pair', () => {
  assert.match(R, /never record a conclusion drawn from a FAILURE/i);
  assert.match(R, /⛔ "a done report from the browser employee cannot be fully trusted"/);
  assert.match(R, /✅ "hand the work over anyway; let the employee report a missing permission/);
  assert.match(R, /What the HUMAN settled still gets carried over under rule 1/);
});

test('rule 4 also covers NOT PRESENT / NOT TRIED cases, not just FAILURE (user reported 09/02)', () => {
  assert.match(R, /NOT PRESENT \/ NOT TRIED/);
  assert.match(R, /⛔ "this office has no email connection/);
  assert.match(R, /the list of connections is rebuilt into your context on EVERY turn/);
});

test('rule 5: keeps HOW TO FETCH IT, not the FIGURES themselves (user settled 08/31)', () => {
  assert.match(R, /never record FIGURES or STATE fetched from a connection or a file/i);
  assert.match(R, /asking the same place again tomorrow could give a different answer/);
});

test('rule 5 must have BOTH SIDES — missing the ✅ half leaves the model with a blank and no way back', () => {
  assert.match(R, /⛔ "there are currently 23 unpaid invoices/);
  assert.match(R, /✅ "number of unpaid invoices: ask the/);
  assert.match(R, /do not answer from memory/);
});

test('rule 5 carves out the right exception: a figure the USER settled is still kept', () => {
  assert.match(R, /A figure the HUMAN themselves settled still gets carried over under rule 1/);
});

test('the block still states clearly how to answer when there is NOTHING worth remembering', () => {
  assert.match(R, /If there is NO earlier memory and nothing in this session is worth keeping/);
});

test('the rules block does NOT name any specific language', () => {
  for (const name of ['Vietnamese', 'tiếng Việt', 'English', 'Chinese', 'tiếng Anh']) { // i18n-allow-vietnamese: fixture — asserting these language names are absent
    assert.equal(R.includes(name), false, `the rules block hardcodes the language "${name}"`);
  }
  assert.match(R, /in the language of the conversation/);
});

test('the "NOTHING" sentinel must match exactly what `office.ts` checks for', () => {
  assert.match(R, /one word: NOTHING/);
  assert.match('NOTHING', /^NOTHING\.?$/i);
  assert.match('Nothing.', /^NOTHING\.?$/i);
});
