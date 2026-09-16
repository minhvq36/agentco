/**
 * 🔴 EVERY COMPANY IS BORN ON 7317, SO THE SECOND ONE ON A MACHINE COLLIDES.
 * Found 16/09/2026 by installing from npm while the packaged app was already
 * running: `listen EADDRINUSE: address already in use 127.0.0.1:7317`, raw,
 * with nothing said about what held the port or what to do next.
 *
 * The answer is not a better sentence. A `.desktop` entry runs with
 * `Terminal=false` and the Windows launcher reads an EXIT CODE, so for anyone
 * arriving by icon there is no sentence at all — and the interface cannot be
 * the fallback, because this is the failure that stops the interface existing.
 * So `start` HEALS: it takes the next free port and writes the number back into
 * company.yaml. Writing it back is the whole difference between healing and
 * drifting. → cli/port.ts · cli/index.ts `cmdStart`
 *
 * ⚠ THE SCENARIOS RUN IN A CHILD PROCESS (`helpers/port-scenarios.ts`), which
 * has its reasons written down there. What matters here: this file opens no
 * socket and awaits nothing, so it cannot hit the runner's drained-loop
 * cancellation — and the helper reports OBSERVATIONS only, so every judgement
 * below is made by an assertion that can fail.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_PORT } from '../dist/cli/port.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.join(HERE, 'helpers', 'port-scenarios.ts');

interface Run {
  port: number;
  code: number | null;
  out: string;
  filePort: number;
}

interface Observed {
  initPort: number;
  busy: number;
  busyReadsFree: boolean;
  stepped: number | undefined;
  freedReadsFree: boolean;
  heal: { wanted: number; moved: number | null; out: string };
  asked: Run;
  old: Run;
}

function observe(): Observed {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', SCENARIOS], {
    encoding: 'utf8',
    timeout: 180_000,
  });
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  assert.ok(line.startsWith('{'), `scenarios produced no result:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line) as Observed;
}

test('a company born on a taken port heals itself, writes the move down, and knows when not to', () => {
  const o = observe();

  // `init` writes the default and does not go looking — `start` heals, so a
  // search at init would be a second mechanism for one problem.
  assert.equal(o.initPort, DEFAULT_PORT, 'init should write the default port');

  // Bindability answered by BINDING: a refused connection says nothing about a
  // port held by another user's process.
  assert.equal(o.busyReadsFree, false, 'a held port should not read as free');
  assert.ok(o.stepped !== undefined && o.stepped > o.busy, 'findFreePort should step over a held port');
  assert.equal(o.freedReadsFree, true, 'a released port should read as free again');

  // 🔴 THE HEAL, asserted on the FILE rather than the sentence: serving on
  // another port while company.yaml still named the old one is exactly the
  // drift this exists to avoid, and the printed line looks identical either way.
  assert.ok(
    o.heal.moved !== null,
    `company.yaml still says ${o.heal.wanted} — the move was not written\n${o.heal.out}`,
  );
  assert.notEqual(o.heal.moved, o.heal.wanted);
  assert.doesNotMatch(o.heal.out, /EADDRINUSE/, 'the raw listen error reached the user');

  // 🔴 AN EXPLICIT `--port` IS NEVER MOVED, and never edits the file. Somebody
  // who names a number is often pointing a script at a fixed address; healing
  // there would be a surprise, not a kindness.
  assert.equal(o.asked.code, 2, o.asked.out);
  assert.match(o.asked.out, new RegExp(String(o.asked.port)), 'the error should name the port asked for');
  assert.doesNotMatch(o.asked.out, /EADDRINUSE/, 'the raw listen error reached the user');
  assert.equal(o.asked.filePort, DEFAULT_PORT, 'an explicit port must not be written to the file');

  // 🔴 AN AGENTCO THAT WILL NOT SAY WHICH COMPANY IT SERVES (anything before
  // 0.1.3) IS REFUSED, NOT MOVED PAST. Moving and being wrong means two daemons
  // over one key store and one ledger, silently. Refusing and being wrong means
  // a sentence and `--port`. The visible failure is the cheaper one to be wrong
  // about.
  assert.equal(o.old.code, 2, o.old.out);
  assert.match(o.old.out, /0\.1\.2/, 'the error should name the version that would not identify itself');
  assert.equal(o.old.filePort, o.old.port, 'the company was moved past an agentco it could not identify');
});
