
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore } from '../dist/core/artifacts.js';

function fixture(): { store: ArtifactStore; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-art-'));
  const artifacts = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(artifacts, 'P-1', 'T-01'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'P-1', 'T-01', 'bao-cao.md'), '# hello', 'utf8');
  fs.writeFileSync(path.join(artifacts, 'P-1', 'ghi-chu.txt'), 'abc', 'utf8');
  fs.mkdirSync(path.join(artifacts, 'P-2'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'P-2', 'so-lieu.csv'), 'a,b\n1,2\n', 'utf8');
  return { store: new ArtifactStore({ root, artifacts } as never), root };
}

test('clears everything and returns the EXACT file COUNT — that number goes straight to the screen', () => {
  const { store } = fixture();
  assert.equal(store.list().length, 3);
  assert.equal(store.removeAll(), 3);
  assert.deepEqual(store.list(), []);
});

test('also cleans up the leftover empty directories — no husk left behind for the user to wonder about', () => {
  const { store, root } = fixture();
  store.removeAll();
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'P-1')), false);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', 'P-2')), false);
  assert.equal(fs.existsSync(path.join(root, 'artifacts')), true);
});

test('touches NOTHING outside `artifacts/` — the `resolve()` guard still holds', () => {
  const { store, root } = fixture();
  fs.writeFileSync(path.join(root, 'office.yaml'), 'name: test', 'utf8');
  fs.mkdirSync(path.join(root, 'roles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'roles', 'nguoi-viet.yaml'), 'id: nguoi-viet', 'utf8');
  fs.mkdirSync(path.join(root, 'artifacts', '.state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', '.state', 'session.json'), '{}', 'utf8');

  store.removeAll();

  assert.equal(fs.existsSync(path.join(root, 'office.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'roles', 'nguoi-viet.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'artifacts', '.state', 'session.json')), true);
});

test('an already-empty store returns 0, does not throw — a mistaken second click must stay quiet', () => {
  const { store } = fixture();
  store.removeAll();
  assert.equal(store.removeAll(), 0);
});
