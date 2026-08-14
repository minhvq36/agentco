/**
 * Daemon: HTTP + SSE.
 *
 * → docs/SPEC-cli.md §1, docs/SPEC-ui.md §5
 *
 * MỘT tiến trình sở hữu mọi thứ. warmSet của cache priming gate và session của
 * master PHẢI sống trong bộ nhớ — mỗi lệnh CLI spawn một process riêng là quay
 * lại đúng cái bẫy `claude -p`: mất warmSet, mất session, mất cache.
 *
 * Bind 127.0.0.1. Bind 0.0.0.0 (chế độ VPS) sẽ BẮT BUỘC có token — daemon từ
 * chối chạy nếu không, vì mở cổng này ra mạng nghĩa là cho người lạ chạy lệnh
 * trên máy bạn.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import type { Company } from '../core/company.js';
import { UI_HTML } from './ui.js';

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
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = `${req.method} ${url.pathname}`;

    if (opts.token && url.pathname.startsWith('/api/')) {
      const given = req.headers['x-agentco-token'] ?? url.searchParams.get('token');
      if (given !== opts.token) return json(res, 401, { error: 'sai token' });
    }

    switch (true) {
      case route === 'GET /healthz':
        return json(res, 200, {
          ok: true,
          version: pkgVersion(),
          state: company.currentState,
          company: company.loaded.config.name,
        });

      case route === 'GET /':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(UI_HTML);
        return;

      case route === 'GET /api/state':
        return json(res, 200, {
          name: company.loaded.config.name,
          state: company.currentState,
          plan: company.plan ?? null,
          pending: company.readPending().length,
          knowledge: company.knowledge.size,
          roles: [...company.loaded.roles.values()].map((r) => ({
            id: r.id,
            display_name: r.display_name || r.id,
            avatar: r.avatar,
            pitch: r.pitch,
            tier: r.model_tier,
          })),
          history: company.history(),
        });

      case route === 'GET /api/events': {
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

      case route === 'POST /api/run': {
        const body = await readJson<{ request?: string }>(req);
        const request = body.request?.trim();
        if (!request) return json(res, 400, { error: 'thiếu "request"' });
        // Trả ngay, chạy nền — công việc dài hơn nhiều so với một HTTP request.
        void company.run(request).catch(() => {});
        return json(res, 202, { accepted: true });
      }

      case route === 'POST /api/chat': {
        const body = await readJson<{ message?: string }>(req);
        const message = body.message?.trim();
        if (!message) return json(res, 400, { error: 'thiếu "message"' });
        const reply = await company.chat(message);
        return json(res, 200, { reply });
      }

      case route === 'POST /api/stop':
        company.stop();
        return json(res, 200, { ok: true });

      case route === 'POST /api/shutdown':
        json(res, 200, { ok: true });
        setTimeout(() => opts.onShutdown?.(), 100);
        return;

      case route === 'GET /api/cost':
        return json(res, 200, {
          text: company.costText(),
          report: company.costReport(),
          cacheKeys: company.cacheKeys(),
        });

      case route.startsWith('GET /api/artifact'): {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: 'thiếu "path"' });
        const content = company.readArtifact(rel);
        if (content === undefined) return json(res, 404, { error: 'không tìm thấy' });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(content);
        return;
      }

      default:
        return json(res, 404, { error: 'không có route này' });
    }
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

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
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
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function pkgVersion(): string {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
