/**
 * MANUAL SIGN-IN INTO A BROWSER ARM'S PROFILE.
 * → docs/TEST-WALKTHROUGH.md test 18 step E · `arms/browser.ts §options`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS FEATURE EXISTS — a real case, hit four times on 29/08.          │
 * │                                                                          │
 * │ A worker's browser lifecycle = the lifecycle of one TASK RUN. Task ends  │
 * │ ⇒ the MCP process is closed ⇒ the window disappears. The user is waiting │
 * │ for an SMS code, mid-way through Google's "set up phone number" step,    │
 * │ and the window closes on them mid-flow:                                  │
 * │                                                                          │
 * │   *"Hey, I'm in the middle of signing in with my phone number, hang on"* │
 * │                                                                          │
 * │ There is no room anywhere in a task's lifecycle for **a human to act**.  │
 * │ So this isn't a task — it's an action the daemon itself performs, in the │
 * │ same family as `probeArm`.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 AND IT DOES NOT GO THROUGH PLAYWRIGHT — the single most important      │
 * │ thing to remember about this file.                                        │
 * │                                                                           │
 * │ The first instinct is to open the window **through MCP** and keep the     │
 * │ session alive. Wrong, because what we actually need to avoid is **a       │
 * │ browser that's being automated**: Google/Facebook detect                  │
 * │ `navigator.webdriver`, detect CDP, and block sign-in right there.         │
 * │ Opening through Playwright means signing in behind the exact door         │
 * │ they're guarding.                                                         │
 * │                                                                           │
 * │ ⇒ Open a **normal** OS window, pointed at **the same profile**. No CDP,   │
 * │ no automation flags — to the vendor, that's a real human. Cookies land    │
 * │ in the profile, and the next Playwright run reuses them.                  │
 * │                                                                           │
 * │   **Sign in with a normal window. Use it through Playwright.**            │
 * │   Two jobs, two tools, one shared profile.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { t } from '../i18n/index.js';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THREE OPERATING SYSTEMS, DECLARED AS DATA. (the user flagged this,        │
 * │ 29/08 — the sixth time)                                                   │
 * │                                                                           │
 * │ The order within each array is TRY order, and it must match               │
 * │ `arms/browser.ts §argsByOs`: whatever channel the catalog entry tells     │
 * │ Playwright to use, this opens that exact browser. A mismatch ⇒ signing    │
 * │ in to the profile with Edge and then running tasks with Chrome — two      │
 * │ browsers, one profile directory, and Chromium will **refuse** it or       │
 * │ corrupt the profile. This is the spot where the two files must agree.     │
 * │                                                                           │
 * │ `win32`/`darwin` use absolute paths because both vendors install to a     │
 * │ fixed location; `linux` uses a COMMAND NAME because every distro puts     │
 * │ it somewhere different — there, `PATH` is the actual source of truth,     │
 * │ not a list we're guessing at.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const BROWSER_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: [
    `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
};

/**
 * The first browser that **actually exists** on this machine.
 *
 * ⚠ Linux returns an UNVERIFIED COMMAND NAME — running `Test-Path` on a bare
 * command name is meaningless, and scanning `PATH` here would just be
 * rebuilding `which` by hand. A wrong name means `spawn` throws, and that
 * error names the exact missing command — a usable error, not a guess. The
 * safe direction: **better a loud failure than silently opening nothing**.
 */
export function findBrowser(platform: string = process.platform): string | undefined {
  const list = BROWSER_CANDIDATES[platform] ?? [];
  if (platform === 'linux') return list[0];
  return list.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** An office's profile — computed in ONE place, so the sign-in door and the arm never disagree. */
export function profileDir(officeStateDir: string): string {
  return path.join(officeStateDir, 'profile');
}

interface OpenSession {
  office: string;
  url: string;
  since: number;
  child: ChildProcess;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LOCK BY **OFFICE**, NOT BY ARM. (the user asked, 29/08)                   │
 * │                                                                           │
 * │ Chromium **locks** `user-data-dir`: two processes pointing at the same    │
 * │ profile means the second one fails. And the profile belongs to the        │
 * │ **office** — two browser arms in the same office share it (deliberately:  │
 * │ one arm for signing in with a visible window, another for running tasks   │
 * │ headless). ⇒ Locking by arm would be locking **the wrong resource**, and  │
 * │ it would let exactly this failure through.                                │
 * │                                                                           │
 * │ Held in RAM, not written to a file: a lock file **orphaned by a crash**   │
 * │ just creates the need for a second cleanup mechanism. The same choice     │
 * │ made for OAuth's `pending`, and the same *1 replica* constraint recorded  │
 * │ at `SPEC-deploy` §5③.                                                     │
 * │                                                                           │
 * │ 🔴 THE LOCK MUST SELF-HEAL, because every lock that doesn't self-heal     │
 * │ eventually becomes permanent:                                             │
 * │   · the user closes the window → the process's `exit` clears the lock     │
 * │     (DETERMINISTIC, not a guessed timeout)                                │
 * │   · the daemon restarts          → RAM is clean, no orphaned state        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const open = new Map<string, OpenSession>();

export function loginOpen(office: string): boolean {
  return open.has(office);
}

/** Who has it open, and since when — so a rejection can say something concrete. */
export function loginInfo(office: string): { url: string; since: number } | undefined {
  const s = open.get(office);
  return s ? { url: s.url, since: s.since } : undefined;
}

export class LoginError extends Error {}

/**
 * Opens the sign-in window. Returns once the window is **open**, not once the
 * user is done — the lock clears whenever they close it.
 *
 * ⚠ `url` must be `http`/`https`. A `file://` here would open the server's own
 * disk through a window with full profile privileges — not what this button
 * exists to do.
 */
export function startLogin(opts: {
  office: string;
  officeStateDir: string;
  /** Empty ⇒ opens the browser's default page. The user types the rest themselves. */
  url?: string;
  /** `office.currentState` — blocks while a task is running, same rule as `archiveOffice`. */
  working: boolean;
  platform?: string;
}): { profile: string; browser: string } {
  if (opts.working) {
    throw new LoginError(
      t('browserLogin.officeBusy'),
    );
  }
  if (open.has(opts.office)) {
    throw new LoginError(t('browserLogin.alreadyOpen'));
  }

  /**
   * ⚠ THE URL IS OPTIONAL (the user's call, 29/08: *"just open the office's
   * chromium, let the user do whatever they want"*).
   *
   * The first version required typing an address. Unnecessary: once the window
   * is open, they can type into the address bar themselves — requiring it
   * upfront just adds a step for the same outcome. And it **misdescribed what
   * this actually is**: this isn't "open a page", it's **open the office's
   * browser**.
   */
  let u: URL | undefined;
  if (opts.url?.trim()) {
    try {
      u = new URL(opts.url);
    } catch {
      throw new LoginError(t('browserLogin.badUrl', { url: opts.url }));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new LoginError(t('browserLogin.badScheme'));
    }
  }

  const platform = opts.platform ?? process.platform;
  const browser = findBrowser(platform);
  if (!browser) {
    throw new LoginError(
      t('browserLogin.noBrowser'),
    );
  }

  const profile = profileDir(opts.officeStateDir);
  fs.mkdirSync(profile, { recursive: true });

  /**
   * ⚠ NOT through a shell. A URL can always contain `&`, and going through a
   * shell on Windows fails **100% of the time** — hit this on 24/08 with an
   * OAuth URL. `spawn` with an argument array delivers each string intact to
   * the child process.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TWO FLAGS TO CLEAR THE BROWSER'S WELCOME SCREEN. (user, 29/08: *"it       │
   * │ shows a panel asking to sync with an account instead of just opening      │
   * │ the browser, that's kind of annoying too"*)                               │
   * │                                                                           │
   * │ This profile is **always new to the browser** (it isn't the user's own    │
   * │ personal profile), so Edge/Chrome show the welcome screen + sync sign-in  │
   * │ prompt **every single time**. The user clicked the button to sign in to   │
   * │ one page, not to answer a question about a browser account.               │
   * │                                                                           │
   * │ ⚠ DELIBERATELY NOT adding `--disable-extensions`: an extension the        │
   * │ machine forces onto it (IDM, Grammarly via the registry) causes real      │
   * │ noise, but disabling all of them also disables the **password manager**   │
   * │ — exactly what someone needs while signing in. Noise is visible and       │
   * │ ignorable; missing it leaves them stuck.                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const quiet = ['--no-first-run', '--no-default-browser-check'];
  const child = spawn(browser, [`--user-data-dir=${profile}`, ...quiet, ...(u ? [u.toString()] : [])], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  open.set(opts.office, { office: opts.office, url: u?.toString() ?? '', since: Date.now(), child });
  const clear = () => {
    if (open.get(opts.office)?.child === child) open.delete(opts.office);
  };
  child.on('exit', clear);
  child.on('error', clear);

  return { profile, browser };
}

/** Closes it on their behalf (the "Done" button). The user closing the window themselves has the same effect. */
export function endLogin(office: string): boolean {
  const s = open.get(office);
  if (!s) return false;
  try {
    s.child.kill();
  } catch {
    /* already closed itself — `exit` already cleared the lock */
  }
  open.delete(office);
  return true;
}
