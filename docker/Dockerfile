# agentco in a container. -> docs/SPEC-deploy.md §3.1
#
# ┌──────────────────────────────────────────────────────────────────────────
# │ IT INSTALLS THE PUBLISHED PACKAGE. IT DOES NOT BUILD FROM SOURCE.
# │
# │ `@agent-co-app/cli` already carries both halves — `dist` is the daemon and
# │ `web/dist` is the interface, which is why this is ONE service and not the
# │ frontend/backend pair in §3. That package is also the exact artifact CI
# │ installs and runs on Ubuntu, macOS and Windows x Node 22/24 on every
# │ release, so the image inherits all of it.
# │
# │ Building from source here would create a SECOND build path, tested by
# │ nobody, free to drift from the one that is. That is the failure this
# │ repository walked into with `web/dist` in September and does not intend to
# │ repeat.
# └──────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim

# ⚠ DEBIAN, NOT ALPINE. Claude Code ships a NATIVE binary and the SDK resolves
# it out of its own node_modules; the musl libc in Alpine does not run it. The
# error, if you try, blames the SDK and mentions nothing about libc.
#
# ⚠ AND THE ARCHITECTURE MUST MATCH THE HOST YOU RUN ON. Building this on an
# ARM Mac produces an arm64 image whose native binary a x64 VPS cannot execute.
# Pass `--platform linux/amd64` to build for a server from such a machine.

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# ⚠ NO VERSION LITERAL HERE, deliberately. `docs/CLAUDE.md §ONE NUMBER` says
# `package.json#version` is the only copy; a number pinned in this file would be
# a second one, drifting quietly every release with no test to notice. Pin at
# BUILD time instead when you want a fixed image:
#   docker compose build --build-arg AGENTCO_VERSION=0.1.6
ARG AGENTCO_VERSION=latest

# 🔴 NEVER `--omit=optional`. Claude Code arrives as an optionalDependency of the
# SDK, pinned to the exact version the SDK was built against, and omitting it
# produces precisely this at the first query:
#   "Native CLI binary for linux-x64 not found. Reinstall
#    @anthropic-ai/claude-agent-sdk without --omit=optional"
# -> src/core/claude-code.ts
RUN npm install -g "@agent-co-app/cli@${AGENTCO_VERSION}" --no-audit --no-fund \
 && npm cache clean --force

COPY docker/entrypoint.sh /usr/local/bin/agentco-entrypoint
# chmod here rather than relying on the checkout: git on Windows does not carry
# the executable bit, so a file that is +x in the repository arrives 644.
RUN chmod +x /usr/local/bin/agentco-entrypoint

# Everything that must survive `docker compose down` lives under /data, and that
# is ONE volume on purpose:
#   /data/company     the company itself
#   /data/home        HOME, which is where `~/.claude` goes -> §3.1
ENV HOME=/data/home \
    AGENTCO_COMPANY_DIR=/data/company \
    AGENTCO_HEADLESS=1

EXPOSE 7317
ENTRYPOINT ["/usr/local/bin/agentco-entrypoint"]
