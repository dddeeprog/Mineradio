'use strict';

const crypto = require('node:crypto');
const http = require('node:http');

const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';
const SPOTIFY_SCOPES = Object.freeze(['user-read-private']);
const DEFAULT_STATE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CALLBACK_PATH = '/spotify/callback';

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function createCodeVerifier(randomBytes = crypto.randomBytes) {
  return base64Url(requireFunction(randomBytes, 'randomBytes')(64));
}

function createCodeChallenge(verifier) {
  verifier = cleanString(verifier);
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw codedError('SPOTIFY_PKCE_VERIFIER_INVALID');
  }
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function exactLoopbackRedirect(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (_error) {
    throw codedError('SPOTIFY_REDIRECT_INVALID');
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (parsed.protocol !== 'http:' || (host !== '127.0.0.1' && host !== '::1')) {
    throw codedError('SPOTIFY_REDIRECT_INVALID');
  }
  if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw codedError('SPOTIFY_REDIRECT_INVALID');
  }
  if (!parsed.pathname.startsWith('/') || parsed.pathname.includes('\\')) {
    throw codedError('SPOTIFY_REDIRECT_INVALID');
  }
  return parsed;
}

function tokenCredential(payload, previous, clientId, now) {
  payload = payload && typeof payload === 'object' ? payload : {};
  previous = previous && typeof previous === 'object' ? previous : {};
  const accessToken = cleanString(payload.access_token || payload.accessToken);
  const refreshToken = cleanString(
    payload.refresh_token || payload.refreshToken || previous.refreshToken,
  );
  if (!accessToken) throw codedError('SPOTIFY_TOKEN_INVALID');
  const returnedScope = cleanString(payload.scope || previous.scope);
  const scopes = returnedScope ? returnedScope.split(/\s+/).filter(Boolean) : [];
  if (scopes.some(scope => !SPOTIFY_SCOPES.includes(scope))) {
    throw codedError('SPOTIFY_SCOPE_INVALID');
  }
  const expiresIn = Math.max(60, Math.min(
    24 * 60 * 60,
    Number(payload.expires_in || payload.expiresIn) || 3600,
  ));
  return {
    accessToken,
    refreshToken,
    tokenType: cleanString(payload.token_type || payload.tokenType) || 'Bearer',
    scope: scopes.length ? scopes.join(' ') : SPOTIFY_SCOPES.join(' '),
    expiresAt: Number(now()) + expiresIn * 1000,
    clientId,
  };
}

function createSpotifyPkceFlow(options = {}) {
  const clientId = cleanString(options.clientId);
  if (!clientId || clientId.length > 256) {
    throw codedError('SPOTIFY_CLIENT_ID_REQUIRED');
  }
  const requestJson = requireFunction(options.requestJson, 'requestJson');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : crypto.randomBytes;
  const stateTtlMs = Number(options.stateTtlMs) > 0
    ? Number(options.stateTtlMs)
    : DEFAULT_STATE_TTL_MS;
  const accountsBase = cleanString(options.accountsBase || SPOTIFY_ACCOUNTS_BASE)
    .replace(/\/+$/, '');
  let pending = null;
  const usedStates = new Set();

  function begin(redirectUri) {
    const redirect = exactLoopbackRedirect(redirectUri);
    const verifier = createCodeVerifier(randomBytes);
    const state = base64Url(randomBytes(24));
    const createdAt = Number(now());
    pending = {
      state,
      verifier,
      redirectUri: redirect.toString(),
      expiresAt: createdAt + stateTtlMs,
    };
    const authorizationUrl = new URL(accountsBase + '/authorize');
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', pending.redirectUri);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set(
      'code_challenge',
      createCodeChallenge(verifier),
    );
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
    return Object.freeze({
      authorizationUrl: authorizationUrl.toString(),
      redirectUri: pending.redirectUri,
      state,
      expiresAt: pending.expiresAt,
    });
  }

  async function consumeCallback(callbackUrl) {
    let callback;
    try {
      callback = new URL(String(callbackUrl || ''));
    } catch (_error) {
      throw codedError('SPOTIFY_OAUTH_CALLBACK_INVALID');
    }
    const returnedState = cleanString(callback.searchParams.get('state'));
    if (!pending) {
      throw codedError(
        usedStates.has(returnedState)
          ? 'SPOTIFY_OAUTH_STATE_USED'
          : 'SPOTIFY_OAUTH_STATE_MISSING',
      );
    }
    const active = pending;
    const expected = new URL(active.redirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
      throw codedError('SPOTIFY_OAUTH_CALLBACK_INVALID');
    }
    if (!returnedState || returnedState !== active.state) {
      throw codedError('SPOTIFY_OAUTH_STATE_MISMATCH');
    }
    if (Number(now()) > active.expiresAt) {
      pending = null;
      usedStates.add(active.state);
      throw codedError('SPOTIFY_OAUTH_STATE_EXPIRED');
    }

    pending = null;
    usedStates.add(active.state);
    if (usedStates.size > 16) {
      usedStates.delete(usedStates.values().next().value);
    }
    const oauthError = cleanString(callback.searchParams.get('error'));
    if (oauthError) {
      throw codedError('SPOTIFY_OAUTH_DENIED');
    }
    const code = cleanString(callback.searchParams.get('code'));
    if (!code || code.length > 4096) {
      throw codedError('SPOTIFY_OAUTH_CODE_INVALID');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: active.redirectUri,
      code_verifier: active.verifier,
    }).toString();
    const payload = await requestJson(accountsBase + '/api/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }, body);
    return tokenCredential(payload, null, clientId, now);
  }

  async function refresh(credential) {
    credential = credential && typeof credential === 'object' ? credential : {};
    const refreshToken = cleanString(credential.refreshToken);
    if (!refreshToken) throw codedError('SPOTIFY_REFRESH_TOKEN_REQUIRED');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }).toString();
    const payload = await requestJson(accountsBase + '/api/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }, body);
    return tokenCredential(payload, credential, clientId, now);
  }

  function cancel() {
    if (pending) {
      usedStates.add(pending.state);
      pending = null;
    }
    return {
      ok: false,
      cancelled: true,
      error: 'SPOTIFY_LOGIN_CANCELLED',
    };
  }

  function diagnostics() {
    return Object.freeze({
      pending: Boolean(pending),
      expiresAt: pending ? pending.expiresAt : 0,
      scope: SPOTIFY_SCOPES.join(' '),
    });
  }

  return Object.freeze({
    begin,
    cancel,
    consumeCallback,
    diagnostics,
    refresh,
  });
}

function callbackResultHtml() {
  return '<!doctype html><meta charset="utf-8"><title>Mineradio</title>'
    + '<style>body{margin:0;display:grid;place-items:center;min-height:100vh;'
    + 'background:#101312;color:#f5fff7;font:15px system-ui}main{text-align:center}'
    + 'b{display:block;color:#1ed760;font-size:20px;margin-bottom:8px}</style>'
    + '<main><b>Spotify 授权已收到</b><span>可以返回 Mineradio。</span></main>';
}

function startSpotifyLoopbackServer(options = {}) {
  const callbackPath = cleanString(options.callbackPath || DEFAULT_CALLBACK_PATH);
  if (!/^\/[A-Za-z0-9/_-]*$/.test(callbackPath)) {
    return Promise.reject(codedError('SPOTIFY_CALLBACK_PATH_INVALID'));
  }
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_CALLBACK_TIMEOUT_MS;
  const createServer = typeof options.createServer === 'function'
    ? options.createServer
    : http.createServer;

  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve;
    let callbackReject;
    const waitForCallback = new Promise((resolveCallback, rejectCallback) => {
      callbackResolve = resolveCallback;
      callbackReject = rejectCallback;
    });
    const server = createServer((req, res) => {
      const method = String(req.method || '').toUpperCase();
      const requestUrl = new URL(String(req.url || '/'), 'http://127.0.0.1');
      if (method !== 'GET' || requestUrl.pathname !== callbackPath) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('Not found');
        return;
      }
      if (settled) {
        res.writeHead(410, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('Callback already used');
        return;
      }
      settled = true;
      clearTimeout(timer);
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      const received = origin + requestUrl.pathname + requestUrl.search;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(callbackResultHtml(), () => server.close());
      callbackResolve(received);
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      callbackReject(codedError('SPOTIFY_CALLBACK_TIMEOUT'));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    server.once('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        callbackReject(codedError('SPOTIFY_CALLBACK_SERVER_FAILED'));
      }
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      resolve(Object.freeze({
        origin,
        redirectUri: origin + callbackPath,
        waitForCallback,
        close() {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            callbackReject(codedError('SPOTIFY_LOGIN_CANCELLED'));
          }
          server.close();
        },
      }));
    });
  });
}

module.exports = {
  SPOTIFY_SCOPES,
  createCodeChallenge,
  createCodeVerifier,
  createSpotifyPkceFlow,
  startSpotifyLoopbackServer,
};
