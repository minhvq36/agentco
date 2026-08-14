/**
 * Runtime của công ty — chỗ mọi thứ gặp nhau.
 * CLI và server đều dùng cùng một object này.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { loadCompany, type LoadedCompany } from './config.js';
import { ensureDirs, resolveCompanyDir, safeJoin } from './paths.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { Master } from './master.js';
import { Scheduler } from './scheduler.js';
import { appendUsage, formatReport, readUsage, summarize, type CostReport } from './usage.js';
import { buildWorkerPrompt } from './prompt.js';
import {
  RunError,
  type AgentEvent,
  type Plan,
  type Receipt,
  type TaskBrief,
  type Usage,
} from './types.js';

export type CompanyState = 'idle' | 'working' | 'paused' | 'stopped';

export interface RunOutcome {
  plan: Plan;
  receipts: Receipt[];
  pending: TaskBrief[];
  report: string;
  usage: Usage;
  stoppedBy?: 'usage_limit' | 'user' | 'auth';
}

export class Company {
  readonly loaded: LoadedCompany;
  readonly knowledge: KnowledgeStore;
  readonly master: Master;
  private readonly bus = new EventEmitter();
  /** Vòng đệm để client kết nối muộn vẫn thấy được chuyện vừa xảy ra. */
  private readonly recent: AgentEvent[] = [];
  private state: CompanyState = 'idle';
  private stopRequested = false;
  private currentPlan: Plan | undefined;

  private constructor(loaded: LoadedCompany) {
    this.loaded = loaded;
    this.knowledge = new KnowledgeStore(loaded.dir, loaded.paths);
    this.knowledge.scan();
    this.master = new Master(loaded);
    this.master.resumeFrom(this.readSessionId());
  }

  static open(dir?: string): Company {
    const resolved = resolveCompanyDir(dir);
    const loaded = loadCompany(resolved);
    ensureDirs(loaded.paths);
    return new Company(loaded);
  }

  // ── sự kiện

  on(fn: (e: AgentEvent) => void): () => void {
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }

  emit(e: AgentEvent): void {
    this.recent.push(e);
    if (this.recent.length > 200) this.recent.shift();
    this.bus.emit('event', e);
  }

  history(): AgentEvent[] {
    return [...this.recent];
  }

  get currentState(): CompanyState {
    return this.state;
  }

  get plan(): Plan | undefined {
    return this.currentPlan;
  }

  /** Dừng việc — daemon vẫn sống. Đây là thứ người dùng muốn 95% số lần. */
  stop(): void {
    this.stopRequested = true;
    this.setState('paused', 'Đã yêu cầu dừng. Đang kết thúc việc đang chạy...');
  }

  // ── chạy một yêu cầu

  async run(request: string): Promise<RunOutcome> {
    if (this.state === 'working') throw new RunError('Công ty đang bận. Đợi xong ca này đã.', 'other');

    this.stopRequested = false;
    this.setState('working', 'Giám đốc đang lập kế hoạch...');
    let usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '' };

    try {
      // 1. Kế hoạch
      const planned = await this.master.plan(request);
      usage = add(usage, planned.usage);
      const plan = planned.value;

      // 2. Chặn DAG hỏng TRƯỚC khi tốn token nào cho worker
      const problems = Scheduler.validate(plan, new Set(this.loaded.roles.keys()));
      if (problems.length) {
        throw new RunError(`Kế hoạch không hợp lệ:\n- ${problems.join('\n- ')}`, 'other');
      }

      this.currentPlan = plan;
      this.savePlan(plan);
      this.emit({ type: 'plan.created', plan_id: plan.plan_id, request, steps: plan.steps });

      // 3. Chạy
      const scheduler = new Scheduler({
        company: this.loaded,
        knowledge: this.knowledge,
        emit: (e) => this.onSchedulerEvent(e, plan),
        shouldStop: () => this.stopRequested,
      });

      const result = await scheduler.run(plan);
      const receipts = [...result.receipts.values()];

      for (const r of receipts) {
        this.saveReceipt(r);
        this.recordUsage(r);
        usage = add(usage, r.usage);
        for (const lesson of r.lessons) {
          this.knowledge.addLesson(r.role, lesson.text, r.task_id);
        }
      }
      if (receipts.some((r) => r.lessons.length > 0)) {
        this.knowledge.scan();
        this.emit({ type: 'knowledge.changed', count: this.knowledge.size, version: this.loaded.knowledgeVersion });
      }

      // 4. Báo cáo
      let report: string;
      if (result.stoppedBy === 'usage_limit') {
        report =
          `Hết lượt dùng Claude. Công ty tạm nghỉ, còn ${result.pending.length} việc chưa làm. ` +
          `Gõ "tiếp tục" khi có lượt lại.`;
        this.setState('paused', report);
      } else if (result.stoppedBy === 'auth') {
        report = 'Chưa đăng nhập Claude Code. Chạy `claude` một lần để đăng nhập rồi thử lại.';
        this.setState('paused', report);
      } else if (result.stoppedBy === 'user') {
        report = `Đã dừng theo yêu cầu. Còn ${result.pending.length} việc chưa làm.`;
        this.setState('paused', report);
      } else {
        const summary = await this.master.report(receipts);
        usage = add(usage, summary.usage);
        report = summary.value;
        this.setState('idle', report);
      }

      this.savePending(result.pending);
      this.saveSessionId();
      this.emit({ type: 'cost.tick', totals: { ...usage, tasks: receipts.length } });
      this.emit({ type: 'master.message', say: report });

      const outcome: RunOutcome = { plan, receipts, pending: result.pending, report, usage };
      if (result.stoppedBy) outcome.stoppedBy = result.stoppedBy;
      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState('idle', 'Gặp lỗi, công ty dừng lại.');
      this.emit({ type: 'master.message', say: msg });
      throw err;
    }
  }

  async chat(message: string): Promise<string> {
    const r = await this.master.chat(message);
    this.saveSessionId();
    this.emit({ type: 'master.message', say: r.value });
    return r.value;
  }

  // ── báo cáo chi phí

  costReport(sinceMs?: number): CostReport {
    return summarize(readUsage(this.loaded.paths, sinceMs));
  }

  costText(sinceMs?: number): string {
    return formatReport(this.costReport(sinceMs));
  }

  /** cacheKey hiện tại của từng vai trò — để chẩn đoán prefix bị phá. */
  cacheKeys(): Array<{ role: string; key: string; staticTokens: number }> {
    return [...this.loaded.roles.values()].map((r) => {
      const built = buildWorkerPrompt(this.loaded, r, {
        hotKnowledge: this.knowledge.hot(r.id, r.hot_knowledge_size, this.loaded.config.budgets.hot_knowledge_tokens).text,
      });
      return { role: r.id, key: built.cacheKey, staticTokens: built.staticTokens };
    });
  }

  // ── nội bộ

  private onSchedulerEvent(e: AgentEvent, plan: Plan): void {
    if (e.type === 'task.started') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) this.markStep(plan, task.step, 'running');
    }
    if (e.type === 'task.done') {
      const task = plan.tasks.find((t) => t.task_id === e.task_id);
      if (task) {
        const siblings = plan.tasks.filter((t) => t.step === task.step);
        const allDone = siblings.every(
          (s) => s.task_id === e.task_id || plan.steps[s.step]?.status === 'done',
        );
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

  private setState(state: CompanyState, say: string): void {
    this.state = state;
    this.emit({ type: 'company.state', state, say });
  }

  private recordUsage(r: Receipt): void {
    const role = this.loaded.roles.get(r.role);
    appendUsage(this.loaded.paths, {
      ts: new Date().toISOString(),
      task_id: r.task_id,
      role: r.role,
      cache_key: role ? buildWorkerPrompt(this.loaded, role).cacheKey : '',
      model: r.usage.model,
      in: r.usage.input,
      cache_read: r.usage.cacheRead,
      cache_write: r.usage.cacheWrite,
      out: r.usage.output,
      cost_usd: r.usage.costUSD,
      wall_ms: r.wall_ms,
      status: r.status,
      reasked: r.reasked,
    });
  }

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

  readPending(): TaskBrief[] {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskBrief[];
    } catch {
      return [];
    }
  }

  private sessionFile(): string {
    return path.join(this.loaded.paths.state, 'master-session.json');
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
    if (!this.master.session) return;
    this.writeJson(this.sessionFile(), { session_id: this.master.session, saved: new Date().toISOString() });
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  }

  /** Đọc artifact có kiểm path traversal — đường dẫn đến từ LLM nên không tin được. */
  readArtifact(rel: string): string | undefined {
    try {
      const abs = safeJoin(this.loaded.dir, rel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
    } catch {
      return undefined;
    }
  }
}

function add(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUSD: a.costUSD + b.costUSD,
    model: a.model || b.model,
  };
}
