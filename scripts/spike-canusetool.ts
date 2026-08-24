/**
 * SPIKE — `canUseTool` CÓ NỔ CHO TOOL GHI KHÔNG? (việc §8c gọi là BẮT BUỘC)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO PHÉP ĐO NÀY CHẶN "NOTION GHI ĐƯỢC"                                │
 * │                                                                          │
 * │ Hôm nay `worker.ts` đẩy `mcp__<server>` vào **`allowedTools`**, tức       │
 * │ **tự duyệt, không hỏi ai**. Bật ghi cho Notion trên nền đó nghĩa là agent │
 * │ sửa workspace thật của người dùng mà không một hộp thoại nào — trong khi  │
 * │ 3/28 tool của Notion khai `destructive`.                                  │
 * │                                                                          │
 * │ `SPEC-tools-approval` §8c thiết kế tầng 2 trên `canUseTool`. Nhưng nó mở  │
 * │ đầu bằng một khối cảnh báo đỏ: phép đo 19/08 cho thấy `canUseTool`        │
 * │ **KHÔNG NỔ MỘT LẦN NÀO** — và ghi rõ ranh giới: *chỉ đo với `Grep`/`Glob`,│
 * │ tức tool CHỈ-ĐỌC*, còn tool GHI thì **chưa đo**. Rồi §8c kết:            │
 * │                                                                          │
 * │   *"Việc bắt buộc trước khi xây: một spike 10 phút… Nếu không nổ thì cả   │
 * │    tầng 2 phải thiết kế lại."*                                            │
 * │                                                                          │
 * │ Spike đó chưa ai chạy. Đây là nó.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ BIẾN THẬT SỰ ĐANG ĐO không phải "tool đọc hay ghi" mà là **có nằm trong
 * `allowedTools` hay không**. Đo 24/08 (`worker.ts` §107) đã cho thấy: KHÔNG
 * nằm trong đó ⇒ SDK trả thẳng *"you haven't granted it yet"* ⇒ **deny**. Nhưng
 * lần đo ấy **không hề truyền `canUseTool`**. Câu chưa ai hỏi là: truyền vào thì
 * nó có chen được vào đúng khe đó không?
 *
 * Bốn ca, một biến mỗi lần:
 *   A  mcp trong allowedTools, KHÔNG canUseTool   → đối chứng: tool phải chạy
 *   B  mcp trong allowedTools, CÓ canUseTool      → §8c dòng 729 nói: KHÔNG nổ
 *   C  mcp NGOÀI allowedTools, CÓ canUseTool      → ⭐ CÂU HỎI CHÍNH
 *   D  builtin `Write` ngoài allowedTools, CÓ cb  → tầng 2 có dùng được cho
 *                                                    tool builtin ghi không
 *
 * Chạy: npx tsx scripts/spike-canusetool.ts   (~$0,02 · 4 lượt haiku)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

const office = fs.mkdtempSync(path.join(os.tmpdir(), 'canuse-'));
fs.writeFileSync(path.join(office, 'ghi-chu.txt'), 'ban dau\n');

const FILES: McpServerConfig = { command: 'npx', args: ['-y', PKG, office] };

/** Bộ builtin nền — giống `probe.ts §BASE_TOOLS` để số so sánh được. */
const BASE = ['Read', 'Glob', 'Grep'];

interface Ca {
  label: string;
  /** Tool nào được TỰ DUYỆT. Thứ không nằm đây mới có cửa rơi xuống `canUseTool`. */
  allow: string[];
  /** Có truyền callback không, và nó trả gì. */
  cb?: 'allow' | 'deny';
  /** Dùng tool MCP hay builtin `Write`. */
  via: 'mcp' | 'builtin';
}

async function chay(ca: Ca) {
  console.log(`\n── ${ca.label}`);
  const fired: string[] = [];
  const calls: string[] = [];
  let ketQua = '';

  const q = query({
    prompt:
      ca.via === 'mcp'
        ? `Dùng tool của kết nối "files" để ghi chuỗi "DA GHI" đè lên file ghi-chu.txt trong thư mục "${office}". Chỉ làm đúng việc đó.`
        : `Ghi chuỗi "DA GHI" đè lên file "${path.join(office, 'ghi-chu.txt')}". Chỉ làm đúng việc đó.`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Trả lời cực ngắn bằng tiếng Việt.',
      // `tools` GIỚI HẠN tool builtin nào tồn tại; `allowedTools` quyết định cái
      // nào được tự duyệt. Hai thứ khác nhau — xem worker.ts §257.
      tools: ca.via === 'builtin' ? [...BASE, 'Write'] : BASE,
      allowedTools: ca.allow,
      /**
       * ⚠ Ca builtin KHÔNG được cắm MCP. Lần chạy đầu (25/08) có cắm, và model
       * lờ `Write` đi để dùng `mcp__files__write_file` — nên ca D đo lại đúng
       * cái ca C vừa đo, và bảng kết quả trông như đã trả lời một câu chưa hỏi.
       * Cùng lớp lỗi với `--no-browser` hôm 24/08: phép thử đi vòng qua đúng
       * nhánh nó sinh ra để kiểm.
       */
      ...(ca.via === 'mcp' ? { mcpServers: { files: FILES } } : {}),
      cwd: office,
      maxTurns: 3,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(ca.cb
        ? {
            canUseTool: async (toolName: string, input: Record<string, unknown>) => {
              fired.push(toolName);
              return ca.cb === 'allow'
                ? ({ behavior: 'allow', updatedInput: input } as never)
                : ({ behavior: 'deny', message: 'TỪ CHỐI THỬ — callback đã nổ.' } as never);
            },
          }
        : {}),
    },
  });

  try {
    for await (const msg of q) {
      const m = msg as Record<string, unknown>;
      if (m['type'] === 'assistant') {
        for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
          if (b['type'] === 'tool_use') calls.push(String(b['name']));
        }
      }
      if (m['type'] === 'user') {
        for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
          if (b['type'] === 'tool_result') {
            ketQua = JSON.stringify(b['content']).replace(/\s+/g, ' ').slice(0, 160);
          }
        }
      }
    }
  } catch (e) {
    ketQua = `⟨ném⟩ ${(e as Error).message.slice(0, 120)}`;
  }

  // ĐỌC ĐĨA, không tin lời model kể. Bốn lần trong dự án này model đã kể một
  // đằng còn hệ thống làm một nẻo (§5r). File là sự thật duy nhất ở đây.
  const tren_dia = fs.readFileSync(path.join(office, 'ghi-chu.txt'), 'utf8').trim();
  fs.writeFileSync(path.join(office, 'ghi-chu.txt'), 'ban dau\n'); // trả về mốc

  console.log(`   tool model gọi : ${calls.join(', ') || '(không)'}`);
  console.log(`   canUseTool nổ  : ${fired.length ? `✅ ${fired.length} lần → ${fired.join(', ')}` : '❌ KHÔNG'}`);
  console.log(`   kết quả tool   : ${ketQua || '(không có)'}`);
  console.log(`   FILE TRÊN ĐĨA  : "${tren_dia}" ${tren_dia === 'DA GHI' ? '⇒ ĐÃ GHI THẬT' : '⇒ không đổi'}`);
}

const CA: Ca[] = [
  { label: 'A · mcp TRONG allowedTools · KHÔNG callback  (đối chứng)', allow: [...BASE, 'mcp__files'], via: 'mcp' },
  { label: 'B · mcp TRONG allowedTools · CÓ callback',                 allow: [...BASE, 'mcp__files'], cb: 'allow', via: 'mcp' },
  { label: 'C · mcp NGOÀI allowedTools · CÓ callback   ⭐',            allow: BASE,                    cb: 'allow', via: 'mcp' },
  { label: 'D · builtin Write NGOÀI allowedTools · CÓ callback',       allow: BASE,                    cb: 'allow', via: 'builtin' },
  // ⭐ Ca E là nửa còn lại của tầng 2: người dùng bấm **Thôi**. §8c hứa rằng
  // `deny` + `message` quay về cho agent như một kết quả tool, để nó *"biết vì
  // sao bị từ chối và tự xoay xở, thay vì fail cụt"*. Lời hứa đó chưa ai kiểm —
  // và nếu sai thì hộp thoại duyệt có nút Thôi mà bấm vào thì agent treo.
  { label: 'E · mcp NGOÀI allowedTools · callback TỪ CHỐI  ⭐',        allow: BASE,                    cb: 'deny',  via: 'mcp' },
];

const chi = process.argv.slice(2).map((s) => s.toUpperCase());
for (const ca of CA) if (!chi.length || chi.includes(ca.label[0]!)) await chay(ca);

fs.rmSync(office, { recursive: true, force: true });
console.log('\n↩ đã dọn');
