const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'folia-native.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const cappellaRenderer = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'cappella.js'), 'utf8');
const adaptiveThree = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'adaptive-three.js'), 'utf8');
const classicThreeRenderer = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'classic-three.js'), 'utf8');

function extractPageFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing page function ${name}`);
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated page function ${name}`);
}

function classicRegistrationSource() {
  const start = html.indexOf("registerNativeLyricRenderer('classic'");
  const end = html.indexOf("registerNativeLyricRenderer('cadenza'", start);
  assert.notEqual(start, -1, 'missing public Classic registration');
  assert.notEqual(end, -1, 'missing registration after Classic');
  return html.slice(start, end);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('page loads native lyric runtime and exposes a dedicated stage root', () => {
  for (const file of [
    'vendor/pretext-0.0.7.iife.min.js',
    'folia-native/config.js',
    'folia-native/state.js',
    'folia-native/layout.js',
    'folia-native/registry.js',
    'folia-native/runtime.js',
    'folia-native/three/performance-budget.js',
    'folia-native/three/glyph-atlas.js',
    'folia-native/three/material-pool.js',
    'folia-native/three/glyph-batch.js',
    'folia-native/three/block-plane.js',
    'folia-native/three/host.js',
    'folia-native/renderers/mineradio-3d.js',
  ]) assert.match(html, new RegExp(file.replace(/[./-]/g, value => `\\${value}`)));

  assert.match(html, /id="native-lyric-root"/);
  assert.match(html, /id="native-lyric-live"[^>]+role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.match(html, /styles\/folia-native\.css/);
  assert.match(css, /#native-lyric-root/);
  assert.match(css, /#native-lyric-live/);
  const threeAdapter = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'mineradio-3d.js'), 'utf8');
  assert.match(threeAdapter, /captureTransition:/);
  assert.match(html, /captureNative3DLyricTransition/);
});

test('preset settings expose all eight native lyric modes in Chinese', () => {
  const labels = ['Mineradio 3D', '流光', '心象', '云阶', '倾诉', '莫奈', '群唱', '浮名'];
  assert.match(html, /id="native-lyric-mode-grid"/);
  for (const label of labels) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /function setNativeLyricMode\(/);
  assert.match(html, /function renderNativeLyricModeControls\(/);
});

test('native lyric config persists, rebuilds documents on lyric changes and updates from main animate', () => {
  assert.match(html, /mineradio-native-lyric-visualizer-v1/);
  assert.match(html, /function refreshNativeLyricDocument\(/);
  assert.match(html, /refreshNativeLyricDocument\('lyrics-state'\)/);
  assert.match(html, /refreshNativeLyricDocument\('custom-lyrics-state'\)/);
  assert.match(html, /function updateNativeLyricRuntime\(/);
  assert.match(html, /updateNativeLyricRuntime\(dt\)/);
  assert.match(html, /updateNativeLyricRuntime\(dt\);[\s\S]{0,500}renderSceneWithShelfOverlay\(\);/);
  assert.doesNotMatch(html, /if \(nativeLyricModeIs3D\(\)\) renderSceneWithShelfOverlay\(\);/);
  assert.match(html, /NATIVE_LYRIC_THREE_4K_PIXEL_BUDGET = 1920 \* 1080/);
  assert.match(html, /nativeLyricThreeRenderBudget\(cssPixels\)/);
  assert.doesNotMatch(html, /renderer\.domElement\.style\.visibility = visible \? 'visible' : 'hidden'/);
  assert.doesNotMatch(html, /renderer\.domElement\.style\.pointerEvents = visible \? 'auto' : 'none'/);
});

test('user visual archive schema 3 includes sanitized native lyric settings', () => {
  assert.match(html, /USER_FX_ARCHIVE_SCHEMA = 3/);
  assert.match(html, /nativeLyrics:/);
  assert.match(html, /toArchiveNativeLyricConfig/);
  assert.match(html, /applyNativeLyricConfig/);
});

test('Cappella renderer is lazy-registered with native assets and styles', () => {
  assert.match(html, /registerNativeLyricRenderer\('cappella'/);
  assert.match(html, /folia-native\/renderers\/cappella\.js/);
  assert.match(css, /\.native-cappella-stage/);
  assert.match(css, /\.native-cappella-message/);
  assert.match(css, /\.native-cappella-character/);
  assert.match(html, /function importNativeCappellaAssets\(/);
  assert.match(html, /mineradio-cappella-assets-changed/);
  assert.match(html, /container\.appendChild\(nativeCappellaAssetControl\('emoji'\)\)/);
  assert.doesNotMatch(html, /container\.appendChild\(nativeCappellaAssetControl\('avatar'\)\)/);
  assert.doesNotMatch(cappellaRenderer, /customAvatarUrls/);
  assert.doesNotMatch(cappellaRenderer, /createElement\(message\.avatarUrl \? 'img'/);
  assert.match(css, /--cappella-glass-filter/);
});

test('Classic is a lazy adaptive Three renderer while Partita and Tilt remain DOM renderers', () => {
  const registration = classicRegistrationSource();
  const loaderStart = registration.indexOf('[');
  const loaderEnd = registration.indexOf(']', loaderStart);
  const loaderOrder = Array.from(registration.slice(loaderStart + 1, loaderEnd).matchAll(/'([^']+)'/g), match => match[1]);
  assert.deepEqual(loaderOrder, [
    'folia-native/dom-state.js',
    'folia-native/classic-three-groups.js',
    'folia-native/classic-three-motion.js',
    'folia-native/classic-three-state.js',
    'folia-native/three/spark-field.js',
    'folia-native/renderers/shared-dom.js',
    'folia-native/renderers/classic.js',
    'folia-native/renderers/adaptive-three.js',
    'folia-native/renderers/classic-three.js',
  ]);
  assert.match(registration, /getTypography\s*:\s*nativeClassicLyricTypography/);
  assert.match(registration, /measureText\s*:\s*nativeClassicLyricMeasureText/);
  assert.match(registration, /getParallax\s*:\s*nativeClassicLyricParallax/);
  assert.match(registration, /THREE\s*:\s*THREE/);
  assert.match(html, /MineradioNativeLyricClassicThree/);
  assert.match(html, /createClassicThreeRenderer/);
  assert.equal((html.match(/registerNativeLyricRenderer\('classic'/g) || []).length, 1);
  assert.match(adaptiveThree, /backendFallbackCount/);
  assert.doesNotMatch(classicThreeRenderer, /Noto Sans SC/);
  assert.match(classicThreeRenderer, /fontFamily:\s*typography\.fontFamily/);
  assert.match(html, /function createNativeThreeLyricHost\(/);

  for (const mode of ['partita', 'tilt']) {
    assert.match(html, new RegExp(`registerNativeLyricRenderer\\('${mode}'`));
    assert.match(html, new RegExp(`folia-native/renderers/${mode}\\.js`));
    assert.match(css, new RegExp(`\\.native-dom-lyric-stage\\.is-${mode}`));
  }
  assert.match(css, /\.native-dom-lyric-stage\.is-classic/);
  assert.match(css, /\.native-classic-ripple/);
  assert.match(css, /\.native-partita-guide/);
  assert.match(css, /\.native-tilt-segment\.is-emphasis/);
  const sharedDom = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'shared-dom.js'), 'utf8');
  assert.match(sharedDom, /function captureTransition\(/);
  assert.match(sharedDom, /is-transition-capture/);
  assert.match(sharedDom, /is-large-surface/);
  assert.match(sharedDom, /currentModelKey/);
  assert.match(sharedDom, /model\.chorusRipple/);
  assert.match(sharedDom, /--classic-char-glow/);
  assert.match(sharedDom, /native-classic-line-exit/);
  assert.match(css, /\.native-dom-lyric-stage\.is-transition-capture/);
  assert.match(css, /\.native-dom-lyric-stage\.is-large-surface/);
  assert.match(css, /@keyframes native-classic-line-enter-normal/);
  assert.match(css, /@keyframes native-classic-word-active/);
  assert.match(html, /modes\.classic\.enableWordRotation/);
  assert.match(html, /modes\.classic\.useLegacyLayout/);
  assert.match(html, /modes\.classic\.wordSpacing/);
});

test('Classic helper modules are covered by the syntax check', () => {
  const check = packageJson.scripts.check;
  assert.ok(check.includes('node --check public/folia-native/classic-three-groups.js'));
  assert.ok(check.includes('node --check public/folia-native/classic-three-motion.js'));
  assert.ok(check.includes('node --check public/folia-native/three/spark-field.js'));
});

test('Classic typography follows the active Mineradio font settings at each viewport tier', () => {
  const source = extractPageFunction('nativeClassicLyricTypography');
  for (const [innerWidth, expectedFontSize] of [[639, 42], [640, 56], [1000, 72]]) {
    const calls = [];
    const sandbox = {
      innerWidth,
      fx: { lyricFont: 'song' },
      lyricFontStackForKey(key) {
        calls.push(['family', key]);
        return 'serif-stack';
      },
      lyricFontWeightValue() { return 650; },
      lyricLetterSpacingPx(fontSize) {
        calls.push(['spacing', fontSize]);
        return fontSize * -0.04;
      },
      lyricTextureStyleKey() { return 'style-key'; },
    };
    vm.runInNewContext(`${source}\n__result = nativeClassicLyricTypography();`, sandbox);
    assert.deepEqual(plain(sandbox.__result), {
      fontFamily: 'serif-stack',
      fontWeight: 650,
      letterSpacing: -0.04,
      key: 'style-key',
    });
    assert.deepEqual(calls, [['family', 'song'], ['spacing', expectedFontSize]]);
  }
});

test('Classic measurement reuses a canvas, measures graphemes and preserves negative letter spacing', () => {
  const source = extractPageFunction('nativeClassicLyricMeasureText');
  const splitInputs = [];
  const measured = [];
  let createCalls = 0;
  const context = {
    font: '',
    measureText(grapheme) {
      measured.push(grapheme);
      return { width: 5 };
    },
  };
  const sandbox = {
    nativeClassicLyricMeasureCanvas: null,
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        createCalls += 1;
        return { getContext: type => type === '2d' ? context : null };
      },
    },
    window: {
      MineradioNativeLyricLayout: {
        splitGraphemes(text) {
          splitInputs.push(text);
          return ['A', 'family-emoji', 'B'];
        },
      },
    },
  };
  vm.runInNewContext(`${source}
    __results = [
      nativeClassicLyricMeasureText('A-family-B', { fontFamily:'serif-stack', fontWeight:650, letterSpacing:-0.1 }, 20),
      nativeClassicLyricMeasureText('A-family-B', { fontFamily:'serif-stack', fontWeight:650, letterSpacing:-1 }, 20)
    ];`, sandbox);

  assert.deepEqual(plain(sandbox.__results), [11, 0]);
  assert.equal(createCalls, 1);
  assert.equal(context.font, '650 20px serif-stack');
  assert.deepEqual(splitInputs, ['A-family-B', 'A-family-B']);
  assert.deepEqual(measured, ['A', 'family-emoji', 'B', 'A', 'family-emoji', 'B']);

  let fallbackCreateCalls = 0;
  const fallbackSandbox = {
    nativeClassicLyricMeasureCanvas: null,
    document: {
      createElement() {
        fallbackCreateCalls += 1;
        return { getContext: () => null };
      },
    },
    window: {
      MineradioNativeLyricLayout: {
        splitGraphemes() { return ['joined-emoji', 'C']; },
      },
    },
  };
  vm.runInNewContext(`${source}
    __results = [
      nativeClassicLyricMeasureText('fallback', { fontFamily:'serif-stack', fontWeight:650, letterSpacing:-0.1 }, 20),
      nativeClassicLyricMeasureText('fallback', { fontFamily:'serif-stack', fontWeight:650, letterSpacing:-0.1 }, 20)
    ];`, fallbackSandbox);
  assert.deepEqual(plain(fallbackSandbox.__results), [24, 24]);
  assert.equal(fallbackCreateCalls, 1);
});

test('Classic parallax follows the real particle drag production path', () => {
  const pointerSource = extractPageFunction('handleCanvasPointerMove');
  const dragSource = extractPageFunction('applyParticleSpinDrag');
  const parallaxSource = extractPageFunction('nativeClassicLyricParallax');
  assert.match(pointerSource, /applyParticleSpinDrag\(dx,\s*dy,\s*spinDt\)/);

  const sandbox = {
    __frame: { reducedMotion: false, config: { common: { performanceMode: 'balanced' } } },
    gestureRotation: { x: 0, y: 0 },
    particleSpin: { vx: 0, vy: 0 },
    PARTICLE_POINTER_SPIN_X: 0.0032,
    PARTICLE_POINTER_SPIN_Y: 0.0034,
    clampParticleSpinVelocity(value) { return Math.max(-6.2, Math.min(6.2, value)); },
    orbit: {
      baselineTheta: 0,
      userTheta: 0,
      baselinePhi: 0.08,
      userPhi: 0.08,
      centerLocked: false,
      focus: { active: false },
    },
    shouldOffsetLyricsForShelfDetail() { return false; },
    clampRange(value, min, max) { return Math.max(min, Math.min(max, value)); },
    shortestAngleDelta(from, to) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); },
  };
  vm.runInNewContext(`${dragSource}\n${parallaxSource}
    applyParticleSpinDrag(100, 50, 1 / 60);
    __result = nativeClassicLyricParallax(__frame);`, sandbox);

  assert.ok(Math.abs(sandbox.gestureRotation.x - 0.16) < 1e-12);
  assert.ok(Math.abs(sandbox.gestureRotation.y - 0.34) < 1e-12);
  const parallax = plain(sandbox.__result);
  assert.ok(Math.abs(parallax.x) > 0);
  assert.ok(Math.abs(parallax.y) > 0);
  assert.ok(Math.abs(parallax.x) <= 0.03);
  assert.ok(Math.abs(parallax.y) <= 0.018);
  assert.ok(Math.abs(parallax.rotationX) <= 3.2 * Math.PI / 180);
  assert.ok(Math.abs(parallax.rotationY) <= 4 * Math.PI / 180);
  assert.ok(Math.abs(parallax.x - 0.03) < 1e-12);
  assert.ok(Math.abs(parallax.y + 0.018) < 1e-12);
});

test('Classic parallax reads only direct gesture rotation and zeros every constrained state', () => {
  const source = extractPageFunction('nativeClassicLyricParallax');
  const orbitReads = Array.from(new Set(Array.from(source.matchAll(/\borbit\.([A-Za-z]\w*)/g), match => match[1]))).sort();
  const gestureReads = Array.from(new Set(Array.from(source.matchAll(/\bgestureRotation\.([A-Za-z]\w*)/g), match => match[1]))).sort();
  assert.deepEqual(orbitReads, ['centerLocked', 'focus']);
  assert.deepEqual(gestureReads, ['x', 'y']);
  assert.match(source, /clampRange\(gestureRotation\.y\s*\/\s*0\.12,\s*-1,\s*1\)/);
  assert.match(source, /clampRange\(gestureRotation\.x\s*\/\s*0\.10,\s*-1,\s*1\)/);
  assert.match(source, /shouldOffsetLyricsForShelfDetail\(\)/);
  assert.doesNotMatch(source, /nativeLyricSafeArea/);
  assert.doesNotMatch(source, /shortestAngleDelta|\b(?:headParallax|pointerParallax|freeCamera|camera|cine\w*|beat\w*|audio\w*)\b/i);

  function run(frame, orbit, gestureRotation, shelfOpen) {
    const sandbox = {
      __frame: frame,
      orbit,
      gestureRotation,
      shouldOffsetLyricsForShelfDetail() { return shelfOpen; },
      clampRange(value, min, max) { return Math.max(min, Math.min(max, value)); },
    };
    vm.runInNewContext(`${source}\n__result = nativeClassicLyricParallax(__frame);`, sandbox);
    return plain(sandbox.__result);
  }

  const frame = { reducedMotion: false, config: { common: { performanceMode: 'balanced' } } };
  const userOrbit = {
    centerLocked: false,
    focus: { active: false },
  };
  const directGesture = { x: 0.05, y: 0.06 };
  const active = run(frame, userOrbit, directGesture, false);
  assert.ok(Math.abs(active.x - 0.015) < 1e-12);
  assert.ok(Math.abs(active.y + 0.009) < 1e-12);
  assert.ok(Math.abs(active.rotationX - 1.6 * Math.PI / 180) < 1e-12);
  assert.ok(Math.abs(active.rotationY + 2 * Math.PI / 180) < 1e-12);

  const zero = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
  const constraints = [
    ['reduced motion', { ...frame, reducedMotion: true }, userOrbit, directGesture, false],
    ['battery mode', { ...frame, config: { common: { performanceMode: 'battery' } } }, userOrbit, directGesture, false],
    ['shelf detail', frame, userOrbit, directGesture, true],
    ['center lock', frame, { ...userOrbit, centerLocked: true }, directGesture, false],
    ['focus lock', frame, { ...userOrbit, focus: { active: true } }, directGesture, false],
  ];
  for (const [name, constrainedFrame, constrainedOrbit, gesture, shelfOpen] of constraints) {
    assert.deepEqual(run(constrainedFrame, constrainedOrbit, gesture, shelfOpen), zero, name);
  }
});

test('Three lyric host resumes before renderer replay and is destroyed after the runtime', () => {
  assert.match(html, /function resumeVisualReleaseBudget[\s\S]*?nativeThreeLyricHost\.resume\(\)[\s\S]*?nativeLyricRuntime\.resume\(\)/);
  assert.match(html, /function destroyNativeLyricRuntime\(/);
  assert.match(html, /nativeLyricRuntime\.destroy\(\)[\s\S]*?nativeThreeLyricHost\.destroy\(\)/);
  assert.match(html, /window\.addEventListener\('pagehide', destroyNativeLyricRuntime\)/);
});

test('Monet is a lazy DOM and Canvas poster renderer fed by Mineradio spectrum data', () => {
  assert.match(html, /registerNativeLyricRenderer\('monet'/);
  assert.match(html, /folia-native\/renderers\/monet\.js/);
  assert.match(css, /\.native-monet-stage/);
  assert.match(css, /\.native-monet-lyric-rail/);
  assert.match(css, /\.native-monet-audio/);
  assert.match(html, /frequencyData:frequencyData/);
  const monet = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'monet.js'), 'utf8');
  assert.match(monet, /function captureTransition\(/);
  assert.match(monet, /is-transition-capture/);
  assert.match(monet, /is-large-surface/);
  assert.match(css, /\.native-monet-stage\.is-large-surface \.native-monet-backdrop/);
});

test('Cadenza and Fume are lazy native Canvas renderers with no private animation loop', () => {
  for (const mode of ['cadenza', 'fume']) {
    assert.match(html, new RegExp(`registerNativeLyricRenderer\\('${mode}'`));
    assert.match(html, new RegExp(`folia-native/renderers/${mode}\\.js`));
  }
  assert.match(css, /\.native-cadenza-stage/);
  assert.match(css, /\.native-cadenza-glow-layer/);
  assert.match(css, /\.native-fume-stage/);
  assert.match(css, /\.native-fume-canvas/);
  const cadenza = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native', 'renderers', 'cadenza.js'), 'utf8');
  assert.match(cadenza, /function captureTransition\(/);
  assert.match(cadenza, /is-transition-capture/);
});
