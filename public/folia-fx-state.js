(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaFxState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_FOLIA_FX = {
    enabled: true,
    stageMode: 'overlay',
    idleBehavior: 'wait',
    lyricScale: 1,
    lyricWeight: 0.7,
    lineSpacing: 1,
    wordHighlight: 0.85,
    currentLineFocus: 0.75,
    translationMode: 'auto',
    romanizationMode: 'off',
    entryMotion: 0.6,
    visualMode: 'auto',
    nativeLyricEffect: 'hybrid',
    backgroundMode: 'theme',
    glow: 0.55,
    blur: 0.35,
    particleAmount: 0.65,
    beatMotion: 0.45,
    cameraMotion: 0.35,
    themeMode: 'mineradio-theme',
    accentColor: '',
    performanceMode: 'balanced',
    reduceMotion: false,
  };

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function oneOf(value, allowed, fallback) {
    value = String(value || '').trim();
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function color(value) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '';
  }

  function normalizeFoliaFx(input) {
    input = input || {};
    return {
      enabled: input.enabled !== false,
      stageMode: oneOf(input.stageMode, ['overlay', 'fullscreen'], DEFAULT_FOLIA_FX.stageMode),
      idleBehavior: oneOf(input.idleBehavior, ['wait', 'keep-last', 'blank'], DEFAULT_FOLIA_FX.idleBehavior),
      lyricScale: clamp(input.lyricScale, 0.65, 1.8, DEFAULT_FOLIA_FX.lyricScale),
      lyricWeight: clamp(input.lyricWeight, 0, 1, DEFAULT_FOLIA_FX.lyricWeight),
      lineSpacing: clamp(input.lineSpacing, 0.75, 1.6, DEFAULT_FOLIA_FX.lineSpacing),
      wordHighlight: clamp(input.wordHighlight, 0, 1, DEFAULT_FOLIA_FX.wordHighlight),
      currentLineFocus: clamp(input.currentLineFocus, 0, 1, DEFAULT_FOLIA_FX.currentLineFocus),
      translationMode: oneOf(input.translationMode, ['off', 'auto', 'always'], DEFAULT_FOLIA_FX.translationMode),
      romanizationMode: oneOf(input.romanizationMode, ['off', 'auto', 'always'], DEFAULT_FOLIA_FX.romanizationMode),
      entryMotion: clamp(input.entryMotion, 0, 1, DEFAULT_FOLIA_FX.entryMotion),
      visualMode: oneOf(input.visualMode, ['auto', 'cappella', 'partita', 'cover', 'minimal'], DEFAULT_FOLIA_FX.visualMode),
      nativeLyricEffect: oneOf(input.nativeLyricEffect, ['off', 'classic', 'monet-sweep', 'hybrid'], DEFAULT_FOLIA_FX.nativeLyricEffect),
      backgroundMode: oneOf(input.backgroundMode, ['theme', 'cover', 'transparent', 'dark'], DEFAULT_FOLIA_FX.backgroundMode),
      glow: clamp(input.glow, 0, 1, DEFAULT_FOLIA_FX.glow),
      blur: clamp(input.blur, 0, 1, DEFAULT_FOLIA_FX.blur),
      particleAmount: clamp(input.particleAmount, 0, 1, DEFAULT_FOLIA_FX.particleAmount),
      beatMotion: clamp(input.beatMotion, 0, 1, DEFAULT_FOLIA_FX.beatMotion),
      cameraMotion: clamp(input.cameraMotion, 0, 1, DEFAULT_FOLIA_FX.cameraMotion),
      themeMode: oneOf(input.themeMode, ['mineradio-theme', 'cover', 'manual'], DEFAULT_FOLIA_FX.themeMode),
      accentColor: color(input.accentColor),
      performanceMode: oneOf(input.performanceMode, ['quality', 'balanced', 'battery'], DEFAULT_FOLIA_FX.performanceMode),
      reduceMotion: input.reduceMotion === true,
    };
  }

  function patchFoliaFx(current, patch) {
    return normalizeFoliaFx(Object.assign({}, normalizeFoliaFx(current || {}), patch || {}));
  }

  function foliaFxToBridgePayload(input) {
    return normalizeFoliaFx(input || {});
  }

  return {
    DEFAULT_FOLIA_FX: DEFAULT_FOLIA_FX,
    normalizeFoliaFx: normalizeFoliaFx,
    patchFoliaFx: patchFoliaFx,
    foliaFxToBridgePayload: foliaFxToBridgePayload,
  };
});
