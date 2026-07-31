'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWallpaperDiagnostics,
  diagnosticCode,
  sanitizeStatus,
} = require('./wallpaper-diagnostics');

test('wallpaper diagnostics keep bounded state and exclude handles paths URLs and metadata', () => {
  const diagnostics = createWallpaperDiagnostics({ maxEvents: 4, clock: () => 1234 });
  for (let index = 0; index < 7; index += 1) {
    diagnostics.record('attach ../private ' + index, {
      enabled: true,
      active: index === 6,
      parentKind: 'workerw',
      windowCount: 99,
      hwnd: '998877',
      path: 'C:\\Users\\Private\\song.mp3',
      url: 'file:///private/song.mp3',
      title: 'Private title',
      error: 'C:\\private WALLPAPER_WORKERW_ATTACH_FAILED file:///private',
    });
  }

  const snapshot = diagnostics.snapshot({ enabled: true, active: true, parentKind: 'workerw' });
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.events.length, 4);
  assert.equal(snapshot.events.at(-1).state.windowCount, 1);
  assert.equal(snapshot.events.at(-1).state.lastError, 'WALLPAPER_WORKERW_ATTACH_FAILED');
  assert.doesNotMatch(serialized, /998877|Users|song\.mp3|file:|Private title/);
});

test('diagnostic status and error codes use fixed bounded shapes', () => {
  assert.equal(diagnosticCode('prefix FULL_DESKTOP_INIT_FAILED details'), 'FULL_DESKTOP_INIT_FAILED');
  assert.equal(diagnosticCode('arbitrary path C:\\private', 'WALLPAPER_UNKNOWN'), 'WALLPAPER_UNKNOWN');
  assert.deepEqual(Object.keys(sanitizeStatus({})).sort(), [
    'active', 'attachAttempts', 'desktopIcons', 'enabled', 'fallback', 'fullDesktop',
    'generation', 'lastError', 'parentKind', 'phase', 'retryCount', 'systemPaused', 'windowCount',
  ].sort());
});
