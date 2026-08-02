/**
 * Sonic Topography state model for Mineradio.
 * Independently rewritten from the behavior of XxHuberrr/Mineradio
 * public/sonic-topography-preset.js at 4abaa190de42c632365ae4244e041bad16443224
 * (GPL-3.0-only). That upstream file references yin-yizhen/sonic-topography
 * 1.1.1 at 3ff303e under its Non-Commercial Learning License. No shader or
 * player source from that nested project is copied here.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioSonicTopographyState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_SONIC_TOPOGRAPHY_CONFIG = Object.freeze({
    enabled: false,
    amplitude: 0.72,
    motion: 0.55,
    opacity: 0.7,
    historySize: 48,
    palette: 'theme',
  });

  var QUALITY_TIERS = Object.freeze({
    quality: Object.freeze({ name: 'quality', columns: 52, rows: 34, historyRows: 72 }),
    balanced: Object.freeze({ name: 'balanced', columns: 40, rows: 26, historyRows: 48 }),
    battery: Object.freeze({ name: 'battery', columns: 28, rows: 18, historyRows: 24 }),
    reduced: Object.freeze({ name: 'reduced', columns: 20, rows: 14, historyRows: 16 }),
  });

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

  function normalizeSonicTopographyConfig(input) {
    input = input && typeof input === 'object' ? input : {};
    return {
      enabled: input.enabled === true,
      amplitude: clamp(input.amplitude, 0.1, 1.5, DEFAULT_SONIC_TOPOGRAPHY_CONFIG.amplitude),
      motion: clamp(input.motion, 0, 1, DEFAULT_SONIC_TOPOGRAPHY_CONFIG.motion),
      opacity: clamp(input.opacity, 0.15, 1, DEFAULT_SONIC_TOPOGRAPHY_CONFIG.opacity),
      historySize: integer(input.historySize, 12, 96, DEFAULT_SONIC_TOPOGRAPHY_CONFIG.historySize),
      palette: input.palette === 'cover' ? 'cover' : 'theme',
    };
  }

  function resolveSonicQualityTier(quality, reducedMotion) {
    if (reducedMotion) return QUALITY_TIERS.reduced;
    quality = String(quality || '').toLowerCase();
    if (quality === 'quality' || quality === 'high' || quality === 'ultra') return QUALITY_TIERS.quality;
    if (quality === 'battery' || quality === 'eco' || quality === 'low') return QUALITY_TIERS.battery;
    return QUALITY_TIERS.balanced;
  }

  function seedNumber(value) {
    if (typeof value === 'number' && isFinite(value)) return (value >>> 0) || 1;
    var text = String(value == null ? 'mineradio-sonic' : value);
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function deterministicUnit(seed, index) {
    var value = (seed ^ Math.imul((index + 1) >>> 0, 2654435761)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 2246822507) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 3266489909) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function audioByte(array, index, fallback) {
    if (!array || !array.length) return fallback || 0;
    index = Math.max(0, Math.min(array.length - 1, Math.round(index)));
    return clamp(array[index] / 255, 0, 1, fallback || 0);
  }

  function timeDomainRms(array) {
    if (!array || !array.length) return 0;
    var stride = Math.max(1, Math.floor(array.length / 96));
    var sum = 0;
    var count = 0;
    for (var index = 0; index < array.length; index += stride) {
      var value = (finite(array[index], 128) - 128) / 128;
      sum += value * value;
      count += 1;
    }
    return count ? Math.min(1, Math.sqrt(sum / count) * 1.8) : 0;
  }

  function resampleRow(source, sourceColumns, targetColumns) {
    if (!source || !source.length || !targetColumns) return null;
    if (sourceColumns === targetColumns) return source.slice(0);
    var output = new Float32Array(targetColumns);
    for (var column = 0; column < targetColumns; column += 1) {
      var ratio = targetColumns <= 1 ? 0 : column / (targetColumns - 1);
      var sourcePosition = ratio * Math.max(0, sourceColumns - 1);
      var left = Math.floor(sourcePosition);
      var right = Math.min(sourceColumns - 1, left + 1);
      var mix = sourcePosition - left;
      output[column] = source[left] + (source[right] - source[left]) * mix;
    }
    return output;
  }

  function createSonicTopographyState(options) {
    options = options || {};
    var seed = seedNumber(options.seed);
    var config = normalizeSonicTopographyConfig(options.config);
    var tier = resolveSonicQualityTier(options.quality, false);
    var columns = tier.columns;
    var rows = tier.rows;
    var historyLimit = Math.min(config.historySize, tier.historyRows);
    var history = [];
    var currentRow = null;
    var terrain = new Float32Array(0);
    var energy = 0;
    var motionTime = 0;
    var released = false;
    var reducedMotion = false;
    var updates = 0;

    function rebuildProfile(nextTier) {
      if (nextTier.columns === columns && nextTier.rows === rows) {
        tier = nextTier;
        historyLimit = Math.min(config.historySize, tier.historyRows);
        if (history.length > historyLimit) history.length = historyLimit;
        return false;
      }
      var previousColumns = columns;
      var previousHistory = history;
      var previousCurrentRow = currentRow;
      tier = nextTier;
      columns = tier.columns;
      rows = tier.rows;
      historyLimit = Math.min(config.historySize, tier.historyRows);
      history = previousHistory.slice(0, historyLimit).map(function(row) {
        return resampleRow(row, previousColumns, columns);
      }).filter(Boolean);
      currentRow = resampleRow(previousCurrentRow, previousColumns, columns);
      terrain = new Float32Array(0);
      return true;
    }

    function configure(nextConfig) {
      config = normalizeSonicTopographyConfig(nextConfig);
      historyLimit = Math.min(config.historySize, tier.historyRows);
      if (history.length > historyLimit) history.length = historyLimit;
      return config;
    }

    function buildAudioRow(audio, dt, playing) {
      audio = audio || {};
      var frequency = audio.frequencyData;
      var rms = timeDomainRms(audio.timeDomainData);
      var explicitEnergy = clamp(audio.energy, 0, 1, 0);
      var bass = clamp(audio.bass, 0, 1, 0);
      var mid = clamp(audio.mid, 0, 1, 0);
      var treble = clamp(audio.treble, 0, 1, 0);
      var beat = clamp(audio.beatPulse != null ? audio.beatPulse : audio.beat, 0, 1, 0);
      var targetEnergy = playing
        ? clamp(explicitEnergy * 0.42 + rms * 0.24 + bass * 0.18 + beat * 0.16, 0, 1, 0)
        : 0;
      var response = playing
        ? 1 - Math.exp(-Math.max(0.001, dt) * (5 + config.motion * 18))
        : 1 - Math.exp(-Math.max(0.001, dt) * 2.8);
      energy += (targetEnergy - energy) * response;

      var next = new Float32Array(columns);
      for (var column = 0; column < columns; column += 1) {
        var ratio = columns <= 1 ? 0 : column / (columns - 1);
        var curved = Math.pow(ratio, 1.45);
        var frequencyValue = audioByte(frequency, curved * Math.max(0, (frequency && frequency.length || 1) - 1), 0);
        var bandBlend = ratio < 0.28
          ? bass
          : ratio < 0.7
            ? mid
            : treble;
        var staticShape = 0.78 + deterministicUnit(seed, column) * 0.44;
        var wave = Math.sin(column * 0.57 + motionTime * (0.8 + config.motion * 1.7)) * 0.08;
        var target = playing
          ? Math.max(0, frequencyValue * 0.62 + bandBlend * 0.18 + rms * 0.08 + beat * (1 - ratio) * 0.18 + wave)
            * staticShape * config.amplitude
          : (currentRow ? currentRow[column] : 0) * Math.exp(-Math.max(0.001, dt) * 2.4);
        var previous = currentRow ? currentRow[column] : 0;
        next[column] = previous + (target - previous) * response;
      }
      return next;
    }

    function decayHistory(dt) {
      var decay = Math.exp(-Math.max(0.001, dt) * 1.25);
      for (var row = 0; row < history.length; row += 1) {
        for (var column = 0; column < history[row].length; column += 1) {
          history[row][column] *= decay;
        }
      }
    }

    function update(frame) {
      if (released) return false;
      frame = frame || {};
      configure(frame.config || config);
      reducedMotion = frame.reducedMotion === true;
      rebuildProfile(resolveSonicQualityTier(frame.quality, reducedMotion));
      var dt = clamp(frame.dt, 0, 0.25, 1 / 60);
      var playing = frame.playing !== false;
      motionTime += dt * config.motion * (reducedMotion ? 0.06 : 1.15);
      currentRow = buildAudioRow(frame.audio, dt, playing);
      if (playing) {
        history.unshift(currentRow.slice(0));
        if (history.length > historyLimit) history.length = historyLimit;
      } else {
        decayHistory(dt);
      }
      terrain = new Float32Array(0);
      updates += 1;
      return true;
    }

    function sampleTerrain() {
      if (released || !history.length || !columns || !rows) return new Float32Array(0);
      if (terrain.length === columns * rows) return terrain;
      terrain = new Float32Array(columns * rows);
      for (var row = 0; row < rows; row += 1) {
        var depthRatio = rows <= 1 ? 0 : row / (rows - 1);
        var historyIndex = Math.min(history.length - 1, Math.round(depthRatio * (history.length - 1)));
        var source = history[historyIndex];
        var depthFade = 1 - depthRatio * 0.36;
        for (var column = 0; column < columns; column += 1) {
          var index = row * columns + column;
          var micro = (deterministicUnit(seed, index + 4096) - 0.5) * 0.045 * energy;
          terrain[index] = Math.max(0, source[column] * depthFade + micro);
        }
      }
      return terrain;
    }

    function release() {
      history = [];
      currentRow = null;
      terrain = new Float32Array(0);
      energy = 0;
      released = true;
      return true;
    }

    function restore() {
      if (!released) return false;
      released = false;
      return true;
    }

    function snapshot() {
      return {
        seed: seed,
        quality: tier.name,
        columns: columns,
        rows: rows,
        historyRows: history.length,
        historyLimit: historyLimit,
        energy: energy,
        motionTime: motionTime,
        reducedMotion: reducedMotion,
        released: released,
        updates: updates,
        cacheEntries: history.length,
        cacheBytes: history.length * columns * 4 + terrain.byteLength,
      };
    }

    return {
      configure: configure,
      update: update,
      sampleTerrain: sampleTerrain,
      release: release,
      restore: restore,
      snapshot: snapshot,
    };
  }

  return {
    DEFAULT_SONIC_TOPOGRAPHY_CONFIG: DEFAULT_SONIC_TOPOGRAPHY_CONFIG,
    QUALITY_TIERS: QUALITY_TIERS,
    normalizeSonicTopographyConfig: normalizeSonicTopographyConfig,
    resolveSonicQualityTier: resolveSonicQualityTier,
    createSonicTopographyState: createSonicTopographyState,
  };
});
