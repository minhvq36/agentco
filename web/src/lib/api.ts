/**
 * Client API. Một chỗ duy nhất nói chuyện với daemon.
 *
 * Nguyên tắc xử lý lỗi (tiêu chí "Xử lý lỗi tốt"): backend đã trả về câu tiếng
 * Việt giải thích được — việc của tầng này là ĐỪNG NUỐT nó. Mọi lỗi ném ra
 * `ApiError` với `message` hiển thị thẳng lên UI được.
 */

import type {
  ArchivedAgent,
  ArmCall,
  ArtifactRecord,
  CanvasState,
  CatalogArm,
  InstalledArm,
  ProbeResult,
  CompanyModels,
  CompanyView,
  KnowledgeEntry,
  LibraryDoc,
  OAuthAccount,
  OfficeDetail,
  OfficeSummary,
  PlanRecord,
  PromptLayer,
  AgentEvent,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
    // Daemon tắt giữa chừng là chuyện SẼ xảy ra (Ctrl+C ở terminal). Nói đúng
    // việc phải làm, đừng để người dùng nhìn "Failed to fetch".
    throw new ApiError('Mất kết nối tới công ty. Kiểm tra terminal — daemon còn chạy không?', 0);
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Máy chủ trả về lỗi ${res.status}.`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  company: () => call<CompanyView>('/api/company'),

  /**
   * Duyệt thư mục trên máy CHẠY DAEMON. Trình duyệt không đưa được đường dẫn
   * tuyệt đối, còn hộp thoại của HĐH thì mở nhầm máy khi daemon ở xa — nên ta
   * tự liệt kê. → `paths.ts §browseDirs`
   */
  browse: (p?: string) =>
    call<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      `/api/browse${p ? `?path=${enc(p)}` : ''}`,
    ),

  // ── cánh tay (MCP). → docs/SPEC-arms.md §6
  armCatalog: () => call<{ arms: CatalogArm[] }>('/api/arms/catalog'),
  arms: () => call<{ arms: InstalledArm[] }>('/api/arms'),

  /**
   * THỬ NGAY — bắt tay thật, chưa lưu gì.
   *
   * ⚠ CHẬM VÀ ĐÓ LÀ BÌNH THƯỜNG. Giao diện phải hiện "đang kết nối…" — coi im
   * lặng là hỏng thì mọi cánh tay đều trông như hỏng ở lần cắm đầu tiên.
   *
   * ĐÍNH CHÍNH 24/08 (`scripts/spike-npx-cost.ts`, 10 lượt): câu cũ ở đây ghi
   * *"4 giây khi cache npx đã ấm, 17,7 giây lần đầu"*. Số thật, gói đã cache:
   * **7,7–9,2 giây, lần đầu bằng lần thứ ba** — không có "lần sau nhanh hơn".
   * ~3,2 s trong đó là phí tự thân của `npx`, đo được bằng cách chạy thẳng
   * `node <file>` (0,8 s). Cùng khoản đó cũng bị trả ở MỖI task có cánh tay.
   */
  testArm: (
    id: string,
    body: {
      /**
       * DÙNG LẠI một mục đã có trong sổ. Server lấy cấu hình + tên chìa + **giá
       * trị chìa** từ sổ chung, nên không có gì để client gửi kèm.
       *
       * ⚠ Không thay bằng cách dán `config` sang đường "tự cắm": cấu hình trong
       * sổ giữ ô trống `${…}`, và gửi nó đi mà không có chìa là **401** — đúng
       * bug user gặp 25/08 khi bê Notion sang văn phòng thứ hai.
       */
      armId?: string;
      config?: unknown;
      catalogId?: string;
      folders?: string[];
      secrets?: Record<string, string>;
      /** Tên chìa OAuth của tài khoản đã chọn. → `oauth.ts §accountName` */
      account?: string;
      /** Nấc quyền. Đi vào băm ở server — xem `addArm`. */
      level?: 'read' | 'add' | 'full';
    },
  ) => call<ProbeResult>('/api/arms/test', { method: 'POST', body: JSON.stringify({ id, ...body }) }),

  // ── đăng nhập một dịch vụ (OAuth). → docs/SPEC-arms.md §5h
  /**
   * Mở một lượt đăng nhập. Trả về **URL cho TA tự mở**, daemon không spawn gì.
   *
   * ⚠ Đó là cả điểm của thiết kế: trình duyệt người dùng đang ngồi có sẵn phiên
   * Notion; trình duyệt mặc định của máy thì chưa chắc — user gặp đúng ca đó
   * ngay lượt thử đầu 24/08.
   */
  oauthStart: (catalogId: string) =>
    call<{ authUrl: string; state: string }>('/api/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ catalogId }),
    }),

  /** Workspace đã nối cho một mục danh mục. TÊN + NHÃN, không token. */
  oauthAccounts: (forCatalog?: string) =>
    call<{ accounts: OAuthAccount[] }>(
      `/api/oauth/accounts${forCatalog ? `?for=${enc(forCatalog)}` : ''}`,
    ),

  /**
   * Gỡ một workspace. Server thu hồi ở phía dịch vụ (nếu dịch vụ nhận) rồi xoá
   * chìa ở máy này — và **từ chối** nếu còn kết nối nào đang dùng nó.
   */
  oauthForget: (name: string) =>
    call<{ accounts: OAuthAccount[] }>(`/api/oauth/accounts/${enc(name)}`, { method: 'DELETE' }),

  /**
   * Cắm một cánh tay. KHÔNG gửi `id` — danh tính là **băm cấu hình**, do server
   * sinh. Client chỉ gửi cái tên hiển thị. → `catalog.ts §armHash`
   */
  addArm: (body: {
    label?: string;
    /** Dùng lại mục đã có trong sổ — xem `testArm`. Nhãn và chìa đều lấy từ sổ. */
    armId?: string;
    /** Gửi thẳng cấu hình (đường "tự cắm")… */
    config?: unknown;
    /** …hoặc để SERVER dựng từ danh mục — số phiên bản gói chỉ nằm ở một chỗ. */
    catalogId?: string;
    folders?: string[];
    secrets?: Record<string, string>;
    /** Tài khoản OAuth đã chọn — tên chìa, mang `workspace_id`. */
    account?: string;
    /**
     * Nấc quyền. **Đi vào `armHash`** ⇒ đổi nấc là một cánh tay KHÁC, và đó
     * chính là thứ làm cho "đổi mức ở văn phòng này" không đụng văn phòng khác.
     */
    level?: 'read' | 'add' | 'full';
    office?: string;
    /** Giao cho ai — đi CÙNG request với việc cắm, xem `Office.grantArm`. */
    grantTo?: string[];
  }) => call<{ id: string; arms: InstalledArm[]; canvas?: CanvasState }>('/api/arms', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  /** Đổi tên — chỉ đụng nhãn trong sổ chung, không đổi khoá, không di trú gì. */
  renameArm: (id: string, label: string) =>
    call<{ label: string }>(`/api/arms/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),

  /** Rút khỏi MỘT văn phòng. Sổ chung giữ nguyên — cắm lại là tìm thấy. */
  removeArm: (id: string, office: string) =>
    call<{ arms: InstalledArm[] }>(`/api/arms/${enc(id)}?office=${enc(office)}`, { method: 'DELETE' }),

  /**
   * XOÁ HẲN khỏi sổ chung — **không lấy lại được**. Chỉ dùng cho mục `orphan`.
   *
   * ⚠ Không xoá chìa: chìa sống theo TÊN ở `.state/secrets.json`, độc lập với
   * sổ. Cắm lại từ danh mục là ba cú bấm; đi lấy lại token thì không.
   */
  forgetArm: (id: string) =>
    call<{ arms: InstalledArm[] }>(`/api/arms/${enc(id)}?forget=1`, { method: 'DELETE' }),

  createOffice: (name: string) =>
    call<{ id: string }>('/api/office', { method: 'POST', body: JSON.stringify({ name }) }),

  /** XOÁ HẲN cả thư mục. Mức "cất đi" là `patchOffice({ archived: true })`. */
  removeOffice: (id: string) => call<{ ok: true }>(`/api/office/${enc(id)}`, { method: 'DELETE' }),

  archivedAgents: (id: string) =>
    call<{ agents: ArchivedAgent[] }>(`/api/office/${enc(id)}/archived`),

  /** Cất đi / đưa trở lại một nhân viên. File yaml không đi đâu cả. */
  archiveAgent: (id: string, role: string, archived: boolean) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    }),

  office: (id: string) => call<OfficeDetail>(`/api/office/${enc(id)}`),

  /**
   * Đổi tên văn phòng và/hoặc mức model của Trợ lý. Cả hai nằm trong office.yaml.
   * `assistant_tier: null` = bỏ đặt riêng, quay về mức mặc định của công ty.
   */
  patchOffice: (
    id: string,
    patch: {
      name?: string;
      assistant_tier?: string | null;
      /** Tên hiển thị của Trợ lý. Không nằm trong prompt nào → không phá cache. */
      assistant_name?: string;
      archived?: boolean;
    },

  ) =>
    call<{
      id: string;
      name: string;
      archived: boolean;
      canvas: CanvasState;
      offices: OfficeSummary[];
    }>(`/api/office/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** Mức nào chạy model nào — cấp công ty, ảnh hưởng MỌI văn phòng. */
  updateModels: (models: Partial<CompanyModels>) =>
    call<{ models: CompanyModels }>('/api/company', {
      method: 'PATCH',
      body: JSON.stringify({ models }),
    }),

  canvas: (id: string) => call<CanvasState>(`/api/office/${enc(id)}/canvas`),

  saveCanvas: (id: string, payload: { nodes: unknown; edges: unknown }) =>
    call<CanvasState>(`/api/office/${enc(id)}/canvas`, { method: 'PUT', body: JSON.stringify(payload) }),

  addAgent: (id: string, input: { display_name: string; pitch: string; tier: string }) =>
    call<{ id: string; canvas: CanvasState }>(`/api/office/${enc(id)}/agent`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  editAgent: (
    id: string,
    role: string,
    patch: {
      display_name?: string;
      avatar?: string;
      pitch?: string;
      model_tier?: string;
      /** `0` = không giới hạn. */
      max_usd?: number;
      max_turns?: number;
      /** Bật `Bash` — mua được metadata file (kích thước · ngày sửa) và chạy script. */
      bash?: boolean;
    },
  ) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** XOÁ HẲN file roles/<id>.yaml. Mức "cất đi" là `archiveAgent`. */
  removeAgent: (id: string, role: string) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, { method: 'DELETE' }),

  say: (id: string, message: string) =>
    call<{ intent: string; reply: string }>(`/api/office/${enc(id)}/say`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  stop: (id: string) => call<{ ok: true }>(`/api/office/${enc(id)}/stop`, { method: 'POST' }),

  knowledge: (id: string) => call<{ nodes: KnowledgeEntry[] }>(`/api/office/${enc(id)}/knowledge`),

  /**
   * Sửa hoặc xoá một ghi chú. Id đi trong BODY chứ không trên đường dẫn —
   * id có dấu `/` (`k/agents/assistant/…`), nhét vào path thì phải encode
   * nhiều lớp và sớm muộn cũng có một lớp bị quên.
   */
  editKnowledge: (id: string, nodeId: string, patch: { body?: string; remove?: boolean }) =>
    call<{ nodes: KnowledgeEntry[] }>(`/api/office/${enc(id)}/knowledge`, {
      method: 'PATCH',
      body: JSON.stringify({ id: nodeId, ...patch }),
    }),

  // ── tủ tài liệu → docs/SPEC-library.md §13

  /** Quét lại thư mục rồi trả danh sách. Không có watcher — xem SPEC §9.1. */
  library: (id: string) => call<{ docs: LibraryDoc[] }>(`/api/office/${enc(id)}/library`),

  /**
   * Tải một tài liệu lên. Body là nội dung NGUYÊN SI, tên đi trên query string.
   *
   * CỐ Ý không dùng `FormData`/multipart: nó buộc server phải parse biên, mã hoá
   * tên file và chunk cắt giữa biên — tức là một thư viện nữa, cho một thứ ta
   * không cần. Ở đây một request là một file, và đó là toàn bộ giao thức.
   *
   * `replace` là quyết định CÓ Ý THỨC của người dùng sau khi thấy câu hỏi lại;
   * không bao giờ tự bật.
   */
  uploadDoc: (id: string, file: File, replace = false) =>
    call<{ doc: LibraryDoc; docs: LibraryDoc[] }>(
      `/api/office/${enc(id)}/library?name=${enc(file.name)}${replace ? '&replace=1' : ''}`,
      { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } },
    ),

  /**
   * Bóc lại một tài liệu chưa dùng được. → SPEC-library.md §4.5
   *
   * Có mặt vì `state` là bản ghi về QUÁ KHỨ, còn nguyên nhân thì sửa được: một
   * PDF kẹt `chưa lập chỉ mục` vì máy thiếu bộ đọc phải bóc lại được sau khi bộ
   * đọc có mặt, chứ không bắt người dùng xoá rồi thả lại file của chính họ.
   */
  libraryReextract: (id: string, name: string) =>
    call<{ docs: LibraryDoc[] }>(
      `/api/office/${enc(id)}/library/reextract?name=${enc(name)}`,
      { method: 'POST' },
    ),

  /** Xoá hẳn. Một mức duy nhất — tài liệu là file của chính người dùng (SPEC §6). */
  removeDoc: (id: string, name: string) =>
    call<{ docs: LibraryDoc[] }>(`/api/office/${enc(id)}/library?name=${enc(name)}`, {
      method: 'DELETE',
    }),

  docUrl: (id: string, name: string) => `/api/office/${enc(id)}/library/file?name=${enc(name)}`,

  // ── kết quả (artifacts) → docs/SPEC-artifacts.md
  //
  // CỐ Ý không có hàm `upload`. Đây không phải tủ tài liệu thứ hai: không có
  // đường nào từ giao diện đưa một kết quả trở lại làm đầu vào cho nhân viên.
  // Muốn dùng lại thì người dùng tự bàn giao.

  /** Quét thư mục kết quả. Không catalog — file do nhân viên ghi lúc đang chạy. */
  artifacts: (id: string) => call<{ artifacts: ArtifactRecord[] }>(`/api/office/${enc(id)}/artifacts`),

  /**
   * Đường dẫn thư mục văn phòng — và server MỞ nó ra nếu trình duyệt đang chạy
   * cùng máy với daemon.
   *
   * `opened: false` là ca BÌNH THƯỜNG khi truy cập từ xa (VPS, Docker), không
   * phải lỗi: "mở thư mục" sẽ mở trên MÁY CHỦ chứ không phải máy đang nhìn, nên
   * server cố ý không làm gì. Giao diện rơi về chép đường dẫn.
   */
  revealOffice: (id: string) =>
    call<{ dir: string; opened: boolean }>(`/api/office/${enc(id)}/reveal`, { method: 'POST' }),

  /**
   * URL của một kết quả. `download` phân biệt XEM với TẢI VỀ, và khác biệt là thật:
   * xem thì bị chặn theo dung lượng và có `content-type` đúng để trình duyệt tự
   * hiện; tải về thì luôn `octet-stream` + `content-disposition`.
   */
  artifactUrl: (id: string, p: string, download = false) =>
    `/api/office/${enc(id)}/artifacts/file?path=${enc(p)}${download ? '&download=1' : ''}`,

  /** Xoá hẳn. Một mức — nhưng khác tủ tài liệu, ĐÂY LÀ BẢN DUY NHẤT. */
  removeArtifact: (id: string, p: string) =>
    call<{ artifacts: ArtifactRecord[] }>(`/api/office/${enc(id)}/artifacts?path=${enc(p)}`, {
      method: 'DELETE',
    }),

  /**
   * Dọn sạch ngăn Kết quả. `all=1` là TƯỜNG MINH — server cố ý không suy
   * "thiếu path" thành "xoá hết". Chỉ ngăn này có nút này; tủ tài liệu và kho
   * tri thức thì không. → `artifacts.ts §removeAll`
   */
  clearArtifacts: (id: string) =>
    call<{ removed: number; artifacts: ArtifactRecord[] }>(`/api/office/${enc(id)}/artifacts?all=1`, {
      method: 'DELETE',
    }),

  /**
   * NHẬT KÝ KIỂM TOÁN của MỘT cánh tay — mọi lời gọi MCP, kèm tham số.
   * → `core/audit.ts` · SPEC-arms §6k
   *
   * Đây là thứ **thay** cho cổng duyệt từng lần: bỏ cổng thì log phải đủ, nếu
   * không ta vừa bỏ cả hai.
   */
  armLog: (id: string, server: string) =>
    call<{ calls: ArmCall[] }>(`/api/office/${enc(id)}/arm-log?server=${enc(server)}`),

  plans: (id: string) => call<{ plans: PlanRecord[] }>(`/api/office/${enc(id)}/plans`),

  plan: (id: string, planId: string) =>
    call<{ plan: PlanRecord; log: AgentEvent[] }>(`/api/office/${enc(id)}/plans/${enc(planId)}`),

  prompt: (id: string, who: string) =>
    call<{ layers: PromptLayer[]; editable: boolean }>(`/api/office/${enc(id)}/prompt/${enc(who)}`),

  savePromptLayer: (id: string, who: string, layer: string, text: string) =>
    call<{ layers: PromptLayer[] }>(`/api/office/${enc(id)}/prompt/${enc(who)}/${enc(layer)}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  cost: () =>
    call<{
      text: string;
      byOffice: Array<{
        office: string;
        name: string;
        tasks: number;
        costUSD: number;
        turns: number;
        /** Văn phòng còn đó nhưng đang trong lưu trữ. */
        archived: boolean;
        /** Văn phòng không còn trên đĩa, hoặc bản ghi có trước khi tách văn phòng. */
        gone: boolean;
      }>;
    }>('/api/cost'),

  shutdown: () => call<{ ok: true }>('/api/shutdown', { method: 'POST' }),
};
