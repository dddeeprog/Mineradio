(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var STORAGE_KEY = 'mineradio-native-lyric-visualizer-v1';
  var MODES = ['mineradio-3d', 'classic', 'cadenza', 'partita', 'tilt', 'monet', 'cappella', 'fume'];
  var PERFORMANCE_MODES = ['quality', 'balanced', 'battery'];

  var DEFAULT_NATIVE_LYRIC_CONFIG = {
    version: 2,
    enabled: true,
    mode: 'mineradio-3d',
    sonic: {
      enabled: false,
      amplitude: 0.72,
      motion: 0.55,
      opacity: 0.7,
      historySize: 48,
      palette: 'theme',
    },
    common: {
      scale: 1,
      opacity: 1,
      lineSpacing: 1,
      translationMode: 'auto',
      backgroundMode: 'theme',
      accentColor: '',
      glow: 0.55,
      beatMotion: 0.45,
      performanceMode: 'balanced',
      reduceMotion: false,
    },
    modes: {
      mineradio3d: {
        effect: 'hybrid',
        cameraMotion: 0.35,
        particleAmount: 0.65,
      },
      classic: {
        intensity: 'normal',
        spread: 0.72,
        enableWordRotation: true,
        useLegacyLayout: false,
        wordSpacing: 0.7,
        wordGlow: 0.82,
        breathing: 1,
        chorusRipple: true,
      },
      cadenza: {
        fontScale: 1.12,
        widthRatio: 0.72,
        motionAmount: 1,
        glowIntensity: 1,
        beam: 0.72,
        trails: 0.62,
        ripple: 0.58,
      },
      partita: {
        columns: 3,
        guideOpacity: 0.28,
        stagger: 0.55,
      },
      tilt: {
        emphasis: 0.72,
        pulse: 0.52,
        maxLines: 4,
      },
      monet: {
        posterContrast: 0.66,
        audioOverlay: 0.68,
        keywordColor: true,
      },
      cappella: {
        maxMessages: 20,
        avatarPackId: 'builtin-folia',
        emojiPackId: 'builtin-folia',
        revealSpeed: 1,
        timestamps: true,
      },
      fume: {
        columns: 3,
        cameraMode: 'smooth',
        hidePrintSymbols: false,
        geometricBackground: false,
        backgroundObjectOpacity: 0.5,
        textHoldRatio: 1,
        cameraSpeed: 1,
        glowIntensity: 1,
        heroScale: 1,
        cacheEntries: 24,
        cacheBytes: 33554432,
      },
    },
  };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function integer(value, min, max, fallback) {
    return Math.round(clamp(value, min, max, fallback));
  }

  function oneOf(value, values, fallback) {
    value = String(value == null ? '' : value);
    return values.indexOf(value) >= 0 ? value : fallback;
  }

  function color(value) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
  }

  function assetId(value, fallback) {
    value = String(value || '').trim();
    return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value) ? value : fallback;
  }

  function normalizeNativeLyricConfig(input) {
    input = input && typeof input === 'object' ? input : {};
    var sonic = input.sonic && typeof input.sonic === 'object' ? input.sonic : {};
    var common = input.common && typeof input.common === 'object' ? input.common : {};
    var modes = input.modes && typeof input.modes === 'object' ? input.modes : {};
    var mineradio3d = modes.mineradio3d || {};
    var classic = modes.classic || {};
    var cadenza = modes.cadenza || {};
    var partita = modes.partita || {};
    var tilt = modes.tilt || {};
    var monet = modes.monet || {};
    var cappella = modes.cappella || {};
    var fume = modes.fume || {};
    var legacyClassicSchema = classic.intensity == null
      && classic.enableWordRotation == null
      && classic.useLegacyLayout == null
      && classic.wordSpacing == null;
    var classicBreathing = legacyClassicSchema && classic.breathing != null
      ? finite(classic.breathing, 0.35) / 0.35
      : classic.breathing;

    return {
      version: 2,
      enabled: input.enabled !== false,
      mode: oneOf(input.mode, MODES, DEFAULT_NATIVE_LYRIC_CONFIG.mode),
      sonic: {
        enabled: sonic.enabled === true,
        amplitude: clamp(sonic.amplitude, 0.1, 1.5, DEFAULT_NATIVE_LYRIC_CONFIG.sonic.amplitude),
        motion: clamp(sonic.motion, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.sonic.motion),
        opacity: clamp(sonic.opacity, 0.15, 1, DEFAULT_NATIVE_LYRIC_CONFIG.sonic.opacity),
        historySize: integer(sonic.historySize, 12, 96, DEFAULT_NATIVE_LYRIC_CONFIG.sonic.historySize),
        palette: oneOf(sonic.palette, ['theme', 'cover'], DEFAULT_NATIVE_LYRIC_CONFIG.sonic.palette),
      },
      common: {
        scale: clamp(common.scale, 0.65, 1.8, DEFAULT_NATIVE_LYRIC_CONFIG.common.scale),
        opacity: clamp(common.opacity, 0.2, 1, DEFAULT_NATIVE_LYRIC_CONFIG.common.opacity),
        lineSpacing: clamp(common.lineSpacing, 0.75, 1.6, DEFAULT_NATIVE_LYRIC_CONFIG.common.lineSpacing),
        translationMode: oneOf(common.translationMode, ['off', 'auto', 'always'], DEFAULT_NATIVE_LYRIC_CONFIG.common.translationMode),
        backgroundMode: oneOf(common.backgroundMode, ['theme', 'cover', 'transparent', 'dark'], DEFAULT_NATIVE_LYRIC_CONFIG.common.backgroundMode),
        accentColor: color(common.accentColor),
        glow: clamp(common.glow, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.common.glow),
        beatMotion: clamp(common.beatMotion, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.common.beatMotion),
        performanceMode: oneOf(common.performanceMode, PERFORMANCE_MODES, DEFAULT_NATIVE_LYRIC_CONFIG.common.performanceMode),
        reduceMotion: common.reduceMotion === true,
      },
      modes: {
        mineradio3d: {
          effect: oneOf(mineradio3d.effect, ['off', 'classic', 'monet-sweep', 'hybrid'], DEFAULT_NATIVE_LYRIC_CONFIG.modes.mineradio3d.effect),
          cameraMotion: clamp(mineradio3d.cameraMotion, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.mineradio3d.cameraMotion),
          particleAmount: clamp(mineradio3d.particleAmount, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.mineradio3d.particleAmount),
        },
        classic: {
          intensity: oneOf(classic.intensity, ['calm', 'normal', 'chaotic'], DEFAULT_NATIVE_LYRIC_CONFIG.modes.classic.intensity),
          spread: clamp(classic.spread, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.classic.spread),
          enableWordRotation: classic.enableWordRotation !== false,
          useLegacyLayout: classic.useLegacyLayout === true,
          wordSpacing: clamp(classic.wordSpacing, 0, 2, DEFAULT_NATIVE_LYRIC_CONFIG.modes.classic.wordSpacing),
          wordGlow: clamp(classic.wordGlow, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.classic.wordGlow),
          breathing: clamp(classicBreathing, 0, 2, DEFAULT_NATIVE_LYRIC_CONFIG.modes.classic.breathing),
          chorusRipple: classic.chorusRipple !== false,
        },
        cadenza: {
          fontScale: clamp(cadenza.fontScale, 0.65, 1.8, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.fontScale),
          widthRatio: clamp(cadenza.widthRatio, 0.42, 0.92, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.widthRatio),
          motionAmount: clamp(cadenza.motionAmount, 0, 1.6, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.motionAmount),
          glowIntensity: clamp(cadenza.glowIntensity, 0, 1.5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.glowIntensity),
          beam: clamp(cadenza.beam, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.beam),
          trails: clamp(cadenza.trails, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.trails),
          ripple: clamp(cadenza.ripple, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cadenza.ripple),
        },
        partita: {
          columns: integer(partita.columns, 2, 5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.partita.columns),
          guideOpacity: clamp(partita.guideOpacity, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.partita.guideOpacity),
          stagger: clamp(partita.stagger, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.partita.stagger),
        },
        tilt: {
          emphasis: clamp(tilt.emphasis, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.tilt.emphasis),
          pulse: clamp(tilt.pulse, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.tilt.pulse),
          maxLines: integer(tilt.maxLines, 1, 4, DEFAULT_NATIVE_LYRIC_CONFIG.modes.tilt.maxLines),
        },
        monet: {
          posterContrast: clamp(monet.posterContrast, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.monet.posterContrast),
          audioOverlay: clamp(monet.audioOverlay, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.monet.audioOverlay),
          keywordColor: monet.keywordColor !== false,
        },
        cappella: {
          maxMessages: integer(cappella.maxMessages, 4, 20, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cappella.maxMessages),
          avatarPackId: assetId(cappella.avatarPackId, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cappella.avatarPackId),
          emojiPackId: assetId(cappella.emojiPackId, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cappella.emojiPackId),
          revealSpeed: clamp(cappella.revealSpeed, 0.5, 2, DEFAULT_NATIVE_LYRIC_CONFIG.modes.cappella.revealSpeed),
          timestamps: cappella.timestamps !== false,
        },
        fume: {
          columns: integer(fume.columns, 2, 5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.columns),
          cameraMode: oneOf(fume.cameraMode, ['smooth', 'step'], DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.cameraMode),
          hidePrintSymbols: fume.hidePrintSymbols === true,
          geometricBackground: fume.geometricBackground === true,
          backgroundObjectOpacity: clamp(fume.backgroundObjectOpacity, 0, 1, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.backgroundObjectOpacity),
          textHoldRatio: clamp(fume.textHoldRatio, 0.2, 1.8, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.textHoldRatio),
          cameraSpeed: clamp(fume.cameraSpeed, 0.35, 2.5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.cameraSpeed),
          glowIntensity: clamp(fume.glowIntensity, 0, 1.5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.glowIntensity),
          heroScale: clamp(fume.heroScale, 0.7, 1.5, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.heroScale),
          cacheEntries: integer(fume.cacheEntries, 8, 48, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.cacheEntries),
          cacheBytes: integer(fume.cacheBytes, 8388608, 67108864, DEFAULT_NATIVE_LYRIC_CONFIG.modes.fume.cacheBytes),
        },
      },
    };
  }

  function mergeModePatches(baseModes, patchModes) {
    var merged = {};
    Object.keys(baseModes).forEach(function(key) {
      merged[key] = Object.assign({}, baseModes[key], patchModes && patchModes[key] || {});
    });
    return merged;
  }

  function patchNativeLyricConfig(current, patch) {
    var base = normalizeNativeLyricConfig(current);
    patch = patch && typeof patch === 'object' ? patch : {};
    return normalizeNativeLyricConfig(Object.assign({}, base, patch, {
      sonic: Object.assign({}, base.sonic, patch.sonic || {}),
      common: Object.assign({}, base.common, patch.common || {}),
      modes: mergeModePatches(base.modes, patch.modes || {}),
    }));
  }

  function legacySonicConfig(input, legacyFoliaFx) {
    input = input && typeof input === 'object' ? input : {};
    legacyFoliaFx = legacyFoliaFx && typeof legacyFoliaFx === 'object' ? legacyFoliaFx : {};
    if (input.sonic && typeof input.sonic === 'object') return input.sonic;
    var source = Object.assign({}, legacyFoliaFx, input);
    var hasLegacy = source.sonicGroundEnabled != null
      || source.sonicGroundAmplitude != null
      || source.sonicGroundMotionSpeed != null
      || source.sonicGroundOpacity != null
      || source.sonicGroundHistorySize != null;
    if (!hasLegacy) return DEFAULT_NATIVE_LYRIC_CONFIG.sonic;
    return {
      enabled: source.sonicGroundEnabled === true,
      amplitude: source.sonicGroundAmplitude == null
        ? DEFAULT_NATIVE_LYRIC_CONFIG.sonic.amplitude
        : Math.round(finite(source.sonicGroundAmplitude, 48) * 15) / 1000,
      motion: source.sonicGroundMotionSpeed == null
        ? DEFAULT_NATIVE_LYRIC_CONFIG.sonic.motion
        : finite(source.sonicGroundMotionSpeed, 55) / 100,
      opacity: source.sonicGroundOpacity == null
        ? DEFAULT_NATIVE_LYRIC_CONFIG.sonic.opacity
        : finite(source.sonicGroundOpacity, 70) / 100,
      historySize: source.sonicGroundHistorySize,
      palette: source.sonicGroundPalette === 'cover' ? 'cover' : 'theme',
    };
  }

  function migrateLegacyNativeLyricConfig(input, legacyFoliaFx) {
    if (input && typeof input === 'object' && Number(input.version) >= 1) {
      return normalizeNativeLyricConfig(Object.assign({}, input, {
        sonic: legacySonicConfig(input, legacyFoliaFx),
      }));
    }
    legacyFoliaFx = legacyFoliaFx && typeof legacyFoliaFx === 'object' ? legacyFoliaFx : {};
    var modeMap = {
      cappella: 'cappella',
      partita: 'partita',
      cover: 'monet',
      auto: 'mineradio-3d',
      minimal: 'mineradio-3d',
    };
    var visualMode = legacyFoliaFx.visualMode;
    var inspiredPreset = legacyFoliaFx.foliaInspiredPreset;
    var hasExplicitVisualMode = visualMode != null && visualMode !== '';
    var hasSupportedInspiredPreset = inspiredPreset === 'classic'
      || inspiredPreset === 'partita'
      || inspiredPreset === 'monet';
    var mode = hasExplicitVisualMode
      ? modeMap[visualMode] || DEFAULT_NATIVE_LYRIC_CONFIG.mode
      : legacyFoliaFx.foliaInspiredVisual !== false && hasSupportedInspiredPreset
        ? oneOf(inspiredPreset, MODES, DEFAULT_NATIVE_LYRIC_CONFIG.mode)
        : DEFAULT_NATIVE_LYRIC_CONFIG.mode;
    return normalizeNativeLyricConfig({
      mode: mode,
      enabled: legacyFoliaFx.enabled !== false,
      sonic: legacySonicConfig(null, legacyFoliaFx),
      common: {
        scale: legacyFoliaFx.lyricScale,
        lineSpacing: legacyFoliaFx.lineSpacing,
        translationMode: legacyFoliaFx.translationMode,
        backgroundMode: legacyFoliaFx.backgroundMode,
        accentColor: legacyFoliaFx.accentColor,
        glow: legacyFoliaFx.glow,
        beatMotion: legacyFoliaFx.beatMotion,
        performanceMode: legacyFoliaFx.performanceMode,
        reduceMotion: legacyFoliaFx.reduceMotion,
      },
      modes: {
        mineradio3d: {
          effect: legacyFoliaFx.nativeLyricEffect,
          cameraMotion: legacyFoliaFx.cameraMotion,
          particleAmount: legacyFoliaFx.particleAmount,
        },
      },
    });
  }

  function toArchiveNativeLyricConfig(input) {
    var normalized = normalizeNativeLyricConfig(input);
    return JSON.parse(JSON.stringify(normalized));
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    MODES: MODES.slice(),
    DEFAULT_NATIVE_LYRIC_CONFIG: normalizeNativeLyricConfig(DEFAULT_NATIVE_LYRIC_CONFIG),
    normalizeNativeLyricConfig: normalizeNativeLyricConfig,
    migrateLegacyNativeLyricConfig: migrateLegacyNativeLyricConfig,
    patchNativeLyricConfig: patchNativeLyricConfig,
    toArchiveNativeLyricConfig: toArchiveNativeLyricConfig,
  };
});
