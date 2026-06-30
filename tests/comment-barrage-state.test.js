const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assignBarrageTrack,
  commentBarrageCommentsUrl,
  commentBarrageLaneOffset,
  commentBarrageLimit,
  commentBarrageMotionBinding,
  commentBarrageOpacityAt,
  commentBarrageSongKey,
  commentBarrageTextStyle,
  commentBarrageVisualProfile,
  commentBarrageControlBounds,
  fitBarrageRectToViewport,
  normalizeCommentBarrageEnabled,
  sanitizeBarrageComments,
  shouldShowCommentBarrage,
  stripUnsupportedEmoji,
  wrapBarrageText,
} = require('../public/comment-barrage-state');

test('normalizes comment barrage enabled state as off by default', () => {
  assert.equal(normalizeCommentBarrageEnabled(undefined), false);
  assert.equal(normalizeCommentBarrageEnabled(null), false);
  assert.equal(normalizeCommentBarrageEnabled('0'), false);
  assert.equal(normalizeCommentBarrageEnabled(false), false);
  assert.equal(normalizeCommentBarrageEnabled('1'), true);
  assert.equal(normalizeCommentBarrageEnabled(true), true);
});

test('builds stable song keys for supported providers only', () => {
  assert.equal(commentBarrageSongKey({ id: 123, provider: 'netease' }), 'netease:123');
  assert.equal(commentBarrageSongKey({ mid: 'abc', provider: 'qq' }), 'qq:abc');
  assert.equal(commentBarrageSongKey({ id: 'abc', type: 'qq' }), 'qq:abc');
  assert.equal(commentBarrageSongKey({ type: 'local', name: 'Local' }), '');
  assert.equal(commentBarrageSongKey({ type: 'podcast', id: 1 }), '');
});

test('selects the correct comments endpoint for netease and QQ songs', () => {
  assert.equal(commentBarrageLimit(), 0);
  assert.equal(commentBarrageLimit(5000), 5000);
  assert.equal(
    commentBarrageCommentsUrl({ id: 123, provider: 'netease' }),
    '/api/song/comments?id=123&limit=all'
  );
  assert.equal(
    commentBarrageCommentsUrl({ id: 77, qqId: 88, mid: 'abc', provider: 'qq' }, 12),
    '/api/qq/song/comments?id=88&mid=abc&limit=12'
  );
  assert.equal(commentBarrageCommentsUrl({ type: 'local', id: 1 }, 15), '');
});

test('cleans, deduplicates and limits comments for barrage display', () => {
  const longText = '这首歌的氛围从第一秒开始就慢慢铺开，后面那一下鼓点进来的时候特别漂亮';
  const comments = sanitizeBarrageComments([
    { id: 1, content: ' 好听！ ', user: { nickname: 'A' }, likedCount: 20 },
    { id: 2, content: '好听！', user: { nickname: 'B' }, likedCount: 10 },
    { id: 3, content: '第一行\n第二行', user: { nickname: 'C' } },
    { id: 4, content: longText, user: { nickname: 'D' } },
    { id: 5, content: '' },
  ], { maxCount: 4, maxLength: 120 });

  assert.deepEqual(comments.map((item) => item.text), ['好听！', '第一行 第二行', longText]);
  assert.equal(Object.prototype.hasOwnProperty.call(comments[0], 'user'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(comments[0], 'likedCount'), false);
  assert.equal(comments.length, 3);
});

test('does not cap sanitized barrage comments unless an explicit max count is provided', () => {
  const raw = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, content: `评论 ${i + 1}` }));
  const comments = sanitizeBarrageComments(raw, { maxLength: 120 });
  const limited = sanitizeBarrageComments(raw, { maxCount: 7, maxLength: 120 });

  assert.equal(comments.length, 80);
  assert.equal(limited.length, 7);
});
test('filters comments that would need ellipsis instead of clipping them', () => {
  const overlong = '这段评论真的非常非常非常非常非常非常非常非常非常非常非常非常非常非常长，放进三维空间会挡住歌词和其他评论';
  const comments = sanitizeBarrageComments([
    { id: 1, content: overlong },
    { id: 2, content: '短一点，刚刚好' },
  ], { maxCount: 5, maxLength: 26 });

  assert.deepEqual(comments.map((item) => item.text), ['短一点，刚刚好']);
  assert.ok(comments.every((item) => !item.text.includes('…')));
});

test('filters unsupported emoji from comment text before rendering', () => {
  assert.equal(stripUnsupportedEmoji('这句真好听🔥🙂，像星星✨'), '这句真好听，像星星');
  const comments = sanitizeBarrageComments([
    { id: 1, content: '开头的鼓点太绝了🔥🔥' },
    { id: 2, content: '🙂' },
  ]);
  assert.deepEqual(comments.map((item) => item.text), ['开头的鼓点太绝了']);
});

test('wraps long barrage comments instead of forcing a single clipped line', () => {
  const lines = wrapBarrageText('这首歌的氛围从第一秒开始就慢慢铺开，后面那一下鼓点进来的时候特别漂亮', {
    maxCharsPerLine: 14,
    maxLines: 3,
  });
  assert.ok(lines.length > 1);
  assert.ok(lines.join('').includes('鼓点'));
  assert.ok(lines.every((line) => line.length <= 14));
});

test('only displays comment barrage while a supported song is actually playing', () => {
  const song = { id: 123, provider: 'netease' };
  assert.equal(shouldShowCommentBarrage(song, { playing: false, audioActive: false }), false);
  assert.equal(shouldShowCommentBarrage(song, { playing: true, audioActive: false }), true);
  assert.equal(shouldShowCommentBarrage({ type: 'local', id: 1 }, { playing: true }), false);
  assert.equal(shouldShowCommentBarrage(null, { playing: true }), false);
});

test('assigns barrage tracks within the visible lane limit', () => {
  assert.equal(assignBarrageTrack(0, 5), 0);
  assert.equal(assignBarrageTrack(4, 5), 4);
  assert.equal(assignBarrageTrack(5, 5), 0);
  assert.equal(assignBarrageTrack(8, 3), 2);
  assert.equal(assignBarrageTrack(2, 0), 0);
});

test('provides a 3D floating comment visual profile for every preset', () => {
  const emily = commentBarrageVisualProfile(0);
  const tunnel = commentBarrageVisualProfile(1);
  const planet = commentBarrageVisualProfile(2);
  const voidPreset = commentBarrageVisualProfile(3);
  const vinyl = commentBarrageVisualProfile(4);
  const galaxy = commentBarrageVisualProfile(5);
  const requiem = commentBarrageVisualProfile(6);

  assert.equal(emily.kind, 'lyric-cloud');
  assert.equal(tunnel.kind, 'tunnel-echo');
  assert.equal(planet.kind, 'orbital');
  assert.equal(voidPreset.kind, 'void-whisper');
  assert.equal(vinyl.kind, 'groove');
  assert.equal(galaxy.kind, 'starfield');
  assert.equal(requiem.kind, 'requiem');
  assert.equal(commentBarrageVisualProfile(99).kind, 'lyric-cloud');
  for (const profile of [emily, tunnel, planet, voidPreset, vinyl, galaxy, requiem]) {
    assert.equal(profile.renderer, 'three-text-plane');
  assert.ok(profile.maxActive >= 7 && profile.maxActive <= 10);
    assert.ok(profile.durationSec >= 6);
    assert.ok(profile.opacity > 0 && profile.opacity <= 1);
    assert.ok(profile.scale <= 0.38);
    assert.ok(profile.spreadX >= 5.2);
    assert.ok(profile.spreadY >= 2.55);
    assert.ok(profile.spreadZ >= 1.80);
    assert.ok(profile.spaceDepth >= 1.80);
    assert.ok(profile.lyricSafeY >= 1.04);
  }
});

test('places simultaneous comments on separated lanes outside the lyric center', () => {
  const profile = commentBarrageVisualProfile(0);
  const offsets = Array.from({ length: 14 }, (_, i) => commentBarrageLaneOffset(i, 14, profile));
  const sortedY = offsets.map((item) => item.y).sort((a, b) => a - b);
  assert.ok(offsets.every((item) => Math.abs(item.y) >= profile.lyricSafeY));
  assert.ok(new Set(offsets.map((item) => Math.round(item.z * 100))).size >= 3);
  for (let i = 1; i < sortedY.length; i++) {
    assert.ok(Math.abs(sortedY[i] - sortedY[i - 1]) >= 0.36);
  }
  assert.ok(new Set(offsets.map((item) => item.lane)).size >= 14);
});

test('fits projected comments back into the visible viewport and away from lyrics', () => {
  const viewport = { width: 1920, height: 1080 };
  const result = fitBarrageRectToViewport(
    { left: 1840, top: 490, width: 360, height: 90 },
    viewport,
    {
      margin: 64,
      lyricRect: { left: 610, top: 420, width: 700, height: 240 },
    }
  );

  assert.equal(result.changed, true);
  assert.ok(result.left + result.width <= viewport.width - 64 + 0.001);
  assert.ok(result.top >= 64);
  assert.ok(result.scale <= 1);

  const lyricCollision = fitBarrageRectToViewport(
    { left: 820, top: 500, width: 300, height: 80 },
    viewport,
    {
      margin: 64,
      lyricRect: { left: 610, top: 420, width: 700, height: 240 },
    }
  );
  assert.equal(lyricCollision.changed, true);
  assert.ok(
    lyricCollision.top + lyricCollision.height <= 420 ||
      lyricCollision.top >= 660
  );
});

test('uses smaller comment text styles than lyric-scale text', () => {
  const single = commentBarrageTextStyle(1);
  const multi = commentBarrageTextStyle(3);
  assert.ok(single.fontSize >= 42);
  assert.ok(multi.fontSize >= 37);
  assert.ok(multi.lineHeight >= 46);
});

test('fades comment barrage opacity in and out over its lifetime', () => {
  assert.equal(commentBarrageOpacityAt(-1, 12), 0);
  assert.equal(commentBarrageOpacityAt(0, 12), 0);
  assert.ok(commentBarrageOpacityAt(0.35, 12) > 0 && commentBarrageOpacityAt(0.35, 12) < 1);
  assert.equal(commentBarrageOpacityAt(2, 12), 1);
  assert.ok(commentBarrageOpacityAt(11.35, 12) > 0 && commentBarrageOpacityAt(11.35, 12) < 1);
  assert.equal(commentBarrageOpacityAt(12, 12), 0);
});

test('binds 3D comment rotation to the lyric plane while staying in the visual world', () => {
  const binding = commentBarrageMotionBinding();
  assert.equal(binding.anchor, 'visual-world');
  assert.equal(binding.billboard, 'lyric-rotation');
  assert.equal(binding.rotation, 'lyric');
});

test('provides DIY bounds for comment barrage controls', () => {
  assert.deepEqual(commentBarrageControlBounds('commentBarrageSize'), { min: 0.55, max: 1.35, fallback: 1 });
  assert.deepEqual(commentBarrageControlBounds('commentBarrageSpread'), { min: 0.7, max: 1.8, fallback: 1 });
  assert.deepEqual(commentBarrageControlBounds('commentBarrageDepth'), { min: 0.6, max: 2.2, fallback: 1 });
  assert.deepEqual(commentBarrageControlBounds('commentBarrageOpacity'), { min: 0.2, max: 1, fallback: 1 });
  assert.deepEqual(commentBarrageControlBounds('commentBarrageDensity'), { min: 0.55, max: 3.4, fallback: 1.35 });
  assert.deepEqual(commentBarrageControlBounds('commentBarrageLifetime'), { min: 0.55, max: 2.2, fallback: 1 });
});
