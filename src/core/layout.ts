/**
 * Canvas: HÌNH DẠNG của một VĂN PHÒNG. → docs/SPEC-canvas.md, SPEC-offices.md §2
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BẤT BIẾN SỐ 1: layout.json chỉ chứa TOẠ ĐỘ + CẠNH NỐI, không chứa       │
 * │ NỘI DUNG. `cacheKey` băm nội dung role — nhét toạ độ vào roles/*.yaml   │
 * │ thì MỖI CÚ KÉO CHUỘT vứt ~20K cache_write. Tách file ra thì lỗi đó      │
 * │ KHÔNG THỂ xảy ra, không cần kỷ luật gì.                                 │
 * │                                                                         │
 * │ Phép thử: xoá layout.json mà văn phòng vẫn chạy y nguyên = ranh giới    │
 * │ đúng. Đó là lý do `assignable()` trả về undefined (= tất cả) khi thiếu  │
 * │ file, và lý do cạnh mcp→agent được ghi vào roles/*.yaml chứ không vào   │
 * │ đây.                                                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Cạnh `assistant → agent` CÓ NGHĨA: "Trợ lý được phép giao việc cho người này".
 * Nó điều khiển trực tiếp `roster()` trong assistant.ts → ngắt dây = bớt `pitch`
 * khỏi ngữ cảnh Trợ lý = tiết kiệm token THẬT. Kéo dây là hành động có hậu quả
 * đo được, không phải trang trí.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import type { LoadedOffice } from './config.js';
import { isSafeId } from './paths.js';

export type NodeKind = 'assistant' | 'agent' | 'knowledge' | 'mcp';

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** chỉ với kind=agent — trỏ tới roles/<role>.yaml */
  role?: string;
  /** chỉ với kind=mcp — tên server khai trong company.yaml */
  server?: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutFile {
  version: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export const ASSISTANT_NODE = 'assistant';
export const KNOWLEDGE_NODE = 'knowledge';
export const agentNodeId = (roleId: string): string => `agent:${roleId}`;
export const mcpNodeId = (server: string): string => `mcp:${server}`;

/** Kích thước node — server và client PHẢI thống nhất để tự sắp xếp khớp nhau. */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  assistant: { w: 232, h: 84 },
  agent: { w: 196, h: 88 },
  knowledge: { w: 200, h: 64 },
  mcp: { w: 168, h: 56 },
};

const COORD_LIMIT = 20_000;
const MAX_NODES = 200;

/** Node kind nào được phép nối RA đâu. Agent cố tình KHÔNG có mặt ở đây. */
const CAN_CONNECT: Partial<Record<NodeKind, ReadonlySet<NodeKind>>> = {
  assistant: new Set<NodeKind>(['agent']),
  mcp: new Set<NodeKind>(['agent', 'assistant']),
};

export class LayoutStore {
  constructor(private office: LoadedOffice) {}

  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  private get file(): string {
    return this.office.paths.layoutFile;
  }

  /** File đã từng được ghi chưa. Phân biệt "chưa ai đụng" với "đã ngắt hết dây". */
  get exists(): boolean {
    return fs.existsSync(this.file);
  }

  /**
   * Hình dạng hiện tại, đã đối chiếu với roles/ và company.yaml.
   *
   * TỰ PHỤC HỒI: có file yaml mà thiếu node → thêm node vào chỗ trống (người
   * dùng thả file vào tay vẫn thấy nó xuất hiện). Có node mà thiếu file yaml →
   * GIỮ LẠI node, đánh dấu `missing` để canvas hiện đỏ, không xoá âm thầm.
   */
  read(): { layout: LayoutFile; missing: Set<string> } {
    const raw = this.readRaw();
    const nodes: LayoutNode[] = [];
    const seen = new Set<string>();

    const keep = (n: LayoutNode): void => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      nodes.push(n);
    };

    const stored = new Map(raw.nodes.map((n) => [n.id, n]));

    keep(stored.get(ASSISTANT_NODE) ?? { id: ASSISTANT_NODE, kind: 'assistant', x: 520, y: 40 });

    const roleIds = [...this.office.roles.keys()];
    roleIds.forEach((roleId, i) => {
      const id = agentNodeId(roleId);
      const prev = stored.get(id);
      keep(prev ? { ...prev, kind: 'agent', role: roleId } : { id, kind: 'agent', role: roleId, ...agentSlot(i) });
    });

    const servers = Object.keys(this.office.company.mcpServers);
    servers.forEach((server, i) => {
      const id = mcpNodeId(server);
      const prev = stored.get(id);
      keep(prev ? { ...prev, kind: 'mcp', server } : { id, kind: 'mcp', server, x: 980, y: 40 + i * 90 });
    });

    keep(stored.get(KNOWLEDGE_NODE) ?? { id: KNOWLEDGE_NODE, kind: 'knowledge', x: 520, y: 470 });

    // Node mồ côi: file yaml/mcp server đã biến mất. Giữ lại + báo đỏ.
    const missing = new Set<string>();
    for (const n of raw.nodes) {
      if (seen.has(n.id)) continue;
      if (n.kind !== 'agent' && n.kind !== 'mcp') continue;
      missing.add(n.id);
      keep(n);
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Chưa có file = mọi nhân viên đều được giao việc. Đây là phép thử
    // "xoá layout.json mà văn phòng chạy y nguyên".
    const edges = this.exists
      ? sanitizeEdges(raw.edges, byId)
      : roleIds.map((r) => ({ from: ASSISTANT_NODE, to: agentNodeId(r) }));

    // Cạnh mcp→agent KHÔNG được lưu ở đây — nó sống trong roles/<id>.yaml.
    // Dựng lại lúc đọc để canvas vẽ đúng, nhưng nguồn sự thật vẫn là yaml.
    const seenEdge = new Set(edges.map((e) => `${e.from} ${e.to}`));
    for (const [roleId, role] of this.office.roles) {
      for (const server of role.mcp) {
        const from = mcpNodeId(server);
        const key = `${from} ${agentNodeId(roleId)}`;
        if (!byId.has(from) || seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ from, to: agentNodeId(roleId) });
      }
    }
    // Cạnh mcp→assistant cũng là NỘI DUNG: nó sống trong office.yaml.
    for (const server of this.office.config.assistant.mcp) {
      const from = mcpNodeId(server);
      const key = `${from} ${ASSISTANT_NODE}`;
      if (!byId.has(from) || seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ from, to: ASSISTANT_NODE });
    }

    return { layout: { version: 1, nodes, edges }, missing };
  }

  /**
   * Vai trò Trợ lý ĐƯỢC PHÉP giao việc. `undefined` = tất cả.
   *
   * undefined chứ không phải "toàn bộ danh sách" là có chủ ý: assistant.ts phân
   * biệt "chưa cấu hình" với "cấu hình cho phép tất cả", và chỉ trường hợp đầu
   * mới được im lặng bỏ qua khi layout.json vắng mặt.
   */
  assignable(): Set<string> | undefined {
    if (!this.exists) return undefined;
    const { layout } = this.read();
    const out = new Set<string>();
    for (const e of layout.edges) {
      if (e.from !== ASSISTANT_NODE) continue;
      const node = layout.nodes.find((n) => n.id === e.to);
      if (node?.kind === 'agent' && node.role) out.add(node.role);
    }
    return out;
  }

  /**
   * Ghi hình dạng mới.
   *
   * Cạnh từ node mcp KHÔNG nằm trong layout.json — "agent này dùng được tool
   * nào" là NỘI DUNG, không phải hình dạng. Nó đã có nhà rồi: `mcp:` trong
   * roles/<id>.yaml (hoặc office.yaml với Trợ lý). Ghi hai nơi = hai nguồn sự
   * thật = sớm muộn cũng lệch nhau.
   *
   * Trả về danh sách file đã sửa, để caller biết có phải nạp lại không.
   */
  save(input: { nodes?: unknown; edges?: unknown }): { touched: string[] } {
    const current = this.read().layout;
    const byId = new Map(current.nodes.map((n) => [n.id, n]));

    // Toạ độ: chỉ nhận node đã biết. Client không được tự sinh node bằng PUT.
    if (Array.isArray(input.nodes)) {
      for (const raw of input.nodes.slice(0, MAX_NODES)) {
        const n = raw as Partial<LayoutNode>;
        if (typeof n.id !== 'string') continue;
        const node = byId.get(n.id);
        if (!node) continue;
        node.x = clampCoord(n.x);
        node.y = clampCoord(n.y);
      }
    }

    const wanted = sanitizeEdges(input.edges, byId);

    // ── tách hai loại cạnh: hình dạng vào layout.json, tool vào yaml
    const mcpByRole = new Map<string, string[]>();
    const mcpForAssistant: string[] = [];
    for (const e of wanted) {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (from?.kind !== 'mcp' || !from.server) continue;
      if (to?.kind === 'assistant') {
        mcpForAssistant.push(from.server);
      } else if (to?.kind === 'agent' && to.role) {
        const list = mcpByRole.get(to.role) ?? [];
        list.push(from.server);
        mcpByRole.set(to.role, list);
      }
    }

    this.writeRaw({ version: 1, nodes: current.nodes, edges: wanted });

    const touched: string[] = [];
    for (const [roleId, role] of this.office.roles) {
      const next = [...new Set(mcpByRole.get(roleId) ?? [])].sort();
      if (sameList(next, role.mcp)) continue;
      if (this.writeYamlKey(this.roleFile(roleId), ['mcp'], next)) touched.push(`roles/${roleId}`);
    }
    const nextAssistant = [...new Set(mcpForAssistant)].sort();
    if (!sameList(nextAssistant, this.office.config.assistant.mcp)) {
      if (this.writeYamlKey(this.office.paths.configFile, ['assistant', 'mcp'], nextAssistant)) {
        touched.push('office');
      }
    }
    return { touched };
  }

  /** Thêm node vào chỗ trống bên phải hàng agent. */
  freeAgentSlot(): { x: number; y: number } {
    const { layout } = this.read();
    const agents = layout.nodes.filter((n) => n.kind === 'agent');
    if (agents.length === 0) return agentSlot(0);
    const right = agents.reduce((m, n) => Math.max(m, n.x), -Infinity);
    const row = agents.filter((n) => Math.abs(n.x - right) < 1);
    return { x: right + NODE_SIZE.agent.w + 40, y: row[0]?.y ?? agentSlot(0).y };
  }

  /** Nối Trợ lý tới một agent mới. Không có bước này thì nhân viên mới vô hình. */
  connectAssistant(roleId: string): void {
    const { layout } = this.read();
    const to = agentNodeId(roleId);
    if (!layout.nodes.some((n) => n.id === to)) return;
    if (layout.edges.some((e) => e.from === ASSISTANT_NODE && e.to === to)) return;
    layout.edges.push({ from: ASSISTANT_NODE, to });
    this.writeRaw(layout);
  }

  /** Bỏ node khỏi layout (file yaml có bị xoá hay không là quyết định của caller). */
  dropAgent(roleId: string): void {
    if (!this.exists) return;
    const raw = this.readRaw();
    const id = agentNodeId(roleId);
    this.writeRaw({
      version: 1,
      nodes: raw.nodes.filter((n) => n.id !== id),
      edges: raw.edges.filter((e) => e.from !== id && e.to !== id),
    });
  }

  // ── nội bộ

  private readRaw(): LayoutFile {
    if (!this.exists) return { version: 1, nodes: [], edges: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<LayoutFile>;
      return {
        version: 1,
        nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isNodeShape).slice(0, MAX_NODES) : [],
        edges: Array.isArray(raw.edges) ? raw.edges.filter(isEdgeShape) : [],
      };
    } catch {
      // layout.json hỏng KHÔNG được làm sập văn phòng — nó chỉ là view state.
      process.emitWarning('layout.json không đọc được, canvas sẽ tự sắp xếp lại.');
      return { version: 1, nodes: [], edges: [] };
    }
  }

  /**
   * Chốt chặn DUY NHẤT ghi ra đĩa. Cạnh từ node mcp bị lọc ở đây, nên không có
   * đường nào để nó lọt vào layout.json dù caller quên — bất biến "một sự thật
   * một nơi ở" được giữ bằng cấu trúc, không bằng kỷ luật.
   */
  private writeRaw(layout: LayoutFile): void {
    const kindOf = new Map(layout.nodes.map((n) => [n.id, n.kind]));
    const payload: LayoutFile = {
      version: 1,
      nodes: layout.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: Math.round(n.x),
        y: Math.round(n.y),
        ...(n.role ? { role: n.role } : {}),
        ...(n.server ? { server: n.server } : {}),
      })),
      edges: layout.edges.filter((e) => kindOf.get(e.from) !== 'mcp').map((e) => ({ from: e.from, to: e.to })),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  /**
   * Sửa đúng một khoá trong một file yaml.
   *
   * Dùng parseDocument chứ không parse+stringify: ghi đè cả file sẽ NUỐT MẤT
   * chú thích người dùng viết — mà "yaml sửa tay được, git diff đọc được" là
   * một trong hai lý do không nhét tất cả vào một cục JSON như n8n.
   */
  private writeYamlKey(file: string | undefined, keyPath: string[], value: string[]): boolean {
    if (!file || !fs.existsSync(file)) return false;
    try {
      const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
      if (value.length) doc.setIn(keyPath, value);
      else doc.deleteIn(keyPath);
      // lineWidth 0: đừng ngắt dòng lại những giá trị ta không đụng tới. Cắm một
      // MCP mà git diff nhảy 8 dòng thì người dùng mất niềm tin vào việc
      // "file của tôi vẫn là của tôi".
      fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
      return true;
    } catch {
      process.emitWarning(`Không ghi được ${keyPath.join('.')} vào ${path.basename(file)}`);
      return false;
    }
  }

  private roleFile(roleId: string): string | undefined {
    if (!isSafeId(roleId)) return undefined;
    for (const ext of ['.yaml', '.yml']) {
      const f = path.join(this.office.paths.roles, `${roleId}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────── helpers

/**
 * Luật nối dây, thi hành ở SERVER.
 *
 * Canvas làm cho agent→agent BẤT KHẢ THI về mặt vật lý (node agent không có
 * cổng ra). Nhưng UI là client — ai cũng POST thẳng được. Luật kinh tế
 * (agent nói chuyện với agent = nguồn đốt token lớn nhất) phải được giữ ở đây
 * mới thật sự là luật.
 */
function sanitizeEdges(raw: unknown, byId: ReadonlyMap<string, LayoutNode>): LayoutEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isEdgeShape(item)) continue;
    const from = byId.get(item.from);
    const to = byId.get(item.to);
    if (!from || !to || from.id === to.id) continue;
    if (!CAN_CONNECT[from.kind]?.has(to.kind)) continue;
    const key = `${from.id} ${to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: from.id, to: to.id });
  }
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(' ') === [...b].sort().join(' ');
}

function agentSlot(i: number): { x: number; y: number } {
  const perRow = 4;
  return {
    x: 140 + (i % perRow) * (NODE_SIZE.agent.w + 40),
    y: 250 + Math.floor(i / perRow) * (NODE_SIZE.agent.h + 60),
  };
}

function clampCoord(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)));
}

function isNodeShape(v: unknown): v is LayoutNode {
  const n = v as Partial<LayoutNode>;
  return (
    !!n &&
    typeof n.id === 'string' &&
    n.id.length > 0 &&
    n.id.length < 200 &&
    (n.kind === 'assistant' || n.kind === 'agent' || n.kind === 'knowledge' || n.kind === 'mcp')
  );
}

function isEdgeShape(v: unknown): v is LayoutEdge {
  const e = v as Partial<LayoutEdge>;
  return !!e && typeof e.from === 'string' && typeof e.to === 'string';
}
