
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LibraryStore } from '../dist/library/store.js';
import { officePaths } from '../dist/core/paths.js';

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function tmpOffice(): { dir: string; paths: ReturnType<typeof officePaths> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-lib-'));
  return { dir, paths: officePaths(dir) };
}

test('🔴 an EMPTY library: two scans in a row ⇒ NO event is fired', async () => {
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    lib.scan();
    await settle();
    lib.scan();
    await settle();

    assert.equal(calls, 0, 'reading an unchanged library gives nothing to report');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 a document EXISTS and nothing changes: the SECOND scan must be silent — this is the 09/02 loop', async () => {
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    fs.mkdirSync(paths.libraryFiles, { recursive: true });
    fs.writeFileSync(path.join(paths.libraryFiles, 'note.txt'), 'hello', 'utf8');

    lib.scan();
    await settle();
    const afterFirst = calls;
    assert.ok(afterFirst > 0, 'dropping a file in must be reported, or the UI stays frozen');

    lib.scan();
    await settle();
    assert.equal(calls, afterFirst, 'nothing changed ⇒ no additional event');

    lib.scan();
    await settle();
    lib.scan();
    await settle();
    assert.equal(calls, afterFirst, 'no number of rereads produces an event');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 the reverse case: a file deleted OUTSIDE the app ⇒ still MUST be reported (do not overcorrect)', async () => {
  const { dir, paths } = tmpOffice();
  try {
    let calls = 0;
    const lib = new LibraryStore(paths, () => calls++);

    fs.mkdirSync(paths.libraryFiles, { recursive: true });
    const file = path.join(paths.libraryFiles, 'note.txt');
    fs.writeFileSync(file, 'hello', 'utf8');
    lib.scan();
    await settle();
    const before = calls;

    fs.rmSync(file);
    lib.scan();
    await settle();

    assert.ok(calls > before, 'a real catalog change ⇒ must be reported');
    assert.equal(lib.size, 0, 'and the document must leave the catalog');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
