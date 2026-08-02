'use strict';

const {
  isAllowedLoginUrl,
} = require('./navigation-guard');

const LOGIN_WINDOW_POLICIES = Object.freeze({
  netease: Object.freeze({
    provider: 'netease',
    title: '网易云音乐登录',
    partition: 'persist:mineradio-netease-login',
    startUrl: 'https://music.163.com/#/login',
    warmupUrl: '',
    width: 940,
    height: 760,
  }),
  qq: Object.freeze({
    provider: 'qq',
    title: 'QQ 音乐登录',
    partition: 'persist:mineradio-qqmusic-login',
    startUrl: 'https://y.qq.com/n/ryqq/profile',
    warmupUrl: 'https://y.qq.com/n/ryqq/player',
    width: 900,
    height: 720,
  }),
  kugou: Object.freeze({
    provider: 'kugou',
    title: '酷狗音乐登录',
    partition: 'persist:mineradio-kugou-login',
    startUrl: 'https://www.kugou.com/',
    warmupUrl: 'https://www.kugou.com/newuc/user/uc/type=edit',
    width: 900,
    height: 720,
  }),
  qishui: Object.freeze({
    provider: 'qishui',
    title: '汽水音乐登录',
    partition: 'persist:mineradio-qishui-login',
    startUrl: 'https://qishui.douyin.com/',
    warmupUrl: '',
    width: 900,
    height: 720,
  }),
  spotify: Object.freeze({
    provider: 'spotify',
    title: 'Spotify 授权',
    partition: 'persist:mineradio-spotify-login',
    startUrl: '',
    warmupUrl: '',
    width: 900,
    height: 720,
  }),
});

function loginError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createLoginWindowPolicy(provider) {
  const source = LOGIN_WINDOW_POLICIES[provider];
  if (!source) throw loginError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
  const webPreferences = Object.freeze({
    partition: source.partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  return Object.freeze({
    ...source,
    webPreferences,
  });
}

function exactCallbackMatcher(redirectUri) {
  if (!redirectUri) return () => false;
  let expected;
  try {
    expected = new URL(String(redirectUri));
  } catch (_error) {
    throw loginError('PLATFORM_LOGIN_CALLBACK_INVALID');
  }
  const host = expected.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (expected.protocol !== 'http:'
    || (host !== '127.0.0.1' && host !== '::1')
    || !expected.port
    || expected.search
    || expected.hash) {
    throw loginError('PLATFORM_LOGIN_CALLBACK_INVALID');
  }
  return value => {
    try {
      const candidate = new URL(String(value || ''));
      return candidate.origin === expected.origin
        && candidate.pathname === expected.pathname;
    } catch (_error) {
      return false;
    }
  };
}

function hardenLoginSession(loginSession) {
  if (!loginSession) throw new TypeError('login session is required');
  if (typeof loginSession.setPermissionRequestHandler === 'function') {
    loginSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
  }
  if (typeof loginSession.setPermissionCheckHandler === 'function') {
    loginSession.setPermissionCheckHandler(() => false);
  }
}

function boundedDelay(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
}

async function openPlatformLoginWindow(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  const electronSession = options.session;
  if (typeof BrowserWindow !== 'function') {
    throw new TypeError('BrowserWindow is required');
  }
  if (!electronSession || typeof electronSession.fromPartition !== 'function') {
    throw new TypeError('session is required');
  }
  const policy = createLoginWindowPolicy(options.provider);
  const loginUrl = String(options.loginUrl || policy.startUrl || '');
  if (!isAllowedLoginUrl(loginUrl, policy.provider)) {
    throw loginError('PLATFORM_LOGIN_URL_REJECTED');
  }
  const callbackMatches = exactCallbackMatcher(options.redirectUri);
  const readCredential = typeof options.readCredential === 'function'
    ? options.readCredential
    : async () => '';
  const credentialComplete = typeof options.credentialComplete === 'function'
    ? options.credentialComplete
    : () => false;
  const credentialAcceptOnClose = typeof options.credentialAcceptOnClose === 'function'
    ? options.credentialAcceptOnClose
    : credentialComplete;
  const openExternal = typeof options.openExternal === 'function'
    ? options.openExternal
    : async () => false;
  const pollIntervalMs = boundedDelay(options.pollIntervalMs, 1200, 250, 5000);
  const timeoutMs = boundedDelay(options.timeoutMs, 5 * 60 * 1000, 1000, 10 * 60 * 1000);
  const loginSession = electronSession.fromPartition(policy.partition);
  hardenLoginSession(loginSession);
  const initialCredential = await readCredential(loginSession);
  if (credentialComplete(initialCredential)) {
    return { ok: true, credential: initialCredential, reused: true };
  }

  return new Promise(resolve => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;
    let warmupStarted = false;
    const owner = options.owner;
    const loginWindow = new BrowserWindow({
      width: policy.width,
      height: policy.height,
      minWidth: Math.min(760, policy.width),
      minHeight: Math.min(560, policy.height),
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: policy.title,
      backgroundColor: '#111111',
      icon: options.icon,
      webPreferences: policy.webPreferences,
    });

    function cleanup() {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      pollTimer = null;
      timeoutTimer = null;
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      if (!loginWindow.isDestroyed()) loginWindow.close();
      resolve(result);
    }

    function allowedNavigation(value) {
      return callbackMatches(value)
        || isAllowedLoginUrl(value, policy.provider);
    }

    function guardNavigation(event, value) {
      if (allowedNavigation(value)) return;
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      openExternal(value);
    }

    async function checkCredential() {
      try {
        const credential = await readCredential(loginSession);
        if (credentialComplete(credential)) {
          finish({ ok: true, credential });
          return;
        }
        if (policy.warmupUrl
          && !warmupStarted
          && options.credentialHasIdentity
          && options.credentialHasIdentity(credential)) {
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && !loginWindow.isDestroyed()) {
              loginWindow.loadURL(policy.warmupUrl).catch(() => {});
            }
          }, 900);
        }
      } catch (_error) {
        // Polling remains value-free; a later attempt can still complete.
      }
    }

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (allowedNavigation(url)) {
        loginWindow.loadURL(url).catch(() => {});
      } else {
        openExternal(url);
      }
      return { action: 'deny' };
    });
    loginWindow.webContents.on(
      'will-navigate',
      (event, url) => guardNavigation(event, url),
    );
    loginWindow.webContents.on(
      'will-redirect',
      (event, url) => guardNavigation(event, url),
    );
    loginWindow.webContents.on(
      'did-start-navigation',
      (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) guardNavigation(event, url);
      },
    );
    loginWindow.webContents.on('did-finish-load', checkCredential);
    loginWindow.on('ready-to-show', () => loginWindow.show());
    loginWindow.on('closed', async () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const credential = await readCredential(loginSession);
        resolve(credentialAcceptOnClose(credential)
          ? { ok: true, credential, partial: !credentialComplete(credential) }
          : {
            ok: false,
            cancelled: true,
            error: 'PLATFORM_LOGIN_CANCELLED',
          });
      } catch (_error) {
        resolve({
          ok: false,
          cancelled: true,
          error: 'PLATFORM_LOGIN_CANCELLED',
        });
      }
    });

    if (options.callbackPromise
      && typeof options.callbackPromise.then === 'function') {
      Promise.resolve(options.callbackPromise).then(
        callbackUrl => finish({ ok: true, callbackUrl }),
        error => finish({
          ok: false,
          cancelled: error && error.code === 'SPOTIFY_LOGIN_CANCELLED',
          error: error && error.code || 'PLATFORM_LOGIN_FAILED',
        }),
      );
    }
    pollTimer = setInterval(checkCredential, pollIntervalMs);
    timeoutTimer = setTimeout(() => finish({
      ok: false,
      error: 'PLATFORM_LOGIN_TIMEOUT',
    }), timeoutMs);
    loginWindow.loadURL(loginUrl).catch(() => finish({
      ok: false,
      error: 'PLATFORM_LOGIN_LOAD_FAILED',
    }));
  });
}

async function clearPlatformLoginSession(electronSession, provider) {
  if (!electronSession || typeof electronSession.fromPartition !== 'function') {
    throw new TypeError('session is required');
  }
  const policy = createLoginWindowPolicy(provider);
  const loginSession = electronSession.fromPartition(policy.partition);
  await loginSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true, provider };
}

module.exports = {
  clearPlatformLoginSession,
  createLoginWindowPolicy,
  openPlatformLoginWindow,
};
