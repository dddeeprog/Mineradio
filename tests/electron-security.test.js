const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isAllowedAppUrl,
  isAllowedLoginUrl,
  isSafeExternalUrl,
} = require('../desktop/navigation-guard');

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

test('in-process server uses the credential session and one account-scoped runtime', () => {
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', 'server.js'),
    'utf8',
  );

  assert.match(serverSource, /processCredentialSessionHost/);
  assert.match(serverSource, /createCredentialSession/);
  assert.match(serverSource, /createAccountScopedCache/);
  assert.match(serverSource, /createAccountContext/);
  assert.match(serverSource, /createAccountLifecycle/);
  assert.match(serverSource, /loginCredential/);
  assert.match(serverSource, /logoutCredential/);
  assert.doesNotMatch(
    serverSource,
    /COOKIE_FILE|QQ_COOKIE_FILE|['"]\.cookie['"]|['"]\.qq-cookie['"]|D:\\\\MineradioCache/,
  );
});
