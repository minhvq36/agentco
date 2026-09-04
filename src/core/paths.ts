/**
 * Directory layout: a COMPANY holds many OFFICES.
 *
 * → docs/SPEC-offices.md §2
 *
 * ```
 * company/
 * ├─ company.yaml        shared config
 * ├─ logs/usage.jsonl    cost for the WHOLE company, every line has an office column
 * ├─ .state/             daemon.json, secrets.json
 * └─ offices/<id>/       an office — SELF-CONTAINED, zipping it up makes a template
 *    ├─ office.yaml · layout.json · roles/ · skills/
 *    ├─ knowledge/{shared,agents}/ · library/{files,text}/
 *    └─ artifacts/ · .state/tasks/
 * ```
 *
 * The dot in `.state/` is a MECHANISM, not a naming convention: `Grep`/`Glob`
 * don't walk into hidden directories (measured). What an agent must be able to
 * find (`library/`, `artifacts/`, `knowledge/`) sits outside it; what an agent
 * must not stumble into (`tasks/` — each other's plans, logs, receipts) sits
 * inside it. → `OfficePaths.tasks`
 *
 * Why cost lives at the company level while knowledge lives at the office
 * level: money is what the user wants to see TOTALED (one Claude bill), while
 * knowledge sits in the prefix cache and so has to live in the narrowest scope
 * possible. → SPEC-offices.md §2
 *
 * The container constraint (docs/SPEC-cli.md §4) still holds: no hard-coded
 * absolute paths, all state under a single directory so mounting one volume is
 * enough.
 */

import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { t } from '../i18n/index.js';

export interface CompanyPaths {
  root: string;
  configFile: string;
  offices: string;
  logs: string;
  usageLog: string;
  /**
   * Every credential-refresh attempt, one line each. Separate from
   * `usageLog` because it answers a different question and is read at a
   * different time: cost is read on purpose, this is read only after
   * something broke — and then it is the only witness there is.
   *
   * It exists because of 09/03: three accounts across three services were
   * refused within 4 seconds, and reconstructing why had to be done from
   * `expires_at` arithmetic, because not one refresh attempt had ever been
   * recorded. → `oauth-routes.ts §logRefresh`
   */
  refreshLog: string;
  state: string;
  daemonFile: string;
  secretsFile: string;
}

export interface OfficePaths {
  root: string;
  configFile: string;
  layoutFile: string;
  roles: string;
  skills: string;
  assistantSkills: string;
  knowledge: string;
  knowledgeShared: string;
  knowledgeAgents: string;
  knowledgeInbox: string;
  knowledgeIndex: string;
  artifacts: string;
  /**
   * The document cabinet — files the USER brought in. → docs/SPEC-library.md
   *
   * ⚠ Must NOT sit under `.state/` or any directory starting with a dot:
   * `Grep` skips hidden directories when walking (measured — SPEC-library.md
   * §2.1), so hiding it there would silently kill the whole retrieval
   * mechanism.
   */
  library: string;
  libraryFiles: string;
  libraryText: string;
  /**
   * Plans · logs · receipts. **Sits BEHIND the dot, and that's the whole
   * mechanism.**
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ THE MIRROR IMAGE OF THE RULE RIGHT ABOVE, RUNNING ON THE SAME MEASURED   │
   * │ FACT.                                                                    │
   * │                                                                         │
   * │ `library/` must NOT be hidden because an agent MUST be able to `Grep`   │
   * │ it. `tasks/` is the opposite: an agent must NOT see it, so it has to be │
   * │ hidden.                                                                 │
   * │                                                                         │
   * │ Measured on 08/20 (`P-260820-2219-5ltb`): a worker's `cwd` is the whole  │
   * │ office directory, so a stray `nguoi-gop` Globbed the entire tree clean   │
   * │ and READ `P-…plan.json` and `P-…log.jsonl`. The log file held another    │
   * │ task's receipt ⇒ a backdoor around the protocol *"receipts are capped   │
   * │ at 800 tokens — the Assistant never reads a worker's transcript"*. It    │
   * │ could read the whole DAG too.                                          │
   * │                                                                         │
   * │ Blocked by STRUCTURE, not by discipline: `Grep`/`Glob` don't walk into   │
   * │ directories starting with a dot (measured — SPEC-library.md §2.1). No    │
   * │ `canUseTool` needed, no denylist needed, nobody has to remember          │
   * │ anything.                                                               │
   * │                                                                         │
   * │ ⚠ This is NOT a security wall — `Read` with an explicit path still opens │
   * │ it. It blocks the actual path that happens: **wandering off and         │
   * │ stumbling into it.**                                                    │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
  tasks: string;
  planIndex: string;
  state: string;
  connectors: string;
}

export function resolveCompanyDir(explicit?: string): string {
  const dir = explicit ?? process.env['AGENTCO_COMPANY_DIR'] ?? path.join(process.cwd(), 'company');
  return path.resolve(dir);
}

export function companyPaths(companyDir: string): CompanyPaths {
  const p = (...s: string[]) => path.join(companyDir, ...s);
  return {
    root: companyDir,
    configFile: p('company.yaml'),
    offices: p('offices'),
    logs: p('logs'),
    usageLog: p('logs', 'usage.jsonl'),
    refreshLog: p('logs', 'oauth-refresh.jsonl'),
    state: p('.state'),
    daemonFile: p('.state', 'daemon.json'),
    secretsFile: p('.state', 'secrets.json'),
  };
}

export function officePaths(officeDir: string): OfficePaths {
  const p = (...s: string[]) => path.join(officeDir, ...s);
  return {
    root: officeDir,
    configFile: p('office.yaml'),
    layoutFile: p('layout.json'),
    roles: p('roles'),
    skills: p('skills'),
    assistantSkills: p('skills', 'assistant.md'),
    knowledge: p('knowledge'),
    knowledgeShared: p('knowledge', 'shared'),
    knowledgeAgents: p('knowledge', 'agents'),
    knowledgeInbox: p('knowledge', '_inbox'),
    knowledgeIndex: p('knowledge', 'index.json'),
    artifacts: p('artifacts'),
    library: p('library'),
    libraryFiles: p('library', 'files'),
    libraryText: p('library', 'text'),
    tasks: p('.state', 'tasks'),
    planIndex: p('.state', 'tasks', 'index.json'),
    state: p('.state'),
    connectors: p('connectors'),
  };
}

export function officeDir(company: CompanyPaths, officeId: string): string {
  return path.join(company.offices, officeId);
}

export function ensureCompanyDirs(pp: CompanyPaths): void {
  for (const dir of [pp.root, pp.offices, pp.logs, pp.state]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureOfficeDirs(pp: OfficePaths): void {
  for (const dir of [
    pp.root,
    pp.roles,
    pp.skills,
    pp.knowledge,
    pp.knowledgeShared,
    pp.knowledgeAgents,
    pp.knowledgeInbox,
    pp.artifacts,
    pp.library,
    pp.libraryFiles,
    pp.libraryText,
    pp.tasks,
    pp.state,
    pp.connectors,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function isCompanyDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'company.yaml'));
}

/** List of office IDs, in directory-name order. Empty is valid — see §3. */
export function listOfficeIds(pp: CompanyPaths): string[] {
  if (!fs.existsSync(pp.offices)) return [];
  return fs
    .readdirSync(pp.offices, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/**
 * Both office IDs and role IDs get used as DIRECTORY/FILE NAMES, and both come
 * from text the user typed. Locked down in one place.
 */
export function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id);
}

/**
 * A display name as the user typed it: strip extra whitespace at both ends
 * AND in the middle.
 *
 * Collapsing interior whitespace is the part that's easy to forget. "Content "
 * and "Content" look identical in the office picker but are two different
 * strings — the user would see two identical-looking rows and not know which
 * one they're opening.
 */
export function normalizeName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * The key used to compare names for duplicates. Deliberately reuses `slugId`:
 * two offices must not have the same name, using exactly the meaning the
 * system already uses to name their directories.
 *
 * That gives a SINGLE definition of "duplicate": "Content", "content ", "Noi
 * Dung" all reduce to `noi-dung`. Comparing raw strings instead would make
 * `createOffice` (compares by slug) and `rename` (compares by string)
 * disagree, and renaming would become a backdoor for creating exactly the
 * duplicate that creation-time blocked.
 */
export function nameKey(input: string): string {
  const name = normalizeName(input);
  /**
   * ⚠ FALLS BACK TO THE NAME ITSELF when the slug is empty — otherwise EVERY
   * non-Latin name would share the key `""`, and `assertNameFree` would treat
   * 会计部 and 人力资源 as **the same name**. Measured 08/22: Chinese, Japanese,
   * Korean, Thai, Russian, Arabic, Greek all reduce to `""`.
   */
  return slugId(name) || name.toLowerCase();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DIRECTORY NAMES — `slugId` ISN'T ENOUGH, AND THAT'S A WALL BLOCKING AN    │
 * │ ENTIRE MARKET. (fixed 08/22)                                             │
 * │                                                                          │
 * │ `slugId` strips combining marks and keeps `[a-z0-9]`. For Vietnamese     │
 * │ it's perfect. For any NON-Latin script it returns an **empty string** —  │
 * │ `NFD` can't decompose Han/Kana/Hangul/Thai/Cyrillic into ASCII:          │
 * │                                                                          │
 * │   "会计部" → ""    "経理部" → ""    "회계팀" → ""                          │
 * │   "แผนกบัญชี" → ""  "Бухгалтерия" → ""  "Λογιστήριο" → ""                  │
 * │                                                                          │
 * │ The OLD consequence: `isSafeId('')` false → `createOffice` throws        │
 * │ *"An office name needs at least one letter or digit"*. Data wasn't       │
 * │ corrupted (the guard did its job), but a user in China typing 会计部     │
 * │ got told to *"use letters"* — when to them, that IS letters. No path      │
 * │ forward. An entire market stalls at the office-creation screen.          │
 * │                                                                          │
 * │ ⚠ WHY NOT LET UNICODE STRAIGHT INTO THE DIRECTORY NAME — sounds          │
 * │ reasonable but it's a trap: macOS normalizes filenames to NFD while      │
 * │ Linux/Windows keep NFC. The same name types out to two different byte    │
 * │ strings depending on the machine, so `id` alone stops matching the        │
 * │ moment an office gets zipped from one machine to another — exactly what  │
 * │ the promise "zip it up and it runs on another machine" forbids.          │
 * │                                                                          │
 * │ ⇒ Fall back to a **stable ASCII id derived from the name itself**. The    │
 * │   directory looks meaningless (`vp-3f8a1c`) but: the real name lives in   │
 * │   `office.yaml` right inside it, the UI never shows this id, and the      │
 * │   user has a button that opens the directory directly. The tradeoff      │
 * │   points the right way — an ugly name that opens beats a rejection with  │
 * │   no path forward.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function folderId(input: string, prefix = 'vp'): string {
  const name = normalizeName(input);
  const slug = slugId(name);
  if (slug) return slug;
  if (!name) return '';
  // Hash the name ITSELF: the same name always produces the same directory,
  // even after being deleted and recreated. `toLowerCase` so "会计部 " and
  // "会计部" don't become two different places.
  const h = createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 6);
  return `${prefix}-${h}`;
}

export function slugId(input: string): string {
  return input
    .normalize('NFD')
    // \p{M} = every combining mark. Don't hand-write the character class:
    // typing a combining mark directly inside [] makes it latch onto the
    // bracket itself and turns the regex into something else entirely —
    // while looking identical on screen.
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd') // i18n-allow-vietnamese: transliterating actual Vietnamese input, not UI text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 40);
}

/**
 * Blocks path traversal. An artifact path comes from the LLM, so it can't be
 * trusted. Returns a checked absolute path, or throws.
 */
export function safeJoin(base: string, relative: string): string {
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(t('error.pathOutside', { path: relative }));
  }
  return target;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A FOURTH KIND OF INPUT: **A WEB ADDRESS**. (bug reported by the user      │
 * │ 08/31)                                                                   │
 * │                                                                          │
 * │ User: *"look up the repo modelcontextprotocol/servers…"* → the Assistant  │
 * │ copies the URL into `inputs` (exactly as `ASSISTANT_CORE` instructs) →    │
 * │ blocks the whole plan: *"needs to read … but that file doesn't exist"*.   │
 * │ Measured: `resolveInput` turns `https://github.com/x` into                │
 * │ **`D:\vp\https:\github.com\x`** — a garbage path, and then `existsSync`   │
 * │ correctly says it doesn't exist.                                        │
 * │                                                                          │
 * │ ⚠⚠ THIRD TIME the same failure class hits the same function: 08/22 blind  │
 * │ to absolute paths · 08/26 blind to arm names · 08/31 blind to URLs. All   │
 * │ three times the Assistant **got blocked for following instructions**,    │
 * │ and all three times the bug sat at the VALIDATION LAYER.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ 🔴 WHY ONLY ACCEPT IT WITH `http://` / `https://` ═══
 *
 * The user asked directly: *"sometimes a user skips http and just types a
 * domain like facebook.com, which makes classification even harder"*. True —
 * and the answer is **don't guess**, because the two mistakes are NOT
 * symmetric:
 *
 * | wrong guess | consequence |
 * |---|---|
 * | a real URL treated as a file | the plan gets blocked — **noisy, fixable**, retyping it is all it takes |
 * | a real filename treated as a URL | the validation gate **silently turns off** for that input ⇒ the worker runs, costs money, then breaks far from the actual cause |
 *
 * ⇒ When unsure, pick the **noisy** side. → [[agentco-safe-default-direction]]
 *
 * And `facebook.com` **genuinely can't be told apart**: `report.md`,
 * `data.csv`, `v1.2` also have a dot. A "looks like a domain" heuristic would
 * misfire on a real filename, which is exactly turning off the gate for the
 * very thing it exists to guard.
 *
 * ⚠ A DELIBERATE consequence: typing bare `facebook.com` still gets blocked as
 * before. That's an **unpatched** case, not a patched one — and the error
 * message can still correctly say no file by that name exists, so the user
 * has a path to fix it (type the full `https://`).
 */
export function isUrlInput(p: string): boolean {
  return /^https?:\/\/\S+$/i.test(p.trim());
}

/**
 * A task's INPUT → an absolute path to open. `undefined` = invalid.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE RULE, ONE PLACE. This function exists because THREE places had        │
 * │ already reinvented it.                                                   │
 * │                                                                          │
 * │ `inputs` has TWO kinds of paths, and before 08/22 the code only knew      │
 * │ one:                                                                     │
 * │                                                                          │
 * │   · RELATIVE to the office directory — a document in the cabinet, a       │
 * │     previous task's output. `safeJoin` locks these in, and must keep      │
 * │     doing so.                                                           │
 * │   · ABSOLUTE, outside the office — something the user typed straight     │
 * │     into the chat box (`D:\Downloads\…`, `/home/an/photo`). Valid since   │
 * │     the day `Bash` shipped enabled by default.                          │
 * │                                                                          │
 * │ Three places had reinvented this distinction: `Scheduler.validate`,       │
 * │ `Scheduler.missingInputs`, and the "did the result come out stale" check  │
 * │ in `Office`. All three wrote exactly HALF of it —                        │
 * │ `try { safeJoin } catch { treat as missing }` — so all three were         │
 * │ equally blind to the second kind. Measured 08/22: a user typed a          │
 * │ directory that genuinely exists on their machine and got blocked at       │
 * │ planning time with *"no task produces it"*.                              │
 * │                                                                          │
 * │ Patching three places with three fixes just invites the bug back at a     │
 * │ fourth. One function makes the fourth place correct automatically.       │
 * │                                                                          │
 * │ ⚠ Distinguished by `isAbsolute`, NOT by "did safeJoin throw". A relative   │
 * │ path that climbs outside (`../../etc/passwd`) also makes safeJoin throw,  │
 * │ but that's a traversal attempt — it must return `undefined`, not fall    │
 * │ into the "outside the office" branch and get `existsSync`'d against the   │
 * │ daemon's `cwd`, a root that has nothing to do with anyone.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function resolveInput(
  officeDir: string,
  p: string,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A THIRD KIND OF PATH: **AN ARM'S NAME**. (bug reported by the user       │
   * │ 08/26)                                                                   │
   * │                                                                          │
   * │ User typed *"List the songs in Musics"*. The Assistant did EXACTLY what  │
   * │ `ASSISTANT_CORE` instructs — *"the path the user typed is exact, copy it │
   * │ verbatim into `inputs`"* — so it wrote `inputs: ["Musics"]`. Then         │
   * │ `validate` looked for a file named `Musics` inside the office, found      │
   * │ none, and blocked the whole plan: *"that file doesn't exist, and no       │
   * │ task produces it"*.                                                     │
   * │                                                                          │
   * │ Three turns in a row, and the user was right: *"you already have an      │
   * │ MCP for that"*. An arm named **Musics** points at `D:\…\Musics` and       │
   * │ sits right in that very worker's roster. That string was resolvable —    │
   * │ we just hadn't tried.                                                    │
   * │                                                                          │
   * │ ⚠ This is the SECOND time the same failure class hits the same function:  │
   * │ 08/22 it was blind to absolute paths outside the office; today it's       │
   * │ blind to an arm's name. Both times, the Assistant **got blocked for       │
   * │ following instructions**, and both times the bug sat at the VALIDATION    │
   * │ LAYER, not the planning layer. Fix it here, not in the prompt: one more    │
   * │ instruction would lose to the roster line itself reading                  │
   * │ `Musics (shortcut to …)`.                                                │
   * │ → [[agentco-prompt-rules-lose-to-examples]]                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * A normalized (lowercased) key → the REAL directory. See `catalog.ts §armDirIndex`.
   */
  armDirs?: Record<string, string>,
): string | undefined {
  /**
   * 🔴 AN EMPTY STRING POINTS AT THE OFFICE DIRECTORY ITSELF. (spotted and
   * measured 08/31)
   *
   * `safeJoin(officeDir, '')` returns **exactly `officeDir`**, and that
   * directory always exists ⇒ `existsOnDisk` says YES ⇒ the input validation
   * gate **silently passes it**, and a worker receives an input pointing at
   * the entire office.
   *
   * This case is genuinely reachable: `TaskIOSchema.path` is `z.string()`
   * **with no `.min(1)`**, so a `{"kind":"file","path":""}` produced by the
   * model sails through the schema normally.
   *
   * ⚠ Patched here rather than tightening the schema: tightening the schema
   * **throws out the whole plan** over one empty field, whereas here it just
   * becomes "invalid input" and the user gets the error message that was
   * already there.
   */
  if (!p.trim()) return undefined;

  // A web address is NOT a path. Return `undefined` instead of joining it into
  // the office directory — see `isUrlInput`.
  if (isUrlInput(p)) return undefined;
  if (path.isAbsolute(p)) return p;

  let inOffice: string | undefined;
  try {
    inOffice = safeJoin(officeDir, p);
  } catch {
    // A traversal attempt (`../../etc/passwd`) — must NOT fall through to the
    // arm branch and find something else there. It has to die right here, as
    // before.
    return undefined;
  }

  /**
   * ⚠ A FILE INSIDE THE OFFICE WINS. Only ask about an arm when it doesn't
   * exist.
   *
   * Otherwise an arm named `bao-cao` would swallow a real `bao-cao/` inside
   * the office — silently, and in exactly the place the user trusts most.
   */
  if (!armDirs || existsOnDisk(inOffice)) return inOffice;

  const hit = armDirs[p.replace(/[\\/]+$/, '').toLowerCase()];
  // No match ⇒ return the in-office path as before: the error message has to
  // talk about the place the user was thinking of, not a directory they never
  // mentioned.
  return hit ?? inOffice;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FORBIDDEN ZONES — a pure function that sits behind `officeJail`.          │
 * │ → docs/SPEC-arms.md §5d–§5f                                             │
 * │                                                                          │
 * │ ⚠ MEASURED 08/23 (`scripts/spike-secrets.ts`), a role with just the 7      │
 * │ default tools, NO shell:                                                │
 * │                                                                          │
 * │   A · read `company/.state/secrets.json`  → 🔴 COULD READ, verbatim copy │
 * │   B · write `roles/<itself>.yaml`          → 🔴 COULD WRITE, via `Write`  │
 * │                                                                          │
 * │ Case B is heavier than it looks: `Write` is a WHOLE-FILE OVERWRITE, so a  │
 * │ worker doesn't *edit* its own role — it **replaces** the role, granting   │
 * │ itself `tools:`, `secrets:`, `mcp:`. No receipt, no log, not one line.    │
 * │ Not effective immediately (no `fs.watch`) but LIVES ON DISK until          │
 * │ `reload()`.                                                             │
 * │                                                                          │
 * │ Why the old `officeJail` missed both: it asked exactly ONE question —     │
 * │ *"does this go outside the office directory"*. The company's `.state/`    │
 * │ sits outside, but it **only matched WRITE tools**, while case A was READ. │
 * │ `roles/` sits INSIDE, so it was let through, by design. One question,     │
 * │ two holes.                                                              │
 * │                                                                          │
 * │ ⇒ Two zones, three rules, and the boundary is DELIBERATELY narrow:        │
 * │                                                                          │
 * │   `secrets`  `.state/` (company AND office)     → bans BOTH READ AND WRITE│
 * │   `config`   roles· skills· connectors· *.yaml· layout.json → bans WRITE  │
 * │   `outside`  outside the office directory        → bans WRITE (old rule)  │
 * │                                                                          │
 * │ ⚠⚠ WHAT'S DELIBERATELY NOT BLOCKED matters JUST AS MUCH as what is:       │
 * │ `artifacts/`, `knowledge/`, `library/` stay wide open. The knowledge      │
 * │ store is where a worker WRITES lessons — blocking it kills the learning    │
 * │ mechanism. A patch that blocks A+B but also blocks these is a regression   │
 * │ in the OPPOSITE direction, and a much quieter one, because nobody checks    │
 * │ something that still appears to work. A test guards exactly this.        │
 * │                                                                          │
 * │ ⚠ An unplanned bonus: banning reads under `<office>/.state/` also seals    │
 * │ the gap noted in `OfficePaths.tasks` — *"NOT a security wall: `Read` with  │
 * │ an explicit path still opens it"*. Now it's an actual wall.               │
 * │                                                                          │
 * │ ⚠ THE BOUNDARY HAS TO BE SPOKEN: this function only reaches tools that     │
 * │ carry a PATH IN A NAMED FIELD. `Bash` buries a path inside a command       │
 * │ string ⇒ it still routes around this. The honest claim is "NARROWED,       │
 * │ NOT CLOSED" — don't write "sealed the hole", that would be the fourth       │
 * │ broken promise after `canUseTool`, `safeJoin`, and §8·0.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type GuardedZone = 'secrets' | 'config' | 'outside' | 'browser';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `.playwright-mcp` — THE DOT BLOCKS **BEING FOUND**, NOT **BEING READ**. │
 * │ (user asked 08/30, measurement found the gap)                            │
 * │                                                                          │
 * │ > *"I'm worried it wanders into .playwright-mcp or .state/browser (I      │
 * │ >  thought that one was locked down hard)"*                              │
 * │                                                                          │
 * │ The second half was right: `.state/browser/profile` (**506 MB** of        │
 * │ cookies + login sessions) is hard-locked, because the `.state` check       │
 * │ sits **before** the line that lets `read` through. The first half had a    │
 * │ gap: `.playwright-mcp` is a **sibling** of `.state`, not nested under it   │
 * │ ⇒ `guardedZone('read')` returned `undefined` ⇒ typing the exact path       │
 * │ would read it.                                                          │
 * │                                                                          │
 * │ A leading dot **is a mechanism** — `Grep`/`Glob` don't walk into hidden    │
 * │ directories (measured). But that blocks *being found*, not *being read*,  │
 * │ and the two differ exactly at the point where a name leaks out (an error   │
 * │ log, text the user pastes in, an old artifact) — at which point the        │
 * │ barrier stops doing anything.                                           │
 * │                                                                          │
 * │ What lives in there isn't harmless: `redact.ts` exists because it could    │
 * │ read a **plaintext Facebook session token** (`fb_dtsg=…&__user=…`) inside  │
 * │ `console-*.log`. It strips the query string off URLs — **mitigation, not   │
 * │ a seal**, and it says so itself. Blocking reads to the whole directory is  │
 * │ a second, different-layer shield.                                       │
 * │                                                                          │
 * │ ⚠ Why its OWN zone instead of folding it into `secrets`: the `secrets`     │
 * │ error message talks about `.state` and credentials. Handing that message   │
 * │ to a worker that just touched a browser log is **the wrong-door failure**  │
 * │ — they go looking for credentials where there are none, and nobody tells   │
 * │ them the actual right move (re-take the snapshot).                        │
 * │                                                                          │
 * │ 🔴🔴 BLOCKING THE WHOLE DIRECTORY CUTS OFF THE BROWSER WORKER'S HANDS.     │
 * │ (the user asked at exactly the right moment, 08/30: *"does sealing the      │
 * │ .playwright-mcp gap affect a worker with the browser arm attached?"* —      │
 * │ YES, if blocked crudely.)                                               │
 * │                                                                          │
 * │ Measured the real directory: **20 `console-*.log` + 21 `page-*.yml`**.     │
 * │ The latter are **page snapshots** — what a worker READS to know what the   │
 * │ page currently shows, and `redact.ts §isConsoleLog` already says so:       │
 * │ *"Snapshots (`page-*.yml`) must not be touched — the worker reads them"*.  │
 * │ A guard that blocks those too makes the browser arm silently useless, at    │
 * │ exactly the moment the user needs it most.                              │
 * │                                                                          │
 * │ ⇒ Rule: **deny by default inside that directory, leave exactly one exit**. │
 * │ Deny-by-default because a new file type added later (trace, har, video)    │
 * │ is always going to be session residue, and with an allowlist a new one     │
 * │ gets blocked **automatically**; with a denylist a new one leaks through     │
 * │ **automatically**. → [[agentco-silent-allowlist]]                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const BROWSER_OUTPUT = '.playwright-mcp';

/** The single exit: page snapshots. Everything else in that directory is session residue. */
const isPageSnapshot = (p: string): boolean => /^page-[^\\/]*\.ya?ml$/i.test(path.basename(p));

/**
 * WHO is calling, and therefore which rules apply.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `arm` is NOT "write, but a little gentler" — it's a DIFFERENT ROLE.       │
 * │                                                                          │
 * │   `read`   a builtin read tool   → bans only `secrets`                   │
 * │   `write`  a builtin write tool  → bans `secrets` · `config` · `outside` │
 * │   `arm`    an MCP tool           → bans `secrets` · `config`, ALLOWS `outside` │
 * │                                                                          │
 * │ Why `arm` gets to go outside: that's the ENTIRE REASON it exists. Rule    │
 * │ §8·0 (user settled 08/22) states *"every path that WRITES outward must     │
 * │ go through an EXPLICIT tool/MCP — named, declarable, visible in the       │
 * │ log"*. Banning `outside` for `arm` would ban the exact well-behaved path   │
 * │ that rule just built, and the user would go back to `Bash` — which has     │
 * │ no boundary at all.                                                     │
 * │                                                                          │
 * │ But an arm's boundary is NOT "no boundary": it's constrained by the MCP    │
 * │ server itself, against the exact directory list the user has declared     │
 * │ (`roots` = `cwd` + `additionalDirectories`, measured 08/24). We're only    │
 * │ adding two zones the server would NEVER know are sensitive: the           │
 * │ credential store and config files.                                      │
 * │                                                                          │
 * │ ⚠ `arm` bans even READING config files, while the builtin `read` allows    │
 * │ it. Deliberate, and erring toward safety: at the point the hook runs we    │
 * │ only have a TOOL NAME, with no deterministic way to know whether           │
 * │ `mcp__x__foo` reads or writes — guessing from the name string is exactly   │
 * │ the class of nondeterminism ruled out in §5n ㉕. The cost of a false        │
 * │ positive here is zero: the builtin `Read` still reads `roles/*.yaml` as    │
 * │ before.                                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type GuardMode = 'read' | 'write' | 'arm';

/** Directories/files belonging to the `config` zone — relative to the OFFICE directory. */
const OFFICE_CONFIG = ['roles', 'skills', 'connectors', 'office.yaml', 'layout.json'];

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE COMPANY-LEVEL `config` ZONE — A GAP PATCHED 09/01, AND IT HAD       │
 * │ BEEN OPEN THE WHOLE TIME.                                                │
 * │                                                                          │
 * │ `OFFICE_CONFIG` resolves relative to the **OFFICE** directory, so          │
 * │ `company/company.yaml` (one level up) had **never been guarded**. For a    │
 * │ worker locked inside the office this was harmless — it can't reach that     │
 * │ far. But a role with a directory arm pointing at the folder containing      │
 * │ `company/` **can reach it**, and that's exactly the case `guardedZone`      │
 * │ exists to guard: the second barrier for anything OUTSIDE the office.       │
 * │                                                                          │
 * │ What it holds:                                                          │
 * │   `mcpServers` + `arms` — the shared roster. Writable ⇒ grant yourself an  │
 * │      arm.                                                               │
 * │   🔴 and since 08/31, the CLI DECLARATION lives here ⇒ writable ⇒ declare  │
 * │      `run: ["powershell","-c","{cmd}"]` ⇒ **arbitrary shell for a role      │
 * │      that had shell TURNED OFF**. Exactly the backdoor §16i warned about,   │
 * │      except I had assumed it was already guarded.                        │
 * │                                                                          │
 * │ ⚠ I wrote in three places that *"putting the declaration in                │
 * │ `company.yaml` means it inherits the §5f guard, 0 new mechanism"*.         │
 * │ **Wrong** — §5f guards OFFICE config. That guard is real, but it lives at   │
 * │ a different level.                                                      │
 * │ → [[agentco-rule-must-see-what-it-governs]] · [[agentco-spec-says-done]]  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `logs/` is deliberately NOT in here: the cost ledger is append-only and the
 * user can read it; guarding it would block something harmless and add an
 * error message that now needs explaining.
 */
const COMPANY_CONFIG = ['company.yaml'];

/**
 * Is `a` inside (or exactly) `b`.
 *
 * ⚠ Compares in LOWERCASE on EVERY platform, without checking
 * `process.platform`. On Windows, `ROLES\x.yaml` and `roles\x.yaml` are the
 * SAME file, so a case-sensitive comparison there would leave a backdoor
 * that's beaten by just capitalizing something. The cost on the other side:
 * on Linux, a directory named `Roles` different from `roles` would get
 * wrongly blocked — a case that's nearly nonexistent, and it errs toward
 * safety. Trading a far-fetched false positive for closing a real backdoor.
 */
function within(a: string, b: string): boolean {
  const rel = path.relative(b.toLowerCase(), a.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Does this tool call touch a forbidden zone? `undefined` = let it through.
 *
 * `target` is the string the model typed — absolute or relative to the office
 * directory (the worker's `cwd`). An empty string = the tool didn't declare a
 * path ⇒ let it through.
 */
export function guardedZone(
  dirs: {
    companyDir: string;
    officeDir: string;
    /**
     * Does this role HAVE a browser arm — already resolved from `role.mcp`
     * when the worker was built. Not declared ⇒ **treated as absent**, i.e.
     * stricter: absence is not a safety signal. → see the block below where
     * it's used
     */
    hasBrowser?: boolean;
  },
  target: string,
  mode: GuardMode,
): GuardedZone | undefined {
  if (!target) return undefined;
  const abs = path.resolve(dirs.officeDir, target);

  // `.state` comes BEFORE everything else: it exists both outside the office
  // (the company copy) and inside it (the office copy), so checking it later
  // would send half the cases down a different branch and hand back an
  // explanation about something unrelated.
  for (const state of [companyPaths(dirs.companyDir).state, officePaths(dirs.officeDir).state]) {
    if (within(abs, state)) return 'secrets';
  }
  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ TWO CONDITIONS, ONE PLACE — and dropping either one breaks a different   │
   * │ way. (the user proposed clause ①, 08/30; clause ② is what clause ① alone  │
   * │ would drop)                                                             │
   * │                                                                        │
   * │  ① NO browser arm ⇒ block **the whole directory**. This is least        │
   * │     privilege stated in its own plain words: *the output of an arm       │
   * │     belongs to whoever holds that arm*. A Linear worker has no business  │
   * │     with a previous turn's page snapshot — and a snapshot **can carry     │
   * │     real PII** (08/30 case: an autofilled email in a Facebook login       │
   * │     form).                                                              │
   * │                                                                        │
   * │  ② HAS the arm ⇒ still block `console-*.log`. Even the holder of the     │
   * │     arm has **no** need for a plaintext session token                    │
   * │     (`fb_dtsg=…&__user=…`). Guarding on clause ① alone would leave a       │
   * │     browser worker's log wide open — **wider** than today's rule, i.e.    │
   * │     a step BACKWARD disguised as tightening.                             │
   * │                                                                        │
   * │ ⚠ `hasBrowser` is a **precomputed boolean flag**, not a `role` or a list   │
   * │ of arms. Keeps this function PURE, driven by a path plus one already-      │
   * │ resolved fact: it's a security guard, and the hardest thing to audit is    │
   * │ a guard that has to go look up config on its own to know what it's        │
   * │ guarding. `role.mcp` remains the SOLE source of "who holds what" — we      │
   * │ only read it once, when the worker gets built. → [[agentco-count-mechanisms]] │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  if (within(abs, path.join(dirs.officeDir, BROWSER_OUTPUT))) {
    if (!dirs.hasBrowser || !isPageSnapshot(abs)) return 'browser';
  }

  if (mode === 'read') return undefined;

  // COMPANY level before office level — it sits outside the office so it can
  // only be reached through a directory arm, exactly the case this guard
  // exists to block.
  for (const rel of COMPANY_CONFIG) {
    if (within(abs, path.join(dirs.companyDir, rel))) return 'config';
  }
  for (const rel of OFFICE_CONFIG) {
    if (within(abs, path.join(dirs.officeDir, rel))) return 'config';
  }
  if (within(abs, companyPaths(dirs.companyDir).configFile)) return 'config';

  // An arm STOPS HERE. Reaching outside the office is its job, not an
  // incident — and its real boundary is held by the MCP server, against the
  // exact directories the user has declared.
  if (mode === 'arm') return undefined;

  return within(abs, dirs.officeDir) ? undefined : 'outside';
}

/**
 * BROWSE A DIRECTORY — feeds the directory picker in the `+ Connect` dialog.
 * → docs/SPEC-arms.md §6f
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NOT USE THE OS'S NATIVE FILE PICKER                                  │
 * │                                                                          │
 * │ A browser CAN'T hand over an absolute path: `<input webkitdirectory>`      │
 * │ only returns a relative name, and the File System Access API returns a     │
 * │ handle, not a string. And opening the OS's own dialog opens it **ON THE    │
 * │ SERVER MACHINE** — exactly the bug the 📂 button already hit               │
 * │ (`isLoopback`): click in Hanoi, the window pops up in Singapore.          │
 * │                                                                          │
 * │ ⇒ List it ourselves. Works even when the daemon is remote or in a          │
 * │ container, and it lists the EXACT filesystem an arm will see — not the     │
 * │ filesystem of whoever is sitting in front of the screen. With Docker         │
 * │ (§10b) that's a make-or-break difference, and this picker is already        │
 * │ correct there with no changes needed.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ READS NAMES ONLY, never content. It answers *"which directories exist"*,
 * and that's the minimum needed to make a selection — nothing more.
 */
export interface BrowseEntry {
  name: string;
  path: string;
}

export function browseDirs(target?: string): { path: string; parent: string | null; dirs: BrowseEntry[] } {
  // Nothing passed = root. On Windows, "root" is a LIST OF DRIVES, not a
  // directory — skip this and a Windows user has no way up past `C:\` and can
  // never reach the D drive.
  if (!target) {
    if (process.platform === 'win32') {
      const drives: BrowseEntry[] = [];
      for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${c}:\\`;
        try {
          if (fs.existsSync(root)) drives.push({ name: root, path: root });
        } catch {
          /* a disconnected network drive: skip it, don't break the whole list */
        }
      }
      return { path: '', parent: null, dirs: drives };
    }
    return listDirs('/');
  }
  return listDirs(path.resolve(target));
}

function listDirs(dir: string): { path: string; parent: string | null; dirs: BrowseEntry[] } {
  const up = path.dirname(dir);
  // `dirname('C:\\')` returns itself ⇒ already at the drive root. Return `''`
  // so the UI goes back to the drive list instead of offering an "up" button
  // that goes nowhere.
  const parent = up === dir ? (process.platform === 'win32' ? '' : null) : up;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Can't read it (no permission, drive was ejected) — return empty rather
    // than throw. The user can still click "up", and that's the only exit
    // they need.
    return { path: dir, parent, dirs: [] };
  }

  const dirs = entries
    // Skip hidden directories: they're noise to an office user, and
    // `.state/` sits behind the `guardedZone` guard anyway.
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return { path: dir, parent, dirs };
}

/**
 * Does it actually exist on disk. `existsSync` **can throw**, not just return
 * `false`: a forbidden character in the name, or a disconnected network
 * drive. Throwing here would crash the entire planning turn over one
 * mistyped path — exactly what this check exists to report gracefully
 * instead.
 */
export function existsOnDisk(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
