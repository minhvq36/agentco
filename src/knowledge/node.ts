/**
 * Node tri thức: markdown + YAML frontmatter.
 *
 * → docs/SPEC-2026-08-14-agentco.md §5
 *
 * Định dạng cố ý chọn để NGƯỜI đọc được và MÁY đọc được cùng lúc: mở bằng
 * bất kỳ editor nào, diff được bằng git, không khoá vào định dạng riêng.
 * Đây là hiện thân của nguyên tắc "sở hữu artifact, không sở hữu prompt".
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { estimateTokens } from '../core/tokens.js';

export type NodeType = 'policy' | 'pitfall' | 'playbook' | 'fact' | 'reference';

export interface KnowledgeNode {
  id: string;
  type: NodeType;
  title: string;
  tags: string[];
  links: string[];
  /** 'shared' = master ghi, cả công ty đọc. 'role:<id>' = chính agent đó ghi và đọc. */
  scope: string;
  author: string;
  confidence: number;
  hits: number;
  pinned: boolean;
  /**
   * Node này ĐÈ LÊN những node nào. → docs/SPEC-2026-08-14-agentco.md §5
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ĐÂY LÀ MẢNH DUY NHẤT GIỮ CHO KHO TRI THỨC ĐÚNG LÊN, KHÔNG CHỈ CŨ ĐI.    │
   * │                                                                          │
   * │ `hits` và `updated` chỉ làm node ít dùng TỤT HẠNG. Chúng không trả lời   │
   * │ được câu quan trọng nhất: "quyết định này đã bị đảo ngược chưa?" Một     │
   * │ node sai mà hay được đọc sẽ đứng đầu bảng mãi mãi.                        │
   * │                                                                          │
   * │ Node bị đè KHÔNG bị xoá — file còn nguyên, đọc lại được để biết vì sao   │
   * │ ngày xưa mình nghĩ thế. Nó chỉ rời khỏi phần được nạp vào prompt.        │
   * │ Cùng tinh thần với Lưu trữ: cất đi thì được, xoá dấu vết thì không.      │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Cố ý là MỘT TRƯỜNG chứ không phải một đồ thị: quan hệ duy nhất kho này thật
   * sự dùng là "đè lên". Dựng graph engine cho một quan hệ là mua độ phức tạp
   * trước khi có bài toán.
   */
  supersedes: string[];
  updated: string;
  /**
   * Lần cuối node này được chọn vì HỢP VỚI MỘT VIỆC (tức là được `cold()` chấm
   * trúng). Rỗng = chưa lần nào.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MỘT NGÀY, KHÔNG PHẢI MỘT MẢNG — và không phải một cơ chế decay.          │
   * │                                                                          │
   * │ `hits` cộng dồn và chỉ tăng, nên nó bất tử: một node được dùng đúng một  │
   * │ lần hai năm trước vẫn `hits > 0` mãi mãi và không bao giờ bị dọn.        │
   * │                                                                          │
   * │ Lối ra KHÔNG phải cho `hits` tự tiêu hao — decay cần một LỊCH CHẠY (mỗi  │
   * │ task? mỗi ngày? daemon tắt hai tuần thì sao?), và cái lịch đó sẽ trôi.   │
   * │                                                                          │
   * │ Cửa sổ thì KHÔNG TRẠNG THÁI: chỉ cần biết lần cuối là bao giờ, rồi so    │
   * │ với hôm nay LÚC ĐỌC. Daemon tắt bao lâu cũng vẫn đúng, không job nền.    │
   * │                                                                          │
   * │ Hai chỉ số, hai việc, cố ý không trộn:                                    │
   * │   `hits`      → XẾP HẠNG vào HOT  (cộng dồn, thưởng cho ích lâu dài)     │
   * │   `last_used` → KHAI TỬ, kể cả khi hits > 0                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Node cũ chưa có trường này thì rơi về `updated` — không cần bảng alias.
   */
  last_used?: string;
  source?: string;
  body: string;
  tokens: number;
  /** đường dẫn file, tương đối với thư mục công ty */
  file: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseNode(raw: string, file: string): KnowledgeNode | undefined {
  const m = FRONTMATTER.exec(raw);
  if (!m) return undefined;
  let fm: Record<string, unknown>;
  try {
    fm = (YAML.parse(m[1] ?? '') ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const body = (m[2] ?? '').trim();
  const id = str(fm['id']) || file.replace(/\.md$/i, '').replace(/\\/g, '/');

  return {
    id,
    type: (str(fm['type']) as NodeType) || 'fact',
    title: str(fm['title']) || id.split('/').pop() || id,
    tags: arr(fm['tags']),
    links: [...new Set([...arr(fm['links']), ...wikilinks(body)])],
    scope: str(fm['scope']) || 'shared',
    author: str(fm['author']) || 'master',
    confidence: num(fm['confidence'], 0.7),
    hits: num(fm['hits'], 0),
    pinned: fm['pinned'] === true,
    supersedes: arr(fm['supersedes']),
    updated: str(fm['updated']) || new Date().toISOString().slice(0, 10),
    ...(str(fm['last_used']) ? { last_used: str(fm['last_used']) } : {}),
    ...(str(fm['source']) ? { source: str(fm['source']) } : {}),
    body,
    tokens: estimateTokens(body),
    file,
  };
}

export function serializeNode(n: KnowledgeNode): string {
  const fm: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    title: n.title,
    tags: n.tags,
    links: n.links.filter((l) => !n.body.includes(`[[${l}]]`)),
    scope: n.scope,
    author: n.author,
    confidence: round2(n.confidence),
    hits: n.hits,
    updated: n.updated,
  };
  if (n.pinned) fm['pinned'] = true;
  if (n.supersedes.length) fm['supersedes'] = n.supersedes;
  if (n.last_used) fm['last_used'] = n.last_used;
  if (n.source) fm['source'] = n.source;
  return `---\n${YAML.stringify(fm).trim()}\n---\n\n${n.body.trim()}\n`;
}

export function readNodeFile(companyDir: string, relFile: string): KnowledgeNode | undefined {
  const abs = path.join(companyDir, relFile);
  if (!fs.existsSync(abs)) return undefined;
  return parseNode(fs.readFileSync(abs, 'utf8'), relFile.replace(/\\/g, '/'));
}

export function writeNodeFile(companyDir: string, n: KnowledgeNode): void {
  const abs = path.join(companyDir, n.file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeNode(n), 'utf8');
}

/** Từ khoá để chấm điểm truy xuất. Bỏ stopword tiếng Việt hay gặp. */
export function keywordsOf(n: Pick<KnowledgeNode, 'title' | 'tags' | 'body'>): string[] {
  return tokenize(`${n.title} ${n.tags.join(' ')} ${n.body}`);
}

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
    ),
  ];
}

const STOPWORDS = new Set(
  ('và của có là không cho với những các được người khi này đó thì mà nếu ở từ về ra vào lên xuống ' +
    'một hai để nên như đã sẽ đang cũng rất nhiều ít hơn nhất bị bởi vì nhưng hoặc tôi bạn chúng ta ' +
    'the and for with that this from you your are was were will have has not but can all any its it')
    .split(/\s+/),
);

function wikilinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
const round2 = (n: number): number => Math.round(n * 100) / 100;
