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
  Energy,
  OfficeState,
  PlanStep,
  StepStatus,
  Usage,
} from './types';

export interface ChatMessage {
  id: number;
  /**
   * 'user' · 'assistant' · **hoặc id một NHÂN VIÊN**.
   *
   * Nhánh thứ ba từ 19/08: task `deliver: reply` gửi câu trả lời thẳng từ nhân
   * viên tới người dùng, không qua Trợ lý. Ô chat chỉ tách 'user' ra một bên;
   * mọi vai trò còn lại dùng chung bong bóng bên trái, khác nhau ở cái nhãn tên
   * tra bằng `labelFor(role)`. → docs/SPEC-offices.md §6
   */
  role: string;
  text: string;
  at: number;
  /**
   * Đường dẫn kết quả ĐÃ XÁC MINH đi kèm tin nhắn (tính từ thư mục văn phòng).
   *
   * Chỉ có ở tin do `whereBlock` dựng — tức là do CODE, không phải do model.
   * Đây là danh sách duy nhất được phép biến thành nút bấm được; xem
   * `FileLinks` trong ChatPanel.
   */
  files?: string[];
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
  /**
   * Hạn mức TÀI KHOẢN Claude. → src/core/energy.ts
   *
   * ⚠ Nằm ngay cạnh `cost` nhưng có vòng đời NGƯỢC HẲN, và đó là chỗ dễ sai
   * nhất: `cost` là tiền của một văn phòng trong phiên này nên đổi văn phòng
   * là dọn; `energy` là hạn mức dùng chung với Claude Code và claude.ai của
   * chính người dùng, nên đổi văn phòng KHÔNG được dọn. Xoá nó là xoá một sự
   * thật vẫn còn đúng, rồi để header trống cho tới lượt chạy kế tiếp.
   */
  energy: Energy | null;
  /** Đang chờ Trợ lý trả lời câu vừa gõ. */
  sending: boolean;

  /**
   * BẢN NHÁP đang gõ trong ô chat. SỐNG NGOÀI component, và có bản sao trên đĩa.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG ĐÃ SỬA (20/08): gõ dở, mở tab Tài liệu xem đường dẫn, quay lại —     │
   * │ MẤT SẠCH.                                                                │
   * │                                                                          │
   * │ Sidebar dựng panel bằng `{panel === 'chat' && <ChatPanel />}`, nên đổi   │
   * │ tab là **unmount**, và bản nháp nằm trong `useState` của chính component │
   * │ đó thì chết theo. Đúng thao tác người ta làm nhiều nhất khi soạn một yêu │
   * │ cầu dài: đi tra tên file rồi quay lại.                                   │
   * │                                                                          │
   * │ Thuộc lớp lỗi tệ nhất của dự án — **mất việc của người dùng, im lặng**.  │
   * │ Không có thông báo nào, và người ta chỉ phát hiện khi nhìn vào ô trống.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Sửa ở TẦNG STATE chứ không phải bằng cách giữ panel luôn mounted (`hidden`):
   * ẩn đi thì mọi panel khác cũng phải sống mãi, và ta đổi một bug lấy sáu cây
   * component không bao giờ được dọn.
   *
   * Bản sao `localStorage` lo nốt ca thứ hai — **F5, crash tab, đóng nhầm cửa
   * sổ**. Cùng một nỗi đau, và nếu chỉ chữa nửa trong bộ nhớ thì người dùng học
   * được một luật sai ("đổi tab thì an toàn") rồi mất bài lúc lỡ tay tải lại.
   */
  draft: string;
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

  /**
   * Kết quả người dùng vừa bấm trong ô chat, đang chờ panel Kết quả mở ra.
   *
   * Cùng khuôn `pendingDocs` và cùng lý do: cả luồng xem trước — nạp nội dung,
   * ba nhóm định dạng, trần 2MB, nút tải về — sống ở đúng MỘT chỗ là
   * `ArtifactsPanel`. Ô này là băng chuyền giữa hai cửa vào, không phải một bản
   * sao thứ hai của logic đó.
   */
  revealArtifact: string | null;

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
  energy: null,
  sending: false,
  draft: '',
  activity: null,
  libraryVersion: 0,
  libraryBusy: 0,
  knowledgeVersion: 0,
  artifactsVersion: 0,
  pendingDocs: null,
  revealArtifact: null,
  panel: null,
  selected: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();
let msgSeq = 0;

/**
 * Bản nháp trên đĩa — MỖI VĂN PHÒNG MỘT NGĂN.
 *
 * Dùng chung một khoá thì soạn dở một yêu cầu ở văn phòng Kế toán, ghé sang Nội
 * dung, và câu đó hiện ra trong ô chat của người khác. Văn phòng độc lập hoàn
 * toàn là luật gốc của sản phẩm; nó phải đúng cả ở những chỗ nhỏ thế này.
 *
 * Mọi lời gọi đều nuốt lỗi: `localStorage` ném khi hết quota hoặc khi trình
 * duyệt chặn cookie/storage. Một bản nháp không lưu được là chuyện đáng tiếc;
 * một màn hình trắng vì nó thì không chấp nhận được.
 */
const draftKey = (officeId: string): string => `agentco:draft:${officeId}`;

/**
 * Văn phòng đang mở — nhớ qua F5 và qua mọi lần tắt tab.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG 21/08: `officeId` chỉ sống trong BỘ NHỚ.                             │
 * │                                                                          │
 * │ `bootstrap` giữ lại lựa chọn cũ (`state.officeId`) — nhưng sau F5 thì     │
 * │ state đã reset, `officeId` là `null`, nên nó luôn rơi về                  │
 * │ `company.offices[0]` = văn phòng đầu tiên theo alphabet. Người dùng thoát │
 * │ ở "Rà hợp đồng", quay lại thấy "Bản địa hoá", mỗi lần.                    │
 * │                                                                          │
 * │ Cùng lớp với bug "model nhớ, màn hình quên": trạng thái sống trong RAM    │
 * │ thì tắt cái là mất, và người dùng không có cách nào biết vì sao.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `localStorage` chứ không phải server: đây là VIEW STATE của một trình duyệt
 * cụ thể. Hai tab mở hai văn phòng khác nhau là chuyện hợp lệ, và nhét nó lên
 * server thì tab này đá tab kia.
 */
const LAST_OFFICE = 'agentco:office';

function readLastOffice(): string | null {
  try {
    return localStorage.getItem(LAST_OFFICE);
  } catch {
    return null;
  }
}

function writeLastOffice(id: string): void {
  try {
    localStorage.setItem(LAST_OFFICE, id);
  } catch {
    /* hết quota / chế độ riêng tư — mất trí nhớ chỗ này không đáng làm sập gì */
  }
}

function readDraft(officeId: string): string {
  try {
    return localStorage.getItem(draftKey(officeId)) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(officeId: string | null, text: string): void {
  if (!officeId) return;
  try {
    if (text) localStorage.setItem(draftKey(officeId), text);
    else localStorage.removeItem(draftKey(officeId));
  } catch {
    /* hết chỗ hoặc bị chặn — bản trong bộ nhớ vẫn chạy đúng */
  }
}

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
    /**
     * Thứ tự ba nước: văn phòng ĐANG mở → văn phòng mở LẦN CUỐI → cái đầu tiên.
     *
     * Nước hai là nước mới (21/08) và là nước cứu ca F5: sau khi tải lại trang
     * thì nước một luôn trượt vì state đã reset. Vẫn phải đối chiếu với danh
     * sách thật — văn phòng có thể đã bị xoá hoặc cất đi từ phiên trước, và mở
     * một id không còn tồn tại thì màn hình trắng.
     */
    const wanted = [state.officeId, readLastOffice()].find(
      (id) => id && company.offices.some((o) => o.id === id),
    );
    await actions.openOffice(wanted ?? company.offices[0]!.id);
    set({ loading: false });
  },

  /** Mở một văn phòng. Xoá sạch state của văn phòng cũ — không trộn hai luồng. */
  async openOffice(id: string): Promise<void> {
    // Ghi NGAY, không đợi tải xong: người dùng đóng tab giữa lúc đang tải thì
    // lần sau vẫn phải quay lại đúng chỗ họ vừa chọn.
    writeLastOffice(id);
    set({
      officeId: id,
      canvas: null,
      plan: null,
      messages: [],
      seenMessages: 0,
      live: {},
      cost: null,
      // ⚠ `energy` CỐ Ý không có ở đây. Hạn mức là của TÀI KHOẢN, không của văn
      // phòng — dọn nó lúc đổi chỗ làm là xoá một sự thật vẫn còn đúng, rồi để
      // header trống cho tới lượt chạy kế tiếp. → `AppState.energy`
      selected: null,
      // Tủ tài liệu là của TỪNG văn phòng. Không dọn thì mở văn phòng khác vẫn
      // thấy "đang đọc 2 tài liệu" của văn phòng vừa rời đi.
      libraryBusy: 0,
      // Bản nháp cũng của TỪNG văn phòng: đọc lại đúng ngăn của văn phòng vừa
      // mở, không mang câu đang soạn ở chỗ khác sang đây.
      draft: readDraft(id),
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

  /**
   * Nạp lại danh sách văn phòng — và TỰ CHỮA nếu văn phòng đang mở biến mất.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐÂY LÀ CHỖ CỨU CẢ CA "TAB KHÁC", thứ mà response của PATCH không với tới.│
   * │                                                                          │
   * │ Đổi tên văn phòng có thể đổi luôn `id` (thư mục dời theo). Tab BẤM nút   │
   * │ thì nhận `id` mới trong response và tự cập nhật. Nhưng **tab thứ hai**   │
   * │ đang mở cùng văn phòng thì không gọi gì cả — nó chỉ nghe SSE, và         │
   * │ `state.officeId` của nó vẫn là id cũ. Từ đó mọi lời gọi 404, và người    │
   * │ dùng thấy toast *"Không có văn phòng …"* cho một thao tác đã thành công. │
   * │                                                                          │
   * │ Nên bất biến phải là: **`officeId` không bao giờ trỏ tới một id server   │
   * │ không có.** Kiểm ở đây vì đây là chỗ DUY NHẤT biết danh sách thật vừa    │
   * │ đổi — và nó chạy cho mọi tab, không chỉ tab vừa bấm.                     │
   * │                                                                          │
   * │ `hint` là `event.office` của `company.offices`: nó mang id MỚI, nên tab  │
   * │ kia đi thẳng tới đúng văn phòng thay vì rơi về cái đầu danh sách.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async refreshCompany(hint?: string): Promise<void> {
    const company = await guard(() => api.company());
    if (!company) return;
    set({ company });

    const id = state.officeId;
    if (!id || company.offices.some((o) => o.id === id)) return;
    // Văn phòng đang mở không còn trong danh sách: hoặc vừa đổi id (đổi tên có
    // dời thư mục), hoặc vừa bị xoá ở tab khác. Cả hai đều phải đi tiếp, không
    // được đứng lại ở một id chết.
    const next = hint && company.offices.some((o) => o.id === hint) ? hint : company.offices[0]?.id;
    if (next) await actions.openOffice(next);
    else set({ officeId: null, canvas: null });
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
   * Đổi tên văn phòng.
   *
   * Server trả về cả danh sách văn phòng đã cập nhật, nên không cần thêm một
   * vòng `GET /api/company` nữa; ô chọn ở đầu màn hình đổi tên ngay lập tức.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MÃ VĂN PHÒNG CÓ THỂ ĐỔI THEO — phải bám lấy `res.id`. (22/08)           │
   * │                                                                          │
   * │ Từ 22/08, đổi tên mà tên mới cho ra một slug thật thì **thư mục dời theo**│
   * │ và `id` đổi (`Company.renameTarget`). Bản trước của khối này ghi *"mã giữ │
   * │ nguyên — không có gì phải mở lại"* và không đụng tới `officeId`.          │
   * │                                                                          │
   * │ Không sửa thì `state.officeId` còn trỏ id CŨ: mọi lời gọi sau đó (chat,   │
   * │ canvas, tủ tài liệu) đi tới một văn phòng không còn tồn tại và trả 404 —  │
   * │ người dùng vừa đổi tên xong thì màn hình chết, mà không có gì giải thích. │
   * │                                                                          │
   * │ `writeLastOffice` cũng phải theo, nếu không mở lại app là quay về đúng    │
   * │ cái id đã biến mất.                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async renameOffice(name: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { name }));
    if (!res) return false;
    const moved = res.id !== id;
    if (moved) writeLastOffice(res.id);
    set({
      ...(moved ? { officeId: res.id } : {}),
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

  /**
   * Đổi tên hiển thị của Trợ lý. → `Office.renameAssistant`
   *
   * Khác `setAssistantTier` ở cái giá, dù hai nút nằm cạnh nhau: tên KHÔNG nằm
   * trong prompt của ai, nên không ghi lại cache, không mất trí nhớ, không đụng
   * session. Sửa thoải mái.
   */
  async renameAssistant(name: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { assistant_name: name }));
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

  /** Người dùng gõ một phím. Ghi cả vào bộ nhớ lẫn đĩa — xem `draft`. */
  setDraft(text: string): void {
    set({ draft: text });
    writeDraft(state.officeId, text);
  },

  /**
   * Gửi bản nháp đang có. Không nhận tham số: **ô chat không còn giữ chữ nữa**,
   * nên nguồn sự thật duy nhất là `state.draft`.
   */
  async say(): Promise<void> {
    const id = state.officeId;
    const text = state.draft.trim();
    if (!id || !text || state.sending) return;

    /**
     * XOÁ Ô CHAT NGAY, NHƯNG GIỮ MỘT BẢN ĐỂ TRẢ LẠI NẾU GỬI HỎNG.
     *
     * Xoá ngay là bắt buộc cho tiêu chí "mượt": thao tác phải phản hồi trước
     * khi server trả lời. Nhưng bản trước xoá xong là **hết** — mất mạng đúng
     * lúc bấm Gửi thì câu vừa gõ biến mất và chỉ còn một cái toast đỏ. Người ta
     * gõ dài mấy trăm chữ rồi mất trắng vì một cú mạng chập.
     */
    actions.setDraft('');
    set({ sending: true, activity: 'đang đọc yêu cầu…' });
    // KHÔNG tự thêm tin nhắn của mình vào đây: server phát lại nó dưới dạng
    // sự kiện (role: 'user') để mọi tab và Telegram bridge cùng thấy một luồng.
    // `say` giờ trả về NGAY sau khi bỏ tin vào hòm thư — mọi cập nhật tiếp theo
    // đến bằng sự kiện `office.activity`, nên đừng tự tắt dòng trạng thái ở đây.
    const ok = await guard(() => api.say(id, text));
    set({ sending: false });
    // `guard` đã hiện lỗi rồi; việc ở đây là **trả lại chữ cho người ta**. Chỉ
    // trả khi ô còn trống: họ có thể đã gõ câu khác trong lúc chờ, và đè lên
    // chữ mới là mất việc của người dùng lần thứ hai.
    if (ok === undefined && !state.draft) actions.setDraft(text);
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

  /**
   * Bấm một đường dẫn kết quả trong ô chat → mở panel Kết quả và bật xem trước.
   * → docs/SPEC-ui.md · docs/SPEC-artifacts.md §2.5
   *
   * `showPanel` chứ không `openPanel`: ý định ở đây luôn là MỞ. Bấm hai đường
   * dẫn liên tiếp mà cái thứ hai đóng panel lại thì đó là một cái bẫy.
   */
  revealArtifact(path: string): void {
    set({ panel: 'artifacts', selected: null, revealArtifact: path });
  },

  /**
   * Panel nhận yêu cầu rồi dọn ô.
   *
   * Dọn NGAY cả khi không tìm thấy file: giữ lại thì lần sau người dùng mở panel
   * Kết quả vì việc khác hẳn cũng bị bật lên một cửa sổ xem trước họ không hề
   * yêu cầu — và họ sẽ không hiểu nó từ đâu ra.
   */
  takeRevealArtifact(): string | null {
    const p = state.revealArtifact;
    if (p) set({ revealArtifact: null });
    return p;
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
      // `e.office` mang id MỚI khi đổi tên làm dời thư mục — chuyển tiếp làm
      // gợi ý để tab nào đang mở id cũ đi thẳng tới đúng chỗ. → `refreshCompany`
      void actions.refreshCompany(e.office ?? undefined);
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

/**
 * Hẹn giờ tắt câu trạng thái TẠM (`office.activity.note`). → SPEC-offices.md §4.6
 *
 * Một biến duy nhất, không phải một bảng: mỗi lúc chỉ có đúng một dòng trạng
 * thái trên màn hình, nên hai câu tạm chồng nhau thì câu sau thắng — và bộ đếm
 * của câu trước phải bị huỷ, nếu không nó sẽ xoá nhầm câu đang hiện.
 */
let noteTimer: ReturnType<typeof setTimeout> | undefined;

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
      const messages = [
        ...state.messages,
        {
          id: ++msgSeq,
          role: e.role,
          text: e.say,
          at: Date.now(),
          // Chuyển tiếp NGUYÊN VẸN, không suy diễn thêm gì. Giao diện không bao
          // giờ tự dò đường dẫn trong `text` — xem chú thích ở `master.message`
          // trong core/types.ts để biết vì sao đó là luật cứng.
          ...(e.files?.length ? { files: e.files } : {}),
        },
      ];
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
      /**
       * `note` ĐÈ LÊN dòng dựng từ con số, rồi tự tắt. → SPEC-offices.md §4.6
       *
       * Đây là chỗ `/clear` nói chuyện. Nó KHÔNG vào `messages`, nên dọn xong
       * ô chat trắng thật — quá trình hiện rồi biến, chỉ kết quả mới ở lại, y
       * hệt khuôn `…thinking` → trắng.
       *
       * Hẹn giờ được HUỶ nếu một `office.activity` khác tới trước: nếu không,
       * bộ đếm cũ sẽ xoá mất dòng trạng thái của việc MỚI vừa bắt đầu.
       */
      if (e.note) {
        if (noteTimer) clearTimeout(noteTimer);
        noteTimer = undefined;
        set({ activity: e.note });
        /**
         * ⚠ VẮNG `hold_ms` = GIỮ CHO TỚI SỰ KIỆN KẾ TIẾP. KHÔNG có mặc định.
         *
         * BUG ĐÃ SỬA (20/08): người dùng báo *"/clear vẫn khựng 3–5 giây không
         * thông báo gì"*. Bản trước đọc "vắng mặt" thành `?? 4_000` — mà nén
         * trí nhớ mất 5–15 giây, nên dòng "Đang dọn…" **tự tắt lúc 4 giây
         * trong khi việc vẫn đang chạy**, để lại đúng khoảng im lặng mà cả cơ
         * chế này sinh ra để lấp.
         *
         * Hai loại `note` có vòng đời ngược nhau, và server ĐÃ phân biệt sẵn:
         * `emitNote()` (kết quả đã xong) luôn gửi `hold_ms`; nhánh `clearing`
         * (việc đang chạy) không bao giờ gửi. Chỉ client đọc sai.
         *
         * → core/types.ts `office.activity`
         */
        if (e.hold_ms === undefined) break;
        noteTimer = setTimeout(() => {
          noteTimer = undefined;
          // Chỉ xoá nếu chưa ai ghi đè — tránh nuốt dòng trạng thái của một
          // việc vừa được giao ngay sau lệnh dọn.
          if (state.activity === e.note) set({ activity: null });
        }, e.hold_ms);
        break;
      }
      if (noteTimer) {
        clearTimeout(noteTimer);
        noteTimer = undefined;
      }

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

    // ⚠ KHÔNG dọn ở chỗ đổi văn phòng — xem chú thích ở `AppState.energy`.
    case 'energy.tick':
      set({ energy: e.energy });
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
