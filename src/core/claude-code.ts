/**
 * FINDING THE CLAUDE CODE EXECUTABLE. → docs/SPEC-packaging.md §2
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 WHY THIS FILE HAS TO EXIST AT ALL — measured 10/09.
 * │
 * │ The SDK does not run Claude in-process and does not call it over HTTP: it
 * │ SPAWNS a Claude Code executable. And it does not go looking for one. On a
 * │ machine with Claude Code installed globally and working from any terminal,
 * │ `query()` still threw:
 * │
 * │   "Native CLI binary for win32-x64 not found. Reinstall
 * │    @anthropic-ai/claude-agent-sdk without --omit=optional,
 * │    or set options.pathToClaudeCodeExecutable."
 * │
 * │ ⚠ THAT IS NOT THE SDK BEING BAD AT SEARCHING — IT SEARCHES SOMEWHERE ELSE
 * │ ON PURPOSE. A terminal resolves `claude` through PATH. The SDK resolves
 * │ its OWN `optionalDependency` inside `node_modules`, pinned to the exact
 * │ `claudeCodeVersion` it was built against. Reaching for whatever is on PATH
 * │ is precisely what it is avoiding, because that version drifts.
 * │
 * │ ⇒ pointing at the customer's copy means WE cut that pin, deliberately. So
 * │ `probeVersion` below is not decoration: it is the only thing standing
 * │ between us and a protocol mismatch nobody can diagnose.
 * │
 * │ ⚠ AND IT WORKS TODAY ONLY BY ACCIDENT: a developer machine has the
 * │ optional package sitting in `node_modules`. A packaged install will not.
 * │ This is the shape of a bug that appears on the day you ship.
 * └──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';

/** Where a candidate came from. Shown by `doctor`, so these are read by humans. */
export type Via =
  | 'configured'
  | 'sdk-package'
  | 'path-direct'
  | 'npm-global'
  | 'native-installer';

export interface Candidate {
  via: Via;
  path: string;
  ok: boolean;
}

export interface Found {
  path: string;
  via: Via;
}

/**
 * Everything the search reads, handed in rather than taken from the process.
 *
 * ⚠ THIS IS WHAT MAKES THREE OPERATING SYSTEMS TESTABLE FROM ONE MACHINE. The
 * install shapes differ per OS and per install method, and this project has
 * been bitten five times by "correct on the dev's box". With the world injected,
 * `test/claude-code.test.ts` walks a fake tree for win32, darwin and linux
 * without any of them being present. → [[agentco-three-os-always]]
 */
export interface World {
  platform: NodeJS.Platform;
  /** `PATH`, already split. */
  pathEntries: string[];
  home: string;
  /** `%LOCALAPPDATA%` — Windows only, absent elsewhere. */
  localAppData?: string | undefined;
  /** What the user wrote in `company.yaml → claude_path`. Wins over everything. */
  configured?: string | undefined;
  /** `require.resolve` of the SDK's own platform package, when it is installed. */
  sdkPackageDir?: string | undefined;
  exists(p: string): boolean;
  /** Follows a symlink. Returns the input unchanged when it is not one. */
  realpath(p: string): string;
}

/** `claude` on Windows is `claude.exe`; the shims are deliberately NOT here — see below. */
const BIN = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'claude.exe' : 'claude');

/**
 * ⚠ JOIN WITH THE TARGET PLATFORM'S SEPARATOR, NOT THE HOST'S.
 *
 * Plain `path.join` follows whichever machine is executing, so building a POSIX
 * candidate on a Windows box produced `\usr\local\bin\claude`. It was caught by
 * the fake-tree tests on the first run — which is the entire reason `World` is
 * injected: the bug is invisible on the one operating system the developer has.
 * → [[agentco-three-os-always]]
 */
const joiner = (platform: NodeJS.Platform): path.PlatformPath =>
  platform === 'win32' ? path.win32 : path.posix;

/**
 * The layout an `npm i -g` leaves behind, read off a real install on 10/09:
 *
 *   %APPDATA%\npm\claude.cmd  →  "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
 *
 * i.e. the real binary is a fixed hop from the SHIM'S OWN DIRECTORY. That is a
 * structural fact of how npm lays out a global install, not something parsed out
 * of the shim — so it holds without reading or understanding `.cmd` syntax.
 */
const NPM_HOP = ['node_modules', '@anthropic-ai', 'claude-code', 'bin'];

/**
 * ⛔ NEVER MATCH A HASHED DIRECTORY. Measured 10/09: an npm global install also
 * leaves a second, fully working copy under
 * `@anthropic-ai/.claude-code-mEIP8Bfk/…`. Both launch. But that name is an npm
 * install artefact and **changes on the customer's next `npm i -g`** — so a
 * resolver that finds it first works today and breaks silently at their next
 * upgrade, which is the worst failure this file can have.
 */
const HASHED = /[\\/]\.claude-code-[^\\/]+[\\/]/;

/**
 * Walk the candidates in order and return the first that exists, plus everything
 * that was tried.
 *
 * ⚠ THE `tried` LIST IS A FEATURE, NOT DEBUG OUTPUT. `doctor` prints it. The
 * difference between *"Claude Code: not found"* and a list of five paths with a
 * verdict beside each is the difference between a support conversation and a
 * screenshot. → `CONTRIBUTING.md` §an error says what happened AND what to do
 */
export function findClaudeCode(w: World): { found?: Found; tried: Candidate[] } {
  const tried: Candidate[] = [];
  const take = (via: Via, p: string): Found | undefined => {
    if (!p || HASHED.test(p)) return undefined;
    const ok = w.exists(p);
    tried.push({ via, path: p, ok });
    return ok ? { path: p, via } : undefined;
  };

  const bin = BIN(w.platform);
  const j = joiner(w.platform);

  /**
   * ① WHAT THE USER TOLD US. It wins over every clever thing below, and it is
   * the reason this whole file cannot dead-end: any install shape we failed to
   * anticipate — including ones that do not exist yet — is one line of yaml
   * away from working. → [[agentco-test-the-escape-hatch]]
   */
  if (w.configured) {
    const hit = take('configured', w.configured);
    if (hit) return { found: hit, tried };
    // ⚠ AND IT STOPS HERE. A configured path that is wrong is a MISTAKE THE
    // USER MADE and must be reported as such; silently falling through to a
    // different binary would "work" while ignoring what they asked for, and
    // they would have no way to see that.
    return { tried };
  }

  // ② The SDK's own optional package: a dev machine, and the slot a bundled
  //    copy would occupy if `vendor/` is ever filled (SPEC-packaging §2 ②).
  if (w.sdkPackageDir) {
    const hit = take('sdk-package', j.join(w.sdkPackageDir, bin));
    if (hit) return { found: hit, tried };
  }

  for (const dir of w.pathEntries) {
    if (!dir) continue;

    /**
     * ③ `claude` ON PATH — the one lookup that survives every install method,
     *    because all of them put something on PATH. Two shapes:
     *
     *    POSIX: the entry is a SYMLINK into the global tree ⇒ `realpath`, done.
     *    win32: the entry is `claude.cmd`, a shim — and `spawn` with
     *           `shell:false` CANNOT RUN A `.cmd` (recorded in `cli-arm.ts`,
     *           measured). So the shim itself is never a candidate; the hop
     *           below is.
     */
    const direct = j.join(dir, bin);
    if (w.exists(direct)) {
      const real = w.realpath(direct);
      const hit = take('path-direct', real);
      if (hit) return { found: hit, tried };
    }

    // ④ The npm-global hop, taken from the shim's own directory.
    const hop = take('npm-global', j.join(dir, ...NPM_HOP, bin));
    if (hop) return { found: hop, tried };
  }

  /**
   * ⑤ THE NATIVE INSTALLER — and it is LAST because it is the only group that
   * is GUESSED rather than asked. Everything above reads something the machine
   * states about itself; these are locations we happen to know about, and a
   * guessed answer that happens to be wrong is worse than no answer.
   */
  for (const p of nativeLocations(w)) {
    const hit = take('native-installer', p);
    if (hit) return { found: hit, tried };
  }

  return { tried };
}

function nativeLocations(w: World): string[] {
  const bin = BIN(w.platform);
  const j = joiner(w.platform);
  if (w.platform === 'win32') {
    return w.localAppData ? [j.join(w.localAppData, 'Programs', 'claude', bin)] : [];
  }
  return [
    j.join(w.home, '.local', 'bin', bin),
    j.join(w.home, '.claude', 'bin', bin),
    '/usr/local/bin/' + bin,
    '/opt/homebrew/bin/' + bin,
  ];
}

// ────────────────────────────────────────────────── the real world

/**
 * What the user wrote in `company.yaml → claude_path`.
 *
 * Module state, set once when the company config loads — the same shape as
 * `setLocale`. It has to live here because `query()` is called from five
 * modules that each have their own idea of context, and threading a path
 * through all five is five places to forget it.
 */
let configured: string | undefined;

export function setClaudePath(p: string | undefined): void {
  configured = p && p.trim() ? p.trim() : undefined;
  cached = undefined;
}

/** The last successful answer. Cleared by `setClaudePath` and on every daemon start. */
let cached: Found | undefined;

/**
 * ⚠ NOT MEMOISED ACROSS RESTARTS, AND DELIBERATELY CHEAP TO REDO.
 *
 * The customer's next `npm i -g`, or a switch from npm to the native installer,
 * moves the binary. A path written down once and trusted forever turns that into
 * a support ticket; re-resolving on each daemon start is a handful of
 * `existsSync` calls and makes the same event **self-healing**.
 */
export function resolveClaudeCode(): Found | undefined {
  if (cached) return cached;
  const r = findClaudeCode(realWorld());
  cached = r.found;
  return cached;
}

/** For `doctor`: the whole search, not just the verdict. */
export function describeSearch(): { found?: Found; tried: Candidate[] } {
  return findClaudeCode(realWorld());
}

function realWorld(): World {
  return {
    platform: process.platform,
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter),
    home: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    localAppData: process.env['LOCALAPPDATA'],
    configured,
    sdkPackageDir: sdkPackageDir(),
    exists: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    realpath: (p) => {
      try {
        return fs.realpathSync(p);
      } catch {
        return p;
      }
    },
  };
}

/**
 * The SDK's own platform package, if npm installed it here.
 *
 * ⚠ Resolved by NAME through node's own resolver rather than by walking up
 * looking for `node_modules`: hoisting, workspaces and pnpm all put it
 * somewhere different, and node already knows where it is.
 */
function sdkPackageDir(): string | undefined {
  const name = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  try {
    // The package has no entry point to import, so resolve its package.json.
    const url = import.meta.resolve?.(`${name}/package.json`);
    if (!url) return undefined;
    return path.dirname(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  } catch {
    return undefined;
  }
}
