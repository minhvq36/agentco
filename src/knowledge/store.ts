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

import type { OfficePaths } from '../core/paths.js';
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
  /** Lần cuối hợp với một việc. Rỗng = chưa lần nào. → node.ts */
  last_used?: string;
  keywords: string[];
}

export class KnowledgeStore {
  private byId = new Map<string, IndexEntry>();
  private nodeCache = new Map<string, KnowledgeNode>();
  /**
   * Node đã bị node khác ĐÈ LÊN. Dựng lại mỗi lần `scan()`.
   *
   * Giữ trong bộ nhớ chứ không ghi cờ vào file bị đè: node bị đè KHÔNG được
   * sửa. Quan hệ thuộc về node MỚI (nó khai `supersedes`), nên xoá node mới đi
   * là quan hệ tự biến mất và node cũ sống lại — đúng thứ ta muốn, và không cần
   * một bước dọn dẹp nào.
   */
  private superseded = new Set<string>();

  constructor(
    private companyDir: string,
    private paths: OfficePaths,
  ) {}

  /** Sau khi nạp lại văn phòng từ đĩa. */
  rebind(dir: string, paths: OfficePaths): void {
    this.companyDir = dir;
    this.paths = paths;
  }

  /** Quét lại toàn bộ thư mục knowledge/ và ghi index.json. */
  scan(): void {
    this.byId.clear();
    this.nodeCache.clear();
    this.superseded.clear();

    for (const dir of [this.paths.knowledgeShared, this.paths.knowledgeAgents]) {
      if (!fs.existsSync(dir)) continue;
      for (const abs of walk(dir)) {
        const rel = path.relative(this.companyDir, abs).replace(/\\/g, '/');
        const node = readNodeFile(this.companyDir, rel);
        if (!node) continue;

        // CỐ Ý không cảnh báo node dài. Token ở đây là ước lượng thô (chia
        // ký tự), và `hot_knowledge_tokens` đã chặn ở đúng chỗ có ý nghĩa —
        // tổng cộng vào prefix, chứ không phải từng node một. Một node dài hơn
        // vài chục token mà mang được nhiều thông tin hơn thì là lãi, và một
        // dòng cảnh báo không ai đọc chỉ làm nhiễu log.
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
          ...(node.last_used ? { last_used: node.last_used } : {}),
          keywords: keywordsOf(node),
        });
        this.nodeCache.set(node.id, node);
        for (const dead of node.supersedes) this.superseded.add(dead);
      }
    }
    // Quét xong MỚI dựng tập bị đè: node đè có thể nằm ở file quét sau node
    // bị đè, nên không thể quyết trong lúc đang duyệt.
    this.writeIndex();
  }

  /** Node đã bị đè — vẫn còn file, chỉ không nạp vào prompt nữa. */
  isSuperseded(id: string): boolean {
    return this.superseded.has(id);
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): KnowledgeNode | undefined {
    return this.nodeCache.get(id);
  }

  /**
   * Số ghi chú trong SỔ TAY RIÊNG của từng vai trò (`knowledge/agents/<role>/`).
   * Đây là con số `📒 n` trên node agent — thứ phân biệt tri thức chung
   * (node knowledge ở giữa canvas) với kinh nghiệm riêng agent tự ghi.
   */
  notesByRole(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.byId.values()) {
      if (!e.scope.startsWith('role:')) continue;
      const role = e.scope.slice('role:'.length);
      out[role] = (out[role] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Duyệt kho cho ngăn kéo tri thức. Đọc từ index — 0 token.
   *
   * Trả về CẢ node đã bị đè, kèm cờ `superseded`. Giấu chúng đi thì người dùng
   * mở thư mục ra thấy những file không có trong giao diện; hiện mà không nói
   * rõ thì họ thấy ba bản "Ghi nhớ" giống hệt nhau và tưởng hệ thống đang nhân
   * bản rác. Hiện + dán nhãn là cách duy nhất không nói dối.
   */
  list(): Array<IndexEntry & { superseded: boolean; body: string; updated: string }> {
    return [...this.byId.values()]
      .map((e) => ({
        ...e,
        superseded: this.superseded.has(e.id),
        body: this.nodeCache.get(e.id)?.body ?? '',
        updated: this.nodeCache.get(e.id)?.updated ?? '',
      }))
      .sort(
        (a, b) =>
          Number(a.superseded) - Number(b.superseded) ||
          b.hits - a.hits ||
          a.scope.localeCompare(b.scope) ||
          a.title.localeCompare(b.title),
      );
  }

  /** Sửa nội dung một node. Trả về false nếu không có node đó. */
  editNode(id: string, body: string): boolean {
    const node = this.nodeCache.get(id);
    if (!node) return false;
    node.body = body.trim();
    node.tokens = estimateTokens(node.body);
    node.updated = new Date().toISOString().slice(0, 10);
    writeNodeFile(this.companyDir, node);
    return true;
  }

  /** Xoá hẳn một node khỏi đĩa. */
  removeNode(id: string): boolean {
    const node = this.nodeCache.get(id);
    if (!node) return false;
    fs.rmSync(path.join(this.companyDir, node.file), { force: true });
    return true;
  }

  /**
   * Dọn ghi chú CŨ mà CHƯA AI DÙNG. Chạy mỗi lần nén trí nhớ.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO PHẢI CÓ, VÀ VÌ SAO NÓ CHƯA ĐỦ                                     │
   * │                                                                          │
   * │ Không có nó thì kho chỉ LỚN LÊN. `supersedes` xử lý được ca "quyết định  │
   * │ bị đảo ngược", nhưng phần lớn rác không bị đảo ngược — nó chỉ đơn giản   │
   * │ là hết liên quan, và không ai đi tuyên bố điều đó.                        │
   * │                                                                          │
   * │ ⚠ `hits` chỉ đáng tin khi kho ĐÃ LỚN HƠN `hot_knowledge_size`. Dưới      │
   * │ ngưỡng đó mọi node đều được nạp mỗi lượt nên `hits` gần như đồng đều, và │
   * │ lọc theo nó là lọc theo nhiễu. Vì thế điều kiện là VÀ chứ không phải     │
   * │ HOẶC: phải vừa cũ VỪA chưa từng được dùng.                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * KHÔNG đụng tới: node `pinned` (charter), node GHI NHỚ (người dùng chốt), và
   * node vừa bị đè trong chính lần nén này. Xoá hẳn chứ không cất — đây là ghi
   * chú agent tự sinh, chưa ai từng đọc, và giữ lại chỉ đẻ ra một kho thứ hai
   * cũng cần dọn.
   */
  pruneStale(maxAgeDays: number): string[] {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      if (e.pinned) continue;

      /**
       * Node ĐÃ BỊ ĐÈ: xoá thẳng, không cần chờ đủ tuổi.
       *
       * Nó đã được thay bằng một node mới CHỨA nội dung gộp lại — giữ nó chỉ
       * để "tham khảo" là giữ rác: người dùng mở ngăn kéo thấy ba bản "Ghi nhớ"
       * trông hệt nhau và phải tự đoán bản nào đang có hiệu lực.
       *
       * An toàn vì `superseded` chỉ được đặt khi node ĐÈ vẫn tồn tại (dựng lại
       * ở mỗi `scan()` từ chính trường `supersedes` của node còn sống). Không
       * có ca "xoá bản cũ rồi phát hiện bản mới cũng biến mất".
       */
      if (this.superseded.has(e.id)) {
        if (this.removeNode(e.id)) dropped.push(e.title);
        continue;
      }

      // Ghi nhớ hội thoại miễn trừ: nó bị THAY bởi bản nén sau, không bị dọn
      // theo tuổi. Người dùng chốt một điều rồi ba tuần không nhắc lại thì điều
      // đó vẫn còn hiệu lực.
      if (this.isMemory(e)) continue;

      /**
       * KHAI TỬ THEO CỬA SỔ, kể cả khi `hits > 0`.
       *
       * Bản trước bỏ qua mọi node có `hits > 0` — nghĩa là node được dùng ĐÚNG
       * MỘT LẦN từ rất lâu vẫn bất tử. Cơ chế dọn gần như không chạy được.
       *
       * Mốc so là `last_used` (lần cuối hợp với một việc), rơi về `updated` khi
       * chưa có: node vừa tạo hoặc vừa được người dùng sửa được ân hạn trọn cửa
       * sổ — sờ vào là sống thêm.
       */
      const node = this.nodeCache.get(e.id);
      if (!node) continue;
      const at = Date.parse(node.last_used ?? node.updated);
      if (!Number.isFinite(at) || at > cutoff) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    return dropped;
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
      // Bản GHI NHỚ đi bằng khối riêng của nó (`assistantMemoryText`), KHÔNG
      // xếp hàng ở đây. Hai lý do, cả hai đều quan trọng:
      //  1. Nó là thứ NGƯỜI DÙNG chốt — không được phép tụt khỏi top-N và biến
      //     mất âm thầm khi kho lớn dần, như một bài học tự rút ra thì được.
      //  2. Không loại ở đây thì nó nằm trong CẢ hai khối, và bảng prompt phân
      //     lớp đếm nó hai lần — người dùng nhìn thấy chính xác điều đó và
      //     tưởng hệ thống đang nhắc lại chồng chéo.
      .filter((e) => !this.isMemory(e))
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
  ): { text: string; ids: string[]; matched: string[] } {
    const exclude = new Set(excludeIds);
    const terms = new Set(tokenize(queryText));
    if (terms.size === 0) return { text: '', ids: [], matched: [] };

    /**
     * Chấm điểm TOÀN BỘ node nhìn thấy được, KHÔNG loại HOT — rồi mới loại HOT
     * ở bước render.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ VÌ SAO PHẢI TÁCH "HỢP VIỆC" KHỎI "ĐƯỢC RENDER"                       │
     * │                                                                      │
     * │ `matched` là tín hiệu HỢP VIỆC; `ids` là thứ thật sự đi vào prompt.  │
     * │ Trộn hai cái làm một thì node nằm trong HOT KHÔNG BAO GIỜ ghi được   │
     * │ `last_used` — vì nó bị loại trước khi kịp được chấm điểm.            │
     * │                                                                      │
     * │ Hậu quả đo được: kho 5 node với `hot_knowledge_size: 8` thì HOT lấy  │
     * │ sạch, COLD luôn rỗng, không node nào có `last_used`, và 15 ngày sau  │
     * │ **cả kho chết** — kể cả những node đang được nạp vào mọi lượt gọi.   │
     * │                                                                      │
     * │ Tách ra thì cả hai chỉ số đúng ở MỌI quy mô kho:                     │
     * │  · node HOT thật sự hợp việc → có `last_used` → sống                 │
     * │  · node HOT chưa bao giờ hợp việc nào → chết đúng lúc, và đáng chết: │
     * │    nó đang ngồi trong prefix của mọi lời gọi mà không đóng góp gì.   │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const scored = this.visible(roleId)
      .map((e) => ({ e, score: this.score(e, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const rendered = this.render(
      scored.filter((x) => !exclude.has(x.e.id)).map((x) => x.e),
      tokenBudget,
    );
    return { ...rendered, matched: scored.map((x) => x.e.id) };
  }

  /**
   * Sổ tay RIÊNG của một vai trò. Chỉ chính nó đọc.
   * Chưa gộp trùng — đó là việc của Librarian (M1).
   */
  addLesson(roleId: string, text: string, source: string): KnowledgeNode {
    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const node: KnowledgeNode = {
      id: `k/agents/${roleId}/${slug}`,
      type: 'pitfall',
      title: text.slice(0, 60),
      tags: [roleId],
      links: [],
      scope: `role:${roleId}`,
      author: `role:${roleId}`,
      confidence: 0.6,
      hits: 0,
      pinned: false,
      supersedes: [],
      updated: new Date().toISOString().slice(0, 10),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/agents/${roleId}/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /**
   * Kho CHUNG của văn phòng — cả văn phòng đọc.
   *
   * Chỉ Trợ lý được gọi hàm này (SPEC-offices.md §4.3). Kho chung nằm trong
   * prefix cache của mọi nhân viên; cho ai cũng ghi được thì nó phình theo cấp
   * số nhân và không ai chịu trách nhiệm.
   */
  addSharedLesson(text: string, source: string): KnowledgeNode {
    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const node: KnowledgeNode = {
      id: `k/shared/${slug}`,
      type: 'playbook',
      title: text.slice(0, 60),
      tags: ['office'],
      links: [],
      scope: 'shared',
      author: 'assistant',
      confidence: 0.7,
      hits: 0,
      pinned: false,
      supersedes: [],
      updated: new Date().toISOString().slice(0, 10),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/shared/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /**
   * Ghi bản NÉN TRÍ NHỚ của Trợ lý. → docs/SPEC-offices.md §4.6
   *
   * Vào `knowledge/agents/assistant/`, scope `role:assistant` — KHÔNG vào kho
   * chung. Kho chung nằm trong prefix của MỌI nhân viên, mà ký ức hội thoại của
   * Trợ lý ("khách thích giọng vui hơn", "đã chốt dùng file markdown") là thứ
   * người viết bài không cần biết và không dùng được. Đưa vào đó là bắt cả văn
   * phòng trả tiền để đọc nhật ký của một người.
   *
   * `supersedes` trỏ về bản nén TRƯỚC ĐÓ: mỗi lần nén, bản cũ rời khỏi prompt
   * nhưng file vẫn nằm đó. Nhờ vậy kho không phình theo số lần nén, mà vẫn lần
   * ngược được lịch sử khi cần.
   */
  addAssistantMemory(title: string, body: string, supersedes: readonly string[]): KnowledgeNode {
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = `bo-nho-${stamp}-${Date.now().toString(36).slice(-4)}`;
    const node: KnowledgeNode = {
      id: `k/agents/assistant/${slug}`,
      type: 'fact',
      title: title.slice(0, 60),
      tags: ['bo-nho'],
      links: [],
      scope: 'role:assistant',
      author: 'assistant',
      // Cao hơn lesson thường: đây là thứ NGƯỜI DÙNG đã chốt, không phải thứ
      // agent tự rút ra.
      confidence: 0.9,
      hits: 0,
      pinned: false,
      supersedes: [...supersedes],
      updated: stamp,
      source: 'compact',
      body: body.trim(),
      tokens: estimateTokens(body),
      file: `knowledge/agents/assistant/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /** Một node là bản nén trí nhớ hội thoại (khác với kinh nghiệm agent tự rút ra). */
  private isMemory(e: IndexEntry): boolean {
    return e.scope === 'role:assistant' && e.id.includes('/bo-nho-');
  }

  /** Id mọi bản nén trí nhớ đang còn hiệu lực (chưa bị bản mới đè). */
  assistantMemoryIds(): string[] {
    return [...this.byId.values()].filter((e) => this.isMemory(e) && !this.superseded.has(e.id)).map((e) => e.id);
  }

  /**
   * Nội dung các bản GHI NHỚ đang hiệu lực, tách riêng để giao diện hiện thành
   * một lớp prompt độc lập. → docs/SPEC-offices.md §4.6
   *
   * Cùng một kho, hai cách NHÌN. Lưu chung là để dùng lại `supersedes`, lão hoá,
   * ngân sách và Librarian; hiện riêng là vì với người dùng đây là hai thứ khác
   * hẳn nhau: **kinh nghiệm** là thứ agent tự rút ra sau khi làm, **ghi nhớ** là
   * thứ CHÍNH NGƯỜI DÙNG đã chốt. Cái sau phải nặng ký hơn, và phải tìm thấy được.
   */
  assistantMemoryText(): string {
    const nodes = this.assistantMemoryIds()
      .map((id) => this.nodeCache.get(id))
      .filter((n): n is KnowledgeNode => !!n);
    return nodes.map((n) => n.body).join('\n\n');
  }

  countShared(): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.scope === 'shared') n++;
    return n;
  }

  /** Node được dùng thật thì tăng hits — đây là tín hiệu xếp hạng HOT. */
  recordHits(ids: readonly string[]): void {
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    for (const id of ids) {
      const entry = this.byId.get(id);
      const node = this.nodeCache.get(id);
      if (!entry || !node) continue;
      entry.hits++;
      node.hits++;
      // Ngày dùng gần nhất — thứ quyết định node sống hay chết. Xem `node.ts`.
      node.last_used = today;
      entry.last_used = today;
      writeNodeFile(this.companyDir, node);
      changed = true;
    }
    if (changed) this.writeIndex();
  }

  // ── nội bộ

  /**
   * Node một vai trò được phép ĐỌC.
   *
   * `shared` + sổ tay riêng của chính nó. Đây là chốt giữ cho sổ tay riêng của
   * Trợ lý (`role:assistant`) KHÔNG lọt vào prefix của nhân viên — nếu không,
   * bộ nhớ hội thoại nén ra sẽ đi vào ngữ cảnh của mọi worker, ở mọi task,
   * để nói với họ những chuyện không liên quan gì tới việc họ đang làm.
   *
   * Node đã bị đè bị loại ở đây, tức là loại khỏi CẢ hot lẫn cold cùng lúc —
   * một chốt, không phải hai chỗ phải nhớ.
   */
  private visible(roleId: string): IndexEntry[] {
    const want = `role:${roleId}`;
    return [...this.byId.values()].filter(
      (e) => (e.scope === 'shared' || e.scope === want) && !this.superseded.has(e.id),
    );
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
    // \p{M} = dấu tổ hợp. Lớp ký tự viết tay [U+0300-U+036F] TRÔNG thì đúng
    // nhưng dấu tổ hợp bám lên dấu ngoặc vuông làm regex thành thứ khác —
    // hậu quả là "Người dùng" ra "ngu-i-d-ng" thay vì "nguoi-dung".
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
