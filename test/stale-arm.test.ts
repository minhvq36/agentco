/**
 * Test cho CỔNG HẬU KIỂM "Trợ lý nhắc tới cánh tay đã rút dây".
 * → docs/SPEC-arms.md §15 · `src/core/assistant.ts`
 *
 * Ca gốc, đo được 24/08: người dùng gõ **y hệt** một câu ba lần quanh lúc rút
 * dây, và Trợ lý trả về **giống nhau từng ký tự** cả ba, kèm nguyên văn một
 * đường dẫn đã không còn trong prompt của lượt đó. Model chép lại câu của chính
 * nó trong lịch sử `resume`.
 *
 * Đây là lớp TẤT ĐỊNH duy nhất áp được vào tầng câu chữ, nên sai ở đây có hai
 * chiều và cả hai đều đắt:
 *
 *   lọt nhầm   → người dùng nhận một câu hỏi về thư mục vừa bị rút, và tin nó
 *   bắn nhầm   → trả tiền một lượt sửa cho một câu vốn đã đúng, mỗi lượt chat
 *
 * Bốn test dưới đây canh đúng bốn ca "bắn nhầm" đã nghĩ ra TRƯỚC khi viết mã.
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { reachDiff, routeText, staleMentions } from '../dist/core/assistant.js';

const ARMS = {
  aMusic: { label: 'Musics' },
  aInstall: { label: 'Programs Installation' },
  aGrub: { label: 'grub2win' },
  aTiny: { label: 'HS' },
};
const SERVERS = {
  aMusic: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Musics'] },
  aInstall: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Programs Installation'] },
  aGrub: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Programs Installation\\grub2win'] },
  aTiny: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\HS'] },
};

const check = (live: string[], say: string, userText = '') =>
  staleMentions({ arms: ARMS, servers: SERVERS, live: new Set(live), say, userText });

// ─────────────────────────────────────────────────── ca phải BẮT

test('bắt đúng ca gốc: nhắc nhãn + đường dẫn của cánh tay đã rút dây', () => {
  const say = 'Bạn muốn soi thư mục nào: Programs Installation (D:\\Downloads\\Programs Installation) hay Musics?';
  assert.deepEqual(check(['aMusic'], say).sort(), ['D:\\Downloads\\Programs Installation', 'Programs Installation']);
});

test('bắt khi chỉ nhắc đường dẫn — và bắt LUÔN cái nhãn nằm lồng trong nó', () => {
  // Nhãn `Programs Installation` là chuỗi con của chính đường dẫn, nên một câu
  // chỉ nêu đường dẫn vẫn trúng cả hai kim. Đó là ĐÚNG: cả hai đều trỏ về một
  // cánh tay đã rút, và câu sửa nêu cả hai thì model càng khó hiểu nhầm.
  assert.deepEqual(check(['aMusic'], 'Mình sẽ xem trong D:\\Downloads\\Programs Installation nhé.').sort(), [
    'D:\\Downloads\\Programs Installation',
    'Programs Installation',
  ]);
});

test('không phân biệt hoa thường — model viết lại tên theo kiểu của nó', () => {
  assert.deepEqual(check(['aMusic'], 'Thư mục PROGRAMS INSTALLATION có gì?'), ['Programs Installation']);
});

// ─────────────────────────────────────── bốn ca phải IM (dương tính giả)

test('IM khi cánh tay VẪN còn nối — đây là câu đúng, không phải câu cũ', () => {
  assert.deepEqual(check(['aMusic', 'aInstall'], 'Soi Programs Installation hay Musics?'), []);
});

test('IM khi CHÍNH NGƯỜI DÙNG nêu tên đó — Trợ lý trả lời "không ai với tới" là đúng', () => {
  const say = 'Hiện không nhân viên nào với tới Programs Installation cả.';
  assert.deepEqual(check(['aMusic'], say, 'Xem giúp mình thư mục Programs Installation'), []);
});

test('IM khi thư mục CON còn nối: rút cha mà con còn thì nhắc cha không phải nói bậy', () => {
  // `aInstall` (cha) đã rút, `aGrub` (con) vẫn nối ⇒ chuỗi của cha nằm trong
  // chuỗi của con, nên nhắc tới nó vẫn có nghĩa.
  assert.deepEqual(check(['aGrub'], 'Mình xem trong D:\\Downloads\\Programs Installation nhé.'), []);
});

test('IM với nhãn dưới 4 ký tự — thà bỏ sót còn hơn bắn ở mọi lượt chat', () => {
  // "HS" nằm trong vô số câu tiếng Việt. Đường dẫn `D:\HS` thì vẫn đủ dài.
  assert.deepEqual(check(['aMusic'], 'Mình HS chưa rõ ý bạn lắm.'), []);
});

// ─────────────────────────────────────────────────────────── routeText

test('routeText: lấy đúng trường chữ của từng cửa', () => {
  assert.equal(routeText({ intent: 'chat', say: 'Chào bạn' }), 'Chào bạn');
  assert.equal(routeText({ intent: 'ask', say: 'Thư mục nào?' }), 'Thư mục nào?');
  assert.equal(routeText({ intent: 'task', request: 'Soi thư mục X', scope: 'new' }), 'Soi thư mục X');
  assert.equal(routeText({ intent: 'lookup', paths: [], question: 'X là gì' }), 'X là gì');
});

test('routeText: `garbled` trả RỖNG — câu đó do ta viết, soi nó là tự kiểm tra mình', () => {
  assert.equal(routeText({ intent: 'garbled', say: 'Mình trả lời sai định dạng…', raw: '{}' }), '');
});

// ─────────────────────────────────────────────────────────── reachDiff
//
// Diff tồn tại để biến một sự VẮNG MẶT thành một sự CÓ MẶT — xem chú thích
// `reachDiff`. Nên hai test đầu canh đúng chiều "rút", chiều vốn thua lịch sử.

const map = (o: Record<string, string[]>) => new Map(Object.entries(o));

test('reachDiff: rút dây thành một dòng CHỮ, không phải một chỗ trống', () => {
  assert.deepEqual(
    reachDiff(map({ 'ho-tro': ['Notion (đường tắt tới D:\\N)'] }), map({ 'ho-tro': [] })),
    ['− Notion ✗ ho-tro'],
  );
});

test('reachDiff: nối dây và rút dây trong cùng một lượt', () => {
  assert.deepEqual(
    reachDiff(
      map({ 'ho-tro': ['Notion'], 'nguoi-soi': [] }),
      map({ 'ho-tro': [], 'nguoi-soi': ['Musics (đường tắt tới D:\\Downloads\\Musics)'] }),
    ),
    ['− Notion ✗ ho-tro', '+ Musics → nguoi-soi'],
  );
});

test('reachDiff: chỉ giữ NHÃN — không tiêm lại đường dẫn vừa bị rút', () => {
  const [line] = reachDiff(
    map({ x: ['Programs Installation (đường tắt tới D:\\Downloads\\Programs Installation)'] }),
    map({ x: [] }),
  );
  assert.equal(line, '− Programs Installation ✗ x');
  assert.ok(!line.includes('D:\\'), 'đường dẫn không được lọt vào dòng diff');
});

test('reachDiff: không đổi thì RỖNG — dòng nhắc phải im ở lượt bình thường', () => {
  assert.deepEqual(reachDiff(map({ a: ['M'] }), map({ a: ['M'] })), []);
});

test('reachDiff: nhân viên bị cất đi tính là RÚT, nhân viên mới tính là NỐI', () => {
  assert.deepEqual(reachDiff(map({ cu: ['A'] }), map({ moi: ['B'] })), ['− A ✗ cu', '+ B → moi']);
});

test('reachDiff: đổi tên cánh tay hiện thành rút + nối — thật thà hơn là im lặng', () => {
  assert.deepEqual(reachDiff(map({ a: ['Musics'] }), map({ a: ['Nhac cua toi'] })), [
    '+ Nhac cua toi → a',
    '− Musics ✗ a',
  ]);
});

test('reachDiff: BẬT shell cũng phải sinh một dòng — cùng lớp lỗi với rút dây', () => {
  // Ca thật 24/08: bật `Bash` xong hỏi lại y hệt, Trợ lý đáp "câu này mình đã
  // thử trước đó rồi và bị chặn". Prompt đã đúng; thiếu đúng cái dòng này.
  assert.deepEqual(reachDiff(map({ 'ho-tro': ['Musics'] }), map({ 'ho-tro': ['Musics', 'chạy lệnh'] })), [
    '+ chạy lệnh → ho-tro',
  ]);
});

test('reachDiff: TẮT shell cũng sinh dòng, và đây là chiều vốn thua lịch sử', () => {
  assert.deepEqual(reachDiff(map({ r: ['chạy lệnh'] }), map({ r: [] })), ['− chạy lệnh ✗ r']);
});

test('reachDiff: TRẦN chặn một lần sửa hàng loạt nhét cả bức tường vào phiên', () => {
  const before = map({ r: ['A', 'B', 'C', 'D', 'E', 'F'] });
  const out = reachDiff(before, map({ r: [] }), 4);
  assert.equal(out.length, 5);
  assert.equal(out[4], 'và 2 thay đổi khác');
});

// ═══════════ KIM THỨ BA: TÊN TÀI KHOẢN (`via`) — ca lọt thật 28/08 ═══════════

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CỔNG NÀY ĐỂ LỌT MỘT CA, VÀ NÓ KHÔNG SAI LUẬT — NÓ THIẾU MỘT CÂY KIM.    │
 * │                                                                          │
 * │ User gỡ tài khoản `minhvuptitd14` rồi Trợ lý vẫn hỏi:                     │
 * │   *"Repo 'focus-flow' nằm trong tài khoản GitHub minhvq36 hay             │
 * │    minhvuptitd14 vậy bạn?"*                                              │
 * │                                                                          │
 * │ Kim cũ là `label` = `"GitHub · minhvuptitd14"`. Câu trên KHÔNG chứa       │
 * │ nguyên chuỗi đó ⇒ không khớp ⇒ không bắn.                                 │
 * │                                                                          │
 * │ Vì sao cánh tay thư mục không dính: nhãn của chúng thường được nhắc       │
 * │ nguyên vẹn (`D:\Downloads\…`). Cánh tay OAuth thì thứ người ta nhắc là    │
 * │ **tên tài khoản đứng một mình** — phần `"GitHub · "` bị bỏ.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_ARMS = {
  aGhOld: { label: 'GitHub · minhvuptitd14', via: 'minhvuptitd14' },
  aGhNew: { label: 'GitHub · minhvq36', via: 'minhvq36' },
};
const OAUTH_SRV = { aGhOld: { type: 'http' }, aGhNew: { type: 'http' } };

const stale = (say: string, userText = '', live: string[] = ['aGhNew']) =>
  staleMentions({
    arms: OAUTH_ARMS,
    servers: OAUTH_SRV,
    live: new Set(live),
    say,
    userText,
  });

test('🔴 CA THẬT: tên tài khoản đã gỡ, nhắc TRỐNG KHÔNG (không kèm "GitHub ·")', () => {
  const hits = stale("Repo 'focus-flow' này nằm trong tài khoản GitHub minhvq36 hay minhvuptitd14 vậy bạn?");
  assert.deepEqual(hits, ['minhvuptitd14'], 'kim `label` một mình không bắt được ca này');
});

test('🔴 tài khoản CÒN NỐI thì im — nếu không cổng bắn ở mọi lượt', () => {
  assert.deepEqual(stale('Mình sẽ đọc repo bằng tài khoản minhvq36 nhé.'), []);
});

test('🔴 người dùng TỰ nêu tên đó ⇒ trả lời về nó là hành vi ĐÚNG', () => {
  // Điều kiện 2 của cổng. Thiếu nó thì hỏi "minhvuptitd14 đâu rồi?" sẽ bị chính
  // cổng chặn mất câu trả lời thật thà *"tài khoản đó không còn nối nữa"*.
  assert.deepEqual(
    stale('Tài khoản minhvuptitd14 giờ sao rồi?', 'minhvuptitd14 giờ sao rồi?'),
    [],
  );
});

test('⭐ vắng `via` (cánh tay không OAuth) thì cổng chạy y như cũ', () => {
  // Trường mới là TUỲ CHỌN. Cánh tay thư mục không có `via`, và hành vi của
  // chúng phải không đổi một chút nào sau bản vá này.
  const hits = staleMentions({
    arms: { aMusic: { label: 'Musics' } },
    servers: { aMusic: {} },
    live: new Set<string>(),
    say: 'Mình đã xem thư mục Musics.',
    userText: '',
  });
  assert.deepEqual(hits, ['Musics']);
});
