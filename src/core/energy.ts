/**
 * THE CLAUDE ACCOUNT LIMIT — two windows, two percentages, two reset marks.
 * → docs/SPEC-token-economy.md §5e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PRECONDITION IS THAT **THE CLI IS IDLE**. That is the whole problem,  │
 * │ and it was very nearly written off as "can't be done".                    │
 * │                                                                           │
 * │ `usage()` is a CONTROL REQUEST sent down to the Claude Code process. The  │
 * │ first four probes (22/08) all called it WHILE the CLI was working on a    │
 * │ prompt:                                                                   │
 * │                                                                           │
 * │   probe 1  after the loop          → `ProcessTransport is not ready`      │
 * │   probe 2  on the first message    → `Query closed…` after 601 ms         │
 * │   probe 3  at `init`, 3 s query    → `Query closed…` after 3,043 ms       │
 * │   probe 4  at `init`, 32 s query   → `Query closed…` after **27,476 ms**  │
 * │                                                                           │
 * │ Probe 4 kills the "it lost because the query was short" hypothesis — it   │
 * │ waited out nearly the whole query lifetime and died with it. The          │
 * │ conclusion drawn then: *"a control request goes unanswered while the      │
 * │ main loop is busy"*. TRUE — but the conclusion AFTER it was false:        │
 * │ *"so it cannot be had at all"*.                                           │
 * │                                                                           │
 * │ The missing question: **why does typing `/usage` by hand work?** Because  │
 * │ when a person types it, the CLI is IDLE. And streaming input rebuilds     │
 * │ exactly that state: open a query with a generator that HOLDS THE STREAM   │
 * │ OPEN and never sends a message.                                           │
 * │                                                                           │
 * │   probe 5  CLI idle → ✅ **3,342 ms**, both `five_hour` + `seven_day`,    │
 * │            with `utilization`, `resets_at`, and `session cost = 0`.       │
 * │                                                                           │
 * │ **IT COSTS NO TOKENS.** No message is sent, no inference turn runs. The   │
 * │ price is ~3.3 seconds and one CLI process alive for that moment.          │
 * │                                                                           │
 * │ ⚠ The lesson, and it is worth more than the feature: **"measured four     │
 * │ times, broken four times" proves a MECHANISM, not a CONCLUSION.** Those   │
 * │ four measurements said exactly one thing — "not while it is busy" — and   │
 * │ "so drop it" was a generalisation I added myself. Before declaring a      │
 * │ road dead, ask: *where is the equivalent already working, and how does    │
 * │ it differ from us?*                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EXACTLY TWO WINDOWS: SESSION AND WEEK. Not split by model. (user, 22/08) │
 * │                                                                          │
 * │ The server returns a great many buckets — `seven_day_opus`,              │
 * │ `seven_day_sonnet`, and a run of code names (`nimbus_quill`,             │
 * │ `iguana_necktie`, `tangelo`…) that are plainly internal feature flags.    │
 * │ On the account measured (`pro`) every per-model bucket came back `null`. │
 * │                                                                          │
 * │ They are dropped not because they are empty, but because **they are not   │
 * │ agentco's business**: the limit belongs to the whole account, and the     │
 * │ user may have spent most of it on something unrelated to this company.    │
 * │ We answer exactly one question — *"can I still run, and until when"*.     │
 * │ Every other number invites the user to chase something they cannot fix.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { query } from './sdk.js';

/** The three levels the server returns. `allowed` = plenty left, `rejected` = already blocked. */
export type EnergyStatus = 'allowed' | 'allowed_warning' | 'rejected';

/** Exactly the two windows a user needs. See the note at the top of the file. */
export type WindowKind = 'session' | 'weekly';

export interface EnergyWindow {
  kind: WindowKind;
  /** 0–100. `null` while we have no number yet (never refreshed). */
  utilization: number | null;
  /** ISO 8601. */
  resetsAt: string | null;
  status: EnergyStatus;
}

export interface Energy {
  windows: EnergyWindow[];
  /** `pro` · `max` · `team` … · `null` when running on an API key. */
  plan: string | null;
  /** When the last number was taken, ISO. */
  seenAt: string;
}

/** `rateLimitType` on a `rate_limit_event` → our window. Any other bucket: ignored. */
const EVENT_KIND: Record<string, WindowKind> = {
  five_hour: 'session',
  seven_day: 'weekly',
};

const STATUSES = new Set<string>(['allowed', 'allowed_warning', 'rejected']);

/**
 * The colour threshold for when we have a `%` but no `status` from an event.
 * At 80% the user can still change plans; at 100% it is already too late.
 */
function statusOf(util: number): EnergyStatus {
  if (util >= 100) return 'rejected';
  return util >= 80 ? 'allowed_warning' : 'allowed';
}

// MODULE-level state: the limit belongs to the ACCOUNT, not to any one office.
const latest = new Map<WindowKind, EnergyWindow>();
let plan: string | null = null;
let version = 0;
let seenAt = '';

function bump(kind: WindowKind, next: EnergyWindow): void {
  const prev = latest.get(kind);
  if (
    prev &&
    prev.status === next.status &&
    prev.resetsAt === next.resetsAt &&
    prev.utilization === next.utilization
  ) {
    return; // unchanged -> do not bump the version, do not fire a spare SSE event
  }
  latest.set(kind, next);
  seenAt = new Date().toISOString();
  version++;
}

/**
 * Pick up a `rate_limit_event` off a stream already running — FREE, it is
 * sitting in the `for await` of `worker.ts` / `assistant.ts` anyway.
 *
 * It carries NO `utilization` (measured 22/08: the server does not send one), so
 * its role is narrow and clear: **report a status change MID-RUN**. A user
 * blocked at 14:03 must see it at 14:03, not at the next refresh.
 *
 * ⚠ Which is why it **may only touch `status`**, leaving the other two alone:
 *
 *  · `utilization` — the event has no %, and overwriting with `null` makes the
 *    bar vanish mid-run, a jolt for no reason at exactly the moment the user is
 *    worried. A number from a few minutes ago still beats no number.
 *  · `resetsAt` — **the two sources disagree down to the second**, and this is a
 *    silent trap a test caught: the event returns `1787367000` (whole seconds)
 *    while `usage()` returns `…T02:49:59.770958Z`. Same instant, 0.23 s apart.
 *    Let the event overwrite and EVERY query flips back and forth between the
 *    two spellings → `bump` sees "changed" → a junk `energy.tick` on SSE on
 *    every single worker call.
 *    ⇒ `usage()` owns the number; the event only fills `resetsAt` when we have
 *    nothing at all.
 */
export function noteRateLimit(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as Record<string, unknown>;

  const kind = typeof r['rateLimitType'] === 'string' ? EVENT_KIND[r['rateLimitType']] : undefined;
  const status =
    typeof r['status'] === 'string' && STATUSES.has(r['status']) ? (r['status'] as EnergyStatus) : undefined;
  if (!kind || !status) return;

  /** `resetsAt` on the event is Unix **SECONDS** (measured: 1787367000), not milliseconds. */
  const secs = typeof r['resetsAt'] === 'number' && Number.isFinite(r['resetsAt']) ? r['resetsAt'] : 0;
  const prev = latest.get(kind);

  bump(kind, {
    kind,
    status,
    resetsAt: prev?.resetsAt ?? (secs > 0 ? new Date(secs * 1000).toISOString() : null),
    utilization: prev?.utilization ?? null,
  });
}

// ──────────────────────────────────────────────────── fetching the percentage

/** The one refresh in flight. Never let two CLI processes be open at once. */
let inflight: Promise<void> | null = null;
let lastAt = 0;

/** Never refresh more often than this. Limit figures move by the minute, not the second. */
const MIN_GAP_MS = 60_000;
/** CLI startup ~2 s + `usage()` ~3.3 s. Double it for a slow machine, then give up. */
const TIMEOUT_MS = 20_000;

/**
 * Open an IDLE CLI, ask for the limit, close it. → note at the top of the file.
 *
 * Swallows EVERY error and never throws: this is a decorative box in the header.
 * A broken `usage()` may not break the user's run, and may not surface an error
 * message either — the user did not ask for anything.
 *
 * `force` skips the throttle, used on the first call when an office opens.
 */
export function refreshEnergy(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve();
  lastAt = Date.now();
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(): Promise<void> {
  let release: (() => void) | undefined;

  /**
   * A generator that NEVER yields until we release it — this is the thing that
   * holds the CLI in the "waiting for input" state, i.e. IDLE. Swap it for a
   * generator that sends a message and the whole mechanism breaks: with a busy
   * CLI, `usage()` hangs and then dies with the query (measured 4 times, see
   * the note at the top of the file).
   */
  const idle = async function* (): AsyncGenerator<never> {
    await new Promise<void>((r) => {
      release = r;
    });
  };

  const q = query({
    prompt: idle(),
    options: {
      // No `model`: no inference turn runs, so it would mean nothing, and pinning
      // a model id here is one more place to remember when the model table changes.
      tools: [],
      allowedTools: [],
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
    },
  });

  // The stream must be CONSUMED, otherwise the control response is never pumped out.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* the content does not matter — the stream just has to flow */
      }
    } catch {
      /* closing a query mid-flight makes the SDK throw; by design */
    }
  })();

  try {
    const res = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), TIMEOUT_MS)),
    ]);
    apply(res as Record<string, unknown>);
  } catch {
    /* if we cannot get it, keep the old number — silently, this is decoration */
  } finally {
    release?.();
    await Promise.race([drain, new Promise((r) => setTimeout(r, 2_000))]);
  }
}

/**
 * Read absolutely DEFENSIVELY. The source function names itself
 * `…_DO_NOT_RELY_ON_THIS_API_YET`, and a real response carries unreleased
 * code-name buckets (`nimbus_quill`, `iguana_necktie`…). We read exactly the two
 * keys declared in the `.d.ts`, and a field changing type MUST break nothing.
 */
export function apply(res: Record<string, unknown>): void {
  if (!res || typeof res !== 'object') return;

  /**
   * ⚠ A FOURTH CASE, MEASURED 17/09/2026: a long-lived token from
   * `claude setup-token`. The list used to read "API key / Bedrock / Vertex",
   * which made this look like an enterprise-only branch — it is not, it is the
   * ordinary way a container signs in.
   *
   * Same probe, same build, two sign-ins:
   *   `claude login`              → subscription_type "pro" · rate_limits_available true
   *   CLAUDE_CODE_OAUTH_TOKEN     → subscription_type null  · rate_limits_available false
   *
   * So the header shows one window and not two, and that is the server
   * declining to report rather than anything here failing. It cost an hour to
   * work out from the outside, because `run()` swallows errors by design and
   * `usage()` did not fail — it succeeded, and said "no".
   *
   * ⚠ The Session chip can still be populated, from `rate_limit_event` during a
   * real query (`noteRateLimit`). Two sources, one of which survives this
   * branch — which is exactly why the header looks half-filled rather than
   * empty, and why that looks like a bug and is not one.
   * → docker/README.md
   */
  if (res['rate_limits_available'] === false) return;
  const limits = res['rate_limits'];
  if (!limits || typeof limits !== 'object') return;

  const sub = res['subscription_type'];
  if (typeof sub === 'string' && sub) plan = sub;

  const l = limits as Record<string, unknown>;
  readWindow(l['five_hour'], 'session');
  readWindow(l['seven_day'], 'weekly');
}

function readWindow(raw: unknown, kind: WindowKind): void {
  if (!raw || typeof raw !== 'object') return;
  const w = raw as Record<string, unknown>;

  const rawUtil = w['utilization'];
  const util =
    typeof rawUtil === 'number' && Number.isFinite(rawUtil) ? Math.max(0, Math.min(100, rawUtil)) : null;
  const at = typeof w['resets_at'] === 'string' ? w['resets_at'] : '';
  const when = at ? new Date(at) : null;

  const prev = latest.get(kind);
  bump(kind, {
    kind,
    utilization: util,
    resetsAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : (prev?.resetsAt ?? null),
    /**
     * Status derived from `%`, NOT carried over from the event: `usage()` is the
     * newer and fuller source. Keeping an old `rejected` while the window has
     * already reset to 0% leaves a red warning up for something that is over.
     */
    status: util === null ? (prev?.status ?? 'allowed') : statusOf(util),
  });
}

// ──────────────────────────────────────────────────── reading it back out

/** Bumped on GENUINELY new news. `Office.emit` compares it to decide whether to fire. */
export function energyVersion(): number {
  return version;
}

export function energySnapshot(): Energy | undefined {
  if (latest.size === 0) return undefined;
  // A FIXED order — session then week. The user reads the two numbers in the same
  // place every time they glance up; reordering by pressure makes them re-read the
  // labels on every glance.
  const order: WindowKind[] = ['session', 'weekly'];
  const windows = order.map((k) => latest.get(k)).filter((w): w is EnergyWindow => !!w);
  return { windows, plan, seenAt };
}

/** Tests only — every house needs a door you can sweep through. */
export function resetEnergy(): void {
  latest.clear();
  plan = null;
  version = 0;
  seenAt = '';
  lastAt = 0;
}
