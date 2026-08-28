/**
 * Kiểu khớp với backend. Nguồn sự thật là `src/core/types.ts` và
 * `src/core/office.ts` — file này là bản sao thủ công, không sinh tự động.
 *
 * Chấp nhận trùng lặp vì hai bên build riêng và không import chéo được.
 * Đổi bên kia thì phải đổi ở đây; `npm run typecheck` của web sẽ không bắt được.
 */

// Kích thước node và phép toán bố cục dùng CHUNG với backend — không còn bản
// sao thủ công. → src/core/layout-geometry.ts
export { NODE_SIZE } from '@core/layout-geometry';
export type { NodeKind } from '@core/layout-geometry';

import type { NodeKind } from '@core/layout-geometry';

export type OfficeState = 'idle' | 'working' | 'paused' | 'stopped';
export type StepStatus = 'pending' | 'running' | 'done' | 'problem' | 'waiting_human';
export type PlanStatus =
  | 'planning'
  | 'running'
  | 'done'
  | 'failed'
  /** Chưa THỬ vì Trợ lý còn thiếu thông tin và đã hỏi lại. Khác `failed` (đã thử và hỏng). */
  | 'blocked'
  | 'paused'
  | 'stopped';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  model: string;
  turns: number;
}

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  role?: string;
  server?: string;
  label: string;
  avatar?: string;
  /** Mức model: `eco` | `standard` | `deep`. */
  tier?: string;
  /** Model thật sự sẽ chạy ở mức đó, ví dụ `claude-sonnet-5`. */
  model?: string;
  /** Chỉ Trợ lý: mức đang thừa hưởng `models.master` của công ty, không đặt riêng. */
  tierInherited?: boolean;
  pitch?: string;
  /** Trần chi phí một việc, đơn vị USD. **`0` = không giới hạn.** */
  maxUsd?: number;
  maxTurns?: number;
  /**
   * Nhân viên: có `Bash` không.
   *
   * ⚠ KHÔNG mô tả nó là *"tool duy nhất ra được khỏi văn phòng"* (câu cũ). Đọc
   * thì `Read`/`Glob`/`Grep` cũng ra được, mà ghi thì `outputScoper` luôn kéo
   * đầu ra về `artifacts/` nên `Bash` chưa bao giờ được trỏ ra ngoài. Thứ nó
   * thật sự độc quyền: **metadata file** (kích thước · ngày sửa) và chạy script.
   * → SPEC-tools-approval.md §1a
   */
  bash?: boolean;
  count?: number;
  /** Cánh tay: nấc quyền — huy hiệu vẽ từ đây, **KHÔNG** từ `label`. → §6j */
  level?: 'read' | 'add' | 'full';
  /** Cánh tay: số việc đã cấp, để nhãn "chỉ đọc" kiểm được bằng mắt. */
  toolCount?: number;
  /** Cánh tay: tên WORKSPACE nó nối tới — tra từ kho OAuth, không đọc `label`. */
  via?: string;
  /**
   * Cánh tay: đường dẫn SVG logo hãng + loại — để node vẽ **cùng một hình** với
   * hộp thoại Kết nối. Server gửi kèm (`office.ts §mark`) chứ canvas không tra
   * danh mục: sơ đồ vẽ trước khi ai mở hộp thoại, và một node không có hình ở
   * mỗi lần mở app là cái giá không đáng.
   */
  mark?: string;
  armKind?: 'files' | 'service' | 'custom';
  mcp?: string[];
  /**
   * Cánh tay: thư mục nó với tới, **nguyên văn** như trong `company.yaml`.
   *
   * CHỈ ĐỌC. Đổi thư mục = đổi `armHash` = một cánh tay khác, nên đường đi đúng
   * là cắm một kết nối mới chứ không phải sửa ô này. Rỗng = không phải cánh tay
   * file (Notion, GitHub…) — khi đó đừng vẽ ô nào cả, một ô trống nói dối rằng
   * cấu hình bị thiếu.
   */
  folders?: string[];
  hue?: number;
  missing: boolean;
  connected: boolean;
  removable: boolean;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  knowledge: { shared: number; total: number };
}

export interface OfficeSummary {
  id: string;
  name: string;
  avatar: string;
  state: OfficeState;
  agents: number;
  onDuty: number;
  knowledge: number;
  /** Đã cất vào lưu trữ — đóng băng, chỉ đọc, khôi phục được. */
  archived: boolean;
  plan_id: string | null;
  error?: string;
}

/** Nhân viên đang nằm trong lưu trữ. Khôi phục về đúng văn phòng cũ. */
export interface ArchivedAgent {
  role: string;
  label: string;
  avatar: string;
  pitch: string;
  notes: number;
}

export type Tier = 'eco' | 'standard' | 'deep';

/** Mức nào chạy model nào — cấu hình cấp CÔNG TY (một hoá đơn, một chỗ để siết). */
export interface CompanyModels {
  eco: string;
  standard: string;
  deep: string;
  /** Mức mặc định của Trợ lý mọi văn phòng. Văn phòng ghi đè được. */
  master: Tier;
  /** Mức cho khâu lập kế hoạch — chạy ở query riêng nên không phá cache Trợ lý. */
  planner: Tier;
}

export interface CompanyView {
  name: string;
  offices: OfficeSummary[];
  allowCorePromptEdit: boolean;
  models: CompanyModels;
}

export interface PlanStep {
  title: string;
  status: StepStatus;
}

export interface PlanRecord {
  plan_id: string;
  office: string;
  request: string;
  status: PlanStatus;
  started_at: string;
  ended_at?: string;
  steps: PlanStep[];
  tasks_done: number;
  tasks_total: number;
  costUSD: number;
  turns: number;
  report?: string;
}

export interface PromptLayer {
  id: string;
  title: string;
  editable: boolean;
  file?: string;
  text: string;
  tokens: number;
  /** Ví dụ THẬT hiện mờ khi lớp trống. Không bao giờ được lưu → 0 token. */
  placeholder?: string;
  /** Trần token — UI cảnh báo khi gõ vượt, server từ chối lưu. */
  limit?: number;
  frontmatter?: boolean;
  note: string;
}

export interface KnowledgeEntry {
  id: string;
  file: string;
  title: string;
  tags: string[];
  scope: string;
  tokens: number;
  hits: number;
  pinned: boolean;
  confidence: number;
  /** Đã bị một node mới đè — còn file, không còn đi vào prompt của ai. */
  superseded: boolean;
  body: string;
  updated: string;
}

/**
 * Một tài liệu trong tủ. → docs/SPEC-library.md
 *
 * PHẢI khớp `DocRecord` trong `src/library/store.ts`.
 */
export type DocState = 'pending' | 'extracting' | 'ready' | 'image-only' | 'unindexed' | 'failed';

export interface LibraryDoc {
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  state: DocState;
  /** "34 trang" · "3 sheet: Tháng 7, Tổng" — dựng bằng code, không qua model. */
  shape?: string;
  preview?: string;
  tokens?: number;
  pages?: number;
  /** Câu giải thích khi state khác `ready`. Luôn kèm việc phải làm. */
  note?: string;
  extracted_at?: string;
}

/**
 * Một kết quả nhân viên làm ra. → docs/SPEC-artifacts.md
 *
 * PHẢI khớp `ArtifactRecord` trong `src/core/artifacts.ts`.
 */
export type ArtifactView = 'text' | 'markdown' | 'csv' | 'code' | 'image' | 'pdf' | 'video' | 'download';

export interface ArtifactRecord {
  path: string;
  name: string;
  ext: string;
  bytes: number;
  mtime: string;
  /** Rỗng với kết quả cũ, sinh ra trước khi đường dẫn được đóng khung theo kế hoạch. */
  plan_id: string;
  task_id: string;
  view: ArtifactView;
  /**
   * TÊN VIỆC đã sinh ra file này — `PlanRecord.request`, server tra sẵn.
   *
   * Rỗng khi kế hoạch đã rơi khỏi `tasks/index.json` (trần 200 bản ghi) hoặc
   * với kết quả cũ chưa đóng khung theo kế hoạch. Giao diện rơi về nhãn ngày
   * giờ — suy giảm êm, không phải lỗi. → docs/SPEC-artifacts.md §2.1
   */
  plan_title: string;
}

export interface OfficeDetail {
  id: string;
  name: string;
  state: OfficeState;
  plan: { plan_id: string; request: string; steps: PlanStep[] } | null;
  pending: number;
  knowledge: number;
  /** Hội thoại đọc từ đĩa — sống sót qua mọi lần tắt daemon. */
  chat?: AgentEvent[];
  /** Vòng đệm trong bộ nhớ của daemon: trạng thái SỐNG, mất khi daemon tắt. */
  history: AgentEvent[];
}

interface EventBase {
  office: string;
  plan_id: string | null;
  /** Chỉ có ở sự kiện đọc từ file log, không có ở sự kiện đến qua SSE. */
  ts?: string;
}

export type AgentEvent = EventBase &
  (
    | { type: 'plan.created'; plan_id: string; request: string; steps: PlanStep[] }
    | { type: 'plan.step'; step: number; status: StepStatus }
    /**
     * ⚠ CỐ Ý không có `say` — phải khớp `AgentEventBody` ở `src/core/types.ts`.
     *
     * Server KHÔNG BAO GIỜ gửi trường đó (`office.ts` → `finish()`): câu báo cáo
     * đã đi bằng `master.message` ngay trước đó. Khai `say` ở đây là một kiểu
     * NÓI DỐI — TypeScript sẽ gật đầu cho `e.say`, và lúc chạy nó là `undefined`.
     */
    | { type: 'plan.finished'; status: PlanStatus; costUSD: number; turns: number }
    | { type: 'task.started'; task_id: string; role: string; say: string }
    | { type: 'task.progress'; task_id: string; role: string; say: string }
    | {
        type: 'task.done';
        task_id: string;
        role: string;
        say: string;
        status: 'done' | 'failed' | 'blocked' | 'needs_human';
        artifacts: string[];
        usage: Usage;
      }
    | { type: 'task.blocked'; task_id: string; role: string; say: string; reason: string }
    /**
     * `role` = 'user' · 'assistant' · **hoặc id một NHÂN VIÊN**.
     *
     * Nhánh thứ ba là task `deliver: reply`: câu trả lời đi thẳng từ nhân viên
     * tới người dùng, không qua Trợ lý. `say` không chứa tên người nói — bên
     * hiển thị tự tra. → docs/SPEC-offices.md §6
     */
    /**
     * `files` — đường dẫn kết quả đã xác minh, dạng DỮ LIỆU. → core/types.ts
     *
     * Chỉ có mặt ở tin do `whereBlock` dựng bằng code. Đây là danh sách DUY
     * NHẤT được phép biến thành nút bấm được: dò đường dẫn bằng regex trên
     * `say` là cho một câu model bịa mượn uy tín của giao diện.
     */
    | { type: 'master.message'; say: string; role: string; files?: string[] }
    | { type: 'office.state'; say: string; state: OfficeState }
    | {
        type: 'office.activity';
        assistant: 'idle' | 'thinking' | 'planning';
        workers: number;
        queued: number;
        jobs: number;
        /**
         * Câu trạng thái TẠM, đè lên dòng dựng từ các con số trên. Tự xoá sau
         * `hold_ms`. Đây là đường nói chuyện của `/clear`, thay cho hai tin nhắn
         * cũ. → docs/SPEC-offices.md §4.6
         */
        note?: string;
        hold_ms?: number;
      }
    | { type: 'office.cleared'; say: string }
    | { type: 'cost.tick'; totals: Usage & { tasks: number } }
    /** Hạn mức TÀI KHOẢN đổi — không dọn khi đổi văn phòng. Xem `Energy`. */
    | { type: 'energy.tick'; energy: Energy }
    | { type: 'knowledge.changed'; count: number; version: number }
    | { type: 'library.changed'; count: number; busy: number }
    | { type: 'layout.changed'; say: string }
    | { type: 'company.offices'; say: string }
  );

/**
 * Luật nối dây — BẢN SAO của `CAN_CONNECT` trong `src/core/layout.ts`.
 *
 * Ở client nó phục vụ việc làm cho thao tác sai KHÔNG XẢY RA ĐƯỢC (không vẽ ra
 * được sợi dây trái luật). Server mới là chỗ thi hành thật — client nào cũng
 * POST thẳng được.
 *
 * `agent` cố tình vắng mặt: agent nói chuyện trực tiếp với agent là nguồn đốt
 * token lớn nhất trong mọi hệ multi-agent.
 */
/**
 * ⚠ PHẢI KHỚP `src/core/layout.ts §CAN_CONNECT` — server là nơi thi hành thật,
 * bảng này chỉ để giao diện không vẽ ra thứ server sẽ từ chối.
 *
 * `mcp → assistant` đã GỠ 23/08: sợi dây đó không làm gì (`assistant.mcp` chỉ
 * được ghi rồi đọc lại để vẽ), và nếu có ngày nó chạy thật thì Trợ lý cầm MCP
 * = ~36 000 token mỗi lượt trò chuyện. Chi tiết ở `layout.ts`.
 */
export const CAN_CONNECT: Partial<Record<NodeKind, readonly NodeKind[]>> = {
  assistant: ['agent'],
  mcp: ['agent'],
};

export function canConnect(from: CanvasNode, to: CanvasNode, edges: readonly CanvasEdge[]): boolean {
  if (from.id === to.id) return false;
  if (!CAN_CONNECT[from.kind]?.includes(to.kind)) return false;
  return !edges.some((e) => e.from === from.id && e.to === to.id);
}

// ─────────────────────────────────────────────────────────── hạn mức tài khoản

/**
 * Hạn mức của TÀI KHOẢN Claude, không phải của công ty.
 * → src/core/energy.ts · docs/SPEC-token-economy.md §5e
 *
 * Cùng cái quota mà Claude Code và claude.ai của chính người dùng đang tiêu.
 * Vì thế nó KHÔNG bị dọn khi đổi văn phòng — khác hẳn `cost`.
 */
export interface EnergyWindow {
  /** Chỉ hai — không tách theo model. Xem chú thích ở `energy.ts`. */
  kind: 'session' | 'weekly';
  status: 'allowed' | 'allowed_warning' | 'rejected';
  /** ISO 8601, hoặc null khi server không gửi. */
  resetsAt: string | null;
  /**
   * 0-100. `null` khi chưa lấy được số. Không có số thì **KHÔNG vẽ thanh** —
   * một cái thanh 0% là nói dối về thứ ta không biết.
   */
  utilization: number | null;
}

export interface Energy {
  /** Thứ tự CỐ ĐỊNH: phiên rồi tuần. */
  windows: EnergyWindow[];
  /** `pro` · `max` … · `null` khi chạy bằng API key. */
  plan: string | null;
  seenAt: string;
}

// ─────────────────────────────────────────────────────────── cánh tay (MCP)
// → docs/SPEC-arms.md §4e · §6

/** Một mục danh mục — thứ người dùng "rút ra xài được ngay". */
export interface CatalogArm {
  id: string;
  name: string;
  /** Icon TRUNG TÍNH của ta, không phải logo bên thứ ba. → SPEC-arms.md §11c */
  icon: string;
  blurb: string;
  /**
   * Câu phụ trên thẻ nói CÁI GIÁ, không nói tính năng: người dùng chọn theo
   * CÔNG SỨC bỏ ra, không theo tên hãng.
   */
  price: 'none' | 'keys' | 'login';
  transport: 'stdio' | 'http';
  secrets: { name: string; label: string; help: string }[];
  /** Cánh tay cần danh sách thư mục được phép. Đó CHÍNH LÀ allowlist. */
  folders?: { label: string; help: string };
  /** Cho chọn nấc quyền lúc cắm (Chỉ đọc / +Thêm / Toàn quyền). → §6j */
  tiered?: boolean;
  /** Cần ĐĂNG NHẬP thay vì gõ chìa. Suy từ `spec` ở server, không khai tay. */
  needsLogin?: boolean;
  /**
   * Đăng nhập bằng **mã thiết bị** thay vì mở tab rồi chờ tab đó xong.
   *
   * Hai luồng khác nhau ở đúng thứ người dùng nhìn thấy, nên giao diện phải
   * biết: web flow bảo họ *"xong ở tab kia thì đây tự cập nhật"*; mã thiết bị
   * hiện **một mã ngay tại đây** và tự hỏi thăm. Bày nhầm luồng là bảo người ta
   * chờ một tab sẽ không bao giờ báo về. → SPEC-arms §5h·7
   */
  deviceLogin?: boolean;
  /**
   * Nhóm việc cho người dùng tick. Không có ⇒ cắm cả server. → §5h·7e
   *
   * `label` giữ **tên của hãng** (tra được trong tài liệu hãng), `help` nói việc
   * làm được. Đừng gộp hai vai vào một chuỗi. → `catalog.ts §ArmGroup`
   */
  groups?: { id: string; label: string; help?: string; on?: boolean }[];
  /**
   * Ô tick **cách chạy** — độc lập nhau, hỏi ở mọi nấc. → `catalog.ts §ArmOption`
   *
   * `loopbackOnly` = chỉ hiện khi trình duyệt và daemon cùng máy (cửa sổ trình
   * duyệt mở trên máy chạy daemon). Giao diện ẩn nó; **cổng thật ở server**.
   */
  options?: { id: string; label: string; help: string; on?: boolean; loopbackOnly?: boolean }[];
  /**
   * HÀNG RÀO NGOÀI — phạm vi do HÃNG giữ, ta chỉ mở cửa. → `catalog.ts §scope`
   * Không có ⇒ mục này không có màn hình đồng ý nào để đi tới.
   */
  scope?: { say: string; url: string; help: string };
  /**
   * TRA BẢN CÀI APP tự động. → `catalog.ts §repoScan` · SPEC-arms §5h·7o
   *
   * Có nó nghĩa là mục này trả lời được câu mà `tools/list` không trả lời được:
   * *"hãng cho cánh tay này đụng repo nào"*. Giao diện chỉ cần biết CÓ hay
   * KHÔNG — tên tool nằm ở server, đúng chỗ nó được gọi.
   */
  repoScan?: Record<string, never> | object;
  /**
   * Hãng này cắt việc **ngay ở server** theo nấc quyền. → `catalog.ts §serverFenced`
   *
   * Giao diện cần biết vì con số token đo được là **trần**: phép thử cố ý chạy
   * không mang hàng rào (mang thì bộ chọn nấc không bao giờ hiện), nên ở nấc dưới
   * thực tế tốn ít hơn số hiện ra. Không nói ra là để người dùng đọc một con số
   * đúng cho một cấu hình họ không chọn.
   */
  serverFence?: boolean;
  /**
   * Hồ sơ thương hiệu — và **logo sống trong đó**. → `catalog.ts §brand`
   *
   * `mark` là đường dẫn SVG 24×24 đơn sắc. Nó ở cạnh `checkedOn` để luật §11c
   * (*"chưa đọc quy tắc hãng ⇒ không dùng logo"*) còn nhìn thấy được thứ nó nói
   * về — bảng logo để riêng ở thư mục web thì luật thành lời hứa.
   */
  brand: {
    owner: string | null;
    guidelineUrl: string | null;
    checkedOn: string | null;
    mark?: string;
  };
}

/**
 * Workspace đã nối. **Tên và nhãn, không bao giờ token.**
 *
 * "Workspace" chứ không phải "tài khoản": kiến trúc Notion là 1 tài khoản ⇄ N
 * workspace, và mỗi lần cấp quyền OAuth gắn với **một** workspace.
 */
/**
 * MỘT lời gọi MCP đã xảy ra. → `core/audit.ts` · SPEC-arms §6k
 *
 * Bản ghi **kiểm toán**, không phải bản ghi tiến độ: nó có `args`, và `args`
 * chính là toàn bộ lý do nó tồn tại. Không có tham số thì dòng log chỉ nói
 * *"đã gọi update_page"* — đúng bằng thứ đã có, và đã thấy là không đủ.
 */
export interface ArmCall {
  ts: string;
  server: string;
  tool: string;
  role: string;
  plan_id?: string;
  task_id?: string;
  args: string;
  /** Tham số bị cắt vì quá dài — nói ra, đừng để người đọc tưởng đó là tất cả. */
  truncated?: boolean;
}

export interface OAuthAccount {
  name: string;
  label?: string;
  expiresAt?: number;
  /** Cánh tay đang dùng chìa này. Rỗng ⇒ gỡ được ngay, không cần hỏi server. */
  usedBy: string[];
  /**
   * Chìa đã chết — phải **đăng nhập lại**, chờ không khỏi. Lý do nguyên văn.
   *
   * Không có trường này thì triệu chứng duy nhất là cánh tay 401 im lặng lúc
   * một nhân viên đang làm việc — xa nguyên nhân, và câu 401 nói *"chìa sai"*
   * chứ không nói *"chìa chết"*.
   */
  dead?: string;
}

/**
 * Một mục trong SỔ CHUNG của công ty. → docs/SPEC-arms.md §6i
 *
 * `id` là **băm cấu hình**, không phải tên — nó không bao giờ lên màn hình.
 * `label` là thứ người dùng đọc và đổi được.
 */
export interface InstalledArm {
  id: string;
  label: string;
  catalog?: string;
  config: unknown;
  /**
   * TÊN chìa, không bao giờ giá trị. Giá trị nằm ở `.state/secrets.json` cấp
   * CÔNG TY và không bao giờ đi qua HTTP — đó chính là lý do "dùng lại" ở một
   * văn phòng khác không phải điền lại gì. → `company.ts §reuseArm`
   */
  secrets: string[];
  /**
   * Nấc quyền. Giao diện vẽ **huy hiệu** từ đây, KHÔNG từ chuỗi tên.
   *
   * ⚠ Nhét mức quyền vào `label` thì một cú đổi tên tạo ra được *"Notion (ghi
   * được)"* trên một cánh tay chỉ đọc — nhãn nói dối về đặc quyền. → §6j
   */
  level?: 'read' | 'add' | 'full';
  /**
   * Tên WORKSPACE cánh tay này nối tới — server tra từ `arms[].secrets` ra kho
   * OAuth. Không đọc chuỗi `label`: nhãn là của người dùng và đổi tự do, còn
   * workspace là sự thật thuộc về cấu hình. Vắng ⇒ không dùng OAuth, hoặc
   * workspace đã bị gỡ; cả hai đều là "không biết" ⇒ không vẽ gì.
   */
  via?: string;
  /** Số việc đã cấp — hiện cạnh huy hiệu để nhãn kiểm được bằng mắt. */
  toolCount: number;
  usedBy: { office: string; role: string }[];
  /**
   * Không văn phòng nào còn giữ — kể cả kiểu "có mặt trên sơ đồ mà chưa nối
   * dây". Chỉ mục như thế mới hiện nút **xoá hẳn**. ⚠ Đừng tự suy từ `usedBy`:
   * nó chỉ đếm sợi dây, nên một node đang nằm chờ sẽ trông như mồ côi.
   */
  orphan: boolean;
}

/**
 * Kết quả bắt tay. `status` có NĂM giá trị, không phải hai — `needs-auth` KHÔNG
 * phải lỗi, nó là "bấm nút đăng nhập đi". → SPEC-arms.md §6c
 */
export interface ProbeResult {
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /**
   * Nấc quyền ĐÁNG hiện, kèm số việc — **tính ở server**, không suy lại ở đây.
   *
   * ⚠ Luật *"chỉ hiện nếu thêm ≥1 việc so với nấc dưới"* có ca biên tinh tế
   * (server toàn tool đọc ⇒ ba nấc bằng nhau ⇒ hai nấc dưới là noise). Dựng bản
   * thứ hai của luật đó ở giao diện là dựng một bản sẽ quên một điều kiện.
   */
  tiers?: { tier: 'read' | 'add' | 'full'; count: number }[];
  serverName?: string;
  serverVersion?: string;
  /** NGUYÊN VĂN câu lỗi của server — chuỗi duy nhất copy đi hỏi chỗ khác được. */
  error?: string;
  tools: { name: string; description?: string; level: 'read' | 'write_external' }[];
  /** Token cộng vào prefix mỗi lượt. `undefined` = chưa đo được, và ô để TRỐNG. */
  tokens?: number;
  /**
   * Nối được nhưng server không cấp việc nào — hỏng, và hỏng KHÔNG có câu lỗi.
   * Ca đã đo: gõ sai tên nhóm trong `X-MCP-Toolsets`. → `probe.ts §ProbeResult.warn`
   */
  warn?: string;
  connectMs: number;
}
