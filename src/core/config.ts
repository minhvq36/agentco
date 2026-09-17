/**
 * Loading config. TWO LEVELS: the company (money, models) and the office (people,
 * knowledge).
 *
 * → docs/SPEC-offices.md §2, docs/SPEC-cli.md §3
 *
 * Precedence: command-line flags > environment variables > company.yaml > defaults.
 *
 * Where the boundary sits and why: anything touching THE BILL is company-level
 * (one Claude subscription, one invoice, one place to tighten). Anything that
 * enters the PREFIX CACHE is office-level, because a prefix must be as narrow as
 * it can be.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import {
  CompanyConfigSchema,
  OfficeConfigSchema,
  RoleSchema,
  type CompanyConfig,
  type OfficeConfig,
  type Role,
  type SkillLevel,
} from './types.js';
import { companyPaths, officePaths, type CompanyPaths, type OfficePaths } from './paths.js';
import { estimateTokens, truncateToTokens } from './tokens.js';
import { resolveLocale, setLocale, t } from '../i18n/index.js';
import { setClaudePath } from './claude-code.js';

export interface LoadedOffice {
  id: string;
  dir: string;
  paths: OfficePaths;
  config: OfficeConfig;
  /** Company config — models, budgets, token ceilings. Shared, read-only. */
  company: CompanyConfig;
  companyDir: string;
  roles: Map<string, Role>;
  /**
   * Archived roles. Still present in `roles` (so they can be restored, and so
   * old log entries resolve to a name) but NOT on the canvas and NOT in the
   * assistant's roster.
   *
   * A separate Set rather than making every site read `role.archived`: six
   * places have to filter, and whichever one forgets produces a failure that
   * surfaces very late and reads as nonsense (an "archived" employee suddenly
   * receiving work).
   */
  archivedRoles: Set<string>;
  /** The charter, read and trimmed to its ceiling. In EVERY agent's cached prefix. */
  charter: string;
  /** Skills the user wrote for the assistant. May be empty — that is a valid choice. */
  assistantSkills: string;
  knowledgeVersion: number;
}

function readYaml(file: string): unknown {
  if (!fs.existsSync(file)) return {};
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch (err) {
    throw new Error(t('cfg.notYaml', { file: path.basename(file), reason: (err as Error).message }));
  }
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `_` IS BOTH THE NESTING SEPARATOR AND A LETTER INSIDE KEY NAMES, SO     │
 * │ EVERY KEY THAT CONTAINS ONE WAS UNREACHABLE FROM THE ENVIRONMENT.        │
 * │ (measured 18/09/2026 in a running container)                             │
 * │                                                                          │
 * │ `AGENTCO_RUNTIME_PUBLIC_URL` split into `runtime · public · url` and      │
 * │ wrote `runtime.public.url`. The schema has no such key, zod strips        │
 * │ unknown ones, and `runtime.public_url` stayed `""` — silently, with the   │
 * │ variable sitting right there in `docker compose exec … env`.             │
 * │                                                                          │
 * │ ⚠ IT COST A REAL FEATURE, NOT A SETTING. Empty `public_url` + a daemon    │
 * │ bound to `0.0.0.0` is branch ③ of `redirectBase` — REFUSE. So every       │
 * │ OAuth sign-in through the Docker door (Notion, Linear, and every other    │
 * │ web-flow arm) was impossible, while GitHub worked and hid it, because     │
 * │ the device flow has no redirect at all.                                   │
 * │                                                                          │
 * │ ⚠ AND THREE PLACES DOCUMENTED THE SPELLING THAT COULD NOT WORK:           │
 * │ `types.ts §public_url` calls it *"the existing env-override mechanism —   │
 * │ no new concept invented"*, the refusal message prints it as the fix, and  │
 * │ `docker-compose.yaml` sets it. All three were right about the intent and  │
 * │ none of them was executable. → [[agentco-spec-says-done]]                 │
 * │                                                                          │
 * │ 19 keys were affected, including all nine of `budgets`.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The fix is to let the rule SEE what it governs: match each segment against
 * the key names the schema really declares, longest first, instead of assuming
 * one segment is one level. → [[agentco-rule-must-see-what-it-governs]]
 */
const ENV_PREFIX = 'AGENTCO_';

/** Variables that drive the PROCESS, not the company. They never reach the config. */
const NOT_CONFIG = ['company', 'dir', 'headless', 'log', 'format', 'token', 'office'];

/**
 * The key names the schema declares, as a plain nested object.
 *
 * ⚠ Taken from the SCHEMA, not written out here, so it cannot drift: a key
 * added to `CompanyConfigSchema` tomorrow is addressable from the environment
 * the same day, with nothing to remember.
 *
 * ⚠ Lazy and failure-tolerant: this runs before `safeParse`, so throwing here
 * would turn a config problem into a crash somewhere that cannot explain
 * itself. An empty map degrades to the old split-on-every-underscore
 * behaviour — and `test/env-override.test.ts` asserts the map is NOT empty, so
 * the degraded path is caught by a gate instead of rotting in production.
 */
let schemaShape: Record<string, unknown> | undefined;
function knownKeys(): Record<string, unknown> {
  if (schemaShape === undefined) {
    try {
      schemaShape = CompanyConfigSchema.parse({}) as Record<string, unknown>;
    } catch {
      schemaShape = {};
    }
  }
  return schemaShape;
}

/**
 * Which config path does this environment variable address? `undefined` = none.
 *
 * `AGENTCO_RUNTIME_PUBLIC_URL` → `['runtime', 'public_url']`
 * `AGENTCO_RUNTIME_PORT`       → `['runtime', 'port']`
 *
 * ⚠ LONGEST MATCH WINS at every level. With both `public` and `public_url`
 * declared, the greedy choice is the only one that can address the longer key
 * at all — the shorter one is still reachable by spelling fewer segments.
 *
 * ⚠ A segment that matches nothing falls back to the old behaviour verbatim:
 * the remaining parts become the path as-is. That is what keeps this change
 * incapable of altering a variable that already worked — it can only bring a
 * dead one to life. `test/env-override.test.ts` states that as a rule.
 */
export function configPathForEnv(name: string): string[] | undefined {
  if (!name.startsWith(ENV_PREFIX)) return undefined;
  const parts = name.slice(ENV_PREFIX.length).toLowerCase().split('_');
  if (!parts[0] || NOT_CONFIG.includes(parts[0])) return undefined;

  const out: string[] = [];
  let node: unknown = knownKeys();
  let i = 0;
  while (i < parts.length) {
    const keys =
      node && typeof node === 'object' && !Array.isArray(node) ? Object.keys(node) : [];
    let hit: string | undefined;
    for (let j = parts.length; j > i; j--) {
      const candidate = parts.slice(i, j).join('_');
      if (keys.includes(candidate)) {
        hit = candidate;
        i = j;
        break;
      }
    }
    if (hit === undefined) {
      out.push(...parts.slice(i));
      break;
    }
    out.push(hit);
    node = (node as Record<string, unknown>)[hit];
  }
  return out;
}

/** AGENTCO_RUNTIME_CONCURRENCY=8 -> config.runtime.concurrency = 8 */
function applyEnvOverrides(cfg: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const pathParts = configPathForEnv(key);
    if (!pathParts?.length) continue;

    let cursor: Record<string, unknown> = cfg;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i]!;
      if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = pathParts[pathParts.length - 1]!;
    const num = Number(value);
    cursor[leaf] =
      value === 'true' ? true : value === 'false' ? false : Number.isFinite(num) && value.trim() !== '' ? num : value;
  }
}

/**
 * The OS's own language hints, in the order they outrank each other.
 *
 * ⚠ `Intl` is in the list because the POSIX variables are NOT SET ON WINDOWS.
 * Reading only `LANG`/`LC_*` would hand every Windows user `en` regardless of
 * their machine — the "correct on the dev's box" failure class this project
 * has now walked into five times. `Intl.DateTimeFormat().resolvedOptions()`
 * reads the real OS setting on Windows, macOS and Linux alike.
 *
 * `AGENTCO_LANGUAGE` goes first for the same reason it wins over company.yaml
 * everywhere else (`applyEnvOverrides`): environment > file.
 */
export function osLocaleHints(): (string | undefined)[] {
  return [
    process.env['AGENTCO_LANGUAGE'],
    process.env['LC_ALL'],
    process.env['LC_MESSAGES'],
    process.env['LANG'],
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];
}

/**
 * 🔴 PICK THE INTERFACE LANGUAGE BEFORE THE FIRST SENTENCE IS PRINTED.
 *
 * Measured 14/09 on a packed npm install: `company.yaml` said `language: en`,
 * `agentco start` answered in English — and `status`, `stop` and `doctor`
 * answered in Vietnamese. The locale was only ever set inside
 * `loadCompanyConfig`, and those three commands never load the config: they
 * ask the daemon, or look at a folder. So they printed in the module default,
 * which is `vi` for the reason given in `i18n/index.ts`. Invisible on the
 * developer's machine, where both answers are readable; the first thing an
 * international npm user sees.
 *
 * Two cases, with the SAME fallbacks their twins already use:
 *   · a company exists  ⇒ its `language`, and absent means `vi` — exactly
 *     `loadCompanyConfig` below, so an existing install is not re-languaged
 *   · no company yet    ⇒ the OS hints, fallback `en` — exactly `agentco init`,
 *     because there is nothing to preserve (`doctor` before `init`)
 *
 * Only the `language` field is read, so this cannot fail where the command
 * itself would not: ⚠ a company.yaml that does not parse leaves the
 * existing-company fallback in place and is reported by whichever command
 * actually loads it — this function choosing a language is not the place to
 * announce a broken file.
 */
export function adoptInterfaceLocale(dir: string): void {
  const file = companyPaths(dir).configFile;
  if (!fs.existsSync(file)) {
    setLocale(resolveLocale(osLocaleHints(), 'en'));
    return;
  }
  let raw: Record<string, unknown> = {};
  try {
    const parsed = readYaml(file);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    /* unparsable — see the ⚠ above; the loading command reports it */
  }
  applyEnvOverrides(raw);
  const language = typeof raw['language'] === 'string' ? raw['language'] : undefined;
  setLocale(resolveLocale([language], 'vi'));
}

export function loadCompanyConfig(dir: string, overrides: Record<string, unknown> = {}): CompanyConfig {
  const pp = companyPaths(dir);
  if (!fs.existsSync(pp.configFile)) {
    throw new Error(t('cfg.noCompanyYaml', { dir }));
  }
  const raw = readYaml(pp.configFile) as Record<string, unknown>;
  applyEnvOverrides(raw);
  deepMerge(raw, overrides);

  const parsed = CompanyConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(t('cfg.badCompanyYaml', { detail: formatZodError(parsed.error) }));

  /**
   * Interface language, resolved once per config load. → `src/i18n/`
   *
   * A module-level locale is the right shape here and not a shortcut: agentco
   * is one person on one machine, so there is no second user to disagree with.
   * A per-request locale would be plumbing that can only ever carry one value.
   *
   * ⚠ Fallback `vi`, not the OS hint. Every company.yaml already on disk means
   * Vietnamese even though it says nothing, so reading the OS here would
   * re-language existing installs on upgrade. `agentco init` is where the OS
   * hint belongs — it has nothing to preserve.
   *
   * ⚠ This value is for the INTERFACE ONLY and must never be passed to a prompt
   * builder. See `CompanyConfigSchema.language`.
   */
  setLocale(resolveLocale([parsed.data.language], 'vi'));

  /**
   * The Claude Code override, adopted on the SAME line as the locale and for the
   * same reason. → `core/claude-code.ts`
   *
   * ⚠ HERE rather than in `Company.open`, because `Company` is not the only
   * caller: `updateModels`, `updateLanguage` and `updateName` all reload the
   * config, and a hook on one door would leave the others carrying a stale path
   * after the user edits `claude_path` and saves. One function that everybody
   * already goes through has no such gap.
   */
  setClaudePath(parsed.data.claude_path);

  return parsed.data;
}

/**
 * Load one office.
 *
 * Does NOT throw when there are no employees — a freshly created office is valid
 * and empty, and that is normal (SPEC-offices.md §3). v0 threw here, which is
 * why "a clean starting point" could not coexist with it.
 */
export function loadOffice(
  companyDir: string,
  companyConfig: CompanyConfig,
  officeId: string,
): LoadedOffice {
  const dir = path.join(companyPaths(companyDir).offices, officeId);
  const pp = officePaths(dir);

  const rawCfg = readYaml(pp.configFile) as Record<string, unknown>;
  /**
   * 🔴 THE DIRECTORY NAME IS THE IDENTITY — it OVERWRITES whatever the file says.
   * → `office.ts §roleTemplate` · `company.ts §officeTemplate`
   *
   * ┌──────────────────────────────────────────────────────────────────────────
   * │ MEASURED 09/09: AN EMPLOYEE NAMED "1" WAS CREATED AND NEVER APPEARED.
   * │
   * │ The templates wrote `id: ${id}` unquoted, so a name that slugs to a YAML
   * │ SCALAR stops being a string the moment it is read back: `1` → number,
   * │ `true`/`false` → boolean, `null` → null, `0x1f` → number. `isSafeId`
   * │ passes all of them — it guards the character set, not the parser's
   * │ opinion of them. The schema then rejected the file, and the office
   * │ carried on without it: a role SKIPPED WITH A WARNING nobody sees on
   * │ stderr, an office THROWN OUT entirely. The user saw a create button that
   * │ worked and a diagram that stayed empty.
   * │
   * │ ⚠ `=`, NOT `??=`. The fallback only fired when the key was absent, which
   * │ is exactly the case that was never broken. And there is no second
   * │ identity to respect: `roles/<id>.yaml` and `offices/<id>/` ARE the id
   * │ everywhere else — `dropAgent`, `archiveAgent`, `skillFileFor` all build
   * │ the path from it. A file whose inner `id` disagreed with its own name
   * │ was already unreachable.
   * │
   * │ ⇒ This also SELF-HEALS the files already on disk: the templates are
   * │ quoted now, but nobody has to go and fix what they wrote yesterday.
   * └──────────────────────────────────────────────────────────────────────────
   */
  rawCfg['id'] = officeId;
  const parsedCfg = OfficeConfigSchema.safeParse(rawCfg);
  if (!parsedCfg.success) {
    throw new Error(t('cfg.badOfficeYaml', { office: officeId, detail: formatZodError(parsedCfg.error) }));
  }
  const config = parsedCfg.data;

  // ── roles
  const roles = new Map<string, Role>();
  const archivedRoles = new Set<string>();
  if (fs.existsSync(pp.roles)) {
    for (const file of fs.readdirSync(pp.roles).sort()) {
      if (!/\.(ya?ml)$/i.test(file)) continue;
      const roleRaw = readYaml(path.join(pp.roles, file)) as Record<string, unknown>;
      // ⚠ The FILE NAME is the identity, and it overwrites what the file says.
      // → the box on `rawCfg['id']` above for the employee named "1".
      roleRaw['id'] = file.replace(/\.(ya?ml)$/i, '');
      const r = RoleSchema.safeParse(roleRaw);
      if (!r.success) {
        // One broken role file must NOT take the whole office down — the
        // "stable" criterion. Skip it, warn, and the canvas shows a red
        // "role not found" node.
        process.emitWarning(
          `offices/${officeId}/roles/${file} is malformed and was skipped:\n${formatZodError(r.error)}`,
        );
        continue;
      }
      roles.set(r.data.id, r.data);
      if (r.data.archived) archivedRoles.add(r.data.id);
    }
  }

  // ── charter: in EVERY employee's cached prefix, so it must be small and stable
  let charter = '';
  const charterFile = path.join(dir, config.charter_file);
  if (fs.existsSync(charterFile)) {
    /**
     * `stripFrontmatter` STAYS even though the charter is now plain markdown
     * (it left `knowledge/` — see SPEC-library.md §17). The reason is no longer
     * "strip a node's metadata" but REGRESSION DEFENCE: an old backup, an office
     * folder someone zipped up last month, or a half-finished migration can all
     * bring a file that still has frontmatter here. Without stripping, ~40
     * tokens of `id/type/tags/confidence` slip into every employee's prefix
     * cache, forever, to tell the model things it cannot use.
     */
    charter = stripFrontmatter(fs.readFileSync(charterFile, 'utf8'));
    const tokens = estimateTokens(charter);
    if (tokens > companyConfig.budgets.charter_tokens) {
      process.emitWarning(
        `Charter of office "${officeId}" is ${tokens} tokens, over the ${companyConfig.budgets.charter_tokens} ceiling. ` +
          `Truncated. The charter sits in the prefix cache of EVERY agent — keep it short.`,
      );
      charter = truncateToTokens(charter, companyConfig.budgets.charter_tokens);
    }
  }

  // ── the assistant's skills: user-editable, and empty is valid
  let assistantSkills = '';
  if (fs.existsSync(pp.assistantSkills)) {
    assistantSkills = fs.readFileSync(pp.assistantSkills, 'utf8').trim();
    const tokens = estimateTokens(assistantSkills);
    if (tokens > companyConfig.budgets.assistant_skills_tokens) {
      process.emitWarning(
        `skills/assistant.md of "${officeId}" is ${tokens} tokens, over the ` +
          `${companyConfig.budgets.assistant_skills_tokens} ceiling. Truncated. This block sits in the ` +
          `prefix of EVERY turn of chat with the assistant — each spare line is a tax charged all shift.`,
      );
      assistantSkills = truncateToTokens(assistantSkills, companyConfig.budgets.assistant_skills_tokens);
    }
  }

  return {
    id: officeId,
    dir,
    paths: pp,
    config,
    company: companyConfig,
    companyDir,
    roles,
    archivedRoles,
    charter,
    assistantSkills,
    knowledgeVersion: readKnowledgeVersion(pp),
  };
}

/**
 * A role's skill file — a path RELATIVE to the office folder.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ READING AND WRITING MUST GO THROUGH THIS EXACT FUNCTION.                  │
 * │                                                                           │
 * │ Fixed bug: the interface WROTE to `skills/<id>.md` (`describePrompt`'s    │
 * │ fallback path) while `loadSkill` only READ what `role.skills` declared.   │
 * │ An employee created from the interface has `skills: {}`, so the user      │
 * │ pressed Save → the server wrote a real file → reading it back gave        │
 * │ empty. What they had just written vanished, even after a reload, with     │
 * │ no error at all.                                                          │
 * │                                                                           │
 * │ Two different paths for one thing is the quietest way to lose someone's   │
 * │ work — the same class of bug as `cheap`→`eco` with no alias.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Order: declared in yaml → the `<id>.<level>.md` convention if present on disk
 * → `<id>.md`.
 */
export function skillFileFor(office: LoadedOffice, role: Role): string {
  const level: SkillLevel = role.skill_level;
  const declared = role.skills[level] ?? role.skills['medium'] ?? role.skills['short'];
  if (declared) return declared;

  // v0 offices named these by level (`skills/writer.medium.md`). Respect the
  // file already on disk; do not spawn a second one beside it.
  const byLevel = `skills/${role.id}.${level}.md`;
  if (fs.existsSync(path.join(office.dir, byLevel))) return byLevel;

  return `skills/${role.id}.md`;
}

/** Read the skill content for the role's chosen level. Empty is valid. */
export function loadSkill(office: LoadedOffice, role: Role): string {
  const rel = skillFileFor(office, role);
  const file = path.join(office.dir, rel);
  if (!fs.existsSync(file)) {
    // Only warn when a file was EXPLICITLY DECLARED and is missing — that is a
    // config error. The fallback path having no file yet is the normal state of
    // a new employee: skills default to EMPTY.
    const declared = role.skills[role.skill_level] ?? role.skills['medium'] ?? role.skills['short'];
    if (declared) process.emitWarning(`Role "${role.id}": skill file ${declared} not found`);
    return '';
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function readKnowledgeVersion(pp: OfficePaths): number {
  const file = path.join(pp.knowledge, 'version.json');
  if (!fs.existsSync(file)) return 1;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: number };
    return typeof v.version === 'number' ? v.version : 1;
  } catch {
    return 1;
  }
}

/**
 * Bumping the knowledge version changes every role's cacheKey, so every prefix
 * has to be re-cached. Deliberately NOT called automatically on each node write:
 * batched instead (Librarian, M1).
 */
export function bumpKnowledgeVersion(pp: OfficePaths): number {
  const next = readKnowledgeVersion(pp) + 1;
  fs.mkdirSync(pp.knowledge, { recursive: true });
  fs.writeFileSync(path.join(pp.knowledge, 'version.json'), JSON.stringify({ version: next }, null, 2));
  return next;
}

// ─────────────────────────────────────────────────────────── helpers

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Drop the leading YAML block, keep the body. No frontmatter ⇒ returned unchanged. */
function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER, '').trim();
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof target[k] !== 'object' || target[k] === null) target[k] = {};
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
}

function formatZodError(err: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return err.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

export type { CompanyPaths, OfficePaths };
