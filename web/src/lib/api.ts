/**
 * Client API. Một chỗ duy nhất nói chuyện với daemon.
 *
 * Nguyên tắc xử lý lỗi (tiêu chí "Xử lý lỗi tốt"): backend đã trả về câu tiếng
 * Việt giải thích được — việc của tầng này là ĐỪNG NUỐT nó. Mọi lỗi ném ra
 * `ApiError` với `message` hiển thị thẳng lên UI được.
 */

import type {
  CanvasState,
  CompanyView,
  KnowledgeEntry,
  OfficeDetail,
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

  removeOffice: (id: string, deleteFiles: boolean) =>
    call<{ ok: true }>(`/api/office/${enc(id)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' }),

  office: (id: string) => call<OfficeDetail>(`/api/office/${enc(id)}`),

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
    patch: { display_name?: string; avatar?: string; pitch?: string; model_tier?: string },
  ) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeAgent: (id: string, role: string, keepFile: boolean) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}?keepFile=${keepFile}`, {
      method: 'DELETE',
    }),

  say: (id: string, message: string) =>
    call<{ intent: string; reply: string }>(`/api/office/${enc(id)}/say`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  stop: (id: string) => call<{ ok: true }>(`/api/office/${enc(id)}/stop`, { method: 'POST' }),

  knowledge: (id: string) => call<{ nodes: KnowledgeEntry[] }>(`/api/office/${enc(id)}/knowledge`),

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
    call<{ text: string; byOffice: Array<{ office: string; name: string; tasks: number; costUSD: number; turns: number }> }>(
      '/api/cost',
    ),

  shutdown: () => call<{ ok: true }>('/api/shutdown', { method: 'POST' }),
};
