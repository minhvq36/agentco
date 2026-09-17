
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isUrlInput, resolveInput } from '../dist/core/paths.js';
import { armDirIndex } from '../dist/core/catalog.js';


test('a URL does NOT get turned into a garbage path inside the office', () => {
  assert.equal(resolveInput('D:\\vp', 'https://github.com/modelcontextprotocol/servers'), undefined);
  assert.equal(resolveInput('D:\\vp', 'HTTP://Example.com/a'), undefined);
});

test('⭐ only accepted with an `http(s)://` scheme — never guess a bare domain', () => {
  assert.equal(isUrlInput('https://x.com/a'), true);
  assert.equal(isUrlInput('facebook.com'), false, 'a bare domain must NOT be guessed as a URL');
  assert.equal(isUrlInput('bao-cao.md'), false);
  assert.equal(isUrlInput('data.csv'), false, 'a filename with a dot must not be mistaken for a domain');
  assert.equal(isUrlInput('v1.2'), false);
});

test('🔴 an EMPTY STRING must not resolve to the office folder itself', () => {
  assert.equal(resolveInput('D:\\vp', ''), undefined);
  assert.equal(resolveInput('D:\\vp', '   '), undefined);
});

const ARMS = { a1: { label: 'Musics' }, a2: { label: 'Company Records' }, http: { label: 'Notion' } };
const SERVERS = {
  a1: { command: 'npx', args: ['-y', 'pkg', 'D:\\Downloads\\Musics'] },
  a2: { command: 'npx', args: ['-y', 'pkg', 'D:\\Ho so'] },
  http: { type: 'http', url: 'https://mcp.notion.com/mcp' },
};


test('builds the table from BOTH the label and the folder\'s leaf name', () => {
  const idx = armDirIndex(ARMS, SERVERS);
  assert.equal(idx['musics'], 'D:\\Downloads\\Musics');
  assert.equal(idx['company records'], 'D:\\Ho so');
  assert.equal(idx['ho so'], 'D:\\Ho so', 'without the leaf name, a user typing what Explorer shows would miss');
});

test('an arm with NO folder does NOT enter the table', () => {
  assert.equal('notion' in armDirIndex(ARMS, SERVERS), false);
});


test('⭐ an arm name resolves to a REAL FOLDER — this is the case a user hits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  const idx = armDirIndex(ARMS, SERVERS);
  assert.equal(resolveInput(dir, 'Musics', idx), 'D:\\Downloads\\Musics');
  assert.equal(resolveInput(dir, 'musics', idx), 'D:\\Downloads\\Musics', 'case-insensitive');
  assert.equal(resolveInput(dir, 'Musics/', idx), 'D:\\Downloads\\Musics', 'trailing slash');
});

test('⭐ A FILE INSIDE THE OFFICE WINS over an arm name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  fs.mkdirSync(path.join(dir, 'Musics'));
  const got = resolveInput(dir, 'Musics', armDirIndex(ARMS, SERVERS));
  assert.equal(got, path.join(dir, 'Musics'), 'a file inside the office must win');
});

test('no arm matches ⇒ still returns a path INSIDE THE OFFICE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, 'khong-co', armDirIndex(ARMS, SERVERS)), path.join(dir, 'khong-co'));
});

test('OLD behavior is unchanged when no table is passed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, 'artifacts/x.md'), path.join(dir, 'artifacts', 'x.md'));
  /*
   * ⚠ Built with `path.sep`, not written as `D:\Downloads\x`. The rule under
   * test is *"an ABSOLUTE path passes through untouched"*, and what counts as
   * absolute is a property of the host: on Linux `D:\Downloads\x` is a
   * perfectly ordinary RELATIVE filename, so the old literal asserted the
   * opposite of the rule there. The code is right on both — the fixture was
   * only ever absolute on one. (18/09/2026, the first Linux run)
   */
  const outside = path.resolve(path.sep, 'Downloads', 'x');
  assert.equal(resolveInput(dir, outside), outside);
});

test('🔴 traversal still DIES, must not fall through to the arm branch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  const idx = armDirIndex({ ...ARMS, evil: { label: '../../etc/passwd' } }, SERVERS);
  assert.equal(resolveInput(dir, '../../etc/passwd', idx), undefined);
});

test('an ABSOLUTE path still passes straight through, without consulting the table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-vp-'));
  assert.equal(resolveInput(dir, '/home/an/x', armDirIndex(ARMS, SERVERS)), '/home/an/x');
});
