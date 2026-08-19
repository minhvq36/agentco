/**
 * Kho bí mật cấp CÔNG TY. → docs/SPEC-offices.md §5
 *
 * `company/.state/secrets.json` — đã nằm trong .gitignore, và hàm đọc file duy
 * nhất phơi ra HTTP (`ArtifactStore.resolve`) chỉ nhận đường dẫn nằm TRONG
 * `artifacts/`, nên `.state/` không có cửa nào ra ngoài.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐẶC QUYỀN TỐI THIỂU. Vai trò khai `secrets: [NOTION_TOKEN]` thì CHỈ khoá  │
 * │ đó được đưa vào môi trường tiến trình MCP của nó. Không có "cho hết cho   │
 * │ tiện": một agent bị prompt injection qua nội dung nó đọc chỉ cầm được     │
 * │ đúng những chìa ta đã trao, và cái giá của sai sót vì thế là hữu hạn.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Giá trị bí mật KHÔNG BAO GIỜ đi vào prompt. Chúng là biến môi trường của tiến
 * trình MCP — model không đọc được chúng, chỉ dùng được tool đã mở khoá sẵn.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CompanyPaths } from './paths.js';

export type SecretMap = Record<string, string>;

export function readSecrets(paths: CompanyPaths): SecretMap {
  if (!fs.existsSync(paths.secretsFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(paths.secretsFile, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: SecretMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    // Bí mật hỏng KHÔNG được làm sập công ty — agent nào cần sẽ tự báo thiếu chìa.
    process.emitWarning('.state/secrets.json không đọc được. Agent cần chìa sẽ báo thiếu.');
    return {};
  }
}

export function writeSecrets(paths: CompanyPaths, map: SecretMap): void {
  fs.mkdirSync(path.dirname(paths.secretsFile), { recursive: true });
  fs.writeFileSync(paths.secretsFile, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  // Trên POSIX: chỉ chủ sở hữu đọc được. Trên Windows chmod là no-op, ACL mặc
  // định của thư mục người dùng đã đủ — nhưng gọi vẫn đúng và vô hại.
  try {
    fs.chmodSync(paths.secretsFile, 0o600);
  } catch {
    /* không đặt được quyền thì thôi */
  }
}

/** Chỉ những chìa vai trò này được khai. Thiếu chìa nào thì trả tên nó ra. */
export function grantFor(
  all: SecretMap,
  wanted: readonly string[],
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of wanted) {
    const value = all[name];
    if (value === undefined) missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}

/** Chỉ TÊN, không bao giờ giá trị — dùng cho giao diện và log. */
export function secretNames(paths: CompanyPaths): string[] {
  return Object.keys(readSecrets(paths)).sort();
}
