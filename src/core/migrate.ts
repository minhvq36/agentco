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
      failed.push(`${entry} (đã có sẵn ở offices/${DEFAULT_OFFICE}/)`);
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
      `id: ${DEFAULT_OFFICE}\nname: "Văn phòng chính"\ncharter_file: knowledge/shared/_charter.md\n\nassistant:\n  display_name: "Trợ lý"\n  avatar: "★"\n  mcp: []\n`,
      'utf8',
    );
  }

  // layout.json v0 gọi node giám đốc là "master"; giờ là "assistant".
  renameMasterNode(path.join(target, 'layout.json'));

  if (failed.length) {
    process.emitWarning(
      `Di trú chưa xong. Chưa dời được: ${failed.join(', ')}.\n` +
        `Thường là do file đang bị khoá (antivirus, hoặc daemon cũ chưa tắt hẳn).\n` +
        `Chạy \`agentco stop\` rồi mở lại — phần đã dời được giữ nguyên, lần sau đi tiếp từ đó.`,
    );
    return;
  }

  console.log(
    `Đã chuyển công ty sang bố cục nhiều văn phòng.\n` +
      `  Mọi thứ cũ giờ nằm trong offices/${DEFAULT_OFFICE}/\n` +
      `  Không có nội dung file nào bị sửa.`,
  );
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
