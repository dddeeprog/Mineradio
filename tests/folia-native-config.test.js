const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODES,
  STORAGE_KEY,
  DEFAULT_NATIVE_LYRIC_CONFIG,
  normalizeNativeLyricConfig,
  migrateLegacyNativeLyricConfig,
  patchNativeLyricConfig,
  toArchiveNativeLyricConfig,
} = require('../public/folia-native/config');

test('defines the eight stable native lyric modes and keeps Mineradio 3D as default', () => {
  assert.deepEqual(MODES, [
    'mineradio-3d', 'classic', 'cadenza', 'partita',
    'tilt', 'monet', 'cappella', 'fume',
  ]);
  assert.equal(STORAGE_KEY, 'mineradio-native-lyric-visualizer-v1');
  assert.equal(DEFAULT_NATIVE_LYRIC_CONFIG.mode, 'mineradio-3d');
});

test('normalizes common and mode-specific values without sharing default objects', () => {
  const first = normalizeNativeLyricConfig({
    mode: 'monet',
    common: { scale: 99, performanceMode: 'battery' },
    modes: { monet: { posterContrast: -2 } },
  });
  const second = normalizeNativeLyricConfig({});

  assert.equal(first.mode, 'monet');
  assert.equal(first.common.scale, 1.8);
  assert.equal(first.common.performanceMode, 'battery');
  assert.equal(first.modes.monet.posterContrast, 0);
  first.modes.monet.posterContrast = 0.3;
  assert.notEqual(second.modes.monet.posterContrast, 0.3);
});

test('Classic exposes Folia tuning and clamps every live visual control', () => {
  const defaults = normalizeNativeLyricConfig({}).modes.classic;
  assert.equal(defaults.intensity, 'normal');
  assert.equal(defaults.enableWordRotation, true);
  assert.equal(defaults.useLegacyLayout, false);
  assert.equal(defaults.wordSpacing, 0.7);
  assert.equal(defaults.breathing, 1);
  assert.equal(normalizeNativeLyricConfig({
    modes: { classic: { spread: 0.72, wordGlow: 0.82, breathing: 0.35, chorusRipple: true } },
  }).modes.classic.breathing, 1);

  const classic = normalizeNativeLyricConfig({
    modes: {
      classic: {
        intensity: 'chaotic',
        spread: 4,
        enableWordRotation: false,
        useLegacyLayout: true,
        wordSpacing: 9,
        wordGlow: -2,
        breathing: 8,
        chorusRipple: false,
      },
    },
  }).modes.classic;

  assert.deepEqual(classic, {
    intensity: 'chaotic',
    spread: 1,
    enableWordRotation: false,
    useLegacyLayout: true,
    wordSpacing: 2,
    wordGlow: 0,
    breathing: 2,
    chorusRipple: false,
  });
});

test('migrates legacy Folia modes and retires the removed orbit effect', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, { visualMode: 'cappella' }).mode, 'cappella');
  assert.equal(migrateLegacyNativeLyricConfig(null, { visualMode: 'partita' }).mode, 'partita');
  assert.equal(migrateLegacyNativeLyricConfig(null, { visualMode: 'cover' }).mode, 'monet');
  assert.equal(migrateLegacyNativeLyricConfig(null, { visualMode: 'auto' }).mode, 'mineradio-3d');
  assert.equal(migrateLegacyNativeLyricConfig(null, { visualMode: 'minimal' }).mode, 'mineradio-3d');
  assert.equal(
    migrateLegacyNativeLyricConfig(null, { nativeLyricEffect: 'claddagh-orbit' }).modes.mineradio3d.effect,
    'hybrid',
  );
  assert.equal(
    normalizeNativeLyricConfig({ modes: { mineradio3d: { effect: 'claddagh-orbit' } } }).modes.mineradio3d.effect,
    'hybrid',
  );
});

test('leaves version 1 native config migration unchanged', () => {
  const migrated = migrateLegacyNativeLyricConfig({
    version: 1,
    mode: 'classic',
    common: { scale: 1.2 },
  }, {
    visualMode: 'cappella',
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'monet',
  });

  assert.equal(migrated.mode, 'classic');
  assert.equal(migrated.common.scale, 1.2);
});

test('gives explicit legacy visualMode priority over inspired presets', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    visualMode: 'cappella',
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'monet',
  }).mode, 'cappella');
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    visualMode: 'unknown',
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'monet',
  }).mode, 'mineradio-3d');
});

test('migrates the archived classic inspired preset without a visualMode', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'classic',
  }).mode, 'classic');
});

test('migrates the archived partita inspired preset without a visualMode', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'partita',
  }).mode, 'partita');
});

test('migrates the archived monet inspired preset when visualMode is empty', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    visualMode: '',
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'monet',
  }).mode, 'monet');
});

test('migrates a supported inspired preset when its visual flag is absent', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredPreset: 'monet',
  }).mode, 'monet');
});

test('falls back to Mineradio 3D for disabled, invalid, or missing inspired presets', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: false,
    foliaInspiredPreset: 'monet',
  }).mode, 'mineradio-3d');
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'unknown',
  }).mode, 'mineradio-3d');
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
  }).mode, 'mineradio-3d');
});

test('patches config and exports asset ids without local paths or blob urls', () => {
  const patched = patchNativeLyricConfig({}, {
    mode: 'cappella',
    modes: {
      cappella: {
        avatarPackId: 'builtin-soft',
        avatarPath: 'C:\\private\\avatar.png',
        avatarUrl: 'blob:secret',
      },
    },
  });
  const archived = toArchiveNativeLyricConfig(patched);

  assert.equal(archived.mode, 'cappella');
  assert.equal(archived.modes.cappella.avatarPackId, 'builtin-soft');
  assert.equal('avatarPath' in archived.modes.cappella, false);
  assert.equal('avatarUrl' in archived.modes.cappella, false);
});

test('Cadenza and Fume preserve their Folia tuning surface within safe bounds', () => {
  const normalized = normalizeNativeLyricConfig({
    modes: {
      cadenza: { fontScale: 99, widthRatio: 0, motionAmount: -1, glowIntensity: 3 },
      fume: {
        hidePrintSymbols: true,
        geometricBackground: true,
        backgroundObjectOpacity: 4,
        textHoldRatio: -1,
        cameraSpeed: 9,
        glowIntensity: 3,
        heroScale: 0,
      },
    },
  });

  assert.deepEqual(normalized.modes.cadenza, {
    fontScale: 1.8,
    widthRatio: 0.42,
    motionAmount: 0,
    glowIntensity: 1.5,
    beam: 0.72,
    trails: 0.62,
    ripple: 0.58,
  });
  assert.equal(normalized.modes.fume.hidePrintSymbols, true);
  assert.equal(normalized.modes.fume.geometricBackground, true);
  assert.equal(normalized.modes.fume.backgroundObjectOpacity, 1);
  assert.equal(normalized.modes.fume.textHoldRatio, 0.2);
  assert.equal(normalized.modes.fume.cameraSpeed, 2.5);
  assert.equal(normalized.modes.fume.glowIntensity, 1.5);
  assert.equal(normalized.modes.fume.heroScale, 0.7);
});
