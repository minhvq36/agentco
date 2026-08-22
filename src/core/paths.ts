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
 *    ├─ knowledge/{shared,agents}/ · library/{files,text}/
 *    └─ artifacts/ · .state/tasks/
 * ```
 *
 * Dấu chấm ở `.state/` là một CƠ CHẾ, không phải quy ước đặt tên: `Grep`/`Glob`
 * không duyệt xuống thư mục ẩn (đã đo). Thứ agent phải tìm thấy (`library/`,
 * `artifacts/`, `knowledge/`) nằm ngoài; thứ agent không được lạc vào
 * (`tasks/` — kế hoạch, log, receipt của nhau) nằm trong. → `OfficePaths.tasks`
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
  /**
   * Tủ tài liệu — file NGƯỜI DÙNG đưa vào. → docs/SPEC-library.md
   *
   * ⚠ KHÔNG được đặt dưới `.state/` hay bất kỳ thư mục nào bắt đầu bằng dấu
   * chấm: `Grep` bỏ qua thư mục ẩn khi duyệt xuống (đã đo — SPEC-library.md
   * §2.1), nên giấu nó đi là làm cả cơ chế truy xuất chết im lặng.
   */
  library: string;
  libraryFiles: string;
  libraryText: string;
  /**
   * Kế hoạch · log · receipt. **Nằm SAU dấu chấm, và đó là cả cơ chế.**
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ ĐẢO CHIỀU CỦA LUẬT NGAY TRÊN, VÀ DÙNG CHUNG MỘT SỰ THẬT ĐÃ ĐO.          │
   * │                                                                         │
   * │ `library/` không được ẩn vì agent PHẢI `Grep` thấy. `tasks/` thì ngược   │
   * │ lại: agent KHÔNG được thấy, nên nó phải ẩn.                             │
   * │                                                                         │
   * │ Đo được 20/08 (`P-260820-2219-5ltb`): `cwd` của worker là cả thư mục     │
   * │ văn phòng, nên `nguoi-gop` lạc đường đã Glob quét sạch cây thư mục rồi   │
   * │ ĐỌC `P-…plan.json` và `P-…log.jsonl`. File log chứa receipt của task     │
   * │ khác ⇒ một cửa sau của giao thức *"Receipt trần 800 token — Trợ lý       │
   * │ không bao giờ đọc transcript worker"*. Nó cũng đọc được cả DAG.          │
   * │                                                                         │
   * │ Chặn bằng CẤU TRÚC, không bằng kỷ luật: `Grep`/`Glob` không duyệt xuống  │
   * │ thư mục bắt đầu bằng dấu chấm (đã đo — SPEC-library.md §2.1). Không cần  │
   * │ `canUseTool`, không cần danh sách cấm, không cần ai nhớ gì.              │
   * │                                                                         │
   * │ ⚠ Đây KHÔNG phải một bức tường bảo mật — `Read` với đường dẫn tường minh │
   * │ vẫn mở được. Nó chặn đúng con đường có thật: **đi lạc rồi vấp phải.**    │
   * └─────────────────────────────────────────────────────────────────────────┘
   */
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
    library: p('library'),
    libraryFiles: p('library', 'files'),
    libraryText: p('library', 'text'),
    tasks: p('.state', 'tasks'),
    planIndex: p('.state', 'tasks', 'index.json'),
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
    pp.library,
    pp.libraryFiles,
    pp.libraryText,
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

/**
 * Tên hiển thị người dùng gõ: bỏ khoảng trắng thừa ở hai đầu VÀ ở giữa.
 *
 * Gộp khoảng trắng giữa là phần hay bị quên. "Nội  dung" và "Nội dung" nhìn
 * giống hệt nhau trong ô chọn văn phòng nhưng là hai chuỗi khác nhau — người
 * dùng sẽ thấy hai dòng y hệt và không biết mình đang mở cái nào.
 */
export function normalizeName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Khoá so trùng TÊN. Cố ý dùng lại `slugId`: hai văn phòng không được có tên
 * trùng nhau theo đúng cái nghĩa mà hệ thống đã dùng để đặt tên thư mục.
 *
 * Nhờ vậy chỉ có MỘT định nghĩa "trùng": "Nội dung", "nội  dung", "Noi Dung"
 * đều ra `noi-dung`. Nếu so bằng chuỗi thô thì `createOffice` (so theo slug) và
 * `rename` (so theo chuỗi) sẽ bất đồng, và đổi tên trở thành cửa sau để tạo ra
 * đúng cái trùng lặp mà lúc tạo mới đã bị chặn.
 */
export function nameKey(input: string): string {
  return slugId(normalizeName(input));
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

/**
 * ĐẦU VÀO của một task → đường dẫn tuyệt đối để mở. `undefined` = không hợp lệ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MỘT LUẬT, MỘT CHỖ. Đây là hàm sinh ra vì đã có BA chỗ tự suy ra nó.      │
 * │                                                                          │
 * │ `inputs` có HAI loại đường dẫn, và trước 22/08 code chỉ biết một:         │
 * │                                                                          │
 * │   · TƯƠNG ĐỐI với thư mục văn phòng — tài liệu trong tủ, kết quả ca      │
 * │     trước. `safeJoin` nhốt chúng lại, và phải giữ nguyên như thế.        │
 * │   · TUYỆT ĐỐI, nằm ngoài văn phòng — thứ người dùng gõ thẳng vào ô chat  │
 * │     (`D:\Downloads\…`, `/home/an/anh`). Hợp lệ từ ngày `Bash` bật sẵn.   │
 * │                                                                          │
 * │ Ba chỗ tự viết lại phép phân biệt này: `Scheduler.validate`,             │
 * │ `Scheduler.missingInputs`, và phép kiểm "kết quả có ôi không" ở          │
 * │ `Office`. Cả ba đều viết đúng MỘT nửa — `try { safeJoin } catch { coi    │
 * │ như không có }` — nên cả ba cùng mù trước loại thứ hai. Ca đo được       │
 * │ 22/08: người dùng gõ một thư mục có thật trên máy và bị chặn ở bước lập  │
 * │ kế hoạch với câu *"không việc nào tạo ra nó"*.                           │
 * │                                                                          │
 * │ Sửa ba chỗ bằng ba miếng vá là mời lỗi quay lại ở chỗ thứ tư. Một hàm    │
 * │ thì chỗ thứ tư tự đúng.                                                  │
 * │                                                                          │
 * │ ⚠ Phân biệt bằng `isAbsolute`, KHÔNG bằng "safeJoin có ném không". Một   │
 * │ đường dẫn tương đối leo ra ngoài (`../../etc/passwd`) cũng làm safeJoin  │
 * │ ném, nhưng nó là mưu toan traversal — nó phải trả `undefined`, không     │
 * │ được rơi vào nhánh "ngoài văn phòng" rồi được đem đi `existsSync` theo   │
 * │ `cwd` của daemon, một cái gốc chẳng liên quan gì tới ai.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function resolveInput(officeDir: string, p: string): string | undefined {
  if (path.isAbsolute(p)) return p;
  try {
    return safeJoin(officeDir, p);
  } catch {
    return undefined;
  }
}

/**
 * Có thật trên đĩa không. `existsSync` **ném được**, không chỉ trả `false`: ký
 * tự cấm trong tên, hoặc một ổ mạng đã ngắt. Ném ở đây là làm sập cả lượt lập
 * kế hoạch vì một đường dẫn gõ sai — đúng thứ phép kiểm này sinh ra để báo cáo
 * tử tế.
 */
export function existsOnDisk(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
