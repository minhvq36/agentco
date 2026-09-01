/**
 * DANH TÍNH ỨNG DỤNG PHẢI SỐNG LÂU BẰNG CHÌA NÓ CẤP. → `core/secrets.ts §$clients`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CA THẬT, truy 27/08: hai tài khoản Notion chết với `invalid_grant`.      │
 * │                                                                          │
 * │ Đo ra: hai cái chết dùng **chung một `client_id` cũ**, cái sống dùng      │
 * │ `client_id` mới nhất — và cả hai client vẫn tồn tại (`invalid_grant` chứ  │
 * │ không phải `invalid_client`). Thủ phạm là một dòng: `client_id` xin bằng  │
 * │ đăng ký động chỉ nằm trong một `Map` **trong RAM**, nên mỗi lần bật lại   │
 * │ daemon là **đăng ký một ứng dụng mới** ở phía dịch vụ.                    │
 * │                                                                          │
 * │ ⇒ Luật: **ứng dụng đứng yên, chỉ chìa xoay.** Đó là cách một phiên web    │
 * │ sống được cả năm.                                                        │
 * │                                                                          │
 * │ Hai test dưới đây khoá hai nửa, và nửa thứ hai mới là nửa dễ mất: giữ     │
 * │ được qua **tắt máy** thì dễ thấy, giữ được qua **một thao tác không liên  │
 * │ quan** (cắm một cánh tay) thì không ai nghĩ tới cho tới khi mất.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

import { companyPaths } from '../dist/core/paths.js';
import {
  readClients,
  readOAuth,
  readSecrets,
  saveClient,
  saveOAuth,
  writeSecrets,
} from '../dist/core/secrets.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-clients-'));
const paths = (): ReturnType<typeof companyPaths> => companyPaths(dir);

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(paths().secretsFile, { force: true });
});

const KEY = 'https://mcp.notion.com|http://127.0.0.1:7317/api/oauth/callback';

const ACC = {
  client_id: 'client-cu',
  access_token: 'at',
  refresh_token: 'rt',
  token_type: 'bearer',
  mcp_url: 'https://mcp.notion.com/mcp',
  issuer: 'https://mcp.notion.com',
};

test('⭐ client_id ghi xuống ĐĨA — sống qua một lần tắt daemon', () => {
  saveClient(paths(), KEY, 'client-1');
  // "Tắt daemon" = không còn state trong RAM; đọc lại từ đĩa là toàn bộ phép thử.
  assert.equal(readClients(paths())[KEY], 'client-1');
});

test('⭐ khoá gồm redirect_uri — đổi cổng ⇒ ứng dụng khác, không dùng nhầm', () => {
  // `client_id` được cấp CHO ĐÚNG URI đã đăng ký. Dùng lại khi đổi cổng ⇒
  // `invalid_redirect_uri`, một câu lỗi không hề nói ra nguyên nhân thật.
  saveClient(paths(), KEY, 'client-1');
  const khac = 'https://mcp.notion.com|http://127.0.0.1:9999/api/oauth/callback';
  assert.equal(readClients(paths())[khac], undefined);
  saveClient(paths(), khac, 'client-2');
  assert.equal(readClients(paths())[KEY], 'client-1', 'đăng ký cho cổng mới không được đè cái cũ');
});

test('🔴 CẮM MỘT CÁNH TAY KHÔNG ĐƯỢC XOÁ $clients (nửa dễ mất nhất)', () => {
  /**
   * `writeSecrets` dựng lại cả file. Bản trước nêu đích danh `$oauth` trong đúng
   * dòng đó ⇒ khoá dành riêng THỨ HAI bị xoá lặng lẽ ở lần cắm cánh tay kế tiếp
   * — tức dựng lại đúng cái lỗi vừa truy ra, qua một cửa khác.
   */
  saveClient(paths(), KEY, 'client-1');
  saveOAuth(paths(), 'NOTION_OAUTH_A1B2C3D4', ACC as never);

  writeSecrets(paths(), { ...readSecrets(paths()), SHOP_TOKEN: 'abc' });

  assert.equal(readClients(paths())[KEY], 'client-1', '$clients bị xoá ⇒ lần sau đăng ký app MỚI');
  assert.ok(readOAuth(paths())['NOTION_OAUTH_A1B2C3D4'], '$oauth vẫn phải còn (hồi quy cũ)');
  assert.equal(readSecrets(paths())['SHOP_TOKEN'], 'abc');
});

test('⭐ kho rỗng ⇒ không đẻ ra khoá rỗng trong file', () => {
  writeSecrets(paths(), { A: 'x' });
  const raw = JSON.parse(fs.readFileSync(paths().secretsFile, 'utf8')) as Record<string, unknown>;
  assert.equal('$clients' in raw, false, 'khoá rỗng chỉ làm file khó đọc');
  assert.equal('$oauth' in raw, false);
});

test('⭐ chìa của tài khoản KHÔNG bị lẫn với danh tính ứng dụng', () => {
  // `readSecrets` dàn phẳng access_token theo TÊN CHÌA. `$clients` không được
  // lọt vào đó — nó không phải chìa, và một cái tên lạ trong map chìa sẽ đi
  // thẳng vào `env` của tiến trình MCP.
  saveClient(paths(), KEY, 'client-1');
  saveOAuth(paths(), 'NOTION_OAUTH_A1B2C3D4', ACC as never);
  const s = readSecrets(paths());
  assert.deepEqual(Object.keys(s), ['NOTION_OAUTH_A1B2C3D4']);
});
