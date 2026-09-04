
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { armRoots, describeCall, pathsIn, warnDroppedTools } from '../dist/core/worker.js';
import { effectiveTools } from '../dist/core/types.js';

process.on('warning', () => {});

const role = { id: 'reviewer' } as never;


test('pathsIn: the three field names a builtin tool uses', () => {
  assert.deepEqual(pathsIn({ file_path: 'a.md' }), ['a.md']);
  assert.deepEqual(pathsIn({ notebook_path: 'b.ipynb' }), ['b.ipynb']);
  assert.deepEqual(pathsIn({ path: 'c/' }), ['c/']);
});

test('pathsIn: `move_file` has TWO paths — both must be returned', () => {
  assert.deepEqual(pathsIn({ source: 'artifacts/x.md', destination: 'roles/y.yaml' }), [
    'artifacts/x.md',
    'roles/y.yaml',
  ]);
});

test('pathsIn: `read_multiple_files` declares an ARRAY', () => {
  assert.deepEqual(pathsIn({ paths: ['a.md', 'b.md'] }), ['a.md', 'b.md']);
});

test('pathsIn: empty strings and non-string values are dropped, no path is made up', () => {
  assert.deepEqual(pathsIn({ path: '', file_path: '   ' }), []);
  assert.deepEqual(pathsIn({ path: 42, paths: [null, 'ok.md'] }), ['ok.md']);
  assert.deepEqual(pathsIn({}), []);
});


test('armRoots: reads the folder from `args`, strips the package name and flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  try {
    const servers = {
      files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10', dir] },
    };
    assert.deepEqual(armRoots(role, servers as never), [dir]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: two arms pointing at the same place yield ONE entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  try {
    const servers = {
      a: { command: 'npx', args: ['-y', 'pkg', dir] },
      b: { command: 'npx', args: ['-y', 'pkg', dir] },
    };
    assert.deepEqual(armRoots(role, servers as never), [dir]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: a folder that is GONE gets dropped and logged, NOT thrown', () => {
  const gone = path.join(os.tmpdir(), 'never-exists-9f3a2b');
  const servers = { a: { command: 'npx', args: ['-y', 'pkg', gone] } };
  assert.deepEqual(armRoots(role, servers as never), []);
});

test('armRoots: a FILE is not a folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'armroots-'));
  const file = path.join(dir, 'x.txt');
  fs.writeFileSync(file, 'x');
  try {
    assert.deepEqual(armRoots(role, { a: { command: 'npx', args: ['-y', 'pkg', file] } } as never), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('armRoots: a role with NO arms ⇒ empty ⇒ nothing is passed down to the SDK', () => {
  assert.deepEqual(armRoots(role, undefined), []);
});

test('armRoots: an HTTP server with no `args` — not a file arm', () => {
  assert.deepEqual(armRoots(role, { gh: { url: 'https://api.githubcopilot.com/mcp/' } } as never), []);
});



// describeCall runs its verbs through the app's i18n catalog (default locale vi), so the
// assertions below match real Vietnamese product output, not stray untranslated source text.
test('describeCall: an absolute path in `pattern` ⇒ says outside the office', () => {
  assert.equal(
    describeCall({ name: 'Glob', input: { pattern: 'D:/Downloads/*' } }),
    'đang tìm “D:/Downloads/*” ngoài văn phòng', // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  );
});

test('describeCall: an absolute path in `path` behaves the same, both OS styles', () => {
  assert.equal(describeCall({ name: 'Grep', input: { pattern: 'x', path: 'D:\\Kho' } }), 'đang tìm “x” ngoài văn phòng'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(describeCall({ name: 'Grep', input: { pattern: 'x', path: '/home/a' } }), 'đang tìm “x” ngoài văn phòng'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});

test('describeCall: a RELATIVE path still names the room correctly, as before', () => {
  assert.equal(describeCall({ name: 'Glob', input: { pattern: '*.md', path: 'library/text' } }), 'đang tìm “*.md” trong tủ tài liệu'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(describeCall({ name: 'Glob', input: { pattern: '*.md' } }), 'đang tìm “*.md” trong văn phòng'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});

test('describeCall: an arm states the NAME the user gave it, not the hash', () => {
  const line = describeCall(
    { name: 'mcp__a385afc3ab6__write_file', input: { path: 'D:\\Downloads\\x\\ban-ke.md' } },
    { a385afc3ab6: 'Programs Installation 2' },
  );
  assert.equal(line, 'Programs Installation 2 · write file → ban-ke.md');
});

test('describeCall: `move_file` states the DESTINATION, not the source', () => {
  const line = describeCall(
    { name: 'mcp__files__move_file', input: { source: 'a.md', destination: 'D:\\kho\\b.md' } },
    { files: 'Files on this machine' },
  );
  assert.equal(line, 'Files on this machine · move file → b.md');
});

test('describeCall: with no label it falls back to the hash — ugly beats silent', () => {
  const line = describeCall({ name: 'mcp__a385afc3ab6__list_directory', input: {} });
  assert.equal(line, 'a385afc3ab6 · list directory');
});


test('warnDroppedTools: `mcp:` is declared but the CLI grants 0 `mcp__` tools ⇒ WARN', () => {
  const r = { id: 'reviewer', tools: [], mcp: ['a385afc3ab6'] } as never;
  const granted = effectiveTools([]);
  assert.deepEqual(warnDroppedTools(r, granted), ['(arms: a385afc3ab6)']);
});

test('warnDroppedTools: an arm that made it through stays QUIET', () => {
  const r = { id: 'reviewer', tools: [], mcp: ['a385afc3ab6'] } as never;
  const granted = [...effectiveTools([]), 'mcp__a385afc3ab6__list_directory'];
  assert.deepEqual(warnDroppedTools(r, granted), []);
});

test('warnDroppedTools: a role that declares NO arms never warns about arms', () => {
  const r = { id: 'writer', tools: [], mcp: [] } as never;
  assert.deepEqual(warnDroppedTools(r, effectiveTools([])), []);
});

test('describeCall: a builtin tool is NOT changed one bit', () => {
  assert.equal(describeCall({ name: 'Read', input: { file_path: 'a/b.md' } }), 'đang đọc b.md'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(describeCall({ name: 'Write', input: { file_path: 'x.md' } }), 'đang viết x.md'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(describeCall({ name: 'Bash', input: { command: 'ls -la' } }), 'đang chạy: ls -la'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
  assert.equal(describeCall({ name: 'WebSearch', input: {} }), 'đang tìm trên web'); // i18n-allow-vietnamese: matches real i18n string (default locale vi)
});
