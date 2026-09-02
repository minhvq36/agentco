/**
 * CÁNH TAY CLI — `core/cli-arm.ts` · `armexec.ts §prepareArm` · `secrets.ts`
 *
 * → docs/SPEC-arms.md §16
 *
 * Bộ này khoá **cổng tất định**: những thứ đúng/sai không phụ thuộc model. Phần
 * đi qua model đã đo bằng `scripts/spike-cli-arm.ts` (tầng thi hành 9/9, chuỗi
 * đầy đủ 4/4) — số đo không thay được test, và test không thay được số đo.
 *
 * ⚠ Dùng `process.execPath -e` chứ không dùng `python`: một test đỏ vì máy chạy
 * test không cài python là một test nói dối về sản phẩm.
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultArmLabel, prepareArm } from '../dist/core/armexec.js';
import { armHash } from '../dist/core/catalog.js';
import { guardedZone } from '../dist/core/paths.js';
import {
  ArgvError,
  CliArmSchema,
  cliSays,
  cliToolNames,
  fillArgv,
  isCliArm,
  parseCliArm,
  runCommand,
} from '../dist/core/cli-arm.js';
import { injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';

const act = (over: Record<string, unknown> = {}) =>
  CliArmSchema.parse({
    type: 'cli',
    actions: [
      {
        id: 'trien_khai',
        say: 'triển khai lên staging',
        description: 'Đẩy nhánh hiện tại lên staging. Ghi đè bản đang chạy, không hoàn tác được.',
        run: ['pnpm', 'deploy', '--env', 'staging', '--tag', '{tag}'],
        params: [{ name: 'tag', type: 'string', required: true }],
        ...over,
      },
    ],
  }).actions[0]!;

// ──────────────────────────────────────────── ARGV, KHÔNG PHẢI CHUỖI SHELL

test('argv giữ nguyên MẢNG, tham số nằm gọn trong đúng một phần tử', () => {
  const a = fillArgv(act(), { tag: 'v1.2.3' });
  assert.ok(Array.isArray(a));
  assert.deepEqual(a, ['pnpm', 'deploy', '--env', 'staging', '--tag', 'v1.2.3']);
});

test('🔴 ký tự shell chỉ là DỮ LIỆU — không tách ra phần tử thứ hai', () => {
  // Cột chịu lực an ninh của cả mục: `shell:false` + argv ⇒ `; calc` không bao
  // giờ thành một lệnh thứ hai. Nếu ngày nào ai đó mở `shell: true`, test này đỏ.
  for (const doc of ['v1; calc', 'v1 && calc', 'v1 | calc', 'v1`calc`', 'v1$(calc)']) {
    const a = fillArgv(act(), { tag: doc });
    assert.equal(a.length, 6, `"${doc}" làm đổi số phần tử argv`);
    assert.equal(a[5], doc);
  }
});

test('🔴 giá trị mở đầu bằng `-` bị TỪ CHỐI — chặn TRƯỚC khi spawn', () => {
  assert.throws(() => fillArgv(act(), { tag: '--force' }), ArgvError);
  // …và mở được, nhưng phải mở CÓ Ý THỨC.
  const ok = act({ params: [{ name: 'tag', type: 'string', required: true, allow_dash: true }] });
  assert.deepEqual(fillArgv(ok, { tag: '--force' }).at(-1), '--force');
});

test('kiểm TRƯỚC khi thay: `--tag=--force` không lách được luật gạch', () => {
  // Kiểm sau khi ghép thì chuỗi đã lẫn phần cố định và luật mất nghĩa ngay.
  assert.throws(() => fillArgv(act(), { tag: '--force' }), /starts with a dash/);
});

test('số nguyên: min · max · không phải số', () => {
  const a = act({
    run: ['x', '--mat', '{mat}'],
    params: [{ name: 'mat', type: 'integer', required: true, min: 2, max: 100 }],
  });
  assert.deepEqual(fillArgv(a, { mat: 6 }), ['x', '--mat', '6']);
  assert.throws(() => fillArgv(a, { mat: 1 }), />= 2/);
  assert.throws(() => fillArgv(a, { mat: 999 }), /<= 100/);
  assert.throws(() => fillArgv(a, { mat: 'sáu' }), /whole number/);
});

test('khuôn `pattern` và tham số bắt buộc còn trống', () => {
  const a = act({ params: [{ name: 'tag', type: 'string', required: true, pattern: '^[a-z0-9.-]+$' }] });
  assert.throws(() => fillArgv(a, { tag: 'Có Dấu' }), /does not match the pattern/);
  assert.throws(() => fillArgv(a, {}), /missing required parameter/);
});

test('ô trống không có tham số tương ứng ⇒ lỗi, không im lặng để nguyên `{x}`', () => {
  const a = act({ run: ['x', '{khong_khai}'], params: [] });
  assert.throws(() => fillArgv(a, {}), /has no parameter for/);
});

// ────────────────────────────────────────────────── BỘ CHẠY — bốn cửa lỗi

test('bốn cửa TÁCH BẠCH: spawn · timeout · exit · (fail_when ở tầng tool)', async () => {
  const cwd = os.tmpdir();
  const env = { PATH: process.env['PATH'] ?? '' };

  const ok = await runCommand({ argv: [process.execPath, '-e', 'console.log(7)'], cwd, env, timeoutMs: 20_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.door, undefined);
  assert.match(ok.stdout, /7/);

  const bad = await runCommand({ argv: ['khong-co-binary-nay-dau'], cwd, env, timeoutMs: 20_000 });
  assert.equal(bad.door, 'spawn');

  const fail = await runCommand({ argv: [process.execPath, '-e', 'process.exit(3)'], cwd, env, timeoutMs: 20_000 });
  assert.equal(fail.door, 'exit');
  assert.equal(fail.code, 3);

  const slow = await runCommand({
    argv: [process.execPath, '-e', 'setTimeout(()=>{},60000)'],
    cwd,
    env,
    timeoutMs: 1_200,
  });
  assert.equal(slow.door, 'timeout');
  assert.equal(slow.ok, false);
});

// ─────────────────────────────────────────────── NHẬN MẶT — theo TYPE, không theo vắng mặt

test('isCliArm đọc `type`, KHÔNG suy theo "không có command và không có url"', () => {
  assert.equal(isCliArm({ type: 'cli', actions: [] }), true);
  assert.equal(isCliArm({ command: 'npx', args: [] }), false);
  assert.equal(isCliArm({ type: 'http', url: 'https://x/mcp' }), false);
  // Vắng mặt KHÔNG phải tín hiệu: một khối gõ sai không được im lặng thành CLI.
  assert.equal(isCliArm({ hoan: 'toan la rac' }), false);
  assert.equal(isCliArm(null), false);
});

test('`runs_on` mặc định `daemon` — ô Docker phải có mặt từ dòng đầu (§16p ⑥)', () => {
  const parsed = CliArmSchema.parse({
    type: 'cli',
    actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }],
  });
  assert.equal(parsed.runs_on, 'daemon');
  assert.equal(parsed.actions[0]!.timeout_ms, 120_000);
});

test('cliToolNames lấy id, cliSays lấy câu tiếng người và CẮT Ở 4', () => {
  const decl = {
    type: 'cli',
    actions: Array.from({ length: 6 }, (_, i) => ({
      id: `viec_${i}`,
      say: `việc ${i}`,
      description: 'd',
      run: ['x'],
    })),
  };
  assert.deepEqual(cliToolNames(decl).length, 6);
  // Dòng danh bạ đi vào prefix MỌI lượt `route()` — trần là một hoá đơn, không phải thẩm mỹ.
  assert.deepEqual(cliSays(decl), ['việc 0', 'việc 1', 'việc 2', 'việc 3']);
  // Khối rác ⇒ rỗng, không ném: `addArm` gọi nó cho MỌI cấu hình.
  assert.deepEqual(cliSays({ type: 'http', url: 'https://x/mcp' }), []);
});

// ───────────────────────────── BẤT BIẾN: phạm vi hàm ĐIỀN = phạm vi hàm KIỂM

test('🔴 ô `${…}` trong `actions[].env` ĐƯỢC ĐIỀN — không thì lặp vô tận như bug 31/08', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 's', description: 'd', run: ['x'], env: { API_TOKEN: '${SHOP_TOKEN}' } },
    ],
  };
  // Hàm KIỂM thấy nó…
  assert.deepEqual(missingSecretRefs(decl), ['SHOP_TOKEN']);
  // …thì hàm ĐIỀN cũng phải thấy. Lệch hai phạm vi = câu lỗi tố cáo đúng cái ô
  // người dùng vừa điền, và không có đường ra.
  const filled = injectSecrets(decl, { SHOP_TOKEN: 'abc123' }) as typeof decl;
  assert.equal(filled.actions[0]!.env!['API_TOKEN'], 'abc123');
  assert.deepEqual(missingSecretRefs(filled), []);
});

test('chìa KHÔNG bị rót cả chùm vào env của tiến trình con', () => {
  const decl = {
    type: 'cli',
    actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }],
  };
  const filled = injectSecrets(decl, { BI_MAT_CUA_CONG_TY: 'xyz' });
  // Nhánh stdio gộp-theo-tên là ĐÚNG cho mục danh mục (server của hãng đọc
  // `process.env.NOTION_TOKEN`). Ở đây tiến trình con là binary của KHÁCH.
  assert.ok(!JSON.stringify(filled).includes('xyz'), 'chìa không khai vẫn lọt vào tờ khai CLI');
});

// ──────────────────────────────────────────────────────── BĂM & AN TOÀN

test('băm: đổi tờ khai ⇒ đổi băm; đổi GIÁ TRỊ chìa ⇒ KHÔNG đổi băm', () => {
  const a = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
  const b = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['y'] }] };
  assert.notEqual(armHash(a, ['T']), armHash(b, ['T']));
  // Băm ăn TÊN chìa, không ăn giá trị — nếu không thì xoay chìa = một cánh tay
  // khác, và chìa Notion xoay mỗi 8 tiếng.
  assert.equal(armHash(a, ['T']), armHash(a, ['T']));
});

test('🔴 KHÔNG có `dirs` ⇒ prepareArm KHÔNG dựng server', () => {
  const decl = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
  const out = prepareArm('a1', decl, {}) as Record<string, unknown>;
  // Không biết văn phòng nào thì không có `cwd` đúng. Thà không dựng còn hơn thả
  // tiến trình con chạy ở thư mục của daemon. → [[agentco-safe-default-direction]]
  assert.equal(out['type'], 'cli');
  assert.equal(out['instance'], undefined);
});

test('có `dirs` ⇒ dựng server SDK thật, và tờ khai không còn lộ ra ngoài', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-arm-test-'));
  try {
    const decl = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
    const out = prepareArm('a1', decl, {}, { officeState: dir, officeDir: dir }) as Record<string, unknown>;
    assert.equal(out['type'], 'sdk');
    assert.equal(out['name'], 'a1');
    assert.ok(out['instance'], 'thiếu instance ⇒ SDK không có gì để chạy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ────────────────── CỬA DÁN STRICT — khoá dễ gõ sai nhất là khoá AN TOÀN

const minimal = (over: Record<string, unknown> = {}) => ({
  type: 'cli',
  actions: [{ id: 'a', say: 's', description: 'd', run: ['x'], ...over }],
});

test('🔴 ba khoá camelCase hay gõ nhất bị TỪ CHỐI kèm gợi ý đúng', () => {
  for (const [bad, good] of [
    ['readOnly', 'read_only'],
    ['timeoutMs', 'timeout_ms'],
    ['failWhen', 'fail_when'],
  ] as const) {
    const r = parseCliArm(minimal({ [bad]: bad === 'failWhen' ? ['ERROR'] : true }));
    assert.equal(r.ok, false, `"${bad}" lọt qua — lưới đỡ biến mất im lặng`);
    assert.match((r as { error: string }).error, new RegExp(`"${bad}".*"${good}"`));
  }
});

test('gõ thừa/thiếu một ký tự cũng có gợi ý; khoá hoàn toàn lạ thì nói thẳng', () => {
  const a = parseCliArm(minimal({ runs: ['x'] }));
  assert.match((a as { error: string }).error, /"runs".*"run"/);
  const b = parseCliArm(minimal({ hoan_toan_la: 1 }));
  assert.match((b as { error: string }).error, /không có trong tờ khai/);
});

test('🔴 CỬA NẠP vẫn LỎNG — siết cả hai là làm mồ côi mọi cánh tay cũ', () => {
  // `CliArmSchema.parse` (đường nạp/biên dịch) BỎ QUA khoá lạ; chỉ `parseCliArm`
  // (cửa dán, nơi người dùng đang đứng) mới từ chối. Hai luật, cố ý khác nhau.
  assert.doesNotThrow(() => CliArmSchema.parse(minimal({ truong_cua_ban_moi_hon: 1 })));
  assert.equal(parseCliArm(minimal({ truong_cua_ban_moi_hon: 1 })).ok, false);
});

test('tờ khai đúng thì `parseCliArm` trả arm đã điền mặc định', () => {
  const r = parseCliArm(minimal());
  assert.equal(r.ok, true);
  assert.equal((r as { arm: { runs_on: string } }).arm.runs_on, 'daemon');
});

// ──────────────────────────── VÍ DỤ — về CHỖ TRỐNG, không về dòng lệnh

test('`params[].example` đi vào description của ĐÚNG property, trần 60 ký tự', () => {
  const ok = parseCliArm({
    type: 'cli',
    actions: [
      {
        id: 'a',
        say: 's',
        description: 'd',
        run: ['x', '{tag}'],
        params: [{ name: 'tag', type: 'string', required: true, example: 'v1.2.3' }],
      },
    ],
  });
  assert.equal(ok.ok, true);
  // Quá trần ⇒ chặn: ví dụ nằm trong prefix MỌI lượt, nó là hoá đơn lặp lại.
  const dai = parseCliArm({
    type: 'cli',
    actions: [
      {
        id: 'a',
        say: 's',
        description: 'd',
        run: ['x', '{tag}'],
        params: [{ name: 'tag', type: 'string', example: 'x'.repeat(61) }],
      },
    ],
  });
  assert.equal(dai.ok, false);
});

// ─────────────────── CHẶN Ở CỬA, KHÔNG CHẶN Ở LÕI

test('🔴 LÕI TRUNG LẬP: tờ khai CLI đến từ đâu cũng chạy — chặn ở CỬA, không ở LÕI', () => {
  // Cảnh báo "dán nhầm tab" sống ở giao diện (`ArmDialog`), KHÔNG ở đây: lõi
  // không được biết thứ này đến từ màn hình nào. Sửa tay `company.yaml` thêm
  // một tờ khai CLI thì nó VẪN PHẢI CHẠY — đó là ô đo của ranh giới đó.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-core-'));
  try {
    const out = prepareArm('a1', minimal(), {}, { officeState: dir, officeDir: dir }) as Record<string, unknown>;
    assert.equal(out['type'], 'sdk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────── TỜ KHAI PHẢI Ở VÙNG CHỈ ĐỌC — §16i, lỗ vá 01/09

test('🔴 `company.yaml` nằm trong vùng `config` — ghi được là tự khai shell cho vai đã tắt shell', () => {
  const companyDir = path.join(os.tmpdir(), 'ct-company');
  const officeDir = path.join(companyDir, 'offices', 'vp');
  const dirs = { companyDir, officeDir };

  // Trước 01/09 ô này trả `undefined`: `OFFICE_CONFIG` giải tương đối với thư
  // mục VĂN PHÒNG, nên tệp cấu hình cấp công ty chưa bao giờ được gác.
  assert.equal(guardedZone(dirs, path.join(companyDir, 'company.yaml'), 'write'), 'config');
  assert.equal(guardedZone(dirs, path.join(companyDir, 'company.yaml'), 'arm'), 'config');
  // Cấu hình văn phòng vẫn gác như cũ — chống hỏng lây.
  assert.equal(guardedZone(dirs, path.join(officeDir, 'office.yaml'), 'write'), 'config');
  // `.state` vẫn là `secrets`, không bị nhánh mới nuốt mất (nó đứng TRƯỚC).
  assert.equal(guardedZone(dirs, path.join(companyDir, '.state', 'secrets.json'), 'read'), 'secrets');
  // Sổ chi phí KHÔNG gác: append-only, người dùng đọc được, gác là tự đẻ một
  // câu lỗi phải đi giải thích.
  assert.equal(guardedZone(dirs, path.join(companyDir, 'logs', 'usage.jsonl'), 'read'), undefined);
  // Artifact trong văn phòng vẫn mở bình thường.
  assert.equal(guardedZone(dirs, path.join(officeDir, 'artifacts', 'a.md'), 'write'), undefined);
});

test('nhãn mặc định: tên chương trình của việc ĐẦU, không ghép tên các việc', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'đếm hoá đơn', description: 'd', run: ['C:\\Python\\python.exe', '-m', 'hoadon'] },
      { id: 'b', say: 'đồng bộ', description: 'd', run: ['node', 'x.js'] },
    ],
  };
  // Nhãn trả lời "cái này là cái gì"; `does` trả lời "nó làm được gì". Trộn vào
  // một chuỗi là đẻ ra cái tên dài mà vẫn không nói được nó là cái gì.
  assert.equal(defaultArmLabel(decl), 'python');
  // Một cái tên bịa tệ hơn một cái băm thật thà.
  assert.equal(defaultArmLabel({ type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: [] }] }), undefined);
});

test('cấu hình KHÔNG phải CLI đi qua prepareArm nguyên vẹn (chống hỏng lây)', () => {
  const http = { type: 'http', url: 'https://mcp.deepwiki.com/mcp' };
  assert.deepEqual(prepareArm('a2', http, {}), http);
  const stdio = { command: 'node', args: ['x.js'] };
  assert.deepEqual(prepareArm('a3', stdio, {}), stdio);
});
