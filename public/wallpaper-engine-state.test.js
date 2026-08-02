'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProject,
  normalizeSelection,
  projectPlaybackKind,
  projectMediaUrl,
  wallpaperEnginePerformancePolicy,
} = require('./wallpaper-engine-state');

test('normalizes Wallpaper Engine projects without retaining filesystem paths', () => {
  const project = normalizeProject({
    id: '1234567890ABCDEF12345678',
    title: '  Scene\nName  ',
    projectType: 'scene',
    enginePlayable: true,
    source: 'workshop',
    sourceLabel: 'Steam Workshop',
    projectRoot: 'C:\\private\\wallpaper',
  });

  assert.deepEqual(project, {
    id: '1234567890abcdef12345678',
    title: 'Scene Name',
    projectType: 'scene',
    mediaType: '',
    playable: false,
    enginePlayable: true,
    previewOnly: false,
    hasPreview: false,
    previewAnimated: false,
    mediaAnimated: false,
    source: 'workshop',
    sourceLabel: 'Steam Workshop',
    workshopId: '',
    updatedAt: 0,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(project, 'projectRoot'), false);
});

test('chooses native Scene, direct media, and preview fallback deterministically', () => {
  assert.equal(projectPlaybackKind({ enginePlayable: true, playable: true }), 'engine');
  assert.equal(projectPlaybackKind({ playable: true, mediaType: 'video' }), 'video');
  assert.equal(projectPlaybackKind({ playable: true, mediaType: 'image' }), 'image');
  assert.equal(projectPlaybackKind({ hasPreview: true }), 'preview');
  assert.equal(projectPlaybackKind({}), '');
});

test('builds token-bound media urls and rejects invalid ids or tokens', () => {
  const id = '1234567890abcdef12345678';
  const token = 'a'.repeat(48);
  assert.equal(
    projectMediaUrl({ id, updatedAt: 123 }, 'preview', token),
    `mineradio-wallpaper://preview/${id}?v=123&token=${token}`
  );
  assert.equal(projectMediaUrl({ id: 'C:\\private' }, 'media', token), '');
  assert.equal(projectMediaUrl({ id }, 'media', 'bad-token'), '');
});

test('restores only a bounded active selection', () => {
  assert.deepEqual(normalizeSelection({
    active: true,
    id: '1234567890ABCDEF12345678',
    title: ' Test ',
    kind: 'engine',
  }), {
    active: true,
    id: '1234567890abcdef12345678',
    title: 'Test',
    kind: 'engine',
  });
  assert.deepEqual(normalizeSelection({ active: true, id: 'invalid' }), {
    active: false,
    id: '',
    title: '',
    kind: '',
  });
});

test('keeps focused Wallpaper Engine capture at the chosen rate and suspends hidden windows', () => {
  assert.deepEqual(wallpaperEnginePerformancePolicy({
    governorFps: 60,
    isVisible: true,
    isMinimized: false,
    isFocused: true,
  }), {
    suspended: false,
    fps: 60,
  });
  assert.deepEqual(wallpaperEnginePerformancePolicy({
    governorFps: 60,
    isVisible: true,
    isMinimized: false,
    isFocused: false,
  }), {
    suspended: false,
    fps: 24,
  });
  assert.deepEqual(wallpaperEnginePerformancePolicy({
    governorFps: 20,
    isVisible: true,
    isMinimized: false,
    isFocused: true,
  }), {
    suspended: false,
    fps: 20,
  });
  assert.deepEqual(wallpaperEnginePerformancePolicy({
    isVisible: true,
    isMinimized: false,
    isFocused: true,
  }), {
    suspended: false,
    fps: 60,
  });

  for (const state of [
    { hidden: true, isVisible: true },
    { isVisible: false },
    { isVisible: true, isMinimized: true },
    { isVisible: true, locked: true },
    { isVisible: true, systemSuspended: true },
  ]) {
    assert.deepEqual(wallpaperEnginePerformancePolicy(state), {
      suspended: true,
      fps: 0,
    });
  }
});
