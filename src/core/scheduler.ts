/**
 * Scheduler: chạy DAG task song song.
 *
 * → docs/SPEC-2026-08-14-agentco.md §7, §9b
 */

import fs from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { CachePrimingGate } from './gate.js';
import { buildWorkerPrompt } from './prompt.js';
import { existsOnDisk, resolveInput, safeJoin } from './paths.js';
import { armDirIndex } from './catalog.js';
import { addUsage, filesOnDisk, runWorker, straysOnDisk, type WorkerHandle } from './worker.js';
import type { LoadedOffice } from './config.js';
import type { KnowledgeStore } from '../knowledge/store.js';
import {
  RunError,
  type AgentEventBody,
  type FailureKind,
  type Plan,
  type Receipt,
  type TaskBrief,
  type Tier,
  type Usage,
} from './types.js';

/** Task không tiêu token nào. Một chỗ định nghĩa, ba receipt dùng chung. */
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUSD: 0,
  model: '',
  turns: 0,
};

export interface SchedulerDeps {
  office: LoadedOffice;
  knowledge: KnowledgeStore;
  emit(event: AgentEventBody): void;
  /** Kiểm tra giữa các task — người dùng bấm Dừng thì thoát sạch. */
  shouldStop?(): boolean;
  /**
   * Nhật ký kiểm toán cánh tay. Vắng ⇒ không ghi (ca test, ca chạy lẻ).
   *
   * ⚠ Tuỳ chọn có chủ ý: mất nhật ký **không được** làm hỏng một ca đang chạy.
   * Cùng luật với `appendChat` — xem `core/audit.ts §append`.
   */
  audit?: { append(call: Record<string, unknown> & { server: string; tool: string; role: string; args: unknown }): void };
}

export interface RunResult {
  receipts: Map<string, Receipt>;
  /** Task chưa chạy vì hết hạn mức / bị dừng. Giữ lại để `agentco resume`. */
  pending: TaskBrief[];
  stoppedBy?: 'usage_limit' | 'user' | 'auth';
  /**
   * Token của những lượt ĐÃ TIÊU nhưng không có receipt nào mang — lượt hỏng vì
   * 429 rồi được chạy lại từ đầu. Không có trường này thì mỗi lần gặp rate limit
   * là một khoản chi vô hình, và đúng ca hay gặp 429 mới là ca người dùng cần
   * nhìn thấy con số. → `RunError.usage`
   */
  wasted: Usage;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Trần số lần chạy tiếp. **1** (user chốt 27/08) — và con số này HIỆN RA.  │
 * │                                                                          │
 * │ Vì sao có trần dù đã đòi "phải có tiến triển": tiến triển có thể **thật   │
 * │ mà rất chậm** (mỗi lượt ghi thêm một dòng), và **tất định KHÔNG có nghĩa │
 * │ là rẻ** — mỗi lần chạy tiếp là một lượt worker ĐẦY ĐỦ, chạy tới tận trần │
 * │ lượt của nó. Trần 3 nghĩa là một việc có thể tốn tới **4×** ngân sách.    │
 * │                                                                          │
 * │ ⚠ VÌ SAO 1 CHỨ KHÔNG PHẢI 3: chưa ai đo một ca dài thật cần mấy vòng.    │
 * │ Chọn 3 là đoán một con số — đúng hình dạng cái trần 2 000 token đã "chặn  │
 * │ ngay cánh tay đầu tiên" (§9b). Khi chưa biết thì **hướng an toàn là       │
 * │ THẤP**, vì hai chiều hỏng không cân nhau:                                │
 * │                                                                          │
 * │   thấp quá → việc hỏng sau 2 lượt, **có câu báo, người dùng thấy ngay**,  │
 * │              và họ nới `max_turns` hoặc chia nhỏ yêu cầu — đường đi tiếp  │
 * │              rõ ràng                                                     │
 * │   cao quá  → đốt tiền **âm thầm** cho một việc sẽ không bao giờ xong      │
 * │                                                                          │
 * │ ⇒ Nâng lên khi có **một ca dài thật đo được**, không nâng theo cảm giác. │
 * │ → [[agentco-safe-default-direction]]                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const MAX_CONTINUE = 1;

/**
 * Việc chạy tiếp = **CÙNG một việc**, thêm đúng một câu dặn.
 *
 * ⚠ KHÔNG nhét số thứ tự hay "bắt đầu từ phần 4" vào đây. Ta không biết nó đã
 * làm tới đâu — và đoán hộ là dựng lại đúng cái lỗi vừa đi sửa (Trợ lý chia
 * *"vị trí 1–3, 4–6"* cho một danh sách nó chưa từng đọc). Chỗ tiếp phải suy từ
 * **thứ đã có trên đĩa**, và thứ duy nhất biết điều đó là chính worker khi nó
 * mở thư mục kết quả của mình.
 */
/**
 * CÓ CHẠY TIẾP KHÔNG — hàm thuần, và nó là hàm thuần **có chủ đích**.
 *
 * Quyết định này nằm trong một `.catch` giữa `run()` thì không test được nếu
 * không dựng cả một văn phòng thật. Mà đây đúng là chỗ **phải** có test: hai
 * hàng rào của nó chặn hai kiểu đốt tiền khác nhau, và cả hai đều im lặng khi
 * hỏng.
 */
export function shouldContinue(p: { kind: FailureKind; tried: number; landed: number }): boolean {
  if (p.kind !== 'max_turns') return false;
  // ① Không có gì mới sinh ra ⇒ chạy tiếp là lặp trên một việc không nhúc nhích.
  if (p.landed <= 0) return false;
  // ② Tiến triển có thể THẬT mà rất chậm. Không trần thì một việc chia sai vẫn
  //    bò tới vô tận, và người trả tiền là khách.
  return p.tried < MAX_CONTINUE;
}

const CAU_TIEP =
  'Việc này đã chạy dở ở lượt trước. Xem những file đã có trong thư mục kết quả của chính việc này, ' +
  'rồi LÀM TIẾP PHẦN CÒN THIẾU — đừng làm lại từ đầu.';

export function continueBrief(brief: TaskBrief): TaskBrief {
  /**
   * ⚠ CỘNG THÊM MỘT LẦN, KHÔNG PHẢI MỖI VÒNG MỘT LẦN. (test bắt được)
   *
   * Vòng thứ hai nối thêm một dòng y hệt là hai chuyện hỏng cùng lúc: bơm
   * prefix của worker lên vô ích, và **ba dòng giống nhau dạy model rằng dòng
   * đó không quan trọng** — đúng cơ chế làm một câu dặn mất tác dụng.
   */
  if (brief.constraints.includes(CAU_TIEP)) return brief;
  return { ...brief, constraints: [...brief.constraints, CAU_TIEP] };
}

export class Scheduler {
  private readonly gate: CachePrimingGate;
  /** Đã chạy tiếp mấy lần, theo `task_id`. → `MAX_CONTINUE` */
  private readonly continued = new Map<string, number>();
  /** AIMD: gặp 429 thì giảm nửa, chạy trơn 10 task thì tăng 1. */
  private concurrency: number;
  private readonly maxConcurrency: number;
  private smoothRun = 0;
  /** Mã kế hoạch của ca đang chạy — chỉ dùng để gắn vào nhật ký kiểm toán. */
  private planId: string | undefined;
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
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ ĐÃ GỠ 22/08: cổng "ghi ra ngoài mà không có shell" — CODE CHẾT.        │
   * │                                                                          │
   * │ Nó kiểm `isAbsolute(o.path)` trên `outputs`. Nhưng `buildPlan` chạy      │
   * │ `outputScoper` lên outputs của MỌI task trước đó (`assistant.ts:591`),   │
   * │ và hàm đó luôn trả `artifacts/<plan>/<task>/…` — không có nhánh nào cho  │
   * │ đường dẫn tuyệt đối. ⇒ điều kiện KHÔNG BAO GIỜ đúng trong sản phẩm.      │
   * │                                                                          │
   * │ 9 test của nó vẫn xanh vì chúng gọi thẳng `validate` với plan tự chế,    │
   * │ **đi vòng qua `buildPlan`**. Chứng minh cơ chế chạy khi gọi trực tiếp,   │
   * │ rồi kết luận nó bảo vệ production — [[agentco-measurement-vs-conclusion]]│
   * │ lần thứ ba trong một phiên.                                              │
   * │                                                                          │
   * │ Và nó còn SAI theo thiết kế mới: biên giới đã chốt là *"văn phòng +      │
   * │ chỗ người dùng gõ ra"*, thi hành ở `officeJail` theo XUẤT XỨ chuỗi.      │
   * │ Ghi ra ngoài khi đó dùng `Write` — **không cần shell**. Một cổng bắt     │
   * │ phải-có-shell-mới-được-ghi là chặn ngược chiều.                          │
   * │ → docs/TEST-WALKTHROUGH.md §Bài 9b                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  static validate(
    plan: Plan,
    knownRoles: ReadonlySet<string>,
    officeDir?: string,
    /** Tên cánh tay → thư mục thật. Thiếu ⇒ "Musics" bị chặn. → `catalog.ts §armDirIndex` */
    armDirs?: Record<string, string>,
  ): string[] {
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
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ HAI LOẠI ĐƯỜNG DẪN, HAI PHÉP KIỂM. (sửa 22/08, ca thật)            │
       * │                                                                    │
       * │ Bản trước chỉ có MỘT phép kiểm — `safeJoin(officeDir, path)` — nên  │
       * │ nó mang sẵn tiền đề *"mọi đầu vào đều nằm trong văn phòng"*. Tiền   │
       * │ đề đó đúng cho tới ngày `Bash` bật sẵn, rồi thành sai.              │
       * │                                                                    │
       * │ Ca đo được: người dùng gõ *"Kiểm kê thư mục D:\Downloads\..."*.     │
       * │ `safeJoin` ném (đúng phận sự của nó), `catch` biến cái ném đó thành │
       * │ `exists = false`, và cả kế hoạch bị chặn với câu **"không có file   │
       * │ đó, và không việc nào tạo ra nó"** — trong khi thư mục nằm đó, và   │
       * │ nhân viên có `Bash` để đọc nó.                                      │
       * │                                                                    │
       * │ Nặng hơn: Trợ lý làm ĐÚNG. `ASSISTANT_CORE` dặn *"a path the human │
       * │ typed is exact — copy it into `inputs` verbatim"*. Nó tuân lệnh và  │
       * │ bị chặn vì tuân lệnh. Lỗi nằm ở tầng kiểm, không ở tầng lập kế      │
       * │ hoạch — và một `catch` nuốt lỗi là chỗ nó ẩn mình.                  │
       * │                                                                    │
       * │ ⚠ Tách theo `isAbsolute`, KHÔNG theo "safeJoin có ném không". Một   │
       * │ đường dẫn TƯƠNG ĐỐI mà leo ra ngoài (`../../etc/passwd`) cũng làm   │
       * │ `safeJoin` ném, nhưng nó là mưu toan traversal chứ không phải một   │
       * │ đường dẫn người dùng gõ — và nếu đem `existsSync` nó thì ta lại đo  │
       * │ theo `cwd` của daemon, một cái gốc chẳng liên quan gì. Nó phải ở    │
       * │ lại nhánh lỗi.                                                     │
       * └────────────────────────────────────────────────────────────────────┘
       */
      if (officeDir) {
        for (const i of t.inputs) {
          const want = norm(i.path);
          // Thư mục mà một task khác đang ghi vào cũng là "sẽ có" — xem `contains`.
          if (produced.has(want) || [...produced].some((p) => contains(want, p))) continue;

          const abs = resolveInput(officeDir, i.path, armDirs);
          if (abs && existsOnDisk(abs)) continue;

          // Hai câu khác nhau vì hai chuyện khác nhau. "Không việc nào tạo ra
          // nó" vô nghĩa với một thư mục trên máy người dùng — nó gợi ý sửa kế
          // hoạch, trong khi thứ cần sửa là đường dẫn họ vừa gõ.
          problems.push(
            isAbsolute(i.path)
              ? `Task ${t.task_id} cần đọc "${i.path}" nhưng không tìm thấy trên máy — kiểm lại đường dẫn`
              : `Task ${t.task_id} cần đọc "${i.path}" nhưng không có file đó, và không việc nào tạo ra nó`,
          );
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
    /**
     * Mã kế hoạch của ca ĐANG chạy — chỉ để gắn vào nhật ký kiểm toán.
     *
     * `TaskBrief` cố ý không mang `plan_id` (nó là đơn vị việc, không phải đơn
     * vị ca), nên worker không biết. Giữ ở đây, nơi BIẾT, thay vì nhét một
     * trường mới vào brief chỉ để chuyển tiếp một chuỗi. → `core/audit.ts`
     */
    this.planId = plan.plan_id;
    const receipts = new Map<string, Receipt>();
    const remaining = new Map(plan.tasks.map((t) => [t.task_id, t]));
    const failed = new Set<string>();
    const running = new Set<Promise<void>>();
    let stoppedBy: RunResult['stoppedBy'];
    let wasted: Usage = ZERO_USAGE;

    while (remaining.size > 0 && !stoppedBy) {
      if (this.deps.shouldStop?.()) {
        stoppedBy = 'user';
        break;
      }

      const ready = [...remaining.values()].filter((t) =>
        t.deps.every((d) => receipts.has(d) || failed.has(d)),
      );

      // Dep chưa giao được hàng thì task con không chạy — nhưng KHÔNG đánh
      // failed âm thầm, trả receipt "blocked" để người dùng thấy vì sao.
      for (const t of ready) {
        const stale = unmetDeps(t, receipts, failed);
        if (stale.length) {
          remaining.delete(t.task_id);
          failed.add(t.task_id);
          const blocked: Receipt = {
            status: 'blocked',
            say: `Không làm được vì bước trước chưa xong.`,
            answer: '',
            /**
             * Receipt do MÃ dựng, không do nhân viên nào chạy ⇒ không có sự kiện
             * nào để neo. `gist` rỗng là câu trả lời đúng, và Trợ lý sẽ rơi về
             * nhánh *"không có dòng KẾT QUẢ"* của nó. Bịa một câu ở đây là đưa
             * cho nó một thứ nghe như dữ kiện mà không ai đo được.
             * → `types.ts §gist`
             */
            gist: '',
            artifacts: [],
            lessons: [],
            blocked_on: reasonFor(stale, receipts),
            task_id: t.task_id,
            role: t.role,
            usage: ZERO_USAGE,
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

        /**
         * ĐẦU VÀO PHẢI CÓ THẬT — KIỂM NGAY TRƯỚC KHI PHÓNG, 0 TOKEN.
         *
         * Đây đúng phép kiểm của `validate`, nhưng chạy ĐÚNG LÚC. `validate`
         * chạy lúc lập kế hoạch, khi file của bước trước còn chưa được sinh ra,
         * nên nó buộc phải bỏ qua mọi đường dẫn "sẽ có". Tới đây thì mọi bước
         * trước đã xong và câu hỏi trở nên trả lời được.
         *
         * Đo được 20/08: thiếu chốt này thì nhân viên nhận một đường dẫn chết và
         * ĐI TÌM — `nguoi-soi` 6 lượt (5 lượt Glob), `nguoi-gop` 9 lượt tool rồi
         * chạm `max_turns`. Cả hai kết luận đúng thứ ta biết miễn phí từ đầu.
         */
        const gone = this.missingInputs(brief);
        if (gone.length) {
          failed.add(brief.task_id);
          receipts.set(brief.task_id, this.blockedReceipt(brief, gone));
          continue;
        }

        // File CÓ trên đĩa nhưng do một task bị cắt ngang ghi ra — nguy hơn hẳn
        // file thiếu, vì mọi phép kiểm "có tồn tại không" đều cho qua và nhân
        // viên đọc được thật. Cái thiếu nằm ngoài file. → `interruptedInputs`
        const halfDone = this.interruptedInputs(brief);
        if (halfDone.length) {
          failed.add(brief.task_id);
          receipts.set(
            brief.task_id,
            this.blockedReceipt(
              brief,
              halfDone,
              'Không làm được vì bước trước bị cắt giữa chừng, kết quả của nó còn thiếu.',
              'ghi dở, chưa đủ để dùng',
            ),
          );
          continue;
        }

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
            /**
             * ┌────────────────────────────────────────────────────────────────┐
             * │ CHẠM TRẦN LƯỢT MÀ ĐANG CÓ TIẾN TRIỂN ⇒ CHẠY TIẾP, KHÔNG BÁO HỎNG│
             * │ (user duyệt 27/08)                                             │
             * │                                                                │
             * │ Ca sinh ra nó: một việc có **N phần**, mà **N chỉ biết được SAU │
             * │ khi việc bắt đầu**. Trợ lý buộc phải đoán N lúc lập kế hoạch ⇒  │
             * │ hoặc đoán thừa (27/08: 3/4 việc rỗng, $0,12 cho ba câu *"danh   │
             * │ sách chỉ có 1 trang"*) hoặc đoán thiếu (một việc cháy trần).    │
             * │ **Hai lỗi là hai đầu của cùng một cây gậy.**                    │
             * │                                                                │
             * │ ⚠ VÌ SAO KHÔNG ĐỂ TRỢ LÝ NGHĨ LẠI: nó phải trả một lượt model   │
             * │ nữa, với ÍT dữ kiện hơn hẳn worker vừa có (nó chỉ thấy một câu  │
             * │ `say`, không thấy 15 lượt kia). Một cơ chế "thử nghĩ cách khác" │
             * │ ở tầng đó là **đoán**, và đoán ở tầng kế hoạch thì đẻ thêm việc.│
             * │ Ở đây thì ngược: **0 token cho quyết định**, và chỗ tiếp đọc từ │
             * │ FILE CÓ THẬT trên đĩa. → [[agentco-deterministic-vs-signal]]    │
             * │                                                                │
             * │ HAI HÀNG RÀO, thiếu cái nào là đẻ ra vòng lặp đốt tiền:         │
             * │   ① phải CÓ TIẾN TRIỂN (`landed` không rỗng) — không có thì     │
             * │      chạy tiếp là lặp vô tận trên một việc không nhúc nhích      │
             * │   ② trần 3 lần, và số đó HIỆN RA cho người dùng                 │
             * └────────────────────────────────────────────────────────────────┘
             */
            {
              const daTiep = this.continued.get(brief.task_id) ?? 0;
              const tienTrien = err instanceof RunError ? (err.observed?.landed.length ?? 0) : 0;
              if (shouldContinue({ kind, tried: daTiep, landed: tienTrien })) {
                this.continued.set(brief.task_id, daTiep + 1);
                // ⚠ GHI SỔ TRƯỚC KHI CHẠY TIẾP — cùng lý do nhánh `rate_limit`:
                // lượt vừa bị cắt đã tiêu token thật, và `max_turns` theo định
                // nghĩa là kiểu hỏng ĐẮT NHẤT (nó chạy tới kịch trần).
                if (err instanceof RunError && err.usage) wasted = addUsage(wasted, err.usage);
                this.deps.emit({
                  type: 'task.progress',
                  task_id: brief.task_id,
                  role: brief.role,
                  say: `Việc dài hơn một lượt — đang chạy tiếp (${daTiep + 1}/${MAX_CONTINUE}).`,
                });
                remaining.set(brief.task_id, continueBrief(brief));
                return;
              }
              // Không tiến triển, hoặc đã tiếp đủ 3 lần ⇒ báo hỏng THẬT, và câu
              // báo của `worker.ts` đã nói ra cả phần *"có thể đã đổi thứ gì ở
              // ngoài"* khi có cánh tay tham gia.
            }
            if (kind === 'rate_limit') {
              this.onRateLimit();
              // ⚠ GHI SỔ TRƯỚC KHI THỬ LẠI. Lượt vừa hỏng đã tiêu token thật;
              // task chạy lại từ đầu và tiêu tiếp. Không ghi ở đây thì mỗi lần
              // gặp 429 là một khoản chi vô hình, và đúng ca hay gặp 429 mới là
              // ca người dùng cần nhìn thấy con số. → `RunError.usage`
              if (err instanceof RunError && err.usage) wasted = addUsage(wasted, err.usage);
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

    const result: RunResult = { receipts, pending: [...remaining.values()], wasted };
    if (stoppedBy) result.stoppedBy = stoppedBy;
    return result;
  }

  /**
   * `inputs` không có trên đĩa. Rỗng = phóng được. → `run()`
   *
   * ⚠ Phải dùng ĐÚNG `resolveInput` mà `validate` dùng. Đây là chốt thứ hai
   * trên cùng một luật, chạy ngay trước lúc phóng worker — hai chốt hiểu
   * "đầu vào hợp lệ" khác nhau thì kế hoạch qua được cửa một rồi chết ở cửa
   * hai, và người dùng nhận một câu từ chối cho thứ hệ thống vừa duyệt.
   */
  private missingInputs(brief: TaskBrief): string[] {
    // ⚠ CÙNG bảng cánh tay mà `validate` dùng. Lệch một chỗ là kế hoạch qua
    // được cửa một rồi chết ở cửa hai — đúng thứ khối chú thích trên cảnh báo.
    const armDirs = armDirIndex(this.deps.office.company.arms, this.deps.office.company.mcpServers);
    const out: string[] = [];
    for (const i of brief.inputs) {
      const abs = resolveInput(this.deps.office.dir, i.path, armDirs);
      if (!abs || !existsOnDisk(abs)) out.push(i.path);
    }
    return out;
  }

  /**
   * `inputs` trỏ vào đầu ra của một task BỊ CẮT GIỮA CHỪNG. → SPEC-offices §6b
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HÀNG RÀO CỨNG. Bảng kê giấu đường dẫn là hàng rào MỀM — model vẫn đoán   │
   * │ ra được, vì `artifacts/<plan>/<task>/…` có quy luật rõ ràng. Và người    │
   * │ dùng có thể dán thẳng một đường dẫn cũ bằng `@`.                          │
   * │                                                                          │
   * │ Chốt này không cần bảng kê, không cần model hợp tác: nó ĐỌC NGƯỢC từ     │
   * │ chính đường dẫn. `artifacts/P-…/T-01/x.md` tự khai ra kế hoạch nào và    │
   * │ task nào, nên tra receipt của task đó là xong. Tất định, 0 token.        │
   * │                                                                          │
   * │ Đo được 21/08, hai lần liên tiếp (hd3 3/5, hd4 4/5): thiếu chốt này thì  │
   * │ cả chuỗi sau chạy trên một hợp đồng thiếu 20–40% và trả về một bản rà    │
   * │ soát trông hoàn hảo.                                                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Chỉ chặn khi receipt NÓI RÕ là chưa giao được hàng. Không có receipt thì
   * KHÔNG chặn: file có thể tới từ một ca quá cũ đã bị dọn khỏi `tasks/`, và
   * chặn một thứ ta không biết gì về nó là biến chốt an toàn thành chốt chặn đường.
   */
  private interruptedInputs(brief: TaskBrief): string[] {
    const out: string[] = [];
    for (const i of brief.inputs) {
      const parts = norm(i.path).split('/');
      // `artifacts/<plan_id>/<task_id>/…` — ngắn hơn thì không trỏ vào đầu ra
      // của task nào cả (tủ tài liệu, file gốc), bỏ qua.
      if (parts[0] !== 'artifacts' || parts.length < 4) continue;
      const receipt = this.receiptOnDisk(parts[1]!, parts[2]!);
      if (receipt && !delivered(receipt)) out.push(i.path);
    }
    return out;
  }

  /**
   * Receipt của một task BẤT KỲ, kể cả của ca khác. Tên file mang cả hai id nên
   * không cần chỉ mục nào — đọc thẳng, `undefined` nếu không có.
   *
   * ⚠ `task_id` đến từ một đường dẫn do model sinh ⇒ phải đi qua `safeJoin`,
   * nếu không nó là một lỗ đọc file tuỳ ý qua tên receipt.
   */
  private receiptOnDisk(planId: string, taskId: string): Receipt | undefined {
    try {
      const dir = this.deps.office.paths.tasks;
      return JSON.parse(
        fs.readFileSync(safeJoin(dir, `${planId}.${taskId}.receipt.json`), 'utf8'),
      ) as Receipt;
    } catch {
      return undefined;
    }
  }

  /** Task không chạy vì đầu vào không dùng được. 0 lượt, $0, và NÓI RA vì sao. */
  private blockedReceipt(
    brief: TaskBrief,
    missing: readonly string[],
    say = 'Không làm được vì thiếu file cần đọc.',
    why = 'không có trên đĩa',
  ): Receipt {
    const blocked: Receipt = {
      status: 'blocked',
      say,
      answer: '',
      // Mã dựng, chưa ai chạy ⇒ không có sự kiện. → `types.ts §gist`
      gist: '',
      artifacts: [],
      lessons: [],
      blocked_on: `${why}: ${missing.join(', ')}`,
      task_id: brief.task_id,
      role: brief.role,
      usage: ZERO_USAGE,
      wall_ms: 0,
      reasked: false,
      landed: [],
      looped: false,
      reads: [],
    };
    this.deps.emit({
      type: 'task.blocked',
      task_id: brief.task_id,
      role: brief.role,
      say: blocked.say,
      reason: blocked.blocked_on ?? '',
    });
    return blocked;
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
          /**
           * MỌI lời gọi MCP xuống nhật ký kiểm toán, kèm tham số. → `core/audit.ts`
           *
           * ⚠ `plan_id` ghép ở ĐÂY, không ở worker: worker chỉ cầm `TaskBrief`,
           * và brief cố ý không mang mã kế hoạch. Ghép ở nơi biết thì không phải
           * thêm một trường chỉ để chuyển tiếp một chuỗi.
           */
          onArmCall: (c) =>
            this.deps.audit?.append({ ...c, ...(this.planId ? { plan_id: this.planId } : {}) }),
          /**
           * Kết quả quá to được bê về ĐÂY — cùng thư mục với file task này làm
           * ra. → `core/spill.ts`
           *
           * ⚠ Ghép ở đây vì cùng một lý do với `plan_id` ngay trên: worker chỉ
           * cầm `TaskBrief`, mà brief cố ý không mang mã kế hoạch. Dựng đường
           * dẫn ở nơi BIẾT thì không phải thêm một trường chỉ để chuyển tiếp.
           */
          ...(this.planId
            ? { outDir: join(office.paths.artifacts, this.planId, brief.task_id) }
            : {}),
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

    /**
     * ĐỌC ĐĨA TRƯỚC KHI NÓI "CHƯA RA KẾT QUẢ". → `RunError.observed`
     *
     * Một lượt hỏng ở lượt thứ N không xoá những gì lượt 1..N-1 đã ghi. Ca
     * `P-260821-1827-m78h` chạm trần chi phí CHÍN GIÂY SAU khi ghi xong bảng
     * kết quả đúng và đủ — bản trước ghi cứng `landed: []` ở đây nên người dùng
     * được mời chạy lại (và trả tiền lại) cho thứ đã nằm sẵn trên đĩa.
     */
    const observed = err instanceof RunError ? err.observed : undefined;
    const promised = brief.outputs.map((o) => o.path);
    const written = observed ? filesOnDisk(this.deps.office.dir, promised, observed.landed) : [];
    const strays = observed ? straysOnDisk(observed.landed) : [];

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ GIAO ĐỦ HÀNG ⇒ KHÔNG PHẢI `failed`. (user chốt 21/08)                │
     * │                                                                      │
     * │ Đo được cùng ngày, ba lượt liền: `m78h` · `i9h2` · `yap2` đều ghi ra │
     * │ file đầy đủ — `i9h2` đúng **56/56 nhóm, không sai một con số** — rồi  │
     * │ chạm trần chi phí SAU đó và bị đóng nhãn "hỏng".                     │
     * │                                                                      │
     * │ Trần dừng lượt gọi; nó không hoá kiếp cái file đã nằm trên đĩa. Lấy   │
     * │ tín hiệu *"đã tiêu hết tiền cho phép"* làm nhãn cho *"việc có xong    │
     * │ không"* là dùng thước của câu hỏi này để đo câu hỏi khác.             │
     * │                                                                      │
     * │ Cái giá thật không phải một chữ xấu xí. Hôm đó hệ thống kêu SAI bốn   │
     * │ lần và im lặng đúng lần cần kêu (`d6v9` sai 45/51 nhóm, nhãn ✅). Một │
     * │ cái chuông sai 80% thì người dùng học cách tắt — rồi lần cháy thật    │
     * │ không ai nghe. Với người non-code đang tin hệ thống, đó là toàn bộ    │
     * │ vốn liếng uy tín của sản phẩm.                                        │
     * │                                                                      │
     * │ ⚠ Ta KHÔNG hứa nội dung đúng — vẫn chỉ khai đúng thứ `existsSync`     │
     * │   biết, y như đường chạy thành công. Không thêm một lời nói dối nào.  │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const deliveredAll = promised.length > 0 && promised.every((p) => written.includes(p));

    // Nói CHUYỆN GÌ XẢY RA + LÀM GÌ TIẾP THEO. "Gặp lỗi" chung chung là vô dụng
    // với người non-code — họ không biết sửa ở đâu.
    const cause =
      kind === 'max_turns'
        ? `Việc này cần nhiều bước hơn mức cho phép của ${brief.role}. Nới số bước tối đa trong trang nhân viên, hoặc chia nhỏ yêu cầu.`
        : kind === 'budget'
          ? `Việc này chạm trần chi phí đã đặt cho ${brief.role}. Nới trần chi phí trong trang nhân viên nếu thấy đáng.`
          : 'Việc này gặp lỗi và không hoàn thành được. Xem nhật ký chi tiết.';

    /**
     * Câu "đã ghi được gì" đứng TRƯỚC câu "vì sao dừng".
     *
     * Người dùng non-code đọc câu đầu rồi quyết định. Chôn *"nhưng file có
     * rồi"* xuống cuối một câu bắt đầu bằng "bị chặn" thì họ đã bấm chạy lại
     * xong mới đọc tới. Thứ tự câu chữ ở đây là một quyết định sản phẩm, không
     * phải cách trình bày.
     */
    const say = deliveredAll
      ? // Giao đủ hàng: báo XONG, và chỉ NHẮC NHẸ về tiền. Đây là ghi chú, không
        // phải cảnh báo — việc đã có kết quả, người dùng không cần làm gì cả.
        `Đã làm xong và ghi ra ${written.length > 1 ? `${written.length} file` : written[0]}. ` +
        (kind === 'budget'
          ? `Chỉ lưu ý nhỏ: việc này tốn hơn mức chi phí bạn đặt cho ${brief.role}, ` +
            `nên nếu còn giao việc tương tự thì cân nhắc nới trần lên một chút.`
          : `Chỉ lưu ý nhỏ: việc này dùng hết số bước tối đa của ${brief.role} — ` +
            `nếu còn giao việc tương tự thì cân nhắc nới lên một chút.`)
      : written.length
        ? `Nhân viên đã ghi được ${written.length} file trước khi dừng: ${written.slice(0, 3).join(', ')}` +
          `${written.length > 3 ? '…' : ''}. Xem thử trước khi quyết chạy lại — có thể đã đủ dùng. ${cause}`
        : cause;

    return {
      // Đủ hàng → `done`. Có nhưng thiếu → `blocked` (dở dang, cần bạn quyết).
      // Trắng tay → `failed`. Ba mức, suy từ đĩa, không suy từ cách vòng lặp chết.
      status: deliveredAll ? 'done' : written.length ? 'blocked' : 'failed',
      say,
      answer: '',
      /**
       * ⚠ RỖNG kể cả khi `deliveredAll` — và đó là chỗ dễ đi sai nhất trong bốn
       * chỗ dựng receipt bằng mã. Ở đây ta biết **file nào đáp xuống**, nhưng
       * không biết **trong file có gì**: vòng lặp chết trước khi nhân viên kịp
       * viết receipt, nên không ai đọc nội dung cả. Suy một câu tóm tắt từ tên
       * file là bịa. `say` ở trên đã nói đúng thứ ta biết. → `types.ts §gist`
       */
      gist: '',
      // File có thật trên đĩa, dù ca này đóng ở `failed`. Khai rỗng là nói dối
      // rằng đĩa sạch — đúng lớp lỗi `stoppedReceipt` đã sửa cho nhánh bị ngắt.
      artifacts: written,
      lessons: [],
      /**
       * ⚠ Giao đủ hàng thì `blocked_on` phải RỖNG, không chỉ `status` đổi.
       *
       * `worthLearning` đọc `!!blocked_on` như một tín hiệu trục trặc độc lập.
       * Đổi mỗi `status` mà để lại câu "chạm trần" ở đây thì cửa hỏi-bài-học
       * vẫn bắn, và ta lại đẻ ra đúng hai node rác đã phải đi dọn. Đây là nửa
       * còn lại của cùng một bản vá — sửa một nhánh xong phải hỏi *"còn nhánh
       * nào cùng hình dạng?"*.
       */
      blocked_on: deliveredAll
        ? null
        : strays.length
          ? `${msg.slice(0, 160)} · ghi ra ngoài văn phòng: ${strays.slice(0, 2).join(', ')}`
          : msg.slice(0, 200),
      task_id: brief.task_id,
      role: brief.role,
      // Kiểu hỏng dưới dạng DỮ LIỆU, để `agentFault()` quyết được "lỗi của ai"
      // mà không phải khớp chuỗi trên câu chữ hiển thị. Giao đủ hàng thì không
      // có kiểu hỏng nào cả — việc đã xong. → `Receipt.failure`
      ...(deliveredAll ? {} : { failure: kind as FailureKind }),
      // Token ĐÃ TIÊU trước khi lỗi nổ, không phải số 0 cho tiện. Bản trước ghi
      // cứng 0 ở đây và đó là chỗ tiền biến mất khỏi sổ — `max_turns` chạy tới
      // kịch trần lượt rồi báo $0. → `RunError.usage`
      usage:
        err instanceof RunError && err.usage
          ? err.usage
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0, model: '', turns: 0 },
      wall_ms: 0,
      reasked: false,
      // Task nổ TRƯỚC khi chạy được gì (`observed` undefined) thì mới rỗng —
      // không quan sát được thao tác nào, nên cũng không được khai là có lặp.
      // Task nổ GIỮA CHỪNG thì mang theo đúng thứ nó đã kịp làm.
      landed: observed?.landed ?? [],
      looped: observed?.looped ?? false,
      reads: observed?.reads ?? [],
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


/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỘT PHỤ THUỘC CHỈ ĐƯỢC COI LÀ XONG KHI NÓ THẬT SỰ GIAO ĐƯỢC HÀNG.        │
 * │                                                                          │
 * │ Bản trước lan truyền theo `failed`, mà `Scheduler.run` chỉ `failed.add`   │
 * │ khi `receipt.status === 'failed'`. Một task trả **`blocked`** thì vào     │
 * │ `receipts` và KHÔNG vào `failed` ⇒ nó được tính là "phụ thuộc đã xong".  │
 * │                                                                          │
 * │ Đo được 20/08, ca `P-260820-2219-5ltb`: T-01 trả `blocked` lúc 22:20:21   │
 * │ (không đọc nổi `.docx`, không sinh file nào) và T-02 phóng lúc **22:20:21 │
 * │ — cùng một giây**. Rồi T-03. Cả hai đi tìm những file mà hệ thống đã biết │
 * │ chắc là không tồn tại. T-02 còn tự chẩn đoán đúng, bằng tiền người dùng:  │
 * │ *"toàn bộ thư mục artifacts đều trống"*.                                  │
 * │                                                                          │
 * │ ⚠ Tách `blocked` ≠ `failed` là ĐÚNG và phải giữ — nhật ký phải phân biệt │
 * │ "hệ thống hỏng" với "đang chờ bạn". Cái sai là dùng `failed` làm TÍN HIỆU │
 * │ LAN TRUYỀN. Tín hiệu đúng quan sát được: **nó có giao được hàng không.**  │
 * │                                                                          │
 * │ Và "giao được hàng" mạnh hơn `status === 'done'`: một task tự nhận xong   │
 * │ mà `outputs` không có gì đáp xuống thì bước sau vẫn đọc vào hư không.     │
 * │ `missingOutputs` bắt ca đó, nhưng nó chạy SAU khi cả DAG xong — quá muộn  │
 * │ cho việc ngăn task con phóng.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Hàm THUẦN, và cố ý: đây là luật đắt nhất trong `run()` mà `run()` thì gọi
 * thẳng `runWorker` nên không bộ test nào chạm tới được. → SESSIONS_MEMORY §4
 */
export function delivered(receipt: Receipt | undefined): boolean {
  if (!receipt || receipt.status !== 'done') return false;
  // Không hứa gì thì không nợ gì. Task `deliver: reply` vẫn phải khai `outputs`
  // theo prompt, nhưng luật này không được sập nếu một ngày nào đó có ngoại lệ.
  if (receipt.artifacts.length === 0 && receipt.landed.length === 0) return true;
  return receipt.landed.length > 0 || receipt.artifacts.length > 0;
}

/** Những `deps` của `t` chưa giao được hàng. Rỗng = phóng được. */
export function unmetDeps(
  t: TaskBrief,
  receipts: ReadonlyMap<string, Receipt>,
  failed: ReadonlySet<string>,
): string[] {
  return t.deps.filter((d) => failed.has(d) || !delivered(receipts.get(d)));
}

/**
 * Câu giải thích, TÁCH HAI Ý. "Bước trước hỏng" và "bước trước không tạo ra file
 * nào" dẫn tới hai việc phải làm khác hẳn nhau — gộp lại thành một câu là bắt
 * người dùng tự đoán mình nên sửa gì.
 */
function reasonFor(stale: readonly string[], receipts: ReadonlyMap<string, Receipt>): string {
  const empty = stale.filter((d) => receipts.get(d)?.status === 'done');
  const broke = stale.filter((d) => !empty.includes(d));
  const parts: string[] = [];
  if (broke.length) parts.push(`bước trước chưa chạy xong: ${broke.join(', ')}`);
  if (empty.length) parts.push(`bước trước không tạo ra file nào: ${empty.join(', ')}`);
  return parts.join(' · ');
}

/** Mọi task ghi một file NẰM TRONG `dir`. Thứ tự giữ nguyên, không trùng. */
function producersInto(producer: ReadonlyMap<string, string>, dir: string): string[] {
  const out: string[] = [];
  for (const [path, task] of producer) {
    if (contains(dir, path) && !out.includes(task)) out.push(task);
  }
  return out;
}
