
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { defaultArmLabel } from '../dist/core/armexec.js';


test('http: takes the DOMAIN NAME, and strips the technical `mcp.` prefix', () => {
  assert.equal(defaultArmLabel({ type: 'http', url: 'https://mcp.deepwiki.com/mcp' }), 'deepwiki.com');
  assert.equal(defaultArmLabel({ type: 'http', url: 'https://mcp.notion.com/mcp' }), 'notion.com');
  assert.equal(defaultArmLabel({ type: 'sse', url: 'http://127.0.0.1:3009/sse' }), '127.0.0.1');
});

test('http: a domain with no prefix is kept as-is', () => {
  assert.equal(defaultArmLabel({ url: 'https://api.githubcopilot.com/mcp/' }), 'api.githubcopilot.com');
});


test('stdio: takes the PACKAGE NAME, strips the scope', () => {
  const cfg = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] };
  assert.equal(defaultArmLabel(cfg), 'server-memory');
});

test('stdio: a VERSIONED package does not carry its version into the name', () => {
  const cfg = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10', 'D:\\x'] };
  assert.equal(defaultArmLabel(cfg), 'server-filesystem');
});

test('stdio NOT via npx: takes the program name, not the whole path', () => {
  assert.equal(defaultArmLabel({ command: 'D:\\bin\\my-server.exe', args: [] }), 'my-server');
  assert.equal(defaultArmLabel({ command: 'python' }), 'python');
});


test('🔴 when nothing can be inferred ⇒ `undefined`, so the caller falls back to the HASH', () => {
  assert.equal(defaultArmLabel({ type: 'sdk', name: 'x' }), undefined);
  assert.equal(defaultArmLabel({ url: 'khong-phai-url' }), undefined);
  assert.equal(defaultArmLabel({}), undefined);
  assert.equal(defaultArmLabel(null), undefined);
  assert.equal(defaultArmLabel('a-string'), undefined);
});

test('⭐ does NOT scan `url` at every level — a `url` nested inside `env`/`headers` is NOT the endpoint', () => {
  const cfg = { command: 'npx', args: ['-y', 'server-x'], env: { API_URL: 'https://vendor.example.com' } };
  assert.equal(defaultArmLabel(cfg), 'server-x', 'must take the package name, NOT vendor.example.com');
});
