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
  slugId,
  type CompanyPaths,
} from './paths.js';
import { Office } from './office.js';
import { appendUsage, formatReport, readUsage, summarize, type CostReport, type UsageRecord } from './usage.js';
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
    const id = slugId(input.id?.trim() || name);
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
  renameOffice(officeId: string, name: string): string {
    const office = this.get(officeId);
    const next = normalizeName(name);
    if (!nameKey(next)) {
      throw new RunError('Tên văn phòng cần có ít nhất một chữ cái hoặc số.', 'other');
    }
    this.assertNameFree(next, officeId);
    const applied = office.rename(next);
    this.emit({
      type: 'company.offices',
      say: `Đã đổi tên văn phòng thành "${applied}".`,
      office: officeId,
      plan_id: null,
    });
    return applied;
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
    const byOffice = new Map<string, { tasks: number; costUSD: number; turns: number }>();
    for (const r of this.usageRecords(sinceMs)) {
      const key = r.office || LEGACY;
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

  private usageRecords(sinceMs?: number, officeId?: string): UsageRecord[] {
    const all = readUsage(this.paths, sinceMs);
    return officeId ? all.filter((r) => r.office === officeId) : all;
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
