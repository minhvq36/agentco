/**
 * ĐĂNG NHẬP BẰNG TAY VÀO HỒ SƠ CỦA CÁNH TAY TRÌNH DUYỆT.
 * → docs/TEST-WALKTHROUGH.md bài 18 chặng E · `arms/browser.ts §options`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TÍNH NĂNG NÀY TỒN TẠI — một ca thật, lặp lại bốn lần 29/08.       │
 * │                                                                          │
 * │ Vòng đời trình duyệt của nhân viên = vòng đời một LƯỢT VIỆC. Task xong ⇒  │
 * │ tiến trình MCP bị đóng ⇒ cửa sổ biến mất. User đang chờ mã SMS, đang ở    │
 * │ bước "setup địa chỉ" của Google, thì cửa sổ tắt giữa chừng:               │
 * │                                                                          │
 * │   *"Kìa, tui đang đăng nhập dở bằng sđt mà, chờ xíu đi"*                 │
 * │                                                                          │
 * │ Không có chỗ nào trong vòng đời một task để **một con người thao tác**.   │
 * │ Nên đây không phải một task — nó là một hành động của daemon, cùng họ với │
 * │ `probeArm`.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 VÀ NÓ KHÔNG ĐI QUA PLAYWRIGHT — đây là chỗ đáng nhớ nhất của file này. │
 * │                                                                          │
 * │ Phản xạ đầu là mở cửa sổ **qua MCP** rồi giữ phiên sống. Sai, vì thứ ta   │
 * │ cần né chính là **trình duyệt bị điều khiển**: Google/Facebook dò         │
 * │ `navigator.webdriver`, dò CDP, và chặn đăng nhập ngay trong đó. Mở qua    │
 * │ Playwright là đăng nhập bên trong đúng cái cửa họ đang gác.               │
 * │                                                                          │
 * │ ⇒ Mở một cửa sổ **bình thường** của hệ điều hành, trỏ vào **cùng hồ sơ**. │
 * │ Không CDP, không cờ tự động hoá — với hãng thì đó là một người thật.      │
 * │ Cookie đọng lại trong hồ sơ, và lượt sau Playwright dùng lại.             │
 * │                                                                          │
 * │   **Đăng nhập bằng cửa sổ thường. Dùng bằng Playwright.**                 │
 * │   Hai việc, hai công cụ, chung một hồ sơ.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { t } from '../i18n/index.js';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BA HỆ ĐIỀU HÀNH, KHAI BẰNG DỮ LIỆU. (user nhắc 29/08 — lần thứ sáu)     │
 * │                                                                          │
 * │ Thứ tự trong mỗi mảng là thứ tự THỬ, và nó khớp `arms/browser.ts          │
 * │ §argsByOs`: mục danh mục bảo Playwright dùng channel nào thì ở đây mở     │
 * │ đúng trình duyệt ấy. Lệch nhau ⇒ đăng nhập vào hồ sơ bằng Edge rồi chạy   │
 * │ việc bằng Chrome — hai trình duyệt, một thư mục hồ sơ, và Chromium sẽ     │
 * │ **từ chối** hoặc làm hỏng hồ sơ. Đây là chỗ hai file phải nhìn nhau.      │
 * │                                                                          │
 * │ `win32`/`darwin` dùng đường tuyệt đối vì hai hãng cài cố định chỗ đó;     │
 * │ `linux` dùng TÊN LỆNH vì bản phân phối nào cũng đặt một chỗ khác nhau —   │
 * │ ở đó `PATH` mới là nguồn sự thật, không phải một danh sách ta đoán.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const BROWSER_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: [
    `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
};

/**
 * Trình duyệt đầu tiên **thật sự có** trên máy này.
 *
 * ⚠ Linux trả về TÊN LỆNH chưa kiểm — `Test-Path` một tên lệnh là vô nghĩa, và
 * quét cả `PATH` ở đây là dựng lại `which` bằng tay. Sai tên thì `spawn` ném, và
 * câu ném đó nói đúng tên lệnh thiếu — một câu lỗi dùng được, không phải một câu
 * đoán. Chiều an toàn: **thà hỏng ồn ào còn hơn im lặng không mở gì**.
 */
export function findBrowser(platform: string = process.platform): string | undefined {
  const list = BROWSER_CANDIDATES[platform] ?? [];
  if (platform === 'linux') return list[0];
  return list.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** Hồ sơ của một văn phòng — MỘT chỗ tính, để cửa đăng nhập và cánh tay không lệch. */
export function profileDir(officeStateDir: string): string {
  return path.join(officeStateDir, 'profile');
}

interface OpenSession {
  office: string;
  url: string;
  since: number;
  child: ChildProcess;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHOÁ THEO **VĂN PHÒNG**, KHÔNG THEO CÁNH TAY. (user hỏi 29/08)          │
 * │                                                                          │
 * │ Chromium **khoá** `user-data-dir`: hai tiến trình cùng trỏ vào một hồ sơ  │
 * │ thì cái thứ hai hỏng. Mà hồ sơ là của **văn phòng** — hai cánh tay trình  │
 * │ duyệt trong cùng văn phòng dùng chung nó (cố ý: đăng nhập bằng cánh tay   │
 * │ hiện-cửa-sổ, chạy việc bằng cánh tay chạy-ẩn). ⇒ Khoá theo cánh tay là    │
 * │ khoá **sai tài nguyên**, và nó sẽ cho qua đúng ca hỏng.                   │
 * │                                                                          │
 * │ Cất trong RAM, không cất ra file: một file khoá **mồ côi sau crash** lại  │
 * │ đẻ ra nhu cầu một cơ chế dọn thứ hai. Cùng lựa chọn đã làm cho `pending`  │
 * │ của OAuth, và cùng ràng buộc *1 replica* đã ghi ở `SPEC-deploy` §5③.      │
 * │                                                                          │
 * │ 🔴 KHOÁ PHẢI TỰ LÀNH, vì mọi khoá không tự lành đều thành khoá vĩnh viễn: │
 * │   · người dùng đóng cửa sổ  → `exit` của tiến trình gỡ khoá (TẤT ĐỊNH,   │
 * │     không phải một cái hẹn giờ đoán mò)                                   │
 * │   · daemon khởi động lại    → RAM sạch, không có trạng thái mồ côi        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const open = new Map<string, OpenSession>();

export function loginOpen(office: string): boolean {
  return open.has(office);
}

/** Ai đang mở, mở từ bao giờ — để câu từ chối nói được điều gì đó cụ thể. */
export function loginInfo(office: string): { url: string; since: number } | undefined {
  const s = open.get(office);
  return s ? { url: s.url, since: s.since } : undefined;
}

export class LoginError extends Error {}

/**
 * Mở cửa sổ đăng nhập. Trả về khi cửa sổ **đã mở**, không đợi người dùng xong —
 * họ đóng lúc nào thì khoá gỡ lúc ấy.
 *
 * ⚠ `url` phải là `http`/`https`. Một `file://` ở đây là mở đĩa của máy chủ bằng
 * một cửa sổ có toàn quyền hồ sơ — không phải thứ nút này sinh ra để làm.
 */
export function startLogin(opts: {
  office: string;
  officeStateDir: string;
  /** Bỏ trống ⇒ mở trang mặc định của trình duyệt. Người dùng tự gõ tiếp. */
  url?: string;
  /** `office.currentState` — chặn khi đang chạy việc, cùng luật `archiveOffice`. */
  working: boolean;
  platform?: string;
}): { profile: string; browser: string } {
  if (opts.working) {
    throw new LoginError(
      t('browserLogin.officeBusy'),
    );
  }
  if (open.has(opts.office)) {
    throw new LoginError(t('browserLogin.alreadyOpen'));
  }

  /**
   * ⚠ URL là TUỲ CHỌN (user chốt 29/08: *"mở chromium của văn phòng lên, người
   * dùng muốn làm gì cũng được"*).
   *
   * Bản đầu bắt gõ địa chỉ. Thừa: một khi cửa sổ đã mở, họ gõ vào thanh địa chỉ
   * được — bắt gõ trước chỉ thêm một bước cho cùng một kết quả. Và nó **mô tả
   * sai bản chất**: đây không phải "mở một trang", đây là **mở trình duyệt của
   * văn phòng**.
   */
  let u: URL | undefined;
  if (opts.url?.trim()) {
    try {
      u = new URL(opts.url);
    } catch {
      throw new LoginError(t('browserLogin.badUrl', { url: opts.url }));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new LoginError(t('browserLogin.badScheme'));
    }
  }

  const platform = opts.platform ?? process.platform;
  const browser = findBrowser(platform);
  if (!browser) {
    throw new LoginError(
      t('browserLogin.noBrowser'),
    );
  }

  const profile = profileDir(opts.officeStateDir);
  fs.mkdirSync(profile, { recursive: true });

  /**
   * ⚠ KHÔNG qua shell. URL luôn có thể chứa `&`, và đi qua shell trên Windows là
   * hỏng **100% số lần** — đã dẫm 24/08 với URL OAuth. `spawn` với mảng tham số
   * đưa từng chuỗi nguyên vẹn tới tiến trình con.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HAI CỜ DẸP MÀN CHÀO CỦA TRÌNH DUYỆT. (user 29/08: *"nó có 1 bảng yêu cầu │
   * │ sync với account mà không ra trình duyệt luôn, tôi thấy cũng hơi phiền"*) │
   * │                                                                          │
   * │ Hồ sơ này **luôn mới với trình duyệt** (nó không phải hồ sơ cá nhân của   │
   * │ người dùng), nên Edge/Chrome bày màn chào + mời đăng nhập đồng bộ **mỗi   │
   * │ lần**. Người dùng bấm nút để đi đăng nhập một trang, không phải để trả    │
   * │ lời một câu hỏi về tài khoản trình duyệt.                                 │
   * │                                                                          │
   * │ ⚠ CỐ Ý KHÔNG thêm `--disable-extensions`: extension bị máy ép cài (IDM,   │
   * │ Grammarly qua registry) thì gây ồn thật, nhưng tắt hết cũng tắt luôn      │
   * │ **trình quản lý mật khẩu** — thứ người ta cần đúng lúc đang đăng nhập.    │
   * │ Ồn thì thấy được và bỏ qua được; thiếu thì họ kẹt.                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const quiet = ['--no-first-run', '--no-default-browser-check'];
  const child = spawn(browser, [`--user-data-dir=${profile}`, ...quiet, ...(u ? [u.toString()] : [])], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  open.set(opts.office, { office: opts.office, url: u?.toString() ?? '', since: Date.now(), child });
  const clear = () => {
    if (open.get(opts.office)?.child === child) open.delete(opts.office);
  };
  child.on('exit', clear);
  child.on('error', clear);

  return { profile, browser };
}

/** Đóng hộ (nút "Xong"). Người dùng tự đóng cửa sổ cũng ra cùng kết quả. */
export function endLogin(office: string): boolean {
  const s = open.get(office);
  if (!s) return false;
  try {
    s.child.kill();
  } catch {
    /* đã tự đóng — `exit` đã gỡ khoá rồi */
  }
  open.delete(office);
  return true;
}
