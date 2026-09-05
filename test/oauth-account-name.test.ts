

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { accountName, applyToken, hasOwnSeed, isAccountName } from '../dist/core/oauth.js';

const base = { issuer: 'https://mcp.notion.com', mcp_url: 'https://mcp.notion.com/mcp' };

test('a valid name only fills the SLOT — [A-Z0-9_] only', () => {
  const n = accountName('notion', { ...base, extra: { workspace_id: 'a1b2c3d4-ee55-0000-9999-abcdefabcdef' } });
  assert.match(n, /^[A-Z0-9_]+$/);
  assert.match(n, /^NOTION_OAUTH_[0-9A-F]{8}$/);
});

test('DETERMINISTIC — same workspace ⇒ same name, logging in again does not spawn a new entry', () => {
  const acc = { ...base, extra: { workspace_id: 'ws-1' } };
  assert.equal(accountName('notion', acc), accountName('notion', { ...acc }));
});

test('DIFFERENT workspace ⇒ DIFFERENT name — two workspaces never collapse into one', () => {
  const a = accountName('notion', { ...base, extra: { workspace_id: 'ws-1' } });
  const b = accountName('notion', { ...base, extra: { workspace_id: 'ws-2' } });
  assert.notEqual(a, b);
});

test('NO workspace_id ⇒ still deterministic, falls back to issuer + mcp_url', () => {
  const a = accountName('linear', base);
  assert.equal(a, accountName('linear', { ...base }));
  assert.match(a, /^LINEAR_OAUTH_[0-9A-F]{8}$/);
});

test('the prefix is sanitized — a catalog entry with a hyphen still produces a valid name', () => {
  const n = accountName('google-drive', base);
  assert.match(n, /^GOOGLEDRIVE_OAUTH_[0-9A-F]{8}$/);
});


test('⭐ isAccountName: correctly recognizes what accountName produces', () => {
  for (const p of ['notion', 'linear', 'google-drive']) {
    assert.ok(isAccountName(accountName(p, base)), `failed to recognize its own generated name: ${p}`);
  }
});

test('⭐ isAccountName: does NOT mistake a hand-typed key for one', () => {
  for (const n of ['NOTION_ACCESS_TOKEN', 'GITHUB_TOKEN', 'MY_OAUTH_KEY', 'OAUTH', 'X_OAUTH_ABCDEFG']) {
    assert.equal(isAccountName(n), false, `mistook "${n}" for an account`);
  }
});


test('🔴🔴 NO seed ⇒ EVERY GitHub account produces the SAME name', () => {
  const gh = (extra: Record<string, unknown> = {}) => ({
    issuer: 'https://github.com',
    mcp_url: 'https://api.githubcopilot.com/mcp/',
    extra,
  });
  assert.equal(
    accountName('github', gh()),
    accountName('github', gh()),
    'THIS is why `oauthDevicePoll` must refuse to save when an entry has `identity` but no seed',
  );
  assert.notEqual(accountName('github', gh(), '111'), accountName('github', gh(), '222'));
});

test('⭐ a seed separates two accounts even when everything else is identical', () => {
  const a = { issuer: 'https://github.com', mcp_url: 'https://x/mcp/', extra: {} };
  assert.notEqual(accountName('github', a, 'octocat-id'), accountName('github', a, 'other-id'));
  assert.equal(accountName('github', a, 'octocat-id'), accountName('github', a, 'octocat-id'));
});


test('🔴 NO workspace_id, NO seed ⇒ hasOwnSeed FALSE (the account-merging branch)', () => {
  assert.equal(hasOwnSeed({ extra: {} }), false);
  assert.equal(hasOwnSeed({}), false);
  assert.equal(hasOwnSeed({ extra: { workspace_id: '' } }), false);
  assert.equal(hasOwnSeed({ extra: {} }, '   '), false);
});

test('⭐ TWO paths to identity, both valid', () => {
  assert.equal(hasOwnSeed({ extra: { workspace_id: 'ws-1' } }), true);
  assert.equal(hasOwnSeed({ extra: {} }, '12345'), true);
});

test('🔴 workspace_id is NOT a string ⇒ not trusted (third-party data)', () => {
  assert.equal(hasOwnSeed({ extra: { workspace_id: 123 as unknown as string } }), false);
  assert.equal(hasOwnSeed({ extra: { workspace_id: null as unknown as string } }), false);
});

test('⭐ `hasOwnSeed` FALSE matches EXACTLY the branch that gives two accounts the same name', () => {
  const a = { issuer: 'https://x', mcp_url: 'https://x/mcp', extra: {} };
  const b = { issuer: 'https://x', mcp_url: 'https://x/mcp', extra: { other: 'totally-different' } };
  assert.equal(hasOwnSeed(a), false);
  assert.equal(hasOwnSeed(b), false);
  assert.equal(accountName('p', a), accountName('p', b), 'two different accounts, ONE name');
});


test('🔴 a Notion MINT pass HAS identity ⇒ the new gate does not block it by mistake', () => {
  const acc = applyToken(
    { client_id: 'c', mcp_url: 'https://mcp.notion.com/mcp', issuer: 'https://mcp.notion.com' },
    {
      access_token: 'at',
      refresh_token: 'rt',
      token_type: 'Bearer',
      expires_in: 28800,
      workspace_id: 'ws-abc',
      workspace_name: "Acme Team's Notion",
    } as never,
  );
  assert.equal(acc.extra?.['workspace_id'], 'ws-abc', 'unknown fields must fall into `extra`');
  assert.equal(hasOwnSeed(acc), true, 'blocking here would block a HEALTHY login');
});

test('🔴 a REFRESH pass drops `extra` — so the gate must NOT be checked against the saved record', () => {
  const minted = applyToken(
    { client_id: 'c', mcp_url: 'u', issuer: 'i' },
    { access_token: 'at', token_type: 'Bearer', workspace_id: 'ws-abc' } as never,
  );
  const refreshed = applyToken(minted, {
    access_token: 'at2',
    refresh_token: 'rt2',
    token_type: 'Bearer',
    expires_in: 28800,
  } as never);
  assert.equal(hasOwnSeed(minted), true);
  assert.equal(hasOwnSeed(refreshed), false, 'this is a false read, not an actual failure');
  const named = applyToken({ ...minted, label: 'Acme Soft-ware' }, {
    access_token: 'at3',
    token_type: 'Bearer',
  } as never);
  assert.equal(named.label, 'Acme Soft-ware');
});
