
import { strict as assert } from 'node:assert';
import path from 'node:path';
import test from 'node:test';

import { guardedZone } from '../dist/core/paths.js';

const companyDir = path.resolve('/tmp/company');
const officeDir = path.join(companyDir, 'offices', 'content');
const dirs = { companyDir, officeDir };

const write = (p: string) => guardedZone(dirs, p, 'write');
const read = (p: string) => guardedZone(dirs, p, 'read');
const arm = (p: string) => guardedZone(dirs, p, 'arm');


test('secrets · reading the key store via an ABSOLUTE path is blocked — case A from spike 6', () => {
  assert.equal(read(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
});

test('secrets · reading via a RELATIVE path that climbs out is blocked too', () => {
  assert.equal(read('../../.state/secrets.json'), 'secrets');
});

test('secrets · WRITING to the key store is blocked too, not just reading', () => {
  assert.equal(write(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
});

test('secrets · the whole .state directory, not just secrets.json', () => {
  assert.equal(read(path.join(companyDir, '.state', 'daemon.json')), 'secrets');
});

test('secrets · an OFFICE\'s .state is forbidden too — closes the hole noted at OfficePaths.tasks', () => {
  assert.equal(read('.state/tasks/P-260820-2219-5ltb/plan.json'), 'secrets');
  assert.equal(read(path.join(officeDir, '.state', 'tasks', 'index.json')), 'secrets');
});


test('config · overwriting one\'s own role file is blocked — case B from spike 6', () => {
  assert.equal(write('roles/report-writer.yaml'), 'config');
});

test('config · office.yaml · layout.json · skills/ · connectors/ are all blocked', () => {
  assert.equal(write('office.yaml'), 'config');
  assert.equal(write('layout.json'), 'config');
  assert.equal(write('skills/assistant.md'), 'config');
  assert.equal(write('connectors/invoices.yaml'), 'config');
});

test('config · company.yaml is blocked — that is where mcpServers is declared', () => {
  assert.equal(write(path.join(companyDir, 'company.yaml')), 'config');
});

test('config · READING a role file is still allowed — a deliberately narrow boundary', () => {
  assert.equal(read('roles/report-writer.yaml'), undefined);
  assert.equal(read('office.yaml'), undefined);
});

test('config · UPPERCASE is blocked too — on Windows that is the same file', () => {
  assert.equal(write('ROLES/x.yaml'), 'config');
  assert.equal(write('Office.YAML'), 'config');
});


test('outside · writing outside the office directory is still blocked as before', () => {
  assert.equal(write(path.join(companyDir, 'offices', 'other', 'artifacts', 'x.md')), 'outside');
  assert.equal(write('../../../etc/passwd'), 'outside');
});

test('outside · READING outside is NOT blocked — the general read fence is not built yet', () => {
  assert.equal(read('/etc/passwd'), undefined);
  assert.equal(read(path.join(companyDir, 'offices', 'other', 'artifacts', 'x.md')), undefined);
});


test('NOT blocked · artifacts/ — this is where staff DELIVER work', () => {
  assert.equal(write('artifacts/T-01/summary.md'), undefined);
  assert.equal(read('artifacts/T-01/summary.md'), undefined);
});

test('NOT blocked · knowledge/ — blocking it would kill the LEARNING mechanism', () => {
  assert.equal(write('knowledge/shared/lesson.md'), undefined);
  assert.equal(write('knowledge/agents/writer/x.md'), undefined);
  assert.equal(read('knowledge/index.json'), undefined);
});

test('NOT blocked · library/ — the cabinet of documents the user brings in', () => {
  assert.equal(read('library/text/contract.txt'), undefined);
  assert.equal(read('library/INDEX.md'), undefined);
});

test('NOT blocked · a tool that declares no path at all', () => {
  assert.equal(read(''), undefined);
  assert.equal(write(''), undefined);
});

test('NOT blocked · a file with "roles" in its name that is not the roles directory', () => {
  assert.equal(write('artifacts/roles-old.md'), undefined);
  assert.equal(write('artifacts/roles-list/x.md'), undefined);
});


test('arm · going OUTSIDE the office is NOT blocked — that is the reason arms exist', () => {
  assert.equal(arm('D:\\Downloads\\Programs Installation\\summary.md'), undefined);
  assert.equal(arm('/home/an/docs/x.md'), undefined);
  assert.equal(arm(path.join(companyDir, 'offices', 'other', 'artifacts', 'x.md')), undefined);
});

test('arm · the key store is still forbidden — MCP must not be a backdoor into `.state/`', () => {
  assert.equal(arm(path.join(companyDir, '.state', 'secrets.json')), 'secrets');
  assert.equal(arm('../../.state/secrets.json'), 'secrets');
  assert.equal(arm('.state/tasks/P-1.plan.json'), 'secrets');
});

test('arm · config files are still forbidden — even READING, unlike the `read` builtin', () => {
  assert.equal(arm('roles/inventory-clerk.yaml'), 'config');
  assert.equal(arm('office.yaml'), 'config');
  assert.equal(arm(path.join(companyDir, 'company.yaml')), 'config');
  assert.equal(read('roles/inventory-clerk.yaml'), undefined);
});

test('arm · artifacts/ and library/ are still open — the REVERSE half of the same invariant', () => {
  assert.equal(arm('artifacts/P-1/T-01/summary.md'), undefined);
  assert.equal(arm('library/text/contract.txt'), undefined);
  assert.equal(arm('knowledge/shared/lesson.md'), undefined);
  assert.equal(arm(''), undefined);
});

/*
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ 🔴 A SIBLING OFFICE WAS WIDE OPEN, AND THE FOLDER BAN DID NOT COVER IT.
 * │ (measured 18/09/2026)
 * │
 * │ `swallowsOffice` blocks picking a PARENT of the office. It does not block
 * │ picking the office NEXT DOOR:
 * │
 * │   root = <company>/offices/b   ->  swallowsOffice = false  ->  pluggable
 * │
 * │ and the guard named two directories — `<company>/.state` and
 * │ `<thisOffice>/.state` — so office `b`'s were neither. Measured before the
 * │ fix, every one of these came back "let through".
 * │
 * │ The rule now: INSIDE A COMPANY, THE MACHINERY IS SHUT AND THE CONTENT IS
 * │ NOT. Machinery is `.state`, `.playwright-mcp` and the config files of ANY
 * │ office; content is artifacts, library, knowledge, logs.
 * └────────────────────────────────────────────────────────────────────────────
 */
const sibling = (...p: string[]) => path.join(companyDir, 'offices', 'b', ...p);

test('🔴 sibling office · its key store is NOT readable through an arm', () => {
  assert.equal(arm(sibling('.state', 'secrets.json')), 'secrets');
  assert.equal(read(sibling('.state', 'secrets.json')), 'secrets');
  assert.equal(write(sibling('.state', 'daemon.json')), 'secrets');
});

test('🔴 sibling office · its browser logs carry ITS session tokens, in plain text', () => {
  // `browser.ts` measured a real one: a Facebook URL holding `fb_dtsg=...`.
  assert.equal(arm(sibling('.playwright-mcp', 'console-1.log')), 'browser');
  assert.equal(read(sibling('.playwright-mcp', 'console-1.log')), 'browser');
});

test('🔴 sibling office · writing ITS role file would grant capabilities to someone else', () => {
  // Including a CLI declaration, which is a shell for a role whose shell is off.
  assert.equal(arm(sibling('roles', 'x.yaml')), 'config');
  assert.equal(arm(sibling('office.yaml')), 'config');
  assert.equal(arm(sibling('connectors', 'c.json')), 'config');
  assert.equal(write(sibling('skills', 's.md')), 'config');
});

test('sibling office · its CONTENT stays open — the fence is about machinery, not privacy', () => {
  assert.equal(arm(sibling('artifacts', 'x.md')), undefined);
  assert.equal(arm(sibling('library', 'text', 'c.txt')), undefined);
  assert.equal(arm(sibling('logs', 'usage.jsonl')), undefined);
});

test('⭐ `.state` is a RESERVED NAME, so a company this process never loaded is covered too', () => {
  /*
   * The case no anchored list could reach: another company folder sitting
   * somewhere on this disk, whose offices we have never heard of. Anchoring to
   * `companyDir` would miss it and nothing would say so.
   */
  const elsewhere = path.resolve('/tmp/another-company');
  assert.equal(arm(path.join(elsewhere, '.state', 'secrets.json')), 'secrets');
  assert.equal(arm(path.join(elsewhere, 'offices', 'z', '.state', 'secrets.json')), 'secrets');
  assert.equal(arm(path.join(elsewhere, '.playwright-mcp', 'console-1.log')), 'browser');
  // Its CONTENT is not ours to fence: the user pointed an arm there on purpose.
  assert.equal(arm(path.join(elsewhere, 'notes', 'x.md')), undefined);
});

test('a SEGMENT, never a substring — a user file that merely looks like ours stays readable', () => {
  /*
   * A guard that blocked `.stateroom` or `my.state-notes` would be switched off
   * within the week, and rightly.
   */
  assert.equal(arm('notes/.stateroom/plan.md'), undefined);
  assert.equal(arm('notes/my.state-notes.md'), undefined);
  assert.equal(arm('notes/state/x.md'), undefined);
});

test('the same directory in a different case is the same directory on Windows', () => {
  assert.equal(arm(sibling('.STATE', 'secrets.json')), 'secrets');
  assert.equal(arm('.State/tasks/index.json'), 'secrets');
});
