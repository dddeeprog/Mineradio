'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WALLPAPER_STATE,
  createWallpaperPropertyBridge,
  normalizeWallpaperPropertyPatch,
  normalizeWallpaperState,
} = require('./wallpaper-properties');

test('wallpaper state accepts only bounded presentation fields and safe cover sources', () => {
  const normalized = normalizeWallpaperState(DEFAULT_WALLPAPER_STATE, {
    enabled: true,
    fullDesktop: true,
    desktopIcons: true,
    title: 'T'.repeat(400),
    artist: 'Artist',
    cover: 'file:///C:/private/cover.png',
    preset: 99,
    opacity: -2,
    frameRate: 999,
    particleDensity: 7,
    paused: true,
    audioInput: false,
    arbitraryPath: 'C:\\private\\music',
    navigateTo: 'https://evil.example/',
  });

  assert.equal(normalized.enabled, true);
  assert.equal(normalized.fullDesktop, true);
  assert.equal(normalized.title.length, 160);
  assert.equal(normalized.cover, '');
  assert.equal(normalized.preset, 7);
  assert.equal(normalized.opacity, 0.35);
  assert.equal(normalized.frameRate, 60);
  assert.equal(normalized.particleDensity, 1.5);
  assert.equal(normalized.paused, true);
  assert.equal(normalized.audioInput, false);
  assert.equal(Object.hasOwn(normalized, 'arbitraryPath'), false);
  assert.equal(Object.hasOwn(normalized, 'navigateTo'), false);

  const withSafeCover = normalizeWallpaperState(normalized, {
    cover: 'https://images.example.test/cover.jpg',
  });
  assert.equal(withSafeCover.cover, 'https://images.example.test/cover.jpg');
  assert.equal(normalizeWallpaperState(withSafeCover, {
    cover: 'javascript:alert(1)',
  }).cover, 'https://images.example.test/cover.jpg');
});

test('runtime pressure may lower wallpaper FPS below the user-facing tiers', () => {
  assert.equal(normalizeWallpaperState(DEFAULT_WALLPAPER_STATE, { frameRate: 12 }).frameRate, 12);
  assert.equal(normalizeWallpaperState(DEFAULT_WALLPAPER_STATE, { frameRate: 1 }).frameRate, 1);
  assert.equal(normalizeWallpaperState(DEFAULT_WALLPAPER_STATE, { frameRate: 24 }).frameRate, 24);
});

test('Wallpaper Engine property patches use an exact allowlist and never accept a path or URL', () => {
  const patch = normalizeWallpaperPropertyPatch({
    preset: { value: 3 },
    opacity: { value: 78 },
    fpstier: { value: 'high' },
    cover: { value: false },
    particles: { value: 125 },
    pause: { value: true },
    audioinput: { value: false },
    path: { value: 'C:\\private\\wallpaper.json' },
    url: { value: 'https://evil.example/' },
    unknown: { value: 'ignored' },
  });

  assert.deepEqual(patch, {
    preset: 3,
    opacity: 0.78,
    frameRate: 60,
    showCover: false,
    particleDensity: 1.25,
    paused: true,
    audioInput: false,
  });
});

test('Wallpaper Engine bridge composes with and restores an existing listener', () => {
  const previousCalls = [];
  const nextCalls = [];
  const previous = {
    applyUserProperties(value) { previousCalls.push(value); },
  };
  const target = { wallpaperPropertyListener: previous };
  const bridge = createWallpaperPropertyBridge({
    target,
    onPatch(value) { nextCalls.push(value); },
  });

  const input = { opacity: { value: 50 }, pause: { value: true } };
  const patch = target.wallpaperPropertyListener.applyUserProperties(input);
  assert.deepEqual(patch, { opacity: 0.5, paused: true });
  assert.equal(previousCalls.length, 1);
  assert.deepEqual(nextCalls, [patch]);

  assert.equal(bridge.dispose(), true);
  assert.equal(target.wallpaperPropertyListener, previous);
  assert.equal(bridge.dispose(), false);
});
