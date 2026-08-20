/**
 * Scheduler: chạy DAG task song song.
 *
 * → docs/SPEC-2026-08-14-agentco.md §7, §9b
 */

import fs from 'node:fs';

import { CachePrimingGate } from './gate.js';
import { buildWorkerPrompt } from './prompt.js';
import { safeJoin } from './paths.js';
import { runWorker, type WorkerHandle } from './worker.js';
import type { LoadedOffice } from './config.js';
import type { KnowledgeStore } from '../knowledge/store.js';
import {
  RunError,
  type AgentEventBody,
  type Plan,
  type Receipt,
  type TaskBrief,
  type Tier,
} from './types.js';

export interface SchedulerDeps {
  office: LoadedOffice;
  knowledge: KnowledgeStore;
  emit(event: AgentEventBody): void;
  /** Kiểm tra giữa các task — người dùng bấm Dừng thì thoát sạch. */
  shouldStop?(): boolean;
}

export interface RunResult {
  receipts: Map<string, Receipt>;
  /** Task chưa chạy vì hết hạn mức / bị dừng. Giữ lại để `agentco resume`. */
  pending: TaskBrief[];
  stoppedBy?: 'usage_limit' | 'user' | 'auth';
}

export class Scheduler {
  private readonly gate: CachePrimingGate;
  /** AIMD: gặp 429 thì giảm nửa, chạy trơn 10 task thì tăng 1. */
  private concurrency: number;
  private readonly maxConcurrency: number;
  private smoothRun = 0;
  private readonly runningByTier = new Map<Tier, number>();
  /**
   * Tay cầm của những worker ĐANG chạy. Không có nó thì `stop()` chỉ là một cờ
   * kiểm tra GIỮA các task — người dùng bấm Dừng vẫn phải ngồi chờ task hiện
   * tại chạy hết, có khi cả phút và cả nghìn token.
   * → docs/SPEC-tools-approval.md §3b
   */
  private readonly live = new Set<WorkerHandle>();

  constructor(private readonly deps: SchedulerDeps) {
    const rt = deps.office.company.runtime;
    this.maxConcurrency = rt.concurrency;
    this.concurrency = rt.concurrency;
    this.gate = new CachePrimingGate(ttlMs(rt.cache_ttl), rt.priming_timeout_ms);
  }

  /**
   * NỐI DÂY CÒN THIẾU — sửa, không báo lỗi. Chạy TRƯỚC `validate`.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TASK ĐỌC KẾT QUẢ CỦA TASK KHÁC MÀ KHÔNG KHAI `deps` = RACE, VÀ NÓ IM.   │
   * │                                                                          │
   * │ `deps` rỗng nghĩa là "chạy song song được" — nên T-02 được phóng cùng    │
   * │ lúc T-01, rồi đọc một file T-01 chưa kịp ghi. Nhân viên không báo lỗi:   │
   * │ nó thấy file trống/không có, tự xoay sở, và trả về một kết quả trông     │
   * │ vẫn hợp lý. Đây đúng loại "conflict" tốn tiền mà không ai nhìn thấy.     │
   * │                                                                          │
   * │ Quan hệ này SUY RA ĐƯỢC: cùng một đường dẫn, một bên khai `outputs`, một │
   * │ bên khai `inputs`. Ta đang cầm cả hai. Bắt model khai lại cho đúng là     │
   * │ trả tiền để đổi lấy bất định — sửa thẳng thì tất định và 0 token.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Trả về những dây đã tự nối, để nhật ký nói ra chứ không sửa lén.
   *
   * An toàn với vòng lặp: nếu việc nối dây đẻ ra chu trình (T-01 cũng đọc kết
   * quả của T-02) thì `validate` chạy ngay sau đây sẽ bắt được — đó là lý do
   * hàm này phải chạy TRƯỚC, không phải sau.
   */
  static linkDeps(plan: Plan): string[] {
    const producer = new Map<string, string>();
    for (const t of plan.tasks) for (const o of t.outputs) producer.set(norm(o.path), t.task_id);

    const linked: string[] = [];
    for (const t of plan.tasks) {
      for (const i of t.inputs) {
        const want = norm(i.path);
        // Khớp thẳng trước; không có thì hỏi tiếp "có ai ĐANG GHI VÀO thư mục
        // này không". Một thư mục có thể có nhiều người ghi, nên nối HẾT —
        // thiếu một dây là task đọc thư mục khi mới có một nửa số file.
        const exact = producer.get(want);
        const from = exact ? [exact] : producersInto(producer, want);
        for (const d of from) {
          if (d === t.task_id || t.deps.includes(d)) continue;
          t.deps.push(d);
          linked.push(`${t.task_id} → ${d}`);
        }
      }
    }
    return linked;
  }

  /**
   * Từ chối DAG hỏng NGAY LÚC LẬP KẾ HOẠCH, không đợi lúc chạy mới nổ.
   * Rẻ hơn nhiều: mới tốn đúng một lượt lập kế hoạch, chưa phóng worker nào.
   *
   * `officeDir` để kiểm `inputs` có thật trên đĩa không. Không truyền thì bỏ
   * qua kiểm đó — hàm vẫn dùng được trong test mà không cần dựng thư mục.
   */
  static validate(plan: Plan, knownRoles: ReadonlySet<string>, officeDir?: string): string[] {
    const problems: string[] = [];
    const ids = new Set(plan.tasks.map((t) => t.task_id));
    const writers = new Map<string, string>();
    const produced = new Set<string>();
    for (const t of plan.tasks) for (const o of t.outputs) produced.add(norm(o.path));

    for (const t of plan.tasks) {
      if (!knownRoles.has(t.role)) problems.push(`Task ${t.task_id}: không có vai trò "${t.role}"`);
      for (const d of t.deps) {
        if (!ids.has(d)) problems.push(`Task ${t.task_id}: phụ thuộc "${d}" không tồn tại`);
      }
      for (const o of t.outputs) {
        const prev = writers.get(o.path);
        if (prev) problems.push(`Task ${t.task_id} và ${prev} cùng ghi "${o.path}"`);
        else writers.set(o.path, t.task_id);
      }

      /**
       * ĐẦU VÀO TRỎ VÀO HƯ KHÔNG — kiểm được, nên phải kiểm.
       *
       * Trợ lý gõ nhầm một chữ trong tên tài liệu là nhân viên nhận một đường
       * dẫn chết. Nó không báo lỗi: nó đi TÌM, tốn lượt, rồi hoặc trả `blocked`
       * hoặc tệ hơn — trả lời bằng thứ nó đoán ra. Cái giá là cả một task.
       *
       * Chỉ báo khi đường dẫn KHÔNG có trên đĩa VÀ không task nào sinh ra nó.
       */
      if (officeDir) {
        for (const i of t.inputs) {
          const want = norm(i.path);
          // Thư mục mà một task khác đang ghi vào cũng là "sẽ có" — xem `contains`.
          if (produced.has(want) || [...produced].some((p) => contains(want, p))) continue;
          let exists = false;
          try {
            exists = fs.existsSync(safeJoin(officeDir, i.path));
          } catch {
            exists = false;
          }
          if (!exists) {
            problems.push(
              `Task ${t.task_id} cần đọc "${i.path}" nhưng không có file đó, và không việc nào tạo ra nó`,
            );
          }
        }
      }
    }

    // chu trình
    const state = new Map<string, 0 | 1 | 2>();
    const byId = new Map(plan.tasks.map((t) => [t.task_id, t]));
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) {
        problems.push(`Phụ thuộc vòng tròn: ${[...trail, id].join(' → ')}`);
        return;
      }
      state.set(id, 1);
      for (const d of byId.get(id)?.deps ?? []) visit(d, [...trail, id]);
      state.set(id, 2);
    };
    for (const t of plan.tasks) visit(t.task_id, []);

    return problems;
  }

  // ────────────────────────────────────────────────────────────
  //
  // (`norm` ở cuối file: một đường dẫn phải so được với chính nó dù model viết
  //  `./artifacts/x.md`, `artifacts\x.md` hay `artifacts/x.md`.)

  async run(plan: Plan): Promise<RunResult> {
    const receipts = new Map<string, Receipt>();
    const remaining = new Map(plan.tasks.map((t) => [t.task_id, t]));
    const failed = new Set<string>();
    const running = new Set<Promise<void>>();
    let stoppedBy: RunResult['stoppedBy'];

    while (remaining.size > 0 && !stoppedBy) {
      if (this.deps.shouldStop?.()) {
        stoppedBy = 'user';
        break;
      }

      const ready = [...remaining.values()].filter((t) =>
        t.deps.every((d) => receipts.has(d) || failed.has(d)),
      );

      // Dep hỏng thì task con không chạy — nhưng KHÔNG đánh failed âm thầm,
      // trả receipt "blocked" để người dùng thấy vì sao nó không chạy.
      for (const t of ready) {
        if (t.deps.some((d) => failed.has(d))) {
          remaining.delete(t.task_id);
          failed.add(t.task_id);
          const blocked: Receipt = {
            status: 'blocked',
            say: `Không làm được vì bước trước chưa xong.`,
            answer: '',
            artifacts: [],
            lessons: [],
            blocked_on: `phụ thuộc hỏng: ${t.deps.filter((d) => failed.has(d)).join(', ')}`,
            task_id: t.task_id,
            role: t.role,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
            wall_ms: 0,
            reasked: false,
            landed: [],
            looped: false,
            reads: [],
          };
          receipts.set(t.task_id, blocked);
          this.deps.emit({
            type: 'task.blocked',
            task_id: t.task_id,
            role: t.role,
            say: blocked.say,
            reason: blocked.blocked_on ?? '',
          });
        }
      }

      // Trần toàn cục VÀ trần theo tier. Trần theo tier quan trọng vì model
      // đắt (deep/Opus) ăn hạn mức subscription nhanh hơn nhiều — chạy 4 Opus
      // song song sẽ đốt gói của người dùng rất nhanh.
      const launchable: TaskBrief[] = [];
      const perTier = new Map(this.runningByTier);
      for (const t of ready) {
        if (!remaining.has(t.task_id)) continue;
        if (running.size + launchable.length >= this.concurrency) break;
        const tier = this.deps.office.roles.get(t.role)?.model_tier ?? 'standard';
        const cap = this.deps.office.company.runtime.concurrency_by_tier[tier];
        const used = perTier.get(tier) ?? 0;
        if (used >= cap) continue;
        perTier.set(tier, used + 1);
        launchable.push(t);
      }

      if (launchable.length === 0) {
        if (running.size === 0) break; // deadlock hoặc hết việc
        await Promise.race(running);
        continue;
      }

      for (const brief of launchable) {
        remaining.delete(brief.task_id);
        const tier = this.deps.office.roles.get(brief.role)?.model_tier ?? 'standard';
        this.runningByTier.set(tier, (this.runningByTier.get(tier) ?? 0) + 1);
        const p = this.execute(brief)
          .then((receipt) => {
            receipts.set(brief.task_id, receipt);
            if (receipt.status === 'failed') failed.add(brief.task_id);
            this.onSuccess();
          })
          .catch((err: unknown) => {
            const kind = err instanceof RunError ? err.kind : 'other';
            if (kind === 'usage_limit') {
              // Hết hạn mức: DỪNG CA, không retry. Task chưa chạy giữ nguyên.
              stoppedBy = 'usage_limit';
              remaining.set(brief.task_id, brief);
              return;
            }
            if (kind === 'auth') {
              stoppedBy = 'auth';
              remaining.set(brief.task_id, brief);
              return;
            }
            if (kind === 'rate_limit') {
              this.onRateLimit();
              remaining.set(brief.task_id, brief); // thử lại vòng sau
              return;
            }
            failed.add(brief.task_id);
            receipts.set(brief.task_id, this.errorReceipt(brief, err, kind));
          })
          .finally(() => {
            running.delete(p);
            this.runningByTier.set(tier, Math.max(0, (this.runningByTier.get(tier) ?? 1) - 1));
          });
        running.add(p);
      }

      if (running.size >= this.concurrency) await Promise.race(running);
    }

    await Promise.allSettled(running);

    const result: RunResult = { receipts, pending: [...remaining.values()] };
    if (stoppedBy) result.stoppedBy = stoppedBy;
    return result;
  }

  gateStats() {
    return this.gate.snapshot();
  }

  /** Số nhân viên ĐANG chạy — giao diện hiện "2 nhân viên đang làm việc". */
  get runningCount(): number {
    return this.live.size;
  }

  /** Ngắt NGAY mọi worker đang chạy. Gọi từ `Esc` / `/stop`. */
  async interruptAll(): Promise<void> {
    await Promise.allSettled([...this.live].map((h) => h.interrupt()));
  }

  // ── nội bộ

  private async execute(brief: TaskBrief): Promise<Receipt> {
    const { office, knowledge } = this.deps;
    const role = office.roles.get(brief.role);
    if (!role) throw new RunError(`Không có vai trò "${brief.role}"`, 'other');

    // HOT: nằm trong prefix cache, tính theo role, KHÔNG theo task.
    const hot = knowledge.hot(role.id, role.hot_knowledge_size, office.company.budgets.hot_knowledge_tokens);
    // COLD: chọn theo nội dung task, nằm sau breakpoint, trả giá đầy đủ.
    const cold = knowledge.cold(
      role.id,
      `${brief.goal} ${brief.constraints.join(' ')}`,
      Math.min(role.budget.knowledge_pack, office.company.budgets.cold_knowledge_tokens),
      hot.ids,
    );

    /**
     * ⚠ BẤT BIẾN: `say` KHÔNG BAO GIỜ chứa TÊN người nói.
     *
     * Sự kiện đã mang `role`, và mọi chỗ hiển thị đều tự tra tên từ đó
     * (`labelFor` ở nhật ký và ở dòng trạng thái). Ghép sẵn tên vào đây thì
     * người dùng đọc được "Người viết: Người viết: Viết 3 đoạn…" — tên hiện
     * hai lần, ở cả hai nơi.
     *
     * Luật này thuộc về giao thức chứ không phải thẩm mỹ: bridge Telegram sau
     * này cũng là một chỗ hiển thị, và nó cần tự quyết cách gắn tên (in đậm,
     * emoji, hay bỏ hẳn). Nướng sẵn tên vào chuỗi là tước quyền đó của mọi
     * client tương lai.
     */
    this.deps.emit({
      type: 'task.started',
      task_id: brief.task_id,
      role: role.id,
      say: brief.goal,
    });

    let handle: WorkerHandle | undefined;
    let receipt: Receipt;
    try {
      receipt = await runWorker(
        {
          office,
          acquireCacheSlot: (key) => this.gate.acquire(key),
          onProgress: (say) =>
            this.deps.emit({ type: 'task.progress', task_id: brief.task_id, role: role.id, say }),
          // Đăng ký tay cầm để `stop()` với tới được worker ĐANG chạy.
          onStart: (h) => {
            handle = h;
            this.live.add(h);
          },
        },
        { brief, role, hotKnowledge: hot.text, coldKnowledge: cold.text },
      );
    } finally {
      if (handle) this.live.delete(handle);
    }

    /**
     * ⚠ CHỈ đếm lượt COLD. Đếm cả HOT là một vòng lặp KHÉP KÍN không tự sửa được.
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ Bản trước: `recordHits([...hot.ids, ...cold.ids])`.                │
     * │                                                                    │
     * │  · node HOT được +1 ở MỌI task, chỉ vì nó đang ở trong HOT          │
     * │  · `hot()` lại xếp hạng bằng chính `hits`                           │
     * │  · `cold()` LOẠI node HOT ra khỏi cuộc thi (`excludeIds: hot.ids`)  │
     * │                                                                    │
     * │ ⇒ vào được HOT một lần là ở đó VĨNH VIỄN. Node ngoài HOT chỉ được   │
     * │ +1 khi khớp từ khoá, không bao giờ đuổi kịp. Số liệu thật của người │
     * │ dùng cho thấy đúng thế: ba node HOT có hits 6/3/2, mọi node còn lại │
     * │ đúng bằng 0.                                                        │
     * │                                                                    │
     * │ Và nó làm `hits` mất hết ý nghĩa: nó đo "anh ở trong HOT bao lâu",  │
     * │ không đo "anh có ích không".                                        │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * Chỉ đếm COLD thì `hits` mang đúng một nghĩa: **bộ chọn từ khoá đã thấy
     * node này hợp với một việc CÓ THẬT bao nhiêu lần.** Vòng lặp tự sửa:
     * node COLD leo dần → chen vào HOT → node HOT yếu nhất rơi ra → nó lại
     * được dự thi COLD và leo lại nếu thật sự có ích.
     *
     * Đây cũng là điều kiện để cửa sổ khai tử trong `pruneStale` có nghĩa.
     *
     * Dùng `cold.matched` chứ không `cold.ids`: `matched` là MỌI node hợp việc,
     * kể cả node đang nằm trong HOT (chúng bị loại khỏi phần render vì đã có
     * trong prefix rồi, nhưng vẫn phải được ghi nhận là có ích). → store.ts
     */
    knowledge.recordHits(cold.matched);

    this.deps.emit({
      type: 'task.done',
      task_id: brief.task_id,
      role: role.id,
      say: receipt.say,
      status: receipt.status,
      artifacts: receipt.artifacts,
      usage: receipt.usage,
    });

    return receipt;
  }

  /** Cho phép kiểm tra cacheKey trước khi chạy — dùng ở `agentco status`. */
  cacheKeyFor(roleId: string): string | undefined {
    const role = this.deps.office.roles.get(roleId);
    if (!role) return undefined;
    return buildWorkerPrompt(this.deps.office, role, {
      model: this.deps.office.company.models[role.model_tier],
    }).cacheKey;
  }

  private onRateLimit(): void {
    this.smoothRun = 0;
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
  }

  private onSuccess(): void {
    if (++this.smoothRun >= 10 && this.concurrency < this.maxConcurrency) {
      this.concurrency++;
      this.smoothRun = 0;
    }
  }

  private errorReceipt(brief: TaskBrief, err: unknown, kind: string): Receipt {
    const msg = err instanceof Error ? err.message : String(err);
    // Nói CHUYỆN GÌ XẢY RA + LÀM GÌ TIẾP THEO. "Gặp lỗi" chung chung là vô dụng
    // với người non-code — họ không biết sửa ở đâu.
    const say =
      kind === 'max_turns'
        ? `Việc này cần nhiều bước hơn mức cho phép. Nới max_turns trong roles/${brief.role}.yaml, hoặc chia nhỏ yêu cầu.`
        : kind === 'budget'
          ? `Việc này chạm trần chi phí đã đặt cho ${brief.role}. Nới max_usd trong roles/${brief.role}.yaml nếu thấy đáng.`
          : 'Việc này gặp lỗi và không hoàn thành được. Xem nhật ký chi tiết.';
    return {
      status: 'failed',
      say,
      answer: '',
      artifacts: [],
      lessons: [],
      blocked_on: msg.slice(0, 200),
      task_id: brief.task_id,
      role: brief.role,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
      wall_ms: 0,
      reasked: false,
      landed: [],
      // Task nổ trước khi chạy được gì: không quan sát được thao tác nào, nên
      // không được khai là có lặp. `status: failed` đã là tín hiệu trục trặc rồi.
      looped: false,
      reads: [],
    };
  }
}

/**
 * TTL 1 giờ khi đang "trong ca": người dùng nghĩ 7 phút giữa hai câu là chuyện
 * thường, mà TTL 5 phút thì mất trắng cache. Ghi cache TTL 1h đắt hơn ~1.6×
 * nhưng cứu được toàn bộ khoảng nghỉ.
 */
function ttlMs(setting: 'auto' | '5m' | '1h'): number {
  if (setting === '5m') return 5 * 60_000;
  return 60 * 60_000;
}

/**
 * Chuẩn hoá đường dẫn để SO SÁNH — không phải để mở file.
 *
 * `outputs` của T-01 và `inputs` của T-02 do model viết ở hai chỗ khác nhau
 * trong cùng một khối JSON, nên nó viết `artifacts/x.md` ở đây và
 * `./artifacts/x.md` ở kia là chuyện bình thường. So chuỗi thô thì hai cái đó
 * là hai file khác nhau, và cả cơ chế nối dây tự động im lặng không chạy.
 *
 * ⚠ DẤU GẠCH CUỐI CŨNG LÀ MỘT CA NHƯ THẾ, và nó đã nổ thật (20/08). Ca hợp
 * đồng: T-01 khai `outputs: artifacts/T-01/dieu-khoan/`, T-02 khai `inputs:`
 * đúng chuỗi đó. Nhưng `outputScoper` cắt dấu gạch cuối (nó tách chuỗi rồi bỏ
 * mảnh rỗng) còn `artifactScoper` thì không — nên hai bên bước vào `norm` với
 * `…/dieu-khoan` và `…/dieu-khoan/`, không khớp, và người dùng nhận
 * *"không việc nào tạo ra nó"* cho một thư mục mà T-01 đang tạo ra.
 */
function norm(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * `dir` có phải THƯ MỤC CHỨA `file` không (đã chuẩn hoá cả hai).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỘT TASK KHÔNG BIẾT TRƯỚC NÓ SẼ ĐẺ RA BAO NHIÊU FILE — VÀ ĐÓ LÀ CA THẬT. │
 * │                                                                          │
 * │ *"Tách hợp đồng theo điều khoản, mỗi điều một file"*: số file bằng số     │
 * │ điều khoản, mà số điều khoản chỉ biết được sau khi đọc. Nên planner viết  │
 * │ `outputs: […/dieu-khoan/dieu-01.md]` rồi `inputs` của bước sau trỏ vào cả │
 * │ THƯ MỤC — đó là cách khai đúng nhất nó có, không phải một lỗi.            │
 * │                                                                          │
 * │ So bằng `===` thì thư mục không bao giờ khớp file, `validate` chặn cả kế  │
 * │ hoạch, và người dùng phải diễn đạt lại một yêu cầu vốn đã rõ ràng.        │
 * │                                                                          │
 * │ So bằng tiền tố + `/` chứ không phải `startsWith` trần: `dieu-khoan` là   │
 * │ tiền tố chuỗi của `dieu-khoan-cu.md` nhưng KHÔNG phải thư mục chứa nó.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function contains(dir: string, file: string): boolean {
  return dir.length > 0 && file.startsWith(`${dir}/`);
}

/** Mọi task ghi một file NẰM TRONG `dir`. Thứ tự giữ nguyên, không trùng. */
function producersInto(producer: ReadonlyMap<string, string>, dir: string): string[] {
  const out: string[] = [];
  for (const [path, task] of producer) {
    if (contains(dir, path) && !out.includes(task)) out.push(task);
  }
  return out;
}
