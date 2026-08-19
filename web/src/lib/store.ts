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

export type PanelId = 'chat' | 'plans' | 'overview' | 'knowledge' | 'library' | 'artifacts';

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

  /**
   * Tăng mỗi khi tủ tài liệu đổi. → docs/SPEC-library.md §10
   *
   * Việc bóc văn bản chạy ngầm và mất vài giây cho một PDF dày, nên panel không
   * thể chỉ nạp một lần lúc mở. Dùng một con số đếm thay vì nhét cả danh sách
   * vào store: danh sách chỉ có đúng một bên đọc, còn store thì mọi component
   * đang lắng nghe — đẩy nó vào đây là bắt cả cây render lại vì một dòng đổi
   * trạng thái.
   */
  libraryVersion: number;

  /**
   * Số tài liệu ĐANG được bóc văn bản. → docs/SPEC-library.md §10
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TRẠNG THÁI CỦA CÁI TỦ, KHÔNG PHẢI TRẠNG THÁI CỦA CUỘC TRÒ CHUYỆN.       │
   * │                                                                          │
   * │ Bản trước nhét câu "Đang đọc N tài liệu…" vào `activity` — dòng trạng    │
   * │ thái của ô chat. Hai lỗi cùng lúc:                                        │
   * │                                                                          │
   * │  1. SAI CHỖ. Người dùng vừa thả file vào tủ, không hỏi Trợ lý câu nào,   │
   * │     mà ô chat lại báo bận. Việc đang xảy ra ở tủ thì phải hiện ở tủ.     │
   * │  2. KHÔNG BAO GIỜ TẮT. `busy` về 0 thì nhánh đó không đặt `activity`     │
   * │     nữa — nó chỉ không ghi gì, nên chuỗi cũ nằm nguyên trên màn hình     │
   * │     cho tới khi người dùng tình cờ gõ một tin nhắn và ghi đè lên.        │
   * │     Đúng lớp lỗi "/help ba chấm quay mãi": bật được mà không tắt được.   │
   * │                                                                          │
   * │ Một con SỐ chứ không phải một lá cờ: giao diện phải nói được "còn 3 file"│
   * │ chứ không chỉ "đang bận".                                                │
   * │                                                                          │
   * │ Chỗ chat THẬT SỰ cần biết vẫn còn nguyên và không đi qua đây: khi một ca │
   * │ chạy phải đứng chờ bóc xong, `office.run()` phát `office.state` riêng    │
   * │ với câu "Đang đọc tài liệu X…". Đó mới là lúc im lặng gây hiểu nhầm.     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  libraryBusy: number;

  /**
   * Tăng mỗi khi kho tri thức đổi.
   *
   * ⚠ Trước 19/08 `KnowledgePanel` bám vào `canvas.knowledge.total` — tức là
   * SỐ ĐẾM, không phải sự kiện. Nó chỉ nạp lại khi số node thay đổi, nên mọi
   * thay đổi giữ nguyên số lượng đều vô hình cho tới khi người dùng bấm F5:
   * sửa nội dung một ghi chú, một node bị đè, dọn một node rồi thêm một node.
   * Đếm không phải là biết đã đổi.
   */
  knowledgeVersion: number;

  /**
   * Tăng mỗi khi có kết quả mới. → docs/SPEC-artifacts.md
   *
   * Không cần sự kiện riêng từ server: kết quả chỉ sinh ra khi một việc chạy
   * xong, mà `task.done` / `plan.finished` đã bay tới rồi. Thêm một sự kiện nữa
   * để nói lại cùng một chuyện là thêm một chỗ có thể lệch nhau.
   */
  artifactsVersion: number;

  /**
   * File vừa được thả lên node Tủ tài liệu, đang chờ panel nhận.
   *
   * Canvas KHÔNG tự tải lên. Cả luồng tải lên — hỏi lại khi trùng tên, câu từ
   * chối cho từng đuôi file, trạng thái bóc text — sống ở đúng MỘT chỗ là
   * `LibraryPanel`. Ô này là băng chuyền giữa hai cửa vào, không phải bản sao
   * thứ hai của logic: có hai bản thì đến ngày sửa luật trùng tên sẽ có một bản
   * được sửa và một bản bị quên.
   */
  pendingDocs: File[] | null;

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
  libraryVersion: 0,
  libraryBusy: 0,
  knowledgeVersion: 0,
  artifactsVersion: 0,
  pendingDocs: null,
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
      // Tủ tài liệu là của TỪNG văn phòng. Không dọn thì mở văn phòng khác vẫn
      // thấy "đang đọc 2 tài liệu" của văn phòng vừa rời đi.
      libraryBusy: 0,
      activity: null,
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
    /**
     * Phát lại theo ĐÚNG THỨ TỰ NÀY, và hai nguồn không được trộn:
     *
     *  1. `chat`    — hội thoại đọc từ đĩa. Đây là thứ sống sót qua tắt daemon,
     *                 và là thứ khiến màn hình khớp với những gì Trợ lý còn nhớ.
     *  2. `history` — vòng đệm trong bộ nhớ của daemon, cho trạng thái SỐNG
     *                 (kế hoạch đang chạy, ai đang làm gì). Bỏ `master.message`
     *                 ở đây vì bước 1 đã có, giữ lại sẽ hiện tin nhắn hai lần.
     */
    for (const e of detail.chat ?? []) applyEvent(e, false);
    for (const e of detail.history) {
      if (e.type === 'master.message') continue;
      applyEvent(e, false);
    }
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

  /**
   * Đổi tên văn phòng. Mã (thư mục) giữ nguyên — không có gì phải mở lại.
   *
   * Server trả về cả danh sách văn phòng đã cập nhật, nên không cần thêm một
   * vòng `GET /api/company` nữa; ô chọn ở đầu màn hình đổi tên ngay lập tức.
   */
  async renameOffice(name: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { name }));
    if (!res) return false;
    set({
      canvas: res.canvas,
      company: state.company ? { ...state.company, offices: res.offices } : state.company,
    });
    return true;
  },

  /**
   * Đổi mức model của Trợ lý văn phòng này. `null` = theo mặc định của công ty.
   *
   * Trí nhớ hội thoại KHÔNG mất: bản ghi session nằm trên đĩa và độc lập với
   * model. Cái mất là prompt cache — lượt kế tiếp ghi lại một lần.
   */
  async setAssistantTier(tier: string | null): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { assistant_tier: tier }));
    if (!res) return false;
    set({ canvas: res.canvas });
    return true;
  },

  /** Mức nào chạy model nào — cấp CÔNG TY, đụng tới mọi văn phòng. */
  async updateModels(models: Record<string, string>): Promise<boolean> {
    const res = await guard(() => api.updateModels(models as never));
    if (!res) return false;
    set({ company: state.company ? { ...state.company, models: res.models } : state.company });
    await actions.refreshCanvas();
    return true;
  },

  /** Cất đi / đưa trở lại một VĂN PHÒNG. Chỉ gắn cờ, file không đi đâu cả. */
  async archiveOffice(id: string, archived: boolean): Promise<boolean> {
    const res = await guard(() => api.patchOffice(id, { archived }));
    if (!res) return false;
    // Cất chính văn phòng đang mở thì phải chuyển sang cái khác — ở lại nghĩa là
    // mọi thao tác tiếp theo đều báo lỗi "chỉ đọc", và người dùng không hiểu vì sao.
    if (archived && state.officeId === id) {
      set({ company: state.company ? { ...state.company, offices: res.offices } : state.company });
      const next = res.offices.find((o) => !o.archived && !o.error);
      if (next) await actions.openOffice(next.id);
      else set({ officeId: null, canvas: null });
      return true;
    }
    set({ company: state.company ? { ...state.company, offices: res.offices } : state.company });
    return true;
  },

  /** XOÁ HẲN. Không lấy lại được — chỗ gọi phải hỏi xác nhận trước. */
  async removeOffice(id: string): Promise<boolean> {
    const ok = await guard(() => api.removeOffice(id));
    if (!ok) return false;
    if (state.officeId === id) set({ officeId: null });
    await actions.boot();
    return true;
  },

  /** Cất đi / đưa trở lại một NHÂN VIÊN. Khôi phục về đúng văn phòng cũ. */
  async archiveAgent(role: string, archived: boolean): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.archiveAgent(id, role, archived));
    if (!res) return false;
    set({ canvas: res.canvas, ...(archived ? { selected: null } : {}) });
    void actions.refreshCompany();
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

  /** XOÁ HẲN file roles/<id>.yaml. Sổ tay kinh nghiệm vẫn được giữ lại. */
  async removeAgent(role: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.removeAgent(id, role));
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

  /** Nút trên thanh tab: bấm lại tab đang mở thì ĐÓNG. Đó là hành vi của một tab. */
  openPanel(panel: PanelId | null): void {
    const next = state.panel === panel ? null : panel;
    set({ panel: next, ...(next === 'chat' ? { seenMessages: state.messages.length } : {}) });
  },

  /**
   * Mở một ngăn kéo, KHÔNG đảo trạng thái. Dùng cho lối vào từ sơ đồ.
   *
   * Khác `openPanel` ở đúng chỗ quan trọng: bấm node "Tủ tài liệu" hai lần phải
   * là "mở, rồi vẫn mở" — không phải "mở rồi đóng". Người dùng bấm vào một thứ
   * cụ thể để tới nơi cụ thể; ý định luôn là MỞ. Chỉ nút tab mới có nghĩa bật/tắt.
   */
  showPanel(panel: PanelId): void {
    if (state.panel === panel) return;
    // Bảng chi tiết bên phải phải đóng lại: node kho không có gì để hiện ở đó,
    // và để nó mở là một cột rỗng đứng cạnh ngăn kéo vừa mở.
    set({ panel, selected: null, ...(panel === 'chat' ? { seenMessages: state.messages.length } : {}) });
  },

  /**
   * Thả file lên node Tủ tài liệu trên sơ đồ.
   *
   * MỞ PANEL RA luôn, không tải lên im lặng phía sau: người dùng vừa thả một
   * file và họ cần thấy chuyện gì đang xảy ra với nó — bóc xong chưa, có bị từ
   * chối không, có trùng tên không. Một thao tác không có phản hồi thị giác thì
   * lần sau họ thả hai lần.
   */
  dropDocs(files: File[]): void {
    if (files.length === 0) return;
    set({ panel: 'library', selected: null, pendingDocs: files });
  },

  /** Panel nhận lô file rồi dọn ô — nếu không thì mở lại panel là tải lên lần nữa. */
  takeDroppedDocs(): File[] {
    const files = state.pendingDocs ?? [];
    if (files.length) set({ pendingDocs: null });
    return files;
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
      // Việc xong = có thể có kết quả mới trên đĩa. Panel Kết quả tự nạp lại.
      if (e.artifacts.length) set({ artifactsVersion: state.artifactsVersion + 1 });
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
      if (e.assistant === 'planning') bits.push('Trợ lý đang lập kế hoạch…');
      if (e.workers > 0) bits.push(`${e.workers} nhân viên đang làm việc`);
      if (e.queued > 0) bits.push(`${e.queued} tin chờ`);
      if (e.jobs > 0) bits.push(`${e.jobs} việc xếp hàng`);
      // MẠCH KHÔNG ĐƯỢC ĐỨT. Còn `plan_id` nghĩa là còn một công việc đang chạy,
      // nên phải còn một câu gì đó trên màn hình — kể cả ở những nhịp ngắn không
      // ai "bận" theo nghĩa hẹp (vừa lập kế hoạch xong, chưa phóng task đầu).
      // Khoảng im lặng chính là chỗ người dùng tưởng hệ thống chết và bấm lại.
      if (bits.length === 0 && e.plan_id) bits.push('Đang chạy…');
      set({ activity: bits.length ? bits.join(' · ') : null });
      break;
    }

    /**
     * Dọn ô chat. Sự kiện này là một MỆNH LỆNH, không phải một câu để đọc —
     * nên nó không đi vào `messages`.
     *
     * Câu báo kết quả đến NGAY SAU nó bằng `master.message`, và vì thế trở
     * thành dòng đầu tiên của cuộc trò chuyện mới. Người dùng thấy: "Đang
     * dọn…" → màn hình trắng → "Đã dọn xong". Cảm giác dọn rác là THẬT, vì
     * bản ghi hội thoại phía sau cũng vừa bị bỏ thật.
     */
    case 'office.cleared':
      set({ messages: [], seenMessages: 0, activity: null });
      break;

    case 'cost.tick':
      set({ cost: e.totals });
      break;

    case 'knowledge.changed':
      // Bump LUÔN, kể cả khi phát lại từ log: ngăn kéo Tri thức bám vào con số
      // này chứ không bám vào số node, nên nó thấy được cả những thay đổi giữ
      // nguyên số lượng (sửa nội dung, node bị đè, dọn một thêm một).
      set({ knowledgeVersion: state.knowledgeVersion + 1 });
      if (fromLive) void actions.refreshCanvas();
      break;

    /**
     * Tủ tài liệu đổi. Chỉ bump một số đếm — panel tự nạp lại danh sách.
     *
     * `libraryBusy` GHI MỖI LẦN, kể cả khi bằng 0. Ghi có điều kiện là cách một
     * dòng trạng thái mắc kẹt trên màn hình vĩnh viễn: nhánh "hết bận" không
     * ghi gì cả thì giá trị cũ sống mãi. Xem chú thích ở `AppState.libraryBusy`.
     */
    case 'library.changed':
      set({ libraryVersion: state.libraryVersion + 1, libraryBusy: e.busy });
      // Node Tủ tài liệu trên sơ đồ hiện SỐ tài liệu — không nạp lại thì con số
      // đó đứng im và sơ đồ nói sai về chính thứ người dùng vừa làm.
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
