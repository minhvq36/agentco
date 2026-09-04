

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { armHash, coveredBy, folderRoots, swallowsOffice } from '../dist/core/catalog.js';


test('folderRoots: correctly picks out the absolute path in args', () => {
  assert.deepEqual(
    folderRoots({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@1', 'D:\\Ho so'] }),
    ['D:\\Ho so'],
  );
});

test('folderRoots: accepts BOTH path styles, without checking the platform', () => {
  assert.deepEqual(folderRoots({ args: ['/home/an/tai-lieu'] }), ['/home/an/tai-lieu']);
  assert.deepEqual(folderRoots({ args: ['C:/Users/An'] }), ['C:/Users/An']);
});

test('folderRoots: flags and package names are NOT folders', () => {
  assert.deepEqual(folderRoots({ args: ['-y', '@scope/pkg@2026.7.10', '--readonly'] }), []);
});

test('folderRoots: a non-stdio config yields empty, never throws', () => {
  assert.deepEqual(folderRoots({ type: 'http', url: 'https://x' }), []);
  assert.deepEqual(folderRoots(undefined), []);
  assert.deepEqual(folderRoots({ args: 'khong-phai-mang' }), []);
});


const have = (id: string, ...folders: string[]) => ({ id, folders });

test('coveredBy: an EXACT match blocks, and names the connection already holding it', () => {
  const hit = coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so']);
  assert.equal(hit?.id, 'files');
});

test('coveredBy: a different slash style and different case are STILL the same folder', () => {
  assert.ok(coveredBy([have('files', 'D:\\Ho So')], ['d:/ho so/']));
});

test('coveredBy: a CHILD folder is ALLOWED — that\'s least privilege, not a duplicate', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so\\2026']), undefined);
});

test('coveredBy: a BROADER new folder is also ALLOWED — widening scope is deliberate', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so\\2026')], ['D:\\Ho so']), undefined);
});

test('coveredBy: a shared name PREFIX is NOT the same folder', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Ho so-cu']), undefined);
});


const OFFICE = 'D:\\cty\\offices\\noi-dung';
const COMPANY = 'D:\\cty';

test('swallowsOffice: the office folder itself blocks', () => {
  assert.ok(swallowsOffice(OFFICE, OFFICE, COMPANY));
});

test('swallowsOffice: a PARENT of the office also blocks — it swallows `.state/` too', () => {
  assert.ok(swallowsOffice('D:\\', OFFICE, COMPANY));
  assert.ok(swallowsOffice(COMPANY, OFFICE, COMPANY));
});

test('swallowsOffice: a CHILD folder inside the office is ALLOWED', () => {
  assert.equal(swallowsOffice(`${OFFICE}\\artifacts`, OFFICE, COMPANY), false);
});

test('swallowsOffice: an unrelated folder is allowed', () => {
  assert.equal(swallowsOffice('D:\\Downloads', OFFICE, COMPANY), false);
});

test('swallowsOffice: still catches it despite a different slash style and case', () => {
  assert.ok(swallowsOffice('d:/cty', OFFICE, COMPANY));
});

test('coveredBy: a completely different folder passes through', () => {
  assert.equal(coveredBy([have('files', 'D:\\Ho so')], ['D:\\Anh']), undefined);
});

test('coveredBy: with no arms at all, it always passes through', () => {
  assert.equal(coveredBy([], ['D:\\Ho so']), undefined);
});

test('coveredBy: an arm with multiple roots — a hit on ANY root blocks', () => {
  assert.ok(coveredBy([have('files', 'D:\\Anh', 'D:\\Ho so')], ['D:\\Ho so']));
});

test('coveredBy: requesting several folders — just ONE hit blocks the whole batch', () => {
  const hit = coveredBy([have('files', 'D:\\Ho so')], ['D:\\Moi', 'D:\\Ho so']);
  assert.equal(hit?.id, 'files');
});


test('armHash: stable across repeated calls', () => {
  const c = { command: 'npx', args: ['-y', 'x', 'D:\\A'] };
  assert.equal(armHash(c), armHash(c));
});

test('armHash: KEY ORDER does not change the result', () => {
  assert.equal(
    armHash({ command: 'npx', args: ['a'] }),
    armHash({ args: ['a'], command: 'npx' }),
  );
});

test('armHash: ELEMENT order inside an array DOES matter — args has real order', () => {
  assert.notEqual(armHash({ args: ['a', 'b'] }), armHash({ args: ['b', 'a'] }));
});

test('armHash: different configs produce different hashes', () => {
  assert.notEqual(
    armHash({ command: 'npx', args: ['-y', 'x', 'D:\\A'] }),
    armHash({ command: 'npx', args: ['-y', 'x', 'D:\\B'] }),
  );
});

test('armHash: SECRET NAMES feed the hash — two different workspaces are NOT merged', () => {
  const c = { command: 'npx', args: ['-y', 'notion'] };
  assert.notEqual(armHash(c, ['NOTION_TOKEN']), armHash(c, ['NOTION_TOKEN_B']));
});

test('armHash: the order of secret names does not change the result', () => {
  const c = { command: 'npx', args: [] };
  assert.equal(armHash(c, ['A', 'B']), armHash(c, ['B', 'A']));
});

test('armHash: the key is safe to use as a yaml key name and a node id', () => {
  assert.match(armHash({ args: ['x'] }), /^a[0-9a-f]{10}$/);
});

