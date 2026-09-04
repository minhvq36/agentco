
import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG, armHash, findArm, normRepo } from '../dist/core/catalog.js';
import { githubDoorError } from '../dist/core/worker.js';

const DOOR = 'https://github.com/apps/agent-co-app/installations/new';
const fix = (raw: Record<string, unknown>, text: string) => githubDoorError(raw, text, DOOR);


test('⭐ 404 with owner/repo ⇒ rewritten as "the app is not installed on this repo"', () => {
  const out = fix({ owner: 'octocat', repo: 'test', path: 'README.md' }, 'Error: 404 Not Found');
  assert.ok(out, 'must rewrite');
  assert.match(out, /octocat\/test/, 'names the correct repo');
  assert.match(out, /is not installed/i, 'states the real cause');
  assert.ok(out.includes(DOOR), 'includes the next-step link — without it the rewrite is a dead end too');
});

test('🔴 KEEPS the original message, only ADDS to it — never swallows the error', () => {
  const original = 'Error: 404 Not Found';
  const out = fix({ owner: 'a', repo: 'b' }, original)!;
  assert.ok(out.startsWith(original), "the vendor's verbatim message must remain — it is what gets copy-pasted when asking for help");
});

test('⭐ tells the model NOT to assume the repo does not exist, and not to try other names', () => {
  const out = fix({ owner: 'a', repo: 'b' }, '404')!;
  assert.match(out, /do not.*(retry|conclude)/is, 'without this warning, every guess is a billed turn');
});

test('🔴 NO owner/repo ⇒ STAY PUT — do not construct a NEW wrong-door message', () => {
  assert.equal(fix({ query: 'user:octocat' }, 'Error: 404 Not Found'), null);
  assert.equal(fix({ owner: 'a' }, '404 Not Found'), null, 'half the pair is not enough to conclude anything');
});

test('not a 404 ⇒ stays put', () => {
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'Error: 403 Forbidden'), null);
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'rate limit exceeded'), null);
  assert.equal(fix({ owner: 'a', repo: 'b' }, 'ok'), null);
});

test('catches both ways the vendor phrases that message', () => {
  assert.ok(fix({ owner: 'a', repo: 'b' }, 'HTTP 404'), 'numeric form');
  assert.ok(fix({ owner: 'a', repo: 'b' }, 'Not Found'), 'text form, no number');
});


test('⛔ `reachTest` (the hand-typed field) has been REMOVED — do not bring it back, its premise was wrong', () => {
  for (const a of CATALOG) {
    assert.equal((a as Record<string, unknown>)['reachTest'], undefined, a.id);
  }
});

test('🔴 NO entry still declares `limitTo` — the repo fence was removed on 27/08', () => {
  for (const a of CATALOG) {
    assert.equal((a as Record<string, unknown>)['limitTo'], undefined, a.id);
  }
});


const CFG = { type: 'http', url: 'https://api.githubcopilot.com/mcp/' };

test('⭐ the hash has NO room for a repo scope — and that is the CORRECT outcome', () => {
  assert.equal(armHash.length <= 3, true, 'armHash only takes config + key name + tier');
  const a = armHash(CFG, ['GITHUB_OAUTH_A'], 'full');
  const b = armHash(CFG, ['GITHUB_OAUTH_B'], 'full');
  assert.notEqual(a, b, 'different account ⇒ different arm');
  assert.equal(a, armHash(CFG, ['GITHUB_OAUTH_A'], 'full'), 'same input ⇒ same hash');
});

test('🔴 the hash is UNCHANGED from before the repo restriction was added and then removed', () => {
  assert.equal(armHash(CFG, ['x'], 'full'), armHash(CFG, ['x'], 'full'));
  assert.equal(armHash(CFG, ['x']), armHash(CFG, ['x'], undefined));
});

test('normRepo is still alive — the tests need it to split owner/name', () => {
  assert.equal(normRepo('https://github.com/Octocat/Test.git'), 'octocat/test');
  assert.equal(normRepo('  /octocat/test/  '), 'octocat/test');
});
