(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaLyricMatchState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  var FOLIA_LYRIC_MATCH_SOURCES = ['netease-current', 'amll', 'qq', 'kugou'];
  var DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : (fallback || 0);
  }

  function normalizeDurationMs(value) {
    var n = finiteNumber(value, 0);
    if (n <= 0) return 0;
    return n > 1000 ? Math.round(n) : Math.round(n * 1000);
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\(\[（【]\s*(feat|featuring|ft)\.?\s+[^\)\]）】]+[\)\]）】]/gi, '')
      .replace(/\b(feat|featuring|ft)\.?\s+.+$/i, '')
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function splitArtists(value) {
    return String(value || '')
      .split(/\s*(?:\/|,|、|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|与)\s*/i)
      .map(normalizeText)
      .map(function(name) { return name.trim(); })
      .filter(Boolean);
  }

  function textSimilarity(a, b) {
    var x = compactText(a);
    var y = compactText(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return Math.min(x.length, y.length) / Math.max(x.length, y.length);
    var sx = {};
    var sy = {};
    for (var i = 0; i < x.length; i++) sx[x.charAt(i)] = true;
    for (var j = 0; j < y.length; j++) sy[y.charAt(j)] = true;
    var union = {};
    var hit = 0;
    Object.keys(sx).forEach(function(ch) {
      union[ch] = true;
      if (sy[ch]) hit++;
    });
    Object.keys(sy).forEach(function(ch) { union[ch] = true; });
    var total = Object.keys(union).length;
    return total ? hit / total : 0;
  }

  function artistSimilarity(a, b) {
    var aa = splitArtists(a);
    var bb = splitArtists(b);
    if (!aa.length || !bb.length) return textSimilarity(a, b);
    var hits = 0;
    aa.forEach(function(left) {
      var matched = bb.some(function(right) {
        return left === right || (left.length >= 3 && right.indexOf(left) >= 0) || (right.length >= 3 && left.indexOf(right) >= 0);
      });
      if (matched) hits++;
    });
    var tokenScore = hits / Math.max(aa.length, bb.length);
    return Math.max(tokenScore, textSimilarity(a, b));
  }

  function albumSimilarityValue(a, b) {
    var base = textSimilarity(a, b);
    var x = compactText(a);
    var y = compactText(b);
    if (x.length >= 6 && y.indexOf(x) >= 0) return Math.max(base, 0.78);
    if (y.length >= 6 && x.indexOf(y) >= 0) return Math.max(base, 0.78);
    return base;
  }

  function sourceDisplayLabel(source, platform) {
    if (source === 'netease-current') return '网易云当前歌词';
    if (source === 'netease') return '网易云歌词';
    if (source === 'amll') return platform === 'qq' ? 'AMLL TTML · QQ' : 'AMLL TTML';
    if (source === 'qq') return 'QQ 歌词';
    if (source === 'kugou') return '酷狗歌词';
    return '歌词来源';
  }

  function normalizeLyricMatchTarget(song) {
    song = song || {};
    var artists = Array.isArray(song.artists)
      ? song.artists.map(function(a) { return a && (a.name || a.title || a.artist || a); }).filter(Boolean).join(' / ')
      : '';
    return {
      title: String(song.title || song.name || '').trim(),
      artist: String(song.artist || song.singer || artists || '').trim(),
      album: String(song.album || song.albumName || (song.al && song.al.name) || '').trim(),
      durationMs: normalizeDurationMs(song.duration || song.durationMs || song.dt || 0),
      id: song.id == null ? '' : String(song.id),
      mid: String(song.mid || song.songmid || ''),
    };
  }

  function normalizeCandidateArtists(candidate) {
    if (!candidate) return '';
    if (candidate.artist) return String(candidate.artist);
    if (Array.isArray(candidate.artists)) {
      return candidate.artists.map(function(a) { return a && (a.name || a.title || a.artist || a); }).filter(Boolean).join(' / ');
    }
    if (Array.isArray(candidate.ar)) {
      return candidate.ar.map(function(a) { return a && (a.name || a.title || a.artist || a); }).filter(Boolean).join(' / ');
    }
    return '';
  }

  function normalizeLyricMatchCandidate(candidate) {
    candidate = candidate || {};
    var source = candidate.source || candidate.provider || 'netease-current';
    var album = candidate.album || candidate.albumName || (candidate.al && candidate.al.name) || '';
    var title = candidate.title || candidate.name || candidate.songName || '';
    var artist = normalizeCandidateArtists(candidate);
    return {
      source: source,
      label: sourceDisplayLabel(source, candidate.platform || candidate.amllDbPlatform),
      providerPlatform: candidate.platform || candidate.amllDbPlatform || '',
      id: candidate.id == null ? '' : String(candidate.id),
      mid: String(candidate.mid || candidate.qqMid || candidate.songmid || ''),
      kgHash: String(candidate.kgHash || candidate.hash || ''),
      title: String(title || '').trim(),
      artist: String(artist || '').trim(),
      album: String(album || '').trim(),
      durationMs: normalizeDurationMs(candidate.duration || candidate.durationMs || candidate.dt || 0),
      format: String(candidate.format || candidate.formatHint || (source === 'amll' ? 'ttml' : 'lrc')).toLowerCase(),
      lyric: candidate.lyric || candidate.lyrics || candidate.text || '',
      raw: candidate.raw || candidate,
    };
  }

  function durationDetails(targetMs, candidateMs) {
    if (!targetMs || !candidateMs) return { multiplier: 0.9, matched: null };
    var diff = Math.abs(targetMs - candidateMs);
    if (diff <= 1000) return { multiplier: 1, matched: true };
    if (diff <= 3000) return { multiplier: 0.95, matched: true };
    if (diff <= 5000) return { multiplier: 0.75, matched: false };
    if (diff <= 10000) return { multiplier: 0.35, matched: false };
    return { multiplier: 0.1, matched: false };
  }

  function sourceQualityBonus(candidate) {
    if (!candidate) return 0;
    if (candidate.source === 'amll' && candidate.format === 'ttml') return 6;
    if ((candidate.source === 'qq' || candidate.source === 'kugou') && /qrc|krc|ttml|yrc/.test(candidate.format)) return 4;
    if (candidate.source === 'netease-current') return 3;
    return 0;
  }

  function calculateLyricMatchScoreDetails(target, candidate) {
    target = normalizeLyricMatchTarget(target || {});
    candidate = normalizeLyricMatchCandidate(candidate || {});
    var titleSimilarity = textSimilarity(target.title, candidate.title);
    var artistSim = target.artist ? artistSimilarity(target.artist, candidate.artist) : 1;
    var hasTargetAlbum = !!target.album;
    var albumSimilarity = hasTargetAlbum && candidate.album ? albumSimilarityValue(target.album, candidate.album) : null;
    var duration = durationDetails(target.durationMs, candidate.durationMs);
    var titleScore = titleSimilarity * 45;
    var artistScore = artistSim * 25;
    var albumScore = albumSimilarity == null ? (hasTargetAlbum ? 0 : 30) : albumSimilarity * 30;
    var titleMatched = titleSimilarity >= 0.65;
    var artistMatched = !target.artist || artistSim >= 0.5;
    var albumMatched = !hasTargetAlbum ? null : (candidate.album ? albumSimilarity >= 0.65 : null);
    var identityReliable = artistMatched || albumMatched === true;
    var rawIdentity = titleScore + artistScore + albumScore;
    var capped = (!titleMatched || !identityReliable) ? Math.min(rawIdentity, 74) : rawIdentity;
    var score = Math.round(Math.max(0, Math.min(100, capped * duration.multiplier + sourceQualityBonus(candidate))));
    return {
      score: score,
      titleScore: titleScore,
      artistScore: artistScore,
      albumScore: albumScore,
      durationScore: duration.multiplier * 100,
      durationMultiplier: duration.multiplier,
      titleSimilarity: titleSimilarity,
      artistSimilarity: artistSim,
      albumSimilarity: albumSimilarity,
      titleMatched: titleMatched,
      artistMatched: artistMatched,
      albumMatched: albumMatched,
      durationMatched: duration.matched,
    };
  }

  function chooseBestLyricCandidate(target, candidates) {
    target = normalizeLyricMatchTarget(target || {});
    var best = null;
    function rank(candidate) {
      if (!candidate) return 0;
      if (candidate.source === 'amll' && candidate.format === 'ttml') return 4;
      if (candidate.source === 'qq' && /qrc|ttml/.test(candidate.format)) return 3;
      if (candidate.source === 'kugou' && /krc|ttml/.test(candidate.format)) return 2;
      if (candidate.source === 'netease-current') return 1;
      return 0;
    }
    (Array.isArray(candidates) ? candidates : []).forEach(function(item) {
      var candidate = normalizeLyricMatchCandidate(item);
      var details = calculateLyricMatchScoreDetails(target, candidate);
      candidate.score = details.score;
      candidate.scoreDetails = details;
      if (!best || candidate.score > best.score || (candidate.score === best.score && rank(candidate) > rank(best))) best = candidate;
    });
    return best;
  }

  function encodeParam(value) {
    return encodeURIComponent(String(value || ''));
  }

  function buildLyricMatchRequestPlan(song) {
    var target = normalizeLyricMatchTarget(song || {});
    var query = [target.title, target.artist].filter(Boolean).join(' ').trim();
    return FOLIA_LYRIC_MATCH_SOURCES.map(function(source) {
      var endpoint = '';
      if (source === 'netease-current') endpoint = '/api/lyric?id=' + encodeParam(target.id);
      else if (source === 'qq') endpoint = '/api/folia/lyrics/qq?query=' + encodeParam(query) + '&title=' + encodeParam(target.title) + '&artist=' + encodeParam(target.artist) + '&album=' + encodeParam(target.album) + '&durationMs=' + encodeParam(target.durationMs) + '&mid=' + encodeParam(target.mid);
      else if (source === 'amll') endpoint = '/api/folia/lyrics/amll?query=' + encodeParam(query) + '&title=' + encodeParam(target.title) + '&artist=' + encodeParam(target.artist) + '&album=' + encodeParam(target.album) + '&durationMs=' + encodeParam(target.durationMs) + '&neteaseId=' + encodeParam(target.id) + '&qqMid=' + encodeParam(target.mid);
      else if (source === 'kugou') endpoint = '/api/folia/lyrics/kugou?query=' + encodeParam(query) + '&title=' + encodeParam(target.title) + '&artist=' + encodeParam(target.artist) + '&album=' + encodeParam(target.album) + '&durationMs=' + encodeParam(target.durationMs);
      return {
        source: source,
        label: sourceDisplayLabel(source),
        endpoint: endpoint,
        timeoutMs: source === 'netease-current' ? 3500 : 5000,
        degraded: false,
      };
    });
  }

  function createLyricMatchTimeout(source, timeoutMs) {
    timeoutMs = finiteNumber(timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS);
    if (timeoutMs < 1000 || timeoutMs > 15000) timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS;
    return {
      source: source || 'unknown',
      timeoutMs: Math.round(timeoutMs),
      fallback: [],
    };
  }

  return {
    FOLIA_LYRIC_MATCH_SOURCES: FOLIA_LYRIC_MATCH_SOURCES.slice(),
    buildLyricMatchRequestPlan: buildLyricMatchRequestPlan,
    calculateLyricMatchScoreDetails: calculateLyricMatchScoreDetails,
    chooseBestLyricCandidate: chooseBestLyricCandidate,
    createLyricMatchTimeout: createLyricMatchTimeout,
    normalizeLyricMatchCandidate: normalizeLyricMatchCandidate,
    normalizeLyricMatchTarget: normalizeLyricMatchTarget,
    sourceDisplayLabel: sourceDisplayLabel,
  };
});
