/**
 * Liệt kê ĐẦY ĐỦ 14 tool của `server-filesystem` kèm mức duyệt suy từ annotations.
 *
 * Sinh ra từ đúng một câu hỏi của user: *"cắm cánh tay này thì có quyền ghi,
 * remove… không?"*. Trả lời bằng DANH SÁCH THẬT chứ không bằng trí nhớ — tool
 * nào không có trong danh sách thì cánh tay này KHÔNG làm được, dù nghe hợp lý.
 *
 * Chạy: npx tsx scripts/spike-fs-tools.ts   (0 token, chỉ tốn đĩa + thời gian)
 */

import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const r = await probeArm({ files: { command: 'npx', args: ['-y', PKG, process.cwd()] } as never });

console.log(`\nstatus=${r.status} · ${r.serverName} ${r.serverVersion} · ${r.connectMs} ms`);
console.log(`tool: ${r.tools.length}\n`);
for (const t of [...r.tools].sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name))) {
  console.log(`  ${t.level === 'read' ? '👁 read          ' : '✍ write_external'}  ${t.name}`);
}
const has = (n: string) => r.tools.some((t) => t.name.includes(n));
console.log(`\ncó tool XOÁ (delete/remove/unlink)? ${has('delete') || has('remove') || has('unlink') ? 'CÓ' : 'KHÔNG'}`);
