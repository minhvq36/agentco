import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/**
 * 🔴 THE UNINSTALL SECTION, READ AS TEXT. → `installer/agentco.nsi` · SPEC-packaging §7.7
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ Everything guarded here is an ORDERING or an OMISSION, and NSIS reports
 * │ neither: `Delete` and `RMDir` set the error flag, nothing reads it, and
 * │ the wizard finishes green over a half-removed install. That is the bug
 * │ this file exists for — it shipped, and the person hitting it could name
 * │ the two leftover directories before anyone read the script.
 * │
 * │ A comment cannot hold an order of instructions. Move one `Delete` above
 * │ the stop gate, drop a `/SD`, hard-code a runtime version, and the script
 * │ still compiles, still installs, still uninstalls on the machine of
 * │ whoever made the change — because their daemon happened to be off.
 * │
 * │ ⚠ Text, not behaviour. The behaviour was measured once (SPEC §7.7's
 * │ table, four holders, `/S _?=`); what a suite run on every commit can
 * │ afford is to check that the shape those measurements were taken on is
 * │ still the shape in the file.
 * └──────────────────────────────────────────────────────────────────────────
 */

const ROOT = url.fileURLToPath(new URL('..', import.meta.url));
const NSI = path.join(ROOT, 'installer', 'agentco.nsi');

// ⚠ The `.nsi` is UTF-8 WITH BOM on purpose — it carries Vietnamese LangStrings
// and makensis reads a BOM-less one as the system codepage.
const src = fs.readFileSync(NSI, 'utf8').trimStart(); // trimStart eats the BOM
const lines = src.split(/\r?\n/).map((l) => l.trim());

// ⚠ Instructions only. Half of this script is the comment blocks recording what
// each line was paid for — and those blocks NAME the things forbidden below
// ("never taskkill /IM node.exe"), so a test reading the whole file would fail
// on the very sentence that keeps the rule alive.
const code = lines.filter((l) => l !== '' && !l.startsWith(';')).join('\n');

/** The instructions of the uninstall section, comments and blanks removed. */
const body = ((): string[] => {
  const from = lines.findIndex((l) => /^Section\s+"Uninstall"/.test(l));
  assert.notEqual(from, -1, 'no Section "Uninstall" in agentco.nsi');
  const to = lines.indexOf('SectionEnd', from);
  assert.notEqual(to, -1, 'Section "Uninstall" is never closed');
  return lines.slice(from + 1, to).filter((l) => l !== '' && !l.startsWith(';'));
})();

test('the daemon gate runs before the first delete', () => {
  // Not "somewhere in the section" — FIRST. The value of the gate is that
  // "we gave up" and "we half-removed it" cannot both be true, and one
  // `Delete` above it is enough to lose that.
  assert.equal(body[0], 'Call un.EnsureStopped');
});

test('the company folder can only be removed when it is already empty', () => {
  assert.match(code, /RMDir\s+"\$INSTDIR"/, 'nothing removes $INSTDIR at all');
  assert.doesNotMatch(
    code,
    /RMDir\s+\/r\s+"\$INSTDIR"/,
    'RMDir /r on $INSTDIR deletes every office, document and note the customer has',
  );
});

test('leftovers are checked before the uninstall entry is removed', () => {
  const leftover = body.findIndex((l) => /FileExists.*\$INSTDIR\\(app|runtime)/.test(l));
  const key = body.findIndex((l) => l.startsWith('DeleteRegKey'));
  assert.notEqual(leftover, -1, 'nothing looks at the disk after the deletes');
  assert.notEqual(key, -1, 'the uninstall entry is never removed');
  // Removing the key on a failed uninstall is what made the state
  // unrecoverable: leftovers on disk, and no door in Apps & features
  // leading back to them.
  assert.ok(leftover < key, 'DeleteRegKey runs before anyone checks what survived');
  assert.ok(
    body.slice(leftover, key).includes('Return'),
    'the leftover branch falls through into DeleteRegKey instead of stopping',
  );
});

test('the runtime is discovered, never spelled out', () => {
  // `runtime\node-vX` moves about twice a year (SPEC-packaging §3.5). A
  // hard-coded version is a check that silently stops checking after the bump.
  assert.match(code, /FindFirst .*node-v\*/);
  assert.doesNotMatch(code, /node-v\d/, 'a runtime version is hard-coded into the installer');
});

test('no process is killed by name', () => {
  // `node.exe` is not our name. It is the customer's editor and dev server too.
  assert.doesNotMatch(code, /taskkill/i);
});

test('every message box has a silent default', () => {
  // A box with no /SD hangs `setup.exe /S` and `uninstall.exe /S` forever,
  // with nobody there to answer it.
  const naked = lines.filter((l) => l.startsWith('MessageBox') && !l.includes('/SD'));
  assert.deepEqual(naked, []);
});
