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
import { createHash } from 'node:crypto';

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
  const name = normalizeName(input);
  /**
   * ⚠ RƠI VỀ CHÍNH CÁI TÊN khi slug rỗng — nếu không thì MỌI tên phi-Latin
   * cùng khoá `""`, và `assertNameFree` coi 会计部 với 人力资源 là **trùng tên**.
   * Đo được 22/08: Trung, Nhật, Hàn, Thái, Nga, Ả Rập, Hy Lạp đều ra `""`.
   */
  return slugId(name) || name.toLowerCase();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TÊN THƯ MỤC — `slugId` KHÔNG ĐỦ, VÀ ĐÓ LÀ MỘT BỨC TƯỜNG CHẶN CẢ THỊ      │
 * │ TRƯỜNG. (sửa 22/08)                                                      │
 * │                                                                          │
 * │ `slugId` bóc dấu tổ hợp rồi giữ lại `[a-z0-9]`. Với tiếng Việt nó hoàn   │
 * │ hảo. Với mọi chữ viết KHÔNG phải Latin thì nó trả về **chuỗi rỗng** —    │
 * │ `NFD` không phân rã chữ Hán/Kana/Hangul/Thái/Kirin thành ASCII được:     │
 * │                                                                          │
 * │   "会计部" → ""    "経理部" → ""    "회계팀" → ""                          │
 * │   "แผนกบัญชี" → ""  "Бухгалтерия" → ""  "Λογιστήριο" → ""                  │
 * │                                                                          │
 * │ Hậu quả CŨ: `isSafeId('')` false → `createOffice` ném                    │
 * │ *"Tên văn phòng cần có ít nhất một chữ cái hoặc số"*. Dữ liệu không hỏng │
 * │ (chốt chặn làm đúng việc), nhưng người dùng Trung Quốc gõ 会计部 và nhận  │
 * │ một câu bảo họ *"hãy dùng chữ cái"* — trong khi với họ đó CHÍNH LÀ chữ.  │
 * │ Không có đường đi tiếp. Cả một thị trường dừng ở màn hình tạo văn phòng. │
 * │                                                                          │
 * │ ⚠ VÌ SAO KHÔNG CHO UNICODE THẲNG VÀO TÊN THƯ MỤC — nghe hợp lý mà bẫy:   │
 * │ macOS chuẩn hoá tên file về NFD còn Linux/Windows giữ NFC. Cùng một cái  │
 * │ tên gõ ra hai chuỗi byte khác nhau tuỳ máy, nên `id` thôi khớp ngay khi  │
 * │ một văn phòng được zip từ máy này sang máy kia — đúng thứ lời hứa        │
 * │ "zip lại là chạy được ở máy khác" cấm.                                   │
 * │                                                                          │
 * │ ⇒ Rơi về một id ASCII **ổn định, suy từ chính cái tên**. Thư mục trông   │
 * │   vô nghĩa (`vp-3f8a1c`) nhưng: tên thật nằm trong `office.yaml` ngay     │
 * │   bên trong, giao diện không bao giờ hiện id này, và người dùng có nút    │
 * │   mở thẳng thư mục. Đánh đổi đúng chiều — thà một cái tên xấu mà mở được │
 * │   còn hơn một câu từ chối không có đường đi tiếp.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function folderId(input: string, prefix = 'vp'): string {
  const name = normalizeName(input);
  const slug = slugId(name);
  if (slug) return slug;
  if (!name) return '';
  // Băm CHÍNH cái tên: cùng một tên luôn ra cùng một thư mục, kể cả sau khi
  // xoá đi tạo lại. `toLowerCase` để "会计部 " và "会计部" không thành hai chỗ.
  const h = createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 6);
  return `${prefix}-${h}`;
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
export function resolveInput(
  officeDir: string,
  p: string,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ LOẠI ĐƯỜNG DẪN THỨ BA: **TÊN MỘT CÁNH TAY**. (bug user báo 26/08)       │
   * │                                                                          │
   * │ User gõ *"Liệt kê danh sách bài hát trong Musics"*. Trợ lý làm ĐÚNG      │
   * │ những gì `ASSISTANT_CORE` dặn — *"đường dẫn người dùng gõ là chính xác,  │
   * │ chép nguyên văn vào `inputs`"* — nên nó ghi `inputs: ["Musics"]`. Rồi    │
   * │ `validate` tìm một file tên `Musics` trong văn phòng, không thấy, và     │
   * │ chặn cả kế hoạch: *"không có file đó, và không việc nào tạo ra nó"*.     │
   * │                                                                          │
   * │ Ba lượt liên tiếp, và người dùng nói đúng: *"bạn được cấp MCP rồi mà"*.  │
   * │ Cánh tay tên **Musics** trỏ vào `D:\…\Musics` và nằm ngay trong danh bạ  │
   * │ của chính nhân viên đó. Chuỗi ấy giải được — ta chỉ chưa thử.            │
   * │                                                                          │
   * │ ⚠ Đây là lần THỨ HAI cùng một lớp lỗi ở cùng một hàm: 22/08 nó mù trước  │
   * │ đường dẫn tuyệt đối ngoài văn phòng; hôm nay nó mù trước tên cánh tay.   │
   * │ Cả hai lần, Trợ lý **bị chặn vì tuân lệnh**, và cả hai lần lỗi nằm ở     │
   * │ TẦNG KIỂM chứ không ở tầng lập kế hoạch. Vá ở đây, không ở prompt: một   │
   * │ câu dặn thêm sẽ thua chính dòng danh bạ ghi `Musics (đường tắt tới …)`.  │
   * │ → [[agentco-prompt-rules-lose-to-examples]]                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Khoá đã chuẩn hoá (thường hoá) → thư mục THẬT. Xem `catalog.ts §armDirIndex`.
   */
  armDirs?: Record<string, string>,
): string | undefined {
  if (path.isAbsolute(p)) return p;

  let inOffice: string | undefined;
  try {
    inOffice = safeJoin(officeDir, p);
  } catch {
    // Mưu toan traversal (`../../etc/passwd`) — KHÔNG được rơi xuống nhánh cánh
    // tay để rồi tìm thấy một thứ khác. Nó phải chết ở đây, như trước.
    return undefined;
  }

  /**
   * ⚠ FILE TRONG VĂN PHÒNG THẮNG. Chỉ khi nó không tồn tại mới hỏi tới cánh tay.
   *
   * Ngược lại thì một cánh tay tên `bao-cao` sẽ nuốt mất `bao-cao/` có thật
   * trong văn phòng — im lặng, và ở đúng chỗ người dùng tin nhất.
   */
  if (!armDirs || existsOnDisk(inOffice)) return inOffice;

  const hit = armDirs[p.replace(/[\\/]+$/, '').toLowerCase()];
  // Không khớp ⇒ trả đường trong văn phòng như cũ: câu lỗi phải nói về chỗ
  // người dùng nghĩ tới, không về một thư mục họ chưa từng nhắc.
  return hit ?? inOffice;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÙNG CẤM — hàm thuần đứng sau `officeJail`. → docs/SPEC-arms.md §5d–§5f   │
 * │                                                                          │
 * │ ⚠ ĐO ĐƯỢC 23/08 (`scripts/spike-secrets.ts`), một vai trò chỉ có 7 tool  │
 * │ mặc định, KHÔNG shell:                                                   │
 * │                                                                          │
 * │   A · đọc `company/.state/secrets.json`  → 🔴 ĐỌC ĐƯỢC, chép nguyên văn  │
 * │   B · ghi `roles/<chính-nó>.yaml`        → 🔴 GHI ĐƯỢC, bằng `Write`     │
 * │                                                                          │
 * │ Ca B nặng hơn vẻ ngoài: `Write` là GHI ĐÈ TRỌN FILE, nên một nhân viên   │
 * │ không *sửa* vai trò của mình — nó **thay** vai trò, tự cấp `tools:`,     │
 * │ `secrets:`, `mcp:`. Không receipt, không nhật ký, không dòng nào. Không   │
 * │ có hiệu lực ngay (không `fs.watch`) nhưng SỐNG TRÊN ĐĨA tới `reload()`.   │
 * │                                                                          │
 * │ Vì sao `officeJail` cũ trượt cả hai: nó hỏi đúng MỘT câu — *"có ra ngoài │
 * │ thư mục văn phòng không"*. `.state/` của công ty thì ở ngoài nhưng nó     │
 * │ **chỉ khớp tool GHI**, mà ca A là ĐỌC. `roles/` thì ở TRONG, nên nó cho   │
 * │ qua đúng theo thiết kế. Một câu hỏi, hai lỗ.                             │
 * │                                                                          │
 * │ ⇒ Hai vùng, ba luật, và ranh giới HẸP có chủ ý:                          │
 * │                                                                          │
 * │   `secrets`  `.state/` (công ty VÀ văn phòng)  → cấm CẢ ĐỌC LẪN GHI      │
 * │   `config`   roles· skills· connectors· *.yaml· layout.json → cấm GHI    │
 * │   `outside`  ngoài thư mục văn phòng           → cấm GHI (luật cũ)       │
 * │                                                                          │
 * │ ⚠⚠ THỨ CỐ Ý KHÔNG CHẶN, và nó quan trọng NGANG phần chặn: `artifacts/`,  │
 * │ `knowledge/`, `library/` mở nguyên. Kho tri thức là chỗ nhân viên GHI     │
 * │ bài học — chặn nó là giết cơ chế học. Một bản vá chặn được A+B mà chặn    │
 * │ luôn mấy chỗ này là hỏng NGƯỢC CHIỀU, và im lặng hơn hẳn, vì không ai đi │
 * │ kiểm một việc vốn vẫn chạy. Có test canh đúng chuyện đó.                 │
 * │                                                                          │
 * │ ⚠ Bonus không định trước: cấm đọc `<office>/.state/` bịt luôn lỗ đã ghi   │
 * │ ở `OfficePaths.tasks` — *"KHÔNG phải một bức tường bảo mật: `Read` với    │
 * │ đường dẫn tường minh vẫn mở được"*. Giờ nó là tường thật.                │
 * │                                                                          │
 * │ ⚠ RANH GIỚI PHẢI NÓI RA: hàm này chỉ với tới tool có ĐƯỜNG DẪN Ở MỘT     │
 * │ TRƯỜNG CÓ TÊN. `Bash` nhét đường dẫn lẫn trong chuỗi lệnh ⇒ vẫn đi vòng  │
 * │ qua được. Câu đúng là "ĐÃ HẸP LẠI, CHƯA ĐÓNG" — đừng viết "đã bịt lỗ",   │
 * │ đó là lời hứa thứ tư sau `canUseTool`, `safeJoin` và §8·0.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type GuardedZone = 'secrets' | 'config' | 'outside' | 'browser';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 `.playwright-mcp` — DẤU CHẤM CHẶN **TÌM THẤY**, KHÔNG CHẶN **ĐỌC**.   │
 * │ (user hỏi 30/08, đo ra khe hở)                                           │
 * │                                                                          │
 * │ > *"tôi lo nó mò vào .playwright-mcp hoặc .state/browser (cái này hình    │
 * │ >  như bị chặn rất nặng)"*                                               │
 * │                                                                          │
 * │ Nửa sau đúng: `.state/browser/profile` (**506 MB** cookie + phiên đăng    │
 * │ nhập) bị khoá cứng, vì phép kiểm `.state` nằm **trước** dòng cho `read`   │
 * │ đi qua. Nửa trước thì hở: `.playwright-mcp` là **anh em** của `.state`,   │
 * │ không nằm dưới nó ⇒ `guardedZone('read')` trả `undefined` ⇒ gõ đúng       │
 * │ đường dẫn là đọc được.                                                   │
 * │                                                                          │
 * │ Dấu chấm đầu tên **là một cơ chế** — `Grep`/`Glob` không duyệt xuống thư  │
 * │ mục ẩn (đã đo). Nhưng đó là chặn *tìm thấy*, không phải chặn *đọc*, và    │
 * │ hai thứ đó khác nhau đúng ở chỗ một cái tên bị lộ ra ngoài (log lỗi, câu  │
 * │ người dùng dán vào, một artifact cũ) là hàng rào hết tác dụng.            │
 * │                                                                          │
 * │ Thứ nằm trong đó không vô hại: `redact.ts` sinh ra vì đọc được **chìa      │
 * │ phiên Facebook dạng chữ** (`fb_dtsg=…&__user=…`) trong `console-*.log`.   │
 * │ Nó cắt query khỏi URL — **giảm thiểu, không bịt kín**, và chính nó ghi ra │
 * │ điều đó. Chặn đọc cả thư mục là lá chắn thứ hai, khác tầng.              │
 * │                                                                          │
 * │ ⚠ Vì sao một vùng RIÊNG chứ không gộp vào `secrets`: câu lỗi của          │
 * │ `secrets` nói về `.state` và chìa khoá. Trả câu đó cho một nhân viên vừa  │
 * │ chạm log trình duyệt là **chỉ sai cửa** — họ đi tìm chìa khoá ở chỗ không │
 * │ có, còn việc đúng phải làm (chụp lại trang) thì không ai nói.            │
 * │                                                                          │
 * │ 🔴🔴 CHẶN CẢ THƯ MỤC LÀ CẮT TAY NHÂN VIÊN TRÌNH DUYỆT. (user hỏi đúng   │
 * │ lúc, 30/08: *"việc bịt khe .playwright-mcp có ảnh hưởng tới worker đang   │
 * │ cắm cánh tay trình duyệt không?"* — CÓ, nếu chặn thô.)                   │
 * │                                                                          │
 * │ Đo thư mục thật: **20 `console-*.log` + 21 `page-*.yml`**. Cái sau là     │
 * │ **ảnh chụp trang** — thứ nhân viên ĐỌC để biết trang đang hiện gì, và     │
 * │ `redact.ts §isConsoleLog` đã ghi sẵn *"Snapshot (`page-*.yml`) không được │
 * │ đụng — worker đọc nó"*. Một hàng rào chặn luôn nó là biến cánh tay trình  │
 * │ duyệt thành vô dụng, im lặng, ở đúng lượt người dùng cần nó nhất.         │
 * │                                                                          │
 * │ ⇒ Luật: **mặc định từ chối trong thư mục đó, chừa đúng một lối ra**.      │
 * │ Mặc định-từ-chối vì file kiểu mới thêm vào sau này (trace, har, video)    │
 * │ đều là dấu vết phiên, và một allowlist thì cái mới **tự động** bị chặn;   │
 * │ một denylist thì cái mới **tự động lọt**. → [[agentco-silent-allowlist]]  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const BROWSER_OUTPUT = '.playwright-mcp';

/** Lối ra duy nhất: ảnh chụp trang. Mọi thứ khác trong thư mục đó là dấu vết phiên. */
const isPageSnapshot = (p: string): boolean => /^page-[^\\/]*\.ya?ml$/i.test(path.basename(p));

/**
 * AI đang gọi, và vì thế luật nào áp.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `arm` KHÔNG PHẢI "write nhẹ tay hơn" — nó là một PHẬN SỰ KHÁC.           │
 * │                                                                          │
 * │   `read`   tool đọc builtin   → chỉ cấm `secrets`                        │
 * │   `write`  tool ghi builtin   → cấm `secrets` · `config` · `outside`     │
 * │   `arm`    tool của MCP       → cấm `secrets` · `config`, CHO `outside`  │
 * │                                                                          │
 * │ Vì sao `arm` được ra ngoài: đó chính là LÝ DO NÓ TỒN TẠI. Luật §8·0      │
 * │ (user chốt 22/08) nói *"mọi đường GHI RA ngoài phải qua một tool/MCP     │
 * │ TƯỜNG MINH — có tên, khai báo được, đọc được trong nhật ký"*. Cấm        │
 * │ `outside` cho `arm` là cấm đúng con đường tử tế mà luật đó vừa dựng ra,  │
 * │ và người dùng sẽ quay lại dùng `Bash` — thứ không có biên nào.           │
 * │                                                                          │
 * │ Nhưng biên của cánh tay KHÔNG phải là "không có biên": nó bị chặn bởi    │
 * │ chính MCP server, ở đúng danh sách thư mục người dùng đã khai            │
 * │ (`roots` = `cwd` + `additionalDirectories`, đo 24/08). Ta chỉ thêm hai   │
 * │ vùng mà server KHÔNG BAO GIỜ biết là nhạy cảm: kho chìa và file cấu hình.│
 * │                                                                          │
 * │ ⚠ `arm` cấm CẢ ĐỌC file cấu hình, trong khi `read` builtin thì cho.      │
 * │ Cố ý, và lệch về phía an toàn: lúc hook chạy ta chỉ có TÊN TOOL, không   │
 * │ có cách tất định nào biết `mcp__x__foo` là đọc hay ghi — dò chuỗi tên là │
 * │ đúng cái class bất định đã loại ở §5n ㉕. Cái giá của phủ định sai ở đây │
 * │ bằng 0: `Read` builtin vẫn đọc được `roles/*.yaml` như trước.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type GuardMode = 'read' | 'write' | 'arm';

/** Thư mục/file thuộc vùng `config` — tương đối với thư mục VĂN PHÒNG. */
const OFFICE_CONFIG = ['roles', 'skills', 'connectors', 'office.yaml', 'layout.json'];

/**
 * `a` có nằm trong (hoặc chính là) `b` không.
 *
 * ⚠ So bằng chữ THƯỜNG trên MỌI nền tảng, không dò `process.platform`. Trên
 * Windows `ROLES\x.yaml` và `roles\x.yaml` là CÙNG một file, nên so phân biệt
 * hoa thường ở đó là để hở một cửa sau chỉ cần viết hoa là qua. Cái giá ở phía
 * kia: trên Linux một thư mục tên `Roles` khác `roles` sẽ bị chặn oan — một ca
 * gần như không tồn tại, và nó lệch về phía an toàn. Đổi một phủ định-sai
 * hoang đường lấy việc bịt một cửa sau có thật.
 */
function within(a: string, b: string): boolean {
  const rel = path.relative(b.toLowerCase(), a.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Lời gọi tool này có chạm vùng cấm không? `undefined` = cho qua.
 *
 * `target` là chuỗi model gõ — tuyệt đối hoặc tương đối với thư mục văn phòng
 * (`cwd` của worker). Chuỗi rỗng = tool không khai đường dẫn ⇒ cho qua.
 */
export function guardedZone(
  dirs: {
    companyDir: string;
    officeDir: string;
    /**
     * Vai trò này CÓ cánh tay trình duyệt không — đã giải sẵn từ `role.mcp` lúc
     * dựng worker. Không khai ⇒ **coi như không có**, tức chặt hơn: vắng mặt
     * không phải tín hiệu an toàn. → khối ở chỗ dùng nó bên dưới
     */
    hasBrowser?: boolean;
  },
  target: string,
  mode: GuardMode,
): GuardedZone | undefined {
  if (!target) return undefined;
  const abs = path.resolve(dirs.officeDir, target);

  // `.state` TRƯỚC mọi thứ: nó vừa nằm ngoài văn phòng (bản công ty) vừa nằm
  // trong (bản văn phòng), nên hỏi sau thì một nửa số ca rơi vào nhánh khác và
  // nhận một câu giải thích nói về chuyện không liên quan.
  for (const state of [companyPaths(dirs.companyDir).state, officePaths(dirs.officeDir).state]) {
    if (within(abs, state)) return 'secrets';
  }
  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ HAI ĐIỀU KIỆN, MỘT CHỖ — và bỏ vế nào cũng hỏng theo một kiểu.        │
   * │ (user đề xuất vế ①, 30/08; vế ② là thứ vế ① một mình sẽ đánh rơi)      │
   * │                                                                        │
   * │  ① KHÔNG có cánh tay trình duyệt ⇒ chặn **cả thư mục**. Đây là đặc      │
   * │     quyền tối thiểu nói đúng bằng lời của nó: *đầu ra của một cánh tay  │
   * │     thuộc về người cầm cánh tay đó*. Nhân viên Linear không có việc gì  │
   * │     với ảnh chụp trang của lượt trước — mà ảnh chụp **có PII thật**     │
   * │     (ca 30/08: email tự-điền trong form đăng nhập Facebook).            │
   * │                                                                        │
   * │  ② CÓ cánh tay ⇒ vẫn chặn `console-*.log`. Người cầm cánh tay cũng      │
   * │     **không** cần chìa phiên dạng chữ (`fb_dtsg=…&__user=…`). Gác theo  │
   * │     mỗi vế ① thì nhân viên trình duyệt được mở cả log — **rộng hơn**    │
   * │     luật hôm nay, tức một bước LÙI đội lốt bước siết.                   │
   * │                                                                        │
   * │ ⚠ `hasBrowser` là một **cờ boolean tính sẵn**, không phải `role` hay    │
   * │ danh sách cánh tay. Giữ hàm này THUẦN theo đường dẫn + một dữ kiện đã   │
   * │ giải: nó là hàng rào an ninh, và thứ khó kiểm chứng nhất là hàng rào    │
   * │ phải tự đi tra cấu hình mới biết mình đang gác gì.                      │
   * │ `role.mcp` vẫn là nguồn DUY NHẤT của "ai cầm gì" — ta chỉ đọc nó một    │
   * │ lần lúc dựng worker. → [[agentco-count-mechanisms]]                     │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  if (within(abs, path.join(dirs.officeDir, BROWSER_OUTPUT))) {
    if (!dirs.hasBrowser || !isPageSnapshot(abs)) return 'browser';
  }

  if (mode === 'read') return undefined;

  for (const rel of OFFICE_CONFIG) {
    if (within(abs, path.join(dirs.officeDir, rel))) return 'config';
  }
  if (within(abs, companyPaths(dirs.companyDir).configFile)) return 'config';

  // Cánh tay DỪNG Ở ĐÂY. Ra ngoài văn phòng là việc của nó, không phải sự cố —
  // và biên thật của nó do MCP server giữ, ở đúng thư mục người dùng đã khai.
  if (mode === 'arm') return undefined;

  return within(abs, dirs.officeDir) ? undefined : 'outside';
}

/**
 * DUYỆT THƯ MỤC — nguồn của bộ chọn thư mục trong hộp thoại `+ Kết nối`.
 * → docs/SPEC-arms.md §6f
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO KHÔNG DÙNG HỘP THOẠI CHỌN FILE CỦA HỆ ĐIỀU HÀNH                   │
 * │                                                                          │
 * │ Trình duyệt KHÔNG đưa được đường dẫn tuyệt đối: `<input webkitdirectory>` │
 * │ chỉ trả tên tương đối, File System Access API trả một handle chứ không    │
 * │ phải chuỗi. Còn mở hộp thoại của HĐH thì nó mở **trên MÁY CHỦ** — đúng ca │
 * │ nút 📂 đã dẫm (`isLoopback`): bấm ở Hà Nội, cửa sổ bật ở Singapore.       │
 * │                                                                          │
 * │ ⇒ Tự liệt kê. Chạy được cả khi daemon ở xa hoặc trong container, và nó    │
 * │ liệt kê ĐÚNG cái filesystem mà cánh tay sẽ nhìn thấy — không phải cái     │
 * │ filesystem của người đang ngồi trước màn hình. Với Docker (§10b) đó là    │
 * │ khác biệt sống còn, và bộ chọn này tự đúng ở đó mà không sửa gì.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ CHỈ ĐỌC TÊN, không đọc nội dung. Nó nói *"có những thư mục nào"*, và đó là
 * thứ ít nhất cần để chọn được — không hơn.
 */
export interface BrowseEntry {
  name: string;
  path: string;
}

export function browseDirs(target?: string): { path: string; parent: string | null; dirs: BrowseEntry[] } {
  // Không truyền gì = gốc. Trên Windows "gốc" là DANH SÁCH Ổ ĐĨA, không phải
  // một thư mục — bỏ qua chuyện này là người dùng Windows không có đường lên
  // trên `C:\` và không bao giờ với tới ổ D.
  if (!target) {
    if (process.platform === 'win32') {
      const drives: BrowseEntry[] = [];
      for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${c}:\\`;
        try {
          if (fs.existsSync(root)) drives.push({ name: root, path: root });
        } catch {
          /* ổ mạng đã ngắt thì bỏ qua, đừng làm hỏng cả danh sách */
        }
      }
      return { path: '', parent: null, dirs: drives };
    }
    return listDirs('/');
  }
  return listDirs(path.resolve(target));
}

function listDirs(dir: string): { path: string; parent: string | null; dirs: BrowseEntry[] } {
  const up = path.dirname(dir);
  // `dirname('C:\\')` trả về chính nó ⇒ đã ở gốc ổ. Trả `''` để giao diện quay
  // về danh sách ổ đĩa thay vì đưa một nút "lên trên" không đi đâu cả.
  const parent = up === dir ? (process.platform === 'win32' ? '' : null) : up;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Không đọc được (không quyền, ổ đã rút) — trả rỗng chứ không ném. Người
    // dùng vẫn bấm "lên trên" được, và đó là đường thoát duy nhất họ cần.
    return { path: dir, parent, dirs: [] };
  }

  const dirs = entries
    // Bỏ thư mục ẩn: chúng là nhiễu với người dùng văn phòng, và `.state/` thì
    // đằng nào cũng nằm sau hàng rào `guardedZone`.
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  return { path: dir, parent, dirs };
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
