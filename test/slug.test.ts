

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { folderId, isSafeId, nameKey, slugId } from '../dist/core/paths.js';
import { isLoopback } from '../dist/server/server.js';

const PHI_LATIN = ['会计部', '人力资源', '経理部', '회계팀', 'แผนกบัญชี', 'Бухгалтерия', 'Λογιστήριο'];

test('slugId: preserves existing behavior for Vietnamese input', () => {
  assert.equal(slugId('Kế toán'), 'ke-toan'); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
  assert.equal(slugId('Đội ngũ'), 'doi-ngu'); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
  assert.equal(slugId('Bảng  tính'), 'bang-tinh'); // i18n-allow-vietnamese: fixture — Vietnamese input to slugId
});

test('slugId: non-Latin script yields an EMPTY slug — the premise behind the whole bug case', () => {
  for (const n of PHI_LATIN) assert.equal(slugId(n), '', n);
});

test('folderId: every non-Latin name yields a VALID id', () => {
  for (const n of PHI_LATIN) {
    const id = folderId(n);
    assert.notEqual(id, '', n);
    assert.ok(isSafeId(id), `${n} -> ${id} must pass isSafeId`);
  }
});

test('folderId: STABLE — same name always gives the same folder, even after delete and recreate', () => {
  for (const n of PHI_LATIN) assert.equal(folderId(n), folderId(n));
  assert.equal(folderId('会计部'), folderId(' 会计部 '), 'extra whitespace must not spawn a second folder');
});

test('folderId: two DIFFERENT names must never share the same folder', () => {
  const ids = new Set(PHI_LATIN.map((n) => folderId(n)));
  assert.equal(ids.size, PHI_LATIN.length);
});

test('folderId: Latin names still use a READABLE slug — no gratuitous hashing', () => {
  assert.equal(folderId('Kế toán'), 'ke-toan'); // i18n-allow-vietnamese: fixture — Vietnamese input to folderId
  assert.equal(folderId('会计 Accounting'), 'accounting', 'Latin characters still take priority for the slug');
});

test('folderId: an EMPTY name still yields empty — let the caller reject it, do not fabricate an id', () => {
  assert.equal(folderId('   '), '');
  assert.equal(folderId(''), '');
});

test('folderId: a prefix separates an employee from an office', () => {
  assert.ok(folderId('会计部', 'nv').startsWith('nv-'));
  assert.notEqual(folderId('会计部', 'nv'), folderId('会计部'));
});

test('nameKey: two different non-Latin names must NOT be treated as duplicates', () => {
  assert.notEqual(nameKey('会计部'), nameKey('人力资源'));
  const keys = new Set(PHI_LATIN.map((n) => nameKey(n)));
  assert.equal(keys.size, PHI_LATIN.length);
});

test('nameKey: still catches duplicates as before with Vietnamese input', () => {
  assert.equal(nameKey('Nội dung'), nameKey('noi  dung')); // i18n-allow-vietnamese: fixture — Vietnamese input to nameKey
  assert.equal(nameKey('Nội dung'), nameKey('NOI DUNG')); // i18n-allow-vietnamese: fixture — Vietnamese input to nameKey
});


test('isLoopback: recognizes addresses of THIS machine itself', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.1.1']) {
    assert.equal(isLoopback(a), true, a);
  }
});

test('isLoopback: LAN and internet addresses are both rejected', () => {
  for (const a of ['192.168.1.10', '10.0.0.4', '172.17.0.1', '::ffff:192.168.1.10', '203.0.113.7', '2001:db8::1']) {
    assert.equal(isLoopback(a), false, a);
  }
});

test('isLoopback: a missing address does NOT open access — fail closed', () => {
  assert.equal(isLoopback(undefined), false);
  assert.equal(isLoopback(''), false);
});
