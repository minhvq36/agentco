/**
 * Test cho **CHÌA OAUTH LÀ MỘT LOẠI CHÌA**, không phải hệ thống thứ hai.
 * → `src/core/secrets.ts` · `src/core/oauth.ts` · docs/SPEC-arms.md §5h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Hai bất biến đắt nhất mà file này canh, và cả hai đều HỎNG IM LẶNG:      │
 * │                                                                          │
 * │ ① `writeSecrets` KHÔNG được nuốt mất `$oauth`. `addArm` gọi              │
 * │    `writeSecrets({ ...readSecrets(pp), ...secrets })` — tức **cắm một    │
 * │    cánh tay bất kỳ** đi qua đường này. Nuốt một lần là mọi tài khoản đã  │
 * │    đăng nhập biến mất, và `refresh_token` đã XOAY thì không lấy lại được.│
 * │                                                                          │
 * │ ② `applyToken` phải giữ `refresh_token` cũ khi server không gửi cái mới, │
 * │    và phải THAY khi server có gửi. Sai chiều nào cũng chỉ lộ ra ở lần    │
 * │    làm mới **thứ hai**, tức ~8 giờ sau — lúc không ai còn nối được       │
 * │    nguyên nhân với triệu chứng.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readOAuth, readSecrets, saveOAuth, writeSecrets } from '../dist/core/secrets.js';
import { applyToken, needsRefresh } from '../dist/core/oauth.js';

function paths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-oauth-'));
  return { secretsFile: path.join(dir, '.state', 'secrets.json') } as never;
}

const ACC = {
  client_id: 'c1',
  access_token: 'at-1',
  refresh_token: 'rt-1',
  token_type: 'Bearer',
  mcp_url: 'https://mcp.notion.com/mcp',
  issuer: 'https://mcp.notion.com',
  label: 'Không gian của Minh',
};

// ─────────────────────────────────────────── chìa tĩnh không đổi hành vi

test('chìa tĩnh vẫn đọc/ghi y như cũ — không di trú gì', () => {
  const p = paths();
  writeSecrets(p, { A: '1', B: '2' });
  assert.deepEqual(readSecrets(p), { A: '1', B: '2' });
});

test('file chưa có thì trả rỗng, không ném', () => {
  assert.deepEqual(readSecrets(paths()), {});
  assert.deepEqual(readOAuth(paths()), {});
});

// ────────────────────────────────────────────────── dàn phẳng

test('tài khoản OAuth dàn phẳng thành access_token dưới ĐÚNG tên chìa', () => {
  // Đây là cả điểm của thiết kế: `grantFor`/`injectSecrets`/`armHash` không
  // biết OAuth tồn tại, và không cần biết.
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  assert.equal(readSecrets(p)['NOTION_OAUTH_A1B2'], 'at-1');
});

test('OAuth THẮNG chìa tĩnh cùng tên — chiều này cố ý', () => {
  // Người dùng dán tay một token hôm nay, mai bấm Đăng nhập. Nếu chuỗi tĩnh
  // thắng thì họ đăng nhập xong mà hệ thống vẫn dùng cái đã chết 8 tiếng trước.
  const p = paths();
  writeSecrets(p, { NOTION_OAUTH_A1B2: 'dán-tay-cũ' });
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  assert.equal(readSecrets(p)['NOTION_OAUTH_A1B2'], 'at-1');
});

test('bản ghi OAuth hỏng nửa chừng bị BỎ, không dàn phẳng thành undefined', () => {
  // Dàn phẳng một bản ghi thiếu `access_token` là gửi `Bearer undefined` lên
  // server ⇒ 401 ⇒ đúng cái câu "sai chìa" cho một chuyện khác hẳn. → §5m
  const p = paths();
  saveOAuth(p, 'X', { client_id: 'c' } as never);
  assert.deepEqual(readOAuth(p), {});
  assert.equal('X' in readSecrets(p), false);
});

// ──────────────────────── ⭐ writeSecrets không được nuốt $oauth

test('⭐ writeSecrets GIỮ tài khoản OAuth — cắm cánh tay không được xoá đăng nhập', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  // Đúng dòng mà `Company.addArm` chạy:
  writeSecrets(p, { ...readSecrets(p), GITHUB_TOKEN: 'ghp_x' });
  assert.equal(readOAuth(p)['NOTION_OAUTH_A1B2']?.refresh_token, 'rt-1');
  assert.equal(readSecrets(p)['GITHUB_TOKEN'], 'ghp_x');
});

test('⭐ writeSecrets KHÔNG đúc bản sao tĩnh của một chìa tự làm mới', () => {
  // `readSecrets` dàn phẳng, nên ghi thẳng map ấy xuống là đóng băng một chìa
  // sống thành một chuỗi chết nằm lại trong file — vô hại hôm nay, và là quả
  // mìn cho người sau mở file ra đọc.
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_A1B2', ACC as never);
  writeSecrets(p, readSecrets(p));
  const onDisk = JSON.parse(fs.readFileSync((p as { secretsFile: string }).secretsFile, 'utf8')) as Record<string, unknown>;
  assert.equal('NOTION_OAUTH_A1B2' in onDisk, false, 'access_token bị đúc thành chìa tĩnh');
  assert.ok(onDisk['$oauth'], 'phần $oauth phải còn');
});

test('saveOAuth(null) xoá đúng một tài khoản, không đụng cái còn lại', () => {
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  saveOAuth(p, 'B', { ...ACC, access_token: 'at-b' } as never);
  saveOAuth(p, 'A', null);
  assert.deepEqual(Object.keys(readOAuth(p)), ['B']);
});

test('nhiều tài khoản cùng lúc — hai workspace Notion sống song song', () => {
  const p = paths();
  saveOAuth(p, 'NOTION_OAUTH_AAAA', { ...ACC, access_token: 'at-a', label: 'Cá nhân' } as never);
  saveOAuth(p, 'NOTION_OAUTH_BBBB', { ...ACC, access_token: 'at-b', label: 'Công ty' } as never);
  const s = readSecrets(p);
  assert.equal(s['NOTION_OAUTH_AAAA'], 'at-a');
  assert.equal(s['NOTION_OAUTH_BBBB'], 'at-b');
});

// ─────────────────────────────── ⭐ refresh token XOAY

test('⭐ applyToken THAY refresh_token khi server gửi cái mới', () => {
  // Notion xoay chìa: giữ cái cũ ⇒ tự khoá mình ở lần làm mới THỨ HAI.
  const next = applyToken(ACC as never, { access_token: 'at-2', refresh_token: 'rt-2' } as never);
  assert.equal(next.refresh_token, 'rt-2');
  assert.equal(next.access_token, 'at-2');
});

test('⭐ applyToken GIỮ refresh_token cũ khi server KHÔNG gửi', () => {
  // Server khác có thể không trả refresh mới. Ghi đè bằng `undefined` là vứt
  // mất cái đang dùng được — cùng một dấu `??`, hai chiều hỏng.
  const next = applyToken(ACC as never, { access_token: 'at-2' } as never);
  assert.equal(next.refresh_token, 'rt-1');
});

test('applyToken giữ danh tính (client_id · mcp_url · issuer · nhãn) qua mỗi lần làm mới', () => {
  const next = applyToken(ACC as never, { access_token: 'at-2' } as never);
  assert.equal(next.client_id, 'c1');
  assert.equal(next.mcp_url, 'https://mcp.notion.com/mcp');
  assert.equal(next.issuer, 'https://mcp.notion.com');
  assert.equal(next.label, 'Không gian của Minh');
});

test('applyToken đổi expires_in thành MỐC TUYỆT ĐỐI', () => {
  const t0 = Date.now();
  const next = applyToken(ACC as never, { access_token: 'a', expires_in: 28800 } as never);
  assert.ok(next.expires_at! >= t0 + 28800_000 - 50 && next.expires_at! <= Date.now() + 28800_000);
});

// ───────────────────────────────────────────── mốc làm mới

test('needsRefresh: làm mới ở 50% tuổi thọ, không đợi sát nút', () => {
  const now = Date.now();
  const at = (msLeft: number) => ({ ...ACC, expires_at: now + msLeft }) as never;
  assert.equal(needsRefresh(at(7 * 3600_000), now), false, 'còn 7 giờ thì chưa cần');
  assert.equal(needsRefresh(at(3 * 3600_000), now), true, 'còn 3 giờ thì làm mới');
  assert.equal(needsRefresh(at(-1), now), true, 'đã hết hạn');
});

test('needsRefresh: KHÔNG khai hạn ⇒ false — đừng vứt một chìa đang chạy tốt', () => {
  assert.equal(needsRefresh({ ...ACC, expires_at: undefined } as never), false);
});

// ───────────────── ⭐ ghi NGUYÊN TỬ + chìa chết hẳn (26/08)

test('⭐ file cũ KHÔNG bị cắt cụt khi ghi — mất nửa file là mất CẢ KHO', () => {
  /**
   * `writeFileSync` cắt file về 0 byte TRƯỚC rồi mới ghi. Chết giữa hai bước đó
   * để lại JSON cụt ⇒ `readRaw` parse hỏng ⇒ trả `{}` ⇒ **mọi tài khoản biến
   * mất**, không riêng cái đang ghi. Và đường ghi hay chạy nhất là vòng làm mới
   * chìa — chạy ngầm, mỗi 15 phút, khi không ai nhìn.
   *
   * Không mô phỏng được một cú kill giữa chừng trong unit test, nên ô này canh
   * thứ QUAN SÁT ĐƯỢC: sau mỗi lần ghi, file luôn parse được và luôn đủ.
   */
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  for (let i = 0; i < 20; i++) {
    writeSecrets(p, { [`K${i}`]: `v${i}` });
    const onDisk = JSON.parse(fs.readFileSync((p as { secretsFile: string }).secretsFile, 'utf8'));
    assert.ok(onDisk['$oauth']?.['A'], `mất tài khoản ở vòng ${i}`);
  }
});

test('⭐ không để lại file tạm sau khi ghi xong', () => {
  // File tạm sót lại là rác trong `.state/`, và tệ hơn: nó chứa **chìa thật**.
  const p = paths();
  saveOAuth(p, 'A', ACC as never);
  const dir = path.dirname((p as { secretsFile: string }).secretsFile);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), []);
});

test('⭐ needsRefresh: chìa đã CHẾT HẲN ⇒ thôi thử lại', () => {
  /**
   * Không có cờ này thì vòng nền gọi mạng mỗi 15 phút cho một thứ **chắc chắn
   * hỏng** — đốt pin, đốt log, và che mất những lần hỏng THẬT đáng đọc.
   * Đường ra đúng là "đăng nhập lại", không phải "thử lại".
   */
  const dead = { ...ACC, expires_at: Date.now() - 1, dead: { at: 'x', why: 'invalid_grant' } };
  assert.equal(needsRefresh(dead as never), false);
  // Còn hạn mà chết thì cũng thôi — cờ THẮNG mọi điều kiện thời gian.
  const deadButFresh = { ...ACC, expires_at: Date.now() + 3600_000, dead: { at: 'x', why: 'y' } };
  assert.equal(needsRefresh(deadButFresh as never), false);
});

test('needsRefresh: không có chìa làm mới ⇒ false, dù đã hết hạn', () => {
  // Không có gì để làm mới bằng. Trả `true` ở đây là đẩy vòng nền vào một vòng
  // lặp thử-rồi-hỏng mỗi tick; ca này phải đi ra "đăng nhập lại", không phải
  // "thử lại".
  const dead = { ...ACC, refresh_token: undefined, expires_at: Date.now() - 1 };
  assert.equal(needsRefresh(dead as never), false);
});
