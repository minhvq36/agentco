
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { httpTarget } from '../dist/core/mcp-http.js';
import { tierOf } from '../dist/core/probe.js';


test('⭐ the SDK loses `false` ⇒ the middle tier is EMPTY. This is why mcp-http exists.', () => {
  const fromSdk = [
    {}, // notion-create-pages  — server declares {readOnly:false, destructive:false}
    {}, // notion-create-database
    { openWorld: true }, // notion-create-attachment
    { destructive: true }, // notion-update-page
    { readOnly: true }, // notion-fetch
  ];
  const tiers = fromSdk.map((a) => tierOf(a));
  assert.deepEqual(tiers, ['full', 'full', 'full', 'full', 'read']);
  assert.equal(tiers.filter((t) => t === 'add').length, 0, 'through the SDK, the middle tier never gets anything');
});

test('⭐ the same tools, read RAW from the server ⇒ the middle tier gets entries', () => {
  const fromRaw = [
    { readOnly: false, destructive: false }, // notion-create-pages
    { readOnly: false, destructive: false }, // notion-create-database
    { readOnly: false, destructive: false, openWorld: true }, // notion-create-attachment
    { readOnly: false, destructive: true }, // notion-update-page
    { readOnly: true, destructive: false }, // notion-fetch
  ];
  assert.deepEqual(fromRaw.map((a) => tierOf(a)), ['add', 'add', 'add', 'full', 'read']);
});

test('the truth table itself does NOT change — only the data fed into it does', () => {
  assert.equal(tierOf({}), 'full');
  assert.equal(tierOf({ readOnly: false }), 'full');
  assert.equal(tierOf({ destructive: false }), 'full');
  assert.equal(tierOf({ readOnly: false, destructive: false }), 'add');
  assert.equal(tierOf({ readOnly: true, destructive: true }), 'full');
});


test('httpTarget: only accepts HTTP config, with headers injected', () => {
  assert.deepEqual(
    httpTarget({ type: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }),
    { url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } },
  );
});

test('httpTarget: stdio ⇒ undefined — cannot be queried directly via fetch', () => {
  assert.equal(httpTarget({ command: 'npx', args: ['-y', 'pkg'] }), undefined);
  assert.equal(httpTarget(null), undefined);
  assert.equal(httpTarget(undefined), undefined);
});

test('httpTarget: a non-string header is DROPPED, not coerced', () => {
  assert.deepEqual(httpTarget({ url: 'https://x', headers: { A: 1, B: 'ok' } }), {
    url: 'https://x',
    headers: { B: 'ok' },
  });
});

test('httpTarget: no headers ⇒ empty object, not undefined', () => {
  assert.deepEqual(httpTarget({ url: 'https://x' }), { url: 'https://x', headers: {} });
});
