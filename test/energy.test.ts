
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { apply, energySnapshot, energyVersion, noteRateLimit, resetEnergy } from '../dist/core/energy.js';

const EVENT = {
  status: 'allowed',
  resetsAt: 1787367000,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  isUsingOverage: false,
};

const USAGE = {
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 58, resets_at: '2026-08-22T02:49:59.770958+00:00' },
    seven_day: { utilization: 65, resets_at: '2026-08-26T03:59:59.770990+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    nimbus_quill: { utilization: 0, resets_at: null },
    iguana_necktie: null,
    extra_usage: { is_enabled: false },
  },
};

test('nothing fetched yet => NO snapshot — the header must stay quiet, no empty box shown', () => {
  resetEnergy();
  assert.equal(energySnapshot(), undefined);
  assert.equal(energyVersion(), 0);
});

test('usage(): reads BOTH windows correctly, correct % and correct reset time', () => {
  resetEnergy();
  apply(USAGE);
  const snap = energySnapshot();
  assert.ok(snap);
  assert.equal(snap.plan, 'pro');
  assert.deepEqual(
    snap.windows.map((w) => [w.kind, w.utilization]),
    [
      ['session', 58],
      ['weekly', 65],
    ],
    'FIXED order session -> weekly, and both carry a %',
  );
  assert.equal(snap.windows[0]!.resetsAt, new Date('2026-08-22T02:49:59.770958+00:00').toISOString());
  assert.equal(snap.windows[1]!.resetsAt, new Date('2026-08-26T03:59:59.770990+00:00').toISOString());
});

test('per-model buckets and internal codename buckets must NOT leak to the UI', () => {
  resetEnergy();
  apply(USAGE);
  const kinds = energySnapshot()!.windows.map((w) => w.kind);
  assert.deepEqual(kinds, ['session', 'weekly']);
});

test('color derived from %: <80 comfortable, >=80 warning, >=100 blocked', () => {
  resetEnergy();
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 79, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'allowed');
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 80, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'allowed_warning');
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 100, resets_at: null } } });
  assert.equal(energySnapshot()!.windows[0]!.status, 'rejected');
});

test('running on an API key (rate_limits_available=false) => nothing at all', () => {
  resetEnergy();
  apply({ subscription_type: null, rate_limits_available: false, rate_limits: null });
  assert.equal(energySnapshot(), undefined);
});

test('event: resetsAt is Unix SECONDS, not milliseconds', () => {
  resetEnergy();
  noteRateLimit(EVENT);
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.resetsAt, new Date(1787367000 * 1000).toISOString());
  assert.ok(new Date(w.resetsAt!).getFullYear() < 2100);
});

test('an event only touches status — does NOT touch the % and does NOT touch the reset time', () => {
  resetEnergy();
  apply(USAGE);
  const before = energySnapshot()!.windows[0]!.resetsAt;
  noteRateLimit({ ...EVENT, status: 'allowed_warning' });
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.status, 'allowed_warning', 'status updates IMMEDIATELY, mid-run');
  assert.equal(w.utilization, 58, 'an event carries no %, so the old number must be kept');
  assert.equal(
    w.resetsAt,
    before,
    'the two sources differ by 0.23s: letting the event overwrite it would produce a junk energy.tick on EVERY query',
  );
});

test('an event for a per-model bucket is ignored, does not spawn a third window', () => {
  resetEnergy();
  apply(USAGE);
  const v = energyVersion();
  noteRateLimit({ ...EVENT, rateLimitType: 'seven_day_opus', status: 'rejected' });
  assert.equal(energyVersion(), v);
  assert.equal(energySnapshot()!.windows.length, 2);
});

test('a message identical to the last one does NOT bump the version — otherwise SSE floods with junk events', () => {
  resetEnergy();
  apply(USAGE);
  const v = energyVersion();
  apply(USAGE);
  noteRateLimit(EVENT);
  noteRateLimit(EVENT);
  assert.equal(energyVersion(), v);
});

test('junk input is ignored, does NOT throw — this is an experimental API we do not control', () => {
  resetEnergy();
  for (const junk of [undefined, null, 42, 'x', {}, { rate_limits: 'nope' }]) {
    apply(junk as never);
    noteRateLimit(junk);
  }
  noteRateLimit({ ...EVENT, status: 'something_new' });
  assert.equal(energySnapshot(), undefined);
  assert.equal(energyVersion(), 0);
});

test('an absurd % is clamped to 0-100, a broken reset time becomes null', () => {
  resetEnergy();
  apply({ ...USAGE, rate_limits: { five_hour: { utilization: 140, resets_at: 'not a date' } } });
  const w = energySnapshot()!.windows[0]!;
  assert.equal(w.utilization, 100);
  assert.equal(w.resetsAt, null);
});
