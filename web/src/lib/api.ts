/**
 * Client API. Một chỗ duy nhất nói chuyện với daemon.
 *
 * Nguyên tắc xử lý lỗi (tiêu chí "Xử lý lỗi tốt"): backend đã trả về câu tiếng
 * Việt giải thích được — việc của tầng này là ĐỪNG NUỐT nó. Mọi lỗi ném ra
 * `ApiError` với `message` hiển thị thẳng lên UI được.
 */

import type {
  ArchivedAgent,
  ArtifactRecord,
  CanvasState,
  CompanyModels,
  CompanyView,
  KnowledgeEntry,
  LibraryDoc,
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
    patch: { name?: string; assistant_tier?: string | null; archived?: boolean },
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
      /** Bật `Bash` cho vai trò này — tool duy nhất ra được khỏi thư mục văn phòng. */
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
