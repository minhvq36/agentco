/**
 * SPIKE — `lookup` TRA WEB CÓ CHẠY ĐẦU-CUỐI KHÔNG, và Trợ lý có định tuyến
 * đúng cửa không?
 *
 * Hai câu, và câu thứ hai mới là câu khó:
 *
 *   A. `assistant.lookup([], "…")` — worker ẩn có tra web thật không?
 *   B. `assistant.route("thời tiết hôm nay")` — nó chọn `lookup` hay `task`?
 *      Và câu ĐÚNG CHUYÊN MÔN của một nhân viên có còn về tay họ không?
 *      (luật ưu tiên user chốt 24/08 — nới `lookup` mà nuốt mất `task` là hỏng
 *      NGƯỢC CHIỀU, và im lặng hơn: không ai kiểm một câu trả lời trôi chảy.)
 *
 * ⚠ Chạy trên văn phòng THẬT của user, nhưng KHÔNG ghi gì: chỉ `route` (một
 * lượt hội thoại) và `lookup` (one-shot, `persistSession: false`).
 * ⚠ `route` chạy TRÊN session Trợ lý ⇒ nó có để lại lượt trong bản ghi hội
 * thoại của văn phòng đó. Dùng văn phòng `canh-tay` (văn phòng thử của bài 11).
 *
 * Chạy: npx tsx scripts/spike-lookup-route.ts [office-id]   (~$0,15)
 */

import { Assistant } from '../src/core/assistant.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const officeId = process.argv[2] ?? 'canh-tay';
const companyConfig = loadCompanyConfig('company');
const office = loadOffice('company', companyConfig, officeId);
const assistant = new Assistant(office);

console.log(`\nvăn phòng: ${officeId}`);
console.log(`nhân viên: ${[...office.roles.keys()].join(', ') || '(không có ai)'}\n`);

// ── A · worker ẩn có tra web thật không ────────────────────────────────────
console.log('── A · lookup([], …) — worker ẩn tra web');
const t0 = Date.now();
const a = await assistant.lookup([], 'Tìm 3 quán cà phê làm việc được ở Quận 1, TP.HCM. Nêu tên và địa chỉ.');
console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s · $${a.usage.costUSD.toFixed(4)} · ${a.usage.turns} lượt`);
console.log(`   nói: ${a.value.replace(/\s+/g, ' ').slice(0, 300)}\n`);

// ── B · Trợ lý chọn cửa nào ────────────────────────────────────────────────
console.log('── B · route() — cửa nào cho câu nào');
const cases: [string, string][] = [
  ['thời tiết TP.HCM hôm nay thế nào?', 'lookup (tra cứu chung, không ai thêm được gì)'],
  ['tin tức công nghệ hôm nay có gì?', 'lookup'],
  ['viết cho mình một bài giới thiệu shop hoa, 300 chữ', 'task (cần FILE + chuyên môn)'],
];

for (const [msg, mong] of cases) {
  const r = await assistant.route(msg, false);
  const v = r.value as Record<string, unknown>;
  const extra =
    v['intent'] === 'lookup' ? ` paths=${JSON.stringify(v['paths'])}` : v['intent'] === 'task' ? ` scope=${v['scope']}` : '';
  console.log(`   "${msg.slice(0, 42)}…"`);
  console.log(`      → ${String(v['intent']).padEnd(7)}${extra}   $${r.usage.costUSD.toFixed(4)}`);
  console.log(`      mong đợi: ${mong}`);
}

console.log(
  `\n⚠ Ranh giới: đây là HÀNH VI của model, không phải một hàng rào. Một lượt đúng\n` +
    `  không chứng minh luật ưu tiên luôn đúng — nó chỉ chứng minh cửa mới không\n` +
    `  nuốt sạch cửa cũ ở ca dễ thấy nhất.`,
);
