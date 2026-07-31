'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  WallpaperRuntime,
  buildWorkerWAttachScript,
} = require('./wallpaper-runtime');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.destroyed = false;
  }

  isDestroyed() { return this.destroyed; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
}

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.id = FakeWindow.instances.length + 1;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.visible = false;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.hooks = new Map();
    FakeWindow.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  async loadURL(url) { this.url = url; }
  setBounds(bounds) { this.bounds = { ...bounds }; }
  setIgnoreMouseEvents(value, options) { this.ignoreMouse = { value, options }; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  getNativeWindowHandle() {
    const value = Buffer.alloc(8);
    value.writeBigUInt64LE(BigInt(this.id));
    return value;
  }
  hookWindowMessage(id, listener) { this.hooks.set(id, listener); }
  unhookWindowMessage(id) { this.hooks.delete(id); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.webContents.destroyed = true;
    this.emit('closed');
  }
}
FakeWindow.instances = [];

function fixture(overrides = {}) {
  FakeWindow.instances = [];
  let display = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 } };
  const attachCalls = [];
  const hookCalls = [];
  const runtime = new WallpaperRuntime({
    BrowserWindow: FakeWindow,
    screen: { getPrimaryDisplay: () => display },
    platform: 'win32',
    preloadPath: 'C:\\app\\desktop\\overlay-preload.js',
    overlayUrl: () => 'http://127.0.0.1:34567/wallpaper.html',
    retryDelays: [0, 0, 0],
    sleep: async () => {},
    attachNative: async input => {
      attachCalls.push(input);
      return { ok: true, targetWindowId: input.hwnd, parentWindowId: '88', parentKind: 'workerw', fallback: false };
    },
    explorerHookFactory: async ({ onRestart }) => {
      hookCalls.push(onRestart);
      return () => hookCalls.push('disposed');
    },
    ...overrides,
  });
  return {
    runtime,
    attachCalls,
    hookCalls,
    setDisplay(next) { display = next; },
  };
}

test('concurrent starts create and attach exactly one wallpaper window', async () => {
  let resolveAttach;
  const pending = new Promise(resolve => { resolveAttach = resolve; });
  const harness = fixture({
    attachNative: async input => {
      harness.attachCalls.push(input);
      await pending;
      return { ok: true, targetWindowId: input.hwnd, parentWindowId: '88', parentKind: 'workerw' };
    },
  });

  const first = harness.runtime.start({ title: 'First' });
  const second = harness.runtime.start({ title: 'Latest', fullDesktop: true });
  resolveAttach();
  const results = await Promise.all([first, second]);

  assert.equal(results.every(result => result.ok), true);
  assert.equal(FakeWindow.instances.length, 1);
  assert.equal(harness.attachCalls.length, 1);
  assert.equal(harness.runtime.getStatus().active, true);
  const states = FakeWindow.instances[0].webContents.sent.filter(item => item.channel === 'mineradio-wallpaper-state');
  assert.equal(states.at(-1).payload.title, 'Latest');
  assert.equal(states.at(-1).payload.fullDesktop, true);
});

test('stopping during a pending attach prevents a late wallpaper window', async () => {
  let resolveAttach;
  const pending = new Promise(resolve => { resolveAttach = resolve; });
  const harness = fixture({
    attachNative: async input => {
      harness.attachCalls.push(input);
      await pending;
      return { ok: true, targetWindowId: input.hwnd, parentWindowId: '88', parentKind: 'workerw' };
    },
  });

  const starting = harness.runtime.start({ enabled: true });
  await Promise.resolve();
  const stopped = await harness.runtime.stop('user-disabled-during-start');
  resolveAttach();
  const started = await starting;

  assert.equal(stopped.enabled, false);
  assert.equal(started.ok, false);
  assert.equal(started.stale, true);
  assert.equal(harness.runtime.getStatus().enabled, false);
  assert.equal(harness.runtime.getStatus().windowCount, 0);
  assert.equal(FakeWindow.instances.every(win => win.destroyed), true);
});

test('WorkerW failure retries and accepts a verified Progman fallback', async () => {
  let attempts = 0;
  const harness = fixture({
    attachNative: async input => {
      harness.attachCalls.push(input);
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('WALLPAPER_WORKERW_NOT_FOUND'), { code: 'WALLPAPER_WORKERW_NOT_FOUND' });
      return { ok: true, targetWindowId: input.hwnd, parentWindowId: '77', parentKind: 'progman', fallback: true };
    },
  });

  const result = await harness.runtime.start({ enabled: true });
  assert.equal(result.ok, true);
  assert.equal(harness.attachCalls.length, 2);
  assert.equal(result.status.parentKind, 'progman');
  assert.equal(result.status.fallback, true);
  assert.equal(result.status.attachAttempts, 2);
});

test('exhausted native attach rolls state back and destroys the failed window', async () => {
  const harness = fixture({
    retryDelays: [0, 0],
    attachNative: async () => {
      throw Object.assign(new Error('WALLPAPER_WORKERW_ATTACH_FAILED'), { code: 'WALLPAPER_WORKERW_ATTACH_FAILED' });
    },
  });

  const result = await harness.runtime.start({ enabled: true, fullDesktop: true });
  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.equal(result.error, 'WALLPAPER_WORKERW_ATTACH_FAILED');
  assert.equal(harness.runtime.getStatus().active, false);
  assert.equal(harness.runtime.getStatus().enabled, false);
  assert.equal(FakeWindow.instances[0].destroyed, true);
});

test('Explorer restart and display changes reuse one window and reattach safely', async () => {
  const harness = fixture();
  await harness.runtime.start({ enabled: true });
  const win = FakeWindow.instances[0];

  await harness.runtime.handleSystemEvent('explorer-restart');
  harness.setDisplay({ id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 } });
  await harness.runtime.handleSystemEvent('display-metrics-changed');

  assert.equal(FakeWindow.instances.length, 1);
  assert.equal(harness.attachCalls.length, 3);
  assert.deepEqual(win.bounds, { x: -1280, y: 0, width: 1280, height: 720 });
  assert.equal(harness.runtime.getStatus().displayId, '2');
});

test('lock and suspend pause the page while unlock and resume reconcile the host', async () => {
  const harness = fixture();
  await harness.runtime.start({ enabled: true, paused: false });
  const win = FakeWindow.instances[0];

  await harness.runtime.handleSystemEvent('lock-screen');
  assert.equal(win.webContents.sent.at(-1).payload.systemPaused, true);
  await harness.runtime.handleSystemEvent('suspend');
  assert.equal(harness.attachCalls.length, 1);

  await harness.runtime.handleSystemEvent('unlock-screen');
  assert.equal(harness.attachCalls.length, 2);
  assert.equal(win.webContents.sent.at(-1).payload.systemPaused, false);
  await harness.runtime.handleSystemEvent('resume');
  assert.equal(harness.attachCalls.length, 3);
});

test('full desktop and icon visibility update the same window without touching shell files', async () => {
  const harness = fixture();
  await harness.runtime.start({ enabled: true, fullDesktop: false });
  const enabled = await harness.runtime.update({ fullDesktop: true, desktopIcons: true });
  const disabled = await harness.runtime.update({ fullDesktop: false });

  assert.equal(enabled.ok, true);
  assert.equal(disabled.ok, true);
  assert.equal(FakeWindow.instances.length, 1);
  assert.equal(enabled.status.fullDesktop, true);
  assert.equal(disabled.status.fullDesktop, false);
  assert.equal(FakeWindow.instances[0].ignoreMouse.value, true);
});

test('stop and dispose are idempotent and remove Explorer hooks', async () => {
  const harness = fixture();
  await harness.runtime.start({ enabled: true });
  assert.equal(harness.hookCalls.length, 1);

  const first = await harness.runtime.stop('user-disabled');
  const second = await harness.runtime.stop('user-disabled-again');
  await harness.runtime.dispose();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(harness.hookCalls.includes('disposed'), true);
  assert.equal(FakeWindow.instances[0].destroyed, true);
  assert.equal(harness.runtime.getStatus().windowCount, 0);
});

test('an unexpected wallpaper close disables the runtime and reports one stable error', async () => {
  const statuses = [];
  const harness = fixture({ onStatus: status => statuses.push(status) });
  await harness.runtime.start({ enabled: true, fullDesktop: true });
  const win = FakeWindow.instances[0];

  win.destroyed = true;
  win.webContents.destroyed = true;
  win.emit('closed');

  assert.equal(harness.runtime.getStatus().enabled, false);
  assert.equal(harness.runtime.getStatus().active, false);
  assert.equal(harness.runtime.getStatus().lastError, 'WALLPAPER_WINDOW_CLOSED');
  assert.equal(statuses.at(-1).reason, 'window-closed-unexpectedly');
});

test('native WorkerW script validates numeric handles and contains a verified Progman fallback', () => {
  assert.throws(
    () => buildWorkerWAttachScript({ hwnd: 'C:\\private', bounds: { width: 1, height: 1 } }),
    /WALLPAPER_NATIVE_HANDLE_INVALID/,
  );
  const source = buildWorkerWAttachScript({
    hwnd: '1234',
    bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  });
  assert.match(source, /WorkerW/);
  assert.match(source, /Progman/);
  assert.match(source, /WALLPAPER_WORKERW_ATTACH_FAILED/);
  assert.match(source, /parentKind/);
  assert.doesNotMatch(source, /C:\\private/);
});
