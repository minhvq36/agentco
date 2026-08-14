/**
 * Kho tri thức: quét, index, truy xuất.
 *
 * → docs/SPEC-2026-08-14-agentco.md §5
 *
 * TRUY XUẤT TỐN 0 TOKEN. Không dùng embedding ở v0: thêm một API phải trả tiền
 * thường trực, thêm phụ thuộc, thêm chỗ hỏng — trong khi từ khoá + đồ thị liên kết
 * đủ dùng cho quy mô vài trăm node. Nếu đo được là không đủ thì v2 dùng
 * embedding CHẠY LOCAL, không qua API.
 *
 * Hai tầng, và đây là chỗ dễ làm sai nhất:
 *   HOT  — top N node hay dùng của role, nằm TRONG prefix cache, gần như miễn phí
 *   COLD — node chọn riêng cho task, nằm SAU cache breakpoint, trả giá đầy đủ
 * Nhét tri thức theo task vào prefix = prefix đổi mỗi task = cache miss 100%,
 * tệ hơn là không cache gì cả.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Paths } from '../core/paths.js';
import { estimateTokens } from '../core/tokens.js';
import { keywordsOf, readNodeFile, tokenize, writeNodeFile, type KnowledgeNode } from './node.js';

export interface IndexEntry {
  id: string;
  file: string;
  title: string;
  tags: string[];
  links: string[];
  scope: string;
  tokens: number;
  hits: number;
  pinned: boolean;
  confidence: number;
  keywords: string[];
}

export class KnowledgeStore {
  private byId = new Map<string, IndexEntry>();
  private nodeCache = new Map<string, KnowledgeNode>();

  constructor(
    private readonly companyDir: string,
    private readonly paths: Paths,
  ) {}

  /** Quét lại toàn bộ thư mục knowledge/ và ghi index.json. */
  scan(): void {
    this.byId.clear();
    this.nodeCache.clear();

    for (const dir of [this.paths.knowledgeShared, this.paths.knowledgeAgents]) {
      if (!fs.existsSync(dir)) continue;
      for (const abs of walk(dir)) {
        const rel = path.relative(this.companyDir, abs).replace(/\\/g, '/');
        const node = readNodeFile(this.companyDir, rel);
        if (!node) continue;

        // Trần CỨNG cho node. Node to làm prefix HOT phình -> đắt cho MỌI call.
        if (node.tokens > 250) {
          process.emitWarning(
            `Node tri thức "${node.id}" ${node.tokens} token, vượt trần 250. ` +
              `Nên tách nhỏ — node to làm prefix cache phình cho mọi agent.`,
          );
        }

        this.byId.set(node.id, {
          id: node.id,
          file: node.file,
          title: node.title,
          tags: node.tags,
          links: node.links,
          scope: node.scope,
          tokens: node.tokens,
          hits: node.hits,
          pinned: node.pinned,
          confidence: node.confidence,
          keywords: keywordsOf(node),
        });
        this.nodeCache.set(node.id, node);
      }
    }
    this.writeIndex();
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): KnowledgeNode | undefined {
    return this.nodeCache.get(id);
  }

  /**
   * Tri thức HOT của một vai trò: node hay dùng nhất, nằm trong prefix cache.
   * Chỉ tính lại khi bump knowledge_version — KHÔNG tính lại mỗi task,
   * nếu không thì prefix đổi liên tục và cache vô nghĩa.
   */
  hot(roleId: string, count: number, tokenBudget: number): { text: string; ids: string[] } {
    const scoped = this.visible(roleId);
    const ranked = scoped
      .filter((e) => !e.pinned) // pinned đã nằm trong charter rồi
      .sort((a, b) => b.hits - a.hits || b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(0, count);
    return this.render(ranked, tokenBudget);
  }

  /**
   * Tri thức COLD: chọn theo nội dung task. Nằm sau cache breakpoint nên
   * trả giá đầy đủ — vì thế trần phải chặt.
   */
  cold(
    roleId: string,
    queryText: string,
    tokenBudget: number,
    excludeIds: readonly string[] = [],
  ): { text: string; ids: string[] } {
    const exclude = new Set(excludeIds);
    const terms = new Set(tokenize(queryText));
    if (terms.size === 0) return { text: '', ids: [] };

    const scored = this.visible(roleId)
      .filter((e) => !exclude.has(e.id))
      .map((e) => ({ e, score: this.score(e, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return this.render(
      scored.map((x) => x.e),
      tokenBudget,
    );
  }

  /** Ghi một bài học mới. Chưa gộp trùng — đó là việc của Librarian (M1). */
  addLesson(roleId: string, text: string, source: string): KnowledgeNode {
    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const id = `k/agents/${roleId}/${slug}`;
    const node: KnowledgeNode = {
      id,
      type: 'pitfall',
      title: text.slice(0, 60),
      tags: [roleId],
      links: [],
      scope: `role:${roleId}`,
      author: `role:${roleId}`,
      confidence: 0.6,
      hits: 0,
      pinned: false,
      updated: new Date().toISOString().slice(0, 10),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/agents/${roleId}/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /** Node được dùng thật thì tăng hits — đây là tín hiệu xếp hạng HOT. */
  recordHits(ids: readonly string[]): void {
    let changed = false;
    for (const id of ids) {
      const entry = this.byId.get(id);
      const node = this.nodeCache.get(id);
      if (!entry || !node) continue;
      entry.hits++;
      node.hits++;
      writeNodeFile(this.companyDir, node);
      changed = true;
    }
    if (changed) this.writeIndex();
  }

  // ── nội bộ

  private visible(roleId: string): IndexEntry[] {
    const want = `role:${roleId}`;
    return [...this.byId.values()].filter((e) => e.scope === 'shared' || e.scope === want);
  }

  private score(e: IndexEntry, terms: Set<string>): number {
    let overlap = 0;
    for (const k of e.keywords) if (terms.has(k)) overlap++;
    for (const t of e.tags) if (terms.has(t.toLowerCase())) overlap += 2;
    if (overlap === 0) return 0;
    // chuẩn hoá theo độ dài để node dài không tự động thắng
    const norm = overlap / Math.sqrt(Math.max(4, e.keywords.length));
    return norm * (0.5 + e.confidence) + 0.1 * Math.log1p(e.hits);
  }

  private render(entries: IndexEntry[], tokenBudget: number): { text: string; ids: string[] } {
    const chunks: string[] = [];
    const ids: string[] = [];
    let used = 0;
    for (const e of entries) {
      const node = this.nodeCache.get(e.id);
      if (!node) continue;
      const block = `## ${node.title}\n${node.body}`;
      const cost = estimateTokens(block);
      if (used + cost > tokenBudget) continue; // bỏ qua, thử node nhỏ hơn phía sau
      chunks.push(block);
      ids.push(node.id);
      used += cost;
    }
    return { text: chunks.join('\n\n'), ids };
  }

  private writeIndex(): void {
    fs.mkdirSync(this.paths.knowledge, { recursive: true });
    const payload = {
      generated: new Date().toISOString(),
      count: this.byId.size,
      nodes: [...this.byId.values()],
    };
    fs.writeFileSync(this.paths.knowledgeIndex, JSON.stringify(payload, null, 2), 'utf8');
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield abs;
  }
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
