# SPEC — Deployment: personal machine · Docker · VPS + domain

> Split out 28/08/2026 when discussing the Google Calendar catalog entry. Before that
> these things were scattered across `SPEC-arms.md` §5h·6 · §10d and `SESSIONS_MEMORY`
> §5o ⑥ · §5s — meaning **no one read them together**, yet they only break when placed
> side by side.
>
> Read alongside `SPEC-arms.md` (arms · OAuth) · `SPEC-tools-approval.md` §5b (containment).

---

## 1. The decision axis is ONE question, not "Docker or not"

> **Are the browser and the daemon on the same machine?**

Everything else — Docker, nginx, VPS, domain — is just a consequence of that answer.
Docker **on the client machine** changes nothing; Docker **on a VPS** changes
everything. Don't lump those two cases under one name.

| Shape | Same machine? | `redirect_uri` |
|---|---|---|
| Running directly on the client machine | ✅ | `http://127.0.0.1:<port>/api/oauth/callback` |
| Docker on the client machine (port mapped to host) | ✅ | exactly the same |
| **Docker on a VPS**, reached via SSH tunnel | ✅ *(simulated)* | exactly the same — see §4 |
| **Docker on a VPS + public domain** | ❌ | `https://<domain>/api/oauth/callback` |

---

## 2. OAuth per shape × per provider

| | Registration mechanism | Client machine / local Docker | VPS + domain |
|---|---|---|---|
| **GitHub** | device flow — **no `redirect_uri`** | ✅ agentco's app, 0 keys | ✅ **exactly the same** — domain is irrelevant |
| **Notion** (+ Linear · Sentry · Asana · Atlassian) | **DCR** (RFC 7591) — we declare the redirect, the provider accepts it on the spot | ✅ app self-registers, 0 keys | ✅ mechanism-wise · ⏸ **not yet run for real**, see §6 |
| **Google** | **no DCR, device flow does not grant the Calendar scope** | ✅ agentco's app (**Desktop** client) ⏸ *waiting on the Q1 spike* | ❌ **the customer must create their own Web-type OAuth client** |

**Why Google is the only case that forces the customer to create an app** — Google's
two rules, verbatim:

> *"Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs (including
> localhost IP address URIs) are exempt from this rule."*
> *"Hosts cannot be raw IP addresses. Localhost IP addresses are exempted from this rule."*

Plus: no wildcards, matching is **character-for-character, port included**. ⇒ We can't
pre-register every customer's domain, and pointing straight at `http://<ip>:<port>`
**fails twice over** (both plain `http` and a raw IP) — the Cloud Console won't even
let you save it.

📌 **A Desktop-type client has no redirect field to fill in at all** —  *"The console
does not require any additional information to create OAuth 2.0 credentials for desktop
applications."* Any loopback port works ⇒ **there is no "pick a good/bad port"** on
Google's side, and nothing to conflict with. The only port that's real is **our own
daemon's port** (§5).

---

## 3. Two-container diagram (locked in 28/08 for the VPS)

```
domain ──nginx──┬── /        → FRONTEND container (static files)
                └── /api/    → BACKEND container (agentco daemon)
```

**The frontend has nothing to do with OAuth.** The whole dance is just: browser ↔
backend ↔ provider.

### Three mandatory conditions — all three are OURS, not the provider's

**① `runtime.public_url` must be declared.** Binding externally without declaring it
⇒ `redirectBase` **refuses**, on purpose: `Host` is sent by the client and can be
forged, while `redirect_uri` is where the **authorization code** flies back to — the
one thing that cannot be allowed to be guessed. That same declaration is also what
opens up `hostAllowed` (`server.ts §hostAllowed`): **one declaration, two effects, no
second field for the two to drift apart.**

**② 🔴 nginx must route `/api/oauth/callback` to the BACKEND.** The easiest way for
this two-container diagram to die. The callback is a **browser navigation** to a
`/api/…` path; if the frontend's SPA fallback swallows every path
(`try_files $uri /index.html`), the authorization code falls into `index.html`.
**Symptom: "clicked login, ended up back on the homepage" — no error, no log.**

**③ The token gate already exempts exactly that path** (`server.ts §OAUTH_CALLBACK`),
because a browser navigation carries no headers — the callback's authentication is the
`state` parameter. Already patched on 26/08, nothing to worry about here.

> ✅ This is a property of the **protocol**, not luck: SSO · Cloudflare Access · VPN ·
> mTLS **don't block** OAuth, because the provider **never calls into our machine**.
> The fragile direction is **egress** — and Node's `fetch` **doesn't automatically
> read `HTTPS_PROXY`** (`NODE_USE_ENV_PROXY=1`).

---

## 3.1 One container, not two — and what had to be built first (17/09/2026)

§3's two-container diagram is for **a VPS behind nginx**. Copying it to a local
`docker compose` would buy the one failure mode §3② warns about and nothing
else: **the daemon already serves the interface** (`server.ts §serveStatic`), and
`@agent-co-app/cli` ships `dist` *and* `web/dist` in one package. So the shipped
compose is **one service**, and the port you open is the port everything is on.

The image installs the **published package**; it does not build from source. That
package is the exact artifact CI installs and runs on three systems × Node 22/24
every release, so the image inherits all of it. A second build path would be
tested by nobody and free to drift — the `web/dist` failure of September, again.

### 🔴 The interface never sent the token, and nothing said so

Found by walking the door, 17/09. Three facts that only collide under Docker:

| | |
|---|---|
| `server.ts §593` | binding anywhere but loopback **without a token throws** |
| Docker | must bind `0.0.0.0` for a published port to reach it |
| `web/src/lib/api.ts` | sent **no** `x-agentco-token`, anywhere |

⇒ the page loads (static files are not gated) and then every call answers 401.
A blank interface, and no sentence pointing anywhere. **Measured in a real
container before the fix: `/api/company` → 401.**

**The token needs two shapes, and that is not a convenience.** A header covers
`call()`, but three things the interface already does cannot send one:
`new EventSource('/api/events')`, the artifact previews (`<img src>`,
`<video src>`, `<object data>`), and the download link. Those are the browser
fetching a URL on its own behalf. `server.ts §708` already accepted both forms —
what was missing was the interface ever sending either.

**The token arrives IN the HTML** (`server/static.ts §injectToken`), because the
interface has no door to ask through: any endpoint serving it would sit behind
the very gate it unlocks, and one that did not would hand it to anyone. Nothing
is stored, nothing is in the URL, nothing survives the tab.

⚠ On loopback there is no token, and every one of these paths is a no-op — the
desktop install sends the bytes it sent before. `test/token-door.test.ts` holds
that, plus a gate over `web/src`: any **new** `/api/` url built outside `api.ts`
must go through `withToken`, or it will 401 under Docker and look fine on the
developer's machine.

⚠ The query-string form is for **tier A/B only** (below). Behind a public proxy
it lands in access logs; that is a different decision, not a bigger version of
this one.

### Three tiers, and the shipped default is the safe one

| | Entry | Needs | State |
|---|---|---|---|
| **A** | `127.0.0.1` on this machine | nothing | shipped |
| **B** | VPS + SSH tunnel / Tailscale | an SSH account | **works today** — §4 |
| **C** | VPS + public domain | TLS · reverse proxy · **identity in front** | operator's call |

The compose publishes to `127.0.0.1` **including on a VPS**. Tier C is not a
missing feature: agentco authenticates with **one shared token and no user
accounts**, so exposing it means buying identity from a proxy (Cloudflare
Access, `oauth2-proxy`, Tailscale) rather than waiting for us to build it. That
is the line every self-hosted product draws, and `docker/README.md` states the
property rather than warning about it.

### Settled by measurement, 17/09

- **`claude setup-token`** — *"Set up a long-lived authentication token (requires
  Claude subscription)"*. A subscription works in a container; `HOME` in the
  volume keeps it. Docker is **not** API-key-only.
- **Claude Code arrives with the package**, as the SDK's own pinned
  `optionalDependency` — the 293 MB we decided to tolerate is what makes this
  work. ⛔ never `--omit=optional`; Debian not Alpine (native binary, glibc);
  architecture must match the host.
- **`AGENTCO_RUNTIME_PUBLIC_URL` is mandatory here.** Bound to `0.0.0.0` with
  nothing declared, `redirectBase` lands in branch ③ and **refuses** — GitHub
  survives (device flow, no redirect), Notion and Google do not. Declaring
  `http://127.0.0.1:<port>` is accepted *because the address handed to the
  provider is still loopback*, which is also what keeps Google on agentco's own
  app. One `.env` variable feeds both it and `ports:`, so they cannot drift.
- **Port self-healing cannot help at the Docker boundary.** When the host port is
  taken, Docker fails to publish and the container never starts — the daemon
  that knows how to move is never asked. Measured: `Ports are not available`,
  before any agentco log line.
- **`HOME` must be in the volume**, not just the company directory:
  `~/.claude` holds the credential *and* the conversation records `resume:`
  needs. Losing those breaks `/clear` permanently (`core/office.ts`).
- **The update button is switched off** (`AGENTCO_UPDATES_CHECK=false`): it runs
  `npm install -g` into the container's filesystem, which would appear to work
  and vanish on the next recreate. For a container the image *is* the version.

### A port change does not cost a re-verification

`refreshAccount` sends `grant_type` · `refresh_token` · `client_id` and **no
`redirect_uri`** (`core/oauth.ts §520`); the redirect appears once, in
`exchangeCode`. So an arm verified on 7317 keeps working on 7318. Only a **new**
sign-in is affected, and all three mechanisms absorb it for different reasons:
GitHub has no redirect at all, Google exempts every loopback port, and the DCR
vendors are **told** the address at registration time — which is also why
`$clients` is keyed by `${issuer}|${redirectUri}`.

---

## 4. The tunnel route — keeps "0 keys" true even on a VPS

```
ssh -L 7317:127.0.0.1:7317  user@vps
```

The administrator's browser opens `http://127.0.0.1:7317` → for Google, the
`redirect_uri` **is still loopback** ⇒ **agentco's app works for the VPS case too**:
0 keys, 0 domain, 0 lines of registration. Exactly how `gh` · `gcloud` · `code tunnel`
still do it.

Today's code **already handles this route**: `redirectBase` checks `targetLoopback`
before blocking `http://`, so `runtime.public_url: http://127.0.0.1:7317` is accepted
(`test/redirect-base.test.ts` already has the `host: '0.0.0.0'` + loopback `publicUrl`
case).

### ⏸ Debt: pick the redirect by the BROWSER'S ENTRY DOOR, not by a config constant

On a VPS, `public_url` **is the domain**, so logging in through the tunnel still
produces a domain redirect ⇒ the tunnel becomes useless. The correct fix: browser
enters via loopback ⇒ loopback redirect; enters via the domain ⇒ `public_url`.

Measure it with **`isLoopback(req.socket.remoteAddress)`** — **the socket address,
not `Host`** (`Host` can be forged; the socket address can't). This is **the third
place carrying the same fact** already used for the 📂 button, **not a second
mechanism**.

⚠ A condition that must be stated to whoever deploys this: **the tunnel's port number
must match** whatever the daemon put into the `redirect_uri`. A mismatch ⇒
`redirect_uri_mismatch`, and that error message **does not tell you the real cause**
(already stepped on this with Notion on 24/08).

---

## 5. 🔴 DOCKER DEBT — four items, all four fail LATE and SILENTLY

> Ordered by how silent they are, not by how hard they are. Item ① is the only one
> that must be paid off **before** Docker goes into the customer-facing recommended
> deployment docs.

### ① Invariant §1b's premise breaks — host ↔ container path mapping

`SPEC-tools-approval` §1b matches against **"the exact string the user just typed"**.
The user types `D:\Downloads\x.md`; the container sees `/data/downloads/x.md` ⇒
**never matches** ⇒ the write-outside-scope block is **silently absent** under Docker.
The exact shape of the `Bash`-switch no-op that sat quiet for 6 days.

The invariant has to be rewritten: *office + mounted volume, and the name the user
sees must be the name they can type.* → `SESSIONS_MEMORY` §5o ⑥ (the fourth instance
of the *"correct on the dev machine, wrong somewhere else"* failure class).

### ② The `company/.state/` volume doesn't persist ⇒ a NEW app gets registered on every deploy

`$clients` is keyed by `${issuer}|${redirectUri}` and lives on disk. If the container
doesn't mount it ⇒ every deploy is **a brand-new Notion app** ⇒ the old key becomes
`invalid_grant`. The exact 26/08 bug (`$clients` living in RAM ⇒ two dead accounts),
this time arriving **through the Docker door**.

⚠ **The symptom shows up hours after the deploy**, so no one will connect it to the
deploy itself.

### ③ `pending` (state ↔ verifier) lives in RAM — `oauth-routes.ts §pending`

Two constraints that **must go into the deployment docs**, not be left for people to
discover on their own:
- **exactly 1 backend replica** — 2 replicas behind a load balancer ⇒ the callback can
  land on the instance that isn't holding the `state` ⇒ random failures, at a rate
  **exactly equal to the load-splitting ratio**;
- **don't restart while someone is mid-login** (a window of a few dozen seconds).

Acceptable, because logging in is rare and short. But it has to be **stated**.

### ④ The stdio arm inside the image

`npx @modelcontextprotocol/server-filesystem` needs **node/python inside the image**
plus a path out to npm. The "Files on this machine" entry only ever sees the
**mounted volume**. `TEST-WALKTHROUGH` exercise 9 **dies** if nothing is mounted. →
`SPEC-arms.md` §10d

### ✅ In exchange, Docker gives us something we're currently missing

A container only sees the volumes it's mounted ⇒ three things **we haven't managed to
build with hooks** (a read fence · blocking `Bash` from writing outside scope · hiding
the key store) come **free from the kernel**. That's exactly the containment that
`SPEC-tools-approval` §5b records us as **not** having.

> 📌 *"Hard to stumble into another project"* **isn't a weakness here — it's a
> feature.** `mount` is Docker's version of "declaring a directory," and it's a
> **fence**, not a list.

---

## 6. Registry of EXTERNAL constants

> Strings already registered **on the provider's side**, which we **cannot change
> unilaterally**. Change one line here and forget the other side = a failure with no
> log to explain it.
>
> Why this registry exists: *a provider's URL living only in the test docs is an
> alarm bell* — already stepped on this with the GitHub App install door
> (`installations/new` sat in the walkthrough for days while the product **had no
> button for it anywhere**).

| Constant | Value | Declared where in code | Who holds the other copy |
|---|---|---|---|
| Daemon port (default) | **7317** | `types.ts §runtime.port` · template `cli/index.ts` | — (free to change when running loopback) |
| Web dev proxy | `/api` · `/healthz` → `127.0.0.1:7317` | `web/vite.config.ts` | — |
| Callback path | `/api/oauth/callback` | `server.ts §OAUTH_CALLBACK` | the deployer's **nginx** |
| GitHub App | `agent-co.app` · org `@agent-co-app` · created 26/08/2026 | `arms/github.ts §auth.clientId` | GitHub — **public**, no secret, no private key |
| GitHub `client_id` | `Iv23li95pd8QpYfTGMho` | `arms/github.ts` | GitHub |
| GitHub install door | `github.com/apps/agent-co-app/installations/new` | `arms/github.ts §scope.url` | GitHub |
| GitHub App *Callback URL* | ❓ **not recorded yet** | — | GitHub |
| Google OAuth client (agentco) | ⏸ **not created yet** | *(will be `arms/google-calendar.ts`)* | Google |
| Google redirect (domain case) | `https://<domain>/api/oauth/callback` | generated from `public_url` | **the customer pastes it in** to the Cloud Console themselves |

⚠ **The "GitHub App *Callback URL*" row**: GitHub forces you to fill this field in
when creating the app, but **device flow never uses it**. Record whatever value was
entered so next time no one mistakes it for something that matters — a field holding
a value nobody reads is exactly where misunderstandings breed.

---

## 7. Error messages written for the USER, not the developer (locked in by the user, 28/08)

The error message below was captured during the Q7 spike, **verbatim** — and it's a
good specimen precisely because it's *considerate toward a developer*, which makes it
**the wrong audience** for our user:

```
Calendar MCP API has not been used in project 963492906835 before or it is disabled.
Enable it by visiting https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=963492906835
then retry. If you enabled this API recently, wait a few minutes for the action to propagate.
```

English · a project number · `console.developers.google.com`. A non-developer who
reads this **has no idea what they're supposed to do**, and worse: half the people
reading it **don't have permission** to do what it's telling them.

### 🔴 SAME 403 CODE, TWO DIFFERENT MESSAGES — split by **where the key came from**

| Key minted from | Project belongs to | Correct message | WRONG message |
|---|---|---|---|
| **agentco's app** (loopback) | **us** | *"The Google Calendar connection is having trouble on agentco's side, not because of anything you did. Try again in a few minutes."* | any message containing *"enable the API"* or a Cloud Console link — **they have no access to that project** |
| **the customer's app** (domain case) | **them** | *"Your Google project hasn't enabled the Calendar MCP API yet."* + **a button** that opens the exact URL Google gave us | a generic *"system error"* — they **do** have permission to fix it, hiding that just makes them go hunting |

⇒ The branch isn't keyed on the provider's name but on **where the `client_id`
originated** (`OAuthAccount.client_id` compared against the default key in the
catalog) — something we've **already been storing since 27/08**, right from when
`$clients` started allowing two clients to coexist. No new mechanism needed.

⚠ This is exactly the §5m failure class — *an error message that sends someone
through the wrong door is more expensive than no message at all*: it reads like an
instruction, so people **follow it**, and burn time somewhere there's nothing to fix.

### General rule, applied to every catalog entry

1. **No machine string leaks onto the screen** — `invalid_grant` ·
   `redirect_uri_mismatch` · `SERVICE_DISABLED` · `-32602` must all have a translated
   version. Today the `other` branch of `sayError` still lets `error_xyz` slip through
   — a known debt.
2. **The key name `GOOGLE_OAUTH_<hex>` is an internal string**, not something to show
   the user. `isAccountName` already tells the two kinds apart (patched 28/08 for
   `pickMcp` + `injectSecrets`); the Google entry must reuse it, rather than let it
   suggest `agentco secret set` for what's actually a login account.
3. **Error messages anchor to the user's GOAL, not to what broke** (rule locked in
   28/08): they want to *see this week's calendar*, not to learn which endpoint
   returned 403.
4. **URLs come from the catalog entry's data**, never hardcoded into executable code
   — the same mold as GitHub's `catalog.scope.url` ⇒ 0 provider-name branches.

---

## 8. ⏸ STILL OWED — check back starting here

| | Item | Why it's still open |
|---|---|---|
| 🔴 | **§5 ①** Docker path mapping | must be paid off **before** recommending Docker to customers |
| 🔴 | **§4** picking the redirect via `isLoopback(socket)` | without it, the tunnel route is useless on a VPS |
| 🔴 | **No one has run this for real behind a domain yet** | checking on 26/08 turned up **two hard blocks of our own making** (`hostAllowed` rejecting every domain name ⇒ 403 on every request; the token gate blocking `/api/*` ⇒ 401 at the last step). Both patched — **by reasoning + unit tests**. What's still unverified **isn't Notion** — it's **our entire HTTP layer**; Notion is just a passenger ⇒ one real run and Google inherits it for free |
| ✅ | ~~Google: Q1 spike~~ | **measured on 28/08** — Desktop + loopback ✅ · `client_secret` **required** ✅ · refresh token ✅ (Google **doesn't rotate it**) · identity from `id_token`, 0 network calls ✅ |
| 🔒 | **Google entry SHELVED** (locked in by the user, 28/08) — MCP requires Developer Preview enrollment + an uncappable ~24,900 tokens/turn | come back to it via a **REST connector** on Calendar API v3 instead. Full record: `SESSIONS_MEMORY` §5u · `SPEC-arms` §4e |
| ⏰ | **A measurement is already running, don't miss it**: the app is in `Testing` ⇒ the refresh token should die **~04/09/2026** | run `--refresh` after that date to **confirm the 7-day mark with our own measurement**, before Publishing |
| ⏸ | Verification profile (path A): homepage + **privacy policy on the same domain** + demo video + domain verification in Search Console | overlaps exactly with the *golive* item — do it near the end, but **start it early since the WAIT is what costs time** |
| ⏸ | Fill in the *GitHub App Callback URL* field in §6 | |
| ✅ | ~~Sample Dockerfile + compose~~ | **shipped 17/09** — `docker/` + `docker-compose.yaml`, and **one** container, not two (§3.1: the daemon serves the interface). Built and run for real: `/healthz` answered, the token chain measured end to end (401 without · 200 by header · 200 by query) |
| 🔴 | **§5① is still open, and the compose only DODGES it** | nothing is bind-mounted, so no host↔container path mapping exists to break the invariant. The moment anyone mounts their own documents — which `docker/README.md` invites — `SPEC-tools-approval §1b` is silently absent again. Mounting is the normal thing to want; this has to be paid before Docker reaches customer-facing docs |
| ⏸ | Tier C (public domain) has still never been run | §3.1: it needs identity in front, not TLS. The `?token=` query form must not go through a logging proxy as-is |
