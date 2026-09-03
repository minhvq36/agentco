/**
 * ⭐ KHÔNG PROMPT NÀO ĐƯỢC NÊU TÊN MỘT NGÔN NGỮ CỤ THỂ.
 * → `src/core/prompt.ts` · `src/core/assistant.ts` · docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO LUẬT NÀY CẦN MÃ THI HÀNH, TRONG KHI NÓ CHỈ LÀ MẤY CHỮ.            │
 * │                                                                          │
 * │ Bốn chỗ ghim `tiếng Việt` sống trong prompt suốt nhiều tuần, và chúng     │
 * │ **không có triệu chứng** — vì mọi người dùng cho tới lúc đó đều gõ tiếng  │
 * │ Việt. Lớp lỗi này chỉ lộ ra ở người dùng thứ hai, và lúc đó nó đã nằm     │
 * │ trong prefix cache của mọi văn phòng.                                    │
 * │                                                                          │
 * │ Thêm lại một dòng *"reply in X"* là chuyện dễ xảy ra nhất trên đời: nó    │
 * │ trông như một bản vá vô hại cho một ca lẻ, và nó phá đúng thứ làm cho     │
 * │ người Trung / người Đức / người Ả Rập nhận được đầu ra bằng tiếng của     │
 * │ họ mà không dòng mã nào phải nhắc tới ba ngôn ngữ đó.                     │
 * │                                                                          │
 * │ Test đọc MÃ NGUỒN dưới dạng văn bản, cùng khuôn `oauth-neutral.test.ts`   │
 * │ đang làm cho tên hãng.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { buildAssistantPrompt, buildWorkerPrompt } from '../dist/core/prompt.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

/**
 * Mọi CHUỖI trong một file, tách bằng trình phân tích thật của TypeScript.
 *
 * ⚠ KHÔNG bóc chú thích bằng regex. Hai lý do, cả hai đều đã cắn:
 *  ① Chú thích ở các file này **cố ý** nêu tên ngôn ngữ để giải thích vì sao
 *    luật tồn tại (*"a Chinese user gets Chinese lessons"*). Cấm cả chú thích là
 *    cấm nhầm, và nó sẽ khiến người sau xoá đúng lời giải thích cần giữ.
 *  ② `src.replace(/^\s*\/\/.*$/gm, '')` bỏ sót chú thích cuối dòng, còn phiên
 *    bản tham lam hơn thì cắt nhầm `https://` bên trong một chuỗi — tức là nó
 *    **giấu** đi đúng loại vi phạm nó sinh ra để bắt.
 *
 * Soi chuỗi cũng là đúng phạm vi của luật: prompt được dựng từ chuỗi, và một
 * tên ngôn ngữ chỉ hại khi nó tới được model.
 */
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

/** Tên ngôn ngữ, cả dạng tiếng Anh lẫn dạng người Việt hay gõ. */
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
  test(`⭐ ${file}: không chuỗi nào nêu tên một ngôn ngữ`, () => {
    for (const s of stringsIn(read(file), file)) {
      for (const name of LANGUAGE_NAMES) {
        assert.equal(
          s.includes(name),
          false,
          `${file} ghim ngôn ngữ "${name}" trong một chuỗi — đọc docs/CLAUDE.md §Language trước khi thêm lại`,
        );
      }
    }
  });
}

/**
 * ⭐ ĐỐI CHỨNG DƯƠNG — mấy bài trên phải ĐỎ ĐƯỢC.
 *
 * `stringsIn` bỏ chú thích, nên nếu nó lỡ bỏ luôn cả chuỗi thì mọi bài trên vẫn
 * xanh và cổng không canh gì cả. Ném vào nó đúng thứ nó sinh ra để bắt là phép
 * thử rẻ nhất phân biệt được hai chuyện đó. ⇒ [[agentco-free-discriminator]]
 */
test('⭐ đối chứng: `stringsIn` bắt được tên ngôn ngữ trong chuỗi, và bỏ qua chú thích', () => {
  const sample = [
    '// a comment naming Vietnamese on purpose', // i18n-allow-vietnamese: fixture for the gate itself
    '/* a block comment naming German */',
    'const a = "reply in Vietnamese";',
    'const url = "https://example.com/German";',
  ].join('\n');
  const found = stringsIn(sample, 'sample.ts');
  assert.deepEqual(found, ['reply in Vietnamese', 'https://example.com/German']);
  // Chuỗi có `//` bên trong vẫn nguyên vẹn — đây là ca mà bản bóc-bằng-regex cắt nhầm.
  assert.ok(found.some((s) => s.includes('https://')));
});

/**
 * 🔴 Ô KHOÁ CHÍNH: không hàm dựng prompt nào NHẬN một locale.
 *
 * Chuỗi có thể tránh được bằng cách nối chuỗi; một tham số thì không. Đây là
 * chỗ cái dây nối sai sẽ mọc lại trước tiên, vì nó trông như một tuỳ chọn hợp lệ.
 */
test('🔴 `BuildPromptOpts` KHÔNG có trường ngôn ngữ nào', () => {
  const code = read('prompt.ts');
  const iface = /export interface BuildPromptOpts \{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  assert.ok(iface, 'không tìm thấy BuildPromptOpts — test này đã lỗi thời');
  assert.doesNotMatch(withoutComments(iface), /\blanguage\b|\blocale\b|\blang\b/i);
});

/**
 * Ở HAI test dưới, phạm vi soi là thân một khai báo kiểu — không có chuỗi nào
 * trong đó, nên bóc chú thích bằng regex ở đây là an toàn: không có `https://`
 * để cắt nhầm, và một tên trường thì không nằm trong chuỗi.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('🔴 opts của `buildAssistantPrompt` cũng vậy', () => {
  const code = read('prompt.ts');
  const opts = /export function buildAssistantPrompt\([\s\S]*?opts: \{([\s\S]*?)\n  \},/.exec(code)?.[1] ?? '';
  assert.ok(opts, 'không tìm thấy opts của buildAssistantPrompt — test này đã lỗi thời');
  assert.doesNotMatch(withoutComments(opts), /\blanguage\b|\blocale\b|\blang\b/i);
});

/**
 * ⭐ Và luật vẫn phải NÓI về ngôn ngữ — bỏ hẳn câu dặn là một lớp lỗi khác.
 *
 * Model có tín hiệu, nhưng đây là chỗ duy nhất nói cho nó biết tín hiệu nào là
 * tín hiệu ĐÚNG: worker chỉ nhìn thấy brief, không nhìn thấy câu người dùng gõ.
 */
test('⭐ prompt vẫn CHỈ ĐƯỜNG tới tín hiệu, chỉ là không nêu tên ngôn ngữ', () => {
  const code = read('prompt.ts');
  assert.match(code, /in the language of your task brief/);
  assert.match(code, /in the language they are writing to you in/);
});

/**
 * ⭐ Đo ĐẦU RA THẬT của hàm dựng, không chỉ mã nguồn.
 *
 * Soi mã bắt được chuỗi gõ thẳng; nó không bắt được một cái tên ngôn ngữ đi vào
 * qua `office.charter` hay một khối nối động. Đây là ô khoá thứ hai, và nó đọc
 * đúng thứ model sắp nhận. ⇒ [[agentco-free-discriminator]]
 */
test('⭐ prompt DỰNG RA không chứa tên ngôn ngữ nào', () => {
  const office = fakeOffice();
  const worker = buildWorkerPrompt(office, fakeRole(), {});
  const assistant = buildAssistantPrompt(office, { roster: '# Employees\n- none' });

  for (const built of [worker, assistant]) {
    const text = Array.isArray(built.systemPrompt)
      ? built.systemPrompt.join('\n')
      : (built.systemPrompt.append ?? '');
    for (const name of LANGUAGE_NAMES) {
      assert.equal(text.includes(name), false, `prompt dựng ra có chữ "${name}"`);
    }
  }
});

// ─────────────────────────────────────────────────────────── đồ giả tối thiểu

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
