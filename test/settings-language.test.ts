/**
 * ⭐ CÔNG TẮC NGÔN NGỮ ĐỔI GIAO DIỆN, VÀ **KHÔNG** ĐỔI PROMPT.
 * → `src/i18n/` · `src/core/prompt.ts` · docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐÂY LÀ Ô KHOÁ ĐÚNG MỆNH ĐỀ *"công tắc không đi vào prompt"*.             │
 * │                                                                          │
 * │ `no-pinned-language.test.ts` khoá chiều tĩnh: không chuỗi nào NÊU TÊN     │
 * │ một ngôn ngữ. Bài này khoá chiều ĐỘNG, thứ chuỗi không bắt được: gạt      │
 * │ công tắc rồi dựng lại prompt, `cacheKey` phải y hệt từng ký tự.           │
 * │                                                                          │
 * │ Nó đỏ vào đúng ngày ai đó nối dây trở lại — và nếu không có nó, cái dây   │
 * │ ấy **không có triệu chứng nào** cho tới khi ai đó đọc hoá đơn: mỗi lần    │
 * │ người dùng gạt công tắc là một `cache_write` cho toàn bộ prefix của mọi   │
 * │ vai trò trong văn phòng.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

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

/**
 * ⚠ Trả locale về đúng chỗ cũ sau mỗi bài.
 *
 * `setLocale` là trạng thái tầng module, dùng chung cả tiến trình — bộ test này
 * chạy ở `vi`, và một bài quên dọn sẽ làm mọi bài sau nó đọc catalog tiếng Anh.
 * Lớp lỗi đó hỏng ở một FILE KHÁC, tức là chỗ khó truy nhất.
 */
function atLocale<T>(locale: 'vi' | 'en', fn: () => T): T {
  const before = getLocale();
  try {
    setLocale(locale);
    return fn();
  } finally {
    setLocale(before);
  }
}

test('🔴 `cacheKey` của worker KHÔNG đổi khi gạt công tắc', () => {
  const office = fakeOffice();
  const vi = atLocale('vi', () => buildWorkerPrompt(office, fakeRole(), {}).cacheKey);
  const en = atLocale('en', () => buildWorkerPrompt(office, fakeRole(), {}).cacheKey);
  assert.equal(vi, en, 'công tắc giao diện vừa đi vào prefix được cache — đọc docs/CLAUDE.md §Language');
});

test('🔴 `cacheKey` của Trợ lý KHÔNG đổi khi gạt công tắc', () => {
  const office = fakeOffice();
  const opts = { roster: '# Employees\n- none' };
  const vi = atLocale('vi', () => buildAssistantPrompt(office, opts).cacheKey);
  const en = atLocale('en', () => buildAssistantPrompt(office, opts).cacheKey);
  assert.equal(vi, en);
});

/**
 * Và chính NỘI DUNG prompt cũng phải y hệt, không chỉ cái băm.
 *
 * Băm giống nhau đã đủ chặt, nhưng khi nó đỏ thì nó chỉ nói "khác nhau" chứ
 * không nói khác ở đâu. Bài này in ra được chỗ lệch, nên nó là bài người sau
 * đọc trước. ⇒ [[agentco-free-discriminator]]
 */
test('⭐ nội dung prompt cũng y hệt ở hai locale', () => {
  const office = fakeOffice();
  const text = (locale: 'vi' | 'en') =>
    atLocale(locale, () => {
      const built = buildAssistantPrompt(office, { roster: '# Employees\n- none' });
      return Array.isArray(built.systemPrompt) ? built.systemPrompt.join('\n') : '';
    });
  assert.equal(text('vi'), text('en'));
});

/**
 * ⭐ Đối chứng: công tắc PHẢI đổi được thứ nó có quyền đổi.
 *
 * Không có bài này thì `setLocale` hỏng hoàn toàn cũng làm ba bài trên xanh —
 * "không đổi gì cả" thoả mọi assertion ở trên. Một cổng chỉ kiểm chiều cấm là
 * một cổng có thể xanh vì lý do sai.
 */
test('⭐ đối chứng: công tắc VẪN đổi được chuỗi giao diện', () => {
  const vi = atLocale('vi', () => t('common.save'));
  const en = atLocale('en', () => t('common.save'));
  assert.notEqual(vi, en, 'setLocale không có tác dụng gì — ba bài trên đang xanh vì lý do sai');
  assert.equal(en, 'Save');
});

test('⭐ locale được trả về nguyên trạng sau mỗi lần mượn', () => {
  const before = getLocale();
  atLocale('en', () => t('common.save'));
  assert.equal(getLocale(), before);
});
