# SPEC — Packaging, updates and licensing

> Settled 10/09/2026, after a long reasoning pass. Read alongside `SPEC-cli.md` §6.1
> (the desktop build ships its own Node) and `SPEC-deploy.md` (VPS · Docker · domain).
>
> ⚠ This file describes **how agentco reaches a customer and stays current**. It does
> not describe what the paid tier contains — that is a business decision, still open,
> and §5 says so out loud rather than guessing.

---

## 0. The premise everything else rests on

**The source is public.** FSL, on GitHub, and `BUSINESS.md` settled on 03/08 —
marked *"do not reopen"* — that we sell **the packaged build, updates and support,
not the bits**. Anyone can clone and build.

Three consequences follow, and every section below obeys them:

1. **No licence mechanism is a fence.** It cannot be; the door beside it is open by
   design. It is a **receipt**, and it is designed as one.
2. **Whatever unlocks a paid feature ends up on the customer's disk**, in JavaScript,
   readable and editable. Obfuscation buys nothing measurable. Do not spend on it.
3. ⇒ **The thing worth protecting is not "who can run it".** It is that the official
   build is signed, current, supported, and obviously safer than a stranger's copy —
   for a program that reads the customer's files and runs commands on their machine.

### 🔴 The one-sentence test for every mechanism in this file

> **When this fails, who is standing there?**

An activation server, a hardware ID, a seat counter and a licence ping all fail on
**the paying customer's machine only** — the pirate removed them. A mechanism whose
failure lands exclusively on honest users is protecting the wrong person. That test
is why §4 has no activation and §5 has no hardware binding.

---

## 1. Version — ONE source of truth

🔴 **Fix this before building anything on top of it.** Today the number lives twice:

```
src/server/server.ts §pkgVersion()   reads package.json          ← the truth
src/cli/index.ts:155  version: '0.0.1'                           ← a hand-typed literal
```

`daemon.json` therefore carries a version that nobody updates, and the updater's
entire job is **comparing that number**. Two sources of truth for the one value the
whole of §3 rests on.

- `package.json → version` is the source. Everything else reads it.
- `pkgVersion()` moves somewhere both the server and the CLI can import.
- It appears in: `daemon.json` · `GET /healthz` · `agentco --version` ·
  the update check · the installed folder name (§2) · the user agent of the update
  fetch, if any.

**Numbering: semver, and the minor is the release train.** `0.x` while v0 is free
(§5). A version is never reused; a build is never re-cut under a version that has
already been published, because §3's `sha256` is what makes an update verifiable and
two different bytes under one version breaks that.

---

## 2. Install layout — four lifetimes, four directories

### 🔴 MEASURED 10/09, AND IT MOVED THE WHOLE PLAN

The first draft of this section said "~100 MB, and the big layer changes twice a
year". Both halves were wrong, and the reason is a dependency nobody had opened:

```
node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe   293.0 MB
node runtime                                                        91.5 MB
web/dist                                                             7.9 MB
dist/                                                                3.8 MB
                                                                 ─────────
                                                              ≈ 400 MB on disk
```

`@anthropic-ai/claude-agent-sdk` is only 4.3 MB, but it declares **per-platform
native binaries as `optionalDependencies`** — `…-win32-x64`, `…-darwin-arm64` and six
more — and `npm install` silently pulls the one matching the host. The Claude Code
executable it fetches is **293 MB**, and it is what actually runs every task.

Two consequences, and the second is the one that broke the plan:

1. **Cross-building needs explicit targets.** `npm i` on Windows fetches only
   `win32-x64`; a macOS installer built from a Windows box would ship no executable at
   all. npm 10's `--os` / `--cpu` overrides, or a build job per platform.
2. ⚠ **The 293 MB layer is pinned to the SDK version** (`claudeCodeVersion` in its
   `package.json`), and the SDK is bumped far more often than Node is. So the
   assumption "the big layer is stable" is **false**, and with it the promise that
   every update is ~10 MB. → §3.5

### ✅ …AND THE 293 MB DOES NOT HAVE TO SHIP AT ALL. MEASURED, SAME DAY.

Three experiments, in order, on a machine with Claude Code installed the ordinary way
(`npm i -g @anthropic-ai/claude-code`):

```
① npm install --omit=optional            →  node_modules is 29.7 MB, not 322 MB
② query() with no binary present          →  THROWS
   "Native CLI binary for win32-x64 not found. Reinstall … without --omit=optional,
    or set options.pathToClaudeCodeExecutable."
③ query({ pathToClaudeCodeExecutable: <the customer's own claude.exe> })
                                          →  init arrived · RESULT: success · "ok"
```

⇒ **agentco never has to carry Anthropic's binary in its installer.** `pathToClaude
CodeExecutable` is a supported, documented input, and a real task runs end to end
through a copy agentco did not ship.

### Which copy it points at — three shapes, and the middle one wins

| | ① bundle in the installer | ② **fetch at first run, into our own directory** | ③ point at the customer's own |
|---|---|---|---|
| **stability** | best — we pin it, we test it | **best — same** | **worst** — depends on what they installed and when they next upgrade |
| redistributing *"All rights reserved"* | ❌ open question | ✅ none — npm → the customer, directly | ✅ none |
| installer size | ~400 MB | **~135 MB** | ~135 MB |
| network needed | at download | **at first run** | at download |
| breaks when the customer upgrades Claude Code | no | **no** | ⚠ yes, silently |
| works if they never installed Claude Code | yes | **yes** | ❌ no |

### ✅ DECIDED 10/09: ③ — the customer installs Claude Code, agentco finds it

**① is the most stable**, for the same reason bundling Node is: our copy, our pinned
version, isolated from the machine. It is ruled out by the licence, which is a gate and
not a preference.

**② keeps ①'s stability without redistributing anything** — agentco's own bundled
runtime carries `npm` (measured 10/09 inside the 91.5 MB Node distribution), so on
first run it could fetch the package into `vendor/` straight from Anthropic's registry.

**③ was chosen anyway, and the reasons are good ones:**

- 293 MB is heavy, and ② would put a **second** copy on machines that already have one.
- **The customer's Claude Code is useful to them beyond agentco.** It is not a private
  copy that serves only us, so asking for it is not a tax on them.
- Nothing to download on first run, nothing to fail behind a proxy.

⇒ **② is not deleted, it is the reopen condition.** If real customers turn out to
stumble on installing Claude Code — measured in support, not guessed — `vendor/` is
already in the layout and the fetch is ~20 lines.

#### 🔴 What ③ actually costs, and none of it is optional

> **"They install it and then it just works" is FALSE, and it was measured.**
> On a machine with Claude Code installed globally, `query()` still threw
> `Native CLI binary … not found`. **The SDK does not go looking.**

So everything below is the mechanism of ③, not polish on top of it:

- **The resolver is the feature.** Without it a customer can install Claude Code
  correctly, sign in correctly, and still have an agentco that does nothing.
- **Re-resolve on every daemon start; never trust a stored path.** The customer's next
  `npm i -g`, or a switch from npm to the native installer, moves it. Re-resolving is a
  handful of `existsSync` calls and it makes that case **self-healing** instead of a
  support ticket.
- **When it is missing, the app must SAY SO where the user is typing.** Silence in the
  chat frame is the worst possible version of this: they conclude agentco is broken,
  not that a prerequisite is absent. → §7.3 · `CONTRIBUTING.md` §error handling
- **Version skew is a real failure mode.** The SDK pins `claudeCodeVersion`; a much
  older Claude Code may not speak the same protocol. Report the version found.

This is also the posture `SESSIONS_MEMORY §8.2` requires — a well-behaved third party
on the official SDK, whose customers keep their own direct relationship with Anthropic.
**We do not stand between them, and we do not hand out their bytes.**

#### What this puts on the build list

- 🔴 **agentco must pass `pathToClaudeCodeExecutable`. It does not today** — it works
  only because the dev machine happens to have the optionalDependency in
  `node_modules`. That is the shape of a bug that appears the day you package.
- 🔴 **A RESOLVER, and it is a three-OS problem** → [[agentco-three-os-always]]. Search
  order, **ours first**: `vendor/claude-<pinned>/` (what we fetched — the only entry we
  control) · the SDK's own optional package if present (dev machines) · npm global
  (`npm root -g`/`@anthropic-ai/claude-code/bin/claude[.exe]`) · the native installer
  (`~/.local/bin/claude`, `%LOCALAPPDATA%\Programs\claude\claude.exe`) · `PATH`.
  ⚠ Ours first is not a preference: entries 2–5 are **the customer's**, and they move
  when the customer upgrades, uninstalls or switches install methods. Preferring one of
  them makes a working install depend on somebody else's next `npm i -g`.
  ⚠ **Measured trap:** an npm global install also leaves a *second* copy under a
  hashed directory (`@anthropic-ai/.claude-code-mEIP8Bfk/…`). Both launch correctly —
  but the hashed name **changes on the next `npm i -g`**, so a resolver that finds it
  first works today and breaks silently at the customer's next upgrade. Prefer
  `claude-code/bin/`; never match a hashed directory.
- 🔴 **`agentco doctor` gains a check, and the first-run screen gains a message.** Not
  a blocker — detect, name what is missing, link the fix, let them continue (§7.3). The
  auth check that already exists is the model.
- ⚠ **A version floor.** The SDK declares `claudeCodeVersion` (2.1.231 for SDK
  0.3.231). A customer's much older Claude Code may not speak the same protocol; the
  resolver should report the version it found and `doctor` should say when it is
  behind.

### 🔴 IF the binary is ever bundled anyway — verify redistribution first

`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/LICENSE.md`, in full:

> © Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements
> outlined here: https://code.claude.com/docs/en/legal-and-compliance

*All rights reserved* is not a redistribution grant. Putting that binary inside an
installer that agentco ships — and later sells — is a question for Anthropic's terms
and possibly for a lawyer. **This is not legal advice and this file cannot settle it.**

It has to be settled **first**, because the answer picks the installer:

| if redistribution is | the installer is |
|---|---|
| **permitted** | one ~400 MB offline package, everything inside |
| **not permitted** | a small package that runs `npm install` **on the user's machine at install time** — the user fetches the binary from npm themselves, under their own agreement with Anthropic |

⇒ **the decision above makes this moot, and that is the point of taking it.** The
question does not have to be answered, a lawyer does not have to be paid, and the
answer cannot change under us later. ⚠ It comes back the moment anyone proposes
bundling the binary "to make onboarding easier" — which is why the terms are quoted
here rather than summarised.

### The layout

The constraint that shapes it: three things that change at three different rates, and
**user data must outlive all of them**.

```
%LOCALAPPDATA%\AgentCo\            (Windows)   ~/Library/Application Support/AgentCo (macOS)
├── runtime/node-v22.12.0/         ←  91.5 MB · changes ~twice a year · SHIPPED
├── vendor/                        ←  EMPTY under decision ③ · the reopen slot for ②
├── app/2026.09.10-0.4.1/          ←  ~42 MB · daemon + web/dist + node_modules · every update
├── app/2026.09.03-0.4.0/          ← the previous one, kept for one generation
├── current  →  app/2026.09.10…    ← a pointer, flipped LAST
└── (the company directory lives wherever the user chose — see §7)
```

⚠ **`vendor/` is in the layout and stays empty**, because ③ was chosen: the Claude Code
executable lives wherever the customer installed it, and the resolver finds it. The
directory is here so that reopening ② later is a fetch and a resolver entry, not a
change to the layout — and so that nobody wonders where it would go.

⚠ If it is ever filled, it is its own layer rather than part of `app/`: it is pinned to
the SDK version, which is bumped far more often than Node is, so folding it into `app/`
would make an ordinary weekly update a 293 MB download of bytes that did not change.

**Why each line is the way it is:**

- **The runtime is outside `app/`.** Put it inside and every weekly update re-ships
  ~90 MB of a Node that did not change.
- **Folder names carry the version; nothing is overwritten in place.** On Windows a
  file held by a running process cannot be replaced, and `node.exe` is held for as
  long as the daemon lives. Writing a new folder and flipping a pointer sidesteps
  that entirely — and makes rollback the same operation in reverse.
- **One previous generation is kept.** Rollback with no download. Older ones are
  pruned on the next successful start, not on update — an update that fails must not
  have deleted its own escape route.
- **Per-user, not `Program Files`.** The latter asks for UAC on **every** update,
  which is exactly what "update often" cannot afford.

### 🔴 User data is in NEITHER of those directories, and that is the mechanism

Entitlements, the licence, `installed_at`, offices, knowledge, artifacts — all of it
lives in the company directory. An update replaces `app/` and touches nothing else.

⇒ **An update cannot reduce what a user has.** Not because we promise to be careful:
because the code path does not reach there. → `CONTRIBUTING.md` §mechanism vs promise

---

## 3. Updates

### 3.1 The manifest is a static file, not an API

```
GET https://agent-co.app/releases/stable.json
{
  "version": "0.4.1",
  "released_at": "2026-09-10",
  "notes_url": "https://agent-co.app/releases/0.4.1",
  "min_supported": "0.3.0",
  "artifacts": [
    { "os": "win32",  "arch": "x64",   "url": "…", "sha256": "…", "size": 104857600 },
    { "os": "darwin", "arch": "arm64", "url": "…", "sha256": "…", "size": … }
  ]
}
GET https://agent-co.app/releases/stable.json.sig     ← detached Ed25519 signature
```

⚠ **And the app asks US, never GitHub — settled 13/09/2026.** It is one fetch
either way, and the wrong one cannot be undone, because the update channel is
what a fix would have to travel through. The API returns what the *GitHub
account* says rather than what *we signed*, so taking the account takes every
customer (§3.2 is the whole answer to that); its anonymous ceiling is 60/hour
per IP, which an office behind one NAT shares; and parsing GitHub's schema bakes
their protocol into copies that live for years. **The manifest comes from us,
the bytes come from GitHub's CDN** — we own the pointer, they carry the payload.
Publishing mechanics live in `agentco-web/SPEC.md §8`.

Static means: cacheable, free, nothing to DDoS, nothing to keep awake, no database to
pool connections against. The whole *"anti-DDoS and overload"* section of a
conventional licensing design solves a problem that only exists if you create it.

### 3.2 🔴 The signature is the highest-severity item in this entire document

Without it, whoever takes the DNS or the CDN can push **an executable to every
customer**. agentco runs real commands on real machines. An unsigned auto-update
channel is more dangerous than every licensing concern in this file put together.

- The manifest is signed with an **Ed25519 release key**, separate from the licence
  key (§4). Different jobs, different blast radius, different rotation story.
- The public key is compiled into the app.
- **Verify the signature before reading a single field.** A manifest that fails
  verification is not "an update we could not check" — it is treated as an attack:
  nothing is downloaded, nothing is reported to the server, and the user is told the
  channel is untrusted.
- **`sha256` is verified after download, before anything is unpacked or run.** The
  version comparison answers *"is there a newer one"*; the hash answers *"is this the
  file the manifest named"*. Two jobs — do not conflate them.

### 3.3 What leaves the machine

**A plain GET, and nothing else.** No licence id, no install id, no version in a
query string, no hardware information, no user agent that identifies an install.

That is not an accident of politeness: **the update check must never be the licence
check.** Wire them together and "I blocked the app from calling home" becomes "my app
stopped working", which is the failure this whole design exists to avoid.

The honest residue, which §7's policy states: the request reveals an IP address and
contributes to a rough download count in a CDN log. Nothing more.

### 3.5 The manifest names LAYERS, not one file

§2's layout has two directories with different lifetimes, so a manifest describing
"the installer" would make every weekly release a ~135 MB download when ~42 MB moved.

```jsonc
"layers": {
  "runtime": { "version": "22.12.0", "url": "…", "sha256": "…", "size": 95970000 },
  "app":     { "version": "0.4.1",   "url": "…", "sha256": "…", "size": 44000000 }
}
```

The updater compares **each layer's version against what is on disk** and fetches only
what moved. A normal week is the `app` layer alone; `runtime` moves about twice a year.

⚠ Every layer is verified separately — `sha256` per layer, under the one signature
over the whole manifest (§3.2). A partially-updated install must never be able to
start: write the new layer beside the old one, verify, and only then flip `current`.

⚠ The layer list is deliberately open-ended rather than the two fields above. If the
Claude Code binary ever does ship (§2), it arrives as a third layer and nothing else
in this section changes.

### 3.4 Cadence, and the off switch

- At most **once every 24 hours**, cached; never on every start.
- **Never blocks startup.** An unreachable manifest is not an error state; it is
  Tuesday on a corporate network.
- **`updates.check: false` in `company.yaml` turns it off, and off means off** — a
  VPS or an air-gapped install must be able to go completely silent. → SPEC-deploy
- Applying an update is a separate act from noticing one. The daemon shuts itself
  down through the door that already exists — `liveDaemon()` → `POST /api/shutdown` →
  wait for exit → flip `current` — the same door the UI's power button uses
  (SPEC-ui §0).

### 3.6 v1: notify, never install — settled and built 15/09/2026, first shipped in 0.1.3

Code: `core/update-check.ts` (fetch · verify · cache) · `core/update-links.ts`
(the compiled-in link and command) · `GET /api/update` · the header line ·
`scripts/release-keys.ts` (made the two keys, once) · `scripts/release-web.ts`
(every release) · `test/update-check.test.ts`.

What ships first, and what waits. Everything above still holds; this section
cuts it to the part that can ship without the update-in-place debt.

- **Notify only.** The daemon learns that a newer version exists and the UI says
  so. Nothing is downloaded, nothing is replaced. Applying an update — §3.5's
  layers, flipping `current` while the daemon runs (`SESSIONS_MEMORY §4.2 #5`) —
  is v2.
- 🔴 **THE WORDS AND THE LINK IN THE BANNER ARE COMPILED INTO THE APP, NEVER READ
  FROM THE MANIFEST.** A forged manifest can then lie about exactly one thing, a
  version number, and send nobody anywhere. The banner says *"version X is
  available"* and points at a constant: `https://agent-co.app` for the Windows
  installer, `npm i -g @agent-co-app/cli@latest` for an npm install.
  `notes_url` and `artifacts` are published for v2 and ignored by v1.
- 🔴 **The signature is verified in v1 anyway** (§3.2), before a field is read.
  The protocol is the one thing an installed copy can never be taught later: a
  v1 that reads unsigned fields reads them for as long as it stays installed.
- **The signing key lives on the maintainer's machine, never in CI** — the same
  reasoning as npm stage-only (`SPEC-cli §6`): a taken-over pipeline must not be
  able to sign. `scripts/release-web.ts <version>`, run by hand after the npm
  approval, writes `RELEASE_INFO`, `public/releases/stable.json` and
  `stable.json.sig` into the `agentco-web` checkout; the maintainer pushes. The
  manual steps per release stay three: push the tag, approve on npm, run the
  script and push the website.
- 🔴 **TWO RELEASE KEYS, BOTH COMPILED IN (settled 15/09/2026).** A lost private
  key would silence the channel for every installed copy — they verify against
  compiled public keys and reject everything else, which is correct and
  unrecoverable. So the app carries two public keys and accepts a manifest
  signed by either: the **working key**, on the maintainer's machine, and the
  **backup key**, kept offline (paper or a password manager), used only if the
  working key is lost. Both are the project's keys, held by the maintainer —
  a customer never sees, stores or remembers any of them. ⚠ Losing one costs
  nothing a customer can see; losing both costs the banner, not the app (a
  customer can still download from the website). ⚠ Separate from the licence
  key (§4): different job, different blast radius.
- **Cadence and the switch are §3.4's:** at most once per 24 h, cached in
  `company/.state/update-check.json` (checked at, latest seen), never on the
  startup path; `updates.check: false` means no request at all.
- **The install kind decides the instruction, read from structure, not guessed:**
  a packaged install is `<root>/app/<version>/…` beside `<root>/runtime/` (§2).
  Anything else is an npm or source install.
- **Surface:** `GET /api/update` answers from the cache — `{ current, latest?,
  kind }`. The header shows one dismissible line when `latest > current`;
  dismissal is per version.
- **Failure is silence.** Unreachable, 404, malformed JSON: no banner, logged
  once. **A bad signature: no banner, logged as an attack** (§3.2), never as "an
  update we could not check".
- **Manifest v1:** `{ "version", "released_at" }` required; every other field
  optional and unread.
- **Tests that must exist:** a well-formed manifest with a bad signature shows
  nothing and its fields are never parsed · `updates.check: false` makes zero
  fetches · the version comparison · install-kind detection on both layouts.

⚠ The website's `/privacy` already says the app asks whether a newer version
exists. Until this ships, that sentence is ahead of the code.

### 3.7 v2: one button, and it never commits a version it has not seen run

Settled 17/09/2026. v1 tells you; v2 does it. The shape is fixed by two facts
that are not negotiable and one that was measured:

- **The interface is served by the thing being replaced.** Any button that
  updates also kills the page it lives on.
- **Only 0.1.4 and later can be updated this way at all.** The launcher decides
  which version runs, and it learned to read `current` in 0.1.4 (§3.7.2).
  Anything older has the number compiled in and must be installed by hand once.
- **No SmartScreen.** The updater downloads a layer of `.js` files and restarts
  `runtime/node.exe`, which is already on disk — it never runs a freshly
  downloaded executable, so the wall a customer meets on first install is a
  one-time cost rather than a per-release one. ⚠ Believed, not yet measured.

#### 3.7.1 The one rule: probe before commit

§3.5 already says *write the layer beside the old one, verify, and only then
flip `current`*. v2 adds a second gate, because a correct `sha256` only proves
the bytes arrived — not that the thing starts:

1. download the `app` layer → verify `sha256` (under the manifest signature,
   §3.2) → extract to `app/<new>/`, which touches nothing that is running;
2. **start it on a free port with `--no-ui` and wait for `/healthz` to answer
   with the new version**, then stop it;
3. only now flip `current` and restart the real daemon;
4. if the probe never answers: delete `app/<new>/`, leave `current` alone,
   report. Nothing was ever at risk, so there is nothing to roll back.

This is stronger than rolling back after the fact, and it is the reason the
user's *"flip back and tell me"* (17/09) is satisfied without a half-applied
state ever existing. The residual case — passes on a scratch port, fails on the
real one — falls to §3.7.2's fallback, which is already shipped.

⚠ **`--port <free>` on the probe, never the company's port.** The daemon being
replaced is still holding it, and the probe must not fight the thing it is
about to succeed. `cli/port.ts §findFreePort` is the door.

#### 3.7.2 What the launcher already does (0.1.4)

`agentco.cmd` and `AgentCo.exe` read `current`, fall back to the version they
shipped with when it is missing, empty, or names a directory with no
`dist/cli/index.js`, and **say so rather than doing nothing** when there is
nothing left to run. Measured against a fabricated tree: the pointer beats the
compiled-in version, a trailing CRLF is trimmed, a missing target falls back.
→ `src/cli/launcher-text.ts` · `installer/launcher.nsi`

#### 3.7.3 The payload does not exist yet

🔴 A release publishes exactly one asset today, `AgentCo-win-x64-setup.exe`.
There is nothing for an updater to fetch. `release.yml` must also produce and
upload the `app` layer as its own archive, and `scripts/release-web.ts` must put
its URL, size and `sha256` into the manifest — which makes this **manifest v2**
(§3.5's `layers`), signed the same way and read by the same verifier.

⚠ `readManifest` reads one field today and says so in its own comment. v2 must
keep v1 readable: an installed 0.1.4 that meets a v2 manifest has to go on
seeing a version number and nothing else, never an error.

#### 3.7.4 The button, and the page that outlives the server

No dialog, no folder picker, no confirmation — the install location is already
known (`packageRoot()`), so there is nothing to ask. **No dismiss button
either** (user, 17/09): the line lives at the foot of the Settings panel, beside
`AgentCo © <year> · v<version>`, where it is only seen by somebody who went
looking. The header keeps the dismissible banner; a notice that cannot be
dismissed is a nuisance there and information here. → `SPEC-ui.md`

The page survives its own server because **it is already in the browser**:

```
click → POST /api/update  → the daemon hands the work off and answers at once
      → the page switches to a local "updating…" state, served by nobody
      → it polls /healthz every second
        · answers with the NEW version → reload
        · answers with the OLD version → "nothing changed — see the terminal"
        · still nothing after N seconds → the same sentence
```

Nothing reports progress from the server, nothing holds a connection open, and
the failure path ends in a sentence rather than a spinner.

#### 3.7.5 The npm door keeps its command

`agentco update` (0.1.4) already stops the daemon, hands the install to a script
**outside the package** so npm is not replacing the code that is running, and
starts the company again. The button on that door runs the same thing; it does
not grow a second mechanism. → `src/cli/update-run.ts`

#### 3.7.6 Tests that must exist

- the probe refuses to flip `current` when the new tree cannot serve `/healthz`,
  and `app/<new>/` is gone afterwards;
- a manifest whose `app` layer hash does not match is never extracted;
- a v1 manifest still reads as a version on a v2-capable install, and a v2
  manifest still reads as a version on a v1 install;
- the probe picks a free port and does not touch the company's;
- the Settings line has no dismiss control, and appears only when
  `latest > current`;
- `POST /api/update` is rejected cross-origin like every other mutation (§5b).

---

## 4. The licence

### 4.1 Shape

A signed JSON document. **Verified entirely on the machine**, with `node:crypto`'s
Ed25519 — no dependency, no custom cryptography, and this was already on `ROADMAP.md`
before this file existed.

```jsonc
{
  "id": "lic_00042",              // ← see 4.4: this field is not optional
  "tier": "personal",
  "issued_at": "2026-09-10",
  "updates_until": null,          // null = no limit; a date = §5
  "buyer": { "name": "…", "email": "…" }   // optional — see 4.3
}
```

⛔ **No hardware id. No activation. No seat count. No online validity check.** Each of
those fails on the paying customer's machine and nowhere else (§0), and two of them
break the customers who pay most: a VM's fingerprint changes when the provider
migrates it, and agentco supports VPS installs by design.

### 4.2 It never stops the app

An absent, malformed, expired or unverifiable licence downgrades the **feature set**
and nothing else. There is no state in which agentco refuses to open.

Three reasons, in order of weight: a broken licence must never brick a paying
customer; the core is FSL and blocking it is meaningless anyway; and a program
holding somebody's business documents must not be able to lock them out of their own
files.

### 4.3 Two doors, one format

```
Bought  →  agentco-0.4.1.zip
           ├── agentco-setup.exe    ← ONE signed binary, byte-identical for everyone
           └── license.agentco      ← ~2 KB; the installer picks it up from beside itself

Reinstall / second machine  →  public installer + paste the same text (Settings)
```

The same signed blob travels both ways. The first door removes all friction on the
day it matters most; the second removes the *"I lost the file, now what"* support
ticket. Nobody is ever asked to type a key by hand.

⚠ **The binary is NOT personalised, and that is load-bearing.** Windows SmartScreen
accumulates reputation per file hash; a unique binary per customer gives **every
customer** a zero-reputation download and the *"Windows protected your PC"* screen.
macOS notarisation is per-binary and cannot run per-download. Personalise the ZIP;
never the executable. → §6

### 4.4 🔴 `id` is mandatory even though nothing reads it yet

**Revocation is deliberately not built** (the user's call, 10/09: the business is
built on people who choose to pay). But adding it later is a **client-side** change
that ships in an ordinary update — *and it only works on licences that already carry
an id*. A licence issued today without one can never be revoked, retroactively, for
its entire life.

⇒ every licence carries `id` from the first one ever signed. Cost: one field. The
option stays open at no charge; closing it costs nothing today and everything later.
Same shape as `installed_at` (§5.1). → [[agentco-fence-before-discovery]]

If it is ever built, the shape is already decided: a static `revoked.json` + `.sig`
beside the manifest, compared **locally** against the licence's own id — so
enforcement costs **zero bits of user data leaving the machine**.

### 4.5 The signing key

- Ed25519. **The private key never leaves the maintainer's machine.** Signing is a
  local CLI, run by hand.
- ⚠ **Automating issuance means putting the private key on a server**, and a breach
  there mints unlimited licences — with no remedy except rotating the public key,
  i.e. breaking every existing customer. Do not automate for convenience.
- **Instant delivery without a server: pre-sign in batches.** A hundred licences
  signed offline once a month, handed to the payment processor's key list; it gives
  one to each buyer automatically and records who got which. Instant, automatic,
  private key still offline. The cost is that a pre-signed licence cannot carry the
  buyer's name (4.1 `buyer` is then absent) — the processor holds the `id ↔ buyer`
  mapping instead, which is all support and revocation ever need.
- ⚠ A pre-signed batch cannot know the purchase date, so `updates_until` is either
  `null` or dated per batch with the slack always in the customer's favour.

---

## 5. Entitlements

### 5.1 🔴 `installed_at` — write it NOW or lose it forever

The company directory records, on first run, the date it was created.

**This is the only item in this document that cannot be done later.** Every policy
that distinguishes people who arrived early from people who arrived later needs to
know when someone arrived, and **v1 cannot go back in time to find out**. Ship v0
without it and the choice disappears: either break a promise, or keep everything free
for everyone forever.

It is a plain field in the company directory. No signature, no key, no delivery
channel, nothing to leak. It is editable by hand — by someone reading the source,
which is the population this project has already decided not to design against.

### 5.2 The feature table is DELIBERATELY OPEN

The business model is not settled, and this file will not invent one. What is settled
is that **it does not need to be settled to build any of the above**: every option
discussed uses the same machinery and differs only in a table of which features
require a licence. That table is configuration.

What is decided:

- **v0 is free**, and its job is to find out whether anybody wants this at all —
  `BUSINESS.md` ranks *"nobody uses it"* as the highest real risk.
- **Nothing is ever taken away.** A feature that shipped free to someone stays free
  for them. The bait-and-switch feeling comes from *removing*, never from *offering*,
  and `installed_at` is what makes the promise keepable.
- **Security patches are never behind a paywall**, in any tier, ever. This program
  reads files and runs commands; a patch that cannot reach a user is a real problem
  and it is not a monetisation lever.

Still open, and not blocking: what v1 charges for · `updates_until` limited or not ·
whether the later free tier is narrower than v0's.

### 5.3 The email on the download page is a SECOND DOOR, not a gate

The website asks for an email before handing over a download — not as a charge, but
as *"at least be a real person and leave a way to reach you"* (the user's framing,
10/09). GitHub Releases stays open beside it, with no email, one click.

Those two coexist because **they are two doors for two audiences**, not a lock and a
hole in the wall:

```
agent-co.app  →  leave an email  →  the link arrives in the inbox    ← non-coders
GitHub Releases →  click, download                                   ← developers
```

⚠ **It is only honest while nobody claims it is the only way.** The moment the site
implies the email is required, the first person to notice says so in public, and a
courtesy has turned into a small lie.

🔴 **The rule that decides how much to build here:**

> **The gate only ever touches the people you least want to obstruct.**

A developer walks around it in five seconds. A non-coder does not — and a non-coder
is the customer. So every hour spent tightening it is an hour spent inconveniencing
exactly the audience it can reach, and **zero** spent on the audience that ignores it.

⇒ build it as a **service** (*"we'll email you the link, and tell you when there's an
update"*), never as a checkpoint. ⛔ No expiring URLs, no tokens, no login, no
verification beyond the email actually arriving. Anyone who opens the network tab is
past it, and that was never the point.

**For v0 it earns its place for a reason that is not marketing:** v0's whole job is to
find out whether anybody wants this, and **you cannot collect feedback from people you
have no way to contact**. It is also the only channel that carries a security patch to
an installed base.

⚠ Delivering the link **by email** rather than showing it on submit is what makes
*"be a real person"* true rather than decorative — a made-up address receives nothing.

⚠ And the form **must not host the file**. Collect the address, hand over the GitHub
Releases URL. ~100 MB per download stays off hosting you pay for, and §8's bandwidth
question never arises.

---

## 6. Signing and trust

🔴 **A code signing certificate is a prerequisite, not a finishing touch — and it is
an unbudgeted recurring cost.** Verify current prices and requirements; since 2023
the key must live on a hardware token or HSM.

Why it belongs in this document rather than in a build script:

**It is the reason someone pays.** The customer is installing a program that will
read their work documents, write files and run shell commands using their Claude
account. Asked to choose between a signed installer from `agent-co.app` and an
unsigned copy from a file-sharing link, that is not a close decision — and the
operating system says so, in a red box, before they can continue.

- **One binary for everyone** (§4.3), so SmartScreen reputation accumulates instead
  of resetting per customer.
- macOS: signed **and notarised**; per-build, not per-download.
- The **release signing key** (§3.2) and the **licence signing key** (§4.5) are
  separate keys with separate jobs. Neither is the code-signing certificate, which is
  a third thing, issued by a CA.

---

## 7. The installer

### 7.1 Language, and the mine beside it

The installer asks for a language, and that answer does two things: it selects the
interface catalogue, and it is written to `company.yaml → language` — the path
`agentco init` already takes, resolving from the OS.

⚠ **It must reach the catalogue and the config file, and it must never reach a
prompt.** `docs/CLAUDE.md §Language` records what that costs when it goes wrong:
`newOffice` seeded `skills/assistant.md` from a translated string, and that file then
sat in the cached prefix of every chat turn for the life of the office, pulling
answers into a language nobody asked for.

⇒ **The installer seeds nothing else from a catalogue.** The company name is the one
safe exception, and CLAUDE.md names it as such: it becomes the user's own datum and
it reaches no prompt.

### 7.2 The company name

Initialised from the chosen language, and editable from the first screen onwards
(SPEC-ui §0 — double-click the title). Empty means "unnamed" and falls back to a
label that follows the interface switch.

### 7.3 The policy screen

The most important screen in the installer, and a checkbox alone is a weak version of
it. It says what the program actually does, in plain words:

> reads and writes files in the folders you point it at · runs the commands you
> declare · connects to the services you sign in to · **sends what you type to
> Anthropic**

…and what it does not do. Then it names the boundaries that already exist in the
product, so the text describes reality rather than acting as a shield: the office
directory is the working root · connections are granted per employee · every arm call
is in the audit log · a CLI action can be declared read-only.

⚠ *"The user is responsible for everything"* is a **disclaimer**, and consumer law in
the EU and Vietnam limits how far a blanket exclusion carries. This is not legal
advice. Have the final text reviewed before selling into the EU.

### 7.4b 🔴 THE LAUNCHER IS AN `.exe`, AND THE REASON IS NOT MODERNITY

A `.vbs` run by `wscript.exe` proved the tree could start silently, and it was
replaced anyway — for two reasons, the second of which was measured:

1. **VBScript is being retired.** Feature-on-demand since 2024, with removal
   stated as the direction. A product's only entry point cannot sit on that.
2. 🔴 **It could not report a failure.** `WScript.Shell.Run(…, 0, …)` means no
   window — which also means no stdout, no stderr, and no exit code anybody
   sees. Symptom, reported from a real desktop: **double-click the icon a second
   time and nothing happens at all.** No browser, no error, nothing. Whatever
   went wrong printed to a console that did not exist.

⚠ **A launcher that cannot fail out loud teaches the user the app is broken.**
That is worse than a launcher that occasionally shows an ugly box.

`installer/launcher.nsi` builds `AgentCo.exe` with NSIS — already the installer's
compiler, so no new toolchain. `SilentInstall silent` emits a plain
GUI-subsystem program: no wizard, no window, and no console can be attached to
it at all — the same guarantee wscript gave, from something that can also show a
message box. **0.32 MB**, and it carries the icon.

It **waits** on the daemon, and that is deliberate in both directions: on a first
launch it stays as the app's presence in Task Manager; on a later one `start`
finds the running daemon, opens a window onto it and exits. Measured:

```
click 1 →  daemon up          healthz {"ok":true,"version":"0.0.1"}
click 2 →  exits in 2.2s, code 0   ← found the daemon, no second port
```

⚠ The second click was the reported bug and it now behaves — but the durable
part is that **if it ever stops behaving, a message box says so** instead of
nothing at all.

### 7.5 🔴 A DOUBLE-CLICKED LAUNCHER DOES NOT KNOW WHERE THE COMPANY IS

Found by running the packaged tree, 10/09 — not by reading anything.

```ts
resolveCompanyDir(explicit?) =
  explicit ?? process.env.AGENTCO_COMPANY_DIR ?? path.join(process.cwd(), 'company')
```

All three doors are shut for a double-click: there is no `--dir`, no environment
was set by anybody, and `cwd` under `wscript` is not a place that means anything.
The daemon goes looking for `company/` beside a directory nobody chose.

⇒ **the launcher has to be told**, and the answer settled 11/09 is the simplest
one available:

> **`<install>\company`. No picker, no `company-dir.txt`, no lookup.**

The maintainer's call, and the reasons are good: one place to find, one place to
back up, and nothing that can go stale. It sits beside `runtime/` and `app/` — the
part of the tree an update never touches — so it survives updates by structure
rather than by care.

⚠ **The uninstaller leaves it, and that needs the right NSIS verb**: `RMDir
"$INSTDIR"` without `/r`, which removes the folder only when it is already
empty. A `/r` on that one line would delete every office, document and note the
customer has — the thing `BUSINESS.md` calls the highest switching cost there is.

⚠ **THE COST, STATED:** `%LOCALAPPDATA%` normally sits outside a user's own backup
and outside OneDrive sync, while `Documents` does not. The customer's work lives
here, so *"where are my backups"* has a worse answer than it would elsewhere.
Accepted in exchange for findability; revisit the first time somebody loses work.

### 7.6 The installer itself — nothing exists yet

What `scripts/package.ts` produces is **the folder an installer would lay down**,
plus two entry points: `agentco.cmd` (terminal, shows a console, correct) and
`AgentCo.vbs` (double-click, no console — see §7.4).

**Not built, and each is one of the five things a customer actually sees:**
accept the policy · choose a path · choose a language · check Claude Code · a
shortcut with an icon.

### ✅ BUILT 10/09 — `installer/agentco.nsi`, and it compiles

```
AgentCo-0.0.1-win-x64-setup.exe    38.5 MB      ← the download
                                  169.5 MB      ← on disk after install
                                     22.9%      ← LZMA, whole-file
```

⚠ **38.5 MB is the number that matters**, not 169.5. The earlier worry about a
"few-hundred-megabyte download" was about the wrong figure: the installer
compresses to a size nobody thinks twice about, and the disk cost lands after
they have already committed. **A web installer buys nothing here.** → §5.3

**Language dialog → policy → install folder → shortcuts → progress → finish.**

- **The policy shows no text caret.** MUI's licence control is a read-only
  RichEdit, so nothing can be typed into it — but it still blinks a caret, and a
  caret is the universal sign for *"a box you fill in"*, on the one screen whose
  entire job is to be read. `HideCaret` on page-show removes it; selecting and
  scrolling still work, because someone must be able to copy a clause and reach
  the end.
- **Both shortcuts are optional and both are pre-ticked** — a components page,
  which is what people expect. Un-ticking is a two-second decision they get to
  make, rather than a surprise they find afterwards.
- ⚠ **The Claude Code check appears ONLY when Claude Code is missing.** On a
  machine that has it there is no page and no pause — which is correct, and is
  why it looked absent to the person who built it: their machine already had it.

### 7.7 🔴 THE UNINSTALLER USED TO FINISH GREEN ON A HALF-REMOVED INSTALL

Reported 11/09 by the maintainer, and reported as a **habit, not an edge case**:
they routinely forget to shut the daemon down before removing, and they had
already noticed which two directories keep surviving — `app\` and `runtime\`.
The naming was theirs before anyone read the script.

**The mechanism.** `Delete` and `RMDir` set the error flag and NSIS carries on;
nothing in the section read it. A live daemon holds two files open:

```
node.exe        HELD   the daemon IS that process — the image is mapped
AgentCo.exe     HELD   the launcher waits on node for its exit code (§7.4b)
app\…\*.js      gone   Node closes each file after reading it
the registry key gone  DeleteRegKey cannot fail the way a locked file can
```

So the customer got: AgentCo missing from Apps & features, ~90 MB and a **live
daemon still answering on 7317** still on disk, its own code deleted underneath
it, and **no door back** — the uninstall entry that would let them retry was the
one thing that always got removed successfully.

**⚠ The polite stop is NOT the gate.** `agentco stop` exits 0 when nothing was
running, and `POST /api/shutdown` returns before the process is gone. A design
that trusted it would land back in exactly the state above. The gate is the
**file lock on the thing about to be deleted**: `FileOpen … a` on a running image
fails with a sharing violation, so the question asked is the question that
matters. → [[agentco-free-discriminator]]

- The runtime is located with `FindFirst "runtime\node-v*"`, never spelled out —
  that version moves ~twice a year (§3.5) and a hard-coded one is a check that
  silently stops checking after the next bump.
- ⛔ **Never `taskkill /IM node.exe`.** That name is not ours; it is the
  customer's editor and dev server too.
- On failure: `MessageBox MB_RETRYCANCEL`, and Cancel **aborts before the first
  `Delete`**. "We gave up" and "we half-removed it" can no longer both be true.
- `/SD IDCANCEL`, because `uninstall.exe /S` has nobody to press Retry, and both
  other outcomes — hang forever, or delete what it can — are worse than stopping
  with the machine intact.

**⚠ And the lock check cannot be the whole answer, so the section now ends by
looking at the disk.** It closes the cause we met; a working directory inside
`app\`, an antivirus mid-read or a preview pane fails the same silent way. If
`app\` or `runtime\` survive, the uninstaller says so and **keeps
`uninstall.exe` and the registry key** — which is what turns "close it and try
again" into something the customer can actually do.
→ [[agentco-detect-fix-pair-scope]]

**Measured 11/09** — a stand-in tree (real `node.exe`, stub `agentco.cmd`),
installed with `/S /D=`, uninstalled with `/S _?=`:

| what was holding it | exit | took | what happened |
|---|---|---|---|
| nothing | 0 | 1.7 s | removed; `stop` never spawned |
| a process on `node.exe`, `stop` works | 0 | 2.0 s | released on the first poll, then removed |
| a process on `node.exe`, `stop` cannot help | 2 | 11 s | **nothing deleted at all** — not even the shortcuts |
| a plain file inside `app\` | 2 | — | `runtime\` went, `app\` survived, and it was *reported*; entry kept |

**And once more on the real 169.9 MB tree, with a real daemon** (`0.0.3` build,
headless, `--port 7399`): exit 0, the daemon dead, 7399 closed, `company\` kept.

⚠ **It took 9.6 s, and almost none of that is the gate.** The same uninstall
with *nothing running* takes **9.9 s** — the cost is `RMDir /r` over **9 294
files**, not the wait. Measured separately, the polite stop returns in **1.22 s**
and `node.exe` is released **1.38 s** after it was asked. So the 10 s budget is
not "nearly exhausted" as the wall-clock first suggested; the poll leaves on its
first tick. ⚠ **A total that looks alarming is not evidence about the part you
just added** — the discriminator was one run with no daemon at all.
[[agentco-measurement-vs-conclusion]]

Two smaller things the same pass fixed:

- **`current` was never deleted** — `scripts/package.ts` writes that pointer file
  and no line removed it, so `RMDir "$INSTDIR"` could never have succeeded even
  on a machine with no `company\`.
- **`NoClaude` had no `/SD`**, which hangs `setup.exe /S` forever on precisely
  the machines that warning exists for. It is `/SD IDYES` now — the same answer
  §7.6 argues for: warn, never block.

⚠ **The update path is the same shape and is not built yet** (§3.5): it replaces
`app\` and `runtime\`, the two directories this section could not remove, and it
runs *far* more often than an uninstall. Whatever it does about a running daemon,
it cannot be "hope it is off".

### 9. The mark

`installer/logo.svg` — a lit tile with three figures in it. Original, and
deliberately nothing like Anthropic's or Claude's marks: agentco is a third-party
app running on somebody's Claude subscription, and *looking official* is the risk
area, not a compliment (→ SESSIONS_MEMORY §8.2).

`scripts/icon.ts` **redraws it from the same numbers** to emit `agentco.ico`
(16 · 32 · 48 · 256 px, 32-bit BMP entries). It draws rather than converts so a
release needs no ImageMagick, no Inkscape and no rasteriser — the mark is made of
one rounded rectangle and three circles precisely so that this is possible.

⚠ **Two copies of one drawing drift**, and quietly: nudge a circle in the SVG and
the website's logo silently stops matching the icon in the customer's taskbar.
`test/icon.test.ts` reads both files and holds them against each other, plus the
constraint the whole design exists for — **nothing thinner than a pixel at 16px**.

⚠ `NotSigned`, verified. Every customer sees *"Windows protected your PC"* until
§6 is paid for. That is the single remaining blocker on shipping to a non-coder.

### 🔴 WHY NOT INNO SETUP — it is no longer free for commercial use

The first draft of the installer was written for Inno, after a recommendation
that said *"Inno Setup is free, and has been since 1997"*. **That is history, not
the present.** Read out of the binaries of 6.7.3, installed 10/09:

```
ISCC.exe banner:  "Non-commercial use only"
strings in Compil32.exe:
   "Commercial license key"   "Purchase"   "Single User"
   "Are you sure you want to remove your commercial license key
    and revert to non-commercial use only?"
```

The bundled `license.txt` still carries the old text (*"for any purpose,
including commercial applications"*), so **reading the licence file agrees with
the outdated memory and the running product does not.** agentco is intended to be
sold; that is commercial use.

⚠ **This is the same class of mistake this document warns about twice elsewhere**
— payment-processor terms (§8) and code-signing requirements (§6) both carry
"verify, do not remember". The build tool got recommended from memory instead.
Vendor terms are checked, never recalled. [[agentco-spec-says-done]]

**NSIS was then checked the same way, and passes on evidence rather than memory:**

```
COPYING (1999-2026)   zlib/libpng — "for any purpose, including commercial
                      applications"; compression modules zlib/bzip2/LZMA-CPL
makensis banner       no non-commercial notice
binary strings        no "license key" / "Purchase" / "Trial"
```

⚠ **And it is better here for a second reason nobody was looking for:** NSIS
ships **67 language files including Vietnamese**, which Inno does not. The
wizard's own chrome follows the customer, so §7.3's translation problem shrinks
to the policy alone — where English-only is the deliberate answer.

**The check that caught this took two minutes and is the reusable part:** install
the tool, run its compiler, read its licence file, and grep its binaries for
licence-key strings. ⚠ The licence FILE alone would have been misleading — Inno's
still carries the old permissive text while the running product says otherwise.

⚠ **The Claude Code check belongs at FIRST RUN, not in the installer** — or if it
is in the installer, it must warn rather than block. The resolver has four install
shapes across three operating systems and exactly one of them has been exercised
on real hardware; a blocking gate turns every false negative into *"cannot install
at all"*, on a machine that has Claude Code working perfectly. → §2

### 7.4 No console window, ever

→ `SPEC-cli.md` §1. The child-process flash is fixed. The remaining half is the
launcher: an icon pointing at `node dist/cli/index.js` opens a console **that stays**,
because the daemon lives in it. The packaged build must start the daemon from a
GUI-subsystem launcher, and the UI's power button plus `agentco stop` are how it is
shut down.

---

## 8. Boundaries — who owns what, and what is deliberately not built

| | who |
|---|---|
| money · invoices · VAT · refunds · chargebacks · transaction history | **the payment processor** |
| the customer's "my purchases" page, and re-sending a lost licence | **the payment processor** |
| signing licences · signing releases | **the maintainer's own machine, offline** |
| the landing page · docs · `stable.json` · (`revoked.json`) | **static hosting** |
| the installers themselves | **GitHub Releases** — free, unmetered, and the repo is already public |
| verifying signatures · comparing versions · reading `installed_at` | **the app, locally** |

⛔ **Deliberately not built, with the condition to reopen each one:**

- **An activation server** — reopen if the product ever stops being local-first.
- **Hardware binding and seat counting** — reopen never; they break VPS and VM
  customers and make us the holder of a device fingerprint tied to an email.
- ~~**A customer account system**~~ — **reopened and decided 10/09: it is built.**
  See §8.1; the reason is support, not enforcement.
- **A transaction database** — reopen never; it is a second copy of a record the
  processor holds authoritatively, and it will not know about refunds or chargebacks.
- **Revocation** — reopen freely; §4.4 keeps the door open at the cost of one field.

⚠ **Two hosting facts to verify before committing** (both change, and this was written
in 09/2026): whether the chosen platform's free tier permits **commercial** use, and
whether it meters **bandwidth**. Installers on GitHub Releases (§5.3) settle the
second one permanently — the site itself is then a few hundred KB and a ~1 KB manifest
fetched once a day per install.

### 8.1 The account — decided 10/09, and it is for SUPPORT

The maintainer's call, after the argument in §5.3 was made and heard: **there is an
account, and people who download through the website create one.** The reason given
was not enforcement — it was *"so I can support them"*, and that is a purpose an
account genuinely serves and an anonymous download cannot.

Two things follow, and neither reopens the §5.3 argument:

- **It is a door, not a wall.** GitHub Releases stays open beside it. Everything §5.3
  says still holds: no expiring URLs, no tokens, no attempt to make the account the
  only way in. Building it and defending it are different projects, and only the
  first one was decided.
- 🔴 **Passwordless — a magic link to the email, and nothing stored but the address.**
  The stated condition was *"as long as we are trustworthy"*, and trustworthiness here
  has an exact technical shape: **the least data held is the least that can be lost.**
  A password store brings password resets, credential stuffing, reuse from other
  breaches, and an obligation — for a product whose pitch is that it holds nothing.
  The email is the identity; it is already the identity the payment processor uses,
  so a second one would only be a second thing to keep in sync.

⚠ **What the account must NOT become:** the place a licence is validated. §4 stays
offline and §3 stays anonymous. The day the app asks the account whether it may run,
every failure in §0's table comes back — and it comes back on the paying customer's
machine.

### 🔴 The rule that makes the hosting choice cheap to reverse

**Ship only your OWN domain in the application. Never a platform hostname.**

`https://agent-co.app/releases/stable.json` is compiled into every build ever
released, and those builds live on customers' machines for years. As long as that
string names a domain whose DNS you control, **the host behind it is a DNS record you
can change in minutes** — the platform question stops being a commitment and becomes
a preference.

Ship `something.vercel.app` or `something.pages.dev` into a build and the opposite is
true: moving hosts orphans every copy already installed, permanently, and there is no
update path to fix it because the update path is the thing that broke.

⇒ the free tier's commercial-use terms matter **on the day a Buy button appears**,
not before. A v0 with no price on it is not a shop. Verify before selling, not before
starting — and until then the choice costs nothing either way.

---

## 9. The logo

An original SVG. Two constraints that are not matters of taste:

- **It must not evoke Anthropic or Claude branding.** agentco is a third-party
  application running on a customer's Claude subscription; *looking official* is
  precisely the risk area. → SESSIONS_MEMORY §8.2
- **It must read at 16 px** (favicon, tray, executable icon) **and on both grounds** —
  the app defaults to dark (SPEC-ui §0), the installer and the website may not.

One source SVG; every ICO/PNG size is generated from it, never redrawn.

---

## 9.5 What the bundled Node is actually for — a claim this file got WRONG

An earlier draft of this section said: *"`getDefaultExecutable()` returns the string
`"node"`, therefore every single task runs through a `spawn('node', …)` resolved from
`PATH`, therefore the launcher's `PATH` is what decides whether the product does
anything at all."*

**That was read out of the minified source and it is false.** Measured 10/09, with the
SDK's optional package hidden *and* no `node` on `PATH` at all:

```
node on PATH?  False
✓  Claude Code            …\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
✓  Claude Code sign-in    the test call succeeded
```

A real task ran. When `pathToClaudeCodeExecutable` names a **native binary**, the SDK
spawns it directly; `getDefaultExecutable()` governs the JS-CLI path, not this one.
⚠ Inference from reading code produced a confident, wrong, specific claim — and it
would have gone into a spec as fact. [[agentco-measurement-vs-conclusion]]

**What survives, and it is narrower and truer:**

| needs the bundled runtime on `PATH` | why |
|---|---|
| the daemon itself | it *is* a Node process; the launcher invokes it by absolute path |
| **CLI arms** (`core/cli-arm.ts`) | the customer's own commands — `python x.py`, `node script.js` |
| **`npx` for MCP arms** (`core/armexec.ts`) | the cold path of every stdio connector in the catalogue |
| ~~running a task~~ | **no** — the Claude binary is addressed by absolute path |

⇒ `SPEC-cli.md §6.1`'s rule still holds, but its blast radius is *connectors and
commands*, not *everything*. A machine with no Node still runs agentco and still gets
answers; what it loses is the arm catalogue's cold path. That is a real bug and a
much smaller one, and knowing which it is decides how early it has to be fixed.

---

## 10. Build order

| | | state |
|---|---|---|
| 1 | **§1 version, one source of truth** — `core/version.ts §appVersion` | ✅ **done 10/09** |
| 2 | **§5.1 `installed_at`** — written by `agentco init` | ✅ **done 10/09** |
| 3 | **§4.4 licence `id`** — one field on the first licence ever signed | ⏸ nothing to attach it to until §4 exists |
| 4 | 🔴 **`pathToClaudeCodeExecutable` + the resolver + the `doctor` check** (§2) | ⏸ **next** |
| 5 | §2 install layout · §6 signing · §3 update channel · §7 installer | ⏸ |

**Item 4 is the next thing to build, and it is also the first honest test of the whole
plan.** agentco works today only because a developer machine happens to have the SDK's
optional binary sitting in `node_modules` — the packaged build will not, so the
resolver is what makes the product run at all. And it is testable the only way that
counts: **on a machine with no `node_modules` and Claude Code installed the way a
customer would install it.**

Items 1–3 are each one field, and each is the difference between having a choice later
and not having one. They were done first for that reason and for no other.
`test/packaging-fields.test.ts` holds 1 and 2 in place.

⚠ **Item 3 is the one still exposed.** It costs nothing today and cannot be applied
retroactively, so the moment §4's licence format is written, `id` goes in it — before
a single licence is issued, not after the first customer.
