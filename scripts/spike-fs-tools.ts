
import { probeArm } from '../src/core/probe.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const r = await probeArm({ files: { command: 'npx', args: ['-y', PKG, process.cwd()] } as never });

console.log(`\nstatus=${r.status} · ${r.serverName} ${r.serverVersion} · ${r.connectMs} ms`);
console.log(`tool: ${r.tools.length}\n`);
for (const t of [...r.tools].sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name))) {
  console.log(`  ${t.level === 'read' ? '👁 read          ' : '✍ write_external'}  ${t.name}`);
}
const has = (n: string) => r.tools.some((t) => t.name.includes(n));
console.log(`\nhas a DELETE tool (delete/remove/unlink)? ${has('delete') || has('remove') || has('unlink') ? 'YES' : 'NO'}`);
