/**
 * DARK OR LIGHT. → `index.css` §TWO STATES · SPEC-ui.md §0
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 THE MACHINE DOES NOT GET A VOTE, AND THAT IS THE WHOLE DESIGN.
 * │ (user, 10/09)
 * │
 * │ The first cut had a third row — "follow the machine" — as the default, so
 * │ an install with nothing stored took `prefers-color-scheme` as its answer.
 * │ It was dropped for a reason that showed up the moment it was tested:
 * │
 * │   Ctrl+Shift+N. A private window has no storage and no extensions, so the
 * │   app fell through to whatever the browser reported and came up LIGHT —
 * │   in a product whose own colours are dark. "I cleared everything" has to
 * │   mean "back to what agentco looks like", not "back to what Windows
 * │   thinks", and those two are not the same sentence.
 * │
 * │ ⇒ NOTHING HERE READS `matchMedia`, and `index.css` carries no
 * │ `prefers-color-scheme` at all. Dark is the base palette in `@theme`, so
 * │ every path that ends in "no attribute on <html>" — blocked site data, the
 * │ inline script never running, someone opening the file by hand — still
 * │ lands on the product's own colours instead of on a guess.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * ⚠ Its own module rather than three more functions in `store.ts`, for the
 * reason the box above `LOCALE_KEY` records: `initial` calls `bootTheme()`
 * while the object literal is being built, and a `const` declared below it is
 * `undefined` at that moment. A separate module cannot have that bug — ESM
 * finishes evaluating an import before the importer's first line runs.
 */

/** ⚠ ORDER IS THE ORDER ON SCREEN, and the first one is the default. */
export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** What an install with nothing stored looks like. Not a guess — a decision. */
const DEFAULT_THEME: Theme = 'dark';

/**
 * ⚠ THIS KEY IS WRITTEN IN TWO PLACES: here, and in `web/index.html`.
 *
 * The copy in the HTML is a three-line inline script that runs BEFORE the
 * stylesheet paints anything, and it exists for exactly one case: somebody who
 * chose `light`. Without it the first paint uses the base palette (dark) and
 * the page flashes dark before swapping — the same "reads as a rendering bug,
 * not as loading" the locale mirror was built to avoid. A module cannot be that
 * script: `<script type="module">` is deferred, so it runs after the browser
 * has already had the chance to paint.
 */
const THEME_KEY = 'agentco.theme';

const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

/**
 * What the user chose last time. Missing or unreadable ⇒ `dark`.
 *
 * Same defensive shape as every other `localStorage` call in this app: a
 * private window or blocked site data costs a preference, never a white screen
 * — and here it costs nothing at all, because the fallback IS the default.
 */
export function bootTheme(): Theme {
  let theme: Theme = DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) theme = stored;
  } catch {
    /* blocked storage — dark, the same as any other install with no choice */
  }
  // Stamp it here rather than in a `useEffect`: an effect runs AFTER the first
  // render, so the app would paint once in the wrong theme on every reload.
  // The inline script in index.html has normally done this already; doing it
  // again is one attribute write and keeps this module correct on its own.
  stamp(theme);
  return theme;
}

/** Apply and remember, in that order — the screen must not wait on the disk. */
export function applyTheme(theme: Theme): void {
  stamp(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* blocked storage — this tab is right, the next reload falls back to dark */
  }
}

/**
 * ⚠ ALWAYS STAMPS, including for the default. The stylesheet does not need
 * `[data-theme='dark']` — dark is the base — but the DOM saying out loud which
 * theme is in force is what makes this debuggable from the inspector, and it
 * costs one attribute.
 */
function stamp(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}
