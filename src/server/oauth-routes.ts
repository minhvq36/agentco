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
import { t } from '../i18n/index.js';
import { findArm } from '../core/catalog.js';
import { callTool } from '../core/mcp-http.js';
import { readClients, readOAuth, saveClient, saveOAuth } from '../core/secrets.js';
import {
  DeadGrantError,
  accountName,
  authorizeUrl,
  deviceStart,
  devicePoll,
  discover,
  exchangeCode,
  needsRefresh,
  hasOwnSeed,
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
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `client_id` NẰM TRÊN ĐĨA, KHÔNG NẰM TRONG RAM. (truy ra 27/08)        │
 * │                                                                          │
 * │ Bản cũ ở đây là `new Map()`. Tắt daemon là mất ⇒ lần bật sau **đăng ký    │
 * │ một ứng dụng MỚI** ở phía dịch vụ. Người dùng bật/tắt vài chục lần là vài │
 * │ chục ứng dụng, mỗi cái cầm chìa của một nhóm tài khoản.                   │
 * │                                                                          │
 * │ Số đo dẫn tới đây: hai tài khoản Notion chết dùng **chung một `client_id` │
 * │ cũ**, tài khoản còn sống dùng `client_id` mới nhất — và cả hai client vẫn │
 * │ tồn tại (`invalid_grant`, không phải `invalid_client`), nên thứ mất là    │
 * │ **quyền cấp cho ứng dụng cũ**, không phải bản thân chìa.                  │
 * │                                                                          │
 * │ ⇒ Luật: **ứng dụng đứng yên, chỉ chìa xoay.** Đó chính là cách một phiên  │
 * │ web sống được cả năm — thứ người dùng đòi bằng đúng câu *"account         │
 * │ Facebook, Shopee log cả năm có bị ai đá ra đâu"*.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function clientFor(company: Company, key: string): string | undefined {
  return readClients(companyPaths(company.dir))[key];
}

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
      t('srv.oauthLoopbackHost', {
        host: opts.host,
        hint: '  AGENTCO_RUNTIME_PUBLIC_URL=https://agentco.your-company.com',
      }),
      'other',
    );
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RunError(t('srv.oauthPublicUrlInvalid', { raw }), 'other');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new RunError(t('srv.oauthPublicUrlScheme', { scheme: u.protocol }), 'other');
  }
  /**
   * ⚠ `http` chỉ được phép khi đích là chính máy này. Mã uỷ quyền đi qua một
   * chặng `http` trên mạng là đi ở dạng chữ thường — ai đứng giữa cũng đọc
   * được, và mã đó đổi thẳng ra chìa. Phần lớn dịch vụ cũng tự từ chối, nhưng
   * ta không dựa vào việc họ nhớ từ chối hộ.
   */
  const targetLoopback = /^(127\.|localhost$|\[::1\]$)/i.test(u.hostname) || u.hostname === '::1';
  if (u.protocol === 'http:' && !targetLoopback) {
    throw new RunError(t('srv.oauthPublicUrlInsecure', { host: u.hostname }), 'other');
  }
  // Query/hash trong một địa chỉ gốc là dấu hiệu dán nhầm cả một URL nào đó.
  // Bỏ qua im lặng thì `redirect_uri` lệch từng ký tự với thứ đã đăng ký, và
  // dịch vụ trả `invalid_redirect_uri` — câu **không hề nói ra nguyên nhân**.
  if (u.search || u.hash) {
    throw new RunError(t('srv.oauthPublicUrlQuery', { raw }), 'other');
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
  company: Company,
  catalogId: string,
  origin: string,
): Promise<StartResult> {
  sweep();
  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http') {
    throw new RunError(t('srv.oauthNotLoginService', { id: catalogId }), 'other');
  }
  const mcpUrl = arm.spec.url;

  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(t('srv.oauthNoLoginNeeded', { url: mcpUrl }), 'other');

  const redirectUri = `${origin}/api/oauth/callback`;
  const ck = `${meta.issuer}|${redirectUri}`;
  let clientId = clientFor(company, ck);
  if (!clientId) {
    clientId = await register(meta, redirectUri);
    // Ghi NGAY, trước khi mở tab: người dùng đóng daemon giữa chừng thì lần sau
    // vẫn dùng lại đúng ứng dụng này thay vì đăng ký thêm một cái nữa.
    saveClient(companyPaths(company.dir), ck, clientId);
  }

  const { verifier, challenge } = pkce();
  const state = randomState();
  pending.set(state, { meta, clientId, verifier, mcpUrl, prefix: catalogId, redirectUri, at: Date.now() });

  return {
    // `authScope` không khai ⇒ `authorizeUrl` không gửi tham số `scope` nào,
    // đúng hành vi cũ. → `catalog.ts §authScope`
    authUrl: authorizeUrl(meta, {
      clientId,
      redirectUri,
      state,
      challenge,
      ...(arm.spec.authScope ? { scope: arm.spec.authScope } : {}),
    }),
    state,
  };
}

/** Notion gọi về đây. Trả một trang HTML nhỏ, và **không bao giờ trả token**. */
export async function oauthCallback(
  company: Company,
  params: URLSearchParams,
  res: ServerResponse,
): Promise<{ name: string; label?: string } | null> {
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TRANG NÀY LÀ THỨ DUY NHẤT NGƯỜI DÙNG THẤY Ở TAB KIA. (viết lại 30/08)    │
   * │                                                                          │
   * │ User chốt hình dạng: *"chỉ toàn chữ thôi cũng được, không cần icon, chữ   │
   * │ thon gọn không to quá, căn giữa màn hình"* + *"font chữ hiện đại"*.       │
   * │                                                                          │
   * │ Bản cũ mở đầu bằng một emoji ✅/❌ cỡ 2.5rem. Bỏ, và không chỉ vì thẩm mỹ:│
   * │ một dấu tích to đùng **nói mạnh hơn thứ ta biết** — ở nhánh hỏng nó đã    │
   * │ hét lên trước khi người ta kịp đọc câu giải thích, còn ở nhánh thành công │
   * │ nó hứa "xong hết rồi" trong khi việc còn lại (chọn nấc, kéo dây) vẫn nằm  │
   * │ ở tab agentco. Chữ nói vừa đúng phần nó biết.                            │
   * │                                                                          │
   * │ ⚠ Tự-đóng chỉ chạy ở nhánh THÀNH CÔNG. Nhánh hỏng mà tự đóng sau 1,2 giây│
   * │ là **xoá mất câu lỗi trước khi người ta đọc xong** — đúng lớp lỗi §5m     │
   * │ (chuông kêu ở chỗ không ai nghe). Hỏng thì để nguyên, họ tự đóng.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const page = (title: string, body: string, ok: boolean) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title><style>` +
        // `system-ui` đứng đầu để mỗi HĐH lấy đúng bộ chữ hiện đại của nó
        // (Segoe UI Variable · SF Pro · Inter), rồi mới tới các bản dự phòng.
        // Nền TRẮNG, chữ xám, không thẻ — user chốt 30/08: *"không cần màu mè
        // container. Chỉ có nền trắng + chữ (hết)"*. "Chút gương" nằm ở hai chỗ
        // rất nhẹ: một vệt sáng xám loang từ mép trên, và tiêu đề tô bằng
        // gradient dọc (đậm trên, nhạt dưới) — đủ để chữ có chiều sâu mà không
        // cần một khối hình nào.
        `*{box-sizing:border-box}` +
        // ⚠ `height:100%` phải leo tới `html`, không chỉ `body`. Thiếu nó thì
        // `body` cao bằng nội dung, và "căn giữa" chỉ căn trong đúng khối chữ —
        // nhìn ra là lệch lên trên. `100dvh` để thanh địa chỉ trên di động
        // không kéo lệch phần bù.
        `html,body{height:100%}` +
        `body{margin:0;min-height:100dvh;padding:1.5rem;display:flex;align-items:center;justify-content:center;` +
        `background:#fff linear-gradient(180deg,#f3f3f2 0%,#fff 34%) no-repeat;` +
        `color:#6f6c67;` +
        `font-family:system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;` +
        `-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}` +
        `main{width:min(22rem,calc(100vw - 2.5rem));text-align:center}` +
        `.tag{margin:0 0 1.1rem;font-size:10.5px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;color:#a7a39e}` +
        // `color` đặt TRƯỚC làm bản dự phòng: trình duyệt không hiểu
        // `background-clip:text` thì chữ vẫn hiện, chỉ mất hiệu ứng.
        `h1{margin:0;font-size:1.0625rem;font-weight:550;letter-spacing:-.012em;line-height:1.4;color:#33312e;` +
        `background:linear-gradient(180deg,#33312e 12%,#7c7873 100%);` +
        `-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}` +
        `p.say{margin:.55rem 0 0;font-size:.8125rem;font-weight:400;line-height:1.7;color:#8a8681}` +
        `hr{margin:1.3rem auto 0;width:1.5rem;border:0;border-top:1px solid #e6e4e1}` +
        `</style>` +
        `<main><p class="tag">agentco</p>` +
        `<h1>${title}</h1><p class="say">${body}</p><hr></main>` +
        // Chỉ đóng khi XONG, và chỉ đóng được nếu tab này do `window.open` sinh
        // ra. Không đóng được thì thôi — câu chữ ở trên đã đủ để biết làm gì.
        (ok ? `<script>setTimeout(()=>window.close(),1400)</script>` : ''),
    );
  };

  const state = params.get('state') ?? '';
  const p = pending.get(state);
  // Xoá NGAY, kể cả khi sắp hỏng: một `code_verifier` chỉ dùng đúng một lần, và
  // để nó nằm lại là mở cửa cho lần gọi thứ hai với cùng `state`.
  pending.delete(state);

  const err = params.get('error');
  if (err) {
    page(t('srv.oauthPageFailedTitle'), t('srv.oauthPageFailedBody', { error: escapeHtml(err) }), false);
    return null;
  }
  if (!p) {
    // `state` không khớp ⇒ mã này không phải của lượt ta mở. Đây là chốt CSRF,
    // và nó cũng bắt luôn ca lành tính: bấm F5 trên trang callback.
    page(t('srv.oauthPageExpiredTitle'), t('srv.oauthPageExpiredBody'), false);
    return null;
  }
  const code = params.get('code');
  if (!code) {
    page(t('srv.oauthPageNoCodeTitle'), t('srv.oauthPageNoCodeBody'), false);
    return null;
  }

  /**
   * ⚠ HAI KHỐI `try` RIÊNG, KHÔNG PHẢI MỘT. (tách 30/08 — user báo lỗi)
   *
   * Bản cũ bọc cả đổi-chìa lẫn lưu-tài-khoản trong một `try`, và mọi thứ hỏng
   * bên trong đều hiện ra là **"Đổi chìa không thành"**. Ca thật: đổi chìa
   * **đã xong**, thứ hỏng là bước hỏi danh tính — nên câu lỗi chỉ **sai cửa**,
   * và người dùng đi tìm nguyên nhân ở chỗ không có gì. Đúng lớp lỗi §5m, và
   * lần này chính ta dựng lại nó. → [[agentco-wrong-door-errors]]
   */
  let acc: OAuthAccount;
  try {
    acc = await exchangeCode(p.meta, {
      clientId: p.clientId,
      code,
      redirectUri: p.redirectUri,
      verifier: p.verifier,
      mcpUrl: p.mcpUrl,
    });
  } catch (e) {
    page(t('srv.oauthPageExchangeTitle'), escapeHtml((e as Error).message.slice(0, 200)), false);
    return null;
  }

  try {
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 CỬA NÀY TRƯỚC 30/08 TRUYỀN THẲNG `undefined` — VÀ ĐÓ LÀ BUG.    │
     * │                                                                    │
     * │ Chú thích của `mustHaveIdentity` tự dặn: *"MỘT hàm, gọi ở CẢ HAI    │
     * │ đường lưu… chốt ở một cửa rồi để cửa kia mở là kiểu vá đã đốt dự án │
     * │ này nhiều lần"*. Hàng rào **đúng là có ở cả hai cửa** — nhưng thứ    │
     * │ NUÔI nó (`probeIdentity`) thì chỉ có ở đường mã thiết bị. Web flow  │
     * │ khai `undefined`, tức luôn luôn "không có seed".                    │
     * │                                                                    │
     * │ Vô hình suốt vì hai mục web flow đầu tiên đều tự trả danh tính:     │
     * │ Notion có `workspace_id` trong phản hồi token ⇒ `hasOwnSeed` true    │
     * │ ⇒ chốt cho qua mà không cần seed. Linear là mục ĐẦU TIÊN vừa khai   │
     * │ `identity` vừa đi web flow, nên nó là mục đầu tiên đâm vào —        │
     * │ triệu chứng: *"Đã cấp quyền xong"* rồi hỏng ở bước lưu.             │
     * │                                                                    │
     * │ ⇒ Gọi `probeIdentity` y như đường kia. Mục không khai `identity`    │
     * │ thì nó trả `{}` ngay lập tức (0 vòng mạng), nên Notion không mất gì.│
     * │ → [[agentco-finish-completely]]                                    │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const arm = findArm(p.prefix);
    const who = arm ? await probeIdentity(arm, acc.access_token) : {};
    if (who.label) acc.label = who.label;

    mustHaveIdentity(acc, who.seed, arm?.name ?? p.prefix);
    const name = accountName(p.prefix, acc, who.seed);
    saveOAuth(companyPaths(company.dir), name, acc);
    page(
      t('srv.oauthPageDoneTitle'),
      t('srv.oauthPageDoneBody', {
        who: escapeHtml(acc.label ?? t('srv.oauthPageDoneFallbackWho')),
      }),
      true,
    );
    return { name, ...(acc.label ? { label: acc.label } : {}) };
  } catch (e) {
    page(t('srv.oauthPageSaveFailedTitle'), escapeHtml((e as Error).message.slice(0, 200)), false);
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
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CLIENT_ID CỦA CÔNG TY NÀY — của khách nếu họ dán, của ta nếu không.      │
 * │ → SPEC-arms §5h·7h · `catalog.ts §ArmAuth.clientId`                      │
 * │                                                                          │
 * │ ⚠ §5h·7h từng ghi ô này *"là công dân hạng nhất"* trong khi **0 dòng mã** │
 * │ tồn tại (bắt 27/08). Đây là phần thi hành.                                │
 * │                                                                          │
 * │ Vì sao nó không phải tính năng phụ — hai rủi ro của việc agentco đứng tên:│
 * │   ① app của ta bị hãng treo ⇒ **MỌI khách gãy cùng lúc**                  │
 * │   ② khách doanh nghiệp không muốn đi qua danh tính của ta                 │
 * │ Một ô nhập vá cả hai, và nó là câu trả lời tử tế nhất cho *"sao tôi phải  │
 * │ tin agentco"*: **"anh không phải tin."**                                  │
 * │                                                                          │
 * │ Cất ở `$clients` — **cùng kho với client DCR**, và đó là đúng chỗ: cả hai │
 * │ đều trả lời *"công ty này đi bằng danh tính ứng dụng nào"*. Khác nguồn    │
 * │ (một cái hãng mint, một cái khách dán), cùng nghĩa. Khoá `device|<mục>`   │
 * │ vì đường device không có `redirect_uri` để làm khoá như DCR.              │
 * │                                                                          │
 * │ ⚠ VÀ ĐÂY LÀ LÚC `OAuthAccount.client_id` KIẾM ĐƯỢC CHỖ ĐỨNG. Trước hôm   │
 * │ nay nó là bản sao thừa của danh mục (user chỉ ra đúng). Từ giờ có thể tồn │
 * │ tại hai client cùng lúc — chìa cũ do ta cấp, chìa mới do họ cấp — và làm  │
 * │ mới **phải dùng đúng client đã cấp**. Đọc từ danh mục là hỏng ở giờ thứ 4.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const DEVICE_CLIENT_KEY = (catalogId: string) => `device|${catalogId}`;

export function deviceClientId(company: Company, catalogId: string): { id: string; own: boolean } {
  const arm = findArm(catalogId);
  const mine = arm?.auth?.clientId ?? '';
  const theirs = clientFor(company, DEVICE_CLIENT_KEY(catalogId));
  return theirs ? { id: theirs, own: true } : { id: mine, own: false };
}

/** Dán rỗng = **quay về client của agentco**, không phải lưu một chuỗi rỗng. */
export function setDeviceClientId(company: Company, catalogId: string, clientId: string): void {
  const v = clientId.trim();
  const paths = companyPaths(company.dir);
  if (!v) {
    saveClient(paths, DEVICE_CLIENT_KEY(catalogId), null);
    return;
  }
  /**
   * ⚠ CHẶN CHUỖI TRÔNG NHƯ BÍ MẬT. `client_id` là dữ liệu công khai; một chuỗi
   * dài loằng ngoằng dán vào đây gần như chắc chắn là `client_secret` hoặc một
   * private key — và ta vừa ghi nó vào một file người dùng commit lên git được.
   * Cùng luật `SPEC-connectors.md §3c`: *UI phải từ chối lưu nếu phát hiện chuỗi
   * trông giống token.*
   */
  if (v.length > 80 || /\s/.test(v) || /BEGIN|secret|ghp_|gho_|ghs_/i.test(v)) {
    throw new RunError(
      t('srv.oauthNotAClientId'),
      'other',
    );
  }
  saveClient(paths, DEVICE_CLIENT_KEY(catalogId), v);
}

export async function oauthDeviceStart(
  company: Company,
  catalogId: string,
): Promise<DeviceStartResult> {
  for (const [k, v] of devices) if (v.at < Date.now() - PENDING_TTL_MS) devices.delete(k);

  const arm = findArm(catalogId);
  if (!arm || arm.spec.kind !== 'http' || arm.auth?.kind !== 'device') {
    throw new RunError(t('srv.oauthNoDeviceLogin', { id: catalogId }), 'other');
  }
  const mcpUrl = arm.spec.url;
  const meta = await discover(mcpUrl);
  if (!meta) throw new RunError(t('srv.oauthNoLoginNeeded', { url: mcpUrl }), 'other');
  if (!supportsDevice(meta)) {
    /**
     * Danh mục khai một đằng, dịch vụ khai một nẻo. Nói thẳng ra là **lời khai
     * của ta sai**, đừng đổ cho người dùng: họ không chọn cái này, ta ship nó.
     */
    throw new RunError(
      t('srv.oauthDeviceGone', { issuer: meta.issuer }),
      'other',
    );
  }

  // Client của CÔNG TY NÀY — của khách nếu họ đã dán, của ta nếu không.
  const { id: clientId } = deviceClientId(company, catalogId);
  const start = await deviceStart(meta, clientId, arm.auth.scope);
  const state = randomState();
  devices.set(state, {
    meta,
    clientId,
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
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 KHÔNG CÓ DANH TÍNH RIÊNG ⇒ KHÔNG LƯU. Thà bắt đăng nhập lại.          │
 * │ → `oauth.ts §hasOwnSeed` (lý do đầy đủ + hai hậu quả đã cân)              │
 * │                                                                          │
 * │ Tóm tắt: thiếu hạt giống riêng thì `accountName` rơi về `issuer|mcp_url`, │
 * │ **giống hệt nhau cho mọi tài khoản** ⇒ người thứ hai ghi đè người thứ     │
 * │ nhất, im lặng. Một cái tên xấu chỉ phiền; cái này thì mất dữ liệu.        │
 * │                                                                          │
 * │ Vì sao vứt một chìa vừa đúc là ĐÚNG: nó chưa được lưu ở đâu cả, nên không │
 * │ có gì hỏng dở. Người dùng bấm lại một lượt — và lượt sau gần như chắc     │
 * │ chạy vì phiên MCP đã ấm (đúng thứ user quan sát 28/08: *"gỡ đi và làm     │
 * │ lại… nó ra chính xác tên"*).                                              │
 * │                                                                          │
 * │ ⚠ MỘT hàm, gọi ở CẢ HAI đường lưu (web flow + mã thiết bị). Chốt ở một    │
 * │ cửa rồi để cửa kia mở là kiểu vá đã đốt dự án này nhiều lần.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function mustHaveIdentity(acc: OAuthAccount, seed: string | undefined, who: string): void {
  if (hasOwnSeed(acc, seed)) return;
  throw new RunError(t('srv.oauthNoIdentityYet', { who }), 'other');
}

async function probeIdentity(
  arm: NonNullable<ReturnType<typeof findArm>>,
  token: string,
): Promise<{ seed?: string; label?: string }> {
  const id = arm.identity;
  if (!id) return {};
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THỬ HAI LƯỢT, LƯỢT SAU RỘNG HẠN HƠN. (bug user bắt 28/08)             │
   * │                                                                          │
   * │ > *"Lần đầu tiên: tôi chọn 1 account mới, nó ra tên tài khoản là          │
   * │ >  OAUTH_… viết hoa… Tôi gỡ đi và làm lại, vẫn account đó, nó ra chính    │
   * │ >  xác tên"*                                                             │
   * │                                                                          │
   * │ Lượt hỏi này là lời gọi ĐẦU TIÊN tới MCP của hãng bằng chìa vừa đúc, nên  │
   * │ nó phải trả cả cái bắt tay phiên. Trần 10 giây của `callTool` là trần cho │
   * │ một lời gọi **ấm**; lượt lạnh vượt qua được, và lượt thứ hai (đã ấm) thì  │
   * │ nhanh — đúng thứ user quan sát.                                           │
   * │                                                                          │
   * │ ⚠⚠ VÀ HỎNG Ở ĐÂY KHÔNG CHỈ LÀ CÁI TÊN XẤU. Với GitHub, không có `seed`   │
   * │ thì `accountName` rơi về `issuer|mcp_url` — một chuỗi **giống hệt nhau    │
   * │ cho mọi tài khoản** ⇒ cùng tên chìa ⇒ **cùng băm** ⇒ hai tài khoản gộp    │
   * │ thành MỘT cánh tay. Đúng ca §6i mà chú thích ở `accountName` đã cảnh báo, │
   * │ và nó **không có triệu chứng** cho tới khi người thứ hai đăng nhập.       │
   * │                                                                          │
   * │ Nên hai lượt, và người gọi PHẢI xử lý ca vẫn hỏng — xem `oauthDevicePoll`.│
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const auth = { Authorization: `Bearer ${token}` };
  const text =
    (await callTool(id.url, auth, id.tool)) ?? (await callTool(id.url, auth, id.tool, {}, 25_000));
  if (!text) {
    process.emitWarning(
      t('srv.oauthNoIdentityTwice', { name: t(arm.name) }),
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

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TRA BẢN CÀI APP — repo nào hãng thật sự cho cánh tay này đụng vào.       │
 * │ → `catalog.ts §repoScan` · SPEC-arms §5h·7o                              │
 * │                                                                          │
 * │ 🔴 CẢ HÀM NÀY ĐỨNG TRÊN MỘT SỐ ĐO, VÀ SỐ ĐO ĐÓ PHẢN TRỰC GIÁC:           │
 * │ chìa `ghu_` **đọc được repo CÔNG KHAI bất kể app có được cài hay không**  │
 * │ (`list_branches` ✅ trên cả 16 repo trong khi app chỉ cài 2). Nên mọi     │
 * │ phép thử kiểu *"thử đọc một file xem có được không"* đều trả lời CÓ, và  │
 * │ một phép tra luôn trả lời CÓ thì tệ hơn không tra.                        │
 * │                                                                          │
 * │ Thứ phân biệt được là `gateTool` — tool **chỉ đọc nhưng đòi quyền push**. │
 * │ Đo 4/4 đúng với bản cài thật. Đổi tool khác là giết cơ chế, xem chú thích │
 * │ ở `catalog.ts §repoScan.gateTool`.                                        │
 * │                                                                          │
 * │ ⚠ HỎNG THÌ TRẢ `null`, KHÔNG NÉM. Đây là một lời gọi PHỤ: mạng chập hay  │
 * │ hãng đổi tên tool không phải lý do chặn người dùng cắm cánh tay. Giao     │
 * │ diện phân biệt được "tra ra rỗng" (chặn) với "không tra được" (cho qua,   │
 * │ kèm câu nói thật) — hai chuyện khác nhau, hai xử lý khác nhau.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface RepoScan {
  login: string;
  /** Repo app THẬT SỰ được cài vào — thứ nhân viên đụng được đầy đủ. */
  installed: string[];
  /** Tổng số repo tìm thấy của tài khoản. `installed` là tập con. */
  seen: number;
}

export async function scanRepos(
  company: Company,
  catalogId: string,
  account: string,
): Promise<RepoScan | null> {
  const arm = findArm(catalogId);
  const s = arm?.repoScan;
  if (!arm || !s || arm.spec.kind !== 'http') return null;

  const token = readOAuth(companyPaths(company.dir))[account]?.access_token;
  if (!token) return null;
  const url = arm.spec.url;
  const H = { Authorization: `Bearer ${token}` };

  try {
    const me = await callTool(url, H, s.meTool, {});
    if (!me) return null;
    const login = String((JSON.parse(me) as Record<string, unknown>)[s.loginField] ?? '').trim();
    if (!login) return null;

    const raw = await callTool(url, H, s.searchTool, {
      query: s.searchQuery.replace('${login}', login),
      perPage: SCAN_MAX,
    });
    if (!raw) return { login, installed: [], seen: 0 };

    /**
     * Hình dạng phản hồi là của HÃNG, và nó đổi được. Nhận ba hình dạng đã gặp
     * rồi thôi — đoán thêm là dựng một bộ phân tích cho một thứ ta không kiểm
     * soát. Không đọc được ⇒ `seen: 0`, và giao diện nói "không tra được".
     */
    const j = JSON.parse(raw) as Record<string, unknown>;
    const items = (j['items'] ?? j['repositories'] ?? j) as unknown;
    const names = (Array.isArray(items) ? items : [])
      .map((r) => {
        const o = r as Record<string, unknown>;
        return String(o['full_name'] ?? o['fullName'] ?? '').trim();
      })
      .filter((n) => n.includes('/'))
      .slice(0, SCAN_MAX);

    /**
     * SONG SONG, có trần. Tuần tự thì 16 repo mất ~15 giây — người dùng đang
     * đứng nhìn. Trần để không bắn 100 lời gọi cùng lúc vào hãng và ăn 429.
     */
    const installed: string[] = [];
    for (let i = 0; i < names.length; i += SCAN_LANES) {
      const lot = names.slice(i, i + SCAN_LANES);
      const got = await Promise.all(
        lot.map(async (full) => {
          const [owner, repo] = full.split('/');
          if (!owner || !repo) return null;
          const r = await callTool(url, H, s.gateTool, { owner, repo }, SCAN_TIMEOUT_MS);
          return r === null ? null : full;
        }),
      );
      for (const g of got) if (g) installed.push(g);
    }
    return { login, installed, seen: names.length };
  } catch {
    // Xem khối chú thích ở trên: lời gọi phụ hỏng không được chặn lượt cắm.
    return null;
  }
}

/** Trần số repo đem đi kiểm — người có 300 repo không đáng chờ 300 lời gọi. */
const SCAN_MAX = 40;
const SCAN_LANES = 8;
const SCAN_TIMEOUT_MS = 8_000;

export type DevicePollResult =
  | { state: 'pending'; intervalMs: number; expiresAt: number }
  | { state: 'done'; name: string; label?: string };

/** Một nhịp hỏi thăm. Giao diện gọi lặp; **daemon giữ phiên**, không phải trình duyệt. */
export async function oauthDevicePoll(company: Company, state: string): Promise<DevicePollResult> {
  const p = devices.get(state);
  if (!p) throw new RunError(t('srv.oauthSessionExpired'), 'other');

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

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 KHÔNG CÓ DANH TÍNH ⇒ KHÔNG LƯU. Thà bắt đăng nhập lại.                │
   * │                                                                          │
   * │ Mục nào KHAI `identity` là mục mà hãng **không** trả danh tính trong phản │
   * │ hồi token (GitHub). Thiếu `seed` ⇒ `accountName` rơi về `issuer|mcp_url`, │
   * │ giống hệt nhau cho mọi tài khoản ⇒ tài khoản thứ hai **ghi đè** tài khoản │
   * │ thứ nhất, im lặng. Một cái tên xấu chỉ phiền; cái này thì mất dữ liệu.    │
   * │                                                                          │
   * │ Vì sao vứt một chìa vừa đúc được là ĐÚNG: nó chưa được lưu ở đâu cả, nên  │
   * │ không có gì hỏng dở. Người dùng bấm lại một lượt device flow — và lượt    │
   * │ thứ hai gần như chắc chắn chạy, vì phiên MCP giờ đã ấm (đúng thứ user     │
   * │ quan sát: *"gỡ đi và làm lại… nó ra chính xác tên"*).                     │
   * │                                                                          │
   * │ ⚠ Chỉ chặn khi mục CÓ khai `identity`. Notion tự trả `workspace_id` nên   │
   * │ `who` rỗng là chuyện bình thường ở đó — chặn nó là chặn một ca lành.      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  mustHaveIdentity(acc, who.seed, arm?.name ?? p.prefix);

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
        .map((arm) => arm.label || t('srv.oauthUnnamed')),
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
          t('srv.oauthKeyDead', { label: acc.label ?? name, detail: e.message }),
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
  if (!acc) throw new RunError(t('srv.oauthNoAccount', { name }), 'other');

  /**
   * ⚠ CHẶN KHI CÒN CÁNH TAY DÙNG NÓ — cùng khuôn `Company.forgetArm`.
   *
   * Gỡ một workspace đang được cắm thì cánh tay đó chết im: cấu hình vẫn trỏ
   * `${TÊN}`, mà chìa thì không còn. Triệu chứng lộ ra ở lần một nhân viên dùng
   * nó — xa chỗ gây ra, và không có gì trên màn hình nối hai đầu lại.
   */
  const users = Object.entries(company.config.arms)
    .filter(([, a]) => a.secrets.includes(name))
    .map(([, a]) => a.label || t('srv.oauthUnnamed'));
  if (users.length) {
    throw new RunError(
      t('srv.oauthAccountInUse', {
        label: acc.label ?? name,
        n: users.length,
        who: users.join(', '),
      }),
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
    process.emitWarning(`could not revoke key "${name}" on the service side — deleting locally anyway`);
  }

  saveOAuth(paths, name, null);
}

/** Nhịp quét. Chìa Notion sống 8 giờ, mốc làm mới là 4 — 15 phút là quá dư. */
export const REFRESH_TICK_MS = 15 * 60_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export type { OAuthAccount };
