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
   * Xoá HẲN mọi node đã bị node khác đè lên. Trả về tiêu đề những cái đã bỏ.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TÁCH KHỎI `pruneStale` VÌ ĐÂY LÀ HAI VIỆC KHÁC NHAU.                     │
   * │                                                                          │
   * │   pruneStale     — LÃO HOÁ: "lâu rồi không ai dùng". Có ngưỡng ngày, và  │
   * │                    người dùng có quyền tắt (`prune_after_days: 0`).      │
   * │   dropSuperseded — THAY THẾ: "bản này đã có bản mới". Không liên quan gì │
   * │                    tới ngày tháng, và KHÔNG được phép tắt.               │
   * │                                                                          │
   * │ Gộp chúng vào một cổng là bug đã gặp: tắt lão hoá thì node bị đè cũng    │
   * │ bất tử theo, và người dùng nhìn thấy hai bản "Ghi nhớ" trông hệt nhau     │
   * │ trong ngăn Tri thức mà phải tự đoán bản nào đang có hiệu lực.            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Trước đây chủ trương là GIỮ file bị đè lại "để đọc lại khi cần". Bỏ chủ
   * trương đó — người dùng cuối không đọc lại, họ chỉ thấy một ngăn kéo đầy bản
   * trùng và một dòng giải thích dài về một cơ chế bên trong mà họ không cần
   * biết. Dấu vết vẫn còn ở nơi đúng của nó: `git`, và bản sao lưu thư mục.
   *
   * An toàn vì `superseded` chỉ được đặt khi node ĐÈ vẫn tồn tại — nó được dựng
   * lại ở mỗi `scan()` từ chính trường `supersedes` của node còn sống. Không có
   * ca "xoá bản cũ rồi phát hiện bản mới cũng biến mất".
   *
   * ⚠ GỌI SAU `scan()`. Node vừa ghi ra đĩa chưa nằm trong `superseded` cho tới
   * lần quét kế tiếp — đó đúng là nửa còn lại của bug này.
   */
  dropSuperseded(): string[] {
    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      if (!this.superseded.has(e.id)) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    return dropped;
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
   * KHÔNG đụng tới: node `pinned`, node GHI NHỚ (người dùng chốt), và
   * node vừa bị đè trong chính lần nén này. Xoá hẳn chứ không cất — đây là ghi
   * chú agent tự sinh, chưa ai từng đọc, và giữ lại chỉ đẻ ra một kho thứ hai
   * cũng cần dọn.
   */
  pruneStale(maxAgeDays: number, archivedRoles: ReadonlySet<string> = new Set()): string[] {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      if (e.pinned) continue;

      /**
       * SỔ TAY CỦA NGƯỜI ĐÃ CẤT ĐƯỢC MIỄN TRỪ — nếu không, "lưu trữ khôi phục
       * được" là một lời nói dối có hạn 15 ngày.
       *
       * Nhân viên đã cất KHÔNG BAO GIỜ chạy, nên `last_used` của nó vĩnh viễn
       * đứng yên và mọi ghi chú của nó chắc chắn rơi qua cửa sổ khai tử. Cất một
       * người đi hai tuần rồi đưa trở lại là nhận về một người mất sạch kinh
       * nghiệm — im lặng, và đúng thứ `archiveAgent` đang hứa là không xảy ra.
       *
       * Đây là mặt trái của cửa sổ khai tử (§5e): nó KHÔNG TRẠNG THÁI nên rất
       * bền, nhưng cũng vì thế nó không phân biệt được "hết liên quan" với
       * "đang nghỉ phép". Chỗ phân biệt được là ở đây, bằng một cờ ta đã có.
       */
      if (e.scope.startsWith('role:') && archivedRoles.has(e.scope.slice('role:'.length))) continue;

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
      /**
       * ⚠ Lý do cũ của dòng này ("pinned đã nằm trong charter rồi") KHÔNG CÒN
       * ĐÚNG từ 17/08: charter đã rời khỏi `knowledge/` (→ SPEC-library.md §17),
       * và nó là node `pinned` duy nhất từng tồn tại.
       *
       * Giữ nguyên hành vi vì hiện KHÔNG có đường nào đặt `pinned: true` — cả
       * ba hàm `add*` đều ghi `false`, giao diện không có nút, chỉ sửa file bằng
       * tay mới đặt được. Đổi ngữ nghĩa của một cờ chưa ai dùng là mua rủi ro
       * không đổi lấy gì.
       *
       * Nếu sau này thật sự làm nút "ghim ghi chú": ghim phải nghĩa là LUÔN nằm
       * trong HOT (và khi đó `cold()` phải loại nó ra, nếu không nó được render
       * hai lần cho cùng một task — đúng cái bẫy charter vừa dẫm).
       */
      .filter((e) => !e.pinned)
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
   *
   * Cũng đi qua `echoesLibrary`: nhân viên vừa đọc xong một tài liệu là lúc nó
   * dễ chép lại một câu trong đó nhất. Nhưng KHÔNG đi qua `worthLearning` —
   * khác Trợ lý, nhân viên đã LÀM THẬT và đã đọc file, nên bài học của nó là
   * chứng kiến chứ không phải nghe kể. Đó cũng là lý do nó giữ `confidence`
   * 0.6, cao hơn 0.55 của bài học chung.
   */
  addLesson(
    roleId: string,
    text: string,
    source: string,
    docs: readonly string[] = [],
    dependsOn: readonly string[] = [],
  ): KnowledgeNode | undefined {
    if (this.rejectLesson(text, docs, `role:${roleId}`, `kinh nghiệm của "${roleId}"`)) return undefined;

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
      // Tài liệu nhân viên THẬT SỰ đọc trong ca này. Quan sát được, không phải
      // lời khai — cùng luật với `landed`. Xoá một trong số đó là node đi theo.
      ...(dependsOn.length ? { depends_on: [...dependsOn] } : {}),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/agents/${roleId}/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /**
   * BA LƯỚI trước khi một bài học được ghi. Trả về `true` nghĩa là ĐÃ TỪ CHỐI.
   *
   * Xếp theo độ chắc chắn giảm dần — lưới chắc nhất chạy trước để lưới yếu hơn
   * không bao giờ phải gánh ca nó không gánh nổi:
   *
   *   1. CON SỐ trùng tài liệu  → gần như chắc chắn là kiến thức, không phải cách làm
   *   2. TRÙNG LẶP với node cũ  → so được chính xác, không phải phỏng đoán
   *   3. CHỒNG TỪ với tài liệu  → `echoesLibrary`, lưới thô nhất, hay lọt
   *
   * Mọi lần từ chối đều NÓI RA. Một cơ chế lọc im lặng là một cơ chế không ai
   * kiểm được, và ngày nó chặn nhầm thì không ai biết vì sao kho ngừng lớn.
   */
  private rejectLesson(text: string, docs: readonly string[], scope: string, who: string): boolean {
    const digit = quotesLibraryNumber(text, docs);
    if (digit) {
      process.emitWarning(
        `Bỏ qua ${who} vì nó chép CON SỐ "${digit}" từ tài liệu: ${text.slice(0, 60)}… ` +
          `Kinh nghiệm ghi CÁCH LÀM, không ghi kiến thức — con số thuộc về tủ tài liệu.`,
      );
      return true;
    }

    const twin = this.findTwin(text, scope);
    if (twin) {
      /**
       * TRÙNG THÌ CỘNG PHIẾU, ĐỪNG VỨT.
       *
       * Bài học lặp lại là BẰNG CHỨNG nó có thật, không phải rác. `hits` chính
       * là thang xếp hạng vào HOT, nên biến bản trùng thành một lá phiếu vừa
       * chặn được spam vừa đẩy node đúng lên trên — rẻ hơn hẳn việc đẻ ra node
       * thứ hai rồi chờ Librarian gộp lại.
       *
       * Nó cũng làm node đó TRẺ LẠI (`recordHits` ghi `last_used`), nên một bài
       * học vẫn còn đúng sẽ không bị cửa sổ khai tử dọn mất.
       */
      this.recordHits([twin.id]);
      process.emitWarning(
        `Bỏ qua ${who} vì trùng ghi chú đã có ("${twin.title}") — đã cộng lượt dùng cho bản cũ.`,
      );
      return true;
    }

    const echo = echoesLibrary(text, docs);
    if (echo) {
      process.emitWarning(
        `Bỏ qua ${who} vì chép lại tài liệu "${echo}": ${text.slice(0, 60)}… ` +
          `Nội dung tài liệu ở tủ, không vào kho tri thức.`,
      );
      return true;
    }

    return false;
  }

  /**
   * Node CÙNG SCOPE nói gần như cùng một chuyện. `undefined` = chưa có.
   *
   * Jaccard trên tập từ đặc trưng: đối xứng, không thiên vị câu dài, và **tất
   * định** — không lượt gọi model nào, chạy được ở mọi lúc.
   *
   * Chỉ so trong cùng scope: một bài học của `nguoi-viet` và một của kho chung
   * nói giống nhau thì đó KHÔNG phải trùng — chúng đi vào prefix của hai tập
   * người khác nhau, và gộp là làm mất một trong hai.
   */
  private findTwin(text: string, scope: string): IndexEntry | undefined {
    if (new Set(tokenize(text)).size < 3) return undefined;
    for (const e of this.byId.values()) {
      if (e.scope !== scope || this.superseded.has(e.id)) continue;
      const body = this.nodeCache.get(e.id)?.body ?? '';
      if (twinScore(text, body) >= TWIN_RATIO) return e;
    }
    return undefined;
  }

  /**
   * XOÁ DÂY CHUYỀN: file biến mất → mọi node khai phụ thuộc vào nó cũng biến mất.
   * → `KnowledgeNode.depends_on`
   *
   * Gọi từ chỗ file thật sự bị xoá (`LibraryStore.remove`), không phải từ một
   * job quét định kỳ. Quét định kỳ nghĩa là có một cửa sổ thời gian mà node mồ
   * côi vẫn nằm trong prefix của mọi nhân viên và vẫn được nghe theo — mà độ dài
   * cửa sổ đó thì không ai kiểm được.
   *
   * Trả về tiêu đề các node đã bỏ, để bên gọi nói ra. Xoá âm thầm thứ người dùng
   * nhìn thấy trong ngăn kéo Tri thức là đúng lớp lỗi "mất việc, im lặng".
   */
  dropDependents(removedPaths: readonly string[]): string[] {
    const gone = new Set(removedPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')));
    if (gone.size === 0) return [];

    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      const deps = this.nodeCache.get(e.id)?.depends_on ?? [];
      // BẤT KỲ, không phải TẤT CẢ: một lời khuyên đúng một nửa nguy hiểm hơn
      // không có lời khuyên nào, vì không ai biết nửa nào đã hỏng.
      if (!deps.some((d) => gone.has(d))) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    if (dropped.length) this.scan();
    return dropped;
  }

  /**
   * Kho CHUNG của văn phòng — cả văn phòng đọc.
   *
   * Chỉ Trợ lý được gọi hàm này (SPEC-offices.md §4.3). Kho chung nằm trong
   * prefix cache của mọi nhân viên; cho ai cũng ghi được thì nó phình theo cấp
   * số nhân và không ai chịu trách nhiệm.
   *
   * Trả `undefined` khi bài học bị TỪ CHỐI — xem `echoesLibrary`.
   *
   * ⚠ `confidence` 0.55, THẤP HƠN cả kinh nghiệm nhân viên tự rút (0.6). Không
   * phải vì nó ít quan trọng hơn, mà vì NGUỒN của nó yếu hơn: nhân viên viết
   * bài học sau khi ĐÃ LÀM việc và đã đọc file; Trợ lý viết sau khi đọc đúng
   * một dòng `say` của nhân viên. Đó là nghe kể lại. Thang phải phản ánh nguồn,
   * nếu không thì lời đồn xếp trên chứng kiến:
   *
   *   0.9  GHI NHỚ  — người dùng tự chốt
   *   0.6  kinh nghiệm — nhân viên rút ra sau khi làm thật
   *   0.55 bài học chung — Trợ lý suy từ receipt, chưa từng thấy file
   */
  addSharedLesson(
    text: string,
    source: string,
    docs: readonly string[] = [],
    dependsOn: readonly string[] = [],
  ): KnowledgeNode | undefined {
    if (this.rejectLesson(text, docs, 'shared', 'bài học chung')) return undefined;

    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const node: KnowledgeNode = {
      id: `k/shared/${slug}`,
      type: 'playbook',
      title: text.slice(0, 60),
      tags: ['office'],
      links: [],
      scope: 'shared',
      author: 'assistant',
      confidence: 0.55,
      hits: 0,
      pinned: false,
      supersedes: [],
      updated: new Date().toISOString().slice(0, 10),
      ...(dependsOn.length ? { depends_on: [...dependsOn] } : {}),
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

/**
 * Bài học này có phải chỉ là chép lại một tài liệu không? Trả về tên file nếu có.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BẤT BIẾN "NODE TRI THỨC ≠ FILE NGƯỜI DÙNG TẢI LÊN" — GIỜ CÓ MÃ THI HÀNH. │
 * │                                                                          │
 * │ SPEC-library §1 tuyên bố ranh giới này từ 17/08, và không có dòng code    │
 * │ nào giữ nó. Ngày 19/08 chính hệ thống vi phạm: Trợ lý ghi vào kho chung   │
 * │ một câu diễn giải chính sách đổi trả của shop — thứ đã nằm sẵn trong tủ   │
 * │ tài liệu, chính xác hơn, và tìm bằng `Grep` thì miễn phí.                 │
 * │                                                                          │
 * │ Cái giá của bản sao đó không phải token (36 token, không đáng kể) mà là   │
 * │ SỰ THẬT: ngày người dùng sửa chính sách xuống 40%, file được cập nhật còn │
 * │ node thì không — và node thắng, vì nó nằm sẵn trong đầu mọi nhân viên     │
 * │ còn tài liệu thì phải đi tìm.                                            │
 * │                                                                          │
 * │ Cùng lớp lỗi với charter (§5f): hai chỗ giữ cùng một sự thật, không chỗ   │
 * │ nào biết chỗ kia.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ ĐÂY LÀ LƯỚI THỨ HAI, KHÔNG PHẢI LƯỚI CHÍNH — ghi rõ để đừng ai tin quá │
 * │                                                                          │
 * │ Chồng từ chỉ bắt được bản CHÉP GẦN NGUYÊN VĂN. Chính câu của ngày 19/08  │
 * │ ("giảm giá 60% thường không được đổi trả…") diễn giải khá xa bản gốc     │
 * │ ("Hàng giảm giá trên 50% KHÔNG áp dụng chính sách đổi trả") — đo được    │
 * │ chỉ ~0.47, LỌT qua lưới này. Bộ test ghi lại đúng ca đó để không ai lầm  │
 * │ tưởng hàm này là hàng rào.                                               │
 * │                                                                          │
 * │ Hàng rào thật là `worthLearning`: ca đó chạy sạch nên lẽ ra KHÔNG BAO    │
 * │ GIỜ được hỏi bài học. Hàm này chỉ lo phần còn lại — ca có trục trặc thật │
 * │ mà Trợ lý nhân tiện chép luôn một đoạn tài liệu vào.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ngưỡng đặt CAO (0.6) chứ không hạ xuống cho vừa ca 19/08, vì hạ xuống là mua
 * báo nhầm: *"Khi khách hỏi đổi trả, luôn hỏi mã đơn hàng trước khi trả lời"* là
 * bài học thật về cách làm việc, mà nó cũng chạm ~0.4 từ của tài liệu chỉ vì
 * nói cùng chủ đề. Bỏ sót thì còn lưới `worthLearning`; chặn nhầm thì mất hẳn.
 *
 * Đòi TỐI THIỂU 4 từ đặc trưng: bài học ngắn kiểu "luôn hỏi lại size" có quá ít
 * từ để so, và ép nó qua ngưỡng tỉ lệ sẽ toàn báo nhầm.
 */
export function echoesLibrary(text: string, docs: readonly string[]): string | undefined {
  const terms = tokenize(text);
  if (terms.length < 4 || docs.length === 0) return undefined;

  for (const doc of docs) {
    const words = new Set(tokenize(doc));
    if (words.size === 0) continue;
    let hit = 0;
    for (const t of terms) if (words.has(t)) hit++;
    if (hit / terms.length >= ECHO_RATIO) return docNameOf(doc);
  }
  return undefined;
}

/** Bao nhiêu phần từ đặc trưng của bài học phải nằm sẵn trong tài liệu thì coi là chép lại. */
const ECHO_RATIO = 0.6;

/**
 * Hai bài học giống nhau tới mức nào thì coi là một. Jaccard trên tập từ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÃ ĐO 21/08 — 0.75 QUÁ CAO, VÀ TIỀN ĐỀ BIỆN MINH CHO NÓ LÀ MỘT LỜI HỨA. │
 * │                                                                          │
 * │ Cặp trùng thật, cùng `scope: shared`, cách nhau chín phút:               │
 * │                                                                          │
 * │   "Phan-tich-standard liên tục chạm trần chi phí khi làm việc            │
 * │    nhóm+tổng hợp CSV — nên nới max_usd trước khi giao việc dạng này."    │
 * │   "Việc nhóm+tổng hợp CSV có thể chạm trần chi phí ở phan-tich-standard  │
 * │    — cân nhắc nới max_usd trước khi giao việc tương tự."                 │
 * │                                                                          │
 * │ Jaccard đo được: **0.654**. Trượt ngưỡng 0.75, hai node cùng sống. Phần  │
 * │ lệch nằm gần như trọn vẹn ở từ đệm — *liên tục* ↔ *có thể*, *nên* ↔      │
 * │ *cân nhắc*, *dạng này* ↔ *tương tự*. Cùng một câu, hai giọng.            │
 * │                                                                          │
 * │ ⚠ Chú thích cũ biện minh cho 0.75 bằng câu *"bỏ sót thì chỉ tốn một node │
 * │   mà Librarian (M1) gộp lại được sau"*. **Librarian CHƯA TỒN TẠI.** Nên  │
 * │   cái giá thật của bỏ sót không phải "một node chờ gộp" mà là **token    │
 * │   trong prefix của mọi worker, mọi lượt, vĩnh viễn**. Quyết định đúng    │
 * │   dựa trên một tiền đề sai là một quả bom hẹn giờ — và nó vừa nổ.        │
 * │                                                                          │
 * │ Hai phía KHÔNG đối xứng như chú thích cũ giả định:                       │
 * │   chặn nhầm  → mất một bài học, `hits` của bản cũ +1, còn dấu vết        │
 * │   bỏ sót     → trả token mãi mãi cho một bản sao không ai dọn            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 0.6 chứ không thấp hơn: dưới đó thì hai bài học cùng nói về một tài liệu bắt
 * đầu dính nhau chỉ vì chia sẻ tên file. Đo lại khi kho vượt vài chục node.
 */
const TWIN_RATIO = 0.6;

/**
 * Hai câu giống nhau bao nhiêu — Jaccard trên tập từ đặc trưng. `0`…`1`.
 *
 * Tách khỏi `findTwin` để NGƯỠNG KIỂM ĐƯỢC BẰNG TEST mà không phải dựng cả một
 * `KnowledgeStore` trên đĩa. Đây là nửa trả được ngay của nợ 0b: khi một luật
 * quan trọng nằm trong một method private cần I/O, món nợ thật là **hình dạng
 * của code**, không phải cái test còn thiếu.
 *
 * Đối xứng và không thiên vị câu dài — đổi thứ tự hai tham số không đổi kết quả.
 */
export function twinScore(a: string, b: string): number {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Bài học này có CHÉP CON SỐ từ tài liệu không? Trả về con số đó nếu có.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ MẢNH VÁ CHO ĐÚNG CA `echoesLibrary` ĐÃ ĐO ĐƯỢC LÀ LỌT.           │
 * │                                                                          │
 * │ Ngày 19/08, node `k/shared/san-pham-giam-gia-60-…` ghi *"giảm 60% THƯỜNG │
 * │ không được đổi trả"* trong khi tài liệu viết *"trên 50% KHÔNG áp dụng"*. │
 * │ Chồng từ đo được **0.47** — dưới ngưỡng 0.6, lọt lưới. Diễn giải càng    │
 * │ xa bản gốc thì lưới chồng-từ càng yếu, mà **diễn giải sai mới là thứ     │
 * │ nguy hiểm**: nó vừa sai vừa không truy được về nguồn.                    │
 * │                                                                          │
 * │ Con số thì ngược lại — nó SỐNG SÓT qua mọi cách diễn đạt. Và một câu về  │
 * │ CÁCH LÀM gần như không bao giờ cần tới ngưỡng, giá hay ngày tháng:       │
 * │                                                                          │
 * │   ✅ "grep trong library/text/ trước khi trả lời"          — không số     │
 * │   ⛔ "hàng giảm trên 50% không đổi trả"                     — có 50       │
 * │                                                                          │
 * │ Nên "có con số, mà con số đó nằm sẵn trong tài liệu" là dấu hiệu gần như │
 * │ chắc chắn của KIẾN THỨC bị chép, và nó tất định — không phỏng đoán gì.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chỉ chặn khi con số CÓ MẶT TRONG TÀI LIỆU. Bài học kiểu *"hỏi lại tối đa 2 câu
 * rồi bắt tay vào làm"* mang số 2 nhưng đó là số của CÁCH LÀM, không của tài
 * liệu nào — nó phải đi qua được.
 *
 * Bỏ qua số ≤ 1 chữ số: chúng gần như luôn là số đếm bước ("2 câu", "3 lần") và
 * đụng ngẫu nhiên với tài liệu quá dễ.
 */
export function quotesLibraryNumber(text: string, docs: readonly string[]): string | undefined {
  const nums = [...new Set(text.match(/\d[\d.,]*/g) ?? [])].filter((n) => n.replace(/\D/g, '').length >= 2);
  if (nums.length === 0 || docs.length === 0) return undefined;

  for (const n of nums) {
    // Ranh giới chữ số ở hai đầu: "50" không được khớp vào "150" hay "500".
    const re = new RegExp(`(?<!\\d)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
    for (const doc of docs) {
      if (re.test(doc)) return n;
    }
  }
  return undefined;
}

/** Dòng đầu của bản văn tài liệu là tên file — xem `Office.libraryTexts()`. */
function docNameOf(doc: string): string {
  return doc.split('\n', 1)[0]?.trim() || 'tài liệu';
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
