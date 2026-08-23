/**
 * SPIKE 1 + 2 — docs/SPEC-arms.md §3 · §7 · §8 · §9 · §12
 *
 * Cả §3 của SPEC-arms đang là 📖 (đọc từ `.d.ts`, chưa chạy lần nào). Script này
 * biến ba dòng của bảng đó thành ✅ hoặc bác bỏ chúng.
 *
 *   SPIKE 1 · `mcpServerStatus()` có trả `tools[]` kèm `annotations` không?
 *             → nguồn cho DÒNG NĂNG LỰC (§7) và cho MỨC DUYỆT (§8a).
 *             Cả hai thiết kế sụp cùng lúc nếu nó rỗng.
 *
 *   SPIKE 2 · Tool của MCP có nằm trong PREFIX ĐƯỢC CACHE không?
 *             → câu hỏi CHẶN của §9b. Nếu có, cắm 3 MCP có thể vượt cả 2 688
 *             token của shell cộng lại, và quyết định "không lấy `ToolSearch`"
 *             (§5c) phải mở lại BẰNG SỐ ĐO.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI BẪY ĐO ĐÃ TRẢ TIỀN, ĐỪNG DẪM LẠI                                     │
 * │                                                                          │
 * │ ① CONTROL REQUEST CHỈ CHẠY KHI CLI RẢNH (§5n ⑤ — đo hỏng 4/4 lần rồi     │
 * │   mới hiểu). Nên phải mở query bằng một generator GIỮ STREAM MỞ mà KHÔNG │
 * │   gửi tin nào, và vẫn phải TIÊU THỤ luồng để phản hồi được bơm ra.       │
 * │   Khuôn chuẩn nằm ở `core/energy.ts §refresh` — chép đúng, đừng chế.     │
 * │                                                                          │
 * │ ② LẦN ĐO THỨ HAI ĂN CACHE CỦA LẦN MỘT và cho ra chênh lệch 0 (§5n ⑬).    │
 * │   Phải cắm NONCE vào system prompt để ép miss cả hai lần. Không có nonce │
 * │   thì script này sẽ báo "MCP tốn 0 token" một cách rất thuyết phục.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npx tsx scripts/spike-mcp.ts [--paid]
 *   không cờ  → chỉ SPIKE 1 + phần MIỄN PHÍ của SPIKE 2 (`getContextUsage`)
 *   --paid    → chạy thêm 2 lượt thật để đối chiếu hoá đơn (~$0,02)
 */

import { query, type McpServerConfig, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const PAID = process.argv.includes('--paid');

/** 7 tool văn phòng — đúng bộ `effectiveTools([])` gửi xuống cho một vai trò trần. */
const OFFICE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

/**
 * Cánh tay đo thử = mục danh mục #1 (`SPEC-arms.md` §4e). Chọn nó chứ không
 * chọn một server bất kỳ vì nó là thứ SẼ ship: số đo phải nói về hàng thật.
 */
const FILES: McpServerConfig = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
};

/** Khuôn ĐÚNG để hỏi CLI lúc nó rảnh. → `core/energy.ts §refresh` */
async function probe<T>(
  label: string,
  mcpServers: Record<string, McpServerConfig> | undefined,
  ask: (q: Awaited<ReturnType<typeof query>>) => Promise<T>,
): Promise<T | undefined> {
  let release: (() => void) | undefined;
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      tools: OFFICE_TOOLS,
      allowedTools: OFFICE_TOOLS,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      ...(mcpServers ? { mcpServers } : {}),
    },
  });

  // Phải TIÊU THỤ luồng, nếu không phản hồi control không được bơm ra.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* chỉ cần luồng chảy */
      }
    } catch {
      /* đóng giữa chừng thì SDK ném — đúng thiết kế */
    }
  })();

  try {
    return await Promise.race([
      ask(q),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('quá hạn 30s')), 30_000)),
    ]);
  } catch (e) {
    console.log(`   ✗ ${label}: ${(e as Error).message}`);
    return undefined;
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
}

// ══════════════════════════════════════════════════ SPIKE 1 · mcpServerStatus

console.log('\n═══ SPIKE 1 · mcpServerStatus() — §7 và §8a cùng phụ thuộc vào nó ═══\n');
console.log('   cắm: npx -y @modelcontextprotocol/server-filesystem (lần đầu sẽ tải, hơi lâu)\n');

/**
 * ⚠ PHẢI CHỜ, và lần đo đầu đã dẫm đúng bẫy này: hỏi ngay thì nhận
 * `status=pending · tools: 0`, và kết luận "annotations không tồn tại" — trong
 * khi thứ đo được chỉ là THỜI ĐIỂM HỎI. `.d.ts` nói thẳng: *"MCP startup is
 * otherwise non-blocking by default"*.
 *
 * ⇒ Hỏi lại tới khi rời `pending`. Một phép đo trên trạng thái quá độ không
 * chứng minh được gì về API. [[agentco-measurement-vs-conclusion]]
 */
const status = await probe('mcpServerStatus', { files: FILES }, async (q) => {
  for (let i = 0; i < 40; i++) {
    const s = await q.mcpServerStatus();
    if (s.length && s.every((x) => x.status !== 'pending')) {
      if (i) console.log(`   (chờ ${i * 500}ms mới rời pending)`);
      return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('   ⚠ vẫn pending sau 20s');
  return q.mcpServerStatus();
});

let annotated = 0;
let toolCount = 0;

if (!status || status.length === 0) {
  console.log('   ✗ KHÔNG có server nào trả về. §7 và §8a đều mất nguồn.');
} else {
  for (const s of status) {
    console.log(`   server "${s.name}"  status=${s.status}`);
    if (s.serverInfo) console.log(`      serverInfo: ${s.serverInfo.name} v${s.serverInfo.version}`);
    if (s.error) console.log(`      error: ${s.error}`);
    const tools = s.tools ?? [];
    toolCount = tools.length;
    console.log(`      tools: ${tools.length}`);
    for (const t of tools) {
      const a = t.annotations;
      if (a && (a.readOnly !== undefined || a.destructive !== undefined || a.openWorld !== undefined)) {
        annotated++;
      }
      const flags = a
        ? `readOnly=${a.readOnly ?? '—'} destructive=${a.destructive ?? '—'} openWorld=${a.openWorld ?? '—'}`
        : '(KHÔNG có annotations)';
      console.log(`        · ${t.name.padEnd(28)} ${flags}`);
    }
  }
}

// ══════════════════════════════════════════════════ SPIKE 2a · getContextUsage

console.log('\n═══ SPIKE 2a · getContextUsage() — MIỄN PHÍ, và nó trả lời câu CHẶN §9b ═══\n');

interface Ctx {
  categories: { name: string; tokens: number; isDeferred?: boolean }[];
  mcpTools: { name: string; serverName: string; tokens: number; isLoaded?: boolean }[];
  systemTools?: { name: string; tokens: number }[];
  totalTokens: number;
}

async function ctx(label: string, servers?: Record<string, McpServerConfig>) {
  const r = (await probe(label, servers, async (q) => {
    // Cùng lý do như SPIKE 1: hỏi trước khi server bắt tay xong thì `mcpTools`
    // rỗng, và "rỗng" ở đây KHÔNG phân biệt được ba chuyện khác hẳn nhau —
    // *chưa kết nối* · *đã hoãn* · *không tốn gì*. Chờ cho hết chuyện thứ nhất.
    if (servers) {
      for (let i = 0; i < 40; i++) {
        const s = await q.mcpServerStatus();
        if (s.length && s.every((x) => x.status !== 'pending')) break;
        await new Promise((r2) => setTimeout(r2, 500));
      }
    }
    return q.getContextUsage();
  })) as Ctx | undefined;
  if (!r) return undefined;
  const mcpTokens = r.mcpTools.reduce((n, t) => n + t.tokens, 0);
  const loaded = r.mcpTools.filter((t) => t.isLoaded !== false).length;
  console.log(`   [${label}]  total=${r.totalTokens}  mcpTools=${r.mcpTools.length} (nạp ${loaded}) = ${mcpTokens} token`);
  for (const c of r.categories) {
    if (c.tokens > 0) console.log(`      ${c.name.padEnd(24)} ${String(c.tokens).padStart(7)}${c.isDeferred ? '   (HOÃN)' : ''}`);
  }
  return { total: r.totalTokens, mcpTokens, count: r.mcpTools.length, loaded };
}

const bare = await ctx('không MCP');
console.log('');
const withMcp = await ctx('có MCP files', { files: FILES });
console.log('');
/**
 * Điều kiện thứ BA, và nó là thứ duy nhất phân biệt được hai lời giải thích
 * cho một con số 0: *"tool bị HOÃN"* vs *"tool không được nạp"*. 📖 `.d.ts`:
 * `alwaysLoad` = *"never deferred behind tool search"*, và nó **chặn khởi động
 * tới khi server nối xong** — tức là nó cũng loại luôn ca "hỏi quá sớm".
 */
const forced = await ctx('có MCP files · alwaysLoad', { files: { ...FILES, alwaysLoad: true } });

// ══════════════════════════════════════════════════ SPIKE 2b · hoá đơn thật

let paidDelta: number | undefined;

if (PAID) {
  console.log('\n═══ SPIKE 2b · HOÁ ĐƠN THẬT — 2 lượt, nonce phá cache ═══\n');

  async function billed(label: string, servers?: Record<string, McpServerConfig>) {
    // ⚠ NONCE trong system prompt. Không có nó thì lượt hai ăn cache lượt một và
    // chênh lệch ra 0 — đúng cái bẫy đã làm sai con số "Bash chỉ thêm 1 token".
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg = {
      type: 'user',
      message: { role: 'user', content: 'Trả lời đúng một chữ: xong' },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage;

    const q = query({
      prompt: (async function* () {
        yield msg;
      })(),
      options: {
        systemPrompt: `Bạn là trợ lý kiểm thử. [nonce ${nonce}]`,
        model: 'claude-haiku-4-5-20251001',
        tools: OFFICE_TOOLS,
        allowedTools: OFFICE_TOOLS,
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        strictMcpConfig: true,
        ...(servers ? { mcpServers: servers } : {}),
      },
    });

    let write = 0;
    let read = 0;
    let cost = 0;
    for await (const m of q as AsyncGenerator<Record<string, unknown>>) {
      if (m['type'] !== 'result') continue;
      const mu = (m['modelUsage'] ?? {}) as Record<string, Record<string, number>>;
      for (const v of Object.values(mu)) {
        write += v['cacheCreationInputTokens'] ?? 0;
        read += v['cacheReadInputTokens'] ?? 0;
      }
      cost = typeof m['total_cost_usd'] === 'number' ? m['total_cost_usd'] : 0;
    }
    console.log(`   [${label}]  cache_write=${write}  cache_read=${read}  $${cost.toFixed(5)}`);
    if (read > 0) console.log('      ⚠ cache_read > 0 ⇒ NONCE KHÔNG PHÁ ĐƯỢC CACHE. Số dưới đây vô nghĩa.');
    return write;
  }

  /**
   * ⚠ `alwaysLoad: true` ở ĐÂY không phải để đo cơ chế hoãn (2a đã đo: không có
   * hoãn). Nó để **loại một cuộc đua**: 📖 `.d.ts` nói MCP khởi động KHÔNG chặn
   * theo mặc định, nên lượt-1 có thể được dựng TRƯỚC khi server nối xong ⇒ ta sẽ
   * đo một prefix không có tool và kết luận "MCP miễn phí".
   *
   * `alwaysLoad` chặn khởi động tới khi nối xong, *"since the tools must be
   * present when the turn-1 prompt is built"*. 2a đã chứng minh nó không đổi số,
   * nên dùng nó ở đây là loại nhiễu chứ không đổi thứ đang đo.
   */
  const w0 = await billed('không MCP');
  const w1 = await billed('có MCP files', { files: { ...FILES, alwaysLoad: true } });
  paidDelta = w1 - w0;
}

// ══════════════════════════════════════════════════ KẾT LUẬN

console.log('\n─── KẾT LUẬN ───\n');

console.log(`SPIKE 1 · tools[] có nội dung        ${toolCount > 0 ? `✅ CÓ — ${toolCount} tool` : '❌ KHÔNG'}`);
console.log(
  `SPIKE 1 · annotations có nội dung     ${
    annotated > 0 ? `✅ CÓ — ${annotated}/${toolCount} tool` : '❌ KHÔNG — §8a mất nguồn, phải mặc định write_external hết'
  }`,
);

if (bare && withMcp && forced) {
  const d1 = withMcp.total - bare.total;
  const d2 = forced.total - bare.total;
  console.log(`\nSPIKE 2a · prefix không MCP           ${bare.total}`);
  console.log(`SPIKE 2a · prefix có MCP (mặc định)   ${withMcp.total}   (${d1 >= 0 ? '+' : ''}${d1})`);
  console.log(`SPIKE 2a · prefix có MCP · alwaysLoad ${forced.total}   (${d2 >= 0 ? '+' : ''}${d2})`);
  console.log(
    `\nSPIKE 2a · MẶC ĐỊNH có hoãn tool không?\n` +
      `   ${
        d1 === 0 && d2 > 0
          ? '✅ CÓ HOÃN — mặc định 0 token, alwaysLoad mới tính tiền ⇒ §9b HẾT là câu chặn'
          : d1 > 0
            ? '🔴 KHÔNG HOÃN — tool MCP nằm trong prefix ở MỌI lượt ⇒ §9b là câu chặn thật'
            : '❓ CẢ HAI đều 0 — chưa phân biệt được "hoãn" với "chưa nạp". Đo lại.'
      }`,
  );
}

if (paidDelta !== undefined) {
  console.log(`\nSPIKE 2b · hoá đơn: MCP thêm          ${paidDelta >= 0 ? '+' : ''}${paidDelta} token/lượt`);
}

console.log(
  `\n⚠ Ranh giới: đo với ĐÚNG MỘT server (${toolCount} tool). Một server 40 tool sẽ ra số khác,\n` +
    `  và quan hệ giữa hai số đó CHƯA đo. Đừng ngoại suy tuyến tính — hãy đo lại khi có mục thứ hai.`,
);

process.exit(0);
