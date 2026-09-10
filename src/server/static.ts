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

/** Returns true when the request has been handled. */
export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
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
