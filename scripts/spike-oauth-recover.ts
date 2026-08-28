/**
 * SPIKE — CỜ `dead` CÓ ĐÚNG KHÔNG? Và nếu sai thì CỨU ĐƯỢC KHÔNG?
 * → `core/oauth.ts §DeadGrantError` · `server/oauth-routes.ts §refreshDue`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÂU HỎI CHƯA AI HỎI: khi ta ghi `dead`, ta đang khai một SỰ THẬT VỀ PHÍA │
 * │ NOTION, hay đang khai một KẾT LUẬN của chính ta?                        │
 * │                                                                          │
 * │ Cờ đó có hậu quả một chiều: `needsRefresh` trả `false` khi thấy `dead`   │
 * │ ⇒ **không bao giờ thử lại nữa**. Nên một lần dán nhãn sai là một tài      │
 * │ khoản chết vĩnh viễn, dù chìa trên đĩa vẫn còn dùng được.                │
 * │                                                                          │
 * │ Script này gõ thẳng cửa Notion bằng ĐÚNG chìa đang nằm trên đĩa:          │
 * │   · 200  ⇒ cờ SAI, và ta vừa cứu được tài khoản (ghi chìa mới, xoá cờ)   │
 * │   · invalid_grant ⇒ cờ ĐÚNG, chìa chết thật, phải đăng nhập lại          │
 * │                                                                          │
 * │ ⚠ KHÔNG có chế độ "chỉ xem". Cách duy nhất biết một refresh token còn    │
 * │ sống là DÙNG nó, mà Notion thì XOAY — dùng xong là chìa cũ chết và chìa   │
 * │ mới phải được ghi xuống. Nên script này **luôn ghi** khi thành công, và   │
 * │ ghi qua `saveOAuth` (nguyên tử: temp → fsync → rename).                  │
 * │                                                                          │
 * │ Chạy:  npx tsx scripts/spike-oauth-recover.ts [--all]                    │
 * │        (mặc định chỉ thử tài khoản có cờ `dead`; `--all` thử hết)         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discover, refreshAccount, DeadGrantError, TransientError } from '../dist/core/oauth.js';
import { companyPaths } from '../dist/core/paths.js';
import { readOAuth, saveOAuth } from '../dist/core/secrets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = path.join(HERE, '..', 'company');

const mask = (v?: string): string => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : '—');

async function main(): Promise<void> {
  const all = process.argv.includes('--all');
  const paths = companyPaths(COMPANY);
  const store = readOAuth(paths);
  const names = Object.keys(store).filter((n) => all || store[n]?.dead);

  if (!names.length) {
    console.log('\nKhông có tài khoản nào mang cờ `dead`. (Dùng --all để thử hết.)\n');
    return;
  }

  console.log(`\n━━ THỬ CỨU ${names.length} tài khoản\n`);

  for (const name of names) {
    const acc = store[name]!;
    console.log(`── ${acc.label ?? name}`);
    console.log(`   cờ dead        ${acc.dead ? `CÓ · ${acc.dead.at} · ${acc.dead.why}` : 'không'}`);
    console.log(`   refresh trên đĩa ${mask(acc.refresh_token)}`);

    if (!acc.refresh_token) {
      console.log('   ⇒ 🔴 không có chìa làm mới — chỉ còn đường đăng nhập lại.\n');
      continue;
    }

    try {
      const meta = await discover(acc.mcp_url);
      if (!meta) {
        console.log('   ⇒ ⚠ server không đòi chìa nữa (?), bỏ qua.\n');
        continue;
      }
      const next = await refreshAccount(meta, acc);
      /**
       * ⚠ XOÁ CỜ TƯỜNG MINH. `refreshAccount` gộp từ `acc`, mà `applyToken`
       * không mang `dead` sang — nhưng dựa vào việc một hàm khác *tình cờ* bỏ
       * quên một trường là dựa vào may mắn. Xoá ở đây, chỗ biết vì sao xoá.
       */
      const { dead: _bo, ...sach } = next as typeof next & { dead?: unknown };
      saveOAuth(paths, name, sach as typeof next);
      console.log(`   ⇒ 🟢 CỨU ĐƯỢC — chìa mới ${mask(sach.access_token)}, cờ dead đã xoá.`);
      console.log(
        `      refresh có XOAY: ${next.refresh_token !== acc.refresh_token ? 'CÓ' : 'không'}\n`,
      );
    } catch (e) {
      if (e instanceof DeadGrantError) {
        console.log(`   ⇒ 🔴 CHẾT THẬT — Notion từ chối chính chìa này. ${e.message}\n`);
      } else if (e instanceof TransientError) {
        console.log(`   ⇒ ⚠ hỏng TẠM (mạng/dịch vụ) — chưa kết luận được. ${e.message}\n`);
      } else {
        console.log(`   ⇒ ❓ ${(e as Error).message}\n`);
      }
    }
  }
}

main().catch((e) => {
  console.error(`\n🔴 ${(e as Error).message}\n`);
  process.exit(1);
});
