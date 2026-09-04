
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { getLocale, isLocale, plural, resolveLocale, setLocale, t, LOCALES } from '../dist/i18n/index.js';
import { formatBytes, formatUSD } from '../dist/i18n/fmt.js';

test('default locale is `vi` — every install on disk today means Vietnamese', () => {
  assert.equal(getLocale(), 'vi');
});

test('⭐ the same key returns different text per locale, and both are real', () => {
  setLocale('vi');
  assert.equal(t('sidebar.chat'), 'Nói với Trợ lý'); // i18n-allow-vietnamese: this IS the string under test
  setLocale('en');
  assert.equal(t('sidebar.chat'), 'Talk to the assistant');
  setLocale('vi');
});

test('⭐ an unsupplied placeholder is LEFT STANDING, not blanked', () => {
  setLocale('en');
  assert.equal(t('settings.language', {}), 'Interface language');
  assert.match(plural('artifacts.count', 2, {}), /^2 results$/);
});

test('plural: English splits, Vietnamese does not — and `{n}` is filled either way', () => {
  setLocale('en');
  assert.equal(plural('artifacts.count', 1), '1 result');
  assert.equal(plural('artifacts.count', 5), '5 results');
  setLocale('vi');
  assert.equal(plural('artifacts.count', 1), plural('artifacts.count', 5).replace('5', '1'));
  assert.match(plural('artifacts.count', 5), /^5 /);
});


test('resolveLocale: first candidate that names a language we ship wins', () => {
  assert.equal(resolveLocale(['en']), 'en');
  assert.equal(resolveLocale([undefined, null, 'vi-VN']), 'vi');
  assert.equal(resolveLocale(['en_US.UTF-8']), 'en');
});

test('🔴 a tag we ship NO catalogue for falls back — it is never rounded to a neighbour', () => {
  assert.equal(resolveLocale(['de-DE'], 'vi'), 'vi');
  assert.equal(resolveLocale(['ar'], 'en'), 'en');
  assert.equal(resolveLocale(['es-ES', 'zh-Hans'], 'en'), 'en');
  assert.equal(resolveLocale([], 'vi'), 'vi');
});

test('resolveLocale: a real tag still wins over the fallback that follows it', () => {
  assert.equal(resolveLocale(['de-DE', 'vi-VN'], 'en'), 'vi');
});

test('isLocale / LOCALES agree on exactly what we ship', () => {
  assert.deepEqual([...LOCALES].sort(), ['en', 'vi']);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('de'), false);
  assert.equal(isLocale(undefined), false);
});


test('⭐ formatBytes is byte-identical to the three copies it replaces', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(49_152), '48 KB');
  assert.equal(formatBytes(1_468_006), '1.4 MB');
});

test('🔴 formatUSD is NOT localised, and four decimals survive', () => {
  setLocale('vi');
  assert.equal(formatUSD(0.1409), '$0.1409');
  setLocale('en');
  assert.equal(formatUSD(0.1409), '$0.1409');
  setLocale('vi');
});
