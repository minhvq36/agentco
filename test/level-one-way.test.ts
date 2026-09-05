
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { levelOf } from '../dist/core/probe.js';


test('explicitly declared read-only ⇒ read', () => {
  assert.equal(levelOf({ readOnly: true }), 'read');
  assert.equal(levelOf({ readOnly: true, destructive: false }), 'read');
});

test('NOTHING DECLARED ⇒ write_external — this case is REAL', () => {
  assert.equal(levelOf(undefined), 'write_external');
  assert.equal(levelOf({}), 'write_external');
});

test('half-declared is still UNKNOWN ⇒ write_external', () => {
  assert.equal(levelOf({ destructive: false }), 'write_external');
  assert.equal(levelOf({ openWorld: false }), 'write_external');
});

test('explicitly declared as writing ⇒ write_external', () => {
  assert.equal(levelOf({ readOnly: false }), 'write_external');
  assert.equal(levelOf({ readOnly: false, destructive: true }), 'write_external');
});

test('⭐ a CONTRADICTORY declaration (readOnly + destructive) ⇒ ESCALATES, does not trust the lighter claim', () => {
  assert.equal(levelOf({ readOnly: true, destructive: true }), 'write_external');
});

test('every combination: only EXACTLY ONE shape resolves down to `read`', () => {
  const vals = [true, false, undefined];
  let readCount = 0;
  for (const readOnly of vals) {
    for (const destructive of vals) {
      for (const openWorld of vals) {
        const got = levelOf({ readOnly, destructive, openWorld });
        const want = readOnly === true && destructive !== true ? 'read' : 'write_external';
        assert.equal(got, want, `{readOnly:${readOnly}, destructive:${destructive}} → ${got}`);
        if (got === 'read') readCount++;
      }
    }
  }
  assert.equal(readCount, 6, 'the count of combinations resolving to `read` changed — recheck the one-way rule');
});

const tierOf = (a: { readOnly?: boolean; destructive?: boolean }): 1 | 2 | 3 =>
  levelOf(a) === 'read' ? 1 : a.readOnly === false && a.destructive === false ? 2 : 3;

test('3 tiers: tier 2 requires BOTH declarations, missing either one bumps it to tier 3', () => {
  assert.equal(tierOf({ readOnly: true }), 1, 'read-only only');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 2, 'more — both declared');
  assert.equal(tierOf({ readOnly: false }), 3, 'missing destructive ⇒ unknown ⇒ tier 3');
  assert.equal(tierOf({ destructive: false }), 3, 'missing readOnly ⇒ unknown ⇒ tier 3');
  assert.equal(tierOf({}), 3, 'nothing declared ⇒ tier 3');
  assert.equal(tierOf({ readOnly: false, destructive: true }), 3, 'explicitly declared destructive');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 3, 'contradiction ⇒ escalates');
});

test('3 tiers: NO combination drops lower than `levelOf` allows', () => {
  const vals = [true, false, undefined];
  for (const readOnly of vals) {
    for (const destructive of vals) {
      const t = tierOf({ readOnly, destructive });
      if (levelOf({ readOnly, destructive }) === 'write_external') {
        assert.ok(t >= 2, `{readOnly:${readOnly}, destructive:${destructive}} dropped to tier ${t}`);
      }
    }
  }
});
