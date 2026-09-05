/**
 * The work log. → docs/SPEC-offices.md §6
 *
 * A PLAN IS THE UNIT OF WORK, not a chat line. v0 wrote loose plan files and
 * then forgot them; the consequence was being unable to answer "what did we do
 * yesterday" and unable to separate two overlapping jobs in the log.
 *
 * Two tiers, deliberately:
 *   index.json           compact, one read gives the whole list — for the sidebar
 *   <plan_id>.log.jsonl  event by event, read only when that job is opened
 *
 * Merged into one, opening the sidebar would read the entire log of the office's
 * lifetime. The "performance" criterion blocks exactly that shape of design.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from './paths.js';
import { isSafeId } from './paths.js';
import type { AgentEvent, PlanRecord } from './types.js';

const MAX_INDEX = 200;
/** Log-line ceiling per job. An agent stuck in a loop must not fill the disk. */
const MAX_LOG_LINES = 5_000;

export class PlanStore {
  constructor(private paths: OfficePaths) {}

  rebind(paths: OfficePaths): void {
    this.paths = paths;
  }

  list(): PlanRecord[] {
    if (!fs.existsSync(this.paths.planIndex)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.planIndex, 'utf8')) as { plans?: PlanRecord[] };
      return Array.isArray(raw.plans) ? raw.plans : [];
    } catch {
      // A broken index must not take the office down — it is derived data.
      process.emitWarning('tasks/index.json is unreadable; the work log starts again from empty.');
      return [];
    }
  }

  get(planId: string): PlanRecord | undefined {
    return this.list().find((p) => p.plan_id === planId);
  }

  upsert(rec: PlanRecord): void {
    const plans = this.list().filter((p) => p.plan_id !== rec.plan_id);
    plans.unshift(rec);
    fs.mkdirSync(path.dirname(this.paths.planIndex), { recursive: true });
    fs.writeFileSync(
      this.paths.planIndex,
      JSON.stringify({ plans: plans.slice(0, MAX_INDEX) }, null, 2),
      'utf8',
    );
  }

  /** Append one event to that job's own log. Conversation events do not come here. */
  append(planId: string, event: AgentEvent): void {
    const file = this.logFile(planId);
    if (!file) return;
    try {
      if (lineCount(file) >= MAX_LOG_LINES) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n', 'utf8');
    } catch {
      // A failed log write must NEVER break the work that is running.
    }
  }

  readLog(planId: string): Array<AgentEvent & { ts: string }> {
    const file = this.logFile(planId);
    if (!file || !fs.existsSync(file)) return [];
    const out: Array<AgentEvent & { ts: string }> = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AgentEvent & { ts: string });
      } catch {
        /* skip a corrupt line */
      }
    }
    return out;
  }

  /**
   * HEAL ZOMBIE RUNS: records stuck at `planning`/`running` after a daemon died.
   * Returns how many were healed. → tech debt #2 · SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY HEAL RATHER THAN ALLOW DELETE — the right question, asked 20/08.     │
   * │                                                                          │
   * │ The symptom raised: *"they break sometimes and the zombies are an        │
   * │ eyesore"*, and the first reflex on both sides was TO ADD A DELETE        │
   * │ BUTTON. But the work log is the ONLY thing linking a `plan_id` in        │
   * │ `logs/usage.jsonl` to a readable NAME. Delete a record and the money is  │
   * │ still in the ledger with nobody able to say what it bought — and         │
   * │ "(unknown)" in the ledger then carries TWO meanings (a v0 record, or a   │
   * │ user deletion), i.e. IT STOPS BEING EXPLAINABLE. The user blocked it:    │
   * │ *"maybe keep the log so it stays traceable — money is involved"*.        │
   * │                                                                          │
   * │ The right diagnosis: the eyesore is NOT "too many rows", it is that      │
   * │ THOSE ROWS ARE LYING — they say "running" while nothing runs. Fix the    │
   * │ lie and the eyesore goes with it, losing no history at all. A delete     │
   * │ button treats the symptom by burning the evidence.                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Runs ONCE while constructing `Office`, i.e. at process start when nothing
   * can possibly be running. Calling it anywhere else eventually stamps `failed`
   * on a job that is genuinely in flight.
   *
   * ⚠ PRESERVE THE ORDER in the index — do not use `upsert`, which lifts a
   * record to the front. Healing three zombies through `upsert` scrambles the
   * chronological history the log exists to keep.
   */
  healStale(note: string): number {
    const plans = this.list();
    let healed = 0;
    for (const p of plans) {
      if (p.status !== 'planning' && p.status !== 'running') continue;
      p.status = 'failed';
      p.ended_at ??= new Date().toISOString();
      p.report = p.report ? `${p.report}\n\n${note}` : note;
      healed++;
    }
    if (healed === 0) return 0;
    fs.mkdirSync(path.dirname(this.paths.planIndex), { recursive: true });
    fs.writeFileSync(this.paths.planIndex, JSON.stringify({ plans }, null, 2), 'utf8');
    return healed;
  }

  /** `plan_id` arrives from a URL and becomes a filename, so it must be checked. */
  private logFile(planId: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(planId)) return undefined;
    return path.join(this.paths.tasks, `${planId}.log.jsonl`);
  }
}

function lineCount(file: string): number {
  if (!fs.existsSync(file)) return 0;
  try {
    // Estimate from the file size rather than reading it — logs get large.
    return Math.floor(fs.statSync(file).size / 120);
  } catch {
    return 0;
  }
}

/**
 * An agent's colour, hashed from its id. → SPEC-offices.md §6
 *
 * HASHED rather than stored: adding or removing a person never shifts anyone
 * else's colour, and it creates no further config file to drift. Hues spread
 * evenly, skipping the 45–70° band (yellow on a light ground is unreadable).
 */
export function agentHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const raw = Math.abs(h) % 335;
  return raw < 45 ? raw : raw + 25;
}

export { isSafeId };
