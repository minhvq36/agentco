/**
 * Scheduler: chạy DAG task song song.
 *
 * → docs/SPEC-2026-08-14-agentco.md §7, §9b
 */

import { CachePrimingGate } from './gate.js';
import { buildWorkerPrompt } from './prompt.js';
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
   * Từ chối DAG hỏng NGAY LÚC LẬP KẾ HOẠCH, không đợi lúc chạy mới nổ.
   * Rẻ hơn nhiều: chưa tốn token nào.
   */
  static validate(plan: Plan, knownRoles: ReadonlySet<string>): string[] {
    const problems: string[] = [];
    const ids = new Set(plan.tasks.map((t) => t.task_id));
    const writers = new Map<string, string>();

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
            artifacts: [],
            lessons: [],
            blocked_on: `phụ thuộc hỏng: ${t.deps.filter((d) => failed.has(d)).join(', ')}`,
            task_id: t.task_id,
            role: t.role,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
            wall_ms: 0,
            reasked: false,
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

    this.deps.emit({
      type: 'task.started',
      task_id: brief.task_id,
      role: role.id,
      say: `${role.display_name || role.id}: ${brief.goal}`,
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

    knowledge.recordHits([...hot.ids, ...cold.ids]);

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
      artifacts: [],
      lessons: [],
      blocked_on: msg.slice(0, 200),
      task_id: brief.task_id,
      role: brief.role,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
      wall_ms: 0,
      reasked: false,
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
