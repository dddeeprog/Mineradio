'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../../third_party/folia-major/node_modules/@playwright/test');
const { PNG } = require('../../third_party/folia-major/node_modules/pngjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const screenshotRoot = path.join(repoRoot, 'screenshots', 'folia-native');
const modes = ['mineradio-3d', 'classic', 'cadenza', 'partita', 'tilt', 'monet', 'cappella', 'fume'];
const backendKinds = {
  'mineradio-3d': 'three',
  classic: 'three',
  cadenza: 'canvas-dom',
  partita: 'dom',
  tilt: 'dom',
  monet: 'dom-canvas',
  cappella: 'dom',
  fume: 'canvas2d',
};
const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '960x540', width: 960, height: 540 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
const classicPerformanceWarmupMs = 2000;
const classicPerformanceSampleDurationMs = 15000;
const classicPerformanceResetMode = 'partita';
const heapMeasurementSource = 'cdp-performance-metrics';
const softwareWebglPattern = /swiftshader|software|warp|llvmpipe|softpipe|lavapipe/i;
const referenceGpuPattern = /NVIDIA GeForce RTX 5060/i;
const classicSwitchBaseline = Object.freeze({
  mode: 'classic',
  quality: 'quality',
  viewport: Object.freeze({ width: 960, height: 540 }),
  frameOffsetSeconds: 0.12,
});
const runtimeTransitionContractMs = 340;
const quickTransitionDrainTimeoutMs = 1500;
const performanceTransitionDrainTimeoutMs = 3000;
const classicPerformanceProfiles = [
  { name: '1080p-balanced', viewport: { width: 1920, height: 1080 }, quality: 'balanced' },
  { name: '4k-quality', viewport: { width: 3840, height: 2160 }, quality: 'quality' },
  { name: '1080p-battery', viewport: { width: 1920, height: 1080 }, quality: 'battery' },
];
// Word poses reach 12/18 degrees during entry and the shared layer adds at most 4 degrees of parallax.
const classicCameraFacingAngleLimit = 26 * Math.PI / 180;
const classicTranslationFacingAngleLimit = 0.5 * Math.PI / 180;
// Stable lanes, entry travel and rigid-plane tilt stay inside this deterministic camera-depth envelope.
const classicRelativeDepthLimit = 1.2;
// MAX_ROTATION is 7 degrees; this covers passed drift and the small projection contribution from tilt.
const classicInPlaneRotationLimit = 9 * Math.PI / 180;
const classicVisibleTiltMinimum = 2 * Math.PI / 180;
const classicVisibleDepthSpanMinimum = 0.36;
const classicVisibleVerticalRangeMinimum = 0.05;
const classicVisibleScaleRangeMinimum = 0.01;
// Combined in-plane and out-of-plane limits bound each positive camera-axis alignment.
const classicCameraAxisAlignmentMinimum = Math.cos(classicInPlaneRotationLimit)
  * Math.cos(classicCameraFacingAngleLimit);
// Observed local +Z opposes camera forward; preserve that sign throughout the allowed 3D pose.
const classicSignedNormalCameraForwardMaximum = -Math.cos(classicCameraFacingAngleLimit);
const classicHandednessMinimum = 0.9999;

function classifyWebglEnvironment(webgl) {
  const renderer = String(webgl && webgl.renderer || '');
  const vendor = String(webgl && webgl.vendor || '');
  const softwareWebgl = softwareWebglPattern.test(`${renderer} ${vendor}`);
  const referenceHardwareOptIn = process.env.MINERADIO_REFERENCE_HARDWARE === '1';
  const referenceGpuMatched = referenceGpuPattern.test(renderer);
  const performanceTargetsValidated = referenceHardwareOptIn && referenceGpuMatched && !softwareWebgl;
  const hardwareClassification = softwareWebgl
    ? 'software'
    : performanceTargetsValidated ? 'reference-hardware' : 'unverified-hardware';
  const targetValidation = performanceTargetsValidated
    ? 'reference-hardware performance-targets-validated'
    : softwareWebgl ? 'software functional-only' : 'unverified-hardware functional-only';
  return {
    softwareWebgl,
    referenceHardwareOptIn,
    referenceGpuMatched,
    performanceTargetsValidated,
    hardwareClassification,
    targetValidation,
  };
}

function isCollectedHeapPair(before, after) {
  return Boolean(
    before && before.measured && before.garbageCollected === true
    && after && after.measured && after.garbageCollected === true
  );
}

fs.mkdirSync(screenshotRoot, { recursive: true });

function imageStats(buffer) {
  const png = PNG.sync.read(buffer);
  const pixelCount = png.width * png.height;
  const step = Math.max(1, Math.floor(pixelCount / 60000));
  let visible = 0;
  let bright = 0;
  let samples = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    const alpha = png.data[offset + 3];
    const luminance = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
    if (alpha > 16) visible += 1;
    if (alpha > 16 && luminance > 18) bright += 1;
    samples += 1;
  }
  return { visibleRatio: visible / samples, brightRatio: bright / samples };
}

async function preparePage(page, viewport) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.nativeLyricRuntime
    && window.MineradioNativeLyricState
    && window.MineradioNativeLyricConfig
    && window.MineradioNativeLyricThreePerformance
  ));
  await page.evaluate(() => {
    const performanceApi = window.MineradioNativeLyricThreePerformance;
    const createPerformanceBudget = performanceApi.createThreeLyricPerformanceBudget;
    window.__foliaNativePerformanceBudgets = [];
    performanceApi.createThreeLyricPerformanceBudget = function(options) {
      const budget = createPerformanceBudget(options);
      window.__foliaNativePerformanceBudgets.push(budget);
      return budget;
    };

    const fixtureStyle = document.createElement('style');
    fixtureStyle.id = 'folia-native-visual-fixture-style';
    fixtureStyle.textContent = [
      '#splash,#empty-home,#search-area,#source-nav,#top-right,#bottom-bar,#bottom-handle,#fx-panel,#fx-fab,#fx-fab-hide-btn,#playlist-panel,#visual-guide,#trial-banner,#ai-depth-chip,#beat-chip,#toast,#gesture-hud,#hand-canvas,#free-camera-hint,#source-fallback-notice{display:none!important}',
      '#native-lyric-root{z-index:999!important;visibility:visible!important}',
      'body{background:#07090d!important}',
    ].join('');
    document.head.appendChild(fixtureStyle);
    document.body.classList.remove('splash-active');

    const texts = [
      ['序曲在城市醒来', 'The city wakes in overture'],
      ['流光穿过 city lights', 'Light crosses the city'],
      ['我们把心事写进夜色', 'We write our thoughts into night'],
      ['云阶一层一层靠近星河', 'Cloud steps approach the stars'],
      ['此刻，请听我慢慢倾诉', 'Listen as I speak softly'],
      ['让这一句成为整篇文章的标题', 'Let this line become the headline'],
      ['雨落在莫奈未干的颜色里', 'Rain falls into Monet colors'],
      ['你在左边，我在右边 ✨', 'You are left, I am right'],
      ['Mixed words 与中文一起呼吸', 'Mixed words breathe together'],
      ['很长很长的一句话也应该在窗口里面完整排版而不遮住下一行', 'A long sentence must remain readable'],
      ['副歌回来，我们一起唱', 'The chorus returns'],
      ['最后把所有名字排成一页', 'At last every name becomes a page'],
    ];
    const lines = texts.map((entry, index) => {
      const start = index * 2.8;
      const text = entry[0];
      const middle = Math.max(1, Math.floor(text.length / 2));
      return {
        t: start,
        duration: 2.65,
        text,
        translation: entry[1],
        agentId: `voice-${index % 4}`,
        isChorus: index === 5 || index === 10,
        words: [
          { text: text.slice(0, middle), t: start, d: 1.3, c0: 0, c1: middle },
          { text: text.slice(middle), t: start + 1.3, d: 1.35, c0: middle, c1: text.length },
        ],
      };
    });
    const stateApi = window.MineradioNativeLyricState;
    const configApi = window.MineradioNativeLyricConfig;
    const documentRef = stateApi.buildNativeLyricDocument(lines, {
      id: 'playwright-native-fixture',
      source: 'fixture',
      title: '纸上心象',
      artist: 'Mineradio',
      cover: '/folia-native/assets/cappella/avatar/avatar17.png',
      duration: lines.at(-1).t + lines.at(-1).duration,
    });
    const spectrum = Uint8Array.from({ length: 256 }, (_, index) => Math.round((Math.sin(index * 0.17) * 0.5 + 0.5) * 220 + 20));
    const theme = {
      primary: '#d6f8ff',
      secondary: '#9cffdf',
      highlight: '#fff0b8',
      wordColors: [
        { word: '城市', color: '#7fd8ff' },
        { word: '夜色', color: '#ff91b8' },
        { word: '标题', color: '#ffd166' },
      ],
    };

    const classicSemanticDocument = stateApi.buildNativeLyricDocument([{
      t: 1,
      duration: 3.5,
      text: '流光 穿过 夜色',
      translation: 'Light crosses the night',
      words: [
        { text: '流光', t: 1, d: 0.45 },
        { text: '穿过', t: 2, d: 0.45 },
        { text: '夜色', t: 3, d: 0.45 },
      ],
    }], {
      id: 'playwright-classic-semantic-groups',
      source: 'fixture',
      title: '流光',
      artist: 'Mineradio',
      duration: 4.5,
    });

    function classicTransitionDocument(mode, nextWordRevealMode) {
      const built = stateApi.buildNativeLyricDocument([
        { t: 1, duration: 1.5, text: `旧层 ${mode}`, translation: 'Old lyric layer' },
        { t: 4, duration: 1.5, text: '新层流光', translation: 'New lyric layer' },
      ], {
        id: `playwright-classic-transition-${mode}`,
        source: 'fixture',
        title: `Classic ${mode}`,
        artist: 'Mineradio',
        duration: 5.5,
      });
      const linesWithHints = built.lines.map((line, index) => Object.assign({}, line, {
        renderHints: Object.assign({}, line.renderHints, index === 0 ? {
          lineTransitionMode: mode,
          wordRevealMode: 'normal',
        } : {
          lineTransitionMode: 'normal',
          wordRevealMode: nextWordRevealMode,
        }),
      }));
      return Object.assign({}, built, {
        fingerprint: `${built.fingerprint}-${mode}-${nextWordRevealMode}`,
        lines: linesWithHints,
      });
    }

    window.__foliaNativeFixture = { lines, documentRef, spectrum, theme, now: 13.35 };
    window.__foliaClassicFixture = {
      active: '',
      documents: {
        semantic: classicSemanticDocument,
        'transition-normal': classicTransitionDocument('normal', 'instant'),
        'transition-fast': classicTransitionDocument('fast', 'normal'),
        'transition-none': classicTransitionDocument('none', 'fast'),
      },
      spectrum,
      theme,
    };
    window.updateNativeLyricRuntime = function() {};
    window.tickLyricsParticles = function() {};
    window.__renderFoliaNativeFixtureThree = window.renderSceneWithShelfOverlay;
    window.renderSceneWithShelfOverlay = function() {
      if (innerWidth >= 3000 && nativeLyricConfig && !['mineradio-3d', 'classic'].includes(nativeLyricConfig.mode)) return;
      return window.__renderFoliaNativeFixtureThree();
    };
    window.__setFoliaNativeMode = async function(mode, quality) {
      const fixture = window.__foliaNativeFixture;
      nativeLyricConfig = configApi.normalizeNativeLyricConfig({
        mode,
        common: {
          scale: 1,
          opacity: 1,
          glow: 0.72,
          beatMotion: 0.55,
          translationMode: 'always',
          performanceMode: quality || 'balanced',
          reduceMotion: false,
        },
        modes: {
          classic: { intensity: 'normal', spread: 0.72, wordGlow: 0.82, breathing: 1, chorusRipple: true },
          cadenza: { beam: 0.78, trails: 0.68, ripple: 0.62 },
          monet: { posterContrast: 0.72, audioOverlay: 0.74, keywordColor: true },
          fume: { columns: 3, cameraMode: 'smooth', geometricBackground: true, cacheEntries: 24, cacheBytes: 33554432 },
        },
      });
      nativeLyricDocument = fixture.documentRef;
      nativeLyricRuntime.setDocument(fixture.documentRef);
      nativeLyricRuntime.resize({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });
      await nativeLyricRuntime.setMode(mode);
      lyricsLines = fixture.lines;
      lyricsTimingSource = 'fixture';
      lyricsHasNativeKaraoke = true;
      fx.particleLyrics = true;
      lyricsVisible = true;
      playing = true;
      try { audio.currentTime = fixture.now; } catch (error) {}
      window.__renderFoliaNativeFrame(fixture.now);
      if (mode === 'mineradio-3d') {
        const lineIndex = stateApi.findActiveLineIndex(fixture.documentRef, fixture.now, 0);
        stageLyrics.currentIdx = lineIndex;
        showStageLine(fixture.documentRef.lines[lineIndex].fullText);
        if (stageLyrics.current) updateLyricMeshProgress(stageLyrics.current, 0.56);
      }
    };
    window.__renderFoliaNativeFrame = function(now, rafDeltaMs) {
      const fixture = window.__foliaNativeFixture;
      const lineIndex = stateApi.findActiveLineIndex(fixture.documentRef, now, 0);
      const explicitDelta = Number(rafDeltaMs);
      const frameDeltaMs = Number.isFinite(explicitDelta) && explicitDelta >= 0 ? explicitDelta : 1000 / 60;
      playing = true;
      const frame = stateApi.buildNativeLyricFrame(fixture.documentRef, {
        now,
        dt: frameDeltaMs / 1000,
        rafDeltaMs: frameDeltaMs,
        lineIndex,
        playing: true,
        audio: { frequencyData: fixture.spectrum, bass: 0.58, mid: 0.44, treble: 0.62, energy: 0.57, beatPulse: 0.48, beatOnset: false },
        theme: fixture.theme,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
        quality: nativeLyricConfig.common.performanceMode,
        reducedMotion: false,
        track: { id: 'playwright-native-fixture', title: '纸上心象', artist: 'Mineradio', album: 'Folia Native', cover: '/folia-native/assets/cappella/avatar/avatar17.png' },
        config: nativeLyricConfig,
      });
      nativeLyricRuntime.update(frame);
      if (typeof updateNativeLyricLiveRegion === 'function') updateNativeLyricLiveRegion(fixture.documentRef.lines[lineIndex] || null);
      if (nativeLyricConfig.mode === 'mineradio-3d') {
        const text = fixture.documentRef.lines[lineIndex] && fixture.documentRef.lines[lineIndex].fullText || '';
        stageLyrics.currentIdx = lineIndex;
        if (!stageLyrics.current || stageLyrics.currentText !== text) showStageLine(text);
        if (stageLyrics.current) updateLyricMeshProgress(stageLyrics.current, 0.56);
      }
      return nativeLyricRuntime.snapshot();
    };
    window.__activateClassicFixture = async function(name, quality) {
      const fixture = window.__foliaClassicFixture;
      const documentRef = fixture.documents[name];
      if (!documentRef) throw new Error(`Unknown Classic fixture: ${name}`);
      await window.__setFoliaNativeMode('classic', quality || 'balanced');
      fixture.active = name;
      nativeLyricDocument = documentRef;
      nativeLyricRuntime.setDocument(documentRef);
      lyricsLines = documentRef.lines;
      lyricsTimingSource = 'fixture';
      lyricsHasNativeKaraoke = true;
      return nativeLyricRuntime.snapshot();
    };
    window.__renderClassicFixtureFrame = function(input) {
      input = input || {};
      const fixture = window.__foliaClassicFixture;
      const name = input.fixture || fixture.active || 'semantic';
      const documentRef = fixture.documents[name];
      if (!documentRef) throw new Error(`Unknown Classic fixture: ${name}`);
      if (fixture.active !== name || nativeLyricRuntime.getDocument() !== documentRef) {
        fixture.active = name;
        nativeLyricDocument = documentRef;
        nativeLyricRuntime.setDocument(documentRef);
        lyricsLines = documentRef.lines;
      }
      const now = Number(input.now);
      const rafDeltaMs = Math.max(0, Number(input.rafDeltaMs) || 0);
      const lineIndex = Number.isInteger(input.lineIndex)
        ? input.lineIndex
        : stateApi.findActiveLineIndex(documentRef, now, 0);
      const framePlaying = input.playing !== false;
      const reducedMotion = input.reducedMotion === true;
      playing = framePlaying;
      try { audio.currentTime = now; } catch (error) {}
      const frame = stateApi.buildNativeLyricFrame(documentRef, {
        now,
        dt: rafDeltaMs / 1000,
        rafDeltaMs,
        lineIndex,
        playing: framePlaying,
        audio: { frequencyData: fixture.spectrum, bass: 0.58, mid: 0.44, treble: 0.62, energy: 0.57, beatPulse: 0.48, beatOnset: false },
        theme: fixture.theme,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
        quality: input.quality || nativeLyricConfig.common.performanceMode,
        reducedMotion,
        track: { id: 'playwright-classic-fixture', title: '流光', artist: 'Mineradio', album: 'Folia Native', cover: '' },
        config: nativeLyricConfig,
      });
      nativeLyricRuntime.update(frame);
      renderSceneWithShelfOverlay();
      return nativeLyricRuntime.snapshot();
    };
  });
  return pageErrors;
}

async function renderMode(page, mode, quality = 'balanced') {
  await page.evaluate(({ mode, quality }) => window.__setFoliaNativeMode(mode, quality), { mode, quality });
  for (let index = 0; index < 8; index += 1) {
    await page.waitForTimeout(45);
    await page.evaluate(offset => window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + offset), index * 0.018);
  }
  await page.waitForTimeout(380);
  await page.evaluate(() => window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + 0.18));
}

async function renderModeFast(page, mode, quality = 'quality', settleMs = 35) {
  await page.evaluate(({ mode, quality }) => window.__setFoliaNativeMode(mode, quality), { mode, quality });
  if (settleMs) await page.waitForTimeout(settleMs);
  return page.evaluate(() => window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + 0.12));
}

async function transitionResourceSnapshot(page) {
  return page.evaluate(() => {
    const root = document.getElementById('native-lyric-root');
    return {
      snapshot: nativeLyricRuntime.snapshot(),
      transitionGhostCount: root ? root.querySelectorAll('.native-lyric-transition-ghost').length : 0,
      fumeStageCount: root ? root.querySelectorAll('.native-fume-stage').length : 0,
      fumeCanvasCount: root ? root.querySelectorAll('.native-fume-canvas').length : 0,
    };
  });
}

async function waitForRuntimeTransitionDrain(page, timeoutMs) {
  await expect.poll(
    () => page.evaluate(() => nativeLyricRuntime.snapshot().transitionLayers),
    { timeout: timeoutMs },
  ).toBe(0);
}

async function measureClassicModeTransitionRetirement(page) {
  await renderModeFast(page, 'fume', 'quality', 80);
  const before = await transitionResourceSnapshot(page);
  const switchStartedAt = Date.now();
  const activatedSnapshot = await renderModeFast(page, 'classic', 'quality', 0);
  const switchElapsedMs = Date.now() - switchStartedAt;
  const initialTransitionLayers = activatedSnapshot.transitionLayers;
  const transitionDrainStartedAt = Date.now();
  await waitForRuntimeTransitionDrain(page, quickTransitionDrainTimeoutMs);
  const transitionDrainElapsedMs = Date.now() - transitionDrainStartedAt;
  const after = await transitionResourceSnapshot(page);
  return {
    viewport: { ...classicSwitchBaseline.viewport },
    fromMode: 'fume',
    toMode: classicSwitchBaseline.mode,
    runtimeTransitionContractMs,
    transitionDrainTimeoutMs: quickTransitionDrainTimeoutMs,
    transitionDrainElapsedMs,
    switchElapsedMs,
    initialTransitionLayers,
    before,
    after,
  };
}

async function establishClassicSwitchEndpoint(page) {
  const viewport = { ...classicSwitchBaseline.viewport };
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    nativeLyricRuntime.resize({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });
  });
  const switchStartedAt = Date.now();
  const activatedSnapshot = await renderModeFast(
    page,
    classicSwitchBaseline.mode,
    classicSwitchBaseline.quality,
    0,
  );
  const switchElapsedMs = Date.now() - switchStartedAt;
  const transitionDrainStartedAt = Date.now();
  await waitForRuntimeTransitionDrain(page, performanceTransitionDrainTimeoutMs);
  const transitionDrainElapsedMs = Date.now() - transitionDrainStartedAt;
  const state = await page.evaluate(baseline => {
    const fixtureTime = window.__foliaNativeFixture.now + baseline.frameOffsetSeconds;
    try { audio.currentTime = fixtureTime; } catch (error) {}
    const snapshot = window.__renderFoliaNativeFrame(fixtureTime);
    const documentRef = nativeLyricRuntime.getDocument();
    const root = document.getElementById('native-lyric-root');
    return {
      mode: snapshot.mode,
      quality: nativeLyricConfig.common.performanceMode,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
      documentFingerprint: documentRef && documentRef.fingerprint || null,
      fixtureTime,
      audioCurrentTime: Number(audio && audio.currentTime || 0),
      transitionGhostCount: root ? root.querySelectorAll('.native-lyric-transition-ghost').length : 0,
      fumeStageCount: root ? root.querySelectorAll('.native-fume-stage').length : 0,
      fumeCanvasCount: root ? root.querySelectorAll('.native-fume-canvas').length : 0,
      snapshot,
    };
  }, classicSwitchBaseline);
  return {
    state,
    initialTransitionLayers: activatedSnapshot.transitionLayers,
    switchElapsedMs,
    transitionDrainElapsedMs,
    transitionDrainTimeoutMs: performanceTransitionDrainTimeoutMs,
  };
}

async function activateClassicFixture(page, fixture = 'semantic', quality = 'balanced') {
  return page.evaluate(
    ({ fixture, quality }) => window.__activateClassicFixture(fixture, quality),
    { fixture, quality },
  );
}

async function submitClassicFrame(page, input) {
  await page.evaluate(options => window.__renderClassicFixtureFrame(options), input);
  return rendererDiagnostics(page, 'classic');
}

function trackWebGlShaderErrors(page) {
  const messages = [];
  page.on('console', message => {
    const value = message.text();
    if (/(?:THREE\.WebGLProgram|shader\s+(?:compile|link).*\b(?:error|failed)|program\s+(?:compile|link).*\b(?:error|failed)|GL_INVALID_\w+.*(?:shader|program)|WebGL.*(?:shader|program).*\b(?:error|failed))/i.test(value)) {
      messages.push({ type: message.type(), text: value });
    }
  });
  return messages;
}

async function collectClassicCompileDiagnostics(page) {
  await activateClassicFixture(page, 'transition-normal', 'balanced');
  await page.evaluate(() => {
    window.__renderClassicFixtureFrame({ fixture: 'transition-normal', now: 1.2, rafDeltaMs: 16, lineIndex: 0 });
    window.__renderClassicFixtureFrame({ fixture: 'transition-normal', now: 4.1, rafDeltaMs: 16, lineIndex: 1 });
  });
  return page.evaluate(() => {
    function materialOf(node) {
      return Array.isArray(node && node.material) ? node.material[0] || null : node && node.material || null;
    }
    function materialState(material) {
      return {
        blending: Number(material && material.blending),
        transparent: !!(material && material.transparent),
        premultipliedAlpha: !!(material && material.premultipliedAlpha),
        isShaderMaterial: !!(material && material.isShaderMaterial),
      };
    }
    function diagnosticLogs(diagnostics) {
      if (!diagnostics) return [];
      const values = [
        diagnostics.programLog,
        diagnostics.vertexShader && diagnostics.vertexShader.log,
        diagnostics.fragmentShader && diagnostics.fragmentShader.log,
      ];
      return values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    }

    const foliaRoot = nativeThreeLyricHost && nativeThreeLyricHost.getRoot();
    const bodyMeshes = [];
    const glowMeshes = [];
    if (foliaRoot && foliaRoot.traverse) {
      foliaRoot.traverse(node => {
        if (!node || !node.isInstancedMesh || !node.count) return;
        const material = materialOf(node);
        const variant = material && material.userData && material.userData.variant || '';
        if (variant === 'body') bodyMeshes.push(node);
        else if (variant.startsWith('glow-')) glowMeshes.push(node);
      });
    }
    const transitionRoot = scene && scene.getObjectByName && scene.getObjectByName('MineradioFoliaThreeTransitions');
    const transitionMeshes = transitionRoot && transitionRoot.children ? transitionRoot.children.slice() : [];
    const selected = [
      { role: 'body', mesh: bodyMeshes[0] || null },
      { role: 'glow', mesh: glowMeshes[0] || null },
      { role: 'transition', mesh: transitionMeshes[0] || null },
    ];

    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const context = renderer.getContext();
    if (context && typeof context.finish === 'function') context.finish();
    const infoPrograms = renderer.info && Array.isArray(renderer.info.programs) ? renderer.info.programs : [];

    function programState(entry) {
      const material = materialOf(entry.mesh);
      const properties = material && renderer.properties && renderer.properties.get(material) || {};
      const propertyProgram = properties.currentProgram || properties.program || null;
      const rawProgram = propertyProgram && propertyProgram.program || propertyProgram;
      const infoIndex = infoPrograms.findIndex(program => program === propertyProgram || program.program === rawProgram);
      const infoProgram = infoIndex >= 0 ? infoPrograms[infoIndex] : propertyProgram;
      let linked = false;
      let programLog = '';
      let shaders = [];
      if (context && rawProgram) {
        try {
          linked = !!context.getProgramParameter(rawProgram, context.LINK_STATUS);
          programLog = String(context.getProgramInfoLog(rawProgram) || '').trim();
          shaders = (context.getAttachedShaders(rawProgram) || []).map(shader => ({
            compiled: !!context.getShaderParameter(shader, context.COMPILE_STATUS),
            log: String(context.getShaderInfoLog(shader) || '').trim(),
          }));
        } catch (error) {
          programLog = String(error && error.message || error);
        }
      }
      return {
        role: entry.role,
        found: !!propertyProgram,
        infoIndex,
        linked,
        programLog,
        shaderCount: shaders.length,
        shaders,
        runnable: infoProgram && infoProgram.diagnostics ? infoProgram.diagnostics.runnable !== false : true,
        diagnosticLogs: diagnosticLogs(infoProgram && infoProgram.diagnostics),
      };
    }

    return {
      snapshot: nativeLyricRuntime.snapshot(),
      constants: { normalBlending: THREE.NormalBlending, additiveBlending: THREE.AdditiveBlending },
      infoProgramCount: infoPrograms.length,
      body: {
        batchCount: bodyMeshes.length,
        instanceCount: bodyMeshes.reduce((sum, mesh) => sum + Number(mesh.count || 0), 0),
        batchIds: bodyMeshes.map(mesh => mesh.uuid),
        material: materialState(materialOf(bodyMeshes[0])),
      },
      glow: {
        batchCount: glowMeshes.length,
        instanceCount: glowMeshes.reduce((sum, mesh) => sum + Number(mesh.count || 0), 0),
        batchIds: glowMeshes.map(mesh => mesh.uuid),
        material: materialState(materialOf(glowMeshes[0])),
      },
      transition: {
        batchCount: transitionMeshes.length,
        material: materialState(materialOf(transitionMeshes[0])),
      },
      programs: selected.map(programState),
    };
  });
}

async function forceClassicWebGlLoss(page) {
  await page.evaluate(() => {
    const sampleRate = 8000;
    const sampleCount = sampleRate * 20;
    const dataBytes = sampleCount * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeAscii = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataBytes, true);

    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const media = new Audio(objectUrl);
    media.loop = true;
    media.volume = 0;
    media.preload = 'auto';
    const events = { pause: 0, stalled: 0, error: 0 };
    const listeners = Object.fromEntries(Object.keys(events).map(type => [type, () => { events[type] += 1; }]));
    Object.entries(listeners).forEach(([type, listener]) => media.addEventListener(type, listener));

    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.setAttribute('aria-label', 'unlock context loss media fixture');
    Object.assign(unlock.style, {
      position: 'fixed', left: '0', top: '0', width: '48px', height: '48px', zIndex: '2147483647', opacity: '0.01',
    });
    document.body.appendChild(unlock);
    const state = {
      media,
      objectUrl,
      unlock,
      events,
      listeners,
      playResolved: false,
      playError: '',
    };
    window.__foliaContextLossMedia = state;
    unlock.addEventListener('click', () => {
      audio = media;
      media.play().then(() => { state.playResolved = true; }).catch(error => {
        state.playError = String(error && error.message || error);
      });
    }, { once: true });
    window.__cleanupFoliaContextLossMedia = () => {
      Object.entries(listeners).forEach(([type, listener]) => media.removeEventListener(type, listener));
      media.pause();
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(objectUrl);
      unlock.remove();
      if (audio === media) audio = null;
      delete window.__foliaContextLossMedia;
      delete window.__cleanupFoliaContextLossMedia;
    };
  });
  await page.mouse.click(24, 24);
  await expect.poll(
    () => page.evaluate(() => {
      const state = window.__foliaContextLossMedia;
      return !!(state && (state.playResolved || state.playError));
    }),
    { timeout: 5000 },
  ).toBe(true);
  const playError = await page.evaluate(() => window.__foliaContextLossMedia.playError);
  expect(playError, 'real media play() error').toBe('');
  await expect.poll(
    () => page.evaluate(() => audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 0),
    { timeout: 5000 },
  ).toBe(true);

  await activateClassicFixture(page, 'semantic', 'balanced');
  await page.evaluate(() => window.__renderClassicFixtureFrame({ fixture: 'semantic', now: 1.36, rafDeltaMs: 16, lineIndex: 0 }));
  await expect.poll(
    () => page.evaluate(() => audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 1.38),
    { timeout: 5000 },
  ).toBe(true);
  const before = await page.evaluate(() => {
    saveNativeLyricConfig();
    window.__foliaContextLossObserved = 0;
    window.__foliaContextLossDocument = nativeLyricRuntime.getDocument();
    renderer.domElement.addEventListener('webglcontextlost', () => {
      window.__foliaContextLossObserved += 1;
    }, { once: true });
    const stored = JSON.parse(localStorage.getItem(MineradioNativeLyricConfig.STORAGE_KEY) || 'null');
    const context = renderer.getContext();
    return {
      snapshot: nativeLyricRuntime.snapshot(),
      configMode: nativeLyricConfig.mode,
      savedMode: stored && stored.mode,
      playing: !!playing,
      isHtmlAudioElement: audio instanceof HTMLAudioElement,
      paused: audio.paused,
      currentTime: Number(audio.currentTime || 0),
      mediaEvents: Object.assign({}, window.__foliaContextLossMedia.events),
      documentFingerprint: nativeLyricRuntime.getDocument() && nativeLyricRuntime.getDocument().fingerprint,
      extensionAvailable: !!(context && context.getExtension('WEBGL_lose_context')),
    };
  });
  const trigger = await page.evaluate(() => {
    const context = renderer.getContext();
    const extension = context && context.getExtension('WEBGL_lose_context');
    if (!extension || typeof extension.loseContext !== 'function') throw new Error('WEBGL_lose_context is unavailable');
    extension.loseContext();
    return { method: 'WEBGL_lose_context' };
  });
  await expect.poll(() => page.evaluate(() => window.__foliaContextLossObserved), { timeout: 5000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => nativeLyricRuntime.snapshot().backend), { timeout: 5000 }).toBe('2d-fallback');
  await expect.poll(
    () => page.locator('.native-dom-lyric-stage.is-classic').count(),
    { timeout: 5000 },
  ).toBe(1);
  await expect.poll(
    () => page.evaluate(startedAt => audio.currentTime - startedAt, before.currentTime),
    { timeout: 5000 },
  ).toBeGreaterThanOrEqual(0.2);
  const after = await page.evaluate(() => {
    const snapshot = nativeLyricRuntime.snapshot();
    const stored = JSON.parse(localStorage.getItem(MineradioNativeLyricConfig.STORAGE_KEY) || 'null');
    const hostSnapshot = nativeThreeLyricHost.snapshot();
    const context = renderer.getContext();
    return {
      snapshot,
      configMode: nativeLyricConfig.mode,
      savedMode: stored && stored.mode,
      playing: !!playing,
      isHtmlAudioElement: audio instanceof HTMLAudioElement,
      paused: audio.paused,
      currentTime: Number(audio.currentTime || 0),
      mediaEvents: Object.assign({}, window.__foliaContextLossMedia.events),
      documentSame: nativeLyricRuntime.getDocument() === window.__foliaContextLossDocument,
      documentFingerprint: nativeLyricRuntime.getDocument() && nativeLyricRuntime.getDocument().fingerprint,
      contextLossEvents: window.__foliaContextLossObserved,
      contextLost: !!(context && context.isContextLost()),
      domFallbackCount: document.querySelectorAll('.native-dom-lyric-stage.is-classic').length,
      nativeRootChildren: document.getElementById('native-lyric-root').children.length,
      threeActiveScopes: hostSnapshot.activeScopes,
      activeThreeModeGroups: nativeThreeLyricHost.getRoot().children.length,
    };
  });
  return { before, trigger, after };
}

function expectBodyGlowMatrixParity(diagnostics) {
  const classic = diagnostics.three && diagnostics.three.classic;
  expect(classic, 'Classic scene diagnostics').toBeDefined();
  expect(classic.bodyMatrices.length).toBeGreaterThan(0);
  expect(classic.bodyMatrices).toEqual(classic.glowMatrices);
}

function classicViewportEvidence(classic, viewport) {
  const tolerance = 2;
  const hasArea = bounds => !!bounds
    && ['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(bounds[key]))
    && bounds.right > bounds.left
    && bounds.bottom > bounds.top;
  const safeArea = classic.safeArea;
  const safeBounds = {
    left: safeArea.left,
    right: viewport.width - safeArea.right,
    top: safeArea.top,
    bottom: viewport.height - safeArea.bottom,
  };
  const mainBoundsNonEmpty = hasArea(classic.mainBounds);
  const translationBoundsNonEmpty = hasArea(classic.translationBounds);
  return {
    mainBoundsNonEmpty,
    translationBoundsNonEmpty,
    mainInsideSafeArea: mainBoundsNonEmpty
      && classic.mainBounds.left >= safeBounds.left - tolerance
      && classic.mainBounds.right <= safeBounds.right + tolerance
      && classic.mainBounds.top >= safeBounds.top - tolerance
      && classic.mainBounds.bottom <= safeBounds.bottom + tolerance,
    translationInsideSafeArea: translationBoundsNonEmpty
      && classic.translationBounds.left >= safeBounds.left - tolerance
      && classic.translationBounds.right <= safeBounds.right + tolerance
      && classic.translationBounds.top >= safeBounds.top - tolerance
      && classic.translationBounds.bottom <= safeBounds.bottom + tolerance,
    mainTranslationDisjoint: mainBoundsNonEmpty
      && translationBoundsNonEmpty
      && classic.mainBounds.bottom <= classic.translationBounds.top + tolerance,
    matrixGeometry: classic.bodyMatrices.map(matrix => {
      const finite = matrix.length === 16 && matrix.every(Number.isFinite);
      const xScale = finite ? Math.hypot(matrix[0], matrix[1], matrix[2]) : 0;
      const yScale = finite ? Math.hypot(matrix[4], matrix[5], matrix[6]) : 0;
      const dot = finite
        ? matrix[0] * matrix[4] + matrix[1] * matrix[5] + matrix[2] * matrix[6]
        : Infinity;
      return {
        finite,
        xScale,
        yScale,
        normalizedDot: xScale > 0 && yScale > 0 ? Math.abs(dot / (xScale * yScale)) : Infinity,
        aspectRatio: yScale > 0 ? xScale / yScale : Infinity,
      };
    }),
  };
}

function expectClassicViewportConstraints(diagnostics, viewport) {
  const classic = diagnostics.three && diagnostics.three.classic;
  expect(classic, `${viewport.name} Classic scene diagnostics`).toBeDefined();
  expect(classic.mainBounds, `${viewport.name} main bounds`).not.toBeNull();
  expect(classic.translationBounds, `${viewport.name} translation bounds`).not.toBeNull();
  expect(classic.bodyBatchIds, `${viewport.name} body batches`).toHaveLength(1);
  expect(classic.glowBatchIds, `${viewport.name} glow batches`).toHaveLength(1);
  expect(classic.bodyBatchIds[0], `${viewport.name} body batch id`).toBeTruthy();
  expect(classic.glowBatchIds[0], `${viewport.name} glow batch id`).toBeTruthy();
  expect(classic.bodyBatchIds[0], `${viewport.name} distinct body/glow batches`).not.toBe(classic.glowBatchIds[0]);
  expect(classic.body.length, `${viewport.name} body instances`).toBeGreaterThan(0);
  expect(classic.glow.length, `${viewport.name} glow instances`).toBe(classic.body.length);
  expect(classic.bodyMatrices, `${viewport.name} body matrices`).toHaveLength(classic.body.length);
  expect(classic.glowMatrices, `${viewport.name} glow matrices`).toHaveLength(classic.glow.length);
  expect(classic.bodyMatrices, `${viewport.name} body/glow matrix parity`).toEqual(classic.glowMatrices);
  expect(classic.translationCameraFacingAngle, `${viewport.name} translation facing angle`).not.toBeNull();
  expect(classic.translationCameraFacingAngle).toBeLessThanOrEqual(classicTranslationFacingAngleLimit);
  expect(classic.translationParentName, `${viewport.name} translation billboard parent`).toBe('FoliaThreeMode:classic');
  expect(classic.wordEffectLayerName, `${viewport.name} word effect layer`).toBe('ClassicThreeWordEffects');
  expect(classic.spark, `${viewport.name} spark field`).not.toBeNull();
  expect(classic.spark.parentName, `${viewport.name} spark parent`).toBe('ClassicThreeWordEffects');
  expect(classic.spark.capacity, `${viewport.name} spark capacity`).toBe(48);
  expect(classic.spark.points, `${viewport.name} spark lower bound`).toBeGreaterThanOrEqual(0);
  expect(classic.spark.points, `${viewport.name} spark upper bound`).toBeLessThanOrEqual(48);
  expect(diagnostics.snapshot.sparkPoints, `${viewport.name} spark diagnostic parity`).toBe(classic.spark.points);
  expect(diagnostics.snapshot.sparkDrawBatches, `${viewport.name} spark draw batches`).toBeLessThanOrEqual(1);
  expect(classic.safeArea, `${viewport.name} safe area`).toBeDefined();
  expect(classic.safeArea, `${viewport.name} safe area`).not.toBeNull();
  for (const key of ['left', 'right', 'top', 'bottom']) {
    expect(
      Object.prototype.hasOwnProperty.call(classic.safeArea, key),
      `${viewport.name} safe area ${key} exists`,
    ).toBe(true);
    expect(Number.isFinite(classic.safeArea[key]), `${viewport.name} safe area ${key} finite`).toBe(true);
    expect(classic.safeArea[key], `${viewport.name} safe area ${key} non-negative`).toBeGreaterThanOrEqual(0);
    expect(classic.safeArea[key], `${viewport.name} safe area ${key} positive`).toBeGreaterThan(0);
  }
  for (const [index, body] of classic.body.entries()) {
    expect(body.worldMatrix, `${viewport.name} body ${index} world matrix`).toHaveLength(16);
    expect(
      body.worldMatrix.every(Number.isFinite),
      `${viewport.name} body ${index} world matrix finite`,
    ).toBe(true);
    expect(Number.isFinite(body.worldXScale), `${viewport.name} body ${index} world x scale finite`).toBe(true);
    expect(Number.isFinite(body.worldYScale), `${viewport.name} body ${index} world y scale finite`).toBe(true);
    expect(body.worldXScale, `${viewport.name} body ${index} world x scale`).toBeGreaterThan(1e-4);
    expect(body.worldYScale, `${viewport.name} body ${index} world y scale`).toBeGreaterThan(1e-4);
    expect(
      Number.isFinite(body.worldNormalizedDot),
      `${viewport.name} body ${index} world orthogonality finite`,
    ).toBe(true);
    expect(body.worldNormalizedDot, `${viewport.name} body ${index} world orthogonality`).toBeLessThanOrEqual(1e-4);
    expect(Number.isFinite(body.worldAspectRatio), `${viewport.name} body ${index} world aspect ratio finite`).toBe(true);
    expect(body.worldAspectRatio, `${viewport.name} body ${index} world minimum aspect ratio`).toBeGreaterThanOrEqual(0.15);
    expect(body.worldAspectRatio, `${viewport.name} body ${index} world maximum aspect ratio`).toBeLessThanOrEqual(2.5);
    expect(Number.isFinite(body.inPlaneRotation), `${viewport.name} body ${index} in-plane rotation finite`).toBe(true);
    expect(body.inPlaneRotation, `${viewport.name} body ${index} in-plane rotation`).toBeGreaterThanOrEqual(0);
    expect(body.inPlaneRotation, `${viewport.name} body ${index} in-plane rotation`).toBeLessThanOrEqual(
      classicInPlaneRotationLimit,
    );
    expect(
      Number.isFinite(body.worldXCameraRightAlignment),
      `${viewport.name} body ${index} world x/camera right alignment finite`,
    ).toBe(true);
    expect(
      body.worldXCameraRightAlignment,
      `${viewport.name} body ${index} world x/camera right minimum alignment`,
    ).toBeGreaterThanOrEqual(classicCameraAxisAlignmentMinimum);
    expect(
      body.worldXCameraRightAlignment,
      `${viewport.name} body ${index} world x/camera right maximum alignment`,
    ).toBeLessThanOrEqual(1);
    expect(
      Number.isFinite(body.worldYCameraUpAlignment),
      `${viewport.name} body ${index} world y/camera up alignment finite`,
    ).toBe(true);
    expect(
      body.worldYCameraUpAlignment,
      `${viewport.name} body ${index} world y/camera up minimum alignment`,
    ).toBeGreaterThanOrEqual(classicCameraAxisAlignmentMinimum);
    expect(
      body.worldYCameraUpAlignment,
      `${viewport.name} body ${index} world y/camera up maximum alignment`,
    ).toBeLessThanOrEqual(1);
    expect(
      Number.isFinite(body.signedNormalCameraForward),
      `${viewport.name} body ${index} signed normal/camera forward finite`,
    ).toBe(true);
    expect(
      body.signedNormalCameraForward,
      `${viewport.name} body ${index} signed normal/camera forward minimum`,
    ).toBeGreaterThanOrEqual(-1);
    expect(
      body.signedNormalCameraForward,
      `${viewport.name} body ${index} signed normal/camera forward direction`,
    ).toBeLessThanOrEqual(classicSignedNormalCameraForwardMaximum);
    expect(Number.isFinite(body.handedness), `${viewport.name} body ${index} handedness finite`).toBe(true);
    expect(body.handedness, `${viewport.name} body ${index} positive handedness`).toBeGreaterThanOrEqual(
      classicHandednessMinimum,
    );
    expect(body.handedness, `${viewport.name} body ${index} maximum handedness`).toBeLessThanOrEqual(1);
    expect(
      Number.isFinite(body.cameraFacingAngle),
      `${viewport.name} body ${index} camera-facing angle finite`,
    ).toBe(true);
    expect(body.cameraFacingAngle, `${viewport.name} body ${index} camera-facing angle`).toBeGreaterThanOrEqual(0);
    expect(body.cameraFacingAngle, `${viewport.name} body ${index} camera-facing angle`).toBeLessThanOrEqual(
      classicCameraFacingAngleLimit,
    );
    expect(Number.isFinite(body.relativeDepth), `${viewport.name} body ${index} relative depth finite`).toBe(true);
    expect(body.relativeDepth, `${viewport.name} body ${index} relative depth minimum`).toBeGreaterThanOrEqual(
      -classicRelativeDepthLimit,
    );
    expect(body.relativeDepth, `${viewport.name} body ${index} relative depth maximum`).toBeLessThanOrEqual(
      classicRelativeDepthLimit,
    );
  }

  const evidence = classicViewportEvidence(classic, viewport);
  expect(evidence.mainBoundsNonEmpty, `${viewport.name} non-empty main bounds`).toBe(true);
  expect(evidence.translationBoundsNonEmpty, `${viewport.name} non-empty translation bounds`).toBe(true);
  expect(evidence.mainInsideSafeArea, `${viewport.name} main bounds inside safe area`).toBe(true);
  expect(evidence.translationInsideSafeArea, `${viewport.name} translation bounds inside safe area`).toBe(true);
  expect(evidence.mainTranslationDisjoint, `${viewport.name} main/translation separation`).toBe(true);
  expect(evidence.matrixGeometry, `${viewport.name} matrix geometry`).toHaveLength(classic.bodyMatrices.length);
  for (const [index, matrix] of evidence.matrixGeometry.entries()) {
    expect(matrix.finite, `${viewport.name} matrix ${index} finite`).toBe(true);
    expect(matrix.xScale, `${viewport.name} matrix ${index} x scale`).toBeGreaterThan(1e-4);
    expect(matrix.yScale, `${viewport.name} matrix ${index} y scale`).toBeGreaterThan(1e-4);
    expect(matrix.normalizedDot, `${viewport.name} matrix ${index} orthogonality`).toBeLessThanOrEqual(1e-4);
    expect(matrix.aspectRatio, `${viewport.name} matrix ${index} minimum aspect ratio`).toBeGreaterThanOrEqual(0.15);
    expect(matrix.aspectRatio, `${viewport.name} matrix ${index} maximum aspect ratio`).toBeLessThanOrEqual(2.5);
  }
}

async function measureHeapWithCdp(page, { collectGarbage = true } = {}) {
  let session = null;
  let garbageCollected = false;
  let garbageCollectionError = null;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    if (collectGarbage) {
      try {
        await session.send('HeapProfiler.collectGarbage');
        garbageCollected = true;
      } catch (error) {
        garbageCollectionError = String(error && error.message || error);
      }
    }
    const response = await session.send('Performance.getMetrics');
    const metric = (response.metrics || []).find(entry => entry.name === 'JSHeapUsedSize');
    const bytes = Number(metric && metric.value);
    const measured = Number.isFinite(bytes) && bytes > 0;
    return {
      source: heapMeasurementSource,
      measured,
      bytes: measured ? bytes : null,
      garbageCollected,
      garbageCollectionError,
      error: measured ? null : 'JSHeapUsedSize metric unavailable',
    };
  } catch (error) {
    return {
      source: heapMeasurementSource,
      measured: false,
      bytes: null,
      garbageCollected,
      garbageCollectionError,
      error: String(error && error.message || error),
    };
  } finally {
    if (session) {
      try { await session.detach(); } catch (error) {}
    }
  }
}

async function measureRafForDuration(page, requestedDurationMs = classicPerformanceSampleDurationMs) {
  return page.evaluate(durationInput => new Promise(resolve => {
    const durationMs = Math.max(1, Number(durationInput) || 0);
    const frameDeltas = [];
    const longTaskDurations = [];
    let runtimeDeltaSamples = 0;
    let runtimeDeltaTotalMs = 0;
    let longTaskObserver = null;
    const captureLongTasks = entries => {
      for (const entry of entries) longTaskDurations.push(entry.duration);
    };
    try {
      const supportsLongTasks = typeof PerformanceObserver === 'function'
        && Array.isArray(PerformanceObserver.supportedEntryTypes)
        && PerformanceObserver.supportedEntryTypes.includes('longtask');
      if (supportsLongTasks) {
        longTaskObserver = new PerformanceObserver(list => captureLongTasks(list.getEntries()));
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }
    } catch (error) {
      longTaskObserver = null;
    }

    let startedAt = null;
    let previous = null;
    function finish(now) {
      if (longTaskObserver) {
        captureLongTasks(longTaskObserver.takeRecords());
        longTaskObserver.disconnect();
      }
      const sorted = frameDeltas.slice().sort((a, b) => a - b);
      const averageFrameMs = frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length;
      resolve({
        requestedDurationMs: durationMs,
        elapsedMs: now - startedAt,
        samples: frameDeltas.length,
        averageFrameMs,
        averageFps: 1000 / averageFrameMs,
        p95FrameMs: sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))],
        maxFrameMs: sorted.at(-1),
        runtimeDeltaSource: runtimeDeltaSamples === frameDeltas.length ? 'measured-raf' : 'unavailable',
        runtimeDeltaSamples,
        runtimeDeltaTotalMs,
        longTaskSupported: Boolean(longTaskObserver),
        longTaskCount: longTaskDurations.length,
        longTaskTotalMs: longTaskDurations.reduce((sum, value) => sum + value, 0),
        maxLongTaskMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
      });
    }
    function tick(now) {
      if (startedAt === null) {
        startedAt = now;
        previous = now;
        requestAnimationFrame(tick);
        return;
      }
      const frameDeltaMs = now - previous;
      previous = now;
      if (frameDeltaMs > 0) {
        frameDeltas.push(frameDeltaMs);
        if (typeof window.__renderFoliaNativeFrame === 'function' && window.__foliaNativeFixture) {
          window.__renderFoliaNativeFrame(
            window.__foliaNativeFixture.now + (now - startedAt) / 1000,
            frameDeltaMs,
          );
          runtimeDeltaSamples += 1;
          runtimeDeltaTotalMs += frameDeltaMs;
        }
      }
      if (now - startedAt >= durationMs && frameDeltas.length) {
        finish(now);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), requestedDurationMs);
}

async function sampleClassicPerformanceProfile(page, profile) {
  await page.setViewportSize(profile.viewport);
  const resetSnapshot = await renderModeFast(page, classicPerformanceResetMode, profile.quality, 80);
  expect(resetSnapshot.mode, `${profile.name} reset mode`).toBe(classicPerformanceResetMode);
  expect(resetSnapshot.rendererKind, `${profile.name} reset renderer`).toBe('dom');
  const performanceBudgetIndex = await page.evaluate(() => window.__foliaNativePerformanceBudgets.length);
  const activatedSnapshot = await renderModeFast(page, 'classic', profile.quality, 80);
  const activatedState = await page.evaluate(() => ({
    performanceMode: nativeLyricConfig.common.performanceMode,
    performanceBudgetCount: window.__foliaNativePerformanceBudgets.length,
  }));
  expect(activatedSnapshot.mode, `${profile.name} active mode`).toBe('classic');
  expect(activatedSnapshot.backend, `${profile.name} active backend`).toBe('three');
  expect(activatedSnapshot.rendererKind, `${profile.name} renderer kind`).toBe('three');
  expect(activatedState.performanceMode, `${profile.name} performance mode`).toBe(profile.quality);
  expect(activatedState.performanceBudgetCount, `${profile.name} fresh performance budget`).toBe(performanceBudgetIndex + 1);

  await page.waitForTimeout(classicPerformanceWarmupMs);
  const warmedSnapshot = await page.evaluate(() => (
    window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + 0.24)
  ));
  expect(warmedSnapshot.mode, `${profile.name} warmed mode`).toBe('classic');
  expect(warmedSnapshot.backend, `${profile.name} warmed backend`).toBe('three');
  expect(warmedSnapshot.resourcesValid, `${profile.name} warmed resources`).toBe(true);

  const heapBeforeMeasurement = await measureHeapWithCdp(page);
  const measurementTimestamp = new Date().toISOString();
  const frameMeasurement = await measureRafForDuration(page, classicPerformanceSampleDurationMs);
  const after = await page.evaluate(budgetIndex => {
    const snapshot = nativeLyricRuntime.snapshot();
    const performanceBudget = window.__foliaNativePerformanceBudgets[budgetIndex];
    const canvas = renderer && renderer.domElement;
    const width = canvas ? canvas.width : 0;
    const height = canvas ? canvas.height : 0;
    return {
      nativeSnapshot: snapshot,
      performanceSnapshot: performanceBudget && performanceBudget.snapshot ? performanceBudget.snapshot() : null,
      rendererBuffer: { width, height, pixels: width * height },
    };
  }, performanceBudgetIndex);
  const heapAfterMeasurement = await measureHeapWithCdp(page);
  const heapMeasured = isCollectedHeapPair(heapBeforeMeasurement, heapAfterMeasurement);
  return {
    measurementTimestamp,
    viewport: { ...profile.viewport },
    quality: profile.quality,
    resetMode: classicPerformanceResetMode,
    warmupDurationMs: classicPerformanceWarmupMs,
    sampleDurationMs: classicPerformanceSampleDurationMs,
    ...frameMeasurement,
    heapMeasurementSource,
    heapMeasured,
    heapBefore: heapMeasured ? heapBeforeMeasurement.bytes : null,
    heapAfter: heapMeasured ? heapAfterMeasurement.bytes : null,
    heapGrowthBytes: heapMeasured ? heapAfterMeasurement.bytes - heapBeforeMeasurement.bytes : null,
    heapMeasurements: { before: heapBeforeMeasurement, after: heapAfterMeasurement },
    nativeSnapshot: after.nativeSnapshot,
    performanceSnapshot: after.performanceSnapshot,
    rendererBuffer: after.rendererBuffer,
  };
}

async function rendererDiagnostics(page, mode) {
  return page.evaluate(expectedMode => {
    function canvasSignal(source) {
      if (!source || !source.width || !source.height) return 0;
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 36;
      const context = probe.getContext('2d');
      try { context.drawImage(source, 0, 0, probe.width, probe.height); } catch (error) { return 0; }
      const data = context.getImageData(0, 0, probe.width, probe.height).data;
      let signal = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] > 8 && data[index] + data[index + 1] + data[index + 2] > 24) signal += 1;
      }
      return signal / (probe.width * probe.height);
    }
    function glassMaterial(node) {
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        background: style.backgroundImage !== 'none' ? style.backgroundImage : style.backgroundColor,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
      };
    }
    function cleanNumber(value) {
      const rounded = Number(Number(value || 0).toFixed(7));
      return Object.is(rounded, -0) ? 0 : rounded;
    }
    function cleanWorldNumber(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return number;
      const rounded = Number(number.toFixed(7));
      return Object.is(rounded, -0) ? 0 : rounded;
    }
    function nodeMaterial(node) {
      const material = node && node.material;
      return Array.isArray(material) ? material[0] || null : material || null;
    }
    function projectBounds(entries) {
      if (!entries.length || !window.THREE || !window.camera) return null;
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const instance = new THREE.Matrix4();
      const world = new THREE.Matrix4();
      const point = new THREE.Vector3();
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      camera.updateMatrixWorld(true);
      entries.forEach(entry => {
        entry.mesh.updateMatrixWorld(true);
        entry.mesh.getMatrixAt(entry.index, instance);
        world.multiplyMatrices(entry.mesh.matrixWorld, instance);
        corners.forEach(corner => {
          point.set(corner[0], corner[1], 0).applyMatrix4(world).project(camera);
          const x = (point.x + 1) * innerWidth / 2;
          const y = (1 - point.y) * innerHeight / 2;
          bounds.left = Math.min(bounds.left, x);
          bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.bottom = Math.max(bounds.bottom, y);
        });
      });
      return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, cleanNumber(value)]));
    }
    function projectPlaneBounds(mesh) {
      if (!mesh || !mesh.visible || !window.THREE || !window.camera) return null;
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const point = new THREE.Vector3();
      camera.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);
      [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].forEach(corner => {
        point.set(corner[0], corner[1], 0).applyMatrix4(mesh.matrixWorld).project(camera);
        const x = (point.x + 1) * innerWidth / 2;
        const y = (1 - point.y) * innerHeight / 2;
        bounds.left = Math.min(bounds.left, x);
        bounds.right = Math.max(bounds.right, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.bottom = Math.max(bounds.bottom, y);
      });
      return Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, cleanNumber(value)]));
    }
    function sampleTransitionRoot(transitionRoot) {
      if (!transitionRoot || !transitionRoot.children || !transitionRoot.children.length) return null;
      if (!window.THREE || !window.renderer || !window.camera || typeof renderer.readRenderTargetPixels !== 'function') return null;
      const width = 320;
      const height = 180;
      const previousTarget = renderer.getRenderTarget();
      const previousViewport = renderer.getViewport(new THREE.Vector4()).clone();
      const previousScissor = renderer.getScissor(new THREE.Vector4()).clone();
      const previousScissorTest = renderer.getScissorTest();
      const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
      const previousClearAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;
      const previousCameraLayerMask = camera.layers && camera.layers.mask;
      let target = null;
      try {
        target = new THREE.WebGLRenderTarget(width, height, {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: false,
          stencilBuffer: false,
        });
        const isolatedScene = new THREE.Scene();
        isolatedScene.add(transitionRoot.clone(true));
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        renderer.clear(true, true, true);
        renderer.render(isolatedScene, camera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        let visiblePixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] > 3 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 6) visiblePixels += 1;
        }
        return {
          width,
          height,
          visiblePixels,
          visibleRatio: visiblePixels / (width * height),
        };
      } finally {
        if (camera.layers && previousCameraLayerMask != null) camera.layers.mask = previousCameraLayerMask;
        renderer.setRenderTarget(previousTarget);
        renderer.setViewport(previousViewport.x, previousViewport.y, previousViewport.z, previousViewport.w);
        renderer.setScissor(previousScissor.x, previousScissor.y, previousScissor.z, previousScissor.w);
        renderer.setScissorTest(previousScissorTest);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
        if (target) target.dispose();
      }
    }
    function classicSceneDiagnostics(foliaRoot, translationMesh, rendererSnapshot) {
      if (!foliaRoot) return null;
      camera.updateMatrixWorld(true);
      foliaRoot.updateMatrixWorld(true);
      const cameraForward = camera.getWorldDirection(new THREE.Vector3()).normalize();
      const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const foliaRootWorldOrigin = foliaRoot.getWorldPosition(new THREE.Vector3());
      const bodyEntries = [];
      const glowEntries = [];
      function nodeFacingAngle(node) {
        if (!node) return null;
        node.updateMatrixWorld(true);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(node.matrixWorld);
        const normal = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();
        const facingDot = Math.abs(normal.dot(cameraForward));
        return cleanWorldNumber(Math.acos(Math.min(1, Math.max(0, facingDot))));
      }
      function instanceWorldDiagnostics(mesh, index) {
        const instanceMatrix = new THREE.Matrix4();
        const worldMatrix = new THREE.Matrix4();
        mesh.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
        const elements = worldMatrix.elements;
        const worldXAxis = new THREE.Vector3(elements[0], elements[1], elements[2]);
        const worldYAxis = new THREE.Vector3(elements[4], elements[5], elements[6]);
        const worldXScale = worldXAxis.length();
        const worldYScale = worldYAxis.length();
        const worldNormalizedDot = worldXScale > 0 && worldYScale > 0
          ? Math.abs(worldXAxis.dot(worldYAxis) / (worldXScale * worldYScale))
          : Infinity;
        const worldAspectRatio = worldYScale > 0 ? worldXScale / worldYScale : Infinity;
        const worldXCameraRightAlignment = worldXScale > 0
          ? worldXAxis.dot(cameraRight) / worldXScale
          : NaN;
        const worldYCameraUpAlignment = worldYScale > 0
          ? worldYAxis.dot(cameraUp) / worldYScale
          : NaN;
        const projectedWorldX = worldXAxis.clone()
          .addScaledVector(cameraForward, -worldXAxis.dot(cameraForward));
        const projectedWorldXLength = projectedWorldX.length();
        const inPlaneRotation = projectedWorldXLength > 1e-8
          ? Math.abs(Math.atan2(projectedWorldX.dot(cameraUp), projectedWorldX.dot(cameraRight)))
          : NaN;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
        const worldNormal = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();
        const signedNormalCameraForward = worldNormal.dot(cameraForward);
        const worldXYNormal = new THREE.Vector3().crossVectors(worldXAxis, worldYAxis);
        const worldXYNormalScale = worldXYNormal.length();
        const handedness = worldXYNormalScale > 0
          ? worldXYNormal.dot(worldNormal) / worldXYNormalScale
          : NaN;
        const worldPosition = new THREE.Vector3().setFromMatrixPosition(worldMatrix);
        const facingDot = Math.abs(signedNormalCameraForward);
        const cameraFacingAngle = Math.acos(Math.min(1, Math.max(0, facingDot)));
        const relativeDepth = new THREE.Vector3()
          .subVectors(worldPosition, foliaRootWorldOrigin)
          .dot(cameraForward);
        return {
          worldMatrix: Array.from(worldMatrix.elements, cleanWorldNumber),
          worldXScale: cleanWorldNumber(worldXScale),
          worldYScale: cleanWorldNumber(worldYScale),
          worldNormalizedDot: cleanWorldNumber(worldNormalizedDot),
          worldAspectRatio: cleanWorldNumber(worldAspectRatio),
          inPlaneRotation: cleanWorldNumber(inPlaneRotation),
          worldXCameraRightAlignment: cleanWorldNumber(worldXCameraRightAlignment),
          worldYCameraUpAlignment: cleanWorldNumber(worldYCameraUpAlignment),
          signedNormalCameraForward: cleanWorldNumber(signedNormalCameraForward),
          handedness: cleanWorldNumber(handedness),
          cameraFacingAngle: cleanWorldNumber(cameraFacingAngle),
          relativeDepth: cleanWorldNumber(relativeDepth),
        };
      }
      foliaRoot.traverse(node => {
        if (!node || !node.isInstancedMesh || !node.instanceMatrix) return;
        const material = nodeMaterial(node);
        const variant = material && material.userData && material.userData.variant || '';
        if (variant !== 'body' && !variant.startsWith('glow-')) return;
        const attributes = node.geometry && node.geometry.attributes || {};
        const target = variant === 'body' ? bodyEntries : glowEntries;
        for (let index = 0; index < Number(node.count || 0); index += 1) {
          const offset = index * 16;
          const worldDiagnostics = instanceWorldDiagnostics(node, index);
          target.push({
            mesh: node,
            index,
            matrix: Array.from(node.instanceMatrix.array.slice(offset, offset + 16), cleanNumber),
            worldMatrix: worldDiagnostics.worldMatrix,
            worldXScale: worldDiagnostics.worldXScale,
            worldYScale: worldDiagnostics.worldYScale,
            worldNormalizedDot: worldDiagnostics.worldNormalizedDot,
            worldAspectRatio: worldDiagnostics.worldAspectRatio,
            inPlaneRotation: worldDiagnostics.inPlaneRotation,
            worldXCameraRightAlignment: worldDiagnostics.worldXCameraRightAlignment,
            worldYCameraUpAlignment: worldDiagnostics.worldYCameraUpAlignment,
            signedNormalCameraForward: worldDiagnostics.signedNormalCameraForward,
            handedness: worldDiagnostics.handedness,
            cameraFacingAngle: worldDiagnostics.cameraFacingAngle,
            relativeDepth: worldDiagnostics.relativeDepth,
            progress: cleanNumber(attributes.aProgress && attributes.aProgress.array[index]),
            glow: cleanNumber(attributes.aGlow && attributes.aGlow.array[index]),
            opacity: cleanNumber(attributes.aOpacity && attributes.aOpacity.array[index]),
            variant,
            tapCount: Number(material && material.userData && material.userData.tapCount || 0),
            blending: Number(material && material.blending),
            transparent: !!(material && material.transparent),
            premultipliedAlpha: !!(material && material.premultipliedAlpha),
            batchId: String(node.uuid || ''),
          });
        }
      });
      function compareEntries(left, right) {
        for (const index of [12, 13, 14, 0, 1, 4, 5]) {
          if (left.matrix[index] !== right.matrix[index]) return left.matrix[index] - right.matrix[index];
        }
        return left.index - right.index;
      }
      bodyEntries.sort(compareEntries);
      glowEntries.sort(compareEntries);
      const publicEntry = entry => ({
        matrix: entry.matrix,
        worldMatrix: entry.worldMatrix,
        worldXScale: entry.worldXScale,
        worldYScale: entry.worldYScale,
        worldNormalizedDot: entry.worldNormalizedDot,
        worldAspectRatio: entry.worldAspectRatio,
        inPlaneRotation: entry.inPlaneRotation,
        worldXCameraRightAlignment: entry.worldXCameraRightAlignment,
        worldYCameraUpAlignment: entry.worldYCameraUpAlignment,
        signedNormalCameraForward: entry.signedNormalCameraForward,
        handedness: entry.handedness,
        cameraFacingAngle: entry.cameraFacingAngle,
        relativeDepth: entry.relativeDepth,
        progress: entry.progress,
        glow: entry.glow,
        opacity: entry.opacity,
        variant: entry.variant,
        tapCount: entry.tapCount,
        blending: entry.blending,
        transparent: entry.transparent,
        premultipliedAlpha: entry.premultipliedAlpha,
        batchId: entry.batchId,
      });
      const transitionRoot = window.scene && scene.getObjectByName
        ? scene.getObjectByName('MineradioFoliaThreeTransitions')
        : null;
      const transitionMesh = transitionRoot && transitionRoot.children && transitionRoot.children[0] || null;
      const transitionMaterial = nodeMaterial(transitionMesh);
      const transitionUniforms = transitionMaterial && transitionMaterial.uniforms || {};
      const transition = transitionMesh ? {
        opacity: cleanNumber(transitionUniforms.uOpacity && transitionUniforms.uOpacity.value),
        blurPx: cleanNumber(transitionUniforms.uBlurPx && transitionUniforms.uBlurPx.value),
        scale: cleanNumber(transitionMesh.scale && transitionMesh.scale.x),
        released: false,
      } : null;
      const transitionSample = sampleTransitionRoot(transitionRoot);
      const safeArea = typeof nativeLyricSafeArea === 'function'
        ? nativeLyricSafeArea({ viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 } })
        : null;
      const wordEffectLayer = foliaRoot.getObjectByName
        ? foliaRoot.getObjectByName('ClassicThreeWordEffects')
        : null;
      const sparkField = foliaRoot.getObjectByName
        ? foliaRoot.getObjectByName('ClassicThreeSparkField')
        : null;
      const sparkMaterial = nodeMaterial(sparkField);
      const sparkPosition = sparkField && sparkField.geometry && sparkField.geometry.getAttribute
        ? sparkField.geometry.getAttribute('position')
        : null;
      const sparkDrawRange = sparkField && sparkField.geometry && sparkField.geometry.drawRange;
      return {
        body: bodyEntries.map(publicEntry),
        glow: glowEntries.map(publicEntry),
        bodyMatrices: bodyEntries.map(entry => entry.matrix),
        glowMatrices: glowEntries.map(entry => entry.matrix),
        bodyBatchIds: Array.from(new Set(bodyEntries.map(entry => entry.batchId))).sort(),
        glowBatchIds: Array.from(new Set(glowEntries.map(entry => entry.batchId))).sort(),
        bodyBlendings: Array.from(new Set(bodyEntries.map(entry => entry.blending))).sort((a, b) => a - b),
        glowBlendings: Array.from(new Set(glowEntries.map(entry => entry.blending))).sort((a, b) => a - b),
        glowTapCounts: Array.from(new Set(glowEntries.map(entry => entry.tapCount))).sort((a, b) => a - b),
        glowVariant: String(rendererSnapshot && rendererSnapshot.glowVariant || 'none'),
        mainBounds: projectBounds(bodyEntries),
        translationBounds: projectPlaneBounds(translationMesh),
        translationCameraFacingAngle: nodeFacingAngle(translationMesh),
        translationParentName: String(translationMesh && translationMesh.parent && translationMesh.parent.name || ''),
        wordEffectLayerName: String(wordEffectLayer && wordEffectLayer.name || ''),
        spark: sparkField ? {
          visible: sparkField.visible === true,
          parentName: String(sparkField.parent && sparkField.parent.name || ''),
          capacity: Number(sparkPosition && sparkPosition.count || 0),
          points: Number(sparkDrawRange && sparkDrawRange.count || 0),
          opacity: cleanNumber(sparkMaterial && sparkMaterial.uniforms && sparkMaterial.uniforms.uOpacity && sparkMaterial.uniforms.uOpacity.value),
        } : null,
        safeArea,
        transition,
        transitionSample,
        transitionLayerCount: transitionRoot && transitionRoot.children ? transitionRoot.children.length : 0,
      };
    }
    const root = document.getElementById('native-lyric-root');
    const canvases = Array.from(root.querySelectorAll('canvas'));
    const isThreeMode = expectedMode === 'mineradio-3d' || expectedMode === 'classic';
    if (isThreeMode && window.renderer && renderer.domElement) canvases.push(renderer.domElement);
    const snapshot = nativeLyricRuntime.snapshot();
    const rootRect = root.getBoundingClientRect();
    const rendererCanvas = window.renderer && renderer.domElement || null;
    const rendererRect = rendererCanvas && rendererCanvas.getBoundingClientRect();
    const rendererStyle = rendererCanvas && getComputedStyle(rendererCanvas);
    const tiltCharacters = Array.from(root.querySelectorAll('.native-tilt-character')).slice(0, 6);
    const cappellaBubbles = Array.from(root.querySelectorAll('.native-cappella-message.is-lyric .native-cappella-bubble'));
    const foliaRoot = window.nativeThreeLyricHost && nativeThreeLyricHost.getRoot ? nativeThreeLyricHost.getRoot() : null;
    let classicMaxGlow = 0;
    if (expectedMode === 'classic' && foliaRoot && foliaRoot.traverse) {
      foliaRoot.traverse(node => {
        const attribute = node.geometry && node.geometry.getAttribute && node.geometry.getAttribute('aGlow');
        if (!attribute || !attribute.array) return;
        const count = Math.min(attribute.count, Number(node.count) || 0);
        for (let index = 0; index < count; index += 1) classicMaxGlow = Math.max(classicMaxGlow, attribute.array[index]);
      });
    }
    const classicRipple = expectedMode === 'classic' && foliaRoot && foliaRoot.getObjectByName
      ? foliaRoot.getObjectByName('ClassicThreeRipple')
      : null;
    const classicTranslation = expectedMode === 'classic' && foliaRoot && foliaRoot.getObjectByName
      ? foliaRoot.getObjectByName('ClassicThreeTranslation')
      : null;
    const classicScene = expectedMode === 'classic'
      ? classicSceneDiagnostics(foliaRoot, classicTranslation, snapshot)
      : null;
    return {
      snapshot,
      textLength: String(root.innerText || '').trim().length,
      rootChildren: root.children.length,
      rootRect: { width: rootRect.width, height: rootRect.height },
      canvasSignals: canvases.map(canvasSignal),
      transitionLayers: root.querySelectorAll('.native-lyric-transition-ghost').length,
      sharedCanvas: rendererRect ? {
        width: rendererRect.width,
        height: rendererRect.height,
        visibility: rendererStyle.visibility,
        pointerEvents: rendererStyle.pointerEvents,
      } : null,
      tiltStyles: tiltCharacters.map(node => {
        const style = getComputedStyle(node);
        return { className: node.className, color: style.color, opacity: style.opacity, textShadow: style.textShadow };
      }),
      cappella: expectedMode === 'cappella' ? {
        bubbles: cappellaBubbles.map(node => {
          const style = getComputedStyle(node);
          const verticalInset = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
            + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
          return {
            width: node.getBoundingClientRect().width,
            lineCount: Math.max(1, Math.round((node.offsetHeight - verticalInset) / parseFloat(style.lineHeight))),
          };
        }),
        avatarImageCount: root.querySelectorAll('img.native-cappella-avatar').length,
        avatarTags: Array.from(root.querySelectorAll('.native-cappella-avatar')).map(node => node.tagName),
        materials: {
          leftBubble: glassMaterial(root.querySelector('.native-cappella-message.is-left .native-cappella-bubble.is-lyric')),
          rightBubble: glassMaterial(root.querySelector('.native-cappella-message.is-right .native-cappella-bubble.is-lyric')),
          leftAvatar: glassMaterial(root.querySelector('.native-cappella-message.is-left .native-cappella-avatar')),
          rightAvatar: glassMaterial(root.querySelector('.native-cappella-message.is-right .native-cappella-avatar')),
        },
      } : null,
      three: isThreeMode ? {
        groupVisible: expectedMode === 'mineradio-3d'
          ? !!(stageLyrics && stageLyrics.group && stageLyrics.group.visible)
          : !!(foliaRoot && foliaRoot.visible),
        groupChildren: stageLyrics && stageLyrics.group ? stageLyrics.group.children.length : 0,
        currentText: stageLyrics && stageLyrics.currentText || '',
        hasCurrent: !!(stageLyrics && stageLyrics.current),
        stageGroupVisible: !!(stageLyrics && stageLyrics.group && stageLyrics.group.visible),
        foliaChildren: foliaRoot ? foliaRoot.children.length : 0,
        host: window.nativeThreeLyricHost && nativeThreeLyricHost.snapshot ? nativeThreeLyricHost.snapshot() : null,
        lyricLayer: expectedMode === 'classic' && window.nativeThreeLyricHost && nativeThreeLyricHost.sampleActiveLayer
          ? nativeThreeLyricHost.sampleActiveLayer({ width: 320, height: 180, alphaThreshold: 0.05 })
          : null,
        maxGlow: classicMaxGlow,
        rippleVisible: !!(classicRipple && classicRipple.visible),
        translationVisible: !!(classicTranslation && classicTranslation.visible),
        classic: classicScene,
        drawCalls: renderer && renderer.info && renderer.info.render && renderer.info.render.calls || 0,
        canvas: rendererRect ? {
          width: rendererRect.width,
          height: rendererRect.height,
          display: rendererStyle.display,
          visibility: rendererStyle.visibility,
          opacity: rendererStyle.opacity,
        } : null,
      } : null,
    };
  }, mode);
}

for (const viewport of viewports) {
  test(`eight native modes render at ${viewport.name}`, async ({ page }) => {
    // Scoped to this eight-mode screenshot and diagnostics contract only.
    test.setTimeout(300000);
    const pageErrors = await preparePage(page, viewport);
    for (const mode of modes) {
      await renderMode(page, mode);
      if (mode === 'cappella') {
        await page.evaluate(() => window.__renderFoliaNativeFrame(25.65));
        await page.waitForTimeout(320);
      }
      const diagnostics = await rendererDiagnostics(page, mode);
      expect(diagnostics.snapshot.mode).toBe(mode);
      expect(diagnostics.snapshot.rendererKind).toBe(backendKinds[mode]);
      expect(diagnostics.snapshot.activeRenderers).toBe(1);
      expect(diagnostics.transitionLayers).toBe(0);
      expect(diagnostics.rootRect.width).toBe(viewport.width);
      expect(diagnostics.rootRect.height).toBe(viewport.height);
      expect(diagnostics.sharedCanvas).not.toBeNull();
      expect(diagnostics.sharedCanvas.visibility).toBe('visible');
      expect(diagnostics.sharedCanvas.pointerEvents).not.toBe('none');
      if (mode === 'classic') {
        expect(diagnostics.snapshot.backend).toBe('three');
        expect(diagnostics.snapshot.backendFallbackCount).toBe(0);
        expect(diagnostics.textLength).toBe(0);
        expect(diagnostics.rootChildren).toBe(0);
        expect(diagnostics.three.groupVisible).toBe(true);
        expect(diagnostics.three.stageGroupVisible).toBe(false);
        expect(diagnostics.three.foliaChildren).toBe(1);
        expect(diagnostics.three.host.atlasPages).toBeGreaterThan(0);
        expect(diagnostics.three.host.glyphInstances).toBeGreaterThan(0);
        expect(diagnostics.three.host.drawBatches).toBeGreaterThan(0);
        expect(diagnostics.three.lyricLayer).not.toBeNull();
        expect(diagnostics.three.lyricLayer.visibleRatio).toBeGreaterThan(0.005);
        expectClassicViewportConstraints(diagnostics, viewport);
      }
      if (mode === 'cappella') {
        const widths = diagnostics.cappella.bubbles.map(bubble => bubble.width);
        expect(widths.length).toBeGreaterThan(1);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
        expect(diagnostics.cappella.bubbles.every(bubble => bubble.lineCount === 1 || bubble.lineCount === 2)).toBe(true);
        expect(diagnostics.cappella.bubbles.some(bubble => bubble.lineCount === 2)).toBe(true);
        expect(diagnostics.cappella.avatarImageCount).toBe(0);
        expect(diagnostics.cappella.avatarTags.every(tag => tag === 'SPAN')).toBe(true);
        for (const material of Object.values(diagnostics.cappella.materials)) {
          expect(material).not.toBeNull();
          expect(material.backdropFilter).not.toBe('none');
        }
        expect(diagnostics.cappella.materials.leftBubble.backdropFilter)
          .not.toBe(diagnostics.cappella.materials.rightBubble.backdropFilter);
        expect(diagnostics.cappella.materials.leftAvatar.backdropFilter)
          .not.toBe(diagnostics.cappella.materials.rightAvatar.backdropFilter);
      }
      if (!['mineradio-3d', 'classic', 'fume'].includes(mode)) expect(diagnostics.textLength).toBeGreaterThan(0);
      const screenshotPath = path.join(screenshotRoot, `${viewport.name}-${mode}.png`);
      const buffer = await page.screenshot({ path: screenshotPath, animations: 'disabled' });
      fs.writeFileSync(path.join(screenshotRoot, `${viewport.name}-${mode}.json`), JSON.stringify(diagnostics, null, 2));
      const stats = imageStats(buffer);
      expect(stats.visibleRatio, `${mode} alpha coverage`).toBeGreaterThan(0.98);
      expect(stats.brightRatio, `${mode} composed pixels`).toBeGreaterThan(0.002);
      if (['cadenza', 'monet', 'fume'].includes(mode)) {
        expect(Math.max(0, ...diagnostics.canvasSignals), `${mode} canvas pixels`).toBeGreaterThan(0.002);
      }
    }
    expect(pageErrors).toEqual([]);
  });
}

test('Cappella advances without flashing the existing conversation', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 960, height: 540 });
  await renderMode(page, 'cappella');
  await page.evaluate(() => window.__renderFoliaNativeFrame(13.95));
  await page.waitForTimeout(320);
  const transition = await page.evaluate(() => {
    const list = document.querySelector('.native-cappella-list');
    const before = Array.from(list && list.children || []).map(node => ({
      key: node.getAttribute('data-message-key'),
      top: node.getBoundingClientRect().top,
      opacity: Number(getComputedStyle(node).opacity),
    }));
    window.__renderFoliaNativeFrame(14.02);
    const retained = before.map(item => {
      const node = list.querySelector(`[data-message-key="${item.key}"]`);
      const animations = node && node.getAnimations ? node.getAnimations() : [];
      const enterAnimations = animations.filter(animation => (
        animation.constructor && animation.constructor.name === 'CSSAnimation'
        && animation.animationName === 'native-cappella-enter'
      ));
      return {
        key: item.key,
        beforeTop: item.top,
        beforeOpacity: item.opacity,
        immediateTop: node && node.getBoundingClientRect().top,
        immediateOpacity: node ? Number(getComputedStyle(node).opacity) : null,
        enterAnimations: enterAnimations.length,
      };
    }).filter(item => item.immediateTop != null);
    return {
      retained,
      listAnimations: list && list.getAnimations ? list.getAnimations().length : 0,
    };
  });
  await page.waitForTimeout(100);
  const midTops = await page.evaluate(keys => keys.map(key => {
    const node = document.querySelector(`.native-cappella-message[data-message-key="${key}"]`);
    return node ? node.getBoundingClientRect().top : null;
  }), transition.retained.map(item => item.key));

  expect(transition.retained.length).toBeGreaterThan(1);
  expect(Math.max(...transition.retained.map(item => Math.abs(item.immediateTop - item.beforeTop)))).toBeLessThanOrEqual(4);
  expect(transition.listAnimations).toBeGreaterThan(0);
  expect(transition.retained.every(item => item.enterAnimations === 0)).toBe(true);
  expect(Math.max(...transition.retained.map(item => Math.abs(item.immediateOpacity - item.beforeOpacity)))).toBeLessThanOrEqual(0.05);
  expect(transition.retained.every((item, index) => midTops[index] != null && midTops[index] < item.beforeTop - 1)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('Classic renders Folia motion in the shared Three canvas and applies live tuning', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  await page.evaluate(async () => {
    await window.__setFoliaNativeMode('classic', 'balanced');
    const configApi = window.MineradioNativeLyricConfig;
    nativeLyricConfig = configApi.patchNativeLyricConfig(nativeLyricConfig, {
      modes: {
        classic: {
          intensity: 'chaotic',
          spread: 1,
          enableWordRotation: true,
          useLegacyLayout: false,
          wordSpacing: 0.7,
          wordGlow: 1,
          breathing: 1,
          chorusRipple: true,
        },
      },
    });
    window.__renderFoliaNativeFrame(12.0);
  });
  await page.waitForTimeout(120);

  const active = await rendererDiagnostics(page, 'classic');
  expect(active.snapshot.backend).toBe('three');
  expect(active.snapshot.backendFallbackCount).toBe(0);
  expect(active.three.host.glyphInstances).toBeGreaterThan(0);
  expect(active.three.host.drawBatches).toBeGreaterThan(0);
  expect(active.three.lyricLayer.visibleRatio).toBeGreaterThan(0.005);
  expect(active.three.maxGlow).toBeGreaterThan(0);
  expect(active.three.translationVisible).toBe(true);
  expect(await page.locator('.native-classic-line').count()).toBe(0);

  await page.evaluate(() => window.__renderFoliaNativeFrame(14.12));
  const chorus = await rendererDiagnostics(page, 'classic');
  expect(chorus.three.rippleVisible).toBe(true);

  await page.evaluate(() => {
    const configApi = window.MineradioNativeLyricConfig;
    nativeLyricConfig = configApi.patchNativeLyricConfig(nativeLyricConfig, {
      modes: { classic: { wordGlow: 0, chorusRipple: false } },
    });
    window.__renderFoliaNativeFrame(14.14);
  });
  const disabled = await rendererDiagnostics(page, 'classic');
  expect(disabled.three.maxGlow).toBe(0);
  expect(disabled.three.rippleVisible).toBe(false);
  expect(disabled.three.host.activeScopes).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('Classic semantic groups enter sequentially with matched body and glow matrices', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  await activateClassicFixture(page);

  const before = await submitClassicFrame(page, { now: 0.84, rafDeltaMs: 0, lineIndex: 0 });
  const firstSpring = await submitClassicFrame(page, { now: 0.98, rafDeltaMs: 16, lineIndex: 0 });
  await page.screenshot({ path: path.join(screenshotRoot, '1366x768-classic-first-group.png'), animations: 'disabled' });
  const firstStable = await submitClassicFrame(page, { now: 1.36, rafDeltaMs: 16, lineIndex: 0 });
  const secondSpring = await submitClassicFrame(page, { now: 1.98, rafDeltaMs: 16, lineIndex: 0 });
  await page.screenshot({ path: path.join(screenshotRoot, '1366x768-classic-second-group.png'), animations: 'disabled' });
  const passed = await submitClassicFrame(page, { now: 3.72, rafDeltaMs: 16, lineIndex: 0 });
  await page.screenshot({ path: path.join(screenshotRoot, '1366x768-classic-passed.png'), animations: 'disabled' });

  expect(before.snapshot.groupStates.map(group => group.phase)).toEqual(['waiting', 'waiting', 'waiting']);
  expect(firstSpring.snapshot.groupStates.map(group => group.phase)).toEqual(['entering', 'waiting', 'waiting']);
  expect(firstStable.snapshot.groupStates.map(group => group.phase)).toEqual(['active', 'waiting', 'waiting']);
  expect(secondSpring.snapshot.groupStates.map(group => group.phase)).toEqual(['passed', 'entering', 'waiting']);
  expect(passed.snapshot.groupStates.map(group => group.phase)).toEqual(['passed', 'passed', 'passed']);

  for (const diagnostics of [before, firstSpring, firstStable, secondSpring, passed]) {
    expectBodyGlowMatrixParity(diagnostics);
    expect(diagnostics.snapshot.activeGroupKeys.length).toBeLessThan(3);
  }

  const triggerFrames = [];
  for (const now of [0.85, 1.85, 2.85]) {
    triggerFrames.push(await submitClassicFrame(page, { now, rafDeltaMs: 0, lineIndex: 0 }));
  }
  expect(triggerFrames.map(frame => frame.snapshot.groupStates.map(group => group.phase))).toEqual([
    ['entering', 'waiting', 'waiting'],
    ['passed', 'entering', 'waiting'],
    ['passed', 'passed', 'entering'],
  ]);
  expect(triggerFrames.every(frame => frame.snapshot.activeGroupKeys.length === 1)).toBe(true);

  expect(before.snapshot.sparkPoints).toBe(0);
  expect(firstSpring.snapshot.sparkPoints).toBe(32);
  expect(firstStable.snapshot.sparkPoints).toBe(32);
  expect(secondSpring.snapshot.sparkPoints).toBe(32);
  expect(passed.snapshot.sparkPoints).toBe(0);
  expect(firstStable.three.classic.spark).toMatchObject({
    visible: true,
    parentName: 'ClassicThreeWordEffects',
    capacity: 48,
    points: 32,
  });
  expect(firstStable.three.classic.spark.opacity).toBeGreaterThan(0);

  const spatialBodies = firstStable.three.classic.body;
  const depthValues = spatialBodies.map(body => body.relativeDepth);
  const verticalValues = spatialBodies.map(body => body.matrix[13]);
  const scaleValues = spatialBodies.map(body => body.worldXScale);
  expect(Math.max(...depthValues) - Math.min(...depthValues)).toBeGreaterThanOrEqual(classicVisibleDepthSpanMinimum);
  expect(Math.max(...verticalValues) - Math.min(...verticalValues)).toBeGreaterThanOrEqual(classicVisibleVerticalRangeMinimum);
  expect(Math.max(...scaleValues) - Math.min(...scaleValues)).toBeGreaterThanOrEqual(classicVisibleScaleRangeMinimum);
  expect(Math.max(...spatialBodies.map(body => body.cameraFacingAngle))).toBeGreaterThanOrEqual(classicVisibleTiltMinimum);
  expect(spatialBodies.some(body => Math.abs(body.matrix[2]) > 1e-4 || Math.abs(body.matrix[6]) > 1e-4)).toBe(true);
  expect(firstStable.three.classic.translationCameraFacingAngle).toBeLessThanOrEqual(classicTranslationFacingAngleLimit);

  const classic = passed.three.classic;
  expect(classic.mainBounds.left).toBeGreaterThanOrEqual(classic.safeArea.left - 2);
  expect(classic.mainBounds.right).toBeLessThanOrEqual(1366 - classic.safeArea.right + 2);
  expect(classic.mainBounds.top).toBeGreaterThanOrEqual(classic.safeArea.top - 2);
  expect(classic.translationBounds.bottom).toBeLessThanOrEqual(768 - classic.safeArea.bottom + 2);
  expect(classic.mainBounds.bottom).toBeLessThan(classic.translationBounds.top);
  expect(passed.three.lyricLayer.visibleRatio).toBeGreaterThan(0.005);
  expect(pageErrors).toEqual([]);
});

test('Classic 1.8 stage scale stays inside the real asymmetric shelf safe area', async ({ page }) => {
  const viewport = { width: 1366, height: 768 };
  const pageErrors = await preparePage(page, viewport);
  await page.evaluate(() => {
    const stateApi = window.MineradioNativeLyricState;
    window.__foliaClassicFixture.documents['stage-scale'] = stateApi.buildNativeLyricDocument([{
      t: 1,
      duration: 4,
      text: '流光穿过很长很长的夜色直到城市另一端',
      translation: 'The streaming light crosses the city to the other side.',
    }], {
      id: 'playwright-classic-stage-scale',
      source: 'fixture',
      title: '流光',
      artist: 'Mineradio',
      duration: 5,
    });
    window.shouldOffsetLyricsForShelfDetail = () => true;
  });
  await activateClassicFixture(page, 'stage-scale');
  await page.evaluate(() => {
    nativeLyricConfig = window.MineradioNativeLyricConfig.patchNativeLyricConfig(nativeLyricConfig, {
      common: { scale: 1.8 },
    });
  });

  const diagnostics = await submitClassicFrame(page, {
    fixture: 'stage-scale',
    now: 2.2,
    rafDeltaMs: 16,
    lineIndex: 0,
  });
  const classic = diagnostics.three.classic;
  const evidence = classicViewportEvidence(classic, viewport);

  expect(classic.safeArea.right).toBeGreaterThan(classic.safeArea.left * 2);
  expect(evidence.mainInsideSafeArea).toBe(true);
  expect(evidence.translationInsideSafeArea).toBe(true);
  expect(evidence.mainTranslationDisjoint).toBe(true);
  expect(diagnostics.snapshot.backend).toBe('three');
  expect(pageErrors).toEqual([]);
});

test('Classic pause seek is analytic and reduced motion still fades', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  await activateClassicFixture(page);

  const pausedBefore = await submitClassicFrame(page, { now: 1.12, rafDeltaMs: 16, lineIndex: 0, playing: false });
  const pausedAfter = await submitClassicFrame(page, { now: 1.12, rafDeltaMs: 500, lineIndex: 0, playing: false });
  expectBodyGlowMatrixParity(pausedBefore);
  expectBodyGlowMatrixParity(pausedAfter);
  expect(pausedAfter.three.classic.bodyMatrices).toEqual(pausedBefore.three.classic.bodyMatrices);
  expect(pausedAfter.three.classic.body.map(glyph => glyph.progress)).toEqual(pausedBefore.three.classic.body.map(glyph => glyph.progress));
  expect(pausedAfter.three.classic.glow.map(glyph => glyph.glow)).toEqual(pausedBefore.three.classic.glow.map(glyph => glyph.glow));

  await activateClassicFixture(page);
  const directTarget = await submitClassicFrame(page, { now: 2.05, rafDeltaMs: 16, lineIndex: 0 });
  await activateClassicFixture(page);
  await submitClassicFrame(page, { now: 0.4, rafDeltaMs: 16, lineIndex: 0 });
  const seekTarget = await submitClassicFrame(page, { now: 2.05, rafDeltaMs: 16, lineIndex: 0 });
  expect(seekTarget.snapshot.groupStates.map(group => group.phase)).toEqual(['passed', 'entering', 'waiting']);
  expect(seekTarget.three.classic.bodyMatrices).toEqual(directTarget.three.classic.bodyMatrices);
  expect(seekTarget.three.classic.body.map(glyph => glyph.progress)).toEqual(directTarget.three.classic.body.map(glyph => glyph.progress));
  expect(seekTarget.three.classic.glow.map(glyph => glyph.glow)).toEqual(directTarget.three.classic.glow.map(glyph => glyph.glow));

  await activateClassicFixture(page);
  await page.evaluate(() => {
    gestureRotation.x = 0.05;
    gestureRotation.y = 0.06;
  });
  const reducedEntry = await submitClassicFrame(page, { now: 0.9, rafDeltaMs: 16, lineIndex: 0, reducedMotion: true });
  const reducedSettled = await submitClassicFrame(page, { now: 1.2, rafDeltaMs: 16, lineIndex: 0, reducedMotion: true });
  const entryOpacity = reducedEntry.three.classic.body.map(glyph => glyph.opacity);
  expect(entryOpacity.some(opacity => opacity > 0 && opacity < 1)).toBe(true);
  expect(reducedSettled.three.classic.body.every((glyph, index) => glyph.opacity >= entryOpacity[index])).toBe(true);
  expect(reducedEntry.snapshot.parallax).toEqual({ x: 0, y: 0, rotationX: 0, rotationY: 0 });
  expect(reducedEntry.snapshot.sparkPoints).toBe(0);
  expect(reducedEntry.three.classic.spark.visible).toBe(false);
  expect(reducedEntry.three.classic.bodyMatrices.every(matrix => Math.abs(matrix[14]) < 1e-7)).toBe(true);
  expect(reducedEntry.three.classic.bodyMatrices.every(matrix => (
    Math.abs(matrix[1]) < 1e-7
    && Math.abs(matrix[2]) < 1e-7
    && Math.abs(matrix[4]) < 1e-7
    && Math.abs(matrix[6]) < 1e-7
  ))).toBe(true);
  expect(reducedEntry.three.classic.bodyMatrices.every((matrix, index) => (
    Math.hypot(matrix[0], matrix[1]) <= Math.hypot(reducedSettled.three.classic.bodyMatrices[index][0], reducedSettled.three.classic.bodyMatrices[index][1]) + 1e-7
  ))).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('Classic line transition profiles keep duration blur and release independent of new wordRevealMode', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  const profiles = [
    { mode: 'normal', durationMs: 300, blur: true, nextReveal: 'instant' },
    { mode: 'fast', durationMs: 160, blur: true, nextReveal: 'normal' },
    { mode: 'none', durationMs: 120, blur: false, nextReveal: 'fast' },
  ];

  for (const profile of profiles) {
    const fixture = `transition-${profile.mode}`;
    await activateClassicFixture(page, fixture);
    const hints = await page.evaluate(name => {
      const lines = window.__foliaClassicFixture.documents[name].lines;
      return { oldTransition: lines[0].renderHints.lineTransitionMode, nextReveal: lines[1].renderHints.wordRevealMode };
    }, fixture);
    expect(hints).toEqual({ oldTransition: profile.mode, nextReveal: profile.nextReveal });

    await submitClassicFrame(page, { fixture, now: 1.2, rafDeltaMs: 16, lineIndex: 0 });
    const started = await submitClassicFrame(page, { fixture, now: 4.1, rafDeltaMs: 16, lineIndex: 1 });
    expect(started.snapshot.lineTransitionActive).toBe(true);
    expect(started.three.classic.transition).toMatchObject({ opacity: 1, blurPx: 0, released: false });

    const middleDeltaMs = Math.floor(profile.durationMs / 2);
    const middle = await submitClassicFrame(page, {
      fixture,
      now: 4.1,
      rafDeltaMs: middleDeltaMs,
      lineIndex: 1,
    });
    expect(middle.snapshot.lineTransitionActive).toBe(true);
    expect(middle.three.classic.transition.opacity).toBeGreaterThan(0);
    expect(middle.three.classic.transition.opacity).toBeLessThan(1);
    if (profile.blur) expect(middle.three.classic.transition.blurPx).toBeGreaterThan(0);
    else expect(middle.three.classic.transition.blurPx).toBe(0);
    expect(middle.three.classic.transitionSample.visiblePixels).toBeGreaterThan(16);
    expect(middle.three.classic.transitionSample.visibleRatio).toBeGreaterThan(0.0001);
    await page.screenshot({ path: path.join(screenshotRoot, `1366x768-classic-line-exit-${profile.mode}.png`), animations: 'disabled' });

    const beforeRelease = await submitClassicFrame(page, {
      fixture,
      now: 4.1,
      rafDeltaMs: profile.durationMs - middleDeltaMs - 1,
      lineIndex: 1,
    });
    expect(beforeRelease.snapshot.lineTransitionActive).toBe(true);
    expect(beforeRelease.three.classic.transition.opacity).toBeGreaterThan(0);
    expect(beforeRelease.three.classic.transition.opacity).toBeLessThan(1);
    if (profile.blur) expect(beforeRelease.three.classic.transition.blurPx).toBeGreaterThan(0);
    else expect(beforeRelease.three.classic.transition.blurPx).toBe(0);

    const released = await submitClassicFrame(page, { fixture, now: 4.1, rafDeltaMs: 1, lineIndex: 1 });
    expect(released.snapshot.lineTransitionActive).toBe(false);
    expect(released.snapshot.transitionLayers).toBe(0);
    expect(released.three.classic.transition).toBeNull();
  }
  expect(pageErrors).toEqual([]);
});

test('Classic typography and quality tiers match Mineradio settings', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  await activateClassicFixture(page);
  const expectedTypography = await page.evaluate(() => {
    fx.lyricFont = 'song';
    fx.lyricWeight = 650;
    return { fontFamily: lyricFontStackForKey(fx.lyricFont), fontWeight: lyricFontWeightValue() };
  });
  const typography = await submitClassicFrame(page, { now: 1.12, rafDeltaMs: 16, lineIndex: 0 });
  expect(typography.snapshot.fontFamily).toBe(expectedTypography.fontFamily);
  expect(typography.snapshot.fontWeight).toBe(expectedTypography.fontWeight);

  for (const [quality, variant, tapCount, sparkPoints] of [
    ['quality', 'glow-9', 9, 48],
    ['balanced', 'glow-5', 5, 32],
    ['battery', 'glow-3', 3, 0],
  ]) {
    await activateClassicFixture(page, 'semantic', quality);
    const diagnostics = await submitClassicFrame(page, { now: 1.12, rafDeltaMs: 16, lineIndex: 0, quality });
    expect(diagnostics.snapshot.glowVariant).toBe(variant);
    expect(diagnostics.three.classic.glowTapCounts).toEqual([tapCount]);
    expect(diagnostics.snapshot.sparkPoints).toBe(sparkPoints);
    expectBodyGlowMatrixParity(diagnostics);
  }

  await activateClassicFixture(page, 'semantic', 'quality');
  let degraded = null;
  for (let index = 0; index < 7; index += 1) {
    degraded = await submitClassicFrame(page, { now: 1.12, rafDeltaMs: 6000, lineIndex: 0, quality: 'quality' });
  }
  expect(degraded.snapshot.degradationLevel).toBe(3);
  expect(degraded.snapshot.glowInstances).toBe(0);
  expect(degraded.snapshot.sparkPoints).toBe(0);
  expect(degraded.three.classic.glow).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Classic Three leaves both stage and side shelves clickable', async ({ page }) => {
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  await renderMode(page, 'classic');
  await page.evaluate(() => {
    playQueue = [
      { id: 'shelf-a', name: 'Shelf A', artist: 'Mineradio', cover: '' },
      { id: 'shelf-b', name: 'Shelf B', artist: 'Mineradio', cover: '' },
      { id: 'shelf-c', name: 'Shelf C', artist: 'Mineradio', cover: '' },
    ];
    currentIdx = -1;
    window.__foliaShelfClicks = [];
    const originalOpenContent = shelfManager.openContent.bind(shelfManager);
    shelfManager.openContent = function(index) {
      window.__foliaShelfClicks.push({ mode: shelfManager.getMode(), index });
    };
    window.__restoreFoliaShelfOpenContent = function() { shelfManager.openContent = originalOpenContent; };
  });

  async function clickCenterCard(mode) {
    const point = await page.evaluate(nextMode => {
      shelfManager.setMode(nextMode);
      shelfManager.rebuild(false);
      if (nextMode === 'side') setShelfPinnedOpen(true, true);
      for (let index = 0; index < 24; index += 1) shelfManager.update(1 / 60);
      renderSceneWithShelfOverlay();
      const card = shelfManager.getCardAt(shelfManager.getCenterIdx());
      if (!card || !card.mesh) return null;
      card.mesh.updateMatrixWorld(true);
      const position = new THREE.Vector3();
      card.mesh.getWorldPosition(position);
      position.project(currentShelfRenderCamera());
      return {
        x: (position.x + 1) * innerWidth / 2,
        y: (1 - position.y) * innerHeight / 2,
      };
    }, mode);
    expect(point).not.toBeNull();
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(1366);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(768);
    await page.mouse.click(point.x, point.y);
  }

  await clickCenterCard('stage');
  await clickCenterCard('side');
  const clicks = await page.evaluate(() => {
    window.__restoreFoliaShelfOpenContent();
    return window.__foliaShelfClicks.slice();
  });

  expect(clicks.map(click => click.mode)).toEqual(['stage', 'side']);
  expect(pageErrors).toEqual([]);
});

test('Classic WebGL compile/blend has clean body glow and transition shaders', async ({ page }) => {
  const shaderConsoleErrors = trackWebGlShaderErrors(page);
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  const diagnostics = await collectClassicCompileDiagnostics(page);
  expect(diagnostics.snapshot).toMatchObject({
    mode: 'classic',
    backend: 'three',
    rendererKind: 'three',
    backendFallbackCount: 0,
  });
  expect(diagnostics.body.batchCount).toBe(1);
  expect(diagnostics.glow.batchCount).toBe(1);
  expect(diagnostics.body.instanceCount).toBeGreaterThan(0);
  expect(diagnostics.glow.instanceCount).toBeGreaterThan(0);
  expect(diagnostics.body.batchIds[0]).not.toBe(diagnostics.glow.batchIds[0]);
  expect(diagnostics.body.material).toMatchObject({
    blending: diagnostics.constants.normalBlending,
    transparent: true,
    premultipliedAlpha: false,
    isShaderMaterial: true,
  });
  expect(diagnostics.glow.material).toMatchObject({
    blending: diagnostics.constants.additiveBlending,
    transparent: true,
    premultipliedAlpha: true,
    isShaderMaterial: true,
  });
  expect(diagnostics.transition).toMatchObject({ batchCount: 1 });
  expect(diagnostics.transition.material.isShaderMaterial).toBe(true);
  expect(diagnostics.infoProgramCount).toBeGreaterThanOrEqual(3);
  for (const program of diagnostics.programs) {
    expect(program.found, `${program.role} renderer program`).toBe(true);
    expect(program.infoIndex, `${program.role} renderer.info.programs entry`).toBeGreaterThanOrEqual(0);
    expect(program.linked, `${program.role} link status`).toBe(true);
    expect(program.runnable, `${program.role} diagnostics runnable`).toBe(true);
    expect(program.programLog, `${program.role} program log`).toBe('');
    expect(program.diagnosticLogs, `${program.role} renderer diagnostics`).toEqual([]);
    expect(program.shaders.every(shader => shader.compiled), `${program.role} shader compile status`).toBe(true);
    expect(program.shaders.map(shader => shader.log).filter(Boolean), `${program.role} shader logs`).toEqual([]);
  }
  expect(shaderConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Classic forced WebGL loss preserves mode config playback and a single fallback renderer', async ({ page }) => {
  const shaderConsoleErrors = trackWebGlShaderErrors(page);
  const pageErrors = await preparePage(page, { width: 1366, height: 768 });
  const diagnostics = await forceClassicWebGlLoss(page);
  expect(diagnostics.before.snapshot).toMatchObject({ mode: 'classic', backend: 'three', activeRenderers: 1 });
  expect(diagnostics.before).toMatchObject({
    configMode: 'classic',
    savedMode: 'classic',
    playing: true,
    extensionAvailable: true,
    isHtmlAudioElement: true,
    paused: false,
  });
  expect(diagnostics.before.currentTime).toBeGreaterThan(0);
  expect(diagnostics.before.mediaEvents).toEqual({ pause: 0, stalled: 0, error: 0 });
  expect(diagnostics.trigger.method).toBe('WEBGL_lose_context');
  expect(diagnostics.after.snapshot).toMatchObject({
    mode: 'classic',
    backend: '2d-fallback',
    rendererKind: 'dom',
    activeRenderers: 1,
    backendFallbackCount: 1,
  });
  expect(diagnostics.after).toMatchObject({
    configMode: 'classic',
    savedMode: 'classic',
    playing: true,
    isHtmlAudioElement: true,
    paused: false,
    documentSame: true,
    contextLossEvents: 1,
    contextLost: true,
    domFallbackCount: 1,
    nativeRootChildren: 1,
    threeActiveScopes: 0,
    activeThreeModeGroups: 0,
  });
  expect(diagnostics.after.documentFingerprint).toBe(diagnostics.before.documentFingerprint);
  expect(diagnostics.after.currentTime - diagnostics.before.currentTime).toBeGreaterThanOrEqual(0.15);
  expect(diagnostics.after.mediaEvents).toEqual({ pause: 0, stalled: 0, error: 0 });
  expect(shaderConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__cleanupFoliaContextLossMedia());
});

test('Classic mode transition retires promptly', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = await preparePage(page, { width: 960, height: 540 });
  const transition = await measureClassicModeTransitionRetirement(page);

  expect(transition).toMatchObject({
    viewport: { width: 960, height: 540 },
    fromMode: 'fume',
    toMode: 'classic',
    runtimeTransitionContractMs: 340,
    transitionDrainTimeoutMs: 1500,
  });
  expect(transition.before.snapshot).toMatchObject({ mode: 'fume', rendererKind: 'canvas2d' });
  expect(transition.before.fumeStageCount).toBe(1);
  expect(transition.before.fumeCanvasCount).toBe(1);
  expect(transition.initialTransitionLayers).toBeGreaterThan(0);
  expect(transition.switchElapsedMs).toBeGreaterThanOrEqual(0);
  expect(transition.transitionDrainElapsedMs).toBeLessThanOrEqual(transition.transitionDrainTimeoutMs);
  expect(transition.after.snapshot).toMatchObject({
    mode: 'classic',
    backend: 'three',
    rendererKind: 'three',
    activeRenderers: 1,
    transitionLayers: 0,
    resourcesValid: true,
  });
  expect(transition.after.transitionGhostCount).toBe(0);
  expect(transition.after.fumeStageCount).toBe(0);
  expect(transition.after.fumeCanvasCount).toBe(0);
  console.log(`Classic transition evidence: switch=${transition.switchElapsedMs}ms drain=${transition.transitionDrainElapsedMs}ms`);
  expect(pageErrors).toEqual([]);
});

test('4K warmed renderers stay bounded through twenty switches', async ({ page }) => {
  test.setTimeout(360000);
  const pageErrors = await preparePage(page, { width: 1920, height: 1080 });
  const observations = {};
  for (const profile of classicPerformanceProfiles) {
    observations[profile.name] = await sampleClassicPerformanceProfile(page, profile);
  }

  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.evaluate(() => {
    nativeLyricRuntime.resize({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });
    window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + 0.12);
  });
  for (const mode of modes) await renderModeFast(page, mode, 'quality', mode === 'fume' ? 220 : 60);
  await renderModeFast(page, 'classic', 'quality', 80);
  await renderModeFast(page, 'mineradio-3d', 'quality', 0);
  await page.evaluate(() => {
    renderer.compile(scene, camera);
    renderSceneWithShelfOverlay();
    const context = renderer.getContext();
    if (context && typeof context.finish === 'function') context.finish();
  });
  await renderModeFast(page, 'fume', 'quality', 120);
  const webgl = await page.evaluate(() => {
    const context = renderer && renderer.getContext && renderer.getContext();
    const extension = context && context.getExtension && context.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : '',
      vendor: extension ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL) : '',
    };
  });
  const webglClassification = classifyWebglEnvironment(webgl);
  const {
    softwareWebgl,
    referenceHardwareOptIn,
    referenceGpuMatched,
    performanceTargetsValidated,
    hardwareClassification,
    targetValidation,
  } = webglClassification;
  const baselineEndpoint = await establishClassicSwitchEndpoint(page);
  const baselineState = baselineEndpoint.state;
  const beforeHeapMeasurement = await measureHeapWithCdp(page);
  const timings = [];
  const switchDetails = [];
  let previousMode = 'classic';
  for (let index = 0; index < 20; index += 1) {
    const mode = modes[index % modes.length];
    const started = Date.now();
    const setModeStarted = Date.now();
    await page.evaluate(({ mode }) => window.__setFoliaNativeMode(mode, 'quality'), { mode });
    const setModeMs = Date.now() - setModeStarted;
    const settleStarted = Date.now();
    await page.waitForTimeout(24);
    const settleMs = Date.now() - settleStarted;
    const frameStarted = Date.now();
    await page.evaluate(() => window.__renderFoliaNativeFrame(window.__foliaNativeFixture.now + 0.12));
    const frameMs = Date.now() - frameStarted;
    const totalMs = Date.now() - started;
    timings.push(totalMs);
    switchDetails.push({ index, mode, previousMode, setModeMs, settleMs, frameMs, totalMs });
    previousMode = mode;
  }
  const endEndpoint = await establishClassicSwitchEndpoint(page);
  const endState = endEndpoint.state;
  const transitionDrainElapsedMs = endEndpoint.transitionDrainElapsedMs;
  const transitionDrainTimeoutMs = endEndpoint.transitionDrainTimeoutMs;
  const afterHeapMeasurement = await measureHeapWithCdp(page);
  const result = await page.evaluate(webglInfo => {
    const canvas = renderer && renderer.domElement;
    const bufferWidth = canvas ? canvas.width : 0;
    const bufferHeight = canvas ? canvas.height : 0;
    return {
      snapshot: nativeLyricRuntime.snapshot(),
      rendererBuffer: { width: bufferWidth, height: bufferHeight, pixels: bufferWidth * bufferHeight },
      threeBufferPixels: bufferWidth * bufferHeight,
      webgl: webglInfo,
    };
  }, webgl);
  const heapMeasured = isCollectedHeapPair(beforeHeapMeasurement, afterHeapMeasurement);
  const heapBefore = heapMeasured ? beforeHeapMeasurement.bytes : null;
  const heapAfter = heapMeasured ? afterHeapMeasurement.bytes : null;
  const heapGrowth = heapMeasured ? heapAfter - heapBefore : null;
  const switchTimingValidation = performanceTargetsValidated
    ? 'reference-hardware 1000ms target'
    : 'functional-only recorded';
  const performanceEvidence = {
    measurementTimestamp: new Date().toISOString(),
    referenceHardware: {
      role: 'performance-target-declaration-only',
      os: 'Windows 11 Pro build 26200',
      cpu: 'Intel Core i5-14600KF',
      gpu: 'NVIDIA GeForce RTX 5060',
      driver: '32.0.15.8097',
    },
    targets: {
      '1080p-balanced': { averageFps: 57, p95FrameMs: 22 },
      '4k-quality': { averageFps: 57, p95FrameMs: 22 },
      '1080p-battery': { averageFps: 29, p95FrameMs: 40 },
    },
    measurementEnvironment: {
      webglRenderer: result.webgl.renderer,
      webglVendor: result.webgl.vendor,
      softwareWebgl,
      hardwareClassification,
      referenceHardwareOptIn,
      referenceGpuMatched,
      performanceTargetsValidated,
      targetValidation,
    },
    referenceHardwareOptIn,
    referenceGpuMatched,
    performanceTargetsValidated,
    hardwareClassification,
    targetValidation,
    switchTimingValidation,
    runtimeDeltaSource: 'measured-raf',
    observations,
    timings,
    switchDetails,
    baselineMode: baselineState.mode,
    endMode: endState.mode,
    baselineQuality: baselineState.quality,
    endQuality: endState.quality,
    baselineViewport: baselineState.viewport,
    endViewport: endState.viewport,
    baselineDocumentFingerprint: baselineState.documentFingerprint,
    endDocumentFingerprint: endState.documentFingerprint,
    baselineFixtureTime: baselineState.fixtureTime,
    endFixtureTime: endState.fixtureTime,
    switchHeapEndpoints: { baseline: baselineState, end: endState },
    baselineTransitionDrainElapsedMs: baselineEndpoint.transitionDrainElapsedMs,
    baselineTransitionDrainTimeoutMs: baselineEndpoint.transitionDrainTimeoutMs,
    baselineClassicSwitchElapsedMs: baselineEndpoint.switchElapsedMs,
    endClassicSwitchElapsedMs: endEndpoint.switchElapsedMs,
    transitionDrainElapsedMs,
    transitionDrainTimeoutMs,
    heapMeasurementSource,
    heapMeasured,
    heapBefore,
    heapAfter,
    heapGrowth,
    heapMeasurements: { before: beforeHeapMeasurement, after: afterHeapMeasurement },
    ...result,
  };
  fs.writeFileSync(path.join(screenshotRoot, 'classic-three-reference-performance.json'), JSON.stringify(performanceEvidence, null, 2));

  const requiredObservationNames = classicPerformanceProfiles.map(profile => profile.name);
  expect(Object.keys(performanceEvidence.observations), 'performance observation tiers').toEqual(requiredObservationNames);
  expect(performanceEvidence.targets['1080p-battery'], '1080p battery target').toEqual({ averageFps: 29, p95FrameMs: 40 });
  expect(performanceEvidence.referenceHardware.role, 'reference hardware declaration role').toBe(
    'performance-target-declaration-only',
  );
  expect(performanceEvidence.measurementEnvironment, 'measurement environment').toEqual(expect.objectContaining({
    webglRenderer: expect.any(String),
    webglVendor: expect.any(String),
    softwareWebgl: expect.any(Boolean),
    hardwareClassification,
    referenceHardwareOptIn,
    referenceGpuMatched,
    performanceTargetsValidated,
    targetValidation,
  }));
  expect(softwareWebgl, 'software WebGL classification').toBe(
    softwareWebglPattern.test(`${result.webgl.renderer} ${result.webgl.vendor}`),
  );
  expect(performanceEvidence.referenceHardwareOptIn, 'reference hardware opt-in').toBe(
    process.env.MINERADIO_REFERENCE_HARDWARE === '1',
  );
  expect(performanceEvidence.referenceGpuMatched, 'reference GPU match').toBe(
    referenceGpuPattern.test(result.webgl.renderer),
  );
  expect(performanceEvidence.performanceTargetsValidated, 'performance target validation gate').toBe(
    referenceHardwareOptIn && referenceGpuMatched && !softwareWebgl,
  );
  expect(performanceEvidence.hardwareClassification, 'hardware classification').toBe(hardwareClassification);
  expect(performanceEvidence.targetValidation, 'target validation').toBe(targetValidation);
  expect(performanceEvidence.switchTimingValidation, 'switch timing validation').toBe(
    performanceTargetsValidated ? 'reference-hardware 1000ms target' : 'functional-only recorded',
  );
  if (!performanceTargetsValidated) {
    expect(performanceEvidence.targetValidation, 'functional-only target validation').toBe(
      softwareWebgl ? 'software functional-only' : 'unverified-hardware functional-only',
    );
  }
  expect(performanceEvidence.baselineMode, 'switch heap baseline mode').toBe('classic');
  expect(performanceEvidence.endMode, 'switch heap end mode').toBe('classic');
  expect(performanceEvidence.baselineQuality, 'switch heap baseline quality').toBe('quality');
  expect(performanceEvidence.endQuality, 'switch heap end quality').toBe(performanceEvidence.baselineQuality);
  expect(performanceEvidence.baselineViewport, 'switch heap baseline viewport').toMatchObject({ width: 960, height: 540 });
  expect(performanceEvidence.endViewport, 'switch heap end viewport').toEqual(performanceEvidence.baselineViewport);
  expect(performanceEvidence.endDocumentFingerprint, 'switch heap document').toBe(
    performanceEvidence.baselineDocumentFingerprint,
  );
  expect(performanceEvidence.endFixtureTime, 'switch heap fixture time').toBe(performanceEvidence.baselineFixtureTime);
  expect(performanceEvidence.switchDetails[0].previousMode, 'first switch previous mode').toBe('classic');
  expect(performanceEvidence.switchHeapEndpoints.baseline.snapshot.transitionLayers, 'baseline transitions').toBe(0);
  expect(performanceEvidence.switchHeapEndpoints.end.snapshot.transitionLayers, 'end transitions').toBe(0);
  expect(performanceEvidence.switchHeapEndpoints.end.transitionGhostCount, 'end transition ghosts').toBe(0);
  expect(performanceEvidence.switchHeapEndpoints.end.fumeStageCount, 'end fume stages').toBe(0);
  expect(performanceEvidence.switchHeapEndpoints.end.fumeCanvasCount, 'end fume canvases').toBe(0);
  expect(performanceEvidence.baselineTransitionDrainTimeoutMs, 'baseline transition drain timeout').toBe(3000);
  expect(performanceEvidence.baselineTransitionDrainElapsedMs, 'baseline transition drain elapsed').toBeLessThanOrEqual(
    performanceEvidence.baselineTransitionDrainTimeoutMs,
  );
  expect(performanceEvidence.transitionDrainTimeoutMs, 'transition drain timeout').toBe(3000);
  expect(performanceEvidence.transitionDrainElapsedMs, 'transition drain elapsed').toBeLessThanOrEqual(
    performanceEvidence.transitionDrainTimeoutMs,
  );
  expect(performanceEvidence.runtimeDeltaSource, 'runtime delta source').toBe('measured-raf');
  expect(performanceEvidence.heapMeasurementSource, 'heap measurement source').toBe('cdp-performance-metrics');
  expect(typeof performanceEvidence.heapMeasured, 'heap measured flag').toBe('boolean');
  expect(performanceEvidence.heapMeasured, 'switch heap validity').toBe(
    isCollectedHeapPair(performanceEvidence.heapMeasurements.before, performanceEvidence.heapMeasurements.after),
  );
  for (const phase of ['before', 'after']) {
    expect(typeof performanceEvidence.heapMeasurements[phase].garbageCollected, `switch heap ${phase} GC status`).toBe(
      'boolean',
    );
  }
  if (performanceEvidence.heapMeasured) {
    expect(performanceEvidence.heapBefore, 'switch heap before').toBeGreaterThan(0);
    expect(performanceEvidence.heapAfter, 'switch heap after').toBeGreaterThan(0);
    expect(performanceEvidence.heapGrowth, 'switch heap growth').toBeLessThan(20 * 1024 * 1024);
  } else {
    expect(performanceEvidence.heapBefore, 'unmeasured switch heap before').toBeNull();
    expect(performanceEvidence.heapAfter, 'unmeasured switch heap after').toBeNull();
    expect(performanceEvidence.heapGrowth, 'unmeasured switch heap growth').toBeNull();
  }
  expect(Number.isNaN(Date.parse(performanceEvidence.measurementTimestamp)), 'measurement timestamp').toBe(false);
  for (const profile of classicPerformanceProfiles) {
    const observation = performanceEvidence.observations[profile.name];
    const performanceSnapshot = observation.performanceSnapshot || {};
    expect(observation.viewport, `${profile.name} viewport`).toEqual(profile.viewport);
    expect(observation.quality, `${profile.name} quality`).toBe(profile.quality);
    expect(observation.resetMode, `${profile.name} reset mode`).toBe(classicPerformanceResetMode);
    expect(observation.runtimeDeltaSource, `${profile.name} runtime delta source`).toBe('measured-raf');
    expect(observation.runtimeDeltaSamples, `${profile.name} runtime delta samples`).toBe(observation.samples);
    expect(observation.runtimeDeltaTotalMs, `${profile.name} runtime delta total`).toBeCloseTo(observation.elapsedMs, 5);
    expect(observation.heapMeasurementSource, `${profile.name} heap measurement source`).toBe('cdp-performance-metrics');
    expect(typeof observation.heapMeasured, `${profile.name} heap measured flag`).toBe('boolean');
    expect(observation.heapMeasured, `${profile.name} heap validity`).toBe(
      isCollectedHeapPair(observation.heapMeasurements.before, observation.heapMeasurements.after),
    );
    for (const phase of ['before', 'after']) {
      expect(
        typeof observation.heapMeasurements[phase].garbageCollected,
        `${profile.name} heap ${phase} GC status`,
      ).toBe('boolean');
    }
    if (observation.heapMeasured) {
      expect(observation.heapBefore, `${profile.name} heap before`).toBeGreaterThan(0);
      expect(observation.heapAfter, `${profile.name} heap after`).toBeGreaterThan(0);
      expect(observation.heapGrowthBytes, `${profile.name} heap growth`).toBeLessThan(20 * 1024 * 1024);
    } else {
      expect(observation.heapBefore, `${profile.name} unmeasured heap before`).toBeNull();
      expect(observation.heapAfter, `${profile.name} unmeasured heap after`).toBeNull();
      expect(observation.heapGrowthBytes, `${profile.name} unmeasured heap growth`).toBeNull();
    }
    expect(observation.performanceSnapshot, `${profile.name} performance snapshot`).not.toBeNull();
    expect(Number.isFinite(performanceSnapshot.p95FrameMs), `${profile.name} performance p95 finite`).toBe(true);
    expect(performanceSnapshot.p95FrameMs, `${profile.name} performance p95 positive`).toBeGreaterThan(0);
    expect(performanceSnapshot.p95FrameMs, `${profile.name} performance p95 input bound`).toBeLessThanOrEqual(
      observation.maxFrameMs,
    );
    expect(performanceSnapshot.quality, `${profile.name} performance quality`).toBe(profile.quality);
    expect(performanceSnapshot.level, `${profile.name} performance degradation`).toBe(
      observation.nativeSnapshot.degradationLevel,
    );
    expect(performanceSnapshot.lastWindowEndedAt, `${profile.name} completed performance window`).toBeGreaterThan(0);
    expect(performanceSnapshot.fallback, `${profile.name} performance fallback`).toBe(false);
    expect(observation.warmupDurationMs, `${profile.name} warmup`).toBeGreaterThanOrEqual(2000);
    expect(observation.sampleDurationMs, `${profile.name} sample duration`).toBe(15000);
    expect(observation.requestedDurationMs, `${profile.name} requested duration`).toBe(15000);
    expect(observation.elapsedMs, `${profile.name} elapsed wall-clock duration`).toBeGreaterThanOrEqual(15000);
    expect(observation.samples, `${profile.name} rAF samples`).toBeGreaterThan(0);
    for (const metric of ['averageFrameMs', 'averageFps', 'p95FrameMs', 'maxFrameMs']) {
      expect(Number.isFinite(observation[metric]), `${profile.name} ${metric} finite`).toBe(true);
      expect(observation[metric], `${profile.name} ${metric} positive`).toBeGreaterThan(0);
    }
    expect(typeof observation.longTaskSupported, `${profile.name} long task support`).toBe('boolean');
    expect(observation.longTaskCount, `${profile.name} long task count`).toBeGreaterThanOrEqual(0);
    expect(observation.longTaskTotalMs, `${profile.name} long task total`).toBeGreaterThanOrEqual(0);
    expect(observation.maxLongTaskMs, `${profile.name} max long task`).toBeGreaterThanOrEqual(0);
    expect(observation.nativeSnapshot.backend, `${profile.name} snapshot backend`).toBe('three');
    expect(observation.nativeSnapshot.rendererKind, `${profile.name} snapshot renderer`).toBe('three');
    expect(observation.nativeSnapshot.quality, `${profile.name} snapshot performance quality`).toBe(profile.quality);
    expect(observation.nativeSnapshot.level, `${profile.name} snapshot performance level`).toBe(
      observation.nativeSnapshot.degradationLevel,
    );
    expect(observation.nativeSnapshot.fallback, `${profile.name} snapshot fallback`).toBe(false);
    expect(observation.nativeSnapshot.backendFallbackCount, `${profile.name} backend fallback count`).toBe(0);
    expect(observation.nativeSnapshot.fallbackCount, `${profile.name} runtime fallback count`).toBe(0);
    expect(observation.nativeSnapshot.resourcesValid, `${profile.name} resources valid`).toBe(true);
    expect(observation.nativeSnapshot.atlasBytes, `${profile.name} atlas bytes`).toBeGreaterThan(0);
    expect(observation.nativeSnapshot.atlasBytes, `${profile.name} atlas bound`).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(observation.nativeSnapshot.retiredGlyphMaterials, `${profile.name} retired materials`).toBe(0);
    expect(observation.nativeSnapshot.bodyDrawBatches, `${profile.name} body batches`).toBeGreaterThanOrEqual(1);
    expect(observation.nativeSnapshot.glowDrawBatches, `${profile.name} glow batches`).toBeGreaterThanOrEqual(1);
    expect(observation.nativeSnapshot.bodyInstances, `${profile.name} body instances`).toBeGreaterThan(0);
    expect(observation.nativeSnapshot.glowInstances, `${profile.name} glow instances`).toBeGreaterThan(0);
    expect(observation.nativeSnapshot.degradationLevel, `${profile.name} degradation level`).toBeGreaterThanOrEqual(0);
    expect(observation.rendererBuffer.width, `${profile.name} buffer width`).toBeGreaterThan(0);
    expect(observation.rendererBuffer.height, `${profile.name} buffer height`).toBeGreaterThan(0);
    expect(observation.rendererBuffer.pixels, `${profile.name} buffer pixels`).toBe(
      observation.rendererBuffer.width * observation.rendererBuffer.height,
    );
  }
  expect(result.snapshot.activeRenderers).toBe(1);
  expect(result.snapshot.transitionLayers).toBe(0);
  expect(result.snapshot.mode).toBe('classic');
  expect(result.snapshot.backend).toBe('three');
  expect(result.snapshot.rendererKind).toBe('three');
  expect(result.snapshot.backendFallbackCount).toBe(0);
  expect(result.snapshot.fallbackCount).toBe(0);
  expect(result.snapshot.atlasBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(result.snapshot.retiredGlyphMaterials).toBe(0);
  expect(result.snapshot.bodyDrawBatches).toBeGreaterThanOrEqual(1);
  expect(result.snapshot.glowDrawBatches).toBeGreaterThanOrEqual(1);
  expect(result.snapshot.bodyInstances).toBeGreaterThan(0);
  expect(result.snapshot.glowInstances).toBeGreaterThan(0);
  expect(result.rendererBuffer.pixels).toBeLessThanOrEqual(1920 * 1080);
  if (heapMeasured) expect(heapGrowth).toBeLessThan(20 * 1024 * 1024);
  expect(timings).toHaveLength(20);
  expect(switchDetails).toHaveLength(20);
  for (const timing of timings) {
    expect(Number.isFinite(timing), 'recorded switch timing finite').toBe(true);
    expect(timing, 'recorded switch timing non-negative').toBeGreaterThanOrEqual(0);
  }
  if (performanceTargetsValidated) {
    expect(result.snapshot.p95FrameMs).toBeLessThan(24);
    for (const [name, target] of Object.entries(performanceEvidence.targets)) {
      expect(observations[name].averageFps, `${name} reference hardware average FPS`).toBeGreaterThanOrEqual(
        target.averageFps,
      );
      expect(observations[name].p95FrameMs, `${name} reference hardware p95 frame time`).toBeLessThanOrEqual(
        target.p95FrameMs,
      );
    }
    expect(Math.max(...timings), switchTimingValidation).toBeLessThan(1000);
  }
  expect(pageErrors).toEqual([]);
});
