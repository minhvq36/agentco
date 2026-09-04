
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
