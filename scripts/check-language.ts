/**
 * SOURCE IS ENGLISH — and this file is what makes that a rule instead of a wish.
 *
 * → docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CONTRIBUTING.md, rule #1: "An invariant is only real when there is code  │
 * │ that enforces it." There is no linter and no CI in this repository, so   │
 * │ the only place a rule can live and survive is `npm test`.                │
 * │                                                                          │
 * │ Without this gate the migration rots the same week it lands: one file    │
 * │ gets a Vietnamese comment back, nothing complains, and six months later  │
 * │ the tree is mixed again with no way to tell which half is intentional.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Run: node --experimental-strip-types scripts/check-language.ts
 * Wired into `npm test`, so it cannot be forgotten.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Characters that exist in Vietnamese and in no other language we might ship.
 *
 * ⚠ THIS IS A 100% DETERMINISTIC TEST **OF OUR OWN SOURCE**, AND ONLY THERE.
 *
 * It is exact here because our source has exactly two possible states — English
 * or Vietnamese — and the rule is "no Vietnamese". Point the same function at
 * USER TEXT and it stops being a test and becomes a guess: it finds no
 * Vietnamese marks in Spanish, German or Arabic and would label all three
 * "English". That guess, written to disk beside a user's note, is unreadable
 * later as a guess. Never reuse this on user data — see the knowledge-store
 * decision in docs/CLAUDE.md.
 */
// i18n-allow-vietnamese: this character class IS the detector — the first line the gate ever flagged was its own
const VIETNAMESE =
  /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/; // i18n-allow-vietnamese

/** Escape hatch for a fixture where Vietnamese IS the thing under test. */
const PRAGMA = /i18n-allow-vietnamese/;

const ROOT = path.resolve(import.meta.dirname, '..');

/** Trees the rule governs. Everything else in the repository is out of scope. */
const SCOPE = ['src', 'web/src', 'test', 'scripts', 'docs', 'README.md', 'package.json'];

/** The single permanent exemption: the Vietnamese catalogue itself. */
const ALWAYS_ALLOWED = ['src/i18n/vi.ts'];

/**
 * ⏳ MIGRATION SCAFFOLD — this list only ever shrinks, and P6 deletes it.
 *
 * Each entry is a path prefix still awaiting its phase. Finishing a phase means
 * deleting its lines here; that deletion IS the phase's exit criterion, which is
 * why the list is spelled out by phase rather than as one clever glob.
 */
const PENDING: { prefix: string; phase: string }[] = [
  { prefix: 'web/src/', phase: 'P1 + P3' },
  { prefix: 'src/', phase: 'P2 + P3' },
  { prefix: 'test/', phase: 'P4' },
  { prefix: 'scripts/', phase: 'P4' },
  { prefix: 'docs/', phase: 'P5' },
  { prefix: 'README.md', phase: 'P5' },
  { prefix: 'package.json', phase: 'P5' },
];

/** Files already migrated, so they are held to the rule even inside a pending tree. */
const ENFORCED_EARLY = ['src/i18n/', 'scripts/check-language.ts', 'scripts/fix-comment-boxes.ts', 'docs/CLAUDE.md'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.state', 'company']);
const TEXT_FILE = /\.(ts|tsx|md|json|yaml|yml|css|html)$/;

interface Offence {
  file: string;
  line: number;
  text: string;
}

function walk(target: string, out: string[]): void {
  const abs = path.join(ROOT, target);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (TEXT_FILE.test(target)) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    walk(path.posix.join(target, entry.name), out);
  }
}

function isExempt(file: string): boolean {
  if (ALWAYS_ALLOWED.includes(file)) return true;
  if (ENFORCED_EARLY.some((p) => file === p || file.startsWith(p))) return false;
  return PENDING.some((p) => file === p.prefix || file.startsWith(p.prefix));
}

const files: string[] = [];
for (const target of SCOPE) walk(target, files);

const offences: Offence[] = [];
for (const file of files) {
  if (isExempt(file)) continue;
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    if (!VIETNAMESE.test(text)) return;
    if (PRAGMA.test(text)) return;
    offences.push({ file, line: i + 1, text: text.trim().slice(0, 120) });
  });
}

const checked = files.filter((f) => !isExempt(f)).length;

if (offences.length === 0) {
  const waiting = PENDING.map((p) => `${p.prefix} (${p.phase})`).join(', ');
  console.log(`language: ${checked} files clean${waiting ? ` · still pending: ${waiting}` : ''}`);
  process.exit(0);
}

console.error(`language: ${offences.length} Vietnamese line(s) in English-only source\n`);
for (const o of offences) console.error(`  ${o.file}:${o.line}  ${o.text}`);
console.error(
  '\nSource, comments and log lines are English. User-visible app strings belong in' +
    '\n`src/i18n/` — English in en.ts, Vietnamese in vi.ts. A test fixture where' +
    '\nVietnamese is the thing under test may carry `i18n-allow-vietnamese: <reason>`' +
    '\non the line. See docs/CLAUDE.md.',
);
process.exit(1);
