/**
 * TÊN MẶC ĐỊNH CỦA CÁNH TAY TỰ CẮM — `armexec.ts §defaultArmLabel`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ User 31/08: khối JSON **trần** (không có vỏ `mcpServers`) ⇒ nhãn rỗng ⇒   │
 * │ node mang tên là một cái BĂM. Và từ 30/08 nó không còn là chuyện thẩm mỹ: │
 * │ `armReach` dựng dòng danh bạ bằng `label || id`, nên Trợ lý **nhìn thấy   │
 * │ cái băm làm tên cánh tay** — đúng ca §16r.                                │
 * │                                                                          │
 * │ Thứ tự user chốt: ① tên trong sổ · ② tên người gõ (`"so-tay"`) ·          │
 * │ ③ suy từ cấu hình · ④ băm.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { defaultArmLabel } from '../dist/core/armexec.js';

// ────────────────────────────────────────────────────── http / sse: tên miền

test('http: lấy TÊN MIỀN, và bỏ tiền tố kỹ thuật `mcp.`', () => {
  assert.equal(defaultArmLabel({ type: 'http', url: 'https://mcp.deepwiki.com/mcp' }), 'deepwiki.com');
  assert.equal(defaultArmLabel({ type: 'http', url: 'https://mcp.notion.com/mcp' }), 'notion.com');
  assert.equal(defaultArmLabel({ type: 'sse', url: 'http://127.0.0.1:3009/sse' }), '127.0.0.1');
});

test('http: tên miền không có tiền tố thì giữ nguyên', () => {
  assert.equal(defaultArmLabel({ url: 'https://api.githubcopilot.com/mcp/' }), 'api.githubcopilot.com');
});

// ───────────────────────────────────────────────────────── stdio: tên gói

test('stdio: lấy TÊN GÓI, bỏ scope', () => {
  const cfg = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] };
  assert.equal(defaultArmLabel(cfg), 'server-memory');
});

test('stdio: gói có PHIÊN BẢN thì phiên bản không dính vào tên', () => {
  const cfg = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10', 'D:\\x'] };
  assert.equal(defaultArmLabel(cfg), 'server-filesystem');
});

test('stdio KHÔNG qua npx: lấy tên chương trình, không lấy cả đường dẫn', () => {
  assert.equal(defaultArmLabel({ command: 'D:\\bin\\my-server.exe', args: [] }), 'my-server');
  assert.equal(defaultArmLabel({ command: 'python' }), 'python');
});

// ─────────────────────────────── 🔴 ĐƯỢC PHÉP NÓI KHÔNG BIẾT

test('🔴 suy không ra ⇒ `undefined`, để chỗ gọi rơi về BĂM', () => {
  // Một cái tên bịa tệ hơn một cái băm thật thà: băm thì người dùng biết là mã,
  // còn một cái tên sai thì họ tin.
  assert.equal(defaultArmLabel({ type: 'sdk', name: 'x' }), undefined);
  assert.equal(defaultArmLabel({ url: 'khong-phai-url' }), undefined);
  assert.equal(defaultArmLabel({}), undefined);
  assert.equal(defaultArmLabel(null), undefined);
  assert.equal(defaultArmLabel('chuỗi'), undefined);
});

test('⭐ KHÔNG quét `url` ở mọi tầng — `url` lồng trong `env`/`headers` KHÔNG phải endpoint', () => {
  /**
   * Câu user hỏi: *"có phải lúc nào nó cũng cùng depth, hay chúng ta chỉ cần
   * tìm key `url` any depth là được"*.
   *
   * Tìm mọi tầng là SAI: `McpHttpServerConfig` của SDK phẳng, nên `url` ở tầng
   * ngoài cùng LÀ endpoint. Một `url` nằm sâu bên trong là địa chỉ API của hãng
   * — đặt tên cánh tay theo nó là sai **một cách tự tin**.
   */
  const cfg = { command: 'npx', args: ['-y', 'server-x'], env: { API_URL: 'https://vendor.example.com' } };
  assert.equal(defaultArmLabel(cfg), 'server-x', 'phải lấy tên gói, KHÔNG lấy vendor.example.com');
});
