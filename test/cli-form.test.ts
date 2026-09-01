/**
 * TAB "LỆNH" — ánh xạ form ↔ tờ khai. `web/src/lib/cli-form.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THỨ ĐANG ĐƯỢC KHOÁ Ở ĐÂY LÀ MỘT **LỜI HỨA VỚI NGƯỜI DÙNG**, không phải   │
 * │ một hàm tiện ích.                                                        │
 * │                                                                          │
 * │ User chốt 31/08: *"view Json từ form và ngược lại… nó là ánh xạ 1-1 hai   │
 * │ chiều"*. Một lời hứa dạng "đi vòng rồi về vẫn thế" hỏng theo cách **im    │
 * │ lặng nhất có thể**: không lỗi, không cảnh báo, chỉ là một trường biến     │
 * │ mất sau khi người dùng bấm "← Về form". Và trường dễ mất nhất lại đúng là │
 * │ trường AN TOÀN (`pattern`, `allow_dash`) — cùng lớp lỗi với `failWhen`    │
 * │ camelCase mà `parseCliArm` sinh ra để chặn.                              │
 * │                                                                          │
 * │ ⚠ Bài cuối là bài quan trọng nhất: **form KHÔNG được đẻ ra thứ mà cửa dán │
 * │ từ chối.** Hai chỗ đó do hai file khác nhau giữ, nên không có gì tự bắt   │
 * │ được lúc chúng lệch nhau ngoài một bài đi qua cả hai.                     │
 * │ → [[agentco-detect-fix-pair-scope]] · [[agentco-fallback-throws-away-answers]]
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  alignExample,
  blankAct,
  cliCount,
  cliDecl,
  cliProblems,
  declToDraft,
  draftToDecl,
  dupIds,
  isCliPaste,
  joinArgv,
  sampleAct,
  slots,
  slugId,
  toArgv,
  type CliDraft,
} from '../web/src/lib/cli-form.ts';
import { parseCliArm } from '../dist/core/cli-arm.js';
import { defaultArmLabel } from '../dist/core/armexec.js';

// ═══════════════════════════════════════════════ 1 · Tách và ghép dòng lệnh

test('toArgv tôn trọng nháy, KHÔNG hiểu cú pháp shell', () => {
  assert.deepEqual(toArgv('node -e "console.log(1)"'), ['node', '-e', 'console.log(1)']);
  // `|`, `&&`, `$()` KHÔNG được xử lý — chúng chỉ là ký tự trong một mảnh argv.
  // Đây là cột chịu lực an ninh của §16e, không phải một thiếu sót.
  assert.deepEqual(toArgv('ls | rm -rf /'), ['ls', '|', 'rm', '-rf', '/']);
  // Chuỗi rỗng có nháy vẫn là MỘT mảnh — `--flag ""` khác hẳn `--flag`.
  assert.deepEqual(toArgv('a "" b'), ['a', '', 'b']);
});

test('joinArgv là NGHỊCH ĐẢO của toArgv, kể cả khi mảnh có nháy', () => {
  for (const argv of [
    ['node', '-e', "console.log('Xin chào, ' + process.argv[1])"],
    ['git', 'commit', '-m', 'sửa lỗi lòi chữ'],
    ['x', ''],
    ['echo', 'nói "thế" đi'],
    ['C:\\Program Files\\x\\y.exe', '--in', 'D:\\Hồ sơ\\2026'],
  ]) {
    assert.deepEqual(toArgv(joinArgv(argv)), argv, `vỡ ở: ${JSON.stringify(argv)}`);
  }
});

test('slots lấy ô trống theo thứ tự, không lặp', () => {
  assert.deepEqual(slots(['a', '{x}', '--f={y}', '{x}']), ['x', 'y']);
  assert.deepEqual(slots(['a', 'b']), []);
});

test('slugId biến câu tiếng Việt thành id hợp khuôn schema', () => {
  const ok = /^[a-z][a-z0-9_]*$/;
  for (const say of ['đếm hoá đơn chưa thanh toán', 'Đồng bộ!!!', '123 việc', 'nói xin chào']) {
    assert.match(slugId(say), ok, `id sai khuôn cho "${say}"`);
  }
  assert.equal(slugId('đếm hoá đơn'), 'dem_hoa_don');
});

// ═════════════════════════════════════════ 2 · Ví dụ: dòng lệnh thật → từng ô

test('alignExample bóc giá trị từ một dòng lệnh thật', () => {
  assert.deepEqual(alignExample(['node', 'd.js', '--thang', '{thang}'], ['node', 'd.js', '--thang', '8']), {
    thang: '8',
  });
  // Ô trống nằm GIỮA một mảnh (`--thang={thang}`) vẫn bóc được.
  assert.deepEqual(alignExample(['x', '--t={t}'], ['x', '--t=8']), { t: '8' });
});

test('🔴 ví dụ KHÔNG khớp cú pháp thì trả null — không đoán bừa', () => {
  // Lệch số mảnh ⇒ ví dụ thuộc về một cú pháp khác.
  assert.equal(alignExample(['a', '{x}'], ['a', 'b', 'c']), null);
  // Mảnh cố định khác nhau ⇒ họ sửa cú pháp mà quên sửa ví dụ.
  assert.equal(alignExample(['node', 'd.js', '{x}'], ['node', 'khac.js', '5']), null);
  assert.equal(alignExample([], []), null);
});

// ═══════════════════════════════════ 3 · 1-1 HAI CHIỀU (lời hứa với user)

const DIR = 'D:\\Hồ sơ\\2026';

const full = (): CliDraft => ({
  say: 'đếm hoá đơn chưa thanh toán',
  description: 'Đếm số hoá đơn còn nợ trong tháng. Chỉ đọc, không sửa gì.',
  line: 'node dem.js --thang {thang}',
  example: 'node dem.js --thang 8',
  read_only: true,
  /** ⚠ Ô này KHÔNG có trong form từ 01/09 — nó phải chở qua được. → §16v */
  fail_when: 'FATAL:',
  params: [],
});

test('form → JSON → form → JSON không đổi một ký tự', () => {
  const once = draftToDecl([full()], DIR);
  const back = declToDraft(once);
  assert.ok(back, 'đọc ngược ra rỗng');
  assert.equal(back.mixed, false);
  const twice = draftToDecl(back.acts, back.cwd);
  assert.deepEqual(twice, once);
  // Và vòng thứ hai trên chính bản nháp cũng phải đứng yên.
  assert.deepEqual(declToDraft(twice), back);
});

test('dòng ví dụ dựng lại được từ JSON — người dùng thấy lại thứ họ đã gõ', () => {
  const back = declToDraft(draftToDecl([full()], DIR))!;
  assert.equal(back.acts[0]!.example, 'node dem.js --thang 8');
  assert.equal(back.acts[0]!.read_only, true);
  assert.equal(back.cwd, DIR, 'thư mục chung không đọc ngược được');
  // 🔴 `fail_when` ra khỏi form nhưng PHẢI sống sót — cùng lý lẽ với `pattern`.
  assert.equal(back.acts[0]!.fail_when, 'FATAL:');
});

test('thư mục là của CẢ CÁNH TAY — mọi lệnh nhận cùng một `cwd`', () => {
  const decl = draftToDecl([full(), { ...full(), say: 'việc hai' }], DIR);
  assert.deepEqual(decl.actions.map((a) => a['cwd']), [DIR, DIR]);
  // Không chọn thư mục ⇒ KHÔNG khai `cwd` ⇒ server rơi về thư mục văn phòng.
  assert.equal(draftToDecl([full()], '').actions[0]!['cwd'], undefined);
});

test('🔴 `cwd` lệch nhau giữa các lệnh ⇒ `mixed`, KHÔNG tự chọn hộ', () => {
  /**
   * Form chỉ giữ được MỘT thư mục. Im lặng lấy cái đầu tiên là dời chỗ chạy của
   * n−1 lệnh còn lại mà không ai được báo — với một lệnh ghi dữ liệu thì đó là
   * chạy nhầm thư mục, không phải một lỗi hiển thị.
   */
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'a', description: 'a', run: ['node', 'a.js'], cwd: 'D:\\mot' },
      { id: 'b', say: 'b', description: 'b', run: ['node', 'b.js'], cwd: 'D:\\hai' },
    ],
  };
  const back = declToDraft(decl)!;
  assert.equal(back.mixed, true);
  assert.equal(back.cwd, '', 'không được chọn hộ một trong hai');
});

test('🔴 hàng rào của tham số SỐNG SÓT một vòng qua form', () => {
  /**
   * Ca thật: người dùng soạn ở tab JSON, đặt `pattern` + `allow_dash`, rồi bấm
   * "← Về form" xem lại. Form không vẽ hai ô đó. Nếu nó thả rơi chúng thì cú bấm
   * kia vừa **gỡ một hàng rào** mà không nói gì — và `fillArgv` sau đó nhận mọi
   * giá trị, kể cả thứ mở đầu bằng dấu gạch.
   */
  const decl = {
    type: 'cli',
    actions: [
      {
        id: 'trien_khai',
        say: 'triển khai',
        description: 'Đẩy bản mới lên. ⚠ Ghi đè bản đang chạy.',
        run: ['pnpm', 'deploy', '--tag', '{tag}'],
        params: [
          { name: 'tag', type: 'string', required: true, pattern: '^v[0-9.]+$', allow_dash: false, example: 'v1.2.3' },
        ],
      },
    ],
  };
  const back = declToDraft(decl)!;
  const round = draftToDecl(back.acts, back.cwd);
  const p = (round.actions[0]!['params'] as Record<string, unknown>[])[0]!;
  assert.equal(p['pattern'], '^v[0-9.]+$', 'pattern bị thả rơi');
  assert.equal(p['allow_dash'], false, 'allow_dash bị thả rơi');
  assert.equal(p['example'], 'v1.2.3');
});

test('sửa dòng ví dụ thì example của tham số đi theo', () => {
  const d = full();
  d.example = 'node dem.js --thang 12';
  const params = draftToDecl([d]).actions[0]!['params'] as Record<string, unknown>[];
  assert.equal(params[0]!['example'], '12');
});

test('ô trống trong cú pháp là NGUỒN SỰ THẬT của danh sách tham số', () => {
  const d = full();
  d.line = 'node dem.js --thang {thang} --nam {nam}';
  d.example = '';
  const params = draftToDecl([d]).actions[0]!['params'] as Record<string, unknown>[];
  assert.deepEqual(params.map((p) => p['name']), ['thang', 'nam']);
  // Không có cú pháp ô trống ⇒ không có tham số nào, kể cả khi JSON cũ có.
  d.line = 'node dem.js';
  assert.equal(draftToDecl([d]).actions[0]!['params'], undefined);
});

// ══════════════════════════════════════════════ 4 · Nối với LÕI và với CỬA

test('🔴 form KHÔNG được đẻ ra thứ mà cửa dán từ chối', () => {
  for (const draft of [full(), sampleAct()]) {
    const r = parseCliArm(draftToDecl([draft]));
    assert.equal(r.ok, true, `cửa dán từ chối: ${r.ok ? '' : r.error}`);
  }
});

test('mẫu "chạy thử" đầy đủ và tự nhận diện được', () => {
  const s = sampleAct();
  const decl = draftToDecl([s]);
  assert.equal(decl.actions.length, 1, 'mẫu phải qua được bộ lọc "việc còn trống"');
  assert.equal(isCliPaste(JSON.stringify(decl)), true);
  // Mẫu PHẢI có ô trống — không có thì ô "Ví dụ" không hiện, và nó dạy sai
  // một nửa quan trọng nhất của tab này.
  const params = decl.actions[0]!['params'] as Record<string, unknown>[];
  assert.equal(params.length, 1);
  // ⚠ So với **mảnh cuối của chính dòng ví dụ trong mẫu**, không với một chuỗi
  // gõ cứng: bài này khoá CƠ CHẾ bóc ví dụ, không khoá cái tên trong mẫu — đổi
  // tên mẫu là chuyện thẩm mỹ và không được làm đỏ một bài về `alignExample`.
  assert.equal(params[0]!['example'], toArgv(s.example).at(-1), 'ví dụ trong mẫu không bóc ra được');
  assert.ok(params[0]!['example'], 'mẫu phải có ví dụ bóc được');
  // Không khai `cwd` ⇒ rơi về thư mục văn phòng, thứ luôn tồn tại.
  assert.equal(decl.actions[0]!['cwd'], undefined);
});

test('🔴 nhãn mặc định của cánh tay CLI là TÊN THƯ MỤC, không phải tên binary', () => {
  /**
   * Ca thường nhất: một cánh tay CLI là một dự án, và mọi lệnh của dự án JS đều
   * mở đầu bằng `node` ⇒ lấy tên binary thì ba dự án ra ba node cùng tên "node".
   */
  const withDir = draftToDecl([full()], 'D:\\Works\\ke-toan');
  assert.equal(defaultArmLabel(withDir), 'ke-toan');
  // Gạch chéo cuối không được biến nhãn thành chuỗi rỗng.
  assert.equal(defaultArmLabel(draftToDecl([full()], 'D:\\Works\\ke-toan\\')), 'ke-toan');
  // Không có thư mục ⇒ ngã về tên chương trình, chứ không ngã về băm.
  assert.equal(defaultArmLabel(draftToDecl([full()], '')), 'node');
});

// ═══════════════════════════════ 4b · LỆNH CÒN DỞ — KHÔNG ĐƯỢC LỌC BỎ IM LẶNG

test('🔴 lệnh còn dở KHÔNG bị vứt đi — đo được: 2 lệnh vào, 2 action ra, 2 lệnh về', () => {
  /**
   * Bug user bắt 01/09. Bản trước `draftToDecl` lọc bỏ dòng chưa điền cho đầu ra
   * "sạch", và đo được cái giá: form **2 lệnh** → JSON **1 action** → về form
   * còn **1 lệnh**. Bấm *Xem JSON* rồi *← Về form* là mất hẳn một dòng, im lặng.
   *
   * ⭐ Bộ lọc CHÍNH LÀ bug: nó xoá dữ liệu người dùng để đầu ra hợp lệ — hàng
   * giả. → [[agentco-fallback-throws-away-answers]]
   */
  const form = [sampleAct(), blankAct()];
  const decl = draftToDecl(form, DIR);
  assert.equal(decl.actions.length, 2, 'lệnh còn dở bị vứt đi');
  assert.equal(declToDraft(decl)!.acts.length, 2, 'đi một vòng JSON là mất dòng');
});

test('🔴 lệnh còn dở làm nút MỜ — và chỉ đúng dòng, đúng ô', () => {
  assert.deepEqual(cliProblems([sampleAct()]), [], 'lệnh đủ mà vẫn kêu');
  const bad = cliProblems([sampleAct(), blankAct()]);
  assert.deepEqual(
    bad.map((p) => [p.at, p.field]),
    [[1, 'say'], [1, 'line']],
    'phải chỉ đúng dòng 2, đúng hai ô còn trống',
  );
  // Thiếu MỘT ô thôi cũng là chưa xong.
  assert.deepEqual(cliProblems([{ ...sampleAct(), line: '' }]).map((p) => p.field), ['line']);
  assert.deepEqual(cliProblems([{ ...sampleAct(), say: '  ' }]).map((p) => p.field), ['say']);
});

test('🔴 khối JSON hỏng ⇒ KHÔNG ngã về bản form', () => {
  /**
   * Bản trước `cliDecl` ngã về `draftToDecl(list)` khi JSON hỏng ⇒ nút vẫn sáng
   * trong lúc ô JSON đang đỏ, và bấm vào thì lưu **bản form** — không phải thứ
   * đang hiện trên màn hình.
   */
  assert.equal(cliDecl([sampleAct()], DIR, '{ hỏng'), null);
  assert.equal(cliCount(null), 0, 'null phải đếm ra 0 để nút mờ');
  // Vẫn phải chạy đúng ở hai nhánh lành.
  assert.equal(cliCount(cliDecl([sampleAct()], DIR, null)), 1);
  assert.equal(cliCount(cliDecl([], DIR, '{"type":"cli","actions":[{"id":"a"}]}')), 1);
});

// ══════════════════════════════════════════════════ 5 · MÃ LỆNH TRÙNG NHAU

/**
 * ĐÃ ĐO 01/09: `createSdkMcpServer` **ném** `Tool a is already registered`.
 * Nên không có ca nuốt im lặng — nhưng nó ném **lúc bấm Thử**, bằng tiếng Anh
 * nói về "tool". Ba bài dưới khoá ba tầng của cùng một chuyện.
 */
test('🔴 cửa dán TỪ CHỐI hai lệnh trùng mã, và nói bằng tiếng người', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'một', description: 'đếm, chỉ đọc', run: ['node', '-e', '1'] },
      { id: 'a', say: 'hai', description: '⚠ xoá sạch', run: ['node', '-e', '2'] },
    ],
  };
  const r = parseCliArm(decl);
  assert.equal(r.ok, false, 'lọt qua cửa dán');
  if (!r.ok) {
    assert.match(r.error, /"a"/, 'câu lỗi không nêu mã trùng');
    assert.match(r.error, /mã riêng/, 'câu lỗi không nói phải làm gì');
  }
  // Mã khác nhau thì vẫn qua — bài chống dương-tính-giả.
  decl.actions[1]!.id = 'b';
  assert.equal(parseCliArm(decl).ok, true);
});

test('🔴 FORM tự sinh ra được mã trùng — hai tên gần giống, một mã', () => {
  /**
   * Người dùng **không bao giờ gõ `id`**: nó do `slugId(say)` sinh ra. Nên đây
   * KHÔNG phải ca hiếm của người nghịch JSON — nó tới từ đường chính.
   */
  assert.equal(slugId('đếm hoá đơn'), slugId('đếm hoá đơn!'));
  const decl = draftToDecl(
    [
      { ...full(), say: 'đếm hoá đơn' },
      { ...full(), say: 'đếm hoá đơn!' },
    ],
    DIR,
  );
  assert.deepEqual(dupIds(decl), ['dem_hoa_don'], 'giao diện không thấy được mã trùng');
  assert.equal(parseCliArm(decl).ok, false, 'cửa dán phải chặn chính thứ form vừa sinh ra');
});

test('dupIds im khi không có gì trùng', () => {
  assert.deepEqual(dupIds(draftToDecl([full(), { ...full(), say: 'việc hai' }], DIR)), []);
  assert.deepEqual(dupIds({}), []);
});

test('isCliPaste hỏi ĐÚNG câu isCliArm hỏi — theo `type`, không theo vắng mặt', () => {
  assert.equal(isCliPaste('{"type":"cli","actions":[]}'), true);
  assert.equal(isCliPaste('{"command":"npx","args":[]}'), false);
  // Khối trống rỗng KHÔNG được im lặng thành CLI.
  assert.equal(isCliPaste('{}'), false);
  assert.equal(isCliPaste('không phải json'), false);
});
