const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeThree } = require('./helpers/fake-three');
const { createClassicSparkField } = require('../public/folia-native/three/spark-field');

function createSparkThree() {
  return createFakeThree();
}

function updateInput(overrides = {}) {
  return {
    position: { x: 1.2, y: -0.4, z: 0.18 },
    scale: 1.15,
    opacity: 0.78,
    color: '#ffdca8',
    time: 2.5,
    quality: 'balanced',
    reducedMotion: false,
    degradationLevel: 0,
    ...overrides,
  };
}

test('Classic spark field creates one deterministic bounded point cloud', () => {
  const THREE = createSparkThree();
  const parent = new THREE.Group();
  const first = createClassicSparkField({ THREE, parent, maxPoints: 48 });
  const secondParent = new THREE.Group();
  const second = createClassicSparkField({ THREE, parent: secondParent, maxPoints: 48 });

  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].name, 'ClassicThreeSparkField');
  assert.equal(first.snapshot().capacity, 48);
  assert.equal(first.snapshot().points, 0);
  assert.deepEqual(
    Array.from(parent.children[0].geometry.getAttribute('position').array),
    Array.from(secondParent.children[0].geometry.getAttribute('position').array),
  );

  first.release();
  second.release();
});

test('Classic spark field follows the active word and bounds quality tiers', () => {
  const THREE = createSparkThree();
  const parent = new THREE.Group();
  const field = createClassicSparkField({ THREE, parent, maxPoints: 48 });
  const points = parent.children[0];

  field.update(updateInput());
  assert.deepEqual([points.position.x, points.position.y, points.position.z], [1.2, -0.4, 0.18]);
  assert.deepEqual([points.scale.x, points.scale.y, points.scale.z], [1.15, 1.15, 1.15]);
  assert.equal(points.visible, true);
  assert.equal(points.geometry.drawRange.count, 32);
  assert.equal(points.material.uniforms.uTime.value, 2.5);
  assert.equal(points.material.uniforms.uOpacity.value, 0.78);
  assert.equal(points.material.uniforms.uColor.value.value, '#ffdca8');
  assert.match(points.material.fragmentShader, /1\.0 - smoothstep\(0\.12, 0\.5, distanceToCenter\)/);
  assert.match(points.material.fragmentShader, /1\.0 - smoothstep\(0\.0, 0\.2, distanceToCenter\)/);
  assert.doesNotMatch(points.material.fragmentShader, /smoothstep\(0\.5, 0\.12|smoothstep\(0\.2, 0\.0/);
  assert.deepEqual(field.snapshot(), {
    capacity: 48,
    points: 32,
    visible: true,
    opacity: 0.78,
    geometryDisposals: 0,
    materialDisposals: 0,
    released: false,
  });

  field.update(updateInput({ quality: 'quality' }));
  assert.equal(points.geometry.drawRange.count, 48);
  field.update(updateInput({ degradationLevel: 1 }));
  assert.equal(points.geometry.drawRange.count, 16);

  field.release();
});

test('Classic spark field hides for constrained modes and releases exactly once', () => {
  const THREE = createSparkThree();
  const parent = new THREE.Group();
  const field = createClassicSparkField({ THREE, parent, maxPoints: 48 });
  const points = parent.children[0];

  field.update(updateInput({ quality: 'battery' }));
  assert.equal(points.visible, false);
  assert.equal(points.geometry.drawRange.count, 0);

  field.update(updateInput({ reducedMotion: true, quality: 'quality' }));
  assert.equal(points.visible, false);
  assert.equal(points.geometry.drawRange.count, 0);

  field.update(updateInput({ degradationLevel: 2, quality: 'quality' }));
  assert.equal(points.visible, false);
  assert.equal(points.geometry.drawRange.count, 0);

  const geometry = points.geometry;
  const material = points.material;
  field.release();
  field.release();
  assert.equal(parent.children.length, 0);
  assert.equal(geometry.disposeCount, 1);
  assert.equal(material.disposeCount, 1);
  assert.deepEqual(field.snapshot(), {
    capacity: 0,
    points: 0,
    visible: false,
    opacity: 0,
    geometryDisposals: 1,
    materialDisposals: 1,
    released: true,
  });
});

test('Classic spark field never creates its own animation, canvas or audio owner', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'public', 'folia-native', 'three', 'spark-field.js'),
    'utf8',
  );

  assert.doesNotMatch(source, /requestAnimationFrame|cancelAnimationFrame/);
  assert.doesNotMatch(source, /createElement\s*\(\s*['"]canvas['"]|OffscreenCanvas/);
  assert.doesNotMatch(source, /AudioContext|webkitAudioContext/);
});
