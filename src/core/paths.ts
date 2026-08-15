/**
 * Bố cục thư mục: CÔNG TY chứa nhiều VĂN PHÒNG.
 *
 * → docs/SPEC-offices.md §2
 *
 * ```
 * company/
 * ├─ company.yaml        cấu hình chung
 * ├─ logs/usage.jsonl    chi phí TOÀN công ty, mỗi dòng có cột office
 * ├─ .state/             daemon.json, secrets.json
 * └─ offices/<id>/       văn phòng — TỰ CHỨA, zip lại là một template
 *    ├─ office.yaml · layout.json · roles/ · skills/
 *    ├─ knowledge/{shared,agents}/
 *    └─ artifacts/ · tasks/ · .state/
 * ```
 *
 * Vì sao chi phí ở cấp công ty mà tri thức ở cấp văn phòng: tiền là thứ người
 * dùng muốn nhìn TỔNG (một hoá đơn Claude), còn tri thức nằm trong prefix cache
 * nên phải nằm ở phạm vi hẹp nhất có thể. → SPEC-offices.md §2
 *
 * Ràng buộc container (docs/SPEC-cli.md §4) không đổi: không đường dẫn tuyệt đối
 * nào hard-code, toàn bộ state trong đúng một thư mục để mount 1 volume là đủ.
 */

import path from 'node:path';
import fs from 'node:fs';

export interface CompanyPaths {
  root: string;
  configFile: string;
  offices: string;
  logs: string;
  usageLog: string;
  state: string;
  daemonFile: string;
  secretsFile: string;
}

export interface OfficePaths {
  root: string;
  configFile: string;
  layoutFile: string;
  roles: string;
  skills: string;
  assistantSkills: string;
  knowledge: string;
  knowledgeShared: string;
  knowledgeAgents: string;
  knowledgeInbox: string;
  knowledgeIndex: string;
  artifacts: string;
  tasks: string;
  planIndex: string;
  state: string;
  connectors: string;
}

export function resolveCompanyDir(explicit?: string): string {
  const dir = explicit ?? process.env['AGENTCO_COMPANY_DIR'] ?? path.join(process.cwd(), 'company');
  return path.resolve(dir);
}

export function companyPaths(companyDir: string): CompanyPaths {
  const p = (...s: string[]) => path.join(companyDir, ...s);
  return {
    root: companyDir,
    configFile: p('company.yaml'),
    offices: p('offices'),
    logs: p('logs'),
    usageLog: p('logs', 'usage.jsonl'),
    state: p('.state'),
    daemonFile: p('.state', 'daemon.json'),
    secretsFile: p('.state', 'secrets.json'),
  };
}

export function officePaths(officeDir: string): OfficePaths {
  const p = (...s: string[]) => path.join(officeDir, ...s);
  return {
    root: officeDir,
    configFile: p('office.yaml'),
    layoutFile: p('layout.json'),
    roles: p('roles'),
    skills: p('skills'),
    assistantSkills: p('skills', 'assistant.md'),
    knowledge: p('knowledge'),
    knowledgeShared: p('knowledge', 'shared'),
    knowledgeAgents: p('knowledge', 'agents'),
    knowledgeInbox: p('knowledge', '_inbox'),
    knowledgeIndex: p('knowledge', 'index.json'),
    artifacts: p('artifacts'),
    tasks: p('tasks'),
    planIndex: p('tasks', 'index.json'),
    state: p('.state'),
    connectors: p('connectors'),
  };
}

export function officeDir(company: CompanyPaths, officeId: string): string {
  return path.join(company.offices, officeId);
}

export function ensureCompanyDirs(pp: CompanyPaths): void {
  for (const dir of [pp.root, pp.offices, pp.logs, pp.state]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureOfficeDirs(pp: OfficePaths): void {
  for (const dir of [
    pp.root,
    pp.roles,
    pp.skills,
    pp.knowledge,
    pp.knowledgeShared,
    pp.knowledgeAgents,
    pp.knowledgeInbox,
    pp.artifacts,
    pp.tasks,
    pp.state,
    pp.connectors,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function isCompanyDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'company.yaml'));
}

/** Danh sách id văn phòng, theo thứ tự tên thư mục. Rỗng là hợp lệ — xem §3. */
export function listOfficeIds(pp: CompanyPaths): string[] {
  if (!fs.existsSync(pp.offices)) return [];
  return fs
    .readdirSync(pp.offices, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/**
 * id văn phòng và id vai trò đều được dùng làm TÊN THƯ MỤC/FILE và đều đến từ
 * chữ người dùng gõ. Siết chặt tại một chỗ.
 */
export function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id);
}

export function slugId(input: string): string {
  return input
    .normalize('NFD')
    // \p{M} = mọi dấu tổ hợp. Đừng viết lớp ký tự bằng tay: gõ thẳng dấu tổ hợp
    // vào trong [] thì nó bám lên chính dấu ngoặc và regex thành thứ khác hẳn,
    // mà nhìn trên màn hình vẫn giống hệt.
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 40);
}

/**
 * Chặn path traversal. Artifact path đến từ LLM nên không được tin.
 * Trả về đường dẫn tuyệt đối đã kiểm, hoặc ném lỗi.
 */
export function safeJoin(base: string, relative: string): string {
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Đường dẫn ra ngoài thư mục: ${relative}`);
  }
  return target;
}
