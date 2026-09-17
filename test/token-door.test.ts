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

import { injectBoot } from '../dist/server/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HEAD = '<!doctype html>\n<html lang="vi">\n  <head>\n    <meta charset="utf-8" />\n  </head>\n  <body></body>\n</html>';

test('🔴 no token means the page is served exactly as it was before', () => {
  /*
   * The desktop install is the normal case and it has no token. If this branch
   * ever starts rewriting HTML for everybody, the cost lands on the 99% who
   * gained nothing from the feature.
   */
  assert.equal(injectBoot(HEAD, { token: undefined, sameMachine: true }), HEAD);
  assert.equal(injectBoot(HEAD, { token: '', sameMachine: true }), HEAD);
  /*
   * ⚠ INCLUDING WHEN `sameMachine` IS FALSE, which cannot actually happen and
   * is asserted anyway: `serve()` refuses to bind anywhere but loopback without
   * a token, so a tokenless daemon only ever serves local connections. If that
   * invariant is ever broken, the interface would silently default to `true` —
   * so this line is here to make the impossible case explicit rather than
   * merely absent. → [[agentco-deterministic-vs-signal]]
   */
  assert.equal(injectBoot(HEAD, { token: undefined, sameMachine: false }), HEAD);
});

test('the token is stamped in before anything can read it', () => {
  const out = injectBoot(HEAD, { token: 'abc123', sameMachine: true });

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
  const out = injectBoot(HEAD, { token: nasty, sameMachine: true });
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
    assert.equal(
      injectBoot('<html><body>x</body></html>', { token: 'abc', sameMachine: true }),
      '<html><body>x</body></html>',
    );
  } finally {
    console.error = real;
  }
  assert.equal(errors.length, 1, 'nothing was said about a page that will 401 forever');
  assert.match(String(errors[0]?.[0]), /token/i);
});

test('🔴 the page also arrives holding WHO CONNECTED, because the interface cannot know', () => {
  /*
   * ┌────────────────────────────────────────────────────────────────────────
   * │ Found by a real test through the Docker door, 18/09/2026: "Show the
   * │ browser window" was offered, PRE-TICKED, and the server then refused it.
   * │
   * │   the interface asked   window.location.hostname   -> "127.0.0.1" -> yes
   * │   the server asked      req.socket.remoteAddress   -> the bridge   -> no
   * │
   * │ Both were answering "are we on the same machine", and under Docker they
   * │ disagreed — which is the only configuration where the question matters.
   * │ A hostname describes the URL; a socket address describes who connected.
   * └────────────────────────────────────────────────────────────────────────
   */
  const yes = injectBoot(HEAD, { token: 't', sameMachine: true });
  const no = injectBoot(HEAD, { token: 't', sameMachine: false });

  assert.match(yes, /window\.__AGENTCO_SAME_MACHINE__=true/, yes);
  assert.match(no, /window\.__AGENTCO_SAME_MACHINE__=false/, no);
  // One script element, both facts — a second tag is a second thing to order.
  assert.equal(no.match(/<script>/g)?.length, 1, no);
  assert.match(no, /<head><script>window\.__AGENTCO_TOKEN__/, no);
});

test('⭐ the interface never works out `sameMachine` for itself', () => {
  /*
   * THE GATE, not the fix. The fix is one line in `ArmDialog.tsx`; the danger
   * is the NEXT place somebody needs this fact and reaches for the address bar
   * again, because that is the obvious thing to reach for and it is right on
   * every machine a developer owns. It is wrong only under Docker, which is
   * precisely where nobody is looking. → `lib/token.ts §SAME_MACHINE`
   */
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(e.name)) continue;
      fs.readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          // Comment lines are documentation, including this rule's own retelling.
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (!/location\.hostname/.test(code)) return;
          offenders.push(`web/src/${path.relative(path.join(ROOT, 'web', 'src'), p)}:${i + 1}  ${code}`);
        });
    }
  };
  walk(path.join(ROOT, 'web', 'src'));

  assert.deepEqual(
    offenders,
    [],
    `these decide "same machine" from the URL, which says 127.0.0.1 under Docker:\n${offenders.join('\n')}`,
  );

  // And the two screens that ask the question read the server's answer.
  assert.match(read('web/src/components/ArmDialog.tsx'), /SAME_MACHINE/, 'ArmDialog stopped reading it');
  assert.match(read('web/src/components/Inspector.tsx'), /SAME_MACHINE/, 'the sign-in panel stopped reading it');
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
