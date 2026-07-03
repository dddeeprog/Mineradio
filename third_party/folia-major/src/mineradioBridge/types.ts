import type { VisualizerBackgroundMode, VisualizerMode } from '../types';

export type MineradioFoliaFxVisualMode = 'auto' | 'cappella' | 'partita' | 'cover' | 'minimal';
export type MineradioFoliaFxPerformanceMode = 'quality' | 'balanced' | 'battery';
export type MineradioFoliaFxBackgroundMode = 'theme' | 'cover' | 'transparent' | 'dark';

export interface MineradioFoliaFx {
  enabled: boolean;
  stageMode: 'overlay' | 'fullscreen';
  idleBehavior: 'wait' | 'keep-last' | 'blank';
  lyricScale: number;
  lyricWeight: number;
  lineSpacing: number;
  wordHighlight: number;
  currentLineFocus: number;
  translationMode: 'off' | 'auto' | 'always';
  romanizationMode: 'off' | 'auto' | 'always';
  entryMotion: number;
  visualMode: MineradioFoliaFxVisualMode;
  backgroundMode: MineradioFoliaFxBackgroundMode;
  glow: number;
  blur: number;
  particleAmount: number;
  beatMotion: number;
  cameraMotion: number;
  themeMode: 'mineradio-theme' | 'cover' | 'manual';
  accentColor: string;
  performanceMode: MineradioFoliaFxPerformanceMode;
  reduceMotion: boolean;
}

export interface MineradioFoliaVisualizerModel {
  visualizerMode: VisualizerMode;
  effects: {
    glow: number;
    particles: number;
    beatMotion: number;
    blur: number;
    cameraMotion: number;
  };
  lyrics: {
    fontScale: number;
    wordHighlight: number;
    currentLineFocus: number;
    lineSpacing: number;
  };
  performance: {
    maxQuality: MineradioFoliaFxPerformanceMode;
    particleMultiplier: number;
    staticMode: boolean;
    reducedMotion: boolean;
  };
  app: {
    backgroundOpacity: number;
    visualizerOpacity: number;
    subtitleOverlayOpacity: number;
    disableGeometricBackground: boolean;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
  };
}

export interface MineradioBridgeSong {
  title: string;
  artist: string;
  artists: string[];
  album: string;
  provider: 'netease' | 'qq' | 'podcast' | 'local' | string;
  id: string;
  mid: string;
  coverUrl: string;
  duration: number;
}

export interface MineradioBridgePlayback {
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  queueIndex: number;
  queueLength: number;
}

export interface MineradioBridgeLyricWord {
  text: string;
  time: number;
  duration: number;
}

export interface MineradioBridgeLyricLine {
  index: number;
  time: number;
  duration: number;
  text: string;
  translation: string;
  fallback: boolean;
  words: MineradioBridgeLyricWord[];
}

export interface MineradioBridgeLyrics {
  timingSource: string;
  hasNativeKaraoke: boolean;
  lines: MineradioBridgeLyricLine[];
}

export interface MineradioBridgeAudio {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  beatPulse: number;
  beatOnset: boolean;
}

export interface MineradioBridgeTheme {
  source: string;
  generated: boolean;
  lyricFont: string;
  foliaStageTheme: unknown;
  particleTint: string;
}

export interface MineradioBridgeSnapshot {
  bridge: 'mineradio-folia';
  version: number;
  reason: string;
  generatedAt: number;
  song: MineradioBridgeSong;
  playback: MineradioBridgePlayback;
  lyrics: MineradioBridgeLyrics;
  audio: MineradioBridgeAudio;
  theme: MineradioBridgeTheme;
  foliaFx: Partial<MineradioFoliaFx>;
}
