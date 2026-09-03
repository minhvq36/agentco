import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { compileCliArm, isCliArm } from './cli-arm.js';
import { injectSecrets } from './secrets.js';

/**
 * REMOVING `npx` FROM THE HOT PATH. → docs/SPEC-arms.md §5j
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DECIDED BY MEASUREMENT, NOT ARGUMENT (24/08, `scripts/spike-npx-cost.ts`)│
 * │                                                                          │
 * │   npx starting a server (package ALREADY cached)   3.8–4.3s  run1=run3   │
 * │   node <cached file>                                0.79 – 0.84 s        │
 * │   end-to-end probeArm through npx                   7.7 – 9.2 s          │
 * │   end-to-end probeArm through node                  4.2 – 4.5 s          │
 * │                                                                          │
 * │ And `npx -y --offline` still costs **3,878 ms** ⇒ that cost is NOT the   │
 * │ network, NOT the package download. It's npm's own resolver overhead, and │
 * │ it never gets smaller.                                                   │
 * │                                                                          │
 * │ The real cost is bigger than the connect dialog: every `query()` spawns  │
 * │ a fresh MCP process, so that ~4s is paid on **EVERY TASK with an arm**,  │
 * │ forever.                                                                 │
 * │                                                                          │
 * │ ⚠ The question the user asked while reviewing this: *"if this is such a  │
 * │ free lunch, why wasn't it done already?"*. Straight answer: **it isn't   │
 * │ free.** It spawns a whole package-management layer with three of its own │
 * │ failure modes — the machine has no `npm` · can't reach the registry the  │
 * │ first time · the cache directory got cleaned up. All three are handled   │
 * │ by ONE rule: **any doubt at all, return the ORIGINAL config and let      │
 * │ `npx` run exactly as before.** This patch is only ever allowed to make   │
 * │ things faster, never allowed to break anything.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two halves, deliberately split:
 *
 *   `fastLaunch`      SYNCHRONOUS, pure disk read. Used in `pickMcp` (every
 *                     task) and `probeArm`. Installs nothing, waits for nothing.
 *   `ensureInstalled` ASYNCHRONOUS, installs once. Called when an arm is
 *                     connected and when the daemon opens a company. Fails
 *                     silently — `fastLaunch` will just fall back to `npx`
 *                     on the next run.
 *
 * Split because `pickMcp` is a SYNCHRONOUS path, and turning it async would
 * pull an `await` into the single hottest spot, all to buy an install that
 * should already have finished ahead of time.
 */

/** The arm package store. Just a CACHE — safe to delete anytime, rebuilds itself. */
export function armsCacheDir(): string {
  return path.join(os.homedir(), '.agentco', 'arms');
}

/**
 * The name of the file marking "install finished, and this is the file to run".
 *
 * Writes out a marker instead of re-reading `bin` from a stranger's package's
 * `package.json` on EVERY startup: `bin` can be a string, or a multi-key
 * object, and we only want to decide that EXACTLY ONCE — at install time,
 * where it's safe to throw and log properly. The hot path just reads one line.
 */
const MARKER = '.agentco-entry';

export interface ExecConfig {
  command?: unknown;
  args?: unknown;
  [k: string]: unknown;
}

/**
 * Splits an `npx` line into: the package to install + arguments passed to the server.
 *
 * `['-y', '@scope/pkg@1.2.3', 'D:\\x']` → spec `@scope/pkg@1.2.3`, rest `['D:\\x']`
 *
 * Rule: the FIRST argument that doesn't start with `-` is the package name;
 * everything after it belongs to the server. npx's own flags (`-y`,
 * `--offline`, `--package=…`) all carry a `-`.
 *
 * ⚠ Returns `undefined` for any shape it isn't sure about. This function is
 * allowed to SAY IT DOESN'T KNOW — the caller falls back to `npx` and
 * everything runs exactly as before.
 */
export function npxSpec(config: ExecConfig): { spec: string; rest: string[] } | undefined {
  if (config.command !== 'npx' && config.command !== 'npx.cmd') return undefined;
  const args = Array.isArray(config.args) ? config.args : undefined;
  if (!args || !args.every((a): a is string => typeof a === 'string')) return undefined;

  const at = args.findIndex((a) => !a.startsWith('-'));
  if (at < 0) return undefined;
  const spec = args[at]!;
  // `--package=x` completely changes what the positional argument means (it
  // becomes the COMMAND NAME, not the package name). A rare case, and guessing
  // wrong here means running the wrong package — say we don't know.
  if (args.some((a) => a.startsWith('--package'))) return undefined;
  return { spec, rest: args.slice(at + 1) };
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A DEFAULT NAME INFERRED FROM THE CONFIG ITSELF — instead of showing a     │
 * │ raw HASH. (the user's call, 31/08) → `company.ts §addArm`                 │
 * │                                                                           │
 * │ Answers the user's two questions directly:                                │
 * │                                                                           │
 * │ **① "Does every custom MCP have a `url`?"** — NO. Only `http`/`sse`       │
 * │ entries do. A `stdio` entry has `command`/`args` and **no `url` at all**. │
 * │ So this function reads BOTH shapes, not just one.                         │
 * │                                                                           │
 * │ **② "Is it always the same depth, or does it search for a `url` key at    │
 * │ any depth?"** — **ALWAYS AT THE TOP LEVEL, and searching every depth would│
 * │ be WRONG.** The SDK's `McpHttpServerConfig` is flat: `{type, url,         │
 * │ headers?, …}`. The only nesting is the `{"mcpServers": {"<name>": {…}}}`  │
 * │ wrapper, which `parsePaste` already unwraps beforehand — and that case    │
 * │ already HAS a name (the key itself), so it never reaches this function.   │
 * │                                                                           │
 * │ ⚠ Scanning every depth would eventually catch a `url` sitting inside      │
 * │ `env`/`headers` — that's the vendor's API address, NOT the MCP endpoint.  │
 * │ Naming the arm after it would be **confidently wrong**, and the user would│
 * │ have no way to tell.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `undefined` = couldn't infer one ⇒ the caller falls back to the hash as
 * before. This function is allowed to say IT DOESN'T KNOW; a made-up name is
 * worse than an honest hash.
 */
export function defaultArmLabel(config: unknown): string | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const c = config as { url?: unknown; command?: unknown };

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A CLI declaration: **FOLDER NAME first, program name second.** (user,    │
   * │ 01/09)                                                                   │
   * │                                                                          │
   * │   *"one CLI arm can have several commands, I think the folder name with  │
   * │    the >_ icon for the node is fine"*                                    │
   * │                                                                          │
   * │ The earlier version used the binary name, and it **fails on exactly the  │
   * │ most common case**: a CLI arm is a project with several commands, and    │
   * │ every command of a JS project starts with `node` ⇒ three different       │
   * │ projects produce three nodes on the diagram all named **"node"**. Names  │
   * │ have to be distinguishable, and what tells them apart is the **folder**. │
   * │                                                                          │
   * │ ⚠ The `>_` icon still follows the TYPE (`ArmIcon kind="cli"`), not the   │
   * │ name — so changing the label here doesn't lose the signal *"this is a    │
   * │ command arm"*.                                                           │
   * │                                                                          │
   * │ ⚠ DELIBERATELY DOES NOT concatenate task names (`"count invoices ·       │
   * │ sync"`): that's `does`'s job, already sitting on the directory line. The │
   * │ label answers *"what is this"*, `does` answers *"what can it do"*.       │
   * │                                                                          │
   * │ ⚠ Still allowed to return `undefined`: a made-up name is worse than an   │
   * │ honest hash. This function runs on data **not yet validated by a schema**│
   * │ (called from `addArm`, before any checks), so every field can be missing │
   * │ or the wrong type.                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (isCliArm(config)) {
    const first = (config as { actions?: { run?: unknown; cwd?: unknown }[] }).actions?.[0];
    const cwd = first?.cwd;
    if (typeof cwd === 'string' && cwd.trim()) {
      /**
       * Strip the trailing slash BEFORE calling `basename`: `D:\Records\2026\`
       * gives an empty string otherwise. And strip the `{office}` placeholder
       * too — it's our own syntax, not a piece of a folder name.
       */
      const clean = cwd.trim().split('{office}').join('').replace(/[\\/]+$/, '');
      const base = clean ? path.basename(clean) : '';
      if (base) return base;
    }
    const bin = Array.isArray(first?.run) ? (first.run as unknown[])[0] : undefined;
    if (typeof bin === 'string' && bin.trim()) {
      return path.basename(bin.trim()).replace(/\.(exe|cmd|bat)$/i, '') || undefined;
    }
    return undefined;
  }

  if (typeof c.url === 'string') {
    try {
      // Strip the technical prefix: `mcp.notion.com` → `notion.com`. It
      // carries no information for a human reader, and every MCP endpoint has one.
      const host = new URL(c.url).hostname.replace(/^(www|mcp)\./, '');
      return host || undefined;
    } catch {
      return undefined;
    }
  }

  // stdio: the package name, reusing `npxSpec`'s EXACT parser rather than writing a second one.
  const parsed = npxSpec(config as ExecConfig);
  if (parsed) return packageName(parsed.spec).split('/').pop() || undefined;

  // Not going through `npx` ⇒ take the program name. `path.basename` so an
  // absolute path doesn't turn into a long, unwieldy label.
  if (typeof c.command === 'string' && c.command.trim()) {
    return path.basename(c.command.trim()).replace(/\.(exe|cmd|bat)$/i, '') || undefined;
  }
  return undefined;
}

/** `@scope/name@1.2.3` → `@scope/name`. `name@1.2.3` → `name`. */
export function packageName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/** The install directory for ONE spec. Hashed because package names contain `@`, `/` — invalid in a folder name. */
function dirFor(spec: string): string {
  return path.join(armsCacheDir(), `${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`);
}

/**
 * SYNCHRONOUS, CHEAP, AND MUST NEVER THROW.
 *
 * If already installed, returns a config that runs `node` directly;
 * otherwise returns **the original config, untouched**. The caller doesn't
 * need to know what just happened.
 */
export function fastLaunch<T extends ExecConfig>(config: T): T {
  try {
    const parsed = npxSpec(config);
    if (!parsed) return config;
    const marker = path.join(dirFor(parsed.spec), MARKER);
    if (!fs.existsSync(marker)) return config;
    const entry = fs.readFileSync(marker, 'utf8').trim();
    if (!entry || !fs.existsSync(entry)) return config;
    // `process.execPath`, not the literal string `'node'`: the daemon may be
    // running on a node build that isn't on PATH, and the arm must run on that EXACT node.
    return { ...config, command: process.execPath, args: [entry, ...parsed.rest] };
  } catch {
    // Broken disk · permissions · a strange path — every case falls back to `npx`, by design.
    return config;
  }
}

/** Does nothing if already installed. Returns `true` if a fast-launch config exists after this call. */
export async function ensureInstalled(config: ExecConfig): Promise<boolean> {
  const parsed = npxSpec(config);
  if (!parsed) return false;
  const dir = dirFor(parsed.spec);
  const marker = path.join(dir, MARKER);
  if (fs.existsSync(marker)) return true;

  try {
    fs.mkdirSync(dir, { recursive: true });
    // `--prefix` so npm doesn't walk upward looking for the company's or
    // agentco's own `package.json` — installing into the user's repo by mistake is a side effect nobody expects.
    await run('npm', ['install', parsed.spec, '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error']);
    const entry = findEntry(dir, packageName(parsed.spec));
    if (!entry) return false;
    fs.writeFileSync(marker, entry, 'utf8');
    return true;
  } catch (e) {
    // Can't reach the registry · machine has no npm · no write permission on
    // home. None of these are an incident: the arm still runs through `npx` as before, just slower.
    process.emitWarning(
      `could not pre-install "${parsed.spec}" into the connection store (${(e as Error).message}); ` +
        `the connection still runs through npx, only ~4 seconds slower to start`,
    );
    return false;
  }
}

/**
 * The file to run, decided EXACTLY ONCE, right here.
 *
 * `bin` in `package.json` has two valid shapes (a string, or a
 * name→path object). A package with multiple `bin` entries takes the FIRST
 * one: the same thing `npx <package>` picks when the command name matches
 * the package name, and the multi-bin case barely exists for MCP servers.
 * Can't figure it out ⇒ returns `undefined` → falls back to npx.
 */
function findEntry(dir: string, name: string): string | undefined {
  const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
  const pkgJson = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return undefined;
  const bin = (JSON.parse(fs.readFileSync(pkgJson, 'utf8')) as { bin?: unknown }).bin;
  const rel =
    typeof bin === 'string'
      ? bin
      : bin && typeof bin === 'object'
        ? Object.values(bin as Record<string, string>).find((v) => typeof v === 'string')
        : undefined;
  if (!rel) return undefined;
  const abs = path.join(pkgDir, rel);
  return fs.existsSync(abs) ? abs : undefined;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // `shell: true` on Windows because `npm` is actually `npm.cmd`; `spawn` doesn't resolve that on its own.
    const p = spawn(cmd, args, { shell: process.platform === 'win32', stdio: 'ignore' });
    // A hard ceiling: an install hanging forever would hang the "Try it" button along with it.
    const kill = setTimeout(() => {
      try {
        p.kill();
      } catch {
        /* already dead */
      }
      reject(new Error('npm install exceeded 120 seconds'));
    }, 120_000);
    p.on('error', (e) => {
      clearTimeout(kill);
      reject(e);
    });
    p.on('exit', (code) => {
      clearTimeout(kill);
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
  });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE FUNCTION TO PREPARE A CONFIG, TWO CALL SITES — `pickMcp` (at runtime) │
 * │ and `probeArm` (the "Try it" button). This is an INVARIANT, not a         │
 * │ convenience.                                                              │
 * │                                                                           │
 * │ `injectSecrets` already put this rule into words on 25/08: *"the Test     │
 * │ button has to check the EXACT config that will run; the slightest drift   │
 * │ means it reports ✓ and then breaks the first time a worker actually uses  │
 * │ it"*. But those two call sites still assembled the same **three steps**   │
 * │ by hand (fill keys → fill the path field → strip `npx`), so the rule was  │
 * │ held together by DISCIPLINE rather than structure — and today there's a   │
 * │ fourth step (compiling a CLI declaration) about to be copy-pasted a third │
 * │ time.                                                                     │
 * │                                                                           │
 * │ ⇒ Merged into one function. Same lesson as `mustHaveIdentity`, 30/08: a   │
 * │ fence that exists at both doors but whose **upkeep** only happens at one  │
 * │ is still a hole. → [[agentco-finish-completely]]                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ THE ORDER OF THE THREE STEPS IS MANDATORY, not a matter of taste:
 *   ① `injectSecrets` — fills in blank fields. Must come FIRST, since
 *      `fillRefs` can only walk a plain object, and step ② produces a
 *      **live** `McpServer`.
 *   ② compile CLI — only for `type: 'cli'`.
 *   ③ `fastLaunch` — removes `npx` from the hot path. Only touches configs
 *      that have `command`, so it naturally skips CLI and HTTP.
 */
export function prepareArm(
  name: string,
  config: unknown,
  env: Record<string, string>,
  dirs?: { officeState: string; officeDir: string },
): unknown {
  return finishArm(name, fillArm(config, env, dirs), env, dirs);
}

/**
 * STEP ① — fills in blank fields. Split out because one gate needs to slot in BETWEEN two steps.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE "ANY BLANK FIELDS LEFT?" CHECK MUST SIT BETWEEN FILLING AND        │
 * │ COMPILING. (caught 31/08, on the very first `probeArm` run on a CLI       │
 * │ declaration)                                                              │
 * │                                                                           │
 * │ `probeArm` calls `missingSecretRefs`, and that function inspects things   │
 * │ via `JSON.stringify`. After step ②, the config carries a **live**         │
 * │ `McpServer` ⇒ *"Converting circular structure to JSON"*, thrown straight  │
 * │ at the user from the "Try it" button.                                     │
 * │                                                                           │
 * │ ⚠ AND DON'T FIX IT BY MAKING `missingSecretRefs` TOLERATE THE CIRCULAR    │
 * │ STRUCTURE: it would stop throwing, then return `[]` for **every** CLI     │
 * │ arm — because after compiling, blank fields live inside a closure and are │
 * │ no longer part of the data. The "missing key" gate turns off **silently**,│
 * │ and we land right back on the 25/08 bug it was built to fix: a missing    │
 * │ key gets reported as a wrong key.                                         │
 * │ ⇒ A loud error message beats a silently disabled gate.                    │
 * │ → [[agentco-safe-default-direction]] · [[agentco-catch-hides-premises]]   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function fillArm(
  config: unknown,
  env: Record<string, string>,
  dirs?: { officeState: string; officeDir: string },
): unknown {
  return injectSecrets(config, env, dirs ? { officeState: dirs.officeState } : undefined);
}

/** STEPS ②+③ — compiles a CLI declaration, then removes `npx` from the hot path. */
export function finishArm(
  name: string,
  filled: unknown,
  env: Record<string, string>,
  dirs?: { officeState: string; officeDir: string },
): unknown {
  if (isCliArm(filled)) {
    /**
     * No `dirs` ⇒ no known office ⇒ **do not compile**. Return the
     * declaration as-is so the caller reports its own error where it
     * understands the context, instead of us guessing a `cwd` and letting the
     * child process run in the daemon's own directory.
     * → [[agentco-safe-default-direction]]
     */
    if (!dirs) return filled;
    return compileCliArm(name, filled, { officeDir: dirs.officeDir, env });
  }
  return fastLaunch(filled as Record<string, unknown>);
}
