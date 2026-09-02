/**
 * Phục vụ giao diện đã build (`web/dist`). → docs/SPEC-ui.md §0
 *
 * Giao diện là một app React build sẵn, không phải chuỗi HTML trong mã nguồn
 * nữa. Daemon chỉ việc đưa file tĩnh ra — không SSR, không router phía server.
 *
 * Nếu chưa build thì KHÔNG trả 404 trống: in ra đúng lệnh phải chạy. Người
 * clone repo về lần đầu sẽ gặp đúng trạng thái này, và một trang trắng ở đây là
 * cách nhanh nhất để họ nghĩ sản phẩm hỏng.
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

/** `dist/server/static.js` → gốc gói. Chạy từ `dist/` hay từ `src/` đều ra đúng. */
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
 * Bundle đang phục vụ có CŨ HƠN mã nguồn giao diện không? → `cmdStart`
 *
 * Daemon phục vụ `web/dist` (đã build), nên sửa `web/src` mà quên build thì
 * trình duyệt tải về bản cũ — và cả ba phản xạ tự nhiên (Ctrl+Shift+R, tắt mở
 * daemon, Ctrl+C) đều KHÔNG chạm tới bước build. Người dùng gặp thật 20/08 và
 * kết luận là mình sai. Một phép so `mtime` vài mili giây thì nói ra được.
 */
export function webBuildStale(): boolean {
  const root = webRoot();
  if (!root) return false;
  const src = path.resolve(root, '../src');
  if (!fs.existsSync(src)) return false; // bản cài từ npm — không có mã nguồn
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

/** Trả về true nếu đã xử lý request. */
export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  const root = webRoot();
  if (!root) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notBuilt());
    return true;
  }

  // SPA: mọi đường dẫn không phải file đều trả index.html.
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, rel);

  // Chặn path traversal: đường dẫn đến từ URL nên không tin được.
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
    res.writeHead(403).end();
    return true;
  }

  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
  const ext = path.extname(file).toLowerCase();

  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Asset của Vite có hash trong tên -> cache vĩnh viễn an toàn.
    // index.html thì không, phải luôn hỏi lại, nếu không người dùng nâng cấp
    // agentco xong vẫn chạy bundle cũ và không hiểu vì sao.
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
 body{margin:0;height:100vh;display:grid;place-items:center;background:#fbfaf8;color:#232019;
      font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
 @media (prefers-color-scheme:dark){body{background:#16150f;color:#ece7dc}}
 main{max-width:34rem;padding:2rem}
 h1{font-size:1.15rem;margin:0 0 .75rem}
 p{color:#7d766a;margin:.5rem 0}
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
