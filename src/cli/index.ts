#!/usr/bin/env node
/**
 * CLI. → docs/SPEC-cli.md §2
 *
 * Nguyên tắc thông báo lỗi: mỗi lỗi in CHUYỆN GÌ XẢY RA + LÀM GÌ TIẾP THEO,
 * một câu mỗi phần. Khách hàng là người non-code — stack trace giấu mặc định.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Company } from '../core/company.js';
import { ensureDirs, isCompanyDir, paths, resolveCompanyDir } from '../core/paths.js';
import { serve } from '../server/server.js';
import { clearDaemonFile, liveDaemon, openBrowser, writeDaemonFile } from './daemonfile.js';

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

function cmdInit(): void {
  if (isCompanyDir(companyDir)) {
    console.log(`Đã có công ty ở ${companyDir}. Không ghi đè.`);
    return;
  }
  const template = path.resolve(here(), '../../templates/company');
  if (!fs.existsSync(template)) throw new Error(`Không tìm thấy thư mục mẫu: ${template}`);

  fs.cpSync(template, companyDir, { recursive: true });
  ensureDirs(paths(companyDir));

  console.log(`Đã tạo công ty ở ${companyDir}\n`);
  console.log('  company.yaml       cấu hình — trần chi phí nằm ở đây');
  console.log('  roles/             nhân viên — thêm file .yaml là có nhân viên mới');
  console.log('  skills/            hướng dẫn làm việc cho từng nhân viên');
  console.log('  knowledge/shared/  kinh nghiệm chung, cả công ty đọc');
  console.log('\nBước tiếp theo:  agentco start');
}

async function cmdStart(): Promise<void> {
  const pp = paths(companyDir);

  // IDEMPOTENT: đã chạy rồi thì mở trình duyệt vào nó, không báo lỗi port.
  const existing = await liveDaemon(pp);
  if (existing) {
    console.log(`Công ty đang chạy sẵn ở ${existing.url} (pid ${existing.pid})`);
    openBrowser(existing.url);
    return;
  }

  const company = Company.open(companyDir);
  const port = typeof flags['port'] === 'number' ? flags['port'] : company.loaded.config.runtime.port;
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

  console.log(`${company.loaded.config.name} đang chạy`);
  console.log(`  ${daemon.url}`);
  console.log(`  ${company.loaded.roles.size} nhân viên · ${company.knowledge.size} ghi chú`);
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
  const pp = paths(companyDir);
  const info = await liveDaemon(pp);
  if (!info) {
    console.log('Công ty không chạy.');
    return;
  }
  await fetch(`${info.url}/api/shutdown`, { method: 'POST' }).catch(() => {});
  console.log(`Đã gửi yêu cầu tắt tới pid ${info.pid}.`);
}

async function cmdStatus(): Promise<void> {
  const pp = paths(companyDir);
  const info = await liveDaemon(pp);
  if (!info) {
    console.log(`Công ty không chạy.\nBật bằng:  agentco start`);
    process.exit(EXIT.noDaemon);
  }
  const state = (await (await fetch(`${info.url}/api/state`)).json()) as {
    name: string;
    state: string;
    knowledge: number;
    pending: number;
    roles: unknown[];
  };
  console.log(`${state.name}  ·  ${state.state}`);
  console.log(`  ${info.url}  (pid ${info.pid})`);
  console.log(`  ${state.roles.length} nhân viên · ${state.knowledge} ghi chú · ${state.pending} việc đang chờ`);
}

async function cmdRun(): Promise<void> {
  const request = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!request) {
    console.error('Thiếu nội dung công việc.\nVí dụ:  agentco run "viết 3 bài giới thiệu sản phẩm X"');
    process.exit(EXIT.config);
  }

  // Có daemon thì giao qua daemon — để dùng chung warmSet và session master.
  const info = await liveDaemon(paths(companyDir));
  if (info) {
    await fetch(`${info.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    console.log(`Đã giao việc. Theo dõi ở ${info.url}`);
    return;
  }

  // Không có daemon thì chạy một lần ngay tại đây.
  const company = Company.open(companyDir);
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

  const out = await company.run(request);
  console.log(`\n${out.report}\n`);
  console.log(company.costText());
  if (out.receipts.some((r) => r.status === 'failed')) process.exit(EXIT.taskFail);
}

function cmdCost(): void {
  const company = Company.open(companyDir);
  const since = typeof flags['since'] === 'string' ? parseDuration(flags['since']) : undefined;
  console.log(company.costText(since));

  const keys = company.cacheKeys();
  if (keys.length) {
    console.log('\nPrefix cache theo vai trò:');
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

  // Xác thực: gọi thật một lần cực rẻ. Đây là lỗi hay gặp nhất của người mới.
  let authOk = false;
  let authNote = '';
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const m of query({
      prompt: 'Reply with the single word: ok',
      options: { model: 'haiku', maxTurns: 1, persistSession: false, settingSources: [], allowedTools: [], systemPrompt: 'Reply with one word.' },
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

  const info = await liveDaemon(paths(companyDir));
  checks.push(['Daemon', !!info, info ? `${info.url} (pid ${info.pid})` : 'không chạy — `agentco start`']);

  for (const [name, ok, note] of checks) {
    console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(24)} ${note}`);
  }
  if (!authOk) process.exit(EXIT.auth);
}

function cmdHelp(): void {
  console.log(`agentco — một công ty ảo chạy trên máy bạn

  agentco init                Tạo công ty mới trong ./company
  agentco start               Bật công ty + mở giao diện  (chạy lại là mở lại tab)
  agentco stop                Tắt hẳn daemon
  agentco status              Xem công ty có đang chạy không
  agentco run "<việc>"        Giao một việc
  agentco cost [--since 7d]   Xem đã tốn bao nhiêu
  agentco doctor              Kiểm tra máy đã sẵn sàng chưa

Tuỳ chọn:  --dir <path>  --port <n>  --host <ip>  --no-ui

Đóng tab trình duyệt KHÔNG tắt công ty. Muốn tắt hẳn: nút "Tắt hẳn" hoặc \`agentco stop\`.`);
}

// ─────────────────────────────────────────────────────────── helpers

function here(): string {
  return path.dirname(fileURLToPath(import.meta.url));
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
