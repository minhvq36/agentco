
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


test('⭐ ① ALWAYS request JSON — miss this header and GitHub returns form-urlencoded', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', refresh_token: 'rt-moi', expires_in: 28800 }));
  await refreshAccount(META, ACC);

  const headers = lastInit?.headers as Record<string, string>;
  assert.equal(
    headers?.['accept'],
    'application/json',
    'no Accept header ⇒ some vendors return form-urlencoded ⇒ JSON.parse throws on the VERY FIRST token refresh',
  );
});


test('🔴 ② HTTP 200 with {"error"} IS a failure, not a success', async () => {
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
    'reading a 200 as success ⇒ overwrites a working account with access_token: undefined, SILENTLY',
  );
});

test('🔴 ② 200 + valid JSON but MISSING access_token is also a failure', async () => {
  reply(200, JSON.stringify({ token_type: 'bearer', scope: '' }));
  await assert.rejects(() => refreshAccount(META, ACC), /access_token/);
});


test('⭐ ③ incorrect_client_credentials ⇒ DEAD GRANT, not a transient failure', async () => {
  reply(200, JSON.stringify({ error: 'incorrect_client_credentials' }));
  await assert.rejects(() => refreshAccount(META, ACC), DeadGrantError);
});

test('⭐ ③ invalid_grant (Notion) is still a dead grant — no regression', async () => {
  reply(400, JSON.stringify({ error: 'invalid_grant' }));
  await assert.rejects(() => refreshAccount(META, ACC), DeadGrantError);
});

test('⭐ ③ the error message does NOT forward the vendor\'s wording verbatim', async () => {
  reply(
    200,
    JSON.stringify({
      error: 'incorrect_client_credentials',
      error_description: 'The client_id and/or client_secret passed are incorrect.',
    }),
  );
  const err = await refreshAccount(META, ACC).catch((e: Error) => e);
  assert.match((err as Error).message, /đăng nhập lại/); // i18n-allow-vietnamese: matches real i18n oauth error string (default locale vi)
  assert.doesNotMatch((err as Error).message, /client_secret/);
});


test('⭐ network down ⇒ TransientError (retry), NOT a dead grant', async () => {
  boom('fetch failed');
  await assert.rejects(() => refreshAccount(META, ACC), TransientError);
});

test('⭐ 5xx ⇒ TransientError — the service is having trouble, the grant is still alive', async () => {
  reply(503, JSON.stringify({ error: 'server_error' }));
  await assert.rejects(() => refreshAccount(META, ACC), TransientError);
});

test('🔴 lumping the two failure kinds together picks the WRONG one for both', () => {
  assert.notEqual(DeadGrantError, TransientError);
  assert.ok(!(new TransientError('x') instanceof DeadGrantError));
  assert.ok(!(new DeadGrantError('x') instanceof TransientError));
});


test('⭐ a new refresh token overwrites the old one — both GitHub and Notion ROTATE it', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', refresh_token: 'rt-moi', expires_in: 28800 }));
  const next = await refreshAccount(META, ACC);
  assert.equal(next.refresh_token, 'rt-moi', 'keeping the old one ⇒ locks itself out on the SECOND refresh');
  assert.equal(next.access_token, 'at-moi');
});

test('⭐ the server does NOT return a new refresh token ⇒ KEEP the old one, do not overwrite with undefined', async () => {
  reply(200, JSON.stringify({ access_token: 'at-moi', expires_in: 3600 }));
  const next = await refreshAccount(META, ACC);
  assert.equal(next.refresh_token, 'rt-cu', 'overwriting with undefined throws away a token that still works');
});


test('⭐ supportsDevice is inferred from METADATA, not by sniffing the vendor name', () => {
  assert.equal(supportsDevice(META), true);
  const { device_authorization_endpoint: _bo, ...khong } = META;
  assert.equal(supportsDevice(khong), false);
});

test('⭐ deviceStart: missing device_code ⇒ the error message points to the RIGHT cause', async () => {
  reply(400, JSON.stringify({ error: 'device_flow_disabled' }));
  const err = await deviceStart(META, 'Iv23li-vi-du').catch((e: Error) => e);
  assert.match((err as Error).message, /mã thiết bị/); // i18n-allow-vietnamese: matches real i18n oauth error string (default locale vi)
});

test('⭐ deviceStart: converts expires_in into an ABSOLUTE timestamp', async () => {
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
  assert.ok(s.expires_at > Date.now() + 800_000, 'must be an absolute timestamp, not a duration');
});

const START = {
  device_code: 'dc-1',
  user_code: 'ABCD-1234',
  verification_uri: 'https://vi-du.com/login/device',
  expires_at: Date.now() + 600_000,
  interval_ms: 5000,
};

test('⭐ authorization_pending is a STATE, not an error', async () => {
  reply(200, JSON.stringify({ error: 'authorization_pending' }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending');
});

test('⭐ slow_down ⇒ ADDS 5 seconds, does not poll again immediately', async () => {
  reply(200, JSON.stringify({ error: 'slow_down' }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending');
  assert.equal(r.state === 'pending' && r.interval_ms, 10_000);
});

test('🔴 A DROPPED CONNECTION MUST NOT KILL THE LOGIN (real case from 08/26)', async () => {
  boom('fetch failed');
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'pending', 'one network hiccup must not break a login that otherwise succeeded');
});

test('⭐ the CODE expiring ⇒ stops — the deadline is the code\'s expiry, not a retry count', async () => {
  reply(200, JSON.stringify({ error: 'authorization_pending' }));
  await assert.rejects(
    () =>
      devicePoll(META, {
        clientId: 'c',
        start: { ...START, expires_at: Date.now() - 1 },
        mcpUrl: 'https://vi-du.com/mcp',
      }),
    /hết hạn/, // i18n-allow-vietnamese: matches real i18n oauth error string (default locale vi)
  );
});

test('⭐ the user clicks Deny ⇒ says exactly that, not "wrong credentials"', async () => {
  reply(200, JSON.stringify({ error: 'access_denied' }));
  await assert.rejects(
    () => devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' }),
    /từ chối/, // i18n-allow-vietnamese: matches real i18n oauth error string (default locale vi)
  );
});

test('⭐ done ⇒ returns an account bound to the right mcp_url + issuer', async () => {
  reply(200, JSON.stringify({ access_token: 'ghu_x', refresh_token: 'ghr_y', expires_in: 28800 }));
  const r = await devicePoll(META, { clientId: 'c', start: START, mcpUrl: 'https://vi-du.com/mcp' });
  assert.equal(r.state, 'done');
  if (r.state !== 'done') return;
  assert.equal(r.account.access_token, 'ghu_x');
  assert.equal(r.account.refresh_token, 'ghr_y');
  assert.equal(r.account.mcp_url, 'https://vi-du.com/mcp');
  assert.equal(r.account.issuer, META.issuer);
  assert.ok((r.account.expires_at ?? 0) > Date.now() + 27_000_000);
});
