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
import { ensureOfficeDirs, isSafeId, safeJoin, slugId } from './paths.js';
import { KnowledgeStore } from '../knowledge/store.js';
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
  type Plan,
  type PlanRecord,
  type PlanStatus,
  type Receipt,
  type TaskBrief,
  type Usage,
} from './types.js';

export type OfficeState = 'idle' | 'working' | 'paused' | 'stopped';

/** Node đã kèm metadata để vẽ. Không có gì trong đây được ghi vào layout.json. */
export interface CanvasNode extends LayoutNode {
  label: string;
  avatar?: string;
  tier?: string;
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
    this.emitFn(full);
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
    this.emit({ type: 'master.message', say: message, role: 'user', plan_id: null });

    // Lệnh chữ bị bắt TRƯỚC khi tới model. Hai lý do, cả hai đều bắt buộc:
    // ném "/stop" cho model là trả tiền để được dừng chậm hơn; và chuỗi bắt đầu
    // bằng "/" có thể bị chính CLI Claude Code hiểu là lệnh CỦA NÓ.
    // → docs/SPEC-tools-approval.md §8e
    const parsed = parseInput(message);
    if (parsed.kind !== 'text') return this.runCommand(parsed);

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

  /** Trạng thái Trợ lý và trạng thái nhân viên là HAI thứ. Nói cả hai ra. */
  private emitActivity(): void {
    this.emit({
      type: 'office.activity',
      assistant: this.mailbox.isBusy ? 'thinking' : 'idle',
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

    try {
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
      const plan = { ...planned.value, plan_id: record.plan_id };

      // 2. Chặn DAG hỏng TRƯỚC khi tốn token nào cho worker. Danh sách đối chiếu
      // là vai trò ĐANG TRỰC, không phải mọi file trong roles/ — nếu không thì
      // ngắt dây trên canvas chỉ là trang trí.
      const problems = Scheduler.validate(plan, onDuty);
      if (problems.length) {
        throw new RunError(`Kế hoạch không hợp lệ:\n- ${problems.join('\n- ')}`, 'other');
      }

      this.currentPlan = plan;
      record.steps = plan.steps;
      record.tasks_total = plan.tasks.length;
      record.status = 'running';
      this.plans.upsert(record);
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

      for (const r of receipts) {
        this.saveReceipt(r);
        this.recordUsage(r);
        usage = addUsage(usage, r.usage);
        for (const lesson of r.lessons) {
          this.knowledge.addLesson(r.role, lesson.text, r.task_id);
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
        report = summary.value.say;
        status = receipts.some((r) => r.status === 'failed') ? 'failed' : 'done';
        // Trợ lý là bên DUY NHẤT được ghi vào kho chung (SPEC-offices.md §4.3):
        // kho chung nằm trong prefix của cả văn phòng, cho ai cũng ghi được thì
        // nó phình theo cấp số nhân và không ai chịu trách nhiệm.
        for (const lesson of summary.value.lessons) {
          this.knowledge.addSharedLesson(lesson.text, plan.plan_id);
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
      this.finish(record, status, report, usage, receipts.length);
      return { plan_id: record.plan_id, report, usage };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Thông báo cho người dùng và thông báo cho log là HAI thứ khác nhau.
      // Người dùng cần biết LÀM GÌ TIẾP; log cần biết chuyện gì xảy ra.
      this.finish(record, 'failed', msg, usage, 0);
      return { plan_id: record.plan_id, report: msg, usage };
    }
  }

  private finish(
    record: PlanRecord,
    status: PlanStatus,
    report: string,
    usage: Usage,
    tasks: number,
  ): void {
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
    this.layout.connectAssistant(id);
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã thêm "${name || id}".`, plan_id: null });
    return id;
  }

  /**
   * Bỏ nhân viên khỏi sơ đồ. MẶC ĐỊNH GIỮ FILE yaml lại.
   *
   * Xoá node và xoá công sức viết skills là hai ý định khác nhau; gộp chúng làm
   * một là cách chắc chắn nhất để người dùng mất việc đã làm vì một cú click.
   */
  removeAgent(roleId: string, keepFile = true): void {
    if (!isSafeId(roleId)) throw new RunError('Mã nhân viên không hợp lệ.', 'other');
    if (!this.loaded.roles.has(roleId)) throw new RunError(`Không có nhân viên "${roleId}".`, 'other');

    this.layout.dropAgent(roleId);
    if (!keepFile) {
      for (const ext of ['.yaml', '.yml']) {
        fs.rmSync(path.join(this.loaded.paths.roles, `${roleId}${ext}`), { force: true });
      }
      this.reload();
    }
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã bỏ "${roleId}" khỏi sơ đồ.`, plan_id: null });
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
    return describePrompt(this.loaded, who, hot);
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

  /** Nạp lại từ đĩa. Giữ nguyên session Trợ lý — nạp lại config không phải quên hội thoại. */
  reload(): void {
    this.loaded = loadOffice(this.loaded.companyDir, this.loaded.company, this.loaded.id);
    this.assistant.rebind(this.loaded);
    this.layout.rebind(this.loaded);
    this.plans.rebind(this.loaded.paths);
    this.knowledge.rebind(this.loaded.dir, this.loaded.paths);
    this.knowledge.scan();
  }

  readArtifact(rel: string): string | undefined {
    const normalized = rel.replace(/\\/g, '/');
    // safeJoin chặn đi RA NGOÀI văn phòng, nhưng `.state/` nằm BÊN TRONG — đó là
    // chỗ chứa session id. Một đường dẫn hợp lệ hoàn toàn như `.state/x.json`
    // sẽ lọt qua safeJoin. Chặn riêng ở đây.
    if (normalized.split('/').some((seg) => seg.startsWith('.'))) return undefined;
    try {
      const abs = safeJoin(this.loaded.dir, normalized);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return undefined;
    }
  }

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
        tier: this.loaded.company.models[this.loaded.company.models.master],
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
