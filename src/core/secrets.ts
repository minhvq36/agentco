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
  const oauth = readOAuth(paths);
  const flat: SecretMap = {};
  for (const [k, v] of Object.entries(map)) if (!(k in oauth)) flat[k] = v;
  writeRaw(paths, { ...flat, ...(Object.keys(oauth).length ? { [OAUTH_KEY]: oauth } : {}) });
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
export function injectSecrets<T>(config: T, env: Record<string, string>): T {
  if (!config || typeof config !== 'object') return config;
  const cfg = config as Record<string, unknown>;

  // Chìa rỗng không phải chìa — cùng luật với `grantFor`. Lọc MỘT LẦN ở đây để
  // cả hai nhánh dưới thấy cùng một sự thật.
  const keys = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

  if (typeof cfg['command'] === 'string') {
    if (!Object.keys(keys).length) return config;
    return { ...cfg, env: { ...((cfg['env'] as object) ?? {}), ...keys } } as T;
  }

  if (typeof cfg['url'] === 'string') {
    const headers = cfg['headers'];
    if (!headers || typeof headers !== 'object') return config;
    const out: Record<string, string> = {};
    const missing = new Set<string>();
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      out[k] =
        typeof v === 'string'
          ? v.replace(PLACEHOLDER, (whole, name: string) => {
              const val = keys[name];
              if (val === undefined) {
                missing.add(name);
                return whole;
              }
              return val;
            })
          : String(v);
    }
    if (missing.size) {
      // TÊN, không bao giờ GIÁ TRỊ — cùng luật với mọi chỗ khác trong file này.
      process.emitWarning(
        `Cánh tay HTTP thiếu chìa ${[...missing].join(', ')} — server sẽ trả 401. ` +
          `Thêm bằng \`agentco secret set <TÊN>\`, đừng đi tìm ở phía server.`,
      );
    }
    return { ...cfg, headers: out } as T;
  }

  return config;
}
