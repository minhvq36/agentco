
import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';

import {
  BROWSER_CANDIDATES,
  LoginError,
  findBrowser,
  loginOpen,
  profileDir,
  startLogin,
} from '../dist/core/browser-login.js';
import { BROWSER_ARM, buildConfig } from '../dist/core/catalog.js';
import { injectSecrets } from '../dist/core/secrets.js';


test('has browser candidates for ALL THREE operating systems', () => {
  for (const os of ['win32', 'darwin', 'linux']) {
    assert.ok(BROWSER_CANDIDATES[os]?.length, `missing candidate list for ${os}`);
  }
});

test('the connection channel and the sign-in window browser MATCH each other', () => {
  const chanOf = (platform: string): string | undefined => {
    const args = (buildConfig(BROWSER_ARM.spec, { folders: [], platform }) as { args: string[] }).args;
    const i = args.indexOf('--browser');
    return i >= 0 ? args[i + 1] : undefined;
  };
  assert.equal(chanOf('win32'), 'msedge');
  assert.match(BROWSER_CANDIDATES['win32']![0]!, /msedge\.exe$/i);
  assert.equal(chanOf('darwin'), 'chrome');
  assert.match(BROWSER_CANDIDATES['darwin']![0]!, /Google Chrome$/);
});

test('linux returns a COMMAND NAME, not a guessed path', () => {
  const first = findBrowser('linux');
  assert.equal(first, 'google-chrome');
  assert.ok(!first!.includes('/'), 'guessing an absolute path on Linux is the wrong guess');
});

test('unknown OS => no candidates at all, and it says so with `undefined`', () => {
  assert.equal(findBrowser('sunos'), undefined);
});


test('the sign-in window profile MATCHES the profile the connection uses at runtime', () => {
  const stateDir = path.join('C:', 'cty', 'offices', 'ke-toan', '.state', 'browser');
  const cfg = buildConfig(BROWSER_ARM.spec, {
    folders: [],
    options: (BROWSER_ARM.options ?? []).filter((o) => o.id === 'nho-dang-nhap'),
    platform: 'win32',
  });
  const { args } = injectSecrets(cfg, {}, { officeState: stateDir }) as { args: string[] };
  const cua = profileDir(stateDir);
  const canhTay = args[args.indexOf('--user-data-dir') + 1];
  assert.equal(cua, canhTay);
});


test('work in progress => REJECTED, and the message says what to do', () => {
  assert.throws(
    () =>
      startLogin({
        office: 'vp-test-working',
        officeStateDir: path.join('C:', 'tmp', 'x'),
        url: 'https://youtube.com',
        working: true,
      }),
    (e: Error) => e instanceof LoginError && /đang chạy việc/i.test(e.message), // i18n-allow-vietnamese: matches real i18n error string (default locale vi)
  );
  assert.equal(loginOpen('vp-test-working'), false, 'rejected, yet it still recorded the lock');
});

test('a URL that is not http/https => REJECTED', () => {
  for (const bad of ['file:///C:/', 'javascript:alert(1)', 'khong-phai-url']) {
    assert.throws(
      () =>
        startLogin({
          office: 'vp-test-url',
          officeStateDir: path.join('C:', 'tmp', 'x'),
          url: bad,
          working: false,
        }),
      LoginError,
      `"${bad}" slipped through`,
    );
  }
  assert.equal(loginOpen('vp-test-url'), false);
});

test('an OS with no browser => the error message names WHAT to install', () => {
  assert.throws(
    () =>
      startLogin({
        office: 'vp-test-nobrowser',
        officeStateDir: path.join('C:', 'tmp', 'x'),
        url: 'https://youtube.com',
        working: false,
        platform: 'sunos',
      }),
    (e: Error) => e instanceof LoginError && /Edge|Chrome/.test(e.message),
  );
});
