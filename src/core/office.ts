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

import { activeOptions, armDirIndex, findArm, folderRoots } from './catalog.js';
import { loadOffice, type LoadedOffice } from './config.js';
import { energySnapshot, energyVersion, refreshEnergy } from './energy.js';
import {
  companyPaths,
  ensureOfficeDirs,
  folderId,
  isSafeId,
  normalizeName,
  resolveInput,
  safeJoin,
  slugId,
} from './paths.js';
import { readOAuth } from './secrets.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { LibraryStore, type DocRecord } from '../library/store.js';
import { docPaths } from '../library/names.js';
import { ArtifactStore, isStale } from './artifacts.js';
import { AuditLog } from './audit.js';
import { loginOpen } from './browser-login.js';
import { LayoutStore, ASSISTANT_NODE, agentNodeId, mcpNodeId, type LayoutNode } from './layout.js';
import { Assistant, learnable, newPlanId, requestOf, type PlanDraft } from './assistant.js';
import {
  helpText,
  parseInput,
  pickReadable,
  type ReadableRef,
  readingNote,
  resolveFileRefs,
  type ParsedInput,
} from './commands.js';
import { Mailbox, mergeUserText } from './mailbox.js';
import { PlanStore, agentHue } from './plans.js';
import { Scheduler, delivered } from './scheduler.js';
import { buildWorkerPrompt, describePrompt, type PromptLayer } from './prompt.js';
import { straysOnDisk } from './worker.js';
import { estimateTokens, truncateToTokens } from './tokens.js';
import {
  RunError,
  TIERS,
  type AgentEvent,
  type AgentEventBody,
  type CompanyConfig,
  EXTERNAL_TOOLS,
  SHELL_TOOL,
  hasShell,
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
  /** Trần chi phí một việc. **`0` = không giới hạn.** → `RoleBudget.max_usd` */
  maxUsd?: number;
  maxTurns?: number;
  /**
   * agent: vai trò này có `Bash` không. → docs/SPEC-tools-approval.md §5
   *
   * Chỉ tool DUY NHẤT đáng đưa lên node, vì nó là tool duy nhất bật/tắt được —
   * và là ranh giới giữa "chỉ chạm được văn phòng" với "chạm được cả máy".
   */
  bash?: boolean;
  /** agent: số ghi chú sổ tay riêng · knowledge: tổng số node */
  count?: number;
  /**
   * mcp: NẤC QUYỀN, và bảng chi tiết vẽ huy hiệu từ đây — **không** từ `label`.
   * Nhãn là của người dùng và đổi tự do; nhét mức quyền vào chuỗi tên thì một
   * cú đổi tên tạo ra được một cái nhãn nói dối về đặc quyền. → §6j
   */
  level?: 'read' | 'add' | 'full';
  /** mcp: số việc đã cấp — để "chỉ đọc" kiểm được bằng mắt, không phải tin nhãn. */
  toolCount?: number;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ HÌNH CỦA NODE CÁNH TAY — gửi từ SERVER, không tra ở giao diện.           │
   * │ (user chốt 28/08: *"đổi cái biểu tượng phích cắm thành … ứng với từng    │
   * │ loại mcp"*)                                                              │
   * │                                                                          │
   * │ `mark` = đường dẫn SVG đơn sắc của hãng, lấy thẳng từ `brand.mark` trong  │
   * │ danh mục. `armKind` = loại, để rơi về hình chung khi hãng không có logo.  │
   * │                                                                          │
   * │ ⚠ Vì sao không để canvas tự tra danh mục: sơ đồ vẽ **trước** khi ai mở    │
   * │ hộp thoại Kết nối, mà danh mục chỉ được tải trong hộp thoại đó. Bắt       │
   * │ canvas đi tải thêm một lượt nữa là mua một khoảnh khắc node **không có    │
   * │ hình** ở mỗi lần mở app. Server đã cầm cả hai dữ kiện — gửi kèm là xong.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  mark?: string;
  /** mcp: `files` · `service` · `custom` — cùng trục phân loại với hộp thoại. */
  armKind?: 'files' | 'service' | 'custom' | 'browser';
  /** Nhãn các ô tick đang bật — panel vẽ chip từ đây. */
  optionLabels?: string[];
  /** Có hồ sơ bền ⇒ panel hiện nút mở cửa sổ đăng nhập. → `browser-login.ts` */
  canLogin?: boolean;
  /**
   * mcp: TÊN TÀI KHOẢN nó nối tới, tra từ kho OAuth chứ không đọc `label`.
   *
   * Node vẽ nó ở dòng phụ — đây là thứ DUY NHẤT trên sơ đồ phân biệt được hai
   * cánh tay cùng hãng khác tài khoản, kể từ khi nhãn thôi ghép tài khoản vào
   * (27/08). Vắng ⇒ không dùng OAuth, hoặc workspace đã bị gỡ ⇒ không vẽ gì.
   */
  via?: string;
  mcp?: string[];
  /**
   * mcp: thư mục cánh tay với tới, nguyên văn như trong `company.yaml`. CHỈ ĐỌC
   * trên giao diện — đổi thư mục là đổi `armHash`, tức một cánh tay khác. Rỗng =
   * không phải cánh tay file (Notion, GitHub…).
   */
  folders?: string[];
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

/**
 * Câu báo "chia việc hỏng" gửi thẳng lên mặt người dùng.
 *
 * `repeats` = số lần DANH SÁCH LỖI Y HỆT vừa lặp lại (0 = lần đầu).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TỪ LẦN THỨ BA, LỜI KHUYÊN MẶC ĐỊNH TRỞ THÀNH MỘT LỜI NÓI DỐI.            │
 * │                                                                          │
 * │ *"Bạn nhắn lại yêu cầu rõ hơn một chút"* là lời khuyên tốt ở lần đầu.     │
 * │ Tới lần thứ ba với cùng một danh sách lỗi thì ta đã có BẰNG CHỨNG rằng    │
 * │ diễn đạt lại không đổi được kết quả — ca 22/08: người dùng gõ lại hai     │
 * │ lần, mỗi lần rõ hơn, và nhận đúng cùng một chuỗi từng byte, vì nguyên     │
 * │ nhân nằm ở hai luật trong prompt ép nhau chứ không ở câu chữ của họ.      │
 * │                                                                          │
 * │ Lặp lại lời khuyên đó là để người dùng tự tiêu thời gian đi tìm một cách  │
 * │ diễn đạt KHÔNG TỒN TẠI. Ta chưa sửa được nguyên nhân, nhưng ta biết chắc  │
 * │ điều này và phải nói ra — rồi chuyển hướng sang thứ họ thật sự làm được.  │
 * │                                                                          │
 * │ ⚠ KHÔNG giấu danh sách lỗi đi ở lần thứ ba. Nó vẫn là thứ duy nhất nói    │
 * │ được chuyện gì đang xảy ra, và người dùng có thể copy nó đi hỏi chỗ khác. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function planProblemsMessage(problems: readonly string[], repeats: number): string {
  const head =
    'Mình chia việc bị lỗi nên chưa chạy được. Chưa nhân viên nào bắt tay vào làm\n' +
    problems.map((p) => `  · ${p}`).join('\n');

  if (repeats < 2) {
    return `${head}\nBạn nhắn lại yêu cầu rõ hơn một chút, hoặc nói cụ thể tên tài liệu cần dùng nhé.`;
  }
  return (
    `${head}\nĐây là lần thứ ${repeats + 1} mình kẹt y hệt, nên gõ lại lần nữa nhiều khả năng ` +
    `cũng vậy — vướng nằm ở chỗ mình chia việc, không nằm ở cách bạn diễn đạt. Thử bỏ bớt một ` +
    `yêu cầu trong câu (nhất là chỗ chỉ định nơi lưu file), hoặc tách ra hai lần nhắn.`
  );
}

export class Office {
  loaded: LoadedOffice;
  readonly knowledge: KnowledgeStore;
  /** Tủ tài liệu — file người dùng đưa vào. → docs/SPEC-library.md */
  readonly library: LibraryStore;
  /** Kết quả — file nhân viên làm ra. → docs/SPEC-artifacts.md */
  readonly artifacts: ArtifactStore;
  /**
   * Nhật ký kiểm toán cánh tay — MỌI lời gọi MCP, kèm tham số.
   * → `core/audit.ts` · docs/SPEC-arms.md §6k
   *
   * Nó là thứ **thay** cho cổng duyệt từng lần (user chốt 25/08), nên nó không
   * phải một tiện ích: bỏ cổng mà log không đủ thì ta vừa bỏ cả hai.
   */
  readonly audit: AuditLog;
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

  /**
   * Dấu vân tay của lần `validate` hỏng gần nhất, và số lần nó lặp lại y nguyên.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CÙNG MỘT CÂU TỪ CHỐI BA LẦN LIÊN TIẾP LÀ HỆ THỐNG ĐANG KHÔNG HỌC ĐƯỢC   │
   * │ GÌ TỪ CHÍNH LỜI TỪ CHỐI CỦA NÓ. (ca thật 22/08, user chạy bài 9b)       │
   * │                                                                          │
   * │ Người dùng gõ lại yêu cầu hai lần, mỗi lần rõ hơn — *"chưa có file đó,   │
   * │ tạo mới mà"*, rồi *"tức là đọc đường dẫn, xong mới ghi vào file đó"* —   │
   * │ và nhận về **đúng cùng một chuỗi, từng byte**. Vì nguyên nhân nằm ở hai  │
   * │ luật trong prompt ép nhau (→ TEST-WALKTHROUGH §Bài 9b), nên KHÔNG cách   │
   * │ diễn đạt lại nào thoát được. Vòng lặp vô hạn theo cấu trúc.              │
   * │                                                                          │
   * │ Ta chưa sửa được nguyên nhân ở đây, nhưng ta biết chắc một điều và phải  │
   * │ nói ra: **gõ lại lần nữa sẽ không giúp gì.** Im lặng lặp lại câu cũ là   │
   * │ để người dùng tự tiêu thời gian đi tìm cách diễn đạt không tồn tại.      │
   * │                                                                          │
   * │ Ở RAM, cùng lý do `planFriction`: nó chỉ có nghĩa trong một mạch hội     │
   * │ thoại liền.                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private lastPlanProblems = '';
  private samePlanProblemsCount = 0;

  private emitFn: (e: AgentEvent) => void = () => {};

  constructor(loaded: LoadedOffice) {
    this.loaded = loaded;
    ensureOfficeDirs(loaded.paths);
    this.knowledge = new KnowledgeStore(loaded.dir, loaded.paths);
    this.knowledge.scan();
    // Bóc tài liệu chạy NGẦM (§10) nên nó phải có đường báo cho giao diện — nếu
    // không thì dòng "đang đọc…" đứng im cho tới lần người dùng bấm mở tủ.
    this.library = new LibraryStore(loaded.paths, () => this.emitLibrary());
    /**
     * Tài liệu kẹt vì THIẾU CÔNG CỤ thì thử lại một lần lúc dựng văn phòng.
     *
     * Khởi động lại daemon là đúng thời điểm nguyên nhân vừa biến mất: người ta
     * chạy `npm install`, nâng phiên bản, rồi `stop`+`start`. Bắt họ tự nhớ đi
     * xoá và thả lại từng file là bắt họ dọn hộ mình. → `retryUnindexed`
     */
    this.library.retryUnindexed();
    this.artifacts = new ArtifactStore(loaded.paths);
    this.audit = new AuditLog(loaded.paths.state);
    this.assistant = new Assistant(loaded);
    const saved = this.readSession();
    this.assistant.resumeFrom(saved.id, saved.reach);
    this.layout = new LayoutStore(loaded);
    this.plans = new PlanStore(loaded.paths);
    /**
     * CHỮA CA ZOMBIE ngay lúc dựng — nợ kỹ thuật #2, trả một phần.
     *
     * Tiến trình vừa khởi động nên KHÔNG có ca nào đang chạy: mọi bản ghi còn
     * mang `planning`/`running` đều là tàn dư của một lần daemon chết giữa
     * chừng. Để nguyên thì nhật ký nói dối vĩnh viễn — nó bảo "đang chạy" cho
     * một việc không ai làm, và người dùng ngồi chờ một thứ đã chết từ lâu.
     *
     * Câu này đi vào `report`, tức là đi thẳng lên mặt người dùng, nên nó phải
     * nói được *chuyện gì xảy ra* + *làm gì tiếp* — tiêu chí "Xử lý lỗi tốt".
     * Và nó KHÔNG đổ lỗi cho hệ thống hay cho người dùng: tắt daemon là việc
     * hạ tầng bình thường (cập nhật, reboot), không phải một sự cố.
     */
    this.plans.healStale(
      'Việc này bị ngắt giữa chừng vì công ty tắt (cập nhật, khởi động lại, hoặc mất điện). ' +
        'Những phần đã xong vẫn còn trong ngăn Kết quả — nhắn lại để mình làm nốt phần còn lại.',
    );
    this.refreshAssistantContext();
  }

  get id(): string {
    return this.loaded.id;
  }

  get name(): string {
    return this.loaded.config.name;
  }

  /** Thư mục thật trên đĩa. Để giao diện mở được nó — xem `openFolder`. */
  get dir(): string {
    return this.loaded.dir;
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

  /**
   * Company gắn bus vào đây. Mọi sự kiện tự động mang `office` và `plan_id`.
   *
   * ⚠ Lời mời chạy tiếp phát Ở ĐÂY, không phải trong constructor — đã dẫm 20/08.
   * Constructor chạy trước khi `PlanStore` được dựng (`resumable()` nổ) VÀ trước
   * khi có bus, nên câu mời rơi vào hư không. Cùng một chỗ sai đẻ ra hai triệu
   * chứng, và triệu chứng thứ hai thì im lặng — đúng loại chỉ lộ ra khi chạy thật.
   */
  bindBus(fn: (e: AgentEvent) => void): void {
    this.emitFn = fn;
    this.offerResume();
    /**
     * Hỏi hạn mức NGAY khi có bus. Người dùng mở app lên là thấy số, không phải
     * chờ tới lượt chạy đầu tiên — mà "còn chạy được nữa không" thường chính là
     * câu họ hỏi TRƯỚC khi giao việc.
     *
     * `force` bỏ tiết lưu: đây là lần đầu, và nó chỉ xảy ra một lần mỗi lần mở.
     * Không `await`: nó tốn ~5 giây và không ai đứng đợi nó. → `core/energy.ts`
     */
    void refreshEnergy(true).then(() => this.emitEnergy());
  }

  emit(e: AgentEventBody & { plan_id?: string | null }): void {
    const planId = e.plan_id !== undefined ? e.plan_id : (this.currentRecord?.plan_id ?? null);
    const full = { ...e, office: this.id, plan_id: planId } as AgentEvent;
    if (planId) this.plans.append(planId, full);
    // Lưới an toàn cuối cùng cho tin RỖNG. Cửa thật nằm ở nơi phát (`reply`),
    // nhưng `emit` là chốt DUY NHẤT mọi sự kiện đi qua — một tin rỗng lọt tới
    // đây là nó sắp nằm lại trên `chat.jsonl` vĩnh viễn. → bug 21/08
    if (full.type === 'master.message' && !String(full.say ?? '').trim()) return;
    if (full.type === 'master.message') this.appendChat(full);
    this.emitEnergy();
    this.emitFn(full);
  }

  /** So `energyVersion()` với lần bắn trước. Chỉ đổi mới bắn. */
  private energySeen = 0;

  /**
   * Hạn mức tài khoản ĐI NHỜ luồng sự kiện đang có, không có bus riêng.
   * → `core/energy.ts`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO KHÔNG DÙNG PUB/SUB — dù đó là phản xạ đầu tiên.                   │
   * │                                                                          │
   * │ `energy.ts` là state ở MODULE (hạn mức thuộc về tài khoản, không thuộc   │
   * │ văn phòng nào), còn `Office` thì sinh ra và mất đi theo thao tác của     │
   * │ người dùng. Cho Office đăng ký listener là tự nhận một bài toán vòng đời │
   * │ — gỡ ở đâu, ai gỡ, và một listener sót lại sẽ bắn vào một SSE đã đóng.   │
   * │                                                                          │
   * │ `emit()` đã là CHỐT DUY NHẤT mọi sự kiện đi qua, và trong lúc chạy thì   │
   * │ nó dày đặc (`plan.step`, `agent.progress`, `cost.tick`). Mà               │
   * │ `rate_limit_event` tới ngay ĐẦU query — tức là ngay trước cả một trận    │
   * │ sự kiện. Đi nhờ ở đây thì độ trễ tính bằng mili-giây, còn số listener    │
   * │ phải quản là 0.                                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Bắn thẳng qua `emitFn`, KHÔNG qua `emit()`: đệ quy là một, và đây không
   * phải chuyện của một kế hoạch nên nó không được nằm trong `plans.append`.
   */
  private emitEnergy(): void {
    if (energyVersion() === this.energySeen) return;
    this.energySeen = energyVersion();
    const energy = energySnapshot();
    if (energy) this.emitFn({ type: 'energy.tick', energy, office: this.id, plan_id: null });
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
  stop(): { dropped: number; cutAssistant: boolean } {
    this.stopRequested = true;
    void this.activeScheduler?.interruptAll();
    /**
     * NGẮT LUÔN LƯỢT CỦA CHÍNH TRỢ LÝ — thứ tư, và nó bị bỏ quên tới 20/08.
     *
     * §11e liệt kê ba thứ (nhân viên · hòm thư · việc hoãn) và cả ba đều đã
     * chạy. Nhưng `route()`/`plan()`/`report()` không nằm trong ba thứ đó, nên
     * gõ `/stop` giữa lúc Trợ lý đang nghĩ thì nó nghĩ nốt và trả lời sau khi
     * màn hình đã nói "đang dừng". Cùng đúng một lớp lỗi mà chính §11e sinh ra
     * để chặn: bấm Dừng xong hệ thống vẫn tự làm tiếp.
     */
    const cutAssistant = this.assistant.abort();
    // Dừng là dừng CẢ HỆ THỐNG: ngắt nhân viên đang chạy, bỏ tin còn trong hòm
    // thư, bỏ việc đang hoãn. Giữ lại bất cứ thứ gì trong số đó nghĩa là người
    // dùng bấm Dừng xong vẫn thấy hệ thống tự làm tiếp — đúng thứ họ vừa bảo đừng.
    const dropped = this.mailbox.clear() + this.deferred.length;
    this.deferred = [];
    if (this.state === 'working') this.setState('paused', 'Đang dừng…');
    this.emitActivity();
    return { dropped, cutAssistant };
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
    // Phần quyết định thì thuần và nằm ở `commands.ts` để bộ test chạm được.
    return resolveFileRefs(text, this.readablePaths());
  }

  /**
   * Mọi đường dẫn người dùng (hoặc Trợ lý) được phép trỏ tới — ĐỌC TỪ ĐĨA ngay
   * lúc gọi, không cache.
   *
   * Đúng một nguồn sự thật cho cả hai cửa: `@đường-dẫn` người dùng gõ, và
   * `paths` của một lượt `lookup`. Hai danh sách riêng cho cùng một câu hỏi thì
   * sẽ lệch nhau vào đúng ngày ai đó thêm một kho thứ ba.
   */
  private readablePaths(): ReadableRef[] {
    /**
     * ⚠ MỖI TÀI LIỆU CÓ HAI CHUỖI, VÀ CẢ HAI ĐỀU PHẢI NHẬN. → `ReadableRef`
     *
     * `ref` = thứ hiện trên giao diện và thứ nút Chép đưa vào ô chat
     * (`library/files/hd1.docx`). `open` = đường nhân viên mở được
     * (`library/text/hd1.docx.txt`). Bỏ `ref` đi thì nút Chép gãy ngay lập tức;
     * bỏ `open` đi thì ta quay lại đúng ca hỏng 20/08.
     *
     * Tài liệu chưa dùng được (`docPaths` không trả `open`) thì KHÔNG có mặt ở
     * đây — `@` vào nó phải nhận câu "không tìm thấy", không phải một đường dẫn
     * chết đi tiếp tới nhân viên.
     */
    const docs: ReadableRef[] = [];
    for (const d of this.library.list()) {
      const { open, original } = docPaths(d.name, d.ext, d.state);
      if (!open) continue;
      docs.push({ ref: `library/files/${d.name}`, open });
      // PDF: bản gốc là một đường hợp lệ theo đúng nghĩa của nó, nêu riêng.
      if (original && original !== open) docs.push({ ref: original, open: original });
    }
    return [...docs, ...this.artifacts.list().map((a) => ({ ref: a.path, open: a.path }))];
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
      // Người dùng bấm Dừng thì `/stop` ĐÃ trả lời rồi. Phát thêm một dòng nữa ở
      // đây là hai tin nói cùng một chuyện — và tin thứ hai trông như một lỗi,
      // trong khi thứ vừa xảy ra chính là thứ họ yêu cầu. → types.ts `stopped`
      if (!(err instanceof RunError && err.kind === 'stopped')) {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: err instanceof Error ? err.message : 'Có lỗi khi xử lý tin nhắn của bạn.',
          plan_id: null,
        });
      }
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

    /**
     * `lookup` — WORKER ẨN đọc tài liệu rồi trả lời thẳng. → `RouteSchema`
     *
     * KHÔNG lập kế hoạch, KHÔNG sinh Plan, KHÔNG đụng `state`: đây không phải
     * một ca làm việc, nó là một câu hỏi có câu trả lời nằm trong file. Sinh một
     * `PlanRecord` cho nó là làm nhật ký công việc đầy những dòng không phải
     * công việc — cùng lý do `intent: 'chat'` không sinh Plan.
     *
     * Chạy TRONG khoá hòm thư (`pump` đang giữ): Trợ lý là MỘT người, và lượt
     * này là lượt của nó. Nhờ thế `/stop` cắt được — `Assistant.run` đặt
     * `inflight` cho mọi lượt, kể cả lượt này.
     */
    if (routed.value.intent === 'lookup') {
      /**
       * `paths` RỖNG = câu hỏi tra cứu chung, không đọc tài liệu nào (24/08).
       *
       * Phải tách nhánh ở ĐÂY chứ không nới `pickReadable`: hàm đó trả lời câu
       * *"những đường dẫn model vừa nêu có thật không"*, và với danh sách rỗng
       * thì câu trả lời đúng là "không có gì để kiểm" — không phải "không tìm
       * thấy file nào". Gộp hai chuyện đó là đẻ ra câu báo lỗi *"Mình không tìm
       * thấy … trong tủ tài liệu"* cho một câu hỏi về thời tiết.
       */
      const asked = routed.value.paths;
      // Đường dẫn do MODEL sinh ⇒ phải đối chiếu với đĩa trước khi ai đọc gì.
      // → commands.ts `pickReadable`
      const { ok, missing } = asked.length
        ? pickReadable(asked, this.readablePaths())
        : { ok: [] as string[], missing: [] as string[] };
      if (asked.length > 0 && ok.length === 0) {
        // Trả lời bằng CODE. Ta đang cầm cả hai cái kho trong tay; hỏi model
        // "file này có thật không" là trả tiền để nhận về một phỏng đoán.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say:
            `Mình không tìm thấy ${missing.map((m) => `"${m}"`).join(', ')} trong tủ tài liệu hay ngăn Kết quả. ` +
            `Bạn kiểm lại tên giúp mình, hoặc dùng nút Chép ở hai ngăn đó để lấy đúng đường dẫn nhé.`,
          plan_id: null,
        });
        return;
      }

      // Dòng "Đang đọc doc-2.md…" — 0 token, và là nửa sự thật còn lại của
      // worker ẩn. `finally` để nó không kẹt trên màn hình khi lượt đọc ném lỗi
      // hoặc bị `/stop` cắt. → `reading`
      this.reading = readingNote(ok);
      this.emitActivity();
      let found: { value: string; usage: Usage };
      try {
        found = await this.assistant.lookup(ok, routed.value.question);
      } finally {
        this.reading = null;
      }
      // Khâu riêng trong sổ chi phí: `lookup` có hình dạng chi phí khác hẳn
      // `route` (prefix tí xíu, nhưng đọc file nên output dài hơn). Gộp vào một
      // khâu thì không thấy khâu nào đang phình. → `logAssistantUsage`
      this.logAssistantUsage('lookup', found.usage);
      this.emit({
        type: 'master.message',
        role: 'assistant',
        say:
          found.value ||
          (asked.length
            ? 'Mình đọc rồi nhưng chưa rút ra được câu trả lời. Bạn hỏi cụ thể hơn một chút, hoặc giao hẳn cho một nhân viên đọc kỹ nhé.'
            : 'Mình tra rồi nhưng chưa ra câu trả lời chắc chắn. Bạn hỏi cụ thể hơn một chút nhé.'),
        plan_id: null,
      });
      // ⚠ Một phần đề nghị của Trợ lý không có thật thì NÓI RA, đừng im. Câu
      // trả lời ở trên dựa trên ít tài liệu hơn nó tưởng, và người dùng là bên
      // duy nhất biết được thiếu file đó có đổi câu trả lời hay không.
      if (missing.length > 0) {
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: `(Mình không tìm thấy ${missing.map((m) => `"${m}"`).join(', ')} nên câu trên chỉ dựa trên ${ok.length} tài liệu còn lại.)`,
          plan_id: null,
        });
      }
      return;
    }

    /**
     * CỬA CỨU HỘ: Trợ lý trả về nguyên một KẾ HOẠCH thay vì một quyết định.
     *
     * → `Assistant.decideRoute`
     *
     * Ta đang cầm một kế hoạch hợp lệ ĐÃ TRẢ TIỀN. Chạy nó thì bỏ luôn được một
     * lượt `plan()` — rẻ hơn ca thường, không phải đắt hơn.
     *
     * ⚠ KHÔNG hạ xuống `intent: 'task'` với chính câu người dùng vừa gõ, dù nghe
     * gọn hơn nhiều: `plan()` chạy ở query ONE-SHOT, **không có trí nhớ hội
     * thoại**. Câu "bất kỳ, random cũng được" đứng một mình thì planner không
     * chia được việc gì cả — ta sẽ trả tiền thêm một lượt để nhận về một ca hỏng.
     * Đúng ca đã đo được 20/08.
     */
    if (routed.value.intent === 'plan') {
      const draft = routed.value.draft;
      if (this.state === 'working') {
        // Bản nháp KHÔNG đi vào hàng đợi cùng câu yêu cầu: tới lượt nó chạy thì
        // danh sách nhân viên trực và các file đầu vào có thể đã khác, mà một kế
        // hoạch đã đóng khung không được kiểm lại lần nữa. Giữ lại phần bền hơn
        // — mô tả việc — rồi lập kế hoạch mới lúc thật sự chạy.
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: 'Mình đang bận một việc rồi. Xong việc này mình làm tiếp việc bạn vừa giao nhé.',
        });
        this.deferred.push({ request: requestOf(draft), at: Date.now() });
        return;
      }
      void this.run(requestOf(draft), draft).catch(() => {
        /* run() đã emit lỗi lên UI rồi */
      });
      return;
    }

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

    // chat, ask, hoặc garbled — trả lời rồi thôi, không tốn một token worker nào.
    // Cả ba mang một câu ĐÃ ĐƯỢC DUYỆT để cho người đọc: hai cửa đầu là lời model
    // nói với người dùng, cửa thứ ba là câu do CODE viết vì lời model không đưa ra
    // được (nguyên văn nằm ở `.state/route-failure.log`). → `Assistant.decideRoute`
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

  /**
   * Đang đọc tài liệu cho một lượt `lookup` — TRẠNG THÁI, không phải thông báo.
   *
   * Cùng khuôn `clearing` và cùng lý do: một việc đang chạy phải đúng chừng nào
   * nó còn chạy, bất kể ai phát `emitActivity()` xen vào. Đặt nó thành một câu
   * có `hold_ms` là tái tạo đúng cái bug "/clear nháy rồi khựng".
   *
   * Đây là nửa sự thật còn lại của worker ẩn: nó cố ý không sinh Plan, nên nếu
   * không có dòng này thì người dùng tưởng Trợ lý tự biết, trong khi vừa có một
   * lượt đọc file thật sự chạy. → commands.ts `readingNote`
   */
  private reading: string | null = null;

  private emitActivity(): void {
    const planning = this.currentRecord?.status === 'planning';
    if (this.reading) {
      this.emit({
        type: 'office.activity',
        assistant: 'thinking',
        workers: this.activeScheduler?.runningCount ?? 0,
        queued: this.mailbox.size,
        jobs: this.deferred.length,
        // ⚠ CỐ Ý KHÔNG kèm `hold_ms` — xem `reading`.
        note: this.reading,
        plan_id: null,
      });
      return;
    }
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
    /**
     * ⚠ `say` RỖNG thì KHÔNG phát sự kiện nào. → bug 21/08
     *
     * Một `master.message` với `say: ''` vẫn đi hết đường: `appendChat` ghi nó
     * vào `chat.jsonl`, SSE đẩy nó ra, và giao diện vẽ một bong bóng chat TRỐNG
     * TRƠN — người dùng thấy một ô rỗng và không có cách nào đoán nó là gì.
     *
     * Ca đẻ ra nó: những lệnh vừa trả lời bằng một câu RIÊNG (`/resume` tự phát
     * câu "chạy tiếp N việc…") vừa phải trả về một `SayOutcome`. Chúng gọi
     * `reply('')` để nói *"tôi nói xong rồi"* — và `reply` cứ thế phát thêm một
     * tin rỗng nữa.
     *
     * Chặn ở ĐÂY chứ không ở tầng vẽ: một tin rỗng lọt xuống `chat.jsonl` là
     * nằm lại trên đĩa vĩnh viễn, và mọi client tương lai (Telegram) lại phải
     * tự nhớ mà lọc. Tầng vẽ có chốt thứ hai, nhưng đó là lưới, không phải cửa.
     */
    const reply = (say: string): SayOutcome => {
      if (say.trim()) {
        this.emit({ type: 'master.message', say, role: 'assistant', plan_id: null });
      }
      return { intent: 'chat', reply: say };
    };

    if (parsed.kind === 'unknown') return reply(helpText(parsed.typed));

    switch (parsed.name) {
      case 'help':
        return reply(helpText());

      case 'stop': {
        /**
         * ⚠ `mailbox.size` LÀ HÀNG ĐỢI, KHÔNG PHẢI "ĐANG BẬN". Bug đã sửa 20/08.
         *
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ Bản trước hỏi `state !== 'working' && mailbox.size === 0 &&      │
         * │ deferred.length === 0` rồi kết luận "đang rảnh". Nhưng lúc Trợ lý │
         * │ đang nghĩ, lô tin đã được `take()` ra khỏi hàng đợi — `size` về 0, │
         * │ `state` vẫn là `idle` (chưa có Plan nào), và cái đang chạy nằm ở  │
         * │ `mailbox.isBusy`, một biến KHÔNG AI HỎI TỚI.                      │
         * │                                                                  │
         * │ Đo được trên máy người dùng, ngay thao tác đầu tiên của phiên:    │
         * │ họ gõ "Chào, giới thiệu về bạn", gõ tiếp `/stop`, nhận về *"Hiện  │
         * │ không có việc nào đang chạy."* — rồi câu trả lời hiện ra ngay sau. │
         * │ Hệ thống vừa nói dối về trạng thái của chính nó.                  │
         * │                                                                  │
         * │ Ba trạng thái, ba biến, phải hỏi cả ba: Plan đang chạy (`state`)  │
         * │ · Trợ lý đang trong một lượt (`isBusy`) · còn việc xếp hàng        │
         * │ (`size`/`deferred`). Nén nhớ (`clearing`) cũng là một lượt model   │
         * │ đang bay, và `/stop` cắt được nó.                                 │
         * └──────────────────────────────────────────────────────────────────┘
         */
        const idle =
          this.state !== 'working' &&
          !this.mailbox.isBusy &&
          !this.clearing &&
          this.mailbox.size === 0 &&
          this.deferred.length === 0;
        if (idle) return reply('Hiện không có việc nào đang chạy.');
        const { dropped, cutAssistant } = this.stop();
        return reply(
          'Đang dừng tất cả.' +
            (cutAssistant ? ' Đã cắt lượt Trợ lý đang chạy.' : '') +
            (dropped ? ` Đã bỏ ${dropped} việc còn trong hàng đợi.` : '') +
            // Cùng lý do với câu ở `finish`: mời `/resume`, đừng mời "nhắn tiếp".
            ' Việc đã xong vẫn giữ nguyên — gõ /resume để mình làm nốt.',
        );
      }

      /**
       * Chạy tiếp ca bị ngắt. 0 lượt model — kế hoạch đã có và đã trả tiền.
       * → `Office.resume` · SPEC-offices.md §6b
       */
      case 'resume': {
        const ready = this.resumable();
        if (!ready) {
          return reply('Không có việc nào đang dở cả. Nhắn cho mình việc mới nhé.');
        }
        if (this.state === 'working') {
          return reply('Văn phòng đang bận. Đợi xong ca này rồi gõ /resume nhé.');
        }
        this.emit({
          type: 'master.message',
          role: 'assistant',
          say: `Chạy tiếp ${ready.left} việc còn dở${ready.request ? ` của "${ready.request}"` : ''}. Mình không chia lại việc — kế hoạch cũ vẫn còn.`,
        });
        // `void`: lệnh trả lời NGAY, ca chạy nền — y như đường `run()` thường.
        void this.resume().catch((err: unknown) => {
          this.emit({
            type: 'master.message',
            role: 'assistant',
            say: err instanceof Error ? err.message : 'Chưa chạy tiếp được.',
          });
        });
        return reply('');
      }

      case 'status': {
        if (!this.currentRecord) {
          const ready = this.resumable();
          if (ready) {
            // Ca dở là TRẠNG THÁI của văn phòng, không phải một thông báo đã
            // trôi qua — nên nó phải trả lời được câu "giờ đang thế nào".
            return reply(
              `Đang rảnh, nhưng còn ${ready.left} việc dở của "${ready.request}". ` +
                `Gõ /resume để làm nốt — mình không chia lại việc nên không tốn thêm lượt nào.`,
            );
          }
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

  /**
   * `draft` — kế hoạch ĐÃ CÓ, khỏi lập lại. → `Assistant.decideRoute` cửa cứu hộ
   *
   * Truyền vào thì bỏ hẳn lượt `plan()`. Mọi chốt sau đó (`linkDeps`, `validate`,
   * đóng khung đường dẫn) chạy y nguyên: một kế hoạch tới từ cửa khác vẫn phải
   * qua đúng những cửa kiểm của kế hoạch bình thường.
   */
  /**
   * `resumePlan` — kế hoạch ĐÃ CÓ, chỉ còn phần chưa chạy. → `resume()`
   *
   * Đi qua ĐÚNG hàm này chứ không phải một bản sao rút gọn: `linkDeps`,
   * `validate`, `missingInputs`, sổ chi phí, báo cáo, `finish` — tất cả đều
   * phải chạy y hệt. Hai bản mã của cùng một phép toán sẽ lệch (luật 19/08), và
   * bản chạy hiếm hơn là bản lệch trước.
   */
  async run(
    request: string,
    draft?: PlanDraft,
    resumePlan?: Plan,
  ): Promise<{ plan_id: string; report: string; usage: Usage }> {
    this.assertLive();
    if (this.state === 'working') {
      throw new RunError('Văn phòng đang bận. Đợi xong ca này đã.', 'other');
    }

    this.stopRequested = false;
    let usage: Usage = emptyUsage();

    // Bản ghi công việc tồn tại TỪ TRƯỚC khi lập kế hoạch: nếu lập kế hoạch
    // fail thì người dùng vẫn phải thấy "đã có một việc, và nó hỏng ở đâu".
    const record: PlanRecord = {
      // DÙNG LẠI id cũ khi chạy tiếp: `artifacts/<plan_id>/` là khung theo ca,
      // nên id mới nghĩa là kết quả mới rơi vào một thư mục khác và phần đã làm
      // xong thành mồ côi — đúng chuyện `resume` sinh ra để tránh.
      plan_id: resumePlan?.plan_id ?? newPlanId(),
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
    // Câu này phải nói ĐÚNG việc đang xảy ra. `/resume` không gọi model lần
    // nào — in "đang lập kế hoạch" ở đó là nói dối đúng chỗ người dùng đang
    // nhìn, và nó chính là thứ làm cả hai chúng tôi đọc nhầm log ca hd3/hd4.
    this.setState(
      'working',
      resumePlan ? 'Đang chạy tiếp việc còn dở...' : 'Trợ lý đang lập kế hoạch...',
    );
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
      // Kế hoạch tới từ cửa cứu hộ thì KHÔNG gọi model lần nữa — nó đã được trả
      // tiền ở lượt `route()` vừa rồi. `usage` cũng đã tính ở đó, nên ở đây là 0.
      // Chạy tiếp thì kế hoạch ĐÃ CÓ và ĐÃ TRẢ TIỀN — không gọi model lần nào.
      // Đây là cả điểm của `resume`: phần đắt nhất của một ca hỏng là những
      // lượt đã tiêu, và làm lại kế hoạch là tiêu thêm cho một thứ đang có sẵn.
      const planned = resumePlan
        ? { value: { kind: 'plan' as const, plan: resumePlan }, usage: emptyUsage() }
        : draft
          ? { value: this.assistant.adopt(draft, request, record.plan_id), usage: emptyUsage() }
          : await this.mailbox
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

      // ⚠ Truyền bảng cánh tay: thiếu nó thì `inputs: ["Musics"]` bị chặn dù
      // nhân viên có cánh tay tên Musics trỏ thẳng vào thư mục đó. → `resolveInput`
      const problems = Scheduler.validate(
        plan,
        onDuty,
        this.loaded.dir,
        armDirIndex(this.loaded.company.arms, this.loaded.company.mcpServers),
      );
      if (problems.length) {
        // Kế hoạch có ra, nhưng không chạy được — với người dùng thì vẫn là một
        // lượt phải nói lại. Tính là ma sát. → `planFriction`
        this.planFriction++;
        /**
         * Câu này đi thẳng lên mặt người dùng, nên nó phải nói được VIỆC PHẢI
         * LÀM — tiêu chí "Xử lý lỗi tốt". Bản trước in nguyên văn danh sách kỹ
         * thuật ("Task T-02: phụ thuộc T-05 không tồn tại") cho một người mở
         * tiệm hoa đọc.
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ VÀ NÓ KHÔNG ĐƯỢC NÓI "CHƯA TỐN TIỀN" (sửa 20/08, user bắt được).  │
         * │                                                                    │
         * │ Bản trước ghi *"chưa tốn tiền cho việc nào cả"*. Người dùng mở sổ   │
         * │ chi phí ngay sau đó và thấy có tiền — vì lượt `route()` và lượt     │
         * │ `plan()` vừa chạy xong đều đã ghi vào sổ. Câu an ủi đó là một câu   │
         * │ nói dối, và nó nói dối đúng ở chỗ người dùng kiểm được dễ nhất.     │
         * │                                                                    │
         * │ Thứ ta biết chắc và nói được: KHÔNG nhân viên nào chạy — mà nhân   │
         * │ viên mới là phần đắt (một lượt worker sàn ~13 200 token, so với     │
         * │ một lượt Trợ lý). Nói đúng phần đó, và chỉ thẳng sang sổ chi phí    │
         * │ cho phần còn lại, thay vì gắn một con số vào đây: ở nhánh cửa cứu   │
         * │ hộ, `usage` tại điểm này bằng 0 trong khi lượt `route()` đã tính    │
         * │ tiền — in số ra là đẻ ra một câu nói dối thứ hai.                   │
         * │ → SESSIONS_MEMORY §2 "Sổ chi phí không được nói sai câu nào"        │
         * └────────────────────────────────────────────────────────────────────┘
         */
        const fingerprint = problems.join('\n');
        this.samePlanProblemsCount =
          fingerprint === this.lastPlanProblems ? this.samePlanProblemsCount + 1 : 0;
        this.lastPlanProblems = fingerprint;

        throw new RunError(planProblemsMessage(problems, this.samePlanProblemsCount), 'other');
      }

      // Qua được cửa `validate` thì mạch kẹt đã đứt — xem `samePlanProblemsCount`.
      this.lastPlanProblems = '';
      this.samePlanProblemsCount = 0;

      this.currentPlan = plan;
      record.steps = plan.steps;
      record.tasks_total = plan.tasks.length;
      record.status = 'running';
      this.plans.upsert(record);
      this.emitActivity();

      /**
       * ⚠ BỐN VIỆC DƯỚI ĐÂY CHỈ DÀNH CHO MỘT LƯỢT LẬP KẾ HOẠCH THẬT.
       *
       * Sửa 21/08, sau khi `/resume` đi nhờ `run()` và kéo theo cả bốn:
       *
       *  · `savePlan` **GHI ĐÈ** `<plan_id>.plan.json` bằng kế hoạch RÚT GỌN.
       *    Bản gốc 3 task biến mất khỏi đĩa — mất bản ghi pháp y, và đó là thứ
       *    duy nhất trả lời được câu "ca này ban đầu định làm gì". Cùng lớp với
       *    lỗi `plan_id` đôi 19/08.
       *  · `plan.created` lần hai trong cùng một file log → nhật ký hiện *"lập
       *    kế hoạch 3 bước"* cho một lượt KHÔNG gọi model lần nào.
       *  · Câu *"Mình chia thành 3 việc: 1. Tách hợp đồng…"* đọc to cả cái bước
       *    nó sẽ KHÔNG làm — người dùng không có cách nào biết đây là chạy tiếp.
       *
       * `resume()` tự phát câu của nó (*"Chạy tiếp N việc còn dở…"*) ở tầng
       * lệnh, nên ở đây im lặng là đúng, không phải là thiếu.
       */
      if (!resumePlan) {
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
      }

      // 3. Chạy
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ CỬA SỔ ĐĂNG NHẬP ĐANG MỞ ⇒ KHÔNG PHÓNG VIỆC. → `browser-login.ts`   │
       * │                                                                      │
       * │ Chromium **khoá** `user-data-dir`. Cửa sổ đăng nhập đang giữ hồ sơ mà │
       * │ worker phóng lên thì Playwright đâm vào hồ sơ bị khoá ⇒ **MCP chết    │
       * │ lúc spawn** ⇒ nhân viên mất tool và trả lời bằng persona của nó. Đó   │
       * │ đúng là ca hỏng im lặng đã tốn của user $0,03 và một buổi đi tìm.     │
       * │                                                                      │
       * │ ⚠ Chặn ở ĐÂY, không ở `pickMcp`: ở đó thì kế hoạch đã lập, tiền lập  │
       * │ kế hoạch đã trả, và câu từ chối đến sau khi người dùng đã chờ. Chặn    │
       * │ trước khi phóng là chặn **trước khi tiêu tiền**.                       │
       * │                                                                      │
       * │ Khoá tự lành: người dùng đóng cửa sổ ⇒ `exit` gỡ khoá. Nên câu này    │
       * │ nói **việc phải làm**, không nói "thử lại sau".                        │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      if (loginOpen(this.id)) {
        throw new RunError(
          'Cửa sổ đăng nhập của văn phòng này đang mở, nên nhân viên chưa dùng được trình duyệt. ' +
            'Đóng cửa sổ đó rồi giao việc lại.',
          'other',
        );
      }
      const scheduler = new Scheduler({
        office: this.loaded,
        knowledge: this.knowledge,
        emit: (e) => this.onSchedulerEvent(e, plan, record),
        shouldStop: () => this.stopRequested,
        audit: this.audit,
      });
      this.activeScheduler = scheduler;

      const result = await scheduler.run(plan);
      // Dọn sau MỘT CA, không phải sau mỗi lời gọi: đọc-ghi cả file cho từng
      // dòng biến một `appendFileSync` thành O(n²). → `audit.ts §trim`
      this.audit.trim();
      const receipts = [...result.receipts.values()];

      /**
       * Bản văn tài liệu, đọc ĐÚNG MỘT LẦN cho cả ca — dùng để chặn bài học chỉ
       * là bản chép lại một tài liệu (`echoesLibrary`).
       *
       * Chỉ đọc khi thật sự có bài học để kiểm. Phần lớn ca không có: chốt
       * `worthLearning` đã cắt nhánh Trợ lý, còn nhân viên thì thường trả về
       * `lessons: []`.
       */
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ 🔴 CẢNH BÁO CẤP CA PHẢI TÍNH **TRƯỚC** HAI CỬA BÀI HỌC. (user 29/08) │
       * │ > *"nếu 1 công việc còn warning có nghĩa là còn leak, không thể coi   │
       * │ >  đó là kinh nghiệm được"*                                          │
       * │                                                                      │
       * │ `missingOutputs` vốn được tính ở tít dưới, SAU cả vòng ghi bài học    │
       * │ của nhân viên VÀ sau lượt `report()` đã hỏi Trợ lý học được gì. Nên   │
       * │ nó nói được với NGƯỜI DÙNG mà chưa bao giờ chặn được một node nào —   │
       * │ đúng lớp lỗi *"luật đứng sau thứ nó quản"*.                          │
       * │ → [[agentco-rule-must-see-what-it-governs]]                           │
       * │                                                                      │
       * │ Dời lên đây: cùng một phép tính, cùng một kết quả, chỉ khác chỗ đứng. │
       * │ Đọc đĩa an toàn ở điểm này — `scheduler.run()` đã xong ở dòng trên.   │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const gone = this.missingOutputs(plan, receipts);
      const leaked = gone.length > 0 || (plan.redirected?.length ?? 0) > 0;

      const anyLesson = receipts.some((r) => r.lessons.length > 0 && learnable(r) && !leaked);
      let docTexts: string[] | undefined = anyLesson ? this.library.texts() : undefined;

      for (const r of receipts) {
        this.saveReceipt(plan.plan_id, r);
        this.recordUsage(r);
        usage = addUsage(usage, r.usage);
        /**
         * ┌────────────────────────────────────────────────────────────────┐
         * │ 🔴 CỬA THỨ HAI CỦA CÙNG MỘT LUẬT. → `assistant.ts §learnable`  │
         * │                                                                │
         * │ `worthLearning` gác cửa Trợ lý. Nhân viên thì KHÔNG đi qua cửa  │
         * │ đó — nó tự khai `lessons` trong biên nhận, và trước 29/08 thứ   │
         * │ duy nhất chặn là `rejectLesson` (trùng · chép tài liệu · con    │
         * │ số). Nên vá một cửa là để hở cửa kia, cùng lớp lỗi              │
         * │ [[agentco-finish-completely]] đã dẫm ba lần.                    │
         * │                                                                │
         * │ Ca thật của cửa NÀY, đo 29/08 — bài học của chính vai trò       │
         * │ `nguoi-soi-thu-muc`, sinh ra từ một ca không xong:              │
         * │   *"Trước khi gọi browser_navigate … nếu bị từ chối quyền,      │
         * │    dừng lại và báo blocked ngay thay vì thử lại"*               │
         * │ Nó nằm trong 10 mẩu đã làm cánh tay trình duyệt ngừng chạy.     │
         * │                                                                │
         * │ ⚠ Cổng đặt ở ĐÂY chứ không ở `addLesson`: `addLesson` chỉ nhận  │
         * │ được `text`, nó không nhìn thấy `status` của ca đã đẻ ra text    │
         * │ đó — luật phải đứng ở chỗ nhìn thấy thứ nó quản.                │
         * │ → [[agentco-rule-must-see-what-it-governs]]                     │
         * └────────────────────────────────────────────────────────────────┘
         */
        // ⚠ Bọc vòng lặp chứ KHÔNG `continue`: dưới đây còn chỗ cho việc khác
        // của mỗi receipt, và một `continue` sẽ lặng lẽ nuốt luôn việc ấy.
        if (learnable(r) && !leaked) {
          for (const lesson of r.lessons) {
            // `r.reads` = tài liệu tủ mà CHÍNH nhân viên này đã mở trong ca. Bài
            // học của nó sống chết theo đúng những file đó — thực thể yếu.
            this.knowledge.addLesson(r.role, lesson.text, r.task_id, docTexts ?? [], r.reads);
          }
        }
      }

      // 4. Báo cáo
      let report: string;
      let status: PlanStatus;
      if (result.stoppedBy === 'usage_limit') {
        report =
          `Hết lượt dùng Claude. Văn phòng tạm nghỉ, còn ${result.pending.length} việc chưa làm. ` +
          `Gõ /resume khi có lượt lại.`;
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
          /**
           * ⚠ MỜI ĐÚNG CON ĐƯỜNG ĐÃ ĐƯỢC BẢO VỆ. → SPEC-offices.md §6b
           *
           * Bản trước mời *"Nhắn tiếp để mình làm phần còn lại"* — tức là đẩy
           * người dùng vào đường LẬP KẾ HOẠCH LẠI, nơi planner nhìn bảng kê và
           * có thể nhặt một file dở dang làm đầu vào. `/resume` thì đi qua
           * `delivered()`: task nào chưa giao được hàng thì CHẠY LẠI.
           *
           * Một câu chữ, và nó đổi hẳn xác suất người dùng rơi vào cửa nào —
           * rẻ hơn mọi hàng rào kỹ thuật dựng ở phía sau.
           */
          `\nGõ /resume để mình làm nốt — việc nào đã xong trọn thì giữ nguyên, ` +
          `việc bị cắt giữa chừng sẽ làm lại cho đủ.`;
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
          this.assistant.report(plan.steps, receipts, friction, leaked),
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
        // `gone` đã tính ở trên — nó phải chạy TRƯỚC hai cửa bài học, xem chỗ
        // dựng `leaked`. Ở đây chỉ còn việc nói ra cho người dùng.
        if (gone.length) {
          status = 'failed';
          /**
           * HAI CA KHÁC HẲN NHAU, VÀ BẢN TRƯỚC GỘP LÀM MỘT.
           *
           *  · không có gì trên đĩa      → làm lại là đúng
           *  · CÓ, nhưng nằm sai chỗ     → làm lại là bắt trả tiền lần hai cho
           *                                thứ đã có, và bỏ lại một file lạc
           *
           * Ca hai đã xảy ra thật (`P-260821-1818-yydi`) và bản trước nói câu
           * của ca một. Ta QUAN SÁT ĐƯỢC sự khác biệt qua `landed.outside` —
           * không nói ra là tự nguyện mù.
           */
          const strays = strayFilesOf(receipts);
          report += strays.length
            ? `\n\n⚠ Kết quả đã được ghi nhưng nằm ngoài văn phòng nên panel Kết quả không thấy: ` +
              `${strays.slice(0, 2).join(', ')}${strays.length > 2 ? '…' : ''}. ` +
              `File có thật và dùng được — bạn xem thử rồi bảo mình chép về đúng chỗ, ` +
              `không cần chạy lại từ đầu.`
            : `\n\n⚠ Có ${gone.length} file lẽ ra phải được ghi mà không thấy trên đĩa: ` +
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
       * Đồng bộ ngoài nhánh trên, và đó là chỗ bản nháp đầu suýt sai.
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
      this.savePending(record.plan_id, result.pending);
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
      this.finish(record, status, report, usage, receipts.length, shown, plan.redirected ?? []);
      return { plan_id: record.plan_id, report, usage };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      /**
       * NGƯỜI DÙNG BẤM DỪNG KHÔNG PHẢI MỘT CA HỎNG. → types.ts `stopped`
       *
       * Ca thật: `/stop` giữa lúc Trợ lý đang lập kế hoạch. Lượt đó bị ngắt và
       * ném ra, rồi rơi vào đây — bản trước đóng bản ghi ở `failed` với nguyên
       * văn câu lỗi làm báo cáo. Nhật ký công việc ghi "hệ thống làm sai" cho
       * đúng một việc người dùng tự bảo đừng làm nữa.
       *
       * Và nó KHÔNG phát thêm tin nào: `/stop` đã trả lời rồi (§11e). `finish`
       * bỏ qua `report` rỗng, nên chỉ còn `plan.finished` đóng sổ cho UI.
       */
      if (err instanceof RunError && err.kind === 'stopped') {
        this.finish(record, 'stopped', '', usage, 0);
        return { plan_id: record.plan_id, report: '', usage };
      }
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
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ HAI CHỖ SAI TRONG MỘT DÒNG, cùng sửa 24/08.                          │
       * │                                                                      │
       * │ ① Nó in cái BĂM (`a385afc3ab6`). Người dùng đặt tên cánh tay ở hộp   │
       * │   thoại và không bao giờ gặp lại cái tên đó. Nhãn nằm sẵn ở          │
       * │   `company.arms[id].label` — ta đang cầm mà không nói ra.            │
       * │                                                                      │
       * │ ② Câu cũ *"Đã ghi ra ngoài qua: …"* KHAI NHIỀU HƠN THỨ TA KIỂM.      │
       * │   `landingOf` ghi nhận một lời GỌI TOOL, không ghi nhận kết quả —    │
       * │   và 10/14 tool của cánh tay filesystem là CHỈ ĐỌC. Ca có thật, đo   │
       * │   được: `P-260824-0355-r3qe` bị deny cả ba lần, không một byte nào   │
       * │   được ghi, và báo cáo vẫn nói *"Đã ghi ra ngoài qua: a385afc3ab6"*. │
       * │                                                                      │
       * │ Câu mới nói ĐÚNG thứ quan sát được — *đã dùng cánh tay này* — rồi    │
       * │ khoanh vùng phần bất định thành một câu riêng. Cùng luật với          │
       * │ `kind: 'command'` của `Bash`: khai điều mình biết, dán nhãn phần     │
       * │ mình không biết, không gộp hai thứ vào một câu khẳng định.           │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      const named = [...servers].map((id) => this.loaded.company.arms[id]?.label || id).sort();
      lines.push(`Có dùng kết nối: ${named.join(', ')}`);
      lines.push('(kết quả của kết nối có thể nằm ngoài thư mục văn phòng)');
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
    /** Đường dẫn ngoài văn phòng mà `outputScoper` đã kéo về khung. → `Plan.redirected` */
    redirected: readonly string[] = [],
  ): void {
    /**
     * ⚠ BÁO CÁO KHÔNG ĐƯỢC MÂU THUẪN VỚI DẢI BƯỚC NGAY BÊN CẠNH NÓ. → §B
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ User bắt được 21/08, và cái họ chỉ ra là một MÂU THUẪN, không phải  │
     * │ một thông tin thiếu:                                               │
     * │                                                                    │
     * │   1. ○ Tách hợp đồng thành từng điều khoản                          │
     * │   2. ✓ …            ← rồi Trợ lý nói "Xong hợp đồng 4 rồi!"        │
     * │                                                                    │
     * │ Thông tin ĐÃ có mặt trên màn hình — dải bước nói đúng. Nhưng hai    │
     * │ bề mặt nói ngược nhau thì tệ hơn cả việc thiếu một trong hai: người │
     * │ dùng không biết tin cái nào, và cái sai thì lại là cái viết bằng    │
     * │ tiếng người nên dễ tin hơn.                                        │
     * │                                                                    │
     * │ Cùng họ với "chưa tốn tiền" (20/08) và "xuất sang PDF giúp mình"    │
     * │ (20/08): model khẳng định một điều mà dữ liệu TRONG TAY TA bác bỏ   │
     * │ được. Ba lần trong hai ngày ⇒ không phải xui, là một lớp lỗi.       │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * Dựng bằng CODE từ `record.steps`: 0 token, không phụ thuộc model, và
     * không có cách nào để nó "quên" như một câu dặn trong prompt.
     *
     * Chỉ nối khi ca tự nhận là XONG. Ca `stopped`/`failed` đã tự nói ra rồi —
     * thêm một dòng nữa là lải nhải đúng lúc người dùng đang bực.
     */
    const undone = record.steps.filter((s) => s.status !== 'done');
    if (status === 'done' && undone.length > 0 && report.trim()) {
      report +=
        `\n\n⚠ Còn ${undone.length}/${record.steps.length} bước chưa xong: ` +
        undone.map((s) => `"${s.title}"`).join(', ') +
        `. Kết quả ở trên chỉ tính phần đã làm.`;
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ NGƯỜI DÙNG XIN MỘT CHỖ ngoài VĂN PHÒNG — NÓI RA, VÀ CHỈ LỐI ĐI.    │
     * │                                                                    │
     * │ Ca 24/08 (`P-260824-0401-q7ma`): họ bảo chép file vào              │
     * │ `D:\Downloads\Programs Installation\`. `outputScoper` kéo đích về    │
     * │ `artifacts/` (đúng thiết kế), Trợ lý nhìn ra sự lệch đó và tự viết:  │
     * │                                                                    │
     * │   *"…nếu cần mình sẽ thử ghi lại đúng vị trí đó."*                  │
     * │                                                                    │
     * │ Thử lại bao nhiêu lần cũng vào `artifacts/`: `outputScoper` chạy    │
     * │ TRƯỚC khi nhân viên được phóng. Đó là một lời mời vào vòng lặp      │
     * │ không có lối ra, và mỗi vòng đều tính tiền.                         │
     * │                                                                    │
     * │ Dòng dưới dựng bằng CODE từ chính chuỗi `outputScoper` vừa viết     │
     * │ lại — 0 token, model không "quên" được, và nó nói ra ĐƯỜNG ĐI CÓ    │
     * │ THẬT thay vì một lời hứa: cắm một kết nối trỏ vào thư mục đó.       │
     * │ Đó chính là luật §8·0 nói bằng tiếng người — *mọi đường ra phải là  │
     * │ một năng lực CÓ TÊN* — và từ 24/08 nó chạy được thật (SPEC-arms     │
     * │ §5i, ca B).                                                        │
     * │                                                                    │
     * │ ⚠ KHÔNG dán vào ca `stopped`: người vừa bấm Dừng không cần một bài  │
     * │ giảng về chỗ để file.                                              │
     * └────────────────────────────────────────────────────────────────────┘
     */
    if (redirected.length && status !== 'stopped' && report.trim()) {
      const shownPaths = [...new Set(redirected)].slice(0, 3);
      report +=
        `\n\nBạn có nhắc tới ${shownPaths.map((p) => `"${p}"`).join(', ')}. ` +
        `Kế hoạch luôn đặt kết quả trong thư mục văn phòng, nên file nằm ở đường dẫn ghi bên dưới. ` +
        `Muốn nó nằm thẳng ngoài đó, cắm một kết nối "File trên máy" trỏ vào thư mục ấy rồi giao ` +
        `cho nhân viên — đó là đường duy nhất ghi ra ngoài mà vẫn vào được nhật ký.`;
    }

    const where = this.whereBlock(receipts);
    report += where.text;
    record.status = status;
    record.ended_at = new Date().toISOString();
    record.report = report;
    record.costUSD = usage.costUSD;
    record.turns = usage.turns;
    this.plans.upsert(record);

    this.emit({ type: 'cost.tick', totals: { ...usage, tasks } });
    /**
     * Kế hoạch vừa xong là lúc DUY NHẤT con số hạn mức thật sự nhảy — hỏi lại ở
     * đây, đừng hẹn giờ. Polling khi không có gì chạy là mở một tiến trình CLI
     * mỗi phút để nghe cùng một câu trả lời.
     *
     * Không `await`: người dùng đang đọc báo cáo, không đứng đợi cái ô ở header.
     * `refreshEnergy` tự tiết lưu 60 giây nên ba kế hoạch ngắn liên tiếp cũng
     * chỉ mở một tiến trình. → `core/energy.ts`
     */
    void refreshEnergy().then(() => this.emitEnergy());
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

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ TÊN TÀI KHOẢN CHO NODE CÁNH TAY — đọc kho OAuth **LƯỜI, một lần**.   │
     * │                                                                      │
     * │ ⚠ ĐÍNH CHÍNH 27/08. `describeNode` từng ghi *"KHÔNG tra tên workspace │
     * │ ở đây … vì nhãn mặc định của cánh tay OAuth ĐÃ kèm tên workspace"*.   │
     * │ Lý lẽ đó chết cùng ngày: nhãn thôi ghép tài khoản, vì nó đóng băng ở  │
     * │ tài khoản đầu tiên và nói dối sau lần đổi thứ hai. → `ArmDialog.tsx`  │
     * │                                                                      │
     * │ Nỗi lo cũ vẫn đúng và vẫn được tôn trọng: `canvas()` chạy mỗi sự kiện │
     * │ SSE, nên **một lần đọc cho mỗi node** thì đắt thật. Cách ở đây:       │
     * │  · lười — văn phòng không có cánh tay OAuth nào ⇒ **không chạm đĩa**; │
     * │  · một lần cho cả sơ đồ — đúng khuôn `Company.listArms`.              │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    let oauth: ReturnType<typeof readOAuth> | null = null;
    const viaOf = (server: string): string | undefined => {
      const names = this.loaded.company.arms[server]?.secrets ?? [];
      if (!names.length) return undefined;
      oauth ??= readOAuth(companyPaths(this.loaded.companyDir));
      // Vắng ⇒ không dùng OAuth, hoặc workspace đã bị gỡ. Cả hai đều là "không
      // biết" ⇒ không vẽ gì, chứ không bịa một cái tên. (cùng luật §armWorkspace)
      return names.map((s) => oauth?.[s]?.label).find(Boolean);
    };

    return {
      nodes: layout.nodes.map((n) => ({
        ...this.describeNode(n, missing.has(n.id), connected.has(n.id), notes, viaOf),
        // Khoá sắp xếp bãi đỗ — tính ở MỘT chỗ (`layout.ts §armGroup`) rồi gửi
        // kèm, để nút "Sắp xếp lại" ở trình duyệt xếp y hệt server. Tính lại ở
        // giao diện là dựng bản mã thứ hai của cùng một luật phân loại.
        ...this.layout.armGroup(n),
      })),
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
   * BỎ HẲN một cánh tay khỏi văn phòng này: xoá `mcp:` khỏi mọi vai trò và khỏi
   * Trợ lý. Dùng khi cánh tay bị xoá ở cấp công ty.
   *
   * ⚠ Phải chạy CẢ KHI server đã biến mất khỏi `company.yaml` — nếu không thì
   * một vai trò còn khai `mcp: [x]` sẽ giữ node mồ côi trên sơ đồ mãi mãi, và
   * người dùng bấm "Xoá hẳn" lần nữa chỉ nhận về *"không có cánh tay x"*. Đó
   * đúng ca user báo 23/08: nút xoá báo lỗi, node không biến mất.
   *
   * Trả `true` nếu có gì đó thật sự đổi — caller dùng để quyết có phát sự kiện.
   */
  dropArm(server: string): boolean {
    let touched = false;
    // Bỏ SỰ CÓ MẶT trước: thiếu bước này thì node vẫn nằm trên sơ đồ dù không
    // còn sợi dây nào — đúng cái node ma đã mất một vòng mới bắt được.
    if (this.loaded.config.arms.includes(server)) {
      this.writeYamlList(
        this.loaded.paths.configFile,
        ['arms'],
        this.loaded.config.arms.filter((s) => s !== server),
      );
      touched = true;
    }
    for (const [roleId, role] of this.loaded.roles) {
      if (!role.mcp.includes(server)) continue;
      this.writeYamlList(
        path.join(this.loaded.paths.roles, `${roleId}.yaml`),
        ['mcp'],
        role.mcp.filter((s) => s !== server),
      );
      touched = true;
    }
    const forAssistant = this.loaded.config.assistant.mcp;
    if (forAssistant.includes(server)) {
      this.writeYamlList(
        this.loaded.paths.configFile,
        ['assistant', 'mcp'],
        forAssistant.filter((s) => s !== server),
      );
      touched = true;
    }
    if (touched) this.reload();
    return touched;
  }

  /** Ghi một mảng chuỗi vào yaml, giữ chú thích. Xoá hẳn khoá khi rỗng. */
  private writeYamlList(file: string, keyPath: string[], next: string[]): void {
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (next.length) doc.setIn(keyPath, doc.createNode(next));
    else doc.deleteIn(keyPath);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
  }

  /**
   * GIAO một cánh tay cho những nhân viên nào. → docs/SPEC-arms.md §6f bước 3
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BƯỚC NÀY BẮT BUỘC, KHÔNG PHẢI TUỲ CHỌN — và đây là lý do nó có mã nguồn │
   * │ riêng thay vì để giao diện tự kéo dây.                                   │
   * │                                                                          │
   * │ Một node KHÔNG CÓ DÂY là một NODE CHẾT: nó hiện trên sơ đồ, trông như đã │
   * │ xong, và không ai dùng được. Người dùng non-code vừa bấm "Lưu" và thấy    │
   * │ dấu ✓ — họ sẽ không đoán ra là còn phải kéo một sợi dây nữa. Đó đúng lớp │
   * │ lỗi "hệ thống nói dối về trạng thái của chính nó" (§5i·1).                │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Cạnh `mcp→agent` là NGUỒN SỰ THẬT cho `role.mcp` — `LayoutStore.save` ghi nó
   * xuống `roles/<id>.yaml`, không xuống `layout.json`. Nên "kéo dây" và "cấp
   * quyền dùng" là **cùng một hành động**, không phải hai.
   */
  grantArm(server: string, roleIds: string[]): CanvasState {
    this.assertLive();

    /**
     * GHI SỰ CÓ MẶT TRƯỚC, nối dây sau — và bước này chạy KỂ CẢ khi `roleIds`
     * rỗng. Đó là điểm của nó: cắm một cánh tay mà chưa giao cho ai thì node
     * vẫn phải hiện ra để còn kéo dây. → types.ts §OfficeConfig.arms
     */
    if (!this.loaded.config.arms.includes(server)) {
      this.writeYamlList(this.loaded.paths.configFile, ['arms'], [...this.loaded.config.arms, server]);
      this.reload();
    }

    const from = mcpNodeId(server);
    const cur = this.layout.read().layout.edges;
    const have = new Set(cur.map((e) => `${e.from} ${e.to}`));

    const add = roleIds
      .filter((r) => this.loaded.roles.has(r))
      .map((r) => ({ from, to: agentNodeId(r) }))
      .filter((e) => !have.has(`${e.from} ${e.to}`));

    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ 🔴 CHÌA PHẢI ĐI THEO SỢI DÂY — nửa này TỪNG THIẾU HẲN.             │
     * │                                                                    │
     * │ `pickMcp` (worker.ts) dựng env từ `role.secrets`, nhưng cho tới     │
     * │ 23/08 **không có chỗ nào GHI `role.secrets`** trong luồng cắm cánh  │
     * │ tay. Hậu quả: cắm một cánh tay cần chìa thì token vào               │
     * │ `.state/secrets.json` đúng, `role.mcp` đúng, mà tiến trình MCP khởi │
     * │ động KHÔNG CÓ BIẾN MÔI TRƯỜNG nào — hỏng lúc chạy thật, sau khi     │
     * │ giao diện đã báo ✓.                                                 │
     * │                                                                    │
     * │ Sổ chung là chỗ trả lời "cánh tay này cần chìa tên gì" (§6i), nên   │
     * │ nối dây và cấp chìa giờ là MỘT thao tác — đúng chốt §7a của          │
     * │ SPEC-tools-approval: *"nối dây là xong, chìa đi theo"*.             │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const need = this.loaded.company.arms[server]?.secrets ?? [];
    if (need.length) {
      for (const r of roleIds) {
        const role = this.loaded.roles.get(r);
        if (!role) continue;
        const next = [...new Set([...role.secrets, ...need])].sort();
        if (next.length === role.secrets.length) continue;
        this.writeYamlList(path.join(this.loaded.paths.roles, `${r}.yaml`), ['secrets'], next);
      }
      this.reload();
    }

    // Không có gì để thêm thì KHÔNG ghi và KHÔNG phát sự kiện: một `layout.changed`
    // rỗng làm mọi tab vẽ lại sơ đồ để nhận về đúng thứ chúng đang có.
    if (!add.length) return this.canvas();
    return this.saveCanvas({ edges: [...cur, ...add] });
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
    // `folderId` để tên nhân viên phi-Latin không chết ở cửa này. → paths.ts
    const id = input.id?.trim() ? slugId(input.id.trim()) : folderId(name || 'nhan-vien', 'nv');
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
    patch: {
      display_name?: string;
      avatar?: string;
      pitch?: string;
      not_for?: string[];
      model_tier?: string;
      /** Trần chi phí một việc. **`0` = không giới hạn.** → `RoleBudget.max_usd` */
      max_usd?: number;
      max_turns?: number;
      /**
       * Bật/tắt `Bash` cho vai trò này. → docs/SPEC-tools-approval.md §5
       *
       * Công tắc DUY NHẤT trong cả hệ thống về khả năng — mọi tool khác bật sẵn
       * và không tắt được (`BUILTIN_TOOLS`). Nó có công tắc riêng vì nó là thứ
       * duy nhất chạm được ra ngoài thư mục văn phòng.
       */
      bash?: boolean;
    },
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

    /**
     * Ngân sách nằm trong một map con — `doc.set('budget', …)` sẽ THAY CẢ KHỐI
     * và nuốt mất `knowledge_pack` cùng mọi chú thích người dùng viết trong đó.
     * `setIn` sửa đúng một khoá. Cùng lý do với `parseDocument` ở đầu hàm.
     */
    if (patch.max_usd !== undefined) {
      if (!Number.isFinite(patch.max_usd) || patch.max_usd < 0) {
        throw new RunError('Trần chi phí phải là số không âm. Đặt 0 nghĩa là không giới hạn.', 'other');
      }
      doc.setIn(['budget', 'max_usd'], patch.max_usd);
    }
    if (patch.max_turns !== undefined) {
      if (!Number.isInteger(patch.max_turns) || patch.max_turns < 1) {
        throw new RunError('Số bước tối đa phải là số nguyên từ 1 trở lên.', 'other');
      }
      doc.setIn(['budget', 'max_turns'], patch.max_turns);
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────────┐
     * │ `Bash` — CÔNG TẮC, KHÔNG PHẢI Ô NHẬP DANH SÁCH TOOL.                   │
     * │ → docs/SPEC-tools-approval.md §5                                        │
     * │                                                                         │
     * │ Spec chốt "một công tắc duy nhất trong toàn hệ thống" từ đầu, nhưng     │
     * │ cách duy nhất để bật vẫn là mở `roles/<id>.yaml` gõ tay — tức là bài 9  │
     * │ của TEST-WALKTHROUGH có một bước 📝 **BẮT BUỘC** dành cho một sản phẩm  │
     * │ làm cho người non-code. Đây là dòng code trả nốt lời hứa đó.            │
     * │                                                                         │
     * │ GIỮ tool khác trong `tools:` nếu người dùng advanced đã tự thêm: đây là │
     * │ công tắc CHO MỘT TOOL, không phải nút ghi đè cả danh sách. Xoá hẳn khoá │
     * │ khi danh sách rỗng để file quay về đúng hình dạng template.             │
     * │                                                                         │
     * │ KHÔNG cần bump `version`: `cacheKey` băm chính `toolKey` (prompt.ts     │
     * │ §buildWorkerPrompt), nên bộ tool đổi là khoá đổi — không thể quên.      │
     * └────────────────────────────────────────────────────────────────────────┘
     */
    if (patch.bash !== undefined) {
      // Lọc MỌI tên nền tảng, ghi lại đúng MỘT tên chuẩn: file vai trò phải
      // portable giữa Windows và macOS. → types.ts §SHELL_ALIASES
      const rest = role.tools.filter((t) => !EXTERNAL_TOOLS.has(t));
      /**
       * GHI `tools: []` chứ KHÔNG xoá khoá. `doc.delete('tools')` kéo theo cả
       * khối chú thích đứng trên nó — yaml gắn comment vào KHOÁ, không vào
       * file. Đo được trên `nguoi-kiem-ke.yaml`: tắt công tắc một lần là mất
       * vĩnh viễn đoạn giải thích "Bash = cho phép chạy lệnh… ngoại lệ duy
       * nhất của luật §2.6", và bật lại chỉ còn một dòng trần.
       *
       * `[]` cũng đọc đúng hơn: nó nói "không có tool thêm nào", khác với
       * "chưa ai từng nghĩ về chuyện này".
       */
      doc.set('tools', patch.bash ? [...rest, SHELL_TOOL] : rest);
    }

    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    this.refreshAssistantContext();
    this.emit({ type: 'layout.changed', say: `Đã cập nhật hồ sơ "${roleId}".`, plan_id: null });
    return this.canvas();
  }

  /**
   * Đổi tên hiển thị của văn phòng. → docs/SPEC-offices.md §3
   *
   * `id` (tên thư mục) có đổi theo hay không là quyết định của `Company` —
   * xem `Company.renameTarget`. Hàm này chỉ ghi cái tên.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `silent` — ĐỪNG PHÁT SỰ KIỆN MANG MỘT ID SẮP CHẾT. (bug user báo 22/08)  │
   * │                                                                          │
   * │ Khi đổi tên kéo theo dời thư mục, `Company` gọi hàm này TRƯỚC rồi mới     │
   * │ `fs.renameSync`. Sự kiện `layout.changed` phát ở đây mang `office: <id    │
   * │ CŨ>` — và tới tay trình duyệt SAU khi thư mục đã dời.                     │
   * │                                                                          │
   * │ Client thấy id đó vẫn khớp `state.officeId` nên xử lý bình thường: gọi    │
   * │ `refreshCanvas()` → `GET /api/office/<id cũ>/canvas` → **404** → toast    │
   * │ *"Không có văn phòng …"*. Người dùng vừa đổi tên THÀNH CÔNG mà màn hình   │
   * │ báo lỗi — đúng thứ họ kể lại.                                            │
   * │                                                                          │
   * │ Nên khi sắp dời, `Company` bảo im, rồi tự phát **một** sự kiện            │
   * │ `company.offices` mang id MỚI. Một thao tác của người dùng ⇒ một sự kiện, │
   * │ và sự kiện đó nói đúng nơi cần đến.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Ghi bằng `parseDocument` để giữ nguyên chú thích trong office.yaml.
   */
  rename(name: string, opts?: { silent?: boolean }): string {
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
    if (opts?.silent) return next;
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
   * Đổi tên hiển thị của Trợ lý văn phòng này. → docs/SPEC-offices.md §4.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ KHÔNG PHÁ CACHE, VÀ ĐÓ LÀ LÝ DO TÊN NÀY ĐƯỢC PHÉP SỬA THOẢI MÁI.        │
   * │                                                                          │
   * │ `display_name` **không nằm trong prompt của ai cả** — không trong         │
   * │ `ASSISTANT_CORE`, không trong roster (roster chỉ liệt kê NHÂN VIÊN).     │
   * │ Nó chỉ là cái nhãn trên sơ đồ và trong bong bóng chat. Nên đổi nó rẻ      │
   * │ ngang đổi tên văn phòng: không ghi lại cache, không mất trí nhớ, không    │
   * │ đụng session.                                                            │
   * │                                                                          │
   * │ Đối lập hẳn với `model_tier` ngay trên: cái đó là một nửa của khoá cache │
   * │ (model, prefix), nên nó phải kèm câu cảnh báo. Hai thao tác trông giống  │
   * │ nhau trên giao diện mà giá khác hẳn nhau — giao diện phải nói ra.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Ghi bằng `parseDocument` để giữ chú thích người dùng viết trong office.yaml.
   */
  renameAssistant(name: string): string {
    this.assertLive();
    const next = normalizeName(name);
    if (!next) throw new RunError('Tên Trợ lý không được để trống.', 'other');
    if (next.length > 40) throw new RunError('Tên Trợ lý dài quá 40 ký tự.', 'other');
    if (next === this.loaded.config.assistant.display_name) return next;

    const file = this.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (!doc.has('assistant')) doc.set('assistant', {});
    doc.setIn(['assistant', 'display_name'], next);
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');

    this.reload();
    // KHÔNG `refreshAssistantContext()`: tên không nằm trong prompt, nên không
    // có gì để làm mới. Gọi thừa ở đây là tự dựng lại prefix cho vui.
    this.emit({ type: 'layout.changed', say: `Trợ lý giờ tên là "${next}".`, plan_id: null });
    return next;
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
    // Đổi tên văn phòng làm dời thư mục ⇒ nhật ký phải đi theo. Quên dòng này
    // là log ghi tiếp vào thư mục cũ, và giao diện đọc chỗ mới thấy trống trơn.
    this.audit.rebind(this.loaded.paths.state);
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
    /**
     * TRẢ LỜI CÂU HỎI NGƯỜI DÙNG THẬT SỰ ĐANG CÓ: *"đã ăn chưa?"*
     *
     * Câu cũ — *"Đã lưu. Bộ nhớ đệm sẽ ghi lại một lần."* — nói về một cơ chế
     * bên trong mà người dùng không hỏi, và **im lặng đúng chỗ họ đang phân
     * vân**: có phải restart không, ai đã biết, việc đang chạy có bị ảnh hưởng.
     * User hỏi thẳng ba câu đó 21/08, và tài liệu thì đang bảo họ đi `stop`/
     * `start` — một bước thừa không bao giờ gây triệu chứng nên sống rất lâu.
     *
     * Nói ba việc, theo đúng thứ tự người ta lo: hiệu lực · phạm vi · cái giá.
     */
    this.emit({
      type: 'layout.changed',
      say:
        'Đã lưu và áp dụng ngay — không cần khởi động lại. Nhân viên nhận việc từ giờ dùng bản mới; ' +
        'việc đang chạy vẫn theo bản cũ cho tới khi xong. Lượt đầu của mỗi nhân viên sẽ tốn thêm ' +
        'một chút vì phải ghi lại bộ nhớ đệm.',
      plan_id: null,
    });
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

  /**
   * Artifact do một task BỊ NGẮT GIỮA CHỪNG ghi ra. → SPEC-artifacts.md §2.7
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CA HỎNG NGUY HIỂM NHẤT TÌM ĐƯỢC TỚI GIỜ — đo được 21/08.                 │
   * │                                                                          │
   * │ User bấm Dừng đúng lúc `Người đọc` đang tách hợp đồng. Hợp đồng có **5**  │
   * │ điều khoản; nó kịp ghi **3**. Receipt ghi đúng: `status: 'blocked'`,      │
   * │ *"Đã dừng giữa chừng. Có 4 file đã ghi dở, xem lại trước khi dùng."*      │
   * │                                                                          │
   * │ Rồi ca sau đọc thư mục đó, thấy 3 file, và trả về:                        │
   * │   *"Đã soi xong CẢ 3 điều khoản, cả ba đều bất lợi…"* → checklist 16 điểm │
   * │                                                                          │
   * │ 🔥 Người dùng nhận một bản rà soát hợp đồng **trông hoàn hảo, bỏ sót 40%**│
   * │ và không có một dòng nào nói rằng nó thiếu. Đây đúng là *"sai mà không ai │
   * │ biết"* — kết cục tệ nhất trong mọi kết cục.                               │
   * │                                                                          │
   * │ ⚠ Nhãn `UNFINISHED` ở cấp CA không cứu được: nó nói *"ca chưa xong"*,     │
   * │ không nói *"file NÀY thiếu"*. Và `isStale` cũng không: nguồn không đổi,   │
   * │ file vẫn tươi — nó chỉ CỤT. Phải là một nhãn thứ ba.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Quan sát được, không đoán: receipt của mỗi task nằm trên đĩa và mang cả
   * `status` lẫn `landed` — tức là *"ai bị ngắt"* và *"nó đã kịp ghi file nào"*.
   * Ta chỉ việc nối hai thứ đang cầm.
   *
   * ⚠ Nhãn nói **"làm lại bước đó"**, không phải "cẩn thận nhé". Với một file
   * cụt thì không có mức độ cẩn thận nào cứu được: cái thiếu KHÔNG nằm trong
   * file, nên đọc kỹ đến mấy cũng không thấy nó.
   */
  private partialIn(planId: string): Set<string> {
    const out = new Set<string>();
    let names: string[];
    try {
      names = fs.readdirSync(this.loaded.paths.tasks);
    } catch {
      return out;
    }
    const prefix = `${planId}.`;
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.receipt.json')) continue;
      try {
        const r = JSON.parse(
          fs.readFileSync(path.join(this.loaded.paths.tasks, name), 'utf8'),
        ) as Receipt;
        // CHỈ task bị cắt ngang. `done` thì thứ nó ghi là thứ nó định ghi; một
        // task chưa bao giờ chạy thì không có file nào để dán nhãn.
        if (r.status === 'done') continue;
        for (const l of r.landed ?? []) {
          if (l.kind === 'file' && l.ref) out.add(l.ref);
        }
      } catch {
        /* receipt hỏng — không đoán bừa, xem `staleIn` */
      }
    }
    return out;
  }

  /**
   * Artifact nào ĐÃ ÔI: nguồn của nó đổi sau khi nó được ghi. → `isStale`
   *
   * Quan hệ "file này sinh ra từ file kia" KHÔNG phải phỏng đoán — `plan.json`
   * ghi rõ từng task đọc gì (`inputs`) và ghi ra gì (`outputs`). Ta chỉ việc so
   * `mtime` hai đầu.
   *
   * Chỉ chạy cho ca CHƯA XONG và chỉ ≤ `MANIFEST_PLANS` ca được hiện, nên nó
   * đọc nhiều nhất vài file JSON nhỏ mỗi lần dựng prefix. Ca đã xong không cần:
   * kết quả trọn vẹn thì "ôi" là chuyện của lần chạy sau, không phải của việc
   * quyết định có dùng lại một mớ dở dang hay không.
   */
  private staleIn(
    planId: string,
    paths: readonly string[],
    mtimes: ReadonlyMap<string, string>,
  ): Set<string> {
    const out = new Set<string>();
    let plan: Plan | undefined;
    try {
      const file = path.join(this.loaded.paths.tasks, `${planId}.plan.json`);
      if (!fs.existsSync(file)) return out;
      plan = JSON.parse(fs.readFileSync(file, 'utf8')) as Plan;
    } catch {
      // Không đọc được kế hoạch thì KHÔNG đoán bừa là ôi. Dán nhãn cảnh báo sai
      // còn tệ hơn không dán: người dùng học cách bỏ qua nhãn đó.
      return out;
    }

    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    const armDirs = armDirIndex(this.loaded.company.arms, this.loaded.company.mcpServers);
    for (const t of plan.tasks ?? []) {
      // `mtime` của một input đọc THẲNG từ đĩa: nguồn thường là tài liệu trong
      // tủ, và tủ không nằm trong bảng kê kết quả.
      const srcTimes: string[] = [];
      for (const i of t.inputs ?? []) {
        // `resolveInput` chứ không phải `safeJoin`: đầu vào có thể là một đường
        // dẫn TUYỆT ĐỐI ngoài văn phòng, hoặc **tên một cánh tay** (`Musics`).
        // Dùng safeJoin thì mọi kết quả dựng từ nguồn bên ngoài lặng lẽ mất
        // phép kiểm "có ôi không" — chỗ thứ BA của cùng một luật. → paths.ts
        const abs = resolveInput(this.loaded.dir, i.path, armDirs);
        if (!abs) continue;
        try {
          srcTimes.push(fs.statSync(abs).mtime.toISOString());
        } catch {
          /* nguồn đã biến mất — không kết luận gì, `missingInputs` lo ca đó */
        }
      }
      if (srcTimes.length === 0) continue;

      const owned = new Set((t.outputs ?? []).map((o) => norm(o.path)));
      for (const p of paths) {
        const made = mtimes.get(p);
        // `outputs` có thể là một THƯ MỤC (ca "mỗi điều khoản một file"), nên
        // vừa so bằng vừa so tiền tố — cùng luật với `contains` ở scheduler.
        const mine = owned.has(norm(p)) || [...owned].some((o) => norm(p).startsWith(`${o}/`));
        if (mine && made && isStale(made, srcTimes)) out.add(p);
      }
    }
    return out;
  }

  /**
   * Việc còn dở của ca bị NGẮT. → SPEC-offices.md §6b
   *
   * Nhận cả hình dạng cũ (mảng trần, chưa có `plan_id`) để một lần nâng cấp
   * không làm mất việc đang chờ của người dùng — nhưng ca đó không chạy tiếp
   * được, và `resumable()` nói thẳng ra thay vì im lặng bỏ qua.
   */
  readPending(): { plan_id: string; tasks: TaskBrief[] } {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (!fs.existsSync(file)) return { plan_id: '', tasks: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (Array.isArray(raw)) return { plan_id: '', tasks: raw as TaskBrief[] };
      const o = raw as { plan_id?: string; tasks?: TaskBrief[] };
      return { plan_id: o.plan_id ?? '', tasks: o.tasks ?? [] };
    } catch {
      return { plan_id: '', tasks: [] };
    }
  }

  /**
   * Ca bị ngắt có chạy tiếp được không — và nếu có thì còn bao nhiêu việc.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐÂY LÀ CA `resume` DUY NHẤT KHÔNG PHẢI ĐOÁN GÌ (user chốt 20/08 tối).    │
   * │                                                                          │
   * │ Ca này **chưa bao giờ được lập kế hoạch lại**: `/stop`, hết hạn mức,      │
   * │ daemon crash. Vẫn đúng `plan_id` đó, vẫn đúng danh sách task đó, receipt  │
   * │ nằm trên đĩa. Không có gì để khớp, nên không có gì để đoán sai.           │
   * │                                                                          │
   * │ Khác hẳn ca *"người dùng gõ lại một yêu cầu tương tự"* — ca đó ta CỐ Ý    │
   * │ không tự khớp, chỉ nói ra mớ dở dang qua bảng kê rồi để planner quyết.    │
   * │ → `artifacts.ts` `isStale`                                               │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  resumable(): { plan_id: string; left: number; request: string } | undefined {
    const { plan_id, tasks } = this.readPending();
    if (tasks.length === 0) return undefined;
    // Hình dạng cũ không mang `plan_id` ⇒ không biết ghi kết quả vào đâu.
    if (!plan_id) return undefined;
    if (!fs.existsSync(path.join(this.loaded.paths.tasks, `${plan_id}.plan.json`))) return undefined;
    const rec = this.plans.list().find((p) => p.plan_id === plan_id);
    return { plan_id, left: tasks.length, request: rec?.request ?? '' };
  }

  /**
   * Một dòng mời chạy tiếp, phát lúc văn phòng nối bus. 0 token.
   *
   * Việc dở được MỜI RA, KHÔNG tự chạy — ba lý do:
   *
   *  1. Tự chạy lúc bật daemon = một lần crash âm thầm tiêu tiền người dùng.
   *     Cùng luật đã chốt cho trí nhớ Trợ lý: đừng gắn ngữ nghĩa vào việc
   *     tắt/bật daemon, đó là việc hạ tầng (cập nhật, crash, reboot).
   *  2. Ca dở thường tới từ `/stop` — tức là người dùng vừa NÓI dừng. Tự chạy
   *     tiếp là ghi đè lên một quyết định họ vừa ra.
   *  3. Một dòng chat để họ đáp là HỘI THOẠI, không phải quản lý trạng thái —
   *     đúng thứ họ muốn khi nói *"tự thông minh, không phải nút bấm"*.
   *
   * Câu phải nói được cả ba thứ người dùng cần để quyết: **còn bao nhiêu việc**,
   * **của ca nào**, và **chạy tiếp thì tốn gì** — vì nỗi lo thật ở khoảnh khắc
   * đó là "bấm vào có mất thêm tiền không". Câu trả lời là *không thêm lượt lập
   * kế hoạch nào*, và nói ra được thì nó thành một quyết định dễ.
   */
  private offerResume(): void {
    const ready = this.resumable();
    if (!ready) return;
    this.emit({
      type: 'master.message',
      role: 'assistant',
      say:
        `Ca trước còn ${ready.left} việc chưa chạy${ready.request ? ` — "${ready.request}"` : ''}. ` +
        `Gõ /resume là mình làm nốt, dùng lại kế hoạch cũ nên không tốn thêm lượt chia việc nào. ` +
        `Hoặc cứ nhắn việc mới, phần đã xong vẫn nằm trong ngăn Kết quả.`,
      plan_id: null,
    });
  }

  /**
   * Chạy tiếp ca dở — DÙNG LẠI đúng `plan_id`, chỉ chạy những task chưa chạy.
   *
   * ⚠ KHÔNG bao giờ tự chạy lúc khởi động daemon. Cùng lý do đã chốt cho trí
   * nhớ Trợ lý: gắn ngữ nghĩa vào việc tắt/bật daemon nghĩa là một lần crash âm
   * thầm tiêu tiền của người dùng. Nó được MỜI ra ở ô chat, và người dùng nói
   * "ừ" — đó là hội thoại, không phải quản lý trạng thái.
   */
  async resume(): Promise<{ plan_id: string; report: string; usage: Usage }> {
    const ready = this.resumable();
    if (!ready) throw new RunError('Không có việc nào đang dở để chạy tiếp.', 'other');

    const file = path.join(this.loaded.paths.tasks, `${ready.plan_id}.plan.json`);
    const full = JSON.parse(fs.readFileSync(file, 'utf8')) as Plan;
    const queued = new Set(this.readPending().tasks.map((t) => t.task_id));

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ "KHÔNG NẰM TRONG `pending`" ≠ "ĐÃ XONG". Bản trước tin thế và nó nổ.  │
     * │                                                                      │
     * │ `pending` là *task CHƯA CHẠY LẦN NÀO* (scheduler trả về khi bị ngắt). │
     * │ Một task vắng mặt ở đó có thể là: xong ✓ · hỏng ✗ · bị chặn ✗ ·      │
     * │ **bị cắt giữa lúc đang ghi file ✗**. Bản trước cắt phăng `deps` trỏ   │
     * │ tới mọi task vắng mặt, tức là coi cả bốn ca như ca đầu.               │
     * │                                                                      │
     * │ Đo được 21/08, hai lần liên tiếp (hd3, hd4): user bấm Dừng lúc        │
     * │ `Người đọc` đang tách hợp đồng (4/5 điều khoản), rồi gõ `/resume`.    │
     * │ T-01 vắng mặt trong `pending` vì nó ĐÃ chạy — và trả `blocked`. Dây   │
     * │ `T-02 → T-01` bị cắt, `missingInputs` thấy thư mục có 4 file nên cho  │
     * │ qua, và cả chuỗi sau chạy trên một hợp đồng thiếu 20%.               │
     * │                                                                      │
     * │ ⚠ `delivered()` tồn tại ĐÚNG để trả lời câu hỏi này, và bản trước đi  │
     * │ vòng qua nó vì lọc theo DANH SÁCH thay vì hỏi RECEIPT.               │
     * │ → luật 20/08 "quyết định đúng + tiền đề sai = bom hẹn giờ"           │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * Luật đúng: một task được bỏ qua **chỉ khi receipt của nó nói là đã giao
     * được hàng**. Còn lại thì nó CHẠY LẠI — kể cả khi nó đã chạy một lần và
     * để lại file dở. Chạy lại ghi đè vào đúng thư mục của chính nó
     * (`artifacts/<plan>/<task>/`) nên không đẻ ra mảnh mồ côi nào.
     */
    const redo = (id: string): boolean => queued.has(id) || !delivered(this.receiptOf(ready.plan_id, id));
    const run = new Set(full.tasks.filter((t) => redo(t.task_id)).map((t) => t.task_id));

    const plan: Plan = {
      ...full,
      tasks: full.tasks
        .filter((t) => run.has(t.task_id))
        // Chỉ cắt dây tới task THẬT SỰ đã giao hàng — nó không còn trong kế
        // hoạch rút gọn nên để nguyên là `validate` báo "phụ thuộc không tồn
        // tại" và chặn chính cái ca ta đang cứu.
        .map((t) => ({ ...t, deps: t.deps.filter((d) => run.has(d)) })),
    };
    return this.run(plan.request, undefined, plan);
  }

  /** Receipt của một task, hoặc `undefined` nếu nó chưa từng chạy. */
  private receiptOf(planId: string, taskId: string): Receipt | undefined {
    try {
      const f = path.join(this.loaded.paths.tasks, `${planId}.${taskId}.receipt.json`);
      return JSON.parse(fs.readFileSync(f, 'utf8')) as Receipt;
    } catch {
      return undefined;
    }
  }

  // ── nội bộ

  /**
   * Đồng bộ hai thứ Trợ lý cần biết: ai đang trực, và kho tri thức có gì.
   *
   * Cả hai nằm trong prefix được cache nên hàm này ĐẮT — gọi khi hình dạng hoặc
   * tri thức đổi, không gọi mỗi lượt trò chuyện.
   */
  /**
   * BẢNG KÊ VỪA ĐỔI — nạp lại prefix Trợ lý. → SPEC-library §8b · SPEC-artifacts §2.4
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG ĐÃ SỬA (20/08): HAI TRONG BỐN CỬA KHÔNG NẠP LẠI.                    │
   * │                                                                          │
   * │   thêm tài liệu  → `library.add()` thẳng từ server   ❌ KHÔNG nạp lại    │
   * │   xoá tài liệu   → `Office.removeDocument()`          ✅                  │
   * │   sinh kết quả   → cuối `Office.run()`                ✅                  │
   * │   xoá kết quả    → `artifacts.remove()` thẳng từ server ❌ KHÔNG nạp lại │
   * │                                                                          │
   * │ Hậu quả của cửa thứ nhất là ca tệ nhất: người dùng **vừa tải một tài     │
   * │ liệu lên rồi hỏi ngay về nó** — thao tác tự nhiên nhất của cả sản phẩm — │
   * │ và Trợ lý nói không thấy file nào tên đó. Cửa thứ tư ngược lại: nó nêu    │
   * │ tên một kết quả người dùng vừa xoá.                                      │
   * │                                                                          │
   * │ Gốc rễ là luật "ghi/đọc phải dùng chung một hàm" bị phá ở tầng HTTP:      │
   * │ hai route gọi thẳng vào store, hai route đi qua `Office`. Cửa nào đi tắt  │
   * │ thì cửa đó quên. Nên bản vá không phải "thêm hai lời gọi" mà là **đóng    │
   * │ cửa tắt**: mọi thao tác đổi hai cái kho đi qua `Office`.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  addDocument(name: string, data: Buffer, opts: { replace: boolean; maxBytes: number }): DocRecord {
    this.assertLive();
    const doc = this.library.add(name, data, opts);
    this.refreshAssistantContext();
    return doc;
  }

  /** Xoá một KẾT QUẢ. Đi qua đây để bảng kê trong prefix Trợ lý không nói tên file đã mất. */
  removeArtifact(rel: string): boolean {
    this.assertLive();
    if (!this.artifacts.remove(rel)) return false;
    this.refreshAssistantContext();
    return true;
  }

  /**
   * DỌN SẠCH ngăn Kết quả. Trả về số file đã xoá.
   *
   * ⚠ `refreshAssistantContext()` ở đây KHÔNG phải thủ tục — bảng kê Kết quả nằm
   * trong prefix của Trợ lý. Bỏ nó là Trợ lý tiếp tục nêu tên hàng chục file vừa
   * bị xoá, rất tự tin, và người dùng bấm vào từng cái để nhận "không tìm thấy".
   * Đúng cửa tắt mà §3116 đã đóng một lần rồi.
   */
  clearArtifacts(): number {
    this.assertLive();
    const n = this.artifacts.removeAll();
    if (n) this.refreshAssistantContext();
    return n;
  }

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

    const records = new Map(this.plans.list().map((p) => [p.plan_id, p]));
    const titles = new Map([...records].map(([id, p]) => [id, p.request]));
    const mtimes = new Map(files.map((a) => [a.path, a.mtime]));
    const groups = [...byPlan.entries()];
    const shown = groups.slice(0, MANIFEST_PLANS);

    const blocks: string[] = [];
    for (const [planId, paths] of shown) {
      /**
       * CA CHƯA XONG PHẢI NÓI RA LÀ CHƯA XONG. → SPEC-artifacts.md §2.6
       *
       * Trước 20/08 bảng kê chỉ liệt kê file, không phân biệt "kết quả của một
       * ca chạy trọn" với "mớ dở dang của một ca chết giữa chừng". Người dùng gõ
       * lại yêu cầu thì Trợ lý làm lại từ đầu — trả tiền lần nữa cho việc đã nằm
       * sẵn trên đĩa — hoặc tệ hơn, dùng lại một file dở như thể nó đã xong.
       *
       * Đây là nửa TẤT ĐỊNH của bài toán "chạy tiếp": ta không đoán *"đây có
       * phải việc cũ không"*, ta chỉ nói ra thứ đang có và để planner quyết với
       * đầy đủ ngữ cảnh câu người dùng vừa gõ. → `isStale`
       */
      const rec = records.get(planId);
      const unfinished = rec && rec.status !== 'done' ? rec : undefined;
      const stale = unfinished ? this.staleIn(planId, paths, mtimes) : new Set<string>();
      /**
       * ⚠ KHÔNG gắn vào `unfinished`. Đã dẫm đúng bẫy này 21/08.
       *
       * Ca `P-260821-0103-cx3a` mang `status: 'done'` — vì lần chạy SAU của nó
       * kết thúc êm — trong khi file của T-01 vẫn cụt ở 3/5 điều khoản. Trạng
       * thái CA nói về lần chạy cuối; tính dở dang là thuộc tính của TỪNG TASK.
       * Gắn nhầm tầng thì nhãn im lặng đúng ở ca nguy hiểm nhất.
       */
      const partial = this.partialIn(planId);
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
      const name = title ? truncateToTokens(title, 30) : '(một việc cũ, không còn tên trong sổ)';
      // Nói bằng SỐ BƯỚC, không bằng tên trạng thái nội bộ: "2/3 bước" nói được
      // cả *"còn dở"* lẫn *"dở tới đâu"*, mà `status: 'blocked'` thì không.
      const progress = unfinished
        ? ` — ⚠ UNFINISHED (${unfinished.steps.filter((s) => s.status === 'done').length}/${
            unfinished.steps.length
          } steps). Files below are partial results you may reuse as inputs.`
        : '';
      blocks.push(
        [
          `## ${name}${progress}`,
          // Sắp theo đường dẫn trong MỘT ca: `T-01` phải đứng trước `T-02`.
          // `list()` sắp theo `mtime` nên task chạy xong sau lại lên trên, và
          // một danh sách nhảy số là một danh sách người đọc phải dò lại.
          /**
           * ⚠ FILE DỞ DANG: GIẤU ĐƯỜNG DẪN, GIỮ CON SỐ. → SPEC-artifacts §2.7
           *
           * ┌──────────────────────────────────────────────────────────────┐
           * │ NHÃN LÀ MỘT LỜI NHỜ MODEL TUÂN THEO. BỎ HẲN THÌ KHÔNG CÓ GÌ │
           * │ ĐỂ TUÂN THEO CẢ.                                             │
           * │                                                              │
           * │ Bản trước dán `(INCOMPLETE — … Redo that step …)` lên từng    │
           * │ file. Đọc rất thuyết phục — và ca hd4 vẫn hỏng y hệt. Đó là   │
           * │ một LỜI HỨA, không phải một cơ chế: luật cổ nhất của dự án.   │
           * │                                                              │
           * │ Không nêu đường dẫn thì planner không có chuỗi nào để chép    │
           * │ vào `inputs`, nên nó buộc phải lập lại bước đó. Không cần     │
           * │ model hợp tác một lần nào.                                    │
           * └──────────────────────────────────────────────────────────────┘
           *
           * Nhưng KHÔNG giấu sạch — giữ một dòng đếm. Ẩn hết thì người dùng
           * hỏi *"ca vừa rồi làm tới đâu?"* và Trợ lý mù, mà đó là câu hỏi
           * chính đáng ở đúng khoảnh khắc đó. Con số trả lời được câu hỏi mà
           * không đưa ra thứ để chép.
           *
           * ⚠ Model ĐOÁN ĐƯỢC đường dẫn (`artifacts/<plan>/<task>/…` có quy
           * luật), nên đây chỉ là hàng rào thứ nhất. Hàng rào cứng nằm ở
           * `Scheduler.missingInputs`, chặn lúc phóng.
           */
          ...[...paths]
            .filter((p) => !partial.has(p))
            .sort()
            .map((p) => (stale.has(p) ? `- ${p} (STALE — its source changed after this was written)` : `- ${p}`)),
          ...(paths.some((p) => partial.has(p))
            ? [
                `(${paths.filter((p) => partial.has(p)).length} more files here were left half-written by an ` +
                  `interrupted employee. They are NOT usable as inputs and their paths are withheld on purpose — ` +
                  `plan that step again instead. The human can still open them.)`,
              ]
            : []),
        ].join('\n'),
      );
    }

    const head = '# Results this office has already produced';
    /**
     * TỔNG SỐ CHÍNH XÁC, kể cả khi danh sách bị cắt. → SPEC-artifacts.md §2.4
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ Bảng kê CỐ Ý chỉ liệt kê `MANIFEST_PLANS` ca gần nhất — đó là ngân    │
     * │ sách token, không phải khiếm khuyết. Nhưng nó khiến một câu hỏi rất   │
     * │ thường gặp trở nên KHÔNG TRẢ LỜI ĐƯỢC: *"mình đang có bao nhiêu kết   │
     * │ quả?"*. Model nhìn vào danh sách cắt ngắn rồi đếm — và đếm sai.        │
     * │                                                                      │
     * │ Hai con số này ta đang CẦM TRONG TAY (`files.length`, `byPlan.size`). │
     * │ Luật tối cao: *thứ gì ta quan sát được thì đừng để model đoán*. Giá:   │
     * │ một dòng, ~15 token, và nó biến một câu trả lời bịa thành một sự việc.│
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const totals =
      `Total: ${files.length} file(s) across ${groups.length} job(s). ` +
      `These numbers are exact — use them when the human asks how much is here.`;
    const foot = [
      groups.length > shown.length
        ? `Listed above: the ${shown.length} most recent job(s) only. The older ones still exist on ` +
          `disk, so a path the human gives you from one of them is valid — never tell them a file ` +
          `is missing because it is not listed here.`
        : '',
      'These are files EMPLOYEES wrote in earlier jobs. To reuse one, put its path in a',
      "task's `inputs`, or send a `lookup` at it to find out what it says.",
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
    // `totals` đứng NGAY SAU tiêu đề và KHÔNG bao giờ bị cắt: vòng lặp dưới chỉ
    // bỏ bớt `kept`. Trần token được phép làm danh sách ngắn đi, không được phép
    // làm con số sai đi.
    const render = (): string => [head, '', totals, '', ...kept, '', foot].join('\n');
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
    /** Tra tên tài khoản của một cánh tay. Lười — xem `canvas()`. */
    viaOf: (server: string) => string | undefined,
  ): CanvasNode {
    const base: CanvasNode = { ...n, label: n.id, missing, connected, removable: true };
    /**
     * Node cánh tay hiện NHÃN, không hiện băm. `a3f9c2e1b0` là danh tính, không
     * phải thứ để đọc — sơ đồ mà đầy chuỗi băm thì không ai nhìn ra cái gì.
     * Rơi về chính băm khi sổ chưa có mục (cấu hình cũ, hoặc dán tay vào yaml).
     */
    if (n.kind === 'mcp') {
      const meta = n.server ? this.loaded.company.arms[n.server] : undefined;
      // Mục danh mục (nếu có) là nguồn của HÌNH. Không có `catalog` ⇒ người dùng
      // tự dán ⇒ `custom`, y hệt `ArmDialog §kindOf` — một trục phân loại, hai
      // chỗ đọc, và cả hai đọc từ cùng một dữ kiện.
      const entry = meta?.catalog ? findArm(meta.catalog) : undefined;
      return {
        ...base,
        label: meta?.label || n.server || n.id,
        avatar: '🔌',
        armKind: !meta?.catalog
        ? 'custom'
        : entry?.shape === 'browser'
          ? 'browser'
          : entry?.folders
            ? 'files'
            : 'service',
        ...(entry?.brand.mark ? { mark: entry.brand.mark } : {}),
        /**
         * NHÃN CẤU HÌNH — *"nhìn vào panel là biết đang cấu hình thế nào"* (user
         * 29/08). Suy từ **cấu hình đã lưu**, không từ một danh sách id cất riêng:
         * hai nguồn cho cùng một sự thật thì nguồn sai sẽ là nguồn **hiển thị**.
         * → `catalog.ts §activeOptions`
         */
        ...(() => {
          const cfg = n.server ? this.loaded.company.mcpServers?.[n.server] : undefined;
          if (!entry || !cfg) return {};
          const on = activeOptions(entry, cfg);
          /**
           * `canLogin` = cánh tay có **hồ sơ bền** để đăng nhập VÀO. Không có
           * `dirs` thì đăng nhập xong cũng mất theo lượt việc — bày nút ở đó là
           * bày một cái bẫy, không phải một tính năng.
           */
          const login = on.some((o) => o.dirs?.length);
          return {
            ...(on.length ? { optionLabels: on.map((o) => o.label) } : {}),
            ...(login ? { canLogin: true } : {}),
          };
        })(),
        connected: true,
        /**
         * NẤC QUYỀN + SỐ VIỆC — để bảng chi tiết vẽ huy hiệu **từ dữ liệu**, chứ
         * không từ chuỗi tên. Nhãn đổi tự do; cái này thì không. → §6j
         */
        ...(meta?.level ? { level: meta.level } : {}),
        ...(meta?.tools?.length ? { toolCount: meta.tools.length } : {}),
        /**
         * TÊN TÀI KHOẢN — node vẽ nó ở dòng phụ, thay cho chữ "kết nối".
         *
         * ⚠ Chỗ này từng cố ý BỎ TRỐNG, với lý lẽ *"nhãn mặc định đã kèm tên
         * workspace rồi"*. Lý lẽ đó không còn: nhãn thôi ghép tài khoản (nó
         * đóng băng ở tài khoản đầu tiên), nên nếu đây cũng trống thì sơ đồ
         * không còn chỗ nào phân biệt hai cánh tay cùng hãng. → `canvas()`
         *
         * Suy từ `arms[].secrets` tra ngược kho OAuth, **không** đọc chuỗi
         * `label`: nhãn là của người dùng và đổi tự do; tài khoản là sự thật
         * thuộc về cấu hình. Cùng luật với `Company.listArms`. → §armWorkspace
         */
        ...(() => {
          const via = n.server ? viaOf(n.server) : undefined;
          return via ? { via } : {};
        })(),
        /**
         * THƯ MỤC THẬT của cánh tay — đọc từ `company.yaml`, KHÔNG sửa được ở đây.
         *
         * Nhãn là thứ người dùng đặt và đổi được; thư mục là **cấu hình**, và
         * đổi nó nghĩa là đổi `armHash` ⇒ một cánh tay KHÁC. Nên ô này chỉ đọc:
         * muốn thư mục khác thì cắm một kết nối khác, đúng luật §6i.
         *
         * ⚠ KHÔNG dò `process.platform`, và đó là chủ ý — `folderRoots` nhận cả
         * `D:\…` lẫn `/home/…` ở mọi hệ, vì một văn phòng zip từ máy khác hệ
         * vẫn phải hiện đúng chuỗi đã ghi trong `company.yaml`. Hiện nguyên văn,
         * không chuẩn hoá dấu gạch: thứ người dùng đối chiếu với Explorer/Finder
         * là chuỗi họ đã nhập, không phải bản ta viết lại.
         */
        folders: n.server ? folderRoots(this.loaded.company.mcpServers[n.server]) : [],
      };
    }
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
    const role = n.role ? this.loaded.roles.get(n.role) : undefined;
    if (!role) return { ...base, label: n.role ?? n.id, avatar: '?', missing: true };
    return {
      ...base,
      label: role.display_name || role.id,
      avatar: role.avatar,
      tier: role.model_tier,
      model: this.loaded.company.models[role.model_tier],
      pitch: role.pitch,
      maxUsd: role.budget.max_usd,
      maxTurns: role.budget.max_turns,
      bash: hasShell(role.tools),
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
  private logAssistantUsage(stage: 'route' | 'plan' | 'report' | 'lookup', usage: Usage): void {
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

  /**
   * Task chưa chạy — để chạy tiếp thay vì làm lại từ đầu. → SPEC-offices §6b
   *
   * ⚠ PHẢI ghi kèm `plan_id`. Bản trước lưu một mảng `TaskBrief` trần, và thiếu
   * đúng mảnh đó thì không chạy tiếp được: `artifacts/<plan_id>/` là khung theo
   * ca, nên không biết ca nào là ghi kết quả mới vào một thư mục khác và mớ dở
   * dang cũ thành mồ côi — đúng chuyện `resume` sinh ra để tránh.
   */
  private savePending(planId: string, pending: TaskBrief[]): void {
    const file = path.join(this.loaded.paths.state, 'pending.json');
    if (pending.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    this.writeJson(file, { plan_id: planId, tasks: pending });
  }

  private sessionFile(): string {
    return path.join(this.loaded.paths.state, 'assistant-session.json');
  }

  /**
   * ⚠ ĐỌC CẢ ẢNH CHỤP DANH BẠ, không chỉ con trỏ phiên. → `Assistant.resumeFrom`
   *
   * Hai thứ này là MỘT CẶP: hội thoại cũ (nơi có những câu từ chối cũ) và ảnh
   * chụp để biết cấu hình đã đổi gì. Lưu một, quên một, thì sau restart lịch sử
   * còn nguyên mà tín hiệu đính chính thì mất — và model theo lịch sử.
   */
  private readSession(): { id?: string; reach?: Record<string, string[]> } {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionFile(), 'utf8')) as {
        session_id?: string;
        reach?: Record<string, string[]>;
      };
      return { id: raw.session_id, reach: raw.reach };
    } catch {
      return {};
    }
  }

  private saveSessionId(): void {
    if (!this.assistant.session) return;
    const reach = this.assistant.reachSnapshot;
    this.writeJson(this.sessionFile(), {
      session_id: this.assistant.session,
      ...(reach ? { reach } : {}),
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

/**
 * File ca này ghi RA ngoài thư mục văn phòng, và có thật trên đĩa.
 *
 * Dùng ở đúng một chỗ: chọn câu nào để nói khi file đã hứa không có mặt. Không
 * bao giờ đi vào `whereBlock` — "kết quả của bạn nằm ở đây" chỉ được nói về chỗ
 * hệ thống quản được. → `worker.ts → landingOf`, nhãn `outside`
 */
function strayFilesOf(receipts: readonly Receipt[]): string[] {
  return straysOnDisk(receipts.flatMap((r) => r.landed ?? []));
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
# không cần khai gì ở đây. Trường này chỉ để thêm thứ nằm ngoài bộ mặc định.
#
# Bash = cho phép chạy lệnh trên máy. BẬT SẴN (user chốt 22/08) vì phần lớn
# việc văn phòng thật sự cần nó: gọi git, đổi định dạng file, nén kết quả,
# đụng tới thư mục nằm ngoài văn phòng.
#
# ⚠ Đây là NGOẠI LỆ DUY NHẤT của luật "kết quả luôn nằm trong thư mục văn
# phòng" (docs/SPEC-artifacts.md §2.6): hook chặn ghi bậy chỉ khớp được
# Write/Edit, không khớp được lệnh shell. Người này đọc và ghi được bất cứ
# đâu trên máy bạn. Xoá dòng dưới, hoặc tắt công tắc trong bảng chi tiết,
# nếu vai trò này không cần.
tools: [Bash]
model_tier: ${tier}
use_preset: false

budget:
  # max_turns là đòn bẩy chi phí lớn nhất: mỗi lượt đọc lại TOÀN BỘ prefix.
  # Vai trò tier eco cần con số CAO HƠN tier standard — model rẻ đi nhiều
  # bước hơn cho cùng một việc. Tier deep thì ngược lại: mỗi lượt đắt hơn hẳn
  # nhưng nó đi ít bước hơn.
  #
  # ⚠ NỚI 26/08 (user chốt) — 6/12 là con số của thời CHƯA CÓ MCP. Mỗi lời gọi
  # MCP là MỘT LƯỢT, nên một việc chạm vài trang Notion đốt hết trần trước khi
  # kịp làm xong. Đo được: xoá một trang con = 9 lượt, chạm trần ở 6, và cái
  # giá của việc chạm trần là ĐẮT NHẤT trong mọi kiểu hỏng — nó chạy tới kịch
  # rồi mất trắng.
  max_turns: ${tier === 'eco' ? 20 : tier === 'deep' ? 10 : 15}
  # Trần chi phí MỘT việc. Đặt 0 = không giới hạn.
  # Số dưới đây RỘNG có chủ ý: chặn giữa chừng là mất trắng số tiền đã tiêu mà
  # không có kết quả. Đo được 21/08 trên bài gộp CSV 200 dòng: eco ~$0.17,
  # standard ~$0.45. Siết xuống khi bạn đã biết việc của mình tốn bao nhiêu.
  max_usd: ${tier === 'eco' ? '2.0' : tier === 'deep' ? '10.0' : '5.0'}
  knowledge_pack: 3000
`;
}
