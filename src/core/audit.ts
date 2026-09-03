/**
 * THE AUDIT LOG FOR ARMS — every MCP call, WITH ITS ARGUMENTS.
 * → docs/SPEC-arms.md §6k
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY IT EXISTS, and the real case proving it is not a theoretical concern. │
 * │                                                                           │
 * │ 26/08: a run hit `max_turns` PART-WAY THROUGH. The log showed it had      │
 * │ already called `notion-update-page` (a WRITE) before being cut, while     │
 * │ the final report said *"could not delete it"*. For a file inside the      │
 * │ office that sentence is harmless; for THE USER'S NOTION it is wrong       │
 * │ about THE OUTSIDE WORLD.                                                  │
 * │                                                                           │
 * │ And we COULD NOT LOOK UP what it had written — the old log kept only      │
 * │ `calls[0]` per turn, with no arguments. So *"what did it write into my    │
 * │ Notion yesterday"* was UNANSWERABLE, in exactly the place where the       │
 * │ consequences sit beyond our reach.                                        │
 * │                                                                           │
 * │ ⚠ This REPLACES a per-call approval gate; it does not supplement one.     │
 * │ Tier 2 was dropped on 25/08 (*"each mcp we plug in is its own sandbox —   │
 * │ a log is enough"*). Having dropped the gate, the log HAS TO BE            │
 * │ SUFFICIENT, or we have dropped both. → §6k                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Written to EACH office's own `.state/mcp-audit.jsonl` — same place, same rule
 * as `chat.jsonl`. Not at company level: the question is always *"what did THIS
 * office do"*, and merging every office into one file makes the reader filter.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ArmCall {
  /** ISO. File order is already chronological, but a line has to READ ON ITS OWN. */
  ts: string;
  /** The arm's hash. The interface resolves the label — a hash never reaches the screen. */
  server: string;
  /** The action name, with the `mcp__<server>__` prefix stripped. */
  tool: string;
  /** Who called it. `''` = unknown (should not happen, but do not invent one). */
  role: string;
  plan_id?: string;
  task_id?: string;
  /**
   * THE ARGUMENTS — the ENTIRE reason this file exists.
   *
   * ⚠ Recording arguments means recording USER CONTENT (the paragraph about to
   * be pasted into Notion, the filename about to be read). That is deliberate:
   * without it a log line says only *"called update_page"*, which is exactly
   * what we already had and already found insufficient.
   */
  args: string;
  /** Arguments truncated for length — say so; do not let a reader assume that is all. */
  truncated?: boolean;
}

/**
 * Per-line ceiling. Deliberately generous — a paragraph pasted into Notion is far
 * longer than a file path, and trimming it away loses exactly what an
 * investigation needs.
 */
const MAX_ARGS = 2_000;

/**
 * How many lines are kept. `chat.jsonl` has no ceiling; this file needs one,
 * because it records EVERY CALL rather than every turn of conversation — a run
 * touching 20 Notion pages writes 20 lines, and over a few months of an office's
 * life the file grows without a floor.
 */
const MAX_LINES = 2_000;

export class AuditLog {
  constructor(private stateDir: string) {}

  rebind(stateDir: string): void {
    this.stateDir = stateDir;
  }

  private file(): string {
    return path.join(this.stateDir, 'mcp-audit.jsonl');
  }

  /**
   * Record one call. MUST NEVER THROW — it runs in the middle of a job, and
   * breaking a job because a log write failed trades a small loss for a large
   * one. Same rule as `appendChat`.
   */
  append(call: Omit<ArmCall, 'ts' | 'args'> & { args: unknown }): void {
    try {
      let args = JSON.stringify(call.args ?? {});
      const truncated = args.length > MAX_ARGS;
      if (truncated) args = `${args.slice(0, MAX_ARGS)}…`;
      const line: ArmCall = {
        ts: new Date().toISOString(),
        server: call.server,
        tool: call.tool,
        role: call.role,
        ...(call.plan_id ? { plan_id: call.plan_id } : {}),
        ...(call.task_id ? { task_id: call.task_id } : {}),
        args,
        ...(truncated ? { truncated: true } : {}),
      };
      fs.mkdirSync(this.stateDir, { recursive: true });
      fs.appendFileSync(this.file(), `${JSON.stringify(line)}\n`, 'utf8');
    } catch {
      /* A failed log write must NOT break the running job. */
    }
  }

  /**
   * Read, NEWEST FIRST. `server` filters to one arm.
   *
   * ⚠ A corrupt line is SKIPPED, not the whole file: one write cut short by a
   * dying daemon must not erase the history of every call before it.
   */
  list(opts: { server?: string; limit?: number } = {}): ArmCall[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file(), 'utf8');
    } catch {
      return [];
    }
    const out: ArmCall[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as ArmCall;
        if (opts.server && rec.server !== opts.server) continue;
        out.push(rec);
      } catch {
        /* corrupt line — skip exactly that line */
      }
    }
    out.reverse();
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /**
   * Trim the old end once the file exceeds its ceiling. Called after each shift,
   * not after each line: read-writing the whole file per call turns one
   * `appendFileSync` into O(n²).
   */
  trim(): void {
    try {
      const lines = fs.readFileSync(this.file(), 'utf8').split('\n').filter((l) => l.trim());
      if (lines.length <= MAX_LINES) return;
      fs.writeFileSync(this.file(), `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
    } catch {
      /* could not trim — a larger file than intended still beats losing the log */
    }
  }
}

/** `mcp__<server>__<tool>` → two pieces. `undefined` = not an MCP call. */
export function splitArmTool(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice('mcp__'.length);
  const cut = rest.indexOf('__');
  // `mcp__files` (a whole server, no action name) is still valid as a permission
  // declaration, but it is NEVER the name of an actual call.
  if (cut < 0) return undefined;
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) };
}
