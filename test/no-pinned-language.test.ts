
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { buildAssistantPrompt, buildWorkerPrompt } from '../dist/core/prompt.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

function stringsIn(src: string, file: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const LANGUAGE_NAMES = [
  'Vietnamese',
  'English',
  'Chinese',
  'Japanese',
  'Korean',
  'German',
  'Spanish',
  'French',
  'Arabic',
  'tiếng Việt', // i18n-allow-vietnamese: the exact string this gate exists to keep out
  'tiếng Anh', // i18n-allow-vietnamese: same, in the other direction
];

for (const file of ['prompt.ts', 'assistant.ts', 'receipt.ts', 'scheduler.ts', 'office.ts', 'mailbox.ts']) {
  test(`⭐ ${file}: no string names a language`, () => {
    for (const s of stringsIn(read(file), file)) {
      for (const name of LANGUAGE_NAMES) {
        assert.equal(
          s.includes(name),
          false,
          `${file} pins the language "${name}" inside a string — read docs/CLAUDE.md §Language before adding it back`,
        );
      }
    }
  });
}

test('⭐ control: `stringsIn` catches language names inside strings, and skips comments', () => {
  const sample = [
    '// a comment naming Vietnamese on purpose', // i18n-allow-vietnamese: fixture for the gate itself
    '/* a block comment naming German */',
    'const a = "reply in Vietnamese";',
    'const url = "https://example.com/German";',
  ].join('\n');
  const found = stringsIn(sample, 'sample.ts');
  assert.deepEqual(found, ['reply in Vietnamese', 'https://example.com/German']);
  assert.ok(found.some((s) => s.includes('https://')));
});

test('🔴 `BuildPromptOpts` has NO language field at all', () => {
  const code = read('prompt.ts');
  const iface = /export interface BuildPromptOpts \{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  assert.ok(iface, 'BuildPromptOpts not found — this test is stale');
  assert.doesNotMatch(withoutComments(iface), /\blanguage\b|\blocale\b|\blang\b/i);
});

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('🔴 same goes for `buildAssistantPrompt`\'s opts', () => {
  const code = read('prompt.ts');
  const opts = /export function buildAssistantPrompt\([\s\S]*?opts: \{([\s\S]*?)\n  \},/.exec(code)?.[1] ?? '';
  assert.ok(opts, "buildAssistantPrompt's opts not found — this test is stale");
  assert.doesNotMatch(withoutComments(opts), /\blanguage\b|\blocale\b|\blang\b/i);
});

test('⭐ the prompt still POINTS TO the signal, it just does not name a language', () => {
  const code = read('prompt.ts');
  assert.match(code, /in the language of your task brief/);
  assert.match(code, /in the language they are writing to you in/);
});

test('⭐ the BUILT prompt contains no language name', () => {
  const office = fakeOffice();
  const worker = buildWorkerPrompt(office, fakeRole(), {});
  const assistant = buildAssistantPrompt(office, { roster: '# Employees\n- none' });

  for (const built of [worker, assistant]) {
    const text = Array.isArray(built.systemPrompt)
      ? built.systemPrompt.join('\n')
      : (built.systemPrompt.append ?? '');
    for (const name of LANGUAGE_NAMES) {
      assert.equal(text.includes(name), false, `the built prompt contains "${name}"`);
    }
  }
});


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
