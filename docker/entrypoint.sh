#!/bin/sh
# -> docs/SPEC-deploy.md §3.1
#
# ⚠ THIS FILE MUST HAVE LF LINE ENDINGS. Checked out with CRLF, the shebang
# becomes `#!/bin/sh\r` and the container answers "no such file or directory"
# about a file that is plainly there. `.gitattributes` fences it; this note is
# here for whoever copies the file somewhere that has no .gitattributes.
set -e

mkdir -p /data/home /data/company

# ┌──────────────────────────────────────────────────────────────────────────
# │ THE TOKEN IS GENERATED, NOT ASKED FOR — AND NOBODY EVER READS IT.
# │
# │ `serve()` refuses to bind anything but loopback without a token, and a
# │ container must bind 0.0.0.0 for `-p` to reach it. So a token has to exist.
# │ Making the operator invent one would be a required step that protects
# │ nobody who skips it: they would paste `changeme` and move on.
# │
# │ Generated once, kept in the volume, stamped into the HTML by the daemon
# │ that serves it (`src/server/static.ts`). The person opening the page never
# │ sees it and has nothing to copy. If the port is later exposed, the fence is
# │ already standing rather than waiting to be built.
# │
# │ ⚠ `node`, not `openssl`/`od`: node is the one program guaranteed present in
# │ this image, and reaching for anything else is how a base-image change turns
# │ into a container that will not start.
# └──────────────────────────────────────────────────────────────────────────
if [ ! -f /data/token ]; then
  node -e "require('fs').writeFileSync('/data/token', require('crypto').randomBytes(32).toString('hex'), { mode: 0o600 })"
fi
AGENTCO_TOKEN="$(cat /data/token)"
export AGENTCO_TOKEN

# First run only. `init` reads AGENTCO_COMPANY_DIR, so there is no path argument
# to keep in step with the one in the Dockerfile.
if [ ! -f /data/company/company.yaml ]; then
  echo "agentco: no company in the volume yet — creating one"
  agentco init
fi

# ⚠ `exec`, so agentco becomes PID 1 and receives SIGTERM from `docker stop`
# directly. Without it the shell holds PID 1, forwards nothing, and every stop
# takes the full 10-second timeout before the daemon is killed outright.
#
# ⚠ `--no-ui`: there is no browser in here to open, and `openBrowser` would
# reach for xdg-open and fail on every start. The browser is on the operator's
# machine, arriving over the mapped port.
exec agentco start --host 0.0.0.0 --no-ui
