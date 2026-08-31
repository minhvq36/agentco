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
import { openFolder } from '../cli/daemonfile.js';
import { browseDirs } from '../core/paths.js';
import { buildConfig, catalogForUi, defaultOptions, findArm, normRepo } from '../core/catalog.js';
import { baselineTokens, probeArm, toolsAtTier, type Tier } from '../core/probe.js';
import { callTool, httpTarget } from '../core/mcp-http.js';
import { cliToolNames, isCliArm } from '../core/cli-arm.js';
import { grantFor, injectSecrets, missingSecretRefs, readSecrets } from '../core/secrets.js';
import { companyPaths, officeDir, officePaths } from '../core/paths.js';
import { endLogin, startLogin } from '../core/browser-login.js';
import {
  REFRESH_TICK_MS,
  oauthAccounts,
  oauthCallback,
  oauthDevicePoll,
  oauthDeviceStart,
  oauthForget,
  oauthStart,
  redirectBase,
  refreshDue,
  scanRepos,
  deviceClientId,
  setDeviceClientId,
} from './oauth-routes.js';

/**
 * Yêu cầu này đến từ chính máy đang chạy daemon?
 *
 * Chỉ đọc địa chỉ SOCKET — `Host` và `X-Forwarded-For` do client gửi nên giả
 * được. IPv4-mapped (`::ffff:127.0.0.1`) là dạng Node trả về khi socket lắng
 * nghe trên IPv6 nhưng nhận kết nối IPv4; bỏ sót nó là chặn nhầm chính máy
 * mình trên phần lớn cấu hình mặc định.
 */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

/**
 * Cấu hình cánh tay sắp dùng: hoặc client gửi thẳng (`config`), hoặc SERVER
 * DỰNG từ mục danh mục (`catalogId` + `folders`).
 *
 * ⚠ Đường thứ hai tồn tại để **số phiên bản gói chỉ nằm ở MỘT chỗ**. Bản trước
 * client tự ghép `npx -y @…/server-filesystem@2026.7.10 <dirs>` — tức chuỗi ghim
 * phiên bản nằm ở cả `catalog.ts` lẫn `ArmDialog.tsx`. Hai bản của cùng một hằng
 * số là chuyện đã đốt dự án này một lần rồi (`agentSlot` vs `arrange`, xem
 * `layout-geometry.ts`): chúng lệch nhau, và không ai thấy cho tới khi hỏng.
 */
/**
 * Dữ kiện **của server** đi kèm một yêu cầu cắm cánh tay — gom vào một chỗ để
 * hai route không tự tính hai kiểu.
 *
 * ⚠ `loopbackOk` đọc từ **địa chỉ socket**, không phải `Host`: client gửi `Host`
 * gì cũng được, còn địa chỉ socket thì không giả được. Cùng cổng đã dùng cho nút
 * 📂 (`isLoopback`) — chỗ thứ tư của cùng một sự thật, không phải cơ chế thứ hai.
 *
 * 📌 KHÔNG còn `stateDir` ở đây nữa (bỏ 29/08). Đường dẫn **không đi vào cấu
 * hình** — sổ giữ ô trống `<OFFICE_STATE>`, `injectSecrets` điền lúc spawn. Lý do
 * đầy đủ ở `secrets.ts §injectSecrets.dirs`. Khối dưới giữ lại vì nó ghi **chỗ
 * đúng để điền**, thứ vẫn còn hiệu lực:
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Đích = **`<văn phòng>/.state/browser`** — và chỗ này thoả HAI điều        │
 * │ kiện cùng lúc, đó là lý do nó thắng hai phương án tôi thử trước:          │
 * │                                                                          │
 * │  ① **theo VĂN PHÒNG** — mục danh mục là bản thiết kế, văn phòng clone ra  │
 * │     một bản của mình (user đính chính 29/08). Hai văn phòng cắm cùng một  │
 * │     mục thì có hai hồ sơ riêng, không giẫm lên nhau.                      │
 * │  ② **sau `guardedZone`** — `paths.ts §guardedZone` gác **cả** `.state`    │
 * │     của công ty **lẫn** của văn phòng. Quan trọng vì hồ sơ trình duyệt    │
 * │     chứa **cookie đăng nhập** của khách: để nó ở chỗ nhân viên đọc được   │
 * │     là để chìa ngay cạnh ổ khoá.                                          │
 * │                                                                          │
 * │ ⚠ CA CÒN HỞ, ghi ra để đừng quên: danh sách **dùng lại** cho phép một văn │
 * │ phòng nhận một cánh tay do văn phòng khác cắm. Lúc đó cấu hình cũ được    │
 * │ dùng nguyên (đường `armId` không dựng lại), nên đường dẫn vẫn trỏ về      │
 * │ **văn phòng cũ**. Chưa vá — cần hoặc loại mục có `dirs` khỏi danh sách    │
 * │ dùng lại, hoặc dựng lại đường dẫn lúc nhận.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỤC NÀY CÓ CẦN GIẢI DANH SÁCH VIỆC KHÔNG — hay cứ cấp cả server?         │
 * │                                                                          │
 * │ 🔴 SUÝT SHIP MỘT LỖ 29/08, và nó im lặng hoàn toàn: mục trình duyệt đổi   │
 * │ sang `tiered: false` (vì nấc `read` không mở nổi một trang — bài 18 C-1). │
 * │ Điều kiện cũ chỉ hỏi `readOnly || tiered` ⇒ mục này rơi vào nhánh         │
 * │ `tools: []` = **cấp CẢ SERVER** ⇒ `scopedTools` không chạy ⇒ **`neverTools`│
 * │ không được áp**, và `browser_evaluate` (chạy JS tuỳ ý) được cấp.          │
 * │                                                                          │
 * │ Không có triệu chứng nào: cánh tay chạy tốt hơn trước, chỉ rộng hơn thứ   │
 * │ ta khai. Đúng họ *"hỏng theo chiều NỚI QUYỀN, không triệu chứng"* (§5t).  │
 * │                                                                          │
 * │ ⇒ Hỏi đủ BA vế. Thêm một cơ chế giới hạn mà quên vế của nó ở đây là mở    │
 * │ lại đúng cái lỗ này bằng một cái tên khác.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function needsToolList(arm?: { readOnly?: boolean; tiered?: boolean; neverTools?: readonly string[] }): boolean {
  return Boolean(arm?.readOnly || arm?.tiered || arm?.neverTools?.length);
}

/**
 * Nấc để giải danh sách việc. Mục **có nấc** thì mặc định `read` (an toàn khi
 * chưa ai chọn); mục **không có nấc** thì không có gì để chọn, nên `full` —
 * giới hạn của nó đến từ `neverTools`, không đến từ nấc.
 */
function tierFor(arm: { tiered?: boolean } | undefined, level?: Tier): Tier {
  return level ?? (arm?.tiered ? 'read' : 'full');
}

function armCtx(req: http.IncomingMessage): { loopbackOk: boolean } {
  return { loopbackOk: isLoopback(req.socket.remoteAddress) };
}

/** Đích thật của ô trống `<OFFICE_STATE>` — dùng chung cho probe và lúc chạy. */
export function officeStateDir(companyDir: string, office: string): string {
  return path.join(officePaths(officeDir(companyPaths(companyDir), office)).state, 'browser');
}

/**
 * Cặp đường dẫn mà `probeArm` và `pickMcp` **cùng** cần — một hàm để hai cửa
 * không thể lệch nhau. `officeDir` là chỗ tiến trình con của cánh tay CLI được
 * phép sống; thiếu nó thì `prepareArm` **cố ý không dựng server** thay vì đoán
 * một `cwd` rồi thả tiến trình con chạy ở thư mục của daemon.
 */
export function armDirs(companyDir: string, office: string): { officeState: string; officeDir: string } {
  return {
    officeState: officeStateDir(companyDir, office),
    officeDir: officeDir(companyPaths(companyDir), office),
  };
}

export function armConfig(body: {
  config?: Record<string, unknown>;
  catalogId?: string;
  folders?: string[];
  account?: string;
  groups?: string[];
  level?: string;
  /**
   * 🔴 KHÁM PHÁ ⇒ **BỎ NẤC ĐI**, dù `level` có nằm trong `body` hay không.
   *
   * Cờ này ở ĐÂY chứ không ở chỗ gọi, và đó là bài học của bản vá hỏng 27/08:
   * chỗ gọi viết `armConfig({ ...body, ...(discovery ? {} : { level }) })` — mà
   * `...body` **đã mang `body.level` vào rồi**, nên spread có điều kiện chỉ thôi
   * *ghi đè*, không hề *xoá*. Bản vá không đổi gì cả và user báo lại y nguyên.
   *
   * ⇒ Một cờ, đọc ở đúng một chỗ, ngay cạnh chỗ nấc được dùng. Chỗ gọi không còn
   * cách nào viết sai. → `catalog.ts §serverFenced`
   */
  discovery?: boolean;
  /**
   * Id các ô tick người dùng bật (`CatalogArm.options`). → `catalog.ts §ArmOption`
   *
   * ⚠ `undefined` = *"client không nói gì"* ⇒ rơi về **bật sẵn**. Mảng **rỗng** =
   * *"người dùng đã bỏ tick hết"* ⇒ tôn trọng, không rơi về mặc định. Gộp hai ca
   * này là biến một lựa chọn tường minh thành một lần bấm không có tác dụng.
   */
  options?: string[];
}, /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠⚠ THAM SỐ RIÊNG, KHÔNG NHÉT VÀO `body` — và đây là chuyện BẢO MẬT.      │
   * │                                                                          │
   * │ `body` đến từ client. Chỗ gọi viết `armConfig({ ...body, … })`, nên bất kỳ│
   * │ trường nào nằm trong `body` đều **client gửi lên được**. Một cờ           │
   * │ `loopbackOk` nằm trong đó là một cờ **tự khai**: ai cũng bật được, và cổng│
   * │ "chỉ cho mở cửa sổ khi cùng máy" thành trang trí.                         │
   * │                                                                          │
   * │ Đây đúng lớp lỗi §5t đã dẫm: `...body` **đã mang `body.level` vào rồi**   │
   * │ nên bản vá tưởng là xoá hoá ra chỉ ghi đè. Chỗ nào client viết được thì   │
   * │ chỗ đó không giữ được một quyết định của server.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  ctx: {
    /** `isLoopback(req.socket.remoteAddress)` — địa chỉ SOCKET, không phải `Host`. */
    loopbackOk?: boolean;
    /** Thư mục `.browser` của văn phòng, cho chế độ nào cần ghi hồ sơ. */
  } = {},
): Record<string, unknown> | undefined {
  if (body.config) return body.config;
  const arm = body.catalogId ? findArm(body.catalogId) : undefined;
  if (!arm) return undefined;
  /**
   * ⚠ Nhóm nào KHÔNG tick thì không được lọt vào cấu hình, và mục có `groups`
   * mà client không gửi gì thì rơi về **những nhóm bật sẵn** — KHÔNG rơi về
   * "cắm cả server". Với GitHub, "cả server" là ≈30 000 token mỗi lượt (§5h·7e):
   * một mặc định quên tay ở đây là hoá đơn của khách, không phải một chi tiết.
   */
  const groups =
    body.groups ?? (arm.groups ? arm.groups.filter((g) => g.on).map((g) => g.id) : undefined);
  // Nấc chỉ đi vào cấu hình khi đang dựng bản THI HÀNH. Xem `discovery` ở trên.
  const level = body.discovery ? undefined : body.level;

  /**
   * Chế độ: id client gửi → đối tượng. Không khớp id nào ⇒ rơi về **mặc định**,
   * KHÔNG ném — một id lạ là chuyện của giao diện cũ, và mặc định là chế độ hẹp
   * nhất nên rơi về nó là rơi về phía an toàn.
   *
   * 🔴 Nhưng `loopbackOnly` thì NÉM, không rơi: người dùng chọn "hiện cửa sổ" mà
   * ta lặng lẽ đưa bản chạy ẩn thì họ ngồi đợi một cửa sổ **không bao giờ hiện**,
   * và không có gì để họ hiểu vì sao. Từ chối kèm lý do là đường duy nhất nói thật.
   */
  const options = arm.options
    ? body.options
      ? arm.options.filter((o) => body.options?.includes(o.id))
      : defaultOptions(arm)
    : undefined;

  for (const o of options ?? []) {
    if (o.loopbackOnly && !ctx.loopbackOk) {
      throw new RunError(
        `"${o.label}" chỉ bật được khi bạn mở agentco trên chính máy đang chạy nó. ` +
          `Cửa sổ trình duyệt mở trên máy chủ, nên xem từ xa thì không ai nhìn thấy nó.`,
        'other',
      );
    }
  }

  return buildConfig(arm.spec, {
    folders: body.folders ?? [],
    ...(body.account ? { account: body.account } : {}),
    ...(groups ? { groups } : {}),
    ...(level ? { level } : {}),
    ...(options ? { options } : {}),
  });
}

/**
 * BA ĐƯỜNG VÀO, MỘT KIỂU TRẢ VỀ. Chỗ duy nhất quyết định "cánh tay này là gì".
 *
 *   `armId`     dùng lại mục đã có trong sổ → SỔ là nguồn (kể cả chìa)
 *   `catalogId` mục danh mục               → DANH MỤC là nguồn tên chìa
 *   `config`    người dùng tự dán (đường B) → tên chìa suy từ chính ô trống
 *
 * ⚠ Đường thứ ba: tên chìa lấy từ `${…}` trong cấu hình họ dán, **không** từ
 * `Object.keys(body.secrets)`. Hai thứ đó lệch nhau được — gõ thừa một ô, hoặc
 * bỏ trống một ô — và `secretNames` đi thẳng vào BĂM, tức lệch là ra một cánh
 * tay khác. Nguồn sự thật phải là thứ server MCP thật sự đọc: cái ô trống.
 */
function resolveArm(
  company: Company,
  body: {
    armId?: string;
    config?: Record<string, unknown>;
    catalogId?: string;
    folders?: string[];
    secrets?: Record<string, string>;
    /** Tên chìa OAuth của tài khoản đã chọn. → `oauth.ts §accountName` */
    account?: string;
    /** Nấc quyền người dùng chọn. Đi vào băm. → §6j */
    level?: Tier;
    /** Nhóm việc đã tick. Vào `headers` ⇒ vào BĂM. → `catalog.ts §toolsetHeader` */
    groups?: string[];
  },
  /**
   * 🔴 KHÁM PHÁ, KHÔNG PHẢI THI HÀNH — dựng cấu hình **không mang hàng rào nấc**.
   *
   * Chỉ nút "Thử ngay" dùng cờ này. Lý do đầy đủ ở `catalog.ts §serverFenced`;
   * tóm tắt: nấc `read` gửi `X-MCP-Readonly` lên GitHub ⇒ server chỉ trả việc
   * đọc ⇒ `offeredTiers` thấy ba nấc bằng nhau ⇒ **bộ chọn nấc không hiện** ⇒
   * người dùng bị khoá vĩnh viễn ở nấc thấp nhất. Câu hỏi của nút Thử là *"tối
   * đa làm được gì"*, nên nó phải hỏi khi cửa còn mở.
   *
   * ⚠ KHÔNG nới quyền: `level` trả về vẫn nguyên, bản LƯU vẫn dựng có hàng rào,
   * và `scopedTools` lúc lưu vẫn hỏi lại server theo đúng nấc.
   */
  discovery = false,
  /** Xem khối chú thích cùng tên ở `armConfig` — nó phải là THAM SỐ, không phải trường của `body`. */
  ctx: { loopbackOk?: boolean } = {},
): {
  config: Record<string, unknown>;
  secretNames: string[];
  secrets: Record<string, string>;
  /** Việc được cấp, nếu đã biết sẵn. `undefined` = phải giải lúc cắm. */
  tools?: string[];
  label?: string;
  catalog?: string;
  level?: Tier;
} | undefined {
  if (body.armId) {
    const r = company.reuseArm(body.armId);
    return {
      config: r.config,
      secretNames: r.secretNames,
      secrets: r.secrets,
      ...(r.level ? { level: r.level } : {}),
      // Đã giải lúc cắm lần đầu — dùng lại chính danh sách đó. Giải LẠI là mở
      // cửa cho hai văn phòng cầm hai danh sách khác nhau của cùng một cánh tay
      // (hãng thêm việc ghi hôm nay, văn phòng cắm hôm nay nhận nhiều hơn).
      tools: r.tools,
      label: r.label,
      ...(r.catalog ? { catalog: r.catalog } : {}),
    };
  }
  const fromCatalog = body.catalogId ? findArm(body.catalogId) : undefined;
  /**
   * ⚠ NẤC PHẢI CHỐT **TRƯỚC** KHI DỰNG CẤU HÌNH, không phải sau.
   *
   * Với mục có `readOnlyHeaders`, nấc **đổi chính cấu hình** (thêm header hàng
   * rào của server). Dựng cấu hình rồi mới suy nấc mặc định ⇒ lượt cắm không
   * chọn nấc sẽ ghi `level: 'read'` vào sổ mà cấu hình lại **thiếu hàng rào** —
   * hai nguồn nói hai chuyện về cùng một cánh tay, và nguồn sai là nguồn đang
   * thi hành. Đúng họ lỗi §15i (*"đọc nhầm cấu hình CHẠY thay vì cấu hình KHAI"*).
   */
  // Nấc vẫn tính và vẫn vào SỔ như cũ. Việc bỏ nó khỏi CẤU HÌNH lúc khám phá do
  // `armConfig` lo — một cờ, đọc ở đúng một chỗ.
  const level = fromCatalog?.tiered ? (body.level ?? 'read') : body.level;
  const config = armConfig({ ...body, ...(level ? { level } : {}), discovery }, ctx);
  if (!config) return undefined;

  /**
   * Tên chìa lấy từ DANH MỤC, không từ client: client gửi giá trị, còn tên biến
   * phải khớp chính xác thứ server MCP đọc — đó là sự thật của ta.
   *
   * Đường B thì HỢP hai nguồn: ô trống `${…}` (cửa của server HTTP) và khoá
   * client gửi (cửa `env` của server stdio, nơi không có ô trống nào để đọc).
   *
   * 🔴 VÀ TÀI KHOẢN OAUTH PHẢI CÓ TRONG DANH SÁCH NÀY. (bug user báo 26/08)
   *
   * Notion khai `secrets: []` — đúng, vì tên chìa của nó sinh lúc đăng nhập.
   * Nhưng bỏ qua `body.account` thì `secretNames` rỗng, kéo theo **hai** hỏng,
   * và cái thứ hai im lặng hơn hẳn:
   *   ① `probeArm` không có chìa ⇒ ô trống còn nguyên ⇒ *"Thiếu chìa"* ngay ở
   *      nút Thử — đây là cái user nhìn thấy.
   *   ② `grantArm` ghi `role.secrets` từ danh sách này. Rỗng ⇒ `pickMcp` không
   *      tiêm gì ⇒ cánh tay **401 lúc nhân viên đầu tiên dùng nó**, sau khi
   *      giao diện đã báo ✓. Đúng lớp lỗi §5i, qua một cửa mới.
   */
  const secretNames = fromCatalog
    ? [...fromCatalog.secrets.map((s) => s.name), ...(body.account ? [body.account] : [])]
    : [...new Set([...missingSecretRefs(config), ...Object.keys(body.secrets ?? {})])].sort();

  /**
   * 🔴 GIÁ TRỊ CHÌA PHẢI ĐỌC TỪ KHO, KHÔNG CHỈ NHẬN TỪ CLIENT. (cùng bug)
   *
   * Bản cũ ở đây là `secrets: body.secrets ?? {}` — tức chỉ biết những chìa
   * người dùng **vừa gõ trong hộp thoại này**. Với OAuth thì không có gì để gõ:
   * chìa nằm ở `.state/secrets.json` từ lúc đăng nhập xong. `reuseArm` đã đọc
   * kho (nó gọi `grantFor`), còn đường cắm-mới thì không — hai đường cho cùng
   * một câu hỏi, và đường mới hơn là đường quên.
   *
   * ⚠ Client ghi đè kho, không phải ngược lại: người dùng đang gõ một chìa MỚI
   * thì thứ họ vừa gõ mới là thứ đúng, kho còn giữ chìa cũ.
   */
  const { env } = grantFor(readSecrets(companyPaths(company.dir)), secretNames);

  return {
    config,
    // Mục có nấc thì nấc là BẮT BUỘC — mặc định `read`, an toàn khi chưa chọn.
    ...(level ? { level } : {}),
    secretNames,
    secrets: { ...env, ...(body.secrets ?? {}) },
    ...(needsToolList(fromCatalog) ? {} : { tools: [] }),
    ...(body.catalogId ? { catalog: body.catalogId } : {}),
  };
}

/**
 * Giải cờ `readOnly` của danh mục thành DANH SÁCH TÊN VIỆC, bằng cách hỏi server.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO HỎI SERVER CHỨ KHÔNG NHẬN TỪ CLIENT — dù client vừa bấm "Thử ngay"│
 * │ và đang cầm sẵn danh sách đó.                                            │
 * │                                                                          │
 * │ Cùng lý lẽ với dòng ngay dưới (*"tên chìa lấy từ DANH MỤC, không từ       │
 * │ client"*): thứ quyết định **agent được gọi gì** phải là sự thật của       │
 * │ server, không phải một mảng JSON đi qua HTTP. Đây là ranh giới đặc quyền, │
 * │ và ranh giới đặc quyền không được tin vào phía bên kia nó — kể cả khi     │
 * │ phía bên kia hôm nay là giao diện của chính ta trên localhost.            │
 * │                                                                          │
 * │ Giá: một lần bắt tay nữa lúc bấm Xong. Trả một lần, lúc người dùng còn    │
 * │ đứng đó và biết mình đang chờ — đúng lý lẽ đã dùng để giữ `ensureInstalled`│
 * │ trong `probeArm` (§6c).                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ MẶC ĐỊNH TỪ CHỐI. `levelOf` xếp tool không khai `readOnly` vào
 * `write_external` ⇒ nó **không** vào danh sách. Vắng annotations không phải
 * tín hiệu an toàn. Và probe hỏng ⇒ trả `[]` ⇒ `armGrants` cấp **cả server** —
 * 🔴 đó là chiều SAI, nên chỗ gọi phải coi mảng rỗng là **lỗi**, không phải
 * "không giới hạn". Xem `readOnlyTools` được dùng ở đâu bên dưới.
 */
async function scopedTools(
  config: Record<string, unknown>,
  secrets: Record<string, string> | undefined,
  tier: Tier,
  /**
   * Việc bị mục danh mục cấm hẳn — xem `catalog.ts §neverTools`. CHỈ CẮT.
   * Đặt tham số này **sau** `tier` chứ không trộn vào `tier`: nấc là thứ người
   * dùng chọn, còn đây là thứ ta quyết hộ, và hai thứ đó không được lẫn vào nhau.
   */
  never: readonly string[] = [],
  /** Đường dẫn `probeArm` cần — xem `server.ts §armDirs`. */
  dirs?: { officeState: string; officeDir: string },
): Promise<string[]> {
  const r = await probeArm({ arm: config as never }, undefined, secrets, dirs);
  if (r.status !== 'connected') {
    throw new RunError(
      `Không nối được để đọc danh sách việc: ${r.error ?? r.status}. ` +
        `Cánh tay có giới hạn quyền không cắm được khi chưa biết việc nào thuộc nấc nào.`,
      'other',
    );
  }
  const granted = toolsAtTier(r.tools, tier).filter((n) => !never.includes(n));
  if (!granted.length) {
    /**
     * 🔴 MẢNG RỖNG LÀ CHIỀU SAI, KHÔNG PHẢI "KHÔNG GIỚI HẠN".
     *
     * `armGrants` đọc `tools: []` thành **cấp CẢ SERVER**. Nên ở đây rỗng phải
     * là **lỗi**, không phải một giá trị đi tiếp được. Ca thật: server không
     * khai `annotations` nào ⇒ mọi việc rơi vào nấc `full` ⇒ chọn `read` ra 0
     * việc. Giao diện đáng lẽ đã không cho chọn nấc đó (`offeredTiers`), nhưng
     * chốt thật phải nằm ở đây — client bỏ qua được.
     */
    throw new RunError(
      `Server trả ${r.tools.length} việc nhưng KHÔNG việc nào thuộc mức quyền này. ` +
        `Nhiều khả năng server không khai annotations — chọn mức cao hơn, hoặc tự chọn từng việc.`,
      'other',
    );
  }
  return granted;
}

/**
 * Đuôi file KHÔNG BAO GIỜ được render trong trình duyệt, luôn ép tải về.
 *
 * `.svg` và `.html` là văn bản, trông vô hại, và chạy được JavaScript. Chúng do
 * MODEL sinh ra — không phải do người dùng viết — và daemon phục vụ chúng ở
 * cùng origin với chính giao diện điều khiển công ty, thứ không có xác thực nào
 * ngoài "cùng máy". Xem trước một file như thế là cho nó chạy trong nhà.
 */
const RISKY = new Set(['svg', 'html', 'htm', 'xhtml']);

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ĐƯỜNG DUY NHẤT DƯỚI `/api/` KHÔNG ĐI QUA CỔNG TOKEN — và phải thế.    │
 * │ (tìm ra 26/08 khi user hỏi *"VPS có bảo mật thì OAuth work không?"*)     │
 * │                                                                          │
 * │ Dịch vụ trả mã uỷ quyền bằng một **302 tới trình duyệt người dùng**, và  │
 * │ trình duyệt đi theo redirect đó như một lần điều hướng bình thường: nó   │
 * │ **không** gắn `x-agentco-token`, và ta không được nhét token vào          │
 * │ `redirect_uri` (nó phải khớp từng ký tự với thứ đã đăng ký, và nó sẽ nằm │
 * │ trong log của dịch vụ). ⇒ Ở chế độ VPS, cổng token trả **401** đúng ở     │
 * │ bước cuối, **mọi lần**, cho tới khi có dòng loại trừ này.                 │
 * │                                                                          │
 * │ ⚠ Không phải nới lỏng bảo mật: xác thực của đường này là **`state`** —    │
 * │ 128 bit ngẫu nhiên, sống ≤10 phút, dùng đúng một lần, và không khớp thì   │
 * │ **không có gì xảy ra cả**. Đó là chốt CSRF đúng của OAuth; token của      │
 * │ daemon chồng lên nó không thêm được gì, mà lại làm gãy cả luồng.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_CALLBACK = '/api/oauth/callback';

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

  /**
   * Cổng THẬT SỰ đang lắng nghe. Khai ở đây chứ không đọc `const port` phía
   * dưới: socket bắt đầu nhận kết nối ngay khi `listen` gọi lại, tức TRƯỚC khi
   * dòng `const port = …` chạy. Một request lọt vào khe đó sẽ chạm vùng chết
   * của `const` và ném `ReferenceError` — hiếm, và vì hiếm nên sẽ không ai
   * dựng lại được nó lúc đi tìm.
   */
  let boundPort = opts.port;

  /**
   * Tên miền thật của người triển khai, suy MỘT LẦN từ `runtime.public_url`.
   *
   * Bỏ trống (chạy trên máy mình) ⇒ `undefined` ⇒ `hostAllowed` giữ nguyên hành
   * vi cũ từng ký tự. URL rác ⇒ cũng `undefined`: chốt Host **phải hẹp lại khi
   * nghi ngờ**, không được nới ra. Câu lỗi về URL rác đã có ở `redirectBase`,
   * nơi người dùng đang thật sự bấm.
   */
  const publicHost = (() => {
    const raw = company.config.runtime.public_url?.trim();
    if (!raw) return undefined;
    try {
      return new URL(raw).hostname;
    } catch {
      return undefined;
    }
  })();

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
    // Host là tên miền đó, không phải localhost. Tên miền THẬT của người triển
    // khai đi qua được nhờ chính khai báo họ đã đặt. → `hostAllowed`
    if (!hostAllowed(req.headers.host, host, publicHost)) {
      return json(res, 403, { error: 'Host không được phép' });
    }

    if (opts.token && url.pathname.startsWith('/api/') && url.pathname !== OAUTH_CALLBACK) {
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
    // ── cánh tay (MCP) — cấp CÔNG TY. → docs/SPEC-arms.md §6
    //
    // Ở cấp công ty vì `mcpServers` là cấp công ty: cắm một lần, mọi văn phòng
    // dùng lại được mà không phải khai chìa lần hai. Còn AI ĐƯỢC DÙNG thì là
    // chuyện của văn phòng — nó đi qua cạnh nối trên canvas, không qua đây.
    /**
     * Duyệt thư mục cho bộ chọn. Liệt kê filesystem của DAEMON — đúng cái mà
     * cánh tay sẽ nhìn thấy, không phải cái của người đang ngồi trước màn hình.
     * Chỉ trả TÊN thư mục, không đọc nội dung gì. → `paths.ts §browseDirs`
     */
    if (url.pathname === '/api/browse' && method === 'GET') {
      return json(res, 200, browseDirs(url.searchParams.get('path') ?? undefined));
    }
    if (url.pathname === '/api/arms/catalog' && method === 'GET') {
      return json(res, 200, { arms: catalogForUi() });
    }
    /**
     * ── ĐĂNG NHẬP MỘT DỊCH VỤ. → `server/oauth-routes.ts`
     *
     * ⚠ `/start` trả về một **URL cho web UI tự mở**, daemon KHÔNG spawn trình
     * duyệt: trình duyệt người dùng đang ngồi đã có sẵn phiên Notion, trình
     * duyệt mặc định của máy thì chưa chắc. (bài học 24/08)
     */
    if (url.pathname === '/api/oauth/start' && method === 'POST') {
      const body = await readJson<{ catalogId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: 'thiếu "catalogId"' });
      /**
       * `redirect_uri` phải khớp TỪNG KÝ TỰ với thứ đã đăng ký — và nó KHÔNG
       * được suy từ header `Host` (client giả được, mà đây là nơi mã uỷ quyền
       * bay về). Ba nhánh, kể cả nhánh TỪ CHỐI khi daemon bind ra ngoài mà chưa
       * ai khai địa chỉ thật. → `oauth-routes.ts §redirectBase`
       */
      const origin = redirectBase({
        host,
        port: boundPort,
        publicUrl: company.config.runtime.public_url,
      });
      return json(res, 200, await oauthStart(company, body.catalogId, origin));
    }
    /**
     * Notion gọi về đây. KHÔNG phải `/api/` theo nghĩa thông thường — nó trả
     * HTML cho một tab trình duyệt, không trả JSON cho giao diện.
     *
     * ⚠ Nằm TRƯỚC chốt `sameSite`? Không cần: đây là `GET`, mà chốt đó chỉ áp
     * cho method đổi trạng thái. Nhưng nó ĐỔI trạng thái thật (lưu chìa) — an
     * toàn nhờ `state`: không có `state` khớp một lượt ta vừa mở thì không có gì
     * xảy ra cả. Đó là chốt CSRF đúng của OAuth, không phải header của trình duyệt.
     */
    if (url.pathname === OAUTH_CALLBACK && method === 'GET') {
      const done = await oauthCallback(company, url.searchParams, res);
      if (done) {
        /**
         * Giao diện đang chờ ở TAB KIA — báo để nó tự chuyển trạng thái thay vì
         * bắt người dùng F5. Đây là cả điểm của việc redirect về daemon: cái tab
         * vừa xong không phải tab đang mở agentco.
         *
         * ⚠ Chỉ TÊN và NHÃN. Token không bao giờ đi qua đường này — SSE là kênh
         * phát cho mọi client đang nghe.
         */
        const payload = `data: ${JSON.stringify({
          type: 'company.offices',
          say: `Đã kết nối ${done.label ?? done.name}.`,
          office: '',
          plan_id: null,
        })}\n\n`;
        for (const c of sseClients) c.write(payload);
      }
      return;
    }
    /**
     * ── ĐĂNG NHẬP BẰNG MÃ THIẾT BỊ — cho hãng không mở đăng ký động. → §5h·7
     *
     * ⚠ KHÔNG có `/callback` ở đường này, và đó là điểm mạnh nhất của nó: không
     * có mã uỷ quyền nào bay về, nên `redirectBase` · `public_url` · nginx ·
     * Docker · VPS **đều không liên quan**. Cánh tay đi đường này chạy được ở
     * mọi kiểu triển khai, kể cả nơi daemon không hề mở cổng ra ngoài.
     */
    if (url.pathname === '/api/oauth/device/start' && method === 'POST') {
      const body = await readJson<{ catalogId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: 'thiếu "catalogId"' });
      return json(res, 200, await oauthDeviceStart(company, body.catalogId));
    }
    /**
     * Một NHỊP hỏi thăm. Giao diện gọi lặp theo `intervalMs` server trả về.
     *
     * ⚠ Vì sao giao diện lặp chứ không phải server giữ một request treo: một
     * request treo 15 phút chết vì mọi thứ nằm giữa (nginx, proxy công ty,
     * trình duyệt ngủ), và khi nó chết thì **không có trạng thái nào để kể
     * lại**. Vòng lặp ngắn thì mất một nhịp là mất một nhịp.
     *
     * Phiên sống ở DAEMON, không ở tab — đóng tab không giết lượt đăng nhập.
     */
    if (url.pathname === '/api/oauth/device/poll' && method === 'POST') {
      const body = await readJson<{ state?: string }>(req);
      if (!body.state) return json(res, 400, { error: 'thiếu "state"' });
      const r = await oauthDevicePoll(company, body.state);
      if (r.state === 'done') {
        // Cùng đường báo với web flow: giao diện đổi trạng thái, không ai F5.
        const payload = `data: ${JSON.stringify({
          type: 'company.offices',
          say: `Đã kết nối ${r.label ?? r.name}.`,
          office: '',
          plan_id: null,
        })}\n\n`;
        for (const c of sseClients) c.write(payload);
      }
      return json(res, 200, r);
    }
    if (url.pathname === '/api/oauth/accounts' && method === 'GET') {
      return json(res, 200, {
        accounts: oauthAccounts(company, url.searchParams.get('for') ?? undefined),
      });
    }
    /** Gỡ một workspace: thu hồi ở dịch vụ (nếu nhận) rồi xoá chìa ở máy này. */
    if (segments[0] === 'api' && segments[1] === 'oauth' && segments[2] === 'accounts' && segments[3] && method === 'DELETE') {
      await oauthForget(company, decodeURIComponent(segments[3]));
      return json(res, 200, { accounts: oauthAccounts(company) });
    }
    if (url.pathname === '/api/arms' && method === 'GET') {
      return json(res, 200, { arms: company.listArms() });
    }

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ CỬA ĐĂNG NHẬP BẰNG TAY — mở cửa sổ trình duyệt THƯỜNG vào hồ sơ của  │
     * │ văn phòng. Không phải một task, không đi qua Playwright.              │
     * │ → `core/browser-login.ts` (lý do đầy đủ ở đầu file đó)                │
     * │                                                                      │
     * │ ⚠ `isLoopback(socket)` — **địa chỉ socket**, không phải `Host`. Cửa sổ│
     * │ mở trên máy chạy daemon; xem giao diện từ xa mà bấm nút này thì nó bật│
     * │ ở nơi không ai nhìn. Chỗ thứ **năm** của cùng một sự thật (nút 📂 ·   │
     * │ redirect OAuth · ô "hiện cửa sổ" · và đây).                           │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (url.pathname === '/api/browser-login' && method === 'POST') {
      const body = await readJson<{ office?: string; url?: string }>(req);
      // `url` TUỲ CHỌN: mở trình duyệt của văn phòng là đủ, họ tự gõ địa chỉ.
      if (!body.office) return json(res, 400, { error: 'thiếu "office"' });
      if (!isLoopback(req.socket.remoteAddress)) {
        return json(res, 400, {
          error:
            'Cửa sổ đăng nhập chỉ mở được khi bạn dùng agentco trên chính máy đang chạy nó — ' +
            'cửa sổ sẽ bật lên ở máy chủ, nơi bạn không nhìn thấy.',
        });
      }
      let working: boolean;
      try {
        working = company.get(body.office).currentState === 'working';
      } catch {
        return json(res, 404, { error: 'không có văn phòng này' });
      }
      try {
        const r = startLogin({
          office: body.office,
          officeStateDir: officeStateDir(company.dir, body.office),
          ...(body.url ? { url: body.url } : {}),
          working,
        });
        return json(res, 200, { ok: true, profile: r.profile });
      } catch (e) {
        // `LoginError` đã là câu tiếng người — chuyển nguyên văn, đừng gói lại.
        return json(res, 400, { error: (e as Error).message });
      }
    }

    if (url.pathname === '/api/browser-login' && method === 'DELETE') {
      const office = url.searchParams.get('office');
      if (!office) return json(res, 400, { error: 'thiếu "office"' });
      return json(res, 200, { closed: endLogin(office) });
    }
    /**
     * THỬ NGAY — bắt tay thật với cấu hình chưa lưu.
     *
     * ⚠ Đây là route CHẬM nhất trong cả server: đo được 4 s khi cache `npx` ấm,
     * **17,7 s** lần đầu phải tải gói. Giao diện PHẢI hiện "đang kết nối…" chứ
     * không được coi im lặng là hỏng. → SPEC-arms.md §3a
     */
    if (url.pathname === '/api/arms/test' && method === 'POST') {
      const body = await readJson<{
        id?: string;
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        secrets?: Record<string, string>;
        /**
         * ⚠ BỐN TRƯỜNG NÀY PHẢI KHAI RA, dù hôm qua chúng vẫn chạy khi không khai.
         *
         * `readJson<T>` là một phép ÉP KIỂU, không phải phép lọc — trường lạ vẫn
         * đi qua lúc chạy. Nên `level` hoạt động suốt từ 26/08 trong khi kiểu ở
         * đây chưa hề nhắc tới nó: **mã đúng, hợp đồng nói dối**. Đó đúng bằng
         * cái bẫy đã nuốt `tools` một lần (`company.ts §addArm`), chỉ khác chiều —
         * và lần sau ai đó thêm một phép lọc theo kiểu thì nó im lặng rụng hết.
         */
        account?: string;
        level?: Tier;
        groups?: string[];
        /** Khai ra vì lý do ngay trên: `readJson` ép kiểu chứ không lọc. */
        office?: string;
        mode?: string;
      }>(req);
      // `true` = KHÁM PHÁ. Xem tham số `discovery` của `resolveArm` — thiếu nó
      // thì mục có hàng rào server tự khoá mình ở nấc thấp nhất, không câu lỗi.
      const arm = resolveArm(company, body, true, armCtx(req));
      if (!arm) return json(res, 400, { error: 'thiếu "config", "catalogId" hoặc "armId"' });
      const config = arm.config;
      const base = await baselineTokens();
      /**
       * ⚠ TIÊM CHÌA VÀO PHÉP THỬ, nếu không thì nút Thử **kiểm một thứ khác với
       * thứ sẽ chạy** — đúng lớp lỗi dự án này bắt đi bắt lại. Worker nhận chìa
       * qua `pickMcp`; probe phải nhận cùng bộ đó, nếu không một cánh tay cần
       * chìa sẽ báo ✓ ở đây rồi hỏng lúc làm việc thật.
       */
      const r = await probeArm(
        { [body.id || 'thu']: config as never },
        base,
        arm.secrets,
        body.office ? armDirs(company.dir, body.office) : undefined,
      );
      return json(res, 200, r);
    }
    /**
     * TRA BẢN CÀI APP — route riêng, KHÔNG gộp vào `/test`. → §5h·7o
     *
     * Hai câu hỏi khác nhau, và gộp chúng là buộc câu chậm phải chờ câu nhanh:
     * `/test` hỏi *"cấu hình này chạy không"* (~8–20 giây, cần cả `baselineTokens`),
     * còn cái này hỏi *"hãng cho ta đụng repo nào"* (chỉ cần chìa, chạy được ngay
     * sau khi đăng nhập, trước cả khi người dùng chọn nấc hay nhóm việc).
     *
     * Tách ra thì giao diện bắn nó **ngay lúc chọn xong tài khoản** và người dùng
     * đọc kết quả trong lúc còn đang cấu hình những thứ khác.
     */
    /**
     * Ô "dùng `client_id` của bạn" — đọc và ghi. → SPEC-arms §5h·7h
     *
     * GET trả `own` để giao diện biết đang đi bằng danh tính của AI, chứ không
     * chỉ hiện một ô trống: một ô trống không phân biệt được *"chưa ai dán"* với
     * *"đã dán rồi nhưng ta không hiện lại"*.
     */
    if (url.pathname === '/api/oauth/client' && method === 'GET') {
      const id = url.searchParams.get('for');
      if (!id) return json(res, 400, { error: 'thiếu "for"' });
      return json(res, 200, deviceClientId(company, id));
    }
    if (url.pathname === '/api/oauth/client' && method === 'PUT') {
      const body = await readJson<{ catalogId?: string; clientId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: 'thiếu "catalogId"' });
      setDeviceClientId(company, body.catalogId, body.clientId ?? '');
      return json(res, 200, deviceClientId(company, body.catalogId));
    }
    if (url.pathname === '/api/arms/repos' && method === 'POST') {
      const body = await readJson<{ catalogId?: string; account?: string }>(req);
      if (!body.catalogId || !body.account) {
        return json(res, 400, { error: 'thiếu "catalogId" hoặc "account"' });
      }
      const scan = await scanRepos(company, body.catalogId, body.account);
      // `null` = KHÔNG TRA ĐƯỢC, khác hẳn "tra ra rỗng". Giao diện xử lý hai ca
      // này theo hai hướng ngược nhau, nên đừng gộp chúng thành một mảng rỗng.
      return json(res, 200, scan ?? { failed: true });
    }
    if (url.pathname === '/api/arms' && method === 'POST') {
      const body = await readJson<{
        label?: string;
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        secrets?: Record<string, string>;
        office?: string;
        grantTo?: string[];
        /** Xem khối chú thích cùng tên ở route `/api/arms/test` ngay trên. */
        account?: string;
        level?: Tier;
        groups?: string[];
        mode?: string;
      }>(req);
      const arm = resolveArm(company, body, false, armCtx(req));
      if (!arm) return json(res, 400, { error: 'thiếu "config", "catalogId" hoặc "armId"' });
      // Giải cờ `readOnly` TRƯỚC khi ghi sổ: hỏng thì ném, và không có cánh tay
      // nào được tạo. Tạo trước rồi giải sau là để lại một cánh tay mang nhãn
      // "chỉ đọc" với `tools: []` — tức cấp CẢ SERVER. Thứ tự ở đây là bảo mật.
      // Danh sách cấm đi theo MỤC DANH MỤC, nên chỉ tra được khi biết mục nào.
      // Cắm bằng `config` gõ tay (đường B) thì không có mục ⇒ không có lệnh cấm —
      // đúng: đường đó là người dùng tự khai server, ta không curate hộ.
      const never = body.catalogId ? (findArm(body.catalogId)?.neverTools ?? []) : [];
      /**
       * ⚠ TỜ KHAI CLI KHÔNG ĐI QUA `scopedTools` — và đây là quyết định, không
       * phải đường tắt.
       *
       * `scopedTools` tồn tại để hỏi **server của người khác** *"anh có những
       * việc gì, việc nào chỉ-đọc"* rồi cắt theo nấc. Với CLI thì cả hai vế đều
       * vô nghĩa: danh sách việc **do chính tờ khai nói ra** (không có nguồn thứ
       * hai để lệch), và **không có nấc nào** — user chốt 30/08 CLI là toàn
       * quyền, cổng còn lại là *ai được nối dây* + `confirm` từng action.
       *
       * Đi qua nó thì ta trả một lượt `query()` để hỏi một câu đã biết đáp án,
       * rồi ép kết quả qua `tierFor` — cỗ máy nấc chạy trên một thứ không có nấc
       * là chỗ đẻ ra nấc giả. → SPEC-arms §16f ô ③
       */
      const tools = isCliArm(arm.config) ? cliToolNames(arm.config) : arm.tools ?? (await scopedTools(
          arm.config,
          arm.secrets,
          tierFor(body.catalogId ? findArm(body.catalogId) : undefined, arm.level),
          never,
          body.office ? armDirs(company.dir, body.office) : undefined,
        ));
      const id = company.addArm({
        config: arm.config,
        secretNames: arm.secretNames,
        ...(arm.level ? { level: arm.level } : {}),
        ...(tools.length ? { tools } : {}),
        // Nhãn của client CHỈ dùng khi tạo mới. Dùng lại thì nhãn đã là của
        // người dùng rồi (`addArm` giữ nhãn cũ) — gửi kèm chỉ tạo ảo giác sửa được.
        ...(body.armId ? {} : body.label ? { label: body.label } : {}),
        ...(arm.catalog ? { catalog: arm.catalog } : {}),
        // Dùng lại: chìa ĐÃ nằm trong `.state/secrets.json`, ghi lại là ghi đè
        // chính nó bằng chính nó. Chỉ ghi khi client thật sự gửi chìa mới.
        ...(body.armId ? {} : body.secrets ? { secrets: body.secrets } : {}),
        ...(body.office ? { office: body.office } : {}),
      });

      // Giao cho ai — cùng MỘT request, cố ý. Tách làm hai lời gọi là mở ra một
      // cửa sổ mà cánh tay đã tồn tại nhưng chưa ai dùng được, và nếu lời gọi
      // thứ hai hỏng thì người dùng ở lại với đúng cái NODE CHẾT mà bước 3 sinh
      // ra để tránh. → Office.grantArm
      /**
       * ⚠ GỌI KỂ CẢ KHI `grantTo` RỖNG — đây là bug user báo hai lần.
       *
       * Điều kiện cũ là `body.grantTo?.length`, nên "cắm mà chưa giao cho ai"
       * KHÔNG chạy `grantArm` ⇒ không ghi `office.arms` ⇒ **bấm Xong xong
       * không có gì xảy ra cả**: cánh tay đã vào sổ chung, mà sơ đồ trống trơn.
       *
       * `grantArm` với danh sách rỗng vẫn có việc để làm — nó ghi SỰ CÓ MẶT.
       * Đó chính là thứ tách hai khái niệm ra để làm được.
       */
      let canvas: unknown;
      if (body.office) {
        canvas = company.get(body.office).grantArm(id, body.grantTo ?? []);
      }
      return json(res, 201, { id, arms: company.listArms(), canvas });
    }
    /** Đổi tên — chỉ đụng nhãn trong sổ chung. Không đổi khoá, không di trú gì. */
    if (segments[0] === 'api' && segments[1] === 'arms' && segments[2] && method === 'PATCH') {
      const body = await readJson<{ label?: string }>(req);
      const label = company.renameArm(decodeURIComponent(segments[2]), body.label ?? '');
      return json(res, 200, { label, arms: company.listArms() });
    }
    /**
     * Rút khỏi MỘT văn phòng (`?office=`), hoặc khỏi mọi văn phòng nếu không nêu.
     * Sổ chung không bị đụng — cắm lại là tìm thấy. → `Company.removeArm`
     */
    if (segments[0] === 'api' && segments[1] === 'arms' && segments[2] && method === 'DELETE') {
      /**
       * `?forget=1` = XOÁ HẲN khỏi sổ chung, không lấy lại được. Tường minh, y
       * như `?all=1` của ngăn Kết quả: không bao giờ suy một lệnh phá huỷ từ
       * việc **thiếu** một tham số. `Company.forgetArm` tự chặn nếu còn ai giữ,
       * và **không đụng tới chìa** — phần đắt của việc cắm nằm ở đó.
       */
      if (url.searchParams.get('forget') === '1') {
        company.forgetArm(decodeURIComponent(segments[2]));
        return json(res, 200, { arms: company.listArms() });
      }
      const office = url.searchParams.get('office') ?? undefined;
      company.removeArm(decodeURIComponent(segments[2]), office);
      return json(res, 200, { arms: company.listArms() });
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

      /**
       * ⚠ Handle này chỉ đúng cho tới mutation ĐẦU TIÊN có thể đổi danh tính
       * văn phòng. Hôm nay đúng một thao tác làm được điều đó — đổi tên có dời
       * thư mục — và nhánh PATCH tự lấy lại handle sau mỗi bước (`cur()`).
       * Thêm một thao tác dời/thay instance mới thì phải theo đúng khuôn đó.
       */
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
          /** Tên hiển thị của Trợ lý. Không nằm trong prompt nào → không phá cache. */
          assistant_name?: string;
          archived?: boolean;
        }>(req);
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ ĐỔI TÊN CÓ THỂ ĐỔI LUÔN `id` — nên KHÔNG được giữ một handle.    │
         * │ (bug user báo 22/08)                                              │
         * │                                                                  │
         * │ `const office` ở đầu route lấy MỘT LẦN. Nhưng `renameOffice` dời │
         * │ thư mục và **thay hẳn instance** trong map (`Company.moveOffice`),│
         * │ nên từ dòng đó trở đi cái handle cũ là ma: `office.id` vẫn là id  │
         * │ cũ, `office.loaded.dir` trỏ vào thư mục đã biến mất.              │
         * │                                                                  │
         * │ Hai hậu quả, và cái thứ hai nặng hơn triệu chứng người dùng thấy: │
         * │                                                                  │
         * │  1. Response trả `id` CŨ ⇒ client tưởng không có gì đổi ⇒ mọi     │
         * │     lời gọi sau đó 404 tới khi F5. Đây là thứ user nhìn thấy.    │
         * │  2. `setAssistantTier` / `renameAssistant` trong CÙNG một request │
         * │     sẽ ghi `office.yaml` vào **đường dẫn cũ đã bị dời**. Giao     │
         * │     diện hôm nay chưa gửi hai thứ đó chung một lần, nhưng route   │
         * │     thì cho phép — một cái bẫy nằm chờ.                           │
         * │                                                                  │
         * │ Sửa MỘT chỗ, hết cả hai: theo dõi `curId` và LẤY LẠI office sau  │
         * │ mỗi mutation có thể đổi danh tính. Thêm một mutation mới sau này  │
         * │ thì nó tự đúng, miễn là gọi qua `cur()`.                          │
         * └──────────────────────────────────────────────────────────────────┘
         */
        let curId = officeId;
        const cur = () => company.get(curId);

        // `archived` đi TRƯỚC: khôi phục rồi mới sửa được những thứ còn lại.
        // Ngược lại thì "khôi phục và đổi tên trong một lần" sẽ bị chính chốt
        // chỉ-đọc chặn, và người dùng không hiểu vì sao.
        if (typeof body.archived === 'boolean') company.archiveOffice(curId, body.archived);
        if (typeof body.name === 'string') curId = company.renameOffice(curId, body.name).id;
        if (body.assistant_tier !== undefined) {
          cur().setAssistantTier(body.assistant_tier ?? undefined);
        }
        if (typeof body.assistant_name === 'string') cur().renameAssistant(body.assistant_name);

        const after = cur();
        return json(res, 200, {
          id: after.id,
          name: after.name,
          archived: after.archived,
          canvas: after.canvas(),
          offices: company.list(),
        });
      }

      /**
       * Thư mục văn phòng: LUÔN trả đường dẫn, và CHỈ mở khi trình duyệt đang
       * chạy trên chính cái máy này. → `cli/daemonfile.ts §openFolder`
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ ⚠ "MỞ THƯ MỤC" MỞ TRÊN MÁY CHỦ, KHÔNG PHẢI MÁY NGƯỜI ĐANG NHÌN.    │
       * │                                                                    │
       * │ Trên máy cá nhân hai cái đó là một, nên nút này rất tiện. Nhưng     │
       * │ agentco sẽ chạy trên VPS và trong Docker, và ở đó nó sai hoàn toàn: │
       * │ người dùng bấm nút ở Hà Nội, một cửa sổ Explorer bật ra trên con    │
       * │ server ở Singapore mà không ai nhìn thấy. Tốt nhất là không có gì   │
       * │ xảy ra; tệ hơn là một tiến trình mồ côi mỗi lần bấm.                │
       * │                                                                    │
       * │ `AGENTCO_HEADLESS=1` đã chặn được ca Docker dựng đúng — nhưng nó là │
       * │ thứ người triển khai phải NHỚ ĐẶT. Một bất biến dựa vào việc ai đó  │
       * │ nhớ thì không phải bất biến.                                        │
       * │                                                                    │
       * │ Chốt thật: hỏi chính cái socket. Yêu cầu đến từ loopback thì trình  │
       * │ duyệt và daemon ở cùng một máy — đó là ĐIỀU KIỆN duy nhất làm cho   │
       * │ "mở thư mục" có nghĩa. Không phải loopback thì chỉ trả đường dẫn.   │
       * │                                                                    │
       * │ ⚠ Không tin `Host`/`X-Forwarded-For`: cả hai do client gửi. Địa chỉ │
       * │ socket thì không giả được từ xa. Reverse proxy chạy CÙNG máy sẽ lọt │
       * │ (nó cũng là loopback) — chấp nhận: hậu quả xấu nhất là một lời gọi  │
       * │ `spawn` không làm gì cả trên một máy không có màn hình.             │
       * └────────────────────────────────────────────────────────────────────┘
       *
       * `officeId` đã qua `isSafeId`, và `office.dir` do chính ta dựng từ
       * `companyDir` — không có chuỗi nào của người dùng đi vào `spawn`.
       */
      if (rest[0] === 'reveal' && method === 'POST') {
        const local = isLoopback(req.socket.remoteAddress);
        if (local) openFolder(office.dir);
        return json(res, 200, { dir: office.dir, opened: local });
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

      /**
       * NHẬT KÝ KIỂM TOÁN CÁNH TAY. → `core/audit.ts` · SPEC-arms §6k
       *
       * `?server=<băm>` lọc theo một cánh tay — đó là cách giao diện dùng nó,
       * vì câu hỏi luôn có dạng *"kết nối NÀY đã làm gì"*, không phải *"văn
       * phòng đã gọi những gì"*.
       */
      if (rest[0] === 'arm-log' && method === 'GET') {
        const server = url.searchParams.get('server') ?? undefined;
        const limit = Number(url.searchParams.get('limit') ?? 200);
        return json(res, 200, {
          calls: office.audit.list({
            ...(server ? { server } : {}),
            limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 200,
          }),
        });
      }

      // ── kết quả (artifacts) → docs/SPEC-artifacts.md
      if (rest[0] === 'artifacts' && !rest[1] && method === 'GET') {
        // Quét đĩa mỗi lần, không catalog: file này do NHÂN VIÊN ghi trong lúc
        // chạy, nên mọi bản lưu sẵn đều lỗi thời ngay giữa một ca.
        return json(res, 200, { artifacts: office.artifactList() });
      }
      if (rest[0] === 'artifacts' && !rest[1] && method === 'DELETE') {
        const rel = url.searchParams.get('path');
        /**
         * XOÁ TẤT CẢ — phải nói ra bằng `?all=1`, KHÔNG bao giờ bằng cách thiếu
         * `path`. Suy "không nêu file nào" thành "xoá hết" là biến một lỗi lập
         * trình (quên ghép query) thành một lệnh phá huỷ. Thiếu `path` vẫn là 400
         * y như cũ. → `Office.clearArtifacts`
         */
        if (!rel && url.searchParams.get('all') === '1') {
          const removed = office.clearArtifacts();
          return json(res, 200, { removed, artifacts: office.artifactList() });
        }
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
  boundPort = port;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÒNG LÀM MỚI CHÌA — **MỘT CHỖ DUY NHẤT TRONG CẢ HỆ**, và đây là chỗ đó. │
   * │                                                                          │
   * │ `refresh_token` **XOAY** (đo 25/08): mỗi lần làm mới trả về cả chìa mới   │
   * │ lẫn refresh mới, cái cũ chết ngay. Hai tiến trình cùng làm mới thì cái    │
   * │ chậm hơn gửi một refresh **đã chết** và ghi đè bản tốt bằng bản hỏng.    │
   * │ Không khoá nào cứu được — chỉ có "một người làm" mới cứu được.           │
   * │                                                                          │
   * │ `unref()` để nó KHÔNG giữ tiến trình sống: một daemon đáng lẽ đã tắt mà   │
   * │ còn treo vì một `setInterval` là thứ người dùng phải đi tìm mà giết.     │
   * │                                                                          │
   * │ Chạy MỘT LẦN ngay lúc khởi động, không đợi hết nhịp đầu: máy vừa ngủ dậy │
   * │ sau 10 tiếng thì chìa đã hết hạn, và bắt người dùng chờ 15 phút nữa để   │
   * │ nó tự tỉnh là để họ gặp một cánh tay hỏng ngay việc đầu tiên.            │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const tick = () => {
    void refreshDue(company).catch((e: unknown) => {
      // Vòng nền hỏng KHÔNG được làm sập daemon. Người dùng sẽ thấy hậu quả ở
      // chỗ họ đang nhìn — câu lỗi lúc dùng cánh tay.
      process.emitWarning(`Vòng làm mới chìa hỏng: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  const refreshTimer = setInterval(tick, REFRESH_TICK_MS);
  refreshTimer.unref();
  tick();

  return {
    port,
    url: `http://${host}:${port}`,
    async close() {
      clearInterval(refreshTimer);
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

/**
 * Host phải là chính cái ta bind. Chặn tên miền của kẻ tấn công trỏ về 127.0.0.1.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CHẶN CỨNG SAU REVERSE PROXY — tìm ra 26/08 khi user hỏi về VPS/domain.│
 * │                                                                          │
 * │ Sau nginx thì `Host` là **tên miền công ty** (`agentco.cty.com`), còn ta │
 * │ bind `0.0.0.0`. Hàm bản cũ so hai chuỗi đó rồi trả `false` ⇒ **403 cho    │
 * │ MỌI request**, không riêng OAuth. Nói cách khác: hôm nay agentco **không │
 * │ chạy được sau một tên miền** chút nào, và không ai biết vì chưa ai dựng.  │
 * │                                                                          │
 * │ ⚠ Bản vá KHÔNG được là "cho qua mọi Host" — chốt này tồn tại để chặn DNS │
 * │ rebinding, và bỏ nó đi là mở lại đúng lỗ đó. Nên tên miền hợp lệ phải là │
 * │ thứ **người triển khai KHAI RA**, và họ đã khai rồi: `runtime.public_url`.│
 * │ Cùng một khai báo vừa quyết `redirect_uri` vừa mở cổng Host — một nguồn,  │
 * │ hai chỗ dùng, không lệch được.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function hostAllowed(given: string | undefined, bound: string, publicHost?: string): boolean {
  if (!given) return true;
  const hostname = given.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (publicHost && hostname === publicHost.toLowerCase()) return true;
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


