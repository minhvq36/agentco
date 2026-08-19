/**
 * Một VĂN PHÒNG đang chạy — chỗ mọi thứ gặp nhau.
 *
 * → docs/SPEC-offices.md
 *
 * Văn phòng tự chứa đầy đủ: Trợ lý riêng, nhân viên riêng, kho tri thức riêng,
 * session riêng. Không nói chuyện với văn phòng khác. Đó là lý do zip một thư
 * mục `offices/<id>/` lại là một template chạy được ở máy khác.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { loadOffice, type LoadedOffice } from './config.js';
import { ensureOfficeDirs, isSafeId, normalizeName, safeJoin, slugId } from './paths.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { LibraryStore } from '../library/store.js';
import { ArtifactStore } from './artifacts.js';
import { LayoutStore, ASSISTANT_NODE, type LayoutNode } from './layout.js';
import { Assistant, newPlanId } from './assistant.js';
import { helpText, parseInput, resolveFileRefs, type ParsedInput } from './commands.js';
import { Mailbox, mergeUserText } from './mailbox.js';
import { PlanStore, agentHue } from './plans.js';
import { Scheduler } from './scheduler.js';
import { buildWorkerPrompt, describePrompt, type PromptLayer } from './prompt.js';
import { estimateTokens, truncateToTokens } from './tokens.js';
import {
  RunError,
  TIERS,
  type AgentEvent,
  type AgentEventBody,
  type CompanyConfig,
  type Plan,
  type PlanRecord,
  type PlanStatus,
  type Receipt,
  type TaskBrief,
  type Usage,
} from './types.js';

export type OfficeState = 'idle' | 'working' | 'paused' | 'stopped';

/**
 * Trần số file liệt kê trong câu báo cáo. Một ca chạm 20 CV (bài 8 của
 * TEST-WALKTHROUGH) sẽ sinh hàng chục file — đổ hết vào ô chat là biến câu báo
 * cáo thành một bức tường không ai đọc. Phần dư nói bằng một dòng đếm.
 */
const MAX_LISTED_FILES = 8;

/** Số tin nhắn phát lại khi mở văn phòng. Đủ để nhớ mạch, không phải cả đời. */
const CHAT_REPLAY = 200;

/**
 * Số CA gần nhất được nêu trong bảng kê kết quả gửi cho Trợ lý.
 *
 * 5 chứ không phải 1: ca người dùng muốn nhắc lại không phải lúc nào cũng là ca
 * vừa xong. Ca thật 20/08 cần một kết quả của **25 phút và hai ca trước đó**.
 * Cũng không phải "tất cả": trần token mới là chốt cuối, còn đây là chốt rẻ
 * chạy trước nó. → `artifactManifest`
 */
const MANIFEST_PLANS = 5;

/** Khoá gom cho file cũ nằm thẳng dưới `artifacts/<task_id>/` (trước 19/08). */
const LEGACY_PLAN = '(cũ)';

/** Node đã kèm metadata để vẽ. Không có gì trong đây được ghi vào layout.json. */
export interface CanvasNode extends LayoutNode {
  label: string;
  avatar?: string;
  /** Mức model: `eco` | `standard` | `deep`. Với Trợ lý có thể là mức thừa hưởng. */
  tier?: string;
  /** Model thật sự sẽ chạy ở mức đó. Nói ra để người dùng không phải đoán. */
  model?: string;
  /** Trợ lý: true khi mức đang theo `models.master` của công ty, không phải đặt riêng. */
  tierInherited?: boolean;
  pitch?: string;
  /** agent: số ghi chú sổ tay riêng · knowledge: tổng số node */
  count?: number;
  mcp?: string[];
  /** màu đại diện, dùng chung với log */
  hue?: number;
  /** không tìm thấy roles/<id>.yaml hoặc mcp server đã biến khỏi company.yaml */
  missing: boolean;
  /** có dây từ Trợ lý → được giao việc. Không có dây = "đang nghỉ". */
  connected: boolean;
  /** Trợ lý và kho tri thức không xoá được. */
  removable: boolean;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: Array<{ from: string; to: string }>;
  knowledge: { shared: number; total: number };
}

export interface SayOutcome {
  intent: 'chat' | 'ask' | 'task';
  reply: string;
  plan_id?: string;
}

export class Office {
  loaded: LoadedOffice;
  readonly knowledge: KnowledgeStore;
  /** Tủ tài liệu — file người dùng đưa vào. → docs/SPEC-library.md */
  readonly library: LibraryStore;
  /** Kết quả — file nhân viên làm ra. → docs/SPEC-artifacts.md */
  readonly artifacts: ArtifactStore;
  readonly assistant: Assistant;
  readonly layout: LayoutStore;
  readonly plans: PlanStore;

  private state: OfficeState = 'idle';
  private stopRequested = false;
  private currentPlan: Plan | undefined;
  private currentRecord: PlanRecord | undefined;
  /** Scheduler của ca đang chạy — giữ để ngắt được giữa chừng. */
  private activeScheduler: Scheduler | undefined;
  /** Hòm thư của Trợ lý — nó là MỘT người, làm một việc một lúc. */
  private readonly mailbox = new Mailbox();
  /** Việc người dùng giao trong lúc đang bận, làm nốt sau khi ca này xong. */
  private deferred: Array<{ request: string; at: number }> = [];
  /** Artifact của ca vừa xong — để bàn giao cho việc xếp hàng kế tiếp. */
  private lastArtifacts: string[] = [];
  /**
   * MA SÁT: số lượt lập kế hoạch KHÔNG ra được kế hoạch kể từ ca chạy được gần
   * nhất. Tăng khi planner hỏi lại hoặc không trả về JSON; về 0 khi một ca thật
   * sự khởi động. Đây là thứ duy nhất trong hệ thống đo được **con người phải
   * vật lộn bao nhiêu**, chứ không phải cỗ máy. → `assistant.ts → worthLearning`
   *
   * Ở RAM chứ không trên đĩa là có chủ ý: nó chỉ có nghĩa trong một mạch hội
   * thoại liền. Tắt daemon rồi mở lại thì người dùng đã bỏ đi và quay lại — ma
   * sát của phiên trước không còn dạy được gì về phiên này.
   */
  private planFriction = 0;
  private emitFn: (e: AgentEvent) => void = () => {};

  constructor(loaded: LoadedOffice) {
    this.loaded = loaded;
    ensureOfficeDirs(loaded.paths);
    this.knowledge = new KnowledgeStore(loaded.dir, loaded.paths);
    this.knowledge.scan();
    // Bóc tài liệu chạy NGẦM (§10) nên nó phải có đường báo cho giao diện — nếu
    // không thì dòng "đang đọc…" đứng im cho tới lần người dùng bấm mở tủ.
    this.library = new LibraryStore(loaded.paths, () => this.emitLibrary());
    this.artifacts = new ArtifactStore(loaded.paths);
    this.assistant = new Assistant(loaded);
    this.assistant.resumeFrom(this.readSessionId());
    this.layout = new LayoutStore(loaded);
    this.plans = new PlanStore(loaded.paths);
    this.refreshAssistantContext();
  }

  get id(): string {
    return this.loaded.id;
  }

  get name(): string {
    return this.loaded.config.name;
  }

  get currentState(): OfficeState {
    return this.state;
  }

  /** Đã cất vào lưu trữ — đóng băng, chỉ đọc. → docs/SPEC-offices.md §3.1 */
  get archived(): boolean {
    return this.loaded.config.archived;
  }

  /**
   * Chốt chặn DUY NHẤT cho "văn phòng lưu trữ là chỉ đọc".
   *
   * Gọi ở đầu MỌI hàm làm thay đổi thứ gì đó. Một chốt một câu, thay vì rải
   * điều kiện khắp nơi rồi sót một chỗ — mà chỗ sót nguy hiểm nhất là chỗ tiêu
   * tiền, vì tiền là thứ duy nhất người dùng không lấy lại được.
   */
  private assertLive(): void {
    if (!this.archived) return;
    throw new RunError(
      `Văn phòng "${this.name}" đang trong lưu trữ nên chỉ xem được. ` +
        `Khôi phục nó ở bảng Tổng quan công ty rồi làm tiếp.`,
      'other',
    );
  }

  get plan(): Plan | undefined {
    return this.currentPlan;
  }

  /** Company gắn bus vào đây. Mọi sự kiện tự động mang `office` và `plan_id`. */
  bindBus(fn: (e: AgentEvent) => void): void {
    this.emitFn = fn;
  }

  emit(e: AgentEventBody & { plan_id?: string | null }): void {
    const planId = e.plan_id !== undefined ? e.plan_id : (this.currentRecord?.plan_id ?? null);
    const full = { ...e, office: this.id, plan_id: planId } as AgentEvent;
    if (planId) this.plans.append(planId, full);
    if (full.type === 'master.message') this.appendChat(full);
    this.emitFn(full);
  }

  /**
   * Luồng hội thoại, GHI RA ĐĨA. → docs/SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MÀN HÌNH KHÔNG ĐƯỢC NÓI DỐI VỀ THỨ HỆ THỐNG CÒN NHỚ.                    │
   * │                                                                          │
   * │ Trí nhớ của Trợ lý nằm trên đĩa ở HAI chỗ và sống sót qua mọi lần tắt    │
   * │ daemon: con trỏ `.state/assistant-session.json`, và bản ghi hội thoại    │
   * │ do chính CLI Claude Code giữ trong `~/.claude/projects/`. Nhưng ô chat   │
   * │ trên giao diện lại đọc từ một vòng đệm 300 sự kiện TRONG BỘ NHỚ.         │
   * │                                                                          │
   * │ Hệ quả người dùng gặp thật: tắt daemon, mở lại, ô chat TRẮNG TRƠN — rồi  │
   * │ gõ tiếp "200 từ, hài hước" thì Trợ lý trả lời đúng như chưa hề mất gì.   │
   * │ Model nhớ, màn hình quên. Người dùng không thể tin cái nào nữa.          │
   * │                                                                          │
   * │ Sự kiện gắn với một công việc đã được ghi ở `<plan_id>.log.jsonl` từ     │
   * │ trước; chỗ hổng đúng là hội thoại (`plan_id: null`) — thứ KHÔNG thuộc    │
   * │ việc nào nên không có file nào nhận.                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private appendChat(e: AgentEvent): void {
    try {
      fs.mkdirSync(this.loaded.paths.state, { recursive: true });
      fs.appendFileSync(this.chatFile(), `${JSON.stringify({ ...e, ts: new Date().toISOString() })}\n`, 'utf8');
    } catch {
      /* Không ghi được nhật ký hội thoại KHÔNG được làm hỏng câu trả lời. */
    }
  }

  /**
   * Hội thoại đã lưu, mới nhất ở cuối. Đọc khi mở văn phòng.
   *
   * Cắt về `CHAT_REPLAY` dòng cuối chứ không đọc cả file: nó chỉ để người dùng
   * thấy lại mạch chuyện, không phải để làm trí nhớ cho model — trí nhớ model
   * nằm ở session của SDK và không đi qua đây.
   */
  readChat(limit = CHAT_REPLAY): AgentEvent[] {
    try {
      const lines = fs.readFileSync(this.chatFile(), 'utf8').split('\n').filter((l) => l.trim());
      return lines.slice(-limit).flatMap((l) => {
        try {
          return [JSON.parse(l) as AgentEvent];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private chatFile(): string {
    return path.join(this.loaded.paths.state, 'chat.jsonl');
  }

  /**
   * Dừng việc — daemon vẫn sống. Đây là thứ người dùng muốn 95% số lần.
   *
   * NGẮT NGAY worker đang chạy, không chỉ đặt cờ. Trước đây cờ chỉ được kiểm
   * GIỮA các task, nên bấm Dừng xong vẫn phải ngồi chờ task hiện tại chạy hết —
   * có khi cả phút và cả nghìn token đã tiêu.
   */
  stop(): { dropped: number } {
    this.stopRequested = true;
    void this.activeScheduler?.interruptAll();
    // Dừng là dừng CẢ HỆ THỐNG: ngắt nhân viên đang chạy, bỏ tin còn trong hòm
    // thư, bỏ việc đang hoãn. Giữ lại bất cứ thứ gì trong số đó nghĩa là người
    // dùng bấm Dừng xong vẫn thấy hệ thống tự làm tiếp — đúng thứ họ vừa bảo đừng.
    const dropped = this.mailbox.clear() + this.deferred.length;
    this.deferred = [];
    if (this.state === 'working') this.setState('paused', 'Đang dừng…');
    this.emitActivity();
    return { dropped };
  }

  // ── cửa vào duy nhất

  /**
   * Cửa vào DUY NHẤT cho mọi thứ người dùng gõ. UI và bridge chat đều dùng cái này.
   *
   * Trước đây UI luôn gọi thẳng `run()`, nên gõ "Chào" cũng khởi động cả một DAG
   * rồi fail — lỗi người dùng gặp ngay thao tác đầu tiên.
   */
  async say(message: string): Promise<SayOutcome> {
    this.assertLive();
    this.emit({ type: 'master.message', say: message, role: 'user', plan_id: null });

    /**
     * `@đường-dẫn` — GIẢI BẰNG CODE, TRƯỚC KHI TỚI MODEL. → docs/SPEC-library.md §8c
     *
     * Chạy ở đây, ngay sau khi ghi tin của người dùng vào luồng và TRƯỚC mọi
     * nhánh khác: người dùng phải thấy đúng thứ họ gõ trong ô chat, còn model
     * thì nhận bản đã được xác minh.
     */
    const refs = this.resolveRefs(message);
    if (refs.problem) {
      // Trả lời bằng CODE. Một đường dẫn không tồn tại là SỰ VIỆC — ta đang cầm
      // cả hai cái kho trong tay, hỏi model là trả tiền để nhận về một phỏng đoán.
      this.emit({ type: 'master.message', say: refs.problem, role: 'assistant', plan_id: null });
      this.emitActivity();
      return { intent: 'chat', reply: refs.problem };
    }
    message = refs.text;

    // Lệnh chữ bị bắt TRƯỚC khi tới model. Hai lý do, cả hai đều bắt buộc:
    // ném "/stop" cho model là trả tiền để được dừng chậm hơn; và chuỗi bắt đầu
    // bằng "/" có thể bị chính CLI Claude Code hiểu là lệnh CỦA NÓ.
    // → docs/SPEC-tools-approval.md §8e
    const parsed = parseInput(message);
    if (parsed.kind !== 'text') {
      const outcome = this.runCommand(parsed);
      // BẮT BUỘC: giao diện bật dòng "đang đọc yêu cầu…" ngay khi bấm Gửi, và
      // chỉ tắt nó khi nhận được `office.activity`. Lệnh chữ trả lời tức thì
      // bằng code nên KHÔNG đi qua hòm thư — không có dòng này thì ba chấm quay
      // mãi mãi sau mỗi `/help`, và người dùng phải tải lại trang mới hết.
      this.emitActivity();
      return outcome;
    }

    // Bỏ vào hòm thư thay vì gọi thẳng. Trợ lý là MỘT NGƯỜI: hai lượt gọi chồng
    // nhau trên cùng một session thì một lượt bị mất trắng khỏi trí nhớ hội
    // thoại. → docs/SPEC-tools-approval.md §11
    if (!this.mailbox.push({ kind: 'user', text: parsed.text, at: Date.now() })) {
      const say = `Bạn nhắn nhanh quá — mình còn ${this.mailbox.size} tin chưa đọc. Chờ mình xử lý xong đã nhé.`;
      this.emit({ type: 'master.message', say, role: 'assistant', plan_id: null });
      return { intent: 'chat', reply: say };
    }

    this.emitActivity();
    void this.pump();
    return { intent: 'chat', reply: '' };
  }

  /**
   * Giải `@đường-dẫn` người dùng dán vào ô chat. → docs/SPEC-library.md §8c
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO KHÔNG TRÔNG CHỜ SDK HIỂU `@` — VÀ VÌ SAO TA KHÔNG MUỐN NÓ HIỂU.  │
   * │                                                                          │
   * │ CLI Claude Code có cú pháp `@file` khi gõ tay. Nó CÓ chạy trong SDK hay  │
   * │ không thì **chưa ai đo** — `FINDINGS-sdk` không có dòng nào về nó, và    │
   * │ dự án này đã có tiền lệ đắt về việc xây lên một hành vi SDK chưa đo      │
   * │ (`canUseTool` không nổ lần nào, §4.7).                                   │
   * │                                                                          │
   * │ 🔥 Nhưng lý do thật mạnh hơn: **nếu SDK có hiểu thì đó là chuyện XẤU.**  │
   * │ Mở rộng `@` nghĩa là nhét NỘI DUNG file vào lượt gọi — mà Trợ lý chạy    │
   * │ trên session được persist, nên mọi thứ nó đọc nằm trong ngữ cảnh của     │
   * │ MỌI lượt sau đó: *đọc một lần, trả tiền mãi mãi*. Cả kiến trúc dựng trên │
   * │ luật "Trợ lý không đọc file, nhân viên mới đọc".                         │
   * │                                                                          │
   * │ Nên `@` bị BÓC HẾT ở đây. Model không bao giờ nhìn thấy ký tự đó, và ta  │
   * │ không phụ thuộc vào bất kỳ hành vi SDK nào — đo hay chưa đo cũng vậy.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Regex chạy trên chữ NGƯỜI DÙNG GÕ, không phải chữ model sinh — khác hẳn
   * luật cấm dò đường dẫn trong `say` (SPEC-artifacts §2.5). Ở đó rủi ro là
   * model bịa; ở đây người dùng tự chịu trách nhiệm cho thứ họ gõ, và mọi tham
   * chiếu vẫn phải ĐỐI CHIẾU với kho thật trước khi được công nhận.
   *
   * Ba dạng nhận được, và dạng thứ ba là lý do phải có hàm này:
   *
   *   @artifacts/P-…/T-01/vi/doc-2.md   đường dẫn đủ  → đối chiếu rồi dùng
   *   @library/files/doc-1.md            đường dẫn đủ  → đối chiếu rồi dùng
   *   @doc-1.md                          tên trần      → tra, và CHẶN nếu trùng
   *
   * Tên trần trùng nhau là ca có thật: tủ tài liệu có `doc-1.md` và ngăn Kết
   * quả cũng có `doc-1.md`. Đoán bừa một bên là làm sai việc của người dùng
   * một cách im lặng — nên hỏi lại, bằng code, 0 token.
   */
  private resolveRefs(text: string): { text: string; problem?: string } {
    // Danh sách đường dẫn THẬT, đọc từ hai kho ngay tại thời điểm này. Phần
    // quyết định thì thuần và nằm ở `commands.ts` để bộ test chạm được.
    return resolveFileRefs(text, [
      ...this.library.list().map((d) => `library/files/${d.name}`),
      ...this.artifacts.list().map((a) => a.path),
    ]);
  }

  /**
   * Vòng bơm hòm thư. Chạy một lô một lúc, không bao giờ hai lô cùng lúc.
   *
   * Trợ lý bận KHÔNG có nghĩa là văn phòng bận: nhân viên vẫn chạy song song
   * bên dưới. Hai trạng thái đó độc lập, và `emitActivity()` nói cả hai ra.
   */
  private async pump(): Promise<void> {
    if (this.mailbox.isBusy) return;

    const batch = this.mailbox.take();
    if (!batch) {
      this.emitActivity();
      return;
    }

    try {
      await this.mailbox.lock(async () => {
        this.emitActivity();
        await this.handleUserBatch(mergeUserText(batch));
      });
    } catch (err) {
      this.emit({
        type: 'master.message',
        role: 'assistant',
        say: err instanceof Error ? err.message : 'Có lỗi khi xử lý tin nhắn của bạn.',
        plan_id: null,
      });
    }

    this.emitActivity();
    // Còn thư thì đọc tiếp. Đệ quy qua microtask nên không làm sâu ngăn xếp.
    if (this.mailbox.size > 0) void this.pump();
  }

  private async handleUserBatch(text: string): Promise<void> {
    const routed = await this.assistant.route(text, this.state === 'working');
    // `route` chạy MỖI lượt người dùng nhắn. Bản trước vứt thẳng `routed.usage`
    // đi, nên toàn bộ chi phí trò chuyện vô hình với `agentco cost` — và đó
    // đúng là phần bị đổi model làm đắt lên. Không đo được thì không đánh giá
    // được cái giá của việc đổi model. → SPEC-token-economy.md §5
    this.logAssistantUsage('route', routed.usage);
    this.saveSessionId();

    if (routed.value.intent === 'task') {
      // scope "refine" gắn vào việc đang chạy; "new" sinh một Plan độc lập.
      // Khi phân vân Trợ lý được dặn chọn "new" — hai việc tách rời chỉ tốn thêm
      // một lần lập kế hoạch, còn gắn nhầm thì làm hỏng cả hai.
      if (this.state === 'working') {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say:
            routed.value.scope === 'refine'
              ? 'Đã ghi nhận bổ sung. Mình áp dụng ngay khi việc đang chạy xong.'
              : 'Mình đang bận một việc rồi. Xong việc này mình làm tiếp việc bạn vừa giao nhé.',
        });
        this.deferred.push({ request: routed.value.request, at: Date.now() });
        return;
      }
      // KHÔNG await: DAG chạy nền, và trong lúc đó Trợ lý phải RẢNH để nói
      // chuyện tiếp. Đây là chỗ "một người, nhiều khoảng trống thời gian".
      void this.run(routed.value.request).catch(() => {
        /* run() đã emit lỗi lên UI rồi */
      });
      return;
    }

    // chat hoặc ask — trả lời rồi thôi, không tốn một token worker nào
    this.emit({ type: 'master.message', say: routed.value.say, role: 'assistant', plan_id: null });
  }

  /**
   * Trạng thái Trợ lý và trạng thái nhân viên là HAI thứ. Nói cả hai ra.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MẠCH KHÔNG ĐƯỢC ĐỨT.                                                     │
   * │                                                                          │
   * │ Từ lúc người dùng bấm Gửi tới lúc có kết quả, LUÔN phải có một câu mô tả │
   * │ việc đang diễn ra. Bản trước đứt đúng một nhịp — giữa lúc Trợ lý đọc     │
   * │ xong yêu cầu và lúc kế hoạch hiện ra — vì `run()` chạy nền còn hòm thư   │
   * │ đã mở khoá, nên mọi con số đều bằng 0.                                   │
   * │                                                                          │
   * │ `planning` lấp đúng nhịp đó. Đọc từ `currentRecord.status`, tức là từ    │
   * │ BẢN GHI CÔNG VIỆC — thứ tồn tại từ trước khi lập kế hoạch, kể cả khi lập │
   * │ kế hoạch fail. Không suy ra từ hòm thư, vì hòm thư chính là chỗ đã sai.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * Đang nén trí nhớ — TRẠNG THÁI THẬT, không phải một câu hẹn giờ.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG ĐÃ SỬA: "/clear nháy một cái rồi khựng im rất lâu".                  │
   * │                                                                          │
   * │ Bản trước phát câu "Đang dọn…" bằng một `note` có hẹn giờ. Nhưng `say()` │
   * │ gọi `emitActivity()` NGAY SAU `runCommand()` — và activity đó không mang │
   * │ `note`, nên giao diện xoá luôn câu vừa đặt. Người dùng thấy nó nháy vài  │
   * │ chục mili giây, rồi im lặng hoàn toàn suốt cả lượt gọi model.            │
   * │                                                                          │
   * │ Bài học chung hơn: **một việc đang chạy là TRẠNG THÁI, không phải một    │
   * │ thông báo.** Thông báo thì có kẻ khác ghi đè được và có hẹn giờ để hết   │
   * │ hạn; trạng thái thì đúng chừng nào việc còn chạy, bất kể ai phát         │
   * │ `emitActivity()` xen vào. Nén mất 5–15 giây — đó là khoảng im lặng dài   │
   * │ nhất trong sản phẩm, đúng thứ luật "mạch không được đứt" (§6) cấm.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private clearing = false;

  private emitActivity(): void {
    const planning = this.currentRecord?.status === 'planning';
    if (this.clearing) {
      // Đè lên mọi thứ khác: lúc này Trợ lý không "nghĩ" về tin nhắn nào cả,
      // nó đang nén trí nhớ. Nói "đang nghĩ…" ở đây là mô tả sai việc đang chạy.
      this.emit({
        type: 'office.activity',
        assistant: 'thinking',
        workers: this.activeScheduler?.runningCount ?? 0,
        queued: this.mailbox.size,
        jobs: this.deferred.length,
        /**
         * Nói luôn là MẤT VÀI GIÂY — đây là khoảng chờ dài nhất trong sản phẩm
         * mà người dùng không thấy có việc gì đang chạy trên sơ đồ.
         *
         * ⚠ CỐ Ý KHÔNG kèm `hold_ms`: đây là TRẠNG THÁI của một việc đang chạy,
         * phải đúng chừng nào việc còn chạy. Thêm `hold_ms` vào đây là tái tạo
         * lại đúng khoảng im lặng vừa vá. → core/types.ts `office.activity`
         */
        note: 'Đang dọn cuộc trò chuyện, cất lại những gì bạn đã chốt… (mất vài giây)',
        plan_id: null,
      });
      return;
    }
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : planning ? 'planning' : 'idle',
      workers: this.activeScheduler?.runningCount ?? 0,
      queued: this.mailbox.size,
      jobs: this.deferred.length,
      plan_id: this.currentRecord?.plan_id ?? null,
    });
  }

  /**
   * Một câu trạng thái TẠM — hiện rồi tự biến, không để lại gì trong luồng chat.
   *
   * Đây là đường nói chuyện của `/clear` (§4.6). Nó cố ý KHÔNG mang các con số
   * bận/rảnh: nó đè lên dòng trạng thái, và lượt `emitActivity()` kế tiếp sẽ tự
   * lấy lại quyền — nên không có ca "câu tạm kẹt trên màn hình vĩnh viễn".
   *
   * `hold_ms` là gợi ý cho BÊN HIỂN THỊ, không phải hẹn giờ ở server: web tự xoá
   * sau ngần ấy, còn Telegram giữ nguyên tin đã sửa làm vạch ngăn. Cùng một sự
   * kiện, hai kết cục — đúng luật "mỗi bên hiển thị tự chọn cách phản ứng".
   */
  private emitNote(note: string, holdMs = 4_000): void {
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : 'idle',
      workers: this.activeScheduler?.runningCount ?? 0,
      queued: this.mailbox.size,
      jobs: this.deferred.length,
      note,
      hold_ms: holdMs,
      plan_id: null,
    });
  }

  /** Lệnh chữ — xử lý hoàn toàn bằng code, KHÔNG gọi model. 0 token. */
  private runCommand(parsed: Exclude<ParsedInput, { kind: 'text' }>): SayOutcome {
    const reply = (say: string): SayOutcome => {
      this.emit({ type: 'master.message', say, role: 'assistant', plan_id: null });
      return { intent: 'chat', reply: say };
    };

    if (parsed.kind === 'unknown') return reply(helpText(parsed.typed));

    switch (parsed.name) {
      case 'help':
        return reply(helpText());

      case 'stop': {
        const idle = this.state !== 'working' && this.mailbox.size === 0 && this.deferred.length === 0;
        if (idle) return reply('Hiện không có việc nào đang chạy.');
        const { dropped } = this.stop();
        return reply(
          'Đang dừng tất cả.' +
            (dropped ? ` Đã bỏ ${dropped} việc còn trong hàng đợi.` : '') +
            ' Việc đã xong vẫn giữ nguyên — nhắn tiếp để mình làm phần còn lại.',
        );
      }

      case 'status': {
        if (!this.currentRecord) {
          return reply(
            `Đang rảnh. Văn phòng có ${this.loaded.roles.size} nhân viên, ` +
              `${this.assistant.assignableRoles().size} người đang trực.`,
          );
        }
        const r = this.currentRecord;
        const done = r.steps.filter((s) => s.status === 'done').length;
        return reply(
          `Đang làm: ${r.request}\n` +
            `Bước ${done}/${r.steps.length} · ${r.tasks_done}/${r.tasks_total} việc · ` +
            `${r.turns} lượt · $${r.costUSD.toFixed(4)}`,
        );
      }

      case 'clear': {
        if (this.state === 'working') {
          return reply('Đang có việc chạy dở. Bấm Dừng hoặc chờ xong rồi mình dọn nhé.');
        }
        /**
         * `/clear` KHÔNG PHÁT MỘT `master.message` NÀO. → SPEC-offices.md §4.6
         *
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ Nhịp "Đang dọn…" VỐN ĐÃ là trạng thái giả dạng tin nhắn: nó luôn │
         * │ bị chính `office.cleared` ngay sau đó cuốn đi, không nhánh nào nó │
         * │ sống sót. Một tin nhắn được thiết kế để không tồn tại quá một     │
         * │ nhịp thì nó LÀ trạng thái — gọi đúng tên là trung thực hơn.       │
         * │                                                                  │
         * │ Nhịp "Đã dọn xong" thì tệ hơn: nó khiến `/clear` để lại rác cho  │
         * │ đúng thứ nó vừa dọn, và dòng đó không thuộc về ai — không phải    │
         * │ người dùng hỏi, không phải Trợ lý trả lời, mà là hệ thống tự nói  │
         * │ về chính mình.                                                    │
         * │                                                                  │
         * │ Cùng khuôn `…thinking` → trắng: QUÁ TRÌNH hiện rồi biến, chỉ KẾT  │
         * │ QUẢ mới ở lại. Bằng chứng bền là node GHI NHỚ trong ngăn Tri thức.│
         * └──────────────────────────────────────────────────────────────────┘
         */
        // Cờ TRẠNG THÁI, không phải một câu có hẹn giờ. `say()` phát
        // `emitActivity()` ngay sau hàm này, và chính nó đọc cờ để nói đúng
        // việc đang chạy — thay vì xoá mất câu vừa đặt. Xem `clearing`.
        this.clearing = true;
        // KHÔNG await: trả lời ngay để ô chat không đứng hình, rồi báo kết quả
        // bằng sự kiện như mọi thứ khác.
        void this.compactMemory()
          .then((r) => {
            this.clearing = false;
            this.emitNote(r.note);
          })
          // Tin XẤU giữ lâu hơn tin tốt: người ta đọc tin xấu chậm hơn, và câu
          // này báo một việc ĐÃ KHÔNG xảy ra — ngữ cảnh vẫn còn nguyên.
          .catch(() => {
            this.clearing = false;
            this.emitNote('Chưa dọn được cuộc trò chuyện. Mình giữ nguyên mọi thứ, thử lại sau nhé.', 8_000);
          });
        return { intent: 'chat', reply: '' };
      }

      // Cổng duyệt chưa cài đặt (SPEC-tools-approval.md §8). Trả lời trung thực
      // thay vì im lặng — người dùng gõ /approve nghĩa là họ đang chờ một thứ
      // mà ta chưa hỏi, và họ cần biết là ta chưa hỏi.
      case 'approve':
      case 'reject':
        return reply('Hiện không có gì đang chờ bạn duyệt.');
    }
  }

  // ── chạy một yêu cầu

  async run(request: string): Promise<{ plan_id: string; report: string; usage: Usage }> {
    this.assertLive();
    if (this.state === 'working') {
      throw new RunError('Văn phòng đang bận. Đợi xong ca này đã.', 'other');
    }

    this.stopRequested = false;
    let usage: Usage = emptyUsage();

    // Bản ghi công việc tồn tại TỪ TRƯỚC khi lập kế hoạch: nếu lập kế hoạch
    // fail thì người dùng vẫn phải thấy "đã có một việc, và nó hỏng ở đâu".
    const record: PlanRecord = {
      plan_id: newPlanId(),
      office: this.id,
      request,
      status: 'planning',
      started_at: new Date().toISOString(),
      steps: [],
      tasks_done: 0,
      tasks_total: 0,
      costUSD: 0,
      turns: 0,
    };
    this.currentRecord = record;
    this.plans.upsert(record);
    this.setState('working', 'Trợ lý đang lập kế hoạch...');
    // Nối mạch NGAY. `run()` được gọi bằng `void` từ `handleUserBatch`, và ngay
    // sau đó `pump()` phát một activity toàn số 0 — nếu ta không phát cái này
    // trước thì dòng trạng thái tắt đúng vào lúc việc mới bắt đầu.
    this.emitActivity();

    try {
      /**
       * 0a. Chờ tài liệu đang bóc — ĐIỂM CHỜ DUY NHẤT của tủ tài liệu.
       *
       * → docs/SPEC-library.md §10
       *
       * Không chờ ở đây thì có một ca hỏng thật và im lặng: người dùng thả một
       * PDF rồi hỏi ngay, `Grep` chạy trước khi văn bản kịp tồn tại, và nhân
       * viên trả lời "không tìm thấy gì trong tài liệu" một cách rất thuyết
       * phục. Sai mà không ai biết là kết cục tệ nhất trong mọi kết cục.
       *
       * Phạm vi chờ hẹp hết mức: chỉ file đang bóc của CHÍNH văn phòng này, có
       * timeout, và không đụng gì tới văn phòng khác. Dừng cả hệ thống để đợi
       * index là thứ luật "không có ngoại lệ nào cần dừng tất cả" đã cấm.
       */
      const waitingFor = this.library.busyNames();
      if (waitingFor.length > 0) {
        this.setState('working', `Đang đọc tài liệu ${waitingFor.slice(0, 2).join(', ')}…`);
        await this.library.settled(this.loaded.company.library.extract_timeout_ms);
      }

      // 0. Không ai trực thì đừng tốn một token nào để biết điều đó.
      const onDuty = this.assistant.assignableRoles();
      if (onDuty.size === 0) {
        throw new RunError(
          this.loaded.roles.size === 0
            ? 'Văn phòng này chưa có nhân viên nào. Bấm "+ Nhân viên" trên sơ đồ để thêm người đầu tiên.'
            : 'Chưa có nhân viên nào được giao việc. Trên sơ đồ, kéo một sợi dây từ Trợ lý xuống một nhân viên.',
          'other',
        );
      }

      // 1. Kế hoạch — QUA KHOÁ. Trợ lý là một người: nếu người dùng vừa nhắn
      // gì đó thì lượt đó phải xong trước, không được chồng lên lượt này.
      // `record.plan_id` đi VÀO khâu lập kế hoạch, không phải được ghi đè lên
      // kết quả của nó: `artifactScoper` đóng khung đường dẫn bằng id nó nhận
      // được, nên ghi đè sau đó là để lại một thư mục kết quả mang id mồ côi.
      // → `Assistant.plan`
      // Lập kế hoạch NÉM thì cũng là một lượt người dùng phải nói lại — đếm ở
      // đây chứ không ở `catch` cuối hàm: `catch` đó còn nhận cả "chưa có nhân
      // viên nào trực" và "văn phòng đang bận", vốn là chuyện cấu hình chứ
      // không phải chuyện hai bên chưa hiểu nhau. → `planFriction`
      const planned = await this.mailbox
        .lock(() => this.assistant.plan(request, record.plan_id))
        .catch((err: unknown) => {
          this.planFriction++;
          throw err;
        });
      usage = addUsage(usage, planned.usage);
      this.logAssistantUsage('plan', planned.usage);

      /**
       * 1b. Chưa chia được vì THIẾU THÔNG TIN → hỏi lại, KHÔNG phải một lỗi.
       *
       * → docs/SPEC-offices.md §6 · `Assistant.plan`
       *
       * Ca này kết thúc ở `blocked`, không phải `failed`: `failed` nghĩa là đã
       * thử và hỏng, còn đây là chưa thử. Người dùng nhìn nhật ký phải phân biệt
       * được "hệ thống làm sai" với "hệ thống đang chờ mình" — gộp hai thứ đó
       * vào một trạng thái là làm hỏng chính cái nhật ký sinh ra để tin.
       *
       * KHÔNG tiêu một token nhân viên nào. Câu hỏi đi thẳng lên ô chat với vai
       * `assistant`, y như một lượt `intent: 'ask'` của `route()` — với người
       * dùng thì đây LÀ cùng một chuyện, và họ không cần biết nó đến từ khâu nào.
       */
      if (planned.value.kind === 'ask') {
        this.planFriction++;
        this.emit({ type: 'master.message', role: 'assistant', say: planned.value.say });
        // `finish` tự trả văn phòng về `idle` — không gọi `setState` thêm ở đây.
        this.finish(record, 'blocked', '', usage, 0);
        return { plan_id: record.plan_id, report: '', usage };
      }

      const plan = planned.value.plan;
      // Chia được việc rồi thì CHỐT con số ma sát cho ca này, và trả biến đếm về
      // 0 ngay: một ca sau đó chạy trơn từ câu đầu tiên không được thừa hưởng
      // ma sát của ca này. Đọc lại ở khâu báo cáo bên dưới.
      const friction = this.planFriction;
      this.planFriction = 0;

      /**
       * 2. SỬA thứ sửa được, rồi mới CHẶN thứ không sửa được.
       *
       * Thứ tự có chủ ý, và nó là phương châm "ra bản nháp để sửa còn hơn viết
       * mới từ đầu" áp vào chính kế hoạch:
       *
       *  · `linkDeps` — task đọc kết quả của task khác mà quên khai `deps` thì
       *    NỐI THẲNG. Quan hệ đó suy ra được từ hai đường dẫn ta đang cầm; bắt
       *    model lập lại kế hoạch cho đúng là một lượt gọi nữa để đổi lấy một
       *    kết quả vẫn có thể sai.
       *  · `validate` — thứ còn lại thì không đoán được, phải dừng.
       *
       * Cả hai chạy SAU lập kế hoạch nhưng TRƯỚC khi phóng worker đầu tiên: tới
       * đây mới tốn đúng một lượt planner.
       *
       * Danh sách vai trò đối chiếu là vai trò ĐANG TRỰC, không phải mọi file
       * trong `roles/` — nếu không thì ngắt dây trên canvas chỉ là trang trí.
       */
      const linked = Scheduler.linkDeps(plan);
      if (linked.length) {
        // Nói ra, đừng sửa lén. Người dùng nhìn dải kế hoạch thấy hai việc chạy
        // nối tiếp thay vì song song thì phải có một dòng giải thích vì sao.
        this.emit({
          type: 'office.state',
          state: 'working',
          say: `Đã nối ${linked.length} việc phải chạy nối tiếp (${linked.join(', ')}) — chúng dùng chung file.`,
        });
      }

      const problems = Scheduler.validate(plan, onDuty, this.loaded.dir);
      if (problems.length) {
        // Kế hoạch có ra, nhưng không chạy được — với người dùng thì vẫn là một
        // lượt phải nói lại. Tính là ma sát. → `planFriction`
        this.planFriction++;
        /**
         * Câu này đi thẳng lên mặt người dùng, nên nó phải nói được VIỆC PHẢI
         * LÀM — tiêu chí "Xử lý lỗi tốt". Bản trước in nguyên văn danh sách kỹ
         * thuật ("Task T-02: phụ thuộc T-05 không tồn tại") cho một người mở
         * tiệm hoa đọc.
         */
        throw new RunError(
          `Mình chia việc bị lỗi nên chưa chạy được — chưa tốn tiền cho việc nào cả.\n` +
            problems.map((p) => `  · ${p}`).join('\n') +
            `\nBạn nhắn lại yêu cầu rõ hơn một chút, hoặc nói cụ thể tên tài liệu cần dùng nhé.`,
          'other',
        );
      }

      this.currentPlan = plan;
      record.steps = plan.steps;
      record.tasks_total = plan.tasks.length;
      record.status = 'running';
      this.plans.upsert(record);
      this.emitActivity();
      this.savePlan(plan);
      this.emit({ type: 'plan.created', plan_id: plan.plan_id, request, steps: plan.steps });

      // Kế hoạch phải LÊN LUỒNG HỘI THOẠI, không chỉ nằm trên sơ đồ. Qua
      // Telegram thì sơ đồ không tồn tại — mà bridge là mục tiêu tối thượng.
      // Dựng bằng code từ `steps` đã có: 0 token. Khi có cổng duyệt
      // (SPEC-tools-approval.md §8b) thì chính tin nhắn này mang nút duyệt.
      this.emit({
        type: 'master.message',
        role: 'assistant',
        say:
          `Mình chia thành ${plan.steps.length} việc:\n` +
          plan.steps.map((s, i) => `  ${i + 1}. ${s.title}`).join('\n') +
          `\nBắt đầu nhé.`,
      });

      // 3. Chạy
      const scheduler = new Scheduler({
        office: this.loaded,
        knowledge: this.knowledge,
        emit: (e) => this.onSchedulerEvent(e, plan, record),
        shouldStop: () => this.stopRequested,
      });
      this.activeScheduler = scheduler;

      const result = await scheduler.run(plan);
      const receipts = [...result.receipts.values()];

      /**
       * Bản văn tài liệu, đọc ĐÚNG MỘT LẦN cho cả ca — dùng để chặn bài học chỉ
       * là bản chép lại một tài liệu (`echoesLibrary`).
       *
       * Chỉ đọc khi thật sự có bài học để kiểm. Phần lớn ca không có: chốt
       * `worthLearning` đã cắt nhánh Trợ lý, còn nhân viên thì thường trả về
       * `lessons: []`.
       */
      const anyLesson = receipts.some((r) => r.lessons.length > 0);
      let docTexts: string[] | undefined = anyLesson ? this.library.texts() : undefined;

      for (const r of receipts) {
        this.saveReceipt(plan.plan_id, r);
        this.recordUsage(r);
        usage = addUsage(usage, r.usage);
        for (const lesson of r.lessons) {
          // `r.reads` = tài liệu tủ mà CHÍNH nhân viên này đã mở trong ca. Bài
          // học của nó sống chết theo đúng những file đó — thực thể yếu.
          this.knowledge.addLesson(r.role, lesson.text, r.task_id, docTexts ?? [], r.reads);
        }
      }

      // 4. Báo cáo
      let report: string;
      let status: PlanStatus;
      if (result.stoppedBy === 'usage_limit') {
        report =
          `Hết lượt dùng Claude. Văn phòng tạm nghỉ, còn ${result.pending.length} việc chưa làm. ` +
          `Gõ "tiếp tục" khi có lượt lại.`;
        status = 'paused';
      } else if (result.stoppedBy === 'auth') {
        report = 'Chưa đăng nhập Claude Code. Chạy `claude` một lần để đăng nhập rồi thử lại.';
        status = 'paused';
        // `stoppedBy` chỉ được đặt khi scheduler chưa kịp phóng task nào nữa.
        // Nhưng khi ta NGẮT task đang chạy, chúng trả receipt "blocked" một cách
        // bình thường và scheduler chạy hết vòng — nên phải tự nhận ra ở đây.
        // Không có dòng này thì nhật ký ghi "xong" cho một ca người dùng đã dừng.
      } else if (result.stoppedBy === 'user' || this.stopRequested) {
        // Bàn giao dựng bằng CODE, không phải một lượt gọi LLM. Trợ lý cần biết
        // đã làm tới đâu để lần nhắn sau nó làm tiếp phần CÒN LẠI thay vì làm
        // lại từ đầu. → docs/SPEC-tools-approval.md §3b
        //
        // Sạch ngữ cảnh là MIỄN PHÍ ở đây: Trợ lý vốn chỉ thấy receipt (≤800
        // token), không bao giờ thấy transcript worker. Nó thừa hưởng KẾT QUẢ,
        // không thừa hưởng QUÁ TRÌNH.
        const finished = receipts.filter((r) => r.status === 'done');
        const left = result.pending.length + receipts.filter((r) => r.status === 'blocked').length;
        report =
          `Đã dừng. Xong ${finished.length}/${plan.tasks.length} việc, còn ${left} việc chưa làm.` +
          (finished.length
            ? `\nĐã có: ${finished.flatMap((r) => r.artifacts).join(', ') || 'kết quả đã lưu'}.`
            : '') +
          `\nNhắn tiếp để mình làm phần còn lại — việc đã xong giữ nguyên, không làm lại.`;
        status = 'stopped';
      } else {
        /**
         * CÂU TRẢ LỜI ĐI THẲNG TỪ NHÂN VIÊN TỚI NGƯỜI DÙNG. → SPEC-offices.md §6
         *
         * Không qua Trợ lý, không nằm trong `report()`, không bao giờ vào session
         * Trợ lý. Đây là nửa "answer" của hai kênh — nửa "say" vẫn chạy đường cũ.
         *
         * Phát TRƯỚC báo cáo: người dùng hỏi một câu, thứ họ chờ là CÂU TRẢ LỜI,
         * không phải một dòng tổng kết về việc đã trả lời.
         */
        const answered = receipts.filter((r) => r.answer.trim() && r.status === 'done');
        for (const r of answered) {
          this.emit({ type: 'master.message', say: r.answer.trim(), role: r.role });
        }

        /**
         * MỘT task `reply` duy nhất thì BỎ LUÔN `report()` — câu trả lời của nhân
         * viên CHÍNH LÀ báo cáo.
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ Đây là chỗ hết "cấn", và nó tiết kiệm thật chứ không chỉ gọn mắt.  │
         * │                                                                    │
         * │ Chạy `report()` ở đây nghĩa là ô chat hiện HAI tin nói cùng một     │
         * │ chuyện: câu trả lời cho khách, rồi một dòng Trợ lý nói lại rằng đã  │
         * │ trả lời. Bỏ nó đi cắt luôn MỘT LƯỢT TRỢ LÝ cho mỗi câu hỏi — mà     │
         * │ văn phòng hỗ trợ là nơi hình dạng chi phí này lặp nhiều nhất.       │
         * │                                                                    │
         * │ Cái giá, nói thẳng: session Trợ lý KHÔNG chứa câu trả lời đó. Lần  │
         * │ sửa sau nó biết YÊU CẦU (chính nó định tuyến) nhưng không biết ĐÃ   │
         * │ TRẢ LỜI GÌ — nó phải giao lại cho nhân viên đọc file. Đúng một lượt │
         * │ nhân viên, đổi lấy việc ngữ cảnh Trợ lý KHÔNG phình theo số câu     │
         * │ khách hỏi. Với văn phòng hỗ trợ, đó là đánh đổi đúng chiều.         │
         * └────────────────────────────────────────────────────────────────────┘
         */
        const soloReply = plan.tasks.length === 1 && answered.length === 1;
        if (soloReply) {
          // `report` rỗng: `finish()` sẽ không phát thêm tin nào. Câu trả lời vừa
          // phát ở trên đã là thứ người dùng cần đọc.
          report = '';
          status = 'done';
        } else {
        const summary = await this.mailbox.lock(() =>
          this.assistant.report(plan.steps, receipts, friction),
        );
        usage = addUsage(usage, summary.usage);
        this.logAssistantUsage('report', summary.usage);
        report = summary.value.say;
        status = receipts.some((r) => r.status === 'failed') ? 'failed' : 'done';

        /**
         * File đã hứa mà không có trên đĩa → NÓI RA, và hạ trạng thái xuống
         * `failed`. Nhật ký ghi "xong" cho một ca không ra được kết quả là đúng
         * loại nói dối mà `stoppedReceipt` đã sửa cho nhánh bị ngắt; nhánh chạy
         * hết bình thường thì chưa ai kiểm.
         */
        const gone = this.missingOutputs(plan, receipts);
        if (gone.length) {
          status = 'failed';
          report +=
            `\n\n⚠ Có ${gone.length} file lẽ ra phải được ghi mà không thấy trên đĩa: ` +
            `${gone.slice(0, 3).join(', ')}${gone.length > 3 ? '…' : ''}. ` +
            `Nhân viên báo xong nhưng kết quả chưa có — nhắn mình làm lại việc này nhé.`;
        }
        // Trợ lý là bên DUY NHẤT được ghi vào kho chung (SPEC-offices.md §4.3):
        // kho chung nằm trong prefix của cả văn phòng, cho ai cũng ghi được thì
        // nó phình theo cấp số nhân và không ai chịu trách nhiệm.
        if (summary.value.lessons.length > 0) docTexts ??= this.library.texts();
        for (const lesson of summary.value.lessons) {
          // Bài học CHUNG phụ thuộc vào MỌI tài liệu ca này đã chạm: Trợ lý
          // không đọc file nào, nên thứ duy nhất nó có thể đang nói tới là tài
          // liệu nhân viên vừa đọc. Xoá bất kỳ file nào trong đó là bài học đi theo.
          this.knowledge.addSharedLesson(lesson.text, plan.plan_id, docTexts ?? [], readsOf(receipts));
        }
        }
      }

      if (receipts.some((r) => r.lessons.length > 0) || status === 'done') {
        this.knowledge.scan();
        this.emit({
          type: 'knowledge.changed',
          count: this.knowledge.size,
          version: this.loaded.knowledgeVersion,
        });
      }
      /**
       * Đồng bộ NGOÀI nhánh trên, và đó là chỗ bản nháp đầu suýt sai.
       *
       * Nhánh trên chỉ chạy khi có bài học hoặc ca `done`. Nhưng bảng kê kết quả
       * phải cập nhật kể cả khi ca `failed`/`stopped` — nhân viên có thể đã ghi
       * xong vài file trước lúc hỏng, và đó chính là những file người dùng sẽ
       * nhắc tới ở câu tiếp theo ("làm nốt phần còn lại"). Gắn nó vào cổng của
       * kho tri thức là để nó lỡ đúng cái ca cần nó nhất.
       */
      this.refreshAssistantContext();

      // Nhớ kết quả để bàn giao cho việc đang xếp hàng — xem inish().
      this.lastArtifacts = receipts.flatMap((r) => r.artifacts);
      this.savePending(result.pending);
      this.saveSessionId();
      /**
       * Khối "kết quả đã lưu tại" bị CHẶN ở hai nhánh, vì hai lý do khác nhau:
       *
       *  · `stopped` — câu của nó đã tự liệt kê artifact rồi (§11f).
       *  · task `reply` — người dùng vừa ĐỌC XONG câu trả lời. Dán thêm một
       *    đường dẫn xuống dưới là nói lại cùng một chuyện bằng ngôn ngữ của
       *    máy, và nó lôi cả `P-260819-1430-…` ra trước mặt một người mở tiệm
       *    hoa. File vẫn nằm nguyên trong ngăn Kết quả cho ai cần.
       */
      const shown = status === 'stopped' ? [] : receipts.filter((r) => !r.answer.trim());
      this.finish(record, status, report, usage, receipts.length, shown);
      return { plan_id: record.plan_id, report, usage };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Thông báo cho người dùng và thông báo cho log là HAI thứ khác nhau.
      // Người dùng cần biết LÀM GÌ TIẾP; log cần biết chuyện gì xảy ra.
      this.finish(record, 'failed', msg, usage, 0);
      return { plan_id: record.plan_id, report: msg, usage };
    }
  }

  /**
   * Khối "kết quả nằm ở đâu", DỰNG BẰNG CODE từ điểm đến QUAN SÁT ĐƯỢC. 0 token.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO KHÔNG DẶN MODEL, VÀ VÌ SAO KHÔNG DÙNG `artifacts`                │
   * │                                                                          │
   * │ Bản đầu: model NGẪU NHIÊN nhắc đường dẫn trong câu tổng kết. Không ai    │
   * │ bảo đảm → mất. Dặn prompt "hãy nêu đường dẫn" là mua lại đúng sự bất     │
   * │ định vừa bỏ đi, bằng token vĩnh viễn, và vẫn hỏng khi đổi model.         │
   * │                                                                          │
   * │ Bản hai dùng `receipt.artifacts` — khá hơn, nhưng vẫn là lời model KỂ,   │
   * │ và nó CHỈ MÔ TẢ ĐƯỢC FILE. Kết quả có thể nằm ở Notion, Google Sheets,   │
   * │ một database. Với những ca đó `artifacts` rỗng và khối này im lặng — tức │
   * │ là ta lại quay về phụ thuộc câu chữ của model.                           │
   * │                                                                          │
   * │ Bản này đọc `receipt.landed`: suy từ TOOL ĐÃ GỌI trong luồng, là sự việc │
   * │ quan sát được chứ không phải lời kể. → worker.ts `landingOf`             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Ba loại điểm đến, ba cách nói — và cách nói phản ánh ĐÚNG mức chắc chắn:
   *
   *  file     kiểm `existsSync` rồi mới liệt kê → nói chắc "đã lưu tại".
   *  external biết chắc đã gọi server nào, không kiểm được nó lưu ra sao →
   *           nói "đã ghi ra", nêu tên server.
   *  command  KHÔNG biết dữ liệu đi đâu → nói thẳng là không biết.
   *
   * Ca cuối là phần bất định còn lại, và nó được KHOANH VÙNG + DÁN NHÃN chứ
   * không bị giấu. Chi tiết còn lại nằm ở câu `say` của chính nhân viên — đó
   * đúng là việc của `say`, và ta không phải dặn thêm gì để có nó.
   */
  /**
   * KIỂM LẮP RÁP — bằng code, 0 token, 0 lượt gọi.
   *
   * Câu hỏi "kết quả có khớp với việc đã giao không" có hai nửa, và chỉ MỘT nửa
   * cần model:
   *
   *  · *"Câu trả lời cho khách có hay không"* → phải đọc nội dung. Việc đó thuộc
   *    về một nhân viên soát, quyết ở lúc lập kế hoạch. KHÔNG thuộc về Trợ lý:
   *    Trợ lý chạy trên session được persist, nên mọi thứ nó đọc sẽ nằm trong
   *    ngữ cảnh của MỌI lượt trò chuyện sau đó — đọc một lần, trả tiền mãi mãi.
   *  · *"Việc khai sẽ ghi ra file X mà file X có tồn tại không"* → đây là SỰ
   *    VIỆC. Hỏi model là trả tiền để đổi lấy bất định. Đó là nửa nằm ở đây.
   *
   * Nhân viên báo `done` mà file đã hứa không có trên đĩa là ca nói dối tệ nhất:
   * người dùng đọc "xong rồi", đi mở file, và không có gì. `whereBlock` liệt kê
   * thứ CÓ THẬT nên nó im lặng đúng lúc cần nói to nhất.
   */
  private missingOutputs(plan: Plan, receipts: readonly Receipt[]): string[] {
    const byTask = new Map(receipts.map((r) => [r.task_id, r]));
    const gone: string[] = [];
    for (const task of plan.tasks) {
      // Chỉ soi việc TỰ NHẬN là xong. Việc bị chặn hoặc bị dừng giữa chừng
      // không có file là chuyện bình thường, và nó đã tự nói ra rồi.
      if (byTask.get(task.task_id)?.status !== 'done') continue;
      for (const out of task.outputs) {
        try {
          if (!fs.existsSync(safeJoin(this.loaded.dir, out.path))) gone.push(out.path);
        } catch {
          gone.push(out.path);
        }
      }
    }
    return gone;
  }

  private whereBlock(receipts: readonly Receipt[]): { text: string; files: string[] } {
    const files = new Set<string>();
    const servers = new Set<string>();
    let ranCommand = false;

    for (const r of receipts) {
      for (const spot of r.landed ?? []) {
        if (spot.kind === 'external') servers.add(spot.ref);
        else if (spot.kind === 'command') ranCommand = true;
        else if (spot.kind === 'file') {
          try {
            if (fs.existsSync(safeJoin(this.loaded.dir, spot.ref))) files.add(spot.ref);
          } catch {
            /* ra ngoài thư mục văn phòng — không khai là kết quả của người dùng */
          }
        }
      }
    }

    const lines: string[] = [];
    let shown: string[] = [];
    if (files.size) {
      // Đường dẫn tính từ THƯ MỤC LÀM VIỆC, không từ thư mục văn phòng: người
      // dùng đang đứng ở đó khi mở file explorer. `artifacts/T-01/x.md` đứng một
      // mình thì đúng về kỹ thuật mà vô dụng với người lần đầu đi tìm.
      const base = `${path.basename(this.loaded.companyDir)}/offices/${this.id}`;
      shown = [...files].sort().slice(0, MAX_LISTED_FILES);
      lines.push('Kết quả đã lưu tại:');
      lines.push(...shown.map((p) => `  ${base}/${p}`));
      if (files.size > shown.length) lines.push(`  …và ${files.size - shown.length} file nữa`);
      /**
       * Một câu giải thích cái tiền tố `P-…/T-01/`, CHỈ khi người dùng đã tự đặt
       * thư mục.
       *
       * `artifacts/<plan>/<task>/` là bốn đoạn. Sâu hơn thế nghĩa là `outputScoper`
       * vừa giữ lại một phần đuôi mà người dùng viết ra — tức là họ CÓ ý về chỗ
       * để file, và giờ đang nhìn đường dẫn của mình bị bọc thêm hai lớp lạ. Đó
       * đúng là lúc phải nói vì sao, và cũng là lúc DUY NHẤT đáng nói: dán câu
       * này vào mọi ca là biến một lời giải thích thành tiếng ồn.
       *
       * 0 token — dựng bằng code từ chính đường dẫn đang cầm.
       */
      if (shown.some((p) => p.split('/').length > 4)) {
        lines.push('(mỗi ca có thư mục riêng để lần chạy sau không đè lên lần này)');
      }
    }
    if (servers.size) {
      lines.push(`Đã ghi ra ngoài qua: ${[...servers].sort().join(', ')}`);
    }
    if (ranCommand) {
      lines.push('Có chạy lệnh trên máy — kết quả có thể nằm ngoài thư mục văn phòng.');
    }

    return {
      text: lines.length ? `\n\n${lines.join('\n')}` : '',
      /**
       * Trả `shown` — ĐÚNG những đường dẫn đã in ra chữ, không phải cả `files`.
       *
       * Lệch một cái là giao diện có một mục bấm được không ứng với dòng nào,
       * hoặc một dòng chữ không bấm được trong khi hàng xóm của nó thì được.
       * Cả hai đều là giao diện tự mâu thuẫn với chính nó. Một nguồn, hai dạng.
       */
      files: shown,
    };
  }

  private finish(
    record: PlanRecord,
    status: PlanStatus,
    report: string,
    usage: Usage,
    tasks: number,
    receipts: readonly Receipt[] = [],
  ): void {
    const where = this.whereBlock(receipts);
    report += where.text;
    record.status = status;
    record.ended_at = new Date().toISOString();
    record.report = report;
    record.costUSD = usage.costUSD;
    record.turns = usage.turns;
    this.plans.upsert(record);

    this.emit({ type: 'cost.tick', totals: { ...usage, tasks } });
    // Câu báo cáo phát ĐÚNG MỘT LẦN, ở đây. `plan.finished` là sự kiện cấu trúc
    // (trạng thái + tiền) để UI đóng sổ, KHÔNG mang lại câu chữ — trước đây nó
    // mang, và nhật ký hiện hai dòng y hệt nhau ngay cạnh nhau.
    //
    // `report` RỖNG là hợp lệ và có chủ ý: ca một task `reply` đã phát câu trả
    // lời của nhân viên rồi, và đó CHÍNH LÀ báo cáo. Phát thêm một bong bóng
    // trống ở đây là tái tạo đúng cái "cấn" vừa bỏ đi.
    // `files` đi KÈM tin nhắn, không thay thế phần chữ trong nó: bên hiển thị
    // nào không đọc trường này (Telegram) vẫn thấy đủ đường dẫn trong `say`.
    if (report.trim()) {
      this.emit({
        type: 'master.message',
        say: report,
        role: 'assistant',
        ...(where.files.length ? { files: where.files } : {}),
      });
    }
    this.emit({ type: 'plan.finished', status, costUSD: usage.costUSD, turns: usage.turns });

    this.currentPlan = undefined;
    this.currentRecord = undefined;
    this.activeScheduler = undefined;
    this.settled.clear();
    this.emitActivity();

    // Việc người dùng giao trong lúc bận: giờ mới tới lượt. Chỉ chạy tiếp khi
    // ca này KHÔNG bị dừng — người dùng bấm Dừng là dừng tất, kể cả hàng đợi.
    const next = this.deferred.shift();
    if (next && !this.stopRequested) {
      this.emitActivity();
      // BÀN GIAO: việc xếp hàng thường là phần tiếp của việc vừa xong ("giọng
      // trẻ hơn nữa"). Không nói cho nó biết kết quả vừa rồi nằm ở đâu thì nó
      // VIẾT LẠI TỪ ĐẦU thay vì SỬA — đắt hơn nhiều và mất luôn bản đã trả tiền.
      //
      // Dựng bằng code từ receipt đã có: 0 token.
      const done = this.lastArtifacts;
      const request = done.length
        ? `${next.request}\n\n(Việc trước vừa xong, kết quả đã có sẵn ở: ${done.join(', ')}. ` +
          `Nếu yêu cầu này là chỉnh sửa cho việc đó thì SỬA file có sẵn, đừng làm lại từ đầu.)`
        : next.request;
      void this.run(request).catch(() => {
        /* run() đã emit lỗi rồi */
      });
    } else {
      this.emitActivity();
    }
    // Còn việc xếp hàng thì để nó chạy trước — nén giữa hai việc liên tiếp là
    // cắt đúng chỗ mạch chuyện đang liền.
    if (!next) this.maybeCompact();

    // `setState` cũng phát một `office.state` mang `say`. Đưa câu báo cáo vào
    // đó nữa là lặp lần thứ ba — trạng thái chỉ cần nói TRẠNG THÁI.
    // `blocked` về `idle` như mọi ca đã đóng, nhưng KHÔNG được nói "Xong việc."
    // — chưa có việc nào chạy cả, và câu hỏi của Trợ lý vừa hiện ngay phía trên.
    this.setState(
      status === 'paused' || status === 'stopped' ? 'paused' : 'idle',
      status === 'paused'
        ? 'Tạm nghỉ.'
        : status === 'stopped'
          ? 'Đã dừng.'
          : status === 'blocked'
            ? 'Đang chờ bạn trả lời.'
            : 'Xong việc.',
    );
  }

  // ── canvas

  canvas(): CanvasState {
    const { layout, missing } = this.layout.read();
    const notes = this.knowledge.notesByRole();
    const connected = new Set(layout.edges.filter((e) => e.from === ASSISTANT_NODE).map((e) => e.to));

    return {
      nodes: layout.nodes.map((n) => this.describeNode(n, missing.has(n.id), connected.has(n.id), notes)),
      edges: layout.edges,
      knowledge: { shared: this.knowledge.countShared(), total: this.knowledge.size },
    };
  }

  saveCanvas(input: { nodes?: unknown; edges?: unknown }): CanvasState {
    this.assertLive();
    const { touched } = this.layout.save(input);
    if (touched.length) this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: 'Sơ đồ văn phòng đã cập nhật.', plan_id: null });
    return this.canvas();
  }

  /**
   * Thêm nhân viên: ghi roles/<id>.yaml rồi nối dây từ Trợ lý.
   *
   * Canvas KHÔNG tự sinh gì ngoài layout.json — trừ đúng chỗ này, và nó ghi ra
   * yaml người đọc được chứ không phải một cục JSON riêng.
   */
  addAgent(input: { id?: string; display_name?: string; pitch?: string; tier?: string }): string {
    this.assertLive();
    const name = (input.display_name ?? '').trim();
    const id = slugId(input.id?.trim() || name || 'nhan-vien');
    if (!isSafeId(id)) {
      throw new RunError('Mã nhân viên chỉ dùng chữ thường, số, gạch ngang.', 'other');
    }
    if (id === 'assistant') {
      throw new RunError('"assistant" là tên dành riêng cho Trợ lý.', 'other');
    }
    if (this.loaded.roles.has(id)) {
      throw new RunError(`Văn phòng này đã có nhân viên "${id}".`, 'other');
    }

    const tier = input.tier === 'eco' || input.tier === 'deep' ? input.tier : 'standard';
    fs.mkdirSync(this.loaded.paths.roles, { recursive: true });
    fs.writeFileSync(
      path.join(this.loaded.paths.roles, `${id}.yaml`),
      roleTemplate(id, name || id, (input.pitch ?? '').trim(), tier),
      'utf8',
    );

    this.reload();
    // `placeAgent` chứ không phải `connectAssistant`: nó GHI vị trí xuống đĩa kể
    // cả khi cạnh đã có sẵn. Bản cũ return sớm ở đó, nên toạ độ vừa tính không
    // bao giờ được lưu. → layout.ts
    // Nhân viên MỚI thì nối dây luôn: thêm một người rồi không giao được việc
    // cho họ là một thao tác không có kết quả nhìn thấy được.
    this.layout.placeAgent(id, true);
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã thêm "${name || id}".`, plan_id: null });
    return id;
  }

  /**
   * LƯU TRỮ một nhân viên (soft delete). → docs/SPEC-offices.md §5.1
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO PHẢI CÓ CỜ, KHÔNG THỂ CHỈ "BỎ KHỎI SƠ ĐỒ"                        │
   * │                                                                          │
   * │ Bản trước xoá node khỏi layout.json rồi giữ file yaml — nghe thì đúng,   │
   * │ nhưng `layout.read()` TÁI TẠO node từ `office.roles` ở lần đọc kế tiếp.  │
   * │ Nhân viên "đã bỏ" quay lại canvas ở một ô lưới khác, chỉ mất sợi dây.    │
   * │ Tức là "bỏ khỏi sơ đồ" chưa bao giờ thật sự bỏ được cái gì.              │
   * │                                                                          │
   * │ Cờ trong yaml là nguồn sự thật DUY NHẤT: canvas, roster và scheduler đều │
   * │ đọc nó. Không có đường nào để một nhân viên đã cất nhận được việc.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * File không đi đâu cả. Kinh nghiệm trong `knowledge/agents/<id>/` còn nguyên,
   * skills còn nguyên — khôi phục là trở lại đúng chỗ cũ, vì nó chưa từng rời đi.
   * (Lời hứa đó chỉ THẬT nhờ `pruneStale` miễn trừ sổ tay của người đã cất —
   * xem `KnowledgeStore.pruneStale`.)
   *
   * ⚠ KHÔI PHỤC KHÔNG NỐI DÂY. Node trở lại sơ đồ, nhưng muốn nó nhận việc thì
   * người dùng phải tự kéo một sợi dây. Xem `LayoutStore.placeAgent`.
   */
  archiveAgent(roleId: string, archived: boolean): CanvasState {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError('Mã nhân viên không hợp lệ.', 'other');
    const role = this.loaded.roles.get(roleId);
    if (!role) throw new RunError(`Không có nhân viên "${roleId}".`, 'other');

    const file = this.roleFile(roleId);
    if (!file) throw new RunError(`Không tìm thấy file roles/${roleId}.yaml.`, 'other');

    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (archived) doc.set('archived', true);
    else doc.delete('archived');
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    if (archived) this.layout.dropAgent(roleId);
    this.reload();
    // `connect: false` — đưa trở lại KHÔNG phải là cho nhận việc lại.
    if (!archived) this.layout.placeAgent(roleId, false);
    this.refreshAssistantContext();

    const name = role.display_name || roleId;
    this.emit({
      type: 'layout.changed',
      // Câu này phải nói ra việc CÒN LẠI phải làm. Không nói thì người dùng thấy
      // node hiện lên, tưởng xong, rồi giao việc và Trợ lý bảo không có ai làm.
      say: archived
        ? `Đã cất "${name}" vào lưu trữ.`
        : `Đã đưa "${name}" trở lại sơ đồ. Kéo một sợi dây từ Trợ lý xuống nếu muốn giao việc cho họ.`,
      plan_id: null,
    });
    return this.canvas();
  }

  /**
   * XOÁ HẲN một nhân viên: mất file yaml, mất skills. Không lấy lại được.
   *
   * Sổ tay kinh nghiệm ở `knowledge/agents/<id>/` CỐ Ý được giữ: nó là thứ văn
   * phòng đã học được, không phải tài sản riêng của một cái tên. Xoá người mà
   * xoá luôn bài học là mất thứ đắt nhất trong cả thư mục.
   */
  removeAgent(roleId: string): void {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError('Mã nhân viên không hợp lệ.', 'other');
    if (!this.loaded.roles.has(roleId)) throw new RunError(`Không có nhân viên "${roleId}".`, 'other');

    this.layout.dropAgent(roleId);
    for (const ext of ['.yaml', '.yml']) {
      fs.rmSync(path.join(this.loaded.paths.roles, `${roleId}${ext}`), { force: true });
    }
    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã xoá hẳn "${roleId}".`, plan_id: null });
  }

  /** Nhân viên đang nằm trong lưu trữ — để giao diện cho khôi phục. */
  archivedAgents(): Array<{ role: string; label: string; avatar: string; pitch: string; notes: number }> {
    const notes = this.knowledge.notesByRole();
    return [...this.loaded.archivedRoles]
      .map((id) => this.loaded.roles.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        role: r.id,
        label: r.display_name || r.id,
        avatar: r.avatar,
        pitch: r.pitch,
        notes: notes[r.id] ?? 0,
      }));
  }

  /**
   * Sửa hồ sơ một nhân viên. → docs/SPEC-tools-approval.md §1
   *
   * Ghi bằng `parseDocument` để GIỮ chú thích người dùng viết trong file yaml.
   *
   * ⚠ Sửa `pitch` là bump cacheKey của TRỢ LÝ (pitch nằm trong roster);
   * sửa `model_tier` là bump cacheKey của chính agent đó. Vì thế giao diện phải
   * có nút Lưu tường minh, không autosave — cùng luật với skills.
   */
  editAgent(
    roleId: string,
    patch: { display_name?: string; avatar?: string; pitch?: string; not_for?: string[]; model_tier?: string },
  ): CanvasState {
    this.assertLive();
    if (!isSafeId(roleId)) throw new RunError('Mã nhân viên không hợp lệ.', 'other');
    const role = this.loaded.roles.get(roleId);
    if (!role) throw new RunError(`Không có nhân viên "${roleId}".`, 'other');

    const pitch = patch.pitch?.trim();
    if (patch.pitch !== undefined && !pitch) {
      throw new RunError('Giới thiệu không được để trống — đây là thứ duy nhất Trợ lý thấy.', 'other');
    }
    if (patch.model_tier !== undefined && !TIERS.includes(patch.model_tier as never)) {
      throw new RunError(`Mức model phải là một trong: ${TIERS.join(', ')}.`, 'other');
    }

    const file = this.roleFile(roleId);
    if (!file) throw new RunError(`Không tìm thấy file roles/${roleId}.yaml.`, 'other');

    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (patch.display_name !== undefined) doc.set('display_name', patch.display_name.trim());
    if (patch.avatar !== undefined) doc.set('avatar', patch.avatar.trim() || '•');
    if (pitch) doc.set('pitch', pitch);
    if (patch.not_for !== undefined) {
      const list = patch.not_for.map((s) => s.trim()).filter(Boolean);
      if (list.length) doc.set('not_for', list);
      else doc.delete('not_for');
    }
    if (patch.model_tier !== undefined) doc.set('model_tier', patch.model_tier);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã cập nhật hồ sơ "${roleId}".`, plan_id: null });
    return this.canvas();
  }

  /**
   * Đổi tên hiển thị của văn phòng. → docs/SPEC-offices.md §3
   *
   * MÃ văn phòng (`id`) giữ nguyên, và đó là quyết định chứ không phải lười:
   * `id` là TÊN THƯ MỤC. Đổi nó là dời `artifacts/`, `tasks/`, `.state/`, mọi
   * đường dẫn đã ghi trong receipt cũ, và session của Trợ lý — để đổi một cái
   * nhãn. Người dùng đổi tên vì cái nhãn đọc sai, không phải vì họ muốn dời nhà.
   *
   * Ghi bằng `parseDocument` để giữ nguyên chú thích trong office.yaml.
   */
  rename(name: string): string {
    this.assertLive();
    const next = normalizeName(name);
    if (!next) throw new RunError('Tên văn phòng không được để trống.', 'other');
    if (next.length > 60) throw new RunError('Tên văn phòng dài quá 60 ký tự.', 'other');
    if (next === this.loaded.config.name) return next;

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    doc.set('name', next);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    // Tên văn phòng KHÔNG nằm trong prompt của ai — không có gì phải ghi lại cache.
    this.emit({ type: 'layout.changed', say: `Văn phòng đã đổi tên thành "${next}".`, plan_id: null });
    return next;
  }

  /**
   * Đổi mức model của Trợ lý văn phòng này. → docs/SPEC-offices.md §4.5
   *
   * `undefined` = bỏ ghi đè, quay về `models.master` của công ty.
   *
   * KHÔNG chạm vào session: `resume` nạp bản ghi hội thoại từ đĩa, và bản ghi đó
   * độc lập với model. Trợ lý vẫn nhớ nguyên mọi thứ đã nói. Thứ mất là PROMPT
   * CACHE — cặp (model, prefix) đổi nên lượt kế tiếp ghi lại cache một lần, và
   * vì `resume` gửi lại cả bản ghi hội thoại nên lần đó trả giá đầy đủ cho phần
   * đó. Đắt nhất khi hội thoại đã dài; vẫn là MỘT LẦN, không phải mỗi lượt.
   */
  setAssistantTier(tier: string | undefined): { tier: string; model: string } {
    this.assertLive();
    if (tier !== undefined && !TIERS.includes(tier as never)) {
      throw new RunError(`Mức model phải là một trong: ${TIERS.join(', ')}.`, 'other');
    }

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (!doc.has('assistant')) doc.set('assistant', {});
    if (tier === undefined) doc.deleteIn(['assistant', 'model_tier']);
    else doc.setIn(['assistant', 'model_tier'], tier);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    this.refreshAssistantContext();
    this.emit({
      type: 'layout.changed',
      say: `Trợ lý chuyển sang mức "${this.assistant.modelTier}". Áp dụng từ lượt trò chuyện tiếp theo.`,
      plan_id: null,
    });
    return { tier: this.assistant.modelTier, model: this.assistant.model };
  }

  /**
   * Nhận cấu hình công ty mới (đổi model, đổi ngân sách…).
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BẤT BIẾN: KHÔNG BAO GIỜ SỬA `this.loaded` TẠI CHỖ.                       │
   * │                                                                          │
   * │ Scheduler của ca đang chạy giữ THAM CHIẾU tới đúng object `LoadedOffice` │
   * │ mà nó nhận lúc `run()`. Dựng object MỚI ở đây nghĩa là ca đang chạy tiếp │
   * │ tục với model và cấu hình cũ cho tới khi xong — đúng thứ người dùng muốn:│
   * │ đổi model không được đổi luật giữa ván. Còn nếu sửa tại chỗ              │
   * │ (`this.loaded.company = next`), những task CHƯA phóng của cùng một kế    │
   * │ hoạch sẽ chạy model khác các task đã phóng, và hoá đơn không giải thích  │
   * │ được nữa.                                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  applyCompanyConfig(next: CompanyConfig): void {
    this.loaded = loadOffice(this.loaded.companyDir, next, this.loaded.id);
    this.assistant.rebind(this.loaded);
    this.layout.rebind(this.loaded);
    this.plans.rebind(this.loaded.paths);
    this.knowledge.rebind(this.loaded.dir, this.loaded.paths);
    this.knowledge.scan();
    this.library.rebind(this.loaded.paths);
    this.artifacts.rebind(this.loaded.paths);
    this.refreshAssistantContext();
  }

  private roleFile(roleId: string): string | undefined {
    for (const ext of ['.yaml', '.yml']) {
      const f = path.join(this.loaded.paths.roles, `${roleId}${ext}`);
      if (fs.existsSync(f)) return f;
    }
    return undefined;
  }

  /**
   * Ghi một lớp prompt sửa được. → docs/SPEC-tools-approval.md §4
   *
   * Ba chốt an toàn, và cái thứ ba là cái dễ quên nhất:
   *  1. Chỉ lớp `editable` mới ghi được — lớp lõi từ chối thẳng.
   *  2. Đường dẫn phải nằm trong thư mục văn phòng (`safeJoin`).
   *  3. File charter là NODE TRI THỨC nên có YAML frontmatter. Ta chỉ hiện
   *     phần thân cho người dùng sửa, nên khi ghi phải GIỮ NGUYÊN frontmatter
   *     cũ — ghi đè cả file là xoá mất id/scope/pinned và node biến khỏi kho.
   */
  savePromptLayer(who: string, layerId: string, text: string): PromptLayer[] {
    this.assertLive();
    const layer = this.describePrompt(who).find((l) => l.id === layerId);
    if (!layer) throw new RunError(`Không có lớp "${layerId}".`, 'other');
    if (!layer.editable || !layer.file) {
      throw new RunError(
        'Lớp này chỉ đọc. Lớp lõi thuộc về mã nguồn — mở khoá bằng ' +
          '`allow_core_prompt_edit: true` trong company.yaml nếu bạn thật sự cần.',
        'other',
      );
    }

    const limit = layer.limit;
    if (limit && estimateTokens(text) > limit) {
      throw new RunError(
        `Dài quá: ${estimateTokens(text)} token, trần là ${limit}. ` +
          `Khối này nằm trong prefix cache nên mỗi dòng thừa là chi phí thu suốt ca làm việc.`,
        'other',
      );
    }

    const abs = safeJoin(this.loaded.dir, layer.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    if (layer.frontmatter) {
      const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      const head = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(old)?.[0] ?? '';
      fs.writeFileSync(abs, `${head}\n${text.trim()}\n`, 'utf8');
    } else {
      fs.writeFileSync(abs, `${text.trim()}\n`, 'utf8');
    }

    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: 'Đã lưu. Bộ nhớ đệm sẽ ghi lại một lần.', plan_id: null });
    return this.describePrompt(who);
  }

  /**
   * Sửa / xoá một node tri thức. → docs/SPEC-2026-08-14-agentco.md §5
   *
   * Tác động 1-1 và NGAY LẬP TỨC: quét lại kho, dựng lại ngữ cảnh Trợ lý, và
   * mọi worker phóng SAU thời điểm này dùng bản mới (chúng đọc `hot()` lúc
   * dựng prompt). Worker đang chạy giữ nguyên bản cũ — cùng luật với đổi model:
   * đổi luật giữa ván thì không ván nào đọc được.
   *
   * Cái giá phải nói ra: node tri thức nằm trong prefix được cache, nên mỗi lần
   * sửa là một lần ghi lại cache cho những vai trò có node đó trong phần HOT.
   */
  editKnowledge(id: string, patch: { body?: string; remove?: boolean }): void {
    this.assertLive();
    const ok = patch.remove
      ? this.knowledge.removeNode(id)
      : this.knowledge.editNode(id, patch.body ?? '');
    if (!ok) throw new RunError(`Không có ghi chú "${id}".`, 'other');

    this.knowledge.scan();
    this.refreshAssistantContext();
    this.emit({
      type: 'knowledge.changed',
      count: this.knowledge.size,
      version: this.loaded.knowledgeVersion,
      plan_id: null,
    });
  }

  /** Prompt phân lớp để NGƯỜI XEM ĐƯỢC. → SPEC-offices.md §4.1 */
  describePrompt(who: string): PromptLayer[] {
    const hot =
      who === 'assistant'
        ? this.assistantHot()
        : this.knowledge.hot(
            who,
            this.loaded.roles.get(who)?.hot_knowledge_size ?? 8,
            this.loaded.company.budgets.hot_knowledge_tokens,
          ).text;
    // Ghi nhớ hội thoại chỉ có với Trợ lý — nhân viên không có, và không được có.
    const memory = who === 'assistant' ? this.knowledge.assistantMemoryText() : '';
    // Hai bảng kê chỉ có với Trợ lý. Tủ tài liệu: nhân viên tìm bằng `Grep`.
    // Kết quả: nhân viên nhận đường dẫn qua `inputs`, không cần danh sách —
    // và đó là chốt giữ cho prefix của họ không phình theo số ca đã chạy.
    const library = who === 'assistant' ? this.library.manifest() : '';
    const artifacts = who === 'assistant' ? this.artifactManifest() : '';
    return describePrompt(this.loaded, who, hot, memory, library, artifacts);
  }

  /** cacheKey hiện tại của từng vai trò — để chẩn đoán prefix bị phá. */
  cacheKeys(): Array<{ role: string; key: string; staticTokens: number; model: string }> {
    return [...this.loaded.roles.values()].map((r) => {
      const model = this.loaded.company.models[r.model_tier];
      const built = buildWorkerPrompt(this.loaded, r, {
        hotKnowledge: this.knowledge.hot(
          r.id,
          r.hot_knowledge_size,
          this.loaded.company.budgets.hot_knowledge_tokens,
        ).text,
        model,
      });
      return { role: r.id, key: built.cacheKey, staticTokens: built.staticTokens, model };
    });
  }

  /**
   * NÉN TRÍ NHỚ TRỢ LÝ vào kho riêng của nó, rồi bắt đầu hội thoại mới.
   * → docs/SPEC-offices.md §4.6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO CHỦ ĐỘNG NÉN, THAY VÌ ĐỂ CLI TỰ NÉN                              │
   * │                                                                          │
   * │ CLI Claude Code CÓ auto-compact (SDK phơi ra hook `PreCompact`/          │
   * │ `PostCompact` với `trigger: 'manual' | 'auto'`). Nghĩa là nén SẼ xảy ra  │
   * │ dù ta muốn hay không.                                                    │
   * │                                                                          │
   * │ Rủi ro không phải tràn bộ nhớ — mà là nén tự động LÀ MẤT MÁT, xảy ra ở  │
   * │ ngưỡng ta không thấy, giữ lại thứ ta không chọn, vào một cái kho ta      │
   * │ không đọc được. Trợ lý sẽ quên một quyết định nào đó, lúc nào đó, và     │
   * │ không ai biết.                                                           │
   * │                                                                          │
   * │ Nén chủ động: đúng thời điểm ta chọn (ranh giới một công việc vừa xong), │
   * │ vào một file người dùng mở ra đọc được, và có `supersedes` để bản cũ     │
   * │ rời khỏi prompt mà không mất dấu vết.                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Vào `knowledge/agents/assistant/`, KHÔNG vào kho chung: ký ức hội thoại của
   * Trợ lý là thứ nhân viên viết bài không cần biết và không dùng được.
   */
  async compactMemory(): Promise<{ saved: boolean; note: string }> {
    this.assertLive();
    // Chưa có hội thoại nào để nén — nhưng VẪN PHẢI DỌN RÁC.
    //
    // Bản trước return thẳng ở đây, nên người dùng gõ `/clear` lần thứ hai (lúc
    // session đã sạch) thì không có gì xảy ra cả: node bị đè vẫn nằm nguyên,
    // ghi chú cũ vẫn nằm nguyên. Đúng lúc họ đang cố dọn thì lệnh dọn im lặng.
    if (!this.assistant.session) {
      const swept = this.finishClear();
      return {
        saved: false,
        note: swept ? `Chưa có gì mới để nhớ.${swept}` : 'Chưa có gì để nhớ — bắt đầu mới luôn.',
      };
    }

    let saved = false;
    try {
      const result = await this.mailbox.lock(() => this.assistant.compact(this.factSkeleton()));
      this.logAssistantUsage('report', result.usage);
      const body = result.value;
      // "KHÔNG" là câu trả lời hợp lệ và đáng tôn trọng: ép ghi một node rỗng
      // vào kho là tự đầu độc phần HOT của chính mình ở mọi lượt sau.
      if (body && !/^KHÔNG\.?$/i.test(body)) {
        this.knowledge.addAssistantMemory(
          `Ghi nhớ tới ${new Date().toISOString().slice(0, 10)}`,
          body,
          this.knowledge.assistantMemoryIds(),
        );
        saved = true;
      }
    } catch (err) {
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ BUG ĐÃ SỬA (20/08): `/clear` KẸT VĨNH VIỄN, không có đường thoát.    │
       * │                                                                      │
       * │ Bản trước gộp MỌI lỗi nén vào một nhánh "giữ nguyên cuộc trò chuyện".│
       * │ Ý định đúng cho lỗi TẠM (mạng, hết hạn mức) — nhưng sai hoàn toàn    │
       * │ cho lỗi VĨNH VIỄN.                                                    │
       * │                                                                      │
       * │ Nén chạy `resume: <session_id>`, và bản ghi hội thoại đó nằm trong   │
       * │ `~/.claude/projects/` — MỘT THƯ MỤC AGENTCO KHÔNG SỞ HỮU. Người dùng │
       * │ dọn nó, đổi tên thư mục công ty, hay bê máy khác là bản ghi biến     │
       * │ mất. Từ giây phút đó, mọi lần gõ `/clear` đều ném cùng một lỗi, và ô │
       * │ chat KHÔNG BAO GIỜ dọn được nữa. Lệnh dọn duy nhất của sản phẩm chết │
       * │ cứng, còn câu lỗi thì nói "mình giữ nguyên cuộc trò chuyện" như thể  │
       * │ đó là một lựa chọn.                                                   │
       * │                                                                      │
       * │ Mất trí nhớ là chuyện ĐÃ RỒI ở thời điểm này — bản ghi không còn thì │
       * │ không ai nén được nó nữa. Giữ thêm một ô chat không xoá được chỉ là   │
       * │ mất thêm lần thứ hai. Nên: dọn, và NÓI THẬT đã mất gì.                │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      if (!sessionGone(err)) {
        // Lỗi TẠM — thà giữ một bản ghi dài còn hơn mất trắng. Gõ lại sau là được.
        return {
          saved: false,
          note:
            `Chưa nén được trí nhớ (${err instanceof Error ? err.message : 'lỗi'}), ` +
            'nên mình giữ nguyên cuộc trò chuyện. Bạn thử lại /clear sau nhé.',
        };
      }
      const swept = this.finishClear();
      return {
        saved: false,
        note:
          'Mình không đọc lại được cuộc trò chuyện cũ (bản ghi của Claude Code đã bị dọn), ' +
          `nên không cất lại được gì. Đã dọn ô chat, bắt đầu mới.${swept}`,
      };
    }

    const tail = this.finishClear();
    return {
      saved,
      note:
        (saved
          ? 'Đã dọn cuộc trò chuyện. Những gì bạn đã chốt mình cất vào sổ tay riêng, mở ở ngăn Tri thức xem được.'
          : 'Đã dọn cuộc trò chuyện.') + tail,
    };
  }

  /**
   * Dọn THẬT: quên session, xoá con trỏ, xoá nhật ký hội thoại, dọn kho, báo UI.
   *
   * Gộp một chỗ vì `compactMemory` có BA đường tới đây — chưa có gì để nén, nén
   * xong, và bản ghi hội thoại đã biến mất. Bản trước viết tay từng đường, nên
   * đường "chưa có gì để nén" thiếu mất `knowledge.changed`: `pruneNow()` có thể
   * vừa xoá vài node xong mà ngăn Tri thức vẫn hiện số cũ cho tới lần mở lại.
   *
   * Trả về câu đuôi của `pruneNow()` để người gọi ghép vào báo cáo.
   */
  private finishClear(): string {
    const tail = this.pruneNow();
    this.assistant.forget();
    fs.rmSync(this.sessionFile(), { force: true });
    this.clearChatLog();
    // Phát TRƯỚC câu báo kết quả: đây là lệnh "xoá những gì đang hiện", nên câu
    // đi sau nó mới là câu đầu tiên của cuộc trò chuyện mới.
    this.emit({ type: 'office.cleared', say: 'Đã dọn cuộc trò chuyện.', plan_id: null });
    this.knowledge.scan();
    this.refreshAssistantContext();
    this.emit({
      type: 'knowledge.changed',
      count: this.knowledge.size,
      version: this.loaded.knowledgeVersion,
      plan_id: null,
    });
    return tail;
  }

  /**
   * Tự nén khi ngữ cảnh vượt trần. → docs/SPEC-token-economy.md §4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ KIỂM Ở ĐÂU VÀ VÌ SAO — hai quyết định tách biệt:                        │
   * │                                                                          │
   * │ NGƯỠNG là `budgets.master_compact_at` (mặc định 60 000), đo bằng         │
   * │ `assistant.contextTokens` — tức `cache_read` thật của lượt gần nhất, chứ │
   * │ không phải một phép đếm tay. Cửa sổ là 200K nên 60K còn rất nhiều dư     │
   * │ địa: ta muốn chặn TRƯỚC auto-compact của CLI, không phải chạy đua với    │
   * │ nó. Và vì `chi phí ≈ lượt × prefix × 0.1`, ngữ cảnh nhỏ là rẻ ở MỌI      │
   * │ lượt, không chỉ ở lượt nén.                                              │
   * │                                                                          │
   * │ THỜI ĐIỂM là ranh giới một công việc vừa xong — chứ không phải "hễ vượt  │
   * │ ngưỡng là nén ngay". Nén giữa lúc người dùng đang hỏi dở là cắt đúng     │
   * │ chỗ mạch chuyện đang liền, và bản tóm tắt sẽ tệ hơn hẳn. Một việc xong   │
   * │ là một đường may tự nhiên.                                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Token của NHÂN VIÊN không tính vào đây. Worker chạy `persistSession:
   * false` ở query riêng, khâu lập kế hoạch cũng vậy — chỉ `route()` (mỗi tin
   * nhắn) và `report()` (mỗi ca) làm bản ghi này phình.
   */
  private maybeCompact(): void {
    const limit = this.loaded.company.budgets.master_compact_at;
    if (this.assistant.contextTokens < limit) return;
    // Cùng đường với `/clear`: một câu trạng thái tạm, KHÔNG một tin nhắn nào.
    // Tự nén còn cần điều đó hơn cả `/clear` — người dùng không hề gõ lệnh gì,
    // nên một bong bóng chat tự mọc ra là thứ họ không giải thích được.
    void this.compactMemory()
      .then((r) => this.emitNote(`Cuộc trò chuyện đã dài, mình dọn bớt cho nhẹ. ${r.note}`, 6_000))
      .catch(() => {
        /* Nén hỏng thì giữ nguyên — `compactMemory` không quên khi lỗi. */
      });
  }

  /**
   * Bộ khung SỰ THẬT, dựng bằng code từ `tasks/index.json`. 0 token.
   *
   * Đưa vào để model KHÔNG phải kể lại — và để nó không kể sai. Việc đã chạy,
   * kết quả ở đâu, tốn bao nhiêu đều là dữ liệu ta đang cầm; thứ duy nhất chỉ
   * model biết là những gì người dùng đã nói mà không nằm trong bản ghi nào.
   */
  private factSkeleton(): string {
    const plans = this.plans.list().slice(0, 12);
    if (plans.length === 0) return '(chưa có việc nào chạy)';
    return plans
      .map((p) => `- [${p.status}] ${p.request}${p.report ? `\n  → ${p.report.split('\n')[0]}` : ''}`)
      .join('\n');
  }

  /**
   * Dọn kho ngay, trả về câu đuôi để ghép vào báo cáo (rỗng nếu không bỏ gì).
   *
   * `/clear` là lúc DUY NHẤT người dùng chủ động nói "dọn đi", nên gộp mọi việc
   * dọn vào đúng nhịp đó — thay vì rải một bộ hẹn giờ chạy ngầm mà không ai thấy
   * và không ai kiểm được.
   */
  private pruneNow(): string {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ BUG ĐÃ SỬA: node bị đè vẫn nằm lại, dù lần trước đã "sửa rồi".        │
     * │                                                                      │
     * │ HAI nguyên nhân ĐỘC LẬP — và đó chính là lý do bản vá trước chỉ giết  │
     * │ được một nửa, rồi ai cũng tưởng xong:                                 │
     * │                                                                      │
     * │  1. QUÉT MUỘN. `addAssistantMemory` GHI file mới (mang `supersedes`)  │
     * │     nhưng KHÔNG `scan()`. Tập `superseded` chỉ được dựng lại lúc quét,│
     * │     nên ngay sau đó `pruneStale` vẫn đang cầm tập CŨ — bản vừa bị đè  │
     * │     không có trong đó. Nó chỉ chết ở lần `/clear` KẾ TIẾP, tức là     │
     * │     người dùng luôn nhìn thấy đúng một node thừa, mãi mãi.            │
     * │                                                                      │
     * │  2. CHẶN NHẦM CỬA. `prune_after_days <= 0` là lựa chọn hợp lệ ("đừng  │
     * │     tự xoá ghi chú của tôi theo tuổi"), nhưng nó `return` sớm và cuốn │
     * │     theo cả việc dọn node bị đè. Mà xoá node bị đè KHÔNG PHẢI lão hoá │
     * │     — nó là "bản này đã được thay thế", đúng hay sai không liên quan  │
     * │     gì tới ngày tháng. Hai việc khác nhau thì không dùng chung cổng.  │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * Quét TRƯỚC: mọi thứ dưới đây đọc `superseded`, mà tập đó chỉ đúng sau khi
     * đã đọc lại đĩa. Đây là bước bản trước thiếu.
     */
    this.knowledge.scan();

    // Node bị đè: xoá LUÔN, không qua cổng `prune_after_days`.
    const replaced = this.knowledge.dropSuperseded();

    const days = this.loaded.company.librarian.prune_after_days;
    // Sổ tay của người đã cất được miễn trừ — xem `pruneStale`.
    const aged = days > 0 ? this.knowledge.pruneStale(days, this.loaded.archivedRoles) : [];

    if (replaced.length === 0 && aged.length === 0) return '';
    this.knowledge.scan();

    // Nói RIÊNG hai loại: "bản cũ bị thay" là chuyện bình thường và đáng yên
    // tâm; "ghi chú cũ bị dọn" là mất mát thật. Gộp một câu thì người dùng
    // không biết mình vừa mất gì.
    const parts: string[] = [];
    if (replaced.length) parts.push(`${replaced.length} bản ghi nhớ cũ đã được thay`);
    if (aged.length) parts.push(`${aged.length} ghi chú lâu không dùng`);
    return ` Dọn luôn ${parts.join(' và ')}.`;
  }

  private clearChatLog(): void {
    fs.rmSync(path.join(this.loaded.paths.state, 'chat.jsonl'), { force: true });
  }

  /** Nạp lại từ đĩa. Giữ nguyên session Trợ lý — nạp lại config không phải quên hội thoại. */
  reload(): void {
    this.applyCompanyConfig(this.loaded.company);
  }

  // `readArtifact` ĐÃ BỎ (19/08). Nó đọc bất kỳ file nào trong văn phòng —
  // `roles/*.yaml`, `charter.md`, `office.yaml` — chỉ vì tên nó nghe như chỉ
  // đọc artifact; và nó luôn `readFileSync(…, 'utf8')` nên làm hỏng mọi file
  // nhị phân. Thay bằng `ArtifactStore`, nhốt trong `artifacts/` và stream.
  // → src/core/artifacts.ts

  readPending(): TaskBrief[] {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskBrief[];
    } catch {
      return [];
    }
  }

  // ── nội bộ

  /**
   * Đồng bộ hai thứ Trợ lý cần biết: ai đang trực, và kho tri thức có gì.
   *
   * Cả hai nằm trong prefix được cache nên hàm này ĐẮT — gọi khi hình dạng hoặc
   * tri thức đổi, không gọi mỗi lượt trò chuyện.
   */
  private refreshAssistantContext(): void {
    this.assistant.setAssignable(this.layout.assignable());
    this.assistant.setHotKnowledge(this.assistantHot());
    this.assistant.setMemory(this.knowledge.assistantMemoryText());
    this.assistant.setLibrary(this.library.manifest());
    this.assistant.setArtifacts(this.artifactManifest());
  }

  /**
   * BẢNG KÊ KẾT QUẢ cho Trợ lý — tên file, KHÔNG nội dung. → docs/SPEC-artifacts.md §2.4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO BẺ LUẬT "ARTIFACT VÔ HÌNH" (20/08) — và bẻ tới đâu.              │
   * │                                                                          │
   * │ Luật cũ (§1) canh ĐÚNG rủi ro: đừng biến ngăn Kết quả thành một cái kho  │
   * │ thứ hai người dùng phải quản, và đừng để kết quả cũ trôi vào ngữ cảnh    │
   * │ việc mới. Nhưng nó chọn cách canh THÔ NHẤT — vô hình hoàn toàn — và cái  │
   * │ giá là chặn luôn thao tác tự nhiên nhất của cả sản phẩm: "làm tiếp cái   │
   * │ vừa xong".                                                               │
   * │                                                                          │
   * │ CA HỎNG ĐO ĐƯỢC 20/08. Người dùng: *"doc-2, doc-3 thiếu file thuật       │
   * │ ngữ"*. Bốn lượt qua lại, một lượt lập kế hoạch chết vì planner hỏi *"bản │
   * │ dịch tiếng Việt đang nằm ở đường dẫn nào?"* — nó KHÔNG THỂ tự biết. Rồi  │
   * │ khi chạy được, kế hoạch lấy `inputs = library/files/doc-2.md` (bản gốc   │
   * │ TIẾNG ANH), nên người dịch **chưa bao giờ nhìn thấy bản dịch** mà vẫn    │
   * │ viết ra một bảng "các thuật ngữ và cách ĐÃ CHỌN dịch chúng".             │
   * │                                                                          │
   * │ 🔥 Kết quả: bảng ghi `Widget → "Tiện ích (widget)"`, trong khi bản dịch  │
   * │ thật dùng `Widget` nguyên văn và KHÔNG chứa chữ "Tiện ích" lần nào. Một  │
   * │ tài liệu ghi lại những lựa chọn CHƯA TỪNG ĐƯỢC THỰC HIỆN — nhìn rất      │
   * │ chuyên nghiệp, và sai. Đúng lớp lỗi "sai mà không ai biết".              │
   * │                                                                          │
   * │ Thứ THIẾU không phải QUYỀN ĐỌC: nhân viên đã có `Read`/`Grep` với `cwd`  │
   * │ là thư mục văn phòng, chỉ cần `inputs` gọi tên là đọc được ngay hôm nay. │
   * │ Thiếu đúng một thứ — **planner không biết đường dẫn để mà ghi vào        │
   * │ `inputs`.** Đây là lỗ hổng THÔNG TIN lúc lập kế hoạch, không phải lỗ     │
   * │ hổng quyền hạn. Nên bản vá cũng chỉ vá đúng chỗ đó.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Năm chốt để nó không thành tiếng ồn:
   *
   *  1. CHỈ tên + hình dạng. Nội dung đã có `Read` lo, và chỉ khi `inputs` gọi.
   *  2. Gom theo CA, kèm một dòng `request` của ca đó. `P-260820-0314-rab5/T-01/
   *     doc-2.md` không nói gì với model; *"ca: dịch doc-2 sang tiếng Việt"* nói
   *     tất cả. Đây là mảnh làm bảng kê DÙNG ĐƯỢC, không phải đường dẫn.
   *  3. Chỉ `MANIFEST_PLANS` ca gần nhất, kèm một dòng nói còn bao nhiêu ca cũ.
   *  4. Trần token cứng, cắt từ ca CŨ NHẤT.
   *  5. 🔒 CHỈ Trợ lý. Không bao giờ vào prefix nhân viên — xem `budgets`.
   *
   * ⚠ Cái giá đã biết: khối này đổi sau MỖI ca, nên prefix Trợ lý bị ghi lại
   * mỗi ca. Giảm thiểu bằng cách đặt nó CUỐI chuỗi khối (`buildAssistantPrompt`)
   * để mọi thứ phía trên vẫn ấm — chỉ cái đuôi bị viết lại.
   */
  private artifactManifest(): string {
    const files = this.artifacts.list();
    if (files.length === 0) return '';

    // Gom theo ca, giữ thứ tự mới→cũ mà `list()` đã sắp (theo `mtime`).
    const byPlan = new Map<string, string[]>();
    for (const a of files) {
      const key = a.plan_id || LEGACY_PLAN;
      const list = byPlan.get(key) ?? [];
      list.push(a.path);
      byPlan.set(key, list);
    }

    const titles = new Map(this.plans.list().map((p) => [p.plan_id, p.request]));
    const groups = [...byPlan.entries()];
    const shown = groups.slice(0, MANIFEST_PLANS);

    const blocks: string[] = [];
    for (const [planId, paths] of shown) {
      /**
       * Tên việc là thứ làm đường dẫn có nghĩa — nhưng CẮT NGẮN HẲN.
       *
       * `request` là câu Trợ lý viết lại "cho rõ, đủ ngữ cảnh" nên nó dài thật:
       * đo trên máy người dùng, một câu chiếm 300+ ký tự và ăn hơn nửa ngân sách
       * của cả bảng kê. Ở đây nó chỉ làm một việc — giúp model nhận ra *"à, ca
       * dịch doc-2"* — và 30 token là quá đủ cho việc đó. Phần đuôi chi tiết
       * không giúp chọn file, chỉ đẩy các ca khác ra khỏi trần.
       *
       * `briefText` (200 token) là trần dành cho NHẬT KÝ, không phải cho prefix.
       *
       * Không tra được tên (ca đã rơi khỏi `index.json`, trần 200 bản ghi — hoặc
       * là artifact sinh trước bản vá `plan_id` đôi 20/08, mang một id mồ côi)
       * thì nói thẳng là không biết. Bịa một nhãn ngày giờ chỉ tốn token mà
       * không giúp model quyết gì.
       */
      const title = titles.get(planId);
      blocks.push(
        [
          `## ${title ? truncateToTokens(title, 30) : '(một việc cũ, không còn tên trong sổ)'}`,
          // Sắp theo đường dẫn trong MỘT ca: `T-01` phải đứng trước `T-02`.
          // `list()` sắp theo `mtime` nên task chạy xong sau lại lên trên, và
          // một danh sách nhảy số là một danh sách người đọc phải dò lại.
          ...[...paths].sort().map((p) => `- ${p}`),
        ].join('\n'),
      );
    }

    const head = '# Results this office has already produced';
    const foot = [
      groups.length > shown.length ? `(and ${groups.length - shown.length} older job(s) not listed)` : '',
      'These are files EMPLOYEES wrote in earlier jobs. To reuse one, put its path in a',
      "task's `inputs` — the employee opens it directly. You cannot read them yourself.",
    ]
      .filter(Boolean)
      .join('\n');

    /**
     * Cắt từ ca CŨ NHẤT khi vượt trần — bỏ dần từ cuối chứ không `truncateToTokens`
     * cả khối. Cắt giữa chuỗi sẽ để lại một đường dẫn cụt, mà một đường dẫn cụt
     * còn tệ hơn không có đường dẫn nào: model vẫn sẽ điền nó vào `inputs`.
     */
    const limit = this.loaded.company.budgets.artifacts_manifest_tokens;
    const kept = [...blocks];
    const render = (): string => [head, '', ...kept, '', foot].join('\n');
    while (kept.length > 1 && estimateTokens(render()) > limit) kept.pop();
    return render();
  }

  /**
   * Danh sách kết quả, KÈM TÊN VIỆC đã sinh ra chúng. → docs/SPEC-artifacts.md §2.1
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MÃ KẾ HOẠCH KHÔNG BAO GIỜ ĐƯỢC LÀ THỨ NGƯỜI DÙNG PHẢI ĐỌC.              │
   * │                                                                          │
   * │ Panel vốn đã cố ý không hiện `plan_id` — nhưng thứ nó hiện thay vào là   │
   * │ một bản dự phòng ("Việc chạy 19/08 15:10") mà chú thích trong chính file │
   * │ đó đã tự thú: *"chưa có tên việc thì nói ngày giờ"*. Tên việc thì CÓ SẴN │
   * │ ở `tasks/index.json`, chỉ là chưa ai nối dây.                            │
   * │                                                                          │
   * │ Nối ở đây chứ không ở `ArtifactStore`: store quét ĐĨA và không được biết │
   * │ gì về sổ công việc. Trộn hai nguồn vào một lớp là để lần sau ai đó phải  │
   * │ tự hỏi cái nào mới là sự thật.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Kế hoạch đã rơi khỏi `index.json` (trần 200 bản ghi) thì trả rỗng — giao
   * diện tự rơi về nhãn ngày giờ. Đó là suy giảm êm, không phải lỗi.
   */
  artifactList(): Array<import('./artifacts.js').ArtifactRecord & { plan_title: string }> {
    // Đọc sổ MỘT LẦN rồi tra bằng Map: `plans.list()` đọc và parse cả file
    // index, mà một ca chạm 20 CV sẽ sinh hàng chục artifact — gọi nó trong
    // vòng lặp là đọc lại cùng một file hàng chục lần cho mỗi lần mở panel.
    const titles = new Map(this.plans.list().map((p) => [p.plan_id, p.request]));
    return this.artifacts.list().map((a) => ({ ...a, plan_title: titles.get(a.plan_id) ?? '' }));
  }

  /**
   * XOÁ MỘT TÀI LIỆU — và mọi kinh nghiệm sống nhờ nó. → `KnowledgeNode.depends_on`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO XOÁ DÂY CHUYỀN Ở ĐÂY, KHÔNG PHẢI Ở MỘT JOB QUÉT ĐỊNH KỲ.         │
   * │                                                                          │
   * │ Quét định kỳ nghĩa là có một cửa sổ thời gian mà node mồ côi vẫn nằm     │
   * │ trong prefix của mọi nhân viên và vẫn được nghe theo — nó trỏ vào một    │
   * │ file không còn tồn tại, và nó nói điều đó rất tự tin. Độ dài cửa sổ ấy   │
   * │ không ai kiểm được, mà đó đúng là loại lỗi tệ nhất: sai mà im lặng.      │
   * │                                                                          │
   * │ Ở đây thì quan hệ là 1-1 với thao tác của người dùng: bấm xoá, mất luôn. │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Nói ra số node đã bỏ. Xoá âm thầm thứ người dùng nhìn thấy trong ngăn Tri
   * thức là đúng lớp lỗi "mất việc của người dùng, im lặng" (§8).
   */
  removeDocument(name: string): { removed: boolean; droppedNotes: string[] } {
    this.assertLive();
    if (!this.library.remove(name)) return { removed: false, droppedNotes: [] };

    // Đường dẫn trong `depends_on` tính từ thư mục VĂN PHÒNG — cùng dạng với
    // `receipt.reads`, vốn là nguồn sinh ra chúng.
    const dropped = this.knowledge.dropDependents([`library/files/${name}`]);
    if (dropped.length) {
      this.refreshAssistantContext();
      this.emit({
        type: 'knowledge.changed',
        count: this.knowledge.size,
        version: this.loaded.knowledgeVersion,
        plan_id: null,
      });
      this.emitNote(
        `Đã xoá "${name}" và ${dropped.length} ghi chú chỉ có nghĩa nhờ tài liệu đó.`,
        6_000,
      );
    }
    return { removed: true, droppedNotes: dropped };
  }

  /** Tủ tài liệu vừa đổi — số lượng và số đang bóc. → docs/SPEC-library.md §10 */
  private emitLibrary(): void {
    // Tủ đổi thì BẢNG KÊ trong prefix Trợ lý cũng phải đổi. Thiếu dòng này thì
    // người dùng thả tài liệu vào rồi hỏi ngay, và Trợ lý lập kế hoạch như thể
    // tủ vẫn trống — đúng cái lỗ hổng vừa bịt, chỉ khác là muộn hơn vài giây.
    this.refreshAssistantContext();
    this.emit({
      type: 'library.changed',
      count: this.library.size,
      busy: this.library.busyCount(),
      plan_id: null,
    });
  }

  private assistantHot(): string {
    return this.knowledge.hot('assistant', 8, this.loaded.company.budgets.hot_knowledge_tokens).text;
  }

  private describeNode(
    n: LayoutNode,
    missing: boolean,
    connected: boolean,
    notes: Record<string, number>,
  ): CanvasNode {
    const base: CanvasNode = { ...n, label: n.id, missing, connected, removable: true };
    if (n.kind === 'assistant') {
      const a = this.loaded.config.assistant;
      return {
        ...base,
        label: a.display_name,
        avatar: a.avatar,
        // Trước đây trường này mang MODEL ID cho Trợ lý nhưng mang TÊN MỨC cho
        // nhân viên, nên cùng một ô "Model" trên giao diện hiện hai loại giá trị
        // khác nhau. Giờ `tier` luôn là mức, `model` luôn là model.
        tier: this.assistant.modelTier,
        model: this.assistant.model,
        tierInherited: a.model_tier === undefined,
        count: notes['assistant'] ?? 0,
        mcp: a.mcp,
        hue: agentHue('assistant'),
        connected: true,
        removable: false,
      };
    }
    if (n.kind === 'knowledge') {
      return {
        ...base,
        label: 'Kho tri thức chung',
        avatar: '📚',
        count: this.knowledge.size,
        connected: true,
        removable: false,
      };
    }
    if (n.kind === 'library') {
      /**
       * `size` đọc từ catalog trong bộ nhớ — KHÔNG quét đĩa ở đây.
       *
       * `describeNode` chạy mỗi lần vẽ lại sơ đồ (kéo node, đổi dây, mỗi sự
       * kiện SSE). Nhét một `readdir` vào đây là mua một lần chạm đĩa cho mỗi
       * khung hình. Quét đĩa chỉ xảy ra ở `GET /library`, đúng lúc người dùng
       * mở tủ ra nhìn. → docs/SPEC-library.md §9.1
       */
      return {
        ...base,
        label: 'Tủ tài liệu',
        avatar: '🗄',
        count: this.library.size,
        connected: true,
        removable: false,
      };
    }
    if (n.kind === 'mcp') {
      return { ...base, label: n.server ?? n.id, avatar: '🔌', connected: true };
    }
    const role = n.role ? this.loaded.roles.get(n.role) : undefined;
    if (!role) return { ...base, label: n.role ?? n.id, avatar: '?', missing: true };
    return {
      ...base,
      label: role.display_name || role.id,
      avatar: role.avatar,
      tier: role.model_tier,
      model: this.loaded.company.models[role.model_tier],
      pitch: role.pitch,
      count: notes[role.id] ?? 0,
      mcp: role.mcp,
      hue: agentHue(role.id),
    };
  }

  /** Task đã kết thúc trong ca hiện tại. Xem `onSchedulerEvent` để biết vì sao cần. */
  private settled = new Set<string>();

  private onSchedulerEvent(e: AgentEventBody, plan: Plan, record: PlanRecord): void {
    if (e.type === 'task.started') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) this.markStep(plan, task.step, 'running');
    }
    if (e.type === 'task.done' || e.type === 'task.blocked') {
      this.settled.add(e.task_id);
      record.tasks_done++;
      this.plans.upsert(record);
    }
    if (e.type === 'task.done') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) {
        // Đếm theo TASK đã xong, không theo trạng thái của BƯỚC.
        //
        // Bản cũ hỏi "các task anh em có thuộc bước đã done không" — mà bước chỉ
        // done khi mọi task của nó xong, nên câu hỏi tự tham chiếu chính nó và
        // KHÔNG BAO GIỜ đúng. Hệ quả: bước có từ 2 task trở lên vĩnh viễn kẹt ở
        // "đang làm", kể cả khi mọi việc đã xong.
        const siblings = plan.tasks.filter((t) => t.step === task.step);
        const allDone = siblings.every((s) => this.settled.has(s.task_id));
        this.markStep(plan, task.step, e.status === 'done' ? (allDone ? 'done' : 'running') : 'problem');
      }
    }
    this.emit(e);
  }

  private markStep(plan: Plan, index: number, status: Plan['steps'][number]['status']): void {
    const step = plan.steps[index];
    if (!step || step.status === status) return;
    step.status = status;
    this.emit({ type: 'plan.step', step: index, status });
  }

  private setState(state: OfficeState, say: string): void {
    this.state = state;
    this.emit({ type: 'office.state', state, say, plan_id: this.currentRecord?.plan_id ?? null });
  }

  /**
   * Ghi một lượt của TRỢ LÝ vào sổ chi phí.
   *
   * Trợ lý cũng tiêu tiền, và với văn phòng dùng nhiều để trò chuyện thì nó tiêu
   * phần lớn. Trước đây sổ chỉ có receipt của nhân viên, nên `agentco cost` trả
   * lời sai cho đúng câu hỏi quan trọng nhất — "còn bao nhiêu hạn mức".
   *
   * `task_id` mang tên KHÂU (`route`/`plan`/`report`) chứ không phải một id
   * task: ba khâu này có hình dạng chi phí khác hẳn nhau — `route` chạy mỗi lượt
   * và phải rẻ; `plan` chạy một lần một ca ở query riêng. Gộp lại thì không thấy
   * khâu nào đang phình.
   */
  private logAssistantUsage(stage: 'route' | 'plan' | 'report', usage: Usage): void {
    if (usage.turns === 0 && usage.costUSD === 0) return;
    this.onUsage?.({
      ts: new Date().toISOString(),
      office: this.id,
      plan_id: this.currentRecord?.plan_id ?? '',
      task_id: stage,
      role: 'assistant',
      cache_key: '',
      model: usage.model,
      in: usage.input,
      cache_read: usage.cacheRead,
      cache_write: usage.cacheWrite,
      out: usage.output,
      cost_usd: usage.costUSD,
      wall_ms: 0,
      turns: usage.turns,
      status: 'done',
      reasked: false,
    });
  }

  private recordUsage(r: Receipt): void {
    const role = this.loaded.roles.get(r.role);
    this.onUsage?.({
      ts: new Date().toISOString(),
      office: this.id,
      plan_id: this.currentRecord?.plan_id ?? '',
      task_id: r.task_id,
      role: r.role,
      cache_key: role
        ? buildWorkerPrompt(this.loaded, role, { model: this.loaded.company.models[role.model_tier] }).cacheKey
        : '',
      model: r.usage.model,
      in: r.usage.input,
      cache_read: r.usage.cacheRead,
      cache_write: r.usage.cacheWrite,
      out: r.usage.output,
      cost_usd: r.usage.costUSD,
      wall_ms: r.wall_ms,
      turns: r.usage.turns,
      status: r.status,
      reasked: r.reasked,
    });
  }

  /** Company cắm vào — sổ chi phí ở cấp CÔNG TY, một hoá đơn Claude một sổ. */
  onUsage?: (rec: import('./usage.js').UsageRecord) => void;

  private savePlan(plan: Plan): void {
    this.writeJson(path.join(this.loaded.paths.tasks, `${plan.plan_id}.plan.json`), plan);
  }

  /**
   * Biên nhận một task. Tên file mang CẢ `plan_id`.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG ĐÃ SỬA (20/08): ba ca chạy, còn đúng MỘT file biên nhận.             │
   * │                                                                          │
   * │ Bản trước đặt tên `${task_id}.receipt.json`. Nhưng `T-01` là số thứ tự   │
   * │ TRONG một kế hoạch và mọi kế hoạch đều bắt đầu từ 1 — nên mọi ca đều ghi │
   * │ đè lên cùng một file. Đo được trên máy người dùng: văn phòng             │
   * │ `ban-dia-hoa` chạy ba ca dịch, `tasks/` còn lại đúng `T-01.receipt.json` │
   * │ của ca CUỐI. Token, số lượt, `reads`, `looped`, `lessons` của hai ca đầu │
   * │ mất trắng, không khôi phục được.                                         │
   * │                                                                          │
   * │ Đây CHÍNH XÁC là lỗi đã sửa cho `artifacts/` ngày 19/08 (xem             │
   * │ `artifactScoper`) — cùng nguyên nhân, cùng lớp hậu quả. Lần đó `tasks/`  │
   * │ bị bỏ quên, dù `savePlan` ngay bên trên đã dùng `plan_id` từ đầu.        │
   * │                                                                          │
   * │ Bài học: khi sửa một lỗi "id không duy nhất", phải rà HẾT mọi chỗ lấy id │
   * │ đó làm tên file — không chỉ chỗ người dùng vừa kêu.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * File cũ KHÔNG di trú: không có đoạn code nào đọc biên nhận trở lại (đây là
   * bản ghi pháp y để người dùng mở ra xem), nên đổi tên là đủ. Bản `T-01.
   * receipt.json` cũ nằm lại vô hại.
   */
  private saveReceipt(planId: string, r: Receipt): void {
    this.writeJson(path.join(this.loaded.paths.tasks, `${planId}.${r.task_id}.receipt.json`), r);
  }

  /** Task chưa chạy — để `agentco resume` chạy tiếp thay vì làm lại từ đầu. */
  private savePending(pending: TaskBrief[]): void {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (pending.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    this.writeJson(file, pending);
  }

  private sessionFile(): string {
    return path.join(this.loaded.paths.state, 'assistant-session.json');
  }

  private readSessionId(): string | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionFile(), 'utf8')) as { session_id?: string };
      return raw.session_id;
    } catch {
      return undefined;
    }
  }

  private saveSessionId(): void {
    if (!this.assistant.session) return;
    this.writeJson(this.sessionFile(), {
      session_id: this.assistant.session,
      saved: new Date().toISOString(),
    });
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  }
}

/**
 * Bản ghi hội thoại đã BIẾN MẤT — `resume` sẽ không bao giờ chạy lại được.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ RANH GIỚI "THỬ LẠI ĐƯỢC" vs "THỬ LẠI VÔ NGHĨA".                   │
 * │                                                                          │
 * │ Không dùng `classifyError` (worker.ts): nó phân loại theo cái giá phải    │
 * │ trả (hết hạn mức, rate limit, auth) để quyết có retry không. Ở đây câu    │
 * │ hỏi khác hẳn — không phải "chờ rồi thử lại được không" mà "cái ta định    │
 * │ đọc còn tồn tại không". Một lỗi mạng là `other`, một session đã bị xoá    │
 * │ cũng là `other`; gộp chúng lại là mất đúng thông tin cần dùng.            │
 * │                                                                          │
 * │ ⚠ MẶC ĐỊNH LÀ `false` — khớp mẫu không chắc thì coi là lỗi TẠM. Nhận      │
 * │ nhầm một lỗi mạng thành "session mất" là ném đi một bản nén trí nhớ có    │
 * │ thể cứu được; nhận nhầm chiều ngược lại chỉ khiến người dùng gõ `/clear`  │
 * │ thêm một lần. Sai lệch về phía giữ dữ liệu.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Khớp theo VĂN BẢN lỗi vì SDK không phơi mã lỗi có cấu trúc cho ca này. Mẫu
 * để rộng có chủ ý: một bản SDK đổi cách diễn đạt không được làm `/clear` kẹt
 * lại lần nữa. → `Office.compactMemory`
 */
function sessionGone(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no conversation found|session[^.]{0,24}not found|no such session|could not find[^.]{0,24}session|ENOENT/i.test(
    msg,
  );
}

/**
 * Mọi tài liệu tủ mà ca này đã chạm — gộp từ receipt, bỏ trùng.
 *
 * Dùng làm `depends_on` cho bài học CHUNG: Trợ lý không đọc file nào, nên thứ
 * duy nhất nó có thể đang nói tới là tài liệu nhân viên vừa mở.
 */
function readsOf(receipts: readonly Receipt[]): string[] {
  return [...new Set(receipts.flatMap((r) => r.reads))].sort();
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUSD: a.costUSD + b.costUSD,
    model: a.model || b.model,
    turns: a.turns + b.turns,
  };
}

/**
 * Nhân viên mới sinh ra dưới dạng YAML CÓ CHÚ THÍCH, không phải cấu hình trần.
 * File này là chỗ người dùng advanced sẽ mở ra đầu tiên — nó phải tự giải thích
 * được, nhất là hai con số trực tiếp quyết định hoá đơn.
 */
function roleTemplate(id: string, displayName: string, pitch: string, tier: string): string {
  return `id: ${id}
version: 1
display_name: ${JSON.stringify(displayName)}
avatar: "•"

# Đây là THỨ DUY NHẤT Trợ lý nhìn thấy khi lên kế hoạch.
# Giữ ngắn: nó nằm trong ngữ cảnh của Trợ lý suốt cả ca làm việc.
pitch: ${JSON.stringify(pitch || `Mô tả việc ${displayName} làm được, viết cho Trợ lý đọc.`)}
good_at: []
not_for: []

skill_level: medium
skills: {}

# Đọc/ghi file trong văn phòng và tìm trên web đã BẬT SẴN cho mọi nhân viên —
# không cần khai gì ở đây. Trường này chỉ để thêm thứ nằm ngoài bộ mặc định:
#   tools: [Bash]   # cho phép chạy lệnh trên máy — cân nhắc, nó ra được khỏi
#                   # thư mục văn phòng
model_tier: ${tier}
use_preset: false

budget:
  # max_turns là đòn bẩy chi phí lớn nhất: mỗi lượt đọc lại TOÀN BỘ prefix.
  # Vai trò tier eco cần con số CAO HƠN tier standard — model rẻ đi nhiều
  # bước hơn cho cùng một việc.
  max_turns: ${tier === 'eco' ? 12 : 6}
  max_usd: 0.4
  knowledge_pack: 3000
`;
}
