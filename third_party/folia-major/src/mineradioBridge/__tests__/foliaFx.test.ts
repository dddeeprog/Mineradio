import { describe, expect, it } from 'vitest';
import { normalizeMineradioFoliaFx, mapMineradioFoliaFxToVisualizer } from '../foliaFx';

describe('Mineradio Folia FX mapping', () => {
  it('normalizes unsafe payloads', () => {
    const fx = normalizeMineradioFoliaFx({
      lyricScale: 9,
      particleAmount: -1,
      performanceMode: 'battery',
    });

    expect(fx.lyricScale).toBe(1.8);
    expect(fx.particleAmount).toBe(0);
    expect(fx.performanceMode).toBe('battery');
  });

  it('maps Mineradio settings to visualizer props', () => {
    const props = mapMineradioFoliaFxToVisualizer({
      visualMode: 'minimal',
      glow: 0.2,
      particleAmount: 0.4,
      beatMotion: 0.7,
      performanceMode: 'battery',
    });

    expect(props.visualizerMode).toBe('minimal');
    expect(props.effects.glow).toBeCloseTo(0.2);
    expect(props.effects.particles).toBeCloseTo(0.4);
    expect(props.effects.beatMotion).toBeCloseTo(0.7);
    expect(props.performance.maxQuality).toBe('battery');
  });
});
