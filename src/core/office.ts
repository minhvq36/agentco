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
import { helpText, parseInput, type ParsedInput } from './commands.js';
import { Mailbox, mergeUserText } from './mailbox.js';
import { PlanStore, agentHue } from './plans.js';
import { Scheduler } from './scheduler.js';
import { buildWorkerPrompt, describePrompt, type PromptLayer } from './prompt.js';
import { estimateTokens } from './tokens.js';
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
  private emitActivity(): void {
    const planning = this.currentRecord?.status === 'planning';
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : planning ? 'planning' : 'idle',
      workers: this.activeScheduler?.runningCount ?? 0,
      queued: this.mailbox.size,
      jobs: this.deferred.length,
      plan_id: this.currentRecord?.plan_id ?? null,
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
        // Nói NGAY là đang làm gì. Nén là một lượt gọi model, mất vài giây —
        // không có dòng này thì người dùng gõ `/clear` xong nhìn vào một ô chat
        // im lặng và không biết lệnh đã ăn hay chưa. Câu này rồi sẽ bị chính
        // `office.cleared` cuốn đi, nên nó không để lại rác.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: 'Đang dọn cuộc trò chuyện, cất lại những gì bạn đã chốt…',
          plan_id: null,
        });
        // KHÔNG await: trả lời ngay để ô chat không đứng hình, rồi báo kết quả
        // bằng sự kiện như mọi thứ khác.
        void this.compactMemory()
          .then((r) => this.emit({ type: 'master.message', say: r.note, role: 'assistant', plan_id: null }))
          .catch(() => {
            this.emit({
              type: 'master.message',
              say: 'Chưa dọn được cuộc trò chuyện. Mình giữ nguyên mọi thứ, thử lại sau nhé.',
              role: 'assistant',
              plan_id: null,
            });
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
      const planned = await this.mailbox.lock(() => this.assistant.plan(request));
      usage = addUsage(usage, planned.usage);
      this.logAssistantUsage('plan', planned.usage);
      const plan = { ...planned.value, plan_id: record.plan_id };

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
        this.saveReceipt(r);
        this.recordUsage(r);
        usage = addUsage(usage, r.usage);
        for (const lesson of r.lessons) {
          this.knowledge.addLesson(r.role, lesson.text, r.task_id, docTexts ?? []);
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
        const summary = await this.mailbox.lock(() => this.assistant.report(plan.steps, receipts));
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
          this.knowledge.addSharedLesson(lesson.text, plan.plan_id, docTexts ?? []);
        }
      }

      if (receipts.some((r) => r.lessons.length > 0) || status === 'done') {
        this.knowledge.scan();
        this.emit({
          type: 'knowledge.changed',
          count: this.knowledge.size,
          version: this.loaded.knowledgeVersion,
        });
        this.refreshAssistantContext();
      }

      // Nhớ kết quả để bàn giao cho việc đang xếp hàng — xem inish().
      this.lastArtifacts = receipts.flatMap((r) => r.artifacts);
      this.savePending(result.pending);
      this.saveSessionId();
      // Nhánh "đã dừng" tự liệt kê artifact trong câu của nó rồi (§11f) — đưa
      // thêm khối đường dẫn vào đó là nói hai lần cùng một chuyện.
      this.finish(record, status, report, usage, receipts.length, status === 'stopped' ? [] : receipts);
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

  private whereBlock(receipts: readonly Receipt[]): string {
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
    if (files.size) {
      // Đường dẫn tính từ THƯ MỤC LÀM VIỆC, không từ thư mục văn phòng: người
      // dùng đang đứng ở đó khi mở file explorer. `artifacts/T-01/x.md` đứng một
      // mình thì đúng về kỹ thuật mà vô dụng với người lần đầu đi tìm.
      const base = `${path.basename(this.loaded.companyDir)}/offices/${this.id}`;
      const shown = [...files].sort().slice(0, MAX_LISTED_FILES);
      lines.push('Kết quả đã lưu tại:');
      lines.push(...shown.map((p) => `  ${base}/${p}`));
      if (files.size > shown.length) lines.push(`  …và ${files.size - shown.length} file nữa`);
    }
    if (servers.size) {
      lines.push(`Đã ghi ra ngoài qua: ${[...servers].sort().join(', ')}`);
    }
    if (ranCommand) {
      lines.push('Có chạy lệnh trên máy — kết quả có thể nằm ngoài thư mục văn phòng.');
    }

    return lines.length ? `\n\n${lines.join('\n')}` : '';
  }

  private finish(
    record: PlanRecord,
    status: PlanStatus,
    report: string,
    usage: Usage,
    tasks: number,
    receipts: readonly Receipt[] = [],
  ): void {
    report += this.whereBlock(receipts);
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
    this.emit({ type: 'master.message', say: report, role: 'assistant' });
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
    this.setState(
      status === 'paused' || status === 'stopped' ? 'paused' : 'idle',
      status === 'paused' ? 'Tạm nghỉ.' : status === 'stopped' ? 'Đã dừng.' : 'Xong việc.',
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
    // Bảng kê tủ chỉ có với Trợ lý — nhân viên tìm bằng `Grep`, không cần danh sách.
    const library = who === 'assistant' ? this.library.manifest() : '';
    return describePrompt(this.loaded, who, hot, memory, library);
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
      const swept = this.pruneNow();
      this.clearChatLog();
      this.emit({ type: 'office.cleared', say: 'Đã dọn cuộc trò chuyện.', plan_id: null });
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
      // Nén hỏng thì KHÔNG được quên: thà giữ một bản ghi dài còn hơn mất trắng.
      return {
        saved: false,
        note: `Chưa nén được trí nhớ (${err instanceof Error ? err.message : 'lỗi'}), nên mình giữ nguyên cuộc trò chuyện.`,
      };
    }

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
    return {
      saved,
      note:
        (saved
          ? 'Đã dọn cuộc trò chuyện. Những gì bạn đã chốt mình cất vào sổ tay riêng, mở ở ngăn Tri thức xem được.'
          : 'Đã dọn cuộc trò chuyện.') + tail,
    };
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
    void this.compactMemory()
      .then((r) => {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: `Cuộc trò chuyện đã dài, mình dọn bớt cho nhẹ. ${r.note}`,
          plan_id: null,
        });
      })
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
    const days = this.loaded.company.librarian.prune_after_days;
    if (days <= 0) return '';
    // Sổ tay của người đã cất được miễn trừ — xem `pruneStale`.
    const dropped = this.knowledge.pruneStale(days, this.loaded.archivedRoles);
    if (dropped.length === 0) return '';
    this.knowledge.scan();
    return ` Bỏ luôn ${dropped.length} ghi chú đã cũ hoặc đã bị bản mới đè.`;
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

  private saveReceipt(r: Receipt): void {
    this.writeJson(path.join(this.loaded.paths.tasks, `${r.task_id}.receipt.json`), r);
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
