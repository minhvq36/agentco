#!/usr/bin/env node
/**
 * CLI. → docs/SPEC-cli.md §2, docs/SPEC-offices.md
 *
 * Error-message rule: every error prints WHAT HAPPENED + WHAT TO DO NEXT, one
 * sentence each. The customer does not write code — stack traces stay hidden by
 * default.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Company } from '../core/company.js';
import { adoptInterfaceLocale, osLocaleHints } from '../core/config.js';
import {
  companyFingerprint,
  companyPaths,
  ensureCompanyDirs,
  isCompanyDir,
  resolveCompanyDir,
} from '../core/paths.js';
import { DESKTOP_LAUNCHER_ENV, desktopEntry, desktopFileName } from './desktop-entry.js';
import { readSignIn, SIGN_IN_PROBE_MS } from './doctor-auth.js';
import { serve, type Daemon } from '../server/server.js';
import { webBuildStale } from '../server/static.js';
import { clearDaemonFile, liveDaemon, openBrowser, writeDaemonFile } from './daemonfile.js';
import { agentcoOnPort, DEFAULT_PORT, findFreePort, type PortOccupant } from './port.js';
import { findNpmCli, globalPrefixFor, updateScript } from './update-run.js';
import {
  compareVersions,
  installKind,
  packageRoot,
  readUpdateCache,
} from '../core/update-check.js';
import { WEBSITE_URL } from '../core/update-links.js';

import { formatRunUsage } from '../core/usage.js';
import { readSecrets, secretNames, writeSecrets } from '../core/secrets.js';
import { appVersion, packageName } from '../core/version.js';
import { describeSearch } from '../core/claude-code.js';
import { resolveLocale, setLocale, t, type Locale } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';

const EXIT = { ok: 0, general: 1, config: 2, noDaemon: 3, auth: 4, taskFail: 5, budget: 6, rateLimit: 7 };

/**
 * The name npm knows us by — read from the manifest, never typed twice.
 *
 * ⚠ BELOW the imports, not among them: `await main()` runs at the top level,
 * so a `const` it depends on has to be initialised before that line is reached.
 */
const PACKAGE_NAME = packageName();

const argv = process.argv.slice(2);
const command = argv[0] ?? 'help';
const flags = parseFlags(argv.slice(1));
const companyDir = resolveCompanyDir(typeof flags['dir'] === 'string' ? flags['dir'] : undefined);

// Before ANY sentence is printed, including an error from `main()` itself.
// `status`, `stop` and `doctor` never load the config, and they used to answer
// in the module default. → core/config.ts §adoptInterfaceLocale
adoptInterfaceLocale(companyDir);

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ONE REF'D HANDLE FOR AS LONG AS A COMMAND IS RUNNING. (16/09/2026)    │
 * │                                                                          │
 * │ Node exits when the event loop has nothing left — and a pending `await`   │
 * │ is NOT something left. A command that reaches a moment with no socket,    │
 * │ no timer and no child process simply stops, exits 0, and prints           │
 * │ "Detected unsettled top-level await" if anyone is reading stderr.         │
 * │                                                                          │
 * │ Caught on CI, never here: `agentco start` on a taken port walked away     │
 * │ between `serve()` rejecting with EADDRINUSE — at which point the listener │
 * │ it tried to open is already closed, so the process holds nothing — and    │
 * │ the recovery that follows. The company was not moved, no error was        │
 * │ printed, and the exit code was 0. Success, on paper.                      │
 * │                                                                          │
 * │ ⚠ IT IS NOT SPECIFIC TO THAT BRANCH, which is why it is here and not      │
 * │ there. Any command whose last live handle closes mid-flight has the same  │
 * │ shape, and the failure is silent in every one of them.                    │
 * │                                                                          │
 * │ ⚠ Cleared in `finally`, so a command that finishes still lets the process │
 * │ exit on its own. `unref()` would defeat the entire point.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const running = setInterval(() => {}, 60_000);
try {
  await main();
} catch (err) {
  fail(err);
} finally {
  clearInterval(running);
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
    case 'update':
      return cmdUpdate();
    case 'shortcut':
      return cmdShortcut();
    case 'version':
    case '--version':
    case '-v':
    case '-V':
      return cmdVersion();
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
    default:
      console.error(t('cli.noCommand', { command }));
      process.exit(EXIT.config);
  }
}

// ─────────────────────────────────────────────────────────── commands

/**
 * Create an EMPTY company. No sample office, no sample employees.
 * → SPEC-offices.md §3
 */
function cmdInit(): void {
  if (isCompanyDir(companyDir)) {
    console.log(t('cli.alreadyInit', { dir: companyDir }));
    return;
  }
  const pp = companyPaths(companyDir);
  ensureCompanyDirs(pp);

  /**
   * ⚠ ALWAYS THE DEFAULT, EVEN THOUGH THE SECOND COMPANY ON A MACHINE WILL
   * COLLIDE WITH IT. (settled 16/09/2026, user)
   *
   * A version of this searched for a free port here as well. It worked, and it
   * was one mechanism too many: `start` already moves a taken port and writes
   * the new number back, so the collision resolves itself the first time the
   * company runs. Two mechanisms for one problem means two places to keep
   * true, and the second one earns nothing — the outcome is the same file
   * holding the same number.
   */
  const port = typeof flags['port'] === 'number' ? flags['port'] : DEFAULT_PORT;
  /**
   * Resolve the interface language HERE, from the OS, and write it down.
   *
   * This is the only place the OS hint is allowed to decide anything. A fresh
   * machine has nothing to preserve, so guessing from the environment is a
   * kindness; `loadCompanyConfig` must not do the same, because there an absent
   * field means "an install that predates this field", and those are Vietnamese.
   *
   * Fallback `en`, not `vi`: an unmatched tag (`de`, `ar`, `es`) means we ship
   * no catalogue for that language, which is not evidence for Vietnamese.
   *
   * ⚠ The OS hints are ONE list shared with `adoptInterfaceLocale`, which runs
   * before every command — including why `Intl` is on it (the POSIX variables
   * are not set on Windows). → core/config.ts §osLocaleHints. Two copies of
   * that list is how `doctor` and `init` would come to disagree.
   */
  /**
   * ⚠ `--lang` GOES FIRST, and it is what the installer passes.
   * → docs/SPEC-packaging.md §7.1
   *
   * The installer asked the person directly, so its answer outranks every hint
   * below it — those exist for the case where nobody was asked. An OS set to
   * English on a machine whose owner wants Vietnamese is a normal situation,
   * not an odd one, and the only way to know is to have asked.
   *
   * ⚠ It is still `resolveLocale`, not a raw assignment: an unshipped tag must
   * fall through to the hints rather than pin the interface to a catalogue that
   * does not exist. → `docs/CLAUDE.md §Language`
   */
  const locale = resolveLocale(
    [typeof flags['lang'] === 'string' ? flags['lang'] : undefined, ...osLocaleHints()],
    'en',
  );
  /**
   * Adopt the resolved locale BEFORE anything is written or printed.
   *
   * The template itself no longer contains a single translated string — see the
   * box on `companyTemplate` — but the five `console.log` lines below it do, and
   * no config has been loaded at this point. Without this line a machine that
   * resolved to `en` would write `language: en` and then report it in Vietnamese.
   */
  setLocale(locale);
  fs.writeFileSync(pp.configFile, companyTemplate(locale, port), 'utf8');

  console.log(t('cli.created', { dir: companyDir }));
  console.log(t('cli.createdCompanyYaml'));
  console.log(t('cli.createdOffices'));
  console.log(t('cli.createdEmpty'));
  console.log(t('cli.createdNext'));
  // ⚠ ONLY WHERE IT WORKS. A tip about a command that answers "not on this
  // system" is worse than no tip: it spends the reader's attention and then
  // refuses. → `cmdShortcut`
  if (process.platform === 'linux') console.log(t('cli.createdShortcutHint'));
}

/**
 * The two cases healing cannot reach: a `--port` the caller named and we must
 * not override, and a machine with nothing free in the window above it.
 *
 * 🔴 IT GOES THROUGH `notifyDesktop`, AND THE FIRST VERSION OF THIS DID NOT.
 * `console.error` alone is a dead end for everyone who did not arrive by
 * terminal — which is the whole audience of a menu icon. The box on
 * `notifyDesktop` names "a port already taken" as its example, and this branch
 * still managed to route around it by exiting directly instead of through
 * `fail()`. → SPEC-packaging §7.4b
 */
async function portDeadEnd(
  port: number,
  host: string,
  file: string,
  why: 'asked' | 'none-free' | 'unidentified',
  occupant?: PortOccupant,
): Promise<never> {
  const next = (await findFreePort(port + 1, host)) ?? port + 1;

  const lines = [t('cli.portBusy', { port })];
  if (occupant && why !== 'unidentified') {
    lines.push(t('cli.portBusyAgentco', { version: occupant.version, url: `http://${host}:${port}` }));
  }
  lines.push(
    why === 'asked'
      ? t('cli.portBusyAsked', { next })
      : why === 'unidentified'
        ? t('cli.portBusyUnknownAgentco', { version: occupant?.version ?? '?', next })
        : t('cli.portBusyNoneFree', { next, file }),
  );

  const message = lines.join('\n');
  console.error(message);
  notifyDesktop(message);
  process.exit(EXIT.config);
}

async function cmdStart(): Promise<void> {
  const pp = companyPaths(companyDir);

  // IDEMPOTENT: already running ⇒ open a browser onto it, not a port error.
  const existing = await liveDaemon(pp);
  if (existing) {
    console.log(t('cli.alreadyRunning', { url: existing.url, pid: existing.pid }));
    openBrowser(existing.url);
    return;
  }

  const company = Company.open(companyDir);
  const asked = typeof flags['port'] === 'number' ? flags['port'] : undefined;
  const host = typeof flags['host'] === 'string' ? flags['host'] : '127.0.0.1';
  const token = process.env['AGENTCO_TOKEN'];

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A TAKEN PORT MOVES THE COMPANY AND WRITES THE NEW NUMBER DOWN.        │
   * │ (16/09/2026)                                                             │
   * │                                                                          │
   * │ The first version of this printed a good sentence and stopped — and the  │
   * │ sentence was a dead end for everyone who did not arrive by terminal.     │
   * │ A `.desktop` entry runs with `Terminal=false`; the Windows launcher      │
   * │ reads an EXIT CODE and shows "stopped unexpectedly (code 2)". The two    │
   * │ ways out on offer — a CLI flag and editing company.yaml — are both       │
   * │ developer-shaped, and the interface cannot be the third one, because     │
   * │ this is the failure that stops the interface from existing.              │
   * │                                                                          │
   * │ So it heals instead of explaining: take the next free port, RECORD IT    │
   * │ (`Company.updatePort`), carry on. Recording is the whole difference      │
   * │ between healing and drifting — the config stays true, so the desktop     │
   * │ entry and the launcher follow on their own.                              │
   * │                                                                          │
   * │ ⚠ AN EXPLICIT `--port` IS NEVER MOVED. Somebody who names a number is    │
   * │ answering a question we did not ask, often pointing a script at a fixed  │
   * │ address; healing there would be a surprise, not a kindness.              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ THE `catch` HANDLES EXACTLY ONE CODE AND RE-THROWS THE REST. `serve()`
   * rejects with whatever `server.once('error')` received, and a catch that
   * swallowed all of them would fold every future listen failure — a bad
   * `--host`, a permission denial, an interface that vanished — into one
   * friendly sentence about ports. That is the shape of bug nobody reports,
   * because the message sounds like it was expected.
   *
   * Above this, `liveDaemon` has ALREADY handled the common case: this
   * company's own daemon running, which opens a browser instead of erroring.
   * Reaching here means the port belongs to somebody else. → cli/port.ts
   */
  let port = asked ?? company.config.runtime.port;
  const wanted = port;
  let daemon: Daemon | undefined;

  // ⚠ A LOOP, NOT ONE RETRY: between `findFreePort` answering and `serve`
  // asking, the port can be taken by somebody else. Rare, and cheap to survive.
  for (let attempt = 0; attempt < 4 && !daemon; attempt++) {
    try {
      daemon = await serve({
        company,
        port,
        host,
        ...(token ? { token } : {}),
        onShutdown: () => {
          console.log(t('cli.shutFromUi'));
          clearDaemonFile(pp);
          process.exit(EXIT.ok);
        },
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      if (asked !== undefined) return portDeadEnd(port, host, pp.configFile, 'asked');

      const occupant = await agentcoOnPort(port, host);

      /*
       * 🔴 OUR OWN DAEMON, WITH ITS RECORD MISSING — the case `liveDaemon`
       * above could not see, because it reads `daemon.json` and that file was
       * not there. Same answer it would have given: open a tab. Starting a
       * second daemon on one company folder is the thing healing must never do.
       *
       * ⚠ `stop` still needs the missing record, so the way out is the "Shut
       * down" button in the tab now opening — which is why it opens.
       */
      if (occupant?.company === companyFingerprint(companyDir)) {
        const url = `http://${host}:${port}`;
        console.log(t('cli.alreadyRunningAtPort', { url }));
        if (!flags['no-ui']) openBrowser(url);
        return;
      }

      /*
       * ⚠ AN AGENTCO THAT WILL NOT SAY WHICH COMPANY IT SERVES (any build
       * before 0.1.3) IS A REFUSAL, NOT A MOVE. Moving and being wrong means
       * two daemons over one key store and one ledger, silently. Refusing and
       * being wrong means a sentence on the screen and `--port`. The visible
       * failure is the cheaper one to be wrong about.
       */
      if (occupant && occupant.company === undefined) {
        return portDeadEnd(port, host, pp.configFile, 'unidentified', occupant);
      }

      const free = await findFreePort(port + 1, host);
      if (free === undefined) return portDeadEnd(port, host, pp.configFile, 'none-free', occupant);
      port = free;
    }
  }
  // Every attempt in the window was taken between being found free and being
  // asked for. Rare, and the same dead end as finding nothing free at all.
  if (!daemon) return portDeadEnd(port, host, pp.configFile, asked === undefined ? 'none-free' : 'asked');

  /*
   * Only a port that came from company.yaml is written back — `--port` is for
   * this run and must not edit the file. Written AFTER `serve` succeeded: the
   * file records a port we actually hold, never one we hoped for.
   */
  if (asked === undefined && daemon.port !== wanted) {
    company.updatePort(daemon.port);
    console.log(t('cli.portMoved', { from: wanted, to: daemon.port, file: pp.configFile }));
  }

  writeDaemonFile(pp, {
    pid: process.pid,
    port: daemon.port,
    url: daemon.url,
    // ⚠ `appVersion()`, never a literal. This used to read `'0.0.1'`, hand-typed,
    // while `/healthz` reported the real one — two copies of the ONE number the
    // update channel exists to compare. → core/version.ts · SPEC-packaging §1
    version: appVersion(),
    started_at: new Date().toISOString(),
  });

  const offices = company.list();
  console.log(t('cli.running', { name: company.config.name || t('company.unnamed') }));
  console.log(`  ${daemon.url}`);
  if (offices.length === 0) {
    console.log(t('cli.noOfficesHint'));
  } else {
    for (const o of offices) {
      console.log(
        t('cli.officeLine', {
          name: o.name.padEnd(20),
          agents: o.agents,
          notes: o.knowledge,
          error: o.error ? '  ⚠ ' + o.error : '',
        }),
      );
    }
  }
  if (webBuildStale()) {
    console.log(t('cli.staleBuild'));
    console.log(t('cli.staleBuildFix'));
    console.log(t('cli.staleBuildDev'));
  }

  console.log(t('cli.ctrlC'));

  if (!flags['no-ui']) openBrowser(daemon.url);

  const shutdown = async (): Promise<void> => {
    console.log(t('cli.closing'));
    clearDaemonFile(pp);
    await daemon.close();
    process.exit(EXIT.ok);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/**
 * `agentco update` — the npm door's one command. → docs/SPEC-packaging.md §3.7
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 IT HANDS THE WORK TO A SCRIPT OUTSIDE THE PACKAGE AND THEN LEAVES.    │
 * │                                                                          │
 * │ Stopping the daemon is not enough, and that is the part that looks done  │
 * │ when it is not: THIS process is itself running from                      │
 * │ `<prefix>/node_modules/@agent-co-app/cli/dist/cli/index.js` — the very   │
 * │ directory npm is about to replace. Node closes a `.js` after reading it, │
 * │ so npm deletes it without complaint; the price is paid later, by the     │
 * │ first `import()` that reaches for a file that is no longer there. A      │
 * │ failure that depends on which code path ran is the worst kind to chase.  │
 * │                                                                          │
 * │ So: write a small script to the OS temp directory, spawn it detached,    │
 * │ and exit. The house is empty before the builders arrive.                 │
 * │                                                                          │
 * │ ⚠ IF npm FAILS, THE OLD PACKAGE IS STILL THERE. There is no half-state   │
 * │ to recover from — `agentco start` brings back exactly what was running.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ `--to <version>` IS NOT A TEST FLAG. It is the npm door's way back: npm
 * keeps every version ever published, so a bad release is undone by naming the
 * old one. It is also what makes the whole path testable before a NEWER version
 * exists — updating downwards runs exactly the same machinery.
 */
async function cmdUpdate(): Promise<void> {
  const kind = installKind();
  if (kind === 'packaged') {
    console.log(t('cli.updatePackaged', { url: WEBSITE_URL }));
    return;
  }

  const target = typeof flags['to'] === 'string' ? flags['to'] : 'latest';
  const pp = companyPaths(companyDir);

  // 🔴 BEFORE the daemon is touched. Finding out afterwards that there is no
  // npm to call leaves the company stopped for a fact knowable a second earlier.
  const npmCli = findNpmCli();
  if (!npmCli) {
    console.error(t('cli.updateNoNpm', { command: `npm i -g ${PACKAGE_NAME}@${target}` }));
    process.exit(EXIT.config);
  }

  /*
   * Only when going to `latest`, and only as a courtesy: an explicit `--to` is
   * an instruction, and the channel has no opinion about a version somebody
   * named. A `bad-signature` answer is NOT a reason to refuse — npm is its own
   * trust chain, and the manifest only ever contributed a number.
   */
  if (target === 'latest') {
    const seen = readUpdateCache(pp);
    if (seen?.outcome === 'ok' && seen.latest && compareVersions(seen.latest, appVersion()) <= 0) {
      console.log(t('cli.updateAlready', { version: appVersion() }));
      return;
    }
  }

  const info = await liveDaemon(pp);
  if (info) {
    await fetch(`${info.url}/api/shutdown`, { method: 'POST' }).catch(() => {});
    console.log(t('cli.stopSent', { pid: info.pid }));
  }

  const script = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-update-')),
    'update.mjs',
  );
  fs.writeFileSync(script, updateScript(), 'utf8');

  /*
   * ⚠ `node <script>`, never a shell. The three operating systems disagree
   * about everything a shell does, and node is guaranteed present because this
   * process IS node. Same reason the script calls npm through its own js entry
   * point: Node cannot spawn a `.cmd` without a shell (EINVAL on Windows).
   */
  const root = packageRoot();
  const child = spawn(
    process.execPath,
    [
      script,
      npmCli,
      PACKAGE_NAME,
      target,
      root,
      companyDir,
      globalPrefixFor(root) ?? '',
      // Restart only what was actually running. `info` is the daemon this
      // command stopped a moment ago; absent means there was nothing to put back.
      info ? '1' : '',
    ],
    { detached: true, stdio: 'inherit' },
  );
  // Without this listener a missing binary KILLS the process instead of
  // throwing — `try/catch` catches exactly none of it.
  child.on('error', (err) => fail(err));
  child.unref();

  console.log(t(info ? 'cli.updateHandedOff' : 'cli.updateHandedOffIdle', { target }));
  process.exit(EXIT.ok);
}

async function cmdStop(): Promise<void> {
  const info = await liveDaemon(companyPaths(companyDir));
  if (!info) {
    console.log(t('cli.notRunning'));
    return;
  }
  await fetch(`${info.url}/api/shutdown`, { method: 'POST' }).catch(() => {});
  console.log(t('cli.stopSent', { pid: info.pid }));
}

/**
 * Ask the daemon. It may be running an OLD BUILD after an upgrade, in which case
 * it returns a 404 or an entirely different shape. Trusting the response shape is
 * the surest way to hand someone a stack trace instead of a readable sentence.
 */
async function askDaemon<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof body['error'] === 'string'
        ? body['error']
        : t('cli.daemonError', { status: res.status }),
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
      t('cli.daemonMismatch'),
    );
  }
  return { name: c.name ?? t('cli.companyFallback'), offices: c.offices };
}

async function cmdStatus(): Promise<void> {
  const info = await liveDaemon(companyPaths(companyDir));
  if (!info) {
    console.log(t('cli.notRunningStart'));
    process.exit(EXIT.noDaemon);
  }
  const c = await fetchCompany(info.url);
  console.log(`${c.name}`);
  console.log(`  ${info.url}  (pid ${info.pid})`);
  if (c.offices.length === 0) {
    console.log(t('cli.noOffices'));
    return;
  }
  for (const o of c.offices) {
    console.log(
      t('cli.officeStatusLine', {
        name: o.name.padEnd(20),
        state: o.state.padEnd(8),
        agents: o.agents,
        notes: o.knowledge,
      }) +
        (o.error ? `  ⚠ ${o.error}` : ''),
    );
  }
}

/** `agentco office` · `office new "Name"` · `office rm <id>` */
async function cmdOffice(): Promise<void> {
  const sub = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'list';
  const info = await liveDaemon(companyPaths(companyDir));

  if (sub === 'list') {
    if (!info) {
      const company = Company.open(companyDir);
      const offices = company.list();
      if (offices.length === 0) console.log(t('cli.noOfficesPlain'));
      for (const o of offices) console.log(`  ${o.id.padEnd(24)} ${o.name}`);
      return;
    }
    const c = await fetchCompany(info.url);
    if (c.offices.length === 0) console.log(t('cli.noOfficesPlain'));
    for (const o of c.offices) console.log(`  ${o.id.padEnd(24)} ${o.name}`);
    return;
  }

  if (sub === 'new') {
    const name = argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!name) {
      console.error(t('cli.officeNameMissing'));
      process.exit(EXIT.config);
    }
    // Go through the daemon when it is up — otherwise two processes write the same place.
    if (info) {
      const body = await askDaemon<{ id?: string }>(`${info.url}/api/office`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      console.log(t('cli.officeCreated', { name, id: body.id ?? '' }));
      return;
    }
    const office = Company.open(companyDir).createOffice({ name });
    console.log(t('cli.officeCreated', { name, id: office.id }));
    return;
  }

  /**
   * `office archive <id>` / `office restore <id>` — soft delete.
   * → docs/SPEC-offices.md §3.1
   *
   * This is the level people should reach for: it sets a flag, no file moves,
   * and the office KEEPS ITS NAME in the ledger. Delete it for good and its
   * spending lines are left with a bare code to trace back from.
   */
  if (sub === 'archive' || sub === 'restore') {
    const id = argv[2];
    if (!id) {
      console.error(t('cli.officeIdMissing', { sub }));
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
      archived ? t('cli.officeArchived', { id }) : t('cli.officeRestored', { id }),
    );
    return;
  }

  if (sub === 'rm') {
    const id = argv[2];
    if (!id) {
      console.error(t('cli.officeRmMissing'));
      process.exit(EXIT.config);
    }
    // `rm` now has ONE meaning: delete for good, unrecoverable. To put something
    // away, use `archive`. A `--delete-files` flag used to separate those two
    // intentions, and that was the mistake: the flag easiest to forget was the
    // one deciding whether anything was lost.
    if (flags['yes'] !== true) {
      console.error(
        t('cli.officeRmWarn', { id }),
      );
      process.exit(EXIT.config);
    }
    if (info) {
      await askDaemon(`${info.url}/api/office/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else {
      Company.open(companyDir).removeOffice(id);
    }
    console.log(t('cli.officeRemoved', { id }));
    return;
  }

  console.error(
    t('cli.officeNoSub', { sub }),
  );
  process.exit(EXIT.config);
}

/**
 * `agentco secret list | set <NAME> | rm <NAME>` → docs/SPEC-offices.md §5
 *
 * CLI-only ON PURPOSE, with no API. Secrets do not travel over HTTP, not even
 * HTTP to localhost — an endpoint that can read them is an endpoint that can be
 * tricked into being called.
 *
 * `set` reads the value from stdin or an environment variable, NEVER from a
 * command-line argument: arguments land in shell history and in the process list.
 */
function cmdSecret(): void {
  const pp = companyPaths(companyDir);
  const sub = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'list';

  if (sub === 'list') {
    const names = secretNames(pp);
    if (names.length === 0) {
      console.log(t('cli.noSecrets'));
      return;
    }
    console.log(t('cli.secretsHeader'));
    for (const n of names) console.log(`  ${n}`);
    console.log(t('cli.secretsGrant'));
    return;
  }

  const name = argv[2];
  if (!name || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) {
    console.error(
      t('cli.secretNameShape'),
    );
    process.exit(EXIT.config);
  }

  const all = readSecrets(pp);

  if (sub === 'rm') {
    if (!(name in all)) {
      console.log(t('cli.secretMissing', { name }));
      return;
    }
    delete all[name];
    writeSecrets(pp, all);
    console.log(t('cli.secretRemoved', { name }));
    return;
  }

  if (sub === 'set') {
    const value = process.env['VALUE'];
    if (!value) {
      console.error(
        t('cli.secretNoValue', { name }),
      );
      process.exit(EXIT.config);
    }
    all[name] = value;
    writeSecrets(pp, all);
    console.log(t('cli.secretSaved', { name }));
    return;
  }

  console.error(t('cli.secretNoSub', { sub }));
  process.exit(EXIT.config);
}

async function cmdRun(): Promise<void> {
  const request = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!request) {
    console.error(t('cli.runMissing'));
    process.exit(EXIT.config);
  }

  const info = await liveDaemon(companyPaths(companyDir));
  const wanted = typeof flags['office'] === 'string' ? flags['office'] : undefined;

  // With a daemon up, hand over through it — to share the warm set and the
  // assistant's session.
  if (info) {
    const c = await fetchCompany(info.url);
    const officeId = pickOffice(c.offices, wanted);
    await fetch(`${info.url}/api/office/${encodeURIComponent(officeId)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    console.log(t('cli.runHandedOver', { office: officeId, url: info.url }));
    return;
  }

  // No daemon: run it once, right here.
  const company = Company.open(companyDir);
  const officeId = pickOffice(company.list(), wanted);
  const office = company.get(officeId);
  company.on((e) => {
    if (e.type === 'plan.created') {
      console.log(t('cli.planHeader'));
      e.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
      console.log('');
    }
    if (e.type === 'task.started') console.log(`  ▶ ${e.say}`);
    if (e.type === 'task.done') console.log(`  ✓ ${e.say}`);
    if (e.type === 'task.blocked') console.log(`  ⚠ ${e.say}`);
  });

  const out = await office.run(request);
  console.log(`\n${out.report}\n`);
  // The cost of THIS shift alone. `agentco cost` is the cumulative one — mixing
  // the two makes a small job look like it burned a hundred thousand tokens.
  console.log(formatRunUsage(out.usage, out.usage.turns > 0 ? 1 : 0));
}

function pickOffice(offices: Array<{ id: string; name: string }>, wanted?: string): string {
  if (offices.length === 0) {
    throw new Error(t('cli.noOfficeYet'));
  }
  if (wanted) {
    const found = offices.find((o) => o.id === wanted);
    if (!found) {
      throw new Error(
        t('cli.noSuchOffice', { wanted, list: offices.map((o) => o.id).join(', ') }),
      );
    }
    return found.id;
  }
  if (offices.length > 1) {
    throw new Error(
      t('cli.whichOffice', { n: offices.length, list: offices.map((o) => o.id).join(', ') }),
    );
  }
  return offices[0]!.id;
}

function cmdCost(): void {
  const company = Company.open(companyDir);
  const since = typeof flags['since'] === 'string' ? parseDuration(flags['since']) : undefined;
  const officeId = typeof flags['office'] === 'string' ? flags['office'] : undefined;

  // Purge first, then print, so the printed number is the one AFTER purging —
  // print first and they are holding a table that stopped being true as they read it.
  if (flags['purge']) {
    const r = company.purgeGoneUsage();
    console.log(
      r.offices === 0
        ? t('cli.purgeNothing')
        : t('cli.purgeDone', { offices: r.offices, tasks: r.tasks, cost: formatUSD(r.costUSD) }),
    );
  }

  console.log(company.costText(since, officeId));

  const byOffice = company.costByOffice(since);
  if (byOffice.length > 1) {
    console.log(t('cli.costByOffice'));
    for (const o of byOffice) {
      console.log(
        t('cli.costLine', {
        name: o.name.padEnd(20),
        tasks: String(o.tasks).padStart(4),
        turns: String(o.turns).padStart(5),
        cost: formatUSD(o.costUSD),
      }),
      );
    }
  }

  for (const o of company.list()) {
    if (o.error) continue;
    const keys = company.get(o.id).cacheKeys();
    if (!keys.length) continue;
    console.log(`\nPrefix cache — ${o.name}:`);
    for (const k of keys) {
      console.log(t('cli.prefixLine', { role: k.role.padEnd(14), key: k.key, tokens: k.staticTokens }));
    }
  }
}

async function cmdDoctor(): Promise<void> {
  const checks: Array<[string, boolean, string]> = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push([t('cli.checkNode'), major >= 22, t('cli.checkNodeNote', { version: process.versions.node })]);
  checks.push([t('cli.checkCompanyDir'), isCompanyDir(companyDir), companyDir]);

  let writable = false;
  try {
    fs.accessSync(companyDir, fs.constants.W_OK);
    writable = true;
  } catch {
    /* not writable */
  }
  checks.push([t('cli.checkWritable'), writable, companyDir]);

  if (isCompanyDir(companyDir)) {
    try {
      const company = Company.open(companyDir);
      const offices = company.list();
      const broken = offices.filter((o) => o.error);
      checks.push([
        t('cli.checkOffices'),
        broken.length === 0,
        offices.length === 0
          ? t('cli.checkOfficesNone')
          : broken.length
            ? t('cli.checkOfficesBroken', {
                broken: broken.length,
                total: offices.length,
                list: broken.map((o) => o.id).join(', '),
              })
            : t('cli.checkOfficesOk', { n: offices.length }),
      ]);
    } catch (err) {
      checks.push([
      t('cli.checkOffices'),
      false,
      err instanceof Error ? err.message.slice(0, 90) : t('cli.unknownError'),
    ]);
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CLAUDE CODE IS CHECKED BEFORE AUTH, AND THE ORDER IS THE POINT.   │
   * │ → src/core/claude-code.ts · docs/SPEC-packaging.md §2                │
   * │                                                                      │
   * │ The SDK does not run Claude in-process — it SPAWNS an executable it  │
   * │ does not go looking for. Without one, the auth check below fails     │
   * │ with a message about the binary, and the reader concludes their      │
   * │ LOGIN is broken. Two different problems, two different fixes, and    │
   * │ the wrong one sends somebody to re-authenticate for an hour.         │
   * │                                                                      │
   * │ ⚠ IT PRINTS EVERY PATH IT TRIED, not just the verdict. "Claude Code: │
   * │ not found" starts a support conversation; five paths with a mark     │
   * │ beside each ends it with a screenshot.                               │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  const search = describeSearch();
  checks.push([
    t('cli.checkClaude'),
    !!search.found,
    search.found
      ? `${search.found.path}  (${search.found.via})`
      : t('cli.checkClaudeNo'),
  ]);
  if (!search.found) {
    for (const c of search.tried) console.log(`       ·  ${c.ok ? '✓' : '✗'} ${c.via.padEnd(17)} ${c.path}`);
  }

  // Auth: one real, very cheap call. This is the most common first-time failure.
  // ⚠ ✓ is harder to earn than `subtype: 'success'` → cli/doctor-auth.ts
  const { query } = await import('../core/sdk.js');
  const probe = new AbortController();
  const ceiling = setTimeout(() => probe.abort(), SIGN_IN_PROBE_MS);
  const signIn = await readSignIn(
    () =>
      query({
        prompt: 'Reply with the single word: ok',
        options: {
          model: 'haiku',
          maxTurns: 1,
          persistSession: false,
          settingSources: [],
          allowedTools: [],
          systemPrompt: 'Reply with one word.',
          abortController: probe,
        },
      }),
    () => probe.signal.aborted,
  );
  clearTimeout(ceiling);
  const authOk = signIn.ok;
  checks.push([
    t('cli.checkAuth'),
    authOk,
    authOk
      ? t('cli.checkAuthOk')
      : signIn.timedOut
        ? t('cli.checkAuthTimeout', { seconds: SIGN_IN_PROBE_MS / 1000 })
        : signIn.note
          ? signIn.note.slice(0, 90)
          : t('cli.checkAuthHint'),
  ]);

  const info = await liveDaemon(companyPaths(companyDir));
  checks.push([
    t('cli.checkDaemon'),
    !!info,
    info ? `${info.url} (pid ${info.pid})` : t('cli.checkDaemonNo'),
  ]);

  for (const [name, ok, note] of checks) {
    console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(24)} ${note}`);
  }
  if (!authOk) process.exit(EXIT.auth);
}

/**
 * `agentco shortcut` — a Linux menu entry that starts THIS company.
 * → docs/SPEC-cli.md §6.2 · cli/desktop-entry.ts
 *
 * ⚠ Refuses a folder that is not a company rather than writing an icon that
 * would start one nobody created: from the menu there is no terminal to read
 * the error in, so the mistake is caught here, where there still is one.
 */
function cmdShortcut(): void {
  if (process.platform !== 'linux') {
    console.log(t('cli.shortcutNotLinux'));
    return;
  }
  if (!isCompanyDir(companyDir)) {
    console.error(t('cli.shortcutNoCompany', { dir: companyDir }));
    process.exit(EXIT.config);
  }

  const company = Company.open(companyDir);
  const name = company.config.name ? `AgentCo · ${company.config.name}` : 'AgentCo';

  // The REAL file of the running CLI, not `process.argv[1]` — that is usually
  // npm's symlink in a bin directory, which is exactly the PATH-dependent
  // thing a menu entry cannot rely on.
  const cli = fileURLToPath(import.meta.url);
  const icon = path.resolve(path.dirname(cli), '../../installer/logo.png');

  // XDG says a relative XDG_DATA_HOME is invalid and must be ignored.
  const xdg = process.env['XDG_DATA_HOME'];
  const dataHome = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
  const dir = path.join(dataHome, 'applications');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, desktopFileName(companyDir));
  fs.writeFileSync(
    file,
    desktopEntry({
      name,
      node: process.execPath,
      cli,
      companyDir,
      ...(fs.existsSync(icon) ? { icon } : {}),
    }),
    'utf8',
  );
  console.log(t('cli.shortcutCreated', { name, file }));
  console.log(t('cli.shortcutNodeNote', { version: process.versions.node }));
}

/**
 * `agentco version` — and `--version`, and `-v`, because people type all three.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 UNTIL 0.1.5 THERE WAS NO WAY TO ASK. `agentco --version` answered      │
 * │ "There is no command '--version'" and exited 2 — the one convention every │
 * │ command-line tool keeps, and this one failed it.                          │
 * │                                                                          │
 * │ The number was never missing: `appVersion()` already wrote it into        │
 * │ `daemon.json` and compared it against the update channel. There was       │
 * │ simply no door. So people did what you do without a door: inferred it     │
 * │ from which files happened to exist — and absence is not a signal.         │
 * │                                                                          │
 * │ It matters most right after `agentco update`, which otherwise gives no    │
 * │ way at all to see whether it worked.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ THE PATH IS PRINTED, and it is the useful half. "Which version" is one
 * question; "which COPY of it am I running" is the other, and on a machine with
 * nvm, volta or a second prefix they have different answers. That is the same
 * confusion `globalPrefixFor` exists to stop the updater walking into.
 */
function cmdVersion(): void {
  console.log(`agentco ${appVersion()}`);
  const kind = installKind();
  console.log(t(kind === 'packaged' ? 'cli.versionPackaged' : 'cli.versionNpm'));
  console.log(`  ${packageRoot()}`);
  /*
   * ⚠ HOW TO REMOVE IT, HERE, RATHER THAN AS AN `agentco uninstall`. A command
   * that removes itself can fail halfway and take away the only thing that
   * could have fixed it — for a saving of a few keystrokes, once. A line that
   * names the right incantation for the door you actually came through costs
   * nothing and cannot break. → the decision, SESSIONS_MEMORY §4.4
   */
  console.log(
    t(kind === 'packaged' ? 'cli.versionRemovePackaged' : 'cli.versionRemoveNpm', {
      package: PACKAGE_NAME,
    }),
  );
}

function cmdHelp(): void {
  console.log(t('cli.help'));
}

// ─────────────────────────────────────────────────────────── helpers

/**
 * A FUNCTION, not a const: `await main()` runs at the top level, i.e. BEFORE the
 * `const`s further down this module are initialised. A string constant at the
 * bottom of the file would throw "Cannot access before initialization" — a
 * function declaration is hoisted.
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A GENERATED FILE CARRIES NO COMMENTS. (settled 03/09)                    │
 * │                                                                          │
 * │ This template used to write a block of explanation above almost every    │
 * │ key, rendered through `t()` so it followed the interface switch. Both    │
 * │ halves of that are gone, and the reason is the same for both:            │
 * │                                                                          │
 * │ A comment written here is frozen at the moment the file is created. It   │
 * │ is never rewritten — every later save goes through `YAML.parseDocument`  │
 * │ + `doc.set()` on individual keys, deliberately, so a comment the user    │
 * │ edited is not clobbered. So the explanation ages in place while the code │
 * │ it describes moves on, and nothing anywhere reports the drift. This      │
 * │ repository has a live example: a `company.yaml` seeded 15/08 still       │
 * │ describes `master:`, `models.cheap` and a pre-migration `charter_file`.  │
 * │                                                                          │
 * │ The explanation lives in `docs/SPEC-token-economy.md` and in the layered │
 * │ prompt dialog instead — both of which get updated with the code.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function companyTemplate(locale: Locale, port: number): string {
  /**
   * ┌──────────────────────────────────────────────────────────────────────
   * │ 🔴 `installed_at` IS THE ONE THING IN THE PACKAGING PLAN THAT CANNOT
   * │ BE DONE LATER. → docs/SPEC-packaging.md §5.1
   * │
   * │ Every policy that treats people who arrived early differently from
   * │ people who arrived later needs to know when somebody arrived — and a
   * │ future release cannot go back in time to find out. Ship without this
   * │ and the choice is gone for good: either break a promise, or keep
   * │ everything free for everyone forever.
   * │
   * │ It is written here, on `init`, and nowhere else. No backfill, and no
   * │ guessing from filesystem timestamps — those survive neither a copy nor
   * │ a restore, so a guess would quietly promote a two-year-old install to
   * │ "new" or the reverse.
   * │
   * │ ⚠ ABSENT MEANS SOMETHING, AND IT IS NOT "unknown": a company with no
   * │ `installed_at` was created BEFORE this field existed, so it is older
   * │ than every company that has one. That is the correct reading and it
   * │ needs no migration — which is the whole reason no backfill is wanted.
   * │
   * │ ⚠ A DATE, NOT A TIMESTAMP. Cohorts are decided by release day; an hour
   * │ and a minute would be a more identifying value bought for nothing.
   * └──────────────────────────────────────────────────────────────────────
   */
  const installedAt = new Date().toISOString().slice(0, 10);
  return `language: ${locale}
installed_at: ${installedAt}

runtime:
  port: ${port}
  concurrency: 4

budgets:
  receipt_tokens: 800
  knowledge_node_tokens: 250
  charter_tokens: 500
  assistant_skills_tokens: 400
  cold_knowledge_tokens: 3000

models:
  eco: claude-haiku-4-5-20251001
  standard: claude-sonnet-5
  deep: claude-opus-5
  master: standard
  planner: standard

mcpServers: {}

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

/**
 * 🔴 NOBODY IS READING stderr WHEN THE MENU STARTED US. → SPEC-packaging §7.4b
 *
 * A `.desktop` entry runs with `Terminal=false`, so a port already taken or a
 * company folder that moved prints its sentence into nothing — and the person
 * who clicked sees an icon that did nothing at all, which reads as "the app is
 * broken". That lesson was paid for once already with the Windows launcher.
 *
 * Only when the entry said so (`AGENTCO_LAUNCHER=desktop`): a terminal user
 * already has the sentence in front of them and does not need a popup too.
 * ⚠ Best-effort by design — a desktop without `notify-send` loses the popup and
 * nothing else, because the same message has already gone to stderr above.
 */
function notifyDesktop(message: string): void {
  if (process.platform !== 'linux' || process.env[DESKTOP_LAUNCHER_ENV] !== 'desktop') return;
  try {
    const child = spawn('notify-send', [t('cli.launchFailedTitle'), message.slice(0, 300)], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      /* no notify-send here — stderr already carries the message */
    });
    child.unref();
  } catch {
    /* same: the popup is the only thing lost */
  }
}

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${msg}\n`);
  if (flags['verbose'] && err instanceof Error && err.stack) console.error(err.stack);
  notifyDesktop(msg);
  const kind = (err as { kind?: string }).kind;
  process.exit(
    kind === 'auth' ? EXIT.auth : kind === 'budget' ? EXIT.budget : kind === 'rate_limit' ? EXIT.rateLimit : EXIT.general,
  );
}
