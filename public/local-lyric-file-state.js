(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioLocalLyricFileState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  var SUPPORTED_FORMATS = { lrc: true, ttml: true };

  function stringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizedPath(value) {
    return stringValue(value).replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  function splitPath(value) {
    var path = normalizedPath(value);
    var index = path.lastIndexOf('/');
    return { path: path, dir: index >= 0 ? path.slice(0, index) : '', base: index >= 0 ? path.slice(index + 1) : path };
  }

  function hasUnsafePathSegments(value) {
    return normalizedPath(value).split('/').some(function(segment) {
      return segment === '.' || segment === '..';
    });
  }

  function extensionOf(name) {
    var base = splitPath(name).base;
    var index = base.lastIndexOf('.');
    return index > 0 ? base.slice(index + 1).toLowerCase() : '';
  }

  function stemOf(name) {
    var base = splitPath(name).base;
    var index = base.lastIndexOf('.');
    return index > 0 ? base.slice(0, index) : base;
  }

  function sameDirectory(left, right) {
    return !!left && String(left).toLowerCase() === String(right).toLowerCase();
  }

  function isSafeSameDirectoryStem(audioPath, lyricPath) {
    if (hasUnsafePathSegments(audioPath) || hasUnsafePathSegments(lyricPath)) return false;
    var audio = splitPath(audioPath);
    var lyric = splitPath(lyricPath);
    return !!audio.dir && !!audio.base && !!lyric.base &&
      sameDirectory(audio.dir, lyric.dir) &&
      stemOf(audio.base).toLowerCase() === stemOf(lyric.base).toLowerCase();
  }

  function safeCandidateName(value) {
    var name = stringValue(value);
    if (!name || name.indexOf('\0') >= 0 || /[\\/]/.test(name)) return '';
    if (name === '.' || name === '..' || name.indexOf('..') >= 0) return '';
    return name;
  }

  function buildSameDirectoryLyricCandidates(audioPath) {
    if (hasUnsafePathSegments(audioPath)) return [];
    var audio = splitPath(audioPath);
    var stem = stemOf(audio.base);
    if (!audio.dir || !stem) return [];
    return ['ttml', 'lrc'].map(function(format) {
      var name = stem + '.' + format;
      return { audioPath: audio.path, lyricPath: audio.dir + '/' + name, name: name, format: format, enhanced: format === 'ttml' };
    });
  }

  function normalizeLocalLyricCandidate(candidate) {
    candidate = candidate || {};
    if (hasUnsafePathSegments(candidate.audioPath) || hasUnsafePathSegments(candidate.lyricPath)) return null;
    var audio = splitPath(candidate.audioPath);
    var audioStem = stemOf(audio.base);
    if (!audio.dir || !audio.base || !audioStem) return null;
    var lyricPath = normalizedPath(candidate.lyricPath);
    var name = safeCandidateName(candidate.name);
    if (!name && lyricPath) {
      var lyric = splitPath(lyricPath);
      if (!sameDirectory(audio.dir, lyric.dir)) return null;
      name = safeCandidateName(lyric.base);
    }
    if (!name || !SUPPORTED_FORMATS[extensionOf(name)] || stemOf(name).toLowerCase() !== audioStem.toLowerCase()) return null;
    if (!lyricPath) lyricPath = audio.dir + '/' + name;
    var normalizedLyric = splitPath(lyricPath);
    if (!isSafeSameDirectoryStem(audio.path, normalizedLyric.path) || normalizedLyric.base.toLowerCase() !== name.toLowerCase()) return null;
    var format = extensionOf(name);
    return {
      audioPath: audio.path,
      lyricPath: normalizedLyric.path,
      name: name,
      format: format,
      enhanced: !!candidate.enhanced || format === 'ttml',
      exists: candidate.exists !== false,
    };
  }

  function lyricPriority(candidate) {
    var format = String(candidate && candidate.format || '').toLowerCase();
    if (format === 'ttml') return 3;
    if (format === 'lrc' && candidate.enhanced) return 2;
    return format === 'lrc' ? 1 : 0;
  }

  function selectPreferredLocalLyric(candidates) {
    var list = (Array.isArray(candidates) ? candidates : []).filter(function(candidate) {
      return candidate && candidate.exists !== false && lyricPriority(candidate) > 0;
    });
    list.sort(function(left, right) {
      var priority = lyricPriority(right) - lyricPriority(left);
      if (priority) return priority;
      return String(left.lyricPath || left.name || '').toLowerCase().localeCompare(String(right.lyricPath || right.name || '').toLowerCase());
    });
    return list[0] || null;
  }

  function cloneWord(word) {
    word = word || {};
    return {
      text: stringValue(word.text),
      t: Math.max(0, Number(word.t == null ? word.time : word.t) || 0),
      d: Math.max(0.03, Number(word.d == null ? word.duration : word.d) || 0.03),
      c0: Math.max(0, Number(word.c0) || 0),
      c1: Math.max(0, Number(word.c1) || 0),
    };
  }

  function normalizeParsedLocalLyrics(parsed) {
    parsed = parsed || {};
    var source = stringValue(parsed.source) || 'local-lrc';
    var lines = (Array.isArray(parsed.lines) ? parsed.lines : []).map(function(line) {
      line = line || {};
      var text = stringValue(line.text);
      if (!text) return null;
      var words = Array.isArray(line.words) ? line.words.map(cloneWord).filter(function(word) { return word.text && word.c1 >= word.c0; }) : [];
      return {
        t: Math.max(0, Number(line.t == null ? line.time : line.t) || 0),
        duration: Math.max(0.45, Math.min(30, Number(line.duration) || 4.8)),
        text: text,
        words: words,
        charCount: Math.max(1, Number(line.charCount) || text.length),
        source: stringValue(line.source) || source,
      };
    }).filter(Boolean).sort(function(left, right) { return left.t - right.t; });
    return {
      lines: lines,
      hasNativeKaraoke: lines.some(function(line) { return line.words.length > 0; }),
      timingSource: stringValue(parsed.timingSource) || source,
      sourceLabel: stringValue(parsed.sourceLabel) || (source === 'local-ttml' ? '同目录 TTML' : '同目录 LRC'),
    };
  }

  return {
    buildSameDirectoryLyricCandidates: buildSameDirectoryLyricCandidates,
    isSafeSameDirectoryStem: isSafeSameDirectoryStem,
    normalizeLocalLyricCandidate: normalizeLocalLyricCandidate,
    selectPreferredLocalLyric: selectPreferredLocalLyric,
    normalizeParsedLocalLyrics: normalizeParsedLocalLyrics,
  };
});
