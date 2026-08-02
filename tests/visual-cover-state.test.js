const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldApplyCoverTextureForPreset,
  shouldDebounceCoverTextureUpdate,
  shouldKeepPresetMotionOnTrackChange,
  visualCoverPolicy,
} = require('../public/visual-cover-state');

test('classifies presets by how they use song cover artwork', () => {
  assert.equal(visualCoverPolicy(0), 'cover-texture');
  assert.equal(visualCoverPolicy(4), 'cover-texture');
  assert.equal(visualCoverPolicy(1), 'palette-only');
  assert.equal(visualCoverPolicy(2), 'palette-only');
  assert.equal(visualCoverPolicy(3), 'static-motion');
  assert.equal(visualCoverPolicy(5), 'static-motion');
  assert.equal(visualCoverPolicy(6), 'static-motion');
  assert.equal(visualCoverPolicy(99), 'cover-texture');
});

test('only cover-texture presets apply song cover textures during normal track switches', () => {
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 0, reason: 'track-switch' }), true);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 4, reason: 'track-switch' }), true);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 1, reason: 'track-switch' }), false);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 2, reason: 'track-switch' }), false);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 5, reason: 'track-switch' }), false);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 6, reason: 'track-switch' }), false);
});

test('manual and resolution cover updates can force texture application', () => {
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 5, reason: 'manual-cover', force: true }), true);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 6, fromResolutionChange: true }), true);
  assert.equal(shouldApplyCoverTextureForPreset({ preset: 1, presetChangedToCoverTexture: true }), true);
});

test('normal cover-texture track switches are debounced after first play', () => {
  assert.equal(shouldDebounceCoverTextureUpdate({ preset: 0, reason: 'track-switch', firstVisualPlay: false }), true);
  assert.equal(shouldDebounceCoverTextureUpdate({ preset: 4, reason: 'track-switch', firstVisualPlay: false }), true);
  assert.equal(shouldDebounceCoverTextureUpdate({ preset: 0, reason: 'track-switch', firstVisualPlay: true }), false);
  assert.equal(shouldDebounceCoverTextureUpdate({ preset: 5, reason: 'track-switch', firstVisualPlay: false }), false);
  assert.equal(shouldDebounceCoverTextureUpdate({ preset: 0, reason: 'manual-cover', force: true }), false);
});

test('static and palette-only presets keep their particle motion on track changes', () => {
  assert.equal(shouldKeepPresetMotionOnTrackChange({ preset: 5, reason: 'track-switch' }), true);
  assert.equal(shouldKeepPresetMotionOnTrackChange({ preset: 6, reason: 'track-switch' }), true);
  assert.equal(shouldKeepPresetMotionOnTrackChange({ preset: 1, reason: 'track-switch' }), true);
  assert.equal(shouldKeepPresetMotionOnTrackChange({ preset: 0, reason: 'track-switch' }), false);
  assert.equal(shouldKeepPresetMotionOnTrackChange({ preset: 5, reason: 'manual-cover', force: true }), false);
});
