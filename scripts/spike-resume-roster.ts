/**
 * SPIKE — ĐỔI CẤU HÌNH GIỮA PHIÊN CÓ TỚI ĐƯỢC TRỢ LÝ KHÔNG? (user đặt bài 24/08)
 *
 * Ca thật user đo được: hỏi một câu, Trợ lý hỏi lại *"soi thư mục nào: Programs
 * Installation hay Musics?"*. Rút dây khỏi Installation → hỏi lại **cùng câu đó**
 * → **cùng câu trả lời**. Xoá hẳn cánh tay khỏi văn phòng → vẫn **cùng câu**.
 * Cắm thêm một cánh tay mới → cũng không thấy.
 *
 * Nghi phạm user nêu: *"cơ chế bảo vệ cache làm việc thêm/xoá không real-time"*.
 * Nghi phạm thứ hai: **`resume` mang cả lịch sử hội thoại**, và câu cũ của chính
 * Trợ lý nằm trong đó — model chép lại câu nó vừa nói thay vì đọc lại danh bạ.
 *
 * HAI NGHI PHẠM NÀY TÁCH ĐƯỢC BẰNG ĐÚNG MỘT PHÉP ĐO — và đó là bài này:
 *
 *   lượt 2  hỏi Y HỆT câu cũ          → cả hai nghi phạm đều dự đoán "vẫn thấy"
 *   lượt 3  hỏi CÙNG Ý, KHÁC CHỮ      → cache-không-real-time: vẫn thấy
 *                                       lịch sử neo:            hết thấy
 *   lượt 5  phiên MỚI, cùng cấu hình  → cấu hình đúng hay sai, không dính lịch sử
 *
 * ⚠ Cấu hình được in ra ở MỖI lượt (`armReach` — đúng hàm dựng dòng năng lực
 *   trong danh bạ), nên bảng dưới so được "thứ ta GỬI" với "thứ model NÓI".
 *   Thiếu cột đó thì lại đo được một hành vi rồi kết luận về một cơ chế.
 *
 * ⚠ Dựng CÔNG TY TẠM trong thư mục tạm — không đụng công ty của user.
 * ⚠ Cánh tay dùng `command: node` (không phải `npx`) nên KHÔNG cài gói, KHÔNG
 *   khởi động tiến trình nào: Trợ lý vốn không bao giờ cầm MCP, bài này chỉ đo
 *   dòng chữ trong danh bạ.
 *
 * Chạy: npx tsx scripts/spike-resume-roster.ts   (~$0,08)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import YAML from 'yaml';

import { Assistant, armReach } from '../src/core/assistant.js';
import { armHash } from '../src/core/catalog.js';
import { Company } from '../src/core/company.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-roster-'));
const companyDir = path.join(root, 'company');
fs.cpSync(path.resolve('templates/company'), companyDir, { recursive: true });

const company = Company.open(companyDir);
const officeId = company.createOffice({ name: 'Canh tay' }).id;
const officeDir = path.join(companyDir, 'offices', officeId);
const rolesDir = path.join(officeDir, 'roles');

// ── hai cánh tay, hai thư mục, đúng hình dạng ca thật ────────────────────────
const cfgA = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Musics'] };
const cfgB = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Programs Installation'] };
const cfgC = { command: 'node', args: ['-e', '0', 'D:\\Fake\\Hoa Don'] };
const A = armHash(cfgA);
const B = armHash(cfgB);
const C = armHash(cfgC);

function writeCompanyArms(entries: [string, Record<string, unknown>, string][]): void {
  const file = path.join(companyDir, 'company.yaml');
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  doc.set('mcpServers', doc.createNode(Object.fromEntries(entries.map(([id, cfg]) => [id, cfg]))));
  doc.set(
    'arms',
    doc.createNode(Object.fromEntries(entries.map(([id, , label]) => [id, { label, secrets: [] }]))),
  );
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), 'utf8');
}

function writeRole(id: string, name: string, pitch: string, mcp: string[]): void {
  fs.writeFileSync(
    path.join(rolesDir, `${id}.yaml`),
    `id: ${id}\nversion: 1\ndisplay_name: "${name}"\navatar: "•"\npitch: "${pitch}"\n` +
      `good_at: []\nnot_for: []\nskill_level: medium\nskills: {}\nmodel_tier: standard\n` +
      `use_preset: false\ntools: []\n` +
      (mcp.length ? `mcp:\n${mcp.map((m) => `  - ${m}\n`).join('')}` : 'mcp: []\n') +
      `budget:\n  max_turns: 6\n  max_usd: 1.0\n  knowledge_pack: 3000\n`,
    'utf8',
  );
}

// Khuôn đẻ sẵn vài vai trò — xoá hết để danh bạ chỉ còn thứ bài này dựng.
for (const f of fs.readdirSync(rolesDir)) fs.rmSync(path.join(rolesDir, f));

writeCompanyArms([
  [A, cfgA, 'Musics'],
  [B, cfgB, 'Programs Installation'],
]);
writeRole('nguoi-soi-nhac', 'Người soi nhạc', 'Đọc file và thư mục người dùng chỉ định, tóm tắt nội dung.', [A]);
writeRole('nguoi-soi-cai-dat', 'Người soi cài đặt', 'Đọc file và thư mục người dùng chỉ định, tóm tắt nội dung.', [B]);

const reload = () => loadOffice(companyDir, loadCompanyConfig(companyDir), officeId);
let loaded = reload();
const assistant = new Assistant(loaded);

/** Đúng dòng năng lực mà `Assistant.roster()` dựng — thứ ta THẬT SỰ gửi đi. */
function guiGi(): string {
  return [...loaded.roles.values()]
    .map((r) => `${r.id}: [${r.mcp.map((m) => armReach(loaded.company.arms, loaded.company.mcpServers, m)).join(' · ') || '—'}]`)
    .join('\n           ');
}

const CAU_GOC = 'Trong thư mục đã cho phép, tìm 5 file lớn nhất và tóm tắt xem thư mục đó đang chứa gì.';
const CAU_KHAC = 'Liệt kê giúp mình 5 tệp nặng nhất ở nơi nhân viên được phép với tới, rồi mô tả nơi đó đựng những gì.';

let tong = 0;
async function hoi(nhan: string, cau: string, a = assistant): Promise<void> {
  const r = await a.route(cau, false);
  const v = r.value as Record<string, unknown>;
  tong += r.usage.costUSD;
  console.log(`\n── ${nhan}`);
  console.log(`   gửi đi  : ${guiGi()}`);
  console.log(`   hỏi     : "${cau.slice(0, 58)}…"`);
  console.log(`   ra      : ${v['intent']}  ·  $${r.usage.costUSD.toFixed(4)}  ·  ngữ cảnh ${a.contextTokens} token`);
  // In CẢ BA trường chữ: `ask`/`chat` dùng `say`, `task` dùng `request`, `lookup`
  // dùng `question`. Bản trước quên `question` nên lượt `lookup` in ra rỗng — và
  // một ô rỗng đọc thành "không nói gì", trong khi nó có nói. → §3a
  console.log(`   nói     : ${String(v['say'] ?? v['request'] ?? v['question'] ?? '').slice(0, 200)}`);
}

console.log(`\ncông ty tạm: ${companyDir}`);
console.log(`A=${A} (Musics) · B=${B} (Programs Installation) · C=${C} (Hoa Don)`);

// ── L1 · nền: hai cánh tay, hai người ────────────────────────────────────────
await hoi('L1 · nền (2 cánh tay, phiên MỚI)', CAU_GOC);
console.log(`   session : ${assistant.session}`);

// ── L2 · rút DÂY khỏi B, hỏi Y HỆT ───────────────────────────────────────────
writeRole('nguoi-soi-cai-dat', 'Người soi cài đặt', 'Đọc file và thư mục người dùng chỉ định, tóm tắt nội dung.', []);
loaded = reload();
assistant.rebind(loaded);
await hoi('L2 · đã RÚT DÂY khỏi B — hỏi Y HỆT câu cũ', CAU_GOC);

// ── L3 · cùng cấu hình, hỏi KHÁC CHỮ ─────────────────────────────────────────
await hoi('L3 · cùng cấu hình như L2 — hỏi CÙNG Ý, KHÁC CHỮ', CAU_KHAC);

// ── L4 · cắm THÊM C, hỏi Y HỆT ───────────────────────────────────────────────
writeCompanyArms([
  [A, cfgA, 'Musics'],
  [B, cfgB, 'Programs Installation'],
  [C, cfgC, 'Hoa Don'],
]);
writeRole('nguoi-soi-cai-dat', 'Người soi cài đặt', 'Đọc file và thư mục người dùng chỉ định, tóm tắt nội dung.', [C]);
loaded = reload();
assistant.rebind(loaded);
await hoi('L4 · đã CẮM THÊM C (Hoa Don) — hỏi Y HỆT câu cũ', CAU_GOC);

// ── L5 · ĐỐI CHỨNG: phiên MỚI TINH, đúng cấu hình của L4 ─────────────────────
const sach = new Assistant(loaded);
await hoi('L5 · ĐỐI CHỨNG — phiên MỚI TINH, cấu hình y hệt L4', CAU_GOC, sach);

console.log(`\n⇒ tổng $${tong.toFixed(4)}`);
console.log(
  `\nCÁCH ĐỌC BẢNG:\n` +
    `  L2 nhắc B  +  L3 KHÔNG nhắc B      ⇒ LỊCH SỬ HỘI THOẠI neo, cấu hình vẫn tới nơi\n` +
    `  L2 nhắc B  +  L3 VẪN nhắc B        ⇒ cấu hình KHÔNG tới được phiên đang resume\n` +
    `  L5 khác L4                          ⇒ chứng minh cấu hình đúng, lỗi nằm ở phiên\n` +
    `  L5 giống L4                         ⇒ lỗi nằm ở tầng cấu hình, không phải phiên\n`,
);

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ đã xoá công ty tạm');
