/**
 * The Docker door's invariants. → docs/SPEC-deploy.md §3.1
 *
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ EVERY RULE HERE WAS MEASURED BY BREAKING IT, ON 17/09/2026, IN A REAL
 * │ CONTAINER — and every one of them fails in a way that points somewhere
 * │ else. That is why they are a test and not a paragraph in the README.
 * └────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ These are text assertions over `docker-compose.yaml`, `docker/Dockerfile`
 * and `.env.example`. The behaviour itself needs a Docker daemon, which `npm
 * test` does not have and CI would pay minutes for; the rules below are shapes,
 * and a shape can be checked anywhere. Same call as `update-door.test.ts`.
 *
 * ⚠ Everything is synchronous. The runner cancels pending tests whenever the
 * event loop drains. → `test/port.test.ts`
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_PORT } from '../dist/cli/port.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const COMPOSE = read('docker-compose.yaml');
const DOCKERFILE = read('docker/Dockerfile');
const ENV_EXAMPLE = read('.env.example');

/**
 * ⚠ COMMENT LINES ARE NOT INSTRUCTIONS, and a gate that cannot tell the
 * difference gets switched off within the week. This file's own Dockerfile
 * spends a paragraph warning about `--omit=optional`; the first version of the
 * test below failed on that warning. Same rule as `scripts/check-language.ts`
 * and the `/api/` gate in `token-door.test.ts` — which got it right, ten minutes
 * before this one got it wrong.
 */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

/** `127.0.0.1:${A:-7317}:${A:-7317}` → three parts. A plain `split(':')` gives five. */
const colonParts = (s: string): string[] => s.match(/\$\{[^}]*\}|[^:]+/g) ?? [];

test('🔴 the template’s default port is the product’s default port', () => {
  /*
   * `.env.example` is copied by every person who runs this, so the number in it
   * is the number most of them will keep. It is also a SECOND copy of a value
   * that already lives in `cli/port.ts`, and `docs/CLAUDE.md §ONE NUMBER` is
   * about exactly this: a second copy drifts, quietly, with nothing to notice.
   * Here the copy is unavoidable — a template has to show a concrete value — so
   * the drift is caught instead of prevented.
   */
  const m = /^AGENTCO_PORT=(\d+)$/m.exec(ENV_EXAMPLE);
  assert.ok(m, 'no AGENTCO_PORT line in .env.example');
  assert.equal(
    Number(m[1]),
    DEFAULT_PORT,
    `.env.example offers ${m[1]} while the product defaults to ${DEFAULT_PORT}`,
  );
});

test('🔴 one port number, on both sides of the mapping and inside the daemon', () => {
  /*
   * Docker's usual shape is `host:container` with the container side fixed, and
   * `7319->7317` then asks every reader to translate. One variable everywhere
   * removes the question — but only while all FOUR readers use it.
   */
  const ports = /ports:\s*\n\s*-\s*"([^"]+)"/.exec(COMPOSE);
  assert.ok(ports, 'no ports mapping found');
  const [, mapping] = ports;
  const parts = colonParts(mapping!);
  assert.equal(parts.length, 3, `expected 127.0.0.1:<port>:<port>, got ${mapping}`);
  assert.equal(parts[1], parts[2], `the two sides differ: ${mapping}`);

  // The daemon has to listen on it too, or the container side maps to nothing.
  assert.match(COMPOSE, /AGENTCO_RUNTIME_PORT: "\$\{AGENTCO_PORT/, COMPOSE);
  // And the healthcheck has to knock on the same door.
  assert.match(COMPOSE, /127\.0\.0\.1:\$\{AGENTCO_PORT[^}]*\}\/healthz/, COMPOSE);
});

test('🔴 the port reaches the daemon as CONFIG, never as `--port`', () => {
  /*
   * `cli/index.ts §433`: a moved port is written back to company.yaml only when
   * it came from the config — "`--port` is for this run and must not edit the
   * file". Passing the flag would leave company.yaml claiming one port while the
   * daemon answers on another: the drift that the port self-healing exists to
   * prevent, reintroduced through the Docker door.
   */
  const entry = read('docker/entrypoint.sh');
  assert.doesNotMatch(entry, /--port/, `the entrypoint passes --port:\n${entry}`);
});

test('🔴 OAuth is declared an address, or every sign-in refuses to start', () => {
  /*
   * Bound to 0.0.0.0 with nothing declared, `redirectBase` takes branch ③ and
   * REFUSES — deliberately, because `Host` is sent by the client and the
   * redirect is where the authorization code lands. GitHub survives on its
   * device flow; Notion and Google do not. Measured: the first version of this
   * compose file was missing the line.
   */
  assert.match(COMPOSE, /AGENTCO_RUNTIME_PUBLIC_URL: "http:\/\/127\.0\.0\.1:\$\{AGENTCO_PORT/, COMPOSE);
});

test('🔴 the image never omits the optional dependency Claude Code arrives in', () => {
  /*
   * `--omit=optional` removes `@anthropic-ai/claude-agent-sdk-<platform>` — the
   * NATIVE binary, pinned to the version the SDK was built against. The failure
   * is at the first model call, and the message blames the SDK:
   *   "Native CLI binary for linux-x64 not found."
   * It is also the tempting flag for anyone trying to shrink the image.
   */
  assert.doesNotMatch(code(DOCKERFILE), /--omit=optional|--no-optional/, code(DOCKERFILE));
});

test('the claude symlink is found, not spelled out, and proves itself in the same layer', () => {
  /*
   * The directory carries the architecture in its name, so a written-out path
   * builds on x64 and fails on arm64. And `claude --version` in the same RUN is
   * what turns a symlink to nowhere into a failed BUILD rather than a README
   * that lies — which is what it was, before it was measured.
   */
  assert.doesNotMatch(DOCKERFILE, /ln -s[^\n]*claude-agent-sdk-linux/, 'the architecture is written into the path');
  assert.match(DOCKERFILE, /ln -s[\s\S]{0,80}claude \\\n?\s*&& claude --version|ln -s[\s\S]{0,120}claude --version/, DOCKERFILE);
});

test('the volume covers HOME, not just the company', () => {
  /*
   * `~/.claude/projects/` holds the conversation records `resume:` reads. Lose
   * them and `/clear` fails permanently for every office that had one, with a
   * message about keeping the conversation as-is that reads like a choice.
   * They are NOT inside the company directory. → core/office.ts
   */
  assert.match(DOCKERFILE, /HOME=\/data\/home/, DOCKERFILE);
  assert.match(DOCKERFILE, /AGENTCO_COMPANY_DIR=\/data\/company/, DOCKERFILE);
  assert.match(COMPOSE, /- agentco-data:\/data\b/, COMPOSE);
});

test('the update button is off, because in here it would lie', () => {
  /*
   * It runs `npm install -g`, which writes to the container's filesystem rather
   * than the volume: it appears to work, then vanishes on the next recreate.
   * For a container the image IS the version.
   */
  assert.match(COMPOSE, /AGENTCO_UPDATES_CHECK: "false"/, COMPOSE);
});
