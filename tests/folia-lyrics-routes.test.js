const assert = require('node:assert/strict');
const test = require('node:test');

const { createFoliaLyricRoutes } = require('../server/routes/folia-lyrics');

function okJson(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function okText(text) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

test('Folia QQ lyric route searches and returns playable lyric candidates', async () => {
  const writes = [];
  const calls = [];
  const routes = createFoliaLyricRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    handleQQSearch(query, limit) {
      calls.push(['search', query, limit]);
      return Promise.resolve([
        {
          id: 7,
          qqId: 7,
          mid: 'qq-mid',
          name: 'Heartbeat',
          artist: 'Childish Gambino',
          album: 'Bando Stone',
          duration: 213000,
        },
      ]);
    },
    handleQQLyric(mid, id) {
      calls.push(['lyric', mid, id]);
      return Promise.resolve({ provider: 'qq', lyric: '[00:01.00]Heartbeat', qrc: '[00:01.00]Heartbeat', source: 'qq-musicu' });
    },
  });

  const handled = await routes.handleRoute(
    '/api/folia/lyrics/qq',
    {},
    {},
    new URL('http://localhost/api/folia/lyrics/qq?query=Heartbeat%20Childish&durationMs=213000')
  );

  assert.equal(handled, true);
  assert.deepEqual(calls[0], ['search', 'Heartbeat Childish', 8]);
  assert.deepEqual(calls[1], ['lyric', 'qq-mid', '7']);
  assert.equal(writes[0].status, 200);
  assert.equal(writes[0].payload.provider, 'qq');
  assert.equal(writes[0].payload.candidates.length, 1);
  assert.equal(writes[0].payload.candidates[0].source, 'qq');
  assert.equal(writes[0].payload.candidates[0].format, 'qrc');
  assert.equal(writes[0].payload.candidates[0].lyric, '[00:01.00]Heartbeat');
});

test('Folia AMLL lyric route fetches TTML candidates by platform ids', async () => {
  const writes = [];
  const requested = [];
  const routes = createFoliaLyricRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    fetchImpl(url) {
      requested.push(String(url));
      return Promise.resolve(okText('<tt><body><div><p begin="00:01.000" end="00:02.000">Hello</p></div></body></tt>'));
    },
  });

  await routes.handleRoute(
    '/api/folia/lyrics/amll',
    {},
    {},
    new URL('http://localhost/api/folia/lyrics/amll?title=Hello&artist=A&durationMs=1000&neteaseId=123&qqMid=abc')
  );

  assert.equal(writes[0].payload.provider, 'amll');
  assert.equal(writes[0].payload.candidates.length, 2);
  assert.match(requested[0], /amll-ttml-db\.stevexmh\.net\/netease\/123\?format=ttml/);
  assert.match(requested[1], /amll-ttml-db\.stevexmh\.net\/qq\/abc\?format=ttml/);
  assert.equal(writes[0].payload.candidates[0].format, 'ttml');
  assert.match(writes[0].payload.candidates[0].lyric, /<tt>/);
});

test('Folia Kugou lyric route searches and downloads decoded LRC candidates', async () => {
  const writes = [];
  const routes = createFoliaLyricRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    fetchImpl(url) {
      const text = String(url);
      if (text.includes('mobiles.kugou.com/api/v3/search/song')) {
        return Promise.resolve(okJson({
          data: {
            info: [
              {
                album_audio_id: 88,
                songname: 'Heartbeat',
                singername: 'Childish Gambino',
                album_name: 'Bando Stone',
                duration: 213,
                hash: 'kg-hash',
              },
            ],
          },
        }));
      }
      if (text.includes('lyrics.kugou.com/v1/search')) {
        return Promise.resolve(okJson({ candidates: [{ id: 'lyric-id', accesskey: 'access-key' }] }));
      }
      if (text.includes('lyrics.kugou.com/download')) {
        return Promise.resolve(okJson({ content: Buffer.from('[00:01.00]Heartbeat').toString('base64'), contenttype: 'lrc' }));
      }
      throw new Error('unexpected url ' + text);
    },
  });

  await routes.handleRoute(
    '/api/folia/lyrics/kugou',
    {},
    {},
    new URL('http://localhost/api/folia/lyrics/kugou?query=Heartbeat%20Childish&durationMs=213000')
  );

  assert.equal(writes[0].payload.provider, 'kugou');
  assert.equal(writes[0].payload.candidates.length, 1);
  assert.equal(writes[0].payload.candidates[0].source, 'kugou');
  assert.equal(writes[0].payload.candidates[0].format, 'lrc');
  assert.equal(writes[0].payload.candidates[0].lyric, '[00:01.00]Heartbeat');
});

test('Folia lyric routes fail softly when a provider errors', async () => {
  const writes = [];
  const routes = createFoliaLyricRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    handleQQSearch() {
      throw new Error('provider down');
    },
    logErrors: false,
  });

  await routes.handleRoute(
    '/api/folia/lyrics/qq',
    {},
    {},
    new URL('http://localhost/api/folia/lyrics/qq?query=Song')
  );

  assert.equal(writes[0].status, 200);
  assert.equal(writes[0].payload.provider, 'qq');
  assert.deepEqual(writes[0].payload.candidates, []);
  assert.equal(writes[0].payload.error, 'provider down');
});
