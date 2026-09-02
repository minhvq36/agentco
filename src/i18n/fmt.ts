/**
 * Dates, numbers, sizes and money — one implementation, both sides of the wire.
 *
 * → docs/CLAUDE.md §Language
 *
 * Before this file the codebase had `'vi-VN'` written out at eleven call sites,
 * two competing date paths (`toLocaleTimeString` in one panel, hand-rolled
 * zero-padding in another), and `formatBytes` copied into three files — one of
 * which carries a comment admitting the copy and asking that they be kept in
 * step by hand. A locale switch cannot be threaded through that shape, so the
 * duplication has to go first.
 *
 * ⚠ PURE — no `node:*`, no disk, no `process`. Imported by the web build through
 * the `@i18n` alias. `Intl` is standard in both runtimes.
 */

import { getLocale, type Locale } from './index.js';

/** The tag handed to `Intl`. Separate from `Locale` so `vi` never leaks into a UI API. */
const BCP47: Record<Locale, string> = { en: 'en-US', vi: 'vi-VN' };

function tag(locale?: Locale): string {
  return BCP47[locale ?? getLocale()];
}

/** `14:05` */
export function formatTime(date: Date, locale?: Locale): string {
  return date.toLocaleTimeString(tag(locale), { hour: '2-digit', minute: '2-digit' });
}

/**
 * `14:05:09` — the log gutter, and the only place the second is shown.
 *
 * `hour12: false` on purpose, in every language: log lines are read as an
 * ordered column, and a 12-hour clock puts an `AM`/`PM` of varying width in a
 * fixed-width gutter, which breaks the alignment that makes the column skimmable.
 */
export function formatTimeOfDay(date: Date, locale?: Locale): string {
  return date.toLocaleTimeString(tag(locale), { hour12: false });
}

/** `03/09` — day and month, no year. Used where the year is obvious from context. */
export function formatDate(date: Date, locale?: Locale): string {
  return date.toLocaleDateString(tag(locale), { day: '2-digit', month: '2-digit' });
}

/** `03/09 14:05` */
export function formatDateTime(date: Date, locale?: Locale): string {
  return date.toLocaleString(tag(locale), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Weekday, short form. */
export function formatWeekday(date: Date, locale?: Locale): string {
  return date.toLocaleDateString(tag(locale), { weekday: 'short' });
}

/** Grouped digits: `12,345` in English, `12.345` in Vietnamese. */
export function formatNumber(value: number, locale?: Locale): string {
  return value.toLocaleString(tag(locale));
}

/**
 * `$0.1409` — four decimals, always, and deliberately NOT localised.
 *
 * ⚠ Three reasons this one stays fixed while everything else in this file moves:
 *
 *  ① `Intl.NumberFormat(…, { currency: 'USD' })` renders `US$0,14` under `vi-VN`
 *    — two decimals, which reads as `$0.00` for the few-cent costs this app
 *    shows constantly. Rounding a price to zero is not a formatting preference.
 *  ② The currency is not a display choice. Anthropic bills USD; showing a
 *    localised symbol would imply a conversion that never happened.
 *  ③ These exact figures are quoted to four places all over `docs/` and in
 *    measurement notes. A number that reads differently from the spec that
 *    records it costs more than the grouping it would buy.
 *
 * `locale` is accepted so call sites do not have to special-case this one
 * function, and ignored on purpose.
 */
export function formatUSD(value: number, _locale?: Locale): string {
  return `$${value.toFixed(4)}`;
}

/**
 * `512 B` · `48 KB` · `1.4 MB`
 *
 * ⚠ Must stay byte-identical to what shipped before, because the same number is
 * shown in the artifacts panel, the library panel and the CLI, and a user who
 * sees `48 KB` in one place and `47.9 KB` in another has found a bug that is
 * not there. The three copies this replaces all rounded exactly this way.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
