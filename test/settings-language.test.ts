
import { strict as assert } from 'node:assert';
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
