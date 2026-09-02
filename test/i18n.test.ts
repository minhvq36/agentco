/**
 * Interface string catalogue. → `src/i18n/` · docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT IS NOT TESTED HERE, AND WHY THAT IS THE POINT.                      │
 * │                                                                          │
 * │ There is no "every key exists in every locale" test. `vi.ts` is declared │
 * │ `: Catalog`, so a missing or extra key fails `tsc` — the gate runs       │
 * │ before this file does, and it names the key. A runtime test would be a   │
 * │ weaker copy of a check that already cannot be skipped.                   │
 * │                                                                          │
 * │ What IS worth locking is the behaviour a type cannot state: how a        │
 * │ placeholder that nobody supplied is rendered, which fallback each caller │
 * │ gets, and that a tag we ship no catalogue for is never quietly rounded   │
 * │ to one we do.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Run: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { getLocale, isLocale, plural, resolveLocale, setLocale, t, LOCALES } from '../dist/i18n/index.js';
import { formatBytes, formatUSD } from '../dist/i18n/fmt.js';

test('default locale is `vi` — every install on disk today means Vietnamese', () => {
  // Not a preference. Defaulting to English would re-language every existing
  // company.yaml on upgrade, silently, because none of them names a language.
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
  /**
   * `{file}` visible in the UI is ugly and somebody reports it. An empty gap
   * reads as a finished sentence that happens to be missing a word, and nobody
   * reports that — so the loud failure is the correct one.
   */
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

// ────────────────────────────────────────────────────────────── resolveLocale

test('resolveLocale: first candidate that names a language we ship wins', () => {
  assert.equal(resolveLocale(['en']), 'en');
  assert.equal(resolveLocale([undefined, null, 'vi-VN']), 'vi');
  assert.equal(resolveLocale(['en_US.UTF-8']), 'en');
});

test('🔴 a tag we ship NO catalogue for falls back — it is never rounded to a neighbour', () => {
  /**
   * This is the ca the plan was rewritten for. `de`, `ar`, `es` are not
   * evidence for English; they are evidence that we ship no catalogue. Rounding
   * them to `en` would be the same guess that got the knowledge-store `lang`
   * field cut. The caller states its own fallback, and the two callers differ:
   *   · loading an existing company ⇒ 'vi' (it has always been Vietnamese)
   *   · `agentco init` on a fresh machine ⇒ 'en' (nothing to preserve)
   */
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

// ───────────────────────────────────────────────────────────────────── fmt

test('⭐ formatBytes is byte-identical to the three copies it replaces', () => {
  // The same number appears in the artifacts panel, the library panel and the
  // CLI. A user seeing `48 KB` in one and `47.9 KB` in another has found a bug
  // that is not there.
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(49_152), '48 KB');
  assert.equal(formatBytes(1_468_006), '1.4 MB');
});

test('🔴 formatUSD is NOT localised, and four decimals survive', () => {
  /**
   * `Intl` with `currency: 'USD'` renders `US$0,14` under `vi-VN` — two
   * decimals, which reads as `$0.00` for the few-cent costs this app shows all
   * the time. Rounding a price to zero is not a formatting preference.
   */
  setLocale('vi');
  assert.equal(formatUSD(0.1409), '$0.1409');
  setLocale('en');
  assert.equal(formatUSD(0.1409), '$0.1409');
  setLocale('vi');
});
