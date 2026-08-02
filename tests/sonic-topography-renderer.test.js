'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeThree } = require('./helpers/fake-three');
const { createSonicTopographyRenderer } = require('../public/sonic-topography-renderer');

const repoRoot = path.resolve(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(repoRoot, 'public', 'sonic-topography-renderer.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const noticeSource = fs.readFileSync(path.join(repoRoot, 'NOTICE.md'), 'utf8');
const vendorManifest = fs.readFileSync(path.join(repoRoot, 'docs', 'VENDOR_MANIFEST.md'), 'utf8');
const thirdPartyNotices = fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

function createCanvas() {
  const context = {
    calls: 0,
    setTransform() {},
    clearRect() { this.calls += 1; },
    fillRect() { this.calls += 1; },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() { this.calls += 1; },
    save() {},
    restore() {},
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return {
    width: 0,
    height: 0,
    className: '',
    style: {},
    parentNode: null,
    getContext(kind) { return kind === '2d' ? context : null; },
    context,
  };
}

function createCanvasRoot() {
  return {
    children: [],
    appendChild(node) {
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.children.push(node);
      return node;
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
      node.parentNode = null;
      return node;
    },
  };
}

function createFixture() {
  const THREE = createFakeThree();
  const scene = new THREE.Scene();
  const hostRoot = new THREE.Group();
  scene.add(hostRoot);
  const contextListeners = new Set();
  const host = {
    getRoot() { return hostRoot; },
    subscribeContext(listener) {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
  };
  const canvasRoot = createCanvasRoot();
  const canvases = [];
  const instance = createSonicTopographyRenderer({
    THREE,
    scene,
    renderer: { domElement: {} },
    host,
    canvasRoot,
    createCanvas() {
      const canvas = createCanvas();
      canvases.push(canvas);
      return canvas;
    },
  });
  return {
    THREE,
    scene,
    hostRoot,
    canvasRoot,
    canvases,
    instance,
    emitContext(type) {
      for (const listener of contextListeners) listener({ type });
    },
    listenerCount() { return contextListeners.size; },
  };
}

function frame(overrides = {}) {
  return {
    dt: 1 / 30,
    playing: true,
    reducedMotion: false,
    quality: 'balanced',
    viewport: { width: 1366, height: 768, dpr: 1.25 },
    audio: {
      frequencyData: Uint8Array.from({ length: 64 }, (_, index) => 32 + ((index * 41) % 210)),
      timeDomainData: Uint8Array.from({ length: 128 }, (_, index) => 128 + Math.round(Math.sin(index / 6) * 60)),
      bass: 0.68,
      mid: 0.45,
      treble: 0.32,
      energy: 0.58,
      beatPulse: 0.74,
    },
    theme: { primary: '#58d9ff', secondary: '#ff7d67', background: '#05070c' },
    config: { enabled: true, amplitude: 0.72, motion: 0.55, opacity: 0.7, historySize: 48, palette: 'theme' },
    ...overrides,
  };
}

test('mounts under the shared Three host and updates without another frame or audio owner', () => {
  const fixture = createFixture();
  fixture.instance.mount();
  fixture.instance.update(frame());

  const snapshot = fixture.instance.snapshot();
  assert.equal(snapshot.backend, 'three');
  assert.equal(snapshot.mounted, true);
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.usesHostRoot, true);
  assert.equal(snapshot.vertices > 0, true);
  assert.equal(fixture.hostRoot.children.length, 1);
  assert.equal(fixture.listenerCount(), 1);
  assert.doesNotMatch(rendererSource, /requestAnimationFrame|cancelAnimationFrame|setInterval/);
  assert.doesNotMatch(rendererSource, /\b(?:AudioContext|OfflineAudioContext|webkitAudioContext)\b|\bnew\s+Worker\b/);
});

test('resize and quality changes rebuild bounded geometry once per profile', () => {
  const fixture = createFixture();
  fixture.instance.mount();
  fixture.instance.resize({ width: 960, height: 540, dpr: 1 });
  fixture.instance.update(frame({ quality: 'battery', viewport: { width: 960, height: 540, dpr: 1 } }));
  const battery = fixture.instance.snapshot();

  fixture.instance.update(frame({ quality: 'battery', viewport: { width: 960, height: 540, dpr: 1 } }));
  assert.equal(fixture.instance.snapshot().rebuildCount, battery.rebuildCount);

  fixture.instance.update(frame({ quality: 'quality', viewport: { width: 1920, height: 1080, dpr: 1.5 } }));
  const quality = fixture.instance.snapshot();
  assert.equal(quality.width, 1920);
  assert.equal(quality.height, 1080);
  assert.equal(quality.vertices > battery.vertices, true);
  assert.equal(quality.rebuildCount, battery.rebuildCount + 1);
});

test('context loss switches to Canvas2D and restore rebuilds the shared Three layer', () => {
  const fixture = createFixture();
  fixture.instance.mount();
  fixture.instance.update(frame());
  fixture.emitContext('lost');
  fixture.instance.update(frame());

  const degraded = fixture.instance.snapshot();
  assert.equal(degraded.backend, 'canvas2d');
  assert.equal(degraded.contextLost, true);
  assert.equal(degraded.canvases, 1);
  assert.equal(fixture.canvasRoot.children.length, 1);
  assert.equal(fixture.canvases[0].context.calls > 0, true);

  fixture.emitContext('restored');
  fixture.instance.update(frame());
  const restored = fixture.instance.snapshot();
  assert.equal(restored.backend, 'three');
  assert.equal(restored.contextLost, false);
  assert.equal(restored.restoreCount, 1);
  assert.equal(fixture.canvasRoot.children.length, 0);
  assert.equal(fixture.hostRoot.children.length, 1);
});

test('disabled context loss and restore stay allocation-free', () => {
  const fixture = createFixture();
  fixture.instance.mount();

  fixture.emitContext('lost');
  assert.equal(fixture.canvasRoot.children.length, 0);
  assert.equal(fixture.canvases.length, 0);

  fixture.emitContext('restored');
  const restored = fixture.instance.snapshot();
  assert.equal(restored.backend, 'three');
  assert.equal(restored.vertices, 0);
  assert.equal(restored.canvases, 0);
  assert.equal(fixture.hostRoot.children.length, 0);
});

test('release disposes live resources, shrinks fallback and restore is idempotent', () => {
  const fixture = createFixture();
  fixture.instance.mount();
  fixture.instance.update(frame());
  fixture.emitContext('lost');
  fixture.instance.update(frame());
  const fallback = fixture.canvases[0];

  fixture.instance.release('background');
  assert.equal(fixture.instance.snapshot().released, true);
  assert.equal(fixture.hostRoot.children.length, 0);
  assert.equal(fallback.width, 1);
  assert.equal(fallback.height, 1);

  assert.equal(fixture.instance.restore(), true);
  assert.equal(fixture.instance.restore(), false);
  fixture.emitContext('restored');
  fixture.instance.update(frame());
  assert.equal(fixture.instance.snapshot().released, false);
  assert.equal(fixture.hostRoot.children.length, 1);
});

test('destroy is idempotent and removes context subscriptions and fallback DOM', () => {
  const fixture = createFixture();
  fixture.instance.mount();
  fixture.emitContext('lost');
  fixture.instance.update(frame());

  fixture.instance.destroy();
  fixture.instance.destroy();

  assert.equal(fixture.instance.snapshot().destroyed, true);
  assert.equal(fixture.listenerCount(), 0);
  assert.equal(fixture.hostRoot.children.length, 0);
  assert.equal(fixture.canvasRoot.children.length, 0);
});

test('page wiring loads Sonic before the app body and uses existing frame, resize and release hooks', () => {
  assert.match(pageSource, /<script src="sonic-topography-state\.js"><\/script>/);
  assert.match(pageSource, /<script src="sonic-topography-renderer\.js"><\/script>/);
  assert.match(pageSource, /function initSonicTopographyRuntime\(/);
  assert.match(pageSource, /updateSonicTopographyRuntime\(dt\);[\s\S]{0,600}renderSceneWithShelfOverlay\(\);/);
  assert.match(pageSource, /sonicTopographyRuntime\.resize/);
  assert.match(pageSource, /sonicTopographyRuntime\.release/);
  assert.match(pageSource, /sonicTopographyRuntime\.restore/);
  assert.match(pageSource, /frequencyData:frequencyData[\s\S]{0,180}timeDomainData:timeDomainData/);
});

test('source notices pin both the adapted Mineradio commit and indirect visual reference', () => {
  for (const source of [rendererSource, noticeSource, vendorManifest, thirdPartyNotices]) {
    assert.match(source, /4abaa190de42c632365ae4244e041bad16443224|4abaa19/);
    assert.match(source, /sonic-topography/i);
  }
  assert.match(vendorManifest, /3ff303e/);
  assert.match(vendorManifest, /Non-Commercial Learning License/);
  assert.match(thirdPartyNotices, /(?:没有|未)复制该项目的源文件、播放器或着色器/);
});
