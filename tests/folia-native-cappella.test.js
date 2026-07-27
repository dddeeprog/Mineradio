const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildNativeLyricDocument, buildNativeLyricFrame } = require('../public/folia-native/state');
const {
  MAX_VISIBLE_MESSAGES,
  buildCappellaModel,
  resolveCappellaFrame,
  prepareCappellaBubbleMetrics,
  formatTimestamp,
} = require('../public/folia-native/cappella-state');
const { createObjectUrlPool } = require('../public/folia-native/cappella-assets');

function documentWithLines(lines) {
  return buildNativeLyricDocument(lines, { id: 'duet-1', title: '夜航', artist: 'Mineradio' });
}

test('Cappella assigns stable senders from TTML agents and alternates fallback lines', () => {
  const doc = documentWithLines([
    { t: 0, duration: 1, text: '右边', agentId: 'v1' },
    { t: 1, duration: 1, text: '左边', agentId: 'v2' },
    { t: 2, duration: 1, text: '还是左边', agentId: 'v2' },
    { t: 3, duration: 1, text: '合唱' },
  ]);
  const first = buildCappellaModel(doc, { seed: 'duet-1' });
  const second = buildCappellaModel(doc, { seed: 'duet-1' });
  const lyrics = first.messages.filter(message => message.kind === 'lyric');

  assert.deepEqual(first, second);
  assert.equal(lyrics[0].side, 'right');
  assert.equal(lyrics[1].side, 'left');
  assert.equal(lyrics[1].avatarIndex, lyrics[2].avatarIndex);
  assert.notEqual(lyrics[0].key, lyrics[1].key);
});

test('Cappella keeps at most twenty visible messages and marks the active row', () => {
  const lines = Array.from({ length: 32 }, (_, index) => ({
    t: index,
    duration: 1,
    text: `第 ${index + 1} 句`,
  }));
  const doc = documentWithLines(lines);
  const model = buildCappellaModel(doc, { seed: 'long-song' });
  const baseFrame = buildNativeLyricFrame(doc, { now: 26.4, lineIndex: 26, playing: true });
  const frame = resolveCappellaFrame(model, baseFrame, { maxMessages: 99, viewportHeight: 2160 });

  assert.equal(MAX_VISIBLE_MESSAGES, 20);
  assert.equal(frame.messages.length <= 20, true);
  assert.equal(frame.messages.some(message => message.role === 'active' && message.lineIndex === 26), true);
  assert.equal(frame.messages.at(-1).lineIndex, 26);
});

test('Cappella character reveal follows grapheme timing after seek', () => {
  const doc = documentWithLines([{
    t: 10,
    duration: 2,
    text: '你A✨',
    words: [
      { text: '你', t: 10, d: 0.5 },
      { text: 'A', t: 10.5, d: 0.5 },
      { text: '✨', t: 11, d: 1 },
    ],
  }]);
  const model = buildCappellaModel(doc);
  const frame = resolveCappellaFrame(model, buildNativeLyricFrame(doc, {
    now: 10.75,
    lineIndex: 0,
    playing: true,
  }), { viewportHeight: 900 });
  const active = frame.messages.find(message => message.role === 'active');

  assert.equal(active.visibleCharacterCount, 2);
  assert.equal(active.characters.join(''), '你A✨');
  assert.equal(active.timestampVisible, false);
  assert.equal(formatTimestamp(3661), '61:01');
});

test('Cappella turns interlude lines into deterministic emoji messages', () => {
  const doc = documentWithLines([
    { t: 0, duration: 2, text: '开场' },
    { t: 2, duration: 2, text: '......' },
  ]);
  const model = buildCappellaModel(doc, { seed: 'emoji-song' });
  const emoji = model.messages.find(message => message.kind === 'emoji');

  assert.ok(emoji);
  assert.match(emoji.assetUrl, /^folia-native\/assets\/cappella\/emo\//);
  assert.equal(emoji.side === 'left' || emoji.side === 'right', true);
});

test('Cappella keeps one bubble size while characters are revealed', () => {
  const line = documentWithLines([{ t: 0, duration: 2, text: '一二三四五' }]).lines[0];
  const metrics = prepareCappellaBubbleMetrics(line, {
    fontSize: 20,
    lineHeight: 28,
    maxTextWidth: 48,
    paddingX: 10,
    paddingY: 8,
    measureText: text => Array.from(text).length * 20,
  });

  assert.equal(metrics.sizes.length, line.graphemes.length + 1);
  assert.deepEqual(metrics.sizes[0], metrics.sizes.at(-1));
  assert.equal(metrics.sizes[0].width, 70);
  assert.equal(metrics.lineCount, 2);
  assert.equal(metrics.bubbleTargetTimes[0] < metrics.revealTimes[0], true);
});

test('Cappella limits lyric bubbles to one or two lines and fits oversized text', () => {
  const shortLine = documentWithLines([{ t: 0, duration: 2, text: '一二' }]).lines[0];
  const longLine = documentWithLines([{ t: 0, duration: 2, text: '一二三四五六七八九十' }]).lines[0];
  const options = {
    fontSize: 20,
    lineHeight: 28,
    maxTextWidth: 48,
    paddingX: 10,
    paddingY: 8,
    measureText: text => Array.from(text).length * 20,
  };
  const shortMetrics = prepareCappellaBubbleMetrics(shortLine, options);
  const longMetrics = prepareCappellaBubbleMetrics(longLine, options);

  assert.equal(shortMetrics.lineCount, 1);
  assert.equal(shortMetrics.fontSize, 20);
  assert.equal(longMetrics.lineCount, 2);
  assert.equal(longMetrics.fontSize < 20, true);
  assert.equal(longMetrics.sizes[0].height, longMetrics.sizes.at(-1).height);
});

test('custom Cappella object URLs are revoked as a group', () => {
  const created = [];
  const revoked = [];
  const pool = createObjectUrlPool({
    createObjectURL(blob) { const url = `blob:${blob.id}`; created.push(url); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  });

  assert.equal(pool.create({ id: 'avatar' }), 'blob:avatar');
  assert.equal(pool.create({ id: 'emoji' }), 'blob:emoji');
  pool.release();
  assert.deepEqual(revoked, created);
  assert.equal(pool.size(), 0);
});

test('Folia Cappella avatar and emoji packs ship with their original notices', () => {
  const root = path.resolve(__dirname, '..', 'public', 'folia-native', 'assets', 'cappella');
  const avatars = fs.readdirSync(path.join(root, 'avatar'));
  const emojis = fs.readdirSync(path.join(root, 'emo'));
  assert.equal(avatars.filter(name => name.endsWith('.png')).length, 15);
  assert.equal(emojis.filter(name => name.endsWith('.png')).length, 9);
  assert.equal(avatars.includes('README.md'), true);
  assert.equal(emojis.includes('README.md'), true);
});
