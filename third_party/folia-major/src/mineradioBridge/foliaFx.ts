import type {
  MineradioFoliaFx,
  MineradioFoliaFxBackgroundMode,
  MineradioFoliaFxPerformanceMode,
  MineradioFoliaFxVisualMode,
  MineradioFoliaVisualizerModel,
} from './types';

export const DEFAULT_MINERADIO_FOLIA_FX: MineradioFoliaFx = {
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

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const text = String(value ?? '').trim() as T;
  return allowed.includes(text) ? text : fallback;
};

const color = (value: unknown) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : '';
};

export function normalizeMineradioFoliaFx(input: Partial<MineradioFoliaFx> | unknown): MineradioFoliaFx {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<MineradioFoliaFx>;
  return {
    enabled: raw.enabled !== false,
    stageMode: oneOf(raw.stageMode, ['overlay', 'fullscreen'] as const, DEFAULT_MINERADIO_FOLIA_FX.stageMode),
    idleBehavior: oneOf(raw.idleBehavior, ['wait', 'keep-last', 'blank'] as const, DEFAULT_MINERADIO_FOLIA_FX.idleBehavior),
    lyricScale: clamp(raw.lyricScale, 0.65, 1.8, DEFAULT_MINERADIO_FOLIA_FX.lyricScale),
    lyricWeight: clamp(raw.lyricWeight, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.lyricWeight),
    lineSpacing: clamp(raw.lineSpacing, 0.75, 1.6, DEFAULT_MINERADIO_FOLIA_FX.lineSpacing),
    wordHighlight: clamp(raw.wordHighlight, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.wordHighlight),
    currentLineFocus: clamp(raw.currentLineFocus, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.currentLineFocus),
    translationMode: oneOf(raw.translationMode, ['off', 'auto', 'always'] as const, DEFAULT_MINERADIO_FOLIA_FX.translationMode),
    romanizationMode: oneOf(raw.romanizationMode, ['off', 'auto', 'always'] as const, DEFAULT_MINERADIO_FOLIA_FX.romanizationMode),
    entryMotion: clamp(raw.entryMotion, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.entryMotion),
    visualMode: oneOf<MineradioFoliaFxVisualMode>(raw.visualMode, ['auto', 'cappella', 'partita', 'cover', 'minimal'] as const, DEFAULT_MINERADIO_FOLIA_FX.visualMode),
    backgroundMode: oneOf<MineradioFoliaFxBackgroundMode>(raw.backgroundMode, ['theme', 'cover', 'transparent', 'dark'] as const, DEFAULT_MINERADIO_FOLIA_FX.backgroundMode),
    glow: clamp(raw.glow, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.glow),
    blur: clamp(raw.blur, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.blur),
    particleAmount: clamp(raw.particleAmount, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.particleAmount),
    beatMotion: clamp(raw.beatMotion, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.beatMotion),
    cameraMotion: clamp(raw.cameraMotion, 0, 1, DEFAULT_MINERADIO_FOLIA_FX.cameraMotion),
    themeMode: oneOf(raw.themeMode, ['mineradio-theme', 'cover', 'manual'] as const, DEFAULT_MINERADIO_FOLIA_FX.themeMode),
    accentColor: color(raw.accentColor),
    performanceMode: oneOf<MineradioFoliaFxPerformanceMode>(raw.performanceMode, ['quality', 'balanced', 'battery'] as const, DEFAULT_MINERADIO_FOLIA_FX.performanceMode),
    reduceMotion: raw.reduceMotion === true,
  };
}

const visualModeForFolia = (mode: MineradioFoliaFxVisualMode) => {
  if (mode === 'cover') return 'monet';
  return mode;
};

const backgroundModeForFolia = (mode: MineradioFoliaFxBackgroundMode) => {
  if (mode === 'cover') return 'monet';
  if (mode === 'transparent') return 'common';
  return null;
};

export function mapMineradioFoliaFxToVisualizer(input: Partial<MineradioFoliaFx> | unknown): MineradioFoliaVisualizerModel {
  const fx = normalizeMineradioFoliaFx(input);
  const batteryMode = fx.performanceMode === 'battery';
  const qualityMode = fx.performanceMode === 'quality';
  const reducedMotion = fx.reduceMotion || batteryMode;
  const particleMultiplier = batteryMode
    ? Math.min(fx.particleAmount, 0.35)
    : qualityMode
      ? Math.max(fx.particleAmount, 0.75)
      : fx.particleAmount;

  return {
    visualizerMode: visualModeForFolia(fx.visualMode),
    effects: {
      glow: fx.glow,
      particles: fx.particleAmount,
      beatMotion: fx.beatMotion,
      blur: fx.blur,
      cameraMotion: fx.cameraMotion,
    },
    lyrics: {
      fontScale: fx.lyricScale,
      wordHighlight: fx.wordHighlight,
      currentLineFocus: fx.currentLineFocus,
      lineSpacing: fx.lineSpacing,
    },
    performance: {
      maxQuality: fx.performanceMode,
      particleMultiplier,
      staticMode: reducedMotion,
      reducedMotion,
    },
    app: {
      backgroundOpacity: fx.backgroundMode === 'transparent' ? 0 : Math.max(0.25, 0.55 + fx.blur * 0.35),
      visualizerOpacity: Math.max(0.25, Math.min(1, 0.45 + particleMultiplier * 0.55)),
      subtitleOverlayOpacity: Math.max(0.2, Math.min(1, 0.3 + fx.glow * 0.45)),
      disableGeometricBackground: fx.visualMode === 'minimal' || particleMultiplier <= 0.08,
      visualizerBackgroundMode: backgroundModeForFolia(fx.backgroundMode),
    },
  };
}
