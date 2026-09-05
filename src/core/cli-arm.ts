/**
 * CLI ARM — wraps an ALREADY-DECLARED command into an MCP that runs in-process.
 *
 * → docs/SPEC-arms.md §16 · TEST-WALKTHROUGH.md test 22
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DON'T WRAP `Bash`. WRAP `gh pr create --title <T>`.                       │
 * │                                                                          │
 * │ §1b lists four reasons that forbid turning a shell into an MCP, and they      │
 * │ still stand for `Bash`. But reason 3 (*"a shell command buries a path        │
 * │ inside a string, and wrapping it in an MCP doesn't produce that field"*)      │
 * │ **stops being true for an ALREADY-DECLARED command**: here the user has        │
 * │ already stated ahead of time which spot is which parameter, so that field       │
 * │ isn't *inferred* — it's *declared*. `officeJail` matches `params.path` the       │
 * │ exact same way it matches `file_path`.                                      │
 * │                                                                          │
 * │ The right axis is GUESSED ↔ DECLARED (the user's framing, better than the      │
 * │ spec's old axis):                                                          │
 * │   `Bash` (the model decides the whole command line) → a filesystem MCP           │
 * │   (choosing from 14 tools) → an already-declared CLI (the user fixes argv,       │
 * │   the model only fills in the blanks)                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 THE MOST DANGEROUS PART, said out loud because it's invisible: **a CLI arm
 * is a DELIBERATE hole in the shell firewall.** A role with `run commands: OFF`
 * can still run a binary through here — that's the intent. It carries one
 * constraint that must never be forgotten:
 *
 *   > **The declaration MUST live in the READ-ONLY zone of `officeJail`.**
 *   > A writable declaration ⇒ self-declare `run:
 *   > ["powershell","-c","{cmd}"]` ⇒ arbitrary shell, through the back door,
 *   > for a role that had shell turned off. The exact same hole as §5f, a new door.
 *
 * The declaration lives in `company.yaml` (the user's call, 31/08).
 *
 * 🔴 **CORRECTED 01/09 — I WROTE THIS WRONG HERE.** The old sentence:
 * *"so it inherits the fence §5f already built, rather than a second fence
 * needing to be built"*. **Wrong:** §5f guards `OFFICE_CONFIG`, and that list
 * resolves **relative to the OFFICE directory** — `company/company.yaml` sits
 * one level up and **was never guarded at all**.
 *
 * The decision to use `company.yaml` is still correct (one place, one model,
 * no new directory), but it was **NOT free** the way I claimed: `COMPANY_CONFIG`
 * had to be added to `paths.ts §guardedZone`. Patched 01/09, with a test.
 *
 * ⚠ The failure class: I asserted a fence **already covered** something
 * without going and reading its actual list. The fence was real, just at a
 * DIFFERENT level.
 * → [[agentco-rule-must-see-what-it-governs]] · [[agentco-spec-says-done]]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { t } from '../i18n/index.js';

// ══════════════════════════════════════════════════ 1 · DECLARATIONS (two of them)

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO DOCUMENTS, NOT ONE — and only one of them is non-deterministic. → §16l    │
 * │                                                                          │
 * │ The user asked *"is this instruction sheet deterministic or not?"* and the    │
 * │ instinct *"non-deterministic, since MCP is non-deterministic too"* is half       │
 * │ right. An MCP tool always has EXACTLY TWO parts, and the other half is the       │
 * │ half that makes it usable at all:                                            │
 * │                                                                          │
 * │   `description` non-deterministic — prose — read by the **model**    → 📄       │
 * │   instruction sheet                                                          │
 * │   `inputSchema` deterministic — a schema — checked by the **runtime** → 📋       │
 * │   declaration                                                               │
 * │                                                                          │
 * │ **Dropping the declaration = going back to `Bash`**: the model has to build       │
 * │ the command line from prose again, i.e. guessing. The declaration isn't               │
 * │ bureaucracy — it IS what turns "guessing" into "filling in a blank".               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const CliParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'integer']),
  required: z.boolean().optional(),
  /** Only for `string`. Undeclared ⇒ accepts any string, except for the dash rule below. */
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ AN EXAMPLE OF **THE BLANK**, NOT OF THE COMMAND LINE. (the user's call, 31/08)   │
   * │                                                                          │
   * │ The user asked right at `inputSchema`'s weak spot: `pattern:               │
   * │ "^[a-z0-9.-]+$"` is a rule for the **runtime**, and it teaches the model very     │
   * │ poorly; `example: v1.2.3` teaches it in one glance.                              │
   * │                                                                          │
   * │ ⚠ But the example must live at the PARAMETER layer, not the action layer:        │
   * │ **the model doesn't build the command line** — argv is already fixed, it            │
   * │ only fills in `{tag}`. Showing it the entire `pnpm deploy --env staging               │
   * │ --tag v1.2.3` hands it information about a layer it doesn't control, then             │
   * │ makes it reverse-match which word is the parameter.                                │
   * │                                                                          │
   * │ Measured 31/08: `.describe()` → the `description` of the EXACT property in        │
   * │ `inputSchema`, i.e. sitting right next to the field the model is filling in.        │
   * │                                                                          │
   * │ ⚠ A 60-CHARACTER CEILING, and it's a RECURRING cost: a tool definition lives         │
   * │ in the prefix on EVERY turn. Same class as `hint` (ceiling 320) and `does`             │
   * │ (ceiling 4).                                                                    │
   * │                                                                          │
   * │ 🎯 The CORRECT source is **a Test run**, not hand-typing — the pattern            │
   * │ `returns` already settled on 14/08: *run it for real → capture the real           │
   * │ behavior*. A hand-typed example is a CLAIM (wrong from the start and nobody           │
   * │ would know); an example captured from a successful run is correct **by             │
   * │ construction**. This field accepts either, but the primary path is the Test         │
   * │ button.                                                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  example: z.string().max(60, t('cliArm.exampleTooLong')).optional(),
  /**
   * 🔴 A VALUE MUST NEVER TURN INTO A FLAG. → §16e
   *
   * `tag = "--force"` concatenated into argv means the user just handed
   * themselves a flag they never declared. The default REJECTS values
   * starting with `-`; opting out requires turning this checkbox on
   * explicitly — the same shape as `confirm`'s *"can be turned off, but only deliberately"*.
   */
  allow_dash: z.boolean().optional(),
});

export const CliActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, t('cliArm.badId')),
  /** A human-readable sentence for the UI and the directory line. Does NOT enter the MCP. */
  say: z.string().min(1),
  /** 📄 THE INSTRUCTION SHEET — goes straight into the tool's `description`. */
  description: z.string().min(1),
  /**
   * 📋 The argv template. `{name}` = a blank. **AN ARRAY, never a shell string.**
   *
   * Three reasons (§16e), and reason ① is the security reason: the parameter
   * is MODEL-generated. A shell string + a model-generated value = command
   * injection, not a theoretical risk. With argv, `; rm -rf /` is just a
   * string of characters sitting neatly inside one array element.
   */
  run: z.array(z.string()).min(1),
  params: z.array(CliParamSchema).optional(),
  /** The `{office}` placeholder is resolved by US. The model can't touch it. */
  cwd: z.string().optional(),
  timeout_ms: z.number().int().positive().default(120_000),
  /**
   * A string in stdout+stderr ⇒ counted as FAILED even with `exit 0`.
   * **In the first version** (the user's call, 30/08), not deferred.
   *
   * `exit 0` does NOT mean success: plenty of CLIs print an error to stdout
   * and still return 0. The exact failure class as §5h·7d (*HTTP 200 with an
   * `error` field*), and here it fires in the WORSE direction: the agent
   * believes the command succeeded and **moves on**.
   */
  fail_when: z.array(z.string()).optional(),
  /**
   * ONLY used to build `annotations` for logs/UI. **Builds no permission
   * tier at all** — the user's call, 30/08: *"DROP TIERS ENTIRELY for CLI
   * arms, full access, follow the instruction sheet"*. The remaining gates
   * are exactly two: **who gets wired to it** and **`confirm` per action**.
   */
  read_only: z.boolean().optional(),
  /** Defaults to ON when writing data. Can be turned off, but only deliberately. */
  confirm: z.boolean().optional(),
  /** Keys go into `env`, NEVER into argv — argv is readable from another process (§16e). */
  env: z.record(z.string(), z.string()).optional(),
});

export const CliArmSchema = z.object({
  type: z.literal('cli'),
  actions: z.array(CliActionSchema).min(1),
  /**
   * ⭐ CONSTRAINT ⑥ OF §16p — *"where does the binary live"* is **DATA inside
   * the declaration**, not something inferred at runtime. Must exist from the VERY FIRST line of code.
   *
   * Without this field, the day Docker gets turned on would require editing
   * **every** customer's action — exactly the *"tear it down and rebuild"*
   * that decision ② exists to avoid. Today there's only one valid value; the
   * day an HTTP shim exists, add `'host'` to the enum, **without touching any
   * declaration already saved**.
   */
  runs_on: z.literal('daemon').default('daemon'),
});

export type CliParam = z.infer<typeof CliParamSchema>;
export type CliAction = z.infer<typeof CliActionSchema>;
export type CliArm = z.infer<typeof CliArmSchema>;

/**
 * Recognizes a CLI declaration inside `company.yaml`.
 *
 * ⚠ Recognized by `type`, not by *"has no `command` and no `url`"*: the
 * latter infers from absence, and absence is not a signal — a
 * mistyped declaration would silently become "CLI" and then fail somewhere else.
 * → [[agentco-deterministic-vs-signal]]
 */
export function isCliArm(config: unknown): boolean {
  return !!config && typeof config === 'object' && (config as { type?: unknown }).type === 'cli';
}

/** Every key we declare — the source for "did you mean…" hints. One list, not three. */
const KNOWN_KEYS = [
  ...Object.keys(CliArmSchema.shape),
  ...Object.keys(CliActionSchema.shape),
  ...Object.keys(CliParamSchema.shape),
];

/**
 * The nearest matching key, or `undefined`.
 *
 * ⚠ Catches the **camelCase family first** via normalization (strip `_`,
 * lowercase) rather than edit distance: `readOnly` → `read_only` is 2 edits
 * away, while `timeoutMs` → `timeout_ms` is 3 — a threshold wide enough to
 * catch both would also catch unrelated things. Normalizing is
 * **deterministic** and needs no threshold at all.
 */
function nearestKey(bad: string): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, '');
  const hit = KNOWN_KEYS.find((k) => norm(k) === norm(bad));
  if (hit) return hit;
  // What's left is a missing/extra character: `runs` → `run`, `sayy` → `say`.
  return KNOWN_KEYS.find((k) => {
    const [a, b] = k.length > bad.length ? [k, bad] : [bad, k];
    if (a!.length - b!.length !== 1) return false;
    const at = [...a!].findIndex((c, i) => c !== b![i]);
    return at < 0 || a!.slice(0, at) + a!.slice(at + 1) === b;
  });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PASTE DOOR: STRICT. THE `company.yaml` LOAD DOOR: LOOSE. **TWO RULES,     │
 * │ DELIBERATELY.** (the user's call, 31/08, after measuring: zod SILENTLY           │
 * │ SWALLOWS unknown keys by default)                                          │
 * │                                                                          │
 * │ Why strict here: **the key most likely to be mistyped is exactly the SAFE-       │
 * │ LOOKING key.** Someone pasting JSON types camelCase the first time, and all       │
 * │ three of the worst offenders have snake_case versions:                          │
 * │   `readOnly`  → the annotation becomes destructive, the wrong direction              │
 * │   `timeoutMs` → falls back to 120s, the user believes they set it                    │
 * │   `failWhen`  → 🔴 the safety net catching `exit 0` with an error VANISHES,           │
 * │                 with no signal at all                                             │
 * │ That last line reopens exactly the §5h·7d hole `fail_when` exists to block.         │
 * │                                                                          │
 * │ The two failure directions aren't equally bad: a false rejection ⇒ the user       │
 * │ is standing right there, fixes it in 3 seconds (LOUD, CHEAP). A false             │
 * │ acceptance ⇒ NO SYMPTOM AT ALL.                                              │
 * │ → [[agentco-safe-default-direction]] · [[agentco-silent-allowlist]]           │
 * │                                                                          │
 * │ ⚠ AND WHY THE LOAD DOOR HAS TO STAY LOOSE: nobody is standing there.              │
 * │ Tightening the load door means the day a new field ships, **every existing         │
 * │ arm becomes orphaned**. Anyone "cleaning up" by merging the two doors would         │
 * │ break exactly one of them. There's a test guarding this.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Suggesting the nearest key is what turns **a fence into a signpost** —
 * that's the real answer to *"strict or flexible"*: flexibility doesn't come
 * from accepting anything, it comes from telling someone exactly what to fix.
 */
export function parseCliArm(input: unknown): { ok: true; arm: CliArm } | { ok: false; error: string } {
  /**
   * ⚠ Scans for unknown keys with ONE walk, NOT with `z.strictObject`.
   *
   * The first version, 31/08, made all three schemas `strictObject` — and a
   * test caught it immediately: it also tightened **the load door**, breaking
   * exactly the invariant stated in the block above. The schema is **one
   * function shared by two doors**, so strictness cannot live inside the
   * schema; it has to live at **the door**. One scanning function here is far
   * cheaper than two parallel schema sets — and two schema sets always drift apart eventually.
   */
  const bad: string[] = [];
  const scan = (obj: unknown, allowed: readonly string[]) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad.push(k);
  };
  scan(input, Object.keys(CliArmSchema.shape));
  const acts = (input as { actions?: unknown })?.actions;
  if (Array.isArray(acts)) {
    for (const a of acts) {
      scan(a, Object.keys(CliActionSchema.shape));
      const ps = (a as { params?: unknown })?.params;
      if (Array.isArray(ps)) for (const p of ps) scan(p, Object.keys(CliParamSchema.shape));
    }
  }
  if (bad.length) {
    const say = [...new Set(bad)].map((k) => {
      const near = nearestKey(k);
      return near ? t('cliArm.didYouMean', { key: k, near }) : t('cliArm.unknownKey', { key: k });
    });
    return { ok: false, error: t('cliArm.unknownKeys', { list: say.join(' · ') }) };
  }

  const r = CliArmSchema.safeParse(input);
  if (r.success) {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 TWO COMMANDS SHARING AN `id`. (the user asked, 01/09, and the question    │
     * │ hit a real hole)                                                       │
     * │                                                                      │
     * │ MEASURED (01/09): the SDK **THROWS** — `Tool a is already registered`.        │
     * │ So the good news is **there's no silent-swallow case**: there's no way a       │
     * │ "delete" command would quietly take over the slot of a "count" command with     │
     * │ the same name.                                                            │
     * │                                                                      │
     * │ But it throws inside `compileCliArm`, meaning **at Test time or at run          │
     * │ time**, with an English sentence about a "tool" — while the user just             │
     * │ named two *commands* in their own language. Exactly the *wrong-door error*         │
     * │ class: correct fact, wrong recipient. → [[agentco-wrong-door-errors]]              │
     * │                                                                      │
     * │ ⚠ AND IT'S REACHABLE FROM THE FORM, no JSON editing required: `id` is             │
     * │ generated by `slugId(say)`, so *"count invoices"* and *"count invoices!"*           │
     * │ produce **the same** id. This is not a rare case limited to someone editing JSON.  │
     * │                                                                      │
     * │ ⚠ Blocked ONLY AT THE DOOR, NOT added to the schema: the schema is                │
     * │ shared with the `company.yaml` load door, and failing there means                 │
     * │ `cliToolNames` returns `[]` ⇒ `addArm` writes `tools: []` ⇒ **grants the           │
     * │ entire server** (exactly the §5t hole). The load door just lets the SDK             │
     * │ throw — deterministic, and grants nobody extra permission.                        │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const seen = new Set<string>();
    for (const a of r.data.actions) {
      if (seen.has(a.id)) {
        return {
          ok: false,
          error:
            t('cliArm.duplicateId', { id: a.id }),
        };
      }
      seen.add(a.id);
    }
    return { ok: true, arm: r.data };
  }
  const first = r.error.issues[0]!;
  const at = first.path.length ? `${first.path.join('.')}: ` : '';
  return { ok: false, error: `${at}${first.message}` };
}

/**
 * ⚠ `cliPasteRedirect` MOVED TO WEB (01/09) — **do not rebuild it here.**
 *
 * It's an **interface affordance** (*"you pasted into the wrong tab, try the
 * Commands tab instead"*), not a core rule. Two reasons, and the second is the hard one:
 *
 *  ① The core **must not know** which screen this came from. Blocked at the
 *    door, not in the core: hand-editing `company.yaml` to add a CLI
 *    declaration **still has to work** — there's a test locking this in.
 *    Tying a DATA TYPE to a SCREEN is exactly the violation.
 *  ② This file does `import 'node:child_process'` and the SDK ⇒ **cannot enter
 *    the browser bundle at all**. A function only web code calls, sitting
 *    inside a module only the server can load, is forever dead code nobody
 *    can call — exactly the trap hit yesterday.
 *    → [[agentco-spec-says-done]]
 */

// ══════════════════ 2 · THE RUNNER — everything EXPLICIT (constraint §16p ③)

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** `spawn` · `timeout` · `exit` · `fail_when` — FOUR DOORS, don't merge them. */
  door?: 'spawn' | 'timeout' | 'exit' | 'fail_when';
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO `process.cwd()`. NO implicit env inheritance. NO `shell: true`.            │
 * │                                                                          │
 * │ The first three are the "Docker-ready" constraint §16p ③ — inside a           │
 * │ container, ambient is a different thing, and this is the most deeply mixed-      │
 * │ in assumption, the hardest to untangle later.                                  │
 * │                                                                          │
 * │ `shell:false` is also a SECURITY LOAD-BEARING PILLAR: it's what makes `;       │
 * │ calc` just a string of characters rather than a second command. Measured in       │
 * │ the spike: `6; calc` and `6 && calc` pass through intact, as plain data.         │
 * │                                                                          │
 * │ ⚠ A KNOWN LIMIT, A DELIBERATE TRADE-OFF: `shell:false` cannot run                 │
 * │ `.cmd`/`.bat` on Windows (`npx`, `npm`). To wrap a `.cmd`, declare the full           │
 * │ path to its interpreter instead — **never turn on `shell`**.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function runCommand(opts: {
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
      child = spawn(cmd!, rest, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true });
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
      /**
       * ⚠ `child.kill()` on Windows does NOT kill the child's own subtree. A
       * `python` process that spawns another process leaves that grandchild
       * alive, orphaned. `taskkill /T /F` is the only correct path here.
       * → [[agentco-three-os-always]]
       */
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

    // `error` = FAILED to spawn at all (missing binary, no permission). This
    // is a DOOR ENTIRELY DIFFERENT from "ran and then failed" — merging the two produces a wrong-door error message.
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

// ═══════════════════════ 3 · FILLING ARGV — the SECURITY load-bearing spot (§16e)

export class ArgvError extends Error {}

/**
 * Replaces `{name}` with a value. **No string concatenation, no shell, never
 * adds an extra element.** One parameter ⇒ sits neatly inside the exact argv
 * element it was declared in.
 *
 * ⚠ The value is checked BEFORE substitution, not after: checking after
 * means checking a string already merged with the fixed part, and the
 * *"starts with `-`"* rule loses its meaning immediately.
 */
export function fillArgv(a: CliAction, args: Record<string, unknown>): string[] {
  const byName = new Map((a.params ?? []).map((p) => [p.name, p]));

  const value = (name: string): string => {
    const p = byName.get(name);
    if (!p) throw new ArgvError(`argv has a placeholder "{${name}}" that the declaration has no parameter for`);
    const raw = args[name];
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) throw new ArgvError(`missing required parameter "${name}"`);
      throw new ArgvError(`parameter "${name}" has no value`);
    }
    if (p.type === 'integer') {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new ArgvError(`"${name}" has to be a whole number, got "${String(raw)}"`);
      if (p.min !== undefined && n < p.min) throw new ArgvError(`"${name}" has to be >= ${p.min}`);
      if (p.max !== undefined && n > p.max) throw new ArgvError(`"${name}" has to be <= ${p.max}`);
      return String(n);
    }
    const s = String(raw);
    // 🔴 THE DASH RULE — see the comment on `allow_dash`.
    if (!p.allow_dash && s.startsWith('-')) {
      throw new ArgvError(
        `"${name}" starts with a dash ("${s}") — a value must never be able to turn into a ` +
          `command-line flag. If that really is what you meant, declare allow_dash on this parameter.`,
      );
    }
    if (p.pattern && !new RegExp(p.pattern).test(s)) {
      throw new ArgvError(`"${name}" does not match the pattern ${p.pattern}: "${s}"`);
    }
    return s;
  };

  return a.run.map((el) => el.replace(/\{([a-z0-9_]+)\}/gi, (_, n: string) => value(n)));
}

// ═════════════════ 4 · DECLARATION → TOOL. A PURE FUNCTION (constraint §16p ①)

/** Where a child process is allowed to live. `officeDir` resolves the `{office}` placeholder. */
export interface CliContext {
  officeDir: string;
  /** Keys already filled in by `injectSecrets`. Goes into `env`, NOT into argv. */
  env: Record<string, string>;
  /** Records every call — the ONLY thing that can answer "who just ran what". */
  onCall?: (rec: { tool: string; argv: string[]; cwd: string; ms: number; ok: boolean }) => void;
}

/**
 * ⚠ This function **does not know** which transport it's running under — that's
 * the entire reason it's split off from where the server gets built. The day an
 * HTTP shim for Docker gets added, this part carries over intact,
 * **without touching a single line**. → §16p ①
 */
export function buildCliTools(arm: CliArm, ctx: CliContext) {
  return arm.actions.map((a) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const p of a.params ?? []) {
      let base: z.ZodTypeAny = p.type === 'integer' ? z.number().int() : z.string();
      /**
       * The example goes into the `description` of THIS EXACT property —
       * measured 31/08: `.describe()` → `{"tag":{"type":"string","description":"…"}}`.
       * Missing `example` ⇒ **prints nothing**, so every arm already running
       * doesn't change a single character in the prefix. (Same
       * doesn't-break-anyone-else rule as `does`.)
       */
      if (p.example) base = base.describe(`example: ${p.example}`);
      shape[p.name] = p.required ? base : base.optional();
    }

    return tool(
      a.id,
      /**
       * 📄 THE INSTRUCTION SHEET goes straight in here, verbatim. Now that
       * tiers are gone, this is the **ONLY** place the model learns what this
       * command does and how dangerous it is — so it must state the
       * CONSEQUENCES, not just the purpose. → §16l
       */
      a.description,
      shape,
      async (args): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
        let filled: string[];
        try {
          filled = fillArgv(a, args as Record<string, unknown>);
        } catch (e) {
          // Blocked at the gate BEFORE spawning. Returns `isError` so the
          // model knows its PARAMETER was wrong, not that the machine is
          // broken — two different things, two different next steps.
          return {
            content: [{ type: 'text', text: `Invalid parameter: ${(e as Error).message}` }],
            isError: true,
          };
        }

        /**
         * `cwd` is resolved by US, always inside the office. **Never accepts
         * `cwd` from a model-generated parameter** — that's constraint §16i, not a preference.
         */
        const cwd = a.cwd ? a.cwd.split('{office}').join(ctx.officeDir) : ctx.officeDir;

        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 THE `spawn` DOOR HAS TWO CAUSES, THE ERROR MESSAGE ONLY STATED ONE.     │
         * │ (caught 30/08, on the very first spike run)                            │
         * │                                                                  │
         * │ `spawn` throws **ENOENT** for BOTH: a missing binary, AND a `cwd` that      │
         * │ doesn't exist. The first version attributed everything to *"this machine       │
         * │ cannot find python"* — and a worker reported that exact sentence to the        │
         * │ user, while the machine had Python installed just fine. A confident,           │
         * │ wrong error message that sent someone off to reinstall something they          │
         * │ already had.                                                              │
         * │                                                                  │
         * │ Distinguishable with ONE cheap check ⇒ no reason at all to guess.            │
         * │ → [[agentco-wrong-door-errors]]                                            │
         * └──────────────────────────────────────────────────────────────────┘
         */
        if (!fs.existsSync(cwd)) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `The command could not run — the working directory "${cwd}" does not exist. ` +
                  `This is NOT about "${filled[0]}" missing on the machine; do not install anything.`,
              },
            ],
            isError: true,
          };
        }

        const r = await runCommand({
          argv: filled,
          cwd,
          // The action's own keys are merged on top of the shared keys — the action is the narrower scope.
          env: { ...ctx.env, ...(a.env ?? {}) },
          timeoutMs: a.timeout_ms,
        });
        ctx.onCall?.({ tool: a.id, argv: filled, cwd, ms: r.ms, ok: r.ok });

        const body = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n');
        const hit = a.fail_when?.find((s) => body.includes(s));

        // ⚠ FOUR DOORS, FOUR SENTENCES. Merging them produces exactly the "wrong-door error message" class.
        if (r.door === 'spawn') {
          return {
            content: [
              {
                type: 'text',
                text:
                  `The command could not run — this machine cannot find "${filled[0]}" (or may not run it). ` +
                  `This is NOT a parameter problem, and not a command that ran and then failed.\n${r.stderr}`,
              },
            ],
            isError: true,
          };
        }
        if (r.door === 'timeout') {
          return {
            content: [
              {
                type: 'text',
                text: `The command ran past ${a.timeout_ms} ms and was stopped. Any output below is incomplete.\n${body}`,
              },
            ],
            isError: true,
          };
        }
        if (hit) {
          return {
            content: [
              {
                type: 'text',
                text: `The command exited 0 BUT the output carries a failure marker ("${hit}"). Treat this as FAILED.\n${body}`,
              },
            ],
            isError: true,
          };
        }
        if (!r.ok) {
          return { content: [{ type: 'text', text: `The command failed (exit ${r.code}).\n${body}` }], isError: true };
        }
        return { content: [{ type: 'text', text: body || '(the command finished and printed nothing)' }] };
      },
      {
        // Still declares `annotations` to follow the MCP protocol CORRECTLY —
        // but they build NO permission tier at all (the user's call, 30/08).
        // They exist here for logs and the UI to read.
        annotations: { readOnlyHint: a.read_only === true, destructiveHint: a.read_only !== true },
      },
    );
  });
}

/**
 * Declaration → a runnable SDK config.
 *
 * ⚠ Called AFTER `injectSecrets`, never before: `fillRefs` can only walk a
 * plain object, and this function's result carries a **live** `McpServer`.
 * Reversing the order means an action's `env` `${KEY}` placeholder never gets
 * filled — exactly the 31/08 bug (`missingSecretRefs` detects it forever,
 * `injectSecrets` never fills it in).
 * → SPEC-arms §16a ⑧
 */
export function compileCliArm(name: string, decl: unknown, ctx: CliContext): McpServerConfig {
  const arm = CliArmSchema.parse(decl);
  return createSdkMcpServer({ name, version: '1', tools: buildCliTools(arm, ctx) }) as McpServerConfig;
}

/** Task names — `arms[hash].tools` needs this to grant `mcp__<id>__<tool>`, not the entire server. */
export function cliToolNames(decl: unknown): string[] {
  const parsed = CliArmSchema.safeParse(decl);
  return parsed.success ? parsed.data.actions.map((a) => a.id) : [];
}

/** Human-readable sentences for the directory line (`arms[hash].does`). Ceiling 4 — §7b forbids raw tool names. */
export function cliSays(decl: unknown): string[] {
  const parsed = CliArmSchema.safeParse(decl);
  return parsed.success ? parsed.data.actions.map((a) => a.say).slice(0, 4) : [];
}
