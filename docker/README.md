# agentco in Docker

```bash
docker compose up -d      # then open http://127.0.0.1:7317
```

That is the whole happy path. Everything below is for when it is not.

---

## What you get, and what you do not

One container. The daemon serves the interface itself, so there is no separate
frontend service and no routing to configure — the port you open is the port
everything lives on.

No TLS, no reverse proxy, no domain, no user accounts. **The perimeter is
yours to design**, because only you know whether this sits behind Cloudflare,
inside a VPN, on a Tailscale network, or on a laptop. A guessed nginx config
would be a confident statement about infrastructure we cannot see.

> 🔴 **Before you expose this anywhere, know how it authenticates.**
> agentco uses **one shared token**. There are no user accounts. Anyone holding
> the token is, to this daemon, the owner: there is no per-person revocation, no
> record of who did what, and rotating it signs everyone out at once.
>
> This is a fact to design around, not a bug to wait on. Put an identity layer
> **in front** — Cloudflare Access, `oauth2-proxy`, Tailscale — and the shared
> token returns to being an internal detail between the proxy and the daemon,
> which is the right job for it.

## The token, which you never have to see

The container generates one on first start, keeps it in the volume, and the
daemon stamps it into the page it serves. You open the URL and it works.

It exists because the daemon refuses to bind anything but loopback without one,
and a container has to bind `0.0.0.0` for a published port to reach it. Asking
you to invent a token would have been a required step that protects nobody who
skips it.

## Reaching it from somewhere else

The published port is `127.0.0.1` only — **including when this machine is a
VPS**. To work from a café, tunnel rather than publish:

```bash
ssh -L 7317:127.0.0.1:7317 user@your-vps
```

and open `http://127.0.0.1:7317` as usual. Tailscale or WireGuard do the same
job with less typing and work on a phone.

Beyond convenience, this route is **cheaper in keys**: Google exempts loopback
from its HTTPS-and-no-raw-IP rules, so agentco's own OAuth app keeps working —
0 keys, 0 domain, nothing to register. A real domain loses that exemption and
you would have to create a Google Cloud OAuth client of your own. Notion,
Linear, Sentry and Asana are unaffected either way (they register a client on
the spot, declaring whatever address you are on), and GitHub uses a device flow
with no redirect at all.

## The port

Two lines have to agree: the published port, and the address the daemon hands
to OAuth providers. They read the same variable so they cannot drift:

```bash
# .env, beside docker-compose.yaml
AGENTCO_PORT=7318
```

Change it when 7317 is already taken — most likely by a desktop install of
agentco on the same machine.

> ⚠ **agentco's own port self-healing cannot rescue this case.** It moves the
> daemon when a port inside its reach is busy; here Docker fails to publish the
> port and the container never starts, so the daemon that knows how to move is
> never asked. The symptom is `Ports are not available`, at `up`, before any
> agentco log line appears.

## Signing in to Claude — do this BEFORE `up`

**A Claude subscription** is the usual choice. Mint a long-lived token wherever
you already have Claude Code — your own laptop is fine, it does not have to be
the server:

```bash
claude setup-token
```

It prints the token once and says so. Put it in a `.env` beside
`docker-compose.yaml`:

```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

**Or an API key**, if that is what you use:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Set **one** of the two. Then `docker compose up -d` is the whole thing — the
container can chat on its first start, with no step inside it.

> ⚠ You *can* mint it inside the container instead, but only from a **real
> terminal window**:
>
> ```bash
> docker compose exec -it agentco claude setup-token
> ```
>
> `setup-token` is a raw-mode prompt. Run it anywhere that cannot allocate a
> terminal — a script, a CI job, an editor's shell pane — and it waits forever
> while printing nothing at all. There is no error to read.

> ⚠ **Changed `.env` and nothing happened?** `docker compose restart` restarts
> the process with the environment it already had. Only `docker compose up -d`
> recreates the container and reads `.env` again. The symptom is an old token
> still failing after you have clearly replaced it, which sends people looking
> at the token — the one thing that is now correct.

### Checking what the container thinks

```bash
docker compose exec agentco claude auth status
```

```json
{ "loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty" }
```

⚠ `loggedIn: true` means **a credential is present**, not that it works — a
token of pure nonsense produces exactly the output above. To know whether it
actually works, ask something that uses it:

```bash
docker compose exec agentco agentco doctor
```

## Your data

One named volume, `agentco-data`, holds two things that both matter:

| | |
|---|---|
| `/data/company` | the company itself — offices, plans, artifacts, connections |
| `/data/home` | `HOME`, and therefore `~/.claude/projects/` — **the conversation records** |

The second is easy to underestimate, and it is not about the credential: that
arrives in an environment variable and is not stored here at all. It is about
the records `resume:` reads. If they vanish, `/clear` fails **permanently** for
every office that had one, with a message about keeping the conversation as-is
that reads like a choice. They live outside the company directory, which is the
whole reason the volume covers `HOME` too.

**No host path appears anywhere**, on purpose: the directory a container sees is
not the directory you typed, and agentco's write-outside-scope guard matches on
the name you typed. Mount your own documents if you want them — knowing that a
tool asked to write to `D:\Downloads\x.md` will not recognise `/data/x.md` as
the same place.

## Updating

Pull a newer image and recreate:

```bash
docker compose pull && docker compose up -d      # or: docker compose build --pull
```

The in-app update button is **switched off here** (`AGENTCO_UPDATES_CHECK=false`)
and that is deliberate: it runs `npm install -g`, which writes into the
container's own filesystem rather than the volume. It would appear to work and
then silently revert the next time the container is recreated. For a container,
the image *is* the version.

## One instance, and restarts

Run exactly one replica. The OAuth `state` ↔ verifier pair lives in memory, so a
second instance behind a load balancer would fail logins at precisely the
load-splitting ratio — random, and proportional. For the same reason, avoid
restarting while somebody is halfway through signing in; it is a window of a few
dozen seconds, and the loss is one login attempt, not any data.

## Building for a server from an ARM Mac

Claude Code ships a **native** binary, so the image architecture has to match the
machine that runs it:

```bash
docker compose build --build-arg AGENTCO_VERSION=latest --platform linux/amd64
```

Without it, an arm64 image on an x64 VPS fails at the first model call with an
error that blames the SDK and never mentions architecture.
