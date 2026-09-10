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

## 9.5 🔴 The bundled Node is not a convenience — the SDK spawns `node` BY NAME

Read out of `sdk.mjs` on 10/09:

```js
getDefaultExecutable() { return isBun() ? "bun" : "node" }
spawnLocalProcess(e) { …spawn(command, args, { …, env: o, windowsHide: true }) }
//                                                  ↑ env defaults to { ...process.env }
```

agentco passes no `pathToClaudeCodeExecutable` and no `executable`, so **every single
task runs through a `spawn('node', …)` resolved from `PATH`**.

⇒ `SPEC-cli.md §6.1`'s rule — the launcher prepends the bundled runtime to the
daemon's `PATH` — is not about arms or samples or convenience. **It is the line that
decides whether the product does anything at all.** Get it wrong and the failure is
not "one connector is unavailable": it is every task, on every machine that has no
Node of its own, which is precisely the customer the packaged build exists for.

⚠ And the SDK hands the child `{ ...process.env }`, so it inherits whatever `PATH` the
daemon has. One place to set it — the launcher — and one thing to test on a machine
with no Node installed. That test is the single most valuable thing in the first
packaging build.

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
