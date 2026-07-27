const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeThree } = require('./helpers/fake-three');
const {
  createThreeLyricHost,
} = require('../public/folia-native/three/host');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
    listenerCount(type) { return (listeners.get(type) || new Set()).size; },
  };
}

function canvasFactory(width, height) {
  const context = {
    font: '',
    measureText(text) {
      const size = Number(String(this.font).match(/([0-9.]+)px/)?.[1]) || 32;
      return {
        width: Math.max(1, Array.from(String(text || '')).length * size * 0.7),
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
    clearRect() {}, save() {}, restore() {}, fillText() {}, strokeText() {},
  };
  return {
    width, height,
    getContext(kind) { return kind === '2d' ? context : null; },
  };
}

function createRenderer(THREE) {
  const domElement = eventTarget();
  let target = { id: 'initial-target' };
  let clearColor = '#123456';
  let clearAlpha = 0.65;
  let viewport = { x: 4, y: 5, z: 800, w: 450 };
  let scissor = { x: 6, y: 7, z: 700, w: 350 };
  let scissorTest = true;
  return {
    domElement,
    autoClear: true,
    renderCalls: [],
    getRenderTarget() { return target; },
    setRenderTarget(value) { target = value; },
    getClearColor(result) { result.value = clearColor; return result; },
    getClearAlpha() { return clearAlpha; },
    setClearColor(value, alpha) {
      clearColor = value && value.value != null ? value.value : value;
      if (alpha != null) clearAlpha = alpha;
    },
    getViewport(result) { Object.assign(result, viewport); return result; },
    setViewport(value, y, z, w) {
      viewport = typeof value === 'number' ? { x: value, y, z, w } : { ...value };
    },
    getScissor(result) { Object.assign(result, scissor); return result; },
    setScissor(value, y, z, w) {
      scissor = typeof value === 'number' ? { x: value, y, z, w } : { ...value };
    },
    getScissorTest() { return scissorTest; },
    setScissorTest(value) { scissorTest = value; },
    clear() {},
    render(scene, camera) { this.renderCalls.push({ scene, camera, target }); },
    readRenderTargetPixels(value, x, y, width, height, pixels) {
      for (let index = 0; index < width * height; index += 1) {
        pixels[index * 4] = 255;
        pixels[index * 4 + 1] = 220;
        pixels[index * 4 + 2] = 180;
        pixels[index * 4 + 3] = index % 2 === 0 ? 255 : 0;
      }
    },
    snapshot() {
      return { target, clearColor, clearAlpha, viewport, scissor, scissorTest, autoClear: this.autoClear };
    },
    capabilities: { getMaxAnisotropy() { return 8; } },
    THREE,
  };
}

function createHostFixture(options = {}) {
  const THREE = createFakeThree();
  const scene = new THREE.Scene();
  const camera = new THREE.Group();
  const renderer = createRenderer(THREE);
  const host = createThreeLyricHost({
    THREE,
    scene,
    camera,
    renderer,
    createCanvas: canvasFactory,
    createTexture: canvas => new THREE.CanvasTexture(canvas),
    transitionMaxPixels: 1920 * 1080,
    ...options,
  });
  return { THREE, scene, camera, renderer, host };
}

function getTransitionMesh(scene) {
  const root = scene.children.find(child => child.name === 'MineradioFoliaThreeTransitions');
  return root && root.children[0];
}

test('ThreeLyricHost owns a sibling root and never mutates stageLyrics', () => {
  const { THREE, scene, host } = createHostFixture();
  const stageLyricsGroup = new THREE.Group();
  scene.add(stageLyricsGroup);
  const scope = host.createModeScope('classic');

  assert.equal(scene.children.includes(stageLyricsGroup), true);
  assert.equal(scene.children.includes(host.getRoot()), true);
  assert.notEqual(host.getRoot(), stageLyricsGroup);
  assert.equal(host.getRoot().children.includes(scope.group), true);

  scope.release();
  scope.release();
  assert.equal(host.getRoot().children.includes(scope.group), false);
  host.destroy();
  host.destroy();
  assert.equal(scene.children.includes(stageLyricsGroup), true);
  assert.equal(scene.children.includes(host.getRoot()), false);
});

test('ThreeLyricHost replaces the previous active scope without disposing shared resources', () => {
  const { host } = createHostFixture();
  const first = host.createModeScope('classic');
  const second = host.createModeScope('partita');

  assert.equal(first.released(), true);
  assert.equal(second.released(), false);
  assert.equal(host.snapshot().activeScopes, 1);
  assert.equal(host.snapshot().destroyed, false);
  second.release();
  assert.equal(host.snapshot().activeScopes, 0);
  assert.equal(host.snapshot().destroyed, false);
  host.destroy();
});

test('ThreeLyricHost captures only its lyric layer and restores renderer state', () => {
  const { THREE, renderer, camera, host } = createHostFixture();
  camera.layers.mask = 7;
  const scope = host.createModeScope('classic');
  scope.group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  host.updateAnchor({ viewport: { width: 3840, height: 2160, dpr: 1 } });
  const before = renderer.snapshot();

  const transition = host.captureTransition(scope);
  const after = renderer.snapshot();

  assert.equal(transition.kind, 'managed-three-transition');
  assert.equal(transition.width * transition.height <= 1920 * 1080, true);
  assert.equal(renderer.renderCalls.length, 1);
  assert.notEqual(renderer.renderCalls[0].scene, host.getRoot());
  assert.deepEqual(after, before);
  assert.equal(camera.layers.mask, 7);
  assert.equal(host.snapshot().transitionLayers, 1);

  scope.release();
  transition.release();
  transition.release();
  assert.equal(host.snapshot().transitionLayers, 0);
  assert.equal(transition.disposeCount(), 1);
  host.destroy();
});

test('ThreeLyricHost keeps rounded transition dimensions within the pixel cap', () => {
  const transitionMaxPixels = 65536;
  const { host } = createHostFixture({ transitionMaxPixels });
  const scope = host.createModeScope('classic');
  host.updateAnchor({ viewport: { width: 257, height: 277, dpr: 1 } });

  const transition = host.captureTransition(scope);
  const pixelCount = transition.width * transition.height;

  assert.equal(
    pixelCount <= transitionMaxPixels,
    true,
    `transition RenderTarget uses ${pixelCount} pixels`,
  );
  transition.release();
  host.destroy();
});

test('ThreeLyricHost disposes partial transition resources when shader construction fails', () => {
  const injectedTHREE = createFakeThree();
  const targets = [];
  const geometries = [];
  class TrackingRenderTarget extends injectedTHREE.WebGLRenderTarget {
    constructor(...args) {
      super(...args);
      targets.push(this);
    }
  }
  class TrackingPlaneGeometry extends injectedTHREE.PlaneGeometry {
    constructor(...args) {
      super(...args);
      geometries.push(this);
    }
  }
  class ThrowingShaderMaterial extends injectedTHREE.ShaderMaterial {
    constructor(options) {
      super(options);
      throw new Error('shader construction failed');
    }
  }
  const { renderer, host } = createHostFixture({
    THREE: {
      ...injectedTHREE,
      WebGLRenderTarget: TrackingRenderTarget,
      PlaneGeometry: TrackingPlaneGeometry,
      ShaderMaterial: ThrowingShaderMaterial,
    },
  });
  const scope = host.createModeScope('classic');
  const before = renderer.snapshot();
  const geometryCountBeforeCapture = geometries.length;

  assert.throws(() => host.captureTransition(scope), /shader construction failed/);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].disposeCount, 1);
  assert.equal(targets[0].texture.disposeCount, 1);
  const transitionGeometries = geometries.slice(geometryCountBeforeCapture);
  assert.equal(transitionGeometries.length, 1);
  assert.equal(transitionGeometries[0].disposeCount, 1);
  assert.equal(host.snapshot().transitionLayers, 0);
  assert.deepEqual(renderer.snapshot(), before);
  host.destroy();
  assert.equal(targets[0].disposeCount, 1);
});

test('ThreeLyricHost disposes its target and restores renderer state when capture rendering fails', () => {
  const injectedTHREE = createFakeThree();
  const targets = [];
  class TrackingRenderTarget extends injectedTHREE.WebGLRenderTarget {
    constructor(...args) {
      super(...args);
      targets.push(this);
    }
  }
  const { renderer, host } = createHostFixture({
    THREE: { ...injectedTHREE, WebGLRenderTarget: TrackingRenderTarget },
  });
  const scope = host.createModeScope('classic');
  const sourceGeometry = new injectedTHREE.PlaneGeometry(1, 1);
  const sourceMaterial = new injectedTHREE.MeshBasicMaterial();
  scope.group.add(new injectedTHREE.Mesh(sourceGeometry, sourceMaterial));
  renderer.render = function() { throw new Error('capture render failed'); };
  const before = renderer.snapshot();

  assert.throws(() => host.captureTransition(scope), /capture render failed/);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].disposeCount, 1);
  assert.equal(targets[0].texture.disposeCount, 1);
  assert.equal(sourceGeometry.disposeCount, 0);
  assert.equal(sourceMaterial.disposeCount, 0);
  assert.equal(host.snapshot().transitionLayers, 0);
  assert.deepEqual(renderer.snapshot(), before);
  host.destroy();
  assert.equal(targets[0].disposeCount, 1);
});

test('ThreeLyricHost exposes a bounded controllable line transition', () => {
  let anchorScale = 1.6;
  const { scene, host } = createHostFixture({
    getAnchor() {
      return { position: [0, 0, -4.85], quaternion: [0, 0, 0, 1], scale: anchorScale, distance: 4.85 };
    },
  });
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });

  transition.setVisualState({ opacity: 0.4, scale: 1.03, blurPx: 8 });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0.4, scale: 1.03, blurPx: 8, released: false,
  });
  anchorScale = 2.2;
  host.updateAnchor({ viewport: { width: 1366, height: 768, dpr: 1 } });
  assert.equal(transition.snapshot().scale, 1.03);
  assert.equal(getTransitionMesh(scene).scale.x, 1.03);
  transition.release();
  transition.release();
  assert.equal(transition.disposeCount(), 1);
  host.destroy();
});

test('ThreeLyricHost clamps controllable transition visual state', () => {
  const { host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });

  transition.setVisualState({ opacity: -2, scale: 0.5, blurPx: -4 });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0, scale: 1, blurPx: 0, released: false,
  });
  transition.setVisualState({ opacity: 2, scale: 2, blurPx: 99 });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 1, scale: 1.1, blurPx: 20, released: false,
  });
  transition.release();
  host.destroy();
});

test('ThreeLyricHost retains partial state and rejects non-finite visual updates', () => {
  const { scene, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });

  transition.setVisualState({ opacity: 0.6, scale: 1.05, blurPx: 10 });
  transition.setVisualState({ opacity: 0.25 });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0.25, scale: 1.05, blurPx: 10, released: false,
  });
  transition.setVisualState({ opacity: NaN, scale: Infinity, blurPx: -Infinity });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0.25, scale: 1.05, blurPx: 10, released: false,
  });
  const uniforms = getTransitionMesh(scene).material.uniforms;
  assert.equal(uniforms.uOpacity.value, 0.25);
  assert.equal(uniforms.uBlurPx.value, 10);
  assert.equal(Number.isFinite(uniforms.uOpacity.value), true);
  assert.equal(Number.isFinite(uniforms.uBlurPx.value), true);
  transition.release();
  host.destroy();
});

test('ThreeLyricHost keeps default mode-switch transitions visually static', () => {
  let anchorScale = 1.4;
  const { scene, host } = createHostFixture({
    getAnchor() {
      return { position: [0, 0, -4.85], quaternion: [0, 0, 0, 1], scale: anchorScale, distance: 4.85 };
    },
  });
  const scope = host.createModeScope('classic');
  host.updateAnchor({ viewport: { width: 1280, height: 720, dpr: 1 } });
  const transition = host.captureTransition(scope);

  assert.deepEqual(transition.snapshot(), {
    purpose: 'mode-switch', opacity: 1, scale: 1, blurPx: 0, released: false,
  });
  anchorScale = 2.1;
  host.updateAnchor({ viewport: { width: 1920, height: 1080, dpr: 1 } });
  const mesh = getTransitionMesh(scene);
  assert.deepEqual(transition.snapshot(), {
    purpose: 'mode-switch', opacity: 1, scale: 1, blurPx: 0, released: false,
  });
  assert.equal(mesh.scale.x, 1);
  assert.equal(mesh.material.uniforms.uOpacity.value, 1);
  assert.equal(mesh.material.uniforms.uBlurPx.value, 0);
  transition.release();
  host.destroy();
});

test('ThreeLyricHost uses a bounded five-tap shader transition plane', () => {
  const { THREE, scene, renderer, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  host.updateAnchor({ viewport: { width: 800, height: 400, dpr: 1 } });
  const transition = host.captureTransition(scope, { purpose: 'line' });
  const target = renderer.renderCalls[0].target;
  const mesh = getTransitionMesh(scene);
  const material = mesh.material;

  assert.equal(material instanceof THREE.ShaderMaterial, true);
  assert.deepEqual(Object.keys(material.uniforms).sort(), ['uBlurPx', 'uMap', 'uOpacity', 'uTexelSize']);
  assert.equal(material.uniforms.uMap.value, target.texture);
  assert.equal(material.uniforms.uOpacity.value, 1);
  assert.equal(material.uniforms.uBlurPx.value, 0);
  assert.deepEqual(
    [material.uniforms.uTexelSize.value.x, material.uniforms.uTexelSize.value.y],
    [1 / transition.width, 1 / transition.height],
  );
  assert.equal(material.transparent, true);
  assert.equal(material.premultipliedAlpha, true);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.depthWrite, false);
  assert.equal(material.depthTest, false);
  assert.equal(mesh.renderOrder, 39);
  assert.match(
    material.fragmentShader,
    /gl_FragColor = vec4\(color\.rgb \* uOpacity, color\.a \* uOpacity\);/,
  );
  assert.doesNotMatch(material.fragmentShader, /precision\s+highp\s+float/);

  const sampleLines = material.fragmentShader.split('\n').filter(line => line.includes('texture2D(uMap'));
  assert.equal(sampleLines.length, 5);
  sampleLines.forEach(line => {
    assert.match(line, /texture2D\(uMap, clamp\(centerUv \+ blurOffset \* vec2\([^)]+\), vec2\(0\.0\), vec2\(1\.0\)\)\)/);
  });
  assert.match(material.fragmentShader, /vec2 blurOffset = uTexelSize \* uBlurPx;/);
  const weights = sampleLines.map(line => Number(line.match(/\) \* ([0-9.]+)/)[1]));
  assert.equal(Number(weights.reduce((sum, weight) => sum + weight, 0).toFixed(6)), 1);

  transition.release();
  host.destroy();
});

test('ThreeLyricHost releases every transition resource once and ignores post-release updates', () => {
  const { scene, renderer, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });
  const target = renderer.renderCalls[0].target;
  const mesh = getTransitionMesh(scene);
  const { geometry, material } = mesh;
  transition.setVisualState({ opacity: 0.5, scale: 1.02, blurPx: 4 });

  transition.release();
  transition.release();
  transition.setVisualState({ opacity: 1, scale: 1.1, blurPx: 20 });

  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0.5, scale: 1.02, blurPx: 4, released: true,
  });
  assert.equal(mesh.parent, null);
  assert.equal(geometry.disposeCount, 1);
  assert.equal(material.disposeCount, 1);
  assert.equal(target.disposeCount, 1);
  assert.equal(target.texture.disposeCount, 1);
  assert.equal(transition.disposeCount(), 1);
  host.destroy();
  assert.equal(geometry.disposeCount, 1);
  assert.equal(material.disposeCount, 1);
  assert.equal(target.disposeCount, 1);
});

test('ThreeLyricHost keeps transition capture at camera-plane scale while the lyric anchor changes', () => {
  let scale = 1.6;
  const { THREE, scene, host } = createHostFixture({
    getAnchor() {
      return { position: [0, 0, -4.85], quaternion: [0, 0, 0, 1], scale, distance: 4.85 };
    },
  });
  const scope = host.createModeScope('classic');
  scope.group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  host.updateAnchor({ viewport: { width: 1280, height: 720, dpr: 1 } });
  const transition = host.captureTransition(scope);
  const transitionRoot = scene.children.find(child => child.name === 'MineradioFoliaThreeTransitions');
  const transitionMesh = transitionRoot.children[0];

  assert.equal(transitionMesh.scale.x, 1);
  scale = 2.2;
  host.updateAnchor({ viewport: { width: 1280, height: 720, dpr: 1 } });
  assert.equal(transitionMesh.scale.x, 1);

  transition.release();
  host.destroy();
});

test('ThreeLyricHost releases active transitions before publishing context loss', () => {
  const { scene, renderer, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });
  const target = renderer.renderCalls[0].target;
  const mesh = getTransitionMesh(scene);
  const events = [];
  host.subscribeContext(event => {
    events.push({
      type: event.type,
      transitionLayers: host.snapshot().transitionLayers,
      disposeCount: transition.disposeCount(),
    });
  });
  let prevented = 0;

  renderer.domElement.dispatch('webglcontextlost', {
    preventDefault() { prevented += 1; },
  });

  assert.equal(prevented, 1);
  assert.deepEqual(events, [{ type: 'lost', transitionLayers: 0, disposeCount: 1 }]);
  assert.equal(host.snapshot().transitionLayers, 0);
  assert.equal(mesh.parent, null);
  assert.equal(target.disposeCount, 1);
  assert.equal(target.texture.disposeCount, 1);
  transition.release();
  transition.release();
  assert.equal(transition.disposeCount(), 1);
  assert.equal(target.disposeCount, 1);
  host.destroy();
  assert.equal(target.disposeCount, 1);
});

test('ThreeLyricHost publishes context loss after preventing default and rebuilds before restore', () => {
  const { renderer, host } = createHostFixture();
  const events = [];
  let prevented = 0;
  const unsubscribe = host.subscribeContext(event => {
    events.push({ type: event.type, resourcesValid: host.snapshot().resourcesValid });
  });

  renderer.domElement.dispatch('webglcontextlost', { preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.deepEqual(events[0], { type: 'lost', resourcesValid: false });

  renderer.domElement.dispatch('webglcontextrestored');
  assert.deepEqual(events[1], { type: 'restored', resourcesValid: true });
  unsubscribe();
  renderer.domElement.dispatch('webglcontextlost', { preventDefault() {} });
  assert.equal(events.length, 2);
  host.destroy();
  assert.equal(renderer.domElement.listenerCount('webglcontextlost'), 0);
  assert.equal(renderer.domElement.listenerCount('webglcontextrestored'), 0);
});

test('ThreeLyricHost suspend and resume only control owned roots', () => {
  const { host } = createHostFixture();
  host.createModeScope('classic');
  host.suspend('background');
  assert.equal(host.getRoot().visible, false);
  assert.equal(host.snapshot().suspended, true);
  host.resume();
  assert.equal(host.getRoot().visible, true);
  assert.equal(host.snapshot().suspended, false);
  host.destroy();
});

test('ThreeLyricHost samples only the active lyric layer and reports director diagnostics', () => {
  const { THREE, renderer, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  scope.group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  scope.group.userData.nativeLyricSnapshot = { instances: 12, drawBatches: 2 };
  const before = renderer.snapshot();

  const sample = host.sampleActiveLayer({ width: 8, height: 4, alphaThreshold: 0.05 });

  assert.deepEqual(sample, { width: 8, height: 4, visiblePixels: 16, visibleRatio: 0.5 });
  assert.deepEqual(renderer.snapshot(), before);
  assert.equal(host.snapshot().glyphInstances, 12);
  assert.equal(host.snapshot().drawBatches, 2);
  host.destroy();
});

test('ThreeLyricHost diagnostics prove retired atlas pages release their shared materials', () => {
  const { host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const atlasLease = host.getAtlas().acquire('光', { size: 40 });
  const batch = host.createGlyphBatch(scope, { renderOrder: 38 });
  batch.setInstances([{
    pageId: atlasLease.entry.pageId,
    texture: atlasLease.entry.texture,
    uv: atlasLease.entry.uv,
    variant: 'normal',
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    tint: [1, 1, 1], opacity: 1, glow: 0, progress: 0,
  }]);

  assert.equal(host.snapshot().glyphMaterials, 1);
  assert.equal(host.snapshot().materialLeases, 1);
  batch.setInstances([]);
  atlasLease.release();
  host.getAtlas().trim({ maxPages: 0 });
  assert.equal(host.snapshot().glyphMaterials, 0);
  assert.equal(host.snapshot().retiredGlyphMaterials, 0);
  assert.equal(host.snapshot().materialLeases, 0);
  host.destroy();
});

test('ThreeLyricHost destroy disposes outstanding managed transitions', () => {
  const { THREE, scene, renderer, host } = createHostFixture();
  const scope = host.createModeScope('classic');
  scope.group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  const transition = host.captureTransition(scope);
  const target = renderer.renderCalls[0].target;
  const mesh = getTransitionMesh(scene);

  host.destroy();
  host.destroy();
  assert.equal(transition.disposeCount(), 1);
  transition.release();

  assert.equal(transition.disposeCount(), 1);
  assert.equal(mesh.geometry.disposeCount, 1);
  assert.equal(mesh.material.disposeCount, 1);
  assert.equal(target.disposeCount, 1);
  assert.equal(target.texture.disposeCount, 1);
});
