const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'public', 'desktop-lyrics.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'docs', 'BRANCH_CONSOLIDATION_AUDIT.md'), 'utf8');

test('desktop lyrics layout settings persist through defaults, layout storage, and FX archives', () => {
  for (const source of [index]) {
    assert.match(source, /desktopLyricsRows:\s*'double'/);
    assert.match(source, /desktopLyricsAlign:\s*'center'/);
    assert.match(source, /function normalizeDesktopLyricsRows\(value\)/);
    assert.match(source, /function normalizeDesktopLyricsAlign\(value\)/);
    assert.match(source, /desktopLyricsRows:\s*desktopLyricsSchemaReady \? normalizeDesktopLyricsRows\(raw\.desktopLyricsRows\)/);
    assert.match(source, /desktopLyricsAlign:\s*desktopLyricsSchemaReady \? normalizeDesktopLyricsAlign\(raw\.desktopLyricsAlign\)/);
    assert.match(source, /desktopLyricsRows:\s*normalizeDesktopLyricsRows\(fx\.desktopLyricsRows\)/);
    assert.match(source, /desktopLyricsAlign:\s*normalizeDesktopLyricsAlign\(fx\.desktopLyricsAlign\)/);
    assert.match(source, /desktopLyricsRows:\s*normalizeDesktopLyricsRows\(Object\.prototype\.hasOwnProperty\.call\(raw, 'desktopLyricsRows'\)/);
    assert.match(source, /desktopLyricsAlign:\s*normalizeDesktopLyricsAlign\(Object\.prototype\.hasOwnProperty\.call\(raw, 'desktopLyricsAlign'\)/);
  }
});

test('FX panel exposes persisted desktop lyric row and alignment controls', () => {
  assert.match(index, /id="desktop-lyrics-rows-seg"/);
  assert.match(index, /data-desktop-lyrics-rows="single"/);
  assert.match(index, /data-desktop-lyrics-rows="double"/);
  assert.match(index, /id="desktop-lyrics-align-seg"/);
  assert.match(index, /data-desktop-lyrics-align="left"/);
  assert.match(index, /data-desktop-lyrics-align="center"/);
  assert.match(index, /data-desktop-lyrics-align="right"/);
  assert.match(index, /function updateDesktopLyricsLayoutControls\(\)/);
  assert.match(index, /updateDesktopLyricsLayoutControls\(\);/);
  assert.match(index, /setFxSectionBefore\('desktop-lyrics-rows-seg', '桌面歌词布局'\)/);
  assert.match(index, /fx\.desktopLyricsRows = normalizeDesktopLyricsRows/);
  assert.match(index, /fx\.desktopLyricsAlign = normalizeDesktopLyricsAlign/);
  assert.match(index, /saveLyricLayout\(\);\s*pushDesktopLyricsState\(true\);\s*showToast\(/s);
});

test('wallpaper mode is active in the existing guarded desktop integration', () => {
  const developmentLockBlock = index.match(/var DEVELOPMENT_LOCKED_FX = \{[\s\S]*?\n\};/);
  assert.ok(developmentLockBlock, 'development lock map is present');
  assert.doesNotMatch(developmentLockBlock[0], /wallpaperMode/);
  assert.match(index, /\['wallpaperMode', 't-wallpaperMode', '桌面壁纸模式'\]/);
  assert.doesNotMatch(index, /enabled:\s*!!fx\.wallpaperMode\s*&&\s*!isDevelopmentLockedFx\('wallpaperMode'\)/);
  assert.match(index, /wallpaperMode:\s*raw\.wallpaperMode === true/);
  assert.match(index, /wallpaperMode:\s*!!fx\.wallpaperMode/);
  assert.match(index, /updateWallpaperMode\(payload\)/);
  assert.match(index, /setWallpaperMode\(!!payload\.enabled, payload\)/);
  assert.match(index, /id="fx-wallpaperopacity"[^>]*type="range"/);
  assert.doesNotMatch(index, /id="fx-wallpaperopacity"[^>]*disabled/);
});

test('desktop lyric payload preserves normalized rows and alignment in its deduplication key', () => {
  assert.match(index, /function normalizeDesktopLyricText\(text, maxLines\)/);
  assert.match(index, /replace\(\/\\r\/g, '\\n'\)/);
  assert.match(index, /replace\(\/\[ \\t\]\+\/g, ' '\)\.trim\(\)/);
  assert.match(index, /return lines\.join\('\\n'\);/);
  assert.match(index, /rows:\s*normalizeDesktopLyricsRows\(fx\.desktopLyricsRows\)/);
  assert.match(index, /align:\s*normalizeDesktopLyricsAlign\(fx\.desktopLyricsAlign\)/);
  assert.match(index, /function desktopLyricsPayloadSignature\(payload\)/);
  assert.match(index, /payload\.rows \|\| ''/);
  assert.match(index, /payload\.align \|\| ''/);
  assert.match(index, /var key = desktopLyricsPayloadSignature\(payload\);/);
});

test('desktop overlay renderer supports multiline alignment and explicit lock control', () => {
  assert.match(overlay, /--lyric-align:center/);
  assert.match(overlay, /text-align:var\(--lyric-align\)/);
  assert.match(overlay, /transform-origin:var\(--lyric-align\)/);
  assert.match(overlay, /white-space:pre-line/);
  assert.match(overlay, /function normalizeRows\(value\)/);
  assert.match(overlay, /function normalizeAlign\(value\)/);
  assert.match(overlay, /function currentLyricLineCount\(\)/);
  assert.match(overlay, /split\(\/\\n\/\)\.filter\(Boolean\)/);
  assert.match(overlay, /height = size \* state\.lineHeight \* currentLyricLineCount\(\)/);
  assert.match(overlay, /setRootVar\('--lyric-align', state\.align\)/);
  assert.match(overlay, /id="lockToggleBtn"/);
  assert.match(overlay, /desktopOverlay\.setLyricsLockState\(/);
  assert.match(overlay, /lockToggleBtn\.textContent = locked/);
  assert.match(overlay, /lockToggleBtn && lockToggleBtn\.contains\(evt\.target\)/);
});

test('desktop overlays use one bounded adaptive scheduler instead of a permanent interval', () => {
  assert.match(index, /var desktopOverlaySyncTimer = null/);
  assert.match(index, /function desktopOverlayActive\(\)/);
  assert.match(index, /function cancelDesktopOverlaySync\(resetState\)/);
  assert.match(index, /function scheduleDesktopOverlaySync\(delay\)/);
  assert.match(index, /function desktopOverlaySyncDelay\(\)/);
  assert.match(index, /isHiddenForBackgroundOptimization\(\)/);
  assert.match(index, /desktopOverlayRenderPressureLevel\(\)/);
  assert.match(index, /scheduleDesktopOverlaySync\(desktopOverlaySyncDelay\(\)\)/);
  assert.match(index, /scheduleDesktopOverlaySync\(0\)/);
  assert.match(index, /applyDesktopLyricsState[\s\S]*?scheduleDesktopOverlaySync\(320\)/);
  assert.match(index, /applyWallpaperModeState[\s\S]*?scheduleDesktopOverlaySync\(320\)/);
  assert.doesNotMatch(index, /setInterval\(function\(\)\{\s*if \(fx && \(fx\.desktopLyrics \|\| fx\.wallpaperMode\)\) syncDesktopOverlayState\(\);\s*\}, 320\)/);
});

test('desktop overlay pressure uses defined renderer signals only', () => {
  assert.match(index, /function desktopOverlayRenderPressureLevel\(\)/);
  assert.match(index, /getRenderLoadTier\(\)/);
  assert.match(index, /renderPerfState\.fps/);
  assert.match(index, /return Math\.max\(0, Math\.min\(2, level\)\);/);
  assert.doesNotMatch(index, /getRuntimeFramePressureLevel/);
  assert.match(index, /desktopOverlaySyncDelay[\s\S]*desktopOverlayRenderPressureLevel\(\)/);
  assert.match(index, /desktopLyricsPushInterval[\s\S]*desktopOverlayRenderPressureLevel\(\)/);
});

test('desktop overlay idle cleanup preserves shared lyric lookup state and cancels pending work', () => {
  const cancelBlock = index.match(/function cancelDesktopOverlaySync\(resetState\)[\s\S]*?\n\}/);
  assert.ok(cancelBlock, 'desktop overlay cancellation helper is present');
  assert.doesNotMatch(cancelBlock[0], /lyricLineFinder/);
  assert.match(index, /if \(!desktopOverlayActive\(\)\) \{\s*cancelDesktopOverlaySync\(true\);\s*return;/);
  assert.match(index, /if \(!desktopOverlayActive\(\)\) \{\s*if \(desktopOverlaySyncTimer\) cancelDesktopOverlaySync\(true\);\s*return;/);
  assert.match(index, /onDesktopLyricsEnabledState[\s\S]*?scheduleDesktopOverlaySync\(0\)[\s\S]*?cancelDesktopOverlaySync\(true\)/);
});

test('locked overlays honor renderer pointer capture only for the lock control', () => {
  assert.match(main, /const shouldIgnore = !desktopLyricsPointerCapture;/);
  assert.doesNotMatch(main, /const shouldIgnore = locked \|\| !desktopLyricsPointerCapture;/);
  assert.match(main, /desktopLyricsState\.clickThrough !== false\) desktopLyricsPointerCapture = false/);
  assert.match(overlay, /function lockToggleUnderPointer\(evt\)/);
  assert.match(overlay, /setPointerCapture\(lockToggleUnderPointer\(evt\)\);/);
  const hoverBlock = overlay.match(/function updateHover\(evt\)[\s\S]*?\n    \}\n    function setLocked/);
  assert.ok(hoverBlock, 'overlay hover handler is present');
  assert.doesNotMatch(hoverBlock[0], /if \(isLocked\(\)\) \{[\s\S]*?setPointerCapture\(false\);/);
  assert.match(overlay, /hideInteractionHint\(\)[\s\S]{0,400}setPointerCapture\(false\)/);
});

test('branch consolidation audit records the desktop overlay migration as equivalent', () => {
  assert.match(audit, /\| `39a1ade` \| `feat: add desktop overlay renderer controls` \| 当前等价实现 \|.*布局控制.*renderer.*锁定控制.*壁纸.*调度器.*Task 10/s);
});
