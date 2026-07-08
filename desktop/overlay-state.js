function roundedStateValue(value, scale = 1000) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * scale) : 0;
}

function normalizeDesktopLyricsOpacity(value) {
  if (value == null || value === '') return 0.92;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.92;
  return Math.max(0.28, Math.min(1, n));
}

function desktopLyricsStateSignature(state) {
  const payload = state || {};
  const motion = payload.motion || {};
  const playback = payload.playback || {};
  const colors = payload.colors || {};
  return [
    payload.enabled ? 1 : 0,
    payload.text || '',
    roundedStateValue(payload.progress, 1000),
    roundedStateValue(payload.progressSpan, 100),
    payload.title || '',
    payload.artist || '',
    payload.playing ? 1 : 0,
    roundedStateValue(payload.size, 100),
    roundedStateValue(payload.opacity, 100),
    roundedStateValue(payload.y, 1000),
    payload.clickThrough === false ? 0 : 1,
    payload.lyricGlowParticles ? 1 : 0,
    payload.cinema === false ? 0 : 1,
    payload.highlightFollow ? 1 : 0,
    payload.frameRate || 0,
    payload.fontFamily || '',
    payload.fontWeight || '',
    roundedStateValue(payload.letterSpacing, 1000),
    roundedStateValue(payload.lineHeight, 100),
    payload.rows || '',
    payload.align || '',
    roundedStateValue(payload.lyricScale, 100),
    roundedStateValue(payload.feather, 1000),
    payload.beatMapKey || '',
    Object.prototype.hasOwnProperty.call(payload, 'beatMap') ? 'map' : 'nomap',
    colors.primary || '',
    colors.secondary || '',
    colors.highlight || '',
    colors.glow || '',
    motion.lyricGlow ? 1 : 0,
    motion.lyricGlowBeat ? 1 : 0,
    roundedStateValue(motion.lyricGlowStrength, 100),
    roundedStateValue(motion.highBloom, 100),
    roundedStateValue(motion.beatGlow, 100),
    roundedStateValue(motion.beatPulse, 100),
    roundedStateValue(motion.bass, 100),
    roundedStateValue(playback.time, 4),
    roundedStateValue(playback.duration, 10),
    roundedStateValue(playback.rate, 100),
  ].join('|');
}

module.exports = {
  desktopLyricsStateSignature,
  normalizeDesktopLyricsOpacity,
  roundedStateValue,
};
