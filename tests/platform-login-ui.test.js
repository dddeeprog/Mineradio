'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createLoginState,
} = require('../public/platform-login-state');
const {
  renderAuthMethods,
  renderProviderRows,
} = require('../public/platform-login-ui');

function stateFixture() {
  return createLoginState({
    schema: 1,
    providers: [
      {
        provider: 'netease',
        label: '网易云音乐',
        authMethods: ['qr', 'cookie', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: true },
        availability: { playback: true },
      },
      {
        provider: 'qq',
        label: 'QQ 音乐',
        authMethods: ['cookie', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: true },
        availability: { playback: true },
      },
      {
        provider: 'kugou',
        label: '酷狗音乐',
        authMethods: ['cookie', 'external-window'],
        account: { loggedIn: true, accountId: 'kg' },
        capabilities: { playback: false },
        availability: { playback: false },
      },
      {
        provider: 'qishui',
        label: '汽水音乐',
        authMethods: ['token', 'cookie', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: false },
        availability: { playback: false },
      },
      {
        provider: 'spotify',
        label: 'Spotify',
        authMethods: ['pkce', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: false },
        availability: { playback: false },
      },
    ],
  }, { selectedProvider: 'qishui' });
}

test('provider rows render five first-level horizontal controls', () => {
  const html = renderProviderRows(stateFixture());

  for (const provider of ['netease', 'qq', 'kugou', 'qishui', 'spotify']) {
    assert.match(html, new RegExp(`data-login-provider="${provider}"`));
  }
  assert.equal((html.match(/class="platform-login-provider-row/g) || []).length, 5);
  assert.match(html, /aria-current="true"[^>]*data-login-provider="qishui"|data-login-provider="qishui"[^>]*aria-current="true"/);
  assert.match(html, /酷狗音乐/);
  assert.match(html, /仅同步账号与搜索元数据/);
});

test('method rows exactly follow the selected provider capability methods', () => {
  const html = renderAuthMethods(stateFixture());

  assert.match(html, /data-login-method="token"/);
  assert.match(html, /data-login-method="cookie"/);
  assert.match(html, /data-login-method="external-window"/);
  assert.doesNotMatch(html, /data-login-method="qr"/);
  assert.doesNotMatch(html, /data-login-method="pkce"/);
  assert.doesNotMatch(html, /可播放|播放授权/);
});

test('renderers escape capability labels and do not invent providers', () => {
  const state = createLoginState({
    schema: 1,
    providers: [{
      provider: 'spotify',
      label: '<img src=x onerror=alert(1)>',
      authMethods: ['pkce'],
      account: { loggedIn: false },
      capabilities: { playback: false },
      availability: { playback: false },
    }],
  }, { selectedProvider: 'spotify' });
  const html = renderProviderRows(state);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal((html.match(/data-login-provider=/g) || []).length, 1);
});

test('application shell wires the five-provider capability-driven login flow', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8',
  );

  assert.match(html, /src="platform-login-state\.js"/);
  assert.match(html, /src="platform-login-ui\.js"/);
  assert.match(html, /id="login-platform-tabs"/);
  assert.match(html, /id="platform-login-method-list"/);
  for (const provider of ['netease', 'qq', 'kugou', 'qishui', 'spotify']) {
    assert.match(
      html,
      new RegExp(`id="account-add-${provider}"`),
    );
  }
  assert.match(html, /function handlePlatformLoginMethod\(provider, method\)/);
  assert.match(html, /function submitPlatformManualLogin\(\)/);
  assert.match(html, /function openPlatformWebLogin\(provider\)/);
  assert.match(html, /openPlatformMusicLogin\(provider, options\)/);
  assert.match(html, /\/api\/platform\/login\/import/);
  assert.match(html, /\/api\/platform\/logout/);
  assert.match(html, /refreshPlatformLoginCapabilities\(true\)/);
  assert.doesNotMatch(html, /\/api\/qq\/login\/cookie/);
  assert.doesNotMatch(html, /\/api\/qq\/logout/);

  const qrSuccessFlow = html.slice(
    html.indexOf('async function checkQr()'),
    html.indexOf('function updateUserModalUi()'),
  );
  assert.match(qrSuccessFlow, /refreshPlatformLoginCapabilities\(true\)/);
});

test('syntax gate covers every platform login runtime module', () => {
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'package.json'),
    'utf8',
  ));
  const check = packageJson.scripts && packageJson.scripts.check || '';

  for (const file of [
    'desktop/platform-login-window.js',
    'desktop/spotify-pkce.js',
    'public/platform-login-state.js',
    'public/platform-login-ui.js',
  ]) {
    assert.match(check, new RegExp(`node --check ${file.replace('.', '\\.')}`));
  }
});
