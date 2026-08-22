/**
 * Test cho ĐƯỜNG RANH "kết quả đi đâu, và tiền là bao nhiêu" — cả hai đường đều
 * đã nói dối với người dùng trong cùng một buổi chạy thật, 21/08.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BA CA THẬT, MỘT VĂN PHÒNG, BỐN MƯƠI LĂM PHÚT.                            │
 * │                                                                          │
 * │  P-260821-1805-d6v9  ghi đúng chỗ   → hệ thống nói "xong"      ✅         │
 * │  P-260821-1818-yydi  ghi RA NGOÀI   → hệ thống nói "chưa có gì, làm lại" │
 * │  P-260821-1827-m78h  ghi đúng chỗ,                                       │
 * │                      rồi chạm trần  → hệ thống nói "chưa ra kết quả"     │
 * │                                                                          │
 * │ Cả ba lượt đều để lại một file đầy đủ trên đĩa. Hệ thống khai đúng MỘT.   │
 * │ Hai câu sai đều mời người dùng chạy lại — tức trả tiền lần hai cho thứ họ │
 * │ đã có. Với người non-code đang tin hệ thống 100%, đó là kiểu hỏng đắt     │
 * │ nhất: không ai đi kiểm một câu mình tin.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Bốn hàm thuần (hoặc chỉ đụng `fs`), 0 token, 0 lượt LLM:
 *
 *  · `landingOf`     — ghi ra ngoài văn phòng là MỘT SỰ VIỆC, không phải `undefined`
 *  · `readUsage`     — token lấy từ `modelUsage` (tích luỹ), không từ `usage` (một lượt)
 *  · `filesOnDisk`   — mớ dở dang có thật, dùng chung cho MỌI đường ra
 *  · `straysOnDisk`  — file lạc, chỉ khai thứ sờ được
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { filesOnDisk, landingOf, straysOnDisk, readUsage, warnDroppedTools } from '../dist/core/worker.js';
import { BUILTIN_TOOLS, effectiveTools, hasShell } from '../dist/core/types.js';

const OFFICE = path.resolve('/co/offices/bang-tinh');

// ────────────────────────────────────────────────────────────────── landingOf

test('landingOf: ghi trong văn phòng → điểm đến `file`, đường dẫn tương đối', () => {
  const spot = landingOf(OFFICE, {
    name: 'Write',
    input: { file_path: 'artifacts/P-01/T-01/ket-qua.md' },
  });
  assert.deepEqual(spot, { kind: 'file', ref: 'artifacts/P-01/T-01/ket-qua.md' });
});

test('landingOf: đường dẫn tuyệt đối TRONG văn phòng vẫn quy về tương đối', () => {
  const abs = path.join(OFFICE, 'artifacts', 'P-01', 'T-01', 'ket-qua.md');
  const spot = landingOf(OFFICE, { name: 'Write', input: { file_path: abs } });
  assert.deepEqual(spot, { kind: 'file', ref: 'artifacts/P-01/T-01/ket-qua.md' });
});

/**
 * CA `P-260821-1818-yydi`, tái hiện y nguyên.
 *
 * Nhân viên `Write` lên hai cấp; file rơi vào `company/artifacts/…`. Bản trước
 * `catch { return undefined }` → `landed` rỗng → Trợ lý nói *"không thấy file
 * trên đĩa"* trong khi bảng kết quả 4236 byte nằm nguyên vẹn cách đó hai thư mục.
 */
test('landingOf: ghi RA NGOÀI văn phòng → `outside`, KHÔNG phải undefined', () => {
  const spot = landingOf(OFFICE, {
    name: 'Write',
    input: { file_path: '../../artifacts/P-260821-1818-yydi/T-01/ket-qua-eco.md' },
  });
  assert.equal(spot?.kind, 'outside', 'ra ngoài văn phòng vẫn là một điểm đến có thật');
  assert.match(String(spot?.ref), /ket-qua-eco\.md$/);
});

test('landingOf: `outside` giữ nguyên đường dẫn thô để còn chỉ đường cho người dùng', () => {
  const spot = landingOf(OFFICE, { name: 'Write', input: { file_path: 'C:\\tmp\\lac.md' } });
  assert.deepEqual(spot, { kind: 'outside', ref: 'C:/tmp/lac.md' });
});

test('landingOf: Edit và NotebookEdit đi cùng một cửa với Write', () => {
  assert.equal(landingOf(OFFICE, { name: 'Edit', input: { file_path: '../ngoai.md' } })?.kind, 'outside');
  assert.equal(
    landingOf(OFFICE, { name: 'NotebookEdit', input: { notebook_path: '../ngoai.ipynb' } })?.kind,
    'outside',
  );
});

test('landingOf: không có đường dẫn thì KHÔNG bịa ra điểm đến', () => {
  assert.equal(landingOf(OFFICE, { name: 'Write', input: {} }), undefined);
  assert.equal(landingOf(OFFICE, { name: 'Write', input: { file_path: '' } }), undefined);
});

test('landingOf: Bash khai "có chạy lệnh" và không khai hơn thế', () => {
  assert.deepEqual(landingOf(OFFICE, { name: 'Bash', input: { command: 'curl x' } }), {
    kind: 'command',
    ref: '',
  });
});

test('landingOf: tool MCP khai tên server', () => {
  assert.deepEqual(landingOf(OFFICE, { name: 'mcp__notion__create_page', input: {} }), {
    kind: 'external',
    ref: 'notion',
  });
});

test('landingOf: Read không phải điểm đến', () => {
  assert.equal(landingOf(OFFICE, { name: 'Read', input: { file_path: 'library/files/a.csv' } }), undefined);
});

// ────────────────────────────────────────────────────────────────── readUsage

/**
 * CA `P-260821-1827-m78h`, tái hiện y nguyên.
 *
 * Sổ ghi `out 59, cacheRead 0` bên cạnh `$0.4248`. `usage` là số của MỘT LƯỢT
 * (sdk.d.ts:4453 — *"per-turn in streaming-input sessions"*), `modelUsage` mới
 * là số tích luỹ. Ta chạy streaming-input mode, nên vế "per-turn" áp dụng.
 */
test('readUsage: token lấy từ `modelUsage` (tích luỹ), KHÔNG từ `usage` (một lượt)', () => {
  const u = readUsage({
    usage: { input_tokens: 2, output_tokens: 59, cache_read_input_tokens: 0, cache_creation_input_tokens: 7699 },
    modelUsage: {
      'claude-sonnet-5': {
        inputTokens: 40,
        outputTokens: 27_800,
        cacheReadInputTokens: 21_400,
        cacheCreationInputTokens: 7_699,
        costUSD: 0.42,
      },
    },
    total_cost_usd: 0.4248467,
    num_turns: 2,
  });

  assert.equal(u.output, 27_800, 'không được lấy 59 của lượt cuối');
  assert.equal(u.cacheRead, 21_400, 'không được lấy 0 của lượt cuối');
  assert.equal(u.cacheWrite, 7_699);
  assert.equal(u.costUSD, 0.4248467, 'tiền vẫn lấy `total_cost_usd` — cùng thứ tiếng với maxBudgetUsd');
  assert.equal(u.turns, 2);
});

test('readUsage: cộng dồn MỌI model, kể cả lượt phụ trợ nội bộ', () => {
  const u = readUsage({
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 10, outputTokens: 1000, cacheReadInputTokens: 500, cacheCreationInputTokens: 200, costUSD: 0.02 },
      'claude-haiku-4-5-20251001': { inputTokens: 5, outputTokens: 40, cacheReadInputTokens: 100, cacheCreationInputTokens: 0, costUSD: 0.001 },
    },
    total_cost_usd: 0.021,
    num_turns: 3,
  });
  assert.equal(u.input, 15);
  assert.equal(u.output, 1040);
  assert.equal(u.cacheRead, 600);
  assert.equal(u.cacheWrite, 200);
});

test('readUsage: model khai là model TIÊU NHIỀU TOKEN NHẤT, không phải khoá đầu tiên', () => {
  const u = readUsage({
    modelUsage: {
      'claude-haiku-4-5-20251001': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 0, costUSD: 0 },
      'claude-sonnet-5': { inputTokens: 100, outputTokens: 900, cacheReadInputTokens: 8000, cacheCreationInputTokens: 0, costUSD: 0.1 },
    },
    total_cost_usd: 0.1,
    num_turns: 1,
  });
  assert.equal(u.model, 'claude-sonnet-5');
});

/**
 * Ca crash sớm / SDK đổi hình dạng: thà lấy số của một lượt còn hơn ghi $0 và
 * 0 token. Đây là bản DỰ PHÒNG, không phải đường mặc định — nên nó chỉ được
 * chạy khi `modelUsage` thật sự trống.
 */
test('readUsage: `modelUsage` trống thì rơi về `usage` chứ không ghi 0', () => {
  const u = readUsage({
    usage: { input_tokens: 7, output_tokens: 300, cache_read_input_tokens: 20, cache_creation_input_tokens: 1 },
    modelUsage: {},
    total_cost_usd: 0.05,
    num_turns: 1,
  });
  assert.equal(u.output, 300);
  assert.equal(u.costUSD, 0.05);
});

test('readUsage: không có gì cả thì trả 0, không ném', () => {
  const u = readUsage({});
  assert.equal(u.output, 0);
  assert.equal(u.costUSD, 0);
  assert.equal(u.turns, 0);
});

// ─────────────────────────────────────────────── filesOnDisk & straysOnDisk

function withTempOffice(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-landing-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('filesOnDisk: chỉ khai file SỜ ĐƯỢC, không khai file model hứa suông', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts', 'T-01'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'T-01', 'co-that.md'), '# co that');

    const got = filesOnDisk(
      dir,
      ['artifacts/T-01/co-that.md', 'artifacts/T-01/khong-co.md'],
      [],
    );
    assert.deepEqual(got, ['artifacts/T-01/co-that.md']);
  });
});

/**
 * File PHỤ nhân viên tự tạo — `brief.outputs` không biết trước, và đây đúng là
 * thứ dễ bị bỏ quên lại trên đĩa nhất.
 */
test('filesOnDisk: gộp cả file được giao lẫn file quan sát thấy nó ghi', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'chinh.md'), 'x');
    fs.writeFileSync(path.join(dir, 'artifacts', 'phu.csv'), 'y');

    const got = filesOnDisk(dir, ['artifacts/chinh.md'], [
      { kind: 'file', ref: 'artifacts/phu.csv' },
      { kind: 'command', ref: '' },
      { kind: 'external', ref: 'notion' },
    ]);
    assert.deepEqual(got.sort(), ['artifacts/chinh.md', 'artifacts/phu.csv']);
  });
});

test('filesOnDisk: trùng giữa hai nguồn chỉ hiện một lần', () => {
  withTempOffice((dir) => {
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', 'a.md'), 'x');
    const got = filesOnDisk(dir, ['artifacts/a.md'], [{ kind: 'file', ref: 'artifacts/a.md' }]);
    assert.deepEqual(got, ['artifacts/a.md']);
  });
});

test('filesOnDisk: đường dẫn ra ngoài văn phòng KHÔNG được khai là kết quả', () => {
  withTempOffice((dir) => {
    const got = filesOnDisk(dir, ['../../ngoai.md'], []);
    assert.deepEqual(got, [], 'safeJoin ném → loại, không sập');
  });
});

test('straysOnDisk: khai file lạc CÓ THẬT, bỏ file lạc chỉ được gọi mà không ghi nổi', () => {
  withTempOffice((dir) => {
    const that = path.join(dir, 'lac-co-that.md');
    fs.writeFileSync(that, '# lac');

    const got = straysOnDisk([
      { kind: 'outside', ref: that },
      { kind: 'outside', ref: path.join(dir, 'khong-ghi-noi.md') },
      { kind: 'file', ref: 'artifacts/a.md' },
    ]);
    assert.deepEqual(got, [that]);
  });
});

test('straysOnDisk: không có file lạc nào thì rỗng — im lặng đúng lúc nên im', () => {
  assert.deepEqual(straysOnDisk([{ kind: 'file', ref: 'artifacts/a.md' }]), []);
  assert.deepEqual(straysOnDisk([]), []);
});

// ──────────────────────────────── tool shell đổi tên theo hệ điều hành

/**
 * Ca thật 22/08: công tắc "cho chạy lệnh" KHÔNG chạy suốt sáu ngày.
 *
 * Trên Windows tool shell tên là `PowerShell`; bộ 29 tool của CLI **không hề
 * có** `Bash`. Mà `tools` là allowlist theo TÊN và **bỏ im lặng** tên không tồn
 * tại — nên `tools: ['Bash']` cấp đúng 0 tool thêm. Hỏi thẳng CLI mới ra:
 *
 *   không truyền `tools` → 29 tool, có `PowerShell`, KHÔNG có `Bash`
 *   `tools: ['Bash']`    → CLI cấp 0 tool
 *   7 mặc định + `PowerShell` → 8 tool, prefix +2 688 token
 *
 * Luật: **config giữ MỘT tên chuẩn** (`Bash`) để một văn phòng zip lại vẫn
 * chạy ở máy khác hệ điều hành; việc dịch sang tên nền tảng làm ở
 * `effectiveTools`, bằng cách gửi CẢ HAI tên và để SDK tự bỏ cái không có.
 */
test('effectiveTools: khai shell bang MOT ten thi nhan duoc MOI ten nen tang', () => {
  const out = effectiveTools(['Bash']);
  assert.ok(out.includes('Bash'), 'giu ten POSIX');
  assert.ok(out.includes('PowerShell'), 'thieu ten Windows = cong tac la no-op tren Windows');
  for (const t of BUILTIN_TOOLS) assert.ok(out.includes(t));
});

test('effectiveTools: khai bang ten Windows cung nhan du', () => {
  const out = effectiveTools(['PowerShell']);
  assert.ok(out.includes('Bash') && out.includes('PowerShell'));
});

test('effectiveTools: KHONG khai shell thi khong ten nao lot vao', () => {
  const out = effectiveTools([]);
  assert.equal(out.includes('Bash'), false);
  assert.equal(out.includes('PowerShell'), false);
  assert.deepEqual(out, [...BUILTIN_TOOLS]);
});

test('hasShell: nhan ra vai tro co shell du khai bang ten nao', () => {
  assert.equal(hasShell([]), false);
  assert.equal(hasShell(['Read']), false);
  assert.equal(hasShell(['Bash']), true);
  assert.equal(hasShell(['PowerShell']), true);
});

/**
 * `landingOf` phải khai "có chạy lệnh" cho CẢ HAI tên. Sót một tên là một điểm
 * đến bị GIẤU — người dùng Windows sẽ thấy "không có kết quả nào" cho một lượt
 * chạy vừa gọi shell.
 */
test('landingOf: ca Bash lan PowerShell deu khai la diem den "command"', () => {
  for (const name of ['Bash', 'PowerShell']) {
    assert.deepEqual(landingOf('/vp', { name, input: { command: 'ls' } }), { kind: 'command', ref: '' });
  }
});


// ──────────────────────── CLI bỏ im lặng tool nó không có → phải kêu

/**
 * Chốt chặn BỀN hơn bảng tên: nó không cần biết tên nào đúng, chỉ cần biết
 * "thứ tôi xin và thứ tôi nhận không khớp". Bảng `SHELL_ALIASES` là do TA viết
 * tay; xuất hiện một nền tảng thứ tư với tên thứ ba thì bảng sai còn phép đối
 * chiếu này vẫn đúng.
 */
const roleWith = (tools) => ({ id: 'r1', tools, budget: {}, mcp: [] });
const GRANTED_POSIX = [...BUILTIN_TOOLS, 'Bash'];
const GRANTED_WIN = [...BUILTIN_TOOLS, 'PowerShell'];

test('warnDroppedTools: POSIX cap Bash, Windows cap PowerShell -> ca hai deu IM', () => {
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), GRANTED_POSIX), []);
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), GRANTED_WIN), []);
});

test('warnDroppedTools: xin shell ma KHONG duoc cap ten nao -> KEU', () => {
  const dropped = warnDroppedTools(roleWith(['Bash']), [...BUILTIN_TOOLS]);
  assert.ok(dropped.length > 0, 'day chinh la ca no-op suot 6 ngay, phai co tieng');
});

test('warnDroppedTools: KHONG xin shell thi khong bao gio keu vi shell', () => {
  assert.deepEqual(warnDroppedTools(roleWith([]), [...BUILTIN_TOOLS]), []);
});

test('warnDroppedTools: tool thuong bi bo cung phai keu', () => {
  const dropped = warnDroppedTools(roleWith([]), BUILTIN_TOOLS.filter((t) => t !== 'WebSearch'));
  assert.deepEqual(dropped, ['WebSearch']);
});

test('warnDroppedTools: granted khong phai mang -> im, dung nem', () => {
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), undefined), []);
  assert.deepEqual(warnDroppedTools(roleWith(['Bash']), 'nope'), []);
});

