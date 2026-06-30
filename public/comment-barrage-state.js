(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioCommentBarrageState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function normalizeCommentBarrageEnabled(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
  }

  function commentBarrageLimit(value) {
    if (value == null || value === '' || value === 0 || value === '0' || value === 'all' || value === 'unlimited') return 0;
    var n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function isLocalOrPodcast(song) {
    if (!song || typeof song !== 'object') return true;
    return song.type === 'local' || song.source === 'local' || song.localUrl ||
      song.type === 'podcast' || song.source === 'podcast';
  }

  function isQQSong(song) {
    return !!(song && (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq'));
  }

  function commentBarrageSongKey(song) {
    if (isLocalOrPodcast(song)) return '';
    if (isQQSong(song)) {
      var qid = song.mid || song.songmid || song.qqId || song.id || '';
      return qid ? ('qq:' + String(qid)) : '';
    }
    return song && song.id != null && song.id !== '' ? ('netease:' + String(song.id)) : '';
  }

  function commentBarrageCommentsUrl(song, limit) {
    limit = commentBarrageLimit(limit);
    var limitParam = limit > 0 ? String(limit) : 'all';
    if (isLocalOrPodcast(song)) return '';
    if (isQQSong(song)) {
      var mid = song.mid || song.songmid || song.id || '';
      var id = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
      if (!mid && !id) return '';
      return '/api/qq/song/comments?id=' + encodeURIComponent(id) + '&mid=' + encodeURIComponent(mid) + '&limit=' + encodeURIComponent(limitParam);
    }
    if (song && song.id != null && song.id !== '') {
      return '/api/song/comments?id=' + encodeURIComponent(song.id) + '&limit=' + encodeURIComponent(limitParam);
    }
    return '';
  }

  var emojiRegexCache = null;
  function stripUnsupportedEmoji(text) {
    var value = String(text || '');
    try {
      if (!emojiRegexCache) emojiRegexCache = new RegExp('[\\p{Extended_Pictographic}\\uFE0F\\u200D]+', 'gu');
      value = value.replace(emojiRegexCache, '');
    } catch (e) {
      value = value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').replace(/[\u2600-\u27BF]/g, '');
    }
    return value.replace(/[\uFE0F\u200D]/g, '').replace(/\s+/g, ' ').trim();
  }

  function cleanCommentText(text, maxLength) {
    var value = stripUnsupportedEmoji(text);
    if (!value) return '';
    if (value.length > maxLength) return '';
    return value;
  }

  function wrapBarrageText(text, options) {
    options = options || {};
    var value = stripUnsupportedEmoji(text);
    if (!value) return [];
    var maxChars = Math.max(8, Math.min(36, Math.floor(Number(options.maxCharsPerLine) || 22)));
    var maxLines = Math.max(1, Math.min(4, Math.floor(Number(options.maxLines) || 3)));
    var chars = Array.from(value);
    if (chars.length > maxChars * maxLines) return [];
    var lines = [];
    var line = '';
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (!line && /\s/.test(ch)) continue;
      line += ch;
      if (line.length >= maxChars) {
        lines.push(line.trim());
        line = '';
        if (lines.length >= maxLines) break;
      }
    }
    if (line.trim() && lines.length < maxLines) lines.push(line.trim());
    return lines.filter(Boolean);
  }

  function sanitizeBarrageComments(comments, options) {
    options = options || {};
    var rawMaxCount = Math.floor(Number(options.maxCount) || 0);
    var maxCount = rawMaxCount > 0 ? rawMaxCount : Infinity;
    var maxLength = Math.max(24, Math.min(260, Math.floor(Number(options.maxLength) || 180)));
    var seen = {};
    var out = [];
    (Array.isArray(comments) ? comments : []).forEach(function(comment) {
      if (out.length >= maxCount) return;
      var text = cleanCommentText(comment && comment.content, maxLength);
      if (!text || seen[text]) return;
      seen[text] = true;
      out.push({
        id: comment && comment.id || text,
        text: text,
      });
    });
    return out;
  }

  function shouldShowCommentBarrage(song, state) {
    state = state || {};
    return !!(commentBarrageSongKey(song) && (state.playing || state.audioActive));
  }

  function assignBarrageTrack(index, maxTracks) {
    var tracks = Math.max(1, Math.floor(Number(maxTracks) || 1));
    var i = Math.max(0, Math.floor(Number(index) || 0));
    return i % tracks;
  }

  function commentBarrageLaneOffset(index, maxTracks, profile) {
    profile = profile || {};
    var tracks = Math.max(1, Math.min(14, Math.floor(Number(maxTracks) || Number(profile.maxActive) || 1)));
    var lane = assignBarrageTrack(index, tracks);
    var lyricSafeY = Math.max(1.04, Math.min(2.20, Number(profile.lyricSafeY) || 1.08));
    var laneGap = Math.max(0.38, Math.min(0.82, Number(profile.laneGap) || 0.50));
    var spaceDepth = Math.max(1.8, Math.min(3.6, Number(profile.spaceDepth) || Number(profile.spreadZ) || 2.2));
    var depthStep = spaceDepth / 3.4;
    var side = lane % 2 === 0 ? 1 : -1;
    var tier = Math.floor(lane / 2);
    var stagger = ((lane % 3) - 1) * 0.18 + (Math.floor(index / tracks) % 2 ? 0.14 : -0.10);
    return {
      lane: lane,
      x: stagger,
      y: side * (lyricSafeY + tier * laneGap),
      z: ((lane % 3) - 1) * depthStep + tier * 0.18,
    };
  }

  function commentBarrageTextStyle(lineCount) {
    var lines = Math.max(1, Math.min(4, Math.floor(Number(lineCount) || 1)));
    return {
      fontSize: lines > 1 ? 40 : 46,
      minFontSize: 25,
      lineHeight: lines > 1 ? 50 : 54,
      weight: 700,
    };
  }

  function smooth01(value) {
    var t = Math.max(0, Math.min(1, Number(value) || 0));
    return t * t * (3 - 2 * t);
  }

  function commentBarrageOpacityAt(ageSec, durationSec, options) {
    options = options || {};
    var age = Number(ageSec);
    var duration = Number(durationSec);
    if (!Number.isFinite(age) || !Number.isFinite(duration) || duration <= 0 || age <= 0 || age >= duration) return 0;
    var fadeIn = Math.max(0.18, Math.min(Number(options.fadeInSec) || 0.72, duration * 0.30));
    var fadeOut = Math.max(0.24, Math.min(Number(options.fadeOutSec) || 1.35, duration * 0.36));
    return smooth01(age / fadeIn) * smooth01((duration - age) / fadeOut);
  }

  function commentBarrageVisualProfile(preset) {
    var rawId = Math.floor(Number(preset));
    var id = rawId >= 0 && rawId <= 6 ? rawId : 0;
    var profiles = [
      { kind: 'lyric-cloud', x: -0.55, y: 0.00, z: 1.72, spreadX: 5.70, spreadY: 2.72, spreadZ: 2.20, spaceDepth: 2.20, driftX: 0.36, driftY: 0.24, driftZ: 0.42, tiltX: -4, tiltY: 0, opacity: 0.58, scale: 0.36, maxActive: 8, durationSec: 12.0, spawnMs: 1080, lyricSafeY: 1.08, laneGap: 0.50 },
      { kind: 'tunnel-echo', x: 0.00, y: 0.00, z: 1.10, spreadX: 6.10, spreadY: 2.90, spreadZ: 2.85, spaceDepth: 2.85, driftX: -0.24, driftY: 0.12, driftZ: -1.18, tiltX: 3, tiltY: 8, opacity: 0.50, scale: 0.34, maxActive: 8, durationSec: 10.2, spawnMs: 1050, lyricSafeY: 1.12, laneGap: 0.52 },
      { kind: 'orbital', x: 0.16, y: 0.00, z: 1.36, spreadX: 5.55, spreadY: 2.76, spreadZ: 2.35, spaceDepth: 2.35, driftX: 0.58, driftY: 0.14, driftZ: -0.30, tiltX: -2, tiltY: -12, opacity: 0.52, scale: 0.35, maxActive: 8, durationSec: 12.8, spawnMs: 1120, lyricSafeY: 1.06, laneGap: 0.50 },
      { kind: 'void-whisper', x: -0.18, y: 0.00, z: 1.96, spreadX: 6.25, spreadY: 2.98, spreadZ: 2.10, spaceDepth: 2.10, driftX: 0.16, driftY: 0.20, driftZ: 0.22, tiltX: 0, tiltY: 0, opacity: 0.42, scale: 0.32, maxActive: 7, durationSec: 13.0, spawnMs: 1250, lyricSafeY: 1.16, laneGap: 0.54 },
      { kind: 'groove', x: 0.00, y: 0.00, z: 1.32, spreadX: 5.85, spreadY: 2.62, spreadZ: 2.05, spaceDepth: 2.05, driftX: 0.64, driftY: 0.10, driftZ: 0.12, tiltX: -6, tiltY: 0, opacity: 0.52, scale: 0.34, maxActive: 8, durationSec: 11.2, spawnMs: 1040, lyricSafeY: 1.04, laneGap: 0.50 },
      { kind: 'starfield', x: 0.12, y: 0.00, z: 2.12, spreadX: 6.60, spreadY: 3.10, spreadZ: 3.10, spaceDepth: 3.10, driftX: -0.28, driftY: 0.18, driftZ: -0.72, tiltX: -8, tiltY: 10, opacity: 0.46, scale: 0.30, maxActive: 9, durationSec: 13.4, spawnMs: 900, lyricSafeY: 1.20, laneGap: 0.54 },
      { kind: 'requiem', x: -0.82, y: 0.00, z: 1.52, spreadX: 5.30, spreadY: 2.82, spreadZ: 2.18, spaceDepth: 2.18, driftX: 0.18, driftY: -0.12, driftZ: 0.32, tiltX: -3, tiltY: -7, opacity: 0.44, scale: 0.32, maxActive: 7, durationSec: 12.2, spawnMs: 1220, lyricSafeY: 1.12, laneGap: 0.52 },
    ];
    var profile = profiles[id] || profiles[0];
    return {
      renderer: 'three-text-plane',
      kind: profile.kind,
      x: profile.x,
      y: profile.y,
      z: profile.z,
      spreadX: profile.spreadX,
      spreadY: profile.spreadY,
      spreadZ: profile.spreadZ,
      spaceDepth: profile.spaceDepth,
      driftX: profile.driftX,
      driftY: profile.driftY,
      driftZ: profile.driftZ,
      tiltX: profile.tiltX,
      tiltY: profile.tiltY,
      opacity: profile.opacity,
      scale: profile.scale,
      maxActive: profile.maxActive,
      durationSec: profile.durationSec,
      spawnMs: profile.spawnMs,
      lyricSafeY: profile.lyricSafeY,
      laneGap: profile.laneGap,
    };
  }

  function commentBarrageMotionBinding() {
    return {
      anchor: 'visual-world',
      billboard: 'lyric-rotation',
      rotation: 'lyric',
    };
  }

  function commentBarrageControlBounds(key) {
    var map = {
      commentBarrageSize: { min: 0.55, max: 1.35, fallback: 1 },
      commentBarrageSpread: { min: 0.7, max: 1.8, fallback: 1 },
      commentBarrageDepth: { min: 0.6, max: 2.2, fallback: 1 },
      commentBarrageOpacity: { min: 0.2, max: 1, fallback: 1 },
      commentBarrageDensity: { min: 0.55, max: 3.4, fallback: 1.35 },
      commentBarrageLifetime: { min: 0.55, max: 2.2, fallback: 1 },
    };
    return map[key] ? {
      min: map[key].min,
      max: map[key].max,
      fallback: map[key].fallback,
    } : null;
  }

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function fitBarrageRectToViewport(rect, viewport, options) {
    options = options || {};
    var vw = Math.max(1, finiteNumber(viewport && viewport.width, 1));
    var vh = Math.max(1, finiteNumber(viewport && viewport.height, 1));
    var margin = Math.max(0, Math.min(Math.min(vw, vh) * 0.24, finiteNumber(options.margin, 56)));
    var left = finiteNumber(rect && rect.left, 0);
    var top = finiteNumber(rect && rect.top, 0);
    var width = Math.max(1, finiteNumber(rect && rect.width, 1));
    var height = Math.max(1, finiteNumber(rect && rect.height, 1));
    var scale = Math.min(1, (vw - margin * 2) / width, (vh - margin * 2) / height);
    scale = Math.max(0.38, Number.isFinite(scale) ? scale : 1);
    var scaledW = width * scale;
    var scaledH = height * scale;
    var cx = left + width * 0.5;
    var cy = top + height * 0.5;
    var minCx = margin + scaledW * 0.5;
    var maxCx = vw - margin - scaledW * 0.5;
    var minCy = margin + scaledH * 0.5;
    var maxCy = vh - margin - scaledH * 0.5;
    var nextCx = Math.max(minCx, Math.min(maxCx, cx));
    var nextCy = Math.max(minCy, Math.min(maxCy, cy));
    var lyric = options.lyricRect;
    if (lyric && Number.isFinite(Number(lyric.left)) && Number.isFinite(Number(lyric.top))) {
      var lyricLeft = finiteNumber(lyric.left, 0);
      var lyricTop = finiteNumber(lyric.top, 0);
      var lyricW = Math.max(0, finiteNumber(lyric.width, 0));
      var lyricH = Math.max(0, finiteNumber(lyric.height, 0));
      var lyricRight = lyricLeft + lyricW;
      var lyricBottom = lyricTop + lyricH;
      var overlapsX = nextCx + scaledW * 0.5 > lyricLeft && nextCx - scaledW * 0.5 < lyricRight;
      var overlapsY = nextCy + scaledH * 0.5 > lyricTop && nextCy - scaledH * 0.5 < lyricBottom;
      if (overlapsX && overlapsY) {
        var upCy = lyricTop - scaledH * 0.5;
        var downCy = lyricBottom + scaledH * 0.5;
        var canUp = upCy >= minCy;
        var canDown = downCy <= maxCy;
        if (canUp && canDown) nextCy = nextCy <= lyricTop + lyricH * 0.5 ? upCy : downCy;
        else if (canUp) nextCy = upCy;
        else if (canDown) nextCy = downCy;
        else nextCx = nextCx < lyricLeft + lyricW * 0.5 ? lyricLeft - scaledW * 0.5 : lyricRight + scaledW * 0.5;
        nextCx = Math.max(minCx, Math.min(maxCx, nextCx));
        nextCy = Math.max(minCy, Math.min(maxCy, nextCy));
      }
    }
    var nextLeft = nextCx - scaledW * 0.5;
    var nextTop = nextCy - scaledH * 0.5;
    var dx = nextCx - cx;
    var dy = nextCy - cy;
    return {
      left: nextLeft,
      top: nextTop,
      width: scaledW,
      height: scaledH,
      scale: scale,
      dx: dx,
      dy: dy,
      changed: Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001 || Math.abs(scale - 1) > 0.001,
    };
  }

  return {
    assignBarrageTrack: assignBarrageTrack,
    commentBarrageCommentsUrl: commentBarrageCommentsUrl,
    commentBarrageControlBounds: commentBarrageControlBounds,
    commentBarrageLaneOffset: commentBarrageLaneOffset,
    commentBarrageLimit: commentBarrageLimit,
    commentBarrageMotionBinding: commentBarrageMotionBinding,
    commentBarrageOpacityAt: commentBarrageOpacityAt,
    commentBarrageSongKey: commentBarrageSongKey,
    commentBarrageTextStyle: commentBarrageTextStyle,
    commentBarrageVisualProfile: commentBarrageVisualProfile,
    normalizeCommentBarrageEnabled: normalizeCommentBarrageEnabled,
    fitBarrageRectToViewport: fitBarrageRectToViewport,
    sanitizeBarrageComments: sanitizeBarrageComments,
    shouldShowCommentBarrage: shouldShowCommentBarrage,
    stripUnsupportedEmoji: stripUnsupportedEmoji,
    wrapBarrageText: wrapBarrageText,
  };
});
