
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cutQuery, redactBrowserLogs, resetRedactMarks } from '../dist/core/redact.js';
import { guardedZone } from '../dist/core/paths.js';


test('⭐ cutQuery — a real case actually observed on disk', () => {
  const before =
    '[ERROR] Failed to load resource @ https://www.facebook.com/ajax/bnzai?__a=1&fb_dtsg=AbCdEfGhIjKlMn&__user=100000000000001';
  const after = cutQuery(before);
  assert.ok(!after.includes('fb_dtsg'), 'token still in the log');
  assert.ok(!after.includes('100000000000001'), 'user id still in the log');
  assert.ok(after.includes('https://www.facebook.com/ajax/bnzai'));
});

test('⭐ cuts the FRAGMENT too, not just the query', () => {
  const after = cutQuery('opening https://x.test/cb#access_token=abc123&expires_in=3600 done');
  assert.ok(!after.includes('access_token'));
  assert.ok(after.includes('https://x.test/cb'));
});

test('cuts at whichever marker comes FIRST when both are present', () => {
  assert.equal(cutQuery('https://a.test/p?q=1#f=2'), 'https://a.test/p');
  assert.equal(cutQuery('https://a.test/p#f=2?q=1'), 'https://a.test/p');
});

test('a clean URL is left UNTOUCHED, and so is the surrounding text', () => {
  const s = 'see https://a.test/duong/dan and done';
  assert.equal(cutQuery(s), s);
});

test('⭐ running it twice yields the exact same result', () => {
  const s = '[ERROR] https://a.test/x?tok=1 and https://b.test/y#z=2';
  assert.equal(cutQuery(cutQuery(s)), cutQuery(s));
});

test('no URL at all ⇒ returns the text unchanged', () => {
  const s = '[LOG] just a normal line of text';
  assert.equal(cutQuery(s), s);
});


test('⭐ only touches `console-*.log`, NEVER touches snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  const out = path.join(dir, '.playwright-mcp');
  fs.mkdirSync(out, { recursive: true });

  const log = path.join(out, 'console-2026-08-29T09-58-07-520Z.log');
  const snap = path.join(out, 'page-2026-08-29T09-58-26-993Z.yml');
  fs.writeFileSync(log, '[ERROR] https://x.test/a?fb_dtsg=SECRET');
  const snapContent = 'link "Home" /url: https://x.test/a?ref=home';
  fs.writeFileSync(snap, snapContent);

  resetRedactMarks();
  const n = redactBrowserLogs(dir);
  assert.equal(n, 1, 'must fix exactly one file');
  assert.ok(!fs.readFileSync(log, 'utf8').includes('SECRET'));
  assert.equal(fs.readFileSync(snap, 'utf8'), snapContent, 'snapshot got modified — the worker would read it wrong');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('no directory ⇒ returns immediately, 0 files — the case for most offices', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  resetRedactMarks();
  assert.equal(redactBrowserLogs(dir), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('⭐ an already-cleaned file is NOT re-read on the next pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-redact-'));
  const out = path.join(dir, '.playwright-mcp');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'console-a.log'), '[ERROR] https://x.test/a?tok=1');

  resetRedactMarks();
  assert.equal(redactBrowserLogs(dir), 1);
  assert.equal(redactBrowserLogs(dir), 0, 're-scanning old files would cost I/O on every tool call');

  fs.rmSync(dir, { recursive: true, force: true });
});


test('⭐ the browser profile sits BEHIND guardedZone — employees cannot read it', () => {
  const dirs = { companyDir: path.join('C:', 'cty'), officeDir: path.join('C:', 'cty', 'offices', 'kt') };
  for (const target of [
    path.join('.state', 'browser', 'profile'),
    path.join('.state', 'browser', 'profile', 'Default', 'Network', 'Cookies'),
    path.join(dirs.officeDir, '.state', 'browser', 'profile'),
  ]) {
    assert.equal(guardedZone(dirs, target, 'read'), 'secrets', `"${target}" slipped past the fence`);
  }
  const withArm = { ...dirs, hasBrowser: true };

  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'page-1.yml'), 'read'), undefined);

  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'console-1.log'), 'read'), 'browser');

  assert.equal(guardedZone(dirs, path.join('.playwright-mcp', 'page-1.yml'), 'read'), 'browser');

  assert.equal(guardedZone(dirs, path.join('.playwright-mcp', 'x.trace.zip'), 'read'), 'browser');

  assert.equal(guardedZone(withArm, path.join('.playwright-mcp', 'x.har'), 'read'), 'browser');

  assert.equal(guardedZone(withArm, path.join('artifacts', 'page-1.yml'), 'read'), undefined);
});
