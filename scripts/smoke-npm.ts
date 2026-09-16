/**
 * The npm door, walked the way a stranger walks it. → docs/SPEC-cli.md §6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THIS RUNS BEFORE THE FIRST `npm publish`, AND THAT ORDER IS THE POINT. │
 * │                                                                          │
 * │ A version number on npm is spent the moment it is published: unpublish  │
 * │ it and the number still cannot be reused. So "try it on Linux after it   │
 * │ is out" means the first time 0.1.1 ever ran on Linux or macOS is the     │
 * │ moment it was public, and a failure there costs a version. `npm pack`    │
 * │ produces the exact tarball `npm publish` would upload (both run          │
 * │ `prepack`), so nothing about the test needs the package to exist.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * What it proves, in order: the tarball carries no orphaned build output ·
 * `npm i -g` into an isolated prefix · `doctor` finds the Claude Code binary
 * THIS package brought (not one already on the machine) · `init` · `start` →
 * `/healthz` reports the packed version · `status` answers in the language
 * company.yaml names · `stop` → the port is closed · on Linux, `shortcut`
 * writes a file `desktop-file-validate` accepts, and launching that file the
 * way a desktop does starts the company.
 *
 * ⚠ NO SHELL, except the one place Windows forces it: an npm bin is a `.cmd`
 * shim there, and `spawn` with `shell:false` cannot run a `.cmd`. npm itself is
 * called as `node <npm-cli.js>`, which is why this must run under `npm run`.
 * → [[agentco-three-os-always]]
 *
 * ⚠ Nothing global is touched: the prefix, the company and XDG_DATA_HOME all
 * live in one temporary folder, removed at the end.
 *
 * Run: npm run smoke:npm      (after `npm ci` and `npm --prefix web ci`)
 * SMOKE_STRICT=1 — CI: a missing `desktop-file-validate` or `gio` is a failure,
 * not a skip.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const STRICT = process.env['SMOKE_STRICT'] === '1';
const WIN = process.platform === 'win32';

const NPM = process.env['npm_execpath'];
if (!NPM || !/\.c?js$/.test(NPM)) {
  console.error('Run this through `npm run smoke:npm` — it needs npm_execpath to call npm without a shell.');
  process.exit(2);
}

// ⚠ realpath: `os.tmpdir()` is `C:\Users\RUNNER~1\…` on a Windows runner and
// `/var/…` → `/private/var/…` on macOS, while the CLI reports resolved paths.
// Comparing the two unresolved fails a check that is actually true.
const WORK = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-npm-')));
const PACK_DIR = path.join(WORK, 'pack');
const PREFIX = path.join(WORK, 'prefix');
const HOME = path.join(WORK, 'home');
const XDG = path.join(WORK, 'xdg');
for (const d of [PACK_DIR, PREFIX, HOME, XDG]) fs.mkdirSync(d, { recursive: true });

const PKG_DIR = WIN
  ? path.join(PREFIX, 'node_modules', ...PKG.name.split('/'))
  : path.join(PREFIX, 'lib', 'node_modules', ...PKG.name.split('/'));
const BIN = WIN ? path.join(PREFIX, 'agentco.cmd') : path.join(PREFIX, 'bin', 'agentco');

const measured: Array<[string, string]> = [
  ['os', `${process.platform}-${process.arch}`],
  ['node', process.versions.node],
];
let daemon: ChildProcess | undefined;

// ─────────────────────────────────────────────────────────── plumbing

/**
 * The environment a stranger's terminal has: none of `npm run`'s variables,
 * and none of this repository's `node_modules/.bin` on PATH — otherwise `doctor`
 * could find the repo's Claude Code and the check below would prove nothing.
 */
function strangerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_/i.test(k) || /^AGENTCO_/.test(k)) continue;
    env[k] = v;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = (env[pathKey] ?? '')
    .split(path.delimiter)
    .filter((p) => p && !path.resolve(p).startsWith(ROOT))
    .join(path.delimiter);
  env['AGENTCO_HEADLESS'] = '1';
  env['XDG_DATA_HOME'] = XDG;
  return env;
}
const ENV = strangerEnv();

function agentco(args: string[], cwd = HOME): ChildProcess {
  if (WIN) {
    // Exactly what `shell: true` builds, spelled out so the quoting is visible.
    const line = `""${BIN}" ${args.join(' ')}"`;
    return spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd,
      env: ENV,
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
  }
  return spawn(BIN, args, { cwd, env: ENV });
}

interface Ran {
  code: number | null;
  out: string;
  ms: number;
}

function collect(child: ChildProcess, timeoutMs: number): Promise<Ran> {
  const started = Date.now();
  let out = '';
  child.stdout?.on('data', (b: Buffer) => (out += b.toString('utf8')));
  child.stderr?.on('data', (b: Buffer) => (out += b.toString('utf8')));
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ code: null, out: out + `\n[timed out after ${timeoutMs} ms]`, ms: Date.now() - started });
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + `\n[spawn failed: ${err.message}]`, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - started });
    });
  });
}

function npm(args: string[], timeoutMs: number): Promise<Ran> {
  return collect(spawn(process.execPath, [NPM!, ...args], { cwd: ROOT, env: process.env }), timeoutMs);
}

/** `cmd.exe` is the child on Windows; the daemon is its child. Kill the tree. */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (WIN) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

class SmokeFailure extends Error {}

function check(ok: unknown, what: string, output?: string): void {
  if (ok) {
    console.log(`  ✓ ${what}`);
    return;
  }
  console.log(`  ✗ ${what}`);
  if (output !== undefined) console.log(output.replace(/^/gm, '    │ '));
  annotate(what, output ?? '');
  throw new SmokeFailure(what);
}

/**
 * ⚠ A JOB LOG NEEDS A SIGNED-IN GITHUB ACCOUNT — even on a public repository
 * the logs endpoint answers 403 — but an annotation does not. So the failing
 * check and its output also go out as one, and the reason a job is red can be
 * read by anyone, from the API or the run page, without a token.
 */
function annotate(title: string, body: string): void {
  if (process.env['GITHUB_ACTIONS'] !== 'true') return;
  const esc = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const tail = body.length > 3_000 ? '…' + body.slice(-3_000) : body;
  console.log(`::error title=${esc(title).replace(/[:,]/g, ' ')}::${esc(tail || title)}`);
}

function step(title: string): void {
  console.log(`\n▸ ${title}`);
}

function sizeOf(p: string): number {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p)) total += sizeOf(path.join(p, e));
  return total;
}

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function healthz(port: number): Promise<{ ok?: boolean; version?: string } | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? ((await res.json()) as { ok?: boolean; version?: string }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What npm currently calls `latest`, which during a release is the version
 * BEFORE this one.
 *
 * 🔴 The update step has to aim at something that EXISTS. Aiming at the version
 * being released 404s every time, because smoke runs before the publish — and
 * `--to latest` is answered, correctly, with "already on the newest there is",
 * since the local build is ahead of the registry. Both leave the package on
 * disk untouched and every assertion passing for nothing. An explicit older
 * version is a real install and exercises the whole mechanism.
 */
async function registryLatest(): Promise<string | undefined> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG.name.replace('/', '%2f')}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { 'dist-tags'?: Record<string, string> };
    return body['dist-tags']?.['latest'];
  } catch {
    return undefined;
  }
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, stop?: () => boolean): Promise<T | undefined> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await probe();
    if (v !== undefined) return v;
    if (stop?.()) return undefined;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

/** The first fixed part of a catalogue sentence — everything before a `{param}`. */
function fixed(s: string): string {
  return s.split('{')[0]!.trim();
}

function has(cmd: string): boolean {
  return !spawnSync(cmd, ['--help'], { stdio: 'ignore' }).error;
}

// ─────────────────────────────────────────────────────────── the walk

async function main(): Promise<void> {
  /**
   * SMOKE_FROM_REGISTRY=1 — the same walk, but installing `name@version` from
   * npm instead of a local tarball: the check AFTER a publish that what the
   * registry serves is what was tested before it.
   */
  let source: string;
  if (process.env['SMOKE_FROM_REGISTRY'] === '1') {
    source = `${PKG.name}@${PKG.version}`;
    measured.push(['source', `registry (${source})`]);
    // Right after a publish the registry can answer before it has the
    // version — `npm view` of an unknown version exits 0 with empty output.
    step(`wait for ${source} on the registry`);
    const seen = await waitFor(async () => {
      const v = await npm(['view', source, 'version', '--prefer-online'], 60_000);
      return v.out.trim().split(/\r?\n/).includes(PKG.version) ? true : undefined;
    }, 300_000);
    check(seen, `the registry serves ${source}`);
  } else {
    step(`npm pack  (${PKG.name}@${PKG.version})`);
    const pack = await npm(['pack', '--pack-destination', PACK_DIR], 600_000);
    check(pack.code === 0, 'npm pack exited 0', pack.out);
    const tgz = fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.tgz'));
    check(tgz.length === 1, `one tarball (${tgz.join(', ') || 'none'})`);
    source = path.join(PACK_DIR, tgz[0]!);
    measured.push(['tarball', `${(fs.statSync(source).size / 1024).toFixed(0)} KB`]);
  }

  step(`npm i -g ${path.isAbsolute(source) ? path.basename(source) : source} into an isolated prefix`);
  // `--prefer-online`: a registry install must not be answered from a cache
  // warmed by an earlier tarball install of the same name and version.
  const install = await npm(['install', '-g', source, '--prefix', PREFIX, '--no-audit', '--no-fund', '--prefer-online'], 900_000);
  check(install.code === 0, 'npm install exited 0', install.out);
  measured.push(['install', `${(install.ms / 1000).toFixed(1)} s`]);
  measured.push(['installed size', `${(sizeOf(PREFIX) / 1024 / 1024).toFixed(0)} MB`]);
  check(fs.existsSync(BIN), `the bin shim exists (${path.relative(WORK, BIN)})`);

  const installed = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as { version: string };
  check(installed.version === PKG.version, `installed version is ${PKG.version} (got ${installed.version})`);

  /**
   * 🔴 THE ORPHAN RULE, AS A RULE AND NOT AS TWO NAMES. `tsc` never deletes the
   * output of a source that was removed; on 14/09 the tree held
   * `core/master.js` and `server/ui.js` that way. Every shipped `.js` must have
   * a source beside it — naming the two known ones would miss the third.
   */
  const orphans = walk(path.join(PKG_DIR, 'dist'))
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !['.ts', '.tsx'].some((ext) => fs.existsSync(path.join(ROOT, 'src', f.replace(/\.js$/, ext)))));
  check(orphans.length === 0, 'every dist/**/*.js in the tarball has a source file', orphans.join('\n'));
  check(fs.existsSync(path.join(PKG_DIR, 'web', 'dist', 'index.html')), 'web/dist/index.html is in the tarball');
  check(fs.existsSync(path.join(PKG_DIR, 'installer', 'logo.png')), 'installer/logo.png is in the tarball');

  // The sentences come from the INSTALLED catalogue, not from this repo's
  // source — the thing under test is what the stranger received.
  const { en } = (await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'i18n', 'en.js')).href)) as {
    en: Record<string, string>;
  };
  const { vi } = (await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'i18n', 'vi.js')).href)) as {
    vi: Record<string, string>;
  };

  step('agentco init --lang en');
  const init = await collect(agentco(['init', '--lang', 'en']), 60_000);
  check(init.code === 0, 'init exited 0', init.out);
  const yaml = path.join(HOME, 'company', 'company.yaml');
  check(fs.existsSync(yaml), 'the company is created where the command was typed (./company)', init.out);
  check(/^language: en$/m.test(fs.readFileSync(yaml, 'utf8')), 'company.yaml says language: en');
  check(init.out.includes(fixed(en['cli.created']!)), 'init answers in English', init.out);

  step('agentco doctor');
  const doctor = await collect(agentco(['doctor']), 180_000);
  const claudeLine = doctor.out.split(/\r?\n/).find((l) => /^\s+[✓✗]\s+Claude Code\s{2,}/.test(l));
  check(doctor.code === 0 || doctor.code === 4, `doctor exited 0 or 4 (got ${doctor.code})`, doctor.out);
  check(claudeLine?.includes('✓'), 'doctor finds Claude Code', doctor.out);
  /**
   * ⚠ `sdk-package`, and inside OUR prefix: the binary npm pulled in for this
   * package. Finding a `claude` that was already on the machine would pass the
   * line above and prove nothing about the door a stranger walks through.
   */
  check(
    claudeLine!.includes('(sdk-package)') && claudeLine!.includes(PREFIX),
    'it is the Claude Code this package brought (sdk-package, inside the prefix)',
    claudeLine,
  );
  check(doctor.out.includes(en['cli.checkNode']!), 'doctor answers in English', doctor.out);
  const authLine = doctor.out.split(/\r?\n/).find((l) => l.includes(en['cli.checkAuth']!));
  check(authLine, 'doctor prints a sign-in line', doctor.out);
  const signedIn = /^\s+✓/.test(authLine!);
  check(signedIn === (doctor.code === 0), `the sign-in mark agrees with the exit code (✓ ⇔ 0, got ${doctor.code})`, doctor.out);
  /**
   * 🔴 ON CI NOBODY IS SIGNED IN, so ✓ there is a lie — and it was, on 14/09:
   * `doctor` printed ✓ over a 401 on all six machines, and this script only
   * reported it as a measurement. It is a check now. → cli/doctor-auth.ts
   */
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    check(!signedIn, 'on CI nobody is signed in, and doctor says so', authLine);
  }
  measured.push(['doctor sign-in', signedIn ? 'signed in (real call)' : 'not signed in']);
  measured.push(['doctor', `${(doctor.ms / 1000).toFixed(1)} s`]);

  step('agentco start --no-ui');
  const port = await freePort();
  daemon = agentco(['start', '--no-ui', '--port', String(port)]);
  const daemonRun = collect(daemon, 600_000);
  let daemonExited = false;
  void daemonRun.then(() => (daemonExited = true));
  const t0 = Date.now();
  const health = await waitFor(() => healthz(port), 60_000, () => daemonExited);
  check(health?.ok === true, `/healthz answers on port ${port}`, daemonExited ? (await daemonRun).out : undefined);
  measured.push(['start → healthy', `${Date.now() - t0} ms`]);
  check(health!.version === PKG.version, `/healthz reports ${PKG.version} (got ${health!.version})`);

  step('agentco status');
  const status = await collect(agentco(['status']), 30_000);
  check(status.code === 0, 'status exited 0', status.out);
  check(status.out.includes(en['cli.noOffices']!.trim()), 'status answers in English (the 14/09 bug)', status.out);
  check(!status.out.includes(vi['cli.noOffices']!.trim()), '…and not in the other catalogue', status.out);

  step('agentco stop');
  const stop = await collect(agentco(['stop']), 30_000);
  check(stop.code === 0, 'stop exited 0', stop.out);
  check(stop.out.includes(fixed(en['cli.stopSent']!)), 'stop answers in English', stop.out);
  const ended = await Promise.race([daemonRun, new Promise<undefined>((r) => setTimeout(() => r(undefined), 20_000))]);
  check(ended !== undefined, 'the daemon process ended within 20 s');
  daemon = undefined;
  check((await healthz(port)) === undefined, 'the port no longer answers');
  check(!fs.existsSync(path.join(HOME, 'company', '.state', 'daemon.json')), 'daemon.json was cleared');

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `agentco update` HAD NEVER RUN ON macOS OR LINUX. (added 17/09/2026)  │
   * │                                                                          │
   * │ Every piece of it was written for three systems — both npm layouts        │
   * │ checked rather than picked by platform, `node <npm-cli.js>` because Node  │
   * │ cannot spawn a `.cmd` without a shell, a prefix derived from where the    │
   * │ running file is — and all of it was measured on Windows only, because     │
   * │ `npm test` runs on Windows only. "Written for three, proved on one" is    │
   * │ the sentence this project has paid for six times.                        │
   * │                                                                          │
   * │ ⚠ `--to` THIS VERSION, not `latest`: it exercises the whole mechanism —   │
   * │ resolve npm, write a helper outside the package, wait, install, restart — │
   * │ while landing on exactly what was already there. A smoke run must not     │
   * │ depend on what the registry happens to call `latest` today, and must not  │
   * │ leave a different version behind for the checks that follow.              │
   * │                                                                          │
   * │ ⚠ It installs into PREFIX, the isolated one this script made. If that     │
   * │ ever stopped being true the machine's real global install would be        │
   * │ overwritten by a test — which is why the version is read back from        │
   * │ PKG_DIR afterwards rather than from `agentco version`.                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /*
   * ⚠ `--to latest`, NOT `--to <this version>`. Smoke runs BEFORE the publish,
   * so the version being released does not exist on the registry yet: aiming at
   * it makes npm 404 every single time, the package on disk stays exactly as it
   * was, and every assertion below passes without a thing having happened. That
   * is what the first version of this step did.
   *
   * `latest` is whatever shipped before this one, which is a real install into
   * the isolated prefix — and after the publish, when `npm-verify` runs this
   * again with SMOKE_FROM_REGISTRY, `latest` is this version and it reinstalls
   * itself. Both are a genuine npm run.
   */
  const published = await registryLatest();
  if (!published) {
    step('agentco update — skipped, nothing published to aim at');
  } else {
  step(`agentco update --to ${published}`);
  const upd = await collect(agentco(['update', '--to', published]), 60_000);

  // 🔴 THE HANG IS THE POINT. `collect` resolves on 'close', which fires only
  // once the process has ended AND its streams are shut; the helper used to be
  // handed this process's stdio and held them open long after it exited.
  check(upd.code === 0, 'update exited 0 and CLOSED its streams', upd.out);
  check(!upd.out.includes('Cannot find npm'), 'npm was found beside this Node', upd.out);

  // ⚠ The log the command printed is the only evidence the helper ran at all —
  // it is detached, so nothing else can see it.
  const logLine = /(\S+update\.log)/.exec(upd.out);
  check(!!logLine, 'update printed where its log is', upd.out);
  const npmSpoke = await waitFor(
    // eslint-disable-next-line @typescript-eslint/require-await
    async () => {
      try {
        const body = fs.readFileSync(logLine![1]!, 'utf8');
        return /added|changed|up to date|npm error|npm warn/.test(body) ? body : undefined;
      } catch {
        return undefined;
      }
    },
    180_000,
  );
  check(!!npmSpoke, 'the detached helper actually ran npm', npmSpoke?.slice(-600));
  check(!/npm error/.test(npmSpoke ?? ''), 'and npm did not fail', npmSpoke?.slice(-600));

  const after = await waitFor(
    // eslint-disable-next-line @typescript-eslint/require-await
    async () => {
      try {
        return (JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as { version: string })
          .version;
      } catch {
        return undefined; // mid-swap: npm has the file open
      }
    },
    60_000,
  );
  check(!!after, 'the isolated prefix still holds a readable install', after);
  measured.push(['update → installed', after ?? '(gone)']);
  }

  step('agentco shortcut');
  const shortcut = await collect(agentco(['shortcut']), 30_000);
  check(shortcut.code === 0, 'shortcut exited 0', shortcut.out);
  if (process.platform !== 'linux') {
    check(shortcut.out.includes(fixed(en['cli.shortcutNotLinux']!)), 'not Linux: it says so and writes nothing', shortcut.out);
  } else {
    await linuxShortcut(en);
  }
}

/**
 * CI cannot click an icon. The next best thing is to hand the file to the same
 * library a desktop uses to launch it (`gio launch`), which reads `Exec` with
 * the spec's own unquoting — the part where a hand-rolled check would agree
 * with a hand-rolled bug. ⚠ Still not a click: a real Ubuntu session is the
 * last step before "done for Linux". → HANDOFF step 7
 */
async function linuxShortcut(en: Record<string, string>): Promise<void> {
  const dir = path.join(XDG, 'applications');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.desktop')) : [];
  check(files.length === 1, `one .desktop file under XDG_DATA_HOME (${files.join(', ') || 'none'})`);
  const file = path.join(dir, files[0]!);
  const body = fs.readFileSync(file, 'utf8');
  console.log(body.replace(/^/gm, '    │ '));

  const icon = /^Icon=(.*)$/m.exec(body)?.[1];
  check(icon && fs.existsSync(icon), 'Icon points at a file that exists');
  const tryExec = /^TryExec=(.*)$/m.exec(body)?.[1];
  check(tryExec && fs.existsSync(tryExec), 'TryExec points at a file that exists');

  if (has('desktop-file-validate')) {
    const v = spawnSync('desktop-file-validate', [file], { encoding: 'utf8' });
    check(v.status === 0 && !v.stdout.trim() && !v.stderr.trim(), 'desktop-file-validate: no errors, no warnings', v.stdout + v.stderr);
  } else {
    check(!STRICT, 'desktop-file-validate is installed (SMOKE_STRICT)');
    console.log('  – desktop-file-validate not installed, skipped');
  }

  if (!has('gio')) {
    check(!STRICT, 'gio is installed (SMOKE_STRICT)');
    console.log('  – gio not installed, launch skipped');
    return;
  }
  // The shortcut starts the company on the port company.yaml names.
  const port = Number(/^\s+port:\s*(\d+)/m.exec(fs.readFileSync(path.join(HOME, 'company', 'company.yaml'), 'utf8'))?.[1]);
  check(Number.isFinite(port) && (await healthz(port)) === undefined, `port ${port} is free before the launch`);
  const launch = spawnSync('gio', ['launch', file], { encoding: 'utf8', env: ENV, cwd: os.tmpdir(), timeout: 30_000 });
  check(launch.status === 0, 'gio launch exited 0', launch.stdout + launch.stderr);
  const health = await waitFor(() => healthz(port), 60_000);
  check(health?.version === PKG.version, `launching the .desktop file starts ${PKG.version} on port ${port}`);
  const stop = await collect(agentco(['stop']), 30_000);
  check(stop.out.includes(fixed(en['cli.stopSent']!)), 'stop reaches the company the menu started', stop.out);
  const gone = await waitFor(async () => ((await healthz(port)) === undefined ? true : undefined), 20_000);
  check(gone, 'and it shuts down');
}

// ─────────────────────────────────────────────────────────── report

function report(ok: boolean): void {
  const rows = measured.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  const md = `### npm smoke — ${ok ? 'passed' : 'FAILED'} · ${PKG.name}@${PKG.version}\n\n| | |\n|---|---|\n${rows}\n`;
  console.log(`\n${md}`);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary) fs.appendFileSync(summary, md + '\n');
}

let ok = false;
try {
  await main();
  ok = true;
} catch (err) {
  if (!(err instanceof SmokeFailure)) {
    console.error(err);
    annotate('the smoke script itself threw', err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
} finally {
  if (daemon) killTree(daemon);
  report(ok);
  try {
    fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    console.log(`(could not remove ${WORK})`);
  }
}
process.exit(ok ? 0 : 1);
