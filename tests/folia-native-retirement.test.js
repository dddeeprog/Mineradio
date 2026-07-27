const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('native lyric acceptance retires the Folia iframe, bridge and stage build pipeline', () => {
  assert.doesNotMatch(html, /folia-stage-ui\.js|folia-bridge-state\.js/);
  assert.doesNotMatch(html, /id="folia-stage-(?:root|frame|btn)"/);
  assert.doesNotMatch(html, /MineradioFoliaBridge|pushFoliaPlaybackBridge|toggleFoliaStage/);
  assert.doesNotMatch(css, /#folia-stage-root|\.folia-stage-toggle/);
  assert.equal('folia:build' in pkg.scripts, false);
  assert.doesNotMatch(pkg.scripts.check, /folia-stage|folia-bridge/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'build', 'folia-stage.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'public', 'folia-stage-ui.js')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'public', 'folia-bridge-state.js')), false);
});

test('retirement keeps Folia source, multi-provider lyrics and AI theme routes', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'third_party', 'folia-major', 'src')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'server', 'routes', 'folia-lyrics.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'server', 'routes', 'folia-theme.js')), true);
  assert.match(pkg.scripts.check, /server\/routes\/folia-lyrics\.js/);
  assert.match(pkg.scripts.check, /server\/routes\/folia-theme\.js/);
  assert.match(html, /folia-lyric-match-state\.js/);
  assert.match(html, /folia-theme-state\.js/);
  assert.match(html, /id="native-lyric-root"/);
  assert.match(html, /registerNativeLyricRenderer\('fume'/);
});
