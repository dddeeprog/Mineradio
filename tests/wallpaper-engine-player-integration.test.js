'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAllowedIpcSender } = require('../desktop/ipc-auth');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Wallpaper Engine library and Scene controls are main-window-only IPC', () => {
  const channels = [
    'mineradio-wallpaper-engine-list',
    'mineradio-wallpaper-engine-choose-directory',
    'mineradio-wallpaper-engine-choose-project-file',
    'mineradio-wallpaper-engine-remove-directory',
    'mineradio-wallpaper-engine-runtime-status',
    'mineradio-wallpaper-engine-start-scene',
    'mineradio-wallpaper-engine-park-scene',
    'mineradio-wallpaper-engine-stop-scene',
  ];
  for (const channel of channels) {
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/', 34567), true, channel);
    assert.equal(isAllowedIpcSender(channel, 'http://127.0.0.1:34567/wallpaper.html', 34567), false, channel);
    assert.equal(isAllowedIpcSender(channel, 'https://example.com/', 34567), false, channel);
  }
});

test('desktop main process wires the local library, native runtime, protocol, and bounded lifecycle', () => {
  const main = read('desktop', 'main.js');
  const preload = read('desktop', 'preload.js');
  const pkg = JSON.parse(read('package.json'));

  assert.match(main, /require\('\.\/wallpaper-engine-library'\)/);
  assert.match(main, /require\('\.\/wallpaper-engine-runtime'\)/);
  assert.match(main, /registerWallpaperEngineScheme\(protocol\)/);
  assert.match(main, /wallpaperEngineLibrary\.installProtocol\(protocol\)/);
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
    assert.match(main, new RegExp(`handleIpc\\('${channel}'`));
  }
  assert.match(main, /wallpaperEngineRuntime\.dispose\(\)/);
  assert.match(main, /wallpaperEngineLibrary\.dispose\(\)/);
  assert.match(main, /app\.on\('before-quit', \(event\) =>/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /await Promise\.allSettled\(disposals\)/);
  assert.match(main, /handleIpc\('mineradio-restart-app',[\s\S]{0,240}await wallpaperEngineRuntime\.dispose\(\)[\s\S]{0,240}app\.relaunch\(\)/);
  assert.match(main, /handleIpc\('mineradio-restart-app',[\s\S]{0,240}app\.quit\(\)/);
  assert.doesNotMatch(main, /handleIpc\('mineradio-restart-app',[\s\S]{0,240}app\.exit\(/);
  assert.match(preload, /listWallpaperEngineProjects/);
  assert.match(preload, /startWallpaperEngineScene/);
  assert.match(preload, /parkWallpaperEngineScene/);
  assert.match(preload, /stopWallpaperEngineScene/);
  assert.match(pkg.scripts.check, /desktop\/wallpaper-engine-library\.js/);
  assert.match(pkg.scripts.check, /desktop\/wallpaper-engine-runtime\.js/);
  assert.match(pkg.scripts.check, /public\/wallpaper-engine-state\.js/);
  assert.match(pkg.scripts.check, /public\/wallpaper-engine-ui\.js/);
});

test('settings expose a separate Wallpaper Engine library and player background layer', () => {
  const index = read('public', 'index.html');
  const css = read('public', 'styles', 'app.css');
  const ui = read('public', 'wallpaper-engine-ui.js');

  assert.match(index, /id="wallpaper-engine-layer"/);
  assert.match(index, /id="wallpaper-engine-video"/);
  assert.match(index, /id="wallpaper-engine-image"/);
  assert.match(index, /id="wallpaper-engine-entry"/);
  assert.match(index, /id="wallpaper-engine-modal"/);
  assert.match(index, /id="wallpaper-engine-grid"/);
  assert.match(index, /src="wallpaper-engine-state\.js"/);
  assert.match(index, /src="wallpaper-engine-ui\.js"/);
  assert.match(css, /#wallpaper-engine-layer/);
  assert.match(css, /body\.wallpaper-engine-active/);
  assert.match(css, /#wallpaper-engine-layer::after/);
  assert.match(css, /radial-gradient\([^\n]+rgba\(0,0,0/);
  assert.match(css, /#fx-panel\s*>\s*\.fx-head\s*\{[^}]*position:\s*sticky/s);
  assert.match(ui, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(ui, /chromeMediaSourceId/);
  assert.match(ui, /projectPlaybackKind/);
  assert.match(ui, /restoreOriginalBackground/);
  assert.match(ui, /function waitForPlayerEntry/);
  assert.match(ui, /function waitForUsableDesktopWindow/);
  assert.match(ui, /async function refreshDesktopLifecycleState/);
  assert.match(ui, /await refreshDesktopLifecycleState\(\)/);
  assert.match(ui, /api\.getState\(\)/);
  assert.match(ui, /api\.onStateChange/);
  assert.match(ui, /state\.isVisible && !state\.isMinimized/);
  assert.match(ui, /await waitForPlayerEntry\(\)/);
  assert.match(ui, /wallpaperEnginePerformancePolicy/);
  assert.match(ui, /document\.addEventListener\('visibilitychange'/);
  assert.match(ui, /function suspendWallpaperEnginePlayback/);
  assert.match(ui, /function resumeWallpaperEnginePlayback/);
  assert.match(ui, /__mineradioSyncWallpaperEngineCaptureFrameRate/);
  assert.match(index, /__mineradioSyncWallpaperEngineCaptureFrameRate/);
  assert.doesNotMatch(ui, /maxFrameRate:\s*60/);
  assert.doesNotMatch(ui, /require\(['"](?:fs|path|child_process)/);

  assert.match(index, /id="t-wallpaperMode"/);
  assert.match(index, /onclick="toggleFx\('wallpaperMode'\)"/);
});
