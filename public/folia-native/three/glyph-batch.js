(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricGlyphBatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var IDENTITY_MATRIX = Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  var WHITE_TINT = Object.freeze([1, 1, 1]);
  var INSTANCE_ATTRIBUTE_NAMES = Object.freeze([
    'aUvRect', 'aUvClamp', 'aTint', 'aOpacity', 'aGlow', 'aProgress',
  ]);

  function nextPowerOfTwo(value) {
    var capacity = 1;
    while (capacity < value) capacity *= 2;
    return capacity;
  }

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function createGlyphBatch(options) {
    options = options || {};
    var THREE = options.THREE;
    var materialPool = options.materialPool;
    var parent = options.parent;
    if (!THREE || !THREE.InstancedBufferGeometry || !THREE.InstancedMesh) throw new Error('Glyph batch requires THREE');
    if (!materialPool || typeof materialPool.acquireGlyphMaterial !== 'function') throw new Error('Glyph batch requires a material pool');
    if (typeof materialPool.normalizeVariant !== 'function') throw new Error('Glyph batch material pool requires normalizeVariant(variant)');
    if (!parent || typeof parent.add !== 'function') throw new Error('Glyph batch requires a parent');
    var batches = new Map();
    var allocations = 0;
    var geometryDisposals = 0;
    var released = false;
    var scratchMatrix = new THREE.Matrix4();

    function batchKey(descriptor, variant) {
      return String(descriptor.pageId || '') + '|' + variant;
    }

    function disposeBatch(record) {
      if (!record || record.disposed) return;
      record.disposed = true;
      if (record.mesh && record.mesh.parent) record.mesh.parent.remove(record.mesh);
      if (record.geometry && typeof record.geometry.dispose === 'function') {
        record.geometry.dispose();
        geometryDisposals += 1;
      }
      if (record.materialLease) record.materialLease.release();
    }

    function makeAttribute(capacity, itemSize) {
      var attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
      if (attribute.setUsage && THREE.DynamicDrawUsage != null) attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    }

    function createRecord(key, descriptors, capacity, variant) {
      var first = descriptors[0];
      var geometry = new THREE.InstancedBufferGeometry();
      geometry.copy(materialPool.getGlyphBaseGeometry());
      geometry.setAttribute('aUvRect', makeAttribute(capacity, 4));
      geometry.setAttribute('aUvClamp', makeAttribute(capacity, 4));
      geometry.setAttribute('aTint', makeAttribute(capacity, 3));
      geometry.setAttribute('aOpacity', makeAttribute(capacity, 1));
      geometry.setAttribute('aGlow', makeAttribute(capacity, 1));
      geometry.setAttribute('aProgress', makeAttribute(capacity, 1));
      geometry.instanceCount = 0;
      var materialLease = materialPool.acquireGlyphMaterial(first.pageId, first.texture, variant);
      var mesh = new THREE.InstancedMesh(geometry, materialLease.material, capacity);
      mesh.count = 0;
      mesh.renderOrder = finite(options.renderOrder, 38);
      parent.add(mesh);
      allocations += 1;
      return {
        key: key,
        capacity: capacity,
        geometry: geometry,
        materialLease: materialLease,
        mesh: mesh,
        disposed: false,
      };
    }

    function ensureRecord(key, descriptors, variant) {
      var record = batches.get(key);
      var required = descriptors.length;
      if (record && record.capacity >= required && record.mesh.material.uniforms.uMap.value === descriptors[0].texture) return record;
      if (record) disposeBatch(record);
      record = createRecord(key, descriptors, nextPowerOfTwo(Math.max(1, required)), variant);
      batches.set(key, record);
      return record;
    }

    function writeDescriptor(record, descriptor, index) {
      var geometry = record.geometry;
      var uv = descriptor.uv || {};
      var sampleUv = descriptor.sampleUv || uv;
      var sampleClampUv = descriptor.sampleClampUv || uv;
      var tint = descriptor.tint || WHITE_TINT;
      var uvOffset = index * 4;
      var tintOffset = index * 3;
      var uvRectArray = geometry.getAttribute('aUvRect').array;
      var uvClampArray = geometry.getAttribute('aUvClamp').array;
      var tintArray = geometry.getAttribute('aTint').array;
      uvRectArray[uvOffset] = finite(sampleUv.u0, 0);
      uvRectArray[uvOffset + 1] = finite(sampleUv.v0, 0);
      uvRectArray[uvOffset + 2] = finite(sampleUv.u1, 1);
      uvRectArray[uvOffset + 3] = finite(sampleUv.v1, 1);
      uvClampArray[uvOffset] = finite(sampleClampUv.u0, 0);
      uvClampArray[uvOffset + 1] = finite(sampleClampUv.v0, 0);
      uvClampArray[uvOffset + 2] = finite(sampleClampUv.u1, 1);
      uvClampArray[uvOffset + 3] = finite(sampleClampUv.v1, 1);
      tintArray[tintOffset] = finite(tint[0], 1);
      tintArray[tintOffset + 1] = finite(tint[1], 1);
      tintArray[tintOffset + 2] = finite(tint[2], 1);
      geometry.getAttribute('aOpacity').array[index] = finite(descriptor.opacity, 1);
      geometry.getAttribute('aGlow').array[index] = finite(descriptor.glow, 0);
      geometry.getAttribute('aProgress').array[index] = finite(descriptor.progress, 0);
      scratchMatrix.fromArray(descriptor.matrix || IDENTITY_MATRIX);
      record.mesh.setMatrixAt(index, scratchMatrix);
    }

    function setInstances(descriptors) {
      if (released) return false;
      descriptors = Array.isArray(descriptors) ? descriptors : [];
      var groups = new Map();
      descriptors.forEach(function(descriptor) {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
          throw new TypeError('Glyph batch descriptor must be an object');
        }
        var variant = materialPool.normalizeVariant(descriptor.variant);
        var key = batchKey(descriptor, variant);
        if (!groups.has(key)) groups.set(key, { descriptors: [], variant: variant });
        groups.get(key).descriptors.push(descriptor);
      });

      var staleKeys = [];
      batches.forEach(function(record, key) {
        if (groups.has(key)) return;
        disposeBatch(record);
        staleKeys.push(key);
      });
      staleKeys.forEach(function(key) { batches.delete(key); });

      groups.forEach(function(group, key) {
        var record = ensureRecord(key, group.descriptors, group.variant);
        group.descriptors.forEach(function(descriptor, index) { writeDescriptor(record, descriptor, index); });
        INSTANCE_ATTRIBUTE_NAMES.forEach(function(name) {
          record.geometry.getAttribute(name).needsUpdate = true;
        });
        record.geometry.instanceCount = group.descriptors.length;
        record.mesh.count = group.descriptors.length;
        record.mesh.visible = group.descriptors.length > 0;
        record.mesh.instanceMatrix.needsUpdate = true;
      });
      return true;
    }

    function snapshot() {
      var instances = 0;
      var drawBatches = 0;
      var capacity = 0;
      batches.forEach(function(record) {
        if (!record.disposed && record.mesh.count > 0) {
          instances += record.mesh.count;
          drawBatches += 1;
          capacity += record.capacity;
        }
      });
      return {
        instances: instances,
        drawBatches: drawBatches,
        capacity: capacity,
        allocations: allocations,
        geometryDisposals: geometryDisposals,
        released: released,
      };
    }

    function release() {
      if (released) return;
      released = true;
      batches.forEach(disposeBatch);
      batches.clear();
    }

    return {
      setInstances: setInstances,
      snapshot: snapshot,
      release: release,
      debugBatches: function() { return Array.from(batches.values()).filter(function(record) { return !record.disposed; }); },
    };
  }

  return {
    createGlyphBatch: createGlyphBatch,
  };
});
