/**
 * Nạp cấu hình công ty và định nghĩa vai trò.
 *
 * Thứ tự ưu tiên: cờ dòng lệnh > biến môi trường > company.yaml > mặc định.
 * (docs/SPEC-cli.md §3)
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import {
  CompanyConfigSchema,
  RoleSchema,
  type CompanyConfig,
  type Role,
  type SkillLevel,
} from './types.js';
import { paths, type Paths } from './paths.js';
import { estimateTokens, truncateToTokens } from './tokens.js';

export interface LoadedCompany {
  dir: string;
  paths: Paths;
  config: CompanyConfig;
  roles: Map<string, Role>;
  /** Nội dung charter đã đọc + cắt về trần. Nằm trong prefix được cache. */
  charter: string;
  /** Bump khi tri thức HOT đổi -> đi vào cacheKey. Xem knowledge/version.ts */
  knowledgeVersion: number;
}

function readYaml(file: string): unknown {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  return YAML.parse(raw) ?? {};
}

/** AGENTCO_RUNTIME_CONCURRENCY=8 -> config.runtime.concurrency = 8 */
function applyEnvOverrides(cfg: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('AGENTCO_') || value === undefined) continue;
    const pathParts = key.slice('AGENTCO_'.length).toLowerCase().split('_');
    // Bỏ qua biến điều khiển process, không phải cấu hình công ty
    if (['company', 'dir', 'headless', 'log', 'format'].includes(pathParts[0] ?? '')) continue;

    let cursor: Record<string, unknown> = cfg;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i]!;
      if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = pathParts[pathParts.length - 1]!;
    const num = Number(value);
    cursor[leaf] = value === 'true' ? true : value === 'false' ? false : Number.isFinite(num) && value.trim() !== '' ? num : value;
  }
}

export function loadCompany(dir: string, overrides: Record<string, unknown> = {}): LoadedCompany {
  const pp = paths(dir);

  if (!fs.existsSync(pp.configFile)) {
    throw new Error(
      `Không tìm thấy company.yaml trong ${dir}.\nChạy \`agentco init\` để tạo công ty mới.`,
    );
  }

  const raw = readYaml(pp.configFile) as Record<string, unknown>;
  applyEnvOverrides(raw);
  deepMerge(raw, overrides);

  const parsed = CompanyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`company.yaml sai định dạng:\n${formatZodError(parsed.error)}`);
  }
  const config = parsed.data;

  // ── roles
  const roles = new Map<string, Role>();
  if (fs.existsSync(pp.roles)) {
    for (const file of fs.readdirSync(pp.roles)) {
      if (!/\.(ya?ml)$/i.test(file)) continue;
      const roleRaw = readYaml(path.join(pp.roles, file)) as Record<string, unknown>;
      roleRaw['id'] ??= file.replace(/\.(ya?ml)$/i, '');
      const r = RoleSchema.safeParse(roleRaw);
      if (!r.success) {
        throw new Error(`roles/${file} sai định dạng:\n${formatZodError(r.error)}`);
      }
      roles.set(r.data.id, r.data);
    }
  }
  if (roles.size === 0) {
    throw new Error(`Không có vai trò nào trong ${pp.roles}. Cần ít nhất một file .yaml.`);
  }

  // ── charter: pinned, nằm trong prefix cache, phải nhỏ và ổn định
  let charter = '';
  const charterFile = path.join(dir, config.charter_file);
  if (fs.existsSync(charterFile)) {
    charter = fs.readFileSync(charterFile, 'utf8').trim();
    const tokens = estimateTokens(charter);
    if (tokens > config.budgets.charter_tokens) {
      process.emitWarning(
        `Charter ${tokens} token, vượt trần ${config.budgets.charter_tokens}. Đã cắt. ` +
          `Charter nằm trong prefix cache của MỌI agent — giữ nó ngắn.`,
      );
      charter = truncateToTokens(charter, config.budgets.charter_tokens);
    }
  }

  return {
    dir,
    paths: pp,
    config,
    roles,
    charter,
    knowledgeVersion: readKnowledgeVersion(pp),
  };
}

/** Đọc nội dung skill theo mức đã chọn của role. */
export function loadSkill(company: LoadedCompany, role: Role): string {
  const level: SkillLevel = role.skill_level;
  const rel = role.skills[level] ?? role.skills['medium'] ?? role.skills['short'];
  if (!rel) return '';
  const file = path.join(company.dir, rel);
  if (!fs.existsSync(file)) {
    process.emitWarning(`Vai trò "${role.id}": không thấy file skill ${rel}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function readKnowledgeVersion(pp: Paths): number {
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
export function bumpKnowledgeVersion(pp: Paths): number {
  const next = readKnowledgeVersion(pp) + 1;
  fs.mkdirSync(pp.knowledge, { recursive: true });
  fs.writeFileSync(path.join(pp.knowledge, 'version.json'), JSON.stringify({ version: next }, null, 2));
  return next;
}

// ─────────────────────────────────────────────────────────── helpers

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
