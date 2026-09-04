
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  MAX_SPILL_BYTES,
  doSpill,
  planSpill,
  readable,
  spillName,
  spillNotice,
} from '../dist/core/spill.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-spill-'));
const cliDir = path.join(tmp, 'cli-session', 'tool-results');
const artifacts = path.join(tmp, 'office', 'artifacts');
fs.mkdirSync(cliDir, { recursive: true });

const cliFile = path.join(cliDir, 'mcp-notion-notion-fetch-1787777435800.txt');
fs.writeFileSync(cliFile, 'x'.repeat(64_146), 'utf8');

const NOTICE =
  `Error: result (64,146 characters across 1 line) exceeds maximum allowed tokens. ` +
  `Output has been saved to ${cliFile}. Format: Plain text Use offset and limit parameters ` +
  `to read specific portions of the file.`;

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('⭐ recognizes the CLI spill-to-file notice and points into the office\'s artifacts', () => {
  const p = planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts);
  assert.ok(p, 'not recognized ⇒ the patch silently does nothing');
  assert.equal(p.from, cliFile);
  assert.equal(p.bytes, 64_146);
  assert.ok(p.to.startsWith(artifacts), 'must sit INSIDE the office — that is the whole point of the patch');
  assert.ok(p.rel.startsWith('artifacts/'), 'the model works relative to the office cwd');
});

test('🔴 MATCHES ON "saved to <path>", NOT on the word "Error"', () => {
  const reworded = NOTICE.replace('Error: result', 'Notice: output');
  assert.ok(planSpill(reworded, 'x', artifacts), 'changing the opening word breaks it ⇒ matching on the wrong thing');
});

test('⭐ an ordinary result ⇒ LEFT UNTOUCHED', () => {
  assert.equal(planSpill('{"ok":true}', 'x', artifacts), undefined);
  assert.equal(planSpill('', 'x', artifacts), undefined);
});

test('⭐ a tool_response that is not a string ⇒ skipped, no shape guessing', () => {
  assert.equal(planSpill({ content: [{ text: NOTICE }] }, 'x', artifacts), undefined);
  assert.equal(planSpill(null, 'x', artifacts), undefined);
});


test('🔴🔴 does NOT copy files OUTSIDE the tool-results directory — even if the notice claims otherwise', () => {
  const shared = path.join(tmp, 'company', '.state', 'secrets.json');
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.writeFileSync(shared, '{"NOTION_TOKEN":"ntn_secret"}');

  for (const doc of [shared, shared.replace(/\.json$/, '.txt')]) {
    fs.writeFileSync(doc, '{"NOTION_TOKEN":"ntn_secret"}');
    assert.equal(
      planSpill(`Output has been saved to ${doc}. Format: Plain text`, 'mcp__la__doc', artifacts),
      undefined,
      `copying ${path.basename(doc)} succeeded ⇒ this is a file-EXFILTRATION hole`,
    );
  }
});

test('🔴 a RELATIVE path ⇒ rejected — it would resolve against the daemon\'s cwd', () => {
  assert.equal(planSpill('saved to tool-results/x.txt', 'x', artifacts), undefined);
});

test('🔴 an extension other than .txt ⇒ rejected', () => {
  const fake = path.join(cliDir, 'fake.json');
  fs.writeFileSync(fake, 'x');
  assert.equal(planSpill(`saved to ${fake}`, 'x', artifacts), undefined);
});

test('⭐ the source check does NOT wrongly block a real case', () => {
  assert.ok(planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts));
});

test('⭐ the CLI file has already vanished ⇒ skipped, does NOT throw', () => {
  const gone = NOTICE.replace(cliFile, path.join(cliDir, 'does-not-exist.txt'));
  assert.equal(planSpill(gone, 'x', artifacts), undefined);
});

test('🔴 over the 50 MB cap ⇒ does NOT copy — this is the cap on the CLIENT\'S DISK', () => {
  const to = path.join(cliDir, 'to.txt');
  fs.writeFileSync(to, 'y');
  fs.truncateSync(to, MAX_SPILL_BYTES + 1);
  const p = planSpill(NOTICE.replace(cliFile, to), 'x', artifacts);
  assert.equal(p, undefined, 'a runaway service must not fill up the client\'s disk');
});

test('⭐ actually copies, WITHOUT losing a single character', () => {
  const p = planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts)!;
  assert.equal(doSpill(p), true);
  const got = fs.readFileSync(p.to, 'utf8');
  assert.equal(got.replace(/\n/g, ''), 'x'.repeat(64_146), 'characters lost while wrapping lines');
  assert.ok(got.split('\n').length > 50, 'copied but still one line ⇒ not yet readable in parts');
  assert.equal(fs.existsSync(cliFile), true, 'COPIES rather than MOVES — the original belongs to the CLI');
});


test('🔴🔴 73 KB ON A SINGLE LINE ⇒ MUST WRAP INTO LINES, otherwise it is an endless loop', () => {
  const one = JSON.stringify({ title: 'x', text: 'a'.repeat(60_000) });
  assert.equal(one.split('\n').length, 1, 'test premise: the input is exactly one line');
  const r = readable(one);
  assert.equal(r.changed, true);
  const lines = r.text.split('\n');
  assert.ok(lines.length > 50, `only ${lines.length} lines — Read still cannot cut it up`);
  assert.ok(Math.max(...lines.map((l) => l.length)) <= 2_000, 'a line is still too long ⇒ still blows the cap');
});

test('⭐ JSON: the content is UNPACKED, not re-escaped', () => {
  const raw = JSON.stringify({ text: ['line 1', 'line 2', 'line 3'].join('\n') + 'z'.repeat(3_000) });
  const r = readable(raw);
  assert.match(r.text, /── text ──/);
  assert.match(r.text, /line 1\nline 2\nline 3/, 'a newline must be a REAL newline');
  assert.doesNotMatch(r.text, /\\n/, 'still escaped ⇒ not yet unpacked');
});

test('⭐ NOT JSON ⇒ hard-wraps lines, still readable', () => {
  const r = readable('q'.repeat(50_000));
  assert.equal(r.changed, true);
  assert.ok(r.text.split('\n').length > 50);
});

test('⭐ content that is ALREADY multi-line ⇒ LEFT UNTOUCHED', () => {
  const ok = 'short line\n'.repeat(5_000);
  const r = readable(ok);
  assert.equal(r.changed, false);
  assert.equal(r.text, ok);
});

test('⭐ the pointer message must NOT instruct something it cannot do', () => {
  const s = spillNotice(planSpill(NOTICE, 'mcp__h__notion-fetch', artifacts)!);
  assert.match(s, /already broken into lines/);
});


test('🔴 THE HASH MUST NOT LEAK INTO THE FILE NAME (user caught this on 27/08)', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'name-'));
  const n = spillName('mcp__a46a7e26403__notion-fetch', d);
  assert.equal(n, 'notion-fetch.txt');
  assert.doesNotMatch(n, /a46a7e26403/, 'the hash leaked onto the screen');
  assert.doesNotMatch(n, /[\\/:*?"<>|]/, 'must be valid on all three operating systems');
});

test('⭐ two runs of the same task ⇒ two files, evidence is not overwritten', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'count-'));
  const a = spillName('mcp__h__notion-fetch', d);
  fs.writeFileSync(path.join(d, a), 'x');
  const b = spillName('mcp__h__notion-fetch', d);
  assert.equal(a, 'notion-fetch.txt');
  assert.equal(b, 'notion-fetch-2.txt', 'an ascending counter is meaningful; a 13-digit epoch is not');
});

test('🔴 lands in the TASK\'S OWN DIRECTORY, not the artifacts root', () => {
  const out = path.join(artifacts, 'P-260827-0347-abcd', 'T-01');
  const p = planSpill(NOTICE, 'mcp__a46a7e26403__notion-fetch', out, artifacts)!;
  assert.ok(p, 'failed to build a plan');
  assert.equal(p.rel, 'artifacts/P-260827-0347-abcd/T-01/notion-fetch.txt');
  assert.ok(p.to.startsWith(out));
});

test('🔴 THE REPLACEMENT MESSAGE MUST NOT CARRY THE WORD "ERROR"', () => {
  const s = spillNotice(planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts)!);
  assert.doesNotMatch(s, /error/i);
  assert.match(s, /did NOT fail/);
});

test('⭐ the replacement message states the NEXT STEP, right on the line with the path', () => {
  const s = spillNotice(planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts)!);
  assert.match(s, /artifacts\//);
  assert.match(s, /Read/);
  assert.match(s, /Grep/);
  assert.match(s, /63 KB/, 'must state the SIZE — the user needs to know why this time is different');
});


test('🔴 the same CLI notice, TOOL NAME swapped to GitHub ⇒ identical behavior', () => {
  const notion = planSpill(NOTICE, 'mcp__notion__notion-fetch', artifacts);
  const github = planSpill(NOTICE, 'mcp__a1b2c3__get_file_contents', artifacts);
  assert.ok(github, 'GitHub must go through that exact same path — 0 lines of dedicated code');
  assert.equal(github.from, notion!.from);
  assert.equal(github.bytes, notion!.bytes);
  assert.equal(path.basename(github.to), 'get_file_contents.txt');
});

test('🔴 a tool that is NOT MCP (Read/Bash/WebFetch) goes through that same path too', () => {
  const p = planSpill(NOTICE, 'WebFetch', artifacts);
  assert.ok(p);
  assert.equal(path.basename(p.to), 'WebFetch.txt');
});

test('🔴 NO vendor name in the EXECUTABLE CODE of `spill.ts`', () => {
  const src = fs.readFileSync(new URL('../src/core/spill.ts', import.meta.url), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') && !l.includes('│');
    })
    .join('\n');
  for (const vendor of ['notion', 'github', 'githubcopilot']) {
    assert.doesNotMatch(code, new RegExp(vendor, 'i'), `\`${vendor}\` must not be present in the code`);
  }
});
