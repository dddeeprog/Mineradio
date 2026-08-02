'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(
  repoRoot,
  'public',
  'playback-source-match-state.js',
);
const matcher = fs.existsSync(modulePath) ? require(modulePath) : null;

test('cross-provider source matching is isolated behind one browser module', () => {
  assert.ok(matcher);
  assert.equal(typeof matcher.normalizeMatchText, 'function');
  assert.equal(typeof matcher.artistNameParts, 'function');
  assert.equal(typeof matcher.isSameTitleArtist, 'function');

  assert.equal(matcher.isSameTitleArtist(
    { name: 'Signal (Official Audio)', artist: 'Artist A' },
    { title: 'SIGNAL', artists: [{ name: 'artist a' }] },
  ), true);
});

test('playback page delegates provider candidate matching to the module', () => {
  const page = fs.readFileSync(
    path.join(repoRoot, 'public', 'index.html'),
    'utf8',
  );
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'package.json'),
    'utf8',
  ));

  assert.match(page, /<script src="playback-source-match-state\.js"><\/script>/);
  assert.match(page, /MineradioPlaybackSourceMatch/);
  assert.match(page, /matcher\.isSameTitleArtist\(song, list\[i\]\)/);
  assert.match(
    packageJson.scripts.check,
    /node --check public\/playback-source-match-state\.js/,
  );
});

test('version-qualified titles only match the same playback version', () => {
  const cases = [
    ['Signal (Live)', 'Signal', false],
    ['Signal (Live)', 'SIGNAL（LIVE VERSION）', true],
    ['Signal（Remix）', 'Signal', false],
    ['Signal（Remix）', 'SIGNAL [REMIX]', true],
    ['Signal (Acoustic)', 'Signal', false],
    ['Signal (Acoustic)', 'signal【ACOUSTIC VERSION】', true],
    ['Signal（伴奏）', 'Signal', false],
    ['Signal（伴奏）', 'SIGNAL (Instrumental)', true],
    ['Signal', 'SIGNAL', true],
  ];

  cases.forEach(([sourceTitle, candidateTitle, expected]) => {
    assert.equal(
      matcher.isSameTitleArtist(
        { name: sourceTitle, artist: 'Artist A' },
        { title: candidateTitle, artists: [{ name: 'artist a' }] },
      ),
      expected,
      `${sourceTitle} -> ${candidateTitle}`,
    );
  });
});

test('artist matching requires the same normalized artist set', () => {
  const source = {
    name: 'Signal',
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
  };

  assert.equal(matcher.isSameTitleArtist(source, {
    title: 'SIGNAL',
    artist: 'artist b / ARTIST A',
  }), true);
  assert.equal(matcher.isSameTitleArtist(source, {
    title: 'Signal',
    artist: 'Artist A',
  }), false);
  assert.equal(matcher.isSameTitleArtist(source, {
    title: 'Signal',
    artist: 'Artist A & Artist C',
  }), false);
});
