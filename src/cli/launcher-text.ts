/**
 * The text of the packaged command-line entry, `agentco.cmd`.
 * → scripts/package.ts · docs/SPEC-packaging.md §3.7
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ IT IS A FUNCTION SO A TEST CAN READ IT WITHOUT BUILDING A RELEASE.     │
 * │                                                                          │
 * │ The rule it has to keep — ask `current`, fall back to something that      │
 * │ exists, never fall silent — used to be checked by running the whole       │
 * │ packaging script and reading the file it produced. That test copied ~90MB │
 * │ of Node runtime, ran an `npm install`, and needed `web/dist`, which       │
 * │ `npm test` does not build. It passed here and failed on CI, at the only   │
 * │ moment the suite runs there: a release. A rule about a string is checked  │
 * │ against the string.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * @param nodeVersion the runtime shipped beside the app (`runtime/node-v<x>`)
 * @param appVersion  the version this tree was built as — the FALLBACK only
 */
export function agentcoCmd(nodeVersion: string, appVersion: string): string {
  return [
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
    //
    // 🔴 WHICH VERSION TO RUN COMES FROM `current`, NOT FROM THIS FILE.
    //
    // It used to be written in here as a literal, and `AgentCo.exe` had it
    // compiled in — so `current` was a pointer nothing read, and replacing
    // `app\` with a newer folder changed nothing at all. An updater can only
    // work if the thing that CHOOSES lives outside the thing being replaced.
    // → SPEC-packaging §3.7 · SESSIONS_MEMORY §4.2 debt #5
    //
    // ⚠ The literal below is the FALLBACK, and it is the version this tree was
    // built as: a missing, empty or stale `current` must land on something that
    // exists rather than on nothing. Silence is the failure mode this launcher
    // was rewritten from a `.vbs` to avoid, so the last resort still SPEAKS.
    'set "APPDIR="',
    'if exist "%HERE%current" set /p APPDIR=<"%HERE%current"',
    `if not defined APPDIR set "APPDIR=app\\${appVersion}"`,
    `if not exist "%HERE%%APPDIR%\\dist\\cli\\index.js" set "APPDIR=app\\${appVersion}"`,
    'if not exist "%HERE%%APPDIR%\\dist\\cli\\index.js" (',
    '  echo AgentCo: no app found under "%HERE%".',
    '  echo Reinstall from agent-co.app to restore it.',
    '  exit /b 2',
    ')',
    '"%NODE%\\node.exe" "%HERE%%APPDIR%\\dist\\cli\\index.js" %*',
  ].join('\r\n');
}
