
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'knowledge');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('🔴 `KnowledgeNode` has NO language field of any kind', () => {
  const code = read('node.ts');
  const iface = /export interface KnowledgeNode \{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  assert.ok(iface, 'KnowledgeNode not found — this test is stale');
  assert.doesNotMatch(
    withoutComments(iface),
    /^\s*(lang|language|locale)\??\s*:/m,
    'adding a language field to a node bakes a guess into user data — read the block above',
  );
});

test('🔴 `hot()` neither accepts nor reads any language parameter', () => {
  const code = read('store.ts');
  const hot = /\n  hot\(([\s\S]*?)\n  \}/.exec(code)?.[1] ?? '';
  assert.ok(hot, 'hot() not found — this test is stale');
  assert.doesNotMatch(withoutComments(hot), /\blang\b|\blanguage\b|\blocale\b/i);
});

test('⭐ no Vietnamese-diacritic detector anywhere in `knowledge/`', () => {
  for (const f of ['node.ts', 'store.ts']) {
    const code = withoutComments(read(f));
    assert.doesNotMatch(
      code,
      /hasVietnamese|detectLang|guessLang|sniffLang/i,
      `${f} has a language detector — that is a signal, not a gate`,
    );
    assert.doesNotMatch(code, DIACRITIC_CLASS, `${f} has a diacritic character range`);
  }
});

const DIACRITIC_CLASS = /\[[^\]]*ạ[^\]]*ẹ[^\]]*\]/u; // i18n-allow-vietnamese: this pattern IS the shape being looked for

test('⭐ control check: the patterns above actually catch a real detector', () => {
  const detector = "const VI = /[àáảãạăèéẻẽẹêìíỉĩị]/;"; // i18n-allow-vietnamese: sample detector regex under test
  assert.match(detector, DIACRITIC_CLASS, 'the character-range pattern fails to catch a real detector');
  assert.match('function hasVietnameseDiacritics(s) {}', /hasVietnamese|detectLang|guessLang|sniffLang/i);
  assert.match('  lang?: string;', /^\s*(lang|language|locale)\??\s*:/m);
  assert.match('  locale: Locale;', /^\s*(lang|language|locale)\??\s*:/m);
});
