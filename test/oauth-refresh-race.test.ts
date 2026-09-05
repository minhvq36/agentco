/**
 * THE CREDENTIAL REFRESH LOOP TRIPPING OVER ITSELF — measured 09/03.
 *
 * Three accounts across three services (Notion `invalid_grant`, GitHub twice
 * `incorrect_client_credentials`) were marked dead inside 4 seconds, while the
 * credentials still had 2h13m of life and the refresh token had 180 of its 181
 * days left. Nothing had expired — they were REFUSED, which is what a service
 * says when it is handed a refresh token it has already rotated away.
 *
 * The two guards below are what stop a lost race from becoming a credential
 * only a human can bring back. Both are pure, so they are locked here rather
 * than described in a comment nobody runs.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { deadMarkStillApplies, oneSweepAtATime } from '../dist/server/oauth-routes.js';

const defer = (): { promise: Promise<void>; done: () => void } => {
  let done!: () => void;
  const promise = new Promise<void>((r) => {
    done = r;
  });
  return { promise, done };
};

test('oneSweepAtATime: a second tick while one is in flight is DROPPED, not queued', async () => {
  const gate = defer();
  let started = 0;
  const tick = oneSweepAtATime(() => {
    started++;
    return gate.promise;
  });

  tick();
  tick();
  tick();
  assert.equal(started, 1, 'only the first sweep may run — the other two collide with it');

  gate.done();
  await gate.promise;
  await new Promise((r) => setImmediate(r));

  tick();
  assert.equal(started, 2, 'once the first finishes, the next tick runs normally');
});

test('oneSweepAtATime: a REJECTED sweep still releases the flag', async () => {
  let started = 0;
  const tick = oneSweepAtATime(() => {
    started++;
    return Promise.reject(new Error('network down'));
  });

  tick();
  await new Promise((r) => setImmediate(r));
  tick();
  await new Promise((r) => setImmediate(r));

  // A latched flag is the worst outcome available here: refreshing would stop
  // for the life of the daemon, and it would look exactly like "credentials
  // just quietly stopped renewing".
  assert.equal(started, 2, 'a failed sweep must not latch the guard ON');
});

test('oneSweepAtATime: a sweep that throws SYNCHRONOUSLY still releases the flag', async () => {
  let started = 0;
  const tick = oneSweepAtATime(() => {
    started++;
    throw new Error('thrown before any promise exists');
  });

  assert.doesNotThrow(() => tick(), 'the timer callback must never throw at the caller');
  tick();
  assert.equal(started, 2, 'the synchronous-throw path must release the guard too');
});

test('deadMarkStillApplies: the store is untouched ⇒ the refusal is real, record it', () => {
  const acc = { access_token: 'a1', refresh_token: 'r1' };
  assert.equal(deadMarkStillApplies(acc, { access_token: 'a1', refresh_token: 'r1' }), true);
});

test('🔴 deadMarkStillApplies: the store MOVED ON ⇒ we lost a race, the account is FINE', () => {
  const acc = { access_token: 'a1', refresh_token: 'r1' };
  // Someone else refreshed successfully while this attempt was in flight. The
  // refusal is the losing half of that race — marking dead here would kill a
  // working account AND write the stale credential back over the good one.
  assert.equal(deadMarkStillApplies(acc, { access_token: 'a2', refresh_token: 'r2' }), false);
});

test('deadMarkStillApplies: only the REFRESH token rotated ⇒ still a lost race', () => {
  const acc = { access_token: 'a1', refresh_token: 'r1' };
  assert.equal(deadMarkStillApplies(acc, { access_token: 'a1', refresh_token: 'r2' }), false);
});

test('deadMarkStillApplies: the account was DELETED meanwhile ⇒ do not resurrect it', () => {
  const acc = { access_token: 'a1', refresh_token: 'r1' };
  // Writing here would put back an account the user had just removed, carrying
  // a dead flag — an entry nobody asked for that cannot even be used.
  assert.equal(deadMarkStillApplies(acc, undefined), false);
});
