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
export type PlanStatus = 'planning' | 'running' | 'done' | 'failed' | 'paused' | 'stopped';

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
  count?: number;
  mcp?: string[];
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
    | { type: 'plan.finished'; status: PlanStatus; say: string; costUSD: number; turns: number }
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
    | { type: 'master.message'; say: string; role: 'assistant' | 'user' }
    | { type: 'office.state'; say: string; state: OfficeState }
    | {
        type: 'office.activity';
        assistant: 'idle' | 'thinking' | 'planning';
        workers: number;
        queued: number;
        jobs: number;
      }
    | { type: 'office.cleared'; say: string }
    | { type: 'cost.tick'; totals: Usage & { tasks: number } }
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
export const CAN_CONNECT: Partial<Record<NodeKind, readonly NodeKind[]>> = {
  assistant: ['agent'],
  mcp: ['agent', 'assistant'],
};

export function canConnect(from: CanvasNode, to: CanvasNode, edges: readonly CanvasEdge[]): boolean {
  if (from.id === to.id) return false;
  if (!CAN_CONNECT[from.kind]?.includes(to.kind)) return false;
  return !edges.some((e) => e.from === from.id && e.to === to.id);
}
