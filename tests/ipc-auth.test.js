const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isAllowedIpcSender,
  senderRoleForUrl,
} = require('../desktop/ipc-auth');

test('sender role is derived from trusted local app urls', () => {
  assert.equal(senderRoleForUrl('http://127.0.0.1:34567/', 34567), 'main');
  assert.equal(senderRoleForUrl('http://127.0.0.1:34567/index.html', 34567), 'main');
  assert.equal(senderRoleForUrl('http://127.0.0.1:34567/desktop-lyrics.html', 34567), 'overlay');
  assert.equal(senderRoleForUrl('https://example.com/', 34567), '');
});

test('main ipc channels reject overlay and remote senders', () => {
  assert.equal(isAllowedIpcSender('mineradio-restart-app', 'http://127.0.0.1:34567/', 34567), true);
  assert.equal(isAllowedIpcSender('mineradio-restart-app', 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), false);
  assert.equal(isAllowedIpcSender('mineradio-restart-app', 'https://example.com/', 34567), false);
});

test('desktop shell ipc channels are main-window only', () => {
  for (const channel of [
    'mineradio-tray-get-settings',
    'mineradio-tray-set-close-to-tray',
    'mineradio-startup-set-enabled',
    'mineradio-ui-state-read-sync',
    'mineradio-ui-state-write',
  ]) {
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/', 34567), true);
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), false);
    assert.equal(isAllowedIpcSender(channel, 'https://example.com/', 34567), false);
  }
});

test('platform credentials and local library ipc channels are main-window only', () => {
  for (const channel of [
    'platform-music-open-login',
    'platform-music-clear-login',
    'mineradio-credential-set',
    'mineradio-credential-clear',
    'mineradio-credential-status',
    'mineradio-local-music-choose-folder',
    'mineradio-local-music-scan-folder',
    'mineradio-local-music-refresh-entries',
    'mineradio-local-file-read-range',
    'mineradio-local-file-read-data-url',
  ]) {
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/', 34567), true);
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), false);
    assert.equal(isAllowedIpcSender(channel, 'https://example.com/', 34567), false);
  }
});

test('Wallpaper Engine project and Scene channels are main-window only', () => {
  for (const channel of [
    'mineradio-wallpaper-engine-list',
    'mineradio-wallpaper-engine-choose-directory',
    'mineradio-wallpaper-engine-choose-project-file',
    'mineradio-wallpaper-engine-remove-directory',
    'mineradio-wallpaper-engine-runtime-status',
    'mineradio-wallpaper-engine-start-scene',
    'mineradio-wallpaper-engine-park-scene',
    'mineradio-wallpaper-engine-stop-scene',
  ]) {
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/', 34567), true);
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/wallpaper.html', 34567), false);
    assert.equal(isAllowedIpcSender(channel, 'https://example.com/', 34567), false);
  }
});

test('overlay ipc channels reject main and remote senders', () => {
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-move-by', 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), true);
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-move-by', 'http://127.0.0.1:34567/', 34567), false);
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-move-by', 'https://example.com/', 34567), false);
});

test('shared desktop lyrics close channel accepts main and overlay senders only', () => {
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-set-enabled', 'http://127.0.0.1:34567/', 34567), true);
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-set-enabled', 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), true);
  assert.equal(isAllowedIpcSender('mineradio-desktop-lyrics-set-enabled', 'https://example.com/', 34567), false);
});
