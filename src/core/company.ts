/**
 * CÔNG TY — vỏ chứa các văn phòng, cộng hai thứ dùng chung: tiền và bus sự kiện.
 *
 * → docs/SPEC-offices.md §2
 *
 * Công ty CỐ Ý mỏng. Nó không có Trợ lý, không có nhân viên, không có kho tri
 * thức. Mọi thứ đó thuộc về văn phòng, vì mọi thứ đó đi vào prefix cache và
 * prefix phải hẹp nhất có thể. Cái duy nhất công ty giữ là thứ người dùng muốn
 * nhìn TỔNG: một subscription Claude, một hoá đơn, một sổ chi phí.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';

import { defaultArmLabel, ensureInstalled } from './armexec.js';
import { cliSays, cliToolNames } from './cli-arm.js';
import { loadCompanyConfig, loadOffice } from './config.js';
import {
  companyPaths,
  ensureCompanyDirs,
  ensureOfficeDirs,
  isSafeId,
  listOfficeIds,
  nameKey,
  normalizeName,
  officePaths,
  resolveCompanyDir,
  folderId,
  slugId,
  type CompanyPaths,
} from './paths.js';
import { Office } from './office.js';
import { grantFor, readOAuth, readSecrets, writeSecrets } from './secrets.js';
import { armHash, coveredBy, folderRoots, swallowsOffice } from './catalog.js';
import {
  appendRename,
  appendUsage,
  formatReport,
  readUsage,
  renameChain,
  summarize,
  type CostReport,
  type UsageRecord,
} from './usage.js';
import { migrateIfNeeded } from './migrate.js';
import { RunError, TIERS, type AgentEvent, type CompanyConfig } from './types.js';

export interface OfficeSummary {
  id: string;
  name: string;
  avatar: string;
  state: string;
  agents: number;
  onDuty: number;
  knowledge: number;
  /** Đã cất vào lưu trữ — đóng băng, chỉ đọc, khôi phục được. */
  archived: boolean;
  /** Có việc đang chạy không, và là việc nào. */
  plan_id: string | null;
  /** Văn phòng nạp lỗi — vẫn liệt kê, kèm lý do. Không được biến mất âm thầm. */
  error?: string;
}

export class Company {
  readonly dir: string;
  readonly paths: CompanyPaths;
  config: CompanyConfig;

  private readonly offices = new Map<string, Office>();
  /** Văn phòng nạp lỗi. Giữ lại để UI hiện được, không im lặng nuốt mất. */
  private readonly broken = new Map<string, string>();
  private readonly bus = new EventEmitter();
  private readonly recent: AgentEvent[] = [];

  private constructor(dir: string, config: CompanyConfig) {
    this.dir = dir;
    this.paths = companyPaths(dir);
    this.config = config;
    ensureCompanyDirs(this.paths);
    this.loadOffices();
    this.warmArms();
  }

  /**
   * Cài sẵn gói của mọi cánh tay đã cắm — KHÔNG chờ, KHÔNG chặn gì.
   *
   * Cánh tay cắm trước bản vá 24/08 chưa có bản cài nhanh nào, nên nếu chỉ dựa
   * vào nút "Thử ngay" thì chúng trả ~4 giây mỗi task **mãi mãi** (không ai bấm
   * Thử lại một cánh tay đang chạy tốt). Daemon mở công ty là lúc rẻ nhất để
   * trả khoản đó: chưa ai chờ gì cả.
   *
   * ⚠ `void` có chủ ý và phải giữ: `await` ở đây là chặn daemon khởi động sau
   * một lời gọi mạng: hỏng đúng lớp "một thao tác dọn dẹp của hệ thống nằm ở
   * tay người dùng". Cài xong hay không, `fastLaunch` vẫn tự quyết đúng ở lượt
   * chạy kế tiếp. → `core/armexec.ts`
   */
  private warmArms(): void {
    for (const cfg of Object.values(this.config.mcpServers)) {
      void ensureInstalled(cfg as Record<string, unknown>);
    }
  }

  static open(dir?: string): Company {
    const resolved = resolveCompanyDir(dir);
    // Di trú TRƯỚC khi nạp: v0 để roles/ ngay dưới company/. Đây là thay đổi
    // hình dạng thư mục do TA gây ra, không phải quyết định của người dùng,
    // nên làm tự động và chỉ in ra thông báo. → SPEC-offices.md §7
    migrateIfNeeded(resolved);
    return new Company(resolved, loadCompanyConfig(resolved));
  }

  // ── văn phòng

  private loadOffices(): void {
    this.offices.clear();
    this.broken.clear();
    for (const id of listOfficeIds(this.paths)) {
      try {
        const office = new Office(loadOffice(this.dir, this.config, id));
        office.bindBus((e) => this.emit(e));
        office.onUsage = (rec) => appendUsage(this.paths, rec);
        this.offices.set(id, office);
      } catch (err) {
        // Một văn phòng hỏng KHÔNG được kéo theo văn phòng khác — tiêu chí
        // "Ổn định". Ghi lại lý do để UI hiện được thay vì im lặng biến mất.
        const msg = err instanceof Error ? err.message : String(err);
        this.broken.set(id, msg);
        process.emitWarning(`Không nạp được văn phòng "${id}": ${msg}`);
      }
    }
  }

  list(): OfficeSummary[] {
    const out: OfficeSummary[] = [];
    for (const o of this.offices.values()) {
      out.push({
        id: o.id,
        name: o.name,
        avatar: o.loaded.config.assistant.avatar,
        state: o.currentState,
        agents: o.loaded.roles.size - o.loaded.archivedRoles.size,
        onDuty: o.assistant.assignableRoles().size,
        knowledge: o.knowledge.size,
        archived: o.archived,
        plan_id: o.plan?.plan_id ?? null,
      });
    }
    for (const [id, error] of this.broken) {
      out.push({
        id,
        name: id,
        avatar: '⚠',
        state: 'stopped',
        agents: 0,
        onDuty: 0,
        knowledge: 0,
        archived: false,
        plan_id: null,
        error,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(officeId: string): Office {
    const o = this.offices.get(officeId);
    if (!o) {
      const why = this.broken.get(officeId);
      throw new RunError(
        why ? `Văn phòng "${officeId}" đang lỗi: ${why}` : `Không có văn phòng "${officeId}".`,
        'other',
      );
    }
    return o;
  }

  get size(): number {
    return this.offices.size;
  }

  /**
   * Tạo văn phòng mới. Nó ra đời với ĐÚNG một Trợ lý, không nhân viên nào.
   *
   * Khởi điểm sạch là có chủ ý (SPEC-offices.md §3): người dùng đầu tiên của v0
   * mở lên thấy ba nhân viên lạ hoắc mà họ không đặt tên, không hiểu vì sao có,
   * và không dám xoá.
   */
  createOffice(input: { name?: string; id?: string }): Office {
    const name = normalizeName(input.name ?? '') || 'Văn phòng mới';
    /**
     * `folderId` chứ không phải `slugId`: tên phi-Latin (中文, 日本語, 한국어,
     * ไทย, Русский…) cho slug RỖNG, và bản cũ ném thẳng *"cần có ít nhất một
     * chữ cái"* — một câu vô nghĩa với người vừa gõ đúng chữ của họ. → paths.ts
     *
     * `id` người dùng TỰ gõ thì vẫn qua `slugId` như cũ: đó là họ đang chọn
     * tên thư mục, nên phải nhận đúng thứ mình gõ hoặc bị từ chối rõ ràng.
     */
    const id = input.id?.trim() ? slugId(input.id.trim()) : folderId(name);
    if (!isSafeId(id)) {
      throw new RunError('Tên văn phòng cần có ít nhất một chữ cái hoặc số.', 'other');
    }
    if (name.length > 60) {
      throw new RunError('Tên văn phòng dài quá 60 ký tự.', 'other');
    }
    if (this.offices.has(id) || this.broken.has(id)) {
      throw new RunError(`Đã có văn phòng "${id}".`, 'other');
    }
    this.assertNameFree(name, id);

    const dir = path.join(this.paths.offices, id);
    const pp = officePaths(dir);
    ensureOfficeDirs(pp);
    fs.writeFileSync(pp.configFile, officeTemplate(id, name), 'utf8');
    fs.writeFileSync(pp.assistantSkills, ASSISTANT_SKILLS_DEFAULT, 'utf8');
    /**
     * KHÔNG tạo file charter, và không tạo node tri thức nào.
     *
     * Bản trước ghi sẵn `knowledge/shared/_charter.md` với frontmatter đầy đủ và
     * thân rỗng. Hậu quả: mỗi văn phòng mới đẻ ra một node ma trong ngăn kéo Tri
     * thức mà người dùng không tạo ra, không hiểu, và xoá đi thì hỏng một thứ
     * khác (xem `charter_file` trong types.ts).
     *
     * Giờ charter là `charter.md` ở gốc văn phòng và **chỉ tồn tại khi người
     * dùng thật sự viết gì đó** — `savePromptLayer` tạo file ở lần lưu đầu tiên.
     * Văn phòng mới có kho tri thức RỖNG THẬT, đúng như ngăn kéo đang nói.
     */

    const office = new Office(loadOffice(this.dir, this.config, id));
    office.bindBus((e) => this.emit(e));
    office.onUsage = (rec) => appendUsage(this.paths, rec);
    this.offices.set(id, office);

    this.emit({ type: 'company.offices', say: `Đã tạo văn phòng "${name}".`, office: id, plan_id: null });
    return office;
  }

  /**
   * Đổi tên hiển thị một văn phòng. Mã (thư mục) giữ nguyên — xem `Office.rename`.
   *
   * Kiểm trùng ở ĐÂY chứ không ở `Office`: chỉ công ty mới nhìn thấy các văn
   * phòng khác. Office tự chứa và không biết hàng xóm là ai — đó là điều kiện để
   * zip một thư mục `offices/<id>/` ra thành template chạy được ở máy khác.
   */
  /**
   * ⚠ TRẢ VỀ CẢ `id`, và người gọi BẮT BUỘC phải dùng nó.
   *
   * Đổi tên có thể **dời thư mục và thay hẳn instance `Office`** trong map
   * (`moveOffice`). Mọi handle lấy TRƯỚC lời gọi này đều thành ma: `office.id`
   * của nó vẫn là id cũ, và `office.loaded.dir` trỏ vào một thư mục không còn
   * tồn tại. Bản trước chỉ trả về cái TÊN, nên `server.ts` không có đường nào
   * biết id đã đổi — nó dựng response từ handle cũ, client thấy `id` cũ, rồi
   * mọi lời gọi sau đó 404 cho tới khi người dùng F5. → bug user báo 22/08
   */
  renameOffice(officeId: string, name: string): { name: string; id: string } {
    const office = this.get(officeId);
    const next = normalizeName(name);
    if (!nameKey(next)) {
      throw new RunError('Tên văn phòng cần có ít nhất một chữ cái hoặc số.', 'other');
    }
    this.assertNameFree(next, officeId);

    const moveTo = this.renameTarget(officeId, next);
    if (moveTo && office.currentState === 'working') {
      throw new RunError(
        'Văn phòng đang chạy việc, chưa đổi tên thư mục được. Bấm Dừng rồi thử lại — ' +
          'hoặc đổi tên sau khi việc xong.',
        'other',
      );
    }
    // `silent` khi sắp dời: sự kiện của `Office` mang id CŨ, và nó tới tay
    // trình duyệt SAU khi thư mục đã dời → client đuổi theo một id chết rồi ăn
    // 404. Ta tự phát một sự kiện mang id MỚI ở cuối hàm. → `Office.rename`
    const applied = office.rename(next, moveTo ? { silent: true } : undefined);
    if (moveTo) this.moveOffice(officeId, moveTo);

    this.emit({
      type: 'company.offices',
      say: moveTo
        ? `Đã đổi tên văn phòng thành "${applied}", và thư mục trên đĩa cũng đổi theo.`
        : `Đã đổi tên văn phòng thành "${applied}".`,
      office: moveTo ?? officeId,
      plan_id: null,
    });
    return { name: applied, id: moveTo ?? officeId };
  }

  /**
   * Id mới nếu đổi tên KÉO THEO cả thư mục, `undefined` nếu giữ nguyên id.
   * → docs/SPEC-offices.md §3
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MỘT LUẬT, KHÔNG PHẢI MỘT BẢNG ĐIỀU KIỆN. (user chốt 22/08)               │
   * │                                                                          │
   * │ Bản đề xuất trước là *"chỉ đổi thư mục khi văn phòng còn trắng"*. User   │
   * │ bác đúng: **một cơ chế lúc chạy lúc không thì người dùng không đoán      │
   * │ nổi** — tệ hơn cả không có. Luật ở đây chỉ có một câu:                    │
   * │                                                                          │
   * │   **Đổi thư mục khi và chỉ khi tên mới cho ra một slug thật.**            │
   * │                                                                          │
   * │ `slugId` chứ KHÔNG phải `folderId` — và đó là cả sự khác biệt. Đổi từ    │
   * │ "Kế toán" sang "会计部" mà đem băm thì `ke-toan` biến thành `vp-ee6fd8`:  │
   * │ một cái tên đọc được đổi thành một cái vô nghĩa, để phục vụ đúng con số  │
   * │ không ai nhìn. `folderId` chỉ dùng lúc TẠO, khi chưa có gì để mất.       │
   * │                                                                          │
   * │ Hệ quả (user hỏi thẳng, và đúng): tên phi-Latin ⇒ **id đứng yên**, chỉ   │
   * │ đổi phía nhìn — kể cả khi tên cũ là Latin. Với thị trường dùng chữ       │
   * │ phi-Latin thì đổi tên thư mục **không đổi gì cả**, và nút 📂 mới là thứ  │
   * │ phục vụ họ. Hai cơ chế bổ sung nhau, không thay nhau.                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private renameTarget(officeId: string, name: string): string | undefined {
    const next = slugId(name);
    if (!next || next === officeId) return undefined;
    // Trùng với một văn phòng khác (kể cả cái đang hỏng) thì GIỮ NGUYÊN id thay
    // vì ném: người dùng chỉ muốn đổi cái nhãn, và cái nhãn thì không trùng —
    // `assertNameFree` đã kiểm rồi. Chặn ở đây là từ chối một việc hợp lệ.
    if (this.offices.has(next) || this.broken.has(next)) return undefined;
    return next;
  }

  /**
   * Dời `offices/<cũ>/` → `offices/<mới>/` rồi dựng lại Office ở chỗ mới.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐO TRƯỚC KHI XÂY — hai nỗi lo lớn nhất đều KHÔNG có thật:               │
   * │                                                                          │
   * │  · **Prompt cache**: `prompt.ts` không chứa `office.dir`/`office.id` ở    │
   * │    đâu cả, mọi đường dẫn trong prefix đều tương đối. Dời thư mục ⇒ 0 lần │
   * │    ghi lại cache.                                                        │
   * │  · **Trí nhớ Trợ lý**: đã thử thật — nói một mã ở `bao-cao`, đổi tên     │
   * │    thành `kiem-ke`, rồi `resume` cùng session id: nó đọc lại đúng mã.    │
   * │    `resume` KHÔNG bám theo cwd.                                          │
   * │                                                                          │
   * │ Nạn nhân duy nhất là `logs/usage.jsonl` — nó nằm ở cấp CÔNG TY (không đi │
   * │ theo thư mục) và mang `office: "<id>"` ở 315/317 dòng. Giải bằng một bản │
   * │ ghi ALIAS nối vào cuối sổ: append-only được giữ nguyên, không viết lại   │
   * │ một dòng lịch sử nào. → `usage.ts`                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Chặn khi đang chạy việc: Windows khoá file đang mở, và một lượt worker
   * ghi vào `artifacts/` giữa lúc thư mục bị dời là hỏng nửa chừng. Cùng luật
   * với `archiveOffice`.
   */
  private moveOffice(officeId: string, nextId: string): void {
    const from = path.join(this.paths.offices, officeId);
    const to = path.join(this.paths.offices, nextId);
    if (fs.existsSync(to)) throw new RunError(`Thư mục "${nextId}" đã tồn tại.`, 'other');

    fs.renameSync(from, to);
    appendRename(this.paths, officeId, nextId);

    this.offices.delete(officeId);
    const office = new Office(loadOffice(this.dir, this.config, nextId));
    office.bindBus((e) => this.emit(e));
    office.onUsage = (rec) => appendUsage(this.paths, rec);
    this.offices.set(nextId, office);
  }

  /** Không cho hai văn phòng mang cùng một cái tên. `exceptId` = chính nó khi đổi tên. */
  private assertNameFree(name: string, exceptId: string): void {
    const key = nameKey(name);
    for (const o of this.offices.values()) {
      if (o.id === exceptId) continue;
      if (nameKey(o.name) === key) {
        throw new RunError(
          `Đã có văn phòng tên "${o.name}". Hai văn phòng trùng tên thì ô chọn ở đầu ` +
            `màn hình hiện hai dòng y hệt nhau — đặt tên khác đi.`,
          'other',
        );
      }
    }
  }

  /**
   * Đổi cấu hình model của công ty (mức nào chạy model nào, Trợ lý/lập kế hoạch
   * chạy mức nào). → docs/SPEC-offices.md §4.5
   *
   * Ghi bằng `parseDocument` để giữ nguyên chú thích trong company.yaml, rồi
   * ĐỌC LẠI QUA SCHEMA thay vì tự vá object trong bộ nhớ — file trên đĩa là
   * nguồn sự thật, và đọc lại là cách duy nhất chắc chắn hai bên không lệch.
   *
   * KHÔNG dựng lại các Office: làm thế là vứt mất kế hoạch đang chạy, hòm thư và
   * scheduler của chúng. Chỉ đưa cấu hình mới vào, và mỗi Office tự dựng một
   * `LoadedOffice` MỚI (ca đang chạy giữ nguyên bản cũ). → `Office.applyCompanyConfig`
   */
  updateModels(patch: Record<string, string>): CompanyConfig['models'] {
    const allowed = new Set(['eco', 'standard', 'deep', 'master', 'planner']);
    const entries = Object.entries(patch).filter(([k]) => allowed.has(k));
    if (entries.length === 0) throw new RunError('Không có trường model nào hợp lệ.', 'other');

    for (const [key, value] of entries) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new RunError(`Giá trị cho "${key}" không được để trống.`, 'other');
      }
      if ((key === 'master' || key === 'planner') && !TIERS.includes(value as never)) {
        throw new RunError(`"${key}" phải là một MỨC: ${TIERS.join(', ')}.`, 'other');
      }
    }

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('models')) doc.set('models', {});
    for (const [key, value] of entries) doc.setIn(['models', key], value.trim());
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: 'Đã đổi model. Việc đang chạy giữ nguyên model cũ cho tới khi xong.',
      office: '',
      plan_id: null,
    });
    return this.config.models;
  }

  /**
   * CẮM MỘT CÁNH TAY. → docs/SPEC-arms.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ KHÔNG CẦN RESTART, VÀ KHÔNG CẦN `setMcpServers`.                         │
   * │                                                                          │
   * │ 📖 SDK có `Query.setMcpServers()` để cắm/rút giữa phiên. Ta KHÔNG dùng,   │
   * │ và lý do là kiến trúc chứ không phải lười: **worker là `query()` one-shot │
   * │ nên lượt sau tự đọc cấu hình mới**, còn phiên dài duy nhất (Trợ lý)       │
   * │ KHÔNG BAO GIỜ cầm MCP (MCP phá prompt cache khi `resume` — `types.ts:499`).│
   * │ ⇒ `applyCompanyConfig` là đủ, đúng như `updateModels` ngay trên.          │
   * │                                                                          │
   * │ Đây là lý do bước `stop`/`start` ở bài 10 bước B7 biến mất — không phải   │
   * │ nhờ một API mới, mà nhờ một ràng buộc đã có sẵn từ đầu.                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Bí mật đi vào `.state/secrets.json` (đã gitignore, và từ 23/08 nhân viên
   * không đọc được — `paths.ts §guardedZone`). Cấu hình đi vào `company.yaml`,
   * nơi commit lên git được. **Giá trị chìa không bao giờ nằm trong company.yaml.**
   */
  addArm(input: {
    /** Tên hiển thị. KHÔNG phải danh tính — danh tính là băm cấu hình. */
    label?: string;
    config: Record<string, unknown>;
    catalog?: string;
    /** TÊN chìa cần có. Vào băm, và vào `role.secrets` lúc giao. */
    secretNames?: string[];
    secrets?: Record<string, string>;
    /**
     * VIỆC ĐƯỢC CẤP, đã giải từ `annotations` lúc cắm. Rỗng/vắng ⇒ cả server.
     * → `types.ts §arms.tools` · `server.ts §readOnlyTools`
     *
     * ⚠ Trường này TỪNG BỊ NUỐT IM LẶNG (bắt 25/08): `server.ts` truyền
     * `...(tools.length ? { tools } : {})` vào đây trong khi kiểu ở đây chưa
     * khai nó — và **spread KHÔNG kích hoạt excess-property check** của
     * TypeScript. Typecheck xanh, test xanh, tính năng **không làm gì cả**.
     * Cùng lớp bẫy với `SHELL_ALIASES` và `tools` của SDK: *allowlist im lặng
     * bỏ phần tử lạ*. → [[agentco-silent-allowlist]]
     */
    tools?: string[];
    /**
     * NẤC QUYỀN, và nó **đi vào băm**. → `catalog.ts §armHash` · §6j
     *
     * ⚠ Vắng ⇒ băm y hệt bản trước 26/08. Đó không phải tiện tay: mọi cánh tay
     * đã tồn tại phải giữ nguyên mã, nếu không một lần nâng cấp làm mồ côi cả
     * `company.yaml` của người dùng.
     */
    level?: 'read' | 'add' | 'full';
    /** Văn phòng sắp dùng nó — cần cho luật "một thư mục, một cánh tay". */
    office?: string;
  }): string {
    const secretNames = [...new Set(input.secretNames ?? Object.keys(input.secrets ?? {}))].sort();
    /**
     * Danh tính do MÁY sinh, không do người gõ. Cùng cấu hình ⇒ cùng khoá ⇒
     * "cắm trùng" là chuyện KHÔNG THỂ XẢY RA, thay vì chuyện phải nhớ đi kiểm
     * ở bốn chỗ. → `catalog.ts §armHash`
     */
    const id = armHash(input.config, secretNames, input.level);
    if (!input.config || typeof input.config !== 'object') {
      throw new RunError('Thiếu cấu hình cho cánh tay này.', 'other');
    }
    /**
     * ⚠ TRÙNG MÃ = GHI ĐÈ IM LẶNG, và user bắt được ngay lượt test đầu: cắm
     * `files` cho thư mục A rồi cắm `files` cho thư mục B thì A biến mất, không
     * một câu nào. Node trên sơ đồ vẫn y nguyên (cùng id), mọi sợi dây vẫn y
     * nguyên — chỉ thư mục bên dưới đổi. **Không có triệu chứng ở chỗ nó nằm.**
     *
     * Từ chối, KHÔNG tự đổi tên hộ: đổi thành `files-2` là ô `viết lại lặng lẽ`
     * — người dùng gõ một cái tên và nhận về một cái khác. Câu từ chối nêu luôn
     * hai đường đi tiếp, vì "đã tồn tại" mà không nói làm gì tiếp là bỏ họ ở đó.
     *
     * ⚠ Một cánh tay `filesystem` nhận NHIỀU thư mục cùng lúc (đo 23/08:
     * `connected` với 2 gốc) — nên "hai thư mục" thường KHÔNG cần hai cánh tay.
     */
    /**
     * ĐÃ CÓ TRONG SỔ = tái dùng, KHÔNG phải lỗi.
     *
     * Đây là chỗ "cắm lại thì tìm thấy" thành hiện thực: người dùng xoá cánh
     * tay khỏi văn phòng rồi cắm lại đúng thư mục đó ⇒ cùng băm ⇒ ta lấy lại
     * nguyên cấu hình + tên + tên chìa, không hỏi lại một câu nào.
     *
     * Chỉ chặn khi văn phòng NÀY đang dùng nó rồi — và câu chặn nói ra cách đi
     * tiếp (kéo dây), vì "đã có" mà không chỉ đường là một ngõ cụt.
     */
    if (input.office && this.armInUse(input.office, id)) {
      const label = this.config.arms[id]?.label || id;
      throw new RunError(
        `Văn phòng này đã có kết nối "${label}". Kéo dây từ nó sang nhân viên cần dùng — ` +
          `một kết nối dùng chung được cho nhiều người.`,
        'other',
      );
    }

    /**
     * MỘT THƯ MỤC, MỘT CÁNH TAY — trong phạm vi MỘT văn phòng. → `catalog.ts §coveredBy`
     *
     * Chỉ so với những cánh tay ĐANG CÓ DÂY ở văn phòng này, không so cả công
     * ty: hai văn phòng cùng trỏ vào `D:\Ho so` là hợp lệ và có chủ ý (clone
     * độc lập, user chốt). Ranh giới của luật này là ranh giới của cái sơ đồ.
     */
    const want = folderRoots(input.config);
    if (input.office && want.length) {
      const office = this.get(input.office);

      // Thư mục văn phòng / công ty: thừa VÀ đi vòng qua hàng rào `.state/`.
      // → `catalog.ts §swallowsOffice`
      const bad = want.find((r) => swallowsOffice(r, office.loaded.dir, this.dir));
      if (bad) {
        throw new RunError(
          `"${bad}" chứa chính thư mục làm việc của văn phòng. Nhân viên đã đọc-ghi được ở đó sẵn ` +
            `mà không tốn token nào, nên cắm thêm là trả tiền cho thứ đang có. Chọn một thư mục bên ngoài.`,
          'other',
        );
      }

      const used = new Set<string>();
      for (const [roleId, role] of office.loaded.roles) {
        if (office.loaded.archivedRoles.has(roleId)) continue;
        for (const s of role.mcp) used.add(s);
      }
      const existing = [...used].map((s) => ({ id: s, folders: folderRoots(this.config.mcpServers[s]) }));
      const clash = coveredBy(existing, want);
      if (clash) {
        throw new RunError(
          `Thư mục này đã nằm trong kết nối "${clash.id}" của văn phòng. ` +
            `Nối thẳng "${clash.id}" vào nhân viên cần nó — một kết nối dùng chung được cho nhiều người, ` +
            `và cắm thêm cái thứ hai là trả token hai lần cho cùng một thứ.`,
          'other',
        );
      }
    }

    // Chìa TRƯỚC cấu hình: nếu ghi cấu hình xong mới hỏng ở bước chìa thì trên
    // sơ đồ đã có một node trỏ vào một tiến trình không bao giờ khởi động được.
    const secrets = input.secrets ?? {};
    if (Object.keys(secrets).length) {
      const pp = companyPaths(this.dir);
      writeSecrets(pp, { ...readSecrets(pp), ...secrets });
    }

    /**
     * ⚠ `createNode` mặc định ra FLOW style, và flow LÂY từ map cha xuống: cả
     * cấu hình dồn vào một dòng, đường dẫn Windows không được nháy. `company.yaml`
     * là file người dùng ĐỌC và commit lên git — nó phải trông như ví dụ đã
     * comment sẵn ngay phía trên khoá này.
     *
     * Ép block cho map ở cả hai tầng. `args` cũng ra block theo — hơi khác ví
     * dụ đã comment, nhưng đọc tốt hơn với tên gói dài kèm số phiên bản ghim.
     */
    const block = (n: unknown) => {
      if (n && typeof n === 'object') (n as { flow?: boolean }).flow = false;
      return n;
    };
    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('mcpServers')) doc.set('mcpServers', block(doc.createNode({})));
    if (!doc.has('arms')) doc.set('arms', block(doc.createNode({})));
    block(doc.get('mcpServers', true));
    block(doc.get('arms', true));
    doc.setIn(['mcpServers', id], block(doc.createNode(input.config)));
    // Giữ nhãn cũ nếu mục đã có trong sổ — người dùng cắm lại một thứ từng đặt
    // tên thì cái tên đó là của họ, đừng lặng lẽ thay bằng tên mặc định.
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ BỐN NẤC, và thứ tự là thứ tự ĐỘ TIN CẬY của cái tên. (user 31/08)  │
     * │                                                                    │
     * │  ① sổ chung   cắm lại thứ từng đặt tên ⇒ tên đó là **của họ**       │
     * │  ② người gõ   khoá trong `{"mcpServers":{"so-tay":…}}`, hoặc tên    │
     * │               mục danh mục. Tên **chuẩn**, do một con người viết ra │
     * │  ③ suy từ cấu hình  `deepwiki.com` · `server-memory` — máy suy, đọc │
     * │               được, và đúng trong đa số ca                          │
     * │  ④ băm        thật thà, nhưng vô nghĩa với người đọc                │
     * │                                                                    │
     * │ Nấc ③ mới thêm. Trước đó ② rơi thẳng xuống ④, nên khối JSON **trần** │
     * │ (không có vỏ `mcpServers`) luôn ra một cái băm.                     │
     * │                                                                    │
     * │ ⚠ Và từ 30/08 nó KHÔNG còn chỉ là chuyện thẩm mỹ: `armReach` dựng    │
     * │ dòng danh bạ bằng `label || id`, nên nhãn rỗng nghĩa là **Trợ lý     │
     * │ nhìn thấy một cái băm làm tên cánh tay** — đúng ca §16r, nơi một cái │
     * │ tên model không có tiên nghiệm khiến nó **lấp chỗ trống**.          │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const label =
      this.config.arms[id]?.label || input.label?.trim() || defaultArmLabel(input.config) || id;
    /**
     * ⚠ `tools` cũng phải GHI RA ĐĨA, không chỉ nhận vào tham số. Cắm lại một
     * cánh tay đã biết thì lấy lại danh sách cũ — cùng lý lẽ với `label` ngay
     * trên: cùng băm nghĩa là **cùng cấu hình**, nên tập việc đã giải vẫn đúng.
     */
    /**
     * ⚠ Với tờ khai CLI, danh sách việc suy được **từ chính tờ khai**, không phải
     * chờ một lượt `probeArm`. Thiếu nó thì `pickMcp` cấp **cả server**
     * (`mcp__<băm>`) — rộng hơn thứ ta định cấp, và im lặng. Cùng cái lỗ
     * `arms[].tools` sinh ra để đóng, chỉ khác nguồn dữ liệu.
     */
    const tools = input.tools?.length
      ? input.tools
      : cliToolNames(input.config).length
        ? cliToolNames(input.config)
        : (this.config.arms[id]?.tools ?? []);
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 `does` — TRƯỜNG CÓ SCHEMA, CÓ NGƯỜI ĐỌC, **CHƯA AI GHI** (tới 31/08)│
     * │                                                                      │
     * │ Bản vá 30/08 dựng `types.ts §arms.does` và `assistant.ts §armReach`   │
     * │ đọc nó, rồi dừng ở đó: không cửa nào trong sản phẩm ghi trường này —  │
     * │ chỉ spike ghi bằng tay. Nên năng lực *"cánh tay tự khai làm được gì"* │
     * │ **chưa từng chạy trong app một lần nào**, và không có test nào đỏ vì  │
     * │ trường vắng là hợp lệ (`.default([])`).                              │
     * │                                                                      │
     * │ Đo được cái giá của nó ngay hôm nay: cùng một câu hỏi, cùng cánh tay  │
     * │ — nhãn trần ⇒ Trợ lý **không giao việc**; có `does` ⇒ giao việc, gọi  │
     * │ thật, đúng số, **4/4 lượt**. → SPEC-arms §16r · §16s                  │
     * │                                                                      │
     * │ ⚠ Nguồn là `say` của từng action (câu tiếng người), KHÔNG phải `id`:  │
     * │ `dem_hoa_don` là tên máy, và §7b cấm dán tên tool thô vào danh bạ.    │
     * │ Trần 4 việc — dòng danh bạ đi vào prefix **mọi lượt `route()`**.      │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const does = cliSays(input.config).length
      ? cliSays(input.config)
      : (this.config.arms[id]?.does ?? []);
    doc.setIn(
      ['arms', id],
      block(
        doc.createNode({
          label,
          ...(input.catalog ? { catalog: input.catalog } : {}),
          secrets: secretNames,
          ...(tools.length ? { tools } : {}),
          ...(does.length ? { does } : {}),
          // Nấc quyền — đã nằm trong băm, ghi ra để người dùng ĐỌC ĐƯỢC bằng mắt
          // thay vì phải tin cái huy hiệu trên giao diện. → §6j
          ...(input.level ? { level: input.level } : {}),
        }),
      ),
    );
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: `Đã cắm "${label}". Nhân viên được nối dây sẽ dùng được ngay ở việc kế tiếp.`,
      office: '',
      plan_id: null,
    });
    return id;
  }

  /** Vai trò nào trong văn phòng này đang nối tới cánh tay `id`? */
  private armInUse(officeId: string, id: string): boolean {
    const office = this.offices.get(officeId);
    if (!office) return false;
    if (office.loaded.config.assistant.mcp.includes(id)) return true;
    for (const [roleId, role] of office.loaded.roles) {
      if (office.loaded.archivedRoles.has(roleId)) continue;
      if (role.mcp.includes(id)) return true;
    }
    return false;
  }

  /**
   * ĐỔI TÊN một cánh tay. Chỉ đụng `arms[id].label` — không ai tham chiếu tới
   * nhãn, nên đây là thao tác rẻ nhất trong cả hệ: không đổi khoá, không viết
   * lại `roles/*.yaml`, không phá cache của ai.
   *
   * Đó chính là lý do danh tính phải là BĂM chứ không phải cái tên: hồi `id`
   * còn là tên người dùng gõ, "đổi tên" là ĐỔI KHOÁ, kéo theo một cuộc di trú
   * nhỏ qua mọi vai trò của mọi văn phòng — mỗi lần bấm.
   */
  renameArm(id: string, label: string): string {
    const next = label.trim();
    if (!next) throw new RunError('Tên kết nối không được để trống.', 'other');
    if (!(id in this.config.mcpServers)) throw new RunError(`Không có kết nối "${id}".`, 'other');

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('arms')) doc.set('arms', doc.createNode({}));
    doc.setIn(['arms', id, 'label'], next);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );
    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);
    this.emit({ type: 'company.offices', say: `Kết nối giờ tên là "${next}".`, office: '', plan_id: null });
    return next;
  }

  /**
   * RÚT một cánh tay khỏi công ty.
   *
   * ⚠ **Chìa KHÔNG bị xoá theo.** Rút dây ≠ vứt chìa: người dùng hay rút để xoay
   * token hoặc thử một server khác, và bắt họ đi lấy lại token là phạt một thao
   * tác vốn vô hại. Muốn xoá chìa thì có đường riêng, có chủ ý.
   *
   * Cạnh nối `mcp→agent` sống trong `roles/*.yaml`; `layout.read()` tự bỏ qua
   * cạnh trỏ tới node không còn tồn tại, nên không cần dọn tay ở đây.
   */
  /**
   * XOÁ một cánh tay KHỎI MỘT VĂN PHÒNG. Sổ chung **không bị đụng**.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐỔI NGHĨA 23/08, và nó là thứ xoá được cả khái niệm "lưu trữ".           │
   * │                                                                          │
   * │ Bản trước xoá khỏi `company.yaml`, tức mất luôn cấu hình — nên mới cần   │
   * │ một mức "cất đi" ở giữa để giữ nó lại. Giờ cấu hình sống trong SỔ CHUNG   │
   * │ và không ai xoá nó, nên "xoá" đã mang đúng tính chất của "cất đi": cắm   │
   * │ lại cùng thư mục ⇒ cùng băm ⇒ tìm thấy nguyên vẹn.                       │
   * │                                                                          │
   * │ ⇒ Một mức thay vì hai. Nhân viên cần hai mức vì họ mang thứ dựng lại     │
   * │ không được; cánh tay chỉ mang cấu hình. Mượn khái niệm từ chỗ nó xứng    │
   * │ đáng sang chỗ nó không, là thứ ta vừa gỡ ra.                              │
   * │                                                                          │
   * │ Mất một thứ, nói ra: SỢI DÂY. Cắm lại phải nối lại. Với một cánh tay     │
   * │ phục vụ 1–2 người thì đó là một cú kéo — rẻ hơn hẳn việc nuôi cả một     │
   * │ khái niệm chỉ để cứu nó.                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ IDEMPOTENT: "xoá thứ đã không còn" phải THÀNH CÔNG. Một câu từ chối chỉ
   * đúng khi người dùng còn đường đi tiếp; ở đây không có đường nào, nên nó sẽ
   * là một ngõ cụt chứ không phải một lời từ chối.
   */
  removeArm(id: string, officeId?: string): void {
    const targets = officeId ? [this.get(officeId)] : [...this.offices.values()];
    for (const office of targets) office.dropArm(id);

    const label = this.config.arms[id]?.label || id;
    this.emit({
      type: 'company.offices',
      say: `Đã rút "${label}". Cắm lại lúc nào cũng được — cấu hình và chìa vẫn giữ.`,
      office: officeId ?? '',
      plan_id: null,
    });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ XOÁ HẲN khỏi SỔ CHUNG — mức thứ hai, và là mức DUY NHẤT không lấy lại    │
   * │ được. (user chốt 25/08: *"Người dùng nên chịu trách nhiệm với hành động  │
   * │ của mình"*)                                                              │
   * │                                                                          │
   * │ Vì sao nó cần tồn tại, và lý do mạnh nhất là luật của chính dự án này:   │
   * │ tới hôm nay, gỡ một mục mồ côi khỏi sổ chỉ làm được bằng cách **mở       │
   * │ `company.yaml` và sửa tay** — mà một bước "mở file yaml" là **chuông      │
   * │ báo** (§6a, chốt 22/08). Không có nút này thì `mcpServers:` chỉ có thể   │
   * │ dài ra, mãi mãi.                                                         │
   * │                                                                          │
   * │ ⚠ MỘT MỤC MỒ CÔI KHÔNG TỐN TOKEN — đừng bán tính năng này bằng lý do sai:│
   * │ `pickMcp` chỉ dựng server có tên trong `role.mcp`. Cái nó tốn là **chỗ   │
   * │ trong đầu người dùng**: danh sách "đã cắm ở văn phòng khác" dài dần bằng │
   * │ những thứ không ai còn nhớ là gì.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠⚠ **CHÌA KHÔNG BỊ XOÁ THEO** — và đây là thứ làm cho quyết định trên rẻ.
   *
   * Phần đắt của việc cắm một cánh tay là **đi lấy chìa**, không phải cấu hình.
   * Cấu hình dựng lại từ danh mục trong ba cú bấm; chìa thì phải sang tận trang
   * của hãng. Chìa sống ở `.state/secrets.json` **theo TÊN**, độc lập với sổ —
   * nên xoá nhầm mất cái rẻ, giữ lại cái đắt. Muốn bỏ chìa thì có đường riêng,
   * có chủ ý: `agentco secret rm <TÊN>`.
   *
   * ⚠ Chặn khi còn ai dùng, và "dùng" có HAI nghĩa — thiếu một nghĩa là xoá mất
   * một node đang nằm trên sơ đồ của ai đó:
   *   · `role.mcp`        — có sợi dây tới một nhân viên
   *   · `office.arms`     — **có mặt** trên sơ đồ, chưa nối dây (node chờ)
   */
  /**
   * Văn phòng nào còn giữ cánh tay này — theo CẢ HAI nghĩa của "giữ".
   *
   * ⚠ Một hàm, hai chỗ gọi: cái chốt trong `forgetArm` và cái cờ `orphan` mà
   * giao diện dùng để quyết có hiện nút xoá hẳn hay không. Tách làm hai bản là
   * mở đúng cửa cho một nút hiện ra rồi bấm vào thì bị từ chối — hoặc tệ hơn,
   * một nút KHÔNG hiện ra cho thứ đáng lẽ xoá được.
   */
  private armHolders(id: string): string[] {
    const out: string[] = [];
    for (const office of this.offices.values()) {
      const wired = [...office.loaded.roles.values()].some((r) => r.mcp.includes(id));
      if (wired || office.loaded.config.arms.includes(id)) out.push(office.loaded.config.name || office.id);
    }
    return out;
  }

  forgetArm(id: string): void {
    if (!(id in this.config.mcpServers)) throw new RunError(`Không có kết nối "${id}".`, 'other');

    const holders = this.armHolders(id);
    if (holders.length) {
      throw new RunError(
        `"${this.config.arms[id]?.label || id}" vẫn đang ở ${holders.length} văn phòng ` +
          `(${holders.join(', ')}). Rút khỏi từng chỗ trước đã — xoá hẳn một thứ đang được dùng ` +
          `là làm hỏng sơ đồ của người khác.`,
        'other',
      );
    }

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    doc.deleteIn(['mcpServers', id]);
    doc.deleteIn(['arms', id]);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );
    const label = this.config.arms[id]?.label || id;
    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);
    /**
     * ⚠ PHẢI BÁO, y như `removeArm`. Thiếu sự kiện này thì mọi tab khác (và
     * chính tab đang mở, nếu nó nghe SSE thay vì tự nạp lại) giữ cái mã vừa chết
     * cho tới khi người dùng F5 — đúng triệu chứng user báo 26/08.
     */
    this.emit({
      type: 'company.offices',
      say: `Đã xoá hẳn "${label}" khỏi sổ chung. Chìa vẫn được giữ.`,
      office: '',
      plan_id: null,
    });
  }

  /**
   * Tên WORKSPACE của một cánh tay — tra `arms[id].secrets` ra kho OAuth.
   *
   * Một hàm, hai chỗ gọi (`listArms` cho hộp thoại, `describeNode` cho bảng chi
   * tiết). Tách làm hai bản là để hai màn hình nói hai chuyện về cùng một cánh
   * tay — đúng thứ user vừa phàn nàn: *"1 loạt Notion thì biết là Notion nào"*.
   */
  armWorkspace(id: string): string | undefined {
    const names = this.config.arms[id]?.secrets ?? [];
    if (!names.length) return undefined;
    const oauth = readOAuth(companyPaths(this.dir));
    return names.map((s) => oauth[s]?.label).find(Boolean);
  }

  /** SỔ CHUNG + nơi nào đang dùng. → docs/SPEC-arms.md §6i */
  listArms(): {
    id: string;
    label: string;
    catalog?: string;
    config: unknown;
    /** TÊN chìa, không bao giờ giá trị — để giao diện nói "đã có sẵn, khỏi nhập lại". */
    secrets: string[];
    /** Nấc quyền — giao diện vẽ HUY HIỆU từ đây, KHÔNG từ chuỗi tên. → §6j */
    level?: 'read' | 'add' | 'full';
    /**
     * Tên WORKSPACE mà cánh tay này nối tới, tra từ kho OAuth.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ User 26/08: *"1 loạt Notion thì biết là Notion nào"*.                │
     * │                                                                      │
     * │ Suy từ `arms[].secrets` (tên chìa mang `workspace_id`) tra ngược ra   │
     * │ nhãn trong `$oauth` — **không** đọc chuỗi `label`. Nhãn là của người  │
     * │ dùng và đổi tự do; workspace là sự thật thuộc về cấu hình.           │
     * │                                                                      │
     * │ Vắng khi: cánh tay không dùng OAuth, hoặc workspace đã bị gỡ. Cả hai  │
     * │ đều là "không biết" ⇒ không vẽ gì, chứ không bịa một cái tên.         │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    via?: string;
    /** Số việc đã cấp. Hiện cạnh huy hiệu để nhãn "chỉ đọc" kiểm được bằng mắt. */
    toolCount: number;
    usedBy: { office: string; role: string }[];
    /**
     * KHÔNG văn phòng nào còn giữ — kể cả kiểu "có mặt trên sơ đồ mà chưa nối
     * dây". Chỉ mục như thế mới hiện nút **xoá hẳn**. Suy từ `usedBy` là sai:
     * `usedBy` chỉ đếm sợi dây, nên một node đang nằm chờ trên sơ đồ sẽ trông
     * như mồ côi. → `armHolders`
     */
    orphan: boolean;
  }[] {
    // Đọc kho MỘT LẦN cho cả danh sách: `readOAuth` parse cả file, mà một công
    // ty chạy lâu có hàng chục cánh tay — gọi trong vòng lặp là đọc lại cùng
    // một file hàng chục lần cho mỗi lần mở hộp thoại.
    const oauth = readOAuth(companyPaths(this.dir));
    return Object.entries(this.config.mcpServers).map(([id, config]) => {
      const usedBy: { office: string; role: string }[] = [];
      for (const office of this.offices.values()) {
        for (const [roleId, role] of office.loaded.roles) {
          if (role.mcp.includes(id)) usedBy.push({ office: office.id, role: roleId });
        }
      }
      const meta = this.config.arms[id];
      return {
        id,
        label: meta?.label || id,
        ...(meta?.catalog ? { catalog: meta.catalog } : {}),
        config,
        secrets: meta?.secrets ?? [],
        ...(meta?.level ? { level: meta.level } : {}),
        // Chìa nào của cánh tay này là một workspace đã nối ⇒ lấy nhãn của nó.
        // Không tìm thấy ⇒ không vẽ gì; bịa một cái tên còn tệ hơn để trống.
        ...(() => {
          const via = (meta?.secrets ?? []).map((s) => oauth[s]?.label).find(Boolean);
          return via ? { via } : {};
        })(),
        toolCount: meta?.tools?.length ?? 0,
        usedBy,
        orphan: this.armHolders(id).length === 0,
      };
    });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ DÙNG LẠI MỘT CÁNH TAY ĐÃ CÓ TRONG SỔ — trọn gói, kể cả CHÌA. (bug 25/08) │
   * │                                                                          │
   * │ User báo: cắm Notion ở *Cánh tay* xong, sang *Trợ lý cá nhân* bấm "dùng  │
   * │ lại" thì **401**. Và câu hỏi kèm theo là câu đúng:                       │
   * │   *"Về lý thuyết văn phòng nào cũng có thể xài chung?"* — ĐÚNG, và đây   │
   * │ là hàm làm cho nó đúng.                                                  │
   * │                                                                          │
   * │ Vì sao nó hỏng: nút "dùng lại" cũ **dán cấu hình** sang đường "tự cắm"   │
   * │ (`setPaste(JSON.stringify(a.config))`). Mà cấu hình trong sổ giữ Ô TRỐNG │
   * │ `${NOTION_ACCESS_TOKEN}` — chìa nằm ở `.state/secrets.json`, đúng thiết  │
   * │ kế. Đường "tự cắm" không có mục danh mục ⇒ không hiện ô chìa ⇒ không     │
   * │ gửi chìa nào ⇒ header bay lên Notion **nguyên văn `Bearer ${…}`** ⇒ 401. │
   * │                                                                          │
   * │ Và một hỏng thứ hai, im lặng hơn: `secretNames` khi ấy là `[]`, mà TÊN   │
   * │ CHÌA NẰM TRONG BĂM (§armHash) ⇒ băm khác ⇒ nó tạo một cánh tay THỨ HAI   │
   * │ trùng cấu hình thay vì dùng lại cái đã có. "Dùng lại" mà nhân bản.       │
   * │                                                                          │
   * │ ⇒ Danh tính đi trọn gói hoặc không đi: cấu hình + tên chìa + việc được   │
   * │ cấp, cả ba lấy từ SỔ, không cái nào đi vòng qua client.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ `secrets` trong kết quả là GIÁ TRỊ THẬT — chỉ để đưa xuống `probeArm`.
   * Nó KHÔNG BAO GIỜ được lọt vào một phản hồi HTTP. Cùng luật với `pickMcp`.
   */
  reuseArm(id: string): {
    config: Record<string, unknown>;
    secretNames: string[];
    tools: string[];
    label: string;
    catalog?: string;
    level?: 'read' | 'add' | 'full';
    secrets: Record<string, string>;
  } {
    const config = this.config.mcpServers[id];
    if (!config) {
      throw new RunError(
        `Không còn kết nối "${id}" trong sổ chung — có lẽ nó vừa bị gỡ. Đóng hộp thoại rồi mở lại.`,
        'other',
      );
    }
    const meta = this.config.arms[id];
    const secretNames = meta?.secrets ?? [];
    // Chỉ đọc đúng những chìa cánh tay này khai — không bê cả kho. `grantFor`
    // cũng là chỗ chuỗi rỗng bị tính là THIẾU, nên chìa lưu hỏng lộ ra ở đây
    // thay vì lộ ra bằng một câu 401 ở Notion.
    const { env } = grantFor(readSecrets(companyPaths(this.dir)), secretNames);
    return {
      config: config as Record<string, unknown>,
      secretNames,
      tools: meta?.tools ?? [],
      label: meta?.label || id,
      ...(meta?.catalog ? { catalog: meta.catalog } : {}),
      // Nấc đi theo trọn gói — thiếu nó thì `addArm` băm lại KHÔNG có nấc và ra
      // một mã khác, tức "dùng lại" lại nhân bản. Đúng bug §6i-bis, cửa thứ hai.
      ...(meta?.level ? { level: meta.level } : {}),
      secrets: env,
    };
  }

  /**
   * LƯU TRỮ / KHÔI PHỤC một văn phòng (soft delete). → docs/SPEC-offices.md §3.1
   *
   * Chỉ gắn một cờ trong `office.yaml`. Không dời file, không đổi mã, không đụng
   * tới `artifacts/` hay session của Trợ lý — nên khôi phục là trở lại nguyên
   * vẹn, kể cả cuộc hội thoại đang dở.
   *
   * Văn phòng đang chạy phải Dừng trước: cất một thứ đang tiêu tiền vào kho là
   * cách chắc chắn nhất để nó tiêu tiếp mà không ai nhìn.
   */
  archiveOffice(officeId: string, archived: boolean): void {
    const office = this.get(officeId);
    if (archived && office.currentState === 'working') {
      throw new RunError('Văn phòng đang chạy việc. Bấm Dừng trước đã.', 'other');
    }
    // Khôi phục xong mà trùng tên với một văn phòng đang sống thì ô chọn hiện
    // hai dòng y hệt nhau. Kiểm ở đây, trước khi ghi.
    if (!archived) this.assertNameFree(office.name, officeId);

    const file = office.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (archived) doc.set('archived', true);
    else doc.delete('archived');
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
    office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: archived
        ? `Đã cất văn phòng "${office.name}" vào lưu trữ. Khôi phục được bất cứ lúc nào.`
        : `Đã khôi phục văn phòng "${office.name}".`,
      office: officeId,
      plan_id: null,
    });
  }

  /**
   * XOÁ HẲN: `rm -rf` cả thư mục. Nhân viên, kỹ năng, kho tri thức, kết quả — mất sạch.
   *
   * Không lấy lại được, và sổ chi phí sau đó chỉ còn cái MÃ để lần ra những dòng
   * tiền của nó. Đó chính là lý do lưu trữ tồn tại và là mức nên dùng.
   */
  removeOffice(officeId: string): void {
    const office = this.offices.get(officeId);
    if (!office && !this.broken.has(officeId)) {
      throw new RunError(`Không có văn phòng "${officeId}".`, 'other');
    }
    if (office?.currentState === 'working') {
      throw new RunError('Văn phòng đang chạy việc. Bấm Dừng trước đã.', 'other');
    }
    if (!isSafeId(officeId)) throw new RunError('Mã văn phòng không hợp lệ.', 'other');

    this.offices.delete(officeId);
    this.broken.delete(officeId);
    fs.rmSync(path.join(this.paths.offices, officeId), { recursive: true, force: true });
    this.emit({
      type: 'company.offices',
      say: `Đã xoá hẳn văn phòng "${officeId}".`,
      office: officeId,
      plan_id: null,
    });
  }

  // ── sự kiện

  on(fn: (e: AgentEvent) => void): () => void {
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }

  emit(e: AgentEvent): void {
    this.recent.push(e);
    if (this.recent.length > 300) this.recent.shift();
    this.bus.emit('event', e);
  }

  /** Vòng đệm để client kết nối muộn vẫn thấy được chuyện vừa xảy ra. */
  history(officeId?: string): AgentEvent[] {
    return officeId ? this.recent.filter((e) => e.office === officeId) : [...this.recent];
  }

  // ── chi phí: một sổ cho cả công ty

  costReport(sinceMs?: number, officeId?: string): CostReport {
    return summarize(this.usageRecords(sinceMs, officeId));
  }

  costText(sinceMs?: number, officeId?: string): string {
    return formatReport(this.costReport(sinceMs, officeId));
  }

  /**
   * Chi phí tách theo văn phòng — để thấy văn phòng nào đang ăn hết hạn mức.
   *
   * `gone: true` = văn phòng không còn trên đĩa (xoá hẳn), hoặc bản ghi có từ
   * TRƯỚC khi có khái niệm văn phòng (v0, cột `office` rỗng). Giao diện gom
   * những dòng này vào một khối đóng/mở — **gộp để HIỂN THỊ, không gộp DỮ
   * LIỆU**: danh sách không dài ra theo số văn phòng đã xoá, mà bung ra vẫn thấy
   * đủ từng dòng và từng cái mã. Cộng chúng lại thành một cục "đã xoá" thì cái
   * mã mất, và cái mã là manh mối duy nhất còn lại để biết tiền đã đi đâu.
   */
  costByOffice(sinceMs?: number): Array<{
    office: string;
    name: string;
    tasks: number;
    costUSD: number;
    turns: number;
    archived: boolean;
    gone: boolean;
  }> {
    const LEGACY = '';
    /**
     * Gộp qua bảng ĐỔI TÊN trước khi cộng. → `usage.ts §renameChain`
     *
     * Không có dòng này thì đổi tên `bao-cao` → `kiem-ke` làm sổ tách làm hai
     * mục: một mục "kiem-ke" mới tinh, và một mục "bao-cao" bị đánh dấu `gone`
     * — tức là giao diện nói với người dùng rằng họ có một văn phòng đã xoá,
     * trong khi họ chỉ đổi tên. Đúng loại nói dối mà cuốn sổ này không được phép.
     */
    const chain = renameChain(this.paths);
    const byOffice = new Map<string, { tasks: number; costUSD: number; turns: number }>();
    for (const r of this.usageRecords(sinceMs)) {
      const key = (r.office && (chain.get(r.office) ?? r.office)) || LEGACY;
      const e = byOffice.get(key) ?? { tasks: 0, costUSD: 0, turns: 0 };
      e.tasks++;
      e.costUSD += r.cost_usd;
      e.turns += r.turns ?? 0;
      byOffice.set(key, e);
    }
    return [...byOffice.entries()]
      .map(([office, v]) => {
        const live = this.offices.get(office);
        return {
          office,
          // Nói đúng sự thật cho từng ca: mã cũ đã xoá thì hiện MÃ (manh mối duy
          // nhất còn lại); bản ghi v0 thì nói rõ nó có trước khi tách văn phòng,
          // chứ không gọi là "đã xoá" — không có văn phòng nào bị xoá ở đó cả.
          name: live?.name ?? (office === LEGACY ? '(trước khi tách văn phòng)' : office),
          ...v,
          archived: live?.archived ?? false,
          gone: !live,
        };
      })
      .sort((a, b) => b.costUSD - a.costUSD);
  }

  /**
   * Bản ghi chi phí, lọc theo văn phòng nếu có.
   *
   * ⚠ Lọc phải nhận CẢ id cũ đã đổi tên. Thiếu chỗ này thì
   * `agentco cost --office kiem-ke` trả về đúng những gì tiêu SAU khi đổi tên,
   * và toàn bộ lịch sử trước đó biến mất không dấu vết — người dùng thấy văn
   * phòng chạy hai tháng mà sổ chỉ ghi hai ngày. → `usage.ts §renameChain`
   */
  private usageRecords(sinceMs?: number, officeId?: string): UsageRecord[] {
    const all = readUsage(this.paths, sinceMs);
    if (!officeId) return all;
    const chain = renameChain(this.paths);
    return all.filter((r) => r.office === officeId || chain.get(r.office ?? '') === officeId);
  }
}

// ─────────────────────────────────────────────────────────── mẫu

function officeTemplate(id: string, name: string): string {
  return `id: ${id}
name: ${JSON.stringify(name)}
charter_file: charter.md

assistant:
  display_name: "Trợ lý"
  avatar: "★"

  # Kết quả rơi xuống đâu khi yêu cầu không nghiêng hẳn về bên nào:
  #   file  - người dùng MỞ file (bài viết, báo cáo, bảng, hợp đồng)
  #   reply - người dùng ĐỌC câu trả lời ngay trong ô chat (hỏi đáp, tra cứu)
  # Task "reply" VẪN ghi file như thường; nó chỉ thôi bắt người ta đi mở file.
  # Văn phòng chuyên hỏi-đáp thì đổi dòng này thành reply.
  default_deliver: file

  # MCP/API mà Trợ lý "dùng được". Thực chất chúng được gắn cho một worker ẩn
  # chạy phía sau, KHÔNG gắn thẳng vào Trợ lý: Trợ lý là session dài, resume
  # liên tục, mà MCP phá prompt cache khi resume -> mất rất nhiều token MỖI LƯỢT
  # trò chuyện. Cắm bằng cách kéo dây trên sơ đồ.
  mcp: []
`;
}

/**
 * Skills mặc định của Trợ lý — CỐ Ý rất ngắn, và CỐ Ý không nói gì với người dùng.
 *
 * Khối này nằm trong prefix cache của MỌI lượt trò chuyện, nên mỗi dòng ở đây là
 * một khoản thuế thu suốt ca làm việc. Bản đầu tiên mở bằng câu "Đây là phần BẠN
 * viết, xoá sạch cũng được" — một lời nhắn gửi NGƯỜI DÙNG, nằm trong prompt gửi
 * cho MODEL. Model không sửa được file, nên câu đó chỉ là nhiễu có phí.
 *
 * Lời giải thích "bạn sửa được cái này" đã chuyển vào bảng prompt phân lớp trên
 * giao diện, nơi người dùng thật sự đọc nó, và nơi nó không tốn token nào.
 */
const ASSISTANT_SKILLS_DEFAULT = `Xưng "mình", gọi người dùng là "bạn". Nói ngắn, không khách sáo.

Khi yêu cầu còn mơ hồ ở chỗ ảnh hưởng tới kết quả (làm cho ai, dài bao nhiêu,
giọng thế nào, dựa trên tài liệu nào), hỏi lại đúng MỘT câu quan trọng nhất.
Thà hỏi còn hơn đoán sai rồi làm lại.

Báo cáo bằng lời người thường: đã xong gì, có gì cần để ý. Không nhắc tên tool,
không nhắc số token, không dùng thuật ngữ kỹ thuật.
`;

/*
 * `charterTemplate()` đã bị BỎ HẲN ngày 17/08 — không thay bằng gì cả.
 *
 * Nó từng ghi sẵn `knowledge/shared/_charter.md` với frontmatter đầy đủ và thân
 * rỗng, để charter vừa là lớp prompt vừa là node tri thức. Đó chính là gốc của
 * ba lỗi mà người dùng gặp cùng lúc (xem `charter_file` trong `types.ts` và
 * `migrateCharters()` trong `migrate.ts`).
 *
 * Charter giờ là `charter.md` ở gốc văn phòng, markdown thuần, và **chỉ ra đời
 * khi người dùng lưu lần đầu**. Không có file mặc định nào cả: một file rỗng chỉ
 * để "cho có" là một dòng nữa trong thư mục mà không ai giải thích được.
 */



