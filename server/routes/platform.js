'use strict';

const {
  createCapabilitySnapshot: defaultCreateCapabilitySnapshot,
} = require('../platform/capabilities');

const PROVIDER_METHODS = Object.freeze({
  netease: Object.freeze(['qr', 'cookie', 'external-window']),
  qq: Object.freeze(['cookie', 'external-window']),
  kugou: Object.freeze(['cookie', 'external-window']),
  qishui: Object.freeze(['token', 'cookie', 'external-window']),
  spotify: Object.freeze(['pkce', 'external-window']),
});
const MAX_CREDENTIAL_LENGTH = 32 * 1024;

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  return fn;
}

function hasOwn(value, key) {
  return value !== null
    && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, key);
}

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedSecret(value) {
  value = cleanString(value);
  return value && value.length <= MAX_CREDENTIAL_LENGTH ? value : '';
}

function cookieKeys(value) {
  const keys = new Set();
  String(value || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const item = part.slice(index + 1).trim();
    if (key && item) keys.add(key);
  });
  return keys;
}

function hasOne(keys, names) {
  return names.some(name => keys.has(name));
}

function normalizeCookieCredential(provider, value) {
  const cookie = boundedSecret(value);
  const keys = cookieKeys(cookie);
  let valid = false;
  if (provider === 'netease') {
    valid = keys.has('MUSIC_U');
  } else if (provider === 'qq') {
    valid = hasOne(keys, ['uin', 'qqmusic_uin', 'wxuin', 'p_uin'])
      && hasOne(keys, [
        'qm_keyst',
        'qqmusic_key',
        'music_key',
        'p_skey',
        'skey',
        'wxskey',
        'psrf_qqaccess_token',
        'psrf_qqrefresh_token',
      ]);
  } else if (provider === 'kugou') {
    valid = hasOne(keys, ['KuGoo', 'token', 'KugooID'])
      && hasOne(keys, ['userid', 'KugooID', 'KuGoo']);
  } else if (provider === 'qishui') {
    valid = hasOne(keys, [
      'sessionid',
      'sessionid_ss',
      'sid_guard',
      'sid_tt',
    ]);
  }
  if (!valid) throw routeError('PLATFORM_LOGIN_VALUE_INVALID');
  return { cookie };
}

function normalizePkceCredential(value) {
  value = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const accessToken = boundedSecret(value.accessToken);
  const refreshToken = boundedSecret(value.refreshToken);
  const clientId = cleanString(value.clientId);
  const scope = cleanString(value.scope);
  const expiresAt = Number(value.expiresAt);
  if (!accessToken
    || !refreshToken
    || !clientId
    || clientId.length > 256
    || scope !== 'user-read-private'
    || !Number.isFinite(expiresAt)
    || expiresAt <= 0) {
    throw routeError('PLATFORM_LOGIN_VALUE_INVALID');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt,
    clientId,
    scope,
    tokenType: cleanString(value.tokenType) || 'Bearer',
  };
}

function normalizeLoginCredential(body) {
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const provider = cleanString(body.provider);
  const method = cleanString(body.method);
  const methods = PROVIDER_METHODS[provider];
  if (!methods) throw routeError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
  if (!methods.includes(method)) {
    throw routeError('PLATFORM_LOGIN_METHOD_UNAVAILABLE');
  }
  if (provider === 'spotify') {
    if (method !== 'pkce' && method !== 'external-window') {
      throw routeError('PLATFORM_LOGIN_METHOD_UNAVAILABLE');
    }
    return {
      provider,
      method,
      credential: normalizePkceCredential(body.credential),
    };
  }
  if (provider === 'qishui' && method === 'token') {
    const token = boundedSecret(body.value);
    if (token.length < 8 || /\s/.test(token)) {
      throw routeError('PLATFORM_LOGIN_VALUE_INVALID');
    }
    return { provider, method, credential: { token } };
  }
  const cookie = method === 'external-window'
    ? body.credential && body.credential.cookie
    : body.value;
  return {
    provider,
    method,
    credential: normalizeCookieCredential(provider, cookie),
  };
}

function publicMembership(value) {
  value = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const isSvip = value.isSvip === true;
  const isVip = isSvip || value.isVip === true;
  return {
    vipLevel: cleanString(value.vipLevel)
      || (isSvip ? 'svip' : (isVip ? 'vip' : 'none')),
    isVip,
    isSvip,
    known: value.known === true,
  };
}

function publicAccount(provider, value, loggedIn) {
  value = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  return {
    ok: true,
    provider,
    loggedIn: loggedIn === true,
    accountId: loggedIn
      ? cleanString(value.accountId ?? value.userId)
      : '',
    nickname: loggedIn ? cleanString(value.nickname) : '',
    avatar: loggedIn ? cleanString(value.avatar) : '',
    membership: publicMembership(loggedIn ? value.membership : null),
  };
}

function createPlatformRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const getAccountStatuses = requireFunction(deps, 'getAccountStatuses');
  const readRequestBody = requireFunction(deps, 'readRequestBody');
  const loginCredential = requireFunction(deps, 'loginCredential');
  const logoutCredential = requireFunction(deps, 'logoutCredential');
  const createCapabilitySnapshot = deps.createCapabilitySnapshot === undefined
    ? defaultCreateCapabilitySnapshot
    : requireFunction(deps, 'createCapabilitySnapshot');
  const capabilityOptions = {};
  for (const key of ['implementationRegistry', 'featureFlags']) {
    if (hasOwn(deps, key)) capabilityOptions[key] = deps[key];
  }
  Object.freeze(capabilityOptions);

  async function handleCapabilities(res) {
    let statuses = {};
    try {
      statuses = await getAccountStatuses();
    } catch (_) {
      statuses = {};
    }

    let snapshot;
    try {
      // Implementation availability is server-owned; request data never reaches this call.
      snapshot = createCapabilitySnapshot(statuses, capabilityOptions);
    } catch (_) {
      snapshot = defaultCreateCapabilitySnapshot({}, capabilityOptions);
    }
    sendJSON(res, snapshot, 200);
  }

  async function handleLoginImport(req, res) {
    let normalized;
    try {
      normalized = normalizeLoginCredential(await readRequestBody(req));
    } catch (error) {
      sendJSON(res, {
        ok: false,
        error: error && error.code || 'PLATFORM_LOGIN_VALUE_INVALID',
      }, 400);
      return;
    }
    try {
      const account = await loginCredential(
        normalized.provider,
        normalized.credential,
        normalized.method,
      );
      sendJSON(
        res,
        publicAccount(normalized.provider, account, true),
        200,
      );
    } catch (_error) {
      sendJSON(res, {
        ok: false,
        provider: normalized.provider,
        error: 'PLATFORM_LOGIN_FAILED',
      }, 401);
    }
  }

  async function handleLogout(req, res) {
    const body = await readRequestBody(req);
    const provider = cleanString(body && body.provider);
    if (!PROVIDER_METHODS[provider]) {
      sendJSON(res, {
        ok: false,
        error: 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
      }, 400);
      return;
    }
    try {
      const account = await logoutCredential(provider);
      sendJSON(res, publicAccount(provider, account, false), 200);
    } catch (_error) {
      sendJSON(res, {
        ok: false,
        provider,
        error: 'PLATFORM_LOGOUT_FAILED',
      }, 409);
    }
  }

  async function handleRoute(pathname, req, res) {
    const method = String(req && req.method || '').toUpperCase();
    if (pathname === '/api/platform/login/import') {
      if (method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      } else {
        await handleLoginImport(req, res);
      }
      return true;
    }
    if (pathname === '/api/platform/logout') {
      if (method !== 'POST') {
        sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      } else {
        await handleLogout(req, res);
      }
      return true;
    }
    if (pathname !== '/api/platform/capabilities') return false;
    if (method !== 'GET') {
      sendJSON(res, {
        ok: false,
        error: 'METHOD_NOT_ALLOWED',
      }, 405);
      return true;
    }
    await handleCapabilities(res);
    return true;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createPlatformRoutes,
  normalizeLoginCredential,
};
