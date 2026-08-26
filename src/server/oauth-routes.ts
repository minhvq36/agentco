/**
 * ĐĂNG NHẬP MỘT DỊCH VỤ — hai route và một cái bàn tạm. → docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ① NÚT ĐĂNG NHẬP Ở **WEB UI**, KHÔNG Ở DAEMON. (bài học đắt, 24/08)       │
 * │                                                                          │
 * │ Spike bản đầu tự mở trình duyệt từ tiến trình nền. Nó hỏng ở đúng ca      │
 * │ thường gặp nhất, và user gặp ngay lượt đầu: trình duyệt mặc định của máy  │
 * │ **chưa đăng nhập Notion**, còn cái đang mở agentco thì có. Daemon không   │
 * │ biết gì về phiên đăng nhập của người dùng; **trình duyệt thì biết**.      │
 * │                                                                          │
 * │ ⇒ Ta không mở trình duyệt. Ta trả về một URL, và **web UI tự mở tab**     │
 * │ trong chính cửa sổ người dùng đang ngồi. Không có `spawn`, nên cũng       │
 * │ không có lớp lỗi shell-quoting đã cắt URL ở dấu `&` trên Windows.        │
 * │                                                                          │
 * │ ② REDIRECT VỀ CHÍNH DAEMON, không dựng cổng loopback riêng.              │
 * │                                                                          │
 * │ Daemon đã lắng nghe sẵn ở `127.0.0.1:<port>`. Dùng luôn nó thì bỏ được   │
 * │ cả một vòng đời server tạm (mở trước DCR vì `redirect_uri` phải khớp      │
 * │ từng ký tự · đóng khi xong · đóng khi người dùng bỏ ngang · rò cổng khi   │
 * │ quên đóng). RFC 8252 cho phép loopback redirect, và cổng cố định thì      │
 * │ **đăng ký một lần dùng mãi** thay vì DCR lại mỗi lần bấm.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { ServerResponse } from 'node:http';

import type { Company } from '../core/company.js';
import { companyPaths } from '../core/paths.js';
import { RunError } from '../core/types.js';
import { findArm } from '../core/catalog.js';
import { callTool } from '../core/mcp-http.js';
import { readOAuth, saveOAuth } from '../core/secrets.js';
import {
  DeadGrantError,
  accountName,
  authorizeUrl,
  deviceStart,
  devicePoll,
  discover,
  exchangeCode,
  needsRefresh,
  pkce,
  randomState,
  refreshAccount,
  register,
  supportsDevice,
  type AsMeta,
  type DeviceStart,
  type OAuthAccount,
} from '../core/oauth.js';

/**
 * Lượt đăng nhập ĐANG BAY. Trong RAM, cố ý.
 *
 * `code_verifier` là bí mật **một lần**, chỉ có nghĩa trong vài chục giây giữa
 * lúc mở tab và lúc Notion gọi lại. Ghi nó xuống đĩa là tạo ra một bí mật thứ
 * hai phải bảo vệ, để đổi lấy khả năng "khôi phục" một thứ mà cách khôi phục
 * đúng là **bấm lại nút**. Daemon tắt ⇒ mất ⇒ đúng như mong muốn.
 */
interface Pending {
  meta: AsMeta;
  clientId: string;
  verifier: string;
  mcpUrl: string;
  prefix: string;
  redirectUri: string;
  at: number;
}
const pending = new Map<string, Pending>();

/** Quá hạn thì dọn — một `state` treo mãi là một khe để đoán mò. */
const PENDING_TTL_MS = 10 * 60_000;

function sweep(): void {
  const cut = Date.now() - PENDING_TTL_MS;
  for (const [k, v] of pending) if (v.at < cut) pending.delete(k);
}

/**
 * `client_id` đã xin cho MỘT (issuer, redirect_uri). Nhớ lại để khỏi DCR mỗi lần.
 *
 * ⚠ Khoá phải gồm `redirect_uri`: `client_id` được cấp **cho đúng URI đã đăng
 * ký**. Đổi cổng daemon mà dùng lại client_id cũ ⇒ `invalid_redirect_uri`, và
 * câu lỗi đó không hề nói ra nguyên nhân thật.
 */
const clients = new Map<string, string>();

export interface StartResult {
  authUrl: string;
  state: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỊA CHỈ REDIRECT — THỨ DUY NHẤT KHÔNG ĐƯỢC PHÉP ĐOÁN. (user hỏi 26/08)   │
 * │                                                                          │
 * │   *"cái flow redirect về nên cần case khách hàng chạy docker, vps, nginx │
 * │    → domain… 1 là ghi vào backlog, 2 là làm luôn, tôi sợ làm mà để đó    │
 * │    không test cũng ố dề"*                                                │
 * │                                                                          │
 * │ Câu lo đúng, nên đây **không** phải một tính năng triển khai chưa test —  │
 * │ nó là một **cái chốt**, và chốt thì test được ngay hôm nay: mọi nhánh     │
 * │ dưới đây là hàm thuần, không cần Docker nào để chạy.                     │
 * │                                                                          │
 * │ 🔴 VÌ SAO KHÔNG SUY TỪ HEADER `Host`: `redirect_uri` là nơi **mã uỷ       │
 * │ quyền** được gửi tới. `Host` do client gửi nên **giả được** — suy redirect│
 * │ từ nó nghĩa là ai gọi được daemon cũng chỉ định được nơi nhận mã. Đó là   │
 * │ lỗ chiếm tài khoản, không phải một chi tiết tiện lợi. Cùng lý lẽ với      │
 * │ `isLoopback` chỉ đọc địa chỉ SOCKET chứ không đọc `X-Forwarded-For`.     │
 * │                                                                          │
 * │ ⇒ Ba nhánh, và nhánh thứ ba là thứ cứu người triển khai:                 │
 * │   ① khai `public_url`        → dùng, sau khi soi kỹ                       │
 * │   ② chạy loopback, không khai → `http://127.0.0.1:<cổng>` (ca đã test)   │
 * │   ③ bind ra ngoài, không khai → **TỪ CHỐI**, và nói ra cách sửa          │
 * │                                                                          │
 * │ Nhánh ③ đúng khuôn `serve()` đã dùng cho `AGENTCO_TOKEN`: mở cổng ra      │
 * │ ngoài mà thiếu một thứ bắt buộc thì **dừng ngay, nói thẳng** — không      │
 * │ chạy tiếp rồi hỏng ở một chỗ xa nguyên nhân.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function redirectBase(opts: { host: string; port: number; publicUrl?: string }): string {
  const loopback = /^(127\.|localhost$|::1$|\[::1\]$)/i.test(opts.host);
  const raw = (opts.publicUrl ?? '').trim();

  if (!raw) {
    if (loopback) return `http://127.0.0.1:${opts.port}`;
    throw new RunError(
      `Daemon đang lắng nghe ở "${opts.host}", nên "http://127.0.0.1" KHÔNG phải địa chỉ người dùng ` +
        `gõ vào trình duyệt — dịch vụ sẽ trả mã uỷ quyền về nhầm máy.\n` +
        `Khai địa chỉ thật rồi thử lại:\n` +
        `  AGENTCO_RUNTIME_PUBLIC_URL=https://agentco.cong-ty-cua-ban.com\n` +
        `hoặc đặt runtime.public_url trong company.yaml.`,
      'other',
    );
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RunError(`runtime.public_url không phải URL hợp lệ: "${raw}"`, 'other');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new RunError(`runtime.public_url phải là http hoặc https, đang là "${u.protocol}"`, 'other');
  }
  /**
   * ⚠ `http` chỉ được phép khi đích là chính máy này. Mã uỷ quyền đi qua một
   * chặng `http` trên mạng là đi ở dạng chữ thường — ai đứng giữa cũng đọc
   * được, và mã đó đổi thẳng ra chìa. Phần lớn dịch vụ cũng tự từ chối, nhưng
   * ta không dựa vào việc họ nhớ từ chối hộ.
   */
  const targetLoopback = /^(127\.|localhost$|\[::1\]$)/i.test(u.hostname) || u.hostname === '::1';
  if (u.protocol === 'http:' && !targetLoopback) {
    throw new RunError(
      `runtime.public_url dùng http:// cho một địa chỉ ngoài máy này ("${u.hostname}").\n` +
        `Mã uỷ quyền sẽ đi qua mạng ở dạng chữ thường — bất kỳ ai đứng giữa cũng đổi được nó ra chìa.\n` +
        `Dùng https, hoặc đưa nginx/Caddy lên trước để nó lo TLS.`,
      'other',
    );
  }
  // Query/hash trong một địa chỉ gốc là dấu hiệu dán nhầm cả một URL nào đó.
  // Bỏ qua im lặng thì `redirect_uri` lệch từng ký tự với thứ đã đăng ký, và
  // dịch vụ trả `invalid_redirect_uri` — câu **không hề nói ra nguyên nhân**.
  if (u.search || u.hash) {
    throw new RunError(`runtime.public_url không được có "?" hay "#": "${raw}"`, 'other');
  }
  // Giữ path prefix (nginx có thể gắn agentco dưới `/agentco`), bỏ gạch chéo cuối.
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI ĐƯỜNG ĐĂNG NHẬP, VÀ METADATA CHỌN GIÙM — không ai gõ tên hãng.       │
 * │                                                                          │
 * │   có DCR          → web flow + PKCE (Notion)     `oauthStart`            │
 * │   khai device     → mã thiết bị (GitHub)         `oauthDeviceStart`      │
 * │                                                                          │
 * │ Mục danh mục khai `auth: {kind:'device'}` thì đi đường hai. Vì sao khai   │
 * │ trong DỮ LIỆU thay vì tự dò: `client_id` phải có **trước** khi gõ cửa,    │
 * │ và nó không suy được từ handshake — đúng cùng lý do tên biến chìa phải    │
 * │ cố định (§5c).                                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function loginKind(catalogId: string): 'device' | 'web' | null {
  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http') return null;
  return arm.auth?.kind === 'device' ? 'device' : 'web';
}

/** Mở một lượt đăng nhập. Trả URL cho **web UI** mở, không tự mở. */
export async function oauthStart(
  catalogId: string,
  origin: string,
): Promise<StartResult> {
  sweep();
  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http') {
    throw new RunError(`"${catalogId}" không phải dịch vụ đăng nhập được.`, 'other');
  }
  const mcpUrl = arm.spec.url;

  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(`${mcpUrl} không cần đăng nhập — cắm thẳng được.`, 'other');

  const redirectUri = `${origin}/api/oauth/callback`;
  const ck = `${meta.issuer}|${redirectUri}`;
  let clientId = clients.get(ck);
  if (!clientId) {
    clientId = await register(meta, redirectUri);
    clients.set(ck, clientId);
  }

  const { verifier, challenge } = pkce();
  const state = randomState();
  pending.set(state, { meta, clientId, verifier, mcpUrl, prefix: catalogId, redirectUri, at: Date.now() });

  return {
    authUrl: authorizeUrl(meta, { clientId, redirectUri, state, challenge }),
    state,
  };
}

/** Notion gọi về đây. Trả một trang HTML nhỏ, và **không bao giờ trả token**. */
export async function oauthCallback(
  company: Company,
  params: URLSearchParams,
  res: ServerResponse,
): Promise<{ name: string; label?: string } | null> {
  const page = (title: string, body: string, ok: boolean) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font:15px/1.6 system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#faf9f7">` +
        `<div style="text-align:center;max-width:26rem;padding:2rem">` +
        `<div style="font-size:2.5rem">${ok ? '✅' : '❌'}</div>` +
        `<h1 style="font-size:1.1rem;margin:.75rem 0">${title}</h1>` +
        `<p style="color:#6b6b6b">${body}</p></div>` +
        // Tự đóng nếu tab này do `window.open` sinh ra; không thì thôi, câu chữ
        // ở trên đã đủ để người dùng biết phải làm gì.
        `<script>setTimeout(()=>window.close(),1200)</script>`,
    );
  };

  const state = params.get('state') ?? '';
  const p = pending.get(state);
  // Xoá NGAY, kể cả khi sắp hỏng: một `code_verifier` chỉ dùng đúng một lần, và
  // để nó nằm lại là mở cửa cho lần gọi thứ hai với cùng `state`.
  pending.delete(state);

  const err = params.get('error');
  if (err) {
    page('Chưa nối được', `Dịch vụ trả về: ${escapeHtml(err)}. Quay lại agentco và thử lại nhé.`, false);
    return null;
  }
  if (!p) {
    // `state` không khớp ⇒ mã này không phải của lượt ta mở. Đây là chốt CSRF,
    // và nó cũng bắt luôn ca lành tính: bấm F5 trên trang callback.
    page('Lượt đăng nhập đã hết hạn', 'Quay lại agentco và bấm Đăng nhập lần nữa.', false);
    return null;
  }
  const code = params.get('code');
  if (!code) {
    page('Thiếu mã uỷ quyền', 'Dịch vụ không gửi mã về. Thử lại từ agentco.', false);
    return null;
  }

  try {
    const acc = await exchangeCode(p.meta, {
      clientId: p.clientId,
      code,
      redirectUri: p.redirectUri,
      verifier: p.verifier,
      mcpUrl: p.mcpUrl,
    });
    const name = accountName(p.prefix, acc);
    saveOAuth(companyPaths(company.dir), name, acc);
    page('Đã kết nối', `${escapeHtml(acc.label ?? 'Tài khoản của bạn')} giờ dùng được trong agentco.`, true);
    return { name, ...(acc.label ? { label: acc.label } : {}) };
  } catch (e) {
    page('Đổi chìa không thành', escapeHtml((e as Error).message.slice(0, 200)), false);
    return null;
  }
}

// ─────────────────────────────────────────────────────────── device flow

/**
 * Lượt đăng nhập bằng mã thiết bị ĐANG BAY. Trong RAM, cùng lý do `pending`.
 *
 * ⚠ Khác `pending` ở một chỗ đáng nói: ở đây **không có bí mật nào**. `device_code`
 * chỉ có nghĩa khi đi kèm `client_id` công khai, và nó tự chết sau 15 phút. Nên
 * mất map này khi tắt daemon **không mất gì cả** — cách khôi phục đúng vẫn là
 * bấm lại nút.
 */
interface DevicePending {
  meta: AsMeta;
  clientId: string;
  start: DeviceStart;
  mcpUrl: string;
  prefix: string;
  catalogId: string;
  at: number;
}
const devices = new Map<string, DevicePending>();

export interface DeviceStartResult {
  state: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

/** Mở một lượt đăng nhập bằng mã thiết bị. **Không có `redirect_uri`.** */
export async function oauthDeviceStart(catalogId: string): Promise<DeviceStartResult> {
  for (const [k, v] of devices) if (v.at < Date.now() - PENDING_TTL_MS) devices.delete(k);

  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http' || arm.auth?.kind !== 'device') {
    throw new RunError(`"${catalogId}" không đăng nhập bằng mã thiết bị.`, 'other');
  }
  const mcpUrl = arm.spec.url;
  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(`${mcpUrl} không cần đăng nhập — cắm thẳng được.`, 'other');
  if (!supportsDevice(meta)) {
    /**
     * Danh mục khai một đằng, dịch vụ khai một nẻo. Nói thẳng ra là **lời khai
     * của ta sai**, đừng đổ cho người dùng: họ không chọn cái này, ta ship nó.
     */
    throw new RunError(
      `${meta.issuer} không còn hỗ trợ đăng nhập bằng mã thiết bị — mục danh mục này cần cập nhật.`,
      'other',
    );
  }

  const start = await deviceStart(meta, arm.auth.clientId, arm.auth.scope);
  const state = randomState();
  devices.set(state, {
    meta,
    clientId: arm.auth.clientId,
    start,
    mcpUrl,
    prefix: catalogId,
    catalogId,
    at: Date.now(),
  });

  return {
    state,
    userCode: start.user_code,
    verificationUri: start.verification_uri,
    ...(start.verification_uri_complete ? { verificationUriComplete: start.verification_uri_complete } : {}),
    expiresAt: start.expires_at,
    intervalMs: start.interval_ms,
  };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HỎI XEM CHÌA NÀY LÀ CỦA AI. → `catalog.ts §ArmIdentity` · SPEC §5h·7k    │
 * │                                                                          │
 * │ Hỏng thì **KHÔNG giết lượt đăng nhập** — chìa đã cấp thật rồi, và vứt nó  │
 * │ đi vì một lời gọi phụ hỏng là bắt người dùng làm lại toàn bộ vì một thứ   │
 * │ chỉ ảnh hưởng tới cái NHÃN. Rơi về hạt giống mặc định, đúng như trước.    │
 * │                                                                          │
 * │ ⚠ Nhưng phải KÊU: rơi về mặc định nghĩa là tài khoản thứ hai của cùng     │
 * │ hãng sẽ đụng băm. Im lặng ở đây là để dành một lỗi gộp cánh tay cho ngày  │
 * │ khác.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function probeIdentity(
  arm: NonNullable<ReturnType<typeof findArm>>,
  token: string,
): Promise<{ seed?: string; label?: string }> {
  const id = arm.identity;
  if (!id) return {};
  const text = await callTool(id.url, { Authorization: `Bearer ${token}` }, id.tool);
  if (!text) {
    process.emitWarning(
      `Không hỏi được danh tính tài khoản (${arm.name}) — nhãn sẽ để trống, và hai tài khoản ` +
        `của cùng dịch vụ này có thể đụng nhau.`,
    );
    return {};
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const seed = j[id.idField];
    const label = j[id.labelField];
    return {
      // `String()` vì đây là dữ liệu của bên thứ ba: `id` có thể là số.
      ...(seed !== undefined && seed !== null ? { seed: String(seed) } : {}),
      ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}),
    };
  } catch {
    // Tool trả chữ chứ không trả JSON — vẫn không phải lý do để bỏ chìa đi.
    return {};
  }
}

export type DevicePollResult =
  | { state: 'pending'; intervalMs: number; expiresAt: number }
  | { state: 'done'; name: string; label?: string };

/** Một nhịp hỏi thăm. Giao diện gọi lặp; **daemon giữ phiên**, không phải trình duyệt. */
export async function oauthDevicePoll(company: Company, state: string): Promise<DevicePollResult> {
  const p = devices.get(state);
  if (!p) throw new RunError('Lượt đăng nhập đã hết hạn — bấm Đăng nhập lần nữa.', 'other');

  const r = await devicePoll(p.meta, { clientId: p.clientId, start: p.start, mcpUrl: p.mcpUrl });
  if (r.state === 'pending') {
    return { state: 'pending', intervalMs: r.interval_ms, expiresAt: p.start.expires_at };
  }

  // Xong ⇒ dọn NGAY, kể cả khi bước dưới hỏng: một `device_code` đã đổi ra chìa
  // thì lần hỏi thứ hai không còn nghĩa gì.
  devices.delete(state);

  const arm = findArm(p.catalogId);
  const acc = r.account;
  const who = arm ? await probeIdentity(arm, acc.access_token) : {};
  if (who.label) acc.label = who.label;

  const name = accountName(p.prefix, acc, who.seed);
  saveOAuth(companyPaths(company.dir), name, acc);
  return { state: 'done', name, ...(acc.label ? { label: acc.label } : {}) };
}

/** Workspace đã nối — **TÊN và NHÃN, không bao giờ token**. */
export function oauthAccounts(company: Company, prefix?: string): {
  name: string;
  label?: string;
  expiresAt?: number;
  /**
   * Cánh tay nào đang dùng chìa này. Rỗng ⇒ gỡ được.
   *
   * ⚠ Tính ở SERVER và gửi kèm, chứ không để giao diện bấm rồi mới biết bị từ
   * chối: luật *"đừng bày ra một lựa chọn chắc chắn bị từ chối"* (§6e) — và ở
   * đây nó còn mua thêm một thứ, xem `Optimistic UI` chỗ gọi. Cùng khuôn với
   * cờ `orphan` của `listArms`.
   */
  usedBy: string[];
  /**
   * Chìa đã chết — cần ĐĂNG NHẬP LẠI, không phải chờ. → `OAuthAccount.dead`
   *
   * Phải nói ra ở đây, vì nếu không thì triệu chứng duy nhất là cánh tay 401
   * im lặng lúc một nhân viên đang làm việc — xa nguyên nhân.
   */
  dead?: string;
}[] {
  const all = readOAuth(companyPaths(company.dir));
  return Object.entries(all)
    .filter(([name]) => !prefix || name.startsWith(`${prefix.toUpperCase()}_OAUTH_`))
    .map(([name, a]) => ({
      name,
      ...(a.label ? { label: a.label } : {}),
      ...(a.expires_at ? { expiresAt: a.expires_at } : {}),
      ...(a.dead ? { dead: a.dead.why } : {}),
      usedBy: Object.values(company.config.arms)
        .filter((arm) => arm.secrets.includes(name))
        .map((arm) => arm.label || '(chưa đặt tên)'),
    }));
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÒNG LÀM MỚI — **MỘT CHỖ DUY NHẤT**, và chỗ đó là daemon.                │
 * │                                                                          │
 * │ `pickMcp` là **đồng bộ có chủ đích** (`armexec.ts` vừa dọn ~4 giây/task   │
 * │ khỏi đường nóng). Làm mới thì bất đồng bộ. Hai lựa chọn đã cân 25/08:     │
 * │   ⓐ làm mới ở NỀN, `pickMcp` chỉ đọc thứ đã có trên đĩa  ← chọn cái này  │
 * │   ⓑ `pickMcp` thành async — trả lại đúng thứ vừa mua                     │
 * │                                                                          │
 * │ ⚠ VÌ SAO PHẢI LÀ MỘT CHỖ: `refresh_token` **XOAY** (đo 25/08 — mỗi lần    │
 * │ làm mới trả về cả chìa mới lẫn refresh mới, cái cũ chết ngay). Hai tiến   │
 * │ trình cùng làm mới thì cái chậm hơn gửi một refresh **đã chết** ⇒ hỏng,   │
 * │ và nó ghi đè bản tốt bằng bản hỏng. Không có khoá nào cứu được chuyện đó  │
 * │ ngoài việc **chỉ có một người làm**.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Trả về số tài khoản đã làm mới. Hỏng một cái KHÔNG được làm hỏng cái khác.
 */
export async function refreshDue(company: Company): Promise<number> {
  const paths = companyPaths(company.dir);
  let n = 0;
  for (const [name, acc] of Object.entries(readOAuth(paths))) {
    if (!needsRefresh(acc)) continue;
    try {
      const meta = await discover(acc.mcp_url);
      if (!meta) continue;
      const next = await refreshAccount(meta, acc);
      /**
       * ⚠ GHI NGAY, và `saveOAuth` ghi NGUYÊN TỬ (temp + rename) — xem
       * `secrets.ts §writeRaw`. Vì dịch vụ đã XOAY chìa lúc nó trả lời,
       * `next.refresh_token` là thứ duy nhất còn dùng được: một lần ghi cụt là
       * mất tài khoản này, và trước 26/08 còn mất **cả kho**.
       */
      saveOAuth(paths, name, next);
      n++;
    } catch (e) {
      /**
       * ⚠ HAI LOẠI HỎNG, HAI XỬ LÝ NGƯỢC NHAU — gộp chúng là chọn sai ở cả hai.
       *
       *  · tạm (mạng chết, 500) → **im lặng, tick sau thử lại**. Cảnh báo mỗi
       *    15 phút cho một sự cố mạng thoáng qua là dạy người ta bỏ qua log.
       *  · chết hẳn (`invalid_grant`) → **đánh dấu**, thôi thử, và để giao diện
       *    nói *"đăng nhập lại"*. Không đánh dấu thì triệu chứng duy nhất là
       *    cánh tay 401 im lặng lúc một nhân viên đang làm việc — xa nguyên
       *    nhân, và câu 401 nói "chìa sai" chứ không nói "chìa chết".
       */
      if (e instanceof DeadGrantError) {
        saveOAuth(paths, name, { ...acc, dead: { at: new Date().toISOString(), why: e.message } });
        process.emitWarning(
          `Chìa "${acc.label ?? name}" không còn hiệu lực — cần đăng nhập lại. ${e.message}`,
        );
      }
      // Hỏng tạm: KHÔNG được dừng vòng, và không cần kêu. Tick sau thử lại.
    }
  }
  return n;
}

/**
 * GỠ MỘT WORKSPACE — xoá chìa ở máy mình, và **báo cho dịch vụ** nếu nó nhận.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Vì sao cố gắng thu hồi ở phía dịch vụ chứ không chỉ xoá file: người dùng │
 * │ bấm "Gỡ" nghĩa là *"agentco đừng với tới workspace này nữa"*. Xoá mỗi    │
 * │ bản sao của mình mà để chìa còn sống ở Notion là làm ĐÚNG một nửa việc,  │
 * │ và nửa còn lại là nửa họ quan tâm.                                       │
 * │                                                                          │
 * │ ⚠ Nhưng thu hồi hỏng thì **vẫn xoá**. Ngược lại là giam người dùng: mạng │
 * │ chết, dịch vụ không mở `revocation_endpoint`, chìa đã hết hạn — cả ba    │
 * │ đều không phải lý do để giữ một mục họ vừa bảo bỏ đi.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function oauthForget(company: Company, name: string): Promise<void> {
  const paths = companyPaths(company.dir);
  const acc = readOAuth(paths)[name];
  if (!acc) throw new RunError(`Không có tài khoản "${name}".`, 'other');

  /**
   * ⚠ CHẶN KHI CÒN CÁNH TAY DÙNG NÓ — cùng khuôn `Company.forgetArm`.
   *
   * Gỡ một workspace đang được cắm thì cánh tay đó chết im: cấu hình vẫn trỏ
   * `${TÊN}`, mà chìa thì không còn. Triệu chứng lộ ra ở lần một nhân viên dùng
   * nó — xa chỗ gây ra, và không có gì trên màn hình nối hai đầu lại.
   */
  const users = Object.entries(company.config.arms)
    .filter(([, a]) => a.secrets.includes(name))
    .map(([, a]) => a.label || '(chưa đặt tên)');
  if (users.length) {
    throw new RunError(
      `"${acc.label ?? name}" vẫn đang được ${users.length} kết nối dùng (${users.join(', ')}). ` +
        `Gỡ những kết nối đó trước — gỡ tài khoản trước là để lại một cánh tay chết im.`,
      'other',
    );
  }

  // Thu hồi là NỖ LỰC TỐT NHẤT, không phải điều kiện.
  try {
    const meta = await discover(acc.mcp_url);
    if (meta?.revocation_endpoint) {
      await fetch(meta.revocation_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: acc.refresh_token ?? acc.access_token,
          token_type_hint: acc.refresh_token ? 'refresh_token' : 'access_token',
          client_id: acc.client_id,
        }).toString(),
      });
    }
  } catch {
    process.emitWarning(`Không thu hồi được chìa "${name}" ở phía dịch vụ — vẫn xoá ở máy này.`);
  }

  saveOAuth(paths, name, null);
}

/** Nhịp quét. Chìa Notion sống 8 giờ, mốc làm mới là 4 — 15 phút là quá dư. */
export const REFRESH_TICK_MS = 15 * 60_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export type { OAuthAccount };
