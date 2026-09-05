
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { grantFor, injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';
import { armHash } from '../dist/core/catalog.js';


test('finds blank slots EVERYWHERE, not just in headers', () => {
  assert.deepEqual(missingSecretRefs({ type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }), ['T']);
  assert.deepEqual(missingSecretRefs({ url: 'https://${HOST}/mcp' }), ['HOST']);
  assert.deepEqual(missingSecretRefs({ command: 'x', args: ['--key=${K}'] }), ['K']);
  assert.deepEqual(missingSecretRefs({ command: 'x', env: { A: '${B}' } }), ['B']);
});

test('no blank slots ⇒ empty, and an empty/null config does not blow up', () => {
  assert.deepEqual(missingSecretRefs({ command: 'npx', args: ['-y', 'pkg'] }), []);
  assert.deepEqual(missingSecretRefs(null), []);
  assert.deepEqual(missingSecretRefs(undefined), []);
});

test('each name is reported only ONCE, and sorted — the error message must be stable', () => {
  assert.deepEqual(missingSecretRefs({ headers: { A: '${T}', B: '${T}', C: '${S}' } }), ['S', 'T']);
});


test('grantFor: an empty string counts as MISSING, not "present but empty"', () => {
  const r = grantFor({ A: '', B: 'real' }, ['A', 'B', 'C']);
  assert.deepEqual(r.env, { B: 'real' });
  assert.deepEqual(r.missing, ['A', 'C']);
});

test('injectSecrets: an empty secret does NOT replace the blank slot — it is left as-is so it stays visible', () => {
  const out = injectSecrets({ type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } }, { T: '' });
  assert.deepEqual(out, { type: 'http', url: 'https://x/mcp', headers: { A: 'Bearer ${T}' } });
});

test('injectSecrets: an empty secret does NOT go into stdio env', () => {
  assert.deepEqual(injectSecrets({ command: 'x' }, { A: '' }), { command: 'x' });
});

test('three user scenarios give three DIFFERENT outcomes, no longer collapsed into one 401', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer ${NOTION_ACCESS_TOKEN}' } };

  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { NOTION_ACCESS_TOKEN: 'totally-wrong' })), []);

  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { NOTION_ACCESS_TOKEN: '' })), ['NOTION_ACCESS_TOKEN']);

  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, {})), ['NOTION_ACCESS_TOKEN']);
});


test('missing the secret name ⇒ DIFFERENT hash ⇒ silently duplicated "reuse"', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.notEqual(armHash(cfg, ['NOTION_ACCESS_TOKEN']), armHash(cfg, []));
});

test('carrying the same secret names ⇒ SAME hash ⇒ true "shared across every workspace"', () => {
  const cfg = { type: 'http', url: 'https://mcp.notion.com/mcp' };
  assert.equal(armHash(cfg, ['NOTION_ACCESS_TOKEN']), armHash({ ...cfg }, ['NOTION_ACCESS_TOKEN']));
});
