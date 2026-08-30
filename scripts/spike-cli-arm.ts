/**
 * SPIKE — CÁNH TAY CLI: khai báo → MCP `type:'sdk'` → worker thật → tiến trình thật
 * → docs/SPEC-arms.md §16d–16q · TEST-WALKTHROUGH bài 22
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NÓ LÀ MCP THẬT, KHÔNG PHẢI "MCP-LIKE".                                    │
 * │                                                                          │
 * │ Đúng giao thức, đúng `tools/list`, đúng `annotations`, đúng `isError`.    │
 * │ Khác mỗi **transport**: `type:'sdk'` chạy TRONG tiến trình daemon thay vì │
 * │ qua stdio/HTTP. Thứ ta thiết kế riêng chỉ là **tầng KHAI BÁO** nằm trên   │
 * │ nó — và tầng đó tồn tại vì một CLI không tự khai được schema.             │
 * │                                                                          │
 * │ ⇒ Ngày bật Docker, `buildTools()` đi theo nguyên vẹn; chỉ adapter đổi.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ HAI TỜ, và chỉ một tờ bất định (§16l) ═══
 *
 *   📄 TỜ HƯỚNG DẪN  `description`  BẤT ĐỊNH — văn xuôi, MODEL đọc
 *   📋 TỜ KHAI       `run`/`params`/`cwd`/`timeoutMs`/`failWhen`  TẤT ĐỊNH — RUNTIME kiểm
 *
 * Bỏ tờ khai = quay về `Bash` = model tự dựng dòng lệnh = phỏng đoán.
 *
 * ═══ BA PHẦN, xếp theo GIÁ ═══
 *
 *   Phần 1  💰 $0    cổng TẤT ĐỊNH — gọi thẳng `fillArgv`/`runCommand`.
 *                    7 ca an ninh + hành vi. Không có model nào tham gia.
 *   Phần 2  💰 ~$0.05 qua `runWorker` THẬT — đúng đường một task đi.
 *   Phần 3  💰 ~$0.15 `--full`: user → Trợ lý → worker → CLI. Đúng chuỗi user hỏi.
 *
 * ⚠ VÌ SAO PHẦN 1 PHẢI ĐỨNG TRƯỚC: 22/08 có 9 test XANH cho một cổng KHÔNG BAO
 * GIỜ BẮN vì chúng đi vòng qua đường thật. Nhưng chiều ngược lại cũng đúng — đo
 * an ninh QUA MODEL là đo hành vi model, không đo hàng rào: model không chịu gõ
 * `; calc` thì ta nhận 🟢 mà chẳng chứng minh được gì. Cổng an ninh phải được
 * gọi TRỰC TIẾP; đường thật để chứng minh nó có mặt trên đường đó.
 *
 * ⚠ KHÔNG ĐỘNG DỮ LIỆU NGƯỜI DÙNG: mọi thứ chạy trong một sandbox tạm, xoá ở
 * `finally`. `role.mcp`/`role.tools` chỉ đổi TRONG BỘ NHỚ, không ghi đĩa.
 *
 * Chạy:
 *   npx tsx scripts/spike-cli-arm.ts                   # phần 1 + 2
 *   npx tsx scripts/spike-cli-arm.ts --only=1          # chỉ cổng tất định, $0
 *   npx tsx scripts/spike-cli-arm.ts --full            # + phần 3 (qua Trợ lý)
 *   npx tsx scripts/spike-cli-arm.ts --treo=180        # đo trần `tools/call` (§16n)
 *   npx tsx scripts/spike-cli-arm.ts [company] [office] [role]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { loadCompanyConfig, loadOffice } from '../src/core/config.js';
import { TaskBriefSchema } from '../src/core/types.js';
import { runWorker } from '../src/core/worker.js';

// ══════════════════════════════════════════════════════════ 0 · THAM SỐ

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const has = (n: string) => argv.includes(`--${n}`);
const positional = argv.filter((a) => !a.startsWith('--'));

const companyDir = path.resolve(positional[0] ?? 'company');
const officeId = positional[1] ?? 'canh-tay';
const roleId = positional[2] ?? 'nguoi-soi-thu-muc';
const ONLY = flag('only');
const wants = (phase: string) => !ONLY || ONLY === phase;
/** Giây ngủ của ca đo trần `tools/call`. `0` = không chạy ca đó. */
const TREO = Number(flag('treo') ?? 0);

// ══════════════════════════════════════════ 1 · KIỂU KHAI BÁO (hai tờ)

interface CliParam {
  name: string;
  type: 'string' | 'integer';
  required?: boolean;
  /** Chỉ dùng cho `string`. Không khai ⇒ nhận mọi chuỗi (trừ luật gạch dưới đây). */
  pattern?: string;
  min?: number;
  max?: number;
  /**
   * 🔴 MẶC ĐỊNH `false` — giá trị mở đầu bằng `-` bị TỪ CHỐI.
   *
   * `tag = "--force"` mà nối vào argv là người dùng vừa cấp một cờ họ chưa bao
   * giờ khai. Bật được, nhưng phải bật CÓ Ý THỨC — cùng khuôn `confirm`.
   */
  allowDash?: boolean;
}

interface CliAction {
  id: string;
  /** Câu tiếng người cho UI. Không vào MCP. */
  say: string;
  /** 📄 TỜ HƯỚNG DẪN — BẤT ĐỊNH. Vào thẳng `description` của tool. */
  description: string;
  /** 📋 argv template. `{ten}` = chỗ trống. **MẢNG, không bao giờ là chuỗi shell.** */
  run: string[];
  params?: CliParam[];
  /** Ô trống `{sandbox}` do runtime giải — model KHÔNG đụng vào được. */
  cwd?: string;
  timeoutMs: number;
  /**
   * Chuỗi trên stdout+stderr ⇒ coi là HỎNG dù `exit 0`.
   * → §5h·7d: *HTTP 200 kèm `error`*. Ở CLI nó nổ tệ hơn — agent tin xong rồi đi tiếp.
   */
  failWhen?: string[];
  /** Chỉ để dựng `annotations`. User chốt 30/08: KHÔNG có nấc quyền cho CLI. */
  readOnly?: boolean;
}

interface CliArm {
  id: string;
  label: string;
  actions: CliAction[];
}

// ══════════════════════════ 2 · BỘ CHẠY — mọi thứ TƯỜNG MINH (ràng buộc E-3)

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** `spawn` · `timeout` · `exit` · `fail_when` — BỐN CỬA KHÁC NHAU, đừng gộp. */
  door?: 'spawn' | 'timeout' | 'exit' | 'fail_when';
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHÔNG `process.cwd()`. KHÔNG kế thừa env ngầm. KHÔNG `shell: true`.       │
 * │                                                                          │
 * │ Cả ba là ràng buộc "chờ sẵn Docker" §16p ③ — trong container ambient là   │
 * │ thứ khác, và một giả định ngầm trộn vào đây sẽ phải gỡ ở hàng chục chỗ.   │
 * │                                                                          │
 * │ `shell:false` còn là cột chịu lực AN NINH: nó là thứ làm `; calc` chỉ là  │
 * │ một chuỗi ký tự chứ không phải một lệnh thứ hai.                          │
 * │                                                                          │
 * │ ⚠ GIỚI HẠN ĐÃ BIẾT: `shell:false` không chạy được `.cmd`/`.bat` trên      │
 * │ Windows (`npx`, `npm`). Đó là ĐÁNH ĐỔI CÓ Ý THỨC — muốn bọc một `.cmd`    │
 * │ thì khai đường dẫn đầy đủ tới trình thông dịch, đừng mở `shell`.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function runCommand(opts: {
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
      child = spawn(cmd!, rest, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
      });
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
       * một tiến trình khác thì tiến trình cháu sống sót và thành mồ côi — đúng
       * ô đo D-6 của bài 22. `taskkill /T /F` là đường duy nhất đúng ở đây.
       */
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* đã chết */
      }
    }, opts.timeoutMs);

    // `error` = KHÔNG spawn được (binary không tồn tại, không có quyền). Đây là
    // một CỬA KHÁC hẳn "chạy rồi hỏng" — gộp hai cái là đẻ ra câu lỗi sai cửa.
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

// ═════════════════════════ 3 · ĐIỀN ARGV — chỗ chịu lực AN NINH (§16e)

class ArgvError extends Error {}

/**
 * Thay `{ten}` bằng giá trị. **Không nối chuỗi, không qua shell, không tự thêm
 * phần tử nào.** Một tham số ⇒ nằm gọn trong đúng phần tử argv đã khai.
 *
 * ⚠ Kiểm giá trị TRƯỚC khi thay, không phải sau: kiểm sau là kiểm một chuỗi đã
 * lẫn với phần cố định, và luật "mở đầu bằng `-`" mất nghĩa ngay lập tức
 * (`--tag=--force` không mở đầu bằng `-` sau khi ghép... nhưng `--force` thì có).
 */
function fillArgv(a: CliAction, args: Record<string, unknown>): string[] {
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
    // 🔴 LUẬT GẠCH — xem chú thích `allowDash`.
    if (!p.allowDash && s.startsWith('-')) {
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

// ══════════════════ 4 · KHAI BÁO → TOOL MCP. HÀM THUẦN (ràng buộc E-1)

/**
 * ⚠ Hàm này **không biết** mình đang chạy dưới transport nào. Đó là toàn bộ lý
 * do nó tồn tại tách khỏi chỗ dựng server: ngày thêm shim HTTP cho Docker, phần
 * này đi theo nguyên vẹn. → §16p ①
 */
/**
 * 🔴 ĐẾM LỜI GỌI THẬT — thêm 30/08 sau khi cổng ⑨ báo XANH cho một lượt chạy
 * KHÔNG hề gọi CLI lần nào.
 *
 * Bản đầu của ⑨ đo `currentState === 'idle'`, tức đo **còn sống**, không đo
 * **có làm việc không**. Trợ lý trả lời bằng cách BỊA một con số, văn phòng về
 * `idle` đúng như mong đợi, và cổng bật đèn xanh cho một thất bại hoàn toàn.
 * ⇒ Cổng phải bám vào thứ CHỈ tồn tại khi việc thật xảy ra: chính cái handler.
 */
const calls: { tool: string; args: unknown; at: number }[] = [];

function buildTools(arm: CliArm, ctx: { sandbox: string; env: Record<string, string> }) {
  return arm.actions.map((a) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const p of a.params ?? []) {
      let s: z.ZodTypeAny = p.type === 'integer' ? z.number().int() : z.string();
      shape[p.name] = p.required ? s : (s = s.optional());
    }

    return tool(
      a.id,
      // 📄 TỜ HƯỚNG DẪN đi thẳng vào đây, nguyên văn. Đây là chỗ DUY NHẤT model
      // học được lệnh này làm gì và nguy hiểm tới đâu — sau khi bỏ nấc quyền,
      // nó gánh cả phần cảnh báo. → §16l
      a.description,
      shape,
      async (args): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
        calls.push({ tool: a.id, args, at: Date.now() });
        console.log(`      ⚙ CLI ĐƯỢC GỌI THẬT: ${a.id}(${JSON.stringify(args)})`);
        let filled: string[];
        try {
          filled = fillArgv(a, args as Record<string, unknown>);
        } catch (e) {
          // Cổng chặn TRƯỚC khi spawn. Trả `isError` để model biết nó sai tham
          // số chứ không phải máy hỏng — hai chuyện, hai cách xử lý khác nhau.
          return { content: [{ type: 'text', text: `Tham số không hợp lệ: ${(e as Error).message}` }], isError: true };
        }

        const cwd = (a.cwd ?? '{sandbox}').replace('{sandbox}', ctx.sandbox);

        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 CỬA `spawn` CÓ HAI NGUYÊN NHÂN, VÀ CÂU LỖI CHỈ NÓI MỘT.       │
         * │ (bắt được 30/08, ngay trong lượt chạy đầu của Phần 3)            │
         * │                                                                  │
         * │ `spawn` ném **ENOENT** cho CẢ HAI: binary không tồn tại, VÀ `cwd` │
         * │ không tồn tại. Bản đầu quy hết về câu *"máy này không tìm thấy    │
         * │ python"* — và nhân viên đã báo cáo lại nguyên văn câu đó cho      │
         * │ người dùng, trong khi `python` có đủ trên máy. Một câu lỗi tự tin │
         * │ và sai, dẫn người ta đi cài lại Python.                          │
         * │                                                                  │
         * │ Phân biệt được bằng MỘT phép kiểm rẻ, nên không có lý do gì để   │
         * │ đoán. → [[agentco-wrong-door-errors]]                            │
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

        const r = await runCommand({ argv: filled, cwd, env: ctx.env, timeoutMs: a.timeoutMs });

        const body = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
        const hit = a.failWhen?.find((s) => body.includes(s));

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
              { type: 'text', text: `Lệnh chạy quá ${a.timeoutMs} ms nên đã bị dừng. Kết quả (nếu có) không đầy đủ.\n${body}` },
            ],
            isError: true,
          };
        }
        if (hit) {
          return {
            content: [
              { type: 'text', text: `Lệnh thoát với mã 0 NHƯNG kết quả có dấu hiệu hỏng ("${hit}"). Coi như THẤT BẠI.\n${body}` },
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
        // nấc quyền nào (user chốt 30/08: CLI = toàn quyền, thi hành theo tờ
        // hướng dẫn). Chúng ở đây để nhật ký và UI đọc được.
        annotations: { readOnlyHint: a.readOnly === true, destructiveHint: a.readOnly !== true },
      },
    );
  });
}

// ══════════════════════════════════ 5 · SANDBOX + "CLI CỦA KHÁCH HÀNG"

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-arm-'));

/** `python -m xucxac` — đúng hình dạng user nêu. `-m` đọc module từ **cwd**. */
fs.writeFileSync(
  path.join(sandbox, 'xucxac.py'),
  [
    'import argparse, random, sys, time',
    'p = argparse.ArgumentParser()',
    "p.add_argument('--mat', type=int, default=6)",
    "p.add_argument('--cho', type=int, default=10)",
    'a = p.parse_args()',
    'time.sleep(a.cho)',
    'print(random.randint(1, a.mat))',
    'sys.exit(0)',
  ].join('\n'),
  'utf8',
);

/** Ca `exit 0` KÈM LỖI — lớp lỗi §5h·7d, ở CLI nó nổ tệ hơn. */
fs.writeFileSync(
  path.join(sandbox, 'dongbo.py'),
  ['import sys', "print('ERROR: khong ket noi duoc database')", 'sys.exit(0)'].join('\n'),
  'utf8',
);

const PY = process.platform === 'win32' ? 'python' : 'python3';

const ARM: CliArm = {
  id: 'cli-xuong',
  label: 'Xưởng lệnh',
  actions: [
    {
      id: 'tung_xuc_xac',
      say: 'tung một con xúc xắc',
      description:
        'Tung một con xúc xắc và trả về số chấm. Mất khoảng 10 giây vì máy tung thật. ' +
        'Chỉ đọc — không ghi gì, không đổi gì trên máy. Trả về đúng một con số.',
      run: [PY, '-m', 'xucxac', '--mat', '{mat}', '--cho', '10'],
      params: [{ name: 'mat', type: 'integer', required: true, min: 2, max: 100 }],
      cwd: '{sandbox}',
      timeoutMs: 60_000,
      readOnly: true,
    },
    {
      id: 'dong_bo_du_lieu',
      say: 'đồng bộ dữ liệu',
      description:
        'Đồng bộ dữ liệu từ hệ thống ngoài về máy. ⚠ Ghi đè dữ liệu đang có, không hoàn tác được.',
      run: [PY, '-m', 'dongbo'],
      cwd: '{sandbox}',
      timeoutMs: 30_000,
      failWhen: ['ERROR'],
      readOnly: false,
    },
  ],
};

if (TREO > 0) {
  ARM.actions.push({
    id: 'viec_rat_lau',
    say: 'một việc rất lâu',
    description: `Một việc chạy rất lâu (${TREO} giây). Dùng để đo trần thời gian.`,
    run: [PY, '-m', 'xucxac', '--mat', '6', '--cho', String(TREO)],
    cwd: '{sandbox}',
    // ⚠ CỐ Ý để trần của TA cao hơn hẳn — ca này đo trần của SDK, không đo trần của ta.
    timeoutMs: (TREO + 120) * 1_000,
    readOnly: true,
  });
}

const CHILD_ENV: Record<string, string> = {
  // Tường minh, không kế thừa. `PATH` là thứ duy nhất bắt buộc phải mượn —
  // không có nó thì không tìm được `python` trên bất kỳ OS nào.
  PATH: process.env['PATH'] ?? '',
  ...(process.platform === 'win32' ? { SYSTEMROOT: process.env['SYSTEMROOT'] ?? '' } : {}),
  PYTHONIOENCODING: 'utf-8',
  PYTHONDONTWRITEBYTECODE: '1',
};

// ═══════════════════════════════════════════ 6 · TẢI VĂN PHÒNG + NỐI DÂY

const companyConfig = loadCompanyConfig(companyDir);
const office = loadOffice(companyDir, companyConfig, officeId);
const role = office.roles.get(roleId);
if (!role) throw new Error(`không có vai trò ${roleId} trong văn phòng ${officeId}`);

const tools = buildTools(ARM, { sandbox, env: CHILD_ENV });
const server = createSdkMcpServer({ name: ARM.id, version: '1', tools });

const shellBefore = role.tools;
const mcpBefore = role.mcp;

// ⚠ TẮT SHELL: còn shell thì nhân viên sẽ tự gõ `python` bằng PowerShell và ta
// đo nhầm một thứ khác hẳn. Chỉ đổi trong BỘ NHỚ. (cùng thủ thuật spike-arm-e2e)
(role as { tools: string[] }).tools = [];
(role as { mcp: string[] }).mcp = [ARM.id];
(office.company.mcpServers as Record<string, unknown>)[ARM.id] = server;
(office.company.arms as Record<string, unknown>)[ARM.id] = {
  label: ARM.label,
  secrets: [],
  // `pickMcp` đọc ô này để cấp `mcp__<id>__<tool>` thay vì cả server. Thiếu nó
  // thì cấp cả server — rộng hơn thứ ta định cấp, và im lặng.
  tools: ARM.actions.map((a) => a.id),
  /**
   * 🔴 Ô SINH RA TỪ CHÍNH LƯỢT ĐO TRƯỚC. Thiếu nó, dòng danh bạ của Trợ lý là
   * đúng chữ `Xưởng lệnh` — và 3/3 lượt Trợ lý hoặc bịa kết quả, hoặc viết brief
   * "bằng lệnh shell". → `assistant.ts §armReach` · SPEC-arms §16r
   *
   * Dùng `say` (câu tiếng người) chứ KHÔNG dùng `a.id`: `tung_xuc_xac` là tên
   * máy, và §7b cấm dán tên tool thô vào danh bạ — cấm đúng.
   */
  does: ARM.actions.map((a) => a.say),
};

/** Giá token của cánh tay, đo bằng byte÷4 — cùng phương pháp §5v đã dùng cho Google. */
const defBytes = Buffer.byteLength(
  JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))),
  'utf8',
);

console.log('─── SPIKE CÁNH TAY CLI ───');
console.log(`văn phòng   ${officeId} · vai trò ${roleId} · shell → TẮT (trong bộ nhớ)`);
console.log(`cánh tay    ${ARM.id} "${ARM.label}" · ${ARM.actions.length} việc · type='sdk' (trong tiến trình)`);
console.log(`sandbox     ${sandbox}`);
console.log(`python      ${PY}`);
console.log(`giá ước     ~${Math.round(defBytes / 4)} token/lượt (byte÷4, ${defBytes} byte)\n`);

/**
 * `--roster` — in dòng danh bạ rồi THOÁT. **$0, không một lượt model nào.**
 *
 * Sinh ra sau khi trả tiền một lượt chỉ để đọc một chuỗi mà đằng nào cũng tính
 * được bằng code. Khi một lượt đo hỏng, câu hỏi đầu tiên luôn là *"dữ liệu có
 * tới nơi không, hay tới rồi mà model vẫn quyết khác"* — hai giả thuyết đó cần
 * hai bản vá khác hẳn nhau, và phân biệt chúng phải MIỄN PHÍ.
 */
if (has('roster')) {
  const { armReach } = await import('../src/core/assistant.js');
  console.log(`dòng danh bạ Trợ lý nhận được:\n  "${armReach(office.company.arms, office.company.mcpServers, ARM.id)}"`);
  console.log(`cùng cánh tay nhưng KHÔNG khai does:\n  "${armReach({ [ARM.id]: { label: ARM.label } }, {}, ARM.id)}"`);
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(0);
}

// ══════════════════════════════════ PHẦN 1 · CỔNG TẤT ĐỊNH — $0, không model

interface Gate {
  label: string;
  ok: boolean;
  note: string;
}
const gates: Gate[] = [];
const dice = ARM.actions[0]!;
const sync = ARM.actions[1]!;

async function phase1(): Promise<void> {
  console.log('══ PHẦN 1 · CỔNG TẤT ĐỊNH (gọi thẳng, không qua model) ══\n');

  // ① tham số hợp lệ → argv đúng hình
  try {
    const a = fillArgv(dice, { mat: 6 });
    gates.push({
      label: '① argv dựng đúng, KHÔNG phải chuỗi',
      ok: Array.isArray(a) && a.length === 7 && a[4] === '6',
      note: JSON.stringify(a),
    });
  } catch (e) {
    gates.push({ label: '① argv dựng đúng', ok: false, note: (e as Error).message });
  }

  // ② giá trị mở đầu bằng `-` → TỪ CHỐI
  const dashArm: CliAction = {
    ...dice,
    run: [PY, '-m', 'xucxac', '--nhan', '{nhan}'],
    params: [{ name: 'nhan', type: 'string', required: true }],
  };
  try {
    fillArgv(dashArm, { nhan: '--force' });
    gates.push({ label: '② giá trị "--force" bị chặn', ok: false, note: '🔴 LỌT — nó thành một cờ' });
  } catch (e) {
    gates.push({ label: '② giá trị "--force" bị chặn', ok: true, note: (e as Error).message.slice(0, 70) });
  }

  // ③ TIÊM LỆNH — hai cú pháp, cả hai phải chỉ là chuỗi ký tự
  for (const bad of ['6; calc', '6 && calc']) {
    const injArm: CliAction = {
      ...dice,
      run: [PY, '-c', 'import sys; print("NHAN:" + sys.argv[1])', '{x}'],
      params: [{ name: 'x', type: 'string', required: true }],
      timeoutMs: 15_000,
    };
    const filled = fillArgv(injArm, { x: bad });
    const r = await runCommand({ argv: filled, cwd: sandbox, env: CHILD_ENV, timeoutMs: 15_000 });
    gates.push({
      label: `③ tiêm lệnh "${bad}" chỉ là chuỗi`,
      ok: r.ok && r.stdout.includes(`NHAN:${bad}`),
      note: `${r.stdout.trim().slice(0, 50)} (mã ${r.code})`,
    });
  }

  // ④ binary không tồn tại → cửa `spawn`, KHÔNG phải cửa `exit`
  const r4 = await runCommand({
    argv: ['khong-co-lenh-nay-dau-2608', '--x'],
    cwd: sandbox,
    env: CHILD_ENV,
    timeoutMs: 10_000,
  });
  gates.push({
    label: '④ binary không có → cửa `spawn`',
    ok: r4.door === 'spawn',
    note: `door=${r4.door} code=${r4.code}`,
  });

  // ⑤ TIMEOUT của TA — lệnh ngủ 30s, trần 3s
  const r5 = await runCommand({
    argv: [PY, '-m', 'xucxac', '--cho', '30'],
    cwd: sandbox,
    env: CHILD_ENV,
    timeoutMs: 3_000,
  });
  gates.push({
    label: '⑤ timeout của ta cắt được tiến trình',
    ok: r5.door === 'timeout' && r5.ms < 10_000,
    note: `door=${r5.door} sau ${r5.ms}ms`,
  });

  // ⑥ `exit 0` KÈM LỖI → `fail_when` bắt được
  const r6 = await runCommand({ argv: fillArgv(sync, {}), cwd: sandbox, env: CHILD_ENV, timeoutMs: 20_000 });
  const caught = sync.failWhen!.some((s) => (r6.stdout + r6.stderr).includes(s));
  gates.push({
    label: '⑥ `exit 0` kèm lỗi bị `fail_when` bắt',
    ok: r6.code === 0 && caught,
    note: `mã ${r6.code}, khớp "${sync.failWhen![0]}": ${caught}`,
  });

  // ⑦ cwd TƯỜNG MINH — chạy từ chỗ khác thì `-m xucxac` phải KHÔNG tìm thấy
  const r7 = await runCommand({
    argv: [PY, '-m', 'xucxac', '--cho', '0'],
    cwd: os.tmpdir(),
    env: CHILD_ENV,
    timeoutMs: 15_000,
  });
  gates.push({
    label: '⑦ cwd là thật (đổi cwd ⇒ không thấy module)',
    ok: !r7.ok,
    note: `mã ${r7.code} — nếu ok thì cwd đang bị lờ đi`,
  });

  console.log(gates.map((g) => `  ${g.ok ? '🟢' : '🔴'} ${g.label}\n       ${g.note}`).join('\n'));
  console.log();
}

// ═══════════════════════════════════════ PHẦN 2 · QUA `runWorker` THẬT

async function phase2(): Promise<void> {
  console.log('══ PHẦN 2 · QUA `runWorker` THẬT ══\n');
  const brief = TaskBriefSchema.parse({
    task_id: 'CLI-A',
    role: roleId,
    goal:
      'Tung một con xúc xắc 6 mặt bằng công cụ của kết nối đang có, rồi ghi ra file kết quả ' +
      'đúng một dòng: "Số chấm: <số>". Không tự bịa số.',
    outputs: [{ path: 'artifacts/cli-arm/A.md' }],
    constraints: ['Không dùng lệnh shell', 'Phải dùng công cụ của kết nối để lấy số'],
  });

  const t0 = Date.now();
  const r = await runWorker(
    { office, onProgress: (say) => console.log(`      · ${say}`) },
    { brief, role: role!, hotKnowledge: '', coldKnowledge: '' },
  );
  const out = path.join(office.dir, 'artifacts', 'cli-arm', 'A.md');
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const num = text.match(/Số chấm:\s*([1-6])\b/)?.[1];

  console.log(
    `\n[CLI-A] ${r.status}  ${Date.now() - t0}ms  ${r.usage.turns} lượt  $${r.usage.costUSD.toFixed(5)}` +
      `\n      say: ${r.say}` +
      `\n      file: ${text.trim() || '(trống)'}`,
  );
  gates.push({
    label: '⑧ đầu-cuối qua worker: có số chấm 1..6 trong file',
    ok: !!num,
    note: num ? `số ${num} · ${r.usage.turns} lượt · $${r.usage.costUSD.toFixed(5)}` : 'không thấy số',
  });
  console.log();
}

// ═════════════════════ PHẦN 3 · user → Trợ lý → worker → CLI (`--full`)

async function phase3(): Promise<void> {
  console.log('══ PHẦN 3 · CHUỖI ĐẦY ĐỦ: user → Trợ lý → worker → CLI ══\n');
  const { Office } = await import('../src/core/office.js');
  const live = new Office(loadOffice(companyDir, companyConfig, officeId));

  // Nối lại cánh tay trên BẢN SAO vừa tải — `new Office(...)` đọc lại từ đĩa.
  const r2 = live.loaded.roles.get(roleId)!;
  (r2 as { tools: string[] }).tools = [];
  (r2 as { mcp: string[] }).mcp = [ARM.id];
  (live.loaded.company.mcpServers as Record<string, unknown>)[ARM.id] = server;
  (live.loaded.company.arms as Record<string, unknown>)[ARM.id] = {
    label: ARM.label,
    secrets: [],
    tools: ARM.actions.map((a) => a.id),
  };

  /**
   * 🔴 IN RA DÒNG DANH BẠ TRƯỚC KHI HỎI.
   *
   * Lượt đo sau bản vá `does` vẫn hỏng, và có HAI giả thuyết hoàn toàn khác nhau:
   *   ① dữ liệu không tới được Trợ lý (bản vá chưa chạy trên đường này)
   *   ② dữ liệu tới nơi nhưng Trợ lý vẫn chọn tự trả lời (bài toán ĐỊNH TUYẾN)
   * Hai giả thuyết đó cần hai bản vá khác hẳn nhau, nên đoán là tốn cả một vòng.
   * In nó ra là xong — [[agentco-measurement-vs-conclusion]].
   */
  const { armReach } = await import('../src/core/assistant.js');
  console.log(
    `  📋 dòng danh bạ Trợ lý nhận được:\n     "${armReach(
      live.loaded.company.arms,
      live.loaded.company.mcpServers,
      ARM.id,
    )}"\n`,
  );

  live.bindBus((e) => {
    if (e.type === 'master.message') console.log(`  [${e.role}] ${e.say}`);
    else if (e.type === 'task.progress') console.log(`      · [${e.role}] ${e.say}`);
    else if (e.type === 'task.done') console.log(`      ✔ [${e.role}] ${e.status} — ${e.say}`);
    else if (e.type === 'task.blocked') console.log(`      ⏸ [${e.role}] ${e.reason} — ${e.say}`);
  });

  const before = calls.length;
  const t0 = Date.now();
  const hoi = flag('hoi') ?? 'Tung giúp mình một con xúc xắc 6 mặt rồi cho mình biết ra mấy chấm nhé.';
  const outcome = await live.say(hoi);
  console.log(`  → định tuyến: ${outcome.intent}`);

  /**
   * Chờ về `idle`. Trần 6 phút: lệnh ngủ 10 s + lập kế hoạch + một lượt worker.
   *
   * ⚠ `say()` trả về NGAY (nó chỉ bỏ tin vào hòm thư, `pump()` chạy bằng `void`),
   * nên `idle` ở lượt kiểm ĐẦU TIÊN là `idle` của lúc CHƯA bắt đầu — không phải
   * lúc đã xong. Phải thấy nó rời `idle` trước đã, rồi mới tin lần về `idle` sau.
   * Đúng lớp lỗi §3a: thứ đo được không phải trạng thái, là THỜI ĐIỂM HỎI.
   */
  /**
   * ⚠⚠ ĐỪNG TIN `outcome.intent` ĐỂ ĐIỀU KHIỂN LUỒNG. (bắt được 30/08)
   *
   * Lượt đo thứ hai trả `intent: "chat"` **rồi vẫn lập kế hoạch và chạy worker**.
   * Bản trước `break` ngay khi thấy `chat` ⇒ script in kết luận sau **121 ms**,
   * `finally` **xoá sandbox**, và worker chạy tiếp trong nền vào một thư mục vừa
   * bị xoá. Kết quả: một cổng 🔴 nói về một chuyện **không có thật**, và một câu
   * lỗi *"máy thiếu python"* trong khi máy có đủ python.
   *
   * ⇒ Chờ theo THỨ QUAN SÁT ĐƯỢC, không theo lời khai: cho nó tối đa 45 giây để
   * rời `idle`. Không rời ⇒ đúng là chat thật, dừng. Rời rồi ⇒ chờ nó quay về.
   */
  const deadline = Date.now() + 360_000;
  const startBy = Date.now() + 45_000;
  let started = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_500));
    if (live.currentState !== 'idle') started = true;
    else if (started) break;
    else if (Date.now() > startBy) break; // không bao giờ khởi động ⇒ chat thật
  }
  const made = calls.length - before;
  console.log(`\n  trạng thái cuối: ${live.currentState} sau ${Date.now() - t0}ms · CLI được gọi ${made} lần`);
  gates.push({
    label: '⑨ chuỗi đầy đủ CÓ GỌI CLI thật',
    ok: made > 0,
    note:
      `định tuyến "${outcome.intent}" · ${made} lời gọi · ${Math.round((Date.now() - t0) / 1000)}s` +
      (made === 0 ? ' — 🔴 KHÔNG lệnh nào chạy' : ''),
  });
  console.log();
}

// ══════════════════════════════════════════════════════════════ CHẠY

try {
  if (wants('1')) await phase1();
  if (wants('2') && !ONLY?.startsWith('1')) await phase2();
  if (has('full')) await phase3();
} catch (e) {
  console.log(`\n💥 NÉM LỖI: ${(e as Error).message}\n${(e as Error).stack ?? ''}`);
} finally {
  (role as { tools: string[] }).tools = shellBefore as string[];
  (role as { mcp: string[] }).mcp = mcpBefore as string[];
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(path.join(office.dir, 'artifacts', 'cli-arm'), { recursive: true, force: true });
  console.log('↩ đã xoá sandbox · xoá artifacts/cli-arm · trả nguyên role (chỉ đổi trong bộ nhớ)');
}

console.log('\n─── KẾT LUẬN ───');
for (const g of gates) console.log(`${g.ok ? '🟢' : '🔴'} ${g.label.padEnd(46)} ${g.note}`);

const bad = gates.filter((g) => !g.ok);
console.log(
  `\n${bad.length === 0 ? '✅ TẤT CẢ ĐẠT' : `🔴 ${bad.length}/${gates.length} KHÔNG ĐẠT`}` +
    `\n\n⚠ RANH GIỚI CỦA PHÉP ĐO NÀY:` +
    `\n  · Cổng ①–⑦ chứng minh một CƠ CHẾ, gọi trực tiếp — chúng KHÔNG chứng minh` +
    `\n    cơ chế đó có mặt trên đường mà một task thật đi. Ô ⑧ mới nói chuyện đó.` +
    `\n  · Ô ⑧/⑨ xanh MỘT lượt không chứng minh ổn định: định tuyến của Trợ lý có` +
    `\n    phương sai cao (đã ghi §15f-bis). Chạy 3 lượt trước khi tin.` +
    `\n  · Giá ~${Math.round(defBytes / 4)} token/lượt là byte÷4, KHÔNG phải số của` +
    `\n    getContextUsage(). Đừng trộn hai nguồn — chúng lệch 27% (§9b ③).`,
);
