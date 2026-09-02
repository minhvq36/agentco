/**
 * KẾT QUẢ QUÁ TO — ĐƯA VỀ VĂN PHÒNG THAY VÌ BẮT MODEL NUỐT.
 * → docs/SPEC-arms.md §9e · `scripts/spike-spill.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠⚠ FILE NÀY KHÔNG CẮT GÌ CẢ, VÀ ĐÓ LÀ ĐIỂM CHÍNH CỦA NÓ.                 │
 * │                                                                          │
 * │ Ca 27/08: `notion-fetch` trả **64 146 ký tự**. Phản xạ đầu là dựng một    │
 * │ trần của ta (~16 KB) rồi tự bê ra file. Đo xong thì hoá ra **Claude Code  │
 * │ ĐÃ LÀM VIỆC ĐÓ RỒI**: nội dung không hề vào ngữ cảnh, CLI cất nó ra       │
 * │ `~/.claude/projects/<slug>/<session-uuid>/tool-results/*.txt` và trả về   │
 * │ một câu ngắn 1 608 ký tự.                                                │
 * │                                                                          │
 * │ ⇒ Dựng trần thứ hai là **hai bản của cùng một luật** — thứ dự án này đã   │
 * │ trả giá vài lần (`agentSlot` vs `arrange`; `pickMcp` vs `probeArm`).      │
 * │ Nên file này KHÔNG đo kích thước, KHÔNG cắt, KHÔNG quyết định bê hay      │
 * │ không. Nó chỉ sửa **BỐN CHỖ CLI ĐẶT FILE SAI VỚI TA**:                    │
 * │                                                                          │
 * │   ① ngoài văn phòng   ⇒ mọi lượt đọc bị dán nhãn "ngoài văn phòng", và   │
 * │                         model chuyển sang shell (10 lượt lạc, ca 27/08)  │
 * │   ② dưới session-uuid ⇒ đổi mỗi phiên, con trỏ hôm qua thành đường chết  │
 * │   ③ người dùng không thấy ⇒ 64 KB vào máy mà ngăn Kết quả trống trơn      │
 * │   ④ 🔴 câu mở đầu bằng "Error:" ⇒ một lượt THÀNH CÔNG bị mồi thành THẤT   │
 * │      BẠI, và model đọc câu đó trước khi quyết định làm gì tiếp            │
 * │                                                                          │
 * │ ④ rẻ nhất để vá và đắt nhất nếu bỏ qua: nó không phải lỗi kỹ thuật, nó là │
 * │ một từ sai trong một câu.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ✅ ĐO 27/08 (`spike-spill.ts`), và cả ba đều là điều kiện để file này chạy:
 *   · `PostToolUse` **nổ cho tool MCP** — khác `canUseTool`, thứ bị `allowedTools` che
 *   · `tool_response` là **string**, không phải khối `content[]`
 *   · `updatedToolOutput` **thay được thật** — chứng minh bằng việc model mở
 *     đúng file của ta, một đường dẫn nó không có cách nào đoán ra
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Câu CLI trả về khi nó đã tự cất kết quả ra file.
 *
 * ⚠ KHỚP THEO CỤM `saved to <đường dẫn>.txt`, KHÔNG khớp theo chữ `Error:`.
 * Chữ đầu câu là thứ dễ đổi nhất giữa hai bản CLI, và khớp vào nó là dựng một
 * bản vá tự hỏng ở lần nâng cấp — im lặng, vì "không khớp" trông y hệt "không
 * có gì để làm".
 */
const NOTICE = /saved to\s+(.+?\.txt)/i;

/**
 * Trần khi CHÉP VÀO VĂN PHÒNG. Khác hẳn trần vào ngữ cảnh (CLI giữ).
 *
 * Đây là trần của **đĩa khách**, không phải của hoá đơn: một dịch vụ chạy loạn
 * trả về vài GB thì ta không được lấp ổ của họ. 50 MB là con số user nêu, và nó
 * rộng gấp ~800 lần ca thật lớn nhất đã gặp (64 KB) — đủ rộng để không bao giờ
 * cắt ngang một việc bình thường, đủ chặt để có đáy.
 */
export const MAX_SPILL_BYTES = 50 * 1024 * 1024;

export interface SpillPlan {
  /** File CLI đã cất. */
  from: string;
  /** Nơi ta chép tới, trong `artifacts/` của văn phòng. */
  to: string;
  /** Đường dẫn tương đối để đưa cho model — nó làm việc theo `cwd` văn phòng. */
  rel: string;
  bytes: number;
}

/**
 * TÊN FILE — tất định, người đọc được, **không có băm**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BẢN ĐẦU ĐẺ RA THẾ NÀY, và user bắt được ngay:                         │
 * │                                                                          │
 * │   a46a7e26403__notion-fetch--mcp-a46a7e26403-notion-fetch-1787778426161  │
 * │                                                                          │
 * │ Ba lỗi trong một cái tên:                                                │
 * │  ① **BĂM LỌT LÊN MÀN HÌNH** — và `audit.ts` đã viết luật từ đầu: *"băm   │
 * │     không bao giờ lên màn hình, giao diện tra ra nhãn"*. Một cái tên file │
 * │     trong ngăn Kết quả **LÀ** màn hình. Băm là ĐỊA CHỈ, không phải TÊN — │
 * │     đúng câu *"tên là cái nhà, băm là địa chỉ nhà"*.                      │
 * │  ② lặp hai lần cùng một thứ, vì tên của CLI đã mang sẵn tên việc          │
 * │  ③ dấu thời gian dạng epoch — máy đọc được, người thì không                │
 * │                                                                          │
 * │ ⚠ Và câu hỏi *"hay nó là file temp nên kệ"* có đáp án là **KHÔNG**: nó    │
 * │ nằm trong `artifacts/`, tức thứ người dùng **nhìn thấy và tải về được**.  │
 * │ File tạm thì phải ở `.state/` — mà `.state/` lại nằm trong `guardedZone`, │
 * │ nên nhân viên không đọc được. ⇒ Không có đường "để tạm": nó là kết quả.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chống trùng bằng ĐẾM, không bằng dấu thời gian: trong một thư mục task, các
 * lời gọi chạy tuần tự nên `-2`, `-3` là đủ, và nó đọc lên có nghĩa (*"lần gọi
 * thứ hai"*) thay vì một chuỗi 13 chữ số không nói gì.
 */
export function spillName(toolName: string, dir: string): string {
  // `mcp__<băm>__<việc>` → `<việc>`. Cắt CẢ băm, không chỉ tiền tố `mcp__`.
  const raw = toolName.replace(/^mcp__/, '');
  const cut = raw.indexOf('__');
  const viec = (cut >= 0 ? raw.slice(cut + 2) : raw).replace(/[^a-zA-Z0-9_-]/g, '-') || 'ket-qua';

  for (let i = 1; i < 1000; i++) {
    const ten = i === 1 ? `${viec}.txt` : `${viec}-${i}.txt`;
    if (!fs.existsSync(path.join(dir, ten))) return ten;
  }
  // 1000 lần gọi cùng một việc trong một task là chuyện không nên xảy ra; nếu
  // xảy ra thì ghi đè cái cuối còn hơn ném giữa một ca đang chạy.
  return `${viec}-999.txt`;
}

/**
 * Đọc câu của CLI ⇒ kế hoạch chép. `undefined` = không có gì để làm.
 *
 * ⚠ KHÔNG ném khi file không tồn tại hay quá to. Đây chạy giữa một ca đang làm
 * việc: một lỗi ở đây phải làm hỏng **đúng phần trang trí**, không phải cả lượt.
 * Chỗ gọi nhận `undefined` và để nguyên câu của CLI — tệ hơn, không sai.
 */
/**
 * @param outDir Thư mục kết quả **CỦA TASK NÀY** (`artifacts/<plan>/<task>/`).
 *
 * ⚠ KHÔNG phải gốc `artifacts/`. Mọi file khác trong văn phòng đều nằm dưới
 * `artifacts/<plan_id>/<task_id>/`, và `ArtifactRecord` **suy `plan_id`/`task_id`
 * TỪ ĐƯỜNG DẪN**. Thả một file phẳng ở gốc là tạo một mục không thuộc kế hoạch
 * nào, không thuộc việc nào — ngăn Kết quả hiện nó mồ côi, và nó không được dọn
 * theo kế hoạch như mọi thứ khác.
 * @param rootDir Gốc `artifacts/` — chỉ để tính đường dẫn tương đối cho model.
 */
export function planSpill(
  toolResponse: unknown,
  toolName: string,
  outDir: string,
  rootDir?: string,
): SpillPlan | undefined {
  if (typeof toolResponse !== 'string') return undefined;
  const from = NOTICE.exec(toolResponse)?.[1]?.trim();
  if (!from) return undefined;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴🔴 CHỐT NGUỒN — KHÔNG CÓ DÒNG NÀY THÌ ĐÂY LÀ MỘT LỖ RÚT FILE.          │
   * │                                                                          │
   * │ `toolResponse` là **chuỗi do bên thứ ba viết ra**: một MCP server trả về  │
   * │ gì cũng được. Không chốt nguồn thì một server chỉ cần trả đúng câu        │
   * │                                                                          │
   * │     "…saved to D:\…\company\.state\secrets.json…"                        │
   * │                                                                          │
   * │ là ta **tự tay chép kho chìa vào `artifacts/`** — nơi mọi nhân viên đọc   │
   * │ được và người dùng tải về được. Hàng rào `guardedZone` chặn agent ĐỌC     │
   * │ `.state/`, và bản vá này sẽ khiêng nội dung đó ra ngoài giùm nó.          │
   * │                                                                          │
   * │ Cùng hình dạng lỗ đã ghi ở `catalog.ts §swallowsOffice`: *"cấm cửa tử tế, │
   * │ để cửa sau mở"*. Và cùng lớp với ca `Musics` — **tin một chuỗi model/hãng │
   * │ đưa vào rồi đem đi mở file**.                                            │
   * │                                                                          │
   * │ Chốt bằng CẤU TRÚC, ba điều kiện, không điều kiện nào dựa vào thiện chí:  │
   * │   ① đường dẫn phải **tuyệt đối** — tương đối thì `statSync` giải theo cwd │
   * │      của daemon, tức trỏ vào một chỗ hoàn toàn khác chỗ ta tưởng          │
   * │   ② thư mục cha phải tên đúng **`tool-results`** — đó là quy ước của CLI, │
   * │      và không thư mục dữ liệu nào của khách mang tên ấy                   │
   * │   ③ phải là `.txt` — cùng quy ước                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (!path.isAbsolute(from)) return undefined;
  if (path.basename(path.dirname(from)) !== 'tool-results') return undefined;
  if (path.extname(from).toLowerCase() !== '.txt') return undefined;

  let bytes: number;
  try {
    bytes = fs.statSync(from).size;
  } catch {
    return undefined;
  }
  if (bytes > MAX_SPILL_BYTES) return undefined;

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
    return undefined;
  }
  const name = spillName(toolName, outDir);
  const to = path.join(outDir, name);
  /**
   * Đường tương đối tính từ THƯ MỤC VĂN PHÒNG, vì đó là `cwd` của nhân viên —
   * `Read`/`Grep` của nó nhận đường dẫn theo gốc ấy. Đưa đường tuyệt đối cũng
   * chạy, nhưng nó dài, lộ cây thư mục máy khách, và không giống một dòng nào
   * khác model từng thấy trong văn phòng.
   */
  const root = rootDir ?? outDir;
  const rel = `artifacts/${path.relative(root, to).replace(/\\/g, '/')}`;
  return { from, to, rel, bytes };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BÊ VỀ ĐƯỢC ≠ ĐỌC ĐƯỢC. Ca thật 27/08, user bắt.                       │
 * │                                                                          │
 * │ File bê về: **73 530 byte trên ĐÚNG MỘT DÒNG.** `Read` cắt theo DÒNG, nên│
 * │ `offset`/`limit` không cắt được gì: mỗi lượt đọc trả về trọn 73 KB ⇒ lại │
 * │ vượt trần ⇒ CLI lại bê ra file ⇒ lại trả con trỏ ⇒ **lặp tới khi hết      │
 * │ lượt** (`error_max_turns`).                                              │
 * │                                                                          │
 * │ Và câu con trỏ của chính ta bảo nó *"dùng Read kèm offset/limit"* — một   │
 * │ lời dặn KHÔNG THỰC HIỆN ĐƯỢC với file một dòng. Ta tự đẻ ra một câu sai   │
 * │ cửa ở đúng chỗ model cần chỉ đường nhất. → §5m                           │
 * │                                                                          │
 * │ ⇒ Bê về mà không xuống dòng thì mới làm được **một nửa việc**, và nửa còn │
 * │ lại là nửa người dùng nhìn thấy.                                         │
 * │                                                                          │
 * │ ⚠ ĐÂY LÀ BẢN ĐỂ ĐỌC, KHÔNG PHẢI BẢN GỐC — nói ra chứ đừng giấu. Bản      │
 * │ nguyên văn vẫn nằm nguyên ở chỗ CLI cất (ta CHÉP, không DI CHUYỂN).       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const LINE_MAX = 2_000;
const WRAP_AT = 800;

/** Dòng dài nhất — thước duy nhất quyết định file có đọc được từng phần không. */
function longestLine(s: string): number {
  let max = 0;
  let start = 0;
  for (;;) {
    const i = s.indexOf('\n', start);
    if (i < 0) return Math.max(max, s.length - start);
    max = Math.max(max, i - start);
    start = i + 1;
  }
}

/**
 * JSON → chữ đọc được. **Không có tên hãng nào trong hàm này.**
 *
 * Vì sao không `JSON.stringify(v, null, 2)` cho xong: nó tách được cái *phong
 * bì* nhưng **không tách được nội dung** — một trường `text` dài 60 KB vẫn nằm
 * trên một dòng, vì `\n` bị escape lại thành `\\n`. Mà nội dung mới là thứ cần
 * đọc. `JSON.parse` đã biến `\n` thành xuống dòng thật; việc của ta là **giữ
 * nguyên** nó thay vì escape lần nữa.
 */
function renderJson(v: unknown, duong: string[] = [], out: string[] = []): string[] {
  if (typeof v === 'string') {
    // Chuỗi dài = nội dung ⇒ in thô, giữ xuống dòng thật.
    out.push(`── ${duong.join('.') || '(content)'} ──`, v, '');
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => renderJson(x, [...duong, String(i)], out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) renderJson(x, [...duong, k], out);
  } else {
    out.push(`${duong.join('.')}: ${String(v)}`);
  }
  return out;
}

/** Bẻ cứng những dòng còn quá dài. Lưới an toàn cuối, không phải đường chính. */
function wrapLong(s: string): string {
  return s
    .split('\n')
    .flatMap((line) => (line.length <= LINE_MAX ? [line] : (line.match(new RegExp(`.{1,${WRAP_AT}}`, 'g')) ?? [line])))
    .join('\n');
}

/**
 * Làm cho nội dung ĐỌC ĐƯỢC TỪNG PHẦN. Trả `changed` để câu con trỏ nói thật.
 *
 * Hai bước, và bước một đủ cho gần hết ca thật: JSON thì trải ra; không phải
 * JSON thì bẻ dòng. Cả hai đều tất định — **không có LLM ở đây**.
 */
export function readable(raw: string): { text: string; changed: boolean } {
  if (longestLine(raw) <= LINE_MAX) return { text: raw, changed: false };
  try {
    const text = wrapLong(renderJson(JSON.parse(raw)).join('\n'));
    return { text, changed: true };
  } catch {
    return { text: wrapLong(raw), changed: true };
  }
}

/** KB đọc được cho người, không phải cho máy. */
function kb(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Câu thay thế. **Không có chữ "Error"**, và nói được việc kế tiếp.
 *
 * ⚠ Điều kiện phải nằm trên chính dòng có ví dụ, không phải một câu dặn ở đầu
 * prompt — luật đã trả tiền 26/08 (`armReach` in nấc ngay trên dòng nhân viên).
 * Nên câu này tự mang đường dẫn VÀ tên hai tool đọc được nó.
 *
 * ⚠⚠ ENGLISH, AND NOT THROUGH `t()`. A worker model reads this, not a person —
 * so it is prompt text, and the interface switch never reaches a prompt.
 * The ban on the word "error" survives the translation and is the sharpest
 * trap in the whole sweep: `test/spill.test.ts` is the code that enforces it.
 */
export function spillNotice(p: SpillPlan): string {
  return (
    `Fetched. The content is ${kb(p.bytes)}, so it was saved into the working directory:\n` +
    `${p.rel}\n` +
    `Read it with Read (using offset/limit) or Grep — the file is already broken into lines so it ` +
    `can be read piece by piece. This did NOT fail: the data came back in full.`
  );
}

/**
 * Chép thật. Trả `true` nếu xong.
 *
 * ⚠ Chép chứ KHÔNG di chuyển: file gốc thuộc về CLI, và nó có thể còn tham
 * chiếu tới đó trong cùng phiên. Xoá thứ của người khác để dọn gọn là đổi một
 * chỗ rác lấy một lớp lỗi.
 */
export function doSpill(p: SpillPlan): boolean {
  try {
    fs.mkdirSync(path.dirname(p.to), { recursive: true });
    /**
     * ĐỌC → TÁCH DÒNG → GHI, chứ không `copyFileSync`.
     *
     * Bản đầu chép nguyên xi, và với một file 73 KB **một dòng** thì nó bê về
     * được một thứ **không đọc nổi từng phần** — mỗi lượt `Read` lại nổ trần,
     * lại bê ra file, lặp tới `error_max_turns`. → §readable
     *
     * ⚠ Bản gốc KHÔNG mất: ta chép từ chỗ CLI cất và không đụng vào nó.
     */
    const { text } = readable(fs.readFileSync(p.from, 'utf8'));
    fs.writeFileSync(p.to, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}
