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

import { loadCompanyConfig, loadOffice } from './config.js';
import {
  companyPaths,
  ensureCompanyDirs,
  ensureOfficeDirs,
  isSafeId,
  listOfficeIds,
  officePaths,
  resolveCompanyDir,
  slugId,
  type CompanyPaths,
} from './paths.js';
import { Office } from './office.js';
import { appendUsage, formatReport, readUsage, summarize, type CostReport, type UsageRecord } from './usage.js';
import { migrateIfNeeded } from './migrate.js';
import { RunError, type AgentEvent, type CompanyConfig } from './types.js';

export interface OfficeSummary {
  id: string;
  name: string;
  avatar: string;
  state: string;
  agents: number;
  onDuty: number;
  knowledge: number;
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
        agents: o.loaded.roles.size,
        onDuty: o.assistant.assignableRoles().size,
        knowledge: o.knowledge.size,
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
    const name = (input.name ?? '').trim() || 'Văn phòng mới';
    const id = slugId(input.id?.trim() || name);
    if (!isSafeId(id)) {
      throw new RunError('Tên văn phòng cần có ít nhất một chữ cái hoặc số.', 'other');
    }
    if (this.offices.has(id) || this.broken.has(id)) {
      throw new RunError(`Đã có văn phòng "${id}".`, 'other');
    }

    const dir = path.join(this.paths.offices, id);
    const pp = officePaths(dir);
    ensureOfficeDirs(pp);
    fs.writeFileSync(pp.configFile, officeTemplate(id, name), 'utf8');
    fs.writeFileSync(pp.assistantSkills, ASSISTANT_SKILLS_DEFAULT, 'utf8');
    fs.writeFileSync(path.join(pp.knowledgeShared, '_charter.md'), charterTemplate(name), 'utf8');

    const office = new Office(loadOffice(this.dir, this.config, id));
    office.bindBus((e) => this.emit(e));
    office.onUsage = (rec) => appendUsage(this.paths, rec);
    this.offices.set(id, office);

    this.emit({ type: 'company.offices', say: `Đã tạo văn phòng "${name}".`, office: id, plan_id: null });
    return office;
  }

  removeOffice(officeId: string, deleteFiles = false): void {
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
    if (deleteFiles) {
      fs.rmSync(path.join(this.paths.offices, officeId), { recursive: true, force: true });
    }
    this.emit({
      type: 'company.offices',
      say: deleteFiles ? `Đã xoá văn phòng "${officeId}".` : `Đã đóng văn phòng "${officeId}".`,
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

  /** Chi phí tách theo văn phòng — để thấy văn phòng nào đang ăn hết hạn mức. */
  costByOffice(sinceMs?: number): Array<{ office: string; name: string; tasks: number; costUSD: number; turns: number }> {
    const byOffice = new Map<string, { tasks: number; costUSD: number; turns: number }>();
    for (const r of this.usageRecords(sinceMs)) {
      const key = r.office || '(không rõ)';
      const e = byOffice.get(key) ?? { tasks: 0, costUSD: 0, turns: 0 };
      e.tasks++;
      e.costUSD += r.cost_usd;
      e.turns += r.turns ?? 0;
      byOffice.set(key, e);
    }
    return [...byOffice.entries()]
      .map(([office, v]) => ({ office, name: this.offices.get(office)?.name ?? office, ...v }))
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
charter_file: knowledge/shared/_charter.md

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

/**
 * Charter mặc định: frontmatter đầy đủ, THÂN RỖNG.
 *
 * Cùng lý do với skills của Trợ lý — thân charter đi vào prefix cache của MỌI
 * nhân viên, nên một dòng "hãy viết vài dòng về văn phòng này" là khoản thuế thu
 * mãi mãi để nói với model một câu chỉ có nghĩa với người.
 *
 * Rỗng thì `office.charter` là chuỗi rỗng và khối này biến mất hẳn khỏi prompt.
 * Giao diện mới là chỗ nói cho người dùng biết nên viết gì vào đây.
 */
function charterTemplate(name: string): string {
  return `---
id: k/shared/_charter
type: policy
title: "Văn phòng ${name}"
tags: [charter]
scope: shared
author: master
confidence: 1
hits: 0
pinned: true
updated: ${new Date().toISOString().slice(0, 10)}
---
`;
}
