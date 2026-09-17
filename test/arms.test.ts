

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { armHash, coveredBy, folderRoots } from '../dist/core/catalog.js';


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


/*
 * ┌────────────────────────────────────────────────────────────────────────────
 * │ ✅ `swallowsOffice` AND ITS FIVE TESTS ARE GONE (18/09/2026), and their
 * │ absence is the feature. The five said: the office folder blocks, a PARENT
 * │ blocks, `D:\` blocks, a different slash style still blocks.
 * │
 * │ They were guarding four files — `.state`, `.playwright-mcp`, and the
 * │ config — by banning a whole SHAPE of directory, because at configuration
 * │ time that was the only reachable handle. `guardedZone` now guards those
 * │ four BY NAME on every tool call, wherever they sit, so the ban bought
 * │ nothing it did not already have and cost somebody with `D:\Temp` a puzzle
 * │ with no good answer: the office can be any number of levels down.
 * │
 * │ ⚠ The replacement is NOT here. It is `test/jail.test.ts`, which asserts
 * │ that picking a parent, a sibling office, or another company entirely
 * │ leaves the machinery shut and the content open. If this file ever grows a
 * │ configuration-time ban again, that is the sign the runtime fence was the
 * │ thing that needed fixing. → [[agentco-rule-must-see-what-it-governs]]
 * └────────────────────────────────────────────────────────────────────────────
 */
test('⭐ nothing refuses a folder for containing the office any more', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'company.ts'),
    'utf8',
  );
  assert.doesNotMatch(src, /swallowsOffice/, 'the configuration-time ban is back in company.ts');
  assert.doesNotMatch(src, /folderIsOfficeItself/, 'the refusal message is back');
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

