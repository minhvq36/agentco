/**
 * 🔴 THE INTERFACE NEVER SENT THE TOKEN, AND NOTHING SAID SO. (found 17/09/2026)
 *
 * `serve()` refuses to bind anywhere but loopback without a token, and a
 * container has to bind `0.0.0.0`. So Docker makes the token mandatory — while
 * `web/src/lib/api.ts` sent no `x-agentco-token` anywhere, and `store.ts` opened
 * `new EventSource('/api/events')`, which cannot send a header at all. The page
 * would have loaded (static files are not gated) and then every call would have
 * answered 401, with a blank interface and no sentence pointing anywhere.
 * → docs/SPEC-deploy.md §3.1
 *
 * ⚠ THE WEB HALF IS ASSERTED AS TEXT, the same call as `update-door.test.ts`:
 * running it needs a DOM and a bundle, `npm test` builds neither, and on CI
 * `npm test` runs BEFORE `build:all`. The rule — "anything the BROWSER fetches
 * by itself carries the token in its query string" — is a shape, and a shape can
 * be checked anywhere.
 *
 * ⚠ Everything here is synchronous. The runner cancels pending tests whenever
 * the event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { injectToken } from '../dist/server/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HEAD = '<!doctype html>\n<html lang="vi">\n  <head>\n    <meta charset="utf-8" />\n  </head>\n  <body></body>\n</html>';

test('🔴 no token means the page is served exactly as it was before', () => {
  /*
   * The desktop install is the normal case and it has no token. If this branch
   * ever starts rewriting HTML for everybody, the cost lands on the 99% who
   * gained nothing from the feature.
   */
  assert.equal(injectToken(HEAD, undefined), HEAD);
  assert.equal(injectToken(HEAD, ''), HEAD);
});

test('the token is stamped in before anything can read it', () => {
  const out = injectToken(HEAD, 'abc123');

  assert.match(out, /window\.__AGENTCO_TOKEN__="abc123"/, out);
  // Immediately after <head>: ahead of the theme script, and far ahead of the
  // deferred module bundle. Anything later is a race nobody would reproduce.
  assert.match(out, /<head><script>window\.__AGENTCO_TOKEN__/, out);
  // The rest of the document is untouched.
  assert.ok(out.includes('<meta charset="utf-8" />'), out);
  assert.equal(out.replace(/<script>window[^<]*<\/script>/, ''), HEAD);
});

test('🔴 a token cannot break out of the script element', () => {
  /*
   * `JSON.stringify` escapes quotes and backslashes and leaves `<` alone, which
   * is safe in JSON and wrong inside `<script>`: the HTML parser looks for the
   * literal `</script` and stops there, whatever the JavaScript around it means.
   * AGENTCO_TOKEN is set by whoever wrote the compose file, so this is not a
   * hostile-input case — it is the case where somebody pastes something odd and
   * gets a blank page with no explanation.
   */
  const nasty = '</script><img src=x onerror=alert(1)>';
  const out = injectToken(HEAD, nasty);
  assert.ok(!out.includes('</script><img'), out);
  assert.match(out, /\\u003c\/script/, out);
  // Still exactly one script element.
  assert.equal(out.match(/<\/script>/g)?.length, 1, out);
});

test('a build with no <head> is served anyway, and says what is wrong', () => {
  // Refusing would turn a broken page into no page. The sentence is the point.
  const errors: unknown[][] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.equal(injectToken('<html><body>x</body></html>', 'abc'), '<html><body>x</body></html>');
  } finally {
    console.error = real;
  }
  assert.equal(errors.length, 1, 'nothing was said about a page that will 401 forever');
  assert.match(String(errors[0]?.[0]), /token/i);
});

test('🔴 every `/api/` url the BROWSER fetches itself carries the token', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────
   * │ THE GATE, not the fix. `api.ts` funnels its calls through `call()`,
   * │ which sets a header — that road is safe by construction. The danger is
   * │ the NEXT url written somewhere else: an `<img src>`, a download link, a
   * │ second EventSource. Those are the browser fetching on its own behalf,
   * │ headers are not available, and the failure is silent under Docker and
   * │ invisible on a developer's loopback machine.
   * │
   * │ ⚠ Comment lines are skipped, exactly as `scripts/check-language.ts`
   * │ does: this very file's own prose names `/api/events`, and a gate that
   * │ tripped over documentation would be turned off within the week.
   * └────────────────────────────────────────────────────────────────────────
   */
  const EXEMPT = new Set([path.join('lib', 'api.ts'), path.join('lib', 'token.ts')]);
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(path.join(ROOT, 'web', 'src'), p);
      if (EXEMPT.has(rel)) continue;

      fs.readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (!/['"`]\/api\//.test(code)) return;
          if (code.includes('withToken')) return;
          offenders.push(`web/src/${rel}:${i + 1}  ${code}`);
        });
    }
  };
  walk(path.join(ROOT, 'web', 'src'));

  assert.deepEqual(
    offenders,
    [],
    `these build an /api/ url without withToken — under Docker they answer 401:\n${offenders.join('\n')}`,
  );
});

test('the one url the browser loads by itself is the artifact url, and it is wrapped', () => {
  // `<img src>`, `<video src>`, `<object data>`, `<a href download>` all take
  // this. Being the single producer is what makes the rule checkable at all.
  const api = read('web/src/lib/api.ts');
  assert.match(api, /artifactUrl:[\s\S]{0,120}withToken\(/, 'artifactUrl no longer carries the token');

  const store = read('web/src/lib/store.ts');
  assert.match(store, /new EventSource\(withToken\(/, 'the event stream no longer carries the token');
});

test('the query-string form is confined to `/api/`, where the gate actually is', () => {
  /*
   * `server.ts §707` gates `/api/` and nothing else. Putting the token on a
   * static asset would spend it on a request that never needed it — and land it
   * in any cache or access log sitting in front of those assets. That is the
   * property that makes tier C (a public domain) a different decision, not a
   * bigger version of this one. → SPEC-deploy §3.1
   */
  const token = read('web/src/lib/token.ts');
  assert.match(token, /url\.startsWith\('\/api\/'\)/, token);
});
