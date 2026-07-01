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
    'node --check server.js && node --check desktop/main.js && node --check desktop/preload.js && node --check desktop/overlay-preload.js && node --check dj-analyzer.js && node --check build/after-pack.js && node --check build/verify-release-artifacts.js && node --check public/api-client.js && node --check public/storage.js && node --check public/actions.js && node --check public/performance.js && node --check public/playlist-state.js && node --check public/content-shelf-state.js && node --check public/playback-session-state.js && node --check public/home-weather-hero-state.js && node --check public/comment-barrage-state.js && node --check public/visual-cover-state.js'
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
  assert.match(html, /<script src="home-weather-hero-state\.js"><\/script>/);
  assert.match(html, /<script src="comment-barrage-state\.js"><\/script>/);
  assert.match(html, /<script src="visual-cover-state\.js"><\/script>/);
  assert.match(html, /restoreLastPlaybackSession\(\);/);
  assert.match(html, /savePlaybackSessionDebounced\('timeupdate'\);/);
});

test('main stylesheet is loaded as an external asset', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /<link rel="stylesheet" href="styles\/app\.css">/);
  assert.doesNotMatch(html, /<style>[\s\S]*<\/style>/);
  assert.match(css, /#empty-home/);
  assert.match(css, /\.home-weather-curve-card/);
  assert.match(css, /#playlist-panel/);
  assert.match(css, /#comment-barrage-layer/);
});

test('home city switch uses its own glass editor while top chip opens weather details', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /onclick="openHomeWeatherCityEditor\(event\)">切换城市<\/button>/);
  assert.match(html, /id="home-weather-city-pop"/);
  assert.match(html, /class="home-weather-city-pop home-weather-city-modal"/);
  assert.match(html, /class="home-weather-city-dialog"/);
  assert.match(html, /function openHomeWeatherCityEditor\(e\)/);
  assert.match(html, /function toggleWeatherDetailPopover\(e\)/);
  assert.match(html, /id="weather-detail-pop"/);
  assert.match(html, /chip\.addEventListener\('click', toggleWeatherDetailPopover\);/);
  assert.match(html, /id="home-weather-city-switch"/);
  assert.match(html, /function bindWeatherCityEditorControls\(\)/);
  assert.match(html, /homeBtn\.addEventListener\('click', openHomeWeatherCityEditor\);/);
  assert.match(html, /if \(e\.target === pop\) closeHomeWeatherCityEditor\(\);/);
  assert.doesNotMatch(html, /weather-city-pop[\s\S]*<input id="weather-city-input"/);
  assert.doesNotMatch(html, /\.home-weather-city-pop\{position:absolute;left:0;top:44px/);
  assert.doesNotMatch(html, /window\.prompt\(.*天气城市/s);
});

test('home weather cache and forecast UI are wired', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /HOME_WEATHER_CACHE_KEY = 'mineradio-weather-radio-cache-v1'/);
  assert.match(html, /HOME_WEATHER_FRESH_MS = 30 \* 60 \* 1000/);
  assert.match(html, /HOME_WEATHER_STALE_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(html, /function restoreCachedHomeWeatherRadio\(/);
  assert.match(html, /function saveHomeWeatherRadioCache\(/);
  assert.match(html, /function shouldRefreshHomeWeatherRadio\(/);
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /id="home-weather-forecast"/);
  assert.match(html, /id="home-weather-curve"/);
  assert.match(html, /id="home-weather-curve-gradient"/);
  assert.match(html, /id="home-weather-curve-line-glow"/);
  assert.match(html, /id="home-weather-selected-guide"/);
  assert.match(html, /id="home-weather-selected-dot"/);
  assert.match(html, /id="home-weather-hour-ticks"/);
  assert.match(html, /id="home-weather-daily"/);
  assert.match(html, /id="home-weather-metrics"/);
  assert.match(html, /id="home-weather-alert"/);
  assert.match(html, /class="home-weather-scene/);
  assert.match(html, /id="home-weather-advice"/);
  assert.match(html, /function renderHomeWeatherCurve\(/);
  assert.match(html, /function renderHomeWeatherMetrics\(/);
  assert.match(html, /function bindHomeWeatherInteractions\(/);
  assert.match(html, /buildWeatherForecastFields/);
  assert.match(html, /buildHourlyTemperatureCurve/);
  assert.match(html, /buildWeatherMetrics/);
  assert.match(html, /resolveInteractiveWeatherSelection/);
  assert.match(html, /buildWeatherAdvice/);
  assert.doesNotMatch(html, /@keyframes home-weather-rain/);
  assert.doesNotMatch(html, /\.weather-scene-rain::after/);
  assert.doesNotMatch(html, /\.home-weather-scene::after/);
  assert.doesNotMatch(html, /id="home-random-lyric"/);
  assert.doesNotMatch(html, /home-lyric-card/);
  assert.doesNotMatch(html, /Random Lyric/);
  assert.doesNotMatch(html, /if \(!emptyHomeActive\) return;\s*\n\s*loadHomeWeatherRadio\(false\);/);
});

test('comment barrage is rendered as Three.js floating text instead of DOM marquee', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var commentBarrage3D = \{/);
  assert.match(html, /function buildCommentBarrageTextMesh\(/);
  assert.match(html, /function commentBarrageVisualBasis\(/);
  assert.match(html, /function commentBarrageLyricQuaternion\(/);
  assert.match(html, /function updateCommentBarrage3D\(dt\)/);
  assert.match(html, /shouldShowCommentBarrageSafe\(song\)/);
  assert.match(html, /updateCommentBarrage3D\(dt\);/);
  assert.match(html, /stageLyrics\.group\.quaternion/);
  assert.match(html, /commentBarrageProfileWithFx\(/);
  assert.match(html, /function applyCommentBarrageFxLive\(/);
  assert.match(html, /function fitCommentBarrageMeshToViewport\(/);
  assert.doesNotMatch(html, /comment-barrage-user/);
  assert.doesNotMatch(html, /@keyframes comment-barrage-fly/);
  assert.doesNotMatch(html, /resetCommentBarrageForCurrentSong\('startup'\)/);
});

test('comment barrage requests all comments without a hard fetch cap', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const helper = fs.readFileSync(path.join(repoRoot, 'public', 'comment-barrage-state.js'), 'utf8');
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  assert.match(html, /var COMMENT_BARRAGE_FETCH_LIMIT = 0;/);
  assert.match(html, /limitParam = limit > 0 \? String\(limit\) : 'all';/);
  assert.doesNotMatch(html, /maxCount: COMMENT_BARRAGE_FETCH_LIMIT/);
  assert.doesNotMatch(helper, /Math\.min\(50/);
  assert.match(server, /function parseSongCommentLimit\(/);
  assert.doesNotMatch(server, /Math\.min\(50,\s*parseInt\(url\.searchParams\.get\('limit'\)/);
});
test('comment barrage DIY controls are wired into the visual panel', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /<label>评论大小<\/label><input id="fx-comment-size" type="range" min="0\.55" max="1\.35" step="0\.01">/);
  assert.match(html, /<label>散开范围<\/label><input id="fx-comment-spread" type="range" min="0\.7" max="1\.8" step="0\.01">/);
  assert.match(html, /<label>空间深度<\/label><input id="fx-comment-depth" type="range" min="0\.6" max="2\.2" step="0\.01">/);
  assert.match(html, /<label>评论透明<\/label><input id="fx-comment-opacity" type="range" min="0\.2" max="1" step="0\.01">/);
  assert.match(html, /<label>评论密度<\/label><input id="fx-comment-density" type="range" min="0\.55" max="3\.4" step="0\.01">/);
  assert.match(html, /<label>存在时长<\/label><input id="fx-comment-lifetime" type="range" min="0\.55" max="2\.2" step="0\.01">/);
  assert.match(html, /\['fx-comment-size','commentBarrageSize'\]/);
  assert.match(html, /\['fx-comment-spread','commentBarrageSpread'\]/);
  assert.match(html, /\['fx-comment-depth','commentBarrageDepth'\]/);
  assert.match(html, /\['fx-comment-opacity','commentBarrageOpacity'\]/);
  assert.match(html, /\['fx-comment-density','commentBarrageDensity'\]/);
  assert.match(html, /\['fx-comment-lifetime','commentBarrageLifetime'\]/);
  assert.match(html, /setRange\('fx-comment-size', fx\.commentBarrageSize\);/);
  assert.match(html, /setRange\('fx-comment-lifetime', fx\.commentBarrageLifetime\);/);
  assert.match(html, /commentBarrageDensity: 1\.35/);
  assert.match(html, /Math\.min\(14, Math\.round\(\(Number\(profile\.maxActive\) \|\| 7\) \* density\)\)/);
  assert.match(html, /commentBarrageControlValue\('commentBarrageSize'/);
  assert.match(html, /applyCommentBarrageFxLive\('diy-input'\);/);
  assert.doesNotMatch(html, /if \(\^commentBarrage.*resetCommentBarrageVisualForPreset/s);
});

test('comment barrage lifecycle uses fade opacity instead of hard cutoff', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function commentBarrageOpacityAtSafe\(/);
  assert.match(html, /commentBarrageOpacityAtSafe\([^)]*duration\)/);
  assert.match(html, /data\.expired = true;/);
  assert.doesNotMatch(html, /if \(age > duration\) \{\s*disposeCommentBarrageMesh\(mesh\);/s);
});

test('lyric style controls hot-swap the current mesh instead of replaying entry animation', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function replaceCurrentLyricMeshStyle\(/);
  assert.match(html, /refreshCurrentLyricStyle\(\) \{/);
  assert.match(html, /replaceCurrentLyricMeshStyle\(\);/);
  assert.doesNotMatch(html, /showStageLine\(stageLyrics\.currentText, true\);/);
});

test('visual cover updates are governed by preset policy', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function visualCoverStateApi\(/);
  assert.match(html, /function scheduleVisualCoverHandoff\(/);
  assert.match(html, /shouldApplyCoverTextureForPresetSafe\(/);
  assert.match(html, /shouldDebounceCoverTextureUpdateSafe\(/);
  assert.match(html, /pendingVisualCoverSource/);
  assert.match(html, /applyLatestVisualCoverForCurrentPreset\(/);
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
    /function resolveShelfLayoutPreset\(viewportLockEnabled, preset\)/
  );
  assert.match(
    html,
    /function currentShelfLayoutPreset\(\)/
  );
  assert.match(
    html,
    /function shelfReferenceCameraOrbit\(viewportLockEnabled, preset\)/
  );
  assert.match(
    html,
    /function currentShelfReferenceCameraOrbit\(\)/
  );
  assert.match(
    html,
    /function shelfRenderCameraMode\(viewportLockEnabled\)/
  );
  assert.match(
    html,
    /function currentShelfRenderCamera\(\)/
  );
  assert.match(
    html,
    /function renderSceneWithShelfOverlay\(\)/
  );
  assert.ok(
    html.indexOf('var childStates = scene.children.map(function(child)') <
      html.indexOf('shelfRoots.forEach(function(root) { root.visible = false; });'),
    'overlay render must save scene visibility before hiding shelf roots'
  );
  assert.match(
    html,
    /renderer\.clearDepth\(\);/
  );
  assert.match(
    html,
    /function updateShelfViewportReferenceCamera\(\)/
  );
  assert.match(
    html,
    /return resolveShelfLayoutPreset\(fx && fx\.shelfViewportLock, fx && fx\.preset\);/
  );
  assert.match(
    html,
    /var anchorCamera = shelfViewportLockActive\(\) \? updateShelfViewportReferenceCamera\(\) : camera;/
  );
  assert.match(
    html,
    /rc\.setFromCamera\(new THREE\.Vector2\(mx, my\), currentShelfRenderCamera\(\)\);/
  );
  assert.match(
    html,
    /getRenderRoots: function\(\)/
  );
  assert.match(
    html,
    /function shelfGroupHitVisible\(\)/
  );
  assert.match(
    html,
    /if \(!shelfGroupHitVisible\(\) \|\| !cards\.length\) return null;/
  );
  assert.doesNotMatch(
    html,
    /if \(!card \|\| !card\.mesh \|\| !card\.mesh\.visible \|\| !group \|\| !group\.visible\) return null;/
  );
  assert.doesNotMatch(
    html,
    /if \(!cards\.length \|\| !group \|\| !group\.visible\) return null;/
  );
  assert.doesNotMatch(
    html,
    /if \(!group \|\| !group\.visible \|\| !cards\.length\) return null;/
  );
  assert.match(
    html,
    /if \(shelfUsesReferenceRenderCamera\(\)\) return;/
  );
  assert.match(
    html,
    /anchorCamera\.position\.set\(/
  );
  assert.doesNotMatch(
    html,
    /quaternionInverse: anchorCamera\.quaternion\.clone\(\)\.invert\(\)/
  );
  assert.doesNotMatch(
    html,
    /mesh\.getWorldQuaternion\(shelfViewportBaseWorldQuat\);/
  );
  assert.doesNotMatch(
    html,
    /shelfViewportTargetWorldQuat\.copy\(shelfViewportCameraQuat\)\.multiply\(anchor\.quaternionInverse\)\.multiply\(shelfViewportBaseWorldQuat\);/
  );
  assert.doesNotMatch(
    html,
    /mesh\.quaternion\.copy\(shelfViewportParentWorldQuat\.invert\(\)\.multiply\(shelfViewportTargetWorldQuat\)\);/
  );
  assert.match(
    html,
    /var shelfLayoutPreset = currentShelfLayoutPreset\(\);/
  );
  assert.match(
    html,
    /var skullShelf = shouldUsePresetShelfLayout\(fx && fx\.shelfViewportLock\) && shelfLayoutPreset === SKULL_PRESET_INDEX;/
  );
  assert.match(
    html,
    /var presetShelfCameraBound = shouldBindShelfToPresetCamera\(fx && fx\.shelfViewportLock\);/
  );
  assert.match(
    html,
    /var shelfPosePreset = currentShelfLayoutPreset\(\);/
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

test('record shelf no longer exposes top or locate shortcuts', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const toolbarBlock = html.match(/var RECORD_TOOLBAR_LAYOUTS = \{[\s\S]*?\n  \};/);

  assert.doesNotMatch(html, /id="record-shelf-fab-actions"/);
  assert.doesNotMatch(html, /data-record-shelf-action="back"/);
  assert.doesNotMatch(html, /data-record-shelf-action="locate"/);
  assert.doesNotMatch(html, /data-record-shelf-action="top"/);
  assert.ok(toolbarBlock);
  assert.match(toolbarBlock[0], /key: 'back'/);
  assert.doesNotMatch(toolbarBlock[0], /key: 'top'/);
  assert.doesNotMatch(toolbarBlock[0], /key: 'locate'/);
  assert.doesNotMatch(html, /UI_HIT_SELECTOR = '[^']*#record-shelf-fab-actions/);
  assert.doesNotMatch(html, /function syncRecordShelfFabActions\(show\)/);
});
