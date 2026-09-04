
/**
 * The optimistic chat bubble. → `web/src/lib/chat-echo.ts`
 *
 * The whole point of drawing before the server confirms is that the bubble
 * MUST NOT then appear twice. Every test here is about that one risk.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { mergeUserEcho } from '../web/src/lib/chat-echo.ts';

const STORE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'web',
  'src',
  'lib',
  'store.ts',
);

type Msg = { id: number; role: string; text: string; pending?: boolean };

const drawn = (text: string, id = 1): Msg => ({ id, role: 'user', text, pending: true });

test('🔴 the echo SETTLES the bubble instead of adding a second one', () => {
  const out = mergeUserEcho([drawn('create abc.txt')], 'create abc.txt');
  assert.ok(out, 'no match found — the caller would append and the message would show twice');
  assert.equal(out.length, 1, 'the list must not grow');
  assert.equal('pending' in out[0]!, false, 'the key is removed, not just falsified');
  assert.equal(out[0]!.id, 1, 'the same bubble, not a replacement with a new identity');
});

test('🔴 an echo matching nothing pending returns undefined, so the caller appends it', () => {
  // Another tab, the Telegram bridge, or the replay on reload. Swallowing this
  // would silently lose a real message.
  assert.equal(mergeUserEcho([], 'hello'), undefined);
  assert.equal(
    mergeUserEcho([{ id: 1, role: 'user', text: 'hello' }], 'hello'),
    undefined,
    'an ALREADY SETTLED bubble must never absorb a second echo',
  );
});

test('🔴 the same sentence sent twice settles OLDEST FIRST, one per echo', () => {
  const twice = [drawn('ok', 1), drawn('ok', 2)];
  const first = mergeUserEcho(twice, 'ok');
  assert.ok(first);
  assert.equal('pending' in first[0]!, false, 'the older bubble settles first');
  assert.equal(first[1]!.pending, true, 'the second one is still waiting for its own echo');

  const second = mergeUserEcho(first, 'ok');
  assert.ok(second, 'the second echo must find the remaining bubble');
  assert.equal(second.filter((m) => m.pending).length, 0);
  assert.equal(second.length, 2, 'two sends, two bubbles — never three');
});

test('🔴 a different text never settles someone else’s bubble', () => {
  assert.equal(mergeUserEcho([drawn('abc')], 'abd'), undefined, 'matching is exact, not fuzzy');
});

test('🔴 only a `user` bubble is ever settleable', () => {
  const fromAgent = [{ id: 1, role: 'assistant', text: 'same words', pending: true }];
  assert.equal(mergeUserEcho(fromAgent, 'same words'), undefined);
});

/**
 * A correct helper nobody calls is worth nothing, and the compiler cannot see
 * the difference — the same hole that made `whereBlock(receipts, wrote)` pass
 * `tsc` with the second argument dropped.
 */
test('🔴 the store really DRAWS early and really CALLS the merge', () => {
  const src = fs.readFileSync(STORE, 'utf8');
  assert.match(src, /pending: true/, 'say() never draws the bubble — the delay is still there');
  assert.match(
    src,
    /mergeUserEcho\(state\.messages, e\.say\)/,
    'the echo handler never settles — every sent message would appear TWICE',
  );
  assert.match(
    src,
    /messages: state\.messages\.filter\(\(m\) => m\.id !== pendingId\)/,
    'a failed send must take the bubble back down, or the UI asserts something that did not happen',
  );
});

test('⭐ messages around the settled one are left exactly as they were', () => {
  const list: Msg[] = [
    { id: 1, role: 'user', text: 'first' },
    { id: 2, role: 'assistant', text: 'a reply' },
    drawn('second', 3),
  ];
  const out = mergeUserEcho(list, 'second');
  assert.ok(out);
  assert.deepEqual(out.slice(0, 2), list.slice(0, 2));
  assert.equal(out.length, 3);
});
