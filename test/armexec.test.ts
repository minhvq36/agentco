
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { fastLaunch, npxSpec, packageName } from '../dist/core/armexec.js';

const PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';


test('npxSpec: correctly splits the package from the server\'s own args', () => {
  assert.deepEqual(npxSpec({ command: 'npx', args: ['-y', PKG, 'D:\\Downloads\\x'] }), {
    spec: PKG,
    rest: ['D:\\Downloads\\x'],
  });
});

test('npxSpec: several flags before the package name still split correctly', () => {
  const r = npxSpec({ command: 'npx', args: ['-y', '--offline', PKG, '/a', '/b'] });
  assert.equal(r?.spec, PKG);
  assert.deepEqual(r?.rest, ['/a', '/b']);
});

test('npxSpec: leaves NON-npx commands alone', () => {
  assert.equal(npxSpec({ command: 'node', args: ['x.js'] }), undefined);
  assert.equal(npxSpec({ url: 'https://api.githubcopilot.com/mcp/' }), undefined);
});

test('npxSpec: `--package=` changes what the positional arg means ⇒ SAY "DON\'T KNOW"', () => {
  assert.equal(npxSpec({ command: 'npx', args: ['-y', '--package=a', 'lenh'] }), undefined);
});

test('npxSpec: an unfamiliar shape returns undefined, never throws', () => {
  assert.equal(npxSpec({ command: 'npx' }), undefined);
  assert.equal(npxSpec({ command: 'npx', args: ['-y'] }), undefined);
  assert.equal(npxSpec({ command: 'npx', args: [1, 2] as never }), undefined);
  assert.equal(npxSpec({}), undefined);
});


test('packageName: a scoped package keeps its scope', () => {
  assert.equal(packageName(PKG), '@modelcontextprotocol/server-filesystem');
  assert.equal(packageName('@scope/x@1.0.0'), '@scope/x');
});

test('packageName: an unscoped package, and a package with no pinned version', () => {
  assert.equal(packageName('wscat@5.1.0'), 'wscat');
  assert.equal(packageName('wscat'), 'wscat');
  assert.equal(packageName('@scope/x'), '@scope/x');
});


test('fastLaunch: nothing installed yet ⇒ returns the ORIGINAL config unchanged', () => {
  const cfg = { command: 'npx', args: ['-y', 'goi-khong-bao-gio-ton-tai-9f3a', '/x'] };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: an HTTP server with no `command` — not touched at all', () => {
  const cfg = { url: 'https://api.githubcopilot.com/mcp/', headers: { a: 'b' } };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: a config the user wired themselves (not npx) is left unchanged', () => {
  const cfg = { command: 'node', args: ['/srv/mcp.js'], env: { TOKEN: 'x' } };
  assert.deepEqual(fastLaunch(cfg), cfg);
});

test('fastLaunch: KEEPS `env` — an injected key must not get dropped', () => {
  const cfg = { command: 'npx', args: ['-y', PKG, '/x'], env: { NOTION_TOKEN: 'secret' } };
  const out = fastLaunch(cfg) as typeof cfg;
  assert.deepEqual(out.env, { NOTION_TOKEN: 'secret' });
});

test('fastLaunch: NEVER throws, even on garbage input', () => {
  for (const bad of [{}, { command: 'npx', args: null }, { command: null }] as never[]) {
    assert.doesNotThrow(() => fastLaunch(bad));
  }
});
