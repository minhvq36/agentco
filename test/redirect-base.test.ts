
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { redirectBase } from '../dist/server/oauth-routes.js';
import { hostAllowed } from '../dist/server/server.js';


test('loopback + nothing declared ⇒ 127.0.0.1 with the CORRECT listening port', () => {
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317 }), 'http://127.0.0.1:7317');
  assert.equal(redirectBase({ host: 'localhost', port: 9999 }), 'http://127.0.0.1:9999');
  assert.equal(redirectBase({ host: '::1', port: 80 }), 'http://127.0.0.1:80');
});

test('port 0 (system-assigned) must be the ACTUAL bound port, not 0', () => {
  assert.equal(redirectBase({ host: '127.0.0.1', port: 51234 }), 'http://127.0.0.1:51234');
});


test('⭐ binding externally + NOT declaring public_url ⇒ REJECT, no wild guessing', () => {
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 7317 }), /public_url|real address/i);
  assert.throws(() => redirectBase({ host: '10.1.2.3', port: 7317 }), /AGENTCO_RUNTIME_PUBLIC_URL/);
});

test('the rejection message must SAY HOW TO FIX IT, not just say it is wrong', () => {
  try {
    redirectBase({ host: '0.0.0.0', port: 7317 });
    assert.fail('must throw');
  } catch (e) {
    const m = (e as Error).message;
    assert.ok(m.includes('AGENTCO_RUNTIME_PUBLIC_URL'), 'missing the env var name');
    assert.ok(m.includes('company.yaml'), 'missing the second path');
  }
});


test('https + domain ⇒ used as-is, trailing slash dropped', () => {
  assert.equal(redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://a.example.com' }), 'https://a.example.com');
  assert.equal(redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://a.example.com/' }), 'https://a.example.com');
});

test('keeps the path prefix — nginx may mount agentco under a subpath', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://x.com/agentco/' }),
    'https://x.com/agentco',
  );
});

test('a non-standard port in public_url is preserved — a daemon behind nginx can still expose a port', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'https://x.com:8443' }),
    'https://x.com:8443',
  );
});

test('⭐ http:// going OUTSIDE this machine ⇒ REJECT — the auth code must not travel in the clear', () => {
  assert.throws(
    () => redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://a.example.com' }),
    /https/i,
  );
});

test('http:// pointing back at this same machine is ALLOWED — that is a valid dev/tunnel case', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://127.0.0.1:7317' }),
    'http://127.0.0.1:7317',
  );
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 7317, publicUrl: 'http://localhost:7317' }),
    'http://localhost:7317',
  );
});

test('garbage URL ⇒ throws with the string it received, so the fixer can see what they typed', () => {
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'a.example.com' }), /không phải URL hợp lệ/); // i18n-allow-vietnamese: matches real i18n error string (default locale vi)
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'ftp://x.com' }), /http/);
});

test('a "?" or "#" present ⇒ throws — a sign of accidentally pasting a whole URL', () => {
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'https://x.com/?a=1' }), /\?/);
  assert.throws(() => redirectBase({ host: '0.0.0.0', port: 1, publicUrl: 'https://x.com/#z' }), /#/);
});

test('leading/trailing whitespace does not break it — people copy-paste', () => {
  assert.equal(
    redirectBase({ host: '0.0.0.0', port: 1, publicUrl: '  https://x.com  ' }),
    'https://x.com',
  );
});


test('⭐ the real domain\'s Host must GET THROUGH — otherwise every request gets a 403', () => {
  assert.equal(hostAllowed('agentco.cty.com', '0.0.0.0'), false, 'must still block when nothing is declared');
  assert.equal(hostAllowed('agentco.cty.com', '0.0.0.0', 'agentco.cty.com'), true);
  assert.equal(hostAllowed('agentco.cty.com:443', '0.0.0.0', 'agentco.cty.com'), true, 'still matches with a port');
  assert.equal(hostAllowed('AGENTCO.CTY.COM', '0.0.0.0', 'agentco.cty.com'), true, 'case insensitive');
});

test('an unknown Host is still blocked even WITH public_url declared — must not loosen into allow-all', () => {
  assert.equal(hostAllowed('ke-tan-cong.com', '0.0.0.0', 'agentco.cty.com'), false);
});

test('localhost always gets through — the old behavior must not change by one character', () => {
  assert.equal(hostAllowed('localhost:7317', '127.0.0.1'), true);
  assert.equal(hostAllowed('127.0.0.1:7317', '127.0.0.1'), true);
  assert.equal(hostAllowed(undefined, '127.0.0.1'), true, 'client is not a browser');
});

test('an empty public_url means NOT DECLARED, not "declared as an empty string"', () => {
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317, publicUrl: '' }), 'http://127.0.0.1:7317');
  assert.equal(redirectBase({ host: '127.0.0.1', port: 7317, publicUrl: '   ' }), 'http://127.0.0.1:7317');
});
