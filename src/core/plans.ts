/**
 * Lịch sử công việc. → docs/SPEC-offices.md §6
 *
 * PLAN LÀ ĐƠN VỊ CÔNG VIỆC, không phải dòng chat. v0 chỉ ghi file plan rời rạc
 * rồi quên chúng đi; hệ quả là không trả lời được "hôm qua làm những gì" và
 * không tách được hai việc chạy chồng nhau trong log.
 *
 * Hai tầng, có chủ ý:
 *   index.json          gọn, đọc một phát ra cả danh sách — cho sidebar
 *   <plan_id>.log.jsonl từng sự kiện, chỉ đọc khi người dùng mở đúng việc đó
 *
 * Gộp làm một thì mở sidebar phải đọc toàn bộ log của cả đời văn phòng. Tiêu chí
 * "Hiệu năng" chặn đúng loại thiết kế đó.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from './paths.js';
import { isSafeId } from './paths.js';
import type { AgentEvent, PlanRecord } from './types.js';

const MAX_INDEX = 200;
/** Trần dòng log mỗi việc. Một agent lặp vô hạn không được làm đầy đĩa. */
const MAX_LOG_LINES = 5_000;

export class PlanStore {
  constructor(private paths: OfficePaths) {}

  rebind(paths: OfficePaths): void {
    this.paths = paths;
  }

  list(): PlanRecord[] {
    if (!fs.existsSync(this.paths.planIndex)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.planIndex, 'utf8')) as { plans?: PlanRecord[] };
      return Array.isArray(raw.plans) ? raw.plans : [];
    } catch {
      // Index hỏng không được làm sập văn phòng — nó là dữ liệu phái sinh.
      process.emitWarning('tasks/index.json is unreadable; the work log starts again from empty.');
      return [];
    }
  }

  get(planId: string): PlanRecord | undefined {
    return this.list().find((p) => p.plan_id === planId);
  }

  upsert(rec: PlanRecord): void {
    const plans = this.list().filter((p) => p.plan_id !== rec.plan_id);
    plans.unshift(rec);
    fs.mkdirSync(path.dirname(this.paths.planIndex), { recursive: true });
    fs.writeFileSync(
      this.paths.planIndex,
      JSON.stringify({ plans: plans.slice(0, MAX_INDEX) }, null, 2),
      'utf8',
    );
  }

  /** Ghi một sự kiện vào log của đúng việc đó. Sự kiện trò chuyện không vào đây. */
  append(planId: string, event: AgentEvent): void {
    const file = this.logFile(planId);
    if (!file) return;
    try {
      if (lineCount(file) >= MAX_LOG_LINES) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
    } catch {
      // Ghi log hỏng KHÔNG được làm hỏng công việc đang chạy.
    }
  }

  readLog(planId: string): Array<AgentEvent & { ts: string }> {
    const file = this.logFile(planId);
    if (!file || !fs.existsSync(file)) return [];
    const out: Array<AgentEvent & { ts: string }> = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AgentEvent & { ts: string });
      } catch {
        /* dòng hỏng thì bỏ qua */
      }
    }
    return out;
  }

  /**
   * CHỮA CA ZOMBIE: bản ghi kẹt ở `planning`/`running` sau khi daemon chết.
   * Trả về số ca đã chữa. → nợ kỹ thuật #2 · SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO CHỮA CHỨ KHÔNG CHO XOÁ — user hỏi đúng câu, 20/08.                │
   * │                                                                          │
   * │ Triệu chứng user nêu: *"nhiều khi hỏng, bị zombie thấy ngứa mắt"*, và    │
   * │ phản xạ đầu tiên của cả hai bên là **thêm nút Xoá**. Nhưng nhật ký công  │
   * │ việc là bên DUY NHẤT nối `plan_id` trong `logs/usage.jsonl` với một cái  │
   * │ TÊN đọc được. Xoá một bản ghi thì tiền vẫn còn trong sổ mà không ai biết │
   * │ nó của việc gì — và "(không rõ)" trong sổ chi phí từ đó mang HAI nghĩa   │
   * │ (bản ghi v0, hoặc người dùng đã xoá), tức là **không còn giải thích      │
   * │ được**. Chính user chặn lại: *"hay là giữ lại log nhỉ, để trace được,    │
   * │ liên quan cả tiền nong"*.                                                │
   * │                                                                          │
   * │ Chẩn đoán đúng trục: cái ngứa mắt KHÔNG phải "có quá nhiều dòng", mà là  │
   * │ **những dòng đó đang NÓI DỐI** — chúng bảo "đang chạy" trong khi không   │
   * │ có gì chạy cả. Sửa lời nói dối thì cái ngứa mắt biến mất, và không mất   │
   * │ một dòng lịch sử nào. Thêm nút Xoá là chữa triệu chứng bằng cách đốt      │
   * │ bằng chứng.                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Chạy MỘT LẦN lúc dựng `Office`, tức là lúc tiến trình vừa khởi động và
   * chắc chắn chưa có ca nào đang chạy. Gọi nó ở bất kỳ đâu khác là có ngày
   * đóng dấu `failed` lên một ca đang chạy thật.
   *
   * ⚠ GIỮ NGUYÊN THỨ TỰ trong index — không dùng `upsert`, vì `upsert` đẩy bản
   * ghi lên đầu danh sách. Chữa ba con zombie bằng `upsert` là xáo tung lịch sử
   * theo thứ tự thời gian, đúng thứ nhật ký sinh ra để giữ.
   */
  healStale(note: string): number {
    const plans = this.list();
    let healed = 0;
    for (const p of plans) {
      if (p.status !== 'planning' && p.status !== 'running') continue;
      p.status = 'failed';
      p.ended_at ??= new Date().toISOString();
      p.report = p.report ? `${p.report}\n\n${note}` : note;
      healed++;
    }
    if (healed === 0) return 0;
    fs.mkdirSync(path.dirname(this.paths.planIndex), { recursive: true });
    fs.writeFileSync(this.paths.planIndex, JSON.stringify({ plans }, null, 2), 'utf8');
    return healed;
  }

  /** plan_id đến từ URL nên phải kiểm — nó thành tên file. */
  private logFile(planId: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(planId)) return undefined;
    return path.join(this.paths.tasks, `${planId}.log.jsonl`);
  }
}

function lineCount(file: string): number {
  if (!fs.existsSync(file)) return 0;
  try {
    // Đếm bằng kích thước ước lượng thay vì đọc cả file — log có thể lớn.
    return Math.floor(fs.statSync(file).size / 120);
  } catch {
    return 0;
  }
}

/**
 * Màu đại diện của một agent, băm từ id. → SPEC-offices.md §6
 *
 * BĂM chứ không lưu: thêm/bớt người không làm đổi màu người khác, và không sinh
 * thêm một file cấu hình nữa để lệch. Hue trải đều, tránh dải 45–70° (vàng trên
 * nền sáng đọc không ra).
 */
export function agentHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const raw = Math.abs(h) % 335;
  return raw < 45 ? raw : raw + 25;
}

export { isSafeId };
