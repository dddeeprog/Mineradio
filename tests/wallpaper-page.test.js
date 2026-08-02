'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const wallpaper = fs.readFileSync(path.join(root, 'public', 'wallpaper.html'), 'utf8');
const iconLayer = fs.readFileSync(path.join(root, 'public', 'desktop-icon-layer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
const overlayPreload = fs.readFileSync(path.join(root, 'desktop', 'overlay-preload.js'), 'utf8');
const ipcAuth = fs.readFileSync(path.join(root, 'desktop', 'ipc-auth.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('wallpaper page exposes the Wallpaper Engine property and audio bridges', () => {
  assert.match(wallpaper, /wallpaperPropertyListener/);
  assert.match(wallpaper, /applyUserProperties/);
  assert.match(wallpaper, /wallpaperRegisterAudioListener/);
  for (const property of ['preset', 'opacity', 'fpstier', 'cover', 'particles', 'pause', 'audioinput']) {
    assert.match(wallpaper, new RegExp(property));
  }
  assert.doesNotMatch(wallpaper, /window\.open|location\.href\s*=|file:\/\//);
});

test('wallpaper page throttles one frame loop and supports pause, density, and audio input', () => {
  assert.equal((wallpaper.match(/requestAnimationFrame\(/g) || []).length <= 2, true);
  assert.match(wallpaper, /state\.frameRate/);
  assert.match(wallpaper, /state\.particleDensity/);
  assert.match(wallpaper, /state\.paused\s*\|\|\s*state\.systemPaused/);
  assert.match(wallpaper, /wallpaperAudioLevel/);
});

test('complete desktop uses one bounded glass icon layer without filesystem or network ownership', () => {
  assert.match(wallpaper, /<script src="desktop-icon-layer\.js"><\/script>/);
  assert.match(wallpaper, /id="desktop-icon-layer"/);
  assert.match(iconLayer, /MAX_DESKTOP_ICONS/);
  assert.match(iconLayer, /textContent/);
  assert.doesNotMatch(iconLayer, /fetch\(|XMLHttpRequest|WebSocket|require\(['"](?:fs|child_process)/);
  assert.doesNotMatch(iconLayer, /file:\/\/|shell\.openPath|execFile|spawn\(/);
});

test('Electron wallpaper lifecycle is extracted, authorized, sandboxed, and power-aware', () => {
  assert.match(main, /require\('\.\/wallpaper-runtime'\)/);
  assert.match(main, /new WallpaperRuntime\(/);
  assert.match(main, /createDesktopWallpaperFeatureGate/);
  assert.match(main, /desktopWallpaperFeatureGate\.run\(/);
  assert.match(main, /desktopWallpaperFeatureGate\.register\(/);
  assert.match(main, /powerMonitor\.on\('lock-screen'/);
  assert.match(main, /powerMonitor\.on\('unlock-screen'/);
  assert.match(main, /powerMonitor\.on\('suspend'/);
  assert.match(main, /powerMonitor\.on\('resume'/);
  assert.doesNotMatch(main, /function attachWallpaperToWorkerW\(/);
  assert.match(preload, /mineradio-wallpaper-get-status/);
  assert.match(ipcAuth, /mineradio-wallpaper-get-status/);
  assert.match(overlayPreload, /wallpaperEnvironment/);
  assert.match(pkg.scripts.check, /desktop\/wallpaper-runtime\.js/);
  assert.match(pkg.scripts.check, /desktop\/wallpaper-properties\.js/);
  assert.match(pkg.scripts.check, /desktop\/desktop-icon-state\.js/);
  assert.match(pkg.scripts.check, /desktop\/wallpaper-diagnostics\.js/);
  assert.match(pkg.scripts.check, /public\/desktop-icon-layer\.js/);
});

test('settings persist complete desktop controls and roll back failed initialization', () => {
  assert.match(index, /id="t-fullDesktopMode"/);
  assert.match(index, /id="t-wallpaperDesktopIcons"/);
  assert.match(index, /id="wallpaper-fps-seg"/);
  assert.match(index, /id="fx-wallpaperparticles"/);
  assert.match(index, /fullDesktopMode:\s*raw\.fullDesktopMode === true/);
  assert.match(index, /wallpaperDesktopIcons:\s*raw\.wallpaperDesktopIcons !== false/);
  assert.match(index, /function rollbackWallpaperModeState\(/);
  assert.match(index, /fx\.wallpaperMode = false/);
  assert.match(index, /fx\.fullDesktopMode = false/);
});
