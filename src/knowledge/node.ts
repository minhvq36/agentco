/**
 * A knowledge node: markdown + YAML frontmatter.
 *
 * → docs/SPEC-2026-08-14-agentco.md §5
 *
 * The format is chosen so a PERSON and a MACHINE can both read it: open it in any
 * editor, diff it with git, no lock-in to a proprietary format. This is the
 * "you own the artifacts, not the prompts" principle made concrete.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { estimateTokens } from '../core/tokens.js';

export type NodeType = 'policy' | 'pitfall' | 'playbook' | 'fact' | 'reference';

export interface KnowledgeNode {
  id: string;
  type: NodeType;
  title: string;
  tags: string[];
  links: string[];
  /** 'shared' = the assistant writes, the office reads. 'role:<id>' = that agent alone. */
  scope: string;
  author: string;
  confidence: number;
  hits: number;
  pinned: boolean;
  /**
   * Which nodes this one SUPERSEDES. → docs/SPEC-2026-08-14-agentco.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE ONLY PIECE THAT KEEPS THE STORE CORRECT, NOT MERELY AGEING.          │
   * │                                                                          │
   * │ `hits` and `updated` only DEMOTE a rarely-used node. They cannot answer  │
   * │ the question that matters most: "has this decision been reversed?" A     │
   * │ wrong node that gets read often sits at the top of the table forever.    │
   * │                                                                          │
   * │ A superseded node is NOT deleted — the file stays, readable, so you can  │
   * │ see why you once thought that. It only leaves the part loaded into the   │
   * │ prompt. Same spirit as archiving: putting something away is fine, wiping │
   * │ the trace is not.                                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Deliberately ONE FIELD rather than a graph: the only relation this store
   * actually uses is "supersedes". Building a graph engine for one relation is
   * buying complexity before there is a problem.
   */
  supersedes: string[];
  updated: string;
  /**
   * The last time this node was chosen for MATCHING A JOB (i.e. scored by
   * `cold()`). Empty = never.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ONE DATE, NOT AN ARRAY — and not a decay mechanism.                      │
   * │                                                                          │
   * │ `hits` accumulates and only ever grows, so it is immortal: a node used   │
   * │ exactly once two years ago still has `hits > 0` forever and is never     │
   * │ swept.                                                                   │
   * │                                                                          │
   * │ The way out is NOT to make `hits` decay — decay needs A SCHEDULE (per    │
   * │ task? per day? what if the daemon was off for two weeks?), and that      │
   * │ schedule drifts.                                                         │
   * │                                                                          │
   * │ A window is STATELESS: all it needs is when the last use was, compared   │
   * │ against today AT READ TIME. Correct however long the daemon was down,    │
   * │ and no background job.                                                   │
   * │                                                                          │
   * │ Two metrics, two jobs, deliberately not mixed:                           │
   * │   `hits`      → RANKING into HOT (cumulative, rewards long usefulness)   │
   * │   `last_used` → RETIREMENT, even when hits > 0                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * An older node without this field falls back to `updated` — no alias table.
   */
  last_used?: string;

  /**
   * Which files this node LIVES OR DIES BY. Empty = independent, nothing removes it.
   * → docs/SPEC-2026-08-14-agentco.md §5, `KnowledgeStore.dropDependents`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A WEAK ENTITY: delete one file in the list and THIS NODE GOES WITH IT.   │
   * │                                                                          │
   * │ A lesson drawn from reading `library/files/doi-tra.md` only means        │
   * │ anything while that file exists. If the user deletes the document and    │
   * │ the node stays, we keep advice pointing at nothing, in every employee's  │
   * │ prefix, forever — and it still sounds perfectly confident.               │
   * │                                                                          │
   * │ Removal is ANY (one file gone ⇒ node gone), not ALL. Deliberately        │
   * │ conservative: advice that is half right is more dangerous than no advice │
   * │ at all, because nobody can tell which half broke.                        │
   * │                                                                          │
   * │ ⚠ This ONLY covers a DELETED file. An EDITED file (policy 50% → 30%)     │
   * │ does not trigger it — the file is still there. That case is covered by   │
   * │ the "record WAYS OF WORKING, never KNOWLEDGE" rule (`LessonSchema` drops │
   * │ `'fact'`, plus the figure guard), because a sentence about a ROUTE stays │
   * │ true however the file's content changes. The two rules complement each   │
   * │ other; drop one and half the surface is open.                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Paths are relative to the OFFICE folder (`library/files/x.md`), and they come
   * from OBSERVATION — files the employee actually `Read` while working
   * (`receipt.reads`) — never from what the model claims. Same rule as `landed`.
   */
  depends_on?: string[];

  source?: string;
  body: string;
  tokens: number;
  /** the file path, relative to the company folder */
  file: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseNode(raw: string, file: string): KnowledgeNode | undefined {
  const m = FRONTMATTER.exec(raw);
  if (!m) return undefined;
  let fm: Record<string, unknown>;
  try {
    fm = (YAML.parse(m[1] ?? '') ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const body = (m[2] ?? '').trim();
  const id = str(fm['id']) || file.replace(/\.md$/i, '').replace(/\\/g, '/');

  return {
    id,
    type: (str(fm['type']) as NodeType) || 'fact',
    title: str(fm['title']) || id.split('/').pop() || id,
    tags: arr(fm['tags']),
    links: [...new Set([...arr(fm['links']), ...wikilinks(body)])],
    scope: str(fm['scope']) || 'shared',
    author: str(fm['author']) || 'master',
    confidence: num(fm['confidence'], 0.7),
    hits: num(fm['hits'], 0),
    pinned: fm['pinned'] === true,
    supersedes: arr(fm['supersedes']),
    updated: str(fm['updated']) || new Date().toISOString().slice(0, 10),
    ...(str(fm['last_used']) ? { last_used: str(fm['last_used']) } : {}),
    ...(arr(fm['depends_on']).length ? { depends_on: arr(fm['depends_on']) } : {}),
    ...(str(fm['source']) ? { source: str(fm['source']) } : {}),
    body,
    tokens: estimateTokens(body),
    file,
  };
}

export function serializeNode(n: KnowledgeNode): string {
  const fm: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    title: n.title,
    tags: n.tags,
    links: n.links.filter((l) => !n.body.includes(`[[${l}]]`)),
    scope: n.scope,
    author: n.author,
    confidence: round2(n.confidence),
    hits: n.hits,
    updated: n.updated,
  };
  if (n.pinned) fm['pinned'] = true;
  if (n.supersedes.length) fm['supersedes'] = n.supersedes;
  if (n.last_used) fm['last_used'] = n.last_used;
  if (n.depends_on?.length) fm['depends_on'] = n.depends_on;
  if (n.source) fm['source'] = n.source;
  return `---\n${YAML.stringify(fm).trim()}\n---\n\n${n.body.trim()}\n`;
}

export function readNodeFile(companyDir: string, relFile: string): KnowledgeNode | undefined {
  const abs = path.join(companyDir, relFile);
  if (!fs.existsSync(abs)) return undefined;
  return parseNode(fs.readFileSync(abs, 'utf8'), relFile.replace(/\\/g, '/'));
}

export function writeNodeFile(companyDir: string, n: KnowledgeNode): void {
  const abs = path.join(companyDir, n.file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeNode(n), 'utf8');
}

/** Keywords for retrieval scoring. Common Vietnamese stopwords are dropped. */
export function keywordsOf(n: Pick<KnowledgeNode, 'title' | 'tags' | 'body'>): string[] {
  return tokenize(`${n.title} ${n.tags.join(' ')} ${n.body}`);
}

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
    ),
  ];
}

/**
 * Function words kept out of the keyword index.
 *
 * ⚠ This is LINGUISTIC DATA, not interface text — it is pointed at the notes the
 * user writes, so it has to carry whatever language the user writes in. Today's
 * store is Vietnamese, so the list holds Vietnamese, and it stays here rather
 * than moving into `src/i18n/`: the catalogue follows the INTERFACE switch, and
 * a person's notes do not. The day someone writes notes in German, this list is
 * the place that needs the addition — not the catalogue.
 */
const STOPWORDS = new Set(
  ('và của có là không cho với những các được người khi này đó thì mà nếu ở từ về ra vào lên xuống ' + // i18n-allow-vietnamese: stopword data for indexing Vietnamese notes, not UI text
    'một hai để nên như đã sẽ đang cũng rất nhiều ít hơn nhất bị bởi vì nhưng hoặc tôi bạn chúng ta ' + // i18n-allow-vietnamese: same list, continued
    'the and for with that this from you your are was were will have has not but can all any its it')
    .split(/\s+/),
);

function wikilinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
const round2 = (n: number): number => Math.round(n * 100) / 100;
