/**
 * TAB "LỆNH" — ÁNH XẠ form ↔ tờ khai CLI. → docs/SPEC-arms.md §16
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO NÓ RA KHỎI `ArmDialog.tsx` (01/09)                                │
 * │                                                                          │
 * │ User chốt 31/08: JSON và form là **ánh xạ 1-1 hai chiều**. Một lời hứa    │
 * │ dạng "đi vòng rồi về vẫn thế" chỉ là lời hứa **cho tới khi có test**, và  │
 * │ test không vào được một file `.tsx` đầy React. Ở đây thì vào được:        │
 * │ không import gì, không JSX, chạy thẳng dưới `node --test`.                │
 * │ → test/cli-form.test.ts · [[agentco-detect-fix-pair-scope]]               │
 * │                                                                          │
 * │ ⚠ File này **không được import React hay `@/…`** — mất tính chất đó là    │
 * │ mất luôn bộ test, im lặng.                                               │
 * │                                                                          │
 * │ ⚠ …and it cannot import `@i18n` AT RUNTIME either. Measured 03/09: node  │
 * │ loads this file as raw `.ts`, so every specifier has to resolve to a     │
 * │ real path on disk — there is no alias, and `src/i18n/index.ts` imports   │
 * │ `./en.js`, which only exists after a build.                              │
 * │                                                                          │
 * │ ⇒ the three functions holding words for a human TAKE `t` AS AN ARGUMENT  │
 * │ instead. `import type` is fine: node erases it before resolving.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { MessageKey } from '@i18n';

/**
 * The `t` of `@i18n`, handed in rather than imported — see the box above.
 *
 * Typed by `MessageKey`, not `string`, so a misspelt key still fails `tsc` at
 * the call site exactly as a direct `t()` would.
 */
export type Translate = (key: MessageKey) => string;

export interface CliDraft {
  say: string;
  description: string;
  /** CÚ PHÁP — dòng lệnh tổng quát, `{ô_trống}` là chỗ nhân viên điền. */
  line: string;
  /**
   * ⭐ MỘT LỆNH THẬT CHẠY ĐƯỢC. (user đòi lại 01/09: *"tôi định nó là 1 lệnh
   * hoàn chỉnh ở sau cú pháp"* — và họ đúng, xem `alignExample`.)
   */
  example: string;
  read_only: boolean;
  /**
   * ⚠ **CHỞ QUA, KHÔNG VẼ** (user 01/09 — xem `SPEC-arms §16v`).
   *
   * `fail_when` là dụng cụ của **người biết CLI của mình**: nó biến một chuỗi
   * thành lời tuyên "THẤT BẠI" dù tiến trình thoát 0. Người điền form thì không
   * biết — và placeholder cũ của tôi (`ERROR, FAILED, Traceback`) mời họ gõ đúng
   * ba chuỗi **hay xuất hiện trong output lành nhất**. ⇒ chỉ soạn ở tab JSON.
   */
  fail_when: string;
  /**
   * Tham số đã khai từ JSON — **chở nguyên, không vẽ hết**.
   *
   * Form chỉ sửa `example` (suy từ dòng ví dụ) và tự thêm/bớt cho khớp ô trống.
   * `pattern`/`min`/`max`/`allow_dash`/`integer` chỉ soạn được ở tab JSON, nhưng
   * **phải sống sót một vòng form** — bằng không thì bấm "Về form" là im lặng gỡ
   * mất một hàng rào người dùng đã dựng. → luật 1-1 hai chiều, user chốt 31/08
   */
  params: Record<string, unknown>[];
}

export const blankAct = (): CliDraft => ({
  say: '',
  description: '',
  line: '',
  example: '',
  read_only: false,
  fail_when: '',
  params: [],
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MẪU CHẠY ĐƯỢC NGAY — một cú bấm, không cần thư mục, không cần cài gì.    │
 * │ (user 01/09: *"chỉ cần click là fill hết chạy được ngay"*)               │
 * │                                                                          │
 * │ Ba ràng buộc nó phải qua, và cả ba đều đã đo:                            │
 * │  ① `node` chắc chắn có — daemon đang chạy bằng nó.                       │
 * │  ② KHÔNG cần file nào, KHÔNG cần thư mục nào: `-e` mang mã theo mình,    │
 * │     nên `cwd` để trống (rơi về thư mục văn phòng, luôn tồn tại).         │
 * │  ③ CÓ một ô trống `{ten}` — mẫu mà không có tham số thì nó dạy sai một   │
 * │     nửa quan trọng nhất, và ô "Ví dụ" bên dưới sẽ không có gì để nói.    │
 * │                                                                          │
 * │ ⚠ `shell:false` ⇒ dấu nháy trong ô Cú pháp là quy ước của `toArgv`, KHÔNG │
 * │ phải cú pháp shell. Mẫu này cố ý có nháy để chỗ đó lộ ra ngay lần đầu.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * A FUNCTION, not a constant: the greeting inside it is translated, and a
 * module-level constant would freeze whichever language the page loaded with.
 * Everything outside the greeting is code and is not translated.
 */
export const hello = (t: Translate): string =>
  `node -e "console.log('${t('cliForm.helloGreeting')}' + process.argv[1])"`;
export const sampleAct = (t: Translate): CliDraft => ({
  say: t('cliForm.helloSay'),
  description: t('cliForm.helloDescription'),
  line: `${hello(t)} {ten}`,
  example: `${hello(t)} Alex`,
  read_only: true,
  fail_when: '',
  params: [],
});

/**
 * Chuỗi đang dán có phải tờ khai CLI không.
 *
 * ⚠ Chỉ hỏi `type === 'cli'` — **cùng một câu hỏi** `core/cli-arm.ts §isCliArm`
 * hỏi, không phải một luật thứ hai. Nhận theo `type`, không suy theo *"không có
 * `command` cũng không có `url`"*: vắng mặt không phải tín hiệu, và một khối gõ
 * sai không được im lặng bị đọc thành CLI rồi đá sang tab khác.
 */
export function isCliPaste(s: string): boolean {
  return safeJson(s)?.['type'] === 'cli';
}

/** `JSON.parse` không ném — ô JSON hỏng thì nút phải mờ đi, không phải nổ. */
export function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tên máy suy từ câu tiếng người — người dùng **không bao giờ gõ `id`**.
 *
 * Schema đòi `^[a-z][a-z0-9_]*$`, và bắt một người non-code tự nghĩ ra một chuỗi
 * hợp khuôn đó là bắt họ học một luật của MÁY. Họ gõ *"đếm hoá đơn"*, ta ra
 * `dem_hoa_don`.
 *
 * ⚠ Bỏ dấu bằng `\p{M}` sau `NFD` chứ không bằng bảng tra tay: gõ thẳng dấu tổ
 * hợp vào `[]` thì nó bám lên dấu ngoặc — nhìn giống hệt, chạy sai. Bài học đã
 * trả tiền một lần ở regex tiếng Việt.
 */
export function slugId(say: string): string {
  const s = say
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd') // i18n-allow-vietnamese: `đ` survives NFD, so it needs its own rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s : `viec_${s || 'moi'}`;
}

/**
 * Một dòng lệnh → argv.
 *
 * ⚠ ĐÂY KHÔNG PHẢI MỘT SHELL, và không được để nó lớn thành shell. Nó chỉ tách
 * theo khoảng trắng, tôn trọng `"…"` và `'…'` — vừa đủ để nhận một dòng người
 * dùng **chép từ chỗ họ đã chạy**. Không `|`, không `&&`, không biến, không
 * `$(…)`: những thứ đó là **cú pháp shell**, mà §16e cấm đi qua shell.
 *
 * ⭐ Và vì phép tách có thể đoán sai, **giao diện hiện lại từng mảnh argv** ngay
 * bên dưới. Người dùng THẤY thứ sẽ chạy ⇒ đoán sai thì họ sửa, không có ca hỏng
 * im lặng. Đó là cách duy nhất một phép đoán được phép tồn tại ở đây.
 */
export function toArgv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * argv → một dòng đọc lại được bằng `toArgv`. Nghịch đảo, nên phải chọn đúng
 * loại nháy: bọc bằng `"` trừ khi mảnh có `"` (lúc đó dùng `'`). `toArgv` không
 * hiểu ký tự thoát, nên `JSON.stringify` là SAI ở đây — nó đẻ ra `\"`.
 */
export function joinArgv(parts: readonly string[]): string {
  return parts
    .map((s) => {
      if (s !== '' && !/[\s'"]/.test(s)) return s;
      return s.includes('"') && !s.includes("'") ? `'${s}'` : `"${s}"`;
    })
    .join(' ');
}

/** Tên các ô trống trong argv, theo thứ tự xuất hiện, không lặp. */
export function slots(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (const el of argv) {
    for (const m of el.matchAll(/\{([a-z0-9_]+)\}/gi)) if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⭐ VÍ DỤ: NGƯỜI DÙNG GÕ **CẢ DÒNG LỆNH**, MÁY BÓC RA **TỪNG Ô**.         │
 * │ (user 01/09 đòi lại ô này, và cách hoà hai chốt cũ nằm ở đây)            │
 * │                                                                          │
 * │ Hai chốt trước mặt nhau tưởng là mâu thuẫn:                              │
 * │  · 31/08 — ví dụ phải ở **tầng THAM SỐ**: model không dựng dòng lệnh, nó │
 * │    chỉ điền `{tag}`. Cho nó xem trọn dòng lệnh là bắt nó khớp ngược.     │
 * │    Và đó là hoá đơn LẶP LẠI: prefix mọi lượt, trần 60 ký tự.             │
 * │  · 01/09 — *"1 lệnh real chạy được thì zero shot"*: người dùng **không   │
 * │    kiểm chứng được** một ví dụ rời rạc, nhưng một dòng lệnh thì họ chạy   │
 * │    thử được ngay trong terminal của chính họ.                            │
 * │                                                                          │
 * │ ⇒ Không phải chọn một. **Người gõ ở tầng họ kiểm chứng được; model nhận  │
 * │ ở tầng nó điều khiển được.** Ta khớp `run` với dòng ví dụ theo từng mảnh │
 * │ argv rồi rút giá trị ra: `… --thang {thang}` ⨯ `… --thang 8` → `thang=8`.│
 * │                                                                          │
 * │ ⚠ Và đây là MỘT PHÉP ĐOÁN, nên nó theo đúng luật của `toArgv`: **giao    │
 * │ diện hiện lại thứ bóc được**. Không khớp ⇒ trả `null` ⇒ màn hình nói     │
 * │ thẳng "ví dụ không khớp cú pháp", chứ KHÔNG âm thầm gán bừa.             │
 * │                                                                          │
 * │ ⚠ Số mảnh phải BẰNG NHAU. Lệch ⇒ ví dụ thuộc về một cú pháp khác (hoặc   │
 * │ họ vừa sửa cú pháp mà quên sửa ví dụ) — đó là tín hiệu, không phải nhiễu.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function alignExample(tmpl: readonly string[], ex: readonly string[]): Record<string, string> | null {
  if (!tmpl.length || tmpl.length !== ex.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < tmpl.length; i++) {
    const t = tmpl[i]!;
    const e = ex[i]!;
    const found = [...t.matchAll(/\{([a-z0-9_]+)\}/gi)];
    // Mảnh cố định: phải giống hệt. Khác ⇒ ví dụ không thuộc cú pháp này.
    if (!found.length) {
      if (t !== e) return null;
      continue;
    }
    // Hai ô trống trong CÙNG một mảnh (`{a}-{b}`) thì tách được nhưng mập mờ —
    // bỏ qua, không đoán. Ô nào không bóc được thì đơn giản là không có ví dụ.
    if (found.length > 1) continue;
    const at = t.indexOf('{');
    const head = t.slice(0, at);
    const tail = t.slice(t.indexOf('}') + 1);
    if (!e.startsWith(head) || !e.endsWith(tail) || e.length < head.length + tail.length) return null;
    const v = e.slice(head.length, e.length - tail.length);
    if (v) out[found[0]![1]!] = v;
  }
  return out;
}

/**
 * Tham số SẼ ĐƯỢC LƯU cho một lệnh — ô trống trong argv là NGUỒN SỰ THẬT.
 *
 * Người dùng không khai tham số ở đâu cả: họ gõ `{thang}` vào cú pháp, thế là
 * có. Khai ở hai chỗ (một danh sách tham số + một argv) là hai chỗ lệch nhau —
 * và chỗ lệch đó nổ lúc chạy, ở `fillArgv`, bằng câu *"argv có ô trống nhưng
 * khai báo không có tham số đó"*.
 */
export function paramsFor(a: CliDraft): Record<string, unknown>[] {
  const argv = toArgv(a.line);
  const names = slots(argv);
  if (!names.length) return [];
  const vals = a.example.trim() ? alignExample(argv, toArgv(a.example)) : null;
  return names.map((n) => {
    const kept = a.params.find((p) => p['name'] === n) ?? { name: n, type: 'string', required: true };
    const ex = vals?.[n];
    return ex ? { ...kept, example: ex.slice(0, 60) } : kept;
  });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `cwd` LÀ CỦA **CÁNH TAY**, KHÔNG PHẢI CỦA TỪNG LỆNH. (user chốt 01/09)   │
 * │                                                                          │
 * │   *"chọn tab → thư mục picker → sau đó tất cả danh sách lệnh đều được    │
 * │    thao tác từ văn phòng đó khi được gọi/kích hoạt"*                     │
 * │                                                                          │
 * │ Schema vẫn để `cwd` ở tầng action (đúng — nó phải mềm hơn giao diện), và │
 * │ ta ghi **cùng một giá trị vào mọi action**. Vì sao đó là đúng chứ không   │
 * │ phải lười: một cánh tay CLI **là một dự án** — nhiều lệnh trên cùng một   │
 * │ thư mục. Hỏi lại thư mục ở mỗi lệnh là hỏi n lần một câu chỉ có một câu   │
 * │ trả lời, và đó chính là chỗ người dùng gõ lệch nhau rồi không hiểu vì sao │
 * │ lệnh thứ ba không thấy file.                                             │
 * │                                                                          │
 * │ ⚠ Hệ quả phải tôn trọng: tờ khai gõ tay CÓ THỂ đặt `cwd` khác nhau từng  │
 * │ lệnh. Form **không giữ được** hình đó ⇒ nó phải **từ chối đọc ngược**     │
 * │ (`declToDraft` trả `mixed: true`), không phải im lặng lấy cái đầu tiên.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 KHÔNG LỌC BỎ LỆNH CÒN TRỐNG. (bug user bắt 01/09, và ĐÃ ĐO)           │
 * │                                                                          │
 * │ Bản trước có `.filter(a => a.say.trim() && toArgv(a.line).length)` để     │
 * │ đầu ra "sạch". Đo được cái giá của nó: form **2 lệnh** → JSON **1         │
 * │ action** → đọc ngược về form còn **1 lệnh**. Bấm *Xem JSON* rồi *← Về     │
 * │ form* là **mất hẳn một dòng, im lặng** — và nút *Dùng cấu hình này* vẫn   │
 * │ sáng vì `cliCount` đếm sau khi lọc.                                       │
 * │                                                                          │
 * │ ⭐ Bộ lọc CHÍNH LÀ bug: nó **xoá dữ liệu người dùng để đầu ra hợp lệ**.   │
 * │ Đó là hàng giả — cấu hình trông hợp lệ vì thứ không hợp lệ đã bị vứt đi,  │
 * │ chứ không phải vì người dùng đã điền xong.                               │
 * │ → [[agentco-fallback-throws-away-answers]]                                │
 * │                                                                          │
 * │ ⇒ Xuất **mọi dòng**, kể cả dòng dở. Dòng dở ra tờ khai KHÔNG hợp lệ, và   │
 * │ đó là chuyện tốt: `cliProblems` bắt nó ở giao diện, `parseCliArm` bắt nó  │
 * │ ở cửa. Một tờ khai nói thật rằng nó chưa xong thì mọi cổng phía sau còn   │
 * │ cơ hội làm việc; một tờ khai đã bị dọn sạch thì không.                    │
 * │                                                                          │
 * │ ⚠ `id: ''` khi chưa có tên — KHÔNG phải `slugId('')` (ra `viec_moi`).     │
 * │ Hai dòng trống mà cùng ra `viec_moi` thì `dupIds` sẽ tố *"trùng tên"*     │
 * │ trên hai ô còn chưa gõ gì — một câu lỗi đúng luật nhưng nói sai chuyện.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function draftToDecl(
  list: readonly CliDraft[],
  cwd = '',
): { type: 'cli'; actions: Record<string, unknown>[] } {
  const dir = cwd.trim();
  return {
    type: 'cli',
    actions: list.map((a) => {
      const params = paramsFor(a);
      return {
        id: a.say.trim() ? slugId(a.say) : '',
        say: a.say.trim(),
        description: a.description.trim() || a.say.trim(),
        run: toArgv(a.line),
        ...(params.length ? { params } : {}),
        ...(dir ? { cwd: dir } : {}),
        ...(a.read_only ? { read_only: true } : {}),
        ...(a.fail_when.trim()
          ? { fail_when: a.fail_when.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
      };
    }),
  };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỌI LỆNH ĐỀU PHẢI ĐỦ THÌ MỚI ĐƯỢC ĐI TIẾP. (user chốt 01/09)             │
 * │                                                                          │
 * │   *"khi tôi bấm thêm lệnh, chưa điền gì cả, nút button vẫn sáng"*        │
 * │                                                                          │
 * │ Trả về **theo chỉ số**, không phải một cờ `boolean` chung: nút mờ mà      │
 * │ không có chỗ nào đỏ thì người dùng phải đi dò từng ô. Cùng luật với       │
 * │ `dupIds` — báo tại **ô sửa được**, không báo ở chân màn hình.             │
 * │                                                                          │
 * │ ⚠ Đây là hàng rào THỨ NHẤT trong hai. Luật thật vẫn ở `parseCliArm`       │
 * │ (`server.ts §resolveArm`, cửa CHUNG của nút Thử và nút Xong) — nên đua    │
 * │ tay hay client tự viết đều không lọt. Cái ở đây chỉ để **thấy trước khi   │
 * │ bấm**, và nó cố ý hẹp hơn schema: chỉ hỏi hai ô mà FORM vẽ.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface CliProblem {
  at: number;
  field: 'say' | 'line';
  say: string;
}

export function cliProblems(list: readonly CliDraft[], t: Translate): CliProblem[] {
  const out: CliProblem[] = [];
  list.forEach((a, at) => {
    if (!a.say.trim()) out.push({ at, field: 'say', say: t('cliForm.noName') });
    if (!toArgv(a.line).length) out.push({ at, field: 'line', say: t('cliForm.noLine') });
  });
  return out;
}

/**
 * Thứ SẼ ĐƯỢC LƯU — dùng cho **cả** nút mờ/sáng lẫn lúc bấm.
 *
 * ⚠ Một hàm, không phải hai biểu thức giống nhau: nút mờ theo một phép tính còn
 * lúc bấm lưu theo một phép tính khác là ca "nút sáng mà bấm không ra gì" (hoặc
 * ngược lại, tệ hơn: nút mờ trong khi cấu hình hợp lệ).
 *
 * ⚠ `null` = **chưa có gì để lưu**, và nó là một câu trả lời chứ không phải một
 * lỗi. Bản trước ngã về `draftToDecl(list)` khi khối JSON hỏng — tức nút
 * *"Dùng cấu hình này"* **vẫn sáng** trong lúc ô JSON đang đỏ, và bấm vào thì
 * lưu **bản form**, không phải thứ đang hiện trên màn hình. Một fallback vứt mất
 * đúng câu trả lời cần nghe (*"khối này hỏng"*).
 * → [[agentco-fallback-throws-away-answers]]
 */
export function cliDecl(
  list: readonly CliDraft[],
  cwd: string,
  json: string | null,
): Record<string, unknown> | null {
  return json === null ? draftToDecl(list, cwd) : safeJson(json);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MÃ LỆNH BỊ TRÙNG — trả về danh sách mã xuất hiện nhiều hơn một lần.      │
 * │ (user hỏi 01/09: *"Điều gì xảy ra nếu id trùng lặp?"*)                   │
 * │                                                                          │
 * │ ĐÃ ĐO: SDK **ném** `Tool a is already registered` ⇒ không có ca nuốt im   │
 * │ lặng. Nhưng nó ném ở `compileCliArm`, tức **lúc bấm Thử**, bằng tiếng Anh │
 * │ nói về "tool" — trong khi người dùng vừa đặt tên hai *lệnh* tiếng Việt.  │
 * │                                                                          │
 * │ 🔴 VÀ NÓ TỚI ĐƯỢC TỪ FORM: người dùng **không bao giờ gõ `id`**, nó do    │
 * │ `slugId(say)` sinh ra ⇒ *"đếm hoá đơn"* và *"đếm hoá đơn!"* ra **cùng     │
 * │ một** mã. Đây không phải ca hiếm của người nghịch JSON.                  │
 * │                                                                          │
 * │ ⚠ VÀ ĐÂY LÀ CHỖ DỄ VÁ SAI TẦNG (user chỉ ra): mã trùng chỉ là **triệu    │
 * │ chứng**; bệnh là **hai lệnh mà nhân viên không phân biệt được**. Nên      │
 * │ đừng tự thêm hậu tố `_2` cho xong — làm thế là giấu một vấn đề vẫn còn    │
 * │ nguyên ở phía model: `does` liệt kê hai dòng y hệt, và nó phải đoán.      │
 * │ ⇒ **Chặn, và báo ở ô TÊN** — chỗ người dùng sửa được.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function dupIds(decl: Record<string, unknown> | null): string[] {
  const acts = decl && Array.isArray(decl['actions']) ? (decl['actions'] as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const bad = new Set<string>();
  for (const a of acts) {
    const id = String(a?.['id'] ?? '');
    if (!id) continue;
    if (seen.has(id)) bad.add(id);
    seen.add(id);
  }
  return [...bad];
}

export function cliCount(decl: Record<string, unknown> | null): number {
  return decl && Array.isArray(decl['actions']) ? (decl['actions'] as unknown[]).length : 0;
}

/**
 * Tờ khai → bản nháp, cho chiều JSON → form.
 *
 * ⚠ ĐÍNH CHÍNH 01/09 — bản trước ghi *"ô lạ rơi mất là ĐÚNG"*, và câu đó chỉ
 * đúng với ô **form không biết tới**. Nó KHÔNG đúng với `params`: form biết
 * `params` (nó tự sinh ra chúng từ `{ô trống}`), nhưng chỉ vẽ **một trường** của
 * chúng. Thả rơi `pattern`/`min`/`max`/`allow_dash` ở đây là bấm "Về form" một
 * cái thì im lặng **gỡ mất hàng rào người dùng đã dựng** — đúng lớp
 * [[agentco-fallback-throws-away-answers]]. ⇒ Chở nguyên, ghi đè đúng `example`.
 *
 * ⚠ `mixed: true` = tờ khai đặt **thư mục khác nhau cho từng lệnh**, thứ form
 * không giữ được (xem `draftToDecl`). Trả cờ chứ không tự chọn hộ: chỗ gọi phải
 * **khoá nút "← Về form"** lại. Im lặng lấy `cwd` của lệnh đầu là đổi chỗ chạy
 * của n−1 lệnh còn lại mà không ai được báo — và với một lệnh ghi dữ liệu thì đó
 * là chạy nhầm thư mục, không phải một lỗi hiển thị.
 */
export function declToDraft(
  decl: unknown,
): { acts: CliDraft[]; cwd: string; mixed: boolean } | null {
  const acts = (decl as { actions?: unknown })?.actions;
  if (!Array.isArray(acts) || !acts.length) return null;
  const dirs = new Set(
    acts.map((a) => {
      const c = (a as Record<string, unknown>)?.['cwd'];
      return typeof c === 'string' ? c : '';
    }),
  );
  const drafts = acts.map((a) => {
    const o = a as Record<string, unknown>;
    const run = Array.isArray(o['run']) ? (o['run'] as unknown[]).map(String) : [];
    const params = Array.isArray(o['params'])
      ? (o['params'] as unknown[]).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      : [];
    /**
     * Dựng lại DÒNG VÍ DỤ bằng cách thay từng ô trống bằng `example` của nó —
     * nghịch đảo của `alignExample`. Thiếu một ô ⇒ **để trống cả dòng**: một ví
     * dụ còn `{thang}` nằm giữa thì không phải ví dụ, nó là cú pháp lần hai.
     */
    const byName = new Map(params.map((p) => [String(p['name']), p['example']]));
    const need = slots(run);
    const full = need.length > 0 && need.every((n) => typeof byName.get(n) === 'string' && byName.get(n) !== '');
    return {
      say: String(o['say'] ?? ''),
      description: String(o['description'] ?? ''),
      line: joinArgv(run),
      example: full ? joinArgv(run.map((s) => s.replace(/\{([a-z0-9_]+)\}/gi, (_, n: string) => String(byName.get(n))))) : '',
      read_only: o['read_only'] === true,
      fail_when: Array.isArray(o['fail_when']) ? (o['fail_when'] as unknown[]).join(', ') : '',
      params,
    };
  });
  return { acts: drafts, cwd: dirs.size === 1 ? [...dirs][0]! : '', mixed: dirs.size > 1 };
}