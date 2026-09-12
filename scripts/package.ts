/**
 * BUILD A PACKAGED INSTALL TREE. → docs/SPEC-packaging.md §2
 *
 *   node --experimental-strip-types scripts/package.ts [--out <dir>]
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ THIS IS NOT THE INSTALLER. It builds the FOLDER an installer would lay
 * │ down, which is the part carrying every unknown worth answering early:
 * │
 * │   · does the daemon run from a runtime in a different directory
 * │   · does it still find `web/dist` and its own `package.json`
 * │   · does the Claude Code resolver work with no `node_modules` beside it
 * │   · does anything need `node` on `PATH`
 * │
 * │ Signing, a real installer and a windowless launcher come later and cost
 * │ money and a toolchain. None of them change the answers above, so none of
 * │ them are worth waiting for. → SPEC-packaging §6
 * └──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(url.fileURLToPath(new URL('..', import.meta.url + '/')));
const argv = process.argv.slice(2);
const OUT = path.resolve(argOf('--out') ?? path.join(ROOT, 'out', 'AgentCo'));

function argOf(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

/**
 * ⚠ THE RUNTIME IS COPIED FROM THE BUILD MACHINE, and that is a SMOKE-TEST
 * SHORTCUT, not the shipping behaviour. A real build downloads the official
 * distribution for the target platform and verifies its checksum — copying
 * whatever the builder happens to have is exactly the "correct on the dev's
 * box" trap this project has walked into five times. Stated here so nobody
 * mistakes this script for the release pipeline.
 */
const nodeDir = path.dirname(process.execPath);
const nodeVersion = process.versions.node;

const appDir = path.join(OUT, 'app', pkg.version);
const runtimeDir = path.join(OUT, 'runtime', `node-v${nodeVersion}`);

console.log(`building  ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true });

// ── the runtime layer
copyDir(nodeDir, runtimeDir);
console.log(`  runtime  node-v${nodeVersion}  ${mb(runtimeDir)}`);

// ── the app layer
//
// ⚠ `package.json` GOES WITH IT. `core/version.ts §appVersion` resolves it two
// levels up from `dist/core/`, and `server/static.ts §webRoot` looks for
// `web/dist` beside it — so the packaged layout has to keep that shape, not a
// tidier one. Both were verified by running the result, not by reading them.
copyDir(path.join(ROOT, 'dist'), path.join(appDir, 'dist'));
copyDir(path.join(ROOT, 'web', 'dist'), path.join(appDir, 'web', 'dist'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(appDir, 'package.json'));

/**
 * ⚠ `--omit=optional` IS THE POINT, NOT A SIZE TRICK. It leaves out
 * `@anthropic-ai/claude-agent-sdk-<platform>` — 293 MB of Claude Code marked
 * "© Anthropic PBC. All rights reserved.", which agentco does not redistribute
 * (§2). The resolver finds the customer's own copy instead, and this is the
 * only way to build a tree that actually exercises that.
 */
console.log('  deps     npm install --omit=dev --omit=optional …');
/**
 * ⚠ `node <npm-cli.js>`, NOT `npm.cmd`.
 *
 * The first cut spawned `npm.cmd` and Node refused it outright — `spawnSync
 * npm.cmd EINVAL`. Node will not execute a `.cmd`/`.bat` without a shell, and
 * `cli-arm.ts` has carried exactly that note since 08/26: *"`shell:false` cannot
 * run `.cmd`/`.bat` on Windows (`npx`, `npm`). To wrap a `.cmd`, declare the
 * full path to its interpreter instead — never turn on `shell`."*
 *
 * So the rule was already written down, in this repository, and this script
 * still walked into it. Following it here costs nothing and buys something
 * extra: npm runs on the SAME node, resolved absolutely, with no `PATH` involved.
 */
const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!fs.existsSync(npmCli)) throw new Error(`no npm beside the runtime: ${npmCli}`);
execFileSync(
  process.execPath,
  [npmCli, 'install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error'],
  { cwd: appDir, stdio: 'inherit', windowsHide: true },
);
console.log(`  app      ${pkg.version}  ${mb(appDir)}`);

// ── the pointer
fs.writeFileSync(path.join(OUT, 'current'), path.relative(OUT, appDir), 'utf8');

/**
 * ① `agentco.cmd` — the COMMAND-LINE entry. It shows a console, and that is
 * correct: somebody typing `agentco doctor` wants to read the output.
 */
const launcher = path.join(OUT, 'agentco.cmd');
fs.writeFileSync(
  launcher,
  [
    '@echo off',
    'setlocal',
    'set "HERE=%~dp0"',
    `set "NODE=%HERE%runtime\\node-v${nodeVersion}"`,
    // The bundled runtime goes FIRST so CLI arms and `npx` resolve against the
    // Node we shipped rather than whatever the machine happens to carry. → §9.5
    'set "PATH=%NODE%;%PATH%"',
    // ⚠ WHERE THE COMPANY LIVES. A packaged install has no meaningful `cwd` and
    // nobody types `--dir`, so `resolveCompanyDir` would look beside a directory
    // nobody chose. It sits BESIDE the program — one place to find, nothing to
    // look up, and outside `app\` which is replaced on every update. §7.5
    //
    // ⚠ Only when it exists: from a source checkout this script's output is run
    // directly, and there `--dir` is passed by hand. Setting the variable
    // unconditionally would silently redirect every developer command.
    'if exist "%HERE%company\\company.yaml" set "AGENTCO_COMPANY_DIR=%HERE%company"',
    `"%NODE%\\node.exe" "%HERE%app\\${pkg.version}\\dist\\cli\\index.js" %*`,
  ].join('\r\n'),
  'utf8',
);

/**
 * ② `AgentCo.exe` — THE DOUBLE-CLICK ENTRY. Built by NSIS, which is already the
 * installer's compiler, so this costs no new toolchain. → `installer/launcher.nsi`
 *
 * ⚠ IT REPLACED A `.vbs` THAT WORKED. VBScript gave the same "no console can
 * exist" guarantee, but it is being retired by Microsoft, and — the reason that
 * actually bit — `WScript.Shell.Run(..., 0, ...)` has nowhere to report a
 * failure. Measured: double-click the icon a second time and NOTHING happens,
 * because whatever went wrong printed to a console that did not exist.
 *
 * ⚠ WITHOUT NSIS THIS STEP IS SKIPPED, and the build still produces a working
 * tree — `agentco.cmd` runs everything. A missing optional tool must not stop a
 * developer from building; it should tell them what they did not get.
 */
const nsis = findMakensis();
if (nsis) {
  execFileSync(
    nsis,
    [
      `/DNODEDIR=runtime\\node-v${nodeVersion}`,
      `/DAPPVER=${pkg.version}`,
      '/V2',
      path.join(ROOT, 'installer', 'launcher.nsi'),
    ],
    { cwd: path.join(ROOT, 'installer'), stdio: 'inherit', windowsHide: true },
  );
  // ⚠ COPY THEN DELETE, never `rename`. The repo and the output tree are
  // routinely on different volumes (`D:\…` and `%TEMP%` on `C:`), and
  // `fs.renameSync` fails across devices with EXDEV — a build that works on one
  // machine's disk layout and not another's.
  const built = path.join(ROOT, 'installer', 'AgentCo.exe');
  fs.copyFileSync(built, path.join(OUT, 'AgentCo.exe'));
  fs.rmSync(built, { force: true });
  console.log(`  launcher AgentCo.exe  ${mb(path.join(OUT, 'AgentCo.exe'))}`);
} else {
  console.log('  launcher SKIPPED — makensis not found; agentco.cmd still works');
}

console.log(`\n  TOTAL    ${mb(OUT)}`);
console.log(`\n  terminal:     ${launcher} doctor`);
if (nsis) console.log(`  double-click: ${path.join(OUT, 'AgentCo.exe')}`);

// ─────────────────────────────────────────────────────────────── helpers

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

/**
 * ⚠ Looked up, not assumed to be on `PATH`. The NSIS installer does not add
 * itself, so `makensis` is normally invisible to a shell — and treating that
 * absence as "NSIS is not installed" would silently drop the launcher.
 */
function findMakensis(): string | undefined {
  const guesses = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'NSIS', 'makensis.exe'),
    path.join(process.env['ProgramFiles'] ?? '', 'NSIS', 'makensis.exe'),
  ];
  return guesses.find((p) => fs.existsSync(p));
}

/** Size of a directory tree — or of a single file, which is what tripped it up once. */
function mb(target: string): string {
  let total = 0;
  const walk = (p: string): void => {
    const st = fs.statSync(p);
    if (!st.isDirectory()) {
      total += st.size;
      return;
    }
    for (const e of fs.readdirSync(p, { withFileTypes: true })) walk(path.join(p, e.name));
  };
  walk(target);
  return `${(total / 1024 / 1024).toFixed(1)} MB`;
}
