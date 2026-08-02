'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SPOTIFY_SCOPES,
  createCodeChallenge,
  createCodeVerifier,
  createSpotifyPkceFlow,
  startSpotifyLoopbackServer,
} = require('../desktop/spotify-pkce');

test('PKCE verifier and S256 challenge use URL-safe public-client material', () => {
  const verifier = createCodeVerifier(size => Buffer.alloc(size, 0x61));

  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(
    createCodeChallenge(verifier),
    'Z4Wd46W11I-lKgD_6PycHoztS3mM5xtEOPBqalOu0Go',
  );
});

test('authorization requests only the minimal profile scope and no secret', () => {
  const flow = createSpotifyPkceFlow({
    clientId: 'public-client-id',
    now: () => 10_000,
    randomBytes: size => Buffer.alloc(size, 0x62),
    async requestJson() {
      throw new Error('token exchange must not run');
    },
  });

  const pending = flow.begin('http://127.0.0.1:43879/spotify/callback');
  const url = new URL(pending.authorizationUrl);

  assert.deepEqual(SPOTIFY_SCOPES, ['user-read-private']);
  assert.equal(url.origin, 'https://accounts.spotify.com');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'public-client-id');
  assert.equal(url.searchParams.get('scope'), 'user-read-private');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(pending.expiresAt, 310_000);
});

test('callback state is one-time and token exchange stores refreshable credentials', async () => {
  const calls = [];
  const flow = createSpotifyPkceFlow({
    clientId: 'public-client-id',
    now: () => 50_000,
    randomBytes: size => Buffer.alloc(size, 0x63),
    async requestJson(url, options, body) {
      calls.push({ url, options, body });
      return {
        access_token: 'access-value',
        refresh_token: 'refresh-value',
        token_type: 'Bearer',
        scope: 'user-read-private',
        expires_in: 3600,
      };
    },
  });
  const pending = flow.begin('http://127.0.0.1:43879/spotify/callback');
  const callback = new URL(pending.redirectUri);
  callback.searchParams.set('code', 'authorization-code');
  callback.searchParams.set('state', pending.state);

  const credential = await flow.consumeCallback(callback.toString());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://accounts.spotify.com/api/token');
  assert.equal(calls[0].options.method, 'POST');
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_id'), 'public-client-id');
  assert.equal(body.get('code'), 'authorization-code');
  assert.equal(body.has('client_secret'), false);
  assert.deepEqual(credential, {
    accessToken: 'access-value',
    refreshToken: 'refresh-value',
    tokenType: 'Bearer',
    scope: 'user-read-private',
    expiresAt: 3_650_000,
    clientId: 'public-client-id',
  });
  await assert.rejects(
    flow.consumeCallback(callback.toString()),
    error => error.code === 'SPOTIFY_OAUTH_STATE_USED',
  );
});

test('expired and mismatched callbacks fail before exchanging a token', async () => {
  let now = 1000;
  let requestCount = 0;
  const flow = createSpotifyPkceFlow({
    clientId: 'public-client-id',
    now: () => now,
    stateTtlMs: 100,
    randomBytes: size => Buffer.alloc(size, 0x64),
    async requestJson() {
      requestCount += 1;
      return {};
    },
  });
  const first = flow.begin('http://127.0.0.1:43879/spotify/callback');
  const wrong = new URL(first.redirectUri);
  wrong.searchParams.set('code', 'code');
  wrong.searchParams.set('state', 'wrong');
  await assert.rejects(
    flow.consumeCallback(wrong.toString()),
    error => error.code === 'SPOTIFY_OAUTH_STATE_MISMATCH',
  );

  const second = flow.begin('http://127.0.0.1:43879/spotify/callback');
  now = second.expiresAt + 1;
  const expired = new URL(second.redirectUri);
  expired.searchParams.set('code', 'code');
  expired.searchParams.set('state', second.state);
  await assert.rejects(
    flow.consumeCallback(expired.toString()),
    error => error.code === 'SPOTIFY_OAUTH_STATE_EXPIRED',
  );
  assert.equal(requestCount, 0);
});

test('refresh uses the public client id and cancellation clears pending state', async () => {
  const calls = [];
  const flow = createSpotifyPkceFlow({
    clientId: 'public-client-id',
    now: () => 25_000,
    randomBytes: size => Buffer.alloc(size, 0x65),
    async requestJson(url, options, body) {
      calls.push({ url, options, body });
      return {
        access_token: 'refreshed-access',
        token_type: 'Bearer',
        expires_in: 1200,
      };
    },
  });

  const refreshed = await flow.refresh({
    refreshToken: 'refresh-value',
    scope: 'user-read-private',
  });
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'refresh-value');
  assert.equal(body.get('client_id'), 'public-client-id');
  assert.equal(body.has('client_secret'), false);
  assert.equal(refreshed.refreshToken, 'refresh-value');

  flow.begin('http://127.0.0.1:43879/spotify/callback');
  assert.deepEqual(flow.cancel(), {
    ok: false,
    cancelled: true,
    error: 'SPOTIFY_LOGIN_CANCELLED',
  });
  assert.equal(flow.diagnostics().pending, false);
});

test('loopback callback accepts one exact local path and closes cleanly', async (t) => {
  const callback = await startSpotifyLoopbackServer({
    callbackPath: '/spotify/callback',
    timeoutMs: 5000,
  });
  t.after(() => callback.close());

  const wrong = await fetch(callback.origin + '/not-the-callback?code=nope');
  assert.equal(wrong.status, 404);

  const target = callback.redirectUri + '?code=good&state=state';
  const response = await fetch(target);
  const received = await callback.waitForCallback;

  assert.equal(response.status, 200);
  assert.equal(received, target);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
});
