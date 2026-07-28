'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const stateApi = require('../public/platform-search-state');
const {
  createController,
} = require('../public/platform-search-ui');

const repoRoot = path.resolve(__dirname, '..');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function capabilitySnapshot() {
  return {
    schema: 1,
    providers: stateApi.PROVIDER_ORDER.map(provider => ({
      provider,
      label: provider,
      capabilities: {
        search: provider === 'netease' || provider === 'qq',
        playback: provider === 'netease' || provider === 'qq',
        playlistWrite: provider === 'netease',
        commentsRead: provider === 'netease' || provider === 'qq',
      },
      availability: {
        search: provider === 'netease' || provider === 'qq',
        playback: provider === 'netease' || provider === 'qq',
        playlistWrite: provider === 'netease',
        commentsRead: provider === 'netease' || provider === 'qq',
      },
    })),
  };
}

function record(provider, id) {
  return {
    provider,
    sourceId: id,
    title: provider + '-' + id,
    artists: [],
    album: { id: '', name: '' },
    cover: '',
    durationMs: 0,
    playable: true,
    matchHints: {},
    capabilities: { playback: true },
    providerData: provider === 'qq' ? { mid: id } : { id },
  };
}

function payload(provider, records, page) {
  return {
    schema: 1,
    query: 'Signal',
    results: records,
    pages: {
      [provider]: Object.assign({
        offset: 0,
        limit: 2,
        nextOffset: records.length,
        hasMore: false,
        total: records.length,
        failed: false,
      }, page || {}),
    },
    errors: [],
  };
}

test('search controller publishes each provider as it settles and caches capabilities', async () => {
  const netease = deferred();
  const qq = deferred();
  const requests = [];
  const updates = [];
  const controller = createController({
    stateApi,
    requestJson(url) {
      requests.push(url);
      if (url === '/api/platform/capabilities') {
        return Promise.resolve(capabilitySnapshot());
      }
      if (url.includes('provider=netease')) return netease.promise;
      if (url.includes('provider=qq')) return qq.promise;
      throw new Error('unexpected request');
    },
    onUpdate(session, meta) {
      updates.push({
        provider: meta.provider || '',
        phase: meta.phase,
        songs: session.songs.map(song => song._searchRecordKey),
      });
    },
  });

  const running = controller.search({
    query: 'Signal',
    mode: 'song',
    pageLimits: { netease: 2, qq: 2 },
  });
  await tick();
  assert.deepEqual(requests, [
    '/api/platform/capabilities',
    '/api/platform/search?q=Signal&provider=netease&limit=2&offset=0',
    '/api/platform/search?q=Signal&provider=qq&limit=2&offset=0',
  ]);

  qq.resolve(payload('qq', [record('qq', 'qq-1')]));
  await tick();
  assert.deepEqual(updates.at(-1), {
    provider: 'qq',
    phase: 'provider',
    songs: ['qq:qq-1'],
  });

  netease.resolve(payload('netease', [record('netease', 'ne-1')]));
  const result = await running;
  assert.equal(result.stale, false);
  assert.deepEqual(
    result.session.songs.map(song => song._searchRecordKey),
    ['netease:ne-1', 'qq:qq-1'],
  );

  const secondNetease = deferred();
  const secondQq = deferred();
  netease.promise = secondNetease.promise;
  qq.promise = secondQq.promise;
  const secondRun = controller.search({ query: 'Again', mode: 'song' });
  await tick();
  assert.equal(
    requests.filter(url => url === '/api/platform/capabilities').length,
    1,
  );
  secondNetease.resolve(payload('netease', []));
  secondQq.resolve(payload('qq', []));
  await secondRun;
});

test('search controller loads only next provider pages and ignores canceled responses', async () => {
  const nextPage = deferred();
  let initialDone = false;
  const requests = [];
  const controller = createController({
    stateApi,
    requestJson(url) {
      requests.push(url);
      if (url === '/api/platform/capabilities') {
        return Promise.resolve(capabilitySnapshot());
      }
      if (url.includes('provider=netease') && url.endsWith('offset=0')) {
        initialDone = true;
        return Promise.resolve(payload('netease', [
          record('netease', 'ne-1'),
          record('netease', 'ne-2'),
        ], {
          limit: 2,
          nextOffset: 2,
          hasMore: true,
          total: 4,
        }));
      }
      if (url.includes('provider=qq')) {
        return Promise.resolve(payload('qq', []));
      }
      if (url.includes('provider=netease') && url.endsWith('offset=2')) {
        return nextPage.promise;
      }
      throw new Error('unexpected request');
    },
  });

  const first = await controller.search({
    query: 'Signal',
    mode: 'song',
    pageLimits: { netease: 2, qq: 2 },
  });
  assert.equal(initialDone, true);
  assert.equal(stateApi.hasMore(first.session), true);

  const loading = controller.loadMore();
  await tick();
  assert.match(requests.at(-1), /provider=netease&limit=2&offset=2$/);
  controller.cancel();
  nextPage.resolve(payload('netease', [
    record('netease', 'ne-3'),
  ], {
    offset: 2,
    limit: 2,
    nextOffset: 3,
    hasMore: false,
    total: 3,
  }));
  const canceled = await loading;
  assert.equal(canceled.stale, true);
  assert.deepEqual(
    first.session.songs.map(song => song.id),
    ['ne-1', 'ne-2'],
  );
});

test('page loads unified search modules and exposes all platform tabs', () => {
  const html = fs.readFileSync(
    path.join(repoRoot, 'public', 'index.html'),
    'utf8',
  );
  const stateScript = html.indexOf(
    '<script src="platform-search-state.js"></script>',
  );
  const uiScript = html.indexOf(
    '<script src="platform-search-ui.js"></script>',
  );
  const firstInline = html.search(/<script>\s*try\s*\{/);

  assert.notEqual(stateScript, -1);
  assert.notEqual(uiScript, -1);
  assert.ok(stateScript < uiScript);
  assert.ok(uiScript < firstInline);
  for (const provider of stateApi.PROVIDER_ORDER) {
    assert.match(html, new RegExp('id="search-mode-' + provider + '"'));
    assert.match(html, new RegExp("setSearchMode\\('" + provider + "'\\)"));
  }
  assert.match(html, /id="search-mode-podcast"/);
});

test('page renders incremental state and gates row commands through capabilities', () => {
  const html = fs.readFileSync(
    path.join(repoRoot, 'public', 'index.html'),
    'utf8',
  );

  assert.match(html, /MineradioPlatformSearchUI\.createController/);
  assert.match(html, /renderIncrementalSearchSession/);
  assert.match(html, /platformSearchController\.search\(/);
  assert.match(html, /platformSearchController\.loadMore\(\)/);
  assert.match(html, /MineradioPlatformSearch\.actionState\(s\)/);
  assert.match(html, /actions\.play/);
  assert.match(html, /actions\.queue/);
  assert.match(html, /actions\.like/);
  assert.match(html, /actions\.collect/);
  assert.match(html, /platform-search-status/);
  assert.match(html, /仅供搜索匹配/);
  assert.doesNotMatch(
    html,
    /async function fetchMusicSearchResults\(q, mode\)/,
  );
});

test('stylesheet supports provider status, labels, metadata rows, and tab overflow', () => {
  const css = fs.readFileSync(
    path.join(repoRoot, 'public', 'styles', 'app.css'),
    'utf8',
  );

  assert.match(css, /\.platform-search-status\{/);
  assert.match(css, /\.platform-search-provider\.loading/);
  assert.match(css, /\.platform-search-provider\.error/);
  assert.match(css, /\.search-result\.metadata-only/);
  assert.match(css, /\.tag-source\.kugou/);
  assert.match(css, /\.tag-source\.qishui/);
  assert.match(css, /\.tag-source\.spotify/);
  assert.match(css, /\.search-mode-tabs\{[^}]*overflow-x:auto/);
  assert.doesNotMatch(css, /html\.simple-mode-preload #search-mode-tabs/);
  assert.doesNotMatch(css, /body\.simple-mode #search-mode-tabs/);
});

test('syntax check includes every unified search module', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'package.json'),
    'utf8',
  ));
  const check = pkg.scripts.check;

  for (const file of [
    'server/platform/search-model.js',
    'server/platform/search-aggregator.js',
    'server/platform/providers/legacy-search.js',
    'server/platform/providers/kugou-search.js',
    'server/platform/providers/qishui-search.js',
    'server/platform/providers/spotify-search.js',
    'server/routes/platform-search.js',
    'public/platform-search-state.js',
    'public/platform-search-ui.js',
  ]) {
    assert.match(check, new RegExp(
      'node --check ' + file.replace(/[/.]/g, '\\$&'),
    ));
  }
});
