/**
 * CẮT QUERY KHỎI URL TRONG LOG CONSOLE CỦA TRÌNH DUYỆT.
 * → `arms/browser.ts` · docs/TEST-WALKTHROUGH.md bài 18
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT, ĐỌC ĐƯỢC TRÊN ĐĨA 29/08 — `.playwright-mcp/console-*.log`:      │
 * │                                                                          │
 * │   …/ajax/bnzai?…&fb_dtsg=AbCdEfGhIjKlMn_…&__user=100000000000001&…       │
 * │                                                                          │
 * │ Đó là **chìa phiên đăng nhập dưới dạng chữ**, nằm trong thư mục văn phòng │
 * │ — nơi nhân viên đọc được bằng `Read`. Trong khi **cookie thì đã được gác**│
 * │ (`<văn phòng>/.state/browser/profile`, trong `guardedZone`).              │
 * │                                                                          │
 * │ ⇒ Lớp lỗi để nhận mặt: **thứ phái sinh từ một tài sản nhạy cảm không tự   │
 * │ thừa kế mức bảo vệ của nó.** Kho chìa được gác; bản ghi chép *về* chìa    │
 * │ thì không.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CẮT THEO **HÌNH DẠNG**, KHÔNG LỌC THEO TÊN. (user chốt 29/08)         │
 * │                                                                          │
 * │ Một danh sách tên (`fb_dtsg` · `access_token` · `sig` · `sessionid`…) là  │
 * │ **denylist**: nó bỏ **im lặng** mọi tên chưa ai nghĩ ra, và hãng thứ mười │
 * │ một sẽ có một tên như thế. Đúng họ [[agentco-silent-allowlist]].          │
 * │                                                                          │
 * │ *"Giữ scheme + host + path, vứt sạch phần sau"* thì đúng cho **mọi hãng**,│
 * │ không cần biết tham số nào là bí mật. Và về giá trị gỡ lỗi, `…/ajax/bnzai`│
 * │ đã nói đủ — cái query 400 ký tự kia chưa bao giờ giúp ai đọc log.         │
 * │                                                                          │
 * │ ⚠ Cắt từ `?` **HOẶC** `#`, cái nào đến trước: token OAuth kiểu implicit   │
 * │ nằm sau `#`, và một luật chỉ nhìn `?` sẽ bỏ sót đúng loại nguy nhất.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠⚠ ĐÂY LÀ GIẢM THIỂU, KHÔNG PHẢI BỊT KÍN — và câu này phải ở lại trong mã:
 * token nằm trong **thân** thông điệp (`[LOG] token=abc…`) thì không luật hình
 * dạng nào bắt được. Muốn kín hẳn thì phải xoá cả file, và cái giá là mất khả
 * năng gỡ lỗi trang. Đừng đọc hàm này thành một lời hứa nó không đưa ra.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * URL trong log console. Dừng ở khoảng trắng và ở vài ký tự bao quanh thường gặp
 * (`"` `'` `<` `>` `)`), vì log là văn bản tự do chứ không phải JSON.
 */
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

/**
 * Cắt query/fragment khỏi mọi URL trong một đoạn văn bản.
 *
 * ⚠ **BẤT BIẾN: LUỸ ĐẲNG.** Chạy hai lần phải ra đúng một kết quả — hook có thể
 * quét lại cùng một file, và một hàm dọn không luỹ đẳng sẽ gặm dần nội dung qua
 * mỗi lượt cho tới ngày file rỗng mà không ai biết vì sao.
 */
export function cutQuery(text: string): string {
  return text.replace(URL_RE, (u) => {
    const i = Math.min(
      ...[u.indexOf('?'), u.indexOf('#')].filter((n) => n >= 0).concat([u.length]),
    );
    return u.slice(0, i);
  });
}

/** Chỉ file log console. Snapshot (`page-*.yml`) **không được đụng** — worker đọc nó. */
const isConsoleLog = (name: string): boolean => name.startsWith('console-') && name.endsWith('.log');

/**
 * Mốc đã quét của từng thư mục — để hook không đọc lại file cũ ở mọi lời gọi tool.
 *
 * Trong RAM: mất khi khởi động lại daemon, và lần quét đầu sau đó chỉ tốn thêm
 * một lượt đọc các file cũ — rẻ hơn hẳn một file mốc trên đĩa cần cơ chế dọn.
 */
const seen = new Map<string, number>();

/** Trần đọc một file. Log console lớn hơn mức này thì nó không còn là log để đọc. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Dọn thư mục output của trình duyệt trong MỘT văn phòng.
 *
 * ⚠ RẺ LÀ MỘT YÊU CẦU, không phải mong muốn: hàm này chạy sau **mỗi lời gọi
 * tool**, kể cả những lượt chẳng liên quan gì tới trình duyệt. Bốn tầng chặn,
 * xếp từ rẻ nhất:
 *   ① thư mục không tồn tại ⇒ về ngay (đúng với gần hết văn phòng)
 *   ② chỉ `console-*.log`
 *   ③ chỉ file có `mtime` **mới hơn** lần quét trước
 *   ④ chỉ ghi lại khi nội dung **thật sự đổi**
 *
 * Trả về số file đã sửa — để test đếm được, và để hook có thứ ghi vào log.
 */
export function redactBrowserLogs(officeDir: string, now = Date.now()): number {
  const dir = path.join(officeDir, '.playwright-mcp');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0; // ① không có thư mục — ca thường, và nó rẻ nhất
  }

  const since = seen.get(dir) ?? 0;
  let changed = 0;
  for (const name of names) {
    if (!isConsoleLog(name)) continue; // ②
    const file = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (st.mtimeMs <= since || st.size > MAX_BYTES) continue; // ③
    try {
      const before = fs.readFileSync(file, 'utf8');
      const after = cutQuery(before);
      if (after !== before) {
        // ④ ghi đè tại chỗ: file này là log của chính ta, không ai đọc dở nó,
        // nên không cần đường ghi nguyên tử như kho chìa.
        fs.writeFileSync(file, after, 'utf8');
        changed++;
      }
    } catch {
      /* file bị khoá hoặc vừa bị xoá — bỏ qua, lượt sau quét lại */
    }
  }
  seen.set(dir, now);
  return changed;
}

/** Cho test: quên mốc đã quét. */
export function resetRedactMarks(): void {
  seen.clear();
}
