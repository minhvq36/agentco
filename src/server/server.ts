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
import { LibraryError } from '../library/store.js';
import { PREVIEW_MAX_BYTES, mimeOf } from '../core/artifacts.js';
import { RunError } from '../core/types.js';
import { serveStatic } from './static.js';

/**
 * Đuôi file KHÔNG BAO GIỜ được render trong trình duyệt, luôn ép tải về.
 *
 * `.svg` và `.html` là văn bản, trông vô hại, và chạy được JavaScript. Chúng do
 * MODEL sinh ra — không phải do người dùng viết — và daemon phục vụ chúng ở
 * cùng origin với chính giao diện điều khiển công ty, thứ không có xác thực nào
 * ngoài "cùng máy". Xem trước một file như thế là cho nó chạy trong nhà.
 */
const RISKY = new Set(['svg', 'html', 'htm', 'xhtml']);

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
        // Mức nào là model nào — giao diện cần nói ra, nếu không thì "standard"
        // chỉ là một chữ và người dùng không biết mình đang trả tiền cho cái gì.
        models: company.config.models,
      });
    }
    if (url.pathname === '/api/company' && method === 'PATCH') {
      const body = await readJson<{ models?: Record<string, string> }>(req);
      if (!body.models) return json(res, 400, { error: 'thiếu "models"' });
      return json(res, 200, { models: company.updateModels(body.models) });
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

      // DELETE giờ chỉ còn một nghĩa: XOÁ HẲN. Mức "cất đi" là PATCH archived —
      // hai ý định khác hẳn nhau thì không nên đi chung một động từ với một cờ
      // trên query string, vì cờ đó rất dễ quên và hậu quả không lấy lại được.
      if (rest.length === 0 && method === 'DELETE') {
        company.removeOffice(officeId);
        return json(res, 200, { ok: true, offices: company.list() });
      }

      const office = company.get(officeId);

      if (rest.length === 0 && method === 'GET') {
        return json(res, 200, {
          id: office.id,
          name: office.name,
          state: office.currentState,
          plan: office.plan ?? null,
          pending: office.readPending().tasks.length,
          // Ca dở CHẠY TIẾP ĐƯỢC — khác `pending` ở chỗ nó đã kiểm đủ điều kiện
          // (có `plan_id`, có `plan.json` trên đĩa). UI mời, không tự chạy.
          resumable: office.resumable() ?? null,
          knowledge: office.knowledge.size,
          // Hai nguồn, hai vai trò khác nhau — đừng gộp:
          //   `chat`    = hội thoại ĐÃ GHI ĐĨA, sống sót qua mọi lần tắt daemon.
          //   `history` = vòng đệm trong bộ nhớ, để tab mở muộn bắt kịp trạng
          //               thái SỐNG (việc đang chạy, ai đang làm gì).
          chat: office.readChat(),
          history: company.history(officeId),
        });
      }
      // Đổi tên văn phòng / đổi mức model của Trợ lý. Hai thứ đều nằm trong
      // office.yaml nên đi chung một route.
      if (rest.length === 0 && method === 'PATCH') {
        const body = await readJson<{
          name?: string;
          assistant_tier?: string | null;
          archived?: boolean;
        }>(req);
        // `archived` đi TRƯỚC: khôi phục rồi mới sửa được những thứ còn lại.
        // Ngược lại thì "khôi phục và đổi tên trong một lần" sẽ bị chính chốt
        // chỉ-đọc chặn, và người dùng không hiểu vì sao.
        if (typeof body.archived === 'boolean') company.archiveOffice(officeId, body.archived);
        if (typeof body.name === 'string') company.renameOffice(officeId, body.name);
        if (body.assistant_tier !== undefined) {
          office.setAssistantTier(body.assistant_tier ?? undefined);
        }
        return json(res, 200, {
          id: office.id,
          name: office.name,
          archived: office.archived,
          canvas: office.canvas(),
          offices: company.list(),
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
        const role = decodeURIComponent(rest[1]);
        // Lưu trữ / khôi phục đi riêng: nó không sửa NỘI DUNG hồ sơ mà đổi việc
        // người này có tồn tại trên sơ đồ hay không.
        if (typeof body['archived'] === 'boolean') {
          return json(res, 200, { canvas: office.archiveAgent(role, body['archived']) });
        }
        return json(res, 200, { canvas: office.editAgent(role, body as never) });
      }
      // XOÁ HẲN file yaml. Mức "cất đi" là PATCH { archived } ở trên.
      if (rest[0] === 'agent' && rest[1] && method === 'DELETE') {
        office.removeAgent(decodeURIComponent(rest[1]));
        return json(res, 200, { ok: true, canvas: office.canvas() });
      }
      if (rest[0] === 'archived' && method === 'GET') {
        return json(res, 200, { agents: office.archivedAgents() });
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
      // Id node có dấu `/` (`k/agents/assistant/…`) nên nó đi trong BODY, không
      // trên đường dẫn — nhét vào path thì phải encode/decode nhiều lớp và sớm
      // muộn cũng có một lớp bị quên.
      if (rest[0] === 'knowledge' && method === 'PATCH') {
        const body = await readJson<{ id?: string; body?: string; remove?: boolean }>(req);
        if (!body.id) return json(res, 400, { error: 'thiếu "id"' });
        office.editKnowledge(body.id, { body: body.body, remove: body.remove === true });
        return json(res, 200, { nodes: office.knowledge.list() });
      }
      if (rest[0] === 'plans' && !rest[1] && method === 'GET') {
        return json(res, 200, { plans: office.plans.list() });
      }
      /**
       * ⚠ KHÔNG CÓ `DELETE /plans` — và đó là một quyết định, không phải thiếu sót.
       *
       * Nhật ký công việc là bên duy nhất nối `plan_id` trong `logs/usage.jsonl`
       * với một cái TÊN đọc được. Xoá một bản ghi thì tiền vẫn còn trong sổ mà
       * không ai biết nó của việc gì — và "(không rõ)" trong sổ chi phí từ đó
       * mang HAI nghĩa (bản ghi v0, hoặc người dùng đã xoá), tức là không còn
       * giải thích được. → SPEC-offices.md §6 · SESSIONS_MEMORY §5i
       *
       * Thứ người dùng thật sự muốn dọn là ca kẹt `running` sau crash —
       * `healStalePlans()` chữa đúng cái đó mà không mất một dòng lịch sử nào.
       */
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
      // ── tủ tài liệu → docs/SPEC-library.md §13
      if (rest[0] === 'library' && !rest[1] && method === 'GET') {
        // Quét ở ĐÂY, không dùng watcher: watcher bắn sự kiện giữa lúc một file
        // lớn đang được copy vào và ta bóc phải bản dở. → SPEC-library.md §9.1
        return json(res, 200, { docs: office.library.scan() });
      }
      if (rest[0] === 'library' && !rest[1] && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: 'thiếu "name"' });
        const maxBytes = Math.round(company.config.library.max_file_mb * 1024 * 1024);
        // Trần phải chặn THEO DÒNG lúc đang nhận, không phải sau khi đã đệm đủ
        // vào RAM — nếu không thì một file 2GB làm sập daemon trước khi tới được
        // câu kiểm tra. → SPEC-library.md §13
        const data = await readBody(req, maxBytes);
        try {
          // `office.addDocument`, KHÔNG phải `library.add` thẳng: bảng kê tủ tài
          // liệu nằm trong prefix Trợ lý và phải được nạp lại NGAY. Thiếu bước
          // đó thì người dùng tải file lên rồi hỏi ngay — thao tác tự nhiên nhất
          // của cả sản phẩm — và Trợ lý nói không thấy file nào tên đó.
          const doc = office.addDocument(decodeURIComponent(name), data, {
            replace: url.searchParams.get('replace') === '1',
            maxBytes,
          });
          return json(res, 201, { doc, docs: office.library.list() });
        } catch (err) {
          if (err instanceof LibraryError) {
            // 409 chỉ dành cho TRÙNG TÊN: giao diện phải phân biệt được "hỏi lại
            // để thay thế" với "file này không nhận được" — hai câu khác hẳn.
            return json(res, err.kind === 'duplicate' ? 409 : 400, { error: err.message });
          }
          throw err;
        }
      }
      // Bóc lại một tài liệu chưa dùng được. → SPEC-library.md §4.5
      if (rest[0] === 'library' && rest[1] === 'reextract' && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: 'thiếu "name"' });
        if (!office.library.reextract(decodeURIComponent(name))) {
          return json(res, 404, { error: 'không có tài liệu này, hoặc bản gốc đã mất' });
        }
        // Trả danh sách NGAY, chưa đợi bóc xong: tài liệu về `pending` và giao
        // diện hiện "đang đọc…" — bóc chạy ngầm, đúng như lúc mới thả file.
        return json(res, 202, { docs: office.library.list() });
      }
      if (rest[0] === 'library' && rest[1] === 'file' && method === 'GET') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: 'thiếu "name"' });
        const abs = office.library.originalPath(decodeURIComponent(name));
        if (!abs) return json(res, 404, { error: 'không có tài liệu này' });
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      if (rest[0] === 'library' && !rest[1] && method === 'DELETE') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: 'thiếu "name"' });
        // `office.removeDocument`, KHÔNG phải `library.remove` thẳng: xoá tài
        // liệu phải kéo theo mọi ghi chú sống nhờ nó (`depends_on`). Gọi thẳng
        // vào store là bỏ qua đúng cái ràng buộc đó.
        const gone = office.removeDocument(decodeURIComponent(name));
        if (!gone.removed) return json(res, 404, { error: 'không có tài liệu này' });
        return json(res, 200, { docs: office.library.list(), droppedNotes: gone.droppedNotes });
      }

      // ── kết quả (artifacts) → docs/SPEC-artifacts.md
      if (rest[0] === 'artifacts' && !rest[1] && method === 'GET') {
        // Quét đĩa mỗi lần, không catalog: file này do NHÂN VIÊN ghi trong lúc
        // chạy, nên mọi bản lưu sẵn đều lỗi thời ngay giữa một ca.
        return json(res, 200, { artifacts: office.artifactList() });
      }
      if (rest[0] === 'artifacts' && !rest[1] && method === 'DELETE') {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: 'thiếu "path"' });
        // Qua `Office` để bảng kê Kết quả trong prefix Trợ lý được nạp lại —
        // nếu không, nó nêu tên một file người dùng vừa xoá. → `removeArtifact`
        if (!office.removeArtifact(rel)) return json(res, 404, { error: 'không có kết quả này' });
        return json(res, 200, { artifacts: office.artifactList() });
      }
      /**
       * Đọc một kết quả — XEM hoặc TẢI VỀ.
       *
       * ⚠ Bản trước (`GET /artifact`) đọc bằng `readFileSync(abs, 'utf8')` và
       * luôn trả `text/plain`. Với markdown thì chạy được, với một tấm ảnh hay
       * một file pdf thì nó **làm hỏng dữ liệu** — utf8 decode một chuỗi byte
       * nhị phân là mất thông tin không lấy lại được. Chưa ai gặp vì tới hôm
       * nay mọi kết quả đều là markdown; đó chính là lúc rẻ nhất để sửa.
       *
       * Cũng không có trần dung lượng: một `.csv` 50MB nhân viên sinh ra sẽ
       * được nạp trọn vào bộ nhớ daemon. Giờ thì stream, không nạp.
       */
      if (rest[0] === 'artifacts' && rest[1] === 'file' && method === 'GET') {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: 'thiếu "path"' });
        const abs = office.artifacts.resolve(rel);
        if (!abs) return json(res, 404, { error: 'không có kết quả này' });

        const ext = path.extname(abs).slice(1);
        const download = url.searchParams.get('download') === '1';
        const stat = fs.statSync(abs);
        if (!download && stat.size > PREVIEW_MAX_BYTES) {
          return json(res, 413, {
            error: `File nặng ${Math.round(stat.size / 1024 / 1024)}MB, quá lớn để xem trước. Tải về để mở.`,
          });
        }
        res.writeHead(200, {
          // `svg` và `html` do model sinh ra CÓ THỂ chứa script. Ép tải về thay
          // vì render là chốt duy nhất chặn nó chạy trong cùng origin với daemon
          // — mà daemon thì không có xác thực nào ngoài "cùng máy".
          'content-type': download || RISKY.has(ext.toLowerCase()) ? 'application/octet-stream' : mimeOf(ext),
          'content-length': String(stat.size),
          ...(download
            ? {
                'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
              }
            : {}),
        });
        fs.createReadStream(abs).pipe(res);
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

/**
 * Đọc body NHỊ PHÂN, cắt ngay khi vượt trần.
 *
 * → docs/SPEC-library.md §13
 *
 * Đây là route đầu tiên của hệ thống nhận dữ liệu nhị phân, và cái bẫy nằm ở chỗ
 * dễ bỏ qua nhất: kiểm kích thước SAU khi đã `Buffer.concat` là đã quá muộn —
 * một file 2GB làm daemon hết bộ nhớ trước khi tới được câu kiểm tra. Phải cộng
 * dồn theo từng chunk và ném ngay khi vượt.
 *
 * CỐ Ý không dùng `multipart/form-data`: parse multipart đúng chuẩn (biên, mã
 * hoá tên file, chunk cắt giữa biên) là một thư viện, còn ở đây tên file đi trên
 * query string và body là nguyên si nội dung. Ít mã hơn, ít chỗ sai hơn.
 */
async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      req.destroy();
      throw new RunError(
        `File vượt trần ${Math.round(maxBytes / 1024 / 1024)}MB. ` +
          'Đổi trần ở company.yaml (library.max_file_mb) nếu bạn thật sự cần.',
        'other',
      );
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
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
