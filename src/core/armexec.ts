import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * BỎ `npx` KHỎI ĐƯỜNG NÓNG. → docs/SPEC-arms.md §5j
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SỐ ĐO ĐÃ QUYẾT, KHÔNG PHẢI LẬP LUẬN (24/08, `scripts/spike-npx-cost.ts`) │
 * │                                                                          │
 * │   npx khởi động server (gói ĐÃ cache)   3,8 – 4,3 s   lần 1 = lần 3      │
 * │   node <file đã cache>                  0,79 – 0,84 s                    │
 * │   đầu-cuối probeArm qua npx             7,7 – 9,2 s                      │
 * │   đầu-cuối probeArm qua node            4,2 – 4,5 s                      │
 * │                                                                          │
 * │ Và `npx -y --offline` vẫn mất **3 878 ms** ⇒ khoản đó KHÔNG phải mạng,   │
 * │ không phải tải gói. Nó là phí tự thân của bộ máy resolve của npm, và nó  │
 * │ không bao giờ nhỏ đi.                                                    │
 * │                                                                          │
 * │ Cái giá thật lớn hơn hộp thoại cắm: mỗi `query()` spawn một tiến trình    │
 * │ MCP mới, nên ~4 s đó bị trả ở **MỖI TASK có cánh tay**, mãi mãi.          │
 * │                                                                          │
 * │ ⚠ Câu user hỏi khi duyệt: *"một việc bỏ 0 ăn tất thế này có lý do gì mà  │
 * │ không làm?"*. Trả lời thẳng: **không phải bỏ 0.** Nó đẻ ra một tầng quản  │
 * │ lý gói với ba ca hỏng riêng — máy không có `npm` · không ra được registry │
 * │ lần đầu · thư mục cache bị dọn. Cả ba đều được xử bằng MỘT luật:          │
 * │ **nghi ngờ gì thì trả về cấu hình GỐC và để `npx` chạy như cũ.** Bản vá   │
 * │ này chỉ được phép làm nhanh hơn, không bao giờ được phép làm hỏng.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Hai nửa, cố ý tách:
 *
 *   `fastLaunch`      ĐỒNG BỘ, thuần đọc đĩa. Dùng ở `pickMcp` (mỗi task) và
 *                     `probeArm`. Không cài gì, không chờ gì.
 *   `ensureInstalled` BẤT ĐỒNG BỘ, cài một lần. Gọi lúc cắm cánh tay và lúc
 *                     daemon mở công ty. Hỏng thì im lặng — `fastLaunch` sẽ tự
 *                     trả về `npx` ở lượt sau.
 *
 * Tách vì `pickMcp` là đường ĐỒNG BỘ và biến nó thành async là kéo `await` vào
 * đúng chỗ nóng nhất, để đổi lấy một lần cài đáng ra phải xong từ trước.
 */

/** Kho gói của cánh tay. Là CACHE — xoá đi lúc nào cũng được, tự dựng lại. */
export function armsCacheDir(): string {
  return path.join(os.homedir(), '.agentco', 'arms');
}

/**
 * Tên file đánh dấu "đã cài xong, và đây là file cần chạy".
 *
 * Ghi ra một marker thay vì đọc lại `bin` trong `package.json` của gói người
 * lạ ở MỖI lần khởi động: `bin` có thể là chuỗi, có thể là object nhiều khoá,
 * và ta chỉ muốn quyết chuyện đó ĐÚNG MỘT LẦN — lúc cài, nơi có thể ném lỗi và
 * ghi log tử tế. Đường nóng thì chỉ đọc một dòng.
 */
const MARKER = '.agentco-entry';

export interface ExecConfig {
  command?: unknown;
  args?: unknown;
  [k: string]: unknown;
}

/**
 * Tách một dòng `npx` thành: gói cần cài + tham số truyền cho server.
 *
 * `['-y', '@scope/pkg@1.2.3', 'D:\\x']` → spec `@scope/pkg@1.2.3`, rest `['D:\\x']`
 *
 * Luật: tham số ĐẦU TIÊN không bắt đầu bằng `-` là tên gói; mọi thứ sau nó là
 * của server. Cờ của npx (`-y`, `--offline`, `--package=…`) đều mang dấu `-`.
 *
 * ⚠ Trả `undefined` cho mọi hình dạng không chắc chắn. Đây là hàm được phép
 * NÓI KHÔNG BIẾT — người gọi rơi về `npx` và mọi thứ chạy y như trước.
 */
export function npxSpec(config: ExecConfig): { spec: string; rest: string[] } | undefined {
  if (config.command !== 'npx' && config.command !== 'npx.cmd') return undefined;
  const args = Array.isArray(config.args) ? config.args : undefined;
  if (!args || !args.every((a): a is string => typeof a === 'string')) return undefined;

  const at = args.findIndex((a) => !a.startsWith('-'));
  if (at < 0) return undefined;
  const spec = args[at]!;
  // `--package=x` đổi hẳn nghĩa của tham số vị trí (nó thành TÊN LỆNH, không
  // phải tên gói). Ca hiếm, và đoán sai ở đây là chạy nhầm gói — nói không biết.
  if (args.some((a) => a.startsWith('--package'))) return undefined;
  return { spec, rest: args.slice(at + 1) };
}

/** `@scope/name@1.2.3` → `@scope/name`. `name@1.2.3` → `name`. */
export function packageName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Thư mục cài của MỘT spec. Băm vì tên gói có `@`, `/` — không hợp lệ làm tên thư mục. */
function dirFor(spec: string): string {
  return path.join(armsCacheDir(), `${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`);
}

/**
 * ĐỒNG BỘ, RẺ, VÀ KHÔNG BAO GIỜ ĐƯỢC NÉM.
 *
 * Có bản cài sẵn thì trả cấu hình chạy thẳng `node`; không thì trả **đúng cấu
 * hình gốc**. Người gọi không cần biết chuyện gì vừa xảy ra.
 */
export function fastLaunch<T extends ExecConfig>(config: T): T {
  try {
    const parsed = npxSpec(config);
    if (!parsed) return config;
    const marker = path.join(dirFor(parsed.spec), MARKER);
    if (!fs.existsSync(marker)) return config;
    const entry = fs.readFileSync(marker, 'utf8').trim();
    if (!entry || !fs.existsSync(entry)) return config;
    // `process.execPath` chứ không phải chuỗi `'node'`: daemon có thể chạy bằng
    // một node không nằm trong PATH, và cánh tay phải chạy bằng ĐÚNG node đó.
    return { ...config, command: process.execPath, args: [entry, ...parsed.rest] };
  } catch {
    // Đĩa hỏng · quyền · đường dẫn lạ — mọi ca đều rơi về `npx`, đúng thiết kế.
    return config;
  }
}

/** Đã cài rồi thì không làm gì. Trả `true` nếu sau lời gọi này có bản chạy nhanh. */
export async function ensureInstalled(config: ExecConfig): Promise<boolean> {
  const parsed = npxSpec(config);
  if (!parsed) return false;
  const dir = dirFor(parsed.spec);
  const marker = path.join(dir, MARKER);
  if (fs.existsSync(marker)) return true;

  try {
    fs.mkdirSync(dir, { recursive: true });
    // `--prefix` để npm không đi ngược lên tìm `package.json` của công ty hay của
    // agentco — cài nhầm vào repo người dùng là một tác dụng phụ không ai đoán.
    await run('npm', ['install', parsed.spec, '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error']);
    const entry = findEntry(dir, packageName(parsed.spec));
    if (!entry) return false;
    fs.writeFileSync(marker, entry, 'utf8');
    return true;
  } catch (e) {
    // Không ra được registry · máy không có npm · quyền ghi home. Cả ba đều
    // KHÔNG phải sự cố: cánh tay vẫn chạy bằng `npx` như trước, chỉ chậm hơn.
    process.emitWarning(
      `Không cài sẵn được "${parsed.spec}" vào kho cánh tay (${(e as Error).message}). ` +
        `Cánh tay vẫn chạy bình thường qua npx, chỉ chậm hơn ~4 giây mỗi lần khởi động.`,
    );
    return false;
  }
}

/**
 * File cần chạy, quyết ĐÚNG MỘT LẦN ở đây.
 *
 * `bin` trong `package.json` có hai hình dạng hợp lệ (chuỗi, hoặc object
 * tên→đường dẫn). Một gói có nhiều `bin` thì lấy cái ĐẦU: cùng thứ `npx <gói>`
 * chọn khi tên lệnh trùng tên gói, và ca nhiều-bin gần như không tồn tại với
 * MCP server. Không đoán được thì trả `undefined` → rơi về npx.
 */
function findEntry(dir: string, name: string): string | undefined {
  const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return undefined;
  const bin = (JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { bin?: unknown }).bin;
  const rel =
    typeof bin === 'string'
      ? bin
      : bin && typeof bin === 'object'
        ? Object.values(bin as Record<string, string>).find((v) => typeof v === 'string')
        : undefined;
  if (!rel) return undefined;
  const abs = path.join(pkgDir, rel);
  return fs.existsSync(abs) ? abs : undefined;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // `shell: true` trên Windows vì `npm` là `npm.cmd`; `spawn` không tự giải.
    const p = spawn(cmd, args, { shell: process.platform === 'win32', stdio: 'ignore' });
    // Trần cứng: một lần cài treo vô hạn sẽ treo luôn cả nút "Thử ngay".
    const kill = setTimeout(() => {
      try {
        p.kill();
      } catch {
        /* đã chết */
      }
      reject(new Error('quá 120 giây'));
    }, 120_000);
    p.on('error', (e) => {
      clearTimeout(kill);
      reject(e);
    });
    p.on('exit', (code) => {
      clearTimeout(kill);
      if (code === 0) resolve();
      else reject(new Error(`npm install thoát với mã ${code}`));
    });
  });
}
