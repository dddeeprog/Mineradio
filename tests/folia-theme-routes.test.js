const assert = require('node:assert/strict');
const test = require('node:test');

const { createFoliaThemeRoutes } = require('../server/routes/folia-theme');

function responseRecorder() {
  const replies = [];
  return {
    replies,
    sendJSON(_res, payload, status = 200) {
      replies.push({ payload, status });
    },
  };
}

test('Folia theme route returns cover fallback when API key is missing', async () => {
  const rec = responseRecorder();
  const routes = createFoliaThemeRoutes({
    sendJSON: rec.sendJSON,
    readRequestBody: async () => ({
      song: { name: 'Rain Song', artist: 'Sia' },
      coverColors: ['#123456', '#ffcc00'],
      settings: { apiKey: '' },
    }),
  });

  const handled = await routes.handleRoute('/api/folia/theme/generate', { method: 'POST' }, {}, new URL('http://localhost/api/folia/theme/generate'));

  assert.equal(handled, true);
  assert.equal(rec.replies[0].status, 200);
  assert.equal(rec.replies[0].payload.ok, true);
  assert.equal(rec.replies[0].payload.generated, false);
  assert.equal(rec.replies[0].payload.themeResult.source, 'fallback-cover');
  assert.equal(rec.replies[0].payload.themeResult.theme.dark.backgroundColor, '#123456');
});

test('Folia theme route calls OpenAI-compatible chat completions and sanitizes JSON content', async () => {
  let requestedUrl = '';
  let requestedBody = null;
  const rec = responseRecorder();
  const routes = createFoliaThemeRoutes({
    sendJSON: rec.sendJSON,
    readRequestBody: async () => ({
      song: { name: 'Heartbeat', artist: 'Childish Gambino' },
      lyricsLines: [{ text: 'Heartbeat' }],
      coverColors: ['#101827', '#88ccff'],
      settings: {
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'theme-model',
      },
    }),
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      requestedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '```json\n{"theme":{"dark":{"name":"AI Night","primaryColor":"#ffffff","accentColor":"#55ddff"}},"lyricFont":"mono","commentColor":"#ffeeaa"}\n```',
            },
          }],
        }),
      };
    },
  });

  await routes.handleRoute('/api/folia/theme/generate', { method: 'POST' }, {}, new URL('http://localhost/api/folia/theme/generate'));

  assert.equal(requestedUrl, 'https://api.example.com/v1/chat/completions');
  assert.equal(requestedBody.model, 'theme-model');
  assert.match(requestedBody.messages[1].content, /Heartbeat/);
  assert.equal(rec.replies[0].payload.ok, true);
  assert.equal(rec.replies[0].payload.generated, true);
  assert.equal(rec.replies[0].payload.themeResult.theme.dark.name, 'AI Night');
  assert.equal(rec.replies[0].payload.themeResult.commentColor, '#ffeeaa');
});

test('Folia theme route rejects non-POST generation requests', async () => {
  const rec = responseRecorder();
  const routes = createFoliaThemeRoutes({
    sendJSON: rec.sendJSON,
    readRequestBody: async () => ({}),
  });

  assert.equal(await routes.handleRoute('/api/folia/theme/generate', { method: 'GET' }, {}, new URL('http://localhost/api/folia/theme/generate')), true);
  assert.equal(rec.replies[0].status, 405);
  assert.equal(rec.replies[0].payload.error, 'METHOD_NOT_ALLOWED');
});
