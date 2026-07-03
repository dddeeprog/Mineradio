const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FOLIA_LYRIC_MATCH_SOURCES,
  buildLyricMatchRequestPlan,
  calculateLyricMatchScoreDetails,
  chooseBestLyricCandidate,
  createLyricMatchTimeout,
  normalizeLyricMatchCandidate,
  normalizeLyricMatchTarget,
  sourceDisplayLabel,
} = require('../public/folia-lyric-match-state');

test('uses Folia source order while keeping current NetEase lyrics first', () => {
  assert.deepEqual(FOLIA_LYRIC_MATCH_SOURCES, ['netease-current', 'amll', 'qq', 'kugou']);

  const plan = buildLyricMatchRequestPlan({
    id: 101,
    name: 'Heartbeat',
    artist: 'Childish Gambino',
    album: 'Bando Stone',
    duration: 213,
  });

  assert.equal(plan[0].source, 'netease-current');
  assert.equal(plan[0].endpoint, '/api/lyric?id=101');
  assert.equal(plan[1].source, 'amll');
  assert.equal(plan[2].source, 'qq');
  assert.equal(plan[3].source, 'kugou');
  assert.ok(plan.every((item) => item.timeoutMs >= 3000 && item.timeoutMs <= 6000));
});

test('scores lyrics candidates by title, artist, album and duration', () => {
  const target = normalizeLyricMatchTarget({
    title: 'Heartbeat',
    artist: 'Childish Gambino / Slom',
    album: 'Bando Stone',
    duration: 213,
  });
  const good = normalizeLyricMatchCandidate({
    source: 'qq',
    title: 'Heartbeat',
    artist: 'Childish Gambino, Slom',
    album: 'Bando Stone and The New World',
    duration: 214000,
  });
  const bad = normalizeLyricMatchCandidate({
    source: 'kugou',
    title: 'Heartbreaker',
    artist: 'Other Artist',
    album: 'Other',
    duration: 260000,
  });

  const goodScore = calculateLyricMatchScoreDetails(target, good);
  const badScore = calculateLyricMatchScoreDetails(target, bad);

  assert.equal(goodScore.titleMatched, true);
  assert.equal(goodScore.artistMatched, true);
  assert.equal(goodScore.albumMatched, true);
  assert.equal(goodScore.durationMatched, true);
  assert.ok(goodScore.score >= 85);
  assert.ok(badScore.score < 65);
});

test('chooses high quality AMLL TTML over lower quality plain candidates', () => {
  const target = normalizeLyricMatchTarget({ title: 'Song', artist: 'Artist', duration: 200 });
  const best = chooseBestLyricCandidate(target, [
    { source: 'qq', title: 'Song', artist: 'Artist', duration: 200, format: 'lrc', lyric: '[00:01]Song' },
    { source: 'amll', title: 'Song', artist: 'Artist', duration: 200, format: 'ttml', lyric: '<tt>Song</tt>' },
    { source: 'kugou', title: 'Song live', artist: 'Artist', duration: 240, format: 'krc', lyric: 'Song' },
  ]);

  assert.equal(best.source, 'amll');
  assert.equal(best.format, 'ttml');
  assert.ok(best.score >= 90);
});

test('keeps unsupported providers visible as safe degraded request plan entries', () => {
  const plan = buildLyricMatchRequestPlan({ name: 'Song', artist: 'Artist', duration: 200 });
  const amll = plan.find((item) => item.source === 'amll');
  const kugou = plan.find((item) => item.source === 'kugou');

  assert.equal(sourceDisplayLabel('amll'), 'AMLL TTML');
  assert.equal(sourceDisplayLabel('kugou'), '酷狗歌词');
  assert.equal(amll.degraded, false);
  assert.equal(kugou.degraded, false);
  assert.match(amll.endpoint, /^\/api\/folia\/lyrics\/amll\?/);
  assert.match(kugou.endpoint, /^\/api\/folia\/lyrics\/kugou\?/);
});

test('creates timeout metadata for fail-soft lyric provider requests', () => {
  assert.deepEqual(createLyricMatchTimeout('qq', 4200), {
    source: 'qq',
    timeoutMs: 4200,
    fallback: [],
  });
  assert.equal(createLyricMatchTimeout('qq', -1).timeoutMs, 5000);
});
