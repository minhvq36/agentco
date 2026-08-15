/**
 * State toàn app. Store tự viết trên `useSyncExternalStore` — không thêm thư viện.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ RÀNG BUỘC HIỆU NĂNG: toạ độ node lúc ĐANG KÉO không đi qua store này.    │
 * │ Canvas cập nhật `transform` thẳng trên DOM qua ref, và chỉ commit vào    │
 * │ store một lần khi thả chuột. Một `setState` mỗi frame kéo = render lại   │
 * │ cả cây React 60 lần/giây, và tiêu chí "Hiệu năng" đòi 60fps KỂ CẢ khi    │
 * │ công ty đang chạy (tức là đang có sự kiện SSE bắn vào liên tục).         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useSyncExternalStore } from 'react';

import { api, ApiError } from './api';
import type {
  AgentEvent,
  CanvasEdge,
  CanvasState,
  CompanyView,
  OfficeState,
  PlanStep,
  StepStatus,
  Usage,
} from './types';

export interface ChatMessage {
  id: number;
  role: 'assistant' | 'user';
  text: string;
  at: number;
}

/** Trạng thái sống của một agent. Giữ ngoài DOM để sống sót qua mọi lần render. */
export interface LiveAgent {
  status: 'working' | 'done' | 'error';
  say: string;
}

export type PanelId = 'chat' | 'plans' | 'overview' | 'knowledge';

export interface AppState {
  loading: boolean;
  /** Lỗi ở tầng công ty (mất daemon, config hỏng). Chặn cả màn hình. */
  fatal: string | null;
  /** Lỗi thoáng qua — hiện thành toast, không chặn gì. */
  toast: { text: string; kind: 'error' | 'info' } | null;

  company: CompanyView | null;
  officeId: string | null;

  canvas: CanvasState | null;
  officeState: OfficeState;
  plan: { plan_id: string; request: string; steps: PlanStep[] } | null;

  messages: ChatMessage[];
  /** Số tin đã đọc. Chấm "có tin mới" phải nói thật, nếu không thì bỏ hẳn còn hơn. */
  seenMessages: number;
  live: Record<string, LiveAgent>;
  cost: (Usage & { tasks: number }) | null;
  /** Đang chờ Trợ lý trả lời câu vừa gõ. */
  sending: boolean;
  /**
   * Câu mô tả việc đang diễn ra, hiện ngay trong khung chat.
   *
   * Không có nó thì từ lúc bấm Gửi tới lúc Trợ lý trả lời là một khoảng im lặng
   * 5–15 giây, và người dùng không biết hệ thống có nhận được hay không. Đây là
   * cùng một thứ mà Telegram gọi là "typing…" — xem SPEC-offices.md §9.
   */
  activity: string | null;

  panel: PanelId | null;
  /** Node đang chọn trên canvas (id node, không phải id vai trò). */
  selected: string | null;
}

const initial: AppState = {
  loading: true,
  fatal: null,
  toast: null,
  company: null,
  officeId: null,
  canvas: null,
  officeState: 'idle',
  plan: null,
  messages: [],
  seenMessages: 0,
  live: {},
  cost: null,
  sending: false,
  activity: null,
  panel: null,
  selected: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();
let msgSeq = 0;

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  );
}

export function getState(): AppState {
  return state;
}

/**
 * Tên hiển thị của một vai trò, để đọc log bằng mắt người.
 *
 * Người dùng đặt tên nhân viên tuỳ ý ("Người viết"), còn `role.id` là bản slug
 * hoá cho tên file ("nguoi-viet"). Log phải hiện cái người dùng đặt.
 *
 * MÀU thì vẫn băm từ `id`, không từ tên: đổi tên hiển thị không được làm đổi màu
 * — mắt đã quen nối màu với người rồi. Và log cũ của vai trò đã bị xoá vẫn còn
 * `id` để lần ra, nên chỗ nào không tra được thì rơi về `id` chứ không rỗng.
 */
export function labelFor(roleId: string): string {
  if (roleId === 'user') return 'bạn';
  if (roleId === 'assistant') {
    const node = state.canvas?.nodes.find((n) => n.kind === 'assistant');
    return node?.label ?? 'Trợ lý';
  }
  const node = state.canvas?.nodes.find((n) => n.role === roleId);
  return node?.label ?? roleId;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'error' | 'info' = 'error'): void {
  set({ toast: { text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 6000);
}

/**
 * Bọc mọi lời gọi API. Backend đã trả câu tiếng Việt giải thích được — việc ở
 * đây là hiện nó ra, không nuốt. Mất daemon thì chặn cả màn hình vì mọi thao
 * tác tiếp theo đều vô nghĩa; lỗi khác thì chỉ báo rồi thôi.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError && err.status === 0) set({ fatal: msg });
    else toast(msg);
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────── hành động

export const actions = {
  async boot(): Promise<void> {
    const company = await guard(() => api.company());
    if (!company) {
      set({ loading: false });
      return;
    }
    set({ company, fatal: null });

    if (company.offices.length === 0) {
      set({ loading: false, officeId: null, canvas: null });
      return;
    }
    const keep = state.officeId && company.offices.some((o) => o.id === state.officeId);
    await actions.openOffice(keep ? state.officeId! : company.offices[0]!.id);
    set({ loading: false });
  },

  /** Mở một văn phòng. Xoá sạch state của văn phòng cũ — không trộn hai luồng. */
  async openOffice(id: string): Promise<void> {
    set({
      officeId: id,
      canvas: null,
      plan: null,
      messages: [],
      seenMessages: 0,
      live: {},
      cost: null,
      selected: null,
      loading: true,
    });

    const [canvas, detail] = await Promise.all([
      guard(() => api.canvas(id)),
      guard(() => api.office(id)),
    ]);
    if (!canvas || !detail) {
      set({ loading: false });
      return;
    }

    set({
      canvas,
      officeState: detail.state,
      plan: detail.plan,
      loading: false,
    });
    // Phát lại lịch sử để tab mở muộn vẫn thấy chuyện vừa xảy ra.
    for (const e of detail.history) applyEvent(e, false);
  },

  async refreshCompany(): Promise<void> {
    const company = await guard(() => api.company());
    if (company) set({ company });
  },

  async refreshCanvas(): Promise<void> {
    const id = state.officeId;
    if (!id) return;
    const canvas = await guard(() => api.canvas(id));
    if (canvas) set({ canvas });
  },

  async createOffice(name: string): Promise<boolean> {
    const res = await guard(() => api.createOffice(name));
    if (!res) return false;
    const company = await guard(() => api.company());
    if (company) set({ company });
    await actions.openOffice(res.id);
    return true;
  },

  async removeOffice(id: string, deleteFiles: boolean): Promise<boolean> {
    const ok = await guard(() => api.removeOffice(id, deleteFiles));
    if (!ok) return false;
    set({ officeId: null });
    await actions.boot();
    return true;
  },

  /**
   * Ghi hình dạng.
   *
   * `optimistic` = vẽ ngay rồi mới gửi. Dùng cho CẠNH NỐI: chúng rời rạc, một
   * lần một, và người dùng vừa thả chuột xong nên phải thấy sợi dây ngay —
   * chờ một vòng mạng mới hiện là đúng thứ tiêu chí "Mượt" cấm.
   *
   * Toạ độ thì KHÔNG optimistic: chúng đã hiện sẵn trên DOM (canvas tự vẽ khi
   * kéo), nên gán lại vào store chỉ tổ làm React render thừa.
   *
   * Server có quyền sửa lại (lọc dây sai luật) → luôn nhận bản của nó, và nếu
   * nó bỏ mất thứ ta vừa vẽ thì NÓI RA chứ không im lặng rút lại.
   */
  async saveCanvas(
    nodes: CanvasState['nodes'],
    edges: CanvasEdge[],
    optimistic = false,
  ): Promise<void> {
    const id = state.officeId;
    if (!id) return;

    if (optimistic && state.canvas) {
      const connected = new Set(edges.filter((e) => e.from === 'assistant').map((e) => e.to));
      set({
        canvas: {
          ...state.canvas,
          edges,
          nodes: state.canvas.nodes.map((n) =>
            n.kind === 'agent' ? { ...n, connected: connected.has(n.id) } : n,
          ),
        },
      });
    }

    const next = await guard(() => api.saveCanvas(id, { nodes, edges }));
    if (!next) return;

    if (optimistic && next.edges.length < edges.length) {
      toast('Sơ đồ không nhận sợi dây đó — kiểu nối này không hợp lệ.', 'error');
    }
    set({ canvas: next });
  },

  async addAgent(input: { display_name: string; pitch: string; tier: string }): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.addAgent(id, input));
    if (!res) return false;
    set({ canvas: res.canvas });
    void actions.refreshCompany();
    return true;
  },

  /**
   * Sửa hồ sơ nhân viên. KHÔNG autosave — caller gọi từ nút Lưu tường minh.
   *
   * Sửa `pitch` bump cacheKey của Trợ lý (pitch nằm trong roster); sửa
   * `model_tier` bump cacheKey của chính agent đó. Autosave theo phím ở đây là
   * churn cache liên tục — cùng lý do với skills (SPEC-ui.md §2.2).
   */
  async editAgent(
    role: string,
    patch: { display_name?: string; avatar?: string; pitch?: string; model_tier?: string },
  ): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.editAgent(id, role, patch));
    if (!res) return false;
    set({ canvas: res.canvas });
    void actions.refreshCompany();
    return true;
  },

  async removeAgent(role: string, keepFile: boolean): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.removeAgent(id, role, keepFile));
    if (!res) return false;
    set({ canvas: res.canvas, selected: null });
    void actions.refreshCompany();
    return true;
  },

  async say(text: string): Promise<void> {
    const id = state.officeId;
    if (!id || !text.trim()) return;
    set({ sending: true, activity: 'đang đọc yêu cầu…' });
    // KHÔNG tự thêm tin nhắn của mình vào đây: server phát lại nó dưới dạng
    // sự kiện (role: 'user') để mọi tab và Telegram bridge cùng thấy một luồng.
    // `say` giờ trả về NGAY sau khi bỏ tin vào hòm thư — mọi cập nhật tiếp theo
    // đến bằng sự kiện `office.activity`, nên đừng tự tắt dòng trạng thái ở đây.
    await guard(() => api.say(id, text.trim()));
    set({ sending: false });
  },

  async stop(): Promise<void> {
    const id = state.officeId;
    if (!id) return;
    await guard(() => api.stop(id));
  },

  openPanel(panel: PanelId | null): void {
    const next = state.panel === panel ? null : panel;
    set({ panel: next, ...(next === 'chat' ? { seenMessages: state.messages.length } : {}) });
  },

  select(nodeId: string | null): void {
    set({ selected: nodeId });
  },

  dismissToast(): void {
    set({ toast: null });
  },
};

// ─────────────────────────────────────────────────────────── SSE

let source: EventSource | undefined;

export function connectEvents(): () => void {
  source?.close();
  const es = new EventSource('/api/events');
  source = es;

  es.onmessage = (m) => {
    let e: AgentEvent;
    try {
      e = JSON.parse(m.data as string) as AgentEvent;
    } catch {
      return;
    }
    if (e.type === 'company.offices') {
      void actions.refreshCompany();
      return;
    }
    // Sự kiện của văn phòng KHÁC không được hiện ở đây. Đây là lý do mọi sự
    // kiện bắt buộc mang trường office.
    if (e.office && e.office !== state.officeId) return;
    applyEvent(e, true);
  };

  es.onerror = () => {
    // EventSource tự kết nối lại. Chỉ báo khi nó đã đóng hẳn.
    if (es.readyState === EventSource.CLOSED) {
      set({ fatal: 'Mất kết nối tới công ty. Kiểm tra terminal — daemon còn chạy không?' });
    }
  };

  return () => es.close();
}

let doneTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function setLive(role: string, next: LiveAgent | null): void {
  const live = { ...state.live };
  if (next) live[role] = next;
  else delete live[role];
  set({ live });
}

function applyEvent(e: AgentEvent, fromLive: boolean): void {
  switch (e.type) {
    case 'plan.created':
      set({ plan: { plan_id: e.plan_id, request: e.request, steps: e.steps }, live: {} });
      break;

    case 'plan.step': {
      const plan = state.plan;
      if (!plan) break;
      const steps = plan.steps.map((s, i) => (i === e.step ? { ...s, status: e.status as StepStatus } : s));
      set({ plan: { ...plan, steps } });
      break;
    }

    case 'plan.finished':
      // Giữ kế hoạch trên màn hình sau khi xong — người dùng vừa mới đọc nó,
      // xoá ngay là cướp mất ngữ cảnh.
      set({ live: {}, activity: null });
      break;

    case 'task.started':
    case 'task.progress':
      clearTimeout(doneTimers[e.role]);
      setLive(e.role, { status: 'working', say: e.say });
      // Ai đang làm gì — hiện ngay trong khung chat, không bắt người dùng mở
      // sang panel khác để biết hệ thống còn sống.
      set({ activity: labelFor(e.role) + ': ' + e.say });
      break;

    case 'task.done': {
      const ok = e.status === 'done';
      setLive(e.role, { status: ok ? 'done' : 'error', say: e.say });
      clearTimeout(doneTimers[e.role]);
      doneTimers[e.role] = setTimeout(() => {
        if (state.live[e.role]?.status === 'done') setLive(e.role, null);
      }, 4500);
      break;
    }

    case 'task.blocked':
      setLive(e.role, { status: 'error', say: e.say });
      break;

    case 'master.message': {
      const messages = [...state.messages, { id: ++msgSeq, role: e.role, text: e.say, at: Date.now() }];
      // Panel chat đang mở thì coi như đã đọc ngay — chấm đỏ chỉ dành cho tin
      // đến lúc người dùng không nhìn.
      set({ messages, ...(state.panel === 'chat' ? { seenMessages: messages.length } : {}) });
      break;
    }

    case 'office.state':
      set({ officeState: e.state });
      break;

    // Trợ lý bận và nhân viên bận là HAI chuyện. Câu hiện ra phải nói đúng cái
    // đang xảy ra, nếu không người dùng thấy im lặng và tưởng hệ thống chết.
    case 'office.activity': {
      const bits: string[] = [];
      if (e.assistant === 'thinking') bits.push('Trợ lý đang nghĩ…');
      if (e.workers > 0) bits.push(`${e.workers} nhân viên đang làm việc`);
      if (e.queued > 0) bits.push(`${e.queued} tin chờ`);
      if (e.jobs > 0) bits.push(`${e.jobs} việc xếp hàng`);
      set({ activity: bits.length ? bits.join(' · ') : null });
      break;
    }

    case 'cost.tick':
      set({ cost: e.totals });
      break;

    case 'knowledge.changed':
      if (fromLive) void actions.refreshCanvas();
      break;

    case 'layout.changed':
      // Bỏ qua tiếng vọng của chính mình — saveCanvas đã nhận bản mới từ server.
      // Nhưng tab KHÁC thì vẫn phải thấy. Đánh dấu bằng thời điểm ghi gần nhất.
      if (fromLive && Date.now() - lastLocalSave > 2000) void actions.refreshCanvas();
      break;
  }
}

let lastLocalSave = 0;
export function markLocalSave(): void {
  lastLocalSave = Date.now();
}

/** Dọn khi hot-reload trong lúc dev. */
export function resetTimers(): void {
  for (const t of Object.values(doneTimers)) clearTimeout(t);
  doneTimers = {};
}
