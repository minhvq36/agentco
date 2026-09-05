
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { loadCompanyConfig, loadOffice } from '../src/core/config.js';
import { TaskBriefSchema } from '../src/core/types.js';
import { runWorker } from '../src/core/worker.js';


const argv = process.argv.slice(2);
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const has = (n: string) => argv.includes(`--${n}`);
const positional = argv.filter((a) => !a.startsWith('--'));

const companyDir = path.resolve(positional[0] ?? 'company');
const officeId = positional[1] ?? 'canh-tay';
const roleId = positional[2] ?? 'nguoi-soi-thu-muc';
const ONLY = flag('only');
const wants = (phase: string) => !ONLY || ONLY === phase;
const HANG = Number(flag('treo') ?? 0);


interface CliParam {
  name: string;
  type: 'string' | 'integer';
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  allowDash?: boolean;
}

interface CliAction {
  id: string;
  say: string;
  description: string;
  run: string[];
  params?: CliParam[];
  cwd?: string;
  timeoutMs: number;
  failWhen?: string[];
  readOnly?: boolean;
}

interface CliArm {
  id: string;
  label: string;
  actions: CliAction[];
}


interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  door?: 'spawn' | 'timeout' | 'exit' | 'fail_when';
}

function runCommand(opts: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<RunResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const [cmd, ...rest] = opts.argv;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd!, rest, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
      });
    } catch (e) {
      resolve({ ok: false, code: null, stdout: '', stderr: (e as Error).message, ms: 0, door: 'spawn' });
      return;
    }

    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already dead */
      }
    }, opts.timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: out, stderr: e.message, ms: Date.now() - t0, door: 'spawn' });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        code,
        stdout: out,
        stderr: err,
        ms: Date.now() - t0,
        ...(timedOut ? { door: 'timeout' as const } : code !== 0 ? { door: 'exit' as const } : {}),
      });
    });
  });
}


class ArgvError extends Error {}

function fillArgv(a: CliAction, args: Record<string, unknown>): string[] {
  const byName = new Map((a.params ?? []).map((p) => [p.name, p]));

  const value = (name: string): string => {
    const p = byName.get(name);
    if (!p) throw new ArgvError(`argv has a placeholder "{${name}}" but no param declares it`);
    const raw = args[name];
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) throw new ArgvError(`missing required parameter "${name}"`);
      throw new ArgvError(`parameter "${name}" has no value yet`);
    }
    if (p.type === 'integer') {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new ArgvError(`"${name}" must be an integer, got "${String(raw)}"`);
      if (p.min !== undefined && n < p.min) throw new ArgvError(`"${name}" must be ≥ ${p.min}`);
      if (p.max !== undefined && n > p.max) throw new ArgvError(`"${name}" must be ≤ ${p.max}`);
      return String(n);
    }
    const s = String(raw);
    if (!p.allowDash && s.startsWith('-')) {
      throw new ArgvError(
        `"${name}" starts with a dash ("${s}") — a value must not turn into a command-line flag. ` +
          `If this really is intended, declare allow_dash for this parameter.`,
      );
    }
    if (p.pattern && !new RegExp(p.pattern).test(s)) {
      throw new ArgvError(`"${name}" does not match pattern ${p.pattern}: "${s}"`);
    }
    return s;
  };

  return a.run.map((el) => el.replace(/\{([a-z0-9_]+)\}/gi, (_, n: string) => value(n)));
}


const calls: { tool: string; args: unknown; at: number; ms?: number }[] = [];

function buildTools(arm: CliArm, ctx: { sandbox: string; env: Record<string, string> }) {
  return arm.actions.map((a) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const p of a.params ?? []) {
      let s: z.ZodTypeAny = p.type === 'integer' ? z.number().int() : z.string();
      shape[p.name] = p.required ? s : (s = s.optional());
    }

    return tool(
      a.id,
      a.description,
      shape,
      async (args): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
        const rec = { tool: a.id, args, at: Date.now() };
        calls.push(rec);
        console.log(`      ⚙ CLI ACTUALLY CALLED: ${a.id}(${JSON.stringify(args)})`);
        let filled: string[];
        try {
          filled = fillArgv(a, args as Record<string, unknown>);
        } catch (e) {
          return { content: [{ type: 'text', text: `Invalid parameter: ${(e as Error).message}` }], isError: true };
        }

        const cwd = (a.cwd ?? '{sandbox}').replace('{sandbox}', ctx.sandbox);

        if (!fs.existsSync(cwd)) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Could not run the command — the working directory "${cwd}" does not exist. ` +
                  `This is NOT about "${filled[0]}" being missing on the machine; do not go install anything.`,
              },
            ],
            isError: true,
          };
        }

        const r = await runCommand({ argv: filled, cwd, env: ctx.env, timeoutMs: a.timeoutMs });
        (rec as { ms?: number }).ms = Date.now() - rec.at;

        const body = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
        const hit = a.failWhen?.find((s) => body.includes(s));

        if (r.door === 'spawn') {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Could not run the command — this machine could not find "${filled[0]}" (or has no permission to run it). ` +
                  `This is NOT a parameter error, and the command did not run and then fail either.\n${r.stderr}`,
              },
            ],
            isError: true,
          };
        }
        if (r.door === 'timeout') {
          return {
            content: [
              { type: 'text', text: `The command ran past ${a.timeoutMs} ms and was stopped. Any result is incomplete.\n${body}` },
            ],
            isError: true,
          };
        }
        if (hit) {
          return {
            content: [
              { type: 'text', text: `The command exited with code 0 BUT the output shows a failure marker ("${hit}"). Treat it as FAILED.\n${body}` },
            ],
            isError: true,
          };
        }
        if (!r.ok) {
          return { content: [{ type: 'text', text: `Command failed (code ${r.code}).\n${body}` }], isError: true };
        }
        return { content: [{ type: 'text', text: body || '(command finished, printed nothing)' }] };
      },
      {
        annotations: { readOnlyHint: a.readOnly === true, destructiveHint: a.readOnly !== true },
      },
    );
  });
}


const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-arm-'));

fs.writeFileSync(
  path.join(sandbox, 'xucxac.py'),
  [
    'import argparse, random, sys, time',
    'p = argparse.ArgumentParser()',
    "p.add_argument('--mat', type=int, default=6)",
    "p.add_argument('--cho', type=int, default=10)",
    'a = p.parse_args()',
    'time.sleep(a.cho)',
    'print(random.randint(1, a.mat))',
    'sys.exit(0)',
  ].join('\n'),
  'utf8',
);

fs.writeFileSync(
  path.join(sandbox, 'dongbo.py'),
  ['import sys', "print('ERROR: could not connect to the database')", 'sys.exit(0)'].join('\n'),
  'utf8',
);

const INVOICE_COUNT = 3000 + Math.floor(Math.random() * 7000);
fs.writeFileSync(
  path.join(sandbox, 'hoadon.py'),
  ['import sys', `print('Unpaid: ${INVOICE_COUNT} invoices · total 41,250,000d')`, 'sys.exit(0)'].join('\n'),
  'utf8',
);

const PY = process.platform === 'win32' ? 'python' : 'python3';

const ARM: CliArm = {
  id: 'cli-xuong',
  label: 'Command Shop',
  actions: [
    {
      id: 'tung_xuc_xac',
      say: 'roll a die',
      description:
        'Rolls a six-sided die and returns the number shown. Takes about 10 seconds because the ' +
        'roll is real. Read-only — writes nothing, changes nothing on the machine. Returns exactly one number.',
      run: [PY, '-m', 'xucxac', '--mat', '{mat}', '--cho', '10'],
      params: [{ name: 'mat', type: 'integer', required: true, min: 2, max: 100 }],
      cwd: '{sandbox}',
      timeoutMs: 60_000,
      readOnly: true,
    },
    {
      id: 'dong_bo_du_lieu',
      say: 'sync data',
      description:
        'Syncs data from an external system onto the machine. ⚠ Overwrites existing data, cannot be undone.',
      run: [PY, '-m', 'dongbo'],
      cwd: '{sandbox}',
      timeoutMs: 30_000,
      failWhen: ['ERROR'],
      readOnly: false,
    },
    {
      id: 'dem_hoa_don',
      say: 'count unpaid invoices',
      description:
        "Counts unpaid invoices in the company's internal system. " +
        'Read-only — writes nothing, changes nothing. Returns the count and the total.',
      run: [PY, '-m', 'hoadon'],
      cwd: '{sandbox}',
      timeoutMs: 30_000,
      readOnly: true,
    },
  ],
};

if (HANG > 0) {
  ARM.actions.push({
    id: 'viec_rat_lau',
    say: 'a very long job',
    description: `A job that takes a very long time (${HANG} seconds). Used to measure the time ceiling.`,
    run: [PY, '-m', 'xucxac', '--mat', '6', '--cho', String(HANG)],
    cwd: '{sandbox}',
    timeoutMs: (HANG + 120) * 1_000,
    readOnly: true,
  });
}

const CHILD_ENV: Record<string, string> = {
  PATH: process.env['PATH'] ?? '',
  ...(process.platform === 'win32' ? { SYSTEMROOT: process.env['SYSTEMROOT'] ?? '' } : {}),
  PYTHONIOENCODING: 'utf-8',
  PYTHONDONTWRITEBYTECODE: '1',
};


const companyConfig = loadCompanyConfig(companyDir);
const office = loadOffice(companyDir, companyConfig, officeId);
const role = office.roles.get(roleId);
if (!role) throw new Error(`role ${roleId} does not exist in office ${officeId}`);

const tools = buildTools(ARM, { sandbox, env: CHILD_ENV });
const server = createSdkMcpServer({ name: ARM.id, version: '1', tools });

const shellBefore = role.tools;
const mcpBefore = role.mcp;

const sessionFile = path.join(office.dir, '.state', 'assistant-session.json');
const sessionBefore = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8') : null;

(role as { tools: string[] }).tools = [];
(role as { mcp: string[] }).mcp = [ARM.id];
const ARM_ENTRY = {
  label: ARM.label,
  secrets: [] as string[],
  tools: ARM.actions.map((a) => a.id),
  does: ARM.actions.map((a) => a.say),
};

(office.company.mcpServers as Record<string, unknown>)[ARM.id] = server;
(office.company.arms as Record<string, unknown>)[ARM.id] = ARM_ENTRY;

const defBytes = Buffer.byteLength(
  JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))),
  'utf8',
);

console.log('─── CLI ARM SPIKE ───');
console.log(`office   ${officeId} · role ${roleId} · shell → OFF (in memory)`);
console.log(`arm      ${ARM.id} "${ARM.label}" · ${ARM.actions.length} actions · type='sdk' (in-process)`);
console.log(`sandbox  ${sandbox}`);
console.log(`python   ${PY}`);
console.log(`est. cost ~${Math.round(defBytes / 4)} tokens/turn (bytes÷4, ${defBytes} bytes)\n`);

if (has('roster')) {
  const { armReach } = await import('../src/core/assistant.js');
  console.log(`roster line the Assistant receives:\n  "${armReach(office.company.arms, office.company.mcpServers, ARM.id)}"`);
  console.log(`same arm but WITHOUT declaring does:\n  "${armReach({ [ARM.id]: { label: ARM.label } }, {}, ARM.id)}"`);
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(0);
}


interface Gate {
  label: string;
  ok: boolean;
  note: string;
}
const gates: Gate[] = [];
const dice = ARM.actions[0]!;
const sync = ARM.actions[1]!;

async function phase1(): Promise<void> {
  console.log('══ PART 1 · DETERMINISTIC GATES (called directly, no model) ══\n');

  try {
    const a = fillArgv(dice, { mat: 6 });
    gates.push({
      label: '① argv built correctly, NOT a string',
      ok: Array.isArray(a) && a.length === 7 && a[4] === '6',
      note: JSON.stringify(a),
    });
  } catch (e) {
    gates.push({ label: '① argv built correctly', ok: false, note: (e as Error).message });
  }

  const dashArm: CliAction = {
    ...dice,
    run: [PY, '-m', 'xucxac', '--nhan', '{nhan}'],
    params: [{ name: 'nhan', type: 'string', required: true }],
  };
  try {
    fillArgv(dashArm, { nhan: '--force' });
    gates.push({ label: '② value "--force" is blocked', ok: false, note: '🔴 LEAKED THROUGH — it became a flag' });
  } catch (e) {
    gates.push({ label: '② value "--force" is blocked', ok: true, note: (e as Error).message.slice(0, 70) });
  }

  for (const bad of ['6; calc', '6 && calc']) {
    const injArm: CliAction = {
      ...dice,
      run: [PY, '-c', 'import sys; print("VALUE:" + sys.argv[1])', '{x}'],
      params: [{ name: 'x', type: 'string', required: true }],
      timeoutMs: 15_000,
    };
    const filled = fillArgv(injArm, { x: bad });
    const r = await runCommand({ argv: filled, cwd: sandbox, env: CHILD_ENV, timeoutMs: 15_000 });
    gates.push({
      label: `③ command injection "${bad}" stays just a string`,
      ok: r.ok && r.stdout.includes(`VALUE:${bad}`),
      note: `${r.stdout.trim().slice(0, 50)} (code ${r.code})`,
    });
  }

  const r4 = await runCommand({
    argv: ['khong-co-lenh-nay-dau-2608', '--x'],
    cwd: sandbox,
    env: CHILD_ENV,
    timeoutMs: 10_000,
  });
  gates.push({
    label: '④ missing binary → the `spawn` door',
    ok: r4.door === 'spawn',
    note: `door=${r4.door} code=${r4.code}`,
  });

  const r5 = await runCommand({
    argv: [PY, '-m', 'xucxac', '--cho', '30'],
    cwd: sandbox,
    env: CHILD_ENV,
    timeoutMs: 3_000,
  });
  gates.push({
    label: '⑤ our timeout can actually cut the process',
    ok: r5.door === 'timeout' && r5.ms < 10_000,
    note: `door=${r5.door} after ${r5.ms}ms`,
  });

  const r6 = await runCommand({ argv: fillArgv(sync, {}), cwd: sandbox, env: CHILD_ENV, timeoutMs: 20_000 });
  const caught = sync.failWhen!.some((s) => (r6.stdout + r6.stderr).includes(s));
  gates.push({
    label: '⑥ `exit 0` with an embedded error is caught by `fail_when`',
    ok: r6.code === 0 && caught,
    note: `code ${r6.code}, matched "${sync.failWhen![0]}": ${caught}`,
  });

  const r7 = await runCommand({
    argv: [PY, '-m', 'xucxac', '--cho', '0'],
    cwd: os.tmpdir(),
    env: CHILD_ENV,
    timeoutMs: 15_000,
  });
  gates.push({
    label: '⑦ cwd is real (change cwd ⇒ module not found)',
    ok: !r7.ok,
    note: `code ${r7.code} — if ok then cwd is being ignored`,
  });

  console.log(gates.map((g) => `  ${g.ok ? '🟢' : '🔴'} ${g.label}\n       ${g.note}`).join('\n'));
  console.log();
}


async function phase2(): Promise<void> {
  console.log('══ PART 2 · THROUGH THE REAL `runWorker` ══\n');
  const brief = TaskBriefSchema.parse({
    task_id: 'CLI-A',
    role: roleId,
    goal:
      'Roll a six-sided die using the tool from the existing connection, then write the result to a ' +
      'file as exactly one line: "Rolled: <n>". Do not make up a number.',
    outputs: [{ path: 'artifacts/cli-arm/A.md' }],
    constraints: ['Do not use a shell command', 'Must use the connection tool to get the number'],
  });

  const t0 = Date.now();
  const r = await runWorker(
    { office, onProgress: (say) => console.log(`      · ${say}`) },
    { brief, role: role!, hotKnowledge: '', coldKnowledge: '' },
  );
  const out = path.join(office.dir, 'artifacts', 'cli-arm', 'A.md');
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const num = text.match(/Rolled:\s*([1-6])\b/)?.[1];

  console.log(
    `\n[CLI-A] ${r.status}  ${Date.now() - t0}ms  ${r.usage.turns} turns  $${r.usage.costUSD.toFixed(5)}` +
      `\n      say: ${r.say}` +
      `\n      file: ${text.trim() || '(empty)'}`,
  );
  gates.push({
    label: '⑧ end-to-end through the worker: file contains a roll of 1..6',
    ok: !!num,
    note: num ? `rolled ${num} · ${r.usage.turns} turns · $${r.usage.costUSD.toFixed(5)}` : 'no number found',
  });
  console.log();
}


async function phaseHang(): Promise<void> {
  console.log(`══ PART 2T · MEASURING THE \`tools/call\` CEILING — one command sleeping ${HANG}s ══\n`);
  const brief = TaskBriefSchema.parse({
    task_id: 'CLI-T',
    role: roleId,
    goal:
      `Run "a very long job" using the tool from the existing connection. That command takes about ${HANG} seconds — ` +
      'WAIT for it to finish, do not give up early and do not call it a second time. ' +
      'When done, write the result to a file as exactly one line: "Result: <what the command printed>".',
    outputs: [{ path: 'artifacts/cli-arm/T.md' }],
    constraints: ['Do not use a shell command', 'Call that tool EXACTLY ONCE'],
  });

  const before = calls.length;
  const t0 = Date.now();
  const r = await runWorker(
    { office, onProgress: (say) => console.log(`      · ${say}`) },
    { brief, role: role!, hotKnowledge: '', coldKnowledge: '' },
  );
  const out = path.join(office.dir, 'artifacts', 'cli-arm', 'T.md');
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const mine = calls.slice(before);
  const first = mine[0];

  console.log(
    `\n[CLI-T] ${r.status}  total ${Math.round((Date.now() - t0) / 1000)}s  ${r.usage.turns} turns  $${r.usage.costUSD.toFixed(5)}` +
      `\n      CLI calls: ${mine.length}${mine.length > 1 ? '  ⚠ >1 ⇒ the first turn may have been cut off' : ''}` +
      `\n      handler ran: ${first?.ms != null ? `${Math.round(first.ms / 1000)}s` : '(never returned)'}` +
      `\n      say: ${r.say}` +
      `\n      file: ${text.trim() || '(empty)'}`,
  );

  const ranFull = (first?.ms ?? 0) >= HANG * 1_000;
  gates.push({
    label: `⑩ a \`tools/call\` running ${HANG}s is NOT cut off, the result comes back`,
    ok: ranFull && mine.length === 1 && /Result:/.test(text),
    note:
      `handler ${first?.ms != null ? Math.round(first.ms / 1000) + 's' : 'never returned'} · ` +
      `${mine.length} calls · worker ${r.status} · file ${text.trim() ? 'has content' : 'empty'}`,
  });
  console.log();
}


async function phase3(): Promise<void> {
  console.log('══ PART 3 · THE FULL CHAIN: user → Assistant → worker → CLI ══\n');
  const { Office } = await import('../src/core/office.js');

  fs.rmSync(sessionFile, { force: true });

  const live = new Office(loadOffice(companyDir, companyConfig, officeId));

  const r2 = live.loaded.roles.get(roleId)!;
  (r2 as { tools: string[] }).tools = [];
  (r2 as { mcp: string[] }).mcp = [ARM.id];
  (live.loaded.company.mcpServers as Record<string, unknown>)[ARM.id] = server;
  (live.loaded.company.arms as Record<string, unknown>)[ARM.id] = ARM_ENTRY;

  const { armReach } = await import('../src/core/assistant.js');
  console.log(
    `  📋 roster line the Assistant receives:\n     "${armReach(
      live.loaded.company.arms,
      live.loaded.company.mcpServers,
      ARM.id,
    )}"\n`,
  );

  const bill: { role: string; usd: number; turns: number }[] = [];
  live.onUsage = (rec) => bill.push({ role: rec.role, usd: rec.cost_usd, turns: rec.turns });

  const said: string[] = [];

  live.bindBus((e) => {
    if (e.type === 'master.message') {
      if (e.role !== 'user') said.push(e.say);
      console.log(`  [${e.role}] ${e.say}`);
    }
    else if (e.type === 'task.progress') console.log(`      · [${e.role}] ${e.say}`);
    else if (e.type === 'task.done') console.log(`      ✔ [${e.role}] ${e.status} — ${e.say}`);
    else if (e.type === 'task.blocked') console.log(`      ⏸ [${e.role}] ${e.reason} — ${e.say}`);
  });

  const before = calls.length;
  const t0 = Date.now();
  const INVOICE_ASK = 'How many unpaid invoices do we still have? Give me the exact number.';
  if (has('bac')) console.log(`  🔑 KNOWN-IN-ADVANCE answer for this run: ${INVOICE_COUNT} invoices\n`);
  const hoi = flag('hoi') ?? (has('bac') ? INVOICE_ASK : 'Please roll me a six-sided die and tell me what number came up.');
  const outcome = await live.say(hoi);
  console.log(`  → routed as: ${outcome.intent}`);

  const deadline = Date.now() + 360_000;
  const startBy = Date.now() + 45_000;
  let started = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_500));
    if (live.currentState !== 'idle') started = true;
    else if (started) break;
    else if (Date.now() > startBy) break;
  }
  const made = calls.length - before;
  const usd = bill.reduce((s, b) => s + b.usd, 0);
  console.log(`\n  final state: ${live.currentState} after ${Date.now() - t0}ms · CLI called ${made} times`);
  console.log(
    `  💰 total $${usd.toFixed(5)} · ${bill.reduce((s, b) => s + b.turns, 0)} turns — ` +
      bill.map((b) => `${b.role} $${b.usd.toFixed(4)}`).join(' · '),
  );
  gates.push({
    label: '⑨ the full chain DID call the real CLI',
    ok: made > 0,
    note:
      `routed "${outcome.intent}" · ${made} calls · ${Math.round((Date.now() - t0) / 1000)}s · $${usd.toFixed(5)}` +
      (made === 0 ? ' — 🔴 NO command ran' : ''),
  });

  if (has('bac')) {
    const answer = said.join('\n');
    const flat = answer.replace(/(?<=\d)[.,  ](?=\d{3}\b)/g, '');
    const hasRightNumber = new RegExp(`\\b${INVOICE_COUNT}\\b`).test(flat);
    const hasNumber = /\d/.test(answer);
    const hasQuestion = answer.includes('?');
    const outcome_ = made > 0 ? 'DELEGATED' : hasNumber && !hasQuestion ? '🔴 MADE UP/REUSED OLD' : hasQuestion ? '⚠ ASKED BACK' : '⚠ dodged';
    gates.push({
      label: `⑪ isolating the number: ${INVOICE_COUNT} came from the arm IN THIS TURN`,
      ok: made > 0 && hasRightNumber,
      note:
        `${outcome_} · ${made} calls · answer ${hasRightNumber ? 'DOES' : 'does NOT'} contain ${INVOICE_COUNT}` +
        (made === 0 && hasQuestion ? ' ⇒ suspect it just SAW the number, not routed' : '') +
        (made === 0 && hasNumber && !hasQuestion ? ' ⇒ made up, OR reused an old answer — check the number to know which' : '') +
        (made > 0 && !hasRightNumber ? ' ⇒ 🔴 CALLED IT AND STILL ANSWERED A DIFFERENT NUMBER' : ''),
    });
  }
  console.log();
}


try {
  if (wants('1')) await phase1();
  if (wants('2') && !ONLY?.startsWith('1')) await (HANG > 0 ? phaseHang() : phase2());
  if (has('full')) await phase3();
} catch (e) {
  console.log(`\n💥 THREW: ${(e as Error).message}\n${(e as Error).stack ?? ''}`);
} finally {
  (role as { tools: string[] }).tools = shellBefore as string[];
  (role as { mcp: string[] }).mcp = mcpBefore as string[];
  if (sessionBefore !== null) fs.writeFileSync(sessionFile, sessionBefore, 'utf8');
  else fs.rmSync(sessionFile, { force: true });
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(path.join(office.dir, 'artifacts', 'cli-arm'), { recursive: true, force: true });
  console.log('↩ sandbox removed · artifacts/cli-arm removed · role restored (in-memory change only)');
}

console.log('\n─── CONCLUSION ───');
for (const g of gates) console.log(`${g.ok ? '🟢' : '🔴'} ${g.label.padEnd(46)} ${g.note}`);

const bad = gates.filter((g) => !g.ok);
console.log(
  `\n${bad.length === 0 ? '✅ ALL PASSED' : `🔴 ${bad.length}/${gates.length} FAILED`}` +
    `\n\n⚠ THE BOUNDARY OF THIS MEASUREMENT:` +
    `\n  · Gates ①–⑦ prove a MECHANISM, called directly — they do NOT prove` +
    `\n    that mechanism sits on the path a real task actually takes. Only ⑧ speaks to that.` +
    `\n  · ⑧/⑨ green on ONE run does not prove stability: the Assistant's routing has` +
    `\n    high variance (recorded in §15f-bis). Run it 3 times before trusting it.` +
    `\n  · The ~${Math.round(defBytes / 4)} tokens/turn estimate is bytes÷4, NOT the number from` +
    `\n    getContextUsage(). Do not mix the two sources — they differ by 27% (§9b ③).`,
);
