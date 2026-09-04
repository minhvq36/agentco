
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';


test('stdio: keys go into env — the old behavior must NOT change', () => {
  const out = injectSecrets({ command: 'npx', args: ['-y', 'pkg'] }, { A: '1' });
  assert.deepEqual(out, { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } });
});

test('stdio: existing env is kept, the new key overrides on merge', () => {
  const out = injectSecrets({ command: 'x', env: { KEEP: 'y', A: 'old' } }, { A: 'new' });
  assert.deepEqual(out, { command: 'x', env: { KEEP: 'y', A: 'new' } });
});


test('http: placeholders in headers get replaced with the key', () => {
  const out = injectSecrets(
    { type: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer ${T}' } },
    { T: 'ntn_abc' },
  );
  assert.deepEqual(out, {
    type: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: { Authorization: 'Bearer ntn_abc' },
  });
});

test('http: multiple placeholders, multiple headers', () => {
  const out = injectSecrets(
    { url: 'https://x/mcp', headers: { A: '${P}', B: 'v=${Q};w=${P}' } },
    { P: '1', Q: '2' },
  );
  assert.deepEqual((out as { headers: unknown }).headers, { A: '1', B: 'v=2;w=1' });
});

test('http: a MISSING key leaves the placeholder as-is, and sends NO garbage', () => {
  const out = injectSecrets({ url: 'https://x/mcp', headers: { Authorization: 'Bearer ${T}' } }, {});
  assert.deepEqual((out as { headers: unknown }).headers, { Authorization: 'Bearer ${T}' });
});

test('http: only SUPPLIED keys get replaced, unrelated keys do not leak in', () => {
  const out = injectSecrets(
    { url: 'https://x/mcp', headers: { A: '${T}', B: '${KHAC}' } },
    { T: 'ok' },
  );
  assert.deepEqual((out as { headers: unknown }).headers, { A: 'ok', B: '${KHAC}' });
});

test('http: no headers ⇒ nothing gets touched', () => {
  const cfg = { type: 'http', url: 'https://x/mcp' };
  assert.deepEqual(injectSecrets(cfg, { T: '1' }), cfg);
});

test('http: a non-string header does not crash it either', () => {
  const out = injectSecrets({ url: 'https://x/mcp', headers: { N: 5 } }, { T: '1' });
  assert.deepEqual((out as { headers: unknown }).headers, { N: '5' });
});


test('no command, no url ⇒ returned unchanged', () => {
  const cfg = { type: 'sdk', name: 'x' };
  assert.equal(injectSecrets(cfg, { A: '1' }), cfg);
});

test('null / not an object ⇒ does not throw', () => {
  assert.equal(injectSecrets(null, { A: '1' }), null);
  assert.equal(injectSecrets('string', { A: '1' }), 'string');
});


test('⭐ stdio: placeholders in `env` ARE REPLACED — path B case, bug from 08/31', () => {
  const out = injectSecrets(
    { command: 'npx', args: ['-y', 'server-memory'], env: { MEMORY_FILE_PATH: '${MEMORY_PATH}' } },
    { MEMORY_PATH: 'D:\\notebook.json' },
  ) as { env: Record<string, string> };
  assert.equal(out.env['MEMORY_FILE_PATH'], 'D:\\notebook.json');
  assert.equal(out.env['MEMORY_PATH'], 'D:\\notebook.json');
});

test('⭐ stdio: once filled in, `missingSecretRefs` must come back CLEAN — no leftover loop', () => {
  const cfg = { command: 'x', env: { P: '${A}' } };
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, { A: 'v' })), []);
  assert.deepEqual(missingSecretRefs(injectSecrets(cfg, {})), ['A']);
});

test('stdio: placeholders in `args` are replaced too', () => {
  const out = injectSecrets({ command: 'x', args: ['--token', '${T}'] }, { T: 'abc' }) as {
    args: string[];
  };
  assert.deepEqual(out.args, ['--token', 'abc']);
});

test('http: a placeholder in `url` is replaced too — the old comment here already predicted this', () => {
  const out = injectSecrets({ url: 'https://${HOST}/mcp', headers: {} }, { HOST: 'a.com' }) as {
    url: string;
  };
  assert.equal(out.url, 'https://a.com/mcp');
});

test('does not mutate in place — the original config must stay unchanged', () => {
  const cfg = { url: 'https://x/mcp', headers: { A: '${T}' } };
  injectSecrets(cfg, { T: 'secret' });
  assert.deepEqual(cfg.headers, { A: '${T}' });
});
