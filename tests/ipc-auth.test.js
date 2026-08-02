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

test('eisland bridge renderer channels are main-window only', () => {
  for (const channel of [
    'mineradio-eisland-bridge-state',
    'mineradio-eisland-bridge-heartbeat',
    'mineradio-eisland-bridge-command-complete',
  ]) {
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/', 34567), true);
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/desktop-lyrics.html', 34567), false);
    assert.equal(isAllowedIpcSender(channel, 'https://example.com/', 34567), false);
  }
});

test('preload exposes only restricted eisland bridge methods and cleans subscriptions', () => {
  const Module = require('node:module');
  const preloadPath = require.resolve('../desktop/preload');
  const originalLoad = Module._load;
  const priorCache = require.cache[preloadPath];
  const previousDocument = global.document;
  const previousWindow = global.window;
  const exposed = {};
  const listeners = new Map();
  const sent = [];
  const ipcRenderer = {
    invoke: async () => undefined,
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(listener);
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
    },
    send(channel, payload) {
      sent.push([channel, payload]);
    },
    sendSync() {
      return {};
    },
  };

  try {
    global.window = {
      addEventListener() {},
      localStorage: {
        getItem() { return null; },
        setItem() {},
      },
    };
    global.document = {
      body: { classList: { add() {} } },
      documentElement: { classList: { add() {} } },
    };
    Module._load = function loadElectronMock(request, parent, isMain) {
      if (request === 'electron') {
        return {
          contextBridge: {
            exposeInMainWorld(name, value) { exposed[name] = value; },
          },
          ipcRenderer,
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[preloadPath];
    require(preloadPath);

    const bridge = exposed.eislandBridge;
    assert.deepEqual(Object.keys(bridge).sort(), [
      'completeCommand',
      'onCommand',
      'publishHeartbeat',
      'publishState',
    ]);
    assert.equal(Object.hasOwn(bridge, 'ipcRenderer'), false);
    bridge.publishState({ state: 'fresh' });
    bridge.publishHeartbeat({ state: 'heartbeat' });
    let command;
    const cleanup = bridge.onCommand((payload) => { command = payload; });
    const listener = [...listeners.get('mineradio-eisland-bridge-command')][0];
    listener({}, { command: 'pause' });
    assert.deepEqual(command, { command: 'pause' });
    cleanup();
    assert.equal(listeners.get('mineradio-eisland-bridge-command').size, 0);
    bridge.completeCommand({ attempt: 'attempt-1', ok: true, requestId: 'request-1' });
    assert.deepEqual(sent, [
      ['mineradio-eisland-bridge-state', { state: 'fresh' }],
      ['mineradio-eisland-bridge-heartbeat', { state: 'heartbeat' }],
      ['mineradio-eisland-bridge-command-complete', {
        attempt: 'attempt-1',
        ok: true,
        requestId: 'request-1',
      }],
    ]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
    if (priorCache) require.cache[preloadPath] = priorCache;
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
