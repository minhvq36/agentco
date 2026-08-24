/**
 * SPIKE — CÁNH TAY CÓ ĐO ĐƯỢC FILE **ngoài** ALLOWLIST KHÔNG? (user đặt 24/08)
 *
 * Ca thật, `P-260824-1850-7u3q`: hỏi *"danh sách thư mục, file, và kích thước
 * trong D:\Works\Profile_Vu Quoc Minh"* — một thư mục **không** cánh tay nào
 * khai. Nhật ký hiện `Programs Installation 2 · get file info → CV_VU QUOC
 * MINH.pdf`, và artifact trả về **kích thước ĐÚNG TỚI 0,1 KB cả ba file**
 * (411,7 · 425 · 171,7 KB — đối chiếu `Get-ChildItem`: khớp tuyệt đối).
 *
 * Con số đúng tuyệt đối thì KHÔNG phải model đoán. Nên chỉ còn hai khả năng, và
 * chúng cách nhau rất xa:
 *
 *   ① MCP `get_file_info` **thành công** ⇒ allowlist thư mục **KHÔNG có hiệu
 *      lực**, và cả §1d (*"MCP filesystem có allowlist"*) mất tiền đề.
 *   ② MCP bị từ chối, kích thước đến từ **builtin** (`Read`/`Glob`) ⇒ allowlist
 *      còn nguyên, và đây chỉ là §14 câu mở #1 (`Read` trần không hàng rào)
 *      hiện ra một lần nữa.
 *
 * ⚠ Đây là câu hỏi TẤT ĐỊNH: hỏi thẳng server, đọc NGUYÊN VĂN `tool_result`.
 *   Không hỏi model xem nó nghĩ gì.
 *
 * Cắm đúng cấu hình thật trong `company.yaml`, qua đúng `fastLaunch` mà
 * `pickMcp` dùng, và đặt `cwd` = thư mục văn phòng thật — vì `spike-mcp-roots`
 * đã cho thấy `cwd` là một biến có thật với server này.
 *
 * Chạy: npx tsx scripts/spike-arm-outside.ts   (~$0,02)
 */

import fs from 'node:fs';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import { fastLaunch } from '../src/core/armexec.js';
import { folderRoots } from '../src/core/catalog.js';
import { loadCompanyConfig } from '../src/core/config.js';

const companyDir = path.resolve('company');
const officeDir = path.join(companyDir, 'offices', 'canh-tay');

/** Cánh tay "Programs Installation" — đúng cái nhật ký nói đã gọi. */
const ARM = 'a385afc3ab6';
/** Thư mục KHÔNG cánh tay nào khai, và là thứ ca thật đã đo được. */
const OUTSIDE = 'D:\\Works\\Profile_Vu Quoc Minh\\CV_VU QUOC MINH.pdf';

const cfg = loadCompanyConfig(companyDir);
const declared = cfg.mcpServers[ARM] as Record<string, unknown> | undefined;
if (!declared) throw new Error(`Không thấy cánh tay ${ARM} trong company.yaml`);

const launched = fastLaunch(declared as never) as McpServerConfig;
console.log(`\ncánh tay  : ${cfg.arms[ARM]?.label ?? ARM}`);
console.log(`khai      : ${JSON.stringify((declared as { args?: unknown }).args)}`);
console.log(`chạy thật : ${JSON.stringify((launched as { args?: unknown }).args)}`);
console.log(`cwd       : ${officeDir}`);
console.log(`hỏi về    : ${OUTSIDE}\n`);

/**
 * ⚠ `additionalDirectories` PHẢI CÓ, và việc quên nó đã suýt sinh ra một kết
 * luận sai hoàn chỉnh ở lần chạy đầu: thiếu nó thì `list_allowed_directories`
 * chỉ trả `cwd`, và bảng đọc ra *"allowlist không có hiệu lực"* — trong khi
 * thứ hỏng là **phép đo**, không phải hệ thống. Đúng cái bẫy `worker.ts` §②
 * đã ghi và ĐÃ VÁ từ 24/08. ⇒ [[agentco-measurement-vs-conclusion]]
 */
const armDirs = folderRoots(launched).filter((d) => {
  try {
    return fs.statSync(d).isDirectory();
  } catch {
    // ⚠ Bản đầu gọi `require('node:fs')` ở đây — ESM không có `require`, nên nó
    // NÉM, `catch` nuốt, và MỌI thư mục bị loại: `additionalDirectories` ra rỗng
    // mà không một dòng lỗi nào. Đúng ca [[agentco-catch-hides-premises]], lần
    // này trong chính dụng cụ đo.
    return false;
  }
});
console.log(`additionalDirectories: ${JSON.stringify(armDirs)}\n`);

async function ask(label: string, prompt: string, useArm: boolean) {
  console.log(`── ${label}`);
  const q = query({
    prompt,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Gọi tool theo yêu cầu. Trả lời cực ngắn.',
      tools: useArm ? [] : ['Read', 'Glob'],
      allowedTools: useArm ? [`mcp__${ARM}`] : ['Read', 'Glob'],
      ...(useArm ? { mcpServers: { [ARM]: launched }, additionalDirectories: armDirs } : {}),
      cwd: officeDir,
      maxTurns: 4,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });
  let said = '';
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;
    if (m['type'] === 'result') said = String(m['result'] ?? '');
    if (m['type'] !== 'user') continue;
    const content = (m['message'] as { content?: unknown[] })?.content ?? [];
    for (const b of content as Record<string, unknown>[]) {
      if (b['type'] === 'tool_result') console.log(`   ⇒ ${JSON.stringify(b['content']).slice(0, 420)}`);
    }
  }
  console.log(`   nói: ${said.slice(0, 200)}\n`);
}

await ask(
  'A · CÁNH TAY, đúng cấu hình worker thật',
  `Làm đúng hai việc: 1) gọi list_allowed_directories. 2) gọi get_file_info với path = "${OUTSIDE}".`,
  true,
);
await ask(
  'B · BUILTIN, không có cánh tay nào — "đo bằng gì" nằm ở đây',
  `Cho biết KÍCH THƯỚC chính xác (byte hoặc KB) của file "${OUTSIDE}". Chỉ dùng Read/Glob.`,
  false,
);

console.log(
  `CÁCH ĐỌC:\n` +
    `  A · get_file_info trả SIZE   ⇒ allowlist thủng — §1d mất tiền đề\n` +
    `  A · get_file_info bị TỪ CHỐI ⇒ allowlist còn nguyên\n` +
    `  B · ra ĐÚNG số               ⇒ builtin đo được kích thước ⇒ §14 #1 rộng hơn ta tưởng\n` +
    `  B · không ra / sai số        ⇒ kích thước ở ca thật đến từ chỗ khác, phải truy tiếp\n`,
);
