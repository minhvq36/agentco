/**
 * Daemon: HTTP + SSE.
 *
 * → docs/SPEC-offices.md §8, docs/SPEC-cli.md §1
 *
 * MỘT tiến trình sở hữu mọi thứ. warmSet của cache priming gate và session của
 * mỗi Trợ lý PHẢI sống trong bộ nhớ — mỗi lệnh CLI spawn một process riêng là
 * quay lại đúng cái bẫy `claude -p`: mất warmSet, mất session, mất cache.
 *
 * Bind 127.0.0.1. Bind 0.0.0.0 (chế độ VPS) sẽ BẮT BUỘC có token — daemon từ
 * chối chạy nếu không, vì mở cổng này ra mạng nghĩa là cho người lạ chạy lệnh
 * trên máy bạn.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Company } from '../core/company.js';
import { RunError } from '../core/types.js';
import { serveStatic } from './static.js';

export interface ServeOptions {
  company: Company;
  port: number;
  host?: string;
  token?: string;
  onShutdown?(): void;
}

export interface Daemon {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions): Promise<Daemon> {
  const host = opts.host ?? '127.0.0.1';
  const { company } = opts;

  if (host !== '127.0.0.1' && host !== 'localhost' && !opts.token) {
    throw new Error(
      `Từ chối bind ${host} khi chưa có token đăng nhập.\n` +
        `Mở cổng này ra mạng nghĩa là cho người lạ chạy lệnh trên máy bạn.\n` +
        `Đặt AGENTCO_TOKEN=<chuỗi bí mật> rồi thử lại.`,
    );
  }

  const sseClients = new Set<http.ServerResponse>();
  const unsubscribe = company.on((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(payload);
  });

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      // RunError = ta đã lường trước và có câu giải thích cho người dùng.
      // 500 dành cho thứ ta không lường trước.
      const status = err instanceof RunError ? 400 : 500;
      json(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const segments = url.pathname.split('/').filter(Boolean);

    // Chặn DNS rebinding: một tên miền của kẻ tấn công trỏ về 127.0.0.1 sẽ gửi
    // Host là tên miền đó, không phải localhost.
    if (!hostAllowed(req.headers.host, host)) {
      return json(res, 403, { error: 'Host không được phép' });
    }

    if (opts.token && url.pathname.startsWith('/api/')) {
      const given = req.headers['x-agentco-token'] ?? url.searchParams.get('token');
      if (given !== opts.token) return json(res, 401, { error: 'sai token' });
    }

    // Chặn CSRF. Không có bước này thì BẤT KỲ trang web nào người dùng mở cũng
    // POST được vào daemon: giao việc đốt token, xoá văn phòng, ngắt hết dây.
    // Trình duyệt luôn gửi Sec-Fetch-Site; CLI và bridge thì không gửi gì cả,
    // nên kiểm tra này không ảnh hưởng client không phải trình duyệt.
    if (method !== 'GET' && method !== 'HEAD' && !sameSite(req)) {
      return json(res, 403, { error: 'yêu cầu đến từ trang khác — đã chặn' });
    }

    // ── cấp công ty
    if (url.pathname === '/healthz') {
      return json(res, 200, { ok: true, version: pkgVersion(), offices: company.size });
    }
    // Mọi thứ không phải /api/ đều là giao diện — kể cả đường dẫn con của SPA.
    if (!url.pathname.startsWith('/api/') && (method === 'GET' || method === 'HEAD')) {
      serveStatic(req, res, url.pathname);
      return;
    }
    if (url.pathname === '/api/company' && method === 'GET') {
      return json(res, 200, {
        name: company.config.name,
        offices: company.list(),
        allowCorePromptEdit: company.config.allow_core_prompt_edit,
      });
    }
    if (url.pathname === '/api/office' && method === 'POST') {
      const body = await readJson<{ name?: string; id?: string }>(req);
      const office = company.createOffice(body);
      return json(res, 201, { id: office.id, offices: company.list() });
    }
    if (url.pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(res);
      });
      return;
    }
    if (url.pathname === '/api/cost' && method === 'GET') {
      return json(res, 200, {
        text: company.costText(),
        report: company.costReport(),
        byOffice: company.costByOffice(),
      });
    }
    if (url.pathname === '/api/shutdown' && method === 'POST') {
      json(res, 200, { ok: true });
      setTimeout(() => opts.onShutdown?.(), 100);
      return;
    }

    // ── cấp văn phòng:  /api/office/:id/...
    if (segments[0] === 'api' && segments[1] === 'office' && segments[2]) {
      const officeId = decodeURIComponent(segments[2]);
      const rest = segments.slice(3);

      if (rest.length === 0 && method === 'DELETE') {
        company.removeOffice(officeId, url.searchParams.get('deleteFiles') === 'true');
        return json(res, 200, { ok: true, offices: company.list() });
      }

      const office = company.get(officeId);

      if (rest.length === 0 && method === 'GET') {
        return json(res, 200, {
          id: office.id,
          name: office.name,
          state: office.currentState,
          plan: office.plan ?? null,
          pending: office.readPending().length,
          knowledge: office.knowledge.size,
          history: company.history(officeId),
        });
      }
      if (rest[0] === 'canvas' && method === 'GET') return json(res, 200, office.canvas());
      if (rest[0] === 'canvas' && method === 'PUT') {
        const body = await readJson<{ nodes?: unknown; edges?: unknown }>(req);
        return json(res, 200, office.saveCanvas(body));
      }
      if (rest[0] === 'agent' && method === 'POST') {
        const body = await readJson<{ id?: string; display_name?: string; pitch?: string; tier?: string }>(req);
        const id = office.addAgent(body);
        return json(res, 201, { id, canvas: office.canvas() });
      }
      if (rest[0] === 'agent' && rest[1] && method === 'PATCH') {
        const body = await readJson<Record<string, unknown>>(req);
        return json(res, 200, {
          canvas: office.editAgent(decodeURIComponent(rest[1]), body as never),
        });
      }
      if (rest[0] === 'agent' && rest[1] && method === 'DELETE') {
        office.removeAgent(decodeURIComponent(rest[1]), url.searchParams.get('keepFile') !== 'false');
        return json(res, 200, { ok: true, canvas: office.canvas() });
      }
      if (rest[0] === 'say' && method === 'POST') {
        const body = await readJson<{ message?: string }>(req);
        const message = body.message?.trim();
        if (!message) return json(res, 400, { error: 'thiếu "message"' });
        return json(res, 200, await office.say(message));
      }
      if (rest[0] === 'run' && method === 'POST') {
        const body = await readJson<{ request?: string }>(req);
        const request = body.request?.trim();
        if (!request) return json(res, 400, { error: 'thiếu "request"' });
        // Trả ngay, chạy nền — công việc dài hơn nhiều so với một HTTP request.
        void office.run(request).catch(() => {});
        return json(res, 202, { accepted: true });
      }
      if (rest[0] === 'stop' && method === 'POST') {
        office.stop();
        return json(res, 200, { ok: true });
      }
      if (rest[0] === 'knowledge' && method === 'GET') {
        return json(res, 200, { nodes: office.knowledge.list() });
      }
      if (rest[0] === 'plans' && !rest[1] && method === 'GET') {
        return json(res, 200, { plans: office.plans.list() });
      }
      if (rest[0] === 'plans' && rest[1] && method === 'GET') {
        const planId = decodeURIComponent(rest[1]);
        const record = office.plans.get(planId);
        if (!record) return json(res, 404, { error: 'không có công việc này' });
        return json(res, 200, { plan: record, log: office.plans.readLog(planId) });
      }
      if (rest[0] === 'prompt' && rest[1] && method === 'GET') {
        const layers = office.describePrompt(decodeURIComponent(rest[1]));
        if (layers.length === 0) return json(res, 404, { error: 'không có vai trò này' });
        return json(res, 200, { layers, editable: company.config.allow_core_prompt_edit });
      }
      if (rest[0] === 'prompt' && rest[1] && rest[2] && method === 'PUT') {
        const body = await readJson<{ text?: string }>(req);
        if (typeof body.text !== 'string') return json(res, 400, { error: 'thiếu "text"' });
        return json(res, 200, {
          layers: office.savePromptLayer(
            decodeURIComponent(rest[1]),
            decodeURIComponent(rest[2]),
            body.text,
          ),
        });
      }
      if (rest[0] === 'artifact' && method === 'GET') {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: 'thiếu "path"' });
        const content = office.readArtifact(rel);
        if (content === undefined) return json(res, 404, { error: 'không tìm thấy' });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(content);
        return;
      }
    }

    return json(res, 404, { error: 'không có route này' });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    url: `http://${host}:${port}`,
    async close() {
      unsubscribe();
      for (const res of sseClients) res.end();
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Chỉ nhận request cùng gốc.
 *
 * `Sec-Fetch-Site` do TRÌNH DUYỆT đặt, trang web không ghi đè được — đây là lý
 * do nó tin được. Client không phải trình duyệt (CLI, Telegram bridge) không gửi
 * header nào trong ba header này, và được đi tiếp.
 */
function sameSite(req: http.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';

  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  return true;
}

/** Host phải là chính cái ta bind. Chặn tên miền của kẻ tấn công trỏ về 127.0.0.1. */
function hostAllowed(given: string | undefined, bound: string): boolean {
  if (!given) return true;
  const hostname = given.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  return hostname === bound.toLowerCase();
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('body quá lớn');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RunError('Dữ liệu gửi lên không phải JSON hợp lệ.', 'other');
  }
}

function pkgVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
