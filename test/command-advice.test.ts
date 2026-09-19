/**
 * Every command we tell a user to type must exist ON THEIR MACHINE.
 *
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 THIS BUG HAS NOW BEEN FIXED TWICE. The second time is why this file
 * │ exists.
 * │
 * │ 16/09/2026 — `cli.shortcutNotLinux` said "on Windows, the installer already
 * │ adds one" to people who arrived through `npm i -g` and never ran the
 * │ installer. Fixed as ONE STRING.
 * │
 * │ 17/09/2026 — `docker/Dockerfile:48` found it AGAIN, named the cause
 * │ exactly ("the binary is nested inside the package's node_modules, not
 * │ installed as a command"), and symlinked `claude` onto PATH — inside the
 * │ image. Fixed as ONE DOOR.
 * │
 * │ 19/09/2026 — three OTHER strings said "run `claude` once to sign in".
 * │ `@anthropic-ai/claude-agent-sdk` declares `bin: undefined` and its platform
 * │ package is a bare executable, so `claude` is on nobody's PATH unless they
 * │ installed Claude Code separately. Every machine this project was ever
 * │ tested on had done exactly that, which is why it survived four releases.
 * │
 * │ The class is "advice that names a door only SOME readers came through".
 * │ It has no symptom: the reader assumes the missing command is a prerequisite
 * │ they forgot, installs it, succeeds, and never reports anything. What we
 * │ lose is not a bug report, it is the belief that the product needs a
 * │ developer's toolbox — the exact belief it exists to remove.
 * │
 * │ A comment cannot hold this. Fixing instances cannot hold this. Only a test
 * │ that reads every sentence in both catalogues can.
 * │   → [[agentco-detect-fix-pair-scope]] · [[agentco-wrong-door-errors]]
 * └────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ It reads the SHIPPED catalogues, not the source files — what the user is
 * handed, after every template has been assembled. → src/i18n/
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { en, enPlural } from '../dist/i18n/en.js';
import { vi, viPlural } from '../dist/i18n/vi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Programs a sentence might name. Anything outside this set is prose in
 * backticks — a key, a filename, a YAML fragment — and not our business.
 */
const PROGRAMS = ['agentco', 'claude', 'npm', 'npx', 'node', 'docker', 'git', 'sudo', 'apt', 'cp'];

/**
 * A command we may name even though not every reader can run it, each with the
 * reason it is safe. The point of an allowlist is that GROWING it is a decision
 * somebody makes in writing — not something that happens by typing a sentence.
 *
 * ⚠ THE COMMAND IS PART OF THE ENTRY, not just the key. Keyed on the message
 * alone, a stale entry would go on waving through whatever that sentence said
 * next — an allowlist that stops reading the thing it permits.
 */
const ALLOWED: Record<string, string> = {
  // Advice, not the only way out: the sentence's own instruction is "free some
  // space", and this is one easy way. A reader without npm still knows what to do.
  'cli.updateNoSpace': 'npm cache clean --force',
  // A degraded FEATURE (keyword search inside PDFs), not a blocked path, and the
  // sentence already says an employee can still read the file if you name pages.
  'lib.notePdfReaderMissing': 'npm install',
  // ⚠ This refusal can ONLY reach somebody who installed through npm — it is
  // produced by the npm update door and nowhere else — so "not every reader has
  // npm" cannot apply to this reader. And the command is the whole repair: the
  // sentence's own instruction is "give npm a prefix you own", which is not
  // advice anyone can act on without being told how. → cli/update-run.ts
  'cli.updateNoPermission': 'npm config set prefix ~/.npm-global',
};

/**
 * `case 'x':` inside `main()` — the commands that actually run.
 *
 * ⚠ ANCHORED TO THE SWITCH, not to the file. Scanning the whole of `index.ts`
 * for `case '…':` is right only as long as there is exactly one such switch,
 * which is true today and is not a property anyone maintains. A second one —
 * `case 'linux':`, `case 'stdio':` — would quietly enrol its labels as
 * commands, and a sentence naming `agentco linux` would pass. That is this
 * file's own subject: a gate reporting clean about something it never read.
 */
function dispatched(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'index.ts'), 'utf8');
  const start = src.indexOf('async function main()');
  assert.notEqual(start, -1, 'main() has been renamed — this gate no longer reads the dispatch');
  const end = src.indexOf('\n}', src.indexOf('switch (command)', start));
  assert.ok(end > start, 'the command switch is no longer inside main()');
  const out = new Set<string>();
  for (const m of src.slice(start, end).matchAll(/case '([a-z][a-z-]*)':/g)) out.add(m[1]!);
  return out;
}

/** Every backticked run of text whose first word is a program name. */
function commandsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const inner = m[1]!.trim();
    const head = inner.split(/\s+/)[0]!;
    // `claude_path:` and friends are config keys, not commands.
    if (head.includes(':') || head.includes('=')) continue;
    if (PROGRAMS.includes(head)) out.push(inner);
  }
  return out;
}

/**
 * ⚠ THE PLURAL CATALOGUES TOO. They are a separate export with a different
 * shape (`{ one, other }`), so building the list from `en`/`vi` alone leaves
 * every plural sentence unread — and `Run \`claude\` {n} more times` would ship
 * through a gate reporting clean. Nothing violates it today; that is the state
 * in which a hole is cheapest to close and hardest to notice.
 */
function flatten(cat: Record<string, { one: string; other: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, forms] of Object.entries(cat)) {
    out[`${key}.one`] = forms.one;
    out[`${key}.other`] = forms.other;
  }
  return out;
}

const CATALOGUES: Array<[string, Record<string, string>]> = [
  ['en', en as unknown as Record<string, string>],
  ['vi', vi as unknown as Record<string, string>],
  ['en/plural', flatten(enPlural as unknown as Record<string, { one: string; other: string }>)],
  ['vi/plural', flatten(viPlural as unknown as Record<string, { one: string; other: string }>)],
];

test('🔴 no sentence sends a reader to `claude` — we ship it, but not as a command', () => {
  const offenders: string[] = [];
  for (const [lang, cat] of CATALOGUES) {
    for (const [key, value] of Object.entries(cat)) {
      if (typeof value !== 'string') continue;
      for (const cmd of commandsIn(value)) {
        if (cmd.split(/\s+/)[0] === 'claude') offenders.push(`${lang}:${key} → \`${cmd}\``);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'The Claude Code we bundle has no bin shim, so `claude` is not on PATH for anyone who\n' +
      'did not install it separately. Say `agentco login` instead — it spawns the copy\n' +
      '`describeSearch()` already found. Offenders:\n  ' + offenders.join('\n  '),
  );
});

test('every `agentco <sub>` we name is a command that dispatches', () => {
  const runs = dispatched();
  const offenders: string[] = [];
  for (const [lang, cat] of CATALOGUES) {
    for (const [key, value] of Object.entries(cat)) {
      if (typeof value !== 'string') continue;
      for (const cmd of commandsIn(value)) {
        const parts = cmd.split(/\s+/);
        if (parts[0] !== 'agentco') continue;
        const sub = parts[1];
        // Bare `agentco` is the program itself, and `agentco --flag` is a flag.
        if (!sub || sub.startsWith('-')) continue;
        if (!runs.has(sub)) offenders.push(`${lang}:${key} → \`${cmd}\``);
      }
    }
  }
  assert.deepEqual(offenders, [], `No such command:\n  ${offenders.join('\n  ')}`);
});

test('any OTHER program we name is on the allowlist, with a reason written down', () => {
  const offenders: string[] = [];
  for (const [lang, cat] of CATALOGUES) {
    for (const [key, value] of Object.entries(cat)) {
      if (typeof value !== 'string') continue;
      for (const cmd of commandsIn(value)) {
        const head = cmd.split(/\s+/)[0]!;
        if (head === 'agentco' || head === 'claude') continue;
        if (ALLOWED[key] === cmd) continue;
        offenders.push(`${lang}:${key} → \`${cmd}\``);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Not every reader has these. Either say an `agentco` command instead, or add the key\n' +
      'to ALLOWED in this file with the reason it is safe. Offenders:\n  ' + offenders.join('\n  '),
  );
});

/**
 * ⚠ The help text is where a reader goes to find out what exists, so a line
 * there that does not dispatch is the same lie in the place most likely to be
 * read. It is checked separately because its commands are not in backticks.
 */
test('`agentco help` lists only commands that exist', () => {
  const runs = dispatched();
  const offenders: string[] = [];
  for (const [lang, cat] of CATALOGUES) {
    const help = cat['cli.help'];
    if (!help) continue;
    for (const m of help.matchAll(/^agentco ([a-z][a-z-]*)/gm)) {
      if (!runs.has(m[1]!)) offenders.push(`${lang} → agentco ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `Listed but not dispatched:\n  ${offenders.join('\n  ')}`);
});

/**
 * ⚠ THE DOCUMENTS TOO, BECAUSE THE FIRST TWO INSTANCES OF THIS BUG WERE IN
 * DOCUMENTS. A lock that reads `src/i18n/` alone is smaller than the class it
 * claims to hold: `docker/README.md`, `.env.example`, `docker-compose.yaml` and
 * `TEST-WALKTHROUGH.md` all told a reader ON THEIR OWN MACHINE to run `claude
 * setup-token`, and stayed that way through the first pass of this very fix.
 *
 * ⚠ Inside the image `claude` IS on PATH — `docker/Dockerfile` symlinks it. So
 * a line that runs the command through `docker compose exec` (or `run`) is
 * correct advice about a different machine, and only those are exempt.
 */
/**
 * Prose that NAMES `claude` without sending anyone to it. No regex separates
 * "run this" from "this is what that command does" — a detector that claimed to
 * would be guessing, which is the thing this file exists to stop. So each one is
 * a decision somebody wrote down, keyed on the words themselves: edit the line
 * and the gate fires again, which is correct, because it wants re-reading.
 */
const DOC_ALLOWED: Array<{ file: string; contains: string; why: string }> = [
  {
    file: '.env.example',
    contains: 'PRINTS the token and stores nothing',
    why: 'describes what the command does; the instruction two lines below it is ours',
  },
  {
    file: 'docker-compose.yaml',
    contains: 'hands you',
    why: 'explains where the token comes from; the instruction underneath is ours',
  },
  {
    file: 'docker/README.md',
    contains: '| `claude login` | `CLAUDE_CODE_OAUTH_TOKEN` |',
    why: 'a measurement table comparing the two auth modes — a column heading, not a step',
  },
  {
    file: 'docker/README.md',
    contains: 'Sign in with `claude login`',
    why: 'the next line says "inside the container", where the Dockerfile symlinks claude',
  },
  {
    file: 'docs/TEST-WALKTHROUGH.md',
    contains: 'is the same thing, if you already have the CLI',
    why: 'offered beside ours and explicitly conditioned on already having it',
  },
  {
    file: 'docs/TEST-WALKTHROUGH.md',
    contains: 'inside the container restores both',
    why: 'inside the container, where claude is on PATH',
  },
  {
    file: 'README.md',
    contains: 'or this, if you already have the CLI',
    why:
      'the Docker section, 19/09/2026. The rule this gate enforces is "offered beside ours", and ' +
      'the gate implements "beside" as SAME LINE — here ours is the line directly above inside one ' +
      'code block, which is the same offer laid out vertically. The line above is deliberately ' +
      '`node dist/cli/index.js login --token` rather than `agentco login --token`: whoever is ' +
      'reading the Docker section cloned this repo, and a clone has NEITHER command on PATH ' +
      '(measured: the SDK declares no `bin`, so `npm install` creates no `claude` shim either). ' +
      'The vendor line stays for the reader who installed Claude Code separately.',
  },
];

const DOC_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  '.env.example',
  'docker-compose.yaml',
  'docker/README.md',
  'docs/TEST-WALKTHROUGH.md',
  'bench/README.md',
];

test('🔴 no DOCUMENT tells a reader on their own machine to run `claude`', () => {
  const offenders: string[] = [];
  for (const rel of DOC_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    fs.readFileSync(abs, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        // Not a line that runs it in the container, where `claude` is symlinked.
        if (/docker\s+compose\s+(exec|run)/.test(line)) return;
        // `claude setup-token` offered as an ALTERNATIVE, next to ours, is fine.
        if (/agentco login/.test(line)) return;
        if (DOC_ALLOWED.some((a) => a.file === rel && line.includes(a.contains))) return;
        if (/(^|[\s`"'(])claude\s+(setup-token|auth|login|--)/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 78)}`);
        }
      });
  }
  assert.deepEqual(
    offenders,
    [],
    'Say `agentco login` (or `--token`). These readers may have no `claude`:\n  ' +
      offenders.join('\n  '),
  );
});

// The two prose catalogues; `cli.help` and `cli.loginStarting` are singular keys
// and do not exist in the plural ones.
const PROSE = CATALOGUES.filter(([lang]) => !lang.includes('plural'));

test('both catalogues describe `login`, because a sign-in wall is where readers arrive', () => {
  assert.equal(PROSE.length, 2, 'expected exactly the en and vi prose catalogues');
  for (const [lang, cat] of PROSE) {
    assert.ok(cat['cli.help']?.includes('agentco login'), `${lang}: help does not mention login`);
    assert.ok(cat['cli.loginStarting']?.includes('{path}'), `${lang}: login does not say WHICH binary`);
  }
});
