import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/**
 * THE THEME'S DETERMINISTIC HALF. → `web/src/index.css` · `web/src/lib/theme.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ TWO INVARIANTS, AND THE FIRST ONE IS A PRODUCT DECISION, NOT TIDINESS.
 * │
 * │ ① THE MACHINE DOES NOT GET A VOTE. (user, 10/09) Dark is what agentco
 * │   looks like; `prefers-color-scheme` is what the operating system happens
 * │   to be set to this week, and the two are not the same question. The first
 * │   cut conflated them and it showed up in a private window: Ctrl+Shift+N
 * │   has no storage and no extensions, so the app fell through to the browser
 * │   and came up LIGHT. This file fails the day a media query reappears.
 * │
 * │ ② EVERY TOKEN EXISTS IN BOTH PALETTES. A token added to `@theme` and
 * │   nowhere else keeps its DARK value on a light ground — the black-bubble
 * │   bug from the other side, where `--color-danger-soft` was missed out of a
 * │   hand-kept list and only surfaced the day a task failed. A hand-kept list
 * │   cannot notice a token that arrives later; this can.
 * │
 * │ ⚠ It reads the stylesheet as TEXT rather than parsing it, for the same
 * │ reason `office-view.test.ts` reads `art/furniture.ts` as text: `node
 * │ --test` cannot load a Tailwind stylesheet. Every premise the regexes rest
 * │ on is asserted, so a rewrite of the file fails loudly here instead of
 * │ quietly passing against nothing.
 * └──────────────────────────────────────────────────────────────────────────
 */

const ROOT = url.fileURLToPath(new URL('..', import.meta.url));
const css = fs.readFileSync(path.join(ROOT, 'web', 'src', 'index.css'), 'utf8');

/** Every `--color-…: value` pair inside one `{ … }` body, in source order. */
function tokens(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--color-[a-z-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/**
 * The body of the first rule whose selector matches.
 *
 * ⚠ `selector.flags` is carried over, not dropped — the `m` on a selector
 * anchored with `^` is what makes it mean "start of a line" rather than "start
 * of the file".
 */
function block(selector: RegExp, what: string): string {
  const m = new RegExp(selector.source + String.raw`\s*\{([\s\S]*?)\n\s*\}`, selector.flags).exec(css);
  assert.ok(m, `premise: ${what} is no longer where this test looks for it`);
  return m[1]!;
}

const dark = tokens(block(/@theme/, 'the @theme block holding the dark base palette'));
const light = tokens(block(/^:root\[data-theme='light'\]/m, 'the light override block'));

test('premise: both palettes were actually found', () => {
  // Without this the comparisons below would happily compare two empty maps and
  // report that everything agrees.
  assert.ok(dark.size > 10, `the dark base read ${dark.size} tokens`);
  assert.ok(light.size > 10, `the light override read ${light.size} tokens`);
});

test('🔴 DARK IS THE BASE — the default is a decision, not the machine', () => {
  /**
   * `@theme` is what applies when `<html>` carries no `data-theme` at all:
   * blocked site data, a private window, the inline script never running,
   * someone opening the file by hand. Every one of those paths has to land on
   * the product's own colours. Checked by a token whose two values are nowhere
   * near each other rather than by counting: `paper` is the page itself.
   */
  assert.equal(dark.get('--color-paper'), '#16150f', 'the base palette is not the dark one');
  assert.equal(light.get('--color-paper'), '#fbfaf8', 'the override block is not the light one');
});

test('🔴 NO `prefers-color-scheme` anywhere in the stylesheet', () => {
  // The gate for ① above. It is one line to add and it silently hands the
  // decision back to the operating system — the exact regression that produced
  // a light app out of Ctrl+Shift+N.
  assert.ok(
    !/@media\s*\(\s*prefers-color-scheme/.test(css),
    'a prefers-color-scheme media query is back: the machine is voting again',
  );
});

test('🔴 every token exists in BOTH palettes', () => {
  const missingLight = [...dark.keys()].filter((k) => !light.has(k)).sort();
  const orphanLight = [...light.keys()].filter((k) => !dark.has(k)).sort();
  assert.deepEqual(missingLight, [], `keep their DARK value on light paper: ${missingLight.join(', ')}`);
  // The other direction: a light-only token compiles to nothing at all, because
  // Tailwind only emits utilities for names `@theme` declares.
  assert.deepEqual(orphanLight, [], `declared only in light: ${orphanLight.join(', ')}`);
});

test('🔴 the two palettes do not share a value — a token that never changes is a bug', () => {
  // Not tidiness: an identical pair means somebody pasted the dark value into
  // the light block (or the reverse) and it will read as dark-on-dark exactly
  // once, on whichever theme they were not looking at.
  const same = [...dark].filter(([k, v]) => light.get(k) === v).map(([k]) => k);
  assert.deepEqual(same, [], `identical in both themes: ${same.join(', ')}`);
});

test('🔴 `color-scheme` is stated for both states, and is never `light dark`', () => {
  /**
   * It is what the BROWSER paints from — scrollbars, form controls — and what
   * `light-dark()` reads, which `lib/colors.ts` uses for every agent's colour
   * in the log. `light dark` hands that question back to the machine, which is
   * the one thing this design refuses to do.
   */
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*dark\s*;/);
  assert.match(css, /:root\[data-theme='light'\]\s*\{[^}]*color-scheme:\s*light\s*;/);
  assert.ok(!/color-scheme:\s*light dark/.test(css), 'color-scheme must name ONE of the two');
});

test('🔴 index.html stamps the SAME storage key `lib/theme.ts` writes', () => {
  /**
   * The inline script exists to beat the first paint, and it cannot import the
   * module that owns the key — a `type="module"` script is deferred, which is
   * the very problem it is there to solve. So the key is duplicated, and a
   * rename would leave the app working perfectly while flashing dark on every
   * reload for anyone who chose light: nothing throws, nothing logs, and the
   * only symptom is a flicker somebody eventually calls a rendering bug.
   */
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  const ts = fs.readFileSync(path.join(ROOT, 'web', 'src', 'lib', 'theme.ts'), 'utf8');

  const key = /const THEME_KEY = '([^']+)'/.exec(ts);
  assert.ok(key, 'premise: THEME_KEY is no longer a plain string literal in theme.ts');
  assert.ok(
    html.includes(`localStorage.getItem('${key[1]}')`),
    `index.html does not read '${key[1]}' — the pre-paint stamp is reading a dead key`,
  );
});

test('🔴 the server\'s "not built yet" page does not ask the machine either', () => {
  // It cannot read the user's choice (there is no bundle yet — that is why it
  // is showing), so it has to use the DEFAULT. Asking `prefers-color-scheme`
  // there would land it somewhere the app itself never lands.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'server', 'static.ts'), 'utf8');
  assert.ok(!/@media\s*\(\s*prefers-color-scheme/.test(src), 'the fallback page is following the machine');
  assert.ok(/background:#16150f/.test(src), 'the fallback page is not on the dark ground');
});
