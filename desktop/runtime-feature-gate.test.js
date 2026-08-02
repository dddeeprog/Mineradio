'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createReleaseFeatureFlags,
} = require('../server/platform/feature-flags');

const modulePath = path.join(__dirname, 'runtime-feature-gate.js');
const runtimeFeatureGate = fs.existsSync(modulePath) ? require(modulePath) : null;

test('disabled desktop wallpaper never creates runtime work or registers system listeners', () => {
  assert.ok(runtimeFeatureGate);
  const featureFlags = createReleaseFeatureFlags({ desktopWallpaper: false });
  const gate = runtimeFeatureGate.createDesktopWallpaperFeatureGate(featureFlags);
  let runtimeWork = 0;
  let listenerRegistrations = 0;
  const disabled = Object.freeze({ ok: false, error: 'DESKTOP_WALLPAPER_DISABLED' });

  assert.equal(gate.run(() => {
    runtimeWork += 1;
    return { ok: true };
  }, disabled), disabled);
  assert.equal(gate.register(() => {
    listenerRegistrations += 1;
  }), false);
  assert.equal(runtimeWork, 0);
  assert.equal(listenerRegistrations, 0);
});

test('enabled desktop wallpaper preserves runtime work and system listeners', () => {
  assert.ok(runtimeFeatureGate);
  const featureFlags = createReleaseFeatureFlags({ desktopWallpaper: true });
  const gate = runtimeFeatureGate.createDesktopWallpaperFeatureGate(featureFlags);
  let runtimeWork = 0;
  let listenerRegistrations = 0;

  assert.deepEqual(gate.run(() => {
    runtimeWork += 1;
    return { ok: true };
  }, null), { ok: true });
  assert.equal(gate.register(() => {
    listenerRegistrations += 1;
  }), true);
  assert.equal(runtimeWork, 1);
  assert.equal(listenerRegistrations, 1);
});

test('release defaults keep desktop wallpaper enabled', () => {
  assert.equal(
    createReleaseFeatureFlags().snapshot().desktopWallpaper,
    true,
  );
});
