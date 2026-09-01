/**
 * SPIKE — BÊ KẾT QUẢ TO RA FILE THAY VÌ BẮT MODEL NUỐT. 📖 → ✅ hay ❌
 * → docs/SPEC-arms.md §9 · SPEC-connectors §7 (*"cắt trần response"*, viết 14/08, chưa cài)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA SINH RA NÓ (27/08): `notion-fetch` trả **64 146 ký tự** ≈ 16 000 token │
 * │ trong MỘT lời gọi — gấp **7 lần** toàn bộ schema của cánh tay Notion      │
 * │ (2 185 token/lượt). Nhân viên nuốt xong thì cạn trần lượt, đi lạc sang    │
 * │ `Grep` ổ đĩa, rồi báo *"quá nhiều bước"*.                                 │
 * │                                                                          │
 * │ 📖 `.d.ts` nói có đúng thứ ta cần, và nó **general cho MỌI tool**, không  │
 * │ riêng MCP:                                                               │
 * │                                                                          │
 * │   PostToolUseHookSpecificOutput.updatedToolOutput?: unknown               │
 * │     "Replaces the tool output **before it is sent to the model**"         │
 * │                                                                          │
 * │ ⚠⚠ NHƯNG 📖 KHÔNG PHẢI ✅. Tiền lệ đắt trong chính dự án này: `canUseTool` │
 * │ từng là 📖 *đọc rất thuyết phục* và **không nổ một lần nào** suốt sáu     │
 * │ ngày — vì `allowedTools` che nó, mà cánh tay thì LUÔN nằm trong đó.       │
 * │ Cùng cái bẫy có thể lặp lại y hệt ở đây.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * NĂM CÂU, và câu 4 giết được cả hướng:
 *
 *   Q1  `PostToolUse` có nổ cho tool MCP không?
 *   Q2  `updatedToolOutput` có THẬT SỰ thay thứ model nhìn thấy không?
 *   Q3  `tool_response` hình dạng gì? Bản thay phải đúng hình dạng nào?
 *   Q4  🔴 Bản GỐC đã bị tính vào token TRƯỚC khi hook chạy chưa?
 *       — nếu rồi thì ta chỉ giấu chữ khỏi mắt model, KHÔNG khỏi hoá đơn,
 *         và cả hướng B chết ngay tại đây.
 *   Q5  Hook có thấy nguyên 64 KB, hay bị cắt sẵn trước khi tới tay ta?
 *
 * PHÉP ĐO CỦA Q4: chạy HAI lượt giống hệt nhau, khác đúng một biến (hook có
 * thay hay không), rồi so `usage.input_tokens` của lượt cuối. Thay mà token
 * KHÔNG giảm ⇒ bản gốc đã nằm trong hoá đơn.
 *
 * ⚠ NONCE ép miss cache ở cả hai lượt — không có nó thì lượt hai đọc cache của
 * lượt một và mọi con số đều vô nghĩa. (Bài học §9b, đã trả tiền một lần.)
 *
 * Chạy:  npx tsx scripts/spike-spill.ts
 * Chi phí: ~$0.05 · KHÔNG dùng shell, đúng chủ ý: đường đọc là `Read`, không
 * phải `Bash` — hàng rào khớp `file_path` chỉ có thật khi đường đi qua trường đó.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { readOAuth } from '../dist/core/secrets.js';
import { companyPaths } from '../dist/core/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = path.join(HERE, '..', 'company');
const SAN = path.join(HERE, '..', '.state-spike', 'spill');

/** Trang đã đo 27/08: 64 146 ký tự. Dùng lại đúng nó để số so được với nhau. */
const PAGE_ID = '347cf455-8531-80fc-96a5-c9918a9d51e4';
const MCP_URL = 'https://mcp.notion.com/mcp';

/** Trần vào ngữ cảnh. 16 KB ≈ 4 000 token — con số `SPEC-connectors` §7 đã chốt. */
const CAP = 16_000;

interface Ket {
  fired: number;
  firedMcp: number;
  shape: string;
  size: number;
  inputTokens: number;
  cost: number;
  say: string;
  file?: string;
  /** Đường dẫn CLI tự cất — để đối chiếu xem model đi theo đường của ai. */
  goc?: string;
  /** Chạm trần lượt — chính triệu chứng đang đi tìm, nên nó là DỮ LIỆU. */
  hetLuot?: boolean;
  /**
   * Đường dẫn model THẬT SỰ mở. Đây là phép kiểm của Q2, và nó là phép kiểm
   * DUY NHẤT không nói dối được: model chỉ biết đường dẫn của ta nếu bản thay
   * đã thật sự tới tay nó.
   */
  doc: string[];
}

/**
 * Bóc phần chữ ra khỏi `tool_response`, KHÔNG đoán hình dạng.
 *
 * MCP trả `{content:[{type:'text',text}]}`; tool builtin trả chuỗi; và có thứ
 * trả object khác hẳn. Ba ca, một hàm — đoán nhầm hình dạng là hỏng im lặng,
 * đúng lớp lỗi đã trả tiền ở `postToken`.
 */
function chuoiCua(resp: unknown): { text: string; shape: string } {
  if (typeof resp === 'string') return { text: resp, shape: 'string' };
  if (resp && typeof resp === 'object') {
    const c = (resp as { content?: unknown[] }).content;
    if (Array.isArray(c)) {
      const text = c
        .map((b) => (b && typeof b === 'object' ? String((b as { text?: unknown }).text ?? '') : ''))
        .join('\n');
      return { text, shape: `{content:[${c.length}]}` };
    }
    return { text: JSON.stringify(resp), shape: `object{${Object.keys(resp).join(',')}}` };
  }
  return { text: String(resp), shape: typeof resp };
}

async function ca(label: string, thayThe: boolean, nonce: string): Promise<Ket> {
  console.log(`\n── ${label}`);
  fs.mkdirSync(SAN, { recursive: true });

  const acc = Object.values(readOAuth(companyPaths(COMPANY))).find((a) => !a.dead);
  if (!acc) throw new Error('Không còn tài khoản Notion nào sống — đăng nhập lại trước đã.');

  const ket: Ket = { fired: 0, firedMcp: 0, shape: '—', size: 0, inputTokens: 0, cost: 0, say: '', doc: [] };

  const q = query({
    // NONCE nằm trong prompt để ép miss cache — xem khối đầu file.
    /**
     * ⚠ CÂU HỎI PHẢI ÉP ĐỌC NỘI DUNG, không được trả lời nổi bằng tiêu đề.
     *
     * Lượt đo trước hỏi *"tiêu đề trang là gì"* và model trả lời đúng — nhưng
     * `focus-flow` nằm sẵn trong chính câu con trỏ, nên phép đo **không chứng
     * minh được nó đã mở file**. Một câu hỏi trả lời được mà không cần đi tới
     * chỗ cần đo thì không đo gì cả.
     */
    prompt:
      `[${nonce}] Dùng tool notion-fetch với id ${PAGE_ID}. ` +
      `Sau đó cho tôi biết ĐÚNG MỘT câu: trong nội dung trang đó, "Delta" được định nghĩa là gì?`,
    options: {
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Trả lời cực ngắn bằng tiếng Việt.',
      // Cố ý CÓ `Read`: nếu bản thay là một con trỏ tới file thì model phải có
      // đường đi tiếp. `BUILTIN_TOOLS` của sản phẩm cũng luôn có `Read`.
      tools: ['Read', 'Grep'],
      allowedTools: ['Read', 'Grep', 'mcp__notion'],
      mcpServers: {
        notion: { type: 'http', url: MCP_URL, headers: { Authorization: `Bearer ${acc.access_token}` } },
      },
      cwd: SAN,
      /**
       * ⚠ Lượt đo ĐẦU TIÊN chạm trần 6 — và đó không phải cấu hình sai, đó là
       * **chính triệu chứng đang đi tìm**: nuốt 64 KB xong thì model hết lượt.
       * Nới lên 12 để phép đo còn chạy tới cuối; con số trần thật của sản phẩm
       * (eco 20 · standard 15 · deep 10) là chuyện khác, bàn sau khi có số.
       */
      maxTurns: 12,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      hooks: {
        PostToolUse: [
          {
            hooks: [
              async (input: Record<string, unknown>) => {
                ket.fired++;
                const ten = String(input['tool_name'] ?? '');
                if (!ten.startsWith('mcp__')) return {};
                ket.firedMcp++;

                const { text, shape } = chuoiCua(input['tool_response']);
                ket.shape = shape;
                ket.size = Math.max(ket.size, text.length);
                /**
                 * ⚠ IN RA NGUYÊN VĂN ĐẦU CHUỖI, KHÔNG CHỈ IN ĐỘ DÀI.
                 *
                 * Lượt đo đầu cho `1 608 ký tự` và tôi suýt đọc nó thành *"hook
                 * bị đưa bản đã cắt"*. Nhưng một con số ngắn có ít nhất ba
                 * nghĩa: bị cắt · gọi nhầm tool · **server trả LỖI**. Không in
                 * nội dung thô thì cả ba trông giống hệt nhau — đúng bài học
                 * spike 1 (in trạng thái thô, đừng chỉ in kết luận).
                 */
                console.log(`   ⇢ ${ten} · ${text.length} ký tự`);
                console.log(`     ${text.replace(/\s+/g, ' ').slice(0, 400)}`);

                // Ghi nhận đường CLI cất TRƯỚC nhánh `thayThe` — nếu không thì
                // lượt đối chứng không có gì để đối chiếu, và dòng tổng kết Q5
                // in `❓` cho một thứ đã đo được. (Lần chạy 27/08 dính đúng thế.)
                ket.goc = text.match(/saved to\s+(.+?\.txt)/i)?.[1];
                if (!thayThe) return {};

                /**
                 * ┌──────────────────────────────────────────────────────────┐
                 * │ CLI ĐÃ BÊ FILE GIÙM RỒI — ta chỉ ĐỔI CHỖ và ĐỔI LỜI.     │
                 * │                                                          │
                 * │ Đo 27/08: kết quả 64 138 ký tự không hề vào ngữ cảnh.    │
                 * │ Claude Code tự cất ra `…/<session-uuid>/tool-results/` và │
                 * │ trả về một câu ngắn. Nên KHÔNG dựng trần thứ hai của ta   │
                 * │ (hai bản của cùng một luật), chỉ vá bốn chỗ nó rơi sai:  │
                 * │   ① ngoài văn phòng  ② dưới session-uuid đổi mỗi phiên    │
                 * │   ③ người dùng không thấy  ④ câu mở đầu bằng "Error:"     │
                 * │                                                          │
                 * │ ④ là chỗ đắt nhất và rẻ nhất cùng lúc: một lượt LẤY ĐƯỢC │
                 * │ dữ liệu bị mồi thành THẤT BẠI, và model đi vào chế độ cứu │
                 * │ vãn — đúng 10 lượt đi lạc của ca sáng 27/08.              │
                 * └──────────────────────────────────────────────────────────┘
                 */
                const daBe = text.match(/saved to\s+(.+?\.txt)/i)?.[1];
                if (!daBe) {
                  // CLI chưa bê ⇒ kết quả đủ nhỏ ⇒ để nguyên. KHÔNG tự bê thêm.
                  return {};
                }
                const kho = path.join(SAN, 'artifacts');
                fs.mkdirSync(kho, { recursive: true });
                const f = path.join(kho, `${ten.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`);
                fs.copyFileSync(daBe, f);
                ket.file = f;
                ket.goc = daBe;

                /**
                 * ⚠ CON TRỎ PHẢI TỰ MÔ TẢ VÀ NÓI ĐƯỢC VIỆC KẾ TIẾP.
                 * Điều kiện nằm trên chính dòng có ví dụ — một câu dặn ở đầu
                 * prompt thua một ví dụ ở đây. → [[agentco-prompt-rules-lose-to-examples]]
                 */
                const kb = Math.round(fs.statSync(f).size / 1024);
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    // ⚠ KHÔNG có chữ "Error". Lượt này THÀNH CÔNG — nó chỉ dài.
                    updatedToolOutput:
                      `Lấy dữ liệu xong. Nội dung dài ${kb} KB nên đã lưu vào thư mục làm việc:\n` +
                      `artifacts/${path.basename(f)}\n` +
                      `Dùng Read (kèm offset/limit) hoặc Grep trên chính file đó để đọc từng phần.`,
                  },
                };
              },
            ],
          },
        ],
      },
    },
  });

  /**
   * ⚠ CHẠM TRẦN LƯỢT KHÔNG ĐƯỢC LÀM MẤT PHÉP ĐO.
   *
   * SDK **ném** khi hết lượt, mà "hết lượt" chính là hiện tượng ta đang đo —
   * để nó ném ra ngoài là vứt đúng con số đáng giá nhất. Bắt lại, ghi nhận, và
   * nói ra trong kết quả.
   */
  try {
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;
    if (m['type'] === 'assistant') {
      // Ghi lại MỌI đường dẫn model mở — đây là bằng chứng của Q2.
      for (const b of ((m['message'] as { content?: unknown[] })?.content ?? []) as Record<string, unknown>[]) {
        if (b['type'] === 'tool_use' && /^(Read|Grep)$/.test(String(b['name']))) {
          const inp = b['input'] as { file_path?: string; path?: string };
          const p = inp?.file_path ?? inp?.path;
          if (p) ket.doc.push(String(p));
        }
      }
      const u = (m['message'] as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } })?.usage;
      if (u) {
        // Lượt CUỐI mang tổng ngữ cảnh — lấy giá trị lớn nhất thấy được.
        ket.inputTokens = Math.max(
          ket.inputTokens,
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        );
      }
    }
    if (m['type'] === 'result') {
      ket.cost = Number(m['total_cost_usd'] ?? 0);
      ket.say = String(m['result'] ?? '').replace(/\s+/g, ' ').slice(0, 120);
    }
  }
  } catch (e) {
    ket.say = `⚠ ${(e as Error).message.slice(0, 100)}`;
    ket.hetLuot = /maximum number of turns/i.test((e as Error).message);
  }

  console.log(`   hook nổ          ${ket.fired} lần (MCP: ${ket.firedMcp})`);
  console.log(`   tool_response    ${ket.shape} · ${ket.size.toLocaleString('vi-VN')} ký tự`);
  console.log(`   token vào        ${ket.inputTokens.toLocaleString('vi-VN')}`);
  console.log(`   giá              $${ket.cost.toFixed(4)}`);
  console.log(`   chạm trần lượt   ${ket.hetLuot ? '🔴 CÓ' : 'không'}`);
  console.log(`   model nói        ${ket.say}`);
  if (ket.file) console.log(`   đã bê ra         ${path.basename(ket.file)}`);
  return ket;
}

async function main(): Promise<void> {
  const nonce = `n${Math.floor(Date.now() / 1000)}`;

  const A = await ca('A · KHÔNG thay — đối chứng, model nuốt trọn', false, `${nonce}a`);
  const B = await ca('B · CÓ thay — bê ra file, trả con trỏ', true, `${nonce}b`);

  console.log('\n━━ KẾT LUẬN\n');
  console.log(`Q1 · PostToolUse nổ cho tool MCP?     ${A.firedMcp > 0 ? '✅ CÓ' : '🔴 KHÔNG'}`);
  console.log(`Q3 · hình dạng tool_response          ${A.shape}`);
  console.log(
    `Q5 · CLI tự bê file giùm?             ${A.goc ?? (A.size > 60_000 ? '🔴 KHÔNG — nguyên 64 KB vào ngữ cảnh' : '❓')}`,
  );

  /**
   * ⚠ PHÉP KIỂM CỦA Q2 LÀ **ĐƯỜNG DẪN MODEL MỞ**, không phải số token.
   *
   * Model chỉ biết đường dẫn của TA nếu bản thay đã thật sự tới tay nó — không
   * có cách nào nó đoán ra. Còn số token thì **không phân biệt được** hai lượt,
   * vì cả hai đều chỉ mang một câu ngắn: CLI đã cắt trước khi ta chen vào.
   */
  const theoTa = B.doc.some((p) => B.file && p.replace(/\\/g, '/').includes(path.basename(B.file)));
  const theoCli = B.doc.some((p) => B.goc && p.replace(/\\/g, '/').includes(path.basename(B.goc)));
  console.log(`Q2 · updatedToolOutput thay được?     ${theoTa ? '✅ CÓ — model mở ĐÚNG file của ta' : theoCli ? '🔴 KHÔNG — model vẫn đi theo đường của CLI' : '❓ model không mở file nào'}`);
  console.log(`     model đã mở:                     ${B.doc.map((p) => path.basename(p)).join(', ') || '(không mở gì)'}`);
  console.log(`Q4 · token — KHÔNG so được ở đây      A ${A.inputTokens.toLocaleString('vi-VN')} vs B ${B.inputTokens.toLocaleString('vi-VN')}`);
  console.log(`     (CLI đã cắt TRƯỚC hook ⇒ cả hai lượt đều không nuốt 64 KB. Câu hỏi Q4 tự tiêu.)`);
  console.log(`\nA nói: ${A.say}`);
  console.log(`B nói: ${B.say}`);
  console.log(`giá: A $${A.cost.toFixed(4)} · B $${B.cost.toFixed(4)}\n`);
}

main().catch((e) => {
  console.error(`\n🔴 ${(e as Error).message}\n`);
  process.exit(1);
});
