/**
 * Test cho CỬA RA của một lượt Trợ lý — nơi một bug đã lọt tới mặt người dùng.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT, 20/08 — và nó là lý do file này tồn tại.                        │
 * │                                                                          │
 * │ Người dùng: *"Bạn có thể nêu cho tôi 10 thuật ngữ tiếng anh?"*            │
 * │ Trợ lý:     *"lấy từ tài liệu nào?"*                                      │
 * │ Người dùng: *"uhm, bất kỳ, random cũng đc"*                               │
 * │ Ô chat:     một khối ```json với `steps`/`tasks`/`deps`.                   │
 * │                                                                          │
 * │ Model trả lời ĐÚNG NỘI DUNG nhưng qua SAI CỬA: `RouteSchema` không khớp,  │
 * │ nhánh dự phòng đổ nguyên văn bản thô lên chat, `run()` không bao giờ được │
 * │ gọi. Người dùng trả tiền một lượt để nhận về một đoạn mã, và **không ai   │
 * │ làm việc họ vừa giao**.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ba hàm thuần, 0 token, 0 lượt LLM — đúng thứ §4 xếp ưu tiên 0:
 *
 *  · `decideRoute` — model vừa nói gì, và cái gì được phép lên mặt người dùng
 *  · `buildPlan`   — bản nháp → kế hoạch chạy được (bốn luật đã từng có bug)
 *  · `requestOf`   — tên việc suy từ dữ liệu, không hỏi thêm một lượt
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildPlan, decideRoute, requestOf } from '../dist/core/assistant.js';
import { pickReadable, readingNote } from '../dist/core/commands.js';

type Draft = Parameters<typeof buildPlan>[0];

const draftTask = (patch: Record<string, unknown> = {}) => ({
  task_id: 'T-01',
  role: 'nguoi-dich',
  goal: 'Liệt kê 10 thuật ngữ',
  inputs: [] as { path: string }[],
  outputs: [{ path: 'artifacts/T-01/ket-qua.md' }],
  constraints: [] as string[],
  deps: [] as string[],
  step: 0,
  ...patch,
});

const draft = (tasks: unknown[], steps = ['Làm việc']): Draft =>
  ({ steps, tasks }) as unknown as Draft;

const fence = (o: unknown) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';

// ──────────────────────────────────────────────────────────── decideRoute

test('decideRoute: ba cửa hợp lệ đi thẳng', () => {
  assert.deepEqual(decideRoute(fence({ intent: 'chat', say: 'Chào bạn!' })), {
    intent: 'chat',
    say: 'Chào bạn!',
  });
  assert.deepEqual(decideRoute(fence({ intent: 'ask', say: 'Lấy từ tài liệu nào?' })), {
    intent: 'ask',
    say: 'Lấy từ tài liệu nào?',
  });
  assert.deepEqual(decideRoute(fence({ intent: 'task', request: 'Dịch doc-1' })), {
    intent: 'task',
    request: 'Dịch doc-1',
    scope: 'new',
  });
});

test('decideRoute: lookup — worker ẩn, có đường dẫn và câu hỏi', () => {
  const out = decideRoute(
    fence({
      intent: 'lookup',
      paths: ['library/files/doc-2.md'],
      question: 'Nội dung chính là gì?',
    }),
  );
  assert.equal(out.intent, 'lookup');
  assert.ok(out.intent === 'lookup');
  assert.deepEqual(out.paths, ['library/files/doc-2.md']);
});

/**
 * `paths` RỖNG KHÔNG PHẢI MỘT LOOKUP HỢP LỆ.
 *
 * Trợ lý đã cầm sẵn bảng kê tủ tài liệu và bảng kê Kết quả trong prefix — đó
 * chính là việc của hai bảng đó. Không nêu được tên file thì đường đúng là hỏi
 * lại, không phải thả một agent đi mò. Schema chặn, nên nó rơi xuống `garbled`
 * và người dùng KHÔNG nhìn thấy khối JSON.
 */
test('decideRoute: lookup thiếu paths thì không lọt qua', () => {
  const out = decideRoute(fence({ intent: 'lookup', paths: [], question: 'gì đó' }));
  assert.equal(out.intent, 'garbled');
});

/**
 * ĐÂY LÀ CA ĐÃ ĐO ĐƯỢC — nguyên văn thứ người dùng nhìn thấy trong ô chat.
 *
 * Kế hoạch phải được NHẶT VỀ, không phải hiện ra. Nó đã được trả tiền ở lượt
 * `route()` vừa rồi, và vứt nó đi để gọi `plan()` lần nữa là trả tiền hai lần
 * cho cùng một suy nghĩ — luật "ra bản nháp để sửa còn hơn viết mới từ đầu".
 */
test('decideRoute: model trả nguyên một KẾ HOẠCH thì nhặt về, không đổ lên chat', () => {
  const leaked = fence({
    steps: ['Lấy 10 thuật ngữ từ bảng đã dịch'],
    tasks: [
      {
        task_id: 'T-01',
        role: 'nguoi-dich',
        goal: 'Mở bảng thuật ngữ của doc-1 và liệt kê đúng 10 thuật ngữ',
        inputs: [{ path: 'artifacts/P-260820-0533-mreo/T-01/vi/thuat-ngu-doc-1.md' }],
        outputs: [{ path: 'artifacts/T-01/10-thuat-ngu.md' }],
        constraints: ['Giữ đúng định dạng bảng 3 cột'],
        deps: [],
        step: 0,
        deliver: 'reply',
      },
    ],
  });

  const out = decideRoute(leaked);
  assert.equal(out.intent, 'plan');
  assert.ok(out.intent === 'plan');
  assert.equal(out.draft.tasks[0]!.role, 'nguoi-dich');
  // Chuỗi JSON không được có mặt trong bất kỳ câu nào đi tới người dùng.
  assert.equal('say' in out, false);
});

/**
 * `{"ask":…}` là hình dạng hợp lệ của khâu LẬP KẾ HOẠCH. Hình dạng khác
 * `intent: 'ask'` nhưng ý nghĩa trùng khít, nên đừng bắt người dùng chịu một
 * "lỗi định dạng" cho một câu hỏi hoàn toàn hợp lý.
 */
test('decideRoute: {"ask"} của khâu lập kế hoạch cũng là một câu hỏi hợp lệ', () => {
  assert.deepEqual(decideRoute(fence({ ask: 'Bạn muốn lấy từ doc mấy?' })), {
    intent: 'ask',
    say: 'Bạn muốn lấy từ doc mấy?',
  });
});

/**
 * LUẬT HẸP CÓ CHỦ Ý: văn xuôi vẫn hiện như cũ.
 *
 * Model lỡ quên bọc JSON mà vẫn nói một câu tiếng Việt cho người đọc thì hiện
 * câu đó đúng hơn là nuốt đi. Thứ bị chặn CHỈ là JSON — một khối JSON không bao
 * giờ là câu nói cho người dùng.
 */
test('decideRoute: văn xuôi trần vẫn được hiện', () => {
  const out = decideRoute('Chào bạn, mình là trợ lý của văn phòng này.');
  assert.deepEqual(out, { intent: 'chat', say: 'Chào bạn, mình là trợ lý của văn phòng này.' });
});

test('decideRoute: JSON không khớp schema nào thì KHÔNG được lên mặt người dùng', () => {
  const junk = fence({ intent: 'task' }); // thiếu `request` → không schema nào khớp
  const out = decideRoute(junk);
  assert.equal(out.intent, 'garbled');
  assert.ok(out.intent === 'garbled');
  // Câu cho người đọc do CODE viết: không có dấu ngoặc nhọn nào trong đó.
  assert.equal(/[{}]/.test(out.say), false);
  // …nhưng nguyên văn KHÔNG bị vứt: nó đi vào `.state/route-failure.log`.
  assert.ok(out.raw.includes('"intent"'));
});

test('decideRoute: model không trả về gì thì nói đúng là lỗi đường truyền', () => {
  const out = decideRoute('   ');
  assert.equal(out.intent, 'garbled');
  assert.ok(out.intent === 'garbled');
  assert.ok(out.say.includes('đường truyền'));
  assert.equal(out.raw, '');
});

// ──────────────────────────────────────────────────────────────── buildPlan

/**
 * Bước không có task nào thì KHÔNG AI TICK ĐƯỢC — nó đứng ở "chưa làm" vĩnh
 * viễn và người dùng tưởng hệ thống bỏ sót. Bỏ bước thì `step` của các task
 * còn lại phải được ĐÁNH SỐ LẠI, không thì chúng trỏ vào chỗ trống.
 */
test('buildPlan: bỏ bước không có task, và đánh số lại phần còn lại', () => {
  const p = buildPlan(
    draft([draftTask({ step: 2 })], ['Chuẩn bị', 'Lưu kết quả', 'Viết bài']),
    'r',
    'P-x',
    'file',
  );
  assert.deepEqual(
    p.steps.map((s) => s.title),
    ['Viết bài'],
  );
  assert.equal(p.tasks[0]!.step, 0);
});

test('buildPlan: `deliver` khuyết thì lấy mặc định của VĂN PHÒNG, không phải của schema', () => {
  const withDefault = buildPlan(draft([draftTask()]), 'r', 'P-x', 'reply');
  assert.equal(withDefault.tasks[0]!.deliver, 'reply');

  // Model khai tường minh thì nó thắng — mặc định chỉ lấp chỗ trống.
  const explicit = buildPlan(draft([draftTask({ deliver: 'file' })]), 'r', 'P-x', 'reply');
  assert.equal(explicit.tasks[0]!.deliver, 'file');
});

/**
 * Đầu VÀO và đầu RA đi qua hai luật khác nhau, và ca này là lý do chúng phải
 * tách: người dùng có quyền nói "làm tiếp trên kết quả hôm qua".
 */
test('buildPlan: đầu vào trỏ kế hoạch KHÁC thì để nguyên, đầu ra luôn bị đóng khung', () => {
  const p = buildPlan(
    draft([
      draftTask({
        inputs: [{ path: 'artifacts/P-cu/T-01/vi/thuat-ngu.md' }],
        outputs: [{ path: 'artifacts/vi/10-thuat-ngu.md' }],
      }),
    ]),
    'r',
    'P-moi',
    'file',
  );
  assert.equal(p.tasks[0]!.inputs[0]!.path, 'artifacts/P-cu/T-01/vi/thuat-ngu.md');
  // Đuôi người dùng đặt (`vi/`) được giữ, khung theo ca thì do CODE quyết.
  assert.equal(p.tasks[0]!.outputs[0]!.path, 'artifacts/P-moi/T-01/vi/10-thuat-ngu.md');
});

test('buildPlan: đường dẫn trỏ task CỦA CHÍNH kế hoạch này thì được đóng khung', () => {
  const p = buildPlan(
    draft([
      draftTask({ task_id: 'T-01' }),
      draftTask({ task_id: 'T-02', inputs: [{ path: 'artifacts/T-01/ket-qua.md' }] }),
    ]),
    'r',
    'P-moi',
    'file',
  );
  assert.equal(p.tasks[1]!.inputs[0]!.path, 'artifacts/P-moi/T-01/ket-qua.md');
});

// ─────────────────────────────────────────────────────────────── pickReadable

const KNOWN = [
  'library/files/doc-1.md',
  'library/files/doc-2.md',
  'artifacts/P-01/T-01/vi/doc-1.md',
];

test('pickReadable: đường dẫn đủ thì nhận, tên trần duy nhất cũng nhận', () => {
  assert.deepEqual(pickReadable(['library/files/doc-2.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
  assert.deepEqual(pickReadable(['doc-2.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
});

/**
 * Tên trần TRÙNG ở hai kho là ca có thật — tủ tài liệu có `doc-1.md`, ngăn Kết
 * quả cũng có. Đoán bừa một bên là đọc nhầm tài liệu rồi trả lời rất thuyết
 * phục: kết cục tệ nhất trong mọi kết cục.
 */
test('pickReadable: tên trần trùng hai kho thì KHÔNG đoán', () => {
  assert.deepEqual(pickReadable(['doc-1.md'], KNOWN), { ok: [], missing: ['doc-1.md'] });
});

/**
 * Model bịa một đường dẫn là ca phải tính tới — luật SPEC-artifacts §2.5 cấm
 * cho một chuỗi model đoán mượn uy tín của hệ thống.
 *
 * Nhưng khác `resolveFileRefs`: ở đó một đường dẫn hỏng là lỗi người dùng nên
 * dừng cả câu. Ở đây model đề nghị hai file mà một file có thật thì **đọc file
 * đó** — bắt người dùng gõ lại vì model đoán sai là phạt nhầm người.
 */
test('pickReadable: file bịa bị loại, file có thật vẫn đi tiếp', () => {
  assert.deepEqual(pickReadable(['library/files/doc-2.md', 'library/files/khong-co.md'], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: ['library/files/khong-co.md'],
  });
});

test('pickReadable: trùng lặp và dấu gạch ngược không đẻ ra hai lần đọc', () => {
  assert.deepEqual(pickReadable(['doc-2.md', 'library\\files\\doc-2.md', ' '], KNOWN), {
    ok: ['library/files/doc-2.md'],
    missing: [],
  });
});

/**
 * Dòng trạng thái chỉ nêu TÊN FILE — `library/files/doc-2.md` trên một dòng
 * trạng thái là ngôn ngữ của máy, và dòng đó bị truncate trong giao diện.
 */
test('readingNote: nêu tên file, cắt ở 2, đếm phần còn lại', () => {
  assert.equal(readingNote(['library/files/doc-2.md']), 'Đang đọc doc-2.md…');
  assert.equal(
    readingNote(['library/files/doc-1.md', 'artifacts/P-01/T-01/vi/doc-1.md']),
    'Đang đọc doc-1.md, doc-1.md…',
  );
  assert.equal(
    readingNote(['a/1.md', 'b/2.md', 'c/3.md', 'd/4.md']),
    'Đang đọc 1.md, 2.md và 2 file nữa…',
  );
});

// ──────────────────────────────────────────────────────────────── requestOf

/**
 * Câu người dùng gõ ở cửa cứu hộ thường là *"ừ, cái nào cũng được"* — đúng
 * nhưng vô nghĩa khi đọc lại trong nhật ký ba ngày sau. `goal` thì đã được yêu
 * cầu đúng hình dạng "một câu rõ ràng", nên dùng lại thứ đang cầm.
 */
test('requestOf: tên việc suy từ goal, nhiều task thì nối lại', () => {
  assert.equal(requestOf(draft([draftTask({ goal: 'Liệt kê 10 thuật ngữ' })])), 'Liệt kê 10 thuật ngữ');
  assert.equal(
    requestOf(draft([draftTask({ goal: 'Dịch doc-1' }), draftTask({ goal: 'Soát lại bản dịch' })])),
    'Dịch doc-1 · Soát lại bản dịch',
  );
});
