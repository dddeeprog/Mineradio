const test = require('node:test');
const assert = require('node:assert/strict');

const { createRendererRegistry } = require('../public/folia-native/registry');
const { createNativeLyricRuntime } = require('../public/folia-native/runtime');

function createRenderer(name, calls, options = {}) {
  return {
    kind: options.kind || 'dom',
    mount() { calls.push(`${name}:mount`); },
    setDocument() { calls.push(`${name}:document`); },
    update() {
      calls.push(`${name}:update`);
      if (options.failUpdate) throw new Error('update failed');
    },
    resize() { calls.push(`${name}:resize`); },
    release() { calls.push(`${name}:release`); },
    destroy() { calls.push(`${name}:destroy`); },
    snapshot() { return { domNodes: 2, canvases: 0, cacheEntries: 1 }; },
  };
}

class FakeNode {
  constructor(name = 'node') {
    this.name = name;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.classList = { values: new Set(), add: value => this.classList.values.add(value) };
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  cloneNode(deep) {
    const clone = new FakeNode(`${this.name}:clone`);
    if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  querySelectorAll() { return []; }
  setAttribute(name, value) { this[name] = value; }
  get firstElementChild() { return this.children[0] || null; }
}

test('registry resolves lazy renderer factories once', async () => {
  const registry = createRendererRegistry();
  let loads = 0;
  registry.register('classic', async () => {
    loads += 1;
    return () => ({ mount() {}, setDocument() {}, update() {}, resize() {}, release() {}, destroy() {} });
  });

  const first = await registry.create('classic');
  const second = await registry.create('classic');
  assert.notEqual(first, second);
  assert.equal(loads, 1);
  assert.equal(registry.has('classic'), true);
});

test('runtime owns exactly one renderer and destroys the old instance on switch', async () => {
  const calls = [];
  const registry = createRendererRegistry();
  registry.register('mineradio-3d', () => () => createRenderer('3d', calls, { kind: 'three' }));
  registry.register('classic', () => () => createRenderer('classic', calls));
  const runtime = createNativeLyricRuntime({ registry, fallbackMode: 'mineradio-3d' });

  await runtime.setMode('mineradio-3d');
  runtime.setDocument({ id: 'one', lines: [] });
  await runtime.setMode('classic');
  assert.equal(runtime.update({ now: 1 }), true);

  assert.deepEqual(calls.slice(0, 5), [
    '3d:mount', '3d:document', '3d:destroy', 'classic:mount', 'classic:document',
  ]);
  assert.equal(runtime.snapshot().mode, 'classic');
  assert.equal(runtime.snapshot().activeRenderers, 1);
});

test('runtime falls back to 3D once when renderer update fails', async () => {
  const calls = [];
  const fallbacks = [];
  const registry = createRendererRegistry();
  registry.register('mineradio-3d', () => () => createRenderer('3d', calls, { kind: 'three' }));
  registry.register('fume', () => () => createRenderer('fume', calls, { failUpdate: true, kind: 'canvas' }));
  const runtime = createNativeLyricRuntime({
    registry,
    fallbackMode: 'mineradio-3d',
    onFallback: info => fallbacks.push(info.mode),
  });

  await runtime.setMode('fume');
  await runtime.update({ now: 1 });
  await runtime.update({ now: 2 });

  assert.equal(runtime.snapshot().mode, 'mineradio-3d');
  assert.equal(runtime.snapshot().fallbackCount, 1);
  assert.deepEqual(fallbacks, ['fume']);
});

test('runtime falls back to 3D when a lazy renderer fails to load', async () => {
  const calls = [];
  const fallbacks = [];
  const registry = createRendererRegistry();
  registry.register('mineradio-3d', () => () => createRenderer('3d', calls, { kind: 'three' }));
  registry.register('monet', () => Promise.reject(new Error('loader failed')));
  const runtime = createNativeLyricRuntime({
    registry,
    fallbackMode: 'mineradio-3d',
    onFallback: info => fallbacks.push(info.mode),
  });

  await runtime.setMode('monet');

  assert.equal(runtime.snapshot().mode, 'mineradio-3d');
  assert.equal(runtime.snapshot().fallbackCount, 1);
  assert.deepEqual(fallbacks, ['monet']);
});

test('runtime destroys a renderer that fails to mount and notifies fallback once', async () => {
  const calls = [];
  const fallbacks = [];
  const registry = createRendererRegistry();
  registry.register('mineradio-3d', () => () => createRenderer('3d', calls, { kind: 'three' }));
  registry.register('cappella', () => () => ({
    kind: 'dom',
    mount() { calls.push('cappella:mount'); throw new Error('mount failed'); },
    setDocument() {}, update() {}, resize() {}, release() {},
    destroy() { calls.push('cappella:destroy'); },
  }));
  const runtime = createNativeLyricRuntime({
    registry,
    fallbackMode: 'mineradio-3d',
    onFallback: info => fallbacks.push(info.mode),
  });

  await runtime.setMode('cappella');

  assert.equal(runtime.snapshot().mode, 'mineradio-3d');
  assert.equal(runtime.snapshot().fallbackCount, 1);
  assert.deepEqual(fallbacks, ['cappella']);
  assert.deepEqual(calls, ['cappella:mount', 'cappella:destroy', '3d:mount']);
});

test('release and destroy forward lifecycle and clear diagnostics', async () => {
  const calls = [];
  const registry = createRendererRegistry();
  registry.register('mineradio-3d', () => () => createRenderer('3d', calls, { kind: 'three' }));
  const runtime = createNativeLyricRuntime({ registry });

  await runtime.setMode('mineradio-3d');
  runtime.release('background');
  runtime.destroy();

  assert.deepEqual(calls, ['3d:mount', '3d:release', '3d:destroy']);
  assert.equal(runtime.snapshot().activeRenderers, 0);
  assert.equal(runtime.snapshot().released, true);
});

test('resource policy survives release and all eight renderer switches with one live owner', async () => {
  const calls = [];
  const registry = createRendererRegistry();
  const modes = ['mineradio-3d', 'classic', 'cadenza', 'partita', 'tilt', 'monet', 'cappella', 'fume'];
  let live = 0;
  for (const mode of modes) {
    registry.register(mode, () => () => ({
      kind: 'test',
      mount() { live += 1; },
      setDocument() {},
      update() {},
      resize() {},
      setResourcePolicy(policy) { calls.push([mode, policy.qualityTier, policy.targetFps, policy.textureCacheBudget.maxCount]); },
      release() { calls.push([mode, 'release']); },
      resume() { calls.push([mode, 'resume']); },
      destroy() { live -= 1; },
      snapshot() { return {}; },
    }));
  }
  const runtime = createNativeLyricRuntime({ registry });
  runtime.setResourcePolicy({
    qualityTier: 'eco',
    targetFps: 24,
    cacheBudget: { maxCount: 12, maxBytes: 1024 },
    textureCacheBudget: { maxCount: 4, maxBytes: 2048 },
  });

  for (const mode of modes) await runtime.setMode(mode);
  runtime.release('background');
  runtime.resume();

  assert.equal(live, 1);
  const policyCalls = calls.filter(call => call[1] === 'eco');
  assert.deepEqual(policyCalls.slice(0, modes.length).map(call => call[0]), modes);
  assert.equal(policyCalls.length, modes.length + 1);
  assert.deepEqual(calls.slice(-3), [
    ['fume', 'release'],
    ['fume', 'resume'],
    ['fume', 'eco', 24, 4],
  ]);
  assert.deepEqual(runtime.snapshot().resourcePolicy, {
    qualityTier: 'eco',
    targetFps: 24,
    cacheBudget: { maxCount: 12, maxBytes: 1024 },
    textureCacheBudget: { maxCount: 4, maxBytes: 2048 },
  });
});

test('a renderer mounted after background release stays released', async () => {
  const calls = [];
  const registry = createRendererRegistry();
  registry.register('classic', () => () => createRenderer('classic', calls));
  const runtime = createNativeLyricRuntime({ registry });

  runtime.release('background-before-load');
  await runtime.setMode('classic');

  assert.equal(runtime.snapshot().released, true);
  assert.equal(runtime.update({ now: 1 }), false);
  assert.deepEqual(calls, ['classic:mount', 'classic:release']);
});

test('mode switch freezes the old stage for 340ms but destroys its renderer immediately', async () => {
  const calls = [];
  const timers = [];
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  function stagedRenderer(name) {
    let node;
    return {
      kind: 'dom',
      mount() { calls.push(`${name}:mount`); node = root.appendChild(new FakeNode(name)); },
      setDocument() {},
      update() {},
      resize() {},
      release() {},
      destroy() { calls.push(`${name}:destroy`); if (node && node.parentNode) node.parentNode.removeChild(node); },
      snapshot() { return {}; },
    };
  }
  registry.register('mineradio-3d', () => () => stagedRenderer('3d'));
  registry.register('classic', () => () => stagedRenderer('classic'));
  const runtime = createNativeLyricRuntime({
    registry,
    root,
    fallbackMode: 'mineradio-3d',
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });

  await runtime.setMode('mineradio-3d');
  await runtime.setMode('classic');

  assert.deepEqual(calls, ['3d:mount', '3d:destroy', 'classic:mount']);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[1].classList.values.has('native-lyric-transition-ghost'), true);
  assert.equal(runtime.snapshot().transitionLayers, 1);
  assert.equal(timers[0].delay, 340);
  timers[0].callback();
  assert.equal(root.children.length, 1);
  assert.equal(runtime.snapshot().transitionLayers, 0);
});

test('runtime releases a managed Three transition after 340ms without appending DOM', async () => {
  const timers = [];
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  let releases = 0;

  registry.register('classic', () => () => ({
    kind: 'three',
    mount() {},
    setDocument() {},
    update() {},
    resize() {},
    release() {},
    destroy() {},
    captureTransition() {
      return {
        kind: 'managed-three-transition',
        release() { releases += 1; },
      };
    },
  }));
  registry.register('mineradio-3d', () => () => createRenderer('3d', [], { kind: 'three' }));

  const runtime = createNativeLyricRuntime({
    registry,
    root,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  });

  await runtime.setMode('classic');
  await runtime.setMode('mineradio-3d');

  assert.equal(root.children.length, 0);
  assert.equal(runtime.snapshot().transitionLayers, 1);
  assert.equal(timers[0].delay, 340);
  timers[0].callback();
  assert.equal(releases, 1);
  assert.equal(runtime.snapshot().transitionLayers, 0);
});

test('runtime releases an unattached managed transition when the next renderer fails to mount', async () => {
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  let releases = 0;

  registry.register('classic', () => () => ({
    kind: 'three',
    mount() {}, setDocument() {}, update() {}, resize() {}, release() {}, destroy() {},
    captureTransition() {
      return { kind: 'managed-three-transition', release() { releases += 1; } };
    },
  }));
  registry.register('cappella', () => () => ({
    kind: 'dom',
    mount() { throw new Error('mount failed'); },
    setDocument() {}, update() {}, resize() {}, release() {}, destroy() {},
  }));
  registry.register('mineradio-3d', () => () => createRenderer('3d', [], { kind: 'three' }));
  const runtime = createNativeLyricRuntime({ registry, root, fallbackMode: 'mineradio-3d' });

  await runtime.setMode('classic');
  await runtime.setMode('cappella');

  assert.equal(releases, 1);
  assert.equal(runtime.snapshot().mode, 'mineradio-3d');
  assert.equal(runtime.snapshot().transitionLayers, 0);
});

test('rapid switches retain only the latest frozen transition layer', async () => {
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  const cancelled = [];
  let timerId = 0;
  function factory(name) {
    let node;
    return () => ({
      kind: 'dom',
      mount() { node = root.appendChild(new FakeNode(name)); },
      setDocument() {}, update() {}, resize() {}, release() {},
      destroy() { if (node && node.parentNode) node.parentNode.removeChild(node); },
      snapshot() { return {}; },
    });
  }
  for (const mode of ['mineradio-3d', 'classic', 'tilt']) registry.register(mode, () => factory(mode));
  const runtime = createNativeLyricRuntime({
    registry,
    root,
    setTimeout() { timerId += 1; return timerId; },
    clearTimeout(id) { cancelled.push(id); },
  });

  await runtime.setMode('mineradio-3d');
  await runtime.setMode('classic');
  await runtime.setMode('tilt');

  assert.equal(runtime.snapshot().transitionLayers, 1);
  assert.equal(root.children.length, 2);
  assert.deepEqual(cancelled, [1]);
});

test('twenty mode switches leave exactly one live renderer', async () => {
  const registry = createRendererRegistry();
  let live = 0;
  let peak = 0;
  let destroyed = 0;
  for (const mode of ['mineradio-3d', 'classic', 'cadenza', 'partita', 'tilt', 'monet', 'cappella', 'fume']) {
    registry.register(mode, () => () => ({
      kind: 'test',
      mount() { live += 1; peak = Math.max(peak, live); },
      setDocument() {},
      update() {},
      resize() {},
      release() {},
      destroy() { live -= 1; destroyed += 1; },
      snapshot() { return {}; },
    }));
  }
  const runtime = createNativeLyricRuntime({ registry });
  const modes = registry.names();
  for (let index = 0; index < 20; index += 1) await runtime.setMode(modes[index % modes.length]);

  assert.equal(live, 1);
  assert.equal(peak, 1);
  assert.equal(destroyed, 19);
  assert.equal(runtime.snapshot().activeRenderers, 1);
});

test('release removes frozen transition layers immediately', async () => {
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  function factory(name) {
    let node;
    return () => ({
      kind: 'dom',
      mount() { node = root.appendChild(new FakeNode(name)); },
      setDocument() {}, update() {}, resize() {}, release() {},
      destroy() { if (node && node.parentNode) node.parentNode.removeChild(node); },
      snapshot() { return {}; },
    });
  }
  registry.register('mineradio-3d', () => factory('3d'));
  registry.register('classic', () => factory('classic'));
  const runtime = createNativeLyricRuntime({ registry, root, setTimeout() { return 1; }, clearTimeout() {} });
  await runtime.setMode('mineradio-3d');
  await runtime.setMode('classic');
  assert.equal(runtime.snapshot().transitionLayers, 1);

  runtime.release('background');
  assert.equal(runtime.snapshot().transitionLayers, 0);
  assert.equal(root.children.length, 1);
});

test('transition canvas snapshots cap 4K raster memory at 1080p pixels', async () => {
  const root = new FakeNode('root');
  const timers = [];
  const sourceCanvas = { width: 3840, height: 2160 };
  const cloneCanvas = {
    width: 0,
    height: 0,
    style: {},
    getContext() { return { drawImage() {} }; },
  };
  const sourceStage = new FakeNode('canvas-stage');
  sourceStage.querySelectorAll = selector => selector === 'canvas' ? [sourceCanvas] : [];
  sourceStage.cloneNode = () => {
    const clone = new FakeNode('canvas-stage:clone');
    clone.querySelectorAll = selector => selector === 'canvas' ? [cloneCanvas] : [];
    return clone;
  };
  const registry = createRendererRegistry();
  registry.register('cadenza', () => () => {
    let node;
    return {
      kind: 'canvas-dom',
      mount() { node = root.appendChild(sourceStage); },
      setDocument() {}, update() {}, resize() {}, release() {},
      destroy() { if (node && node.parentNode) node.parentNode.removeChild(node); },
      snapshot() { return {}; },
    };
  });
  registry.register('classic', () => () => {
    let node;
    return {
      kind: 'dom',
      mount() { node = root.appendChild(new FakeNode('classic')); },
      setDocument() {}, update() {}, resize() {}, release() {},
      destroy() { if (node && node.parentNode) node.parentNode.removeChild(node); },
      snapshot() { return {}; },
    };
  });
  const runtime = createNativeLyricRuntime({
    registry,
    root,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });

  await runtime.setMode('cadenza');
  await runtime.setMode('classic');
  assert.equal(cloneCanvas.width * cloneCanvas.height <= 1920 * 1080, true);
  assert.equal(cloneCanvas.width / cloneCanvas.height, 16 / 9);
});
