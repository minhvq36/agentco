/**
 * `agentco shortcut` writes a file a desktop session reads, with no terminal
 * to report a wrong path. → `cli/desktop-entry.ts`
 *
 * 🔴 THE ESCAPING IS TESTED BY READING THE FILE BACK THE WAY THE SPEC SAYS A
 * DESKTOP READS IT, not by comparing against a hand-written expected string.
 * An expected string encodes the author's understanding of the two escaping
 * layers — the exact thing that can be wrong — so it would agree with the bug.
 * A reader written from the spec's own description is a second, independent
 * account, and a path round-tripping through it is the property that matters.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { desktopEntry, desktopFileName, execArg } from '../dist/cli/desktop-entry.js';

/** Desktop Entry Spec, "Possible value types" — the string escape rule. */
function unescapeString(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) =>
    c === 's' ? ' ' : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === '\\' ? '\\' : `\\${c}`,
  );
}

/** Desktop Entry Spec, "The Exec key" — split into argv, honouring quotes. */
function splitExec(v: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < v.length) {
    if (v[i] === ' ') {
      i++;
      continue;
    }
    let arg = '';
    if (v[i] === '"') {
      i++;
      while (i < v.length && v[i] !== '"') {
        if (v[i] === '\\') {
          arg += v[i + 1];
          i += 2;
        } else {
          arg += v[i];
          i++;
        }
      }
      i++;
    } else {
      while (i < v.length && v[i] !== ' ') arg += v[i++];
    }
    out.push(arg.replace(/%%/g, '%'));
  }
  return out;
}

function field(entry: string, key: string): string | undefined {
  const line = entry.split('\n').find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

const HOSTILE = {
  name: 'AgentCo · Studio',
  node: '/home/jane doe/.nvm/versions/node/v22.12.0/bin/node',
  cli: '/home/jane doe/.nvm/versions/node/v22.12.0/lib/node_modules/@agent-co-app/cli/dist/cli/index.js',
  companyDir: '/home/jane doe/work/my $pace/100% "real" `co`\\back',
  icon: '/home/jane doe/icon.png',
};

test('🔴 a folder with spaces, $, %, quotes, backticks and a backslash reaches argv unchanged', () => {
  const entry = desktopEntry(HOSTILE);
  const exec = field(entry, 'Exec');
  assert.ok(exec, 'Exec line present');
  assert.deepEqual(splitExec(unescapeString(exec)), [
    'env',
    'AGENTCO_LAUNCHER=desktop',
    HOSTILE.node,
    HOSTILE.cli,
    'start',
    '--dir',
    HOSTILE.companyDir,
  ]);
});

test('the entry never relies on PATH for node — a menu session does not read ~/.bashrc', () => {
  const entry = desktopEntry(HOSTILE);
  assert.equal(unescapeString(field(entry, 'TryExec') ?? ''), HOSTILE.node);
  assert.equal(field(entry, 'Terminal'), 'false');
  assert.equal(field(entry, 'Type'), 'Application');
  assert.ok(entry.startsWith('[Desktop Entry]\n'));
});

test('no icon line at all when the package carries no icon', () => {
  const { icon: _icon, ...noIcon } = HOSTILE;
  assert.equal(field(desktopEntry(noIcon), 'Icon'), undefined);
});

test('a line break in a path is refused, not written as a different path', () => {
  assert.throws(() => desktopEntry({ ...HOSTILE, companyDir: '/tmp/a\nb' }));
});

test('one file per company: stable for a folder, different for another', () => {
  assert.equal(desktopFileName('/home/a/one'), desktopFileName('/home/a/one'));
  assert.notEqual(desktopFileName('/home/a/one'), desktopFileName('/home/a/two'));
  assert.match(desktopFileName('/home/a/one'), /^agentco-[0-9a-f]{8}\.desktop$/);
});

test('every Exec argument is quoted, including the ones that would not need it', () => {
  assert.equal(execArg('plain'), '"plain"');
});
