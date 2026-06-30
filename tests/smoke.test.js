const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('maintenance baseline scripts are wired', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};

  assert.equal(
    scripts.check,
    'node --check server.js && node --check desktop/main.js && node --check desktop/preload.js && node --check desktop/overlay-preload.js && node --check dj-analyzer.js && node --check build/after-pack.js && node --check build/verify-release-artifacts.js && node --check public/api-client.js && node --check public/storage.js && node --check public/actions.js && node --check public/performance.js && node --check public/playlist-state.js && node --check public/content-shelf-state.js && node --check public/playback-session-state.js'
  );
  assert.equal(scripts['audit:prod'], 'npm audit --omit=dev');
  assert.equal(scripts.test, 'node --test tests/*.test.js');
  assert.equal(scripts['verify:artifacts'], 'node build/verify-release-artifacts.js');
  assert.equal(
    scripts['verify:release'],
    'npm run check && npm run test && npm run audit:prod && npm run build:win:dir'
  );
});

test('playback session restore script is wired', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /<script src="playback-session-state\.js"><\/script>/);
  assert.match(html, /restoreLastPlaybackSession\(\);/);
  assert.match(html, /savePlaybackSessionDebounced\('timeupdate'\);/);
});

test('development context document exists', () => {
  const docPath = path.join(repoRoot, 'docs', 'DEVELOPMENT_CONTEXT.md');
  const content = fs.readFileSync(docPath, 'utf8');

  assert.match(content, /develop\/mineradio-maintenance/);
  assert.match(content, /C:\\Users\\TomatoK\\Documents\\Playground\\Mineradio/);
});

test('independent shelf viewport lock is not tied to a single preset', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(
    html,
    /var modePart = presetLayoutBound \? mode : 'independent-mode';/
  );
  assert.match(
    html,
    /var cameraPart = presetCameraBound \? \(\(fx && fx\.shelfCameraMode\) \|\| fxDefaults\.shelfCameraMode\) : 'independent-camera';/
  );
  assert.match(
    html,
    /var presetPart = presetLayoutBound \? \(\(fx && fx\.preset\) \|\| 0\) : 'independent';/
  );
  assert.match(
    html,
    /var skullShelf = shouldUsePresetShelfLayout\(fx && fx\.shelfViewportLock\) && shouldUseSkullSafeShelfCamera\(\);/
  );
  assert.match(
    html,
    /var presetShelfCameraBound = shouldBindShelfToPresetCamera\(fx && fx\.shelfViewportLock\);/
  );
  assert.match(
    html,
    /var backgroundMotionBound = shouldBindShelfToBackgroundMotion\(fx && fx\.shelfViewportLock\);/
  );
});

test('stage shelf hides the floor mirror shadow for playlist and record views', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(
    html,
    /if \(floorMirror\) floorMirror\.visible = false;/
  );
  assert.doesNotMatch(html, /floorMirror = new THREE\.Mesh/);
  assert.doesNotMatch(html, /floorMirror\.visible = group\.visible && mode === 'stage'/);
});

test('shelf gap slider is wired into DIY controls', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /<label>歌单间隔<\/label><input id="fx-shelfgap" type="range" min="0\.55" max="1\.7" step="0\.01">/);
  assert.match(html, /\['fx-shelfgap','shelfGap'\]/);
  assert.match(html, /setRange\('fx-shelfgap', fx\.shelfGap\);/);
});

test('record shelf actions use floating round buttons above the DIY fab without back action', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /id="record-shelf-fab-actions"/);
  assert.doesNotMatch(html, /data-record-shelf-action="back"/);
  assert.match(html, /data-record-shelf-action="locate"/);
  assert.match(html, /data-record-shelf-action="top"/);
  assert.match(html, /#record-shelf-fab-actions\{position:fixed;z-index:18;right:24px;bottom:90px/);
  assert.match(html, /#record-shelf-fab-actions \.record-shelf-fab-btn\{width:54px;height:54px;border-radius:50%/);
  assert.match(html, /UI_HIT_SELECTOR = '[^']*#record-shelf-fab-actions/);
  assert.match(html, /function syncRecordShelfFabActions\(show\)/);
});
