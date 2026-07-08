const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceNavigation = require('./source-navigation');
const repoRoot = path.resolve(__dirname, '..');

function extractFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`Function ${name} was not closed`);
}

test('normalizeSourceNavTarget accepts known source targets and defaults online', () => {
  assert.equal(sourceNavigation.normalizeSourceNavTarget('online'), 'online');
  assert.equal(sourceNavigation.normalizeSourceNavTarget('playlists'), 'playlists');
  assert.equal(sourceNavigation.normalizeSourceNavTarget('local'), 'local');
  assert.equal(sourceNavigation.normalizeSourceNavTarget('qq'), 'online');
  assert.equal(sourceNavigation.normalizeSourceNavTarget(''), 'online');
});

test('sourceNavItems returns stable online playlists and local entries', () => {
  assert.deepEqual(sourceNavigation.sourceNavItems({ localCount: 12 }), [
    { key: 'online', label: '在线', title: '打开在线搜索' },
    { key: 'playlists', label: '歌单', title: '打开在线歌单库' },
    { key: 'local', label: '本地', title: '导入本地音乐库', badge: '12' },
  ]);
});

test('sourceNavItems caps local badge count for compact UI', () => {
  assert.equal(sourceNavigation.sourceNavItems({ localCount: 1000 })[2].badge, '999+');
  assert.equal(sourceNavigation.sourceNavItems({ localCount: 0 })[2].badge, '');
});

test('activeSourceNavTarget prioritizes open panels before playback source', () => {
  assert.equal(sourceNavigation.activeSourceNavTarget({ searchOpen: true, playlistOpen: true, currentSource: 'local' }), 'online');
  assert.equal(sourceNavigation.activeSourceNavTarget({ playlistOpen: true, currentSource: 'local' }), 'playlists');
  assert.equal(sourceNavigation.activeSourceNavTarget({ currentSource: 'local' }), 'local');
  assert.equal(sourceNavigation.activeSourceNavTarget({ currentSource: 'qq' }), 'online');
});

test('source navigation UI and package checks are wired', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(html, /<script src="source-navigation\.js"><\/script>/);
  assert.match(pkg.scripts.check, /node --check public\/source-navigation\.js/);
  assert.match(html, /id="source-nav"/);
  assert.match(html, /id="source-nav-online"/);
  assert.match(html, /id="source-nav-playlists"/);
  assert.match(html, /id="source-nav-local"/);
  assert.match(css, /#source-nav/);
  assert.match(css, /\.source-nav-btn/);
});

test('sourceNavigationLocalCount reads the persisted local library snapshot', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const localCountFunction = extractFunctionBlock(html, 'sourceNavigationLocalCount');

  assert.match(localCountFunction, /readLocalLibrarySnapshot/);
  assert.doesNotMatch(localCountFunction, /localLibraryState/);
});

test('openSourceNavigation keeps online, playlist, and local entries explicit', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const openFunction = extractFunctionBlock(html, 'openSourceNavigation');

  assert.match(openFunction, /openOnlineEntry\('song'\)/);
  assert.match(openFunction, /openPlaylistPanelTab\('playlists', true\)/);
  assert.match(openFunction, /openHomeLocalImport\(\)/);
});
