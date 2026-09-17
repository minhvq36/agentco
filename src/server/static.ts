/**
 * Serving the built interface (`web/dist`). → docs/SPEC-ui.md §0
 *
 * The interface is a pre-built React app, not HTML strings in the source any
 * more. The daemon just hands out static files — no SSR, no server-side router.
 *
 * When it has not been built, do NOT return a bare 404: print the exact command
 * to run. Anyone cloning the repo for the first time lands in precisely this
 * state, and a blank page here is the fastest way to make them think the
 * product is broken.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLocale, t } from '../i18n/index.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

let cachedRoot: string | null | undefined;

/** `dist/server/static.js` → the package root. Correct from `dist/` and from `src/`. */
function webRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../web/dist', '../../../web/dist']) {
    const candidate = path.resolve(here, rel);
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      cachedRoot = candidate;
      return cachedRoot;
    }
  }
  cachedRoot = null;
  return null;
}

/**
 * Is the bundle being served OLDER than the interface source? → `cmdStart`
 *
 * The daemon serves `web/dist`, so editing `web/src` and forgetting to build
 * means the browser downloads the old version — and all three natural reflexes
 * (Ctrl+Shift+R, restarting the daemon, Ctrl+C) touch nothing that rebuilds. A
 * real user hit this on 20/08 and concluded they had done something wrong. An
 * `mtime` comparison costs a few milliseconds and says it out loud.
 */
export function webBuildStale(): boolean {
  const root = webRoot();
  if (!root) return false;
  const src = path.resolve(root, '../src');
  if (!fs.existsSync(src)) return false; // installed from npm — no source tree
  const newest = (dir: string): number => {
    let max = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      max = Math.max(max, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
    }
    return max;
  };
  try {
    return newest(src) > newest(root);
  } catch {
    return false;
  }
}

/**
 * Stamp the daemon's token into the page that is about to be served.
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 THE INTERFACE CANNOT ASK FOR THIS, SO THE PAGE ARRIVES HOLDING IT.
 * │
 * │ Under Docker the daemon binds `0.0.0.0`, which `serve()` refuses without a
 * │ token — so every `/api/` call needs one. But the interface has no door to
 * │ fetch it through: any such endpoint would itself sit behind the gate, and
 * │ one that did not would hand the token to anyone who asked.
 * │
 * │ ⇒ the only party that can both prove it should know and deliver it is the
 * │ daemon serving the HTML. Nothing is stored, nothing is in the URL, nothing
 * │ survives the tab; a reload re-reads it from a daemon that had to be
 * │ reachable for the page to exist at all.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * ⚠ IT GOES RIGHT AFTER `<head>`, ahead of the theme script and far ahead of
 * the deferred module bundle, so it is set before any code can read it.
 *
 * ⚠ ESCAPED AS A JS STRING **and** past `<`. `JSON.stringify` alone is not
 * enough inside a `<script>`: a token containing `</script>` would close the
 * element and the rest would land on the page as markup.
 */
export interface BootFacts {
  /** `AGENTCO_TOKEN`, when there is one. No token ⇒ nothing is injected at all. */
  token?: string | undefined;
  /**
   * Did this request arrive from the machine running the daemon —
   * `isLoopback(req.socket.remoteAddress)`, computed by the caller because only
   * it holds the socket.
   *
   * ┌────────────────────────────────────────────────────────────────────────
   * │ 🔴 THE INTERFACE USED TO WORK THIS OUT ITSELF, AND UNDER DOCKER IT WAS
   * │ WRONG. (found by a real test, 18/09/2026)
   * │
   * │ `ArmDialog.tsx` asked its own address bar — `window.location.hostname`.
   * │ Open the container at `127.0.0.1:7319` and that answers "same machine",
   * │ so "Show the browser window" appeared PRE-TICKED and the server then
   * │ refused it, because the server reads the SOCKET and sees the Docker
   * │ bridge. Two mechanisms answering one question, disagreeing exactly where
   * │ it mattered — and the user meets the disagreement as an error message
   * │ after the click. → [[agentco-count-mechanisms]]
   * │
   * │ The socket is the only answer that cannot be faked, and only the daemon
   * │ can see it. So the page arrives already holding it, like the token.
   * └────────────────────────────────────────────────────────────────────────
   */
  sameMachine: boolean;
}

export function injectBoot(html: string, boot: BootFacts): string {
  /*
   * ⚠ NO TOKEN ⇒ NOTHING INJECTED, and `sameMachine` is not an exception.
   * A daemon with no token is bound to loopback — `serve()` refuses otherwise —
   * so every connection it is capable of serving IS local, and the interface's
   * default of `true` is not an optimistic guess but the only possible answer.
   * The desktop install keeps serving exactly the bytes it served before.
   */
  const token = boot.token;
  if (!token) return html;
  /*
   * ⚠ ONE RULE FOR THREE CHARACTERS, AND THEY ARE WRITTEN AS ESCAPES ON PURPOSE.
   * `<` ends the script element as far as the HTML parser is concerned, whatever
   * the JavaScript around it means. U+2028 and U+2029 are line terminators to a
   * JS parser — and writing those two LITERALLY here is what broke this file on
   * the first attempt: TypeScript read them as newlines and the string never
   * closed. The defect and the defence were the same character.
   */
  const literal = JSON.stringify(token).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const tag =
    `<script>window.__AGENTCO_TOKEN__=${literal};` +
    `window.__AGENTCO_SAME_MACHINE__=${boot.sameMachine ? 'true' : 'false'}</script>`;
  const head = html.indexOf('<head>');
  if (head < 0) {
    /*
     * A build with no `<head>` is broken, but failing the request would turn a
     * broken page into no page. Serve it and SAY SO — the symptom otherwise is
     * a blank interface and 401s with nothing pointing here.
     */
    console.error('agentco: index.html has no <head> — the interface will not receive its token');
    return html;
  }
  return html.slice(0, head + 6) + tag + html.slice(head + 6);
}

/** Returns true when the request has been handled. */
export function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  boot: BootFacts = { sameMachine: true },
): boolean {
  const root = webRoot();
  if (!root) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notBuilt());
    return true;
  }

  // SPA: every path that is not a file resolves to index.html.
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, rel);

  // Block path traversal: this path came from a URL, so it is not trusted.
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
    res.writeHead(403).end();
    return true;
  }

  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
  const ext = path.extname(file).toLowerCase();

  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Vite assets carry a hash in the filename -> caching them forever is safe.
    // index.html does not, so it must always be revalidated; otherwise someone
    // upgrades agentco and keeps running the old bundle with no idea why.
    'cache-control': /-[A-Za-z0-9_]{8,}\./.test(path.basename(file))
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });

  /*
   * ⚠ ONLY THE HTML IS READ INTO MEMORY, and only when there is a token to add.
   * Artifacts go through here too and they are arbitrarily large, so the stream
   * stays the default path — the desktop install serves exactly the bytes it
   * served before this branch existed.
   */
  if (boot.token && ext === '.html') {
    res.end(injectBoot(fs.readFileSync(file, 'utf8'), boot));
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * A FUNCTION, not a constant: the page is built per request so it follows the
 * interface language, `lang` attribute included. A module-level template string
 * would freeze whichever locale happened to be set when this file was imported.
 */
const notBuilt = (): string => `<!doctype html>
<html lang="${getLocale()}"><head><meta charset="utf-8"><title>${t('srv.notBuiltTitle')}</title>
<style>
 /* Dark, unconditionally — the same call as web/src/index.css §TWO STATES: the
    machine does not get a vote on the product's colours. This page cannot read
    the user's choice (there is no bundle yet, which is why it is showing at
    all), so it uses the DEFAULT rather than asking prefers-color-scheme and
    landing somewhere the app itself would never land.
    ⚠ NO BACKTICKS IN HERE — this whole page is a template literal, and one
    backtick in a comment ends it. Cost me a build. */
 body{margin:0;height:100vh;display:grid;place-items:center;background:#16150f;color:#ece7dc;
      font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
 :root{color-scheme:dark}
 main{max-width:34rem;padding:2rem}
 h1{font-size:1.15rem;margin:0 0 .75rem}
 /* ⚠ muted from the DARK palette (#948c7c), not the light one. The old value
    was the light #7d766a, which under a prefers-color-scheme twin only ever sat
    on light paper; pinning the page to dark without moving this leaves the
    explanation as mid-grey on near-black. Same shape as the black bubble in
    office.css — a ground that flipped and a colour on top of it that did not. */
 p{color:#948c7c;margin:.5rem 0}
 code{display:block;background:rgba(128,128,128,.14);padding:.7rem .9rem;border-radius:.5rem;
      margin:.9rem 0;font:13px ui-monospace,Consolas,monospace}
</style></head>
<body><main>
 <h1>${t('srv.notBuiltH1')}</h1>
 <p>${t('srv.notBuiltRun')}</p>
 <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code>
 <p>${t('srv.notBuiltFromRoot')} <code style="display:inline;padding:.15rem .4rem">npm run build:all</code></p>
 <p>${t('srv.notBuiltReloadBefore')} <code style="display:inline;padding:.15rem .4rem">agentco run</code> ${t('srv.notBuiltReloadAfter')}</p>
</main></body></html>`;
