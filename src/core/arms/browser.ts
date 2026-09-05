/**
 * ONE CATALOG ENTRY = ONE FILE. → `../catalog.ts` · docs/TEST-WALKTHROUGH.md test 18
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY ENTRY THAT NEEDS NO COOPERATION FROM THE OTHER SIDE.
 * │
 * │ Every other entry demands the vendor have an API and be willing to grant a
 * │ key. This entry works with **any system that has a web interface** — even
 * │ 15-year-old internal software with no API, something `SPEC-connectors`
 * │ can't reach because it needs an API to describe. This is the answer to the
 * │ question customers ask most: *"what if my system has no API?"*
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ PIN THE VERSION, DON'T USE `@latest`. → SPEC-arms.md §11d
 *
 * 🔴 AND THIS IS A NUMBER-READING TRAP, recorded so nobody trips on it again:
 * at handshake, the server declares `version: "1.63.0-alpha-2026-08-05"`, and I
 * nearly concluded *"`@latest` returns an alpha build"*. **Wrong.** The
 * package's `dist-tags.latest` is **`0.0.79`, a stable release**; the string
 * `1.63.0-alpha` is the version of the **Playwright core** that package embeds.
 * Two different numbers showing up in the same place.
 *
 * 📌 The thing worth carrying forward: **a stable package can embed an alpha
 * core.** Not a bug, but something to know before promising a customer the
 * word "stable".
 */
const PLAYWRIGHT_MCP_PKG = '@playwright/mcp@0.0.79';

export const BROWSER_ARM: CatalogArm = {
  id: 'browser',
  /**
   * ⚠ NAMED AFTER THE TASK, NOT THE VENDOR — the same approach "Local files" already takes.
   *
   * Two reasons, and the second is the deciding one:
   * ① someone with no coding background **doesn't know what Playwright is**,
   *    so the vendor name is both meaningless to them and makes the card harder to read;
   * ② the §11c trademark debt **disappears**: we use neither Microsoft's name
   *    nor its logo on the front, so there's nothing to ask permission for.
   *    The package name only appears under Advanced.
   */
  name: 'armCat.browser.name',
  icon: '🌐',
  /** The interface draws a globe instead of a plug icon. → ArmIcon.tsx */
  shape: 'browser',
  /**
   * Two sentences, two different jobs, and both grew out of real money spent:
   *
   * ① *"cannot wait for a manual action"* — structurally impossible (a
   *    browser's lifecycle = the lifecycle of one task run), so it has to be
   *    stated **before** planning happens. Measured 29/08: a turn like that
   *    cost **$0.0473** before reporting it couldn't be done.
   * ② *"public pages should use WebFetch/WebSearch"* — the user's call,
   *    29/08: *"whatever can use webSearch/webFetch should, so the user
   *    doesn't assume connecting a browser is somehow fancier"*. The
   *    measurements back that up: a `snapshot` of a news page is ≈47,000
   *    tokens, while WebFetch is many times cheaper.
   */
  /**
   * ⚠ A THIRD CLAUSE ADDED 30/08 — a real case, and it's the ONE leak no fence can close.
   *
   * A worker opens `facebook.com`, the Chrome profile **auto-fills** the
   * user's real email into the sign-in field, and the worker copies it
   * verbatim into an artifact: *"The 'Email address or mobile number' field
   * already has a pre-filled value: …"*. From there it flows on into the
   * Assistant's context, and becomes a Linear lookup brief keyed on that exact
   * email — a confident, plausible, wrong answer.
   *
   * 🔴 Why this CANNOT be patched with `redact.ts` or `guardedZone`: this data
   * reaches the worker through `browser_snapshot`'s **inline tool result**,
   * not through a file. There's no file to strip, no path to block. The only
   * remaining place to stand is **an instruction right on the arm's own line**.
   * ⇒ Reduce, don't eliminate — exactly what `redact.ts` already admits about itself.
   */
  hint:
    'public pages: WebFetch/WebSearch, far cheaper; keep the browser for pages needing a ' +
    'sign-in or a click. It cannot wait for the user mid-turn — to sign in by hand, tell them ' +
    'to press "Sign in / add cookies". A value pre-filled in a form field belongs to the ' +
    'browser, not to the page: never copy it into a file.',
  /**
   * ⚠ THIS SENTENCE MUST STATE THREE THINGS, and all three are easy to trim away for brevity:
   *
   * ① It **opens the page on the machine running agentco**, not on the machine
   *    the person is looking at.
   * ② By default the session is **not kept** — every run is a clean browser,
   *    so a page needing sign-in **won't** load until the keep-session option is turned on.
   * ③ Web content is **a stranger's words**. A worker reads it and then acts,
   *    so a page can try to steer it somewhere else — something no config setting can filter out.
   */
  blurb: 'armCat.browser.blurb',
  price: 'none',
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THESE TWO FLAGS ARE **DELIBERATE REVERSALS OF THE VENDOR'S DEFAULT**.
   * │
   * │ `--headless`  Playwright defaults to **headed**. A worker running in the
   * │               background whose window suddenly pops up while someone is
   * │               doing something else is a rude product. And on a VPS,
   * │               headed **doesn't even exist**.
   * │               ⚠ The "show window" option is only allowed to appear when
   * │               the browser and the daemon are on **the same machine** —
   * │               measured with `isLoopback(socket)`, NOT with `Host` (which
   * │               can be spoofed). The same fence already used for the 📂
   * │               button. Clicking from Hanoi and having the window pop up
   * │               on a Singapore server is a bug already hit once.
   * │
   * │ `--isolated`  the profile lives in RAM, never touches disk ⇒ leaves no
   * │               trace of the customer's sign-in session. Wanting to keep a
   * │               session means declaring `--user-data-dir` **explicitly**,
   * │               and at that point the blast radius is every page ever
   * │               signed into within that profile.
   * │
   * │ Both live in `args` ⇒ **feed into the hash** ⇒ changing them means **a
   * │ different arm entirely**, and the model never sees them, never changes
   * │ them mid-run.
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `--browser` IS A DECISION ABOUT DISK SPACE, not a matter of taste.
   * │ (the user's instruction, 29/08: *"limit downloads filling up the hard drive"*)
   * │
   * │ Leaving it unset ⇒ Playwright uses **its own bundled build** and
   * │ **downloads it**:
   * │   `chromium_headless_shell` **269 MB** · the full build **415 MB**
   * │ and **old builds never get cleaned up on their own** — the machine
   * │ measured 29/08 had **1,340 MB** with two sets (04/2026 and 07/2026)
   * │ sitting side by side.
   * │
   * │ Declaring a **channel** ⇒ uses the browser **already installed** ⇒ **0 bytes**.
   * │   win32  `msedge` — every Windows 10+ machine has it, nothing to install
   * │   darwin `chrome` — not preinstalled by default, but the closest thing to a safe bet
   * │   linux  **left undeclared** — a Linux desktop rarely has any of them
   * │          preinstalled; on a server the right path is the **official
   * │          Docker image**, where Chromium already lives in the image
   * │          (→ `SPEC-deploy.md` §2)
   * │
   * │ ⚠ In exchange: a machine that **doesn't have** that channel fails — but
   * │ it fails **visibly** (an error naming the missing browser), which beats a
   * │ silent failure mode that eats 400 MB of a customer's disk without ever asking them.
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `--output-max-size`: every `browser_navigate` call **auto-writes its
   * snapshot to a file** (measured 29/08 — that's why navigate costs only
   * ~118 tokens instead of ~47,000). Great for context, but it **grows
   * forever**. This ceiling is what turns a cache into a cache **with a
   * floor** — exactly what the user settled on: *"a cache isn't bad if one
   * page comes and goes frequently"*, as long as it doesn't swallow the disk.
   * ✅ CORRECTED 29/08 — **the `--output-dir` debt DOES NOT EXIST.** The
   * worker runs with `cwd` = the office directory, so Playwright creates
   * `.playwright-mcp/` **right inside the office**: automatically in the
   * right place, automatically separated per office, **0 lines of code**.
   * Evidence: `company/offices/canh-tay/.playwright-mcp/` — 26 files, 0.25 MB.
   * The earlier sighting of it inside the repo happened because **the spike
   * ran from the repo root**, meaning I mistook the measurement's `cwd` for
   * the product's `cwd`.
   * → [[agentco-measurement-vs-conclusion]]
   *
   * 🔴 BUT THAT DIRECTORY CONTAINS `console-*.log`, AND CONSOLE LOGS CARRY
   * SESSION TOKENS. Read one file for real: a Facebook URL in it carries
   * `fb_dtsg=…` and `__user=100000000000001`. That's **a sign-in session key
   * sitting as plain text**, inside the office directory — a place a worker
   * can read. Not yet patched.
   *
   * 🔴 A CONSEQUENCE THAT MUST BE CLOSED: `tools/list` returns all 24 tools
   * **without ever launching a browser** (measured 29/08). So a probe that
   * only lists tools would report a **false-green ✓** on a machine with no
   * usable browser, and the user would only find out once handing it a real task.
   * ⇒ This entry's probe **must call a tool that actually opens a browser**. → test 18 box A-4
   */
  spec: {
    kind: 'stdio',
    command: 'npx',
    /**
     * ⚠ `--headless` and `--isolated` live HERE, and the two checkboxes
     * **REMOVE** them (`ArmOption.remove`). Writing it the other way around —
     * a bare base, checkboxes adding flags in — would make the safe state
     * something the user has to **remember to turn on**, and a safe default
     * must never depend on anyone's memory.
     */
    args: ['-y', PLAYWRIGHT_MCP_PKG, '--headless', '--isolated', '--output-max-size', '52428800'],
    argsByOs: {
      win32: ['--browser', 'msedge'],
      darwin: ['--browser', 'chrome'],
    },
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THREE MODES, AND THE USER MUST SEE WHICH ONE THEY'RE CHOOSING. (the user's │
   * │ call, 29/08)                                                              │
   * │                                                                          │
   * │ The next two modes open up exactly what **neither OAuth nor a connector    │
   * │ can reach**: internal software with no API, no OAuth, just a sign-in field.  │
   * │ The customer signs in by hand **once**, in a real window; the session lives  │
   * │ in that **office's own profile**, and the worker reuses it — headless from    │
   * │ then on.                                                                   │
   * │                                                                          │
   * │ ⚠ In exchange, the blast radius equals **every page ever signed into in       │
   * │ that profile**. So the `help` copy for the next two modes has to state that     │
   * │ in plain language, not describe the config.                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  options: [
    {
      id: 'nho-dang-nhap',
      label: 'armCat.browser.keepSession.label',
      /**
       * ⚠ ON BY DEFAULT, a decision that runs against the instinct that "the default should be narrow".
       *
       * This profile is **agentco's own, created EMPTY** — not the user's
       * personal browser. So defaulting to on **does not widen the blast
       * radius immediately**: it only grows by exactly as much as the **user
       * themselves signs into** there. Leaving it off instead throws away the
       * entire cache every run — costs bandwidth, costs time, and a page
       * needing sign-in never loads at all.
       */
      on: true,
      /**
       * 🔴 THE OLD COPY OVERPROMISED, the user caught it 29/08: *"cookies from
       * my main browser can't really transfer over there, not to mention I use
       * both edge and chrome"*.
       *
       * Right. `--user-data-dir` opens a **SEPARATE, empty profile** — it does
       * NOT inherit the sign-ins already sitting in the user's Chrome/Edge (and
       * there's no way it could: an open profile is locked, and cookies are
       * encrypted per profile). The old copy, *"keeps the pages you've signed
       * into"*, reads as *"reuses my own sign-ins"* — promising something that
       * doesn't exist, exactly the §11a-bis failure class: **overpromising is
       * worse than overwarning**.
       */
      /*
        ⚠ Shortened 02/09 (the app is all text right now). The clause *"a
        SEPARATE profile, created empty"* left the screen but did **not** leave
        the product — it's what blocks the misreading "reuses the sign-ins
        already in my Chrome", and that misreading is still possible. If a
        user falls into it again, the right place to say so is the blast-radius
        warning shown when this box gets TICKED, not a paragraph read before
        anyone understands what they're even choosing.
      */
      help: 'armCat.browser.keepSession.help',
      /** A persistent profile and "profile lives in RAM" are mutually exclusive — remove the other one. */
      remove: ['--isolated'],
      dirs: [{ flag: '--user-data-dir', sub: 'profile' }],
    },
    {
      id: 'hien-cua-so',
      label: 'armCat.browser.showWindow.label',
      help: 'armCat.browser.showWindow.help',
      /** "Show window" is simply the **absence** of `--headless`. → `ArmOption.remove` */
      remove: ['--headless'],
      /**
       * The window opens on the **machine running the daemon**. Viewing the
       * interface from a different machine and ticking this box means the
       * window pops up somewhere nobody's looking — the exact 📂-button bug
       * (*"clicked from Hanoi, window popped up on a Singapore server"*). Same
       * fence, fourth place it's applied.
       */
      loopbackOnly: true,
    },
  ],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 NO TIERING — and this is the conclusion of a measurement, not laziness. │
   * │ (the user ran this for real, 29/08, exactly the box C-1 that test 18 predicted) │
   * │                                                                          │
   * │ `browser_navigate` declares `destructive: true` (same as `click`,          │
   * │ `type`), so `tierOf` sorts it into `full`. The consequence at the default   │
   * │ `read` tier: `scopedTools` grants exactly 7 tools — `snapshot · find ·      │
   * │ screenshot · network · console · wait` — **none of which can open a page**.  │
   * │ What the user actually hit:                                                │
   * │                                                                          │
   * │   *"Claude requested permissions to use mcp__…__browser_navigate,           │
   * │    but you haven't granted it yet"*                                       │
   * │                                                                          │
   * │ ⇒ A browser that can't navigate anywhere is **not a low tier, it's broken**.  │
   * │ And it can't be fixed by downgrading `navigate` to `read`: the one-way        │
   * │ rule (25/08) forbids downgrades, and forbids it correctly — opening a URL       │
   * │ **does** have side effects.                                                 │
   * │                                                                          │
   * │ 📌 What's LOST, recorded so it can be weighed later: there's no "view-only"   │
   * │ version. The substitute is `neverTools` (cuts the two arbitrary-JS-execution    │
   * │ tools) — a fence by **tool**, not by **tier**. A real tier would need this        │
   * │ vendor's tools declared as data-driven groups the way GitHub's are, and that's    │
   * │ later work.                                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  tiered: false,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TWO TOOLS NEVER GRANTED — even at the full-access tier. → `catalog.ts`     │
   * │                                                                          │
   * │ Both run **arbitrary JavaScript** on the page. Their annotations declare      │
   * │ it correctly (`destructive: true`), so `tierOf` sorts them into `full` —       │
   * │ valid, and not enough: *"full access"* means **allowed to write**, not          │
   * │ **allowed to run arbitrary code under your signed-in session**. A malicious       │
   * │ page that gets a worker to call `browser_evaluate` gets it to do everything        │
   * │ that page itself could do.                                                  │
   * │                                                                          │
   * │ ⚠ This list ONLY REMOVES ⇒ doesn't touch the one-way rule (25/08). And it's      │
   * │ a **snapshot taken at connect time**: if the vendor adds a new dangerous          │
   * │ tool, this doesn't automatically know — the same limitation already recorded       │
   * │ for `readOnly`.                                                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  neverTools: ['browser_run_code_unsafe', 'browser_evaluate'],
  /** Empty — this entry has no keys at all. That's the entire point of `price: 'none'`. */
  secrets: [],
  /**
   * ⚠ `mark` LEFT BLANK, and that's a decision, not an unfilled field.
   *
   * §11c settled it: without having read the brand guidelines, don't use the
   * logo. Here we **don't need** one — the entry is named after the task, so
   * nothing about it uses Microsoft's trademark. The interface draws an icon
   * by TYPE, same as "Local files".
   * ⇒ This entry ships with **zero brand debt**, not deferred debt.
   */
  brand: { owner: 'Microsoft Corporation', guidelineUrl: null, checkedOn: null },
};
