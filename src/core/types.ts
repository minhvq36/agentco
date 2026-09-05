/**
 * Shared data types.
 *
 * Source: docs/SPEC-2026-08-14-agentco.md §4 (Task/Receipt), §3 (Role)
 *         docs/SPEC-cli.md §3 (config)
 */

import { z } from 'zod';
import { t } from '../i18n/index.js';

// TYPES only, and `energy.ts` doesn't import back from here — no cycle.
import type { Energy } from './energy.js';

// ─────────────────────────────────────────────────────────── tier & model

export const TIERS = ['eco', 'standard', 'deep'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Old tier name → current name.
 *
 * `cheap` was renamed to `eco` on 08/15/2026. A user's `roles/*.yaml` file that
 * already wrote `cheap` must NOT break because of this: schema rejects it, the
 * role gets skipped, and a worker vanishes from the office just because we
 * renamed a word.
 *
 * Renaming in the schema without this table is the quietest way to lose a
 * user's work. The table has one line today — room for it to grow.
 */
const TIER_ALIASES: Record<string, Tier> = { cheap: 'eco' };

export const TierSchema = z.preprocess(
  (v) => (typeof v === 'string' && TIER_ALIASES[v] ? TIER_ALIASES[v] : v),
  z.enum(TIERS),
);

// ─────────────────────────────────────────────────────────── tool

/**
 * Tools ON BY DEFAULT for every worker, can't be turned off.
 * → docs/SPEC-tools-approval.md §5
 *
 * These are the office's HANDS, not a choice. Forcing a user to turn on
 * `WebSearch` for a worker named "News Finder" is asking a question with
 * exactly one answer — that's not a choice, that's paperwork. The previous
 * version required hand-editing a yaml file to add these, and that's exactly
 * where a non-technical user falls off.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ CORRECTED 08/22 — THIS BLOCK USED TO STATE SOMETHING WRONG.            │
 * │                                                                          │
 * │ The old sentence: *"the four file tools only touch `cwd` (= the office        │
 * │ directory) and `safeJoin` blocks going outside it"*. **Wrong.** `safeJoin`      │
 * │ is OUR OWN function, running in OUR OWN code — it has never once stood         │
 * │ between the model and the `Read` tool.                                   │
 * │                                                                          │
 * │ Measured: a role with only the default toolset (NO `Bash`) read a whole         │
 * │ file sitting in an unrelated temp directory, using nothing but an               │
 * │ absolute path. `cwd` **is not a wall** — it's just the default working          │
 * │ directory.                                                              │
 * │                                                                          │
 * │ The REAL boundary today:                                                 │
 * │                                                                          │
 * │   WRITE  `Write`/`Edit`/`NotebookEdit` → HAS a gate (`officeJail`)       │
 * │   READ   `Read`/`Glob`/`Grep`          → NO gate at all                  │
 * │   WEB    `WebFetch`/`WebSearch`        → read-only, but CAN SEND OUT     │
 * │   SHELL  `Bash`                        → no gate, and on by default      │
 * │                                                                          │
 * │ ⇒ `Read` + `WebFetch` is a data-exfiltration path, **no `Bash` needed**.        │
 * │   A read gate IS BUILDABLE (measured: `PreToolUse` fires for `Read` and         │
 * │   `deny` actually blocks it) but is NOT built yet — awaiting a decision.        │
 * │   → SPEC §5                                                             │
 * │                                                                          │
 * │ Lesson: an invariant is only real when there's code enforcing it. The old       │
 * │ sentence read very convincingly because it NAMED a real function — it          │
 * │ just happened to be running at the wrong layer.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Bash` is absent from here so it stays a VISIBLE LINE in `roles/<id>.yaml`
 * with its own switch — even though since 08/22 `roleTemplate` writes it in
 * for every new worker by default.
 */
export const BUILTIN_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
] as const;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE SHELL TOOL'S NAME CHANGES BY OS — and that's why the "allow           │
 * │    commands" switch DIDN'T WORK from 08/16 all the way to 08/22/2026.           │
 * │                                                                          │
 * │ Measured by asking the CLI directly (`system/init` has a `tools` field):        │
 * │                                                                          │
 * │   no `tools` passed  → 29 tools, and among them is **`PowerShell`**,           │
 * │                        `Bash` is NOT there at all (Windows machine)            │
 * │   `tools: ['Bash']`  → the CLI grants **0 tools**                        │
 * │                                                                          │
 * │ `tools` is an allowlist BY NAME. A name that doesn't exist on this               │
 * │ platform gets **silently dropped** — no error, no warning. So a role                │
 * │ declaring `Bash` on Windows receives the exact default set, as if it had              │
 * │ declared nothing at all.                                                 │
 * │                                                                          │
 * │ The trail had been sitting in the spec for six days with nobody reading it            │
 * │ right: the 08/16 entry wrote *"`nguoi-viet` … reached for **PowerShell**              │
 * │ FOUR TIMES"*. The correct name was sitting right inside the evidence for a           │
 * │ different bug.                                                          │
 * │                                                                          │
 * │ ⇒ CONFIG uses ONE canonical name (`Bash`) so an office zipped up still runs           │
 * │   on a machine with a different OS. Translating to a platform's own name             │
 * │   happens here, by sending **BOTH** names down to the SDK: whichever                 │
 * │   doesn't exist just gets dropped by the CLI. Measured: sending an extra              │
 * │   name costs **0 tokens**, because it's dropped before it ever reaches the           │
 * │   prefix.                                                                │
 * │                                                                          │
 * │ Doesn't check `process.platform`: Claude Code on Windows WITH Git Bash            │
 * │ installed could use a different name, and we don't control that naming             │
 * │ table. Sending both lets the SDK answer its own question — no premise left          │
 * │ to be wrong about.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const SHELL_TOOL = 'Bash';

/** Every name the shell tool might carry. Send all of them, the SDK drops whichever doesn't exist. */
export const SHELL_ALIASES = ['Bash', 'PowerShell'] as const;

/** Does this role have the shell tool — declared under any of its names counts. */
export function hasShell(tools: readonly string[]): boolean {
  return tools.some((t) => (SHELL_ALIASES as readonly string[]).includes(t));
}

/** Tools at the `write_external` level — will have to pass through the approval gate once §8 is implemented. */
export const EXTERNAL_TOOLS = new Set<string>(SHELL_ALIASES);

/**
 * The actual tool set granted to a role: the default set + whatever's added.
 *
 * Declaring shell under ONE name grants EVERY name — see the block above.
 * This is the only place that knows that, so `roles/*.yaml` keeps
 * `tools: [Bash]` unchanged, whatever machine it's actually running on.
 */
export function effectiveTools(extra: readonly string[]): string[] {
  const out = new Set<string>([...BUILTIN_TOOLS, ...extra]);
  if (hasShell(extra)) for (const alias of SHELL_ALIASES) out.add(alias);
  return [...out];
}

// ─────────────────────────────────────────────────────────── role

export const SkillLevelSchema = z.enum(['short', 'medium', 'formal']);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const RoleSchema = z.object({
  id: z.string().min(1),
  /** Bump when editing skills/tools — feeds into the cacheKey. Edit without bumping = the cache serves stale content. */
  version: z.number().int().positive().default(1),
  display_name: z.string().default(''),
  avatar: z.string().default('•'),

  /** The ONLY thing the master sees at planning time. Keep it short — it lives in the master's context. */
  pitch: z.string().min(1),
  good_at: z.array(z.string()).default([]),
  not_for: z.array(z.string()).default([]),

  skill_level: SkillLevelSchema.default('medium'),
  /** map level -> skill file path, relative to the company directory */
  skills: z.partialRecord(SkillLevelSchema, z.string()).prefault({}),

  /**
   * Tools ADDED beyond the default set. → docs/SPEC-tools-approval.md §5
   *
   * Almost always empty. The default set (`BUILTIN_TOOLS`) is already on for
   * every worker and can't be turned off — they're the office's HANDS, and
   * `cwd` + `safeJoin` already lock them inside the office directory.
   *
   * The only field value worth using here is `Bash` — the only thing that
   * can reach outside the office directory.
   */
  tools: z.array(z.string()).default([]),
  /** MCP server names (declared in company.yaml). Only a worker can be granted these — the master never is. */
  mcp: z.array(z.string()).default([]),
  /** REST connectors (docs/SPEC-connectors.md). Not used yet at v0. */
  connectors: z.array(z.string()).default([]),

  /**
   * The NAMES of secrets this role holds — credentials for external
   * tools/APIs. The values live in `company/.state/secrets.json` (gitignored),
   * NOT here.
   *
   * Least privilege per person: only a secret named in this list gets fed
   * into the environment of the MCP server an agent runs. A writer doesn't
   * hold the credential to the payment gateway, even if two people share the
   * same office.
   *
   * The Assistant does NOT have this field. It never holds a tool itself —
   * anything needing a tool goes through a hidden worker, and that worker has
   * its own role with its own secrets. → docs/SPEC-offices.md §5
   */
  secrets: z.array(z.string()).default([]),

  /**
   * ARCHIVED (soft delete). → docs/SPEC-offices.md §5.1
   *
   * Just a flag — the file doesn't go anywhere, the experience in
   * `knowledge/agents/<id>/` stays intact, and restoring means the worker
   * lands back in the exact same office, because it never actually left.
   *
   * An archived role disappears from the canvas AND from the Assistant's
   * roster — i.e. its `pitch` leaves the prefix cache. Archiving someone
   * saves real tokens, exactly like disconnecting a wire, just more decisive.
   */
  archived: z.boolean().default(false),

  model_tier: TierSchema.default('standard'),

  /**
   * Whether to use Claude Code's system-prompt preset.
   * Default FALSE: the preset costs ~6,300 more tokens/call, 5.5× the price.
   * Only turn it on for a role that genuinely needs coding guidance.
   * → docs/FINDINGS-sdk-2026-08-14.md §2a
   */
  use_preset: z.boolean().default(false),

  budget: z
    .object({
      max_tokens: z.number().int().positive().default(60_000),
      max_turns: z.number().int().positive().default(15),
      /**
       * A task's cost cap. **`0` = NO LIMIT**, and that's the default.
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ A CAP IS THE USER'S OWN BRAKE, NOT OUR RULER. (user settled 08/21)     │
       * │                                                                    │
       * │ The previous version defaulted to $0.5 in the schema and $0.4 in the      │
       * │ role-generating template. Measured the same day: the exact task a role's       │
       * │ `pitch` advertises (*"reads a CSV, aggregates totals by group"*) cost           │
       * │ **$0.425 · $0.448 · $0.516** on the `standard` tier. I.e. OUR default            │
       * │ sat BELOW the price of the very work that role exists to do — it fires           │
       * │ on the happy path, every time, and the user reads "failed" for a task            │
       * │ that ran correctly.                                                  │
       * │                                                                    │
       * │ One number for both tiers is also wrong: same task, `eco` spends              │
       * │ $0.157–0.179 while `standard` spends $0.425–0.516 (~2.7×). One shared          │
       * │ cap is simultaneously too loose for one tier and too tight for the other.      │
       * │                                                                    │
       * │ ⇒ The default does NOT block; `newRoleYaml` writes in a WIDE number per         │
       * │   tier so the user can see it and tighten it themselves. Hard work has          │
       * │   to be given enough room to finish — cutting it off mid-way loses the          │
       * │   money already spent, entirely.                                      │
       * └────────────────────────────────────────────────────────────────────┘
       */
      max_usd: z.number().nonnegative().default(0),
      /** Cap for COLD knowledge (loaded per task). HOT sits in the prefix, counted separately. */
      knowledge_pack: z.number().int().nonnegative().default(3_000),
    })
    .prefault({}),

  /** Number of "hot" knowledge nodes packed into the cached prefix. */
  hot_knowledge_size: z.number().int().nonnegative().default(8),
});
export type Role = z.infer<typeof RoleSchema>;

// ─────────────────────────────────────────────────────────── company config


export const CompanyConfigSchema = z.object({
  /** Empty = never named. → the note on `assistant.display_name` */
  name: z.string().default(''),

  runtime: z
    .object({
      port: z.number().int().default(7317),
      concurrency: z.number().int().positive().default(4),
      concurrency_by_tier: z
      .object({
        eco: z.number().int().positive().default(6),
        standard: z.number().int().positive().default(4),
        deep: z.number().int().positive().default(1),
      })
      .prefault({}),
      /** auto = 1h while "in a session" (UI open / bridge active), 5m for a one-off run. */
      cache_ttl: z.enum(['auto', '5m', '1h']).default('auto'),
      /** How long to wait at most at the cache priming gate before releasing everything. */
      priming_timeout_ms: z.number().int().positive().default(20_000),
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ THE ADDRESS THE USER ACTUALLY TYPES INTO THE BROWSER. Only needed when         │
       * │ the daemon is NOT running on the user's own machine: Docker · VPS ·           │
       * │ behind nginx · with a domain.                                          │
       * │                                                                      │
       * │ Why it can't be inferred: the `Host` header is sent by the client, so it       │
       * │ can be SPOOFED, and `redirect_uri` is where the AUTHORIZATION CODE gets           │
       * │ sent. Inferring it from a header a stranger controls is opening exactly            │
       * │ the door to steal that code. ⇒ It has to be something **the deployer               │
       * │ declares**, not something we guess.                                    │
       * │                                                                      │
       * │ Leave it blank when running on your own machine (the default) — at that          │
       * │ point `127.0.0.1:<port>` is both correct and safe, and it's the only case         │
       * │ that's been tested.                                                    │
       * │                                                                      │
       * │ Set it via yaml, or `AGENTCO_RUNTIME_PUBLIC_URL=https://…` (the existing            │
       * │ env-override mechanism — no new concept invented). → SPEC-arms §5h·6           │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      public_url: z.string().default(''),
    })
    .prefault({}),

  budgets: z
    .object({
      /** A HARD cap. Exceed it and it gets cut. → SPEC-token-economy.md §4 */
      receipt_tokens: z.number().int().positive().default(800),
      knowledge_node_tokens: z.number().int().positive().default(250),
      charter_tokens: z.number().int().positive().default(500),
      /**
       * Cap for skills the user writes for the Assistant. This block sits in the
       * prefix of EVERY conversation turn — being smaller than the charter is
       * deliberate.
       */
      assistant_skills_tokens: z.number().int().positive().default(400),
      /**
       * Cap for the RESULTS LISTING in the Assistant's prefix.
       * → SPEC-artifacts.md §2.4
       *
       * Deliberately small, and it's the ONLY cap holding back the results
       * store from growing forever while context doesn't. Exceeding it cuts
       * from the OLDEST session — an old result is less likely to be
       * referenced again than one that just finished.
       *
       * ⚠ This block NEVER enters a worker's prefix. A worker receives a path
       * through `inputs`; stuffing the listing in there would charge EVERYONE
       * on EVERY turn for something they don't use.
       */
      artifacts_manifest_tokens: z.number().int().positive().default(600),
      hot_knowledge_tokens: z.number().int().positive().default(2_000),
      cold_knowledge_tokens: z.number().int().positive().default(3_000),
      task_brief_tokens: z.number().int().positive().default(1_500),
      master_compact_at: z.number().int().positive().default(60_000),
    })
    .prefault({}),

  /**
   * ⚠ `cheap` is the OLD KEY NAME for `eco` (renamed 08/15/2026).
   *
   * `TIER_ALIASES` already handles the VALUE side (`model_tier: cheap` in
   * roles/*.yaml) but missed the KEY side here, and the consequence is far
   * quieter: `company.yaml` writing `models.cheap: <model>` gets its
   * unrecognized key silently dropped by zod, `eco` falls back to its
   * default, and the user runs on a model DIFFERENT from what they wrote —
   * no error, no warning, just a bill that doesn't match. Same lesson, its
   * other half.
   */
  models: z.preprocess(
    (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      const m = { ...(v as Record<string, unknown>) };
      if (m['cheap'] !== undefined && m['eco'] === undefined) m['eco'] = m['cheap'];
      delete m['cheap'];
      return m;
    },
    z
    .object({
      eco: z.string().default('claude-haiku-4-5-20251001'),
      standard: z.string().default('claude-sonnet-5'),
      deep: z.string().default('claude-opus-5'),
      /**
       * The master's tier — a long session, conversing with a person.
       * MUST STAY FIXED for the whole session. Changing the model mid-way
       * misses the master's entire context every time, because the prompt
       * cache is keyed on (model, prefix).
       */
      master: TierSchema.default('standard'),
      /**
       * The tier for PLANNING. Runs as its own SEPARATE one-shot query, not
       * inside the master's session — so setting 'deep' here doesn't break
       * the master's cache. This is the only way to use Opus for the step
       * that needs quality without paying its full price elsewhere.
       */
      planner: TierSchema.default('standard'),
    })
      .prefault({}),
  ),

  librarian: z
    .object({
      every_n_tasks: z.number().int().positive().default(20),
      /**
       * The AGING WINDOW: a note that hasn't been selected once in N days gets
       * pruned, on every memory compaction. Set to 0 to disable entirely.
       *
       * The condition is AND, not OR: `hits` is only trustworthy once the
       * store is bigger than `hot_knowledge_size` — below that threshold
       * every node loads on every turn so `hits` is nearly uniform, and
       * filtering on it is filtering on noise.
       */
      prune_after_days: z.number().int().nonnegative().default(15),
    })
    .prefault({}),

  /**
   * The document cabinet. → docs/SPEC-library.md §12
   *
   * Sits at the COMPANY level even though the cabinet itself is per office:
   * these are just numbers about mechanical limits, not about "what business
   * this office is in". Same reasoning as `budgets`.
   */
  library: z
    .object({
      /**
       * The cap on one file. 50MB covers nearly every PDF with a text layer (a
       * 300-page book is only 1–5MB) and most image-heavy PDFs. Above this it's
       * almost certainly a scan — something we can accept but can't search by
       * keyword.
       */
      max_file_mb: z.number().positive().default(50),
      /**
       * How long to wait at most for a document mid-extraction before running
       * the task without text. A timeout is mandatory: a file broken in some
       * unforeseen way must never hang the entire office. → SPEC-library.md §10
       */
      extract_timeout_ms: z.number().int().positive().default(30_000),
    })
    .prefault({}),

  /**
   * MCP servers declared at the COMPANY level (plug in once, every office can
   * see it), but WHO gets to USE which one is decided by each office's own
   * canvas connections.
   */
  mcpServers: z.record(z.string(), z.unknown()).prefault({}),

  /**
   * The SHARED ROSTER of arms — agentco's own half, split from `mcpServers`
   * which is the SDK's half. → docs/SPEC-arms.md §6i (user settled 08/23)
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TWO MAPS, THE SAME KEY (a config hash), TWO ENTIRELY DIFFERENT JOBS.            │
   * │                                                                          │
   * │   `mcpServers[hash]`  the EXACT shape the SDK needs, not one extra field.       │
   * │   `arms[hash]`        what agentco needs that the SDK doesn't know: label,      │
   * │                       credentials, origin.                              │
   * │                                                                          │
   * │ Stuffing `label`/`secrets` into `mcpServers` would send them straight down       │
   * │ to the SDK as unrecognized fields — harmless today, broken the day the SDK       │
   * │ tightens its schema, and we'd go looking for the cause somewhere else.          │
   * │                                                                          │
   * │ ⚠ THIS ROSTER IS NOT DELETED WHEN AN ARM IS UNPLUGGED. That's exactly the       │
   * │ "plug it back in and it's found" mechanism: unplugging at an office =            │
   * │ removing `mcp:` from `roles/*.yaml`, while the config + name + credential          │
   * │ names stay intact right here. That's exactly what let the "archive" concept       │
   * │ get dropped entirely for arms — a worker needs archiving because it carries         │
   * │ things that can't be rebuilt (skills, an experience notebook); an arm only          │
   * │ carries config, and this roster holds exactly that.                            │
   * │                                                                          │
   * │ An entry nobody uses costs NOTHING: `pickMcp` only builds a server whose         │
   * │ name appears in `role.mcp`, so unused ones never enter anyone's prompt.          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  arms: z
    .record(
      z.string(),
      z.object({
        /** Display name. Renames freely — NOTHING references it. */
        label: z.string().default(''),
        /** The catalog entry used to build it, if any. Only used for icon and hinting. */
        catalog: z.string().optional(),
        /**
         * Credential NAMES (never values). `grantArm` merges this list into
         * `role.secrets` so `pickMcp` injects the exact right set into the
         * MCP process.
         */
        secrets: z.array(z.string()).default([]),
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ TOOLS GRANTED — **already resolved**, not a policy. Empty ⇒ the           │
         * │ whole server.                                                     │
         * │                                                                    │
         * │ A catalog entry declares `readOnly: true` (one flag); `addArm` runs a         │
         * │ probe, asks each tool's `annotations`, and writes the **resolved                │
         * │ list** in here. ⇒ 0 tool names sit in the source code, yet it's still            │
         * │ deterministic at runtime.                                        │
         * │                                                                    │
         * │ Why it lives in `arms[]` instead of being recomputed on every use:            │
         * │  · `pickMcp` is SYNCHRONOUS (armexec.ts) — asking the server there would        │
         * │    pull a network round trip into a hot path just cleaned up             │
         * │  · the user CAN READ IT in `company.yaml` — a "read-only" arm can be            │
         * │    verified with their own eyes, not by trusting the badge                │
         * │  · a provider adding a WRITE tool later does NOT automatically leak in            │
         * └────────────────────────────────────────────────────────────────────┘
         */
        tools: z.array(z.string()).default([]),
        /**
         * The PERMISSION TIER the user chose at plug-in time.
         * → docs/SPEC-arms.md §6j
         *
         * `read` read-only · `add` read + create · `full` full access.
         * Absent = an arm created before 08/26, or an entry with no tiers
         * (a directory, plugged in manually) — these keep the old behavior
         * and **keep their old hash**.
         *
         * ⚠ This field goes into `armHash`. Changing the tier = **a different
         * arm**, which is exactly what makes "changing the level at this
         * office" not touch another office — see the comment block at
         * `catalog.ts §armHash`.
         */
        level: z.enum(['read', 'add', 'full']).optional(),
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ WHAT THIS ARM CAN DO — in HUMAN LANGUAGE. → `assistant.ts §armReach` ·         │
         * │ docs/SPEC-arms.md §16r                                            │
         * │                                                                    │
         * │ 🔴 BORN FROM A MEASURED FAILURE (spike 08/30, 3/3 turns failed).            │
         * │                                                                    │
         * │ `CatalogArm.hint` has been *"a sentence for the model, added to the           │
         * │ roster line"* since 08/29 — but it could only arrive **through a               │
         * │ catalog entry**. A hand-pasted arm (path B) and a CLI arm **have no                │
         * │ `catalog`** ⇒ they get no sentence, ever, and their roster line is                 │
         * │ EXACTLY ONE NAME.                                                      │
         * │                                                                    │
         * │ Measured what happens when the model has never seen that name before:             │
         * │   · asked naturally      ⇒ the Assistant **MAKES UP** a result, never             │
         * │                             hands out the task                       │
         * │   · named explicitly     ⇒ the Assistant writes a brief *"via shell               │
         * │                             command"* ⇒ blocked                          │
         * │                                                                    │
         * │ For `Notion`/`GitHub` this hole is INVISIBLE because the name itself                │
         * │ carries capability (the model has a prior on the provider). That's why             │
         * │ it sat quiet for 3 weeks. → [[agentco-debt-hidden-by-model-priors]]                │
         * │                                                                    │
         * │ ⚠ NOT "listing raw tool names" (§7b bans that, correctly): this is a               │
         * │ HUMAN-readable sentence (`roll a die`), has a CAP, and only appears for            │
         * │ a role that holds that exact arm. And for a self-built arm it's also              │
         * │ NOT "a second declaration" (§7a): this exact string is what feeds into              │
         * │ the MCP tool's `description`, meaning it IS the handshake.                  │
         * │                                                                    │
         * │ ⚠ Absent ⇒ **prints nothing**, never makes something up. Every arm                │
         * │ created before 08/30 keeps its old roster line, its old hash.                   │
         * └────────────────────────────────────────────────────────────────────┘
         */
        does: z.array(z.string()).default([]),
        /*
          ⚠ `repos` WAS REMOVED (08/27 afternoon) — a repo-level limit agentco
          used to hold. Don't rebuild it without reading `SPEC-arms.md` §5h·7m.
          A GitHub arm's reach is a property of **the provider's own app
          installation**, not a field we get to hold.
        */
      }),
    )
    .prefault({}),

  /**
   * Allow editing the core prompt layer. Defaults to FALSE, and the UI must
   * ask through a warning dialog before turning it on. → SPEC-offices.md §4.1
   *
   * The core belongs to the SOURCE CODE, not to running the business. Allowing
   * edits isn't granting freedom — it's handing over a trap: strip out the
   * Receipt protocol and the whole cost architecture collapses, and the user
   * blames the product instead of their own edit. But HIDING it means an
   * advanced user guesses, and a wrong guess means they write skills that
   * fight the system itself. So: always viewable, locked by default.
   */
  allow_core_prompt_edit: z.boolean().default(false),

  /**
   * INTERFACE language. → `src/i18n/` · docs/CLAUDE.md §Language
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THIS FIELD NEVER REACHES A PROMPT. NOT ONE.                       │
   * │                                                                      │
   * │ It answers "what do I want to SEE". It cannot answer "what language  │
   * │ is this person SPEAKING". A Vietnamese user may genuinely prefer an  │
   * │ English interface — a normal case, not an odd one. Wiring the two    │
   * │ together forces English answers on someone who wanted English menus. │
   * │                                                                      │
   * │ Everything the system PRODUCES — `say`, `answer`, `gist`, `lessons`, │
   * │ the memory written on `/clear`, the contents of every result file —  │
   * │ follows the language the human types in, observed by the model. No   │
   * │ mechanism at all, and that is exactly why a Chinese user gets        │
   * │ Chinese lessons without one line of code naming Chinese anywhere.    │
   * │                                                                      │
   * │ `test/no-pinned-language.test.ts` is the gate that keeps it so.      │
   * └──────────────────────────────────────────────────────────────────────┘
   *
   * OPTIONAL, no `.default()`: absent must stay distinguishable from a real
   * choice so `resolveLocale` can still consult the OS hint. `agentco init`
   * writes a value outright, so absent only happens for a config predating
   * this work — where the correct answer is `vi`.
   */
  language: z.enum(['vi', 'en']).optional(),
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

// ─────────────────────────────────────────────────────────── office config

/**
 * WHERE THE RESULT LANDS — a second axis, independent from `intent`.
 * → docs/SPEC-offices.md §6 "`deliver`"
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `intent` decides WHO DOES IT. `deliver` decides WHERE THE RESULT LANDS.        │
 * │                                                                          │
 * │ Before 08/19 this axis was hard-coded to `file` in the prompt, so it was          │
 * │ INVISIBLE — and every attempt to fix it accidentally went to the `intent`         │
 * │ axis instead. A real case: a customer asked *"how long is the warranty?"*,           │
 * │ the system answered *"saved at                                          │
 * │ artifacts/P-mt08w0t8-iu50/T-01/tra-loi.md"*. Routing was CORRECT (the             │
 * │ Assistant has no tool, a worker had to read the document) — the task just         │
 * │ only had one delivery shape available.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `reply` — the person wants to KNOW something. Read it, done.
 * `file`  — the person wants to HAVE something. Open · send · edit · save.
 */
export const DeliverSchema = z.enum(['reply', 'file']);
export type Deliver = z.infer<typeof DeliverSchema>;

/**
 * Configuration for one office. DELIBERATELY small: anything money-related
 * lives in company.yaml, here there's only "what's this office named and
 * who's its Assistant".
 */
export const OfficeConfigSchema = z.object({
  id: z.string().min(1),
  /**
   * A FUNCTION default, not a literal one. `z.string().default('…')` captures its
   * value when the schema object is built — at import — so a literal here would
   * freeze the label to whichever language the process started in and keep it
   * after the user switches. The function runs on every parse instead.
   */
  name: z.string().default(() => t('company.unnamedOffice')),
  /**
   * The office's introduction — PLAIN markdown, no frontmatter, at the office
   * root.
   *
   * ⚠ Before 08/17 this file lived at `knowledge/shared/_charter.md`, meaning
   * it was both a prompt layer AND a knowledge node at once. Two windows, two
   * write paths, no link between them — and users hit all three
   * consequences: a ghost node in the Knowledge drawer, deleting that node
   * and then editing the prompt layer meant the file lost its frontmatter and
   * silently stopped being a node, and it competed in COLD selection so the
   * charter's body got sent TWICE per task (once in the cached prefix, once
   * at full price).
   *
   * → docs/SPEC-library.md §17. `migrateCharters()` moves it automatically,
   * no prompt.
   */
  charter_file: z.string().default('charter.md'),

  /**
   * ARCHIVED (soft delete). → docs/SPEC-offices.md §3.1
   *
   * Meaning: **FROZEN, READ-ONLY.** Accepts no tasks, answers no chat, edits
   * nothing. But old results are still openable, and it still has a NAME in
   * the cost ledger — that's the actual reason soft delete exists: a
   * permanently deleted office leaves behind cost lines nobody can explain
   * anymore.
   *
   * Not letting it run is deliberate. "Deleted but still silently spending
   * money" is behavior nobody can predict, and money is the one thing a user
   * can't get back.
   */
  archived: z.boolean().default(false),

  /**
   * ARM PRESENT ON THIS OFFICE'S CANVAS. → docs/SPEC-arms.md §6i
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ SEPARATE "PRESENT" FROM "WHO CAN USE IT" (user settled 08/23).           │
   * │                                                                          │
   * │ The old version inferred presence from `role.mcp` — an arm only showed  │
   * │ up once at least one wire existed. User-visible consequence: plug one   │
   * │ in, don't pick a worker for it yet, hit Done — **nothing happens at     │
   * │ all**. As data it was already plugged in; on screen it didn't exist.    │
   * │                                                                          │
   * │ Two different things, now two different places that record them:        │
   * │                                                                          │
   * │   `office.arms`  this one IS ON THE OFFICE'S CANVAS   ← this field      │
   * │   `role.mcp`     who's allowed to use it              ← the wire        │
   * │                                                                          │
   * │ That lets an unwired node still render, and the user can DRAG a wire    │
   * │ from it — instead of going back into a dialog. A wireless node is still │
   * │ useless, but it's **visible**, and that's the whole difference between  │
   * │ "not done yet" and "gone".                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  arms: z.array(z.string()).default([]),

  assistant: z
    .object({
      /**
       * EMPTY means "nobody has named this assistant" — not "the name is blank".
       *
       * Same shape a role already uses (`display_name: ''`, read as
       * `display_name || id`), and it is the difference between OUR label and
       * THEIR datum: an empty field renders through the interface switch, a
       * filled one is the name a person chose and is never translated.
       *
       * Writing a default here instead would freeze a name from whichever
       * locale happened to be active at creation — and `company.yaml` has no
       * rename button, so the switch could never take it back.
       */
      display_name: z.string().default(''),
      avatar: z.string().default('★'),
      /**
       * Model tier for THIS OFFICE's Assistant. Empty = falls back to the
       * company's `models.master`. → docs/SPEC-offices.md §4.5
       *
       * Boundary stays the same: the COMPANY decides which model each tier
       * points to (that's money); the OFFICE decides which tier its Assistant
       * runs at (that's work). Same shape as a role's `model_tier`, so it
       * doesn't invent a new concept.
       *
       * ⚠ Changing this field changes the cache key (model, prefix). The next
       * chat turn has to WRITE OUT the whole prefix again, and because the
       * Assistant runs on `resume` it also resends the full conversation
       * record at full price. Memory is NOT lost — the record lives on disk,
       * independent of the model — but this one turn is a real charge.
       */
      model_tier: TierSchema.optional(),

      /**
       * Where this office's task output lands BY DEFAULT. → SPEC-offices.md §6
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ THIS IS THE DETERMINISTIC LEVER THAT REPLACES THE REJECTED `/answer`  │
       * │ COMMAND.                                                              │
       * │                                                                      │
       * │ Chat vs. file is NOT a per-message decision — it's a property of the │
       * │ OFFICE, stable for months. `customer-support` exists to produce      │
       * │ replies; `content` exists to produce files. Set the right default    │
       * │ here and the Assistant stops flipping a coin every turn — it only    │
       * │ overrides when a case is genuinely unusual.                          │
       * │                                                                      │
       * │ Cost: 0 tokens. It's a word sitting in a prefix that's already       │
       * │ cached.                                                              │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      default_deliver: DeliverSchema.default('file'),

      /**
       * MCP servers the Assistant "can use". In practice wired to the hidden
       * worker (the concierge) — the master never holds an MCP connection
       * itself, because it resumes constantly and MCP breaks the prompt cache
       * on resume (issue #247), costing ~36,000 equivalent tokens on EVERY
       * chat turn. → SPEC-offices.md §4.4
       */
      mcp: z.array(z.string()).default([]),
    })
    .prefault({}),
});
export type OfficeConfig = z.infer<typeof OfficeConfigSchema>;

// ─────────────────────────────────────────────────────────── task & receipt

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `kind` STOPPED BEING A ONE-VALUE ENUM ON 05/09 — the FOURTH time one   │
 * │ failure class hit `resolveInput`, and the file had predicted it.          │
 * │                                                                          │
 * │ `paths.ts` already recorded three: 08/22 blind to absolute paths · 08/26  │
 * │ blind to arm names · 08/31 blind to URLs. *"Patching three places with    │
 * │ three fixes just invites the bug back at a fourth."* Here it is.          │
 * │                                                                          │
 * │ Measured 05/09: *"read the agentco page on Notion"*, to a worker holding  │
 * │ a read-only Notion arm. The Assistant planned it correctly and wrote      │
 * │ `inputs: [{path: "Notion: agentco"}]` — because `inputs` is the ONLY      │
 * │ slot for "what this task needs", and the slot could only say **file**.    │
 * │ The gate then blocked the whole plan: not on disk, no task produces it.   │
 * │ The Assistant got blocked for doing the right thing, a fourth time, and   │
 * │ the advice it gave back — *"say which document you mean"* — could not     │
 * │ work, because nothing the human retyped was ever the problem.             │
 * │                                                                          │
 * │ ⚠ The 08/26 fix WAS deterministic, and that is the sharp part: `armDirs`  │
 * │ maps an arm to a DIRECTORY, so a filesystem arm resolves and Notion,      │
 * │ Linear and GitHub — which have no directory at all — can never appear in  │
 * │ that table. A deterministic gate that cannot SEE half of what it governs  │
 * │ is not a gate over that half. → [[agentco-rule-must-see-what-it-governs]] │
 * │                                                                          │
 * │ ⚠ `'connection'` carries a NAME, not a path: what to fetch, in the        │
 * │ human's own words. Nothing resolves it to disk and nothing opens it —     │
 * │ the worker asks its own arm at the moment of doing the work, which is     │
 * │ the only moment anyone knows what that arm can do.                        │
 * │                                                                          │
 * │ ⚠ `.default('file')` keeps every plan written before today parsing        │
 * │ unchanged — including one being resumed mid-run.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const TaskIOSchema = z.object({
  kind: z.enum(['file', 'connection']).default('file'),
  path: z.string(),
});
export type TaskIO = z.infer<typeof TaskIOSchema>;

/**
 * Master → worker.
 *
 * INVARIANT: `inputs` holds only PATHS, never file content. Pasting content
 * into the brief means that content sits in the master's context forever —
 * this is the #1 token-burning mistake in multi-agent systems.
 */
export const TaskBriefSchema = z.object({
  task_id: z.string(),
  role: z.string(),
  goal: z.string().min(1),
  inputs: z.array(TaskIOSchema).default([]),
  outputs: z.array(TaskIOSchema).default([]),
  constraints: z.array(z.string()).default([]),
  knowledge_refs: z.array(z.string()).default([]),
  deps: z.array(z.string()).default([]),
  /** Plan step this task belongs to (so the UI can group it). */
  step: z.number().int().nonnegative().default(0),

  /**
   * Where this task's output lands. Default `file` — the old shape, doesn't
   * change behavior for any office that hasn't declared `default_deliver`.
   *
   * ⚠ A `reply` task STILL writes a file as usual. It just stops being
   * ANNOUNCED: the file is an anchor for later edits and an audit trail,
   * nearly free. What changes is that the user reads the ANSWER in chat
   * instead of reading a path.
   */
  deliver: DeliverSchema.default('file'),
});
export type TaskBrief = z.infer<typeof TaskBriefSchema>;

/**
 * ⚠ `'fact'` WAS REMOVED FROM THIS ENUM (08/19) — and that's a deliberate
 * block, not cleanup.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A LESSON MAY ONLY RECORD *HOW TO DO IT*, NEVER *WHAT IS TRUE*.           │
 * │                                                                          │
 * │ `fact` was exactly the slot for copying knowledge into. Give the model   │
 * │ that slot and it will use it — removing the slot is cheaper and more     │
 * │ reliable than any instruction telling it not to. Same rule as §4.3:      │
 * │ don't tell the model not to do something, don't give it the chance to.   │
 * │                                                                          │
 * │   ✅ "the return policy lives in library/files/doi-tra.md, grep there"   │
 * │   ⛔ "products at 60% off usually can't be returned"                     │
 * │                                                                          │
 * │ Why the line sits exactly here: the line ABOVE stays true when the user  │
 * │ edits the policy; the line BELOW becomes a lie that same day, and it     │
 * │ BEATS the document because it already sits in every worker's prefix      │
 * │ while the document has to be looked up. A weak entity (`depends_on`)     │
 * │ only rescues the case where a file is DELETED; the case where a file is  │
 * │ EDITED is only rescued by this rule.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `NodeType` still keeps `'fact'`: the Assistant's own MEMORY record uses it,
 * and something the USER has settled themselves genuinely is a fact. Only a
 * LESSON THE AGENT DRAWS ITSELF loses that slot.
 */
export const LessonSchema = z.object({
  kind: z.enum(['pitfall', 'playbook']).default('pitfall'),
  text: z.string(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * Worker → master. HARD CAP 800 tokens.
 *
 * `say` is a human sentence, shown straight in the UI. The worker generates
 * it directly, so no extra LLM call is spent "translating it to be friendly".
 */
export const ReceiptSchema = z.object({
  status: z.enum(['done', 'failed', 'blocked', 'needs_human']),
  say: z.string().min(1),

  /**
   * The FULL ANSWER for the user — only present on a `deliver: reply` task.
   * → docs/SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TWO CHANNELS, NEITHER ONE CARRIES THE OTHER'S WORDS.                     │
   * │                                                                          │
   * │   answer  →  straight to chat, role = THE WORKER                        │
   * │             ⛔ NEVER enters the Assistant's session                     │
   * │   say     →  report() exactly as before                                 │
   * │             ✅ the ONLY thing the Assistant sees                        │
   * │                                                                          │
   * │ The split keeps the cost invariant intact: the Assistant's context      │
   * │ still receives only ONE SENTENCE per task, even when the customer's     │
   * │ answer runs 300 words.                                                  │
   * │                                                                          │
   * │ The worry "the Assistant reads the file and relays the content twice"   │
   * │ CANNOT happen: it would require the Assistant to be able to read the    │
   * │ file, and §4.7 already blocks that, with a measurement behind the ban.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Its own cap, NOT counted against `say`'s 500-word cap — see `enforceCap`.
   */
  answer: z.string().default(''),

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIRD CHANNEL — AN EVENT FOR THE ASSISTANT TO ANCHOR ON. (user settled   │
   * │ 08/30)                                                                   │
   * │                                                                          │
   * │ > *"I keep having to go into the file to see the result, which is even   │
   * │ >  worse over a bridge"* · *"the worker hands back a gist and lets the   │
   * │ >  assistant parse it into something human-friendly"* · *"it just needs  │
   * │ >  to anchor to the user's intent"*                                      │
   * │                                                                          │
   * │ Three channels, three different lifetimes — don't merge them:            │
   * │                                                                          │
   * │   say     ONE STATUS SENTENCE     → Assistant's session                  │
   * │   answer  FULL answer             → straight to chat, ⛔ NOT into the    │
   * │                                      Assistant's session                 │
   * │   gist    an EVENT, capped        → Assistant's session, for it to       │
   * │                                      COMPOSE INTO WORDS                  │
   * │                                                                          │
   * │ 🔴 WHY THE WORKER HAS TO WRITE THIS, NOBODY ELSE CAN:                    │
   * │  · The Assistant **can't read files** (§4.7, hard-blocked, measured) ⇒   │
   * │    it has no event to summarize, only `say` and a path.                  │
   * │  · A hidden worker reading the file back ⇒ a fresh `query()`, cold       │
   * │    context, re-reading content that sat in a context two seconds ago.    │
   * │    Pay twice for something already held, and open a new spot to          │
   * │    summarize it wrong.                                                   │
   * │  · The worker that just wrote the file ⇒ the content is **still in its   │
   * │    context** ⇒ ~0 extra cost.                                            │
   * │                                                                          │
   * │ 🔴 WHY THE ASSISTANT STILL HAS TO RE-COMPOSE IT, INSTEAD OF PRINTING     │
   * │ `gist` VERBATIM: the worker has **never seen what the user typed** — it  │
   * │ only sees the task brief. Anchoring to intent is the Assistant's job,    │
   * │ and `report()` is **already an LLM call** that has the original question │
   * │ in its session ⇒ zero extra calls.                                       │
   * │                                                                          │
   * │ ⚠ AN EVENT, NOT A NARRATIVE. "3 things: A, B, C" — not "I have completed │
   * │ the lookup task." And ⚠ **not an answer**: that's `answer`. Letting      │
   * │ `gist` balloon into an answer tears down exactly the double-payment      │
   * │ fence that `answer`'s ⛔ rule builds. Hard cap: `GIST_TOKENS`.           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  gist: z.string().default(''),

  artifacts: z.array(z.string()).default([]),
  lessons: z.array(LessonSchema).default([]),
  blocked_on: z.string().nullable().default(null),
});
export type ReceiptBody = z.infer<typeof ReceiptSchema>;

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUSD: number;
  model: string;
  /**
   * Number of API turns. THE MOST IMPORTANT COST METRIC: every turn rereads
   * the WHOLE prefix, so cost ≈ turns × prefix × 0.1. Used to have to be
   * inferred from cache_read; now read straight from the SDK's `num_turns`.
   */
  turns: number;
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUSD: 0,
  model: '',
  turns: 0,
};

/**
 * Where a task's output actually WENT — OBSERVED, not something the model
 * self-reports. → docs/SPEC-offices.md §6, `worker.ts → landingOf`
 *
 * This is different from `artifacts`: `artifacts` is the model's own account
 * (can be made up, and only describes files), while this is inferred from
 * the TOOLS ACTUALLY CALLED during the run.
 */
export interface Landing {
  /**
   * `file`     — written into the office directory, CHECKABLE with `existsSync`
   * `external` — called an MCP server (`ref` = server name). Not checkable,
   *              but known for certain to have been called.
   * `command`  — ran `Bash`. We do NOT know where the data went, and have to
   *              say so.
   * `outside`  — written outside the office directory (`ref` = the raw path
   *              the model typed). See the block below: this is a label for
   *              something we know for certain happened.
   */
  kind: 'file' | 'external' | 'command' | 'outside';
  ref: string;
}

/**
 * A DESTINATION OUTSIDE THE OFFICE MUST HAVE A NAME — MEASURED 08/21.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Case `P-260821-1818-yydi`: a worker `Write`s a path pointing two levels   │
 * │ up, the file lands in `company/artifacts/…` instead of                   │
 * │ `offices/<id>/artifacts/…`. `landingOf` calls `safeJoin`, `safeJoin`      │
 * │ throws exactly as designed, and the `catch { return undefined }` **eats   │
 * │ the whole event**.                                                       │
 * │                                                                          │
 * │ Consequence: `landed` comes back empty → the system says *"no file found │
 * │ on disk, please redo it"* while a 4,236-byte results table sits intact   │
 * │ two directories away. The user gets invited to pay a second time for     │
 * │ something they already have.                                            │
 * │                                                                          │
 * │ This is the failure-mode column of tier 0c debt, the `silently drops it` │
 * │ cell — and it's more dangerous than the `refuses` cell exactly as        │
 * │ predicted: a refusal comes with an error message, dropping it comes with │
 * │ nothing at all. `undefined` here means "there is no destination", when   │
 * │ the truth is "there is a destination, and it's outside the place we      │
 * │ allow". Two different statements; returning the same value for both      │
 * │ loses half of it.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * What's OBSERVABLE during a worker run — entirely independent of how that
 * run ends.
 *
 * Packaged as its own type because it has to travel down **every** exit path
 * (finished · interrupted · hit the cap · out of turns · odd error). Same
 * shape as `RunError.usage`, and for the same reason: tokens spent still
 * exist no matter how the run ends, and a file already written sits on disk
 * no matter how the run ends.
 */
export interface Observed {
  landed: Landing[];
  looped: boolean;
  reads: string[];
}

/** Receipt after validation + measured numbers attached. */
export interface Receipt extends ReceiptBody {
  task_id: string;
  role: string;
  usage: Usage;
  wall_ms: number;
  /** true if the worker returned a malformed schema and had to be re-asked. Used to flag a weak prompt. */
  reasked: boolean;

  /**
   * WHY the run ended early — a failure kind, not prose.
   * `undefined` = the loop ran to completion normally.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ EXISTS TO ANSWER "WHOSE FAULT IS THIS" WITH CODE, NOT A GUESS.           │
   * │                                                                          │
   * │ `blocked_on` already carries this information — but as a plain sentence, │
   * │ in whatever language the model happens to write it in. Deciding         │
   * │ anything based on it means matching that string, and matching a string   │
   * │ meant for display breaks the day someone rewords it to read better.     │
   * │                                                                          │
   * │ The reader of this field is `agentFault()` — the gate that decides       │
   * │ WHETHER TO ASK the model "what did you learn" at all. See the block      │
   * │ there for why the question *"whose fault"* has to be answered before     │
   * │ the question *"what was learned"*.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  failure?: FailureKind;
  /** Observed destinations. Empty = the task produced no visible impact. */
  landed: Landing[];

  /**
   * Did the worker REPEAT an action — a signal that "something's off here".
   * → `worker.ts → detectLoop`, `assistant.ts → worthLearning`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ "LOOP" IS NOT "MANY TURNS". NEVER CONFLATE THE TWO.                     │
   * │                                                                          │
   * │ Turn count is a property of the MODEL, not of the run: measured haiku    │
   * │ taking 10 turns vs. sonnet taking 4 for the SAME job. Using it as a      │
   * │ failure signal makes every `eco` office permanently "broken" and every   │
   * │ `deep` office never broken at all. The draft rule `turns >= 8` was       │
   * │ rejected by the test suite: the 08/19 case ran exactly 9 turns          │
   * │ correctly, i.e. it would have PASSED the exact case it was written to    │
   * │ catch.                                                                   │
   * │                                                                          │
   * │ Repeating an action is the opposite — it's MODEL-INDEPENDENT, and it     │
   * │ violates a discipline `CORE_PROMPT` states outright ("Read each file at  │
   * │ most once", "Never read back a file you just wrote"). Re-reading an      │
   * │ already-read file, re-reading a file just written, calling the same     │
   * │ tool again with the same arguments — all three are observable in the    │
   * │ `tool_use` stream that `worker.ts` already unpacks.                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  looped: boolean;

  /**
   * Library files the worker actually TOUCHED — OBSERVED, not something the
   * model self-reports.
   *
   * This is the source of `depends_on` on a knowledge node: a lesson drawn
   * after reading `library/files/doi-tra.md` LIVES OR DIES with that file.
   * The user deletes the document, the lesson goes with it — a weak entity,
   * deleted 1-to-1, never an orphan node talking about a file that no longer
   * exists. → `KnowledgeStore.dropDependents`
   */
  reads: string[];
}

// ─────────────────────────────────────────────────────────── plan

export interface PlanStep {
  /** ≤10 words. A constraint in the master prompt, not a suggestion. */
  title: string;
  status: 'pending' | 'running' | 'done' | 'problem' | 'waiting_human';
}

export interface Plan {
  plan_id: string;
  request: string;
  /** Max 6 steps. */
  steps: PlanStep[];
  tasks: TaskBrief[];
  /**
   * Paths outside the office that `outputScoper` pulled back into `artifacts/`.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THIS HAS TO BE RECORDED, RATHER THAN LEFT FOR THE MODEL TO NOTICE.   │
   * │                                                                          │
   * │ Case 08/24 (`P-260824-0401-q7ma`): the user asked to copy a file into    │
   * │ `D:\Downloads\Programs Installation\`. `outputScoper` pulled the         │
   * │ destination back to `artifacts/…` (as designed). The Assistant NOTICED   │
   * │ the mismatch and wrote on its own:                                      │
   * │                                                                          │
   * │   *"…I'll try writing to that exact location if needed."*                │
   * │                                                                          │
   * │ **A promise it can't keep.** However many times it retries, the file     │
   * │ still lands in `artifacts/` — `outputScoper` runs BEFORE the worker is   │
   * │ even launched, so no turn ever passes through that path. We just         │
   * │ invited the user into a loop with no exit, charging them for every lap.  │
   * │ Same failure class as ㉗②.                                              │
   * │                                                                          │
   * │ Not fixed with a prompt instruction: this is something CODE knows for    │
   * │ certain (the exact string `outputScoper` just rewrote), while the model  │
   * │ is guessing. Same rule as the "⚠ N/M steps still left" line — *when the  │
   * │ model asserts something the data in hand can refute, block it with code  │
   * │ that checks, not with a warning*.                                        │
   * │                                                                          │
   * │ ⚠ Optional (`?`) on purpose: an old `plan.json` on disk doesn't have     │
   * │ this key, and `/resume` still has to be able to read those back.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  redirected?: string[];
}

/**
 * A PLAN IS THE UNIT OF WORK, not a chat line. → SPEC-offices.md §6
 *
 * v0's log was one flat stream: unreadable once two jobs overlap, and unable
 * to answer "what did yesterday's job actually do". Every event now carries
 * a `plan_id`, and this is the record that `plan_id` points to.
 */
/**
 * `blocked` (08/20) — NOT YET TRIED for lack of information, distinct from
 * `failed` (TRIED and broke). When planning has to ask the user something
 * back, the case stops here.
 *
 * Split out so the work log doesn't lie: the user has to be able to tell
 * *"the system got it wrong"* from *"the system is waiting on me"*, and
 * merging the two into one status breaks the very log built to be trusted.
 * → SPEC-offices.md §6
 */
export type PlanStatus =
  | 'planning'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'paused'
  | 'stopped';

export interface PlanRecord {
  plan_id: string;
  office: string;
  /** What the user typed, rewritten clearly by the Assistant. */
  request: string;
  status: PlanStatus;
  started_at: string;
  ended_at?: string;
  steps: PlanStep[];
  /** Tasks done / total — shows progress without reading every receipt. */
  tasks_done: number;
  tasks_total: number;
  costUSD: number;
  turns: number;
  /** The Assistant's closing summary sentence. */
  report?: string;
}

// ─────────────────────────────────────────────────────────── failure classification

/**
 * Rate limiting (429) and running out of subscription usage are TWO
 * different failure kinds, handled in opposite ways. →
 * SPEC-2026-08-14-agentco.md §9b
 */
export type FailureKind =
  /** temporary, measured in seconds → backoff + reduce concurrency */
  | 'rate_limit'
  /** waits for the reset window, measured in hours → STOP THE RUN, no retry */
  | 'usage_limit'
  /** not logged into Claude Code */
  | 'auth'
  /** hit a budget cap we set ourselves → ask the user, never raise it ourselves */
  | 'budget'
  /** ran out of allowed turns → say exactly where to fix it, don't report a generic "error" */
  | 'max_turns'
  /**
   * The user pressed Stop. NOT A FAILURE — and that's the whole reason it has
   * its own name.
   *
   * Without this label, an interrupted Assistant turn looks exactly like a
   * broken one: the run closes as `failed`, and the log records "the system
   * got it wrong" for something the user themself asked to stop. Same
   * failure class that `blocked` was split out of `failed` for
   * (SPEC-offices §6) — the log has to distinguish three genuinely different
   * things: *we broke* · *we're waiting on you* · *you said stop*.
   *
   * Never retried: the only thing that could happen is redoing the exact
   * thing that was just cancelled.
   */
  | 'stopped'
  | 'other';

export class RunError extends Error {
  readonly kind: FailureKind;
  /**
   * Tokens ALREADY SPENT before the error fired. → SPEC-token-economy.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MISSING THIS FIELD MEANS MONEY VANISHES FROM THE LEDGER — MEASURED       │
   * │ 08/20.                                                                   │
   * │                                                                          │
   * │ Case `P-260820-2219-5ltb`: `nguoi-gop` made 9 tool calls in 29 seconds   │
   * │ then hit `max_turns`. `worker.ts` threw `RunError` and **discarded the   │
   * │ accumulated `usage` variable**, so `usage.jsonl` recorded "0 turns, $0". │
   * │ The user paid real money for a line that reads $0.                      │
   * │                                                                          │
   * │ And it lands on exactly the most expensive spot: `max_turns` is by       │
   * │ definition the MOST EXPENSIVE failure kind — it ran all the way to the   │
   * │ turn ceiling. Same class as `budget` and `rate_limit` (that branch also  │
   * │ puts the task back on the queue and reruns it from scratch).            │
   * │                                                                          │
   * │ The INTERRUPTED branch already did this right                           │
   * │ (`stoppedReceipt(…, usage, …)`) — so this isn't a new mechanism, just    │
   * │ plugging the three remaining paths into the same place.                 │
   * │ → SESSIONS_MEMORY §2 "The cost ledger must never say the wrong thing"    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readonly usage: Usage | undefined;

  /**
   * Files WRITTEN before the error fired. → `Observed`, SPEC-artifacts.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ SAME LESSON AS `usage` RIGHT ABOVE — AND LAST TIME WE ONLY LEARNED HALF   │
   * │ OF IT.                                                                   │
   * │                                                                          │
   * │ Case `P-260821-1827-m78h`: the worker finished writing a 4,474-byte      │
   * │ results table at 18:30:01, in the right place, with all 56/56 groups     │
   * │ correct and **not a single wrong number**. Nine seconds later,          │
   * │ `error_max_budget_usd` fired. `worker.ts` threw, `observed()` got        │
   * │ stranded inside the function, `errorReceipt` hardcoded `landed: []` —    │
   * │ and the user read *"no result yet"* for work that was done and paid     │
   * │ for.                                                                    │
   * │                                                                          │
   * │ The bitter part: `stoppedReceipt` had already described this exact bug   │
   * │ before (*"the old version returned `artifacts: []` — i.e. lying that     │
   * │ there was nothing on disk"*) and fixed it for EXACTLY ONE of the four    │
   * │ throw branches. Right next to it, `usage` was wrapped into a `fail()`    │
   * │ helper with its own note to self *"a new throw branch added later will   │
   * │ get this right automatically"*. Two fields, the same `catch` block, the  │
   * │ same reasoning — one field covers all four branches, the other covers    │
   * │ one.                                                                     │
   * │                                                                          │
   * │ ⇒ PATCHING ONE LAYER MEANS GOING THROUGH EVERY PATH OF THAT LAYER. Once  │
   * │   one branch is fixed, the next question is always *"which other branch  │
   * │   has the same shape?"*                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readonly observed: Observed | undefined;

  constructor(
    message: string,
    kind: FailureKind,
    options?: { cause?: unknown; usage?: Usage; observed?: Observed },
  ) {
    super(message, options);
    this.name = 'RunError';
    this.kind = kind;
    this.usage = options?.usage;
    this.observed = options?.observed;
  }
}

// ─────────────────────────────────────────────────────────── events (SSE)

/**
 * INVARIANT 1: every user-facing event MUST have `say`.
 * No `say` means the UI shows nothing — this constraint forces everything
 * displayed to already be in human words at the source.
 *
 * INVARIANT 2 (since 08/15): every event MUST have `office`, and every event
 * that belongs to a job MUST have `plan_id`. Missing `office` makes a
 * multi-office UI show it in the wrong place; missing `plan_id` makes the log
 * unable to separate two overlapping jobs. An event that belongs to no job
 * (chat) carries `plan_id: null`.
 */
interface EventBase {
  office: string;
  plan_id: string | null;
}

/**
 * Event body, not yet attached to `office`/`plan_id`.
 *
 * Split out because `Omit<AgentEvent, 'office' | 'plan_id'>` on a union type
 * COLLAPSES down to the shared keys — i.e. it silently drops every field
 * specific to one event kind, and TypeScript accepts it quietly and reports
 * the error somewhere else instead. Wherever events are emitted (scheduler,
 * office) receives exactly this type; `Office.emit` attaches the other two
 * fields.
 */
export type AgentEventBody =
  | { type: 'plan.created'; plan_id: string; request: string; steps: PlanStep[] }
  | { type: 'plan.step'; step: number; status: PlanStep['status'] }
  /**
   * Closes the books on a job. DELIBERATELY has no `say`: the report sentence
   * already went out via `master.message` right before this. Carrying it
   * again here makes the log show two identical lines side by side — this is
   * the one exception to the invariant "every user-facing event has a say",
   * because this one isn't user-facing.
   */
  | { type: 'plan.finished'; status: PlanStatus; costUSD: number; turns: number }
  | { type: 'task.started'; task_id: string; role: string; say: string }
  | { type: 'task.progress'; task_id: string; role: string; say: string }
  | {
      type: 'task.done';
      task_id: string;
      role: string;
      say: string;
      status: ReceiptBody['status'];
      artifacts: string[];
      usage: Usage;
      }
  | { type: 'task.blocked'; task_id: string; role: string; say: string; reason: string }
  /**
   * A message in the chat stream.
   *
   * `role` = `'user'` · `'assistant'` · **or a WORKER's id** — a third branch
   * opened up on 08/19 for a `deliver: reply` task: the answer goes STRAIGHT
   * from the worker to the user, without passing through the Assistant, so it
   * has to carry the name of whoever actually wrote it.
   *
   * ⚠ `say` NEVER contains the speaker's name (§6). The display side looks up
   * the name from `role` itself — baking the name into the string strips that
   * choice from every future client, and on the current UI the name would
   * show up TWICE.
   */
  /**
   * `files` — VERIFIED result paths, carried alongside the message as DATA,
   * not as text. → docs/SPEC-ui.md · SPEC-artifacts.md §2.5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THE UI DOESN'T JUST SNIFF PATHS OUT OF `say` ITSELF.                 │
   * │                                                                          │
   * │ `say` is a string aimed at a human reader, and some messages in the      │
   * │ stream are written by the MODEL (a worker's `answer` on a               │
   * │ `deliver: reply` task). Regex-sniffing a path out of it means: a worker  │
   * │ makes up a path that sounds completely real, the UI turns it into a      │
   * │ clickable button, and the user trusts it enough to click. That's lending │
   * │ the UI's credibility to a sentence the model guessed.                   │
   * │                                                                          │
   * │ Here it's the opposite: `files` is ONLY ever filled by `whereBlock`, and │
   * │ every path in it has already passed THREE gates — inferred from          │
   * │ `receipt.landed` (a tool ACTUALLY CALLED, not `receipt.artifacts`        │
   * │ self-reported by the model), blocked from leaving the office directory   │
   * │ by `safeJoin`, and checked with `existsSync` right before it's emitted.  │
   * │                                                                          │
   * │ The result is one clean rule: **only a path CODE ITSELF put there gets   │
   * │ to be clickable.** The model has no path to make a word clickable.       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Paths here are relative to the OFFICE DIRECTORY (`artifacts/…`), while in
   * `say` they carry the prefix `company/offices/<id>/` for someone opening a
   * file explorer. Two different reference frames because they're two
   * different audiences, and the display side reconciles them by comparing
   * the string SUFFIX — no regex, no guessing.
   *
   * ⚠ Being absent is normal, and is the default. A display side that doesn't
   * read `files` (Telegram) shows `say` verbatim exactly as today — the path
   * is still right there in it, just not clickable. Same event, two
   * outcomes, exactly the rule "each display side picks its own reaction".
   */
  | { type: 'master.message'; say: string; role: string; files?: string[] }
  | { type: 'office.state'; say: string; state: 'idle' | 'working' | 'paused' | 'stopped' }
  /**
   * The Assistant being busy and a worker being busy are TWO different
   * things. The UI has to be able to say both, or the user sees silence and
   * assumes the system died. → docs/SPEC-tools-approval.md §11
   */
  | {
      type: 'office.activity';
      /**
       * `planning` is a THIRD state, and it exists because of a real blind
       * spot: `handleUserBatch` calls `run()` WITHOUT awaiting it and returns
       * right away, so the mailbox unlocks immediately and `pump()` emits an
       * `office.activity` that's all zeros — right as `run()` is only just
       * starting to plan. The UI turns off the "what's happening" line, then
       * 15 seconds later the plan shows up.
       *
       * What the user sees: "Assistant is thinking…" → silence → (wait) →
       * plan. That silence is exactly where they conclude the system died
       * and hit Send again.
       */
      assistant: 'idle' | 'thinking' | 'planning';
      workers: number;
      /** messages waiting for the Assistant to read */
      queued: number;
      /** JOBS waiting for their turn to run — the queue has to be visible, not a private array */
      jobs: number;
      /**
       * A TEMPORARY status sentence, overriding the line built from the
       * numbers above. → §4.6
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ THIS IS WHERE `/clear` SPEAKS, INSTEAD OF EMITTING `master.message`. │
       * │                                                                      │
       * │ The "Clearing…" pulse was ALREADY a state pretending to be a         │
       * │ message — it always got swept away by `office.cleared` right after,  │
       * │ no branch of it ever survives. A message designed to never outlive   │
       * │ one beat IS a state. And the "Cleared" pulse was worse: it left      │
       * │ `/clear` littering the exact thing it had just cleaned up.           │
       * │                                                                      │
       * │ Same pattern as `…thinking` → blank: a PROCESS shows then vanishes,  │
       * │ only the RESULT stays. `/clear` has no result that belongs to the    │
       * │ chat pane — its durable evidence is the MEMORY node in the Knowledge │
       * │ pane.                                                               │
       * └──────────────────────────────────────────────────────────────────────┘
       *
       * `hold_ms` = how long the display side holds this sentence before
       * clearing it itself. Bad news stays up longer than good news: people
       * read bad news more slowly.
       *
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ ⚠ MISSING `hold_ms` = HOLD UNTIL THE NEXT EVENT. NO DEFAULT.        │
       * │                                                                      │
       * │ BUG FIXED (08/20): "/clear still stalls 3-5 seconds with no update". │
       * │                                                                      │
       * │ Two kinds of `note` share one field but have OPPOSITE LIFETIMES:     │
       * │                                                                      │
       * │   `emitNote()`            a RESULT is done  → show then vanish (has  │
       * │                                                a hold)               │
       * │   the `clearing` branch   WORK IS RUNNING    → hold until done (no   │
       * │                                                hold)                 │
       * │                                                                      │
       * │ The old web version read "absent" as `?? 4_000`. But compacting      │
       * │ memory takes 5-15 seconds — so the "Clearing…" line **turned itself  │
       * │ off at 4 seconds while the work was still running**, leaving exactly │
       * │ the silence this whole mechanism exists to fill. The user stares at  │
       * │ a frozen screen and assumes the app hung.                            │
       * │                                                                      │
       * │ 🔥 The sting: the `clearing` comment on the `office.ts` side had      │
       * │ already written out this exact lesson — *"a notification can be      │
       * │ overwritten by something else and HAS A TIMER TO EXPIRE; a state is  │
       * │ correct for as long as the work keeps running"*. The server got      │
       * │ fixed to a state; the client still set a timer. **The bug didn't      │
       * │ die, it moved house.** Fixing an invariant at one layer means         │
       * │ tracing its path all the way through — two ends reading the same     │
       * │ field have to agree on what it means.                               │
       * │                                                                      │
       * │ Safe by construction: there's always a closing side — `office.cleared`│
       * │ clears the status line, and both the `.then` and `.catch` branches   │
       * │ of `/clear` emit `emitNote`.                                        │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      note?: string;
      hold_ms?: number;
    }
  /**
   * The conversation was just cleared (`/clear` or auto-compaction). →
   * docs/SPEC-offices.md §4.6
   *
   * Split out from `master.message` because it's a COMMAND to the display
   * side ("erase what's currently shown"), not a sentence meant to be read.
   * Each display side picks its own reaction: web wipes `messages` clean, the
   * Telegram bridge ignores it.
   *
   * ⚠ Why Telegram ignores it is NOT "can't be deleted" (the Bot API has
   * `deleteMessage`, a bot can delete its own messages within 48 hours). The
   * reason is SHOULDN'T: on Telegram the chat pane itself is the user's own
   * record, not a redrawable view.
   *
   * REQUIRED ORDER: `office.cleared` fires FIRST, the result sentence fires
   * AFTER. Reversed, the sentence that just appeared gets swept away by the
   * clear command itself.
   */
  | { type: 'office.cleared'; say: string }
  | { type: 'cost.tick'; totals: Usage & { tasks: number } }
  /**
   * The Claude ACCOUNT's usage limit changed. → `core/energy.ts`
   *
   * ⚠ Differs from `cost.tick` at exactly the point most likely to confuse,
   * and the UI has to treat them differently: `cost.tick` is money for ONE
   * OFFICE in this session — switching offices means clearing it out.
   * `energy.tick` is the limit for the whole ACCOUNT, shared with the user's
   * own Claude Code and claude.ai. Clearing it on an office switch would
   * erase a fact that's still true.
   */
  | { type: 'energy.tick'; energy: Energy }
  | { type: 'knowledge.changed'; count: number; version: number }
  /**
   * The library changed. → docs/SPEC-library.md §10
   *
   * Text extraction runs IN THE BACKGROUND, and can take a few seconds for a
   * thick PDF. Without this event, the "reading…" line just sits frozen until
   * the user happens to reopen the library — i.e. the screen goes silent
   * exactly when they need to know the most.
   *
   * `busy` is the COUNT of documents still being extracted, not a flag: the
   * UI needs to be able to say "3 files left", not just "busy".
   */
  | { type: 'library.changed'; count: number; busy: number }
  /** Office shape changed (dragged a node, wired/unwired, added/removed a worker). */
  | { type: 'layout.changed'; say: string }
  /** Office list changed. `office` is the one just added/removed. */
  | { type: 'company.offices'; say: string };

export type AgentEvent = EventBase & AgentEventBody;
