
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultArmLabel, prepareArm } from '../dist/core/armexec.js';
import { armHash } from '../dist/core/catalog.js';
import { guardedZone } from '../dist/core/paths.js';
import {
  ArgvError,
  CliArmSchema,
  cliSays,
  cliToolNames,
  compileCliArm,
  fillArgv,
  isCliArm,
  parseCliArm,
  runCommand,
} from '../dist/core/cli-arm.js';
import { injectSecrets, missingSecretRefs } from '../dist/core/secrets.js';

const act = (over: Record<string, unknown> = {}) =>
  CliArmSchema.parse({
    type: 'cli',
    actions: [
      {
        id: 'trien_khai',
        say: 'deploy to staging',
        description: 'Push the current branch to staging. Overwrites the running build, cannot be undone.',
        run: ['pnpm', 'deploy', '--env', 'staging', '--tag', '{tag}'],
        params: [{ name: 'tag', type: 'string', required: true }],
        ...over,
      },
    ],
  }).actions[0]!;


test('argv stays an ARRAY, the parameter fits inside exactly one element', () => {
  const a = fillArgv(act(), { tag: 'v1.2.3' });
  assert.ok(Array.isArray(a));
  assert.deepEqual(a, ['pnpm', 'deploy', '--env', 'staging', '--tag', 'v1.2.3']);
});

test('shell metacharacters are just DATA — never split into a second element', () => {
  for (const doc of ['v1; calc', 'v1 && calc', 'v1 | calc', 'v1`calc`', 'v1$(calc)']) {
    const a = fillArgv(act(), { tag: doc });
    assert.equal(a.length, 6, `"${doc}" changed the argv element count`);
    assert.equal(a[5], doc);
  }
});

test('a value starting with `-` is REJECTED — blocked BEFORE spawn', () => {
  assert.throws(() => fillArgv(act(), { tag: '--force' }), ArgvError);
  const ok = act({ params: [{ name: 'tag', type: 'string', required: true, allow_dash: true }] });
  assert.deepEqual(fillArgv(ok, { tag: '--force' }).at(-1), '--force');
});

test('checked BEFORE substitution: `--tag=--force` cannot dodge the dash rule', () => {
  assert.throws(() => fillArgv(act(), { tag: '--force' }), /starts with a dash/);
});

test('integer: min, max, not-a-number', () => {
  const a = act({
    run: ['x', '--mat', '{mat}'],
    params: [{ name: 'mat', type: 'integer', required: true, min: 2, max: 100 }],
  });
  assert.deepEqual(fillArgv(a, { mat: 6 }), ['x', '--mat', '6']);
  assert.throws(() => fillArgv(a, { mat: 1 }), />= 2/);
  assert.throws(() => fillArgv(a, { mat: 999 }), /<= 100/);
  assert.throws(() => fillArgv(a, { mat: 'six' }), /whole number/);
});

test('`pattern` mismatch and a required parameter left empty', () => {
  const a = act({ params: [{ name: 'tag', type: 'string', required: true, pattern: '^[a-z0-9.-]+$' }] });
  assert.throws(() => fillArgv(a, { tag: 'Has Space' }), /does not match the pattern/);
  assert.throws(() => fillArgv(a, {}), /missing required parameter/);
});

test('a placeholder with no matching parameter => error, never silently left as `{x}`', () => {
  const a = act({ run: ['x', '{khong_khai}'], params: [] });
  assert.throws(() => fillArgv(a, {}), /has no parameter for/);
});


test('four SEPARATE doors: spawn, timeout, exit, (fail_when lives at the tool layer)', async () => {
  const cwd = os.tmpdir();
  const env = { PATH: process.env['PATH'] ?? '' };

  const ok = await runCommand({ argv: [process.execPath, '-e', 'console.log(7)'], cwd, env, timeoutMs: 20_000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.door, undefined);
  assert.match(ok.stdout, /7/);

  const bad = await runCommand({ argv: ['khong-co-binary-nay-dau'], cwd, env, timeoutMs: 20_000 });
  assert.equal(bad.door, 'spawn');

  const fail = await runCommand({ argv: [process.execPath, '-e', 'process.exit(3)'], cwd, env, timeoutMs: 20_000 });
  assert.equal(fail.door, 'exit');
  assert.equal(fail.code, 3);

  const slow = await runCommand({
    argv: [process.execPath, '-e', 'setTimeout(()=>{},60000)'],
    cwd,
    env,
    timeoutMs: 1_200,
  });
  assert.equal(slow.door, 'timeout');
  assert.equal(slow.ok, false);
});


test('isCliArm reads `type`, does NOT infer from "no command and no url"', () => {
  assert.equal(isCliArm({ type: 'cli', actions: [] }), true);
  assert.equal(isCliArm({ command: 'npx', args: [] }), false);
  assert.equal(isCliArm({ type: 'http', url: 'https://x/mcp' }), false);
  assert.equal(isCliArm({ hoan: 'toan la rac' }), false);
  assert.equal(isCliArm(null), false);
});

test('`runs_on` defaults to `daemon` — the Docker option must be present from line one (§16p ⑥)', () => {
  const parsed = CliArmSchema.parse({
    type: 'cli',
    actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }],
  });
  assert.equal(parsed.runs_on, 'daemon');
  assert.equal(parsed.actions[0]!.timeout_ms, 120_000);
});

test('cliToolNames takes the id, cliSays takes the human-readable sentence and CAPS AT 4', () => {
  const decl = {
    type: 'cli',
    actions: Array.from({ length: 6 }, (_, i) => ({
      id: `viec_${i}`,
      say: `task ${i}`,
      description: 'd',
      run: ['x'],
    })),
  };
  assert.deepEqual(cliToolNames(decl).length, 6);
  assert.deepEqual(cliSays(decl), ['task 0', 'task 1', 'task 2', 'task 3']);
  assert.deepEqual(cliSays({ type: 'http', url: 'https://x/mcp' }), []);
});


test('a `${…}` placeholder in `actions[].env` gets FILLED IN — otherwise it loops forever like the 08/31 bug', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 's', description: 'd', run: ['x'], env: { API_TOKEN: '${SHOP_TOKEN}' } },
    ],
  };
  assert.deepEqual(missingSecretRefs(decl), ['SHOP_TOKEN']);
  const filled = injectSecrets(decl, { SHOP_TOKEN: 'abc123' }) as typeof decl;
  assert.equal(filled.actions[0]!.env!['API_TOKEN'], 'abc123');
  assert.deepEqual(missingSecretRefs(filled), []);
});

test('secrets are NOT dumped wholesale into the child process env', () => {
  const decl = {
    type: 'cli',
    actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }],
  };
  const filled = injectSecrets(decl, { BI_MAT_CUA_CONG_TY: 'xyz' });
  assert.ok(!JSON.stringify(filled).includes('xyz'), 'an undeclared secret still leaked into the CLI declaration');
});


test('hash: changing the declaration => changes the hash; changing a secret\'s VALUE => hash does NOT change', () => {
  const a = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
  const b = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['y'] }] };
  assert.notEqual(armHash(a, ['T']), armHash(b, ['T']));
  assert.equal(armHash(a, ['T']), armHash(a, ['T']));
});

test('NO `dirs` => prepareArm does NOT build a server', () => {
  const decl = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
  const out = prepareArm('a1', decl, {}) as Record<string, unknown>;
  assert.equal(out['type'], 'cli');
  assert.equal(out['instance'], undefined);
});

test('with `dirs` => builds a real SDK server, and the declaration no longer leaks out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-arm-test-'));
  try {
    const decl = { type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: ['x'] }] };
    const out = prepareArm('a1', decl, {}, { officeState: dir, officeDir: dir }) as Record<string, unknown>;
    assert.equal(out['type'], 'sdk');
    assert.equal(out['name'], 'a1');
    assert.ok(out['instance'], 'missing instance => the SDK has nothing to run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


const minimal = (over: Record<string, unknown> = {}) => ({
  type: 'cli',
  actions: [{ id: 'a', say: 's', description: 'd', run: ['x'], ...over }],
});

test('the three most-typo\'d camelCase keys are REJECTED with the right suggestion', () => {
  for (const [bad, good] of [
    ['readOnly', 'read_only'],
    ['timeoutMs', 'timeout_ms'],
    ['failWhen', 'fail_when'],
  ] as const) {
    const r = parseCliArm(minimal({ [bad]: bad === 'failWhen' ? ['ERROR'] : true }));
    assert.equal(r.ok, false, `"${bad}" slipped through — the safety net vanished silently`);
    assert.match((r as { error: string }).error, new RegExp(`"${bad}".*"${good}"`));
  }
});

test('a one-character typo also gets a suggestion; a totally unknown key is stated plainly', () => {
  const a = parseCliArm(minimal({ runs: ['x'] }));
  assert.match((a as { error: string }).error, /"runs".*"run"/);
  const b = parseCliArm(minimal({ hoan_toan_la: 1 }));
  assert.match((b as { error: string }).error, /không có trong tờ khai/); // i18n-allow-vietnamese: matches real i18n error string (default locale vi)
});

test('the LOADING gate is still LOOSE — tightening both would orphan every existing arm', () => {
  assert.doesNotThrow(() => CliArmSchema.parse(minimal({ truong_cua_ban_moi_hon: 1 })));
  assert.equal(parseCliArm(minimal({ truong_cua_ban_moi_hon: 1 })).ok, false);
});

test('a valid declaration => `parseCliArm` returns the arm with defaults filled in', () => {
  const r = parseCliArm(minimal());
  assert.equal(r.ok, true);
  assert.equal((r as { arm: { runs_on: string } }).arm.runs_on, 'daemon');
});


test('`params[].example` lands in the description of the RIGHT property, capped at 60 chars', () => {
  const ok = parseCliArm({
    type: 'cli',
    actions: [
      {
        id: 'a',
        say: 's',
        description: 'd',
        run: ['x', '{tag}'],
        params: [{ name: 'tag', type: 'string', required: true, example: 'v1.2.3' }],
      },
    ],
  });
  assert.equal(ok.ok, true);
  const dai = parseCliArm({
    type: 'cli',
    actions: [
      {
        id: 'a',
        say: 's',
        description: 'd',
        run: ['x', '{tag}'],
        params: [{ name: 'tag', type: 'string', example: 'x'.repeat(61) }],
      },
    ],
  });
  assert.equal(dai.ok, false);
});


test('CORE STAYS NEUTRAL: a CLI declaration runs regardless of origin — gated at the DOOR, not the CORE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-core-'));
  try {
    const out = prepareArm('a1', minimal(), {}, { officeState: dir, officeDir: dir }) as Record<string, unknown>;
    assert.equal(out['type'], 'sdk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('`company.yaml` lives in the `config` zone — writable would let a role with shell disabled self-declare a shell', () => {
  const companyDir = path.join(os.tmpdir(), 'ct-company');
  const officeDir = path.join(companyDir, 'offices', 'vp');
  const dirs = { companyDir, officeDir };

  assert.equal(guardedZone(dirs, path.join(companyDir, 'company.yaml'), 'write'), 'config');
  assert.equal(guardedZone(dirs, path.join(companyDir, 'company.yaml'), 'arm'), 'config');
  assert.equal(guardedZone(dirs, path.join(officeDir, 'office.yaml'), 'write'), 'config');
  assert.equal(guardedZone(dirs, path.join(companyDir, '.state', 'secrets.json'), 'read'), 'secrets');
  assert.equal(guardedZone(dirs, path.join(companyDir, 'logs', 'usage.jsonl'), 'read'), undefined);
  assert.equal(guardedZone(dirs, path.join(officeDir, 'artifacts', 'a.md'), 'write'), undefined);
});

test('default label: the FIRST action\'s program name, never a concatenation of action names', () => {
  const decl = {
    type: 'cli',
    actions: [
      { id: 'a', say: 'count invoices', description: 'd', run: ['C:\\Python\\python.exe', '-m', 'hoadon'] },
      { id: 'b', say: 'sync', description: 'd', run: ['node', 'x.js'] },
    ],
  };
  assert.equal(defaultArmLabel(decl), 'python');
  assert.equal(defaultArmLabel({ type: 'cli', actions: [{ id: 'a', say: 's', description: 'd', run: [] }] }), undefined);
});

// ── an unknown parameter is refused, through the REAL MCP path (21/09) ──
//
// ⚠ Through a real client, not by calling the handler: the stripping happened
// in the SDK's own `z.object`, BEFORE the handler — a test that calls the
// handler directly would pass while the product still stripped. `InMemory`
// comes from the MCP SDK that `claude-agent-sdk` itself runs on.

async function callThroughMcp(decl: unknown, args: Record<string, unknown>) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const calls: { argv: string[] }[] = [];
  const cfg = compileCliArm('probe', decl, { officeDir: os.tmpdir(), env: {}, onCall: (r) => calls.push(r) }) as {
    instance: { connect(t: unknown): Promise<void> };
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await cfg.instance.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const listed = await client.listTools();
  const r = (await client.callTool({ name: 'echo', arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  await client.close();
  return { r, calls, schema: listed.tools[0]!.inputSchema };
}

const echo = (run: string[], params?: unknown[]) => ({
  type: 'cli',
  actions: [{ id: 'echo', say: 'echo', description: 'echo', run, ...(params ? { params } : {}) }],
});
const NODE_ECHO = [process.execPath, '-e', 'console.log(process.argv.slice(1).join("|"))'];

test('a command with NO blank refuses a parameter instead of running its fixed line', async () => {
  const { r, calls } = await callThroughMcp(echo([...NODE_ECHO, 'placeholder text']), { content: 'Xin chao thang 8' });
  assert.equal(r.isError, true, 'shipped behaviour: the key was stripped and the fixed line ran as a success');
  assert.equal(calls.length, 0, 'nothing may be spawned when the call was refused');
  assert.match(r.content[0]!.text, /takes NO parameters/);
  assert.match(r.content[0]!.text, /content/);
});

test('a command WITH a blank refuses an extra key, and still runs with the declared one', async () => {
  const decl = echo([...NODE_ECHO, '{msg}'], [{ name: 'msg', type: 'string', required: true }]);

  const bad = await callThroughMcp(decl, { msg: 'hi', content: 'extra' });
  assert.equal(bad.r.isError, true);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.r.content[0]!.text, /accepts only: msg/);

  const good = await callThroughMcp(decl, { msg: 'Xin chao thang 8' });
  assert.notEqual(good.r.isError, true);
  assert.equal(good.r.content[0]!.text.trim(), 'Xin chao thang 8');
  // The model is shown the same parameter list as before the change.
  assert.deepEqual(Object.keys((good.schema as { properties: object }).properties), ['msg']);
});

test('a command with no blank, called with no arguments, still just runs', async () => {
  const { r, calls } = await callThroughMcp(echo([...NODE_ECHO, 'fixed']), {});
  assert.notEqual(r.isError, true);
  assert.equal(calls.length, 1);
  assert.equal(r.content[0]!.text.trim(), 'fixed');
});

test('a NON-CLI config passes through prepareArm untouched (no cross-contamination)', () => {
  const http = { type: 'http', url: 'https://mcp.deepwiki.com/mcp' };
  assert.deepEqual(prepareArm('a2', http, {}), http);
  const stdio = { command: 'node', args: ['x.js'] };
  assert.deepEqual(prepareArm('a3', stdio, {}), stdio);
});
