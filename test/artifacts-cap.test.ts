
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore, MAX_PANEL_FILES } from '../dist/core/artifacts.js';
import { officePaths } from '../dist/core/paths.js';

function tmpOffice(): { dir: string; store: ArtifactStore; paths: ReturnType<typeof officePaths> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-art-'));
  const paths = officePaths(dir);
  return { dir, store: new ArtifactStore(paths), paths };
}

function write(paths: ReturnType<typeof officePaths>, rel: string, mtime: Date): void {
  const abs = path.join(paths.artifacts, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x', 'utf8');
  fs.utimesSync(abs, mtime, mtime);
}

const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const at = (i: number): Date => new Date(T0 + i * 1000);

test('🔴 over the cap: keeps the NEWEST files, not whichever readdir happens to hit first', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    const OLD = 300;
    const NEW = 220;
    for (let i = 0; i < OLD; i++) {
      write(paths, `P-260101-0000-aaaa/T-01/cu-${String(i).padStart(3, '0')}.md`, at(i));
    }
    for (let i = 0; i < NEW; i++) {
      write(paths, `P-260901-0000-zzzz/T-01/moi-${String(i).padStart(3, '0')}.md`, at(OLD + i));
    }

    const { items, capped } = store.scan();
    assert.equal(items.length, OLD + NEW, 'the scan must see EVERYTHING — trimming is the display layer\'s job');
    assert.equal(capped, false, '520 files does not yet hit the scan cap');
    assert.equal(items[0]?.name, `moi-${String(NEW - 1).padStart(3, '0')}.md`, 'newest goes first');

    const shown = items.slice(0, MAX_PANEL_FILES).map((a) => a.name);
    assert.equal(shown.length, MAX_PANEL_FILES);
    assert.ok(shown.includes(`moi-${String(NEW - 1).padStart(3, '0')}.md`), 'the newest file MUST still be there');
    assert.ok(shown.includes('moi-000.md'), 'the whole new batch must still be intact');
    assert.ok(!shown.includes('cu-000.md'), 'the oldest is the one that should fall off');
    assert.ok(!shown.includes('cu-019.md'));
    assert.ok(shown.includes('cu-020.md'), 'trims exactly 20, not one more than it should');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 the sort axis is mtime (edited time), not the name and not the creation date', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    write(paths, 'P-1/T-01/a-old-but-just-edited.md', at(999));
    write(paths, 'P-1/T-01/z-new-but-left-untouched.md', at(1));

    const names = store.list().map((a) => a.name);
    assert.deepEqual(names, ['a-old-but-just-edited.md', 'z-new-but-left-untouched.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('EQUAL mtimes ⇒ order is still deterministic (a batch writing 3 files in the same millisecond)', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    const same = at(50);
    write(paths, 'P-1/T-01/c.md', same);
    write(paths, 'P-1/T-01/a.md', same);
    write(paths, 'P-1/T-01/b.md', same);

    assert.deepEqual(store.list().map((a) => a.name), ['a.md', 'b.md', 'c.md']);
    assert.deepEqual(store.list().map((a) => a.name), ['a.md', 'b.md', 'c.md'], 'still the same on a repeat call');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 "clear all" must delete EVERYTHING, even more than the display cap', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    const N = MAX_PANEL_FILES + 20;
    for (let i = 0; i < N; i++) {
      write(paths, `P-1/T-01/f-${String(i).padStart(4, '0')}.md`, at(i));
    }

    assert.equal(store.removeAll(), N, 'returns the exact count of files deleted');
    assert.equal(store.scan().items.length, 0, 'and the Results panel must actually be empty');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('`filePaths()` and `scan()` see the SAME set of files', () => {
  const { dir, store, paths } = tmpOffice();
  try {
    write(paths, 'P-1/T-01/a.md', at(3));
    write(paths, 'P-2/T-01/b.md', at(1));
    write(paths, 'P-2/T-02/sau/c.md', at(2));
    write(paths, '.an/d.md', at(9));

    const viaScan = store.scan().items.map((a) => a.path).sort();
    const viaPaths = [...store.filePaths().items].sort();
    assert.deepEqual(viaPaths, viaScan);
    assert.equal(viaScan.length, 3, 'and a file inside a hidden folder does not slip through either path');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('artifacts/ folder does not exist yet ⇒ empty, no crash', () => {
  const { dir, store } = tmpOffice();
  try {
    assert.deepEqual(store.scan(), { items: [], capped: false });
    assert.deepEqual(store.filePaths(), { items: [], capped: false });
    assert.equal(store.removeAll(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
