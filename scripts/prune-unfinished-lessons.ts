/**
 * DỌN NGƯỢC BÁNH CÓC — bỏ những bài học sinh ra từ ca KHÔNG ĐI ĐẾN ĐÍCH.
 * → `assistant.ts §learnable` · SESSIONS_MEMORY §"BÁNH CÓC KINH NGHIỆM"
 *
 * Cổng mới (29/08) chỉ chặn từ nay về sau. Kho hiện có đã tích sẵn những mẩu mà
 * cổng ấy lẽ ra đã chặn — và chín trong số đó đang làm cánh tay "Trình duyệt
 * web" ngừng chạy. Script này áp **đúng cùng một luật** lên kho cũ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHÔNG GÕ TAY DANH SÁCH. Mỗi node ghi `source: <plan_id>`, và biên nhận   │
 * │ của kế hoạch đó còn nằm trong `.state/tasks/`. Nên câu hỏi *"ca này có    │
 * │ đi đến đích không"* trả lời được bằng **dữ liệu**, y hệt cách cổng mới    │
 * │ trả lời nó lúc chạy. Gõ tay thì danh sách đúng một lần rồi thành sai.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ ĐI QUA API CỦA DAEMON nếu daemon đang chạy. Xoá file dưới chân một daemon
 * đang giữ index trong RAM thì đĩa và bộ nhớ lệch nhau, và nó sẽ tiếp tục nạp
 * mẩu đã xoá vào prompt cho tới lần quét sau — đúng kiểu hỏng im lặng.
 *
 * ⚠ KHÔNG đụng node GHI NHỚ của Trợ lý (`source: compact`): thẩm quyền của nó
 * đến từ NGƯỜI DÙNG, không từ kết quả một ca.
 * ⚠ KHÔNG đụng node của vai trò (`source: T-01`): chúng không ghi lại kế hoạch
 * nào đã đẻ ra chúng, nên KHÔNG CÓ DỮ LIỆU để phán — script báo ra, không đoán.
 *
 * Chạy:  npx tsx scripts/prune-unfinished-lessons.ts <office-id> [--apply]
 * Không có `--apply` thì chỉ in ra, không xoá gì.
 */

import fs from 'node:fs';
import path from 'node:path';

import { agentFault } from '../src/core/assistant.js';
import { loadCompanyConfig } from '../src/core/config.js';
import { companyPaths, officePaths } from '../src/core/paths.js';

const companyDir = path.resolve('company');
const officeId = process.argv[2];
if (!officeId) throw new Error('thiếu <office-id>, ví dụ: canh-tay');
const apply = process.argv.includes('--apply');

const oPaths = officePaths(path.join(companyPaths(companyDir).offices, officeId));

/** `learnable` của `assistant.ts`, áp lên biên nhận đọc từ đĩa. */
const learnableReceipt = (r: Record<string, unknown>): boolean =>
  r['status'] === 'done' && agentFault(r as never);

/**
 * Kế hoạch này còn được giữ bài học không — BA kết quả, và vế thứ hai là vế dễ
 * đánh rơi nhất:
 *
 *   'yes'      có việc ĐI ĐẾN ĐÍCH mà có vấp  → `learnable`
 *   'friction' MỌI việc đều `done` và SẠCH    → `worthLearning` nhánh ma sát
 *   'no'       còn lại
 *
 * ⚠ `friction` không nằm trên đĩa (nó ở RAM, theo mạch hội thoại), nên không
 * đọc thẳng được. Nhưng suy ra được **chắc chắn**: một ca sạch bong mà vẫn có
 * bài học thì cửa duy nhất nó lọt qua là nhánh ma sát. Bỏ vế này là xoá nhầm
 * đúng cái LỚP bài học học được từ chính người dùng — thứ đắt nhất trong kho,
 * và là thứ luật 29/08 cố ý KHÔNG đụng tới.
 */
function planLearnable(planId: string): 'yes' | 'friction' | 'no' | 'unknown' {
  let files: string[];
  try {
    files = fs.readdirSync(oPaths.tasks).filter((f) => f.startsWith(`${planId}.`) && f.endsWith('.receipt.json'));
  } catch {
    return 'unknown';
  }
  if (!files.length) return 'unknown'; // biên nhận đã bị dọn — không có dữ liệu để phán
  const rs: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      rs.push(JSON.parse(fs.readFileSync(path.join(oPaths.tasks, f), 'utf8')));
    } catch {
      return 'unknown'; // biên nhận hỏng ⇒ không đủ dữ kiện, và "không biết" thì KHÔNG xoá
    }
  }
  if (rs.some(learnableReceipt)) return 'yes';
  if (rs.every((r) => r['status'] === 'done' && !agentFault(r as never))) return 'friction';
  return 'no';
}

const front = (raw: string, key: string): string =>
  new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(raw)?.[1]?.trim() ?? '';

interface Row {
  id: string;
  file: string;
  source: string;
  verdict: 'yes' | 'friction' | 'no' | 'unknown' | 'memory' | 'role';
  title: string;
}

const rows: Row[] = [];
function walk(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.isFile() && e.name.endsWith('.md')) {
      const raw = fs.readFileSync(abs, 'utf8');
      const id = front(raw, 'id');
      const source = front(raw, 'source');
      if (!id) continue;
      const verdict: Row['verdict'] = !source
        ? 'unknown'
        : source === 'compact'
          ? 'memory'
          : source.startsWith('P-')
            ? planLearnable(source)
            : 'role';
      rows.push({ id, file: abs, source, verdict, title: front(raw, 'title') });
    }
  }
}
walk(oPaths.knowledge);

const drop = rows.filter((r) => r.verdict === 'no');
const keep = rows.filter((r) => r.verdict === 'yes');
const fric = rows.filter((r) => r.verdict === 'friction');
const skip = rows.filter((r) => r.verdict === 'role' || r.verdict === 'memory' || r.verdict === 'unknown');

const say = (label: string, rs: Row[]) => {
  console.log(`\n${label} (${rs.length})`);
  for (const r of rs) console.log(`  ${r.source.padEnd(19)} ${r.title.slice(0, 62)}`);
};
say('✅ GIỮ — ca có việc đi đến đích mà có vấp', keep);
say('✅ GIỮ — nhánh MA SÁT: ca sạch bong, bài học là về cách giao việc', fric);
say('⏭ KHÔNG PHÁN — ghi nhớ của người dùng / bài học vai trò (không ghi plan_id)', skip);
say('🔴 BỎ — sinh ra từ ca KHÔNG đi đến đích', drop);

if (!apply) {
  console.log(`\n(chạy thử — chưa xoá gì. Thêm --apply để xoá ${drop.length} mẩu.)\n`);
  process.exit(0);
}

const daemonFile = companyPaths(companyDir).daemonFile;
const base = fs.existsSync(daemonFile)
  ? (JSON.parse(fs.readFileSync(daemonFile, 'utf8')) as { url?: string }).url
  : undefined;

if (!base) {
  throw new Error(
    'Không thấy daemon.json. Script này cố ý KHÔNG xoá thẳng trên đĩa: daemon giữ index ' +
      'trong RAM, xoá dưới chân nó thì đĩa và bộ nhớ lệch nhau. Khởi động daemon rồi chạy lại.',
  );
}

let done = 0;
for (const r of drop) {
  const res = await fetch(`${base}/api/office/${encodeURIComponent(officeId)}/knowledge`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: r.id, remove: true }),
  });
  if (!res.ok) {
    console.log(`  ✗ ${r.id}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    continue;
  }
  done++;
}
console.log(`\nĐã xoá ${done}/${drop.length} mẩu qua API của daemon (${base}).\n`);
