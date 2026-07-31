const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog, protocol, Tray, Menu, safeStorage, powerMonitor } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { Readable } = require('stream');
const {
  configureStableAppPaths,
} = require('./app-paths');
const {
  createPlatformCredentialRuntime,
} = require('./platform-credential-runtime');
const {
  isAllowedAppUrl,
  isSafeExternalUrl,
} = require('./navigation-guard');
const {
  clearPlatformLoginSession,
  openPlatformLoginWindow,
} = require('./platform-login-window');
const {
  createSpotifyPkceFlow,
  startSpotifyLoopbackServer,
} = require('./spotify-pkce');
const { assertAllowedIpcSender } = require('./ipc-auth');
const { WallpaperRuntime } = require('./wallpaper-runtime');
const {
  createLocalAssetsManager,
  localFilePathFromProxyUrl,
  parseLocalFileRangeHeader,
  LOCAL_FILE_PROTOCOL,
  LOCAL_LIBRARY_MIME,
} = require('./local-assets');
const {
  filterPersistentUiStatePatch,
  mergeDesktopShellSettings,
  normalizeDesktopShellSettings,
  normalizePersistentUiState,
} = require('./shell-state');
const {
  desktopLyricsStateSignature,
  normalizeDesktopLyricsOpacity,
  shouldIgnoreDesktopLyricsMouse,
} = require('./overlay-state');

let mainWindow = null;
let localServer = null;
let mainServerPort = 0;
let platformCredentialRuntime = null;
let platformCredentialRuntimePromise = null;
let desktopLyricsWindow = null;
let desktopLyricsState = {};
let desktopLyricsUserBounds = null;
let desktopLyricsProgrammaticMove = false;
let desktopLyricsPointerCapture = false;
let desktopLyricsMouseIgnored = null;
let desktopLyricsLastStateSignature = '';
let desktopLyricsLastOpacity = null;
let desktopLyricsMousePoller = null;
let desktopLyricsMousePollerBuffer = '';
let desktopLyricsHotBounds = null;
let desktopLyricsLastMiddleAt = 0;
let wallpaperRuntime = null;
let htmlFullscreenActive = false;
let windowFullscreenActive = false;
let mainWindowStateTimer = null;
let tray = null;
let closeToTrayEnabled = true;
let appQuitting = false;
const registeredGlobalHotkeys = new Map();

const WINDOWED_ASPECT = 16 / 9;
const WINDOWED_SCALE = 3 / 4;
const WINDOWED_MARGIN = 32;
const MIN_WINDOWED_WIDTH = 960;
const MIN_WINDOWED_HEIGHT = 540;
const APP_NAME = 'Mineradio';
const APP_USER_MODEL_ID = 'com.mineradio.desktop';
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico');
const DESKTOP_SHELL_SETTINGS_FILE = 'desktop-shell-settings.json';
const DESKTOP_UI_STATE_FILE = 'desktop-ui-state.json';
const APP_PATHS = configureStableAppPaths(app);
const LEGACY_APP_DATA_ROOTS = Object.freeze([
  path.resolve(__dirname, '..'),
  path.join(path.dirname(APP_PATHS.userData), 'mineradio'),
]);

const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'],
  ['ignore-gpu-blocklist'],
  ['enable-gpu-rasterization'],
  ['enable-oop-rasterization'],
  ['enable-zero-copy'],
  ['enable-accelerated-2d-canvas'],
  ['disable-background-timer-throttling'],
  ['disable-renderer-backgrounding'],
  ['disable-backgrounding-occluded-windows'],
  ['force_high_performance_gpu'],
  ['use-angle', 'd3d11'],
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}
protocol.registerSchemesAsPrivileged([{
  scheme: LOCAL_FILE_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
  },
}]);
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',
  'qqmusic_uin',
  'wxuin',
  'login_type',
  'qm_keyst',
  'qqmusic_key',
  'p_skey',
  'skey',
  'psrf_qqopenid',
  'psrf_qqunionid',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'wxopenid',
  'wxunionid',
  'wxrefresh_token',
  'wxskey',
  'p_uin',
  'ptcz',
  'RK',
];
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',
  '__csrf',
  'NMTID',
  'MUSIC_A',
  '__remember_me',
  '_ntes_nuid',
  '_ntes_nnid',
  'WEVNSM',
  'WNMCID',
  'JSESSIONID-WYYY',
];
const KUGOU_LOGIN_COOKIE_PRIORITY = [
  'KuGoo',
  'token',
  'userid',
  'KugooID',
  'kg_mid',
  'kg_dfid',
  'Kugou',
  'NickName',
];
const QISHUI_LOGIN_COOKIE_PRIORITY = [
  'sessionid',
  'sessionid_ss',
  'sid_guard',
  'sid_tt',
  'passport_csrf_token',
  'passport_csrf_token_default',
  'ttwid',
];
const localAssetsManager = createLocalAssetsManager();
let localFileProtocolRegistered = false;

function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1);
          return;
        }
        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function initializePlatformCredentialRuntime() {
  if (!platformCredentialRuntimePromise) {
    platformCredentialRuntimePromise = createPlatformCredentialRuntime({
      paths: APP_PATHS,
      sourceRoots: LEGACY_APP_DATA_ROOTS,
      safeStorage,
    }).then((runtime) => {
      platformCredentialRuntime = runtime;
      return runtime;
    });
  }
  return platformCredentialRuntimePromise;
}

function credentialRuntimeUnavailable() {
  return {
    ok: false,
    error: 'PLATFORM_CREDENTIAL_RUNTIME_UNAVAILABLE',
  };
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('mineradio-global-hotkey', { action });
}

function unregisterMineradioGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

function configureMineradioGlobalHotkeys(bindings = []) {
  unregisterMineradioGlobalHotkeys();
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2;
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });
  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win),
  };
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function openSafeExternal(url) {
  if (!isSafeExternalUrl(url)) return Promise.resolve(false);
  return shell.openExternal(url).then(() => true).catch(() => false);
}

function guardMainNavigation(event, url) {
  if (isAllowedAppUrl(url, mainServerPort)) return;
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  openSafeExternal(url);
}

function handleIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertAllowedIpcSender(event, channel, mainServerPort);
    return handler(event, ...args);
  });
}

function localFileContentType(filePath) {
  return LOCAL_LIBRARY_MIME[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function localFileErrorResponse(error) {
  const message = String(error && error.message || error || 'LOCAL_FILE_FAILED');
  if (/LOCAL_FILE_URL/.test(message)) return new Response('Invalid local file url', { status: 400 });
  if (/LOCAL_FILE_NOT_AUTHORIZED/.test(message)) return new Response('Local file not authorized', { status: 403 });
  if (/LOCAL_FILE_NOT_FOUND/.test(message)) return new Response('Local file not found', { status: 404 });
  console.warn('Local file protocol failed:', message);
  return new Response('Local file failed', { status: 500 });
}

async function handleLocalFileProtocolRequest(request) {
  try {
    const filePath = localFilePathFromProxyUrl(request.url);
    const target = localAssetsManager.resolveAuthorizedLocalFile(filePath);
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) return new Response('Local file not found', { status: 404 });

    const range = parseLocalFileRangeHeader(request.headers.get('range') || '', stat.size);
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': localFileContentType(target),
    };
    if (!range) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes */${stat.size}`,
        },
      });
    }

    if (stat.size <= 0 || range.end < range.start) {
      return new Response('', {
        status: 200,
        headers: {
          ...baseHeaders,
          'Content-Length': '0',
        },
      });
    }

    const headers = {
      ...baseHeaders,
      'Content-Length': String(range.end - range.start + 1),
    };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    const fileStream = fs.createReadStream(target, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(fileStream), {
      status: range.partial ? 206 : 200,
      headers,
    });
  } catch (error) {
    return localFileErrorResponse(error);
  }
}

function registerLocalFileProtocol() {
  if (localFileProtocolRegistered) return;
  protocol.handle(LOCAL_FILE_PROTOCOL, handleLocalFileProtocolRequest);
  localFileProtocolRegistered = true;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

function desktopShellSettingsPath() {
  return path.join(APP_PATHS.userData, DESKTOP_SHELL_SETTINGS_FILE);
}

function readDesktopShellSettings() {
  try {
    const file = desktopShellSettingsPath();
    if (!fs.existsSync(file)) return normalizeDesktopShellSettings({});
    return normalizeDesktopShellSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_e) {
    return normalizeDesktopShellSettings({});
  }
}

function writeDesktopShellSettings(patch) {
  const file = desktopShellSettingsPath();
  const next = mergeDesktopShellSettings(readDesktopShellSettings(), patch);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function applySavedDesktopShellSettings() {
  closeToTrayEnabled = readDesktopShellSettings().closeToTray;
}

function desktopUiStatePath() {
  return path.join(APP_PATHS.userData, DESKTOP_UI_STATE_FILE);
}

function readDesktopUiState() {
  try {
    const file = desktopUiStatePath();
    if (!fs.existsSync(file)) return normalizePersistentUiState({});
    return normalizePersistentUiState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_e) {
    return normalizePersistentUiState({});
  }
}

function writeDesktopUiStatePatch(patch) {
  const filtered = filterPersistentUiStatePatch(patch);
  const current = readDesktopUiState();
  const values = { ...current.values };
  for (const [key, value] of Object.entries(filtered)) {
    if (value == null) delete values[key];
    else values[key] = value;
  }
  const next = normalizePersistentUiState({ values, updatedAt: Date.now() });
  const file = desktopUiStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isStartupEnabled() {
  if (process.platform !== 'win32') return false;
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_e) {
    return false;
  }
}

function setStartupEnabled(enabled) {
  if (process.platform !== 'win32') return { ok: false, enabled: false, unsupported: true };
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath, args: [] });
  return { ok: true, enabled: isStartupEnabled() };
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Mineradio', click: focusMainWindow },
    {
      label: '关闭按钮最小化到托盘',
      type: 'checkbox',
      checked: closeToTrayEnabled,
      click: (item) => {
        closeToTrayEnabled = !!item.checked;
        writeDesktopShellSettings({ closeToTray: closeToTrayEnabled });
        refreshTrayMenu();
      },
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: isStartupEnabled(),
      click: (item) => {
        const result = setStartupEnabled(item.checked);
        if (!result.ok) item.checked = false;
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '退出 Mineradio',
      click: () => {
        appQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  if (tray || process.platform !== 'win32') return;
  const icon = fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : process.execPath;
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.on('click', focusMainWindow);
  tray.on('double-click', focusMainWindow);
  refreshTrayMenu();
}

function getUpdateDownloadDir() {
  return APP_PATHS.updateDirectory;
}

function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.MINERADIO_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.MINERADIO_CREATE_DESKTOP_SHORTCUT === '1';
}

function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'Mineradio desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U;
}

function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

function isKugouCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'kugou.com' || normalized.endsWith('.kugou.com');
}

function isQishuiCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qishui.com'
    || normalized.endsWith('.qishui.com')
    || normalized === 'douyin.com'
    || normalized.endsWith('.douyin.com');
}

function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

async function readKugouLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(
    cookies,
    isKugouCookieDomain,
    KUGOU_LOGIN_COOKIE_PRIORITY,
  );
}

async function readQishuiLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(
    cookies,
    isQishuiCookieDomain,
    QISHUI_LOGIN_COOKIE_PRIORITY,
  );
}

function kugouCookieHasLogin(cookieText) {
  const value = parseCookieHeader(cookieText);
  return Boolean(
    (value.token || value.KuGoo)
    && (value.userid || value.KugooID || value.KuGoo),
  );
}

function qishuiCookieHasLogin(cookieText) {
  const value = parseCookieHeader(cookieText);
  return Boolean(
    value.sessionid
    || value.sessionid_ss
    || value.sid_guard
    || value.sid_tt,
  );
}

async function openNeteaseMusicLoginWindow(owner) {
  return openPlatformLoginWindow({
    BrowserWindow,
    session,
    provider: 'netease',
    owner,
    icon: APP_ICON_ICO,
    openExternal: openSafeExternal,
    readCredential: readNeteaseLoginCookieHeader,
    credentialComplete: neteaseCookieHasLogin,
    credentialAcceptOnClose: neteaseCookieHasLogin,
  });
}

async function openQQMusicLoginWindow(owner) {
  return openPlatformLoginWindow({
    BrowserWindow,
    session,
    provider: 'qq',
    owner,
    icon: APP_ICON_ICO,
    openExternal: openSafeExternal,
    readCredential: readQQLoginCookieHeader,
    credentialComplete: qqCookieHasPlaybackLogin,
    credentialHasIdentity: qqCookieHasLogin,
    credentialAcceptOnClose: qqCookieHasLogin,
  });
}

async function openKugouMusicLoginWindow(owner) {
  return openPlatformLoginWindow({
    BrowserWindow,
    session,
    provider: 'kugou',
    owner,
    icon: APP_ICON_ICO,
    openExternal: openSafeExternal,
    readCredential: readKugouLoginCookieHeader,
    credentialComplete: kugouCookieHasLogin,
    credentialHasIdentity: kugouCookieHasLogin,
    credentialAcceptOnClose: kugouCookieHasLogin,
  });
}

async function openQishuiMusicLoginWindow(owner) {
  return openPlatformLoginWindow({
    BrowserWindow,
    session,
    provider: 'qishui',
    owner,
    icon: APP_ICON_ICO,
    openExternal: openSafeExternal,
    readCredential: readQishuiLoginCookieHeader,
    credentialComplete: qishuiCookieHasLogin,
    credentialAcceptOnClose: qishuiCookieHasLogin,
  });
}

async function readLoopbackJson(response) {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? value : {};
  } catch (_error) {
    return {};
  }
}

async function desktopRequestJson(url, options, body) {
  const response = await fetch(url, {
    ...options,
    body,
  });
  const payload = await readLoopbackJson(response);
  if (!response.ok) {
    const error = new Error('PLATFORM_REQUEST_FAILED');
    error.code = 'PLATFORM_REQUEST_FAILED';
    throw error;
  }
  return payload;
}

async function commitPlatformCredential(provider, method, credential) {
  if (!mainServerPort) return credentialRuntimeUnavailable();
  const body = method === 'pkce'
    ? { provider, method, credential }
    : method === 'external-window'
      ? { provider, method, credential }
      : {
        provider,
        method,
        value: method === 'token'
          ? credential && credential.token
          : credential && credential.cookie,
      };
  try {
    const response = await fetch(
      `http://127.0.0.1:${mainServerPort}/api/platform/login/import`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const info = await readLoopbackJson(response);
    if (!response.ok || info.loggedIn !== true) {
      return {
        ok: false,
        provider,
        error: info.error || 'PLATFORM_LOGIN_COMMIT_FAILED',
      };
    }
    const membership = info.membership
      && typeof info.membership === 'object'
      ? info.membership
      : {};
    return {
      ok: true,
      provider,
      loggedIn: true,
      accountId: info.accountId || '',
      userId: info.accountId || '',
      nickname: typeof info.nickname === 'string' ? info.nickname : '',
      avatar: typeof info.avatar === 'string' ? info.avatar : '',
      vipLevel: typeof membership.vipLevel === 'string'
        ? membership.vipLevel
        : 'none',
      isVip: membership.isVip === true,
      isSvip: membership.isSvip === true,
      metadataOnly: provider === 'kugou'
        || provider === 'qishui'
        || provider === 'spotify',
    };
  } catch (_error) {
    return {
      ok: false,
      provider,
      error: 'PLATFORM_LOGIN_COMMIT_FAILED',
    };
  }
}

async function commitLoginWindowCredential(provider, capture) {
  if (!capture || capture.ok !== true
    || typeof capture.credential !== 'string') {
    return {
      ok: false,
      cancelled: capture && capture.cancelled === true,
      error: capture && capture.error || 'PLATFORM_LOGIN_CANCELLED',
    };
  }
  const result = await commitPlatformCredential(
    provider,
    'external-window',
    { cookie: capture.credential },
  );
  if (result.ok) {
    result.partial = capture.partial === true;
    if (provider === 'qq') {
      result.playbackKeyReady = qqCookieHasPlaybackLogin(capture.credential);
    }
  }
  return result;
}

function spotifyClientId(options) {
  options = options && typeof options === 'object' ? options : {};
  const value = String(
    options.clientId
    || process.env.MINERADIO_SPOTIFY_CLIENT_ID
    || process.env.SPOTIFY_CLIENT_ID
    || '',
  ).trim();
  return /^[A-Za-z0-9]{16,128}$/.test(value) ? value : '';
}

async function openSpotifyMusicLoginWindow(owner, options) {
  const clientId = spotifyClientId(options);
  if (!clientId) {
    return {
      ok: false,
      provider: 'spotify',
      error: 'SPOTIFY_CLIENT_ID_REQUIRED',
    };
  }
  const callback = await startSpotifyLoopbackServer();
  const flow = createSpotifyPkceFlow({
    clientId,
    requestJson: desktopRequestJson,
  });
  const pending = flow.begin(callback.redirectUri);
  let capture;
  try {
    capture = await openPlatformLoginWindow({
      BrowserWindow,
      session,
      provider: 'spotify',
      owner,
      icon: APP_ICON_ICO,
      loginUrl: pending.authorizationUrl,
      redirectUri: pending.redirectUri,
      callbackPromise: callback.waitForCallback,
      openExternal: openSafeExternal,
    });
    if (!capture || capture.ok !== true || !capture.callbackUrl) {
      flow.cancel();
      return capture || {
        ok: false,
        error: 'SPOTIFY_LOGIN_CANCELLED',
      };
    }
    const credential = await flow.consumeCallback(capture.callbackUrl);
    return commitPlatformCredential('spotify', 'pkce', credential);
  } catch (_error) {
    flow.cancel();
    return {
      ok: false,
      provider: 'spotify',
      error: 'SPOTIFY_LOGIN_FAILED',
    };
  } finally {
    callback.close();
  }
}

async function openPlatformMusicLogin(owner, provider, options) {
  if (provider === 'spotify') {
    return openSpotifyMusicLoginWindow(owner, options);
  }
  const openers = {
    netease: openNeteaseMusicLoginWindow,
    qq: openQQMusicLoginWindow,
    kugou: openKugouMusicLoginWindow,
    qishui: openQishuiMusicLoginWindow,
  };
  const opener = openers[provider];
  if (!Object.hasOwn(openers, provider)
    || typeof opener !== 'function') {
    return {
      ok: false,
      error: 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
    };
  }
  const capture = await opener(owner);
  return commitLoginWindowCredential(provider, capture);
}

async function clearServerCredential(provider) {
  if (!mainServerPort) return credentialRuntimeUnavailable();
  try {
    const response = await fetch(
      `http://127.0.0.1:${mainServerPort}/api/platform/logout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      },
    );
    const result = await readLoopbackJson(response);
    return response.ok && result.ok !== false
      ? { ok: true, provider }
      : { ok: false, error: result.error || 'PLATFORM_LOGOUT_FAILED' };
  } catch (_error) {
    return { ok: false, error: 'PLATFORM_LOGOUT_FAILED' };
  }
}

async function clearPlatformMusicLoginSession(provider) {
  const serverResult = await clearServerCredential(provider);
  try {
    await clearPlatformLoginSession(session, provider);
  } catch (_error) {
    if (serverResult.ok) {
      return {
        ok: false,
        provider,
        error: 'PLATFORM_LOGIN_SESSION_CLEAR_FAILED',
      };
    }
  }
  return serverResult;
}

function clearQQMusicLoginSession() {
  return clearPlatformMusicLoginSession('qq');
}

function clearNeteaseMusicLoginSession() {
  return clearPlatformMusicLoginSession('netease');
}

function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500);
}

function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76);
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),
    width,
    height,
  };
}

function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)),
  };
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true;
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldIgnore = shouldIgnoreDesktopLyricsMouse(desktopLyricsPointerCapture);
  if (desktopLyricsMouseIgnored === shouldIgnore) return;
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds;
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return;
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return;
  desktopLyricsLastMiddleAt = now;
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MineradioMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([MineradioMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineradio-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  setDesktopLyricsOpacity(payload.opacity);
}

function setDesktopLyricsOpacity(value) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || typeof desktopLyricsWindow.setOpacity !== 'function') return;
  const nextOpacity = normalizeDesktopLyricsOpacity(value);
  if (desktopLyricsLastOpacity != null && Math.abs(desktopLyricsLastOpacity - nextOpacity) <= 0.001) return;
  desktopLyricsLastOpacity = nextOpacity;
  desktopLyricsWindow.setOpacity(nextOpacity);
}

function sendDesktopLyricsState(force = false) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const signature = desktopLyricsStateSignature(desktopLyricsState);
  if (!force && signature === desktopLyricsLastStateSignature) return;
  desktopLyricsLastStateSignature = signature;
  desktopLyricsWindow.webContents.send('mineradio-desktop-lyrics-state', desktopLyricsState);
}

function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;
  if (yChanged) desktopLyricsUserBounds = null;
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      setDesktopLyricsOpacity(desktopLyricsState.opacity);
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'Mineradio Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }
  startDesktopLyricsMousePoller();
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });
  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive();
    sendDesktopLyricsState(true);
  });
  desktopLyricsWindow.webContents.once('did-finish-load', () => sendDesktopLyricsState(true));
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
    desktopLyricsLastStateSignature = '';
    desktopLyricsLastOpacity = null;
  });
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsLastStateSignature = '';
  desktopLyricsLastOpacity = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

function broadcastWallpaperRuntimeStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('mineradio-wallpaper-runtime-state', status || {});
}

function ensureWallpaperRuntime() {
  if (wallpaperRuntime && !wallpaperRuntime.disposed) return wallpaperRuntime;
  wallpaperRuntime = new WallpaperRuntime({
    BrowserWindow,
    screen,
    platform: process.platform,
    preloadPath: path.join(__dirname, 'overlay-preload.js'),
    overlayUrl: () => overlayUrl('wallpaper.html'),
    execFileImpl: execFile,
    onStatus: broadcastWallpaperRuntimeStatus,
  });
  return wallpaperRuntime;
}

function positionWallpaperWindow(reason = 'display-metrics-changed') {
  if (!wallpaperRuntime) return Promise.resolve({ ok: true, enabled: false });
  return wallpaperRuntime.handleSystemEvent(reason);
}

function closeWallpaperWindow(reason = 'disabled') {
  if (!wallpaperRuntime) return Promise.resolve({ ok: true, enabled: false });
  return wallpaperRuntime.stop(reason);
}

function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow('main-window-closed').catch((error) => {
    console.warn('Wallpaper shutdown failed:', error && error.message);
  });
}

handleIpc('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

handleIpc('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

handleIpc('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

handleIpc('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

handleIpc('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

handleIpc('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

handleIpc('mineradio-hotkeys-configure-global', (_event, bindings) => {
  return configureMineradioGlobalHotkeys(bindings);
});

handleIpc('mineradio-tray-get-settings', () => {
  const startup = isStartupEnabled();
  return { ok: true, closeToTray: closeToTrayEnabled, startup, startupEnabled: startup };
});

handleIpc('mineradio-tray-set-close-to-tray', (_event, enabled) => {
  closeToTrayEnabled = !!enabled;
  writeDesktopShellSettings({ closeToTray: closeToTrayEnabled });
  refreshTrayMenu();
  return { ok: true, closeToTray: closeToTrayEnabled };
});

handleIpc('mineradio-startup-set-enabled', (_event, enabled) => {
  const result = setStartupEnabled(!!enabled);
  refreshTrayMenu();
  return result;
});

handleIpc('mineradio-credential-status', () => {
  if (!platformCredentialRuntime) return credentialRuntimeUnavailable();
  return {
    ok: true,
    ...platformCredentialRuntime.status(),
  };
});

handleIpc('mineradio-credential-set', async (_event, provider, credential) => {
  if (!platformCredentialRuntime) return credentialRuntimeUnavailable();
  if (!['netease', 'qq', 'kugou', 'qishui', 'spotify'].includes(provider)) {
    return {
      ok: false,
      error: 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
    };
  }
  if (!credential || typeof credential !== 'object') {
    return { ok: false, error: 'PLATFORM_CREDENTIAL_INVALID' };
  }
  if (provider === 'spotify') {
    return commitPlatformCredential(provider, 'pkce', credential);
  }
  const token = Object.getOwnPropertyDescriptor(credential, 'token');
  if (provider === 'qishui' && token && typeof token.value === 'string') {
    return commitPlatformCredential(provider, 'token', {
      token: token.value,
    });
  }
  const cookie = Object.getOwnPropertyDescriptor(credential, 'cookie');
  if (!cookie || typeof cookie.value !== 'string') {
    return { ok: false, error: 'PLATFORM_CREDENTIAL_INVALID' };
  }
  return commitPlatformCredential(provider, 'cookie', {
    cookie: cookie.value,
  });
});

handleIpc('mineradio-credential-clear', async (_event, provider) => {
  if (!platformCredentialRuntime) return credentialRuntimeUnavailable();
  if (!['netease', 'qq', 'kugou', 'qishui', 'spotify'].includes(provider)) {
    return {
      ok: false,
      error: 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
    };
  }
  return clearServerCredential(provider);
});

ipcMain.on('mineradio-ui-state-read-sync', (event) => {
  try {
    assertAllowedIpcSender(event, 'mineradio-ui-state-read-sync', mainServerPort);
    event.returnValue = readDesktopUiState().values || {};
  } catch (_e) {
    event.returnValue = {};
  }
});

handleIpc('mineradio-ui-state-write', (_event, patch) => {
  return { ok: true, ...writeDesktopUiStatePatch(patch) };
});

handleIpc('mineradio-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'mineradio-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 Mineradio 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

handleIpc('mineradio-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 Mineradio 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

handleIpc('mineradio-local-music-choose-folder', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '选择本地音乐文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    return await localAssetsManager.scanLocalMusicFolder(result.filePaths[0]);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_CHOOSE_FAILED' };
  }
});

handleIpc('mineradio-local-music-scan-folder', async (_event, folderPath, options) => {
  try {
    if (!folderPath) return { ok: false, error: 'LOCAL_LIBRARY_PATH_EMPTY' };
    return await localAssetsManager.scanLocalMusicFolder(folderPath, options || {});
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_SCAN_FAILED' };
  }
});

handleIpc('mineradio-local-music-refresh-entries', async (_event, folderPath, snapshotOrFiles) => {
  try {
    if (!folderPath) return { ok: false, error: 'LOCAL_LIBRARY_PATH_EMPTY' };
    return await localAssetsManager.refreshLocalMusicFileEntries(folderPath, snapshotOrFiles);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_LIBRARY_REFRESH_FAILED' };
  }
});

handleIpc('mineradio-local-file-read-range', async (_event, filePath, start, end) => {
  try {
    return await localAssetsManager.readAuthorizedLocalFileRange(filePath, start, end);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_FILE_READ_FAILED' };
  }
});

handleIpc('mineradio-local-file-read-data-url', async (_event, filePath) => {
  try {
    return await localAssetsManager.readAuthorizedLocalFileDataUrl(filePath);
  } catch (e) {
    return { ok: false, error: e.message || 'LOCAL_FILE_READ_FAILED' };
  }
});

handleIpc('platform-music-open-login', async (event, provider, options) => {
  if (!platformCredentialRuntime) return credentialRuntimeUnavailable();
  return openPlatformMusicLogin(
    getSenderWindow(event),
    provider,
    options,
  );
});

handleIpc('platform-music-clear-login', async (_event, provider) => {
  if (!platformCredentialRuntime) return credentialRuntimeUnavailable();
  if (!['netease', 'qq', 'kugou', 'qishui', 'spotify'].includes(provider)) {
    return { ok: false, error: 'PLATFORM_LOGIN_PROVIDER_UNKNOWN' };
  }
  return clearPlatformMusicLoginSession(provider);
});

handleIpc('netease-music-open-login', async (event) => {
  return openPlatformMusicLogin(
    getSenderWindow(event),
    'netease',
  );
});

handleIpc('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

handleIpc('qq-music-open-login', async (event) => {
  return openPlatformMusicLogin(
    getSenderWindow(event),
    'qq',
  );
});

handleIpc('qq-music-clear-login', async () => {
  return clearQQMusicLoginSession();
});

handleIpc('mineradio-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

handleIpc('mineradio-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

handleIpc('mineradio-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

handleIpc('mineradio-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

handleIpc('mineradio-wallpaper-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) return await ensureWallpaperRuntime().start(payload || {});
    return await closeWallpaperWindow('disabled');
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

handleIpc('mineradio-wallpaper-update', async (_event, payload) => {
  try {
    return await ensureWallpaperRuntime().update(payload || {});
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_UPDATE_FAILED' };
  }
});

handleIpc('mineradio-wallpaper-get-status', async () => {
  const runtime = wallpaperRuntime;
  return {
    ok: true,
    status: runtime ? runtime.getStatus('requested') : { enabled: false, active: false, phase: 'disabled' },
    diagnostics: runtime ? runtime.getDiagnostics() : { events: [] },
  };
});

function configureLocalServerEnvironment(port) {
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.MINERADIO_PLATFORM_CACHE_FILE = APP_PATHS.platformCache;
  process.env.MINERADIO_LISTEN_SYNC_FILE = APP_PATHS.listenJournal;
  process.env.MINERADIO_UPDATE_DIR = APP_PATHS.updateDirectory;
  process.env.MINERADIO_BEAT_CACHE_DIR = APP_PATHS.beatmapDirectory;
  process.env.MINERADIO_LYRICS_DIR = APP_PATHS.lyricsDirectory;
  process.env.MINERADIO_LOCAL_METADATA_DIR = APP_PATHS.localMetadataDirectory;
}

async function createWindow() {
  await initializePlatformCredentialRuntime();
  htmlFullscreenActive = false;
  windowFullscreenActive = false;
  const port = await findOpenPort(3000);
  mainServerPort = port;
  configureLocalServerEnvironment(port);

  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);

  const initialBounds = getWindowedBounds();

  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: false,
    fullscreen: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', guardMainNavigation);
  mainWindow.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) guardMainNavigation(event, url);
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('close', (event) => {
    if (appQuitting || !closeToTrayEnabled || process.platform !== 'win32') return;
    event.preventDefault();
    mainWindow.hide();
    sendWindowState(mainWindow);
  });
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  app.whenReady().then(async () => {
    await initializePlatformCredentialRuntime();
    registerLocalFileProtocol();
    applySavedDesktopShellSettings();
    createTray();
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow('display-metrics-changed').catch(() => {});
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => {
      positionWallpaperWindow('display-added').catch(() => {});
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-removed', () => {
      positionWallpaperWindow('display-removed').catch(() => {});
      scheduleWindowStateSend(mainWindow);
    });
    powerMonitor.on('lock-screen', () => positionWallpaperWindow('lock-screen').catch(() => {}));
    powerMonitor.on('unlock-screen', () => positionWallpaperWindow('unlock-screen').catch(() => {}));
    powerMonitor.on('suspend', () => positionWallpaperWindow('suspend').catch(() => {}));
    powerMonitor.on('resume', () => positionWallpaperWindow('resume').catch(() => {}));
    await createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    appQuitting = true;
    unregisterMineradioGlobalHotkeys();
    closeOverlayWindows();
    if (wallpaperRuntime) wallpaperRuntime.dispose().catch(() => {});
    if (localServer && localServer.close) localServer.close();
  });
}
