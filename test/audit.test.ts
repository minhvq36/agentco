
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AuditLog, splitArmTool } from '../dist/core/audit.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-audit-'));

const call = (over: Record<string, unknown> = {}) => ({
  server: 'a354ff2bb34',
  tool: 'notion-create-pages',
  role: 'nguoi-soi-thu-muc',
  args: { pages: [{ title: 'test run' }] },
  ...over,
});


test('writes then reads back, PARAMS included — that is the whole reason this file exists', () => {
  const log = new AuditLog(tmp());
  log.append(call());
  const [rec] = log.list();
  assert.equal(rec?.tool, 'notion-create-pages');
  assert.equal(rec?.role, 'nguoi-soi-thu-muc');
  assert.ok(rec?.args.includes('test run'), 'losing the params makes the log line useless');
  assert.ok(rec?.ts, 'missing timestamp');
});

test('NEWEST FIRST — whoever is auditing always asks "what did it just do"', () => {
  const log = new AuditLog(tmp());
  log.append(call({ tool: 'cu' }));
  log.append(call({ tool: 'moi' }));
  assert.deepEqual(log.list().map((c) => c.tool), ['moi', 'cu']);
});

test('filters by connection — the question is always "what did THIS CONNECTION do"', () => {
  const log = new AuditLog(tmp());
  log.append(call({ server: 'a1' }));
  log.append(call({ server: 'a2' }));
  assert.deepEqual(log.list({ server: 'a1' }).map((c) => c.server), ['a1']);
});

test('no file yet => empty, does not throw', () => {
  assert.deepEqual(new AuditLog(path.join(tmp(), 'chua-co')).list(), []);
});


test('a directory that cannot be written to => does NOT throw — losing the log beats breaking a request', () => {
  const dir = tmp();
  const file = path.join(dir, 'chan');
  fs.writeFileSync(file, 'toi la mot FILE, khong phai thu muc');
  const log = new AuditLog(file);
  assert.doesNotThrow(() => log.append(call()));
  assert.deepEqual(log.list(), []);
});

test('a CORRUPT line drops only that line, not the whole file', () => {
  const dir = tmp();
  const log = new AuditLog(dir);
  log.append(call({ tool: 'truoc' }));
  fs.appendFileSync(path.join(dir, 'mcp-audit.jsonl'), '{"cut giua ch\n', 'utf8');
  log.append(call({ tool: 'sau' }));
  assert.deepEqual(log.list().map((c) => c.tool), ['sau', 'truoc']);
});

test('params that are too long get truncated, and it SAYS SO', () => {
  const log = new AuditLog(tmp());
  log.append(call({ args: { text: 'x'.repeat(5_000) } }));
  const [rec] = log.list();
  assert.equal(rec?.truncated, true);
  assert.ok(rec!.args.length < 2_100);
});

test('trim: keeps the NEW entries, drops the old ones', () => {
  const dir = tmp();
  const log = new AuditLog(dir);
  for (let i = 0; i < 2_100; i++) log.append(call({ tool: `t${i}` }));
  log.trim();
  const kept = log.list();
  assert.equal(kept.length, 2_000);
  assert.equal(kept[0]?.tool, 't2099', 'must keep the newest one');
});


test('splitArmTool: extracts the hash and the tool name correctly', () => {
  assert.deepEqual(splitArmTool('mcp__a354ff2bb34__notion-create-pages'), {
    server: 'a354ff2bb34',
    tool: 'notion-create-pages',
  });
});

test('splitArmTool: a tool that is NOT MCP => undefined', () => {
  for (const n of ['Read', 'Write', 'PowerShell', 'ToolSearch']) {
    assert.equal(splitArmTool(n), undefined);
  }
});

test('splitArmTool: bare `mcp__<server>` (no tool name) => undefined', () => {
  assert.equal(splitArmTool('mcp__files'), undefined);
});

test('splitArmTool: a tool name with `__` inside still parses correctly', () => {
  assert.deepEqual(splitArmTool('mcp__files__list__deep'), { server: 'files', tool: 'list__deep' });
});
