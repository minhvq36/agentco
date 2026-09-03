#!/usr/bin/env node
/**
 * CLI. → docs/SPEC-cli.md §2, docs/SPEC-offices.md
 *
 * Error-message rule: every error prints WHAT HAPPENED + WHAT TO DO NEXT, one
 * sentence each. The customer does not write code — stack traces stay hidden by
 * default.
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
import { resolveLocale, setLocale, t, type Locale } from '../i18n/index.js';
import { formatUSD } from '../i18n/fmt.js';

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
   * ⚠ `Intl` is in the list because the POSIX variables are NOT SET ON WINDOWS.
   * Reading only `LANG`/`LC_*` would hand every Windows user `en` regardless of
   * their machine — the "correct on the dev's box" failure class this project
   * has now walked into five times. `Intl.DateTimeFormat().resolvedOptions()`
   * reads the real OS setting on Windows, macOS and Linux alike.
   */
  const locale = resolveLocale(
    [
      process.env['LC_ALL'],
      process.env['LC_MESSAGES'],
      process.env['LANG'],
      Intl.DateTimeFormat().resolvedOptions().locale,
    ],
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
  fs.writeFileSync(pp.configFile, companyTemplate(locale), 'utf8');

  console.log(t('cli.created', { dir: companyDir }));
  console.log(t('cli.createdCompanyYaml'));
  console.log(t('cli.createdOffices'));
  console.log(t('cli.createdEmpty'));
  console.log(t('cli.createdNext'));
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
  const port = typeof flags['port'] === 'number' ? flags['port'] : company.config.runtime.port;
  const host = typeof flags['host'] === 'string' ? flags['host'] : '127.0.0.1';
  const token = process.env['AGENTCO_TOKEN'];

  const daemon = await serve({
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

  writeDaemonFile(pp, {
    pid: process.pid,
    port: daemon.port,
    url: daemon.url,
    version: '0.0.1',
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

  // Auth: one real, very cheap call. This is the most common first-time failure.
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
        authNote = authOk ? t('cli.checkAuthOk') : String(msg['subtype']);
      }
    }
  } catch (err) {
    authNote = err instanceof Error ? err.message.slice(0, 90) : t('cli.unknownError');
  }
  checks.push([t('cli.checkAuth'), authOk, authNote || t('cli.checkAuthHint')]);

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
function companyTemplate(locale: Locale): string {
  return `language: ${locale}

runtime:
  port: 7317
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

function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${msg}\n`);
  if (flags['verbose'] && err instanceof Error && err.stack) console.error(err.stack);
  const kind = (err as { kind?: string }).kind;
  process.exit(
    kind === 'auth' ? EXIT.auth : kind === 'budget' ? EXIT.budget : kind === 'rate_limit' ? EXIT.rateLimit : EXIT.general,
  );
}
