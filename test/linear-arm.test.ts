
import assert from 'node:assert/strict';
import test from 'node:test';

import { armHash, buildConfig, findArm, needsOAuth, serverFenced } from '../dist/core/catalog.js';
import { t } from '../dist/i18n/index.js';

const li = findArm('linear')!;
const cfg = (input: Parameters<typeof buildConfig>[1]): { url?: string; headers?: Record<string, string> } =>
  buildConfig(li.spec, input) as { url?: string; headers?: Record<string, string> };


test('⭐ Linear logs in via OAuth, 0 secret slots', () => {
  assert.equal(li.price, 'login');
  assert.deepEqual(li.secrets, [], 'the secret comes from the login flow, not from an input field');
  assert.equal(needsOAuth(li), true);
  assert.equal(li.auth, undefined, 'DCR is open ⇒ no need to ship a client_id like GitHub does');
});

test('🔴 NO secret string anywhere in the catalog — only slots with a conventional name', () => {
  const s = JSON.stringify(li);
  assert.ok(s.includes('${OAUTH}'), 'the header must be a blank slot, not a real secret');
  assert.doesNotMatch(s, /client_secret|private[_-]?key|lin_(api|oauth)_/i);
});


test('⭐ the `read` tier hits /mcp/readonly — a fence built by the VENDOR ITSELF', () => {
  assert.equal(cfg({ folders: [], level: 'read' }).url, 'https://mcp.linear.app/mcp/readonly');
});

test('⭐ the `add` and `full` tiers both hit the full /mcp', () => {
  assert.equal(cfg({ folders: [], level: 'add' }).url, 'https://mcp.linear.app/mcp');
  assert.equal(cfg({ folders: [], level: 'full' }).url, 'https://mcp.linear.app/mcp');
});

test('⭐ changing tier ⇒ different hash ⇒ two tiers are two separate arms', () => {
  const doc = cfg({ folders: [], level: 'read' });
  const toan = cfg({ folders: [], level: 'full' });
  assert.notEqual(armHash(doc, ['L'], 'read'), armHash(toan, ['L'], 'full'));
});

test('📌 the URL is part of the hash — read/write tiers stay separate even without the `level` param', () => {
  assert.notEqual(armHash(cfg({ folders: [], level: 'read' }), ['L']), armHash(cfg({ folders: [], level: 'full' }), ['L']));
});


test('🔴 must request `read write` — requesting a narrower scope locks the tier picker out', () => {
  const spec = li.spec as { authScope?: string };
  assert.equal(spec.authScope, 'read write');
});

test('⭐ must NOT request `openid`/`email` — those return the PERSON identity, we need the WORKSPACE', () => {
  const spec = li.spec as { authScope?: string };
  assert.doesNotMatch(spec.authScope ?? '', /openid|email/);
});

test('⭐ every OTHER entry declares no `authScope` — the login URL does not change by one byte', () => {
  for (const id of ['notion', 'github']) {
    const s = findArm(id)!.spec as { authScope?: string };
    assert.equal(s.authScope, undefined, `${id} must keep the old behavior (no scope param sent)`);
  }
});


test('🔴 must declare `identity` — Linear does NOT return identity in the token response', () => {
  assert.equal(li.identity?.tool, 'get_workspace');
  assert.equal(li.identity?.idField, 'id', 'renaming the workspace must NOT change the hash');
  assert.equal(li.identity?.labelField, 'name');
});

test('📌 identity is looked up at the FULL URL, not at /readonly', () => {
  assert.equal(li.identity?.url, 'https://mcp.linear.app/mcp');
  assert.notEqual(li.identity?.url, li.spec.kind === 'http' ? li.spec.readOnlyUrl : undefined);
});


test('🔴 the `add` tier must have its OWN message — the default one promises "can create", Linear cannot', () => {
  const say = li.tierSay?.add ? t(li.tierSay.add) : '';
  assert.ok(say.length > 0, 'must be overridden');
  assert.match(say, /KHÔNG mở được issue/, 'must state what it CANNOT do'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.match(say, /Toàn quyền/, 'and point the way to the tier that can'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});

test('⭐ the override only touches the tier that needs it — `read`/`full` still use the shared message', () => {
  assert.equal(li.tierSay?.read, undefined);
  assert.equal(li.tierSay?.full, undefined);
});

test('⭐ every OTHER entry declares no `tierSay` — the default path is unchanged', () => {
  for (const id of ['notion', 'github', 'files', 'browser']) {
    assert.equal(findArm(id)!.tierSay, undefined, `${id} must keep the default message`);
  }
});


test('🔴 REGRESSION 08/30 — `hint` must state the label is a WORKSPACE, not a project', () => {
  const h = li.hint ?? '';
  assert.match(h, /WORKSPACE/, 'must state what kind the label is');
  assert.match(h, /not a project/i);
  assert.match(h, /list_issues/, 'and must POINT TO the next step, not just forbid');
});

test('⭐ `hint` must be SHORT — it goes into the prefix of EVERY turn for any role holding this arm', () => {
  assert.ok((li.hint ?? '').length < 260, `hint is ${li.hint?.length} characters long`);
});


test('⭐ has BOTH a logo AND a statement that the guidelines were read — §11c requires BOTH', () => {
  assert.ok(li.brand.mark, 'must have an SVG path');
  assert.ok(li.brand.guidelineUrl, 'must state where the guidelines were read');
  assert.match(li.brand.checkedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, 'must have the DATE it was read');
});

test('🔴 the logo is a MONOCHROME 24×24 shape, no brand color, no background', () => {
  const m = li.brand.mark ?? '';
  assert.doesNotMatch(m, /#[0-9a-f]{3,8}\b|rgb|fill=|<svg|<path/i, 'just the path, not a whole SVG tag');
  assert.match(m, /^M/, 'starts with a moveto command');
});


test('🔴🔴 `serverFenced` MUST see `readOnlyUrl` — miss it and the tier picker disappears', () => {
  assert.equal(serverFenced(li), true);
});

test('⭐ control: an entry that is NOT fenced-at-server must have `serverFenced` false', () => {
  assert.equal(serverFenced(findArm('notion')!), false);
  assert.equal(serverFenced(findArm('github')!), true, 'GitHub fences via a header');
});

test('⭐ an entry that does NOT declare readOnlyUrl keeps the same ADDRESS for the read tier', () => {
  const notion = findArm('notion')!;
  assert.deepEqual(
    buildConfig(notion.spec, { folders: [], level: 'read' }),
    buildConfig(notion.spec, { folders: [], level: 'full' }),
  );
});
