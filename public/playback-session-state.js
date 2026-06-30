(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlaybackSessionState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  var PLAYBACK_SESSION_SCHEMA = 1;
  var MAX_QUEUE_ITEMS = 300;
  var MAX_STRING_LENGTH = 2400;

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback || 0);
  }

  function isTemporaryUrl(value) {
    return typeof value === 'string' && (/^(blob:|data:)/i.test(value));
  }

  function isPlainSerializable(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length <= 80;
    return typeof value !== 'object' || Object.getPrototypeOf(value) === Object.prototype;
  }

  function sanitizeValue(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
      if (isTemporaryUrl(value)) return undefined;
      return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    }
    if (typeof value === 'number') return isFinite(value) ? value : undefined;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value.slice(0, 80).map(sanitizeValue).filter(function(item){ return item !== undefined; });
    }
    if (!isPlainSerializable(value)) return undefined;
    var out = {};
    Object.keys(value).forEach(function(key) {
      if (key.charAt(0) === '_') return;
      var v = sanitizeValue(value[key]);
      if (v !== undefined) out[key] = v;
    });
    return out;
  }

  function isRestorablePlaybackSong(song) {
    if (!song || typeof song !== 'object') return false;
    if (song.type === 'local' || song.source === 'local' || song.localUrl || song.file || song.blob) return false;
    if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') {
      return !!(song.mid || song.songmid || song.id || song.name || song.title);
    }
    if (song.type === 'podcast') return !!(song.programId || song.id || song.name || song.title);
    return song.id != null || !!(song.name || song.title);
  }

  function sanitizePlaybackSong(song) {
    if (!song || typeof song !== 'object') return null;
    var out = {};
    Object.keys(song).forEach(function(key) {
      if (key.charAt(0) === '_') return;
      if (/^(localUrl|file|blob|customCover)$/i.test(key)) return;
      var value = sanitizeValue(song[key]);
      if (value !== undefined) out[key] = value;
    });
    return Object.keys(out).length ? out : null;
  }

  function normalizeResumeSeconds(value, duration) {
    var seconds = finiteNumber(value, 0);
    if (seconds < 0.35) return 0;
    var durationSec = finiteNumber(duration, 0);
    if (durationSec > 0) seconds = Math.min(seconds, Math.max(0, durationSec - 0.75));
    return Math.max(0, Math.round(seconds * 1000) / 1000);
  }

  function createPlaybackSessionSnapshot(state) {
    state = state || {};
    var queue = Array.isArray(state.playQueue) ? state.playQueue : [];
    var currentIdx = Math.floor(finiteNumber(state.currentIdx, -1));
    if (!queue.length || currentIdx < 0 || currentIdx >= queue.length) return null;
    var filtered = [];
    var remappedIdx = -1;
    for (var i = 0; i < queue.length && filtered.length < MAX_QUEUE_ITEMS; i++) {
      var original = queue[i];
      if (!isRestorablePlaybackSong(original)) continue;
      var sanitized = sanitizePlaybackSong(original);
      if (!sanitized) continue;
      if (i === currentIdx) remappedIdx = filtered.length;
      filtered.push(sanitized);
    }
    if (!filtered.length || remappedIdx < 0) return null;
    var duration = finiteNumber(state.duration, 0);
    return {
      schema: PLAYBACK_SESSION_SCHEMA,
      savedAt: finiteNumber(state.now, Date.now()),
      currentIdx: remappedIdx,
      currentTime: normalizeResumeSeconds(state.currentTime, duration),
      duration: duration > 0 ? Math.round(duration * 1000) / 1000 : 0,
      wasPlaying: state.playing === true,
      queue: filtered,
    };
  }

  function normalizePlaybackSessionSnapshot(raw, options) {
    options = options || {};
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schema !== PLAYBACK_SESSION_SCHEMA) return null;
    var rawQueue = Array.isArray(raw.queue) ? raw.queue : [];
    if (!rawQueue.length) return null;
    var queue = [];
    for (var i = 0; i < rawQueue.length && queue.length < MAX_QUEUE_ITEMS; i++) {
      if (!isRestorablePlaybackSong(rawQueue[i])) continue;
      var song = sanitizePlaybackSong(rawQueue[i]);
      if (song) queue.push(song);
    }
    if (!queue.length) return null;
    var idx = Math.floor(finiteNumber(raw.currentIdx, 0));
    idx = Math.max(0, Math.min(queue.length - 1, idx));
    var duration = finiteNumber(raw.duration, 0);
    return {
      schema: PLAYBACK_SESSION_SCHEMA,
      savedAt: finiteNumber(raw.savedAt, options.now || Date.now()),
      currentIdx: idx,
      currentTime: normalizeResumeSeconds(raw.currentTime, duration),
      duration: duration > 0 ? Math.round(duration * 1000) / 1000 : 0,
      wasPlaying: raw.wasPlaying === true,
      queue: queue,
    };
  }

  return {
    PLAYBACK_SESSION_SCHEMA: PLAYBACK_SESSION_SCHEMA,
    createPlaybackSessionSnapshot: createPlaybackSessionSnapshot,
    isRestorablePlaybackSong: isRestorablePlaybackSong,
    normalizePlaybackSessionSnapshot: normalizePlaybackSessionSnapshot,
    normalizeResumeSeconds: normalizeResumeSeconds,
    sanitizePlaybackSong: sanitizePlaybackSong,
  };
});
