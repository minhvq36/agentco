/**
 * COMPANY — the shell holding the offices, plus two things shared across them:
 * money and the event bus.
 *
 * → docs/SPEC-offices.md §2
 *
 * A company is DELIBERATELY thin. It has no Assistant, no workers, no
 * knowledge store. All of that belongs to an office, because all of that goes
 * into the prefix cache and the prefix has to stay as narrow as possible. The
 * only thing a company holds is what the user wants to see TOTALED: one Claude
 * subscription, one bill, one cost ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';

import { defaultArmLabel, ensureInstalled } from './armexec.js';
import { cliSays, cliToolNames } from './cli-arm.js';
import { loadCompanyConfig, loadOffice } from './config.js';
import {
  companyPaths,
  ensureCompanyDirs,
  ensureOfficeDirs,
  isSafeId,
  listOfficeIds,
  nameKey,
  normalizeName,
  officePaths,
  resolveCompanyDir,
  folderId,
  slugId,
  type CompanyPaths,
} from './paths.js';
import { Office } from './office.js';
import { grantFor, readOAuth, readSecrets, writeSecrets } from './secrets.js';
import { armHash, coveredBy, folderRoots, swallowsOffice } from './catalog.js';
import { isLocale, t } from '../i18n/index.js';
import {
  appendPurge,
  appendRename,
  appendUsage,
  formatReport,
  readUsage,
  renameChain,
  summarize,
  type CostReport,
  type UsageRecord,
} from './usage.js';
import { migrateIfNeeded } from './migrate.js';
import { RunError, TIERS, type AgentEvent, type CompanyConfig } from './types.js';

export interface OfficeSummary {
  id: string;
  name: string;
  avatar: string;
  state: string;
  agents: number;
  onDuty: number;
  knowledge: number;
  /** Archived — frozen, read-only, restorable. */
  archived: boolean;
  /** Whether a task is currently running, and which one. */
  plan_id: string | null;
  /** An office that failed to load — still listed, with a reason. Must not silently disappear. */
  error?: string;
}

export class Company {
  readonly dir: string;
  readonly paths: CompanyPaths;
  config: CompanyConfig;

  private readonly offices = new Map<string, Office>();
  /** Offices that failed to load. Kept so the UI can show them, not silently swallowed. */
  private readonly broken = new Map<string, string>();
  private readonly bus = new EventEmitter();
  private readonly recent: AgentEvent[] = [];

  private constructor(dir: string, config: CompanyConfig) {
    this.dir = dir;
    this.paths = companyPaths(dir);
    this.config = config;
    ensureCompanyDirs(this.paths);
    this.loadOffices();
    this.warmArms();
  }

  /**
   * Pre-install the package of every already-plugged arm — NO waiting, NO
   * blocking anything.
   *
   * An arm plugged in before the 08/24 patch has no fast-install yet, so
   * relying only on the "Try now" button means it pays ~4 seconds per task
   * **forever** (nobody clicks Retry on an arm that's already working fine).
   * The moment the daemon opens the company is the cheapest time to pay that
   * cost: nobody's waiting on anything yet.
   *
   * ⚠ The `void` is deliberate and must stay: `await`-ing here would block the
   * daemon's startup on a network call — exactly the failure class of "a
   * system housekeeping task sitting in the user's way". Whether the install
   * finishes or not, `fastLaunch` still makes the correct call on its own at
   * the next run. → `core/armexec.ts`
   */
  private warmArms(): void {
    for (const cfg of Object.values(this.config.mcpServers)) {
      void ensureInstalled(cfg as Record<string, unknown>);
    }
  }

  static open(dir?: string): Company {
    const resolved = resolveCompanyDir(dir);
    // Migrate BEFORE loading: v0 put roles/ directly under company/. This is a
    // directory-shape change caused by US, not a decision the user made, so it
    // runs automatically and just prints a notice. → SPEC-offices.md §7
    migrateIfNeeded(resolved);
    return new Company(resolved, loadCompanyConfig(resolved));
  }

  // ── offices

  private loadOffices(): void {
    this.offices.clear();
    this.broken.clear();
    for (const id of listOfficeIds(this.paths)) {
      try {
        const office = new Office(loadOffice(this.dir, this.config, id));
        office.bindBus((e) => this.emit(e));
        office.onUsage = (rec) => appendUsage(this.paths, rec);
        this.offices.set(id, office);
      } catch (err) {
        // One broken office must NOT take down another — the "Stable"
        // criterion. Record the reason so the UI can show it instead of it
        // silently disappearing.
        const msg = err instanceof Error ? err.message : String(err);
        this.broken.set(id, msg);
        process.emitWarning(`Could not load office "${id}": ${msg}`);
      }
    }
  }

  list(): OfficeSummary[] {
    const out: OfficeSummary[] = [];
    for (const o of this.offices.values()) {
      out.push({
        id: o.id,
        name: o.name,
        avatar: o.loaded.config.assistant.avatar,
        state: o.currentState,
        agents: o.loaded.roles.size - o.loaded.archivedRoles.size,
        onDuty: o.assistant.assignableRoles().size,
        knowledge: o.knowledge.size,
        archived: o.archived,
        plan_id: o.plan?.plan_id ?? null,
      });
    }
    for (const [id, error] of this.broken) {
      out.push({
        id,
        name: id,
        avatar: '⚠',
        state: 'stopped',
        agents: 0,
        onDuty: 0,
        knowledge: 0,
        archived: false,
        plan_id: null,
        error,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(officeId: string): Office {
    const o = this.offices.get(officeId);
    if (!o) {
      const why = this.broken.get(officeId);
      throw new RunError(
        why ? t('co.officeBroken', { office: officeId, why }) : t('co.noOffice', { office: officeId }),
        'other',
      );
    }
    return o;
  }

  get size(): number {
    return this.offices.size;
  }

  /**
   * Create a new office. It's born with EXACTLY one Assistant, no workers.
   *
   * A clean starting point is deliberate (SPEC-offices.md §3): v0's first
   * users opened it to find three strangers they hadn't named, didn't
   * understand the presence of, and were afraid to delete.
   */
  createOffice(input: { name?: string; id?: string }): Office {
    const name = normalizeName(input.name ?? '') || t('company.unnamedOffice');
    /**
     * `folderId`, not `slugId`: a non-Latin name (中文, 日本語, 한국어, ไทย,
     * Русский…) produces an EMPTY slug, and the old version threw straight at
     * *"needs at least one letter"* — a message that's meaningless to someone
     * who just typed their own script correctly. → paths.ts
     *
     * An `id` the user typed THEMSELVES still goes through `slugId` as before:
     * that's them choosing the directory name, so it must get exactly what
     * they typed, or a clear rejection.
     */
    const id = input.id?.trim() ? slugId(input.id.trim()) : folderId(name);
    if (!isSafeId(id)) {
      throw new RunError(t('co.officeNameNeedsAlnum'), 'other');
    }
    if (name.length > 60) {
      throw new RunError(t('co.officeNameTooLong'), 'other');
    }
    if (this.offices.has(id) || this.broken.has(id)) {
      throw new RunError(t('co.officeExists', { id }), 'other');
    }
    this.assertNameFree(name, id);

    const dir = path.join(this.paths.offices, id);
    const pp = officePaths(dir);
    ensureOfficeDirs(pp);
    fs.writeFileSync(pp.configFile, officeTemplate(id, name), 'utf8');
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 DOES NOT SEED `skills/assistant.md` EITHER — removed 05/09.         │
     * │                                                                      │
     * │ It used to be written here from `t('seed.assistantSkills.body')`,     │
     * │ i.e. IN THE INTERFACE LANGUAGE AT THE MOMENT OF CREATION. That was    │
     * │ argued as safe because seed content becomes the user's own datum the  │
     * │ instant it lands. It IS their datum — and that is exactly the         │
     * │ problem: from then on it sits in the cached prefix of every single    │
     * │ chat turn, and it is the ONLY text in that prefix carrying a          │
     * │ language. Measured 05/09 (`P-260905-0100-zquw`): an English request   │
     * │ produced a plan in the seed's language, because the seed did not      │
     * │ merely happen to be in a language — it gave a STYLE ORDER that can    │
     * │ only be obeyed in one ("address yourself as X, call the user Y",      │
     * │ a clause the English seed has no counterpart for at all).             │
     * │                                                                      │
     * │ So the interface switch never reached a prompt through the code —     │
     * │ it reached one through a FILE WE WROTE FOR THE USER. A gate reading   │
     * │ source code cannot see that road.                                     │
     * │                                                                      │
     * │ Nothing of value is lost: the same advice is the PLACEHOLDER of that  │
     * │ very editor (`promptLayer.assistantSkillsPlaceholder`), where the     │
     * │ person reads it, adopts it deliberately if they want it, and it       │
     * │ costs ZERO tokens until they do. → the box on `PromptLayer.placeholder`│
     * │                                                                      │
     * │ Same shape, same reasoning as the charter directly below — which was  │
     * │ removed for the neighbouring reason on 08/17.                         │
     * │                                                                      │
     * │ ⚠ Offices that ALREADY have the file keep it untouched. It is their   │
     * │ text now; rewriting a user's own file to fix our seed would be us      │
     * │ editing their data behind their back.                                 │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * Does NOT create a charter file, and does not create any knowledge node.
     *
     * The previous version wrote `knowledge/shared/_charter.md` upfront with
     * full frontmatter and an empty body. The consequence: every new office
     * spawned a ghost node in the Knowledge drawer that the user didn't
     * create, didn't understand, and whose deletion broke something else (see
     * `charter_file` in types.ts).
     *
     * The charter is now `charter.md` at the office root and **only exists
     * once the user actually writes something** — `savePromptLayer` creates
     * the file on the first save. A new office has a GENUINELY EMPTY
     * knowledge store, exactly as the drawer claims.
     */

    const office = new Office(loadOffice(this.dir, this.config, id));
    office.bindBus((e) => this.emit(e));
    office.onUsage = (rec) => appendUsage(this.paths, rec);
    this.offices.set(id, office);

    this.emit({ type: 'company.offices', say: t('co.officeCreated', { name }), office: id, plan_id: null });
    return office;
  }

  /**
   * Change an office's display name. The code (directory) stays the same —
   * see `Office.rename`.
   *
   * Duplicate checking happens HERE, not inside `Office`: only the company can
   * see the other offices. An office is self-contained and doesn't know who
   * its neighbors are — that's the condition that lets zipping up an
   * `offices/<id>/` directory produce a template that runs on another
   * machine.
   */
  /**
   * ⚠ RETURNS `id` TOO, and the caller MUST use it.
   *
   * Renaming can **move the directory and swap out the `Office` instance**
   * entirely in the map (`moveOffice`). Every handle grabbed BEFORE this call
   * turns into a ghost: its `office.id` is still the old id, and
   * `office.loaded.dir` points at a directory that no longer exists. The
   * previous version only returned the NAME, so `server.ts` had no way to
   * know the id had changed — it built a response from the stale handle, the
   * client saw the old `id`, and every call after that 404'd until the user
   * hit F5. → bug reported by the user 08/22
   */
  renameOffice(officeId: string, name: string): { name: string; id: string } {
    const office = this.get(officeId);
    const next = normalizeName(name);
    if (!nameKey(next)) {
      throw new RunError(t('co.officeNameNeedsAlnum'), 'other');
    }
    this.assertNameFree(next, officeId);

    const moveTo = this.renameTarget(officeId, next);
    if (moveTo && office.currentState === 'working') {
      throw new RunError(
        t('co.officeBusyRename'),
        'other',
      );
    }
    // `silent` when a move is about to happen: `Office`'s own event carries
    // the OLD id, and it reaches the browser AFTER the directory has already
    // moved → the client chases a dead id and gets a 404. We emit our own
    // event carrying the NEW id at the end of this function. → `Office.rename`
    const applied = office.rename(next, moveTo ? { silent: true } : undefined);
    if (moveTo) this.moveOffice(officeId, moveTo);

    this.emit({
      type: 'company.offices',
      say: moveTo
        ? t('co.officeRenamedWithFolder', { name: applied })
        : t('co.officeRenamed', { name: applied }),
      office: moveTo ?? officeId,
      plan_id: null,
    });
    return { name: applied, id: moveTo ?? officeId };
  }

  /**
   * The new id if renaming DRAGS the directory along with it, `undefined` if
   * the id stays put. → docs/SPEC-offices.md §3
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ONE RULE, NOT A CONDITION TABLE. (user settled 08/22)                    │
   * │                                                                          │
   * │ The earlier proposal was *"only move the directory while the office is    │
   * │ still empty"*. The user correctly rejected it: **a mechanism that fires   │
   * │ sometimes and not others is unguessable to a user** — worse than not      │
   * │ having it at all. The rule here is one sentence:                         │
   * │                                                                          │
   * │   **Move the directory if and only if the new name produces a real       │
   * │   slug.**                                                                │
   * │                                                                          │
   * │ `slugId`, NOT `folderId` — and that's the whole difference. Renaming      │
   * │ "Accounting" to "会计部" and hashing it would turn `ke-toan` into           │
   * │ `vp-ee6fd8`: a readable name changed into a meaningless one, to serve a    │
   * │ number nobody looks at. `folderId` is only for CREATION, when there's     │
   * │ nothing to lose yet.                                                     │
   * │                                                                          │
   * │ Consequence (the user asked directly, and was right): a non-Latin name    │
   * │ ⇒ **the id stays put**, only the display side changes — even when the      │
   * │ old name was Latin. For a market that writes in non-Latin script,          │
   * │ renaming the directory **changes nothing**, and the 📂 button is what      │
   * │ actually serves them. The two mechanisms complement each other, they       │
   * │ don't replace each other.                                                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  private renameTarget(officeId: string, name: string): string | undefined {
    const next = slugId(name);
    if (!next || next === officeId) return undefined;
    // Colliding with another office (even a broken one) means KEEP the id
    // rather than throwing: the user only wanted to change the label, and the
    // label itself isn't a duplicate — `assertNameFree` already checked that.
    // Blocking here would reject a legitimate action.
    if (this.offices.has(next) || this.broken.has(next)) return undefined;
    return next;
  }

  /**
   * Move `offices/<old>/` → `offices/<new>/`, then rebuild the Office in place.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MEASURED BEFORE BUILDING — the two biggest worries turned out to be       │
   * │ NOT REAL:                                                                │
   * │                                                                          │
   * │  · **Prompt cache**: `prompt.ts` doesn't hold `office.dir`/`office.id`     │
   * │    anywhere, every path in the prefix is relative. Moving the directory    │
   * │    ⇒ 0 cache rewrites.                                                    │
   * │  · **Assistant memory**: actually tested it — mention a code in            │
   * │    `bao-cao`, rename it to `kiem-ke`, then `resume` with the same           │
   * │    session id: it reads back the correct code. `resume` does NOT track     │
   * │    `cwd`.                                                                 │
   * │                                                                          │
   * │ The only casualty is `logs/usage.jsonl` — it lives at the COMPANY level    │
   * │ (doesn't follow the directory) and carries `office: "<id>"` on 315/317     │
   * │ lines. Solved with an ALIAS record appended to the end of the ledger:      │
   * │ append-only stays intact, no line of history gets rewritten.               │
   * │ → `usage.ts`                                                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Blocked while a task is running: Windows locks open files, and a worker
   * turn writing into `artifacts/` mid-move would corrupt it halfway through.
   * Same rule as `archiveOffice`.
   */
  private moveOffice(officeId: string, nextId: string): void {
    const from = path.join(this.paths.offices, officeId);
    const to = path.join(this.paths.offices, nextId);
    if (fs.existsSync(to)) throw new RunError(t('co.folderExists', { id: nextId }), 'other');

    fs.renameSync(from, to);
    appendRename(this.paths, officeId, nextId);

    this.offices.delete(officeId);
    const office = new Office(loadOffice(this.dir, this.config, nextId));
    office.bindBus((e) => this.emit(e));
    office.onUsage = (rec) => appendUsage(this.paths, rec);
    this.offices.set(nextId, office);
  }

  /** Don't let two offices carry the same name. `exceptId` = itself, when renaming. */
  private assertNameFree(name: string, exceptId: string): void {
    const key = nameKey(name);
    for (const o of this.offices.values()) {
      if (o.id === exceptId) continue;
      if (nameKey(o.name) === key) {
        throw new RunError(
          t('co.officeNameTaken', { name: o.name }),
          'other',
        );
      }
    }
  }

  /**
   * Change the company's model configuration (which tier runs which model,
   * which tier the Assistant/planner runs at). → docs/SPEC-offices.md §4.5
   *
   * Written through `parseDocument` so comments in company.yaml survive, then
   * READ BACK THROUGH THE SCHEMA instead of patching the in-memory object —
   * the file on disk is the source of truth, and reading it back is the only
   * way to be sure the two sides don't drift apart.
   *
   * Does NOT rebuild the Offices: doing so would throw away their running
   * plans, mailboxes, and schedulers. Just feeds in the new config, and each
   * Office builds itself a NEW `LoadedOffice` (a task already in progress
   * keeps the old one). → `Office.applyCompanyConfig`
   */
  updateModels(patch: Record<string, string>): CompanyConfig['models'] {
    const allowed = new Set(['eco', 'standard', 'deep', 'master', 'planner']);
    const entries = Object.entries(patch).filter(([k]) => allowed.has(k));
    if (entries.length === 0) throw new RunError(t('co.noValidModelField'), 'other');

    for (const [key, value] of entries) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new RunError(t('co.valueEmpty', { key }), 'other');
      }
      if ((key === 'master' || key === 'planner') && !TIERS.includes(value as never)) {
        throw new RunError(t('co.mustBeTier', { key, tiers: TIERS.join(', ') }), 'other');
      }
    }

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('models')) doc.set('models', {});
    for (const [key, value] of entries) doc.setIn(['models', key], value.trim());
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: t('co.modelsChanged'),
      office: '',
      plan_id: null,
    });
    return this.config.models;
  }

  /**
   * Change the INTERFACE language. → `src/i18n/` · docs/CLAUDE.md §Language
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THIS DOES NOT TOUCH A SINGLE PROMPT, AND MUST NOT LEARN TO.           │
   * │                                                                          │
   * │ It changes what the screen says. It does NOT change what the assistant   │
   * │ or the workers write — those follow whatever language the human is       │
   * │ typing in, which is a different question and one the switch cannot       │
   * │ answer. A Vietnamese user may well want an English interface.            │
   * │                                                                          │
   * │ Two consequences worth stating because they read as bugs otherwise:      │
   * │  · no `cacheKey` moves, so nothing is re-cached and nothing is re-paid.  │
   * │    Model config changes cost a prefix rewrite; this one costs nothing.   │
   * │  · a reply that arrives right after the switch is still in the old       │
   * │    language if that is the language the human wrote in. Correct.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Same write shape as `updateModels`: edit through `parseDocument` so the
   * comments in company.yaml survive, then READ BACK THROUGH THE SCHEMA rather
   * than patching the in-memory object. `loadCompanyConfig` applies the locale
   * as it parses, so the daemon's own strings switch on the same line.
   */
  updateLanguage(language: string): 'vi' | 'en' {
    if (!isLocale(language)) {
      throw new RunError(t('co.unsupportedLanguage', { language }), 'other');
    }

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    doc.set('language', language);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    // No `applyCompanyConfig` loop: offices hold no interface strings, and a
    // rebuild would throw away running plans to change a label.
    return language;
  }

  /**
   * RENAME THE COMPANY — the title in the top-left corner of the screen.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ IT IS A LABEL, AND THAT IS WHY IT IS THE CHEAPEST WRITE IN THE SYSTEM.   │
   * │                                                                          │
   * │ Nothing is keyed on it: the directory is `companyDir`, offices are keyed │
   * │ by their own folder name, and the cost ledger records office ids. So     │
   * │ unlike renaming an OFFICE — which can move a directory and change an id  │
   * │ (`renameTarget`) — this moves not one byte and breaks not one path.      │
   * │                                                                          │
   * │ ⚠ AND IT REACHES NO PROMPT. `docs/CLAUDE.md §Language` names the company │
   * │ name as the example of a datum that passes both tests: it becomes the    │
   * │ user's own, and it never lands in a prefix. So no `cacheKey` moves and   │
   * │ nothing is re-paid. Wire it into a prompt one day and this sentence      │
   * │ stops being true — the rename would start costing a prefix rewrite       │
   * │ across every office.                                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * EMPTY IS ACCEPTED AND MEANS "unnamed". `name: ''` is the state a fresh
   * `company.yaml` is in — the server then renders `t('company.unnamed')`, a
   * label that follows the interface switch. Refusing an empty box would leave
   * somebody who typed a name by accident with no way back to the default.
   *
   * Same write shape as `updateLanguage`: `parseDocument` so the user's own
   * comments in `company.yaml` survive, then read the file back through the
   * schema rather than patching the object in memory.
   */
  updateName(name: string): string {
    const next = name.trim().replace(/\s+/g, ' ');
    // A ceiling, not a rule about taste: this string is drawn in a fixed header
    // beside the office picker, and there is no wrapping to fall back on.
    if (next.length > 80) throw new RunError(t('co.nameTooLong', { max: 80 }), 'other');

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    doc.set('name', next);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    /**
     * ⚠ TELL THE OTHER TABS. The title is drawn from `GET /api/company`, which
     * a tab only calls on boot — without this event a second window keeps the
     * old name on screen until somebody presses F5, and this is precisely the
     * class of thing the user reads as "the app lies about its own state".
     */
    this.emit({ type: 'company.offices', say: t('co.nameChanged'), office: '', plan_id: null });
    return this.config.name;
  }

  /**
   * PLUG IN AN ARM. → docs/SPEC-arms.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NO RESTART NEEDED, AND NO NEED FOR `setMcpServers`.                      │
   * │                                                                          │
   * │ 📖 The SDK has `Query.setMcpServers()` to plug/unplug mid-session. We're   │
   * │ NOT using it, and the reason is architectural, not laziness: **a worker    │
   * │ is a one-shot `query()`, so the next turn reads the new config on its       │
   * │ own**, while the one long-lived session (the Assistant) NEVER holds MCP    │
   * │ (MCP breaks the prompt cache on `resume` — `types.ts:499`).                │
   * │ ⇒ `applyCompanyConfig` is enough, exactly like `updateModels` right         │
   * │ above.                                                                    │
   * │                                                                          │
   * │ This is why the `stop`/`start` step in the 10-step plan's B7 disappeared   │
   * │ — not because of a new API, but because of a constraint that was already    │
   * │ there from the start.                                                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Credentials go into `.state/secrets.json` (gitignored, and since 08/23 a
   * worker can't read it — `paths.ts §guardedZone`). Config goes into
   * `company.yaml`, which can be committed to git. **A credential's value is
   * never in company.yaml.**
   */
  addArm(input: {
    /** Display name. NOT the identity — the identity is a config hash. */
    label?: string;
    config: Record<string, unknown>;
    catalog?: string;
    /** The credential NAMES needed. Goes into the hash, and into `role.secrets` when assigned. */
    secretNames?: string[];
    secrets?: Record<string, string>;
    /**
     * TOOLS GRANTED, already resolved from `annotations` at plug-in time.
     * Empty/absent ⇒ the whole server. → `types.ts §arms.tools` ·
     * `server.ts §readOnlyTools`
     *
     * ⚠ This field WAS SILENTLY SWALLOWED (caught 08/25): `server.ts` was
     * passing `...(tools.length ? { tools } : {})` in here while the type
     * here hadn't declared it — and a **spread does NOT trigger TypeScript's**
     * excess-property check. Typecheck green, tests green, the feature **did
     * nothing at all**. Same trap class as `SHELL_ALIASES` and the SDK's
     * `tools`: *a silent allowlist drops an unrecognized element*.
     * → [[agentco-silent-allowlist]]
     */
    tools?: string[];
    /**
     * PERMISSION TIER, and it **goes into the hash**. → `catalog.ts §armHash` · §6j
     *
     * ⚠ Absent ⇒ hashes identically to before 08/26. That's not convenience:
     * every already-existing arm must keep its exact code, or a single
     * upgrade orphans the user's entire `company.yaml`.
     */
    level?: 'read' | 'add' | 'full';
    /** The office about to use it — needed for the "one folder, one arm" rule. */
    office?: string;
  }): string {
    const secretNames = [...new Set(input.secretNames ?? Object.keys(input.secrets ?? {}))].sort();
    /**
     * An identity generated by the MACHINE, not typed by a person. Same
     * config ⇒ same key ⇒ "duplicate plug-in" becomes a thing that CAN'T
     * HAPPEN, rather than something to remember to check in four places.
     * → `catalog.ts §armHash`
     */
    const id = armHash(input.config, secretNames, input.level);
    if (!input.config || typeof input.config !== 'object') {
      throw new RunError(t('co.armConfigMissing'), 'other');
    }
    /**
     * ⚠ A DUPLICATE CODE = A SILENT OVERWRITE, and the user caught it on the
     * very first test run: plug `files` in for directory A, then plug `files`
     * in for directory B, and A vanishes without a word. The node on the
     * diagram stays exactly the same (same id), every connection stays the
     * same — only the directory underneath changes. **No symptom shows up
     * where the change actually happened.**
     *
     * Reject it, don't silently rename it: renaming to `files-2` falls into
     * the "silent rewrite" trap — the user typed one name and got a different
     * one back. The rejection message always states two ways forward, because
     * "already exists" with no next step just strands them there.
     *
     * ⚠ A `filesystem` arm accepts MULTIPLE directories at once (measured
     * 08/23: `connected` with 2 roots) — so "two directories" usually does
     * NOT need two arms.
     */
    /**
     * ALREADY IN THE ROSTER = reuse, NOT an error.
     *
     * This is where "plug it back in and it's found" becomes real: a user
     * removes an arm from an office, then plugs the exact same directory back
     * in ⇒ same hash ⇒ we hand back the exact same config + name + credential
     * names, with no re-asking of a single question.
     *
     * Only blocked when THIS office is already using it — and the block
     * message states the next step (wire it up), because "already exists"
     * with no direction is a dead end.
     */
    if (input.office && this.armInUse(input.office, id)) {
      const label = this.config.arms[id]?.label || id;
      throw new RunError(
        t('co.armAlreadyHere', { label }),
        'other',
      );
    }

    /**
     * ONE DIRECTORY, ONE ARM — scoped to ONE office. → `catalog.ts §coveredBy`
     *
     * Only compares against arms ACTUALLY WIRED UP in this office, not the
     * whole company: two offices both pointing at `D:\Records` is valid and
     * deliberate (independent clones, settled by the user). This rule's
     * boundary is the diagram's boundary.
     */
    const want = folderRoots(input.config);
    if (input.office && want.length) {
      const office = this.get(input.office);

      // The office / company directory itself: redundant AND routes around
      // the `.state/` guard. → `catalog.ts §swallowsOffice`
      const bad = want.find((r) => swallowsOffice(r, office.loaded.dir, this.dir));
      if (bad) {
        throw new RunError(
          t('co.folderIsOfficeItself', { path: bad }),
          'other',
        );
      }

      const used = new Set<string>();
      for (const [roleId, role] of office.loaded.roles) {
        if (office.loaded.archivedRoles.has(roleId)) continue;
        for (const s of role.mcp) used.add(s);
      }
      const existing = [...used].map((s) => ({ id: s, folders: folderRoots(this.config.mcpServers[s]) }));
      const clash = coveredBy(existing, want);
      if (clash) {
        throw new RunError(
          t('co.folderAlreadyCovered', { id: clash.id }),
          'other',
        );
      }
    }

    // Credentials BEFORE config: if config gets written first and the
    // credential step then fails, the diagram already has a node pointing at
    // a process that can never start.
    const secrets = input.secrets ?? {};
    if (Object.keys(secrets).length) {
      const pp = companyPaths(this.dir);
      writeSecrets(pp, { ...readSecrets(pp), ...secrets });
    }

    /**
     * ⚠ `createNode` defaults to FLOW style, and flow style is INHERITED from
     * the parent map downward: the whole config collapses onto one line,
     * Windows paths go unquoted. `company.yaml` is a file the user READS and
     * commits to git — it has to look like the commented example right above
     * this key.
     *
     * Force block style at both levels. `args` comes out block-styled too — a
     * bit different from the commented example, but it reads better with a
     * long package name plus a pinned version number.
     */
    const block = (n: unknown) => {
      if (n && typeof n === 'object') (n as { flow?: boolean }).flow = false;
      return n;
    };
    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('mcpServers')) doc.set('mcpServers', block(doc.createNode({})));
    if (!doc.has('arms')) doc.set('arms', block(doc.createNode({})));
    block(doc.get('mcpServers', true));
    block(doc.get('arms', true));
    doc.setIn(['mcpServers', id], block(doc.createNode(input.config)));
    // Keep the old label if the entry is already in the roster — a user
    // plugging back in something they once named owns that name, don't
    // silently swap it for a default.
    /**
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ FOUR TIERS, and the order is the order of TRUST in the name.        │
     * │ (user, 08/31)                                                      │
     * │                                                                    │
     * │  ① shared roster   plugging back in something once named ⇒ that     │
     * │                     name is **theirs**                              │
     * │  ② what they typed  the key in `{"mcpServers":{"notebook":…}}`,       │
     * │                     or a catalog entry's name. A **proper** name,    │
     * │                     written by a human being                        │
     * │  ③ inferred from config  `deepwiki.com` · `server-memory` — machine-   │
     * │                     inferred, readable, and correct in most cases     │
     * │  ④ hash             honest, but meaningless to a reader              │
     * │                                                                    │
     * │ Tier ③ is newly added. Before this, ② fell straight through to ④,    │
     * │ so a **bare** JSON block (with no `mcpServers` wrapper) always        │
     * │ produced a hash.                                                    │
     * │                                                                    │
     * │ ⚠ And since 08/30 it's NOT just cosmetic anymore: `armReach` builds    │
     * │ the roster line with `label || id`, so an empty label means **the      │
     * │ Assistant sees a hash as the arm's name** — exactly the case in        │
     * │ §16r, where a model with no prior on a name **fills the gap in for      │
     * │ itself**.                                                            │
     * └────────────────────────────────────────────────────────────────────┘
     */
    const label =
      this.config.arms[id]?.label || input.label?.trim() || defaultArmLabel(input.config) || id;
    /**
     * ⚠ `tools` also has to be WRITTEN TO DISK, not just accepted as a
     * parameter. Plugging a known arm back in reuses the old list — same
     * logic as `label` right above: the same hash means **the same config**,
     * so the previously-resolved tool set is still correct.
     */
    /**
     * ⚠ For a CLI declaration, the tool list is inferred **from the
     * declaration itself**, not by waiting for a `probeArm` round trip.
     * Without this, `pickMcp` grants **the entire server** (`mcp__<hash>`) —
     * broader than what we meant to grant, and silently so. The same hole
     * `arms[].tools` was built to close, just a different data source.
     */
    const tools = input.tools?.length
      ? input.tools
      : cliToolNames(input.config).length
        ? cliToolNames(input.config)
        : (this.config.arms[id]?.tools ?? []);
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 `does` — A FIELD WITH A SCHEMA, WITH A READER, **NOBODY WRITES IT**  │
     * │ (as of 08/31)                                                         │
     * │                                                                      │
     * │ The 08/30 patch built `types.ts §arms.does` and `assistant.ts             │
     * │ §armReach` reads it, then stopped there: no path in the product writes    │
     * │ this field — only a spike wrote it by hand. So the capability *"an arm     │
     * │ declares what it can do"* **has never once run inside the app**, and       │
     * │ no test goes red because an absent field is valid (`.default([])`).       │
     * │                                                                      │
     * │ Measured the cost today: same question, same arm — bare label ⇒ the       │
     * │ Assistant **doesn't hand out the task**; with `does` ⇒ hands it out,      │
     * │ calls it for real, correct count, **4/4 turns**. → SPEC-arms §16r ·        │
     * │ §16s                                                                  │
     * │                                                                      │
     * │ ⚠ The source is each action's `say` (a human-language sentence), NOT      │
     * │ `id`: `dem_hoa_don` is a machine name, and §7b bans pasting raw tool        │
     * │ names into the roster. Capped at 4 items — the roster line enters the      │
     * │ prefix on **every `route()` turn**.                                       │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const does = cliSays(input.config).length
      ? cliSays(input.config)
      : (this.config.arms[id]?.does ?? []);
    doc.setIn(
      ['arms', id],
      block(
        doc.createNode({
          label,
          ...(input.catalog ? { catalog: input.catalog } : {}),
          secrets: secretNames,
          ...(tools.length ? { tools } : {}),
          ...(does.length ? { does } : {}),
          // Permission tier — already inside the hash, written out so the user
          // can READ IT WITH THEIR OWN EYES instead of having to trust the
          // badge in the UI. → §6j
          ...(input.level ? { level: input.level } : {}),
        }),
      ),
    );
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );

    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: t('co.armPlugged', { label }),
      office: '',
      plan_id: null,
    });
    return id;
  }

  /** Which role in this office is connected to arm `id`? */
  private armInUse(officeId: string, id: string): boolean {
    const office = this.offices.get(officeId);
    if (!office) return false;
    if (office.loaded.config.assistant.mcp.includes(id)) return true;
    for (const [roleId, role] of office.loaded.roles) {
      if (office.loaded.archivedRoles.has(roleId)) continue;
      if (role.mcp.includes(id)) return true;
    }
    return false;
  }

  /**
   * RENAME an arm. Only touches `arms[id].label` — nothing references the
   * label, so this is the cheapest operation in the whole system: no key
   * changes, no rewriting `roles/*.yaml`, no cache broken for anyone.
   *
   * That's exactly why the identity has to be a HASH and not the name: back
   * when `id` was whatever the user typed, "renaming" meant CHANGING THE KEY,
   * dragging a small migration across every role of every office — on every
   * click.
   */
  renameArm(id: string, label: string): string {
    const next = label.trim();
    if (!next) throw new RunError(t('co.armNameEmpty'), 'other');
    if (!(id in this.config.mcpServers)) throw new RunError(t('co.noArm', { id }), 'other');

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    if (!doc.has('arms')) doc.set('arms', doc.createNode({}));
    doc.setIn(['arms', id, 'label'], next);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );
    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);
    this.emit({ type: 'company.offices', say: t('co.armRenamed', { name: next }), office: '', plan_id: null });
    return next;
  }

  /**
   * UNPLUG an arm from the company.
   *
   * ⚠ **Credentials are NOT deleted along with it.** Unplugging ≠ throwing
   * away the credential: users often unplug to rotate a token or try a
   * different server, and forcing them to re-obtain a token would punish an
   * otherwise harmless action. Deleting a credential has its own, deliberate,
   * path.
   *
   * The `mcp→agent` edge lives in `roles/*.yaml`; `layout.read()` already
   * skips an edge pointing at a node that no longer exists, so no manual
   * cleanup is needed here.
   */
  /**
   * REMOVE an arm FROM ONE OFFICE. The shared roster **is not touched**.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MEANING CHANGED 08/23, and it's what let the whole "archive" concept get   │
   * │ deleted.                                                                 │
   * │                                                                          │
   * │ The previous version deleted from `company.yaml`, i.e. lost the config     │
   * │ entirely — which is why a middle "put it away" tier was needed to keep    │
   * │ it around. Now config lives in the SHARED ROSTER and nobody deletes it,    │
   * │ so "remove" already carries the exact nature of "put away": plug the       │
   * │ same directory back in ⇒ same hash ⇒ found intact.                        │
   * │                                                                          │
   * │ ⇒ One tier instead of two. Workers need two tiers because what they        │
   * │ carry can't be rebuilt; an arm only carries config. Borrowing a concept     │
   * │ from where it earns its keep to where it doesn't is exactly what just       │
   * │ got removed.                                                             │
   * │                                                                          │
   * │ One thing is lost, and it's said out loud: THE WIRE. Plugging back in       │
   * │ means rewiring. For an arm serving 1–2 people, that's one drag of a          │
   * │ connection — far cheaper than maintaining an entire concept just to save    │
   * │ it.                                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ IDEMPOTENT: "removing something already gone" must SUCCEED. A rejection
   * message is only correct when the user still has a path forward; here
   * there is none, so it would be a dead end rather than a rejection.
   */
  removeArm(id: string, officeId?: string): void {
    const targets = officeId ? [this.get(officeId)] : [...this.offices.values()];
    for (const office of targets) office.dropArm(id);

    const label = this.config.arms[id]?.label || id;
    this.emit({
      type: 'company.offices',
      say: t('co.armUnplugged', { label }),
      office: officeId ?? '',
      plan_id: null,
    });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ PERMANENTLY DELETE from the SHARED ROSTER — the second tier, and the       │
   * │ ONLY one that can't be undone. (user settled 08/25: *"the user should       │
   * │ be responsible for their own actions"*)                                    │
   * │                                                                          │
   * │ Why it needs to exist, and the strongest reason is this project's own       │
   * │ rule: as of today, removing an orphaned entry from the roster can only       │
   * │ be done by **opening `company.yaml` and hand-editing it** — and an "open      │
   * │ the yaml file" step is a **warning bell** (§6a, settled 08/22). Without         │
   * │ this button, `mcpServers:` can only ever grow longer, forever.               │
   * │                                                                          │
   * │ ⚠ AN ORPHANED ENTRY COSTS NO TOKENS — don't sell this feature on the           │
   * │ wrong reason: `pickMcp` only builds a server whose name appears in            │
   * │ `role.mcp`. What it costs is **space in the user's head**: a list of            │
   * │ "already plugged in at another office" grows longer with things nobody           │
   * │ remembers the purpose of anymore.                                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠⚠ **CREDENTIALS ARE NOT DELETED ALONG WITH IT** — and this is what makes
   * the decision above cheap.
   *
   * The expensive part of plugging in an arm is **going and getting the
   * credential**, not the config. Config rebuilds from the catalog in three
   * clicks; a credential means a trip to the provider's own site.
   * Credentials live in `.state/secrets.json` **by NAME**, independent of the
   * roster — so deleting the wrong thing here loses the cheap part and keeps
   * the expensive one. Removing a credential has its own, deliberate, path:
   * `agentco secret rm <NAME>`.
   *
   * ⚠ Blocked while anyone's still using it, and "using" has TWO meanings —
   * missing one means deleting a node still sitting on someone's diagram:
   *   · `role.mcp`        — has a wire to a worker
   *   · `office.arms`     — **present** on the diagram, not wired up yet (a waiting node)
   */
  /**
   * Which offices still hold this arm — under BOTH meanings of "hold".
   *
   * ⚠ One function, two call sites: the gate inside `forgetArm`, and the
   * `orphan` flag the UI uses to decide whether to show the permanent-delete
   * button. Splitting it into two copies opens exactly the door where a
   * button shows up and clicking it gets rejected — or worse, a button
   * doesn't show up for something that could actually be deleted.
   */
  private armHolders(id: string): string[] {
    const out: string[] = [];
    for (const office of this.offices.values()) {
      const wired = [...office.loaded.roles.values()].some((r) => r.mcp.includes(id));
      if (wired || office.loaded.config.arms.includes(id)) out.push(office.loaded.config.name || office.id);
    }
    return out;
  }

  forgetArm(id: string): void {
    if (!(id in this.config.mcpServers)) throw new RunError(t('co.noArm', { id }), 'other');

    const holders = this.armHolders(id);
    if (holders.length) {
      throw new RunError(
        t('co.armStillInUse', {
          label: this.config.arms[id]?.label || id,
          n: String(holders.length),
          offices: holders.join(', '),
        }),
        'other',
      );
    }

    const doc = YAML.parseDocument(fs.readFileSync(this.paths.configFile, 'utf8'));
    doc.deleteIn(['mcpServers', id]);
    doc.deleteIn(['arms', id]);
    fs.writeFileSync(
      this.paths.configFile,
      doc.toString({ lineWidth: 0, flowCollectionPadding: false }),
      'utf8',
    );
    const label = this.config.arms[id]?.label || id;
    this.config = loadCompanyConfig(this.dir);
    for (const office of this.offices.values()) office.applyCompanyConfig(this.config);
    /**
     * ⚠ MUST notify, just like `removeArm`. Without this event, every other
     * tab (and the current one too, if it listens to SSE instead of
     * self-reloading) keeps the code that just died until the user hits F5 —
     * exactly the symptom the user reported 08/26.
     */
    this.emit({
      type: 'company.offices',
      say: t('co.armDeleted', { label }),
      office: '',
      plan_id: null,
    });
  }

  /**
   * An arm's WORKSPACE name — looks up `arms[id].secrets` in the OAuth store.
   *
   * One function, two call sites (`listArms` for the dialog, `describeNode`
   * for the detail panel). Splitting it into two copies would make two
   * screens say two different things about the same arm — exactly what the
   * user just complained about: *"with a bunch of Notion arms, which Notion
   * is which"*.
   */
  armWorkspace(id: string): string | undefined {
    const names = this.config.arms[id]?.secrets ?? [];
    if (!names.length) return undefined;
    const oauth = readOAuth(companyPaths(this.dir));
    return names.map((s) => oauth[s]?.label).find(Boolean);
  }

  /** The SHARED ROSTER + who's using each one. → docs/SPEC-arms.md §6i */
  listArms(): {
    id: string;
    label: string;
    catalog?: string;
    config: unknown;
    /** Credential NAMES, never values — so the UI can say "already set, no need to re-enter". */
    secrets: string[];
    /** Permission tier — the UI draws the BADGE from here, NOT from the name string. → §6j */
    level?: 'read' | 'add' | 'full';
    /**
     * The WORKSPACE name this arm connects to, looked up from the OAuth store.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ User, 08/26: *"with a bunch of Notion arms, which Notion is which"*.    │
     * │                                                                      │
     * │ Inferred from `arms[].secrets` (a credential name carrying              │
     * │ `workspace_id`), looked back up against the label in `$oauth` —          │
     * │ **not** reading the `label` string. A label belongs to the user and       │
     * │ changes freely; a workspace is a fact that belongs to the config.          │
     * │                                                                      │
     * │ Absent when: the arm doesn't use OAuth, or the workspace has been           │
     * │ disconnected. Both cases are "unknown" ⇒ draw nothing, rather than           │
     * │ making up a name.                                                        │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    via?: string;
    /**
     * The account this arm runs on has a DEAD credential — carries that
     * account's label, so the interface can name it.
     *
     * ⚠ Derived from the SAME lookup as `via` (`arms[].secrets` against the
     * OAuth store), deliberately: one more derived field, not a second
     * mechanism. → [[agentco-count-mechanisms]]
     *
     * Why it has to travel with the arm rather than only with the account
     * (real case, 09/03): all the interface had at the spot the user was
     * standing was *"press Try it to be sure it is still alive"*, and Try it
     * answered with the SDK's raw English 401. The store had known the key was
     * dead since the day before. Knowing something and saying it at the place
     * the person is standing are two different things.
     * → [[agentco-scope-of-door-vs-data]]
     *
     * ⚠ Absent ≠ healthy. Only a refresh that a service REFUSED sets this
     * (`oauth-routes.ts §refreshDue`); a credential revoked but never yet
     * refreshed still reads as blank here and shows up as a 401 in use.
     */
    keyDead?: string;
    /** Number of tools granted. Shown next to the badge so a "read-only" label can be visually verified. */
    toolCount: number;
    usedBy: { office: string; role: string }[];
    /**
     * NO office holds it anymore — including the "present on the diagram but
     * not wired up" kind. Only an entry like that shows the **permanent
     * delete** button. Inferring it from `usedBy` would be wrong: `usedBy`
     * only counts wires, so a node still waiting on the diagram would look
     * orphaned. → `armHolders`
     */
    orphan: boolean;
  }[] {
    // Read the store ONCE for the whole list: `readOAuth` parses the entire
    // file, and a long-running company can have dozens of arms — calling it
    // inside the loop would re-read the same file dozens of times every time
    // the dialog opens.
    const oauth = readOAuth(companyPaths(this.dir));
    return Object.entries(this.config.mcpServers).map(([id, config]) => {
      const usedBy: { office: string; role: string }[] = [];
      for (const office of this.offices.values()) {
        for (const [roleId, role] of office.loaded.roles) {
          if (role.mcp.includes(id)) usedBy.push({ office: office.id, role: roleId });
        }
      }
      const meta = this.config.arms[id];
      return {
        id,
        label: meta?.label || id,
        ...(meta?.catalog ? { catalog: meta.catalog } : {}),
        config,
        secrets: meta?.secrets ?? [],
        ...(meta?.level ? { level: meta.level } : {}),
        // If any of this arm's credentials is a connected workspace ⇒ take
        // its label. Not found ⇒ draw nothing; making up a name is worse than
        // leaving it blank.
        ...(() => {
          const via = (meta?.secrets ?? []).map((s) => oauth[s]?.label).find(Boolean);
          return via ? { via } : {};
        })(),
        // Same lookup, one field further: which of this arm's credentials a
        // service has already refused. Named by the account's own label,
        // falling back to the credential name — an arm cannot be fixed by
        // someone who does not know WHICH sign-in to redo.
        ...(() => {
          const name = (meta?.secrets ?? []).find((s) => oauth[s]?.dead);
          return name ? { keyDead: oauth[name]?.label ?? name } : {};
        })(),
        toolCount: meta?.tools?.length ?? 0,
        usedBy,
        orphan: this.armHolders(id).length === 0,
      };
    });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ REUSE AN ARM ALREADY IN THE ROSTER — the whole package, CREDENTIALS         │
   * │ included. (bug, 08/25)                                                   │
   * │                                                                          │
   * │ User reported: plug Notion in under *Arms*, go to *Personal Assistant*      │
   * │ and click "reuse", get **401**. And the follow-up question was the right    │
   * │ one:                                                                     │
   * │   *"In theory any office should be able to share it?"* — CORRECT, and         │
   * │ this function is what makes it correct.                                    │
   * │                                                                          │
   * │ Why it was broken: the old "reuse" button **pasted the config** into the    │
   * │ "plug in manually" path (`setPaste(JSON.stringify(a.config))`). But the     │
   * │ config stored in the roster keeps a PLACEHOLDER                             │
   * │ `${NOTION_ACCESS_TOKEN}` — the credential lives in                          │
   * │ `.state/secrets.json`, by design. The "plug in manually" path has no          │
   * │ catalog entry ⇒ shows no credential field ⇒ sends no credential ⇒ the           │
   * │ header that reaches Notion is **literally `Bearer ${…}`** ⇒ 401.               │
   * │                                                                          │
   * │ And a second, quieter break: `secretNames` was `[]` at that point, and         │
   * │ CREDENTIAL NAMES ARE PART OF THE HASH (§armHash) ⇒ different hash ⇒ it            │
   * │ creates a SECOND arm with a duplicate config instead of reusing the                │
   * │ existing one. "Reuse" that duplicates.                                    │
   * │                                                                          │
   * │ ⇒ Identity travels as a whole package or not at all: config + credential      │
   * │ names + granted tools, all three pulled from the ROSTER, none of them              │
   * │ routed through the client.                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ `secrets` in the return value is the REAL VALUE — only meant to feed into
   * `probeArm`. It must NEVER leak into an HTTP response. Same rule as
   * `pickMcp`.
   */
  reuseArm(id: string): {
    config: Record<string, unknown>;
    secretNames: string[];
    tools: string[];
    label: string;
    catalog?: string;
    level?: 'read' | 'add' | 'full';
    secrets: Record<string, string>;
  } {
    const config = this.config.mcpServers[id];
    if (!config) {
      throw new RunError(
        t('co.armGoneFromList', { id }),
        'other',
      );
    }
    const meta = this.config.arms[id];
    const secretNames = meta?.secrets ?? [];
    // Reads only the exact credentials this arm declared — not the whole
    // store. `grantFor` is also where an empty string counts as MISSING, so a
    // corrupted stored credential shows up here instead of surfacing as a 401
    // from Notion.
    const { env } = grantFor(readSecrets(companyPaths(this.dir)), secretNames);
    return {
      config: config as Record<string, unknown>,
      secretNames,
      tools: meta?.tools ?? [],
      label: meta?.label || id,
      ...(meta?.catalog ? { catalog: meta.catalog } : {}),
      // The tier travels with the whole package — without it, `addArm` would
      // re-hash WITHOUT a tier and produce a different code, i.e. "reuse"
      // duplicates again. The exact bug §6i-bis, second door.
      ...(meta?.level ? { level: meta.level } : {}),
      secrets: env,
    };
  }

  /**
   * ARCHIVE / RESTORE an office (soft delete). → docs/SPEC-offices.md §3.1
   *
   * Only sets a flag in `office.yaml`. No files move, no code changes, nothing
   * touches `artifacts/` or the Assistant's session — so restoring means
   * coming back exactly as it was, including a conversation mid-thought.
   *
   * A running office must be Stopped first: archiving something that's
   * spending money is the surest way to have it keep spending with nobody
   * watching.
   */
  archiveOffice(officeId: string, archived: boolean): void {
    const office = this.get(officeId);
    if (archived && office.currentState === 'working') {
      throw new RunError(t('co.officeBusyStopFirst'), 'other');
    }
    // Restoring into a name collision with a living office would show two
    // identical-looking rows in the picker. Check here, before writing.
    if (!archived) this.assertNameFree(office.name, officeId);

    const file = office.loaded.paths.configFile;
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    if (archived) doc.set('archived', true);
    else doc.delete('archived');
    fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }), 'utf8');
    office.applyCompanyConfig(this.config);

    this.emit({
      type: 'company.offices',
      say: archived
        ? t('co.officeArchived', { name: office.name })
        : t('co.officeRestored', { name: office.name }),
      office: officeId,
      plan_id: null,
    });
  }

  /**
   * PERMANENTLY DELETE: `rm -rf` the whole directory, **and closes its cost
   * ledger too**. Workers, skills, the knowledge store, outputs, cost lines —
   * gone entirely from every report.
   *
   * Not recoverable. To keep history, use ARCHIVE — that's why it exists.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY DELETING AN OFFICE MUST ALSO CLOSE ITS LEDGER — bug reported by the      │
   * │ user 09/02.                                                              │
   * │                                                                          │
   * │ The previous version just `rm -rf`'d the directory and left                  │
   * │ `logs/usage.jsonl` alone. Two consequences, and the second is far heavier:      │
   * │                                                                          │
   * │  ① The cost table sat there showing *"14 entries no longer exist"* — a         │
   * │    user who wiped every office still saw money attributed to dead names.      │
   * │                                                                          │
   * │  ② 🔴 **A NEW OFFICE INHERITS A DEAD ONE'S LEDGER.** `createOffice` infers          │
   * │    the id FROM THE NAME (`folderId`), so deleting "Content" and recreating         │
   * │    "Content" produces the exact same `noi-dung`. The old lines instantly            │
   * │    match back onto the new office: `gone` turns off, the name displays as           │
   * │    the new name, and it arrives pre-loaded with dozens of turns plus a               │
   * │    dollar amount it never actually spent. No symptom except one wrong                 │
   * │    number — exactly the kind of lie this ledger is not allowed to tell.               │
   * │                                                                          │
   * │ No line gets rewritten: append a CUTOFF (`appendPurge`), and anyone                    │
   * │ reading the ledger truncates against it. → `usage.ts §PurgeRecord`                     │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  removeOffice(officeId: string): void {
    const office = this.offices.get(officeId);
    if (!office && !this.broken.has(officeId)) {
      throw new RunError(t('co.noOffice', { office: officeId }), 'other');
    }
    if (office?.currentState === 'working') {
      throw new RunError(t('co.officeBusyStopFirst'), 'other');
    }
    if (!isSafeId(officeId)) throw new RunError(t('co.officeIdInvalid'), 'other');

    this.offices.delete(officeId);
    this.broken.delete(officeId);
    fs.rmSync(path.join(this.paths.offices, officeId), { recursive: true, force: true });
    appendPurge(this.paths, officeId);
    this.emit({
      type: 'company.offices',
      say: t('co.officeDeleted', { id: officeId }),
      office: officeId,
      plan_id: null,
    });
  }

  /**
   * Sweep up the *"no longer exists"* entries left sitting in the ledger —
   * offices deleted BEFORE `removeOffice` knew how to close its own ledger,
   * plus the block of v0 records (from before offices existed).
   *
   * Only touches entries where **no living office** carries that id. A living
   * or archived office is never touched — this button isn't "delete my
   * history", it's a broom for exactly the junk currently showing on screen.
   */
  purgeGoneUsage(): { offices: number; tasks: number; costUSD: number } {
    const gone = this.costByOffice().filter((r) => r.gone);
    const at = new Date();
    for (const r of gone) appendPurge(this.paths, r.office, at);
    const out = {
      offices: gone.length,
      tasks: gone.reduce((n, r) => n + r.tasks, 0),
      costUSD: gone.reduce((n, r) => n + r.costUSD, 0),
    };
    if (out.offices > 0) {
      this.emit({
        type: 'company.offices',
        // A COMPANY-level event: belongs to no office (`history(id)` filters
        // on this field, so tagging it with some random id would make it show
        // up in someone else's log).
        say: t('co.ledgerPurged', { n: String(out.offices) }),
        office: '',
        plan_id: null,
      });
    }
    return out;
  }

  // ── events

  on(fn: (e: AgentEvent) => void): () => void {
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }

  emit(e: AgentEvent): void {
    this.recent.push(e);
    if (this.recent.length > 300) this.recent.shift();
    this.bus.emit('event', e);
  }

  /** A ring buffer so a client that connects late can still see what just happened. */
  history(officeId?: string): AgentEvent[] {
    return officeId ? this.recent.filter((e) => e.office === officeId) : [...this.recent];
  }

  // ── cost: one ledger for the whole company

  costReport(sinceMs?: number, officeId?: string): CostReport {
    return summarize(this.usageRecords(sinceMs, officeId));
  }

  costText(sinceMs?: number, officeId?: string): string {
    return formatReport(this.costReport(sinceMs, officeId));
  }

  /**
   * Cost broken down by office — to see which office is eating the budget.
   *
   * `gone: true` = the office is no longer on disk (permanently deleted), or
   * the record predates the office concept (v0, empty `office` column). The
   * UI collapses these lines into a collapsible block — **merged for
   * DISPLAY, not merged as DATA**: the list doesn't grow with every deleted
   * office, but expanding it still shows every line and every code
   * individually. Summing them into one "deleted" blob would lose the code,
   * and the code is the only remaining clue to where the money went.
   */
  costByOffice(sinceMs?: number): Array<{
    office: string;
    name: string;
    tasks: number;
    costUSD: number;
    turns: number;
    archived: boolean;
    gone: boolean;
  }> {
    const LEGACY = '';
    /**
     * Collapse through the RENAME table before summing. → `usage.ts §renameChain`
     *
     * Without this line, renaming `bao-cao` → `kiem-ke` would split the ledger
     * into two entries: a brand-new "kiem-ke" entry, and a "bao-cao" entry
     * marked `gone` — telling the user they have a deleted office, when all
     * they did was rename it. Exactly the kind of lie this ledger is not
     * allowed to tell.
     */
    const chain = renameChain(this.paths);
    const byOffice = new Map<string, { tasks: number; costUSD: number; turns: number }>();
    for (const r of this.usageRecords(sinceMs)) {
      const key = (r.office && (chain.get(r.office) ?? r.office)) || LEGACY;
      const e = byOffice.get(key) ?? { tasks: 0, costUSD: 0, turns: 0 };
      e.tasks++;
      e.costUSD += r.cost_usd;
      e.turns += r.turns ?? 0;
      byOffice.set(key, e);
    }
    return [...byOffice.entries()]
      .map(([office, v]) => {
        const live = this.offices.get(office);
        return {
          office,
          // Tell the truth for each case: a deleted old code shows THE CODE
          // (the only clue left); a v0 record says explicitly that it predates
          // offices existing, rather than calling it "deleted" — no office was
          // ever deleted there.
          name: live?.name ?? (office === LEGACY ? t('co.beforeOfficesSplit') : office),
          ...v,
          archived: live?.archived ?? false,
          gone: !live,
        };
      })
      .sort((a, b) => b.costUSD - a.costUSD);
  }

  /**
   * Cost records, filtered by office if given.
   *
   * ⚠ The filter must also accept the OLD, renamed-away id. Without this,
   * `agentco cost --office kiem-ke` would return exactly what was spent AFTER
   * the rename, with all history before it gone without a trace — a user
   * sees an office that's run for two months while the ledger shows two days.
   * → `usage.ts §renameChain`
   */
  private usageRecords(sinceMs?: number, officeId?: string): UsageRecord[] {
    const all = readUsage(this.paths, sinceMs);
    if (!officeId) return all;
    const chain = renameChain(this.paths);
    return all.filter((r) => r.office === officeId || chain.get(r.office ?? '') === officeId);
  }
}

// ─────────────────────────────────────────────────────────── templates

/**
 * ⚠ NO COMMENTS. → the box on `companyTemplate` in `src/cli/index.ts`
 *
 * `display_name` is deliberately absent rather than empty: absent means "nobody
 * named this assistant", and the interface then shows a label in the chosen
 * language. The moment a person types a name the key gets written and it is
 * their datum, never translated again.
 */
/**
 * ⚠ `id` IS QUOTED, for the same reason `name` beside it always was: an office
 * named "1" slugs to `1`, and unquoted that is a NUMBER when the file is read
 * back — the schema then rejects it and the whole office fails to load, which
 * is worse than the employee case (a role is skipped; an office throws).
 * → `config.ts §loadOffice`
 */
function officeTemplate(id: string, name: string): string {
  return `id: ${JSON.stringify(id)}
name: ${JSON.stringify(name)}
charter_file: charter.md

assistant:
  avatar: "★"
  default_deliver: file
  mcp: []
`;
}

/*
 * `assistantSkillsDefault()` was REMOVED ENTIRELY on 05/09 — the same fate,
 * for a neighbouring reason, as `charterTemplate()` below.
 *
 * It read `t('seed.assistantSkills.body')` and wrote the result into the new
 * office's `skills/assistant.md`. The argument for letting it through the
 * catalogue was that seed content becomes the user's own datum the moment it
 * lands. True — and that is precisely why it was the wrong thing to write:
 * the file it produced then sat in the cached prefix of every chat turn,
 * holding the only language in the entire prompt. → the box at `newOffice`
 */

/*
 * `charterTemplate()` was REMOVED ENTIRELY on 08/17 — not replaced with
 * anything.
 *
 * It used to write `knowledge/shared/_charter.md` upfront with full
 * frontmatter and an empty body, so the charter was both a prompt layer and a
 * knowledge node at once. That was the root of three bugs the user hit at
 * once (see `charter_file` in `types.ts` and `migrateCharters()` in
 * `migrate.ts`).
 *
 * The charter is now `charter.md` at the office root, plain markdown, and
 * **only comes into existence once the user saves for the first time**. No
 * default file at all: an empty file that exists just "to have something
 * there" is one more line in the directory that nobody can explain.
 */



