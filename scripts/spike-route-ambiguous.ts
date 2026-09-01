/**
 * SPIKE — CÂU MÙ MỜ: `lookup` hay NHÂN VIÊN? (user đặt bài 24/08)
 *
 * Luật ưu tiên vừa chốt: *"cho phép cả hai, Trợ lý tự định tuyến, nhưng ưu tiên
 * nhân viên nếu nhân viên là người chuyên nghiệp và làm chính xác việc đó"*.
 * Bài này dựng đúng thế khó nhất cho luật đó: **một nhân viên chuyên duyệt web
 * và tìm tin**, rồi hỏi những câu mà `lookup` cũng làm được.
 *
 * Nếu `lookup` nuốt hết ⇒ người dùng mất góc nhìn chuyên môn họ cố ý dựng ra,
 * **và không ai thấy là đã mất**, vì câu trả lời vẫn trôi chảy. Đó là hỏng
 * NGƯỢC CHIỀU, im lặng hơn hẳn ca ngược lại.
 *
 * ⚠ Dựng một CÔNG TY TẠM trong thư mục tạm — không đụng công ty của user.
 * ⚠ Đây là HÀNH VI của model, không phải hàng rào. Một bảng đẹp không chứng
 *   minh luật luôn đúng; nó chỉ nói cửa mới có nuốt cửa cũ hay không.
 *
 * Chạy: npx tsx scripts/spike-route-ambiguous.ts   (~$0,15)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Assistant } from '../src/core/assistant.js';
import { Company } from '../src/core/company.js';
import { loadCompanyConfig, loadOffice } from '../src/core/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-amb-'));
const companyDir = path.join(root, 'company');

// Đúng thứ `agentco init` làm: chép nguyên khuôn công ty. Dựng tay `company.yaml`
// ở đây là đẻ ra một bản sao thứ hai của khuôn, và nó sẽ lệch với bản thật.
fs.cpSync(path.resolve('templates/company'), companyDir, { recursive: true });

const company = Company.open(companyDir);
const office = company.createOffice({ name: 'Tin tuc' });
const officeId = office.id;

// Nhân viên CHUYÊN duyệt web — đúng thứ làm câu hỏi trở nên mù mờ.
fs.writeFileSync(
  path.join(companyDir, 'offices', officeId, 'roles', 'nguoi-tim-tin.yaml'),
  [
    'id: nguoi-tim-tin',
    'version: 1',
    'display_name: "Người tìm tin"',
    'avatar: "🔎"',
    'pitch: "Duyệt web, tìm và đối chiếu thông tin từ nhiều nguồn, viết lại thành bản tóm tắt có dẫn nguồn."',
    'good_at: []',
    'not_for: []',
    'skill_level: medium',
    'skills: {}',
    'model_tier: standard',
    'use_preset: false',
    'tools: []',
    'mcp: []',
    'budget:',
    '  max_turns: 8',
    '  max_usd: 1.0',
    '',
  ].join('\n'),
  'utf8',
);

const loaded = loadOffice(companyDir, loadCompanyConfig(companyDir), officeId);
const assistant = new Assistant(loaded);

console.log(`\ncông ty tạm: ${companyDir}`);
console.log(`nhân viên   : ${[...loaded.roles.keys()].join(', ')}\n`);

/** `mong` = cửa ĐÚNG theo luật ưu tiên, để đọc bảng không phải tự suy. */
const cases: { msg: string; mong: 'task' | 'lookup' | 'chat'; vi: string }[] = [
  {
    msg: 'Tìm giúp mình 5 quán cà phê làm việc được ở quận 1',
    mong: 'task',
    vi: 'có người CHUYÊN tìm tin — đúng chuyên môn của họ',
  },
  {
    msg: 'Tin tức công nghệ hôm nay có gì nổi bật?',
    mong: 'task',
    vi: 'cũng là duyệt web + đối chiếu nguồn = việc của họ',
  },
  {
    // ⚠ MONG ĐỢI CỦA TÔI SAI Ở LƯỢT ĐO ĐẦU, KHÔNG PHẢI HỆ THỐNG SAI.
    // Tôi ghi `lookup`, thực tế ra `chat` và nó trả lời đúng ngay trong ô chat.
    // `chat` là cửa RẺ NHẤT và đúng: không cần web, không cần ai. Giữ ca này lại
    // vì nó canh chuyện `lookup` mới KHÔNG được nuốt cả những câu vốn free.
    msg: 'Hôm nay thứ mấy?',
    mong: 'chat',
    vi: 'không cần web, không cần ai — cửa rẻ nhất phải thắng',
  },
  {
    msg: 'Tổng hợp giá hoa hồng của 3 shop ở quận 3 rồi ghi ra file cho mình',
    mong: 'task',
    vi: 'cần một FILE để giữ ⇒ luôn là task',
  },
];

let dung = 0;
for (const c of cases) {
  const r = await assistant.route(c.msg, false);
  const v = r.value as Record<string, unknown>;
  const got = String(v['intent']);
  const hit = got === c.mong;
  if (hit) dung++;
  const extra = got === 'lookup' ? ` paths=${JSON.stringify(v['paths'])}` : got === 'task' ? ` → ${v['scope']}` : '';
  console.log(`${hit ? '✅' : '❌'} "${c.msg.slice(0, 46)}"`);
  console.log(`     ra: ${got}${extra}   ·   mong: ${c.mong} (${c.vi})   ·   $${r.usage.costUSD.toFixed(4)}`);
  if (got === 'ask' || got === 'chat') console.log(`     say: ${String(v['say']).slice(0, 120)}`);
}

console.log(`\n⇒ ${dung}/${cases.length} đúng cửa\n`);

/**
 * ══════════ NỬA NGƯỢC CHIỀU — QUAN TRỌNG NGANG NỬA TRÊN ══════════
 *
 * Kéo luật ưu tiên quá tay thì văn phòng KHÔNG có người tra cứu sẽ đẩy mọi câu
 * vu vơ sang `task`, và người non-code lại nhận *"chưa có nhân viên phụ trách"*
 * — đúng ca đã sinh ra cả bản vá này. Hai văn phòng, cùng bộ câu hỏi.
 */
async function nguocChieu(label: string, roles: { id: string; pitch: string }[]) {
  const oid = company.createOffice({ name: label }).id;
  for (const r of roles) {
    fs.writeFileSync(
      path.join(companyDir, 'offices', oid, 'roles', `${r.id}.yaml`),
      `id: ${r.id}\nversion: 1\ndisplay_name: "${r.id}"\navatar: "•"\npitch: "${r.pitch}"\n` +
        `skill_level: medium\nskills: {}\nmodel_tier: standard\ntools: []\nmcp: []\n` +
        `budget:\n  max_turns: 8\n  max_usd: 1.0\n`,
      'utf8',
    );
  }
  const a = new Assistant(loadOffice(companyDir, loadCompanyConfig(companyDir), oid));
  console.log(`── ${label} (${roles.map((r) => r.id).join(', ') || 'KHÔNG có ai'})`);
  for (const msg of ['Tìm giúp mình 5 quán cà phê làm việc được ở quận 1', 'Tin tức công nghệ hôm nay có gì?']) {
    const r = await a.route(msg, false);
    const v = r.value as Record<string, unknown>;
    const ok = v['intent'] === 'lookup';
    console.log(`   ${ok ? '✅' : '❌'} "${msg.slice(0, 40)}" → ${v['intent']}   (mong: lookup)`);
    if (!ok) console.log(`        say: ${String(v['say'] ?? '').slice(0, 140)}`);
  }
}

await nguocChieu('Van phong rong', []);
await nguocChieu('Chi co nguoi dich', [
  { id: 'nguoi-dich', pitch: 'Dịch tài liệu Anh–Việt, giữ đúng thuật ngữ chuyên ngành.' },
]);

console.log(
  `\n⚠ Ranh giới: đây là HÀNH VI của model, không phải hàng rào. Bảng đẹp chỉ nói\n` +
    `  rằng cửa mới không nuốt cửa cũ ở những ca dễ thấy nhất.`,
);

fs.rmSync(root, { recursive: true, force: true });
console.log('↩ đã xoá công ty tạm');
