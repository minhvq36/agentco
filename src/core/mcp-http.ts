/**
 * HỎI THẲNG MỘT MCP SERVER HTTP `tools/list` — chỉ để lấy `annotations` THÔ.
 * → docs/SPEC-arms.md §6j · `core/probe.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 VÌ SAO FILE NÀY TỒN TẠI: **SDK VỨT MỌI ANNOTATION CÓ GIÁ TRỊ `false`.**│
 * │ (đo 26/08, `scripts/spike-sdk-annotations.ts` — dứt khoát)               │
 * │                                                                          │
 * │   Notion khai   `{readOnlyHint: false, destructiveHint: false}`          │
 * │   SDK đưa ta    `{}`                                                     │
 * │   Notion khai   `{readOnlyHint: false, destructiveHint: true}`           │
 * │   SDK đưa ta    `{destructive: true}`                                    │
 * │                                                                          │
 * │ ⇒ `destructive: false` **không biểu diễn được** qua SDK. Mà nấc giữa      │
 * │ ("đọc + thêm mới, không sửa/xoá") được định nghĩa **chính bằng** cặp      │
 * │ `readOnly:false + destructive:false` — nên nó vĩnh viễn rỗng, và 11/28    │
 * │ tool Notion vốn chỉ TẠO MỚI bị đẩy vào ô **toàn quyền**.                  │
 * │                                                                          │
 * │ ⚠⚠ ĐÂY KHÔNG PHẢI CHUYỆN ĐẾM NẤC. Nó là một **hồi quy đặc quyền tối      │
 * │ thiểu**: người dùng muốn *"cho agent tạo trang, đừng cho sửa trang cũ"*   │
 * │ — thứ Notion hỗ trợ chính xác — mà hệ thống buộc họ cấp cả sửa lẫn xoá.   │
 * │ Luật "không biết ⇒ leo thang" **không sai**; nó đang xử lý một dữ kiện    │
 * │ đã bị mất trên đường.                                                    │
 * │                                                                          │
 * │ ⚠ Chỉ dùng cho PHÂN LOẠI, không thay SDK ở bất kỳ chỗ nào khác. Việc gọi │
 * │ tool, vòng đời phiên, quyền — vẫn của SDK. Đây là một lần đọc, một lần,   │
 * │ lúc cắm. Hỏng thì rơi về annotations của SDK: **tệ hơn, nhưng không sai** │
 * │ (rơi về nấc cao = an toàn khi không biết).                               │
 * │                                                                          │
 * │ ⚠ Và nó KHÔNG import SDK hãng nào — cùng luật `core/oauth.ts`. Đổi hãng   │
 * │ chạy agent thì file này đi theo nguyên vẹn.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Đúng bốn trường chuẩn của MCP. → `@modelcontextprotocol/sdk §ToolAnnotationsSchema` */
export interface RawAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const PROTOCOL = '2025-06-18';

/**
 * Streamable HTTP trả về **SSE**, không phải JSON trần: một khối `event:`/`data:`.
 * Bóc dòng `data:` đầu tiên. Không có thì thử đọc cả body như JSON — vài server
 * trả thẳng JSON khi client không xin `text/event-stream`.
 */
function parseBody(text: string): { result?: unknown; error?: unknown } | null {
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  try {
    return JSON.parse(line ? line.slice(5).trim() : text) as { result?: unknown; error?: unknown };
  } catch {
    return null;
  }
}

/**
 * `annotations` THÔ theo tên tool. Ném/rỗng ⇒ chỗ gọi phải tự rơi về SDK.
 *
 * ⚠ Ba bước, đúng thứ tự giao thức, và **bỏ bước hai là hỏng ở một nửa số
 * server**: nhiều bản triển khai từ chối `tools/list` khi chưa nhận
 * `notifications/initialized`.
 */
export async function rawAnnotations(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<Map<string, RawAnnotations>> {
  const out = new Map<string, RawAnnotations>();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    let session = '';
    const post = async (body: unknown): Promise<{ result?: unknown; error?: unknown } | null> => {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
          ...headers,
          ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify(body),
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) session = sid;
      if (!res.ok) return null;
      return parseBody(await res.text());
    };

    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'agentco', version: '1' },
      },
    });
    if (!init?.result) return out;

    // Thông báo, không phải yêu cầu — không có `id`, không đọc phản hồi.
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (listed?.result as { tools?: { name?: string; annotations?: RawAnnotations }[] })?.tools;
    for (const t of tools ?? []) {
      if (typeof t?.name === 'string' && t.annotations) out.set(t.name, t.annotations);
    }
  } catch {
    // Mạng chết · server không nói streamable HTTP · quá hạn — im lặng trả rỗng.
    // Chỗ gọi rơi về annotations của SDK, tức về đúng hành vi trước 26/08.
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/**
 * Cấu hình này hỏi thẳng được không? Chỉ HTTP — stdio phải spawn tiến trình và
 * nói MCP qua đường ống, tức dựng lại nguyên một client thứ hai. Không đáng:
 * cánh tay stdio hôm nay chỉ có `filesystem`, và nó không có nấc.
 */
export function httpTarget(
  config: unknown,
): { url: string; headers: Record<string, string> } | undefined {
  const c = config as { url?: unknown; headers?: unknown } | null;
  if (!c || typeof c.url !== 'string') return undefined;
  const headers: Record<string, string> = {};
  if (c.headers && typeof c.headers === 'object') {
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v;
    }
  }
  return { url: c.url, headers };
}
