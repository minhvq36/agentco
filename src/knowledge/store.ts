/**
 * Knowledge store: scan, index, retrieve.
 *
 * → docs/SPEC-2026-08-14-agentco.md §5
 *
 * RETRIEVAL COSTS 0 TOKENS. No embeddings in v0: that would add an API with a
 * standing cost, an extra dependency, and an extra place to break — while
 * keywords + a link graph are enough at a scale of a few hundred nodes. If
 * measurement ever shows that's not enough, v2 uses embeddings run LOCALLY, not
 * through an API.
 *
 * Two tiers, and this is the easiest place to get it wrong:
 *   HOT  — a role's top-N frequently-used nodes, sit INSIDE the prefix cache, nearly free
 *   COLD — nodes selected per task, sit AFTER the cache breakpoint, pay full price
 * Stuffing task-specific knowledge into the prefix = the prefix changes every
 * task = 100% cache miss, worse than caching nothing at all.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { OfficePaths } from '../core/paths.js';
import { estimateTokens } from '../core/tokens.js';
import { keywordsOf, readNodeFile, tokenize, writeNodeFile, type KnowledgeNode } from './node.js';

export interface IndexEntry {
  id: string;
  file: string;
  title: string;
  tags: string[];
  links: string[];
  scope: string;
  tokens: number;
  hits: number;
  pinned: boolean;
  confidence: number;
  /** Last time it matched a task. Empty = never. → node.ts */
  last_used?: string;
  keywords: string[];
}

export class KnowledgeStore {
  private byId = new Map<string, IndexEntry>();
  private nodeCache = new Map<string, KnowledgeNode>();
  /**
   * Nodes superseded by another node. Rebuilt every `scan()`.
   *
   * Kept in memory rather than flagged on the superseded file: a superseded
   * node must NOT be edited. The relationship belongs to the NEW node (it
   * declares `supersedes`), so deleting the new node makes the relationship
   * vanish and the old node comes back to life — exactly what we want, with
   * no cleanup step needed.
   */
  private superseded = new Set<string>();

  constructor(
    private companyDir: string,
    private paths: OfficePaths,
  ) {}

  /** After reloading the office from disk. */
  rebind(dir: string, paths: OfficePaths): void {
    this.companyDir = dir;
    this.paths = paths;
  }

  /** Rescan the entire knowledge/ directory and write index.json. */
  scan(): void {
    this.byId.clear();
    this.nodeCache.clear();
    this.superseded.clear();

    for (const dir of [this.paths.knowledgeShared, this.paths.knowledgeAgents]) {
      if (!fs.existsSync(dir)) continue;
      for (const abs of walk(dir)) {
        const rel = path.relative(this.companyDir, abs).replace(/\\/g, '/');
        const node = readNodeFile(this.companyDir, rel);
        if (!node) continue;

        // DELIBERATELY no warning for a long node. Tokens here are a rough
        // estimate (character count / n), and `hot_knowledge_tokens` already
        // caps the thing that actually matters — the total added to the
        // prefix, not any one node. A node that runs a few dozen tokens
        // longer but carries more information is a net gain, and a warning
        // line nobody reads just adds log noise.
        this.byId.set(node.id, {
          id: node.id,
          file: node.file,
          title: node.title,
          tags: node.tags,
          links: node.links,
          scope: node.scope,
          tokens: node.tokens,
          hits: node.hits,
          pinned: node.pinned,
          confidence: node.confidence,
          ...(node.last_used ? { last_used: node.last_used } : {}),
          keywords: keywordsOf(node),
        });
        this.nodeCache.set(node.id, node);
        for (const dead of node.supersedes) this.superseded.add(dead);
      }
    }
    // Build the superseded set only AFTER the scan finishes: the superseding
    // node may sit in a file scanned after the one it supersedes, so this
    // can't be decided mid-walk.
    this.writeIndex();
  }

  /** A superseded node — the file still exists, it just no longer loads into the prompt. */
  isSuperseded(id: string): boolean {
    return this.superseded.has(id);
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): KnowledgeNode | undefined {
    return this.nodeCache.get(id);
  }

  /**
   * Number of notes in each role's PRIVATE NOTEBOOK (`knowledge/agents/<role>/`).
   * This is the `📒 n` count on an agent node — what distinguishes shared
   * knowledge (a knowledge node in the middle of the canvas) from an agent's
   * own private experience.
   */
  notesByRole(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.byId.values()) {
      if (!e.scope.startsWith('role:')) continue;
      const role = e.scope.slice('role:'.length);
      out[role] = (out[role] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Browse the store for the knowledge drawer. Reads from the index — 0 tokens.
   *
   * Returns superseded nodes TOO, tagged with a `superseded` flag. Hiding them
   * means a user who opens the folder finds files that aren't in the UI;
   * showing them without labeling means they see three identical "Memory"
   * copies and think the system is duplicating junk. Show + label is the only
   * option that doesn't lie.
   */
  list(): Array<IndexEntry & { superseded: boolean; body: string; updated: string }> {
    return [...this.byId.values()]
      .map((e) => ({
        ...e,
        superseded: this.superseded.has(e.id),
        body: this.nodeCache.get(e.id)?.body ?? '',
        updated: this.nodeCache.get(e.id)?.updated ?? '',
      }))
      .sort(
        (a, b) =>
          Number(a.superseded) - Number(b.superseded) ||
          b.hits - a.hits ||
          a.scope.localeCompare(b.scope) ||
          a.title.localeCompare(b.title),
      );
  }

  /** Edit a node's body. Returns false if that node doesn't exist. */
  editNode(id: string, body: string): boolean {
    const node = this.nodeCache.get(id);
    if (!node) return false;
    node.body = body.trim();
    node.tokens = estimateTokens(node.body);
    node.updated = new Date().toISOString().slice(0, 10);
    writeNodeFile(this.companyDir, node);
    return true;
  }

  /** Permanently delete a node from disk. */
  removeNode(id: string): boolean {
    const node = this.nodeCache.get(id);
    if (!node) return false;
    fs.rmSync(path.join(this.companyDir, node.file), { force: true });
    return true;
  }

  /**
   * Permanently delete every node that another node has superseded. Returns
   * the titles of the ones dropped.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ SPLIT FROM `pruneStale` BECAUSE THESE ARE TWO DIFFERENT THINGS.          │
   * │                                                                          │
   * │   pruneStale     — AGING: "nobody has used this in a while". Has a day   │
   * │                    threshold, and a user can turn it off                 │
   * │                    (`prune_after_days: 0`).                              │
   * │   dropSuperseded — REPLACEMENT: "a newer version of this already         │
   * │                    exists". Has nothing to do with dates, and must NOT   │
   * │                    be turned off.                                        │
   * │                                                                          │
   * │ Merging these into one gate is a bug we've hit: turn off aging and a     │
   * │ superseded node becomes immortal too, and the user sees two identical    │
   * │ "Memory" entries in the Knowledge drawer and has to guess which one is   │
   * │ actually in effect.                                                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The earlier stance was to KEEP the superseded file "in case it's needed
   * later". Dropped that stance — the end user never reads it again, they
   * just see a drawer full of duplicates and a long explanation of an internal
   * mechanism they don't need to know about. The trail still lives in the
   * right place: `git`, and folder backups.
   *
   * Safe because `superseded` is only ever set when the superseding node still
   * exists — it's rebuilt on every `scan()` from the live node's own
   * `supersedes` field. There's no case of "delete the old version, then find
   * the new one has vanished too".
   *
   * ⚠ CALL AFTER `scan()`. A node just written to disk isn't in `superseded`
   * until the next scan — that's the other half of this bug.
   */
  dropSuperseded(): string[] {
    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      if (!this.superseded.has(e.id)) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    return dropped;
  }

  /**
   * Prune OLD notes that NOBODY HAS USED. Runs on every memory compaction.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WHY THIS EXISTS, AND WHY IT'S NOT ENOUGH ON ITS OWN                      │
   * │                                                                          │
   * │ Without it the store only GROWS. `supersedes` handles the "decision got  │
   * │ reversed" case, but most junk isn't reversed — it simply stops being     │
   * │ relevant, and nobody ever declares that.                                 │
   * │                                                                          │
   * │ ⚠ `hits` is only trustworthy once the store is BIGGER than               │
   * │ `hot_knowledge_size`. Below that threshold every node loads on every     │
   * │ turn, so `hits` is nearly uniform and filtering on it is filtering on    │
   * │ noise. That's why the condition is AND, not OR: a node must be both old  │
   * │ AND never used.                                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Leaves ALONE: `pinned` nodes, MEMORY nodes (user-committed), and nodes
   * just superseded in this very compaction. Deletes outright rather than
   * archiving — these are agent-generated notes nobody has ever read, and
   * keeping them just spawns a second store that also needs cleaning.
   */
  pruneStale(maxAgeDays: number, archivedRoles: ReadonlySet<string> = new Set()): string[] {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      if (e.pinned) continue;

      /**
       * AN ARCHIVED ROLE'S NOTEBOOK IS EXEMPT — otherwise "archiving is
       * reversible" is a promise with a 15-day expiry date.
       *
       * An archived worker NEVER runs, so its `last_used` sits frozen forever
       * and every one of its notes is guaranteed to fall through the aging
       * window. Archive someone for two weeks and bring them back, and they
       * come back having silently lost all their experience — exactly what
       * `archiveAgent` promises won't happen.
       *
       * This is the flip side of the aging window (§5e): it's STATELESS,
       * which makes it durable, but for the same reason it can't tell
       * "no longer relevant" apart from "currently on leave". That
       * distinction is made right here, with a flag we already have.
       */
      if (e.scope.startsWith('role:') && archivedRoles.has(e.scope.slice('role:'.length))) continue;

      /**
       * An ALREADY-SUPERSEDED node: delete it outright, no need to wait out
       * the age threshold.
       *
       * It's already been replaced by a new node that CONTAINS the merged
       * content — keeping it "for reference" is keeping junk: the user opens
       * the drawer, sees three identical "Memory" entries, and has to guess
       * which one is actually in effect.
       *
       * Safe because `superseded` is only ever set when the superseding node
       * still exists (rebuilt on every `scan()` from the live node's own
       * `supersedes` field). There's no case of "delete the old version, then
       * find the new one has vanished too".
       */
      if (this.superseded.has(e.id)) {
        if (this.removeNode(e.id)) dropped.push(e.title);
        continue;
      }

      // Conversation memory is exempt: it gets REPLACED by a later compaction,
      // not pruned by age. If a user settles something and doesn't mention it
      // again for three weeks, it's still in effect.
      if (this.isMemory(e)) continue;

      /**
       * WINDOW-BASED AGING, even when `hits > 0`.
       *
       * An earlier version skipped every node with `hits > 0` — meaning a node
       * used EXACTLY ONCE, ages ago, stayed immortal. The pruning mechanism
       * almost never fired.
       *
       * The yardstick is `last_used` (last time it matched a task), falling
       * back to `updated` when unset: a node just created or just edited by
       * the user gets a full window's grace — a touch buys it more life.
       */
      const node = this.nodeCache.get(e.id);
      if (!node) continue;
      const at = Date.parse(node.last_used ?? node.updated);
      if (!Number.isFinite(at) || at > cutoff) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    return dropped;
  }

  /**
   * A role's HOT knowledge: its most-used nodes, sitting in the prefix cache.
   * Recomputed only when knowledge_version bumps — NOT recomputed every task,
   * or the prefix keeps changing and the cache becomes meaningless.
   */
  hot(roleId: string, count: number, tokenBudget: number): { text: string; ids: string[] } {
    const scoped = this.visible(roleId);
    const ranked = scoped
      /**
       * ⚠ The old reason for this line ("pinned already lives in the charter")
       * STOPPED BEING TRUE on 08/17: the charter left `knowledge/`
       * (→ SPEC-library.md §17), and it was the only `pinned` node that ever
       * existed.
       *
       * Keeping the behavior anyway because there is currently NO path that
       * sets `pinned: true` — all three `add*` functions write `false`, the UI
       * has no button for it, only a manual file edit can set it. Changing the
       * semantics of a flag nobody uses buys risk for nothing.
       *
       * If a "pin this note" button gets built later: pinned must mean ALWAYS
       * in HOT (and `cold()` must then exclude it, or it renders twice for the
       * same task — the exact trap the charter just stepped in).
       */
      .filter((e) => !e.pinned)
      // MEMORY entries travel in their own block (`assistantMemoryText`), they
      // do NOT queue up here. Two reasons, both matter:
      //  1. It's something the USER committed — it must never drop out of the
      //     top-N and silently disappear as the store grows, the way a
      //     self-derived lesson is allowed to.
      //  2. Not excluding it here means it sits in BOTH blocks, and the
      //     layered prompt table counts it twice — the user sees exactly that
      //     and thinks the system is repeating itself redundantly.
      .filter((e) => !this.isMemory(e))
      .sort((a, b) => b.hits - a.hits || b.confidence - a.confidence || a.id.localeCompare(b.id))
      .slice(0, count);
    return this.render(ranked, tokenBudget);
  }

  /**
   * COLD knowledge: selected by task content. Sits after the cache breakpoint
   * so it pays full price — which is why the cap has to be tight.
   */
  cold(
    roleId: string,
    queryText: string,
    tokenBudget: number,
    excludeIds: readonly string[] = [],
  ): { text: string; ids: string[]; matched: string[] } {
    const exclude = new Set(excludeIds);
    const terms = new Set(tokenize(queryText));
    if (terms.size === 0) return { text: '', ids: [], matched: [] };

    /**
     * Score EVERY visible node, WITHOUT excluding HOT ones — HOT gets excluded
     * later, at render time.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ WHY "MATCHES THE TASK" MUST BE SPLIT FROM "GETS RENDERED"            │
     * │                                                                      │
     * │ `matched` is the MATCHES-THE-TASK signal; `ids` is what actually     │
     * │ enters the prompt. Collapse the two into one and a HOT node can      │
     * │ NEVER record `last_used` — it gets excluded before it's ever scored. │
     * │                                                                      │
     * │ Measured consequence: a 5-node store with `hot_knowledge_size: 8`    │
     * │ means HOT takes everything, COLD is always empty, no node ever gets  │
     * │ a `last_used`, and 15 days later **the entire store is dead** — even │
     * │ the nodes being loaded on every single call.                         │
     * │                                                                      │
     * │ Splitting them makes both numbers correct AT ANY STORE SIZE:         │
     * │  · a HOT node that actually matched a task → gets `last_used` → lives│
     * │  · a HOT node that never matched anything → dies on schedule, and    │
     * │    deserves to: it's sitting in every call's prefix contributing     │
     * │    nothing.                                                          │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const scored = this.visible(roleId)
      .map((e) => ({ e, score: this.score(e, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const rendered = this.render(
      scored.filter((x) => !exclude.has(x.e.id)).map((x) => x.e),
      tokenBudget,
    );
    return { ...rendered, matched: scored.map((x) => x.e.id) };
  }

  /**
   * A role's PRIVATE notebook. Only that role reads it.
   * No dedup yet — that's the Librarian's job (M1).
   *
   * Also runs through `echoesLibrary`: a worker that just finished reading a
   * document is exactly when it's most likely to copy a sentence out of it.
   * But does NOT run through `worthLearning` — unlike the Assistant, the
   * worker actually DID the work and read the file, so its lesson is a
   * firsthand account, not hearsay. That's also why it holds `confidence`
   * 0.6, higher than a shared lesson's 0.55.
   */
  addLesson(
    roleId: string,
    text: string,
    source: string,
    docs: readonly string[] = [],
    dependsOn: readonly string[] = [],
  ): KnowledgeNode | undefined {
    if (this.rejectLesson(text, docs, `role:${roleId}`, `the lesson from "${roleId}"`)) return undefined;

    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const node: KnowledgeNode = {
      id: `k/agents/${roleId}/${slug}`,
      type: 'pitfall',
      title: text.slice(0, 60),
      tags: [roleId],
      links: [],
      scope: `role:${roleId}`,
      author: `role:${roleId}`,
      confidence: 0.6,
      hits: 0,
      pinned: false,
      supersedes: [],
      updated: new Date().toISOString().slice(0, 10),
      // Documents the worker ACTUALLY read during this task. Observed, not
      // self-reported — same rule as `landed`. Delete one of them and the node
      // goes with it.
      ...(dependsOn.length ? { depends_on: [...dependsOn] } : {}),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/agents/${roleId}/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /**
   * THREE NETS before a lesson gets written. Returns `true` meaning REJECTED.
   *
   * Ordered by decreasing certainty — the surest net runs first so a weaker
   * net never has to carry a case it can't:
   *
   *   1. A NUMBER matching a document  → almost certainly knowledge, not a way of working
   *   2. A DUPLICATE of an old node    → an exact comparison, not a guess
   *   3. WORD OVERLAP with a document  → `echoesLibrary`, the coarsest net, prone to misses
   *
   * Every rejection SPEAKS UP. A silent filtering mechanism is one nobody can
   * audit, and the day it blocks something wrongly, nobody knows why the
   * store stopped growing.
   */
  private rejectLesson(text: string, docs: readonly string[], scope: string, who: string): boolean {
    const digit = quotesLibraryNumber(text, docs);
    if (digit) {
      process.emitWarning(
        `Dropped ${who} because it copied the NUMBER "${digit}" out of a document: ${text.slice(0, 60)}… ` +
          `A lesson records HOW TO WORK, not knowledge — figures belong to the document cabinet.`,
      );
      return true;
    }

    const twin = this.findTwin(text, scope);
    if (twin) {
      /**
       * A DUPLICATE EARNS A VOTE, IT DOESN'T GET THROWN AWAY.
       *
       * A repeated lesson is EVIDENCE it's real, not junk. `hits` is exactly
       * the ranking ladder into HOT, so turning a duplicate into a vote both
       * blocks spam and pushes the correct node further up — far cheaper than
       * spawning a second node and waiting for the Librarian to merge it.
       *
       * It also makes that node YOUNGER AGAIN (`recordHits` writes
       * `last_used`), so a lesson that's still correct won't get swept away
       * by the aging window.
       */
      this.recordHits([twin.id]);
      process.emitWarning(
        `Dropped ${who} as a duplicate of an existing note ("${twin.title}") — counted a hit on the old one instead.`,
      );
      return true;
    }

    const echo = echoesLibrary(text, docs);
    if (echo) {
      process.emitWarning(
        `Dropped ${who} because it repeats the document "${echo}": ${text.slice(0, 60)}… ` +
          `Document contents live in the cabinet, not in the knowledge store.`,
      );
      return true;
    }

    return false;
  }

  /**
   * A SAME-SCOPE node saying nearly the same thing. `undefined` = none found.
   *
   * Jaccard over the significant-word set: symmetric, no bias toward long
   * sentences, and **deterministic** — no model call, runs anywhere, anytime.
   *
   * Only compares within the same scope: a `nguoi-viet` lesson and a
   * shared-store one that say the same thing are NOT a duplicate — they enter
   * the prefix of two different audiences, and merging them loses one of the
   * two.
   */
  private findTwin(text: string, scope: string): IndexEntry | undefined {
    if (new Set(tokenize(text)).size < 3) return undefined;
    for (const e of this.byId.values()) {
      if (e.scope !== scope || this.superseded.has(e.id)) continue;
      const body = this.nodeCache.get(e.id)?.body ?? '';
      if (twinScore(text, body) >= TWIN_RATIO) return e;
    }
    return undefined;
  }

  /**
   * CASCADE DELETE: a file disappears → every node that declared a dependency
   * on it disappears too. → `KnowledgeNode.depends_on`
   *
   * Called from the actual point a file gets deleted (`LibraryStore.remove`),
   * not from a periodic scan job. A periodic scan means there's a time window
   * where the orphaned node still sits in every worker's prefix and is still
   * being followed — and nobody can audit how long that window runs.
   *
   * Returns the titles of the dropped nodes, so the caller can announce it.
   * Silently deleting something the user can see in the Knowledge drawer is
   * exactly the "lost work, silently" failure class.
   */
  dropDependents(removedPaths: readonly string[]): string[] {
    const gone = new Set(removedPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')));
    if (gone.size === 0) return [];

    const dropped: string[] = [];
    for (const e of [...this.byId.values()]) {
      const deps = this.nodeCache.get(e.id)?.depends_on ?? [];
      // ANY, not ALL: advice that's half-correct is more dangerous than no
      // advice at all, because nobody knows which half broke.
      if (!deps.some((d) => gone.has(d))) continue;
      if (this.removeNode(e.id)) dropped.push(e.title);
    }
    if (dropped.length) this.scan();
    return dropped;
  }

  /**
   * The office's SHARED store — the whole office reads it.
   *
   * Only the Assistant may call this function (SPEC-offices.md §4.3). The
   * shared store sits in every worker's prefix cache; let anyone write to it
   * and it grows exponentially with nobody accountable.
   *
   * Returns `undefined` when the lesson gets REJECTED — see `echoesLibrary`.
   *
   * ⚠ `confidence` 0.55, LOWER than even a worker's self-derived experience
   * (0.6). Not because it matters less, but because its SOURCE is weaker: a
   * worker writes a lesson after actually DOING the work and reading the
   * file; the Assistant writes one after reading exactly one line of a
   * worker's `say`. That's hearsay. The scale has to reflect the source, or
   * rumor outranks eyewitness testimony:
   *
   *   0.9  MEMORY          — the user committed it themselves
   *   0.6  experience      — a worker derived it after doing the real work
   *   0.55 shared lesson   — the Assistant inferred it from a receipt, never saw the file
   */
  addSharedLesson(
    text: string,
    source: string,
    docs: readonly string[] = [],
    dependsOn: readonly string[] = [],
  ): KnowledgeNode | undefined {
    if (this.rejectLesson(text, docs, 'shared', 'the shared lesson')) return undefined;

    const slug = slugify(text).slice(0, 48) || `lesson-${Date.now()}`;
    const node: KnowledgeNode = {
      id: `k/shared/${slug}`,
      type: 'playbook',
      title: text.slice(0, 60),
      tags: ['office'],
      links: [],
      scope: 'shared',
      author: 'assistant',
      confidence: 0.55,
      hits: 0,
      pinned: false,
      supersedes: [],
      updated: new Date().toISOString().slice(0, 10),
      ...(dependsOn.length ? { depends_on: [...dependsOn] } : {}),
      source,
      body: text.trim(),
      tokens: estimateTokens(text),
      file: `knowledge/shared/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /**
   * Write the Assistant's MEMORY COMPACTION. → docs/SPEC-offices.md §4.6
   *
   * Goes into `knowledge/agents/assistant/`, scope `role:assistant` — NOT into
   * the shared store. The shared store sits in EVERY worker's prefix, and the
   * Assistant's conversation memory ("the client prefers a livelier tone",
   * "settled on using markdown files") is something a writer worker doesn't
   * need to know and can't use. Putting it there makes the whole office pay to
   * read one person's diary.
   *
   * `supersedes` points at the PREVIOUS compaction: each time compaction runs,
   * the old version leaves the prompt but the file stays put. That way the
   * store doesn't grow with every compaction, while history can still be
   * traced back when needed.
   */
  addAssistantMemory(title: string, body: string, supersedes: readonly string[]): KnowledgeNode {
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = `bo-nho-${stamp}-${Date.now().toString(36).slice(-4)}`;
    const node: KnowledgeNode = {
      id: `k/agents/assistant/${slug}`,
      type: 'fact',
      title: title.slice(0, 60),
      tags: ['bo-nho'],
      links: [],
      scope: 'role:assistant',
      author: 'assistant',
      // Higher than a regular lesson: this is something the USER committed,
      // not something an agent derived on its own.
      confidence: 0.9,
      hits: 0,
      pinned: false,
      supersedes: [...supersedes],
      updated: stamp,
      source: 'compact',
      body: body.trim(),
      tokens: estimateTokens(body),
      file: `knowledge/agents/assistant/${slug}.md`,
    };
    writeNodeFile(this.companyDir, node);
    return node;
  }

  /** A node that is a conversation-memory compaction (as opposed to an agent's own derived experience). */
  private isMemory(e: IndexEntry): boolean {
    return e.scope === 'role:assistant' && e.id.includes('/bo-nho-');
  }

  /** IDs of every memory compaction still in effect (not yet superseded by a newer one). */
  assistantMemoryIds(): string[] {
    return [...this.byId.values()].filter((e) => this.isMemory(e) && !this.superseded.has(e.id)).map((e) => e.id);
  }

  /**
   * The content of the currently-effective MEMORY entries, split out so the UI
   * can show it as its own independent prompt layer. → docs/SPEC-offices.md §4.6
   *
   * Same store, two VIEWS. Stored together to reuse `supersedes`, aging,
   * budgeting and the Librarian; shown separately because to the user these
   * are two very different things: **experience** is what an agent derives on
   * its own after doing the work, **memory** is what the USER THEMSELVES
   * committed. The latter must carry more weight, and must be findable.
   */
  assistantMemoryText(): string {
    const nodes = this.assistantMemoryIds()
      .map((id) => this.nodeCache.get(id))
      .filter((n): n is KnowledgeNode => !!n);
    return nodes.map((n) => n.body).join('\n\n');
  }

  countShared(): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.scope === 'shared') n++;
    return n;
  }

  /** A node that actually got used bumps its hits — this is the HOT ranking signal. */
  recordHits(ids: readonly string[]): void {
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    for (const id of ids) {
      const entry = this.byId.get(id);
      const node = this.nodeCache.get(id);
      if (!entry || !node) continue;
      entry.hits++;
      node.hits++;
      // Most recent use date — what decides whether a node lives or dies. See `node.ts`.
      node.last_used = today;
      entry.last_used = today;
      writeNodeFile(this.companyDir, node);
      changed = true;
    }
    if (changed) this.writeIndex();
  }

  // ── internal

  /**
   * The nodes a role is allowed to READ.
   *
   * `shared` + that role's own notebook. This is the gate that keeps the
   * Assistant's own notebook (`role:assistant`) OUT of a worker's prefix —
   * otherwise compacted conversation memory would land in every worker's
   * context, on every task, telling them things that have nothing to do with
   * the work they're doing.
   *
   * A superseded node gets excluded right here, meaning it's excluded from
   * BOTH hot and cold at once — one gate, not two places to remember.
   */
  private visible(roleId: string): IndexEntry[] {
    const want = `role:${roleId}`;
    return [...this.byId.values()].filter(
      (e) => (e.scope === 'shared' || e.scope === want) && !this.superseded.has(e.id),
    );
  }

  private score(e: IndexEntry, terms: Set<string>): number {
    let overlap = 0;
    for (const k of e.keywords) if (terms.has(k)) overlap++;
    for (const t of e.tags) if (terms.has(t.toLowerCase())) overlap += 2;
    if (overlap === 0) return 0;
    // normalize by length so a long node doesn't automatically win
    const norm = overlap / Math.sqrt(Math.max(4, e.keywords.length));
    return norm * (0.5 + e.confidence) + 0.1 * Math.log1p(e.hits);
  }

  private render(entries: IndexEntry[], tokenBudget: number): { text: string; ids: string[] } {
    const chunks: string[] = [];
    const ids: string[] = [];
    let used = 0;
    for (const e of entries) {
      const node = this.nodeCache.get(e.id);
      if (!node) continue;
      const block = `## ${node.title}\n${node.body}`;
      const cost = estimateTokens(block);
      if (used + cost > tokenBudget) continue; // skip it, try a smaller node further along
      chunks.push(block);
      ids.push(node.id);
      used += cost;
    }
    return { text: chunks.join('\n\n'), ids };
  }

  private writeIndex(): void {
    fs.mkdirSync(this.paths.knowledge, { recursive: true });
    const payload = {
      generated: new Date().toISOString(),
      count: this.byId.size,
      nodes: [...this.byId.values()],
    };
    fs.writeFileSync(this.paths.knowledgeIndex, JSON.stringify(payload, null, 2), 'utf8');
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield abs;
  }
}

/**
 * Is this lesson just a copy of a document? Returns the filename if so.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE "KNOWLEDGE NODE ≠ USER-UPLOADED FILE" INVARIANT — NOW HAS CODE.       │
 * │                                                                           │
 * │ SPEC-library §1 declared this boundary on 08/17, and no line of code      │
 * │ enforced it. On 08/19 the system itself violated it: the Assistant wrote  │
 * │ a paraphrase of the shop's return policy into the shared store — a        │
 * │ policy that already lived in the document cabinet, more precisely, and    │
 * │ was free to find with `Grep`.                                             │
 * │                                                                           │
 * │ The cost of that copy wasn't tokens (36 tokens, negligible) but TRUTH:    │
 * │ the day the user changed the policy to 40%, the file got updated and the  │
 * │ node didn't — and the node won, because it already lived in every         │
 * │ worker's head while the document had to be looked up.                     │
 * │                                                                           │
 * │ Same failure class as the charter (§5f): two places holding the same      │
 * │ truth, neither aware of the other.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THIS IS THE SECOND NET, NOT THE MAIN ONE — noted so nobody trusts it   │
 * │ too much                                                                 │
 * │                                                                          │
 * │ Word overlap only catches a NEAR-VERBATIM copy. The actual 08/19 sentence│
 * │ ("60% discounts usually aren't eligible for returns…") paraphrased its   │
 * │ source pretty far ("Items discounted over 50% are NOT eligible for the   │
 * │ return policy") — measured at only ~0.47, SLIPPING past this net. The    │
 * │ test suite records that exact case so nobody mistakes this function for  │
 * │ a hard guarantee.                                                        │
 * │                                                                          │
 * │ The real guardrail is `worthLearning`: that case ran clean and so should │
 * │ NEVER have been asked for a lesson at all. This function only handles    │
 * │ what's left — a case with a real hiccup where the Assistant also happens │
 * │ to copy in a chunk of a document.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The threshold is set HIGH (0.6), not lowered to catch the 08/19 case,
 * because lowering it buys false positives: *"When a customer asks about
 * returns, always ask for the order number before answering"* is a real
 * lesson about how to work, and it too shares ~0.4 of its words with a
 * document just by talking about the same topic. Miss one and `worthLearning`
 * still catches it; block one wrongly and it's gone for good.
 *
 * Requires a MINIMUM of 4 significant words: a short lesson like "always
 * confirm the size" has too few words to compare, and forcing it through a
 * ratio threshold would be all false positives.
 */
export function echoesLibrary(text: string, docs: readonly string[]): string | undefined {
  const terms = tokenize(text);
  if (terms.length < 4 || docs.length === 0) return undefined;

  for (const doc of docs) {
    const words = new Set(tokenize(doc));
    if (words.size === 0) continue;
    let hit = 0;
    for (const t of terms) if (words.has(t)) hit++;
    if (hit / terms.length >= ECHO_RATIO) return docNameOf(doc);
  }
  return undefined;
}

/** What fraction of a lesson's significant words must already be in the document to count as copied. */
const ECHO_RATIO = 0.6;

/**
 * How similar do two lessons have to be to count as one. Jaccard over the
 * word set.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MEASURED 08/21 — 0.75 WAS TOO HIGH, AND THE PREMISE JUSTIFYING IT WAS A  │
 * │ PROMISE.                                                                 │
 * │                                                                          │
 * │ A real duplicate pair, both `scope: shared`, nine minutes apart:         │
 * │                                                                          │
 * │   "Phan-tich-standard keeps hitting the cost cap on batch CSV            │
 * │    aggregation work — raise max_usd before handing out this kind of      │
 * │    task."                                                                │
 * │   "Batch CSV aggregation work can hit the cost cap on                    │
 * │    phan-tich-standard — consider raising max_usd before handing out      │
 * │    similar work."                                                        │
 * │                                                                          │
 * │ Measured Jaccard: **0.654**. Fell short of the 0.75 threshold, both      │
 * │ nodes survived. The gap sits almost entirely in filler words — *keeps*   │
 * │ ↔ *can*, *raise* ↔ *consider raising*, *this kind of* ↔ *similar*. The   │
 * │ same sentence, two voices.                                               │
 * │                                                                          │
 * │ ⚠ The old comment justified 0.75 with *"a miss only costs one extra node │
 * │   that the Librarian (M1) can merge later"*. **The Librarian DOES NOT    │
 * │   EXIST YET.** So the real cost of a miss isn't "one node waiting to be  │
 * │   merged" but **tokens in every worker's prefix, on every turn,          │
 * │   forever**. A correct decision built on a false premise is a time       │
 * │   bomb — and it just went off.                                           │
 * │                                                                          │
 * │ The two sides are NOT symmetric the way the old comment assumed:         │
 * │   false positive → loses one lesson, the older copy's `hits` +1, a trail │
 * │                     survives                                             │
 * │   false negative → pays tokens forever for a duplicate nobody cleans up  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 0.6, not lower: below that, two lessons that both mention the same document
 * start sticking together just from sharing a filename. Re-measure once the
 * store passes a few dozen nodes.
 */
const TWIN_RATIO = 0.6;

/**
 * How similar two pieces of text are — Jaccard over the significant-word set.
 * `0`…`1`.
 *
 * Split out of `findTwin` so the THRESHOLD CAN BE TESTED without standing up
 * an entire `KnowledgeStore` on disk. This is the part of debt 0b that's
 * payable right away: when an important rule lives inside a private method
 * that needs I/O, the real debt is **the shape of the code**, not the missing
 * test.
 *
 * Symmetric and unbiased toward long sentences — swapping the two arguments'
 * order doesn't change the result.
 */
export function twinScore(a: string, b: string): number {
  const x = new Set(tokenize(a));
  const y = new Set(tokenize(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Did this lesson COPY A NUMBER from a document? Returns that number if so.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS PATCHES THE EXACT CASE `echoesLibrary` WAS MEASURED TO MISS.        │
 * │                                                                          │
 * │ On 08/19, node `k/shared/discounted-product-60-…` wrote *"60% discounts  │
 * │ USUALLY aren't eligible for returns"* while the document said *"over     │
 * │ 50% is NOT eligible"*. Word overlap measured **0.47** — below the 0.6    │
 * │ threshold, slipped through. The further a paraphrase drifts from its     │
 * │ source, the weaker the word-overlap net gets, and **a wrong paraphrase   │
 * │ is exactly the dangerous case**: it's both incorrect and untraceable     │
 * │ back to its source.                                                      │
 * │                                                                          │
 * │ A number is the opposite — it SURVIVES any paraphrase. And a sentence    │
 * │ about HOW TO WORK almost never needs a threshold, a price, or a date:    │
 * │                                                                          │
 * │   ✅ "grep library/text/ before answering"                — no number    │
 * │   ⛔ "items discounted over 50% aren't eligible for returns" — has 50    │
 * │                                                                          │
 * │ So "has a number, and that number already appears in the document" is a  │
 * │ near-certain sign of copied KNOWLEDGE, and it's deterministic — no       │
 * │ guessing involved.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Only blocks when the number IS PRESENT IN THE DOCUMENT. A lesson like
 * *"ask at most 2 follow-up questions before starting the work"* carries the
 * number 2, but that's a number belonging to HOW TO WORK, not to any
 * document — it has to pass through.
 *
 * Ignores numbers ≤ 1 digit: they're almost always step counters ("2
 * questions", "3 times") and collide with documents far too easily.
 */
export function quotesLibraryNumber(text: string, docs: readonly string[]): string | undefined {
  const nums = [...new Set(text.match(/\d[\d.,]*/g) ?? [])].filter((n) => n.replace(/\D/g, '').length >= 2);
  if (nums.length === 0 || docs.length === 0) return undefined;

  for (const n of nums) {
    // Digit boundaries on both ends: "50" must not match inside "150" or "500".
    const re = new RegExp(`(?<!\\d)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`);
    for (const doc of docs) {
      if (re.test(doc)) return n;
    }
  }
  return undefined;
}

/** The first line of a document's text body is its filename — see `Office.libraryTexts()`. */
function docNameOf(doc: string): string {
  return doc.split('\n', 1)[0]?.trim() || 'a document';
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    // \p{M} = combining mark. The hand-written character class
    // [U+0300-U+036F] LOOKS right, but a combining mark that lands on a
    // square bracket turns the regex into something else — the result was
    // "Người dùng" slugifying to "ngu-i-d-ng" instead of "nguoi-dung". // i18n-allow-vietnamese: the actual reported bug input
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd') // i18n-allow-vietnamese: transliterating actual Vietnamese input, not UI text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
