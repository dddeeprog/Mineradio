const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeThree } = require('./helpers/fake-three');
const materialPoolApi = require('../public/folia-native/three/material-pool');
const {
  createThreeLyricMaterialPool,
  normalizeVariant,
} = materialPoolApi;
const {
  createGlyphBatch,
} = require('../public/folia-native/three/glyph-batch');
const {
  createBlockPlane,
} = require('../public/folia-native/three/block-plane');

function matrix(x = 0, y = 0, z = 0) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

const textures = new Map();

function descriptor(key, pageId, overrides = {}) {
  if (!textures.has(pageId)) textures.set(pageId, { id: `texture-${pageId}` });
  return {
    key,
    pageId,
    texture: overrides.texture || textures.get(pageId),
    matrix: overrides.matrix || matrix(),
    uv: overrides.uv || { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
    sampleUv: overrides.sampleUv,
    sampleClampUv: overrides.sampleClampUv,
    tint: overrides.tint || [1, 1, 1],
    opacity: overrides.opacity ?? 1,
    glow: overrides.glow ?? 0,
    progress: overrides.progress ?? 0,
    variant: overrides.variant || 'normal',
  };
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-6, `${value} !== ${expected[index]} at ${index}`);
  });
}

test('material pool shares glyph materials and disposes owned resources once', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const texture = { id: 'atlas-page' };
  const first = pool.acquireGlyphMaterial('page-1', texture, 'normal');
  const second = pool.acquireGlyphMaterial('page-1', texture, 'normal');

  assert.equal(first.material, second.material);
  assert.equal(pool.snapshot().glyphMaterials, 1);
  assert.equal(pool.snapshot().materialLeases, 2);
  first.release();
  first.release();
  second.release();
  assert.equal(pool.snapshot().materialLeases, 0);

  const glyphGeometry = pool.getGlyphBaseGeometry();
  const blockGeometry = pool.getBlockGeometry();
  const material = first.material;
  pool.destroy();
  pool.destroy();
  assert.equal(material.disposeCount, 1);
  assert.equal(glyphGeometry.disposeCount, 1);
  assert.equal(blockGeometry.disposeCount, 1);
});

test('material pool exposes sharp body and bounded glow tap variants', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const texture = { id: 'atlas-page', image: { width: 256, height: 128 } };
  const expected = [
    ['body', THREE.NormalBlending, 1],
    ['glow-9', THREE.AdditiveBlending, 9],
    ['glow-5', THREE.AdditiveBlending, 5],
    ['glow-3', THREE.AdditiveBlending, 3],
  ];
  const leases = expected.map(([variant]) => pool.acquireGlyphMaterial('page-1', texture, variant));

  expected.forEach(([variant, blending, tapCount], index) => {
    const material = leases[index].material;
    const sampleLines = material.fragmentShader.split('\n').filter(line => line.includes('texture2D('));
    assert.equal(material.blending, blending, variant);
    assert.equal(material.userData && material.userData.variant, variant);
    assert.equal(material.userData && material.userData.tapCount, tapCount);
    assert.equal(sampleLines.length, tapCount, variant);
    assert.equal(material.uniforms.uTexelSize.value.x, 1 / 256);
    assert.equal(material.uniforms.uTexelSize.value.y, 1 / 128);
    if (variant === 'body') {
      assert.match(material.fragmentShader, /gl_FragColor = vec4\(vTint,/);
      assert.doesNotMatch(material.fragmentShader, /vProgress|vec3\(1\.0, 0\.94, 0\.72\)/);
    } else {
      sampleLines.forEach(line => {
        assert.match(line, /texture2D\(uMap, clamp\(/);
        assert.match(line, /vUvClamp\.xy, vUvClamp\.zw/);
      });
      assert.match(material.fragmentShader, /mask \* max\(0\.0, vGlow\) \* vOpacity \* uGlobalOpacity/);
    }
  });

  leases.forEach(lease => lease.release());
  pool.destroy();
});

test('material pool releases retired atlas page textures without retaining stale materials', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const first = pool.acquireGlyphMaterial('page-1', { id: 'texture-1' }, 'normal');
  const second = pool.acquireGlyphMaterial('page-2', { id: 'texture-2' }, 'normal');
  const firstMaterial = first.material;
  const secondMaterial = second.material;

  first.release();
  second.release();
  assert.equal(pool.evictGlyphPage('page-1'), 1);
  assert.equal(firstMaterial.disposeCount, 1);
  assert.equal(secondMaterial.disposeCount, 0);
  assert.equal(pool.snapshot().glyphMaterials, 1);

  pool.destroy();
  assert.equal(firstMaterial.disposeCount, 1);
  assert.equal(secondMaterial.disposeCount, 1);
});

test('material pool defers a retired page until its final active lease is released', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const lease = pool.acquireGlyphMaterial('page-1', { id: 'texture-1' }, 'normal');
  const material = lease.material;

  assert.equal(pool.evictGlyphPage('page-1'), 0);
  assert.equal(material.disposeCount, 0);
  assert.equal(pool.snapshot().retiredGlyphMaterials, 1);
  lease.release();
  assert.equal(material.disposeCount, 1);
  assert.equal(pool.snapshot().glyphMaterials, 0);
  pool.destroy();
  assert.equal(material.disposeCount, 1);
});

test('glyph batch groups instances by atlas page and reuses capacity', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent });

  batch.setInstances([
    descriptor('a', 'page-1'),
    descriptor('b', 'page-1', { matrix: matrix(1, 0, 0) }),
    descriptor('光', 'page-2'),
  ]);
  const first = batch.snapshot();
  batch.setInstances([
    descriptor('a', 'page-1'),
    descriptor('光', 'page-2'),
  ]);
  const second = batch.snapshot();

  assert.equal(first.drawBatches, 2);
  assert.equal(first.instances, 3);
  assert.equal(second.drawBatches, 2);
  assert.equal(second.instances, 2);
  assert.equal(second.allocations, first.allocations);
  assert.equal(parent.children.length, 2);
  batch.release();
  assert.equal(parent.children.length, 0);
  assert.equal(batch.snapshot().geometryDisposals, 2);
  assert.equal(pool.snapshot().materialLeases, 0);
  pool.destroy();
});

test('glyph batch normalizes legacy material aliases before grouping and leasing', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent });
  const texture = { id: 'page-aliases', image: { width: 256, height: 256 } };

  batch.setInstances([
    descriptor('normal', 'page-aliases', { texture, variant: 'normal' }),
    descriptor('body', 'page-aliases', { texture, variant: 'body' }),
    descriptor('glow', 'page-aliases', { texture, variant: 'glow' }),
    descriptor('additive', 'page-aliases', { texture, variant: 'additive' }),
    descriptor('glow-9', 'page-aliases', { texture, variant: 'glow-9' }),
  ]);
  const records = batch.debugBatches().sort((left, right) => left.key.localeCompare(right.key));

  assert.deepEqual(records.map(record => record.key), ['page-aliases|body', 'page-aliases|glow-9']);
  assert.deepEqual(records.map(record => record.mesh.count), [2, 3]);
  assert.deepEqual(records.map(record => record.mesh.material.userData.variant), ['body', 'glow-9']);
  assert.equal(batch.snapshot().drawBatches, 2);
  assert.equal(pool.snapshot().glyphMaterials, 2);
  assert.equal(pool.snapshot().materialLeases, 2);
  assert.equal(typeof normalizeVariant, 'function');
  assert.equal(pool.normalizeVariant, normalizeVariant);
  assert.equal(pool.normalizeVariant('normal'), 'body');
  assert.equal(pool.normalizeVariant('glow'), 'glow-9');
  assert.equal(pool.normalizeVariant('additive'), 'glow-9');
  assert.throws(() => pool.normalizeVariant('unknown'), /Unknown glyph material variant: unknown/);

  batch.release();
  pool.destroy();
});

test('glyph batch rejects a null descriptor before allocating resources', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent });

  assert.throws(
    () => batch.setInstances([null]),
    error => error instanceof TypeError && error.message === 'Glyph batch descriptor must be an object',
  );
  assert.equal(batch.snapshot().allocations, 0);
  assert.equal(batch.snapshot().drawBatches, 0);
  assert.equal(batch.snapshot().geometryDisposals, 0);
  assert.equal(pool.snapshot().glyphMaterials, 0);
  assert.equal(pool.snapshot().materialLeases, 0);
  assert.equal(parent.children.length, 0);

  batch.release();
  pool.destroy();
});

test('glyph batch grows one page to the next power of two and updates instance attributes', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent: new THREE.Group() });
  const texture = { id: 'page-1' };

  batch.setInstances([descriptor('a', 'page-1', { texture })]);
  const first = batch.snapshot();
  batch.setInstances([
    descriptor('a', 'page-1', { texture, glow: 0.1 }),
    descriptor('b', 'page-1', { texture, glow: 0.5, progress: 0.4 }),
    descriptor('c', 'page-1', { texture, opacity: 0.6, tint: [0.2, 0.4, 0.8] }),
  ]);
  const second = batch.snapshot();
  const debug = batch.debugBatches()[0];

  assert.equal(first.capacity, 1);
  assert.equal(second.capacity, 4);
  assert.equal(second.allocations, first.allocations + 1);
  assert.equal(second.geometryDisposals, 1);
  const glows = Array.from(debug.geometry.getAttribute('aGlow').array.slice(0, 3));
  const progress = Array.from(debug.geometry.getAttribute('aProgress').array.slice(0, 3));
  assert.ok(Math.abs(glows[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(glows[1] - 0.5) < 1e-6);
  assert.equal(glows[2], 0);
  assert.equal(progress[0], 0);
  assert.ok(Math.abs(progress[1] - 0.4) < 1e-6);
  assert.equal(progress[2], 0);
  assert.equal(debug.mesh.instanceMatrix.needsUpdate, true);
  batch.release();
  pool.destroy();
});

test('glyph batch uploads padded UV clamps and preserves body/glow matrices byte-for-byte', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent });
  const texture = { id: 'page-padded', image: { width: 256, height: 128 } };
  const sharedMatrix = matrix(2, 3, 4);
  const uv = { u0: 0.2, v0: 0.3, u1: 0.4, v1: 0.6 };
  const sampleUv = { u0: 0.1, v0: 0.2, u1: 0.5, v1: 0.7 };
  const sampleClampUv = { u0: 0.11, v0: 0.21, u1: 0.49, v1: 0.69 };

  batch.setInstances([
    descriptor('body', 'page-padded', { texture, variant: 'body', matrix: sharedMatrix, uv, sampleUv, sampleClampUv }),
    descriptor('fallback', 'page-padded', { texture, variant: 'body', uv }),
    descriptor('glow', 'page-padded', { texture, variant: 'glow-9', matrix: sharedMatrix, uv, sampleUv, sampleClampUv }),
  ]);
  const records = batch.debugBatches();
  const body = records.find(record => record.key === 'page-padded|body');
  const glow = records.find(record => record.key === 'page-padded|glow-9');
  const instancedAttributes = Object.keys(body.geometry.attributes).filter(name => name.startsWith('a')).sort();

  assert.deepEqual(instancedAttributes, ['aGlow', 'aOpacity', 'aProgress', 'aTint', 'aUvClamp', 'aUvRect']);
  assertFloatArrayClose(Array.from(body.geometry.getAttribute('aUvRect').array.slice(0, 4)), Object.values(sampleUv));
  assertFloatArrayClose(Array.from(body.geometry.getAttribute('aUvClamp').array.slice(0, 4)), Object.values(sampleClampUv));
  assertFloatArrayClose(Array.from(body.geometry.getAttribute('aUvRect').array.slice(4, 8)), Object.values(uv));
  assertFloatArrayClose(Array.from(body.geometry.getAttribute('aUvClamp').array.slice(4, 8)), Object.values(uv));
  assert.deepEqual(
    Buffer.from(body.mesh.instanceMatrix.array.buffer, 0, 16 * Float32Array.BYTES_PER_ELEMENT),
    Buffer.from(glow.mesh.instanceMatrix.array.buffer, 0, 16 * Float32Array.BYTES_PER_ELEMENT),
  );
  assert.deepEqual(sharedMatrix, matrix(2, 3, 4));
  assert.equal(body.mesh.material.uniforms.uTexelSize.value.x, 1 / 256);
  assert.equal(body.mesh.material.uniforms.uTexelSize.value.y, 1 / 128);

  batch.release();
  assert.equal(parent.children.length, 0);
  pool.destroy();
});

test('glyph batch releases page materials and geometry after a page leaves the active line', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool, parent });

  batch.setInstances([descriptor('a', 'page-1'), descriptor('光', 'page-2')]);
  batch.setInstances([descriptor('影', 'page-2')]);
  assert.equal(parent.children.length, 1);
  assert.equal(batch.debugBatches().length, 1);
  assert.equal(batch.snapshot().geometryDisposals, 1);
  assert.equal(pool.snapshot().materialLeases, 1);

  batch.release();
  pool.destroy();
});

test('block plane redraws only for a new content key and owns only local texture material', () => {
  const THREE = createFakeThree();
  const parent = new THREE.Group();
  const pool = createThreeLyricMaterialPool({ THREE });
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return { clearRect() {} }; },
  };
  const plane = createBlockPlane({
    THREE,
    materialPool: pool,
    parent,
    width: 256,
    height: 64,
    createCanvas: () => canvas,
    createTexture: value => new THREE.CanvasTexture(value),
  });
  let draws = 0;

  plane.setContent('line-1', () => { draws += 1; });
  plane.setContent('line-1', () => { draws += 1; });
  plane.setContent('line-2', () => { draws += 1; });
  assert.equal(draws, 2);
  assert.equal(plane.snapshot().redraws, 2);
  assert.equal(parent.children.length, 1);

  const sharedGeometry = pool.getBlockGeometry();
  const localMaterial = plane.getMesh().material;
  const localTexture = localMaterial.map;
  plane.release();
  plane.release();
  assert.equal(parent.children.length, 0);
  assert.equal(localMaterial.disposeCount, 1);
  assert.equal(localTexture.disposeCount, 1);
  assert.equal(sharedGeometry.disposeCount, 0);
  pool.destroy();
  assert.equal(sharedGeometry.disposeCount, 1);
});
