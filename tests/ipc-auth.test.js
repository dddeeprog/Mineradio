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
