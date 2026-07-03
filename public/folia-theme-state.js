(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaThemeState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var DEFAULT_OPENAI_API_URL = 'https://api.openai.com/v1';
  var DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
  var HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  var FALLBACK_DUAL_THEME = {
    light: {
      name: 'Mineradio AI Light',
      backgroundColor: '#f8fafc',
      primaryColor: '#111827',
      accentColor: '#2563eb',
      secondaryColor: '#475569',
      fontStyle: 'sans',
      animationIntensity: 'normal',
      wordColors: [],
      lyricsIcons: [],
      provider: 'Mineradio',
    },
    dark: {
      name: 'Mineradio AI Dark',
      backgroundColor: '#0f172a',
      primaryColor: '#f8fafc',
      accentColor: '#7dd3fc',
      secondaryColor: '#cbd5e1',
      fontStyle: 'sans',
      animationIntensity: 'normal',
      wordColors: [],
      lyricsIcons: [],
      provider: 'Mineradio',
    },
  };

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, fallback) {
    return String(value == null ? (fallback || '') : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeHexColor(value, fallback, hardFallback) {
    var raw = typeof value === 'string' ? value.trim() : '';
    if (HEX_COLOR_PATTERN.test(raw)) {
      var hex = raw.slice(1).toLowerCase();
      if (hex.length === 3) hex = hex.split('').map(function(char) { return char + char; }).join('');
      return '#' + hex;
    }
    if (fallback !== undefined) return normalizeHexColor(fallback, hardFallback || '#ffffff', hardFallback || '#ffffff');
    return hardFallback || '#ffffff';
  }

  function normalizeCoverColors(value) {
    var list = Array.isArray(value) ? value : [];
    var seen = {};
    return list.map(function(color) {
      var raw = typeof color === 'string' ? color.trim() : '';
      if (!HEX_COLOR_PATTERN.test(raw)) return '';
      return normalizeHexColor(raw, '', '');
    }).filter(function(color) {
      if (!/^#[0-9a-f]{6}$/i.test(color) || seen[color]) return false;
      seen[color] = true;
      return true;
    }).slice(0, 8);
  }

  function normalizeDurationSec(value) {
    var n = Number(value) || 0;
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round((n > 1000 ? n / 1000 : n) * 100) / 100;
  }

  function artistName(song) {
    song = song || {};
    if (song.artist || song.author || song.singer) return text(song.artist || song.author || song.singer);
    var list = Array.isArray(song.artists) ? song.artists : (Array.isArray(song.ar) ? song.ar : []);
    return list.map(function(item) {
      return text(item && (item.name || item.title || item.artist || item));
    }).filter(Boolean).join(' / ');
  }

  function lyricLineText(line) {
    if (typeof line === 'string') return text(line);
    if (!line || typeof line !== 'object') return '';
    return text(line.fullText || line.text || line.content || '');
  }

  function isPureMusicLyricText(value) {
    var raw = text(value).toLowerCase();
    return !raw || /纯音乐|instrumental|music only|no lyrics|暂无歌词/.test(raw);
  }

  function buildFoliaThemeInput(input) {
    input = input || {};
    var song = input.song || {};
    var title = text(song.name || song.title || input.title || 'Mineradio');
    var artist = text(input.artist || artistName(song));
    var album = text(input.album || song.album || song.albumName || (song.al && song.al.name) || '');
    var lyrics = (Array.isArray(input.lyricsLines) ? input.lyricsLines : [])
      .map(lyricLineText)
      .filter(function(line) {
        return line && !isPureMusicLyricText(line);
      })
      .slice(0, 80)
      .join('\n');
    var coverColors = normalizeCoverColors(input.coverColors);
    var pureMusic = input.isPureMusic === true || isPureMusicLyricText(lyrics);
    var promptParts = [
      'Song: ' + title,
      artist ? 'Artist: ' + artist : '',
      album ? 'Album: ' + album : '',
      coverColors.length ? 'Cover colors: ' + coverColors.join(', ') : '',
      pureMusic ? 'This track has no reliable lyrics. Build a theme from song metadata and cover colors.' : 'Lyrics:\n' + lyrics,
    ].filter(Boolean);
    return {
      title: title,
      artist: artist,
      album: album,
      durationSec: normalizeDurationSec(song.duration || song.durationMs || song.dt || input.duration || input.durationSec || 0),
      lyricsText: lyrics,
      isPureMusic: pureMusic,
      coverColors: coverColors,
      promptText: promptParts.join('\n'),
    };
  }

  function normalizeFontStyle(value, fallback) {
    value = text(value || fallback || 'sans');
    return value === 'serif' || value === 'mono' || value === 'sans' ? value : (fallback || 'sans');
  }

  function normalizeAnimationIntensity(value, fallback) {
    value = text(value || fallback || 'normal');
    return value === 'calm' || value === 'normal' || value === 'chaotic' ? value : (fallback || 'normal');
  }

  function sanitizeWordColors(value, fallbackColor) {
    if (!Array.isArray(value)) return [];
    return value.map(function(entry) {
      if (!isRecord(entry)) return null;
      var word = text(entry.word);
      if (!word) return null;
      return { word: word, color: normalizeHexColor(entry.color, fallbackColor) };
    }).filter(Boolean).slice(0, 16);
  }

  function sanitizeIcons(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function(icon) { return text(icon); }).filter(Boolean).slice(0, 12);
  }

  function sanitizeTheme(value, fallbackTheme) {
    value = isRecord(value) ? value : {};
    fallbackTheme = fallbackTheme || FALLBACK_DUAL_THEME.dark;
    var accentColor = normalizeHexColor(value.accentColor, fallbackTheme.accentColor);
    return {
      name: text(value.name, fallbackTheme.name),
      description: text(value.description || fallbackTheme.description || ''),
      backgroundColor: normalizeHexColor(value.backgroundColor, fallbackTheme.backgroundColor),
      primaryColor: normalizeHexColor(value.primaryColor, fallbackTheme.primaryColor),
      accentColor: accentColor,
      secondaryColor: normalizeHexColor(value.secondaryColor, fallbackTheme.secondaryColor),
      fontStyle: normalizeFontStyle(value.fontStyle, fallbackTheme.fontStyle),
      animationIntensity: normalizeAnimationIntensity(value.animationIntensity, fallbackTheme.animationIntensity),
      wordColors: sanitizeWordColors(value.wordColors, accentColor),
      lyricsIcons: sanitizeIcons(value.lyricsIcons),
      provider: text(value.provider, fallbackTheme.provider || 'Mineradio'),
    };
  }

  function sanitizeDualTheme(value, fallbackTheme) {
    value = isRecord(value) ? value : {};
    fallbackTheme = fallbackTheme || FALLBACK_DUAL_THEME;
    return {
      light: sanitizeTheme(value.light, fallbackTheme.light),
      dark: sanitizeTheme(value.dark, fallbackTheme.dark),
    };
  }

  function normalizeLyricFont(value, fallback) {
    value = text(value || fallback || 'sans');
    var map = {
      serif: 'serif-en',
      mono: 'mono',
      sans: 'sans',
      hei: 'hei',
      song: 'song',
      'serif-en': 'serif-en',
      'bold-song': 'bold-song',
      'stone-song': 'stone-song',
      'kai-song': 'kai-song',
      gothic: 'gothic',
      editorial: 'editorial',
      humanist: 'humanist',
      display: 'display',
    };
    return map[value] || 'sans';
  }

  function buildCoverFallbackDualTheme(input) {
    input = input || {};
    var colors = normalizeCoverColors(input.coverColors);
    var background = colors[0] || FALLBACK_DUAL_THEME.dark.backgroundColor;
    var accent = colors[1] || colors[0] || FALLBACK_DUAL_THEME.dark.accentColor;
    var secondary = colors[2] || accent;
    var title = text(input.title || input.songTitle || 'Cover Theme');
    return {
      light: {
        name: title + ' Light',
        backgroundColor: '#f8fafc',
        primaryColor: '#111827',
        accentColor: accent,
        secondaryColor: secondary,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Mineradio Cover',
      },
      dark: {
        name: title + ' Cover',
        backgroundColor: background,
        primaryColor: '#f8fafc',
        accentColor: accent,
        secondaryColor: secondary,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Mineradio Cover',
      },
    };
  }

  function sanitizeFoliaThemeResult(value, input) {
    value = isRecord(value) ? value : {};
    input = input || {};
    var fallbackDual = buildCoverFallbackDualTheme(input);
    var dual = sanitizeDualTheme(value.theme || value.dualTheme || value.foliaStageTheme || value, fallbackDual);
    var dark = dual.dark;
    return {
      source: text(value.source, 'ai'),
      generated: value.generated === false ? false : true,
      reason: text(value.reason || ''),
      theme: dual,
      foliaStageTheme: dual,
      lyricFont: normalizeLyricFont(value.lyricFont || value.font || dark.fontStyle),
      lyricColor: normalizeHexColor(value.lyricColor, dark.primaryColor),
      lyricHighlightColor: normalizeHexColor(value.lyricHighlightColor, dark.accentColor),
      lyricGlowColor: normalizeHexColor(value.lyricGlowColor, dark.accentColor),
      backgroundColor: normalizeHexColor(value.backgroundColor, dark.backgroundColor),
      backgroundAtmosphere: text(value.backgroundAtmosphere || value.atmosphere || dark.description || ''),
      commentColor: normalizeHexColor(value.commentColor, dark.secondaryColor || dark.accentColor),
      particleTint: normalizeHexColor(value.particleTint || value.visualTintColor, dark.accentColor),
    };
  }

  function buildFallbackFoliaThemeResult(input) {
    var theme = buildCoverFallbackDualTheme(input || {});
    return sanitizeFoliaThemeResult({
      source: 'fallback-cover',
      generated: false,
      reason: 'missing-api-key',
      theme: theme,
      lyricFont: theme.dark.fontStyle,
      commentColor: theme.dark.accentColor,
      particleTint: theme.dark.accentColor,
    }, input || {});
  }

  function themeResultToFxPatch(result) {
    result = sanitizeFoliaThemeResult(result || {});
    return {
      lyricFont: result.lyricFont,
      lyricColorMode: 'custom',
      lyricColor: result.lyricColor,
      lyricHighlightMode: 'custom',
      lyricHighlightColor: result.lyricHighlightColor,
      lyricGlowLinked: false,
      lyricGlowColor: result.lyricGlowColor,
      visualTintMode: 'custom',
      visualTintColor: result.particleTint,
      backgroundColorMode: 'custom',
      backgroundColorCustom: true,
      backgroundColor: result.backgroundColor,
      commentColor: result.commentColor,
      foliaStageTheme: result.foliaStageTheme,
    };
  }

  function normalizeFoliaThemeSettings(raw) {
    raw = raw || {};
    var apiUrl = text(raw.apiUrl || raw.openaiApiUrl || DEFAULT_OPENAI_API_URL, DEFAULT_OPENAI_API_URL).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(apiUrl)) apiUrl = DEFAULT_OPENAI_API_URL;
    var apiKey = text(raw.apiKey || raw.openaiApiKey || '');
    var model = text(raw.model || raw.openaiApiModel || DEFAULT_OPENAI_MODEL, DEFAULT_OPENAI_MODEL);
    return {
      provider: 'openai',
      apiUrl: apiUrl,
      apiKey: apiKey,
      model: model,
      hasApiKey: !!apiKey,
    };
  }

  function foliaThemeCacheKey(song) {
    song = song || {};
    var provider = song.provider || song.source || song.type || 'netease';
    if (provider === 'song') provider = 'netease';
    if (provider === 'qq' || song.mid || song.songmid) return 'qq:' + text(song.mid || song.songmid || song.id || song.name || 'unknown');
    if (song.type === 'local' || song.localUrl) return 'local:' + text(song.path || song.filePath || song.name || 'unknown').toLowerCase();
    return String(provider || 'netease') + ':' + text(song.id || [song.name || song.title, artistName(song)].filter(Boolean).join('|') || 'unknown').toLowerCase();
  }

  function getCachedFoliaTheme(cache, key, now, ttlMs) {
    cache = cache || {};
    key = text(key);
    if (!key || !cache[key]) return null;
    now = Number(now) || Date.now();
    ttlMs = Number(ttlMs) || CACHE_TTL_MS;
    var entry = cache[key];
    if (!entry || !entry.themeResult || !entry.updatedAt) return null;
    if (now - Number(entry.updatedAt) > ttlMs) return null;
    return entry.themeResult;
  }

  function writeCachedFoliaTheme(cache, key, themeResult, now) {
    var next = Object.assign({}, cache || {});
    key = text(key);
    if (!key) return next;
    next[key] = {
      updatedAt: Number(now) || Date.now(),
      themeResult: sanitizeFoliaThemeResult(themeResult || {}),
    };
    return next;
  }

  return {
    CACHE_TTL_MS: CACHE_TTL_MS,
    DEFAULT_OPENAI_API_URL: DEFAULT_OPENAI_API_URL,
    DEFAULT_OPENAI_MODEL: DEFAULT_OPENAI_MODEL,
    FALLBACK_DUAL_THEME: FALLBACK_DUAL_THEME,
    buildFallbackFoliaThemeResult: buildFallbackFoliaThemeResult,
    buildFoliaThemeInput: buildFoliaThemeInput,
    foliaThemeCacheKey: foliaThemeCacheKey,
    getCachedFoliaTheme: getCachedFoliaTheme,
    normalizeCoverColors: normalizeCoverColors,
    normalizeFoliaThemeSettings: normalizeFoliaThemeSettings,
    normalizeHexColor: normalizeHexColor,
    sanitizeDualTheme: sanitizeDualTheme,
    sanitizeFoliaThemeResult: sanitizeFoliaThemeResult,
    sanitizeTheme: sanitizeTheme,
    themeResultToFxPatch: themeResultToFxPatch,
    writeCachedFoliaTheme: writeCachedFoliaTheme,
  };
});
