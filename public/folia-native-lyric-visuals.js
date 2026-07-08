(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaNativeLyricVisuals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback == null ? min : fallback)));
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function resolveMonetSweep(opts) {
    opts = opts || {};
    var start = finite(opts.startTime, 0);
    var end = Math.max(start + 0.001, finite(opts.endTime, start + 1));
    var progress = clamp((finite(opts.now, start) - start) / (end - start), 0, 1);
    var width = Math.max(0, finite(opts.width, 1));
    var fillWidth = width * progress;
    var softness = clamp(opts.softnessPx, 0, Math.max(width, 0), 12);
    return {
      progress: progress,
      fillWidth: fillWidth,
      solidEnd: Math.max(fillWidth - softness, 0),
      featherStart: Math.max(fillWidth - softness * 0.55, 0),
      featherEnd: fillWidth,
    };
  }

  function resolveGlowEnvelope(opts) {
    opts = opts || {};
    var start = finite(opts.startTime, 0);
    var end = Math.max(start + 0.001, finite(opts.endTime, start + 1));
    var renderEnd = Math.max(end, finite(opts.renderEndTime, end + 0.8));
    var now = finite(opts.now, start);
    var intensity = clamp(opts.intensity, 0, 1);
    if (now < start || intensity <= 0) return 0;

    var riseEnd = start + (end - start) * 1.18;
    if (now <= riseEnd) {
      return smoothstep((now - start) / Math.max(0.001, riseEnd - start)) * intensity;
    }

    var tail = 1 - smoothstep((now - riseEnd) / Math.max(0.18, renderEnd - riseEnd));
    return clamp(tail * intensity, 0, 1);
  }

  function resolveCladdaghOrbit(opts) {
    opts = opts || {};
    var count = Math.max(1, Math.floor(finite(opts.count, 1)));
    var index = clamp(opts.index, 0, count - 1);
    var progress = clamp(opts.progress, 0, 1);
    var strength = clamp(opts.effectStrength, 0, 1);
    var audio = clamp(opts.audioPower, 0, 2);
    var rx = Math.max(0.1, finite(opts.radiusX, 2.8)) * (1 + audio * 0.12 * strength);
    var ry = Math.max(0.1, finite(opts.radiusY, 0.9)) * (1 + audio * 0.08 * strength);
    var theta = ((index / count) - progress) * Math.PI * 2;
    var cos = Math.cos(theta);
    var sin = Math.sin(theta);
    var depth = clamp((cos + 1) / 2, 0, 1);
    var focus = clamp(opts.focus, 0, 1);
    return {
      x: rx * sin * strength,
      y: ry * Math.sin(theta * 0.72) * strength,
      z: (depth - 0.5) * finite(opts.depth, 0.6) * strength,
      opacity: clamp((0.42 + depth * 0.42 + focus * 0.16) * (0.35 + strength * 0.65), 0, 1),
      scale: Math.max(0.2, 0.82 + depth * 0.38 + focus * 0.18 * strength),
      blur: Math.max(0, (1 - depth) * 5.5 * strength),
      rotateZ: Math.atan2(Math.cos(theta), Math.sin(theta)) * 10 * strength,
    };
  }

  function resolvePerformanceScale(fx) {
    fx = fx || {};
    if (fx.reduceMotion) return 0;
    if (fx.performanceMode === 'battery') return 0.45;
    if (fx.performanceMode === 'quality') return 1;
    return 0.75;
  }

  function resolveNativeLyricVisualFrame(opts) {
    opts = opts || {};
    var fx = opts.fx || {};
    var audio = opts.audio || {};
    var line = opts.line || {};
    var perf = resolvePerformanceScale(fx);
    var effect = String(opts.effect || 'off');
    var glowBase = resolveGlowEnvelope({
      startTime: line.startTime,
      endTime: line.endTime,
      renderEndTime: line.renderHints && line.renderHints.renderEndTime,
      now: opts.now,
      intensity: clamp(fx.glow, 0, 1),
    });
    var beat = clamp(audio.beatPulse || audio.beatOnset || 0, 0, 2);
    var cameraMotion = clamp(fx.cameraMotion == null ? 0.35 : fx.cameraMotion, 0, 1);
    var wordHighlight = clamp(fx.wordHighlight == null ? 0.85 : fx.wordHighlight, 0, 1);
    var beatMotion = clamp(fx.beatMotion == null ? 0.45 : fx.beatMotion, 0, 1);
    var particleAmount = clamp(fx.particleAmount == null ? 0.65 : fx.particleAmount, 0, 1);
    var hasSweep = effect === 'monet-sweep' || effect === 'hybrid' || effect === 'classic';
    var hasOrbit = effect === 'claddagh-orbit' || effect === 'hybrid';

    return {
      effect: effect,
      progress: clamp(opts.progress, 0, 1),
      sweepStrength: hasSweep ? perf * wordHighlight : 0,
      orbitStrength: hasOrbit ? perf * cameraMotion : 0,
      glow: glowBase * (0.72 + beat * beatMotion * 0.28) * (0.45 + perf * 0.55),
      particleStrength: perf * particleAmount,
    };
  }

  return {
    resolveMonetSweep: resolveMonetSweep,
    resolveGlowEnvelope: resolveGlowEnvelope,
    resolveCladdaghOrbit: resolveCladdaghOrbit,
    resolveNativeLyricVisualFrame: resolveNativeLyricVisualFrame,
  };
});
