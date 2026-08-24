/**
 * SPIKE — VÌ SAO CẮM MỘT CÁNH TAY LÚC NÀO CŨNG MẤT ~20 GIÂY, VÀ THỈNH THOẢNG
 * TIMEOUT?
 *
 * `TEST-WALKTHROUGH` bài 11 hứa *"22,3 s lần đầu · ~4 s những lần sau"*. User
 * báo: **lần nào cũng lâu, chưa thấy lần 4 giây nào**, và thỉnh thoảng timeout
 * rồi thử lại thì được. Một trong hai vế đang sai — phải đo, không đoán.
 *
 * Tách BỐN thành phần của "20 giây" đó, mỗi cái đo riêng:
 *
 *   ① npx tự resolve gói (kể cả khi đã có trong `_npx` cache)
 *   ② node khởi động + server MCP tự khởi tạo
 *   ③ bắt tay MCP + liệt kê tool (`mcpServerStatus`)
 *   ④ chạy `node <đường dẫn dist>` THẲNG, bỏ hẳn npx  ← đây là phương án thay thế
 *
 * ⚠ Đo NHIỀU LẦN liên tiếp trong cùng một tiến trình: nếu lần 2, 3 vẫn bằng lần
 * 1 thì "lần sau nhanh hơn" là một mệnh đề SAI, không phải chuyện máy user.
 *
 * Chạy: npx tsx scripts/spike-npx-cost.ts   (0 token — chỉ tốn đĩa và thời gian)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npxcost-'));

const ms = (t: number) => `${((Date.now() - t) / 1000).toFixed(2)}s`;

/** Đo riêng chi phí của chính `npx`: khởi động rồi giết ngay khi có dấu hiệu sống. */
function timeSpawn(label: string, cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const dt = Date.now() - t0;
      try {
        p.kill();
      } catch {
        /* đã chết rồi thì thôi */
      }
      console.log(`   ${label.padEnd(46)} ${(dt / 1000).toFixed(2)}s`);
      resolve(dt);
    };
    // Server MCP stdio in một dòng lên stderr khi sẵn sàng; bất kỳ byte nào ra
    // cũng chứng minh tiến trình đã SỐNG — đó là thứ ta đang bấm giờ.
    p.stderr.on('data', finish);
    p.stdout.on('data', finish);
    p.on('error', finish);
    p.on('exit', finish);
    setTimeout(finish, 60_000);
  });
}

/** Đường dẫn `dist/index.js` trong cache `_npx`, nếu gói đã từng chạy qua npx. */
function cachedEntry(): string | undefined {
  const root = path.join(process.env['LOCALAPPDATA'] ?? os.homedir(), 'npm-cache', '_npx');
  const alt = path.join(os.homedir(), '.npm', '_npx');
  for (const base of [root, alt]) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

console.log(`\nthư mục thử: ${dir}\n`);

console.log('── ① + ② npx khởi động server (gói ĐÃ có trong _npx cache)');
await timeSpawn('lần 1', 'npx', ['-y', PKG, dir]);
await timeSpawn('lần 2', 'npx', ['-y', PKG, dir]);
await timeSpawn('lần 3', 'npx', ['-y', PKG, dir]);

const entry = cachedEntry();
console.log('\n── ④ node CHẠY THẲNG file đã cache (bỏ npx)');
if (entry) {
  console.log(`   entry: ${entry}`);
  await timeSpawn('lần 1', process.execPath, [entry, dir]);
  await timeSpawn('lần 2', process.execPath, [entry, dir]);
} else {
  console.log('   ✗ không tìm thấy trong _npx cache — bỏ qua');
}

console.log('\n── ③ ĐẦU-CUỐI qua `probeArm` (npx + bắt tay + liệt kê tool)');
for (let i = 1; i <= 3; i++) {
  const t0 = Date.now();
  const r = await probeArm({ files: { command: 'npx', args: ['-y', PKG, dir] } as never });
  console.log(`   probeArm lần ${i}: ${r.status} · ${r.tools.length} tool · ${ms(t0)} (connectMs=${r.connectMs})`);
}

if (entry) {
  console.log('\n── ③b ĐẦU-CUỐI nhưng spawn `node` thẳng');
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    const r = await probeArm({ files: { command: process.execPath, args: [entry, dir] } as never });
    console.log(`   probeArm lần ${i}: ${r.status} · ${r.tools.length} tool · ${ms(t0)} (connectMs=${r.connectMs})`);
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n↩ đã dọn');
