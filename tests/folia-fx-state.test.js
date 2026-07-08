const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_FOLIA_FX,
  normalizeFoliaFx,
  patchFoliaFx,
  foliaFxToBridgePayload,
} = require('../public/folia-fx-state');

test('normalizes Folia FX defaults safely', () => {
  const fx = normalizeFoliaFx({});
  assert.equal(fx.enabled, true);
  assert.equal(fx.stageMode, 'overlay');
  assert.equal(fx.performanceMode, 'balanced');
  assert.equal(fx.visualMode, 'auto');
});

test('clamps Folia FX numeric ranges', () => {
  const fx = normalizeFoliaFx({
    lyricScale: 9,
    wordHighlight: -1,
    particleAmount: 3,
    beatMotion: Infinity,
  });
  assert.equal(fx.lyricScale, 1.8);
  assert.equal(fx.wordHighlight, 0);
  assert.equal(fx.particleAmount, 1);
  assert.equal(fx.beatMotion, DEFAULT_FOLIA_FX.beatMotion);
});

test('patches existing Folia FX without losing unknown-safe defaults', () => {
  const fx = patchFoliaFx({ lyricScale: 1.2 }, { glow: 0.9 });
  assert.equal(fx.lyricScale, 1.2);
  assert.equal(fx.glow, 0.9);
  assert.equal(fx.enabled, true);
});

test('builds bridge payload without private or invalid fields', () => {
  const payload = foliaFxToBridgePayload({
    accentColor: '#7dd3fc',
    performanceMode: 'battery',
    extra: 'drop-me',
  });
  assert.equal(payload.accentColor, '#7dd3fc');
  assert.equal(payload.performanceMode, 'battery');
  assert.equal(payload.extra, undefined);
});

test('normalizes native lyric effect mode for Mineradio 3D lyrics', () => {
  const fx = normalizeFoliaFx({ nativeLyricEffect: 'claddagh-orbit' });
  assert.equal(fx.nativeLyricEffect, 'claddagh-orbit');

  const fallback = normalizeFoliaFx({ nativeLyricEffect: 'unknown' });
  assert.equal(fallback.nativeLyricEffect, 'hybrid');
});
