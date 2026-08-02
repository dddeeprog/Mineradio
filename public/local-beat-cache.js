(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MineradioLocalBeatCache = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeMode(mode) {
    return mode === 'dj' ? 'dj' : 'mr';
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .toLowerCase();
  }

  function isLocalLikeSong(song) {
    return !!(song && (
      song.type === 'local' ||
      song.source === 'local-library' ||
      song.localKey ||
      song.localUrl ||
      song.localFilePath ||
      song.localLibraryFileSignature
    ));
  }

  function localBeatSongKey(song) {
    if (!isLocalLikeSong(song)) return '';
    if (song.localKey) return String(song.localKey);
    var signature = String(song.localLibraryFileSignature || '').trim();
    if (signature) return signature.indexOf('library:') === 0 ? signature : 'library:' + signature;
    var file = song.localFile || {};
    var pathKey = normalizePath(song.localLibraryPathKey || file.relativePath || file.webkitRelativePath || file.fullPath || file.filePath || file.path || file.name);
    if (!pathKey) return '';
    var size = Number(song.size != null ? song.size : file.size) || 0;
    var lastModified = Number(song.lastModified != null ? song.lastModified : file.lastModified) || 0;
    return 'library:' + [pathKey, size, lastModified].join(':');
  }

  function playbackBeatMapKey(song) {
    var localKey = localBeatSongKey(song);
    return localKey ? 'local:' + localKey : '';
  }

  function localBeatDiskKey(localKey, mode) {
    if (!localKey) return '';
    return 'local:' + String(localKey) + ':' + normalizeMode(mode);
  }

  function preferredLocalBeatMode(prefs, localKey) {
    return prefs && localKey && prefs[localKey] === 'dj' ? 'dj' : 'mr';
  }

  function getLocalBeatMapEntry(cache, localKey, mode) {
    var entry = localKey && cache ? cache[localKey] : null;
    return entry && entry[normalizeMode(mode)] ? entry[normalizeMode(mode)] : null;
  }

  function pickCachedLocalBeatMap(cache, prefs, song, mode) {
    var localKey = localBeatSongKey(song);
    if (!localKey) return null;
    var firstMode = mode ? normalizeMode(mode) : preferredLocalBeatMode(prefs, localKey);
    var secondMode = firstMode === 'dj' ? 'mr' : 'dj';
    var firstMap = getLocalBeatMapEntry(cache, localKey, firstMode);
    if (firstMap) return { localKey: localKey, mode: firstMode, map: firstMap };
    var secondMap = getLocalBeatMapEntry(cache, localKey, secondMode);
    if (secondMap) return { localKey: localKey, mode: secondMode, map: secondMap };
    return null;
  }

  function storeLocalBeatMapEntry(cache, prefs, localKey, mode, map, options) {
    if (!cache || !prefs || !localKey || !map) return false;
    mode = normalizeMode(mode);
    var entry = cache[localKey] || {};
    entry[mode] = map;
    entry.updatedAt = Number(options && options.now) || Date.now();
    cache[localKey] = entry;
    prefs[localKey] = mode;
    return true;
  }

  return {
    normalizeMode: normalizeMode,
    localBeatSongKey: localBeatSongKey,
    playbackBeatMapKey: playbackBeatMapKey,
    localBeatDiskKey: localBeatDiskKey,
    preferredLocalBeatMode: preferredLocalBeatMode,
    getLocalBeatMapEntry: getLocalBeatMapEntry,
    pickCachedLocalBeatMap: pickCachedLocalBeatMap,
    storeLocalBeatMapEntry: storeLocalBeatMapEntry
  };
});
