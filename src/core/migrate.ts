/**
 * Migration from v0 to multiple offices. → docs/SPEC-offices.md §7
 *
 * v0 kept `roles/` directly under `company/`. This version keeps it at
 * `offices/<id>/roles/`.
 *
 * Done AUTOMATICALLY, without asking. This is a change of folder shape WE caused
 * by upgrading the software, not a decision the user made — asking "would you
 * like to migrate?" makes them accountable for something they did not cause, and
 * an answer of "no" leads nowhere anyway.
 *
 * The rule: MOVE ONLY, never edit the contents of any file. Anything unexpected
 * means stopping and leaving things as they are — losing one upgrade beats
 * losing data.
 */

import fs from 'node:fs';
import path from 'node:path';

import { companyPaths, officePaths } from './paths.js';
import { t } from '../i18n/index.js';

const DEFAULT_OFFICE = 'van-phong-chinh';

/** The v0 entries that belong to an OFFICE, not to the company. */
const OFFICE_ENTRIES = [
  'roles',
  'skills',
  'knowledge',
  'artifacts',
  'tasks',
  'connectors',
  'layout.json',
];

export function migrateIfNeeded(companyDir: string): void {
  const pp = companyPaths(companyDir);
  if (!fs.existsSync(pp.configFile)) return;

  // Runs BEFORE the v0 migration and independently of it: the charter has to
  // leave the knowledge store in EVERY company, including ones that moved to the
  // multi-office layout long ago.
  migrateCharters(pp.offices);
  migrateTasksIntoState(pp.offices);

  // The sign of a leftover v0 layout: any office-level entry sitting at company level.
  const leftovers = OFFICE_ENTRIES.filter((e) => fs.existsSync(path.join(companyDir, e)));
  if (leftovers.length === 0) return;

  const target = path.join(pp.offices, DEFAULT_OFFICE);
  fs.mkdirSync(target, { recursive: true });

  // ONE ENTRY AT A TIME, each idempotent on its own. Windows holds file locks
  // (antivirus, indexer, a process that just exited), so a rename failing
  // part-way through is something that WILL happen — and the next run has to
  // continue from where it stopped rather than give up because "both layouts
  // exist".
  const failed: string[] = [];
  for (const entry of leftovers) {
    const from = path.join(companyDir, entry);
    const to = path.join(target, entry);
    if (fs.existsSync(to)) {
      // The target exists: a genuine conflict. Leave both, report it, guess nothing.
      failed.push(`${entry} (already present under offices/${DEFAULT_OFFICE}/)`);
      continue;
    }
    if (!moveWithRetry(from, to)) failed.push(entry);
  }

  // v0's .state mixed two things: the daemon (company-level) and the assistant's
  // session (office-level). Split them to the right places, renaming to match
  // the current terminology.
  const oldState = path.join(companyDir, '.state');
  const newState = officePaths(target).state;
  if (fs.existsSync(oldState)) {
    fs.mkdirSync(newState, { recursive: true });
    for (const [from, to] of [
      ['master-session.json', 'assistant-session.json'],
      ['pending.json', 'pending.json'],
    ]) {
      const src = path.join(oldState, from!);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(newState, to!));
    }
  }

  // v0's company.yaml carried charter_file — it belongs to office.yaml now.
  const officeCfg = officePaths(target).configFile;
  if (!fs.existsSync(officeCfg)) {
    fs.writeFileSync(
      officeCfg,
      `id: ${DEFAULT_OFFICE}\nname: "${t('seed.mainOfficeName')}"\ncharter_file: charter.md\n\n` +
        `assistant:\n  display_name: "${t('seed.assistantName')}"\n  avatar: "★"\n  mcp: []\n`,
      'utf8',
    );
  }

  // v0's layout.json called the director node "master"; it is "assistant" now.
  renameMasterNode(path.join(target, 'layout.json'));

  // A second time, and it is NOT redundant: the first pass above ran while
  // `knowledge/` was still at company level, so it saw no charter. It is inside
  // the office now. The function is idempotent, so calling it twice costs
  // nothing.
  migrateCharters(pp.offices);
  // Same reason: the v0 company's `tasks/` was just moved into the office above,
  // and it landed in the OLD shape (directly under the office root). It has to
  // be hidden away once more.
  migrateTasksIntoState(pp.offices);

  if (failed.length) {
    process.emitWarning(
      `Migration incomplete. Could not move: ${failed.join(', ')}.\n` +
        `Usually a locked file (antivirus, or an old daemon still running).\n` +
        `Run \`agentco stop\` and open it again — whatever moved stays moved, the next run picks up from there.`,
    );
    return;
  }

  console.log(
    `Moved the company onto the multi-office layout.\n` +
      `  Everything that was there now lives under offices/${DEFAULT_OFFICE}/\n` +
      `  No file had its contents changed.`,
  );
}

/**
 * `tasks/` → `.state/tasks/`. → `OfficePaths.tasks`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS MIGRATION IS PART OF THE FIX, NOT TIDYING UP.                        │
 * │                                                                           │
 * │ The guard is the leading dot: `Grep`/`Glob` do not descend into hidden    │
 * │ directories. Any office still holding `tasks/` at its root is one that    │
 * │ guard DOES NOT COVER — and those are precisely the offices with real      │
 * │ plans and logs to wander into. Without the move, the fix only holds for   │
 * │ offices created after today.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent per office, and one broken office does not block the others. When
 * the target already exists, MERGE file by file rather than giving up: a move
 * failing part-way on Windows (antivirus holding a lock) is something that WILL
 * happen, and the next run has to continue from where it stopped.
 */
function migrateTasksIntoState(officesDir: string): void {
  if (!fs.existsSync(officesDir)) return;
  for (const entry of fs.readdirSync(officesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const office = path.join(officesDir, entry.name);
    const from = path.join(office, 'tasks');
    if (!fs.existsSync(from)) continue;
    const to = officePaths(office).tasks;

    try {
      if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (moveWithRetry(from, to)) continue;
      }
      // Target exists (or renaming the whole directory failed): move file by
      // file, then drop the empty shell.
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) {
        const dest = path.join(to, f);
        // Do NOT overwrite: the copy in `.state/` is the newer one. Leaving the
        // old one where it is beats overwriting a plan that is still running.
        if (fs.existsSync(dest)) continue;
        moveWithRetry(path.join(from, f), dest);
      }
      if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
    } catch (err) {
      process.emitWarning(
        `Could not move tasks/ of office "${entry.name}" into .state/: ${
          err instanceof Error ? err.message : String(err)
        }. The work log still runs; rerun \`agentco start\` once the old daemon is fully stopped.`,
      );
    }
  }
}

/**
 * The charter moves from `knowledge/shared/_charter.md` → `charter.md` at the
 * office root.
 *
 * → docs/SPEC-library.md §17
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY MOVE IT RATHER THAN PATCH IN PLACE                                   │
 * │                                                                          │
 * │ Living in `knowledge/` made the charter both "the About-this-office      │
 * │ prompt layer" AND "a node in the Knowledge drawer". TWO windows, TWO     │
 * │ write paths, NO link — and users hit all three consequences:             │
 * │                                                                          │
 * │  · a ghost node in the drawer they never created and cannot explain      │
 * │  · deleting that node (reasonably!) then editing the prompt layer → the  │
 * │    file gets rewritten WITHOUT frontmatter → it quietly stops being a    │
 * │    knowledge node, while the prompt still works so nothing complains     │
 * │  · it competed in COLD, so it accrued `hits` and got rendered ONE MORE   │
 * │    TIME — while the charter body was ALREADY in the prefix. Paying twice │
 * │    for the same paragraph, the second time at full price.                │
 * │                                                                          │
 * │ Patching each symptom means remembering all three places forever. Moving │
 * │ it makes all three vanish at once, and makes the invariant "only agents  │
 * │ write to the knowledge store" true.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent per office: any number of reruns give the same result, and one
 * broken office does not block the rest.
 */
export function migrateCharters(officesDir: string): void {
  if (!fs.existsSync(officesDir)) return;
  for (const entry of fs.readdirSync(officesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(officesDir, entry.name);
    const oldFile = path.join(dir, 'knowledge', 'shared', '_charter.md');
    const newFile = path.join(dir, 'charter.md');
    try {
      if (fs.existsSync(oldFile)) {
        // Keep the BODY only. Frontmatter is knowledge-store metadata — the
        // thing the charter is leaving — so carrying it along would carry
        // exactly what was just decided against.
        const body = stripFrontmatter(fs.readFileSync(oldFile, 'utf8'));
        // If the target has content, do NOT overwrite: that is what the user
        // wrote after migrating, and the old copy may not take its place.
        const targetEmpty = !fs.existsSync(newFile) || fs.readFileSync(newFile, 'utf8').trim() === '';
        if (targetEmpty && body) fs.writeFileSync(newFile, `${body}\n`, 'utf8');
        fs.rmSync(oldFile, { force: true });
      }
      pointCharterFileAt(path.join(dir, 'office.yaml'));
    } catch (err) {
      process.emitWarning(
        `Could not move the charter of office "${entry.name}": ${(err as Error).message}. ` +
          `The office still runs; rerun \`agentco start\` to try again.`,
      );
    }
  }
}

/**
 * An old `office.yaml` names the old path outright. Left alone, zod reads exactly
 * the path that was just removed and the charter silently becomes empty.
 *
 * Replaced by a regex on ONE line rather than parsing and rewriting the file:
 * rewriting loses the comments and the key order the user arranged.
 */
function pointCharterFileAt(officeYaml: string): void {
  if (!fs.existsSync(officeYaml)) return;
  const raw = fs.readFileSync(officeYaml, 'utf8');
  if (!/^charter_file:\s*knowledge\/shared\/_charter\.md\s*$/m.test(raw)) return;
  fs.writeFileSync(
    officeYaml,
    raw.replace(/^charter_file:\s*knowledge\/shared\/_charter\.md\s*$/m, 'charter_file: charter.md'),
    'utf8',
  );
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/**
 * Move one entry. Try rename first (fast, atomic); if Windows refuses, copy then
 * delete. The source is removed ONLY after the copy succeeds — leaving litter
 * behind beats losing data.
 */
function moveWithRetry(from: string, to: string): boolean {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(from, to);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EXDEV' && code !== 'ENOTEMPTY') return false;
      if (attempt < 2) {
        sleep(120);
        continue;
      }
      try {
        fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(from, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** A synchronous wait — migration runs before there is any event loop worth yielding to. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameMasterNode(file: string): void {
  if (!fs.existsSync(file)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      nodes?: Array<{ id: string; kind: string }>;
      edges?: Array<{ from: string; to: string }>;
    };
    const swap = (id: string): string => (id === 'master' ? 'assistant' : id);
    for (const n of raw.nodes ?? []) {
      if (n.id === 'master') {
        n.id = 'assistant';
        n.kind = 'assistant';
      }
    }
    for (const e of raw.edges ?? []) {
      e.from = swap(e.from);
      e.to = swap(e.to);
    }
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  } catch {
    // layout.json is only view state — if it is broken, delete it and the canvas
    // lays itself out again.
    fs.rmSync(file, { force: true });
  }
}
