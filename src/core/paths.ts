/**
 * Bố cục thư mục công ty. Mọi đường dẫn TƯƠNG ĐỐI với COMPANY_DIR.
 *
 * Ràng buộc container (docs/SPEC-cli.md §4): không đường dẫn tuyệt đối nào
 * được hard-code, toàn bộ state nằm trong đúng một thư mục để mount 1 volume là đủ.
 */

import path from 'node:path';
import fs from 'node:fs';

export interface Paths {
  root: string;
  configFile: string;
  roles: string;
  skills: string;
  knowledge: string;
  knowledgeShared: string;
  knowledgeAgents: string;
  knowledgeInbox: string;
  knowledgeIndex: string;
  artifacts: string;
  tasks: string;
  logs: string;
  usageLog: string;
  state: string;
  daemonFile: string;
  secretsFile: string;
  connectors: string;
}

export function resolveCompanyDir(explicit?: string): string {
  const dir = explicit ?? process.env['AGENTCO_COMPANY_DIR'] ?? path.join(process.cwd(), 'company');
  return path.resolve(dir);
}

export function paths(companyDir: string): Paths {
  const p = (...s: string[]) => path.join(companyDir, ...s);
  return {
    root: companyDir,
    configFile: p('company.yaml'),
    roles: p('roles'),
    skills: p('skills'),
    knowledge: p('knowledge'),
    knowledgeShared: p('knowledge', 'shared'),
    knowledgeAgents: p('knowledge', 'agents'),
    knowledgeInbox: p('knowledge', '_inbox'),
    knowledgeIndex: p('knowledge', 'index.json'),
    artifacts: p('artifacts'),
    tasks: p('tasks'),
    logs: p('logs'),
    usageLog: p('logs', 'usage.jsonl'),
    state: p('.state'),
    daemonFile: p('.state', 'daemon.json'),
    secretsFile: p('.state', 'secrets.json'),
    connectors: p('connectors'),
  };
}

export function ensureDirs(pp: Paths): void {
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
    pp.logs,
    pp.state,
    pp.connectors,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function isCompanyDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'company.yaml'));
}

/**
 * Chặn path traversal. Artifact path đến từ LLM nên không được tin.
 * Trả về đường dẫn tuyệt đối đã kiểm, hoặc ném lỗi.
 */
export function safeJoin(base: string, relative: string): string {
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Đường dẫn ra ngoài thư mục công ty: ${relative}`);
  }
  return target;
}
