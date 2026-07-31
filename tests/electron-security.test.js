const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const {
  isAllowedAppUrl,
  isAllowedLoginUrl,
  isSafeExternalUrl,
} = require('../desktop/navigation-guard');
const {
  createLoginWindowPolicy,
} = require('../desktop/platform-login-window');

test('main app navigation is limited to the active loopback origin', () => {
  assert.equal(isAllowedAppUrl('http://127.0.0.1:34567/', 34567), true);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:34567/index.html', 34567), true);
  assert.equal(isAllowedAppUrl('http://localhost:34567/', 34567), false);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:3000/', 34567), false);
  assert.equal(isAllowedAppUrl('https://example.com/', 34567), false);
});

test('external opener only allows ordinary https urls', () => {
  assert.equal(isSafeExternalUrl('https://example.com/path?q=1'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), false);
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isSafeExternalUrl('mineradio://update'), false);
  assert.equal(isSafeExternalUrl('not a url'), false);
});

test('provider login windows only load provider-owned hosts', () => {
  assert.equal(isAllowedLoginUrl('https://music.163.com/#/login', 'netease'), true);
  assert.equal(isAllowedLoginUrl('https://passport.163.com/login', 'netease'), true);
  assert.equal(isAllowedLoginUrl('https://music.163.com.evil.test/login', 'netease'), false);

  assert.equal(isAllowedLoginUrl('https://y.qq.com/n/ryqq/profile', 'qq'), true);
  assert.equal(isAllowedLoginUrl('https://xui.ptlogin2.qq.com/cgi-bin/xlogin', 'qq'), true);
  assert.equal(isAllowedLoginUrl('https://example.com/login', 'qq'), false);

  assert.equal(isAllowedLoginUrl('https://www.kugou.com/newuc/user/uc/type=edit', 'kugou'), true);
  assert.equal(isAllowedLoginUrl('https://login-user.kugou.com/login', 'kugou'), true);
  assert.equal(isAllowedLoginUrl('https://www.kugou.com.evil.test/', 'kugou'), false);

  assert.equal(isAllowedLoginUrl('https://qishui.douyin.com/', 'qishui'), true);
  assert.equal(isAllowedLoginUrl('https://bff-pc.qishui.com/ucenter_web/app/sdk-next', 'qishui'), true);
  assert.equal(isAllowedLoginUrl('https://evil.test/?next=qishui.douyin.com', 'qishui'), false);

  assert.equal(isAllowedLoginUrl('https://accounts.spotify.com/authorize', 'spotify'), true);
  assert.equal(isAllowedLoginUrl('https://accounts.spotify.com/api/token', 'spotify'), false);
  assert.equal(isAllowedLoginUrl('https://accounts.spotify.com.evil.test/authorize', 'spotify'), false);
  assert.equal(isAllowedLoginUrl('https://music.163.com/api/login', 'unknown'), false);
});

test('generic login policy fixes dedicated partitions and hardened preferences', () => {
  const expected = {
    netease: 'persist:mineradio-netease-login',
    qq: 'persist:mineradio-qqmusic-login',
    kugou: 'persist:mineradio-kugou-login',
    qishui: 'persist:mineradio-qishui-login',
    spotify: 'persist:mineradio-spotify-login',
  };

  for (const [provider, partition] of Object.entries(expected)) {
    const policy = createLoginWindowPolicy(provider);
    assert.equal(policy.partition, partition);
    assert.equal(policy.webPreferences.partition, partition);
    assert.equal(policy.webPreferences.contextIsolation, true);
    assert.equal(policy.webPreferences.nodeIntegration, false);
    assert.equal(policy.webPreferences.sandbox, true);
    assert.equal(Object.isFrozen(policy), true);
  }
  assert.throws(
    () => createLoginWindowPolicy('unknown'),
    error => error.code === 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
  );
});

test('desktop credentials initialize after ready and before the local server', () => {
  const projectRoot = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
  const readyBlock = main.slice(main.indexOf('app.whenReady().then(async () => {'));
  const initializeAt = readyBlock.indexOf('await initializePlatformCredentialRuntime()');
  const createWindowAt = readyBlock.indexOf('await createWindow()');
  const serverRequireAt = main.indexOf("require(path.join(__dirname, '..', 'server.js'))");

  assert.match(main, /\bsafeStorage\b/);
  assert.match(main, /require\('\.\/platform-credential-runtime'\)/);
  assert.match(main, /platformCredentialRuntimePromise = null;\s*throw error;/);
  assert.notEqual(initializeAt, -1);
  assert.notEqual(createWindowAt, -1);
  assert.equal(initializeAt < createWindowAt, true);
  assert.notEqual(serverRequireAt, -1);
  assert.doesNotMatch(
    main,
    /migrateOwnedDataFiles|COOKIE_FILE|QQ_COOKIE_FILE|['"]\.qq-cookie['"]|['"]\.cookie['"]/,
  );
  assert.match(main, /MINERADIO_BEAT_CACHE_DIR = APP_PATHS\.beatmapDirectory/);
  assert.match(main, /MINERADIO_UPDATE_DIR = APP_PATHS\.updateDirectory/);
});

test('desktop exposes credential set clear and redacted status but no read-back IPC', () => {
  const projectRoot = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'desktop', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

  for (const channel of [
    'mineradio-credential-set',
    'mineradio-credential-clear',
    'mineradio-credential-status',
  ]) {
    assert.match(main, new RegExp(`handleIpc\\('${channel}'`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`));
  }
  assert.doesNotMatch(main, /mineradio-credential-(?:get|read)/);
  assert.doesNotMatch(preload, /mineradio-credential-(?:get|read)/);
  assert.doesNotMatch(
    main,
    /platformCredentialRuntime\.session\.(?:replace|clear)/,
  );
  assert.match(main, /commitLoginWindowCredential/);
  assert.doesNotMatch(renderer, /result\.cookie/);
});

test('desktop credential writes send the active loopback Origin', async (t) => {
  let receivedOrigin = '';
  const server = http.createServer((req, res) => {
    receivedOrigin = String(req.headers.origin || '');
    res.writeHead(204);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/write`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  assert.equal(response.status, 204);
  assert.equal(receivedOrigin, origin);

  const main = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'main.js'),
    'utf8',
  );
  assert.match(main, /function loopbackOrigin\(port\)/);
  assert.equal(
    (main.match(/Origin:\s*loopbackOrigin\(mainServerPort\)/g) || []).length,
    2,
  );
});

test('desktop login runtime uses the generic guarded window and PKCE without secrets', () => {
  const projectRoot = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'desktop', 'preload.js'), 'utf8');
  const loginWindow = fs.readFileSync(
    path.join(projectRoot, 'desktop', 'platform-login-window.js'),
    'utf8',
  );
  const pkce = fs.readFileSync(
    path.join(projectRoot, 'desktop', 'spotify-pkce.js'),
    'utf8',
  );

  assert.match(main, /require\('\.\/platform-login-window'\)/);
  assert.match(main, /require\('\.\/spotify-pkce'\)/);
  assert.match(main, /platform-music-open-login/);
  assert.match(main, /platform-music-clear-login/);
  assert.match(main, /typeof opener !== 'function'/);
  assert.match(preload, /platform-music-open-login/);
  assert.match(preload, /platform-music-clear-login/);
  assert.match(loginWindow, /setPermissionRequestHandler/);
  assert.match(loginWindow, /setPermissionCheckHandler/);
  assert.match(loginWindow, /will-navigate/);
  assert.match(loginWindow, /will-redirect/);
  assert.match(loginWindow, /setWindowOpenHandler/);
  assert.doesNotMatch(pkce, /client_secret|client_credentials/i);
  assert.doesNotMatch(main, /SPOTIFY_CLIENT_SECRET|client_secret|client_credentials/i);
});

test('wallpaper IPC remains main-only and the overlay has no arbitrary path or URL command', () => {
  const projectRoot = path.join(__dirname, '..');
  const ipcAuth = fs.readFileSync(path.join(projectRoot, 'desktop', 'ipc-auth.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'desktop', 'preload.js'), 'utf8');
  const overlayPreload = fs.readFileSync(path.join(projectRoot, 'desktop', 'overlay-preload.js'), 'utf8');
  const properties = fs.readFileSync(path.join(projectRoot, 'desktop', 'wallpaper-properties.js'), 'utf8');

  for (const channel of [
    'mineradio-wallpaper-set-enabled',
    'mineradio-wallpaper-update',
    'mineradio-wallpaper-get-status',
  ]) {
    assert.match(ipcAuth, new RegExp(channel));
  }
  assert.match(preload, /getWallpaperStatus/);
  assert.doesNotMatch(overlayPreload, /openPath|openExternal|exec|spawn|filePath|targetUrl/);
  assert.doesNotMatch(properties, /shell\.open|execFile|spawn\(|readFile|writeFile/);
});

test('in-process server uses the credential session and one account-scoped runtime', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8',
  );

  assert.match(serverSource, /processCredentialSessionHost/);
  assert.match(serverSource, /createCredentialSession/);
  assert.match(serverSource, /createAccountCacheBinding/);
  assert.match(serverSource, /createAccountScopedCache/);
  assert.match(serverSource, /createAccountContext/);
  assert.match(serverSource, /createAccountLifecycle/);
  assert.match(serverSource, /loginCredential/);
  assert.match(serverSource, /logoutCredential/);
  for (const namespace of ['collection', 'membership', 'source']) {
    assert.match(serverSource, new RegExp(`\\.get\\(['"]${namespace}['"]`));
    assert.match(serverSource, new RegExp(`\\.set\\(['"]${namespace}['"]`));
  }
  assert.match(serverSource, /\.delete\(change\.namespace,\s*change\.key\)/);
  assert.doesNotMatch(
    serverSource,
    /COOKIE_FILE|QQ_COOKIE_FILE|['"]\.cookie['"]|['"]\.qq-cookie['"]|D:\\\\MineradioCache/,
  );

  const neteaseLogin = serverSource.slice(
    serverSource.indexOf('async function loginNeteaseCredential'),
    serverSource.indexOf('function logoutNeteaseCredential'),
  );
  assert.match(neteaseLogin, /getLoginInfo/);
  assert.doesNotMatch(neteaseLogin, /pendingProfile|loggedIn:\s*true/);

  const platformLoginStart = serverSource.indexOf(
    'function loginPlatformCredential',
  );
  const platformLoginEnd = serverSource.indexOf(
    'function logoutPlatformCredential',
    platformLoginStart,
  );
  const platformLogin = serverSource.slice(platformLoginStart, platformLoginEnd);
  const kugouLoginStart = platformLogin.indexOf("if (provider === 'kugou'");
  const qishuiLoginStart = platformLogin.indexOf(
    "if (provider === 'qishui'",
    kugouLoginStart,
  );
  const kugouLogin = platformLogin.slice(kugouLoginStart, qishuiLoginStart);
  assert.match(kugouLogin, /verifyKugouAccount\(credential\)/);
  assert.ok(
    kugouLogin.indexOf('verifyKugouAccount(credential)')
      < kugouLogin.indexOf('accountLifecycle.login'),
  );
  assert.doesNotMatch(kugouLogin, /metadataAccountFor/);

  const spotifyLoginStart = platformLogin.indexOf(
    "if (provider === 'spotify'",
    qishuiLoginStart,
  );
  const qishuiLogin = platformLogin.slice(qishuiLoginStart, spotifyLoginStart);
  assert.match(qishuiLogin, /verifyQishuiAccount\(credential\)/);
  assert.ok(
    qishuiLogin.indexOf('verifyQishuiAccount(credential)')
      < qishuiLogin.indexOf('accountLifecycle.login'),
  );
  assert.doesNotMatch(qishuiLogin, /qishuiMetadataAccount|loggedIn:\s*true/);
});
