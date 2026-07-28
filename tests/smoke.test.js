const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

test('maintenance baseline scripts are wired', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};

  assert.match(scripts.check, /node --check server\.js/);
  assert.match(scripts.check, /node --check server\/routes\/weather-full\.js/);
  assert.match(scripts.check, /node --check public\/home-weather-ui\.js/);
  assert.match(scripts.check, /node --check public\/weather-lively-ui\.js/);
  assert.match(scripts.check, /node --check public\/weather-lively-visuals\.js/);
  assert.match(scripts.check, /node --check public\/memory-cache-state\.js/);
  assert.equal(scripts['audit:prod'], 'npm audit --omit=dev');
  assert.match(scripts.test, /^node --test\b/);
  assert.match(scripts.test, /tests\/\*\.test\.js/);
  assert.match(scripts.test, /desktop\/\*\.test\.js/);
  assert.equal(scripts['verify:artifacts'], 'node build/verify-release-artifacts.js');
  assert.equal(
    scripts['verify:release'],
    'npm run check && npm run test && npm run audit:prod && npm run build:win:dir'
  );
  assert.ok(
    Array.isArray(pkg.build && pkg.build.files) && pkg.build.files.includes('server/**/*'),
    'Windows packaged app must include server modules required by server.js'
  );
});

test('palette helpers load before page initialization', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const helperScript = html.indexOf('<script src="palette-helpers.js"></script>');
  const firstInlineScript = html.search(/<script>\s*try\s*\{/);

  assert.notEqual(helperScript, -1);
  assert.notEqual(firstInlineScript, -1);
  assert.ok(helperScript < firstInlineScript);
});

test('complete weather route is registered in the local API server', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
  const route = fs.readFileSync(path.join(repoRoot, 'server', 'routes', 'weather-full.js'), 'utf8');

  assert.match(server, /createWeatherFullRoutes/);
  assert.match(server, /buildFullWeather/);
  assert.match(server, /weatherFullRoutes\.handleRoute\(pn, req, res, url\)/);
  assert.match(route, /pn === '\/api\/weather\/full'/);
});

test('playback session restore script is wired', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /<script src="playback-session-state\.js"><\/script>/);
  assert.match(html, /<script src="folia-fx-state\.js"><\/script>/);
  assert.match(html, /<script src="folia-lyric-match-state\.js"><\/script>/);
  assert.match(html, /<script src="folia-theme-state\.js"><\/script>/);
  assert.match(html, /<script src="weather-lively-graph\.js"><\/script>/);
  assert.match(html, /<script src="weather-lively-state\.js"><\/script>/);
  assert.match(html, /<script src="weather-lively-visuals\.js"><\/script>/);
  assert.match(html, /<script src="weather-lively-ui\.js"><\/script>/);
  assert.match(html, /<script src="home-weather-hero-state\.js"><\/script>/);
  assert.match(html, /<script src="home-weather-ui\.js"><\/script>/);
  assert.match(html, /<script src="update-preview-ui\.js"><\/script>/);
  assert.match(html, /<script src="hotkeys-ui\.js"><\/script>/);
  assert.match(html, /<script src="memory-cache-state\.js"><\/script>/);
  assert.match(html, /<script src="comment-barrage-state\.js"><\/script>/);
  assert.match(html, /<script src="comment-barrage-3d\.js"><\/script>/);
  assert.match(html, /<script src="shelf-aux-ui\.js"><\/script>/);
  assert.match(html, /<script src="visual-cover-state\.js"><\/script>/);
  assert.match(html, /<script src="local-lyric-file-state\.js"><\/script>/);
  assert.match(html, /<script src="local-media-assets\.js"><\/script>/);
  assert.match(html, /<script src="local-library\.js"><\/script>/);
  assert.match(html, /restoreLastPlaybackSession\(\);/);
  assert.match(html, /savePlaybackSessionDebounced\('timeupdate'\);/);
});

test('local lyric file inputs and the home stage distinguish TTML from LRC', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /id="file-input"[^>]*accept="[^"]*\.ttml[^"]*\.lrc/);
  assert.match(html, /lyricsTimingSource === 'local-ttml'/);
  assert.match(html, /歌词源：同目录 TTML/);
  assert.match(html, /lyricsTimingSource === 'local-lrc'/);
  assert.match(html, /歌词源：同目录 LRC/);
});

test('Folia lyric matching UI is wired into lyric source controls', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /id="lyric-source-folia"/);
  assert.match(html, /openFoliaLyricMatchModal\(\)/);
  assert.match(html, /id="folia-lyric-match-modal"/);
  assert.match(html, /id="folia-lyric-match-list"/);
  assert.match(html, /fetchFoliaLyricMatchCandidates/);
  assert.match(html, /applyFoliaLyricCandidate/);
  assert.match(html, /parseFoliaTtmlLyricText/);
  assert.match(css, /\.folia-lyric-match-modal/);
  assert.match(css, /\.folia-lyric-candidate/);
});

test('native Folia routes and settings stay wired without the visual bridge', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(pkg.scripts.check, /node --check public\/folia-fx-state\.js/);
  assert.match(pkg.scripts.check, /node --check public\/folia-lyric-match-state\.js/);
  assert.match(pkg.scripts.check, /node --check public\/folia-theme-state\.js/);
  assert.match(pkg.scripts.check, /node --check server\/routes\/folia-lyrics\.js/);
  assert.match(pkg.scripts.check, /node --check server\/routes\/folia-theme\.js/);
  assert.match(html, /mineradio-native-lyric-visualizer-v1/);
  assert.doesNotMatch(html, /MineradioFoliaBridge|pushFoliaPlaybackBridge/);
});

test('Folia AI theme generation is wired into DIY controls and local API', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  assert.match(server, /createFoliaThemeRoutes/);
  assert.match(server, /foliaThemeRoutes\.handleRoute\(pn, req, res, url\)/);
  assert.match(html, /id="folia-theme-card"/);
  assert.match(html, /id="folia-theme-api-key"/);
  assert.match(html, /saveFoliaThemeSettingsFromUi/);
  assert.match(html, /generateFoliaThemeForCurrentSong/);
  assert.match(html, /applyFoliaThemeResult/);
  assert.match(html, /foliaThemeCurrent/);
  assert.match(css, /\.folia-theme-card/);
  assert.match(css, /\.folia-theme-preview/);
});

test('native Folia mode controls replace the legacy stage DIY panel', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /id="folia-fx-card"/);
  assert.match(html, /id="native-lyric-current-mode-name"/);
  assert.match(html, /id="native-lyric-mode-controls"/);
  assert.match(html, /function renderNativeLyricModeControls\(/);
  assert.match(html, /function syncLegacyFoliaFxFromNativeConfig\(/);
  assert.doesNotMatch(html, /folia-fx-legacy-controls/);
  assert.match(css, /\.folia-fx-card/);
});

test('native Folia lyric fusion controls are wired into the 3D lyric panel', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /folia-native-lyric-state\.js/);
  assert.match(html, /folia-native-lyric-visuals\.js/);
  assert.match(html, /modes\.mineradio3d\.effect/);
  assert.match(html, /nativeLyricEffect/);
});

test('3D lyric renderer consumes native Folia lyric timing model', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /buildNativeStageLyricLine/);
  assert.match(html, /MineradioFoliaNativeLyricState/);
  assert.match(html, /nativeLyricLine/);
  assert.match(html, /buildGraphemeTimeline/);
});

test('3D lyric renderer applies native Folia visual frame values', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /foliaNativeLyricVisualsApi/);
  assert.match(html, /resolveNativeStageLyricFrame/);
  assert.match(html, /nativeVisualFrame/);
  assert.match(html, /sweepStrength/);
  assert.match(html, /particleStrength/);
});

test('3D lyric renderer excludes the retired Claddagh orbit motion path', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /resolveNativeStageLyricOrbit/);
  assert.doesNotMatch(html, /resolveCladdaghOrbit/);
  assert.doesNotMatch(html, /orbitStrength/);
  assert.doesNotMatch(html, /\['claddagh-orbit','回环'\]/);
});

test('native Folia lyrics expose translation and current-line focus to 3D stage', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /nativeLyricTranslation/);
  assert.match(html, /translationMode/);
  assert.match(html, /currentLineFocus/);
  assert.match(html, /stageLyrics\.current\.userData\.nativeLyricTranslation = nativeLine/);
});

test('Folia lyric provider routes are registered in the local API server', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  assert.match(server, /createFoliaLyricRoutes/);
  assert.match(server, /foliaLyricRoutes\.handleRoute\(pn, req, res, url\)/);
  assert.match(server, /handleQQSearch/);
  assert.match(server, /handleQQLyric/);
});

test('native lyric stage replaces the isolated Folia iframe layer', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');
  const nativeCss = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'folia-native.css'), 'utf8');

  assert.match(html, /id="native-lyric-root"/);
  assert.match(html, /registerNativeLyricRenderer\('cappella'/);
  assert.match(html, /registerNativeLyricRenderer\('fume'/);
  assert.match(nativeCss, /#native-lyric-root/);
  assert.doesNotMatch(html, /id="folia-stage-(?:root|frame|btn)"/);
  assert.doesNotMatch(css, /#folia-stage-root/);
});

test('main stylesheet is loaded as an external asset', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /<link rel="stylesheet" href="styles\/app\.css">/);
  assert.match(html, /<link rel="stylesheet" href="styles\/weather-lively\.css">/);
  assert.doesNotMatch(html, /<style>[\s\S]*<\/style>/);
  assert.match(css, /#empty-home/);
  assert.match(css, /\.home-stage-hero/);
  assert.match(css, /#playlist-panel/);
  assert.match(css, /#comment-barrage-layer/);
});

test('Lively weather dashboard UI boundary is externalized', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const livelyUi = fs.readFileSync(path.join(repoRoot, 'public', 'weather-lively-ui.js'), 'utf8');
  const livelyVisuals = fs.readFileSync(path.join(repoRoot, 'public', 'weather-lively-visuals.js'), 'utf8');
  const livelyCss = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'weather-lively.css'), 'utf8');

  assert.match(html, /window\.MineradioWeatherLivelyUi/);
  assert.match(html, /window\.MineradioWeatherLivelyVisuals/);
  assert.match(livelyUi, /MineradioWeatherLivelyUi/);
  assert.match(livelyUi, /decorateDashboard/);
  assert.match(livelyUi, /syncGraphModel/);
  assert.match(livelyUi, /syncWeatherVisual/);
  assert.match(livelyUi, /metricKey/);
  assert.match(livelyVisuals, /initWeatherVisuals/);
  assert.match(livelyVisuals, /applyWeatherVisualProfile/);
  assert.match(livelyVisuals, /setWeatherVisualReducedMotion/);
  assert.match(livelyVisuals, /disposeWeatherVisuals/);
  assert.match(livelyCss, /\.weather-lively-dashboard/);
  assert.match(livelyCss, /\.weather-lively-graph/);
  assert.match(livelyCss, /\.weather-lively-metric/);
  assert.match(livelyCss, /\.weather-lively-visual-rain-day/);
  assert.match(livelyCss, /\.weather-lively-layer-rain/);
});

test('weather ambient sound can be enabled manually from Home', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /HOME_WEATHER_AMBIENT_KEY = 'mineradio-weather-ambient-v1'/);
  assert.match(html, /id="home-weather-ambient-btn"/);
  assert.match(html, /onclick="toggleHomeWeatherAmbient\(event\)"/);
  assert.match(html, /id="home-weather-ambient-pop"/);
  assert.match(html, /id="home-weather-ambient-volume"/);
  assert.match(html, /oninput="setHomeWeatherAmbientVolume\(this\.value\)"/);
  assert.match(html, /function toggleHomeWeatherAmbient\(e\)/);
  assert.match(html, /function setHomeWeatherAmbientVolume\(value\)/);
  assert.match(html, /homeWeatherLivelyVisuals\.setWeatherAmbientSettings/);
  assert.match(css, /\.home-weather-ambient-wrap/);
  assert.match(css, /\.home-weather-ambient-pop/);
  assert.match(css, /\.home-weather-ambient-control/);
});

test('home left card enters Mineradio native dynamic lyrics', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /class="home-hero home-stage-hero"/);
  assert.match(html, /id="home-stage-cover"/);
  assert.match(html, /id="home-stage-title"/);
  assert.match(html, /id="home-stage-artist"/);
  assert.match(html, /id="home-stage-album"/);
  assert.match(html, /id="home-stage-lyric"/);
  assert.match(html, /id="home-stage-lyric-source"/);
  assert.match(html, /id="home-stage-dynamic-btn"/);
  assert.match(html, /id="home-stage-dynamic-btn" class="home-stage-action primary"/);
  assert.match(html, /onclick="enterHomeDynamicLyrics\(event\)"/);
  assert.match(html, /id="home-stage-weather-pill"/);
  assert.match(html, /data-home-radio-start/);
  assert.match(html, /id="home-weather-city-switch"/);
  assert.match(html, /function renderHomeStageHero\(/);
  assert.match(html, /function currentHomeStageLyricSourceLabel\(/);
  assert.match(css, /\.home-stage-hero\{/);
  assert.match(css, /\.home-stage-cover\{/);
  assert.match(css, /\.home-stage-action\.primary/);
  assert.doesNotMatch(html, /home-weather-dashboard/);
  assert.doesNotMatch(html, /id="home-weather-curve"/);
  assert.doesNotMatch(html, /id="home-weather-daily"/);
  assert.doesNotMatch(html, /id="home-weather-metrics"/);
});

test('home city switch uses its own glass editor while top chip opens weather details', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const homeWeatherUi = fs.readFileSync(path.join(repoRoot, 'public', 'home-weather-ui.js'), 'utf8');

  assert.match(html, /onclick="openHomeWeatherCityEditor\(event\)">切换城市<\/button>/);
  assert.match(html, /id="home-weather-city-pop"/);
  assert.match(html, /class="home-weather-city-pop home-weather-city-modal"/);
  assert.match(html, /class="home-weather-city-dialog"/);
  assert.match(html, /function openHomeWeatherCityEditor\(e\)/);
  assert.match(html, /function toggleWeatherDetailPopover\(e\)/);
  assert.match(html, /id="weather-detail-pop"/);
  assert.match(html, /id="home-weather-city-switch"/);
  assert.match(homeWeatherUi, /window\.MineradioHomeWeatherUi/);
  assert.match(homeWeatherUi, /chip\.addEventListener\('click', toggleWeatherDetailPopover\);/);
  assert.match(homeWeatherUi, /function bindWeatherCityEditorControls\(\)/);
  assert.match(homeWeatherUi, /homeBtn\.addEventListener\('click', openHomeWeatherCityEditor\);/);
  assert.match(homeWeatherUi, /if \(e\.target === pop\) closeHomeWeatherCityEditor\(\);/);
  assert.doesNotMatch(html, /function bindWeatherCityEditorControls\(\)/);
  assert.doesNotMatch(html, /weather-city-pop[\s\S]*<input id="weather-city-input"/);
  assert.doesNotMatch(html, /\.home-weather-city-pop\{position:absolute;left:0;top:44px/);
  assert.doesNotMatch(html, /window\.prompt\(.*天气城市/s);
});

test('home weather cache and lightweight controls stay wired', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const homeWeatherUi = fs.readFileSync(path.join(repoRoot, 'public', 'home-weather-ui.js'), 'utf8');

  assert.match(html, /HOME_WEATHER_CACHE_KEY = 'mineradio-weather-radio-cache-v1'/);
  assert.match(html, /HOME_WEATHER_FRESH_MS = 30 \* 60 \* 1000/);
  assert.match(html, /HOME_WEATHER_STALE_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(html, /function restoreCachedHomeWeatherRadio\(/);
  assert.match(html, /function saveHomeWeatherRadioCache\(/);
  assert.match(html, /function shouldRefreshHomeWeatherRadio\(/);
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /id="home-stage-weather-pill"/);
  assert.match(html, /id="home-stage-weather-title"/);
  assert.match(html, /id="home-stage-weather-sub"/);
  assert.match(html, /data-home-radio-start/);
  assert.match(html, /进入动态歌词/);
  assert.match(html, /window\.MineradioHomeWeatherUi\.init/);
  assert.match(homeWeatherUi, /function renderHomeWeatherCurve\(/);
  assert.match(homeWeatherUi, /function renderHomeWeatherMetrics\(/);
  assert.match(homeWeatherUi, /home-weather-curve-tab/);
  assert.match(homeWeatherUi, /home-weather-icon/);
  assert.match(homeWeatherUi, /home-weather-instrument/);
  assert.match(homeWeatherUi, /axisUnit/);
  assert.match(homeWeatherUi, /curve\.timeTicks/);
  assert.match(homeWeatherUi, /curve\.iconRow/);
  assert.match(homeWeatherUi, /curve\.valueLabels/);
  const selectedDayFunction = homeWeatherUi.match(/function selectedHomeWeatherDay[\s\S]*?function selectedHomeWeatherHourPoint/);
  assert.ok(selectedDayFunction);
  assert.match(selectedDayFunction[0], /if \(idx == null\) return null;/);
  assert.match(homeWeatherUi, /var displayPoint = selected \|\| null;/);
  assert.match(homeWeatherUi, /if \(idx == null\) return null;/);
  assert.match(homeWeatherUi, /guide\.style\.opacity = selected \? '1' : '0';/);
  assert.match(homeWeatherUi, /values\.innerHTML = selected \?/);
  assert.match(homeWeatherUi, /home-weather-value-label/);
  assert.match(homeWeatherUi, /function bindHomeWeatherInteractions\(/);
  assert.doesNotMatch(homeWeatherUi, /top:' \+ y \+ '%'/);
  assert.doesNotMatch(html, /function renderHomeWeatherCurve\(/);
  assert.doesNotMatch(html, /function renderHomeWeatherMetrics\(/);
  assert.doesNotMatch(html, /function bindHomeWeatherInteractions\(/);
  assert.match(html, /buildWeatherForecastFields/);
  assert.match(html, /buildHourlyTemperatureCurve/);
  assert.match(html, /buildWeatherCurveMetricOptions/);
  assert.match(html, /buildWeatherIconKey/);
  assert.match(html, /buildWeatherMetrics/);
  assert.match(html, /resolveInteractiveWeatherSelection/);
  assert.match(html, /buildWeatherAdvice/);
  assert.doesNotMatch(html, /id="home-weather-forecast"/);
  assert.doesNotMatch(html, /id="home-weather-curve"/);
  assert.doesNotMatch(html, /id="home-weather-curve-tabs"/);
  assert.doesNotMatch(html, /id="home-weather-daily"/);
  assert.doesNotMatch(html, /id="home-weather-metrics"/);
  assert.doesNotMatch(html, /id="home-weather-advice"/);
  assert.doesNotMatch(html, /@keyframes home-weather-rain/);
  assert.doesNotMatch(html, /\.weather-scene-rain::after/);
  assert.doesNotMatch(html, /\.home-weather-scene::after/);
  assert.doesNotMatch(html, /id="home-random-lyric"/);
  assert.doesNotMatch(html, /home-lyric-card/);
  assert.doesNotMatch(html, /Random Lyric/);
  assert.doesNotMatch(html, /if \(!emptyHomeActive\) return;\s*\n\s*loadHomeWeatherRadio\(false\);/);
});

test('home weather curve follows Lively-style layered graph contract', () => {
  const state = fs.readFileSync(path.join(repoRoot, 'public', 'home-weather-hero-state.js'), 'utf8');
  const ui = fs.readFileSync(path.join(repoRoot, 'public', 'home-weather-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(state, /baselineY:\s*82/);
  assert.match(state, /graphTopY:\s*30/);
  assert.match(state, /graphBottomY:\s*70/);
  assert.match(state, /timeTicks:\s*timeTicks/);
  assert.match(state, /iconRow:\s*iconRow/);
  assert.match(state, /valueLabels:\s*valueLabels/);
  assert.match(ui, /curve\.timeTicks \|\| curve\.points/);
  assert.match(ui, /curve\.iconRow \|\| curve\.points/);
  assert.match(ui, /curve\.valueLabels \|\| \[\]/);
  assert.match(css, /\.home-weather-curve-line\{[^}]*stroke-width:1\.25/);
  assert.match(css, /\.home-weather-curve-backdrop/);
  assert.match(css, /\.home-weather-curve-icons\{[^}]*background:/);
  assert.match(css, /\.home-weather-value-label/);
});

test('home internal clicks do not dismiss and dynamic lyrics exit is explicit', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /id="home-stage-dynamic-btn"/);
  assert.match(html, /dismissHomePage\(\{ reason: 'dynamic-lyrics-button' \}\)/);
  assert.match(html, /target\.closest\('#empty-home'\)/);
});

test('home glass is stable before SVG glass filter readiness', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');
  const homeBlock = css.match(/\.home-hero,\.home-card,\.home-tile,\.home-mosaic-cell\{[\s\S]*?\}/);

  assert.ok(homeBlock);
  assert.match(homeBlock[0], /backdrop-filter:blur\(26px\)/);
  assert.doesNotMatch(homeBlock[0], /url\(#mineradio-control-glass-filter\)/);
});

test('update preview and hotkey controllers are externalized', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const updateUi = fs.readFileSync(path.join(repoRoot, 'public', 'update-preview-ui.js'), 'utf8');
  const hotkeysUi = fs.readFileSync(path.join(repoRoot, 'public', 'hotkeys-ui.js'), 'utf8');

  assert.match(updateUi, /window\.MineradioUpdatePreviewUi/);
  assert.match(updateUi, /function renderUpdatePreviewPanel\(/);
  assert.match(updateUi, /function startRealUpdateDownload\(/);
  assert.match(hotkeysUi, /window\.MineradioHotkeysUi/);
  assert.match(hotkeysUi, /function ensureHotkeyModal\(/);
  assert.match(hotkeysUi, /function renderHotkeySettings\(/);
  assert.match(html, /window\.MineradioUpdatePreviewUi\.init/);
  assert.match(html, /window\.MineradioHotkeysUi\.init/);
  assert.match(html, /function openUpdatePanel\(\)/);
  assert.match(html, /function openHotkeySettings\(\)/);
  assert.doesNotMatch(html, /function renderUpdatePreviewPanel\(/);
  assert.doesNotMatch(html, /function startRealUpdateDownload\(/);
  assert.doesNotMatch(html, /function ensureHotkeyModal\(/);
  assert.doesNotMatch(html, /function renderHotkeySettings\(/);
});

test('hotkey helper exposes startup storage keys used by the entry script', () => {
  const hotkeysUi = fs.readFileSync(path.join(repoRoot, 'public', 'hotkeys-ui.js'), 'utf8');
  const context = { console };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(hotkeysUi, context);

  assert.equal(context.HOTKEY_SETTINGS_STORE_KEY, 'mineradio-hotkey-settings-v1');
  assert.equal(context.VISUAL_GUIDE_SEEN_STORE_KEY, 'mineradio-visual-guide-seen-v2');
  assert.equal(context.LOCAL_BEATMAP_STORE_KEY, 'mineradio-local-beatmaps-v1');
  assert.equal(context.LOCAL_BEAT_PREF_STORE_KEY, 'mineradio-local-beatmap-prefs-v1');
  assert.deepEqual(Array.from(context.LOCAL_BEAT_COMBOS), ['', 'downbeat', 'push', 'drop', 'rebound', 'accent']);
});

test('listen session finalization does not recursively start a new session', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function updateListenStatsTick\(force,\s*opts\)/);
  assert.match(html, /if \(!listenSession \|\| listenSession\.key !== key\) \{\s*if \(opts\.noAutoBegin\) return;/);
  assert.match(html, /updateListenStatsTick\(true,\s*\{ noAutoBegin: true \}\)/);
});

test('bottom playback controls default to auto hide and schedule startup collapse', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var CONTROLS_AUTO_HIDE_MIGRATION_STORE_KEY = 'mineradio-controls-auto-hide-defaulted-v2';/);
  assert.match(html, /function readControlsAutoHidePreference\(\)/);
  assert.match(html, /localStorage\.setItem\(CONTROLS_AUTO_HIDE_MIGRATION_STORE_KEY,\s*'1'\)/);
  assert.match(html, /if \(raw == null \|\| raw === '0'\) \{\s*localStorage\.setItem\(CONTROLS_AUTO_HIDE_STORE_KEY,\s*'1'\);/);
  assert.match(html, /var controlsAutoHide = readControlsAutoHidePreference\(\);/);
  assert.match(html, /if \(controlsAutoHide && bar && bar\.classList\.contains\('visible'\) && !controlsHovering\) scheduleControlsHide\(520\);/);
});

test('large queue panels render bounded windows instead of mapping the full play queue', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var QUEUE_PANEL_RENDER_LIMIT = 180;/);
  assert.match(html, /var MINI_QUEUE_RENDER_LIMIT = 96;/);
  assert.match(html, /function queueRenderItemsForWindow\(kind, limit\)/);
  assert.doesNotMatch(html, /\$list\.innerHTML = playQueue\.map\(function\(song, i\)/);
  assert.doesNotMatch(html, /\$ql\.innerHTML = playQueue\.map\(function\(song, i\)/);
});

test('search and podcast result panels render bounded batches with load more controls', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var SEARCH_RESULT_RENDER_LIMIT = 18;/);
  assert.match(html, /var SEARCH_RESULT_BATCH_SIZE = 18;/);
  assert.match(html, /var PODCAST_PANEL_RENDER_LIMIT = 24;/);
  assert.match(html, /function listRenderItems\(items, limit\)/);
  assert.match(html, /data-search-load-more="1"/);
  assert.match(html, /data-podcast-load-more="collections"/);
  assert.match(html, /data-podcast-load-more="children"/);
  assert.doesNotMatch(html, /\$results\.innerHTML = podcastResults\.map\(function\(p, i\)/);
  assert.doesNotMatch(html, /\$results\.innerHTML = playlist\.map\(function\(s, i\)/);
  assert.doesNotMatch(html, /podcastPrograms\.map\(function\(p, i\)/);
  assert.doesNotMatch(html, /\$pod\.innerHTML = items\.map\(function\(pc\)/);
});

test('media resource caches are visible in runtime snapshots and trimmed in background', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function trimLyricTextureCache\(keep\)/);
  assert.match(html, /lyricTextures: cacheCount\(lyricTextureCache\)/);
  assert.match(html, /trimLyricTextureCache\(aggressive \? 6 : 24\)/);
  assert.match(html, /memoryCacheTools\.trimMapCache/);
});

test('visual release budget releases native lyrics and low priority 3D resources', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var visualBudgetState = \{/);
  assert.match(html, /function applyVisualReleaseBudget\(reason, aggressive\)/);
  assert.match(html, /function resumeVisualReleaseBudget\(reason\)/);
  assert.match(html, /nativeLyricRuntime\.release\(reason\)/);
  assert.match(html, /nativeLyricRuntime\.resume\(\)/);
  assert.match(html, /clearCommentBarrage3D\(true\)/);
  assert.match(html, /trimLyricTextureCache\(aggressive \? 2 : 8\)/);
  assert.match(html, /visualBudget: \{/);
  assert.match(html, /applyVisualReleaseBudget\(reason \|\| 'runtime-cache-trim', true\)/);
  assert.match(html, /resumeVisualReleaseBudget\(reason \|\| 'restore'\)/);
});

test('performance diagnostics modal exposes renderer heap cache and visual budget snapshot', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /id="performance-diagnostics-btn"/);
  assert.match(html, /onclick="openPerformanceDiagnosticsModal\(\)"/);
  assert.match(html, /id="performance-diagnostics-modal"/);
  assert.match(html, /id="performance-diagnostics-summary"/);
  assert.match(html, /id="performance-diagnostics-grid"/);
  assert.match(html, /id="performance-diagnostics-raw"/);
  assert.match(html, /function collectPerformanceDiagnosticRows\(snapshot\)/);
  assert.match(html, /function renderPerformanceDiagnosticsSnapshot\(snapshot\)/);
  assert.match(html, /function openPerformanceDiagnosticsModal\(\)/);
  assert.match(html, /function copyPerformanceDiagnosticsSnapshot\(\)/);
  assert.match(html, /window\.__mineradioPerfSnapshot\(\)/);
  assert.match(html, /snapshot\.renderer/);
  assert.match(html, /snapshot\.runtime && snapshot\.runtime\.heapMB/);
  assert.match(html, /snapshot\.runtime && snapshot\.runtime\.cacheCounts/);
  assert.match(html, /snapshot\.visualBudget/);
  assert.match(html, /\['performance-diagnostics-modal', closePerformanceDiagnosticsModal\]/);
  assert.match(css, /\.performance-diagnostics-modal/);
  assert.match(css, /\.performance-diagnostics-grid/);
  assert.match(css, /\.performance-diagnostics-raw/);
});

test('local library import avoids retaining duplicate full scan and song arrays', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /localLibraryState\.songs = Array\.isArray\(songs\) \? songs\.slice\(\) : \[\];/);
  assert.doesNotMatch(html, /localLibraryState\.lastScan = scanResult \|\| null;/);
  assert.match(html, /localLibraryState\.songs = \[\];/);
  assert.match(html, /localLibraryState\.lastScan = null;/);
});

test('comment barrage is rendered as Three.js floating text instead of DOM marquee', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'public', 'comment-barrage-3d.js'), 'utf8');

  assert.match(renderer, /window\.MineradioCommentBarrage3D/);
  assert.match(renderer, /var commentBarrage3D = \{/);
  assert.match(renderer, /function buildCommentBarrageTextMesh\(/);
  assert.match(renderer, /function commentBarrageVisualBasis\(/);
  assert.match(renderer, /function commentBarrageLyricQuaternion\(/);
  assert.match(renderer, /function updateCommentBarrage3D\(dt\)/);
  assert.match(html, /window\.MineradioCommentBarrage3D\.init/);
  assert.match(html, /shouldShowCommentBarrageSafe\(song\)/);
  assert.match(html, /updateCommentBarrage3D\(dt\);/);
  assert.match(renderer, /stageLyrics\.group\.quaternion/);
  assert.match(html, /commentBarrageProfileWithFx\(/);
  assert.match(renderer, /function applyCommentBarrageFxLive\(/);
  assert.match(renderer, /function fitCommentBarrageMeshToViewport\(/);
  assert.doesNotMatch(html, /var commentBarrage3D = \{/);
  assert.doesNotMatch(html, /function buildCommentBarrageTextMesh\(/);
  assert.doesNotMatch(html, /function commentBarrageVisualBasis\(/);
  assert.doesNotMatch(html, /function commentBarrageLyricQuaternion\(/);
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
  const renderer = fs.readFileSync(path.join(repoRoot, 'public', 'comment-barrage-3d.js'), 'utf8');

  assert.match(html, /function commentBarrageOpacityAtSafe\(/);
  assert.match(renderer, /commentBarrageOpacityAtSafe\([^)]*duration\)/);
  assert.match(renderer, /data\.expired = true;/);
  assert.doesNotMatch(html, /if \(age > duration\) \{\s*disposeCommentBarrageMesh\(mesh\);/s);
  assert.doesNotMatch(renderer, /if \(age > duration\) \{\s*disposeCommentBarrageMesh\(mesh\);/s);
});

test('lyric style controls hot-swap the current mesh instead of replaying entry animation', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /function replaceCurrentLyricMeshStyle\(/);
  assert.match(html, /refreshCurrentLyricStyle\(\) \{/);
  assert.match(html, /replaceCurrentLyricMeshStyle\(\);/);
  assert.match(html, /nextMesh\.userData\.nativeLyricLine = oldUser\.nativeLyricLine/);
  assert.match(html, /nextMesh\.userData\.nativeLyricTranslation = oldUser\.nativeLyricTranslation/);
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
  const shelfAux = fs.readFileSync(path.join(repoRoot, 'public', 'shelf-aux-ui.js'), 'utf8');
  const toolbarBlock = shelfAux.match(/var RECORD_TOOLBAR_LAYOUTS = \{[\s\S]*?\n  \};/);

  assert.doesNotMatch(html, /id="record-shelf-fab-actions"/);
  assert.doesNotMatch(html, /data-record-shelf-action="back"/);
  assert.doesNotMatch(html, /data-record-shelf-action="locate"/);
  assert.doesNotMatch(html, /data-record-shelf-action="top"/);
  assert.ok(toolbarBlock);
  assert.match(shelfAux, /window\.MineradioShelfAuxUi/);
  assert.match(html, /MineradioShelfAuxUi\.getRecordToolbarLayouts/);
  assert.match(toolbarBlock[0], /key: 'back'/);
  assert.doesNotMatch(toolbarBlock[0], /key: 'top'/);
  assert.doesNotMatch(toolbarBlock[0], /key: 'locate'/);
  assert.doesNotMatch(html, /UI_HIT_SELECTOR = '[^']*#record-shelf-fab-actions/);
  assert.doesNotMatch(html, /function syncRecordShelfFabActions\(show\)/);
});

test('record shelf close animation fades in place without fixed shrink drift', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');

  assert.match(html, /var closeRetreat = isRecordClose \? 0\.045 : 0\.10;/);
  assert.doesNotMatch(html, /window\.gsap\.to\(targetGroup\.scale, \{ x: 0\.965, y: 0\.965, z: 0\.965/);
  assert.doesNotMatch(html, /x: targetGroup\.position\.x \+ 0\.18/);
});

test('Lively Weather 95 percent acceptance report is recorded', () => {
  const baseline = fs.readFileSync(path.join(repoRoot, 'docs', 'WEATHER_LIVELY_95_BASELINE.md'), 'utf8');

  assert.match(baseline, /## 最终 95% 验收记录/);
  assert.match(baseline, /总分：95\.[0-9]+\/100/);
  assert.match(baseline, /浏览器验收证据/);
  assert.match(baseline, /metricsCount: 6/);
  assert.match(baseline, /visualLayers: 2/);
  assert.match(baseline, /遗留差异/);
  assert.match(baseline, /DirectX\/Avalonia\/Win2D/);
});
