/**
 * HÌNH DẠNG PHẢN HỒI CỦA TOKEN ENDPOINT — ba tiền đề sai, đo 26/08 với GitHub.
 * → `src/core/oauth.ts §postToken` · docs/SPEC-arms.md §5h·7d
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO FILE TEST NÀY TỒN TẠI, và vì sao nó không phải "test cho GitHub": │
 * │                                                                          │
 * │ Ba lỗi được vá đều **ĐÚNG với Notion** nên chúng sống ẩn từ 25/08. Chúng  │
 * │ chỉ lộ ra khi cắm hãng thứ hai. ⇒ Thứ cần khoá lại **không phải hành vi   │
 * │ của GitHub**, mà là: *"đừng bao giờ giả định lại hình dạng phản hồi"*.    │
 * │                                                                          │
 * │ Mỗi test dưới đây mô tả MỘT hình dạng phản hồi hợp lệ theo RFC mà một     │
 * │ hãng nào đó ngoài kia đang dùng. Hãng thứ ba sẽ có hình dạng thứ n — và   │
 * │ file này là chỗ nó được thêm vào, không phải một `if` mới trong mã.       │
 * │                                                                          │
 * │ ⚠ Test đắt nhất ở đây là **"200 kèm error"**: lỗi đó KHÔNG NÉM, không     │
 * │ log, và nó ghi đè một tài khoản đang chạy tốt bằng một tài khoản rỗng —   │
 * │ trong vòng làm mới chạy ngầm, lúc không ai nhìn.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import {
  DeadGrantError,
  TransientError,
  devicePoll,
  deviceStart,
  refreshAccount,
  supportsDevice,
  type AsMeta,
  type OAuthAccount,
} from '../dist/core/oauth.js';

const META: AsMeta = {
  issuer: 'https://vi-du.com/oauth',
  authorization_endpoint: 'https://vi-du.com/oauth/authorize',
  token_endpoint: 'https://vi-du.com/oauth/access_token',
  device_authorization_endpoint: 'https://vi-du.com/login/device/code',
};

const ACC: OAuthAccount = {
  client_id: 'Iv23li-vi-du',
  access_token: 'at-cu',
  refresh_token: 'rt-cu',
  token_type: 'bearer',
  mcp_url: 'https://vi-du.com/mcp',
  issuer: META.issuer,
};

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** Ghi lại lời gọi cuối để soi header — thứ ① của bộ ba lỗi. */
let lastInit: RequestInit | undefined;

function reply(status: number, body: string, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    lastInit = init;
    return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  }) as typeof fetch;
}

function boom(message: string): void {
  globalThis.fetch = (async () => {
    throw new TypeError(message);
  }) as typeof fetch;
}

beforeEach(() => {
  lastInit = undefined;
});

// ──────────────────────────────────────────── ① Accept: application/json

test('⭐ ① LUÔN xin JSON — thiếu header này thì GitHub trả form-urlencoded', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', refresh_token: 'rt-moi', expires_in: 28800 }));
  await refreshAccount(META, ACC);

  const headers = lastInit?.headers as Record<string, string>;
  assert.equal(
    headers?.['accept'],
    'application/json',
    'không gửi Accept ⇒ có hãng trả form-urlencoded ⇒ JSON.parse ném ở lần đổi chìa ĐẦU TIÊN',
  );
});

// ──────────────────────────────────────────── ② HTTP 200 kèm error

test('🔴 ② HTTP 200 kèm {"error"} là HỎNG, không phải thành công', async () => {
  // Đây CHÍNH XÁC thứ GitHub trả khi refresh token đã bị xoay. Đo 26/08.
  reply(
    200,
    JSON.stringify({
      error: 'incorrect_client_credentials',
      error_description: 'The client_id and/or client_secret passed are incorrect.',
    }),
  );

  await assert.rejects(
    () => refreshAccount(META, ACC),
    DeadGrantError,
    'đọc 200 thành công ⇒ ghi đè tài khoản đang tốt bằng access_token: undefined, IM LẶNG',
  );
});

test('🔴 ② 200 + JSON hợp lệ nhưng THIẾU access_token cũng là hỏng', async () => {
  // Không có chốt này thì ca ② quay lại qua cửa khác: thân đúng cú pháp, không
  // có `error`, cũng không có chìa — và hạ nguồn cất một tài khoản rỗng.
  reply(200, JSON.stringify({ token_type: 'bearer', scope: '' }));
  await assert.rejects(() => refreshAccount(META, ACC), /access_token/);
});

// ──────────────────────────────────────────── ③ danh sách chìa-đã-chết

test('⭐ ③ incorrect_client_credentials ⇒ CHÌA CHẾT, không phải hỏng tạm', async () => {
  reply(200, JSON.stringify({ error: 'incorrect_client_credentials' }));
  await assert.rejects(() => refreshAccount(META, ACC), DeadGrantError);
});

test('⭐ ③ invalid_grant (Notion) vẫn là chìa chết — không hồi quy', async () => {
  reply(400, JSON.stringify({ error: 'invalid_grant' }));
  await assert.rejects(() => refreshAccount(META, ACC), DeadGrantError);
});

test('⭐ ③ câu lỗi KHÔNG chuyển tiếp nguyên văn lời hãng', async () => {
  reply(
    200,
    JSON.stringify({
      error: 'incorrect_client_credentials',
      error_description: 'The client_id and/or client_secret passed are incorrect.',
    }),
  );
  // Chữ của GitHub SAI CỬA ngay từ phía hãng: nó nói về client_id/secret, thứ
  // hoàn toàn không sai. Người đọc sẽ đi kiểm đúng cái đang đúng.
  const err = await refreshAccount(META, ACC).catch((e: Error) => e);
  assert.match((err as Error).message, /đăng nhập lại/);
  assert.doesNotMatch((err as Error).message, /client_secret/);
});

// ──────────────────────────────────────────── hỏng TẠM ≠ hỏng HẲN

test('⭐ mạng chết ⇒ TransientError (thử lại), KHÔNG phải chìa chết', async () => {
  boom('fetch failed');
  await assert.rejects(() => refreshAccount(META, ACC), TransientError);
});

test('⭐ 5xx ⇒ TransientError — dịch vụ trục trặc, chìa vẫn sống', async () => {
  reply(503, JSON.stringify({ error: 'server_error' }));
  await assert.rejects(() => refreshAccount(META, ACC), TransientError);
});

test('🔴 gộp hai loại hỏng là chọn SAI ở cả hai', () => {
  // Chốt bằng kiểu, không bằng lời dặn: hai lớp lỗi phải phân biệt được ở chỗ
  // gọi, vì `refreshDue` xử lý chúng NGƯỢC NHAU (đánh dấu dead vs im lặng chờ).
  assert.notEqual(DeadGrantError, TransientError);
  assert.ok(!(new TransientError('x') instanceof DeadGrantError));
  assert.ok(!(new DeadGrantError('x') instanceof TransientError));
});

// ──────────────────────────────────────────── refresh XOAY

test('⭐ refresh mới ghi đè refresh cũ — cả GitHub lẫn Notion đều XOAY', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', refresh_token: 'rt-moi', expires_in: 28800 }));
  const next = await refreshAccount(META, ACC);
  assert.equal(next.refresh_token, 'rt-moi', 'giữ cái cũ ⇒ tự khoá mình ở lần làm mới THỨ HAI');
  assert.equal(next.access_token, 'at-moi');
});

test('⭐ server KHÔNG trả refresh mới ⇒ GIỮ cái cũ, không ghi đè bằng undefined', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', expires_in: 3600 }));
  const next = await refreshAccount(META, ACC);
  assert.equal(next.refresh_token, 'rt-cu', 'ghi đè bằng undefined là vứt cái đang dùng được');
});

// ──────────────────────────────────────────── device flow

test('⭐ supportsDevice suy từ METADATA, không dò tên hãng', () => {
  assert.equal(supportsDevice(META), true);
  const { device_authorization_endpoint: _bo, ...khong } = META;
  assert.equal(supportsDevice(khong), false);
});

test('⭐ deviceStart: thiếu device_code ⇒ câu lỗi CHỈ ĐÚNG CỬA', async () => {
  // Ca thường gặp nhất trong đời thật: app chưa bật "đăng nhập bằng mã thiết bị"
  // ⇒ hãng trả 400. Câu lỗi phải nói ra điều đó, nếu không người ta đi kiểm
  // client_id, kiểm mạng, kiểm URL — mọi chỗ trừ chỗ hỏng.
  reply(400, JSON.stringify({ error: 'device_flow_disabled' }));
  const err = await deviceStart(META, 'Iv23li-vi-du').catch((e: Error) => e);
  assert.match((err as Error).message, /mã thiết bị/);
});

test('⭐ deviceStart: quy expires_in thành MỐC TUYỆT ĐỐI', async () => {
  reply(
    200,
    JSON.stringify({
      device_code: 'dc-1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://vi-du.com/login/device',
      expires_in: 900,
      interval: 5,
    }),
  );
  const s = await deviceStart(META, 'Iv23li-vi-du');
  assert.equal(s.user_code, 'ABCD-1234');
  assert.equal(s.interval_ms, 5000);
  // Cất `expires_in` là cất một con số vô nghĩa ngay sau khi tắt máy.
  assert.ok(s.expires_at > Date.now() + 800_000, 'phải là mốc tuyệt đối, không phải khoảng');
});

const START = {
  device_code: 'dc-1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://vi-du.com/login/device',
  expires_at: Date.now() + 600_000,
  interval_ms: 5000,
};

test('⭐ authorization_pending là TRẠNG THÁI, không phải lỗi', async () => {
  reply(200, JSON.stringify({ error: 'authorization_pending' }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending');
});

test('⭐ slow_down ⇒ CỘNG 5 giây, không phải hỏi lại ngay', async () => {
  reply(200, JSON.stringify({ error: 'slow_down' }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending');
  assert.equal(r.state === 'pending' && r.interval_ms, 10_000);
});

test('🔴 RỚT MẠNG KHÔNG ĐƯỢC GIẾT LƯỢT ĐĂNG NHẬP (ca thật 26/08)', async () => {
  // Người dùng lúc đó đang đứng trước trang của hãng và VỪA BẤM ĐỒNG Ý. Hãng
  // báo "đã cấp quyền", ta báo "hỏng" — hai màn hình nói ngược nhau, và màn
  // hình sai là của ta. Trong khi chìa thì đã cấp thật.
  boom('fetch failed');
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending', 'một cú nấc mạng không được làm hỏng một lượt cấp quyền đã thành công');
});

test('⭐ hết hạn MÃ ⇒ dừng — mốc là hạn của mã, không phải số lần thử', async () => {
  reply(200, JSON.stringify({ error: 'authorization_pending' }));
  await assert.rejects(
    () =>
      devicePoll(META, {
        clientId: 'c',
        start: { ...START, expires_at: Date.now() - 1 },
        mcpUrl: 'https://vi-du.com/mcp',
      }),
    /hết hạn/,
  );
});

test('⭐ người dùng bấm Từ chối ⇒ nói đúng chuyện đó, không nói "chìa sai"', async () => {
  reply(200, JSON.stringify({ error: 'access_denied' }));
  await assert.rejects(
    () => devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' }),
    /từ chối/,
  );
});

test('⭐ xong ⇒ trả về tài khoản gắn đúng mcp_url + issuer', async () => {
  reply(200, JSON.stringify({ access_token: 'ghu_x', refresh_token: 'ghr_y', expires_in: 28800 }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'done');
  if (r.state !== 'done') return;
  assert.equal(r.account.access_token, 'ghu_x');
  assert.equal(r.account.refresh_token, 'ghr_y');
  assert.equal(r.account.mcp_url, 'https://vi-du.com/mcp');
  assert.equal(r.account.issuer, META.issuer);
  // Làm mới ở mốc 50% tuổi thọ ⇒ chìa 8 giờ thì chưa tới hạn ngay.
  assert.ok((r.account.expires_at ?? 0) > Date.now() + 27_000_000);
});
