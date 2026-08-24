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

export type SecretMap = Record<string, string>;

export function readSecrets(paths: CompanyPaths): SecretMap {
  if (!fs.existsSync(paths.secretsFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(paths.secretsFile, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: SecretMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // Bí mật hỏng KHÔNG được làm sập công ty — agent nào cần sẽ tự báo thiếu chìa.
    process.emitWarning('.state/secrets.json không đọc được. Agent cần chìa sẽ báo thiếu.');
    return {};
  }
}

export function writeSecrets(paths: CompanyPaths, map: SecretMap): void {
  fs.mkdirSync(path.dirname(paths.secretsFile), { recursive: true });
  fs.writeFileSync(paths.secretsFile, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  // Trên POSIX: chỉ chủ sở hữu đọc được. Trên Windows chmod là no-op, ACL mặc
  // định của thư mục người dùng đã đủ — nhưng gọi vẫn đúng và vô hại.
  try {
    fs.chmodSync(paths.secretsFile, 0o600);
  } catch {
    /* không đặt được quyền thì thôi */
  }
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
