/**
 * Nạp cấu hình. HAI CẤP: công ty (tiền, model) và văn phòng (người, tri thức).
 *
 * → docs/SPEC-offices.md §2, docs/SPEC-cli.md §3
 *
 * Thứ tự ưu tiên: cờ dòng lệnh > biến môi trường > company.yaml > mặc định.
 *
 * Ranh giới đặt ở đâu và vì sao: thứ gì ảnh hưởng tới HOÁ ĐƠN thì ở cấp công ty
 * (một subscription Claude, một hoá đơn, một chỗ để siết). Thứ gì đi vào PREFIX
 * CACHE thì ở cấp văn phòng, vì prefix phải hẹp nhất có thể.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import {
  CompanyConfigSchema,
  OfficeConfigSchema,
  RoleSchema,
  type CompanyConfig,
  type OfficeConfig,
  type Role,
  type SkillLevel,
} from './types.js';
import { companyPaths, officePaths, type CompanyPaths, type OfficePaths } from './paths.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

export interface LoadedOffice {
  id: string;
  dir: string;
  paths: OfficePaths;
  config: OfficeConfig;
  /** Cấu hình công ty — model, ngân sách, trần token. Dùng chung, chỉ đọc. */
  company: CompanyConfig;
  companyDir: string;
  roles: Map<string, Role>;
  /**
   * Vai trò đã lưu trữ. Vẫn nằm trong `roles` (để khôi phục và để tra tên trong
   * nhật ký cũ) nhưng KHÔNG lên canvas, KHÔNG vào roster của Trợ lý.
   *
   * Tách thành Set riêng chứ không bắt mỗi chỗ tự đọc `role.archived`: có sáu
   * chỗ phải lọc, và chỗ nào quên thì lỗi hiện ra rất muộn và rất khó hiểu
   * (nhân viên "đã cất" bỗng nhận được việc).
   */
  archivedRoles: Set<string>;
  /** Charter đã đọc + cắt về trần. Nằm trong prefix được cache của MỌI agent. */
  charter: string;
  /** Skills người dùng viết cho Assistant. Có thể rỗng — đó là lựa chọn hợp lệ. */
  assistantSkills: string;
  knowledgeVersion: number;
}

function readYaml(file: string): unknown {
  if (!fs.existsSync(file)) return {};
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch (err) {
    throw new Error(`${path.basename(file)} không phải YAML hợp lệ: ${(err as Error).message}`);
  }
}

/** AGENTCO_RUNTIME_CONCURRENCY=8 -> config.runtime.concurrency = 8 */
function applyEnvOverrides(cfg: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('AGENTCO_') || value === undefined) continue;
    const pathParts = key.slice('AGENTCO_'.length).toLowerCase().split('_');
    // Bỏ qua biến điều khiển process, không phải cấu hình công ty
    if (['company', 'dir', 'headless', 'log', 'format', 'token', 'office'].includes(pathParts[0] ?? '')) continue;

    let cursor: Record<string, unknown> = cfg;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i]!;
      if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = pathParts[pathParts.length - 1]!;
    const num = Number(value);
    cursor[leaf] =
      value === 'true' ? true : value === 'false' ? false : Number.isFinite(num) && value.trim() !== '' ? num : value;
  }
}

export function loadCompanyConfig(dir: string, overrides: Record<string, unknown> = {}): CompanyConfig {
  const pp = companyPaths(dir);
  if (!fs.existsSync(pp.configFile)) {
    throw new Error(
      `Không tìm thấy company.yaml trong ${dir}.\nChạy \`agentco init\` để tạo công ty mới.`,
    );
  }
  const raw = readYaml(pp.configFile) as Record<string, unknown>;
  applyEnvOverrides(raw);
  deepMerge(raw, overrides);

  const parsed = CompanyConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`company.yaml sai định dạng:\n${formatZodError(parsed.error)}`);
  return parsed.data;
}

/**
 * Nạp một văn phòng.
 *
 * KHÔNG ném lỗi khi chưa có nhân viên nào — văn phòng vừa tạo hợp lệ và rỗng là
 * bình thường (SPEC-offices.md §3). v0 ném lỗi ở đây, và đó là lý do "khởi điểm
 * sạch" không thể tồn tại cùng nó.
 */
export function loadOffice(
  companyDir: string,
  companyConfig: CompanyConfig,
  officeId: string,
): LoadedOffice {
  const dir = path.join(companyPaths(companyDir).offices, officeId);
  const pp = officePaths(dir);

  const rawCfg = readYaml(pp.configFile) as Record<string, unknown>;
  rawCfg['id'] ??= officeId;
  const parsedCfg = OfficeConfigSchema.safeParse(rawCfg);
  if (!parsedCfg.success) {
    throw new Error(`offices/${officeId}/office.yaml sai định dạng:\n${formatZodError(parsedCfg.error)}`);
  }
  const config = parsedCfg.data;

  // ── roles
  const roles = new Map<string, Role>();
  const archivedRoles = new Set<string>();
  if (fs.existsSync(pp.roles)) {
    for (const file of fs.readdirSync(pp.roles).sort()) {
      if (!/\.(ya?ml)$/i.test(file)) continue;
      const roleRaw = readYaml(path.join(pp.roles, file)) as Record<string, unknown>;
      roleRaw['id'] ??= file.replace(/\.(ya?ml)$/i, '');
      const r = RoleSchema.safeParse(roleRaw);
      if (!r.success) {
        // Một file role hỏng KHÔNG được làm sập cả văn phòng — tiêu chí "Ổn định".
        // Bỏ qua nó, cảnh báo, canvas sẽ hiện node đỏ "không tìm thấy vai trò".
        process.emitWarning(
          `offices/${officeId}/roles/${file} sai định dạng, đã bỏ qua:\n${formatZodError(r.error)}`,
        );
        continue;
      }
      roles.set(r.data.id, r.data);
      if (r.data.archived) archivedRoles.add(r.data.id);
    }
  }

  // ── charter: pinned, nằm trong prefix cache, phải nhỏ và ổn định
  let charter = '';
  const charterFile = path.join(dir, config.charter_file);
  if (fs.existsSync(charterFile)) {
    // CHỈ lấy phần thân. Charter là một node tri thức nên nó có YAML frontmatter
    // (id, type, tags, confidence…) — thứ có nghĩa với KHO, không có nghĩa với
    // MODEL. Đọc nguyên file là nhét ~40 token metadata vào prefix cache của
    // MỌI nhân viên, mãi mãi, để nói với model những điều nó không dùng được.
    charter = stripFrontmatter(fs.readFileSync(charterFile, 'utf8'));
    const tokens = estimateTokens(charter);
    if (tokens > companyConfig.budgets.charter_tokens) {
      process.emitWarning(
        `Charter văn phòng "${officeId}" ${tokens} token, vượt trần ${companyConfig.budgets.charter_tokens}. ` +
          `Đã cắt. Charter nằm trong prefix cache của MỌI agent — giữ nó ngắn.`,
      );
      charter = truncateToTokens(charter, companyConfig.budgets.charter_tokens);
    }
  }

  // ── skills của Assistant: người dùng sửa được, rỗng cũng hợp lệ
  let assistantSkills = '';
  if (fs.existsSync(pp.assistantSkills)) {
    assistantSkills = fs.readFileSync(pp.assistantSkills, 'utf8').trim();
    const tokens = estimateTokens(assistantSkills);
    if (tokens > companyConfig.budgets.assistant_skills_tokens) {
      process.emitWarning(
        `skills/assistant.md của "${officeId}" ${tokens} token, vượt trần ` +
          `${companyConfig.budgets.assistant_skills_tokens}. Đã cắt. Khối này nằm trong prefix của ` +
          `MỌI lượt trò chuyện với Assistant — mỗi dòng thừa là thuế thu suốt ca.`,
      );
      assistantSkills = truncateToTokens(assistantSkills, companyConfig.budgets.assistant_skills_tokens);
    }
  }

  return {
    id: officeId,
    dir,
    paths: pp,
    config,
    company: companyConfig,
    companyDir,
    roles,
    archivedRoles,
    charter,
    assistantSkills,
    knowledgeVersion: readKnowledgeVersion(pp),
  };
}

/**
 * File skill của một vai trò — ĐƯỜNG DẪN TƯƠNG ĐỐI với thư mục văn phòng.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỌC VÀ GHI PHẢI DÙNG CHUNG ĐÚNG HÀM NÀY.                                 │
 * │                                                                          │
 * │ Bug đã sửa: giao diện GHI vào `skills/<id>.md` (đường dự phòng của        │
 * │ `describePrompt`), còn `loadSkill` chỉ ĐỌC những gì khai trong            │
 * │ `role.skills`. Nhân viên tạo từ giao diện có `skills: {}`, nên người dùng │
 * │ bấm Lưu → server ghi file thật → đọc lại vẫn ra rỗng. Nội dung họ vừa    │
 * │ viết biến mất, kể cả sau khi tải lại trang, mà không có một câu lỗi nào.  │
 * │                                                                          │
 * │ Hai đường dẫn khác nhau cho cùng một thứ là cách âm thầm nhất để làm mất  │
 * │ việc của người dùng — cùng loại lỗi với `cheap`→`eco` không có alias.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Thứ tự: khai trong yaml → quy ước `<id>.<mức>.md` đã có trên đĩa → `<id>.md`.
 */
export function skillFileFor(office: LoadedOffice, role: Role): string {
  const level: SkillLevel = role.skill_level;
  const declared = role.skills[level] ?? role.skills['medium'] ?? role.skills['short'];
  if (declared) return declared;

  // Văn phòng của v0 đặt tên theo mức (`skills/writer.medium.md`). Tôn trọng
  // file đã có trên đĩa, đừng đẻ ra file thứ hai cạnh nó.
  const byLevel = `skills/${role.id}.${level}.md`;
  if (fs.existsSync(path.join(office.dir, byLevel))) return byLevel;

  return `skills/${role.id}.md`;
}

/** Đọc nội dung skill theo mức đã chọn của role. Rỗng là hợp lệ. */
export function loadSkill(office: LoadedOffice, role: Role): string {
  const rel = skillFileFor(office, role);
  const file = path.join(office.dir, rel);
  if (!fs.existsSync(file)) {
    // Chỉ cảnh báo khi file được KHAI TƯỜNG MINH mà không thấy — đó mới là lỗi
    // cấu hình. Đường dự phòng chưa có file là trạng thái bình thường của một
    // nhân viên mới: skills mặc định TRỐNG.
    const declared = role.skills[role.skill_level] ?? role.skills['medium'] ?? role.skills['short'];
    if (declared) process.emitWarning(`Vai trò "${role.id}": không thấy file skill ${declared}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function readKnowledgeVersion(pp: OfficePaths): number {
  const file = path.join(pp.knowledge, 'version.json');
  if (!fs.existsSync(file)) return 1;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: number };
    return typeof v.version === 'number' ? v.version : 1;
  } catch {
    return 1;
  }
}

/**
 * Bump version tri thức -> đổi cacheKey của mọi role -> mọi prefix phải ghi lại cache.
 * CỐ Ý không gọi tự động mỗi lần ghi node: gom theo lô (Librarian, M1).
 */
export function bumpKnowledgeVersion(pp: OfficePaths): number {
  const next = readKnowledgeVersion(pp) + 1;
  fs.mkdirSync(pp.knowledge, { recursive: true });
  fs.writeFileSync(path.join(pp.knowledge, 'version.json'), JSON.stringify({ version: next }, null, 2));
  return next;
}

// ─────────────────────────────────────────────────────────── helpers

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Bỏ khối YAML đầu file, giữ phần thân. Không có frontmatter thì trả nguyên. */
function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER, '').trim();
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof target[k] !== 'object' || target[k] === null) target[k] = {};
      deepMerge(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
}

function formatZodError(err: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return err.issues.map((i) => `  ${i.path.join('.') || '(gốc)'}: ${i.message}`).join('\n');
}

export type { CompanyPaths, OfficePaths };
