/**
 * Kho bí mật cấp CÔNG TY. → docs/SPEC-offices.md §5
 *
 * `company/.state/secrets.json` — đã nằm trong .gitignore, và hàm đọc file duy
 * nhất phơi ra HTTP (`ArtifactStore.resolve`) chỉ nhận đường dẫn nằm TRONG
 * `artifacts/`, nên `.state/` không có cửa nào ra ngoài.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐẶC QUYỀN TỐI THIỂU. Vai trò khai `secrets: [NOTION_TOKEN]` thì CHỈ khoá  │
 * │ đó được đưa vào môi trường tiến trình MCP của nó. Không có "cho hết cho   │
 * │ tiện": một agent bị prompt injection qua nội dung nó đọc chỉ cầm được     │
 * │ đúng những chìa ta đã trao, và cái giá của sai sót vì thế là hữu hạn.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Giá trị bí mật KHÔNG BAO GIỜ đi vào prompt. Chúng là biến môi trường của tiến
 * trình MCP — model không đọc được chúng, chỉ dùng được tool đã mở khoá sẵn.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CompanyPaths } from './paths.js';
import type { OAuthAccount } from './oauth.js';

export type SecretMap = Record<string, string>;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CHÌA OAUTH LÀ **MỘT LOẠI CHÌA**, KHÔNG PHẢI MỘT HỆ THỐNG THỨ HAI.        │
 * │                                                                          │
 * │ Chìa tĩnh là một chuỗi; chìa OAuth là một object có 4+ trường và tự làm  │
 * │ mới. Cám dỗ là dựng một kho riêng cho nó — và đó là chỗ hỏng: `grantFor`,│
 * │ `injectSecrets`, `armHash`, `role.secrets`, `secret list` đều sẽ phải     │
 * │ mọc thêm một nhánh, tức **năm bản của cùng một luật**.                    │
 * │                                                                          │
 * │ Thay vào đó: tài khoản OAuth vẫn **có một cái TÊN** như mọi chìa khác,   │
 * │ và `readSecrets` **dàn phẳng** nó thành `access_token` hiện hành. Cả năm │
 * │ chỗ trên không đổi một dòng nào. Thứ duy nhất OAuth thêm vào là *"giá trị│
 * │ này được làm mới ở nền"* — một chuyện về VÒNG ĐỜI, không phải về hình    │
 * │ dạng.                                                                    │
 * │                                                                          │
 * │ Tên khoá là `$oauth`, và nó **không thể trùng** tên chìa nào: tên chìa   │
 * │ đi qua `PLACEHOLDER` = `[A-Z0-9_]+`, không có `$`. Và bản `readSecrets`  │
 * │ cũ **đã** bỏ qua mọi giá trị không phải chuỗi ⇒ công ty tạo bằng bản cũ  │
 * │ đọc được bản mới và ngược lại, không cần di trú.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_KEY = '$oauth';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 DANH TÍNH ỨNG DỤNG PHẢI SỐNG LÂU BẰNG CÁI TÀI KHOẢN NÓ CẤP CHÌA.      │
 * │ (nguyên nhân gốc của hai tài khoản Notion chết — truy 27/08)             │
 * │                                                                          │
 * │ Trước: `client_id` xin được bằng đăng ký động (DCR) chỉ nằm trong một     │
 * │ `Map` **trong RAM**. Tắt daemon là mất ⇒ lần bật sau **đăng ký một ứng    │
 * │ dụng MỚI** ở phía dịch vụ. Chạy vài hôm là rải ra hàng chục ứng dụng, mỗi │
 * │ cái cầm chìa của một nhóm tài khoản, và không cái nào được ai dọn.        │
 * │                                                                          │
 * │ Số đo 27/08 chỉ thẳng vào đó: hai tài khoản chết dùng CHUNG một           │
 * │ `client_id` cũ, tài khoản sống dùng `client_id` mới nhất. Cả hai client   │
 * │ đều còn tồn tại (`invalid_grant` chứ không phải `invalid_client`) ⇒ thứ   │
 * │ bị thu hồi là **quyền cấp cho ứng dụng cũ**, không phải bản thân chìa.    │
 * │                                                                          │
 * │ ⇒ Ứng dụng phải được đăng ký **một lần, giữ mãi**. Đó cũng đúng điều      │
 * │ người dùng đòi: *"như account Facebook, Shopee — log cả năm có bị ai đá   │
 * │ ra đâu"*. Phiên web sống lâu được vì **ứng dụng đứng yên**, chỉ có chìa   │
 * │ xoay. Ta đang làm ngược: xoay cả ứng dụng.                               │
 * │                                                                          │
 * │ Khoá `$clients`, cùng file, cùng đường ghi nguyên tử — **không** đẻ thêm  │
 * │ một kho thứ ba. Cùng lý lẽ đã viết cho `$oauth` ở khối trên.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const CLIENTS_KEY = '$clients';

/**
 * Mọi khoá dành riêng. Dùng ở **một** chỗ: `writeSecrets` phải giữ lại tất cả.
 *
 * ⚠ Đây là chỗ đã suýt hỏng lần thứ hai. `writeSecrets` dựng lại cả file từ
 * `{...chìa, $oauth}` — tức bất kỳ khoá dành riêng nào **không được nêu tên
 * trong đúng dòng đó** sẽ bị xoá lặng lẽ khi người dùng cắm một cánh tay bất kỳ.
 * Liệt kê một chỗ thì thêm khoá thứ ba về sau không cần nhớ đi sửa nơi khác.
 */
const RESERVED = [OAUTH_KEY, CLIENTS_KEY] as const;

/** Tài khoản OAuth theo TÊN CHÌA (`NOTION_OAUTH_A1B2C3D4`). → `oauth.ts` */
export type OAuthMap = Record<string, OAuthAccount>;

function readRaw(paths: CompanyPaths): Record<string, unknown> {
  if (!fs.existsSync(paths.secretsFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(paths.secretsFile, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  } catch {
    // Bí mật hỏng KHÔNG được làm sập công ty — agent nào cần sẽ tự báo thiếu chìa.
    process.emitWarning('.state/secrets.json không đọc được. Agent cần chìa sẽ báo thiếu.');
    return {};
  }
}

export function readSecrets(paths: CompanyPaths): SecretMap {
  const raw = readRaw(paths);
  const out: SecretMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  /**
   * ⚠ OAUTH GHI ĐÈ CHÌA TĨNH CÙNG TÊN, cố ý và theo đúng chiều này.
   *
   * Ca thật: người dùng dán tay một access token vào `NOTION_ACCESS_TOKEN` hôm
   * nay, rồi mai bấm Đăng nhập. Nếu chìa tĩnh thắng thì họ đăng nhập xong mà
   * hệ thống vẫn dùng cái chuỗi cũ **đã hết hạn 8 tiếng trước** — và triệu
   * chứng là 401 ngay sau một thao tác vừa báo thành công.
   *
   * Chiều này an toàn vì OAuth là thứ có VÒNG ĐỜI: nó tự làm mới, còn chuỗi
   * dán tay thì đứng yên chờ chết.
   */
  for (const [name, acc] of Object.entries(readOAuth(paths))) {
    if (acc.access_token) out[name] = acc.access_token;
  }
  return out;
}

/** Chỉ phần OAuth — cho vòng làm mới ở nền và cho giao diện liệt kê tài khoản. */
export function readOAuth(paths: CompanyPaths): OAuthMap {
  const bag = readRaw(paths)[OAUTH_KEY];
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {};
  const out: OAuthMap = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    // Tối thiểu phải có `access_token` — một bản ghi hỏng nửa chừng thì bỏ qua,
    // đừng để nó dàn phẳng thành `undefined` rồi bay lên server thành `Bearer `.
    if (v && typeof v === 'object' && typeof (v as OAuthAccount).access_token === 'string') {
      out[k] = v as OAuthAccount;
    }
  }
  return out;
}

/**
 * Ghi/xoá MỘT tài khoản OAuth. Đọc-sửa-ghi cả file, không ghi đè cả kho.
 *
 * ⚠ ĐỌC LẠI TỪ ĐĨA NGAY TRƯỚC KHI GHI, không dùng bản đã cầm sẵn trong tay.
 * Vòng làm mới ở nền và người dùng bấm "Đăng nhập" chạy song song được; ghi
 * bằng một bản chụp cũ là xoá mất chìa vừa được cái kia lưu — và mất một
 * `refresh_token` đã XOAY thì không lấy lại được bằng gì ngoài đăng nhập lại.
 */
export function saveOAuth(paths: CompanyPaths, name: string, acc: OAuthAccount | null): void {
  const raw = readRaw(paths);
  const bag = { ...(readOAuth(paths) as Record<string, unknown>) };
  if (acc) bag[name] = acc;
  else delete bag[name];
  writeRaw(paths, { ...raw, [OAUTH_KEY]: bag });
}

/**
 * `client_id` đã đăng ký, theo `issuer|redirect_uri`. → `$clients`
 *
 * ⚠ Khoá phải gồm `redirect_uri`: DCR cấp `client_id` **cho đúng URI đã đăng
 * ký**. Đổi cổng daemon rồi dùng lại client cũ ⇒ `invalid_redirect_uri`, và câu
 * lỗi đó không hề nói ra nguyên nhân thật.
 *
 * ⚠ `client_id` **không phải bí mật** (public client, `token_endpoint_auth_method:
 * none`). Nó nằm ở đây vì đây là chỗ dữ liệu **của công ty** sống, không phải vì
 * nó cần được giấu.
 */
export function readClients(paths: CompanyPaths): Record<string, string> {
  const bag = readRaw(paths)[CLIENTS_KEY];
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/**
 * `null` = **XOÁ** mục đó, không phải ghi chuỗi rỗng.
 *
 * Cần cho ô *"dùng client_id của bạn"*: xoá ô đi nghĩa là **quay về client của
 * agentco**, và cách duy nhất diễn đạt điều đó là mục ấy biến mất. Ghi `''` thì
 * `deviceClientId` đọc lên một chuỗi rỗng và gửi nó lên hãng.
 */
export function saveClient(paths: CompanyPaths, key: string, clientId: string | null): void {
  const raw = readRaw(paths);
  const next = { ...readClients(paths) };
  if (clientId === null) delete next[key];
  else next[key] = clientId;
  writeRaw(paths, { ...raw, [CLIENTS_KEY]: next });
}

export function writeSecrets(paths: CompanyPaths, map: SecretMap): void {
  /**
   * ⚠ HAI CÁI BẪY Ở ĐÂY, VÀ CẢ HAI ĐẾN TỪ CÙNG MỘT DÒNG CÓ SẴN:
   * `addArm` gọi `writeSecrets({ ...readSecrets(pp), ...secrets })`.
   *
   * ① Không giữ `$oauth` lại ⇒ cắm một cánh tay bất kỳ là **xoá sạch mọi tài
   *    khoản đã đăng nhập**. Mất `refresh_token` đã xoay thì không có đường
   *    nào lấy lại ngoài đăng nhập lại từ đầu.
   *
   * ② `readSecrets` giờ DÀN PHẲNG access_token vào map ⇒ nếu ghi thẳng map ấy
   *    xuống, ta đúc một **bản sao tĩnh** của một chìa vốn tự làm mới. Bản sao
   *    đó chết sau 8 giờ và nằm lại trong file dưới dạng chuỗi — vô hại hôm nay
   *    (OAuth thắng lúc đọc) nhưng là một quả mìn cho bất kỳ ai đọc file và
   *    tưởng đó là chìa thật.
   */
  /**
   * ③ 🔴 VÀ MỌI KHOÁ DÀNH RIÊNG KHÁC CŨNG PHẢI SỐNG SÓT — không riêng `$oauth`.
   *
   * Bản trước nêu đích danh `$oauth` trong đúng dòng dựng lại file, nên khoá
   * dành riêng **thứ hai** (`$clients`) sẽ bị xoá lặng lẽ ở lần cắm cánh tay
   * tiếp theo — và mất `$clients` nghĩa là lần đăng nhập sau đăng ký một ứng
   * dụng mới, tức dựng lại **đúng cái lỗi vừa truy ra**. Giữ theo DANH SÁCH
   * (`RESERVED`), không theo tên gõ tay.
   */
  const raw = readRaw(paths);
  const oauth = readOAuth(paths);
  const flat: SecretMap = {};
  for (const [k, v] of Object.entries(map)) if (!(k in oauth)) flat[k] = v;
  const giu: Record<string, unknown> = {};
  for (const k of RESERVED) if (raw[k] && Object.keys(raw[k] as object).length) giu[k] = raw[k];
  writeRaw(paths, { ...flat, ...giu, ...(Object.keys(oauth).length ? { [OAUTH_KEY]: oauth } : {}) });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 GHI NGUYÊN TỬ — vì mất nửa file ở đây là mất **CẢ KHO CHÌA**.         │
 * │ (user 26/08: *"race condition này nguy hiểm vậy cơ à, vá thôi"*)         │
 * │                                                                          │
 * │ `writeFileSync` **cắt file về 0 byte trước, rồi mới ghi**. Chết giữa hai │
 * │ bước đó (daemon bị kill · máy mất điện · đĩa đầy) để lại một file JSON    │
 * │ cụt ⇒ `readRaw` parse hỏng ⇒ `catch` trả `{}` ⇒ **mọi tài khoản biến     │
 * │ mất**, không riêng cái đang ghi. Người dùng phải đăng nhập lại TẤT CẢ.   │
 * │                                                                          │
 * │ Và nó đắt gấp đôi vì đường ghi hay chạy nhất là **vòng làm mới chìa** —  │
 * │ chạy ngầm, mỗi 15 phút, khi không ai nhìn.                               │
 * │                                                                          │
 * │ Ghi tạm rồi `rename`: trên cùng một ổ, `rename` là thao tác **nguyên tử** │
 * │ của hệ điều hành. Mọi lúc, file thật hoặc là bản CŨ nguyên vẹn, hoặc là  │
 * │ bản MỚI nguyên vẹn — không có trạng thái thứ ba.                         │
 * │                                                                          │
 * │ ⚠ `fsync` TRƯỚC khi rename, không phải sau. Rename nguyên tử về mặt thư  │
 * │ mục, nhưng nó không hứa rằng NỘI DUNG đã xuống đĩa — mất điện có thể để  │
 * │ lại một tên file mới trỏ vào một khối rỗng.                              │
 * │                                                                          │
 * │ ⚠⚠ VÀ ĐÂY LÀ THỨ NÓ **KHÔNG** CỨU ĐƯỢC, phải nói thẳng: nếu tiến trình   │
 * │ chết SAU khi Notion đã xoay chìa mà TRƯỚC khi ta ghi, chìa mới nằm trong │
 * │ một phản hồi HTTP đã mất — không cơ chế lưu trữ nào lấy lại được. Cửa sổ │
 * │ đó vài micro-giây và chỉ mất MỘT tài khoản. Đường ra là `needs_login`.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function writeRaw(paths: CompanyPaths, obj: Record<string, unknown>): void {
  const dir = path.dirname(paths.secretsFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.secrets.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  /**
   * ⚠ Đặt quyền trên FILE TẠM, trước khi rename — không phải sau.
   *
   * Sau rename thì đã có một khoảnh khắc file thật nằm đó với quyền mặc định,
   * và trên máy nhiều người dùng thì khoảnh khắc đó là đủ. Trên POSIX: chỉ chủ
   * sở hữu đọc được. Trên Windows `chmod` là no-op, ACL thư mục người dùng đã đủ.
   */
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* không đặt được quyền thì thôi */
  }
  // Nguyên tử: sau dòng này, file thật là bản mới HOẶC bản cũ, không có ở giữa.
  fs.renameSync(tmp, paths.secretsFile);
}

/**
 * Chỉ những chìa vai trò này được khai. Thiếu chìa nào thì trả tên nó ra.
 *
 * ⚠ CHUỖI RỖNG = THIẾU, không phải "có mà rỗng". Ô nhập để trắng gửi lên `''`,
 * và nếu ta coi nó là một chìa hợp lệ thì `Bearer ` bay lên server và quay về
 * 401 — tức người dùng nhận câu *"chìa sai"* cho việc **chưa điền chìa**. Cùng
 * một câu trả lời phải ra từ mọi hàm hỏi "có chìa chưa", nếu không thì hai chỗ
 * trong cùng một luồng tin hai chuyện khác nhau. → §missingSecretRefs
 */
export function grantFor(
  all: SecretMap,
  wanted: readonly string[],
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of wanted) {
    const value = all[name];
    if (value === undefined || value === '') missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}

/** Chỉ TÊN, không bao giờ giá trị — dùng cho giao diện và log. */
export function secretNames(paths: CompanyPaths): string[] {
  return Object.keys(readSecrets(paths)).sort();
}

/** Chỗ duy nhất biết cú pháp ô trống. Đổi ở đây là đổi mọi nơi. */
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴🔴 THAY Ô TRỐNG Ở **MỌI CHỖ** TRONG CẤU HÌNH — không riêng `headers`.   │
 * │ (bug user bắt 31/08, bài 20 chặng B)                                     │
 * │                                                                          │
 * │ Ca thật: dán khối README có `env: { MEMORY_FILE_PATH: "${MEMORY_PATH}" }`,│
 * │ giao diện **sinh đúng ô nhập** `MEMORY_PATH`, người dùng điền `abcde` →   │
 * │ vẫn *"Thiếu chìa: MEMORY_PATH"*. Điền lại bao nhiêu lần cũng thế.         │
 * │                                                                          │
 * │ ⚠⚠ NGUYÊN NHÂN LÀ MỘT BẤT ĐỐI XỨNG GIỮA HAI HÀM ĐI CHUNG MỘT ĐƯỜNG:      │
 * │                                                                          │
 * │   `missingSecretRefs`  quét **cả cấu hình** (JSON.stringify)  ← phát hiện │
 * │   `injectSecrets`      chỉ thay trong **`headers`** của HTTP  ← điền      │
 * │                                                                          │
 * │ Nhánh stdio không thay ô trống bao giờ — nó chỉ **gộp chìa vào `env`      │
 * │ theo TÊN** (đúng cho danh mục: server đọc `process.env.NOTION_TOKEN`).    │
 * │ Nên mọi ô trống nằm ngoài `headers` bị **phát hiện mãi mãi, không bao giờ │
 * │ được điền** ⇒ vòng lặp vô tận, và câu lỗi lại chỉ vào đúng cái ô người    │
 * │ dùng VỪA ĐIỀN. Câu lỗi sai cửa tệ nhất: nó tố cáo thứ đang đúng.          │
 * │                                                                          │
 * │ Chú thích ở `missingSecretRefs` đã tiên đoán đúng ngày này — *"một hàm    │
 * │ chỉ nhìn `headers` là hàm sẽ đúng cho tới đúng ngày ai đó viết            │
 * │ `url: 'https://${HOST}/mcp'`"*. Nó chỉ đoán nhầm CHỖ: `env` của stdio đến │
 * │ trước, và nó đến qua đường B — đường mà danh mục không che được.          │
 * │                                                                          │
 * │ ⇒ **BẤT BIẾN PHẢI GIỮ: phạm vi của hàm ĐIỀN = phạm vi của hàm KIỂM.**     │
 * │ Lệch một chút là đẻ ra một ô trống không ai điền được. Có test canh.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ô trống không có chìa thì **giữ nguyên** và ghi vào `missing` — để
 * `missingSecretRefs` phía sau vẫn bắt được và báo đúng câu *"thiếu chìa"*.
 */
function fillRefs<T>(node: T, keys: Record<string, string>, missing: Set<string>): T {
  if (typeof node === 'string') {
    return node.replace(PLACEHOLDER, (whole, name: string) => {
      const v = keys[name];
      if (v === undefined) {
        missing.add(name);
        return whole;
      }
      return v;
    }) as T;
  }
  if (Array.isArray(node)) return node.map((v) => fillRefs(v, keys, missing)) as T;
  /**
   * ⚠ CHỈ đi vào object THUẦN. Một `McpSdkServerConfigWithInstance` chở
   * `instance` là một object sống (`McpServer`) — đệ quy vào đó là bò qua cả một
   * cây đối tượng của SDK và dựng lại một bản sao chết. Nhánh gọi đã chặn bằng
   * cổng `command`/`url`, nhưng hàm này phải tự an toàn: nó là hàm đệ quy, và
   * người sửa sau sẽ gọi nó ở chỗ thứ ba.
   */
  if (node && typeof node === 'object' && Object.getPrototypeOf(node) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = fillRefs(v, keys, missing);
    return out as T;
  }
  return node;
}

/**
 * Ô trống ĐƯỜNG DẪN — `<văn phòng>/.state/browser` điền vào lúc spawn.
 *
 * ⚠ Ngoặc nhọn chứ không phải `${…}`, và đó là **cố ý**: hai cú pháp, hai nghĩa,
 * hai đường điền. `missingSecretRefs()` quét `${…}` để tìm chìa còn thiếu — một
 * ô trống đường dẫn lọt vào lưới đó sẽ báo *"Thiếu chìa: OFFICE_STATE"*, tức một
 * câu lỗi **chỉ sai cửa** ngay trong cơ chế sinh ra để tránh câu lỗi sai cửa.
 *
 * Xuất ra để `catalog.ts` dùng đúng một chuỗi này — hai bản của cùng một hằng số
 * là chuyện đã đốt dự án này một lần (`agentSlot` vs `arrange`).
 */
export const OFFICE_STATE = '<OFFICE_STATE>';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Ô TRỐNG NÀO CÒN SÓT SAU KHI ĐÃ TIÊM — tức CHÌA THIẾU. (bug user 25/08)   │
 * │                                                                          │
 * │ Triệu chứng user báo, và nó là một câu hỏi ĐÚNG:                         │
 * │                                                                          │
 * │   *"chìa sai khi tạo mới → 401. Nhưng chìa THIẾU (để trắng) nó cũng báo  │
 * │    câu lệnh y hệt mà? Tôi hiểu sai chỗ nào"*                             │
 * │                                                                          │
 * │ Không hiểu sai chỗ nào cả — **ta báo sai**. Ba nguyên nhân khác hẳn nhau │
 * │ đều rơi vào đúng một câu 401 của Notion:                                 │
 * │                                                                          │
 * │   ① chìa sai thật          → `Bearer ntn_xxx`      → 401  ✔ đúng câu     │
 * │   ② để trắng               → `Bearer ${NOTION_…}`  → 401  ✘ sai cửa      │
 * │   ③ dùng lại ở VP khác     → `Bearer ${NOTION_…}`  → 401  ✘ sai cửa      │
 * │                                                                          │
 * │ ② và ③ ta BIẾT TRƯỚC khi gửi. `injectSecrets` đã giữ ô trống lại và      │
 * │ `emitWarning` — nhưng cảnh báo đó đi ra stderr của daemon, còn người      │
 * │ dùng thì đang nhìn màn hình. Rồi ta **vẫn gửi** cái header có `${…}`.     │
 * │                                                                          │
 * │ ⇒ Đừng gửi một yêu cầu mà ta đã biết chắc sẽ 401. Câu lỗi CHỈ SAI CỬA    │
 * │ đắt hơn câu lỗi không có: người dùng sẽ đi kiểm tài khoản, kiểm quyền,   │
 * │ kiểm workspace — mọi chỗ trừ chỗ hỏng. → SPEC-arms §5m ②                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Quét trên chuỗi JSON của cả cấu hình, không riêng `headers`: `args`, `env`,
 * `url` đều mang ô trống được, và một hàm chỉ nhìn `headers` là hàm sẽ đúng cho
 * tới đúng ngày ai đó viết `url: 'https://${HOST}/mcp'`.
 */
export function missingSecretRefs(config: unknown): string[] {
  const seen = new Set<string>();
  for (const m of JSON.stringify(config ?? null).matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen].sort();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TIÊM CHÌA VÀO MỘT CẤU HÌNH MCP — MỘT HÀM, HAI NƠI GỌI. → SPEC-arms §5a   │
 * │ (từ 29/08 nó điền thêm **ô trống đường dẫn** — xem tham số `dirs`)        │
 * │                                                                          │
 * │ 🔴 LỖ ĐANG VÁ: tới 25/08 chìa **chỉ** đi vào server có `command` (tiêm   │
 * │ qua `env`). Server `http`/`sse` nhận **không gì cả** — nên cánh tay HTTP │
 * │ đầu tiên sẽ chạy KHÔNG CHÌA và không ai biết vì sao.                     │
 * │                                                                          │
 * │ ⚠ VÀ ĐÂY LÀ LÝ DO NÓ PHẢI LÀ MỘT HÀM CHUNG, KHÔNG PHẢI HAI BẢN VÁ:      │
 * │ `pickMcp` (lúc chạy) và `probeArm` (nút "Thử ngay") **phải tiêm y hệt    │
 * │ nhau**. Lệch một chút là nút Thử kiểm một thứ khác với thứ sẽ chạy —     │
 * │ báo ✓ rồi hỏng ở lần đầu một nhân viên dùng nó. `server.ts` đã ghi đúng  │
 * │ bất biến này bằng lời; hàm này làm nó thành **cấu trúc**.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Hai đường, chọn theo hình dạng cấu hình chứ không theo tên hãng:
 *
 *   có `command`  → gộp vào `env`      (như cũ, không đổi hành vi)
 *   có `url`      → thay ô trống `${TÊN_CHÌA}` trong `headers`
 *
 * Vì sao ô trống thay vì một trường `inject` riêng: nó là **dữ liệu**, nằm ngay
 * trong `company.yaml` người dùng đọc được — họ THẤY chìa đi vào đâu. Nó cũng
 * chạy luôn cho cấu hình người dùng **tự dán** (đường B), không cần ta biết
 * trước đó là hãng nào. Cùng lý lẽ §5h·1: *danh mục là dữ liệu, không phải mã*.
 *
 *     headers: { Authorization: 'Bearer ${NOTION_ACCESS_TOKEN}' }
 *
 * ⚠ Chỉ thay bằng những chìa vai trò ĐƯỢC CẤP (`grantFor` lọc trước). Ô trống
 * không có chìa thì **giữ nguyên và cảnh báo** — tuyệt đối không gửi chuỗi
 * `${TÊN}` lên server như thể nó là token: server sẽ trả 401, và câu lỗi đó
 * chỉ về "chìa sai" chứ không về "chìa thiếu", tức chỉ sai cửa để đi tìm.
 */
export function injectSecrets<T>(
  config: T,
  env: Record<string, string>,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ Ô TRỐNG THỨ HAI: ĐƯỜNG DẪN. Và nó ở đây vì một lý do về BĂM.             │
   * │ (user chốt 29/08: *"dữ liệu ở đâu cũng không ảnh hưởng tới băm"*)         │
   * │                                                                          │
   * │ Chỗ cất dữ liệu **không phải danh tính của cánh tay**. Nhét đường dẫn     │
   * │ tuyệt đối vào `args` là nhét nó vào băm, và đổi lấy hai thứ hỏng:         │
   * │   · cùng một mục cắm ở hai văn phòng ⇒ hai băm ⇒ hai cánh tay, trong khi │
   * │     mục danh mục là **bản thiết kế** và văn phòng chỉ clone ra;           │
   * │   · **đổi chỗ thư mục công ty ⇒ MỌI băm đổi** ⇒ thư mục thôi mang đi được.│
   * │                                                                          │
   * │ ⇒ Sổ giữ một **ô trống**, đường dẫn thật chỉ tồn tại lúc spawn — đúng     │
   * │ cách **giá trị chìa** đã được xử lý từ 25/08 (chìa không vào băm).        │
   * │                                                                          │
   * │ ⚠ CỐ Ý KHÔNG dùng cú pháp `${…}`: trong dự án này nó có đúng một nghĩa là │
   * │ **tên một cái chìa**, và `missingSecretRefs()` quét nó. Mượn là tự đẻ ra  │
   * │ câu *"Thiếu chìa: OFFICE_STATE"* — một câu lỗi chỉ sai cửa.               │
   * │                                                                          │
   * │ ⚠ Và nó nằm trong CÙNG hàm với chìa, không phải một hàm thứ hai: `pickMcp`│
   * │ và `probeArm` phải điền **y hệt nhau**, nếu không thì nút Thử lại kiểm    │
   * │ một thứ khác thứ sẽ chạy — đúng bất biến khối chú thích ở trên.           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  dirs?: { officeState: string },
): T {
  if (!config || typeof config !== 'object') return config;
  const cfg = config as Record<string, unknown>;

  // Chìa rỗng không phải chìa — cùng luật với `grantFor`. Lọc MỘT LẦN ở đây để
  // cả hai nhánh dưới thấy cùng một sự thật.
  const keys = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

  if (typeof cfg['command'] === 'string') {
    /**
     * Điền ô trống đường dẫn TRƯỚC, và làm nó độc lập với chìa: một cánh tay có
     * thể cần đường dẫn mà **không cần chìa nào** (mục trình duyệt là đúng ca đó).
     * Gộp vào nhánh `if (!keys.length) return` là để nó im lặng không chạy.
     */
    /**
     * ⚠ `path.normalize` SAU KHI THAY — và chỉ với chuỗi CÓ ô trống.
     *
     * Danh mục viết `<OFFICE_STATE>/profile` bằng `/` (nó là dữ liệu, phải đọc
     * được như nhau trên mọi máy), còn `officeState` là đường của **hệ điều hành
     * đang chạy**. Nối thẳng ra `D:\…\browser/profile` — trộn hai dấu phân cách.
     * Windows nuốt được, nhưng chuỗi đó rò ra mọi chỗ khác: câu lỗi, log kiểm
     * toán, và mọi phép so đường dẫn sau này. **Lần thứ sáu** của lớp lỗi *"đúng
     * trên máy dev, sai ở chỗ khác"* (tên shell theo OS · slug phi-Latin · nút 📂
     * từ xa · ánh xạ Docker · shell quoting).
     *
     * Chỉ chuỗi chứa ô trống mới chuẩn hoá: `--output-max-size 52428800` mà đem
     * `normalize` thì thành `52428800` (may là không đổi) — nhưng một cờ khác có
     * thể không may như thế. Đừng đụng vào thứ không phải đường dẫn.
     */
    const args =
      dirs && Array.isArray(cfg['args'])
        ? (cfg['args'] as unknown[]).map((a) =>
            typeof a === 'string' && a.includes(OFFICE_STATE)
              ? path.normalize(a.split(OFFICE_STATE).join(dirs.officeState))
              : a,
          )
        : cfg['args'];
    const withArgs = args === cfg['args'] ? cfg : { ...cfg, args };
    if (!Object.keys(keys).length) return withArgs as T;

    /**
     * ⭐ THAY Ô TRỐNG TRƯỚC, GỘP THEO TÊN SAU — hai cơ chế, cả hai đều cần.
     * (vá 31/08, xem khối chú thích ở `fillRefs`)
     *
     *   thay ô trống   `env: { MEMORY_FILE_PATH: "${MEMORY_PATH}" }`  ← đường B,
     *                  người dùng dán README của hãng
     *   gộp theo tên   server đọc thẳng `process.env.NOTION_TOKEN`     ← danh mục
     *
     * Bỏ vế thứ hai là làm hỏng mọi mục danh mục stdio; bỏ vế thứ nhất là đúng
     * cái bug vừa bắt. Gộp sau khi thay nên một chìa vừa được thay vào chỗ khác
     * vẫn có mặt trong `env` dưới tên gốc — thừa một biến, và thừa thì vô hại.
     */
    const gone = new Set<string>();
    const filled = fillRefs(withArgs as Record<string, unknown>, keys, gone);
    warnMissing(gone, 'tiến trình sẽ chạy với ô trống chưa được điền.');
    return { ...filled, env: { ...((filled['env'] as object) ?? {}), ...keys } } as T;
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NHÁNH THỨ BA: TỜ KHAI CLI. → SPEC-arms §16                               │
   * │                                                                          │
   * │ Nó không có `command` cũng không có `url` ở tầng ngoài — chìa nằm trong   │
   * │ `actions[].env`. Thiếu nhánh này thì nó **rơi qua cả hai `if` và trả về   │
   * │ nguyên xi**: ô trống không bao giờ được điền, còn `missingSecretRefs`     │
   * │ (quét cả cấu hình) thì tố cáo mãi mãi. Đúng bug 31/08, y hệt hình dạng,   │
   * │ chỉ khác chỗ đứng.                                                       │
   * │                                                                          │
   * │ ⇒ **BẤT BIẾN: phạm vi hàm ĐIỀN = phạm vi hàm KIỂM.** Có test canh.        │
   * │                                                                          │
   * │ ⚠ CHỈ điền ô trống, KHÔNG gộp `keys` vào một `env` chung: một action chỉ  │
   * │ được thấy đúng cái chìa nó khai. Gộp theo tên (nhánh stdio) là đúng cho   │
   * │ mục danh mục — server của hãng đọc thẳng `process.env.NOTION_TOKEN` — còn │
   * │ ở đây tiến trình con là binary của KHÁCH, và rót cả chùm chìa của công ty │
   * │ vào env của nó là mở đúng cái lỗ §5d vừa mất công đóng.                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (cfg['type'] === 'cli') {
    const gone = new Set<string>();
    const filled = fillRefs(cfg, keys, gone);
    warnMissing(gone, 'lệnh sẽ chạy với ô trống chưa được điền.');
    return filled as T;
  }

  if (typeof cfg['url'] === 'string') {
    const missing = new Set<string>();
    const filled = fillRefs(cfg, keys, missing);
    warnMissing(missing, 'server sẽ trả 401.');
    const headers = filled['headers'];
    if (!headers || typeof headers !== 'object') return filled as T;
    /**
     * ⚠ ÉP CHUỖI CHO HEADER — giữ nguyên hành vi cũ. Một header số (`{N: 5}`)
     * đi thẳng xuống SDK là một trường sai kiểu ở tận đáy, và câu lỗi ở đó sẽ
     * không nói gì về cấu hình người dùng vừa dán. Có test canh.
     */
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? v : String(v);
    }
    return { ...filled, headers: out } as T;
  }

  return config;
}

/**
 * TÊN, không bao giờ GIÁ TRỊ — cùng luật với mọi chỗ khác trong file này.
 *
 * ⚠ Luật hai-câu của `worker.ts §pickMcp`: tên dạng `*_OAUTH_xxxxxxxx` là TÀI
 * KHOẢN ĐĂNG NHẬP, không có chuỗi nào để gõ. Bảo họ `secret set` là chỉ sai cửa.
 * Nhận dạng bằng chính hình dạng tên — không đoán.
 */
function warnMissing(names: Set<string>, consequence: string): void {
  if (!names.size) return;
  process.emitWarning(
    `Cánh tay thiếu chìa ${[...names].join(', ')} — ${consequence} ` +
      `Tên dạng \`*_OAUTH_xxxxxxxx\` là tài khoản đăng nhập (nối lại ở hộp thoại Kết nối); ` +
      `tên khác thì thêm bằng \`agentco secret set <TÊN>\`. Đừng đi tìm ở phía server.`,
  );
}
