/**
 * NHẬT KÝ KIỂM TOÁN CÁNH TAY. → `src/core/audit.ts` · docs/SPEC-arms.md §6k
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Nó là thứ **THAY** cho cổng duyệt từng lần, không phải bổ sung cho nó.   │
 * │ User chốt 25/08 bỏ tầng 2 (*"mỗi mcp cắm cho nó chính là sandbox, cùng   │
 * │ lắm thì có log"*). ⇒ Bỏ cổng thì log **phải đủ** — nếu không ta vừa bỏ    │
 * │ cả hai, và không ai thấy vì cả hai đều im lặng.                          │
 * │                                                                          │
 * │ Ca thật đã chứng minh nó không phải chuyện lý thuyết (26/08): một lượt    │
 * │ chạm `max_turns` giữa chừng ĐÃ gọi `notion-update-page` rồi bị cắt, mà    │
 * │ báo cáo cuối nói *"chưa xoá được"*. Không ai tra lại được nó ghi gì.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AuditLog, splitArmTool } from '../dist/core/audit.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-audit-'));

const call = (over: Record<string, unknown> = {}) => ({
  server: 'a354ff2bb34',
  tool: 'notion-create-pages',
  role: 'nguoi-soi-thu-muc',
  args: { pages: [{ title: 'thử nghiệm' }] },
  ...over,
});

// ─────────────────────────────────────────── ghi & đọc

test('ghi rồi đọc lại được, kèm THAM SỐ — đó là cả lý do file này tồn tại', () => {
  const log = new AuditLog(tmp());
  log.append(call());
  const [rec] = log.list();
  assert.equal(rec?.tool, 'notion-create-pages');
  assert.equal(rec?.role, 'nguoi-soi-thu-muc');
  assert.ok(rec?.args.includes('thử nghiệm'), 'mất tham số thì dòng log vô dụng');
  assert.ok(rec?.ts, 'thiếu mốc thời gian');
});

test('MỚI NHẤT LÊN ĐẦU — người đi truy luôn hỏi "vừa nãy nó làm gì"', () => {
  const log = new AuditLog(tmp());
  log.append(call({ tool: 'cu' }));
  log.append(call({ tool: 'moi' }));
  assert.deepEqual(log.list().map((c) => c.tool), ['moi', 'cu']);
});

test('lọc theo cánh tay — câu hỏi luôn là "KẾT NỐI NÀY đã làm gì"', () => {
  const log = new AuditLog(tmp());
  log.append(call({ server: 'a1' }));
  log.append(call({ server: 'a2' }));
  assert.deepEqual(log.list({ server: 'a1' }).map((c) => c.server), ['a1']);
});

test('chưa có file ⇒ rỗng, không ném', () => {
  assert.deepEqual(new AuditLog(path.join(tmp(), 'chua-co')).list(), []);
});

// ────────────────────── không được làm hỏng ca đang chạy

test('⭐ thư mục không ghi được ⇒ KHÔNG ném — mất log còn hơn hỏng một ca', () => {
  /**
   * `append` chạy giữa một ca đang làm việc. Ném ở đây là đổi một mất mát nhỏ
   * (một dòng nhật ký) lấy một mất mát lớn (cả ca, kèm tiền đã tiêu). Cùng luật
   * với `appendChat`.
   */
  const dir = tmp();
  const file = path.join(dir, 'chan');
  fs.writeFileSync(file, 'toi la mot FILE, khong phai thu muc');
  const log = new AuditLog(file);
  assert.doesNotThrow(() => log.append(call()));
  assert.deepEqual(log.list(), []);
});

test('⭐ dòng HỎNG chỉ bỏ đúng dòng đó, không bỏ cả file', () => {
  // Daemon chết giữa một lần ghi để lại một dòng cụt. Bỏ cả file vì nó là xoá
  // sổ lịch sử của mọi lời gọi TRƯỚC nó — đúng lúc người ta cần chúng nhất.
  const dir = tmp();
  const log = new AuditLog(dir);
  log.append(call({ tool: 'truoc' }));
  fs.appendFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"cut giua ch\n', 'utf8');
  log.append(call({ tool: 'sau' }));
  assert.deepEqual(log.list().map((c) => c.tool), ['sau', 'truoc']);
});

test('tham số quá dài bị cắt, và NÓI RA là đã cắt', () => {
  // Không nói ra thì người đọc tưởng đó là toàn bộ thứ đã gửi đi — một cuốn
  // nhật ký nói dối về chính nó thì tệ hơn không có.
  const log = new AuditLog(tmp());
  log.append(call({ args: { text: 'x'.repeat(5_000) } }));
  const [rec] = log.list();
  assert.equal(rec?.truncated, true);
  assert.ok(rec!.args.length < 2_100);
});

test('trim: giữ phần MỚI, cắt phần cũ', () => {
  const dir = tmp();
  const log = new AuditLog(dir);
  for (let i = 0; i < 2_100; i++) log.append(call({ tool: `t${i}` }));
  log.trim();
  const kept = log.list();
  assert.equal(kept.length, 2_000);
  assert.equal(kept[0]?.tool, 't2099', 'phải giữ cái mới nhất');
});

// ─────────────────────────────────────── splitArmTool

test('splitArmTool: bóc đúng băm và tên việc', () => {
  assert.deepEqual(splitArmTool('mcp__a354ff2bb34__notion-create-pages'), {
    server: 'a354ff2bb34',
    tool: 'notion-create-pages',
  });
});

test('splitArmTool: tool KHÔNG phải MCP ⇒ undefined', () => {
  // `Read`/`Write`/`Bash` không đi qua cánh tay nào — ghi chúng vào nhật ký
  // CÁNH TAY là trộn hai câu hỏi khác nhau vào một cuốn sổ.
  for (const n of ['Read', 'Write', 'PowerShell', 'ToolSearch']) {
    assert.equal(splitArmTool(n), undefined);
  }
});

test('splitArmTool: `mcp__<server>` trần (không có tên việc) ⇒ undefined', () => {
  // Đó là chuỗi KHAI QUYỀN trong `allowedTools`, không bao giờ là tên một lời
  // gọi thật. Nhận nhầm nó là đẻ ra những dòng nhật ký không ứng với việc nào.
  assert.equal(splitArmTool('mcp__files'), undefined);
});

test('splitArmTool: tên việc có `__` bên trong vẫn bóc đúng', () => {
  assert.deepEqual(splitArmTool('mcp__files__list__deep'), { server: 'files', tool: 'list__deep' });
});
