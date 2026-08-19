#!/usr/bin/env node
/**
 * CLI. → docs/SPEC-cli.md §2, docs/SPEC-offices.md
 *
 * Nguyên tắc thông báo lỗi: mỗi lỗi in CHUYỆN GÌ XẢY RA + LÀM GÌ TIẾP THEO,
 * một câu mỗi phần. Khách hàng là người non-code — stack trace giấu mặc định.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Company } from '../core/company.js';
import { companyPaths, ensureCompanyDirs, isCompanyDir, resolveCompanyDir } from '../core/paths.js';
import { serve } from '../server/server.js';
import { webBuildStale } from '../server/static.js';
import { clearDaemonFile, liveDaemon, openBrowser, writeDaemonFile } from './daemonfile.js';
import { formatRunUsage } from '../core/usage.js';
import { readSecrets, secretNames, writeSecrets } from '../core/secrets.js';

const EXIT = { ok: 0, general: 1, config: 2, noDaemon: 3, auth: 4, taskFail: 5, budget: 6, rateLimit: 7 };

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flags = parseFlags(argv.slice(1));
const companyDir = resolveCompanyDir(typeof flags['dir'] === 'string' ? flags['dir'] : undefined);

try {
  await main();
} catch (err) {
  fail(err);
}

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      return cmdInit();
    case 'start':
      return cmdStart();
    case 'stop':
      return cmdStop();
    case 'status':
      return cmdStatus();
    case 'office':
      return cmdOffice();
    case 'secret':
      return cmdSecret();
    case 'run':
      return cmdRun();
    case 'cost':
      return cmdCost();
    case 'doctor':
      return cmdDoctor();
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
    default:
      console.error(`Không có lệnh "${command}".\nChạy \`agentco help\` để xem danh sách.`);
      process.exit(EXIT.config);
  }
}

// ─────────────────────────────────────────────────────────── lệnh

/**
 * Tạo công ty RỖNG. Không văn phòng mẫu, không nhân viên mẫu.
 * → SPEC-offices.md §3
 */
function cmdInit(): void {
  if (isCompanyDir(companyDir)) {
    console.log(`Đã có công ty ở ${companyDir}. Không ghi đè.`);
    return;
  }
  const pp = companyPaths(companyDir);
  ensureCompanyDirs(pp);
  fs.writeFileSync(pp.configFile, companyTemplate(), 'utf8');

  console.log(`Đã tạo công ty ở ${companyDir}\n`);
  console.log('  company.yaml   cấu hình chung — trần chi phí và model nằm ở đây');
  console.log('  offices/       mỗi văn phòng một thư mục, tự chứa đầy đủ\n');
  console.log('Công ty đang RỖNG — chưa có văn phòng nào. Đó là bình thường.');
  console.log('Bước tiếp theo:  agentco start   rồi bấm "Tạo văn phòng"');
}

async function cmdStart(): Promise<void> {
  const pp = companyPaths(companyDir);

  // IDEMPOTENT: đã chạy rồi thì mở trình duyệt vào nó, không báo lỗi port.
  const existing = await liveDaemon(pp);
  if (existing) {
    console.log(`Công ty đang chạy sẵn ở ${existing.url} (pid ${existing.pid})`);
    openBrowser(existing.url);
    return;
  }

  const company = Company.open(companyDir);
  const port = typeof flags['port'] === 'number' ? flags['port'] : company.config.runtime.port;
  const host = typeof flags['host'] === 'string' ? flags['host'] : '127.0.0.1';
  const token = process.env['AGENTCO_TOKEN'];

  const daemon = await serve({
    company,
    port,
    host,
    ...(token ? { token } : {}),
    onShutdown: () => {
      console.log('\nĐã tắt theo yêu cầu từ giao diện.');
      clearDaemonFile(pp);
      process.exit(EXIT.ok);
    },
  });

  writeDaemonFile(pp, {
    pid: process.pid,
    port: daemon.port,
    url: daemon.url,
    version: '0.0.1',
    started_at: new Date().toISOString(),
  });

  const offices = company.list();
  console.log(`${company.config.name} đang chạy`);
  console.log(`  ${daemon.url}`);
  if (offices.length === 0) {
    console.log('  chưa có văn phòng nào — mở giao diện rồi bấm "Tạo văn phòng"');
  } else {
    for (const o of offices) {
      console.log(`  ${o.name.padEnd(20)} ${o.agents} nhân viên · ${o.knowledge} ghi chú${o.error ? '  ⚠ ' + o.error : ''}`);
    }
  }
  if (webBuildStale()) {
    console.log('\n⚠ Giao diện đang phục vụ bản build CŨ — web/src có thay đổi chưa build.');
    console.log('  npm run build:web    build lại một lần');
    console.log('  npm run dev:web      sửa giao diện có hot-reload');
  }

  console.log(`\nCtrl+C để tắt. Đóng tab trình duyệt KHÔNG tắt công ty.`);

  if (!flags['no-ui']) openBrowser(daemon.url);

  const shutdown = async (): Promise<void> => {
    console.log('\nĐang đóng...');
    clearDaemonFile(pp);
    await daemon.close();
    process.exit(EXIT.ok);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function cmdStop(): Promise<void> {
  const info = await liveDaemon(companyPaths(companyDir));
  if (!info) {
    console.log('Công ty không chạy.');
    return;
  }
  await fetch(`${info.url}/api/shutdown`, { method: 'POST' }).catch(() => {});
  console.log(`Đã gửi yêu cầu tắt tới pid ${info.pid}.`);
}

/**
 * Hỏi daemon. Daemon có thể đang chạy BẢN CŨ sau khi ta nâng cấp code — lúc đó
 * nó trả 404 hoặc một hình dạng khác hẳn. Tin tưởng hình dạng phản hồi là cách
 * chắc chắn nhất để người dùng nhận một stack trace thay vì một câu tiếng Việt.
 */
async function askDaemon<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof body['error'] === 'string'
        ? body['error']
        : `Daemon trả về lỗi ${res.status}. Nếu bạn vừa nâng cấp agentco, chạy \`agentco stop\` rồi \`agentco start\` lại.`,
    );
  }
  return body as T;
}

interface CompanyView {
  name: string;
  offices: Array<{ id: string; name: string; state: string; agents: number; knowledge: number; error?: string }>;
}

async function fetchCompany(url: string): Promise<CompanyView> {
  const c = await askDaemon<Partial<CompanyView>>(`${url}/api/company`);
  if (!Array.isArray(c.offices)) {
    throw new Error(
      'Daemon đang chạy một phiên bản khác với CLI này.\nChạy:  agentco stop   rồi   agentco start',
    );
  }
  return { name: c.name ?? 'Công ty', offices: c.offices };
}

async function cmdStatus(): Promise<void> {
  const info = await liveDaemon(companyPaths(companyDir));
  if (!info) {
    console.log(`Công ty không chạy.\nBật bằng:  agentco start`);
    process.exit(EXIT.noDaemon);
  }
  const c = await fetchCompany(info.url);
  console.log(`${c.name}`);
  console.log(`  ${info.url}  (pid ${info.pid})`);
  if (c.offices.length === 0) {
    console.log('  chưa có văn phòng nào');
    return;
  }
  for (const o of c.offices) {
    console.log(
      `  ${o.name.padEnd(20)} ${o.state.padEnd(8)} ${o.agents} nhân viên · ${o.knowledge} ghi chú` +
        (o.error ? `  ⚠ ${o.error}` : ''),
    );
  }
}

/** `agentco office` · `office new "Tên"` · `office rm <id>` */
async function cmdOffice(): Promise<void> {
  const sub = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'list';
  const info = await liveDaemon(companyPaths(companyDir));

  if (sub === 'list') {
    if (!info) {
      const company = Company.open(companyDir);
      const offices = company.list();
      if (offices.length === 0) console.log('Chưa có văn phòng nào.');
      for (const o of offices) console.log(`  ${o.id.padEnd(24)} ${o.name}`);
      return;
    }
    const c = await fetchCompany(info.url);
    if (c.offices.length === 0) console.log('Chưa có văn phòng nào.');
    for (const o of c.offices) console.log(`  ${o.id.padEnd(24)} ${o.name}`);
    return;
  }

  if (sub === 'new') {
    const name = argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!name) {
      console.error('Thiếu tên văn phòng.\nVí dụ:  agentco office new "Nội dung"');
      process.exit(EXIT.config);
    }
    // Qua daemon nếu nó đang chạy — nếu không thì hai tiến trình cùng ghi một chỗ.
    if (info) {
      const body = await askDaemon<{ id?: string }>(`${info.url}/api/office`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      console.log(`Đã tạo văn phòng "${name}" (${body.id}).`);
      return;
    }
    const office = Company.open(companyDir).createOffice({ name });
    console.log(`Đã tạo văn phòng "${name}" (${office.id}).`);
    return;
  }

  /**
   * `office archive <id>` / `office restore <id>` — soft delete.
   * → docs/SPEC-offices.md §3.1
   *
   * Đây là mức người dùng nên dùng: chỉ gắn một cờ, file không đi đâu cả, và
   * văn phòng vẫn giữ TÊN trong sổ chi phí. Xoá hẳn thì những dòng tiền của nó
   * chỉ còn cái mã trần để lần ra.
   */
  if (sub === 'archive' || sub === 'restore') {
    const id = argv[2];
    if (!id) {
      console.error(`Thiếu mã văn phòng.\nVí dụ:  agentco office ${sub} noi-dung`);
      process.exit(EXIT.config);
    }
    const archived = sub === 'archive';
    if (info) {
      await askDaemon(`${info.url}/api/office/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
    } else {
      Company.open(companyDir).archiveOffice(id, archived);
    }
    console.log(
      archived
        ? `Đã cất văn phòng "${id}" vào lưu trữ. Khôi phục: agentco office restore ${id}`
        : `Đã khôi phục văn phòng "${id}".`,
    );
    return;
  }

  if (sub === 'rm') {
    const id = argv[2];
    if (!id) {
      console.error('Thiếu mã văn phòng.\nVí dụ:  agentco office rm noi-dung');
      process.exit(EXIT.config);
    }
    // `rm` giờ chỉ còn MỘT nghĩa: xoá hẳn, không lấy lại được. Muốn cất đi thì
    // dùng `archive`. Cờ `--delete-files` từng là cách phân biệt hai ý định đó,
    // và đó là chỗ sai: cái cờ dễ quên nhất lại là cái quyết định mất hay không.
    if (flags['yes'] !== true) {
      console.error(
        `Xoá hẳn văn phòng "${id}": mất toàn bộ nhân viên, kỹ năng, kho tri thức và kết quả.\n` +
          `Không lấy lại được.\n\n` +
          `  Muốn cất đi rồi lấy lại sau:  agentco office archive ${id}\n` +
          `  Chắc chắn xoá hẳn:            agentco office rm ${id} --yes`,
      );
      process.exit(EXIT.config);
    }
    if (info) {
      await askDaemon(`${info.url}/api/office/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else {
      Company.open(companyDir).removeOffice(id);
    }
    console.log(`Đã xoá hẳn văn phòng "${id}" và toàn bộ file.`);
    return;
  }

  console.error(
    `Không có lệnh "office ${sub}".\n` +
      `Dùng: office list | office new "Tên" | office archive <id> | office restore <id> | office rm <id> --yes`,
  );
  process.exit(EXIT.config);
}

/**
 * `agentco secret list | set <TÊN> | rm <TÊN>` → docs/SPEC-offices.md §5
 *
 * CỐ Ý chỉ có ở CLI, không có API. Bí mật không đi qua HTTP, kể cả HTTP tới
 * localhost — một endpoint đọc được chúng là một endpoint bị lừa gọi được.
 *
 * `set` đọc giá trị từ stdin hoặc biến môi trường, KHÔNG nhận từ tham số dòng
 * lệnh: tham số nằm trong lịch sử shell và trong danh sách tiến trình.
 */
function cmdSecret(): void {
  const pp = companyPaths(companyDir);
  const sub = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'list';

  if (sub === 'list') {
    const names = secretNames(pp);
    if (names.length === 0) {
      console.log('Chưa có bí mật nào.\nThêm bằng:  $env:VALUE="..."; agentco secret set TÊN_KHOÁ');
      return;
    }
    console.log('Bí mật đã lưu (chỉ hiện TÊN):');
    for (const n of names) console.log(`  ${n}`);
    console.log('\nCấp cho nhân viên bằng cách thêm vào roles/<id>.yaml:  secrets: [TÊN_KHOÁ]');
    return;
  }

  const name = argv[2];
  if (!name || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) {
    console.error(
      'Tên bí mật phải VIẾT HOA, chỉ chữ/số/gạch dưới.\nVí dụ:  agentco secret set NOTION_TOKEN',
    );
    process.exit(EXIT.config);
  }

  const all = readSecrets(pp);

  if (sub === 'rm') {
    if (!(name in all)) {
      console.log(`Không có bí mật "${name}".`);
      return;
    }
    delete all[name];
    writeSecrets(pp, all);
    console.log(`Đã xoá "${name}". Nhân viên nào đang khai nó sẽ báo thiếu chìa ở lần chạy tới.`);
    return;
  }

  if (sub === 'set') {
    const value = process.env['VALUE'];
    if (!value) {
      console.error(
        'Thiếu giá trị. Đặt qua biến môi trường VALUE để nó không lọt vào lịch sử shell:\n' +
          `  PowerShell:  $env:VALUE="dán-khoá-vào-đây"; agentco secret set ${name}\n` +
          `  bash:        VALUE='dán-khoá-vào-đây' agentco secret set ${name}`,
      );
      process.exit(EXIT.config);
    }
    all[name] = value;
    writeSecrets(pp, all);
    console.log(`Đã lưu "${name}" vào .state/secrets.json (không commit, không đi qua HTTP).`);
    return;
  }

  console.error(`Không có lệnh "secret ${sub}".\nDùng: secret list | secret set <TÊN> | secret rm <TÊN>`);
  process.exit(EXIT.config);
}

async function cmdRun(): Promise<void> {
  const request = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!request) {
    console.error('Thiếu nội dung công việc.\nVí dụ:  agentco run "viết 3 bài giới thiệu sản phẩm X" --office noi-dung');
    process.exit(EXIT.config);
  }

  const info = await liveDaemon(companyPaths(companyDir));
  const wanted = typeof flags['office'] === 'string' ? flags['office'] : undefined;

  // Có daemon thì giao qua daemon — để dùng chung warmSet và session Trợ lý.
  if (info) {
    const c = await fetchCompany(info.url);
    const officeId = pickOffice(c.offices, wanted);
    await fetch(`${info.url}/api/office/${encodeURIComponent(officeId)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    console.log(`Đã giao việc cho "${officeId}". Theo dõi ở ${info.url}`);
    return;
  }

  // Không có daemon thì chạy một lần ngay tại đây.
  const company = Company.open(companyDir);
  const officeId = pickOffice(company.list(), wanted);
  const office = company.get(officeId);
  company.on((e) => {
    if (e.type === 'plan.created') {
      console.log(`\nKế hoạch:`);
      e.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
      console.log('');
    }
    if (e.type === 'task.started') console.log(`  ▶ ${e.say}`);
    if (e.type === 'task.done') console.log(`  ✓ ${e.say}`);
    if (e.type === 'task.blocked') console.log(`  ⚠ ${e.say}`);
  });

  const out = await office.run(request);
  console.log(`\n${out.report}\n`);
  // Chi phí của ĐÚNG ca này. `agentco cost` mới là tích luỹ — trộn hai thứ
  // vào nhau làm người dùng tưởng một việc nhỏ tốn cả trăm nghìn token.
  console.log(formatRunUsage(out.usage, out.usage.turns > 0 ? 1 : 0));
}

function pickOffice(offices: Array<{ id: string; name: string }>, wanted?: string): string {
  if (offices.length === 0) {
    throw new Error('Chưa có văn phòng nào.\nTạo bằng:  agentco office new "Tên văn phòng"');
  }
  if (wanted) {
    const found = offices.find((o) => o.id === wanted);
    if (!found) {
      throw new Error(
        `Không có văn phòng "${wanted}".\nĐang có: ${offices.map((o) => o.id).join(', ')}`,
      );
    }
    return found.id;
  }
  if (offices.length > 1) {
    throw new Error(
      `Có ${offices.length} văn phòng, cần nói rõ giao cho ai.\n` +
        `Thêm:  --office <mã>\nĐang có: ${offices.map((o) => o.id).join(', ')}`,
    );
  }
  return offices[0]!.id;
}

function cmdCost(): void {
  const company = Company.open(companyDir);
  const since = typeof flags['since'] === 'string' ? parseDuration(flags['since']) : undefined;
  const officeId = typeof flags['office'] === 'string' ? flags['office'] : undefined;

  console.log(company.costText(since, officeId));

  const byOffice = company.costByOffice(since);
  if (byOffice.length > 1) {
    console.log('\nTheo văn phòng:');
    for (const o of byOffice) {
      console.log(
        `  ${o.name.padEnd(20)} ${String(o.tasks).padStart(4)} việc · ${String(o.turns).padStart(5)} lượt · $${o.costUSD.toFixed(4)}`,
      );
    }
  }

  for (const o of company.list()) {
    if (o.error) continue;
    const keys = company.get(o.id).cacheKeys();
    if (!keys.length) continue;
    console.log(`\nPrefix cache — ${o.name}:`);
    for (const k of keys) {
      console.log(`  ${k.role.padEnd(14)} ${k.key}  ~${k.staticTokens} token tĩnh`);
    }
  }
}

async function cmdDoctor(): Promise<void> {
  const checks: Array<[string, boolean, string]> = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push(['Node ≥ 22', major >= 22, `đang dùng ${process.versions.node}`]);
  checks.push(['Thư mục công ty', isCompanyDir(companyDir), companyDir]);

  let writable = false;
  try {
    fs.accessSync(companyDir, fs.constants.W_OK);
    writable = true;
  } catch {
    /* không ghi được */
  }
  checks.push(['Quyền ghi', writable, companyDir]);

  if (isCompanyDir(companyDir)) {
    try {
      const company = Company.open(companyDir);
      const offices = company.list();
      const broken = offices.filter((o) => o.error);
      checks.push([
        'Văn phòng',
        broken.length === 0,
        offices.length === 0
          ? 'chưa có văn phòng nào — tạo trong giao diện'
          : broken.length
            ? `${broken.length}/${offices.length} lỗi: ${broken.map((o) => o.id).join(', ')}`
            : `${offices.length} văn phòng, đều nạp được`,
      ]);
    } catch (err) {
      checks.push(['Văn phòng', false, err instanceof Error ? err.message.slice(0, 90) : 'lỗi không rõ']);
    }
  }

  // Xác thực: gọi thật một lần cực rẻ. Đây là lỗi hay gặp nhất của người mới.
  let authOk = false;
  let authNote = '';
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const m of query({
      prompt: 'Reply with the single word: ok',
      options: {
        model: 'haiku',
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        allowedTools: [],
        systemPrompt: 'Reply with one word.',
      },
    })) {
      const msg = m as Record<string, unknown>;
      if (msg['type'] === 'result') {
        authOk = msg['subtype'] === 'success';
        authNote = authOk ? 'gọi thử thành công' : String(msg['subtype']);
      }
    }
  } catch (err) {
    authNote = err instanceof Error ? err.message.slice(0, 90) : 'lỗi không rõ';
  }
  checks.push(['Đăng nhập Claude Code', authOk, authNote || 'chạy `claude` một lần để đăng nhập']);

  const info = await liveDaemon(companyPaths(companyDir));
  checks.push(['Daemon', !!info, info ? `${info.url} (pid ${info.pid})` : 'không chạy — `agentco start`']);

  for (const [name, ok, note] of checks) {
    console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(24)} ${note}`);
  }
  if (!authOk) process.exit(EXIT.auth);
}

function cmdHelp(): void {
  console.log(`agentco — một công ty ảo chạy trên máy bạn

  agentco init                   Tạo công ty mới (RỖNG) trong ./company
  agentco start                  Bật công ty + mở giao diện  (chạy lại là mở lại tab)
  agentco stop                   Tắt hẳn daemon
  agentco status                 Xem công ty và các văn phòng

  agentco office list            Liệt kê văn phòng
  agentco office new "Tên"       Tạo văn phòng mới (kèm Trợ lý, chưa có nhân viên)
  agentco office rm <mã>         Đóng văn phòng  (thêm --delete-files để xoá hẳn)

  agentco secret list            Xem TÊN các chìa khoá đã lưu (không hiện giá trị)
  agentco secret set <TÊN>       Lưu một chìa  (giá trị qua biến môi trường VALUE)
  agentco secret rm <TÊN>        Xoá một chìa

  agentco run "<việc>"           Giao một việc  (--office <mã> khi có nhiều văn phòng)
  agentco cost [--since 7d]      Xem đã tốn bao nhiêu  (--office <mã> để lọc)
  agentco doctor                 Kiểm tra máy đã sẵn sàng chưa

Tuỳ chọn chung:  --dir <path>  --port <n>  --host <ip>  --no-ui

Đóng tab trình duyệt KHÔNG tắt công ty. Muốn tắt hẳn: nút "Tắt hẳn" hoặc \`agentco stop\`.`);
}

// ─────────────────────────────────────────────────────────── helpers

/**
 * HÀM chứ không phải const: `await main()` chạy ở top-level, tức là TRƯỚC khi
 * các `const` phía dưới trong module này được khởi tạo. Một hằng chuỗi ở cuối
 * file sẽ ném "Cannot access before initialization" — khai báo hàm thì được hoist.
 */
function companyTemplate(): string {
  return `# Cấu hình CÔNG TY. Mọi thứ dính tới tiền nằm ở đây.
# Người, tri thức, sơ đồ thì thuộc về từng văn phòng: offices/<mã>/
name: "Công ty của tôi"

runtime:
  port: 7317
  # Số nhân viên chạy song song cùng lúc, tính trên toàn công ty.
  concurrency: 4

budgets:
  # TRẦN CỨNG. Đây là thứ giữ cho chi phí không âm thầm phình lên.
  # Nới lên thì tốn tiền hơn, không phải "chạy tốt hơn".
  # Đọc docs/SPEC-token-economy.md trước khi đổi.
  receipt_tokens: 800
  knowledge_node_tokens: 250
  charter_tokens: 500
  # Skills của Trợ lý nằm trong prefix của MỌI lượt trò chuyện -> trần chặt hơn.
  assistant_skills_tokens: 400
  cold_knowledge_tokens: 3000

models:
  eco: claude-haiku-4-5-20251001
  standard: claude-sonnet-5
  deep: claude-opus-5
  # Tier của Trợ lý. PHẢI CỐ ĐỊNH suốt ca — đổi giữa chừng là mất cả ngữ cảnh.
  master: standard
  # Lập kế hoạch chạy ở query riêng, nên đặt 'deep' ở đây KHÔNG phá cache Trợ lý.
  planner: standard

# MCP server tự cắm thêm. Khai ở đây một lần, rồi kéo dây trên sơ đồ của từng
# văn phòng để quyết định ai được dùng.
# mcpServers:
#   notion:
#     command: npx
#     args: ["-y", "@notionhq/notion-mcp-server"]
mcpServers: {}

# Lớp prompt lõi luôn XEM ĐƯỢC trong giao diện. Bật cái này mới SỬA được nó.
# Nó thuộc về mã nguồn, không thuộc về việc vận hành doanh nghiệp — sửa sai là
# phá kiến trúc chi phí. Chỉ bật nếu bạn biết mình đang làm gì.
allow_core_prompt_edit: false
`;
}

function parseFlags(args: string[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      const n = Number(next);
      out[key] = Number.isFinite(n) && next.trim() !== '' ? n : next;
      i++;
    }
  }
  return out;
}

function parseDuration(s: string): number | undefined {
  const m = /^(\d+)([hdm])$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3_600_000 : m[2] === 'd' ? n * 86_400_000 : n * 60_000;
}

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${msg}\n`);
  if (flags['verbose'] && err instanceof Error && err.stack) console.error(err.stack);
  const kind = (err as { kind?: string }).kind;
  process.exit(
    kind === 'auth' ? EXIT.auth : kind === 'budget' ? EXIT.budget : kind === 'rate_limit' ? EXIT.rateLimit : EXIT.general,
  );
}
