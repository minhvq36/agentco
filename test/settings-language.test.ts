
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildAssistantPrompt, buildWorkerPrompt } from '../dist/core/prompt.js';
import { getLocale, setLocale, t } from '../dist/i18n/index.js';

function fakeRole() {
  return {
    id: 'writer',
    version: 1,
    display_name: 'Writer',
    avatar: '•',
    pitch: 'writes things',
    good_at: [],
    not_for: [],
    skill_level: 'medium',
    skills: {},
    tools: [],
    mcp: [],
    secrets: [],
    model_tier: 'standard',
    use_preset: false,
    budget: { max_turns: 15, max_usd: 5, knowledge_pack: 3000 },
  } as never;
}

function fakeOffice() {
  return {
    dir: '/tmp/office',
    config: {
      id: 'o',
      name: 'Office',
      assistant: { display_name: '', avatar: '★', mcp: [], default_deliver: 'file', model_tier: 'standard' },
    },
    charter: '',
    assistantSkills: '',
    roles: new Map(),
    archivedRoles: new Set(),
    company: {
      models: { eco: 'm-eco', standard: 'm-std', deep: 'm-deep' },
      budgets: { charter_tokens: 500, assistant_skills_tokens: 400 },
    },
  } as never;
}

function atLocale<T>(locale: 'vi' | 'en', fn: () => T): T {
  const before = getLocale();
  try {
    setLocale(locale);
    return fn();
  } finally {
    setLocale(before);
  }
}

test('🔴 the worker `cacheKey` does NOT change when the switch is flipped', () => {
  const office = fakeOffice();
  const vi = atLocale('vi', () => buildWorkerPrompt(office, fakeRole(), {}).cacheKey);
  const en = atLocale('en', () => buildWorkerPrompt(office, fakeRole(), {}).cacheKey);
  assert.equal(vi, en, 'the UI language switch just entered the cached prefix — see docs/CLAUDE.md §Language');
});

test('🔴 the Assistant `cacheKey` does NOT change when the switch is flipped', () => {
  const office = fakeOffice();
  const opts = { roster: '# Employees\n- none' };
  const vi = atLocale('vi', () => buildAssistantPrompt(office, opts).cacheKey);
  const en = atLocale('en', () => buildAssistantPrompt(office, opts).cacheKey);
  assert.equal(vi, en);
});

test('⭐ the prompt content is also identical across both locales', () => {
  const office = fakeOffice();
  const text = (locale: 'vi' | 'en') =>
    atLocale(locale, () => {
      const built = buildAssistantPrompt(office, { roster: '# Employees\n- none' });
      return Array.isArray(built.systemPrompt) ? built.systemPrompt.join('\n') : '';
    });
  assert.equal(text('vi'), text('en'));
});

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE THREE CODE-BUILT BLOCKS OF THE PREFIX NEVER GO THROUGH THE         │
 * │ CATALOGUE. (user asked 05/09)                                            │
 * │                                                                          │
 * │ The tests above hand `roster` in as a literal and leave `library` /       │
 * │ `artifacts` empty, so they prove `buildAssistantPrompt` ASSEMBLES         │
 * │ locale-free — they say nothing about the three functions that PRODUCE     │
 * │ those blocks. A `t()` added inside any of them would wire the interface   │
 * │ switch straight into the cached prefix, and every test in this file       │
 * │ would stay green.                                                        │
 * │                                                                          │
 * │ That is not hypothetical: `seed.assistantSkills.body` reached a prompt    │
 * │ the same way — through a road no gate was looking at. Both surviving      │
 * │ functions already carry a comment saying *"English, always: an employee   │
 * │ reads this block"*; this is that comment turned into a mechanism, because │
 * │ a ⚠ next to the code is not one.                                         │
 * │                                                                          │
 * │ Checked by SOURCE, not by output: the property wanted is *"never asks     │
 * │ the catalogue"*, and no amount of running them can prove a negative       │
 * │ about a branch that did not happen to fire.                              │
 * │                                                                          │
 * │ ⚠ Scope, stated honestly: the three blocks named in the prefix. The       │
 * │ VOLATILE half is NOT covered — `report()` feeds every receipt's `say`     │
 * │ into the assistant, and on the failure paths that `say` IS built with     │
 * │ `t()` (`worker.ts §sayError`, `§stoppedReceipt`). Known, unmeasured,      │
 * │ recorded rather than silently implied to be safe.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The body of one function, by brace counting on comment-free source. */
function bodyOf(file: string, signature: string, marker: string): string {
  const src = stripComments(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const at = src.indexOf(signature);
  assert.ok(at >= 0, `${file}: \`${signature}\` not found — this test is stale, not passing`);
  let depth = 0;
  let end = -1;
  for (let i = at + signature.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  assert.ok(end > at, `${file}: could not find the end of \`${signature}\``);
  const body = src.slice(at, end);
  // Guard against a mis-extraction quietly shrinking to nothing and passing.
  assert.ok(body.includes(marker), `${file}: extracted body is missing \`${marker}\` — the extraction is wrong`);
  return body;
}

const PREFIX_BLOCKS: { file: string; signature: string; marker: string; what: string }[] = [
  {
    file: path.join('core', 'assistant.ts'),
    signature: 'private roster(): string {',
    marker: 'assignableRoles()',
    what: 'the employee roster',
  },
  {
    file: path.join('core', 'office.ts'),
    signature: 'private artifactManifest(): string {',
    marker: 'byPlan',
    what: 'the results listing',
  },
  {
    file: path.join('library', 'store.ts'),
    signature: 'manifest(): string {',
    marker: 'docPaths',
    what: 'the document cabinet listing',
  },
];

for (const block of PREFIX_BLOCKS) {
  test(`🔴 ${block.what} is built without the catalogue`, () => {
    const body = bodyOf(block.file, block.signature, block.marker);
    assert.doesNotMatch(
      body,
      /\bt\(/,
      `${block.file}: this block sits in the assistant's CACHED PREFIX — a t() here is the interface switch reaching a prompt`,
    );
    assert.doesNotMatch(body, /\bplural\(/, `${block.file}: same rule — plural() reads the same switch`);
  });
}

test('⭐ control: `bodyOf` really does find catalogue calls when they are there', () => {
  // `describePrompt` is the deliberate counter-example — the layer table the
  // UI draws, which SHOULD follow the switch. If the check above cannot see a
  // t() in here, it cannot see one anywhere.
  const body = bodyOf(path.join('core', 'prompt.ts'), 'export function describePrompt(', 'promptLayer.');
  assert.match(body, /\bt\(/, 'the detector is blind — the three tests above would be green for the wrong reason');
});

test('⭐ control check: the switch STILL changes UI strings', () => {
  const vi = atLocale('vi', () => t('common.save'));
  const en = atLocale('en', () => t('common.save'));
  assert.notEqual(vi, en, 'setLocale has no effect — the three tests above would be green for the wrong reason');
  assert.equal(en, 'Save');
});

test('⭐ the locale is restored to its prior state after each borrow', () => {
  const before = getLocale();
  atLocale('en', () => t('common.save'));
  assert.equal(getLocale(), before);
});
