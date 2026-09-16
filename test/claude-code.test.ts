import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findClaudeCode, type World } from '../dist/core/claude-code.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 🔴 FINDING CLAUDE CODE — THREE OPERATING SYSTEMS, FROM ONE MACHINE.
 * → docs/SPEC-packaging.md §2 · src/core/claude-code.ts
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ The whole product runs through a Claude Code executable that agentco does
 * │ not ship, and the SDK does not go looking for one — measured 10/09, on a
 * │ machine where `claude` works in any terminal. So this resolver is not a
 * │ convenience: **it is the thing that decides whether anything runs at all.**
 * │
 * │ ⚠ AND IT IS EXACTLY THE SHAPE THIS PROJECT HAS BEEN BITTEN BY FIVE TIMES:
 * │ four install methods across three operating systems, of which a developer
 * │ can see one. So the world is injected and the trees below are fake — win32,
 * │ darwin and linux are all tested here, on whichever machine happens to run
 * │ the suite. → [[agentco-three-os-always]]
 * └──────────────────────────────────────────────────────────────────────────
 */

/** A fake machine. `files` is the set of paths that exist; nothing else does. */
function world(over: Partial<World> & { files?: string[] }): World {
  const files = new Set((over.files ?? []).map((f) => f.toLowerCase()));
  return {
    platform: 'linux',
    pathEntries: [],
    home: '/home/u',
    exists: (p) => files.has(p.toLowerCase()),
    realpath: (p) => p,
    ...over,
  };
}

const WIN_NPM = 'C:\\Users\\u\\AppData\\Roaming\\npm';
const WIN_REAL = path.win32.join(WIN_NPM, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

test('🔴 win32 · npm global: the SHIM is on PATH, the binary is one structural hop away', () => {
  /**
   * Read off a real install: `claude.cmd` contains
   *   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
   * — relative to the shim's OWN directory. So no `.cmd` is ever parsed, and no
   * `.cmd` is ever handed to `spawn`, which could not run it anyway
   * (`shell:false` cannot execute `.cmd` on Windows — recorded in `cli-arm.ts`).
   */
  const r = findClaudeCode(
    world({ platform: 'win32', pathEntries: [WIN_NPM], files: [WIN_REAL] }),
  );
  assert.equal(r.found?.path, WIN_REAL);
  assert.equal(r.found?.via, 'npm-global');
});

test('🔴 a HASHED npm directory is never accepted, even when it works', () => {
  /**
   * Measured 10/09: an npm global install leaves a second, fully launchable copy
   * under `@anthropic-ai/.claude-code-mEIP8Bfk/…`. Taking it would work today and
   * break on the customer's next `npm i -g`, because that name is regenerated —
   * a silent break, at a moment nobody connects to agentco.
   */
  const hashed =
    'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\.claude-code-mEIP8Bfk\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe';
  const r = findClaudeCode(
    world({ platform: 'win32', pathEntries: [WIN_NPM], sdkPackageDir: path.dirname(hashed), files: [hashed] }),
  );
  assert.equal(r.found, undefined, 'a hashed path was accepted');
  assert.ok(!r.tried.some((c) => c.path === hashed), 'it should not even be offered as a candidate');
});

test('🔴 POSIX · npm global: the PATH entry is a SYMLINK, so realpath is the whole answer', () => {
  const link = '/usr/local/bin/claude';
  const real = '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude';
  const r = findClaudeCode(
    world({
      platform: 'linux',
      pathEntries: ['/usr/local/bin'],
      files: [link, real],
      realpath: (p) => (p === link ? real : p),
    }),
  );
  assert.equal(r.found?.path, real);
  assert.equal(r.found?.via, 'path-direct');
});

test('darwin · the native installer, found only after everything on PATH failed', () => {
  const native = '/home/u/.local/bin/claude';
  const r = findClaudeCode(
    world({ platform: 'darwin', pathEntries: ['/nothing/here'], files: [native] }),
  );
  assert.equal(r.found?.path, native);
  assert.equal(r.found?.via, 'native-installer');
  // …and the ones that failed are all reported, in order, for `doctor` to print.
  assert.ok(r.tried.length > 1, 'the search must record what it tried, not just what it found');
  assert.equal(r.tried.at(-1)?.ok, true);
});

test('🔴 a CONFIGURED path wins over everything — including a working one', () => {
  // The escape hatch has to outrank cleverness, or it is not an escape hatch.
  const mine = '/opt/mine/claude';
  const npmish = '/usr/local/bin/claude';
  const r = findClaudeCode(
    world({ pathEntries: ['/usr/local/bin'], configured: mine, files: [mine, npmish] }),
  );
  assert.equal(r.found?.path, mine);
  assert.equal(r.found?.via, 'configured');
});

test('🔴 a WRONG configured path is an error, NOT a fallback', () => {
  /**
   * Falling through to some other binary would "work" while quietly ignoring
   * what the user asked for — and they would have no way to see that it was
   * ignored. A configured path that does not exist is a mistake to report.
   */
  const working = '/usr/local/bin/claude';
  const r = findClaudeCode(
    world({ pathEntries: ['/usr/local/bin'], configured: '/typo/claude', files: [working] }),
  );
  assert.equal(r.found, undefined, 'it silently used a different binary');
  assert.deepEqual(r.tried.map((c) => c.via), ['configured']);
  assert.equal(r.tried[0]?.ok, false);
});

test('the SDK package (a dev machine) is preferred over the customer PATH', () => {
  // It is the version the SDK was built against, so when it is present it is the
  // one that cannot be out of step. → `claudeCodeVersion`
  const sdk = '/repo/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64';
  const r = findClaudeCode(
    world({
      pathEntries: ['/usr/local/bin'],
      sdkPackageDir: sdk,
      files: [`${sdk}/claude`, '/usr/local/bin/claude'],
    }),
  );
  assert.equal(r.found?.via, 'sdk-package');
});

test('nothing anywhere: no crash, no guess, and the trail is still recorded', () => {
  const r = findClaudeCode(world({ platform: 'win32', pathEntries: ['C:\\nope'], localAppData: 'C:\\lad' }));
  assert.equal(r.found, undefined);
  assert.ok(r.tried.length > 0, 'even a total miss must say where it looked');
  assert.ok(r.tried.every((c) => !c.ok));
});

test('🔴 nothing in the repository turns a file URL into a path by hand', () => {
  /*
   * A file URL is PERCENT-ENCODED. `new URL(u).pathname` gives back
   * `/C:/Program%20Files/…`, and on a Windows CI runner whose temp directory is
   * the 8.3 name `RUNNER~1`, `/C:/Users/RUNNER%7E1/…`. Stripping the leading
   * slash with a regex leaves every one of those encoded, so the path does not
   * exist and the code SILENTLY takes the other branch.
   *
   * `core/claude-code.ts §sdkPackageDir` did exactly this, inside a five-tier
   * detector whose entire value is being able to say what it looked at: on any
   * machine with a space in its paths that tier could never match, and nothing
   * anywhere reported it. It was found 17/09/2026 only because the same line
   * had been copied into a test fixture, where CI's `RUNNER~1` broke it loudly.
   *
   * So the gate is the CLASS, not the two lines: `fileURLToPath` is the only
   * way this conversion happens. → SESSIONS_MEMORY §7
   */
  const roots = ['src', 'scripts', 'test', path.join('web', 'src')];
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') walk(p);
      } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const body = fs.readFileSync(p, 'utf8');
        body.split('\n').forEach((line, i) => {
          // ⚠ Comments are skipped, or this gate flags the paragraph above it
          // and the one in `claude-code.ts` explaining the fix. A gate that
          // reads code has to read code.
          const t = line.trim();
          if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
          if (/new URL\([^)]*\)\.pathname/.test(line)) offenders.push(`${p}:${i + 1}`);
        });
      }
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));

  assert.deepEqual(offenders, [], `use fileURLToPath instead:\n${offenders.join('\n')}`);
});

test('an empty PATH entry is skipped rather than turned into a relative path', () => {
  // `PATH` ending in `;` yields an empty string; `path.join('', 'claude')` is
  // `claude`, a RELATIVE path that would resolve against the daemon's cwd.
  const r = findClaudeCode(world({ pathEntries: ['', '/usr/local/bin'], files: ['/usr/local/bin/claude'] }));
  assert.equal(r.found?.path, '/usr/local/bin/claude');
  // ⚠ `path.posix`, not `path` — on a Windows runner the host flavour calls a
  // POSIX absolute path relative, and the assertion would pass for the wrong reason.
  assert.ok(!r.tried.some((c) => !path.posix.isAbsolute(c.path)), 'a relative candidate was produced');
});
