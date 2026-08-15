/**
 * Kiểu khớp với backend. Nguồn sự thật là `src/core/types.ts` và
 * `src/core/office.ts` — file này là bản sao thủ công, không sinh tự động.
 *
 * Chấp nhận trùng lặp vì hai bên build riêng và không import chéo được.
 * Đổi bên kia thì phải đổi ở đây; `npm run typecheck` của web sẽ không bắt được.
 */

export type NodeKind = 'assistant' | 'agent' | 'knowledge' | 'mcp';
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
  tier?: string;
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
  plan_id: string | null;
  error?: string;
}

export interface CompanyView {
  name: string;
  offices: OfficeSummary[];
  allowCorePromptEdit: boolean;
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
}

export interface OfficeDetail {
  id: string;
  name: string;
  state: OfficeState;
  plan: { plan_id: string; request: string; steps: PlanStep[] } | null;
  pending: number;
  knowledge: number;
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
        assistant: 'idle' | 'thinking';
        workers: number;
        queued: number;
        jobs: number;
      }
    | { type: 'cost.tick'; totals: Usage & { tasks: number } }
    | { type: 'knowledge.changed'; count: number; version: number }
    | { type: 'layout.changed'; say: string }
    | { type: 'company.offices'; say: string }
  );

/** Kích thước node — PHẢI khớp `NODE_SIZE` trong `src/core/layout.ts`. */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  assistant: { w: 232, h: 84 },
  agent: { w: 196, h: 88 },
  knowledge: { w: 200, h: 64 },
  mcp: { w: 168, h: 56 },
};

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
