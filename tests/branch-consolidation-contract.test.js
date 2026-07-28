const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('source navigation keeps online, playlists, local library, and online URL routes', () => {
  for (const id of ['source-nav-online', 'source-nav-playlists', 'source-nav-local']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /\/api\/qq\/song\/url/);
  assert.match(html, /\/api\/song\/url/);
});

test('unified player retains local library and desktop state modules', () => {
  const modules = [
    'public/local-library.js',
    'public/local-media-assets.js',
    'public/local-beat-cache.js',
    'desktop/local-assets.js',
    'desktop/shell-state.js',
    'desktop/overlay-state.js',
  ];

  for (const modulePath of modules) {
    assert.equal(fs.existsSync(path.join(repoRoot, modulePath)), true, `missing ${modulePath}`);
  }
});

test('native Folia runtime remains while the retired stage build stays absent', () => {
  assert.doesNotMatch(html, /folia-native-stage-(?:state|renderers|ui)\.js/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'public', 'folia-native', 'runtime.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'build', 'folia-stage.js')), false);
});

test('release and verification scripts remain available', () => {
  for (const script of ['check', 'test', 'test:visual', 'verify:artifacts', 'build:win:dir']) {
    assert.equal(typeof packageJson.scripts[script], 'string', `missing ${script} script`);
    assert.notEqual(packageJson.scripts[script].trim(), '', `empty ${script} script`);
  }
});
