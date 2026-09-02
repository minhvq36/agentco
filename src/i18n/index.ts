/**
 * Interface language for the app shell. Shared by the daemon and the web UI.
 *
 * → docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THIS SWITCH NEVER REACHES A PROMPT. NOT ONE.                          │
 * │                                                                          │
 * │ It answers "what do I want to SEE", and that is a different question     │
 * │ from "what language is this person SPEAKING". A Vietnamese user may      │
 * │ genuinely prefer an English interface — that is a normal case, not an    │
 * │ odd one. Wiring the two together forces English answers on someone who   │
 * │ only wanted an English menu.                                             │
 * │                                                                          │
 * │ So everything the SYSTEM PRODUCES — `say`, `answer`, `gist`, `lessons`,  │
 * │ the memory written on `/clear`, the contents of every artifact file —    │
 * │ follows the language the human is actually writing in, observed by the   │
 * │ model from the conversation. There is no mechanism for that, and that is │
 * │ the point: not forcing a language is what makes a Chinese user get       │
 * │ Chinese lessons without one line of code naming Chinese anywhere.        │
 * │                                                                          │
 * │ `test/no-pinned-language.test.ts` is the gate. It fails the day someone  │
 * │ passes a locale into a prompt builder again.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ THIS MODULE MUST STAY PURE — no `node:*`, no disk, no `process`. The web
 * build imports it through the `@i18n` alias, exactly as it already imports
 * `layout-geometry.ts` through `@core`, and for the same stated reason: two
 * copies of one table drift, and drift here means the daemon and the UI
 * disagree about what a button is called. Environment and OS hints are read by
 * the CALLER and handed in as plain strings.
 */

import { en, enPlural, type Catalog, type MessageKey, type PluralCatalog, type PluralKey } from './en.js';
import { vi, viPlural } from './vi.js';

export type { MessageKey, PluralKey } from './en.js';

export type Locale = 'en' | 'vi';

/** Ordered for display. Adding a language means adding its file and one entry. */
export const LOCALES: readonly Locale[] = ['vi', 'en'];

const CATALOGS: Record<Locale, Catalog> = { en, vi };
const PLURALS: Record<Locale, PluralCatalog> = { en: enPlural, vi: viPlural };

/**
 * Default `vi`, deliberately.
 *
 * agentco has only ever spoken Vietnamese, so every company.yaml already on
 * disk means Vietnamese even though it says nothing. Defaulting to English
 * would silently re-language every existing install on upgrade — and it would
 * also change what 843 tests assert, turning a migration into a rewrite. New
 * installs do not rely on this: `agentco init` resolves the OS locale and
 * writes the answer down explicitly.
 */
const DEFAULT_LOCALE: Locale = 'vi';

let current: Locale = DEFAULT_LOCALE;

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
}

/** True for a value that is one of the locales we actually ship a catalogue for. */
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'vi';
}

/**
 * First candidate that names a language we ship, else `fallback`.
 *
 * Candidates are BCP-47-ish tags from wherever the caller found them:
 * `company.yaml`, `AGENTCO_LANGUAGE`, `navigator.language`, an OS locale.
 *
 * ⚠ Returns `fallback` — never a guess — for a tag we have no catalogue for.
 * A German tag is not evidence for English; it is evidence that we do not ship
 * German. The two callers want different fallbacks and say so:
 *   · loading an existing company ⇒ 'vi'  (it has always been Vietnamese)
 *   · `agentco init` on a fresh machine ⇒ 'en'  (nothing to preserve)
 */
export function resolveLocale(
  candidates: readonly (string | null | undefined)[],
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return fallback;
}

function matchLocale(value: string | null | undefined): Locale | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().replace(/_/g, '-');
  if (tag === 'vi' || tag.startsWith('vi-')) return 'vi';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

export type Params = Readonly<Record<string, string | number>>;

/**
 * One app string, in the current interface language.
 *
 * No runtime fallback to another catalogue on a missing key: `vi.ts` is typed
 * `: Catalog`, so a gap is a compile error. A fallback here would convert that
 * loud failure into a silent one — the screen would read English inside a
 * Vietnamese sentence and nothing would say why.
 */
export function t(key: MessageKey, params?: Params): string {
  return interpolate(CATALOGS[current][key], params);
}

/**
 * The ENGLISH form of a string, whatever the interface switch says.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FOR TEXT THAT GOES INTO A PROMPT, and only for that.                     │
 * │                                                                          │
 * │ A few strings are read by BOTH audiences: a connection's option label is │
 * │ a chip in the dialog (follows the switch) and a clause on the arm's line │
 * │ in the assistant's prefix (must be English, always — → the box at the    │
 * │ top of this file). Keeping two literals for one label is how the two     │
 * │ drift; one key with two readers cannot.                                  │
 * │                                                                          │
 * │ ⚠ This is NOT a hole in the blocking rule. `t()` reads the switch and    │
 * │ `tEn()` cannot — so a prompt built from `tEn` says the same thing for    │
 * │ every user, which is exactly what the rule asks for.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function tEn(key: MessageKey, params?: Params): string {
  return interpolate(en[key], params);
}

/** A counted string. `{n}` is filled from `count`; extra `params` still apply. */
export function plural(key: PluralKey, count: number, params?: Params): string {
  const forms = PLURALS[current][key];
  const form = count === 1 ? forms.one : forms.other;
  return interpolate(form, { n: count, ...params });
}

/**
 * `{name}` ⇒ value.
 *
 * An unknown placeholder is left standing rather than blanked. `{file}` sitting
 * in the UI is ugly and someone reports it; an empty gap reads as a finished
 * sentence that happens to be missing a word, and nobody reports that.
 */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
