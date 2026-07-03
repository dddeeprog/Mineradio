(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaBridgeState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
  var FOLIA_BRIDGE_VERSION = 1;
  var FOLIA_BRIDGE_MESSAGE_TYPE = 'mineradio:folia-playback-state';
  var MAX_STRING_LENGTH = 360;
  var MAX_LYRIC_LINES = 1200;
  var MAX_WORDS_PER_LINE = 160;
  var nodeThemeApi = null;
  var nodeFoliaFxApi = null;
  if (typeof module === 'object' && module.exports && typeof require === 'function') {
    try { nodeThemeApi = require('./folia-theme-state'); } catch (_err) {}
    try { nodeFoliaFxApi = require('./folia-fx-state'); } catch (_err) {}
  }

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback || 0);
  }

  function clamp(value, min, max) {
    var n = finiteNumber(value, min);
    return Math.max(min, Math.min(max, n));
  }

  function round3(value) {
    return Math.round(finiteNumber(value, 0) * 1000) / 1000;
  }

  function text(value, fallback) {
    var out = String(value == null ? (fallback || '') : value).replace(/\s+/g, ' ').trim();
    return out.length > MAX_STRING_LENGTH ? out.slice(0, MAX_STRING_LENGTH) : out;
  }

  function normalizeProvider(song) {
    song = song || {};
    if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq';
    if (song.type === 'podcast' || song.source === 'podcast') return 'podcast';
    if (song.type === 'local' || song.source === 'local' || song.localUrl) return 'local';
    return 'netease';
  }

  function pushArtist(parts, value) {
    if (!value) return;
    if (typeof value === 'string') {
      value.split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function(part) {
        var name = text(part);
        if (name && parts.indexOf(name) < 0) parts.push(name);
      });
      return;
    }
    if (value && typeof value === 'object') {
      pushArtist(parts, value.name || value.title || value.artist);
    }
  }

  function normalizeArtists(song) {
    song = song || {};
    var parts = [];
    if (Array.isArray(song.artists)) song.artists.forEach(function(item) { pushArtist(parts, item); });
    if (Array.isArray(song.ar)) song.ar.forEach(function(item) { pushArtist(parts, item); });
    pushArtist(parts, song.artist || song.author || song.singer);
    return parts.slice(0, 12);
  }

  function normalizeSongMeta(song) {
    song = song || {};
    var artists = normalizeArtists(song);
    var provider = normalizeProvider(song);
    return {
      title: text(song.name || song.title || song.programName || 'Mineradio'),
      artist: text(artists.join(' / ')),
      artists: artists,
      album: text(song.album || song.al || song.albumName || ''),
      provider: provider,
      id: song.id == null ? '' : text(song.id),
      mid: text(song.mid || song.songmid || song.mediaMid || song.media_mid || ''),
      coverUrl: text(song.coverUrl || song.cover || song.picUrl || song.albumPic || ''),
      duration: round3(normalizeDurationSeconds(song.duration || song.durationMs || song.dt || 0)),
    };
  }

  function normalizeDurationSeconds(value) {
    var raw = finiteNumber(value, 0);
    if (raw <= 0) return 0;
    return raw > 1000 ? raw / 1000 : raw;
  }

  function normalizeLyricWord(word) {
    if (!word || typeof word !== 'object') return null;
    var w = {
      text: text(word.text || word.word || ''),
      time: round3(word.t || word.time || word.start || 0),
      duration: round3(word.duration || word.d || 0),
    };
    return w.text ? w : null;
  }

  function normalizeLyricLine(line, index) {
    line = line || {};
    var words = Array.isArray(line.words)
      ? line.words.slice(0, MAX_WORDS_PER_LINE).map(normalizeLyricWord).filter(Boolean)
      : [];
    return {
      index: index,
      time: round3(line.t || line.time || line.start || 0),
      duration: round3(line.duration || line.d || 0),
      text: text(line.text || line.content || ''),
      translation: text(line.translation || line.translated || line.tl || ''),
      fallback: line.fallback === true,
      words: words,
    };
  }

  function normalizeLyricsPayload(input) {
    input = input || {};
    var lines = Array.isArray(input.lines) ? input.lines : [];
    return {
      timingSource: text(input.timingSource || 'none', 'none'),
      hasNativeKaraoke: input.hasNativeKaraoke === true,
      lines: lines.slice(0, MAX_LYRIC_LINES).map(normalizeLyricLine).filter(function(line) {
        return line.text || line.words.length;
      }),
    };
  }

  function normalizePlaybackPayload(input) {
    input = input || {};
    return {
      playing: input.playing === true,
      currentTime: round3(Math.max(0, finiteNumber(input.currentTime, input.time || 0))),
      duration: round3(Math.max(0, normalizeDurationSeconds(input.duration || 0))),
      rate: round3(clamp(input.rate || 1, 0.25, 4)),
      queueIndex: Math.max(-1, Math.floor(finiteNumber(input.queueIndex, -1))),
      queueLength: Math.max(0, Math.floor(finiteNumber(input.queueLength, 0))),
    };
  }

  function normalizeAudioPayload(input) {
    input = input || {};
    return {
      energy: round3(clamp(input.energy, 0, 2)),
      bass: round3(clamp(input.bass, 0, 2)),
      mid: round3(clamp(input.mid, 0, 2)),
      treble: round3(clamp(input.treble, 0, 2)),
      beatPulse: round3(clamp(input.beatPulse, 0, 2)),
      beatOnset: input.beatOnset === true,
    };
  }

  function themeApi() {
    return nodeThemeApi || (root && root.MineradioFoliaThemeState) || null;
  }

  function normalizeThemePayload(input) {
    var api = themeApi();
    if (api && typeof api.sanitizeFoliaThemeResult === 'function') {
      return api.sanitizeFoliaThemeResult(input || {});
    }
    input = input || {};
    return {
      source: text(input.source || 'none', 'none'),
      generated: input.generated === true,
      lyricFont: text(input.lyricFont || 'sans', 'sans'),
      foliaStageTheme: input.foliaStageTheme || input.theme || null,
      particleTint: text(input.particleTint || ''),
    };
  }

  function foliaFxApi() {
    return nodeFoliaFxApi || (root && root.MineradioFoliaFxState) || null;
  }

  function normalizeFoliaFxPayload(input) {
    var api = foliaFxApi();
    if (api && typeof api.foliaFxToBridgePayload === 'function') {
      return api.foliaFxToBridgePayload(input || {});
    }
    return input || {};
  }

  function createFoliaBridgeSnapshot(state) {
    state = state || {};
    var playback = normalizePlaybackPayload(state.playback || state);
    var song = normalizeSongMeta(state.song || {});
    if (!song.duration && playback.duration) song.duration = playback.duration;
    return {
      bridge: 'mineradio-folia',
      version: FOLIA_BRIDGE_VERSION,
      reason: text(state.reason || 'sync', 'sync'),
      generatedAt: Math.max(0, Math.floor(finiteNumber(state.now, Date.now()))),
      song: song,
      playback: playback,
      lyrics: normalizeLyricsPayload(state.lyrics || {}),
      audio: normalizeAudioPayload(state.audio || {}),
      theme: normalizeThemePayload(state.theme || {}),
      foliaFx: normalizeFoliaFxPayload(state.foliaFx || {}),
    };
  }

  function createFoliaBridgeMessage(snapshot) {
    return {
      type: FOLIA_BRIDGE_MESSAGE_TYPE,
      version: FOLIA_BRIDGE_VERSION,
      payload: snapshot || createFoliaBridgeSnapshot({}),
    };
  }

  function foliaBridgeSnapshotKey(snapshot) {
    snapshot = snapshot || {};
    var song = snapshot.song || {};
    var playback = snapshot.playback || {};
    var lyrics = snapshot.lyrics || {};
    var audio = snapshot.audio || {};
    var theme = snapshot.theme || {};
    var foliaFx = snapshot.foliaFx || {};
    var darkTheme = theme.foliaStageTheme && theme.foliaStageTheme.dark || {};
    return [
      song.provider || '',
      song.id || song.mid || song.title || '',
      Math.round((playback.currentTime || 0) * 4),
      Math.round((playback.duration || 0) * 2),
      playback.playing ? 1 : 0,
      lyrics.timingSource || '',
      (lyrics.lines || []).length,
      Math.round((audio.energy || 0) * 20),
      Math.round((audio.beatPulse || 0) * 20),
      audio.beatOnset ? 1 : 0,
      theme.source || '',
      darkTheme.accentColor || theme.particleTint || '',
      foliaFx.enabled === false ? 0 : 1,
      foliaFx.visualMode || '',
      foliaFx.performanceMode || '',
      foliaFx.lyricScale || '',
      foliaFx.glow || '',
      foliaFx.particleAmount || '',
      foliaFx.beatMotion || '',
    ].join('|');
  }

  return {
    FOLIA_BRIDGE_MESSAGE_TYPE: FOLIA_BRIDGE_MESSAGE_TYPE,
    FOLIA_BRIDGE_VERSION: FOLIA_BRIDGE_VERSION,
    createFoliaBridgeMessage: createFoliaBridgeMessage,
    createFoliaBridgeSnapshot: createFoliaBridgeSnapshot,
    foliaBridgeSnapshotKey: foliaBridgeSnapshotKey,
    normalizeArtists: normalizeArtists,
    normalizeAudioPayload: normalizeAudioPayload,
    normalizeLyricsPayload: normalizeLyricsPayload,
    normalizePlaybackPayload: normalizePlaybackPayload,
    normalizeProvider: normalizeProvider,
    normalizeSongMeta: normalizeSongMeta,
    normalizeThemePayload: normalizeThemePayload,
    normalizeFoliaFxPayload: normalizeFoliaFxPayload,
  };
});
