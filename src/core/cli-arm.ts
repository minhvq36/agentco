/**
 * CÁNH TAY CLI — bọc một lệnh ĐÃ KHAI thành MCP chạy trong tiến trình.
 *
 * → docs/SPEC-arms.md §16 · TEST-WALKTHROUGH.md bài 22
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỪNG BỌC `Bash`. BỌC `gh pr create --title <T>`.                         │
 * │                                                                          │
 * │ §1b ra bốn lý do cấm biến shell thành MCP, và chúng vẫn đứng nguyên cho   │
 * │ `Bash`. Nhưng lý do thứ 3 (*"lệnh shell nhét đường dẫn lẫn trong chuỗi,   │
 * │ bọc vào MCP không sinh ra cái trường đó"*) **hết đúng với một lệnh đã     │
 * │ KHAI**: ở đây người dùng đã nói trước chỗ nào là tham số gì, nên cái      │
 * │ trường ấy không phải *suy ra* — nó được *khai ra*. `officeJail` khớp      │
 * │ `params.path` y hệt cách nó khớp `file_path`.                            │
 * │                                                                          │
 * │ Trục đúng là ĐOÁN ↔ KHAI (user nêu, tốt hơn trục cũ của spec):           │
 * │   `Bash` (model quyết cả dòng lệnh) → filesystem MCP (chọn trong 14 tool)│
 * │   → CLI đã khai (người dùng cố định argv, model chỉ điền chỗ trống)      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 CHỖ NGUY HIỂM NHẤT, nói to vì nó vô hình: **một cánh tay CLI là một cái lỗ
 * CÓ CHỦ Ý trên tường lửa shell.** Một vai có `chạy lệnh: TẮT` vẫn chạy được
 * binary qua đây — đúng ý đồ. Kéo theo một ràng buộc không được quên:
 *
 *   > **Tờ khai PHẢI nằm ở vùng CHỈ ĐỌC của `officeJail`.**
 *   > Ghi được tờ khai ⇒ tự khai `run: ["powershell","-c","{cmd}"]` ⇒ shell tuỳ
 *   > ý, qua cửa sau, cho một vai đã tắt shell. Cùng cái lỗ §5f, cửa mới.
 *
 * Tờ khai sống trong `company.yaml` (user chốt 31/08).
 *
 * 🔴 **ĐÍNH CHÍNH 01/09 — TÔI ĐÃ VIẾT SAI Ở ĐÂY.** Câu cũ: *"nên nó thừa hưởng
 * hàng rào đã có từ §5f, không phải dựng hàng rào thứ hai"*. **Sai:** §5f gác
 * `OFFICE_CONFIG`, và danh sách đó giải **tương đối với thư mục VĂN PHÒNG** —
 * `company/company.yaml` nằm một cấp trên và **chưa bao giờ được gác**.
 *
 * Chốt chọn `company.yaml` vẫn đúng (một chỗ, một mô hình, không thư mục mới),
 * nhưng nó **KHÔNG miễn phí** như tôi đã nói: phải thêm `COMPANY_CONFIG` vào
 * `paths.ts §guardedZone`. Đã vá 01/09, có test.
 *
 * ⚠ Lớp lỗi: tôi khẳng định một hàng rào **đã bao** một thứ mà chưa đi đọc danh
 * sách của nó. Hàng rào có thật, chỉ là nó ở **một cấp khác**.
 * → [[agentco-rule-must-see-what-it-governs]] · [[agentco-spec-says-done]]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// ══════════════════════════════════════════════════ 1 · TỜ KHAI (hai tờ)

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI TỜ, KHÔNG PHẢI MỘT — và chỉ một tờ bất định. → §16l                  │
 * │                                                                          │
 * │ User hỏi *"tờ hướng dẫn này tất định hay bất định?"* và trực giác         │
 * │ *"bất định, vì MCP cũng bất định"* đúng một nửa. Một tool MCP luôn có     │
 * │ ĐÚNG HAI phần, và nửa còn lại là nửa làm nó dùng được:                    │
 * │                                                                          │
 * │   `description` bất định — văn xuôi — **model** đọc   → 📄 tờ hướng dẫn  │
 * │   `inputSchema` tất định — schema   — **runtime** kiểm → 📋 tờ khai      │
 * │                                                                          │
 * │ **Bỏ tờ khai = quay về `Bash`**: model lại phải tự dựng dòng lệnh từ văn  │
 * │ xuôi, tức phỏng đoán. Tờ khai không phải quan liêu — nó CHÍNH LÀ thứ biến │
 * │ "phỏng đoán" thành "điền vào chỗ trống".                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const CliParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'integer']),
  required: z.boolean().optional(),
  /** Chỉ cho `string`. Không khai ⇒ nhận mọi chuỗi, trừ luật gạch dưới đây. */
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÍ DỤ VỀ **CHỖ TRỐNG**, KHÔNG PHẢI VỀ DÒNG LỆNH. (user chốt 31/08)       │
   * │                                                                          │
   * │ User hỏi đúng chỗ `inputSchema` yếu: `pattern: "^[a-z0-9.-]+$"` là luật   │
   * │ cho **runtime**, nó dạy model rất tệ; `ví dụ: v1.2.3` dạy xong một nhịp.  │
   * │                                                                          │
   * │ ⚠ Nhưng ví dụ phải ở tầng THAM SỐ, không phải tầng action: **model không │
   * │ dựng dòng lệnh** — argv đã cố định, nó chỉ điền vào `{tag}`. Cho nó xem   │
   * │ trọn `pnpm deploy --env staging --tag v1.2.3` là đưa thông tin về một     │
   * │ tầng nó không điều khiển, rồi bắt nó khớp ngược xem chữ nào là tham số.   │
   * │                                                                          │
   * │ Đo 31/08: `.describe()` → `description` của ĐÚNG property đó trong        │
   * │ `inputSchema`, tức nằm ngay cạnh cái ô model đang điền.                   │
   * │                                                                          │
   * │ ⚠ TRẦN 60 KÝ TỰ, và nó là hoá đơn LẶP LẠI: tool definition nằm trong      │
   * │ prefix **mọi lượt**. Cùng lớp `hint` (trần 320) và `does` (trần 4).       │
   * │                                                                          │
   * │ 🎯 Nguồn ĐÚNG là **lượt Thử**, không phải gõ tay — khuôn `returns` đã chốt │
   * │ 14/08: *chạy thật → chụp lại hành vi thật*. Một ví dụ gõ tay là một LỜI   │
   * │ KHAI (sai từ đầu cũng không ai biết); một ví dụ chụp từ lần chạy được thì │
   * │ đúng **theo cấu tạo**. Ô này nhận cả hai, nhưng đường chính là nút Thử.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  example: z.string().max(60, 'ví dụ phải ngắn — nó nằm trong prefix mọi lượt').optional(),
  /**
   * 🔴 GIÁ TRỊ KHÔNG ĐƯỢC BIẾN THÀNH CỜ. → §16e
   *
   * `tag = "--force"` nối vào argv là người dùng vừa cấp một cờ họ chưa bao giờ
   * khai. Mặc định TỪ CHỐI giá trị mở đầu bằng `-`; muốn khác thì bật ô này một
   * cách tường minh — cùng khuôn *"tắt được, nhưng phải tắt có ý thức"* của
   * `confirm`.
   */
  allow_dash: z.boolean().optional(),
});

export const CliActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'id chỉ gồm chữ thường, số và gạch dưới'),
  /** Câu tiếng người cho UI và cho dòng danh bạ. KHÔNG vào MCP. */
  say: z.string().min(1),
  /** 📄 TỜ HƯỚNG DẪN — vào thẳng `description` của tool. */
  description: z.string().min(1),
  /**
   * 📋 argv template. `{ten}` = chỗ trống. **MẢNG, không bao giờ là chuỗi shell.**
   *
   * Ba lý do (§16e), và lý do ① là lý do an ninh: tham số do MODEL sinh. Chuỗi
   * shell + giá trị model sinh = tiêm lệnh, không phải rủi ro lý thuyết. Với
   * argv thì `; rm -rf /` chỉ là một chuỗi ký tự nằm gọn trong một phần tử.
   */
  run: z.array(z.string()).min(1),
  params: z.array(CliParamSchema).optional(),
  /** Ô trống `{office}` do TA giải. Model không đụng vào được. */
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().default(120_000),
  /**
   * Chuỗi trên stdout+stderr ⇒ coi là HỎNG dù `exit 0`. **Vào bản đầu** (user
   * chốt 30/08), không phải "để sau".
   *
   * `exit 0` KHÔNG đồng nghĩa thành công: rất nhiều CLI in lỗi ra stdout rồi
   * trả 0. Đúng lớp lỗi §5h·7d (*HTTP 200 kèm `error`*), và ở đây nó nổ theo
   * chiều TỆ HƠN: agent tin lệnh đã xong và **đi tiếp**.
   */
  fail_when: z.array(z.string()).optional(),
  /**
   * CHỈ để dựng `annotations` cho nhật ký/UI. **Không dựng nấc quyền nào** —
   * user chốt 30/08: *"BỎ NẤC HẲN cho cánh tay CLI, toàn quyền, thực hiện theo
   * tờ hướng dẫn sử dụng"*. Cổng còn lại đúng hai: **ai được nối dây** và
   * **`confirm` từng action**.
   */
  read_only: z.boolean().optional(),
  /** Ghi dữ liệu thì mặc định BẬT. Tắt được, nhưng phải tắt có ý thức. */
  confirm: z.boolean().optional(),
  /** Chìa vào `env`, KHÔNG vào argv — argv đọc được từ tiến trình khác (§16e). */
  env: z.record(z.string(), z.string()).optional(),
});

export const CliArmSchema = z.object({
  type: z.literal('cli'),
  actions: z.array(CliActionSchema).min(1),
  /**
   * ⭐ RÀNG BUỘC ⑥ CỦA §16p — *"binary sống ở đâu"* là **DỮ LIỆU trong khai
   * báo**, không phải thứ suy lúc chạy. Phải có mặt từ dòng mã ĐẦU TIÊN.
   *
   * Không có ô này thì ngày bật Docker phải sửa **mọi** action của khách — và
   * đó chính là *"đập đi xây lại"* mà chốt ② sinh ra để tránh. Hôm nay chỉ có
   * một giá trị hợp lệ; ngày có shim HTTP thì thêm `'host'` vào enum, **không
   * đụng khai báo nào đã lưu**.
   */
  runs_on: z.literal('daemon').default('daemon'),
});

export type CliParam = z.infer<typeof CliParamSchema>;
export type CliAction = z.infer<typeof CliActionSchema>;
export type CliArm = z.infer<typeof CliArmSchema>;

/**
 * Nhận mặt một tờ khai CLI trong `company.yaml`.
 *
 * ⚠ Nhận theo `type`, không theo *"không có `command` cũng không có `url`"*:
 * cái sau là suy luận theo vắng mặt, mà vắng mặt không phải tín hiệu — một tờ
 * khai gõ sai sẽ im lặng thành "CLI" rồi hỏng ở chỗ khác.
 * → [[agentco-deterministic-vs-signal]]
 */
export function isCliArm(config: unknown): boolean {
  return !!config && typeof config === 'object' && (config as { type?: unknown }).type === 'cli';
}

/** Mọi khoá ta khai — nguồn của gợi ý "ý bạn là…". Một danh sách, không phải ba. */
const KNOWN_KEYS = [
  ...Object.keys(CliArmSchema.shape),
  ...Object.keys(CliActionSchema.shape),
  ...Object.keys(CliParamSchema.shape),
];

/**
 * Khoá gần đúng nhất, hoặc `undefined`.
 *
 * ⚠ Bắt **họ camelCase trước** bằng phép chuẩn hoá (bỏ `_`, hạ chữ thường) chứ
 * không dựa vào khoảng cách sửa: `readOnly` → `read_only` lệch 2 phép, còn
 * `timeoutMs` → `timeout_ms` lệch 3 — một ngưỡng đủ rộng để bắt cả hai sẽ bắt
 * luôn những thứ không liên quan. Chuẩn hoá thì **tất định** và không cần ngưỡng.
 */
function nearestKey(bad: string): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, '');
  const hit = KNOWN_KEYS.find((k) => norm(k) === norm(bad));
  if (hit) return hit;
  // Còn lại là gõ thiếu/thừa một ký tự: `runs` → `run`, `sayy` → `say`.
  return KNOWN_KEYS.find((k) => {
    const [a, b] = k.length > bad.length ? [k, bad] : [bad, k];
    if (a!.length - b!.length !== 1) return false;
    const at = [...a!].findIndex((c, i) => c !== b![i]);
    return at < 0 || a!.slice(0, at) + a!.slice(at + 1) === b;
  });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CỬA DÁN: STRICT. CỬA NẠP `company.yaml`: LỎNG. **HAI LUẬT, CỐ Ý.**       │
 * │ (user chốt 31/08 sau khi đo: zod mặc định NUỐT IM LẶNG khoá lạ)          │
 * │                                                                          │
 * │ Vì sao strict ở đây: **khoá dễ gõ sai nhất chính là khoá AN TOÀN.** Người │
 * │ dán JSON gõ camelCase ở lần đầu, và ba cái hay nhất đều có bản snake:     │
 * │   `readOnly`  → annotation thành destructive, sai chiều                  │
 * │   `timeoutMs` → rơi về 120s, người dùng tin là đã đặt                    │
 * │   `failWhen`  → 🔴 lưới đỡ `exit 0` kèm lỗi BIẾN MẤT, không tín hiệu nào  │
 * │ Dòng cuối mở lại đúng cái lỗ §5h·7d mà `fail_when` sinh ra để chặn.       │
 * │                                                                          │
 * │ Hai chiều hỏng không cân nhau: từ chối nhầm ⇒ người dùng đang đứng đó,    │
 * │ sửa trong 3 giây (ỒN ÀO, RẺ). Nhận nhầm ⇒ KHÔNG TRIỆU CHỨNG NÀO.         │
 * │ → [[agentco-safe-default-direction]] · [[agentco-silent-allowlist]]       │
 * │                                                                          │
 * │ ⚠ VÀ VÌ SAO CỬA NẠP PHẢI LỎNG: không ai đứng đó. Siết cửa nạp là ngày     │
 * │ nâng cấp thêm một trường thì **mọi cánh tay cũ thành mồ côi**. Ai "dọn    │
 * │ cho gọn" bằng cách gộp hai cửa sẽ phá đúng một trong hai. Có test canh.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Gợi ý khoá gần đúng là thứ biến **hàng rào thành biển chỉ đường** — đó mới
 * là câu trả lời cho *"rào hay linh hoạt"*: linh hoạt không nằm ở chỗ nhận bừa,
 * nó nằm ở chỗ nói cho người ta biết phải sửa gì.
 */
export function parseCliArm(input: unknown): { ok: true; arm: CliArm } | { ok: false; error: string } {
  /**
   * ⚠ Quét khoá lạ bằng MỘT lượt đi bộ, KHÔNG bằng `z.strictObject`.
   *
   * Bản đầu 31/08 làm cả ba schema `strictObject` — và test bắt ngay: nó siết
   * **cả cửa nạp**, tức phá đúng bất biến vừa viết ở khối trên. Schema là **một
   * hàm dùng chung cho hai cửa**, nên độ chặt không được sống trong schema; nó
   * phải sống ở **cửa**. Một hàm quét ở đây rẻ hơn hẳn hai bộ schema song song —
   * và hai bộ schema thì sớm muộn cũng lệch nhau.
   */
  const bad: string[] = [];
  const scan = (obj: unknown, allowed: readonly string[]) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad.push(k);
  };
  scan(input, Object.keys(CliArmSchema.shape));
  const acts = (input as { actions?: unknown })?.actions;
  if (Array.isArray(acts)) {
    for (const a of acts) {
      scan(a, Object.keys(CliActionSchema.shape));
      const ps = (a as { params?: unknown })?.params;
      if (Array.isArray(ps)) for (const p of ps) scan(p, Object.keys(CliParamSchema.shape));
    }
  }
  if (bad.length) {
    const say = [...new Set(bad)].map((k) => {
      const near = nearestKey(k);
      return near ? `"${k}" — ý bạn là "${near}"?` : `"${k}" không có trong tờ khai`;
    });
    return { ok: false, error: `Khoá không nhận ra: ${say.join(' · ')}` };
  }

  const r = CliArmSchema.safeParse(input);
  if (r.success) return { ok: true, arm: r.data };
  const first = r.error.issues[0]!;
  const at = first.path.length ? `${first.path.join('.')}: ` : '';
  return { ok: false, error: `${at}${first.message}` };
}

/**
 * ⚠ `cliPasteRedirect` ĐÃ CHUYỂN SANG WEB (01/09) — **đừng dựng lại ở đây.**
 *
 * Nó là một **affordance của giao diện** (*"anh dán nhầm tab, mở tab Lệnh nhé"*),
 * không phải một luật của lõi. Hai lý do, và lý do thứ hai là lý do cứng:
 *
 *  ① Lõi **không được biết** thứ này đến từ màn hình nào. Chặn ở cửa, không chặn
 *    ở lõi: sửa tay `company.yaml` thêm tờ khai CLI thì nó **vẫn phải chạy** —
 *    có test khoá. Buộc một KIỂU DỮ LIỆU vào một MÀN HÌNH mới là chỗ vi phạm.
 *  ② File này `import 'node:child_process'` và SDK ⇒ **không vào được bundle
 *    trình duyệt**. Một hàm chỉ web gọi mà nằm trong module chỉ server nạp được
 *    thì mãi mãi là mã không ai gọi — đúng cái bẫy vừa mắc hôm qua.
 *    → [[agentco-spec-says-done]]
 */

// ══════════════════ 2 · BỘ CHẠY — mọi thứ TƯỜNG MINH (ràng buộc §16p ③)

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** `spawn` · `timeout` · `exit` · `fail_when` — BỐN CỬA, đừng gộp. */
  door?: 'spawn' | 'timeout' | 'exit' | 'fail_when';
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHÔNG `process.cwd()`. KHÔNG kế thừa env ngầm. KHÔNG `shell: true`.       │
 * │                                                                          │
 * │ Ba cái đầu là ràng buộc "chờ sẵn Docker" §16p ③ — trong container ambient │
 * │ là thứ khác, và đây là giả định trộn sâu nhất, khó gỡ nhất.               │
 * │                                                                          │
 * │ `shell:false` còn là CỘT CHỊU LỰC AN NINH: nó là thứ làm `; calc` chỉ là  │
 * │ một chuỗi ký tự chứ không phải một lệnh thứ hai. Đo được trong spike:     │
 * │ `6; calc` và `6 && calc` đi qua nguyên vẹn như dữ liệu.                   │
 * │                                                                          │
 * │ ⚠ GIỚI HẠN ĐÃ BIẾT, ĐÁNH ĐỔI CÓ Ý THỨC: `shell:false` không chạy được    │
 * │ `.cmd`/`.bat` trên Windows (`npx`, `npm`). Muốn bọc một `.cmd` thì khai   │
 * │ đường dẫn đầy đủ tới trình thông dịch — **đừng mở `shell`**.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function runCommand(opts: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<RunResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const [cmd, ...rest] = opts.argv;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd!, rest, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: null, stdout: '', stderr: (e as Error).message, ms: 0, door: 'spawn' });
      return;
    }

    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      /**
       * ⚠ `child.kill()` trên Windows KHÔNG giết cây con. Một `python` gọi tiếp
       * một tiến trình khác thì tiến trình cháu sống sót và thành mồ côi.
       * `taskkill /T /F` là đường duy nhất đúng ở đây.
       * → [[agentco-three-os-always]]
       */
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* đã chết rồi */
      }
    }, opts.timeoutMs);

    // `error` = KHÔNG spawn được (thiếu binary, không có quyền). Đây là một CỬA
    // KHÁC HẲN "chạy rồi hỏng" — gộp hai cái là đẻ ra câu lỗi sai cửa.
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: out, stderr: e.message, ms: Date.now() - t0, door: 'spawn' });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        code,
        stdout: out,
        stderr: err,
        ms: Date.now() - t0,
        ...(timedOut ? { door: 'timeout' as const } : code !== 0 ? { door: 'exit' as const } : {}),
      });
    });
  });
}

// ═══════════════════════ 3 · ĐIỀN ARGV — chỗ chịu lực AN NINH (§16e)

export class ArgvError extends Error {}

/**
 * Thay `{ten}` bằng giá trị. **Không nối chuỗi, không qua shell, không tự thêm
 * phần tử nào.** Một tham số ⇒ nằm gọn trong đúng phần tử argv đã khai.
 *
 * ⚠ Kiểm giá trị TRƯỚC khi thay, không phải sau: kiểm sau là kiểm một chuỗi đã
 * lẫn với phần cố định, và luật *"mở đầu bằng `-`"* mất nghĩa ngay lập tức.
 */
export function fillArgv(a: CliAction, args: Record<string, unknown>): string[] {
  const byName = new Map((a.params ?? []).map((p) => [p.name, p]));

  const value = (name: string): string => {
    const p = byName.get(name);
    if (!p) throw new ArgvError(`argv có ô trống "{${name}}" nhưng khai báo không có tham số đó`);
    const raw = args[name];
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) throw new ArgvError(`thiếu tham số bắt buộc "${name}"`);
      throw new ArgvError(`tham số "${name}" chưa có giá trị`);
    }
    if (p.type === 'integer') {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new ArgvError(`"${name}" phải là số nguyên, nhận "${String(raw)}"`);
      if (p.min !== undefined && n < p.min) throw new ArgvError(`"${name}" phải ≥ ${p.min}`);
      if (p.max !== undefined && n > p.max) throw new ArgvError(`"${name}" phải ≤ ${p.max}`);
      return String(n);
    }
    const s = String(raw);
    // 🔴 LUẬT GẠCH — xem chú thích `allow_dash`.
    if (!p.allow_dash && s.startsWith('-')) {
      throw new ArgvError(
        `"${name}" mở đầu bằng dấu gạch ("${s}") — giá trị không được biến thành một cờ dòng lệnh. ` +
          `Nếu đây thật sự là ý bạn, khai allow_dash cho tham số này.`,
      );
    }
    if (p.pattern && !new RegExp(p.pattern).test(s)) {
      throw new ArgvError(`"${name}" không khớp khuôn ${p.pattern}: "${s}"`);
    }
    return s;
  };

  return a.run.map((el) => el.replace(/\{([a-z0-9_]+)\}/gi, (_, n: string) => value(n)));
}

// ═════════════════ 4 · KHAI BÁO → TOOL. HÀM THUẦN (ràng buộc §16p ①)

/** Nơi tiến trình con được phép sống. `officeDir` giải ô trống `{office}`. */
export interface CliContext {
  officeDir: string;
  /** Chìa đã được `injectSecrets` điền. Đi vào `env`, KHÔNG vào argv. */
  env: Record<string, string>;
  /** Ghi lại mọi lời gọi — thứ DUY NHẤT trả lời được "ai vừa chạy cái gì". */
  onCall?: (rec: { tool: string; argv: string[]; cwd: string; ms: number; ok: boolean }) => void;
}

/**
 * ⚠ Hàm này **không biết** mình đang chạy dưới transport nào — đó là toàn bộ lý
 * do nó tách khỏi chỗ dựng server. Ngày thêm shim HTTP cho Docker, phần này đi
 * theo nguyên vẹn, **không đụng một dòng**. → §16p ①
 */
export function buildCliTools(arm: CliArm, ctx: CliContext) {
  return arm.actions.map((a) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const p of a.params ?? []) {
      let base: z.ZodTypeAny = p.type === 'integer' ? z.number().int() : z.string();
      /**
       * Ví dụ đi vào `description` của ĐÚNG property này — đo 31/08:
       * `.describe()` → `{"tag":{"type":"string","description":"…"}}`.
       * Vắng `example` ⇒ **không in gì**, nên mọi cánh tay đang chạy không đổi
       * một ký tự nào trong prefix. (Cùng luật chống-hỏng-lây của `does`.)
       */
      if (p.example) base = base.describe(`ví dụ: ${p.example}`);
      shape[p.name] = p.required ? base : base.optional();
    }

    return tool(
      a.id,
      /**
       * 📄 TỜ HƯỚNG DẪN đi thẳng vào đây, nguyên văn. Sau khi bỏ nấc quyền, đây
       * là chỗ **DUY NHẤT** model học được lệnh này làm gì và nguy hiểm tới đâu
       * — nên nó phải nói ra HẬU QUẢ, không chỉ công dụng. → §16l
       */
      a.description,
      shape,
      async (args): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
        let filled: string[];
        try {
          filled = fillArgv(a, args as Record<string, unknown>);
        } catch (e) {
          // Cổng chặn TRƯỚC khi spawn. Trả `isError` để model biết nó sai THAM SỐ
          // chứ không phải máy hỏng — hai chuyện, hai cách xử lý khác nhau.
          return {
            content: [{ type: 'text', text: `Tham số không hợp lệ: ${(e as Error).message}` }],
            isError: true,
          };
        }

        /**
         * `cwd` do TA giải, luôn trong văn phòng. **Không nhận `cwd` từ tham số
         * model sinh** — đó là ràng buộc §16i, không phải khẩu vị.
         */
        const cwd = a.cwd ? a.cwd.split('{office}').join(ctx.officeDir) : ctx.officeDir;

        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 CỬA `spawn` CÓ HAI NGUYÊN NHÂN, CÂU LỖI CHỈ NÓI MỘT.          │
         * │ (bắt được 30/08, ngay trong lượt chạy đầu của spike)             │
         * │                                                                  │
         * │ `spawn` ném **ENOENT** cho CẢ HAI: thiếu binary, VÀ `cwd` không   │
         * │ tồn tại. Bản đầu quy hết về *"máy này không tìm thấy python"* —   │
         * │ và nhân viên đã báo nguyên văn câu đó cho người dùng, trong khi   │
         * │ máy có đủ Python. Một câu lỗi tự tin và sai, dẫn người ta đi cài  │
         * │ lại thứ họ đang có.                                              │
         * │                                                                  │
         * │ Phân biệt được bằng MỘT phép kiểm rẻ ⇒ không có lý do gì để đoán. │
         * │ → [[agentco-wrong-door-errors]]                                   │
         * └──────────────────────────────────────────────────────────────────┘
         */
        if (!fs.existsSync(cwd)) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Không chạy được lệnh — thư mục làm việc "${cwd}" không tồn tại. ` +
                  `Đây KHÔNG phải chuyện thiếu "${filled[0]}" trên máy; đừng đi cài gì cả.`,
              },
            ],
            isError: true,
          };
        }

        const r = await runCommand({
          argv: filled,
          cwd,
          // Chìa của action gộp lên trên chìa chung — action là chỗ hẹp hơn.
          env: { ...ctx.env, ...(a.env ?? {}) },
          timeoutMs: a.timeout_ms,
        });
        ctx.onCall?.({ tool: a.id, argv: filled, cwd, ms: r.ms, ok: r.ok });

        const body = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
        const hit = a.fail_when?.find((s) => body.includes(s));

        // ⚠ BỐN CỬA, BỐN CÂU. Gộp lại là đẻ ra đúng lớp "câu lỗi chỉ sai cửa".
        if (r.door === 'spawn') {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Không chạy được lệnh — máy này không tìm thấy "${filled[0]}" (hoặc không có quyền chạy nó). ` +
                  `Đây KHÔNG phải lỗi tham số, và cũng không phải lệnh chạy rồi hỏng.\n${r.stderr}`,
              },
            ],
            isError: true,
          };
        }
        if (r.door === 'timeout') {
          return {
            content: [
              {
                type: 'text',
                text: `Lệnh chạy quá ${a.timeout_ms} ms nên đã bị dừng. Kết quả (nếu có) không đầy đủ.\n${body}`,
              },
            ],
            isError: true,
          };
        }
        if (hit) {
          return {
            content: [
              {
                type: 'text',
                text: `Lệnh thoát với mã 0 NHƯNG kết quả có dấu hiệu hỏng ("${hit}"). Coi như THẤT BẠI.\n${body}`,
              },
            ],
            isError: true,
          };
        }
        if (!r.ok) {
          return { content: [{ type: 'text', text: `Lệnh thất bại (mã ${r.code}).\n${body}` }], isError: true };
        }
        return { content: [{ type: 'text', text: body || '(lệnh chạy xong, không in gì)' }] };
      },
      {
        // Vẫn khai `annotations` cho ĐÚNG giao thức MCP — nhưng chúng KHÔNG dựng
        // nấc quyền nào (user chốt 30/08). Chúng ở đây để nhật ký và UI đọc được.
        annotations: { readOnlyHint: a.read_only === true, destructiveHint: a.read_only !== true },
      },
    );
  });
}

/**
 * Tờ khai → cấu hình SDK chạy được.
 *
 * ⚠ Gọi SAU `injectSecrets`, không bao giờ trước: `fillRefs` chỉ đi vào object
 * thuần, mà kết quả của hàm này chở một `McpServer` **sống**. Đảo thứ tự là ô
 * `${CHIA}` trong `env` của action không bao giờ được điền — đúng cái bug 31/08
 * (`missingSecretRefs` phát hiện mãi mãi, `injectSecrets` không bao giờ điền).
 * → SPEC-arms §16a ⑧
 */
export function compileCliArm(name: string, decl: unknown, ctx: CliContext): McpServerConfig {
  const arm = CliArmSchema.parse(decl);
  return createSdkMcpServer({ name, version: '1', tools: buildCliTools(arm, ctx) }) as McpServerConfig;
}

/** Tên các việc — `arms[băm].tools` cần nó để cấp `mcp__<id>__<tool>`, không cấp cả server. */
export function cliToolNames(decl: unknown): string[] {
  const parsed = CliArmSchema.safeParse(decl);
  return parsed.success ? parsed.data.actions.map((a) => a.id) : [];
}

/** Câu tiếng người cho dòng danh bạ (`arms[băm].does`). Trần 4 — §7b cấm tên tool thô. */
export function cliSays(decl: unknown): string[] {
  const parsed = CliArmSchema.safeParse(decl);
  return parsed.success ? parsed.data.actions.map((a) => a.say).slice(0, 4) : [];
}
