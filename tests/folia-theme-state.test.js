const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFallbackFoliaThemeResult,
  buildFoliaThemeInput,
  foliaThemeCacheKey,
  getCachedFoliaTheme,
  normalizeFoliaThemeSettings,
  sanitizeFoliaThemeResult,
  themeResultToFxPatch,
  writeCachedFoliaTheme,
} = require('../public/folia-theme-state');

test('normalizes Folia AI theme settings without leaking invalid provider state', () => {
  const settings = normalizeFoliaThemeSettings({
    provider: 'unknown',
    apiUrl: ' https://api.deepseek.com/v1/ ',
    apiKey: '  sk-test  ',
    model: ' deepseek-chat ',
  });

  assert.equal(settings.provider, 'openai');
  assert.equal(settings.apiUrl, 'https://api.deepseek.com/v1');
  assert.equal(settings.apiKey, 'sk-test');
  assert.equal(settings.model, 'deepseek-chat');
  assert.equal(settings.hasApiKey, true);
});

test('builds a compact theme input from song metadata, lyrics and cover colors', () => {
  const input = buildFoliaThemeInput({
    song: {
      id: 101,
      name: 'Heartbeat',
      artist: 'Childish Gambino / Slom',
      album: 'Bando Stone',
      duration: 213000,
    },
    lyricsLines: [
      { text: 'I make a flirt with this new girl' },
      { text: '   ' },
      { text: 'Heartbeat' },
    ],
    coverColors: ['#aa1122', 'bad', '#03f'],
  });

  assert.equal(input.title, 'Heartbeat');
  assert.equal(input.artist, 'Childish Gambino / Slom');
  assert.equal(input.album, 'Bando Stone');
  assert.equal(input.durationSec, 213);
  assert.deepEqual(input.coverColors, ['#aa1122', '#0033ff']);
  assert.match(input.promptText, /Heartbeat/);
  assert.match(input.promptText, /I make a flirt/);
});

test('falls back to cover colors when API key is missing', () => {
  const result = buildFallbackFoliaThemeResult({
    title: 'Rain Song',
    coverColors: ['#123456', '#ffcc00'],
  });

  assert.equal(result.generated, false);
  assert.equal(result.source, 'fallback-cover');
  assert.equal(result.theme.dark.accentColor, '#ffcc00');
  assert.equal(result.theme.dark.backgroundColor, '#123456');
  assert.equal(result.commentColor, '#ffcc00');
  assert.equal(result.particleTint, '#ffcc00');
});

test('sanitizes sparse AI theme responses into a complete Mineradio theme result', () => {
  const result = sanitizeFoliaThemeResult({
    theme: {
      dark: {
        name: 'Neon Night',
        primaryColor: '#fff',
        accentColor: 'not-color',
      },
    },
    lyricFont: 'serif',
    commentColor: '#0f0',
  }, { coverColors: ['#111827', '#7dd3fc'] });

  assert.equal(result.generated, true);
  assert.equal(result.theme.dark.name, 'Neon Night');
  assert.equal(result.theme.dark.primaryColor, '#ffffff');
  assert.equal(result.theme.dark.accentColor, '#7dd3fc');
  assert.equal(result.lyricFont, 'serif-en');
  assert.equal(result.commentColor, '#00ff00');
  assert.equal(result.foliaStageTheme.dark.accentColor, '#7dd3fc');

  const patch = themeResultToFxPatch(result);
  assert.equal(patch.lyricColorMode, 'custom');
  assert.equal(patch.lyricHighlightMode, 'custom');
  assert.equal(patch.visualTintMode, 'custom');
});

test('returns cached Folia theme records before requesting AI again', () => {
  const song = { provider: 'qq', mid: '003abc', name: 'Heartbeat', artist: 'Childish Gambino' };
  const key = foliaThemeCacheKey(song);
  const cache = writeCachedFoliaTheme({}, key, { source: 'ai', theme: { dark: { accentColor: '#abcdef' } } }, 1000);

  assert.equal(key, 'qq:003abc');
  assert.equal(getCachedFoliaTheme(cache, key, 1000 + 10 * 60 * 1000).source, 'ai');
  assert.equal(getCachedFoliaTheme(cache, key, 1000 + 8 * 24 * 60 * 60 * 1000), null);
});
