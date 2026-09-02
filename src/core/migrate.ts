/**
 * Di trú v0 → nhiều văn phòng. → docs/SPEC-offices.md §7
 *
 * v0 để `roles/` ngay dưới `company/`. Bản này để nó ở `offices/<id>/roles/`.
 *
 * Làm TỰ ĐỘNG, không hỏi. Đây là thay đổi hình dạng thư mục do TA gây ra khi
 * nâng phần mềm, không phải một quyết định của người dùng — hỏi họ "có muốn di
 * trú không" là bắt họ chịu trách nhiệm cho việc họ không gây ra, và câu trả lời
 * "không" cũng chẳng dẫn tới đâu.
 *
 * Nguyên tắc: CHỈ DI CHUYỂN, không sửa nội dung file nào. Nếu có gì bất thường
 * thì dừng lại và để nguyên hiện trạng — mất một lần nâng cấp còn hơn mất dữ liệu.
 */

import fs from 'node:fs';
import path from 'node:path';

import { companyPaths, officePaths } from './paths.js';
import { t } from '../i18n/index.js';

const DEFAULT_OFFICE = 'van-phong-chinh';

/** Những thứ của v0 thuộc về một VĂN PHÒNG, không thuộc về công ty. */
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

  // Chạy TRƯỚC di trú v0 và độc lập với nó: charter phải rời kho tri thức ở MỌI
  // công ty, kể cả công ty đã ở bố cục nhiều văn phòng từ lâu.
  migrateCharters(pp.offices);
  migrateTasksIntoState(pp.offices);

  // Dấu hiệu còn sót bố cục v0: có bất kỳ mục nào của văn phòng nằm ở cấp công ty.
  const leftovers = OFFICE_ENTRIES.filter((e) => fs.existsSync(path.join(companyDir, e)));
  if (leftovers.length === 0) return;

  const target = path.join(pp.offices, DEFAULT_OFFICE);
  fs.mkdirSync(target, { recursive: true });

  // TỪNG MỤC MỘT, và mỗi mục tự nó idempotent. Windows hay giữ khoá file
  // (antivirus, indexer, một tiến trình vừa thoát), nên một lần rename hỏng
  // giữa chừng là chuyện SẼ xảy ra — và lần chạy sau phải đi tiếp được từ chỗ
  // đang dở, chứ không phải bó tay vì "có cả hai bố cục".
  const failed: string[] = [];
  for (const entry of leftovers) {
    const from = path.join(companyDir, entry);
    const to = path.join(target, entry);
    if (fs.existsSync(to)) {
      // Đích đã có: xung đột thật. Để nguyên cả hai, báo rõ, không đoán.
      failed.push(`${entry} (already present under offices/${DEFAULT_OFFICE}/)`);
      continue;
    }
    if (!moveWithRetry(from, to)) failed.push(entry);
  }

  // .state của v0 trộn hai thứ: daemon (cấp công ty) và session master (cấp
  // văn phòng). Tách đúng chỗ, đổi tên cho khớp thuật ngữ mới.
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

  // company.yaml v0 có charter_file — giờ nó thuộc về office.yaml.
  const officeCfg = officePaths(target).configFile;
  if (!fs.existsSync(officeCfg)) {
    fs.writeFileSync(
      officeCfg,
      `id: ${DEFAULT_OFFICE}\nname: "${t('seed.mainOfficeName')}"\ncharter_file: charter.md\n\n` +
        `assistant:\n  display_name: "${t('seed.assistantName')}"\n  avatar: "★"\n  mcp: []\n`,
      'utf8',
    );
  }

  // layout.json v0 gọi node giám đốc là "master"; giờ là "assistant".
  renameMasterNode(path.join(target, 'layout.json'));

  // Lần hai, và nó KHÔNG thừa: lượt đầu ở trên chạy khi `knowledge/` còn nằm ở
  // cấp công ty nên không thấy charter nào. Giờ nó đã ở trong văn phòng. Hàm
  // idempotent nên gọi hai lần không tốn gì.
  migrateCharters(pp.offices);
  // Cùng lý do: `tasks/` của công ty v0 vừa được dời vào văn phòng ở trên, và
  // nó vào ở bố cục CŨ (ngay dưới gốc văn phòng). Phải giấu nó đi lần nữa.
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
 * │ DI TRÚ NÀY LÀ MỘT PHẦN CỦA BẢN VÁ, KHÔNG PHẢI DỌN DẸP CHO GỌN.           │
 * │                                                                          │
 * │ Chốt chặn là dấu chấm: `Grep`/`Glob` không duyệt xuống thư mục ẩn. Văn    │
 * │ phòng nào còn `tasks/` ở gốc thì chốt đó KHÔNG có hiệu lực với nó — mà    │
 * │ đúng những văn phòng đó mới là nơi đang có kế hoạch và log thật để lạc    │
 * │ vào. Không dời thì bản vá chỉ đúng với văn phòng tạo mới sau hôm nay.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent từng văn phòng, và một văn phòng hỏng không chặn văn phòng khác.
 * Đích đã tồn tại thì GỘP từng file thay vì bó tay: một lần dời hỏng giữa chừng
 * trên Windows (antivirus giữ khoá) là chuyện SẼ xảy ra, và lần chạy sau phải
 * đi tiếp được từ chỗ đang dở.
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
      // Đích đã có (hoặc rename cả thư mục hỏng): dời từng file, rồi bỏ vỏ rỗng.
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) {
        const dest = path.join(to, f);
        // KHÔNG ghi đè: bản ở `.state/` là bản mới hơn. Bản cũ để nguyên chỗ cũ
        // còn hơn đè mất một kế hoạch đang chạy.
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
 * Charter rời `knowledge/shared/_charter.md` → `charter.md` ở gốc văn phòng.
 *
 * → docs/SPEC-library.md §17
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO PHẢI DỜI, CHỨ KHÔNG PHẢI VÁ TẠI CHỖ                               │
 * │                                                                          │
 * │ Charter nằm trong `knowledge/` nên nó vừa là "lớp prompt Giới thiệu văn  │
 * │ phòng" vừa là "một node trong ngăn kéo Tri thức". HAI cửa sổ, HAI đường  │
 * │ ghi, KHÔNG liên kết — và người dùng gặp đúng hậu quả:                     │
 * │                                                                          │
 * │  · node ma trong ngăn kéo mà người dùng không tạo ra và không hiểu       │
 * │  · xoá node đó (hợp lý!) rồi sửa lớp prompt → file được ghi lại KHÔNG    │
 * │    còn frontmatter → nó lặng lẽ thôi là node tri thức, mà prompt vẫn     │
 * │    chạy nên không có gì báo                                              │
 * │  · nó dự thi COLD nên bị tính `hits` và được render THÊM một lần nữa —   │
 * │    trong khi thân charter ĐÃ nằm sẵn trong prefix. Trả tiền hai lần cho  │
 * │    cùng một đoạn văn, lần thứ hai ở giá đầy đủ.                          │
 * │                                                                          │
 * │ Vá từng triệu chứng thì phải nhớ cả ba chỗ mãi mãi. Dời ra thì cả ba     │
 * │ biến mất cùng lúc, và bất biến "kho tri thức chỉ agent ghi" thành thật.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent từng văn phòng: chạy lại bao nhiêu lần cũng ra cùng một kết quả,
 * và một văn phòng hỏng không chặn những văn phòng còn lại.
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
        // Chỉ giữ phần THÂN. Frontmatter là metadata của kho tri thức — nơi
        // charter vừa rời khỏi — nên mang nó theo là mang theo đúng thứ vừa
        // quyết định bỏ.
        const body = stripFrontmatter(fs.readFileSync(oldFile, 'utf8'));
        // Đích đã có nội dung thì KHÔNG đè: đó là bản người dùng viết sau khi
        // di trú, và bản cũ không được phép cướp chỗ của nó.
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
 * `office.yaml` cũ khai thẳng đường dẫn cũ. Không sửa thì zod đọc ra đúng cái
 * đường dẫn vừa bị xoá và charter im lặng thành rỗng.
 *
 * Thay bằng regex trên đúng MỘT dòng chứ không parse rồi ghi lại cả file: ghi
 * lại là mất chú thích và thứ tự khoá người dùng đã sắp.
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
 * Dời một mục. rename trước (nhanh, nguyên tử); nếu Windows từ chối thì
 * copy + xoá. CHỈ xoá nguồn sau khi copy xong — thà để lại rác còn hơn mất dữ liệu.
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

/** Chờ đồng bộ — di trú chạy trước khi có event loop nào đáng để nhường. */
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
    // layout.json chỉ là view state — hỏng thì xoá đi, canvas tự sắp lại.
    fs.rmSync(file, { force: true });
  }
}
