(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricThreeSparkField = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MAX_POINTS = 48;
  var QUALITY_POINTS = {
    quality: 48,
    balanced: 32,
    battery: 0,
  };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function pointCount(input, capacity) {
    input = input || {};
    var quality = Object.prototype.hasOwnProperty.call(QUALITY_POINTS, input.quality)
      ? input.quality
      : 'balanced';
    var count = Math.min(capacity, QUALITY_POINTS[quality]);
    if (input.reducedMotion === true || finite(input.degradationLevel, 0) >= 2) return 0;
    if (finite(input.degradationLevel, 0) >= 1) count = Math.floor(count * 0.5);
    return count;
  }

  function positionValues(value) {
    if (Array.isArray(value)) {
      return [finite(value[0], 0), finite(value[1], 0), finite(value[2], 0)];
    }
    value = value && typeof value === 'object' ? value : {};
    return [finite(value.x, 0), finite(value.y, 0), finite(value.z, 0)];
  }

  function buildAttributes(capacity) {
    var positions = new Float32Array(capacity * 3);
    var seeds = new Float32Array(capacity);
    var goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (var index = 0; index < capacity; index += 1) {
      var ratio = (index + 0.5) / capacity;
      var angle = index * goldenAngle;
      var radius = 0.055 + Math.pow(ratio, 0.62) * 0.38;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle) * radius * 0.58;
      positions[index * 3 + 2] = ((((index * 17) % 29) / 28) - 0.5) * 0.26;
      seeds[index] = (index * 0.61803398875) % 1;
    }
    return { positions: positions, seeds: seeds };
  }

  function createClassicSparkField(options) {
    options = options || {};
    var THREE = options.THREE;
    var parent = options.parent;
    if (!THREE || !THREE.BufferGeometry || !THREE.BufferAttribute || !THREE.ShaderMaterial || !THREE.Points || !THREE.Color) {
      throw new Error('Classic spark field requires THREE points support');
    }
    if (!parent || typeof parent.add !== 'function') throw new Error('Classic spark field requires a parent');

    var capacity = Math.max(1, Math.min(MAX_POINTS, Math.floor(finite(options.maxPoints, MAX_POINTS))));
    var attributes = buildAttributes(capacity);
    var geometry = null;
    var material = null;
    var points = null;
    try {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(attributes.positions, 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(attributes.seeds, 1));
      geometry.setDrawRange(0, 0);
      material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uEnergy: { value: 0 },
          uPointSize: { value: clamp(options.pointSize, 2, 18, 8) },
          uColor: { value: new THREE.Color('#ffffff') },
        },
        vertexShader: [
          'attribute float aSeed;',
          'uniform float uTime;',
          'uniform float uEnergy;',
          'uniform float uPointSize;',
          'varying float vSeed;',
          'void main() {',
          '  vSeed = aSeed;',
          '  vec3 sparkPosition = position;',
          '  sparkPosition.x += sin(uTime * 1.15 + aSeed * 17.0) * 0.025 * uEnergy;',
          '  sparkPosition.y += cos(uTime * 0.92 + aSeed * 13.0) * 0.018 * uEnergy;',
          '  sparkPosition.z += sin(uTime * 0.74 + aSeed * 23.0) * 0.022 * uEnergy;',
          '  vec4 viewPosition = modelViewMatrix * vec4(sparkPosition, 1.0);',
          '  gl_Position = projectionMatrix * viewPosition;',
          '  float depthScale = clamp(2.8 / max(1.0, -viewPosition.z), 0.68, 1.5);',
          '  gl_PointSize = uPointSize * (0.72 + aSeed * 0.5) * depthScale;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor;',
          'uniform float uOpacity;',
          'varying float vSeed;',
          'void main() {',
          '  float distanceToCenter = length(gl_PointCoord - vec2(0.5));',
          '  if (distanceToCenter >= 0.5) discard;',
          '  float halo = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);',
          '  float core = 1.0 - smoothstep(0.0, 0.2, distanceToCenter);',
          '  float alpha = (halo * 0.34 + core * 0.78) * uOpacity * (0.72 + vSeed * 0.28);',
          '  gl_FragColor = vec4(uColor, alpha);',
          '}',
        ].join('\n'),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });
      points = new THREE.Points(geometry, material);
      points.name = 'ClassicThreeSparkField';
      points.renderOrder = finite(options.renderOrder, 36);
      points.frustumCulled = false;
      points.visible = false;
      parent.add(points);
    } catch (error) {
      if (points && points.parent && typeof points.parent.remove === 'function') points.parent.remove(points);
      if (geometry && typeof geometry.dispose === 'function') geometry.dispose();
      if (material && typeof material.dispose === 'function') material.dispose();
      throw error;
    }

    var activePoints = 0;
    var opacity = 0;
    var released = false;
    var geometryDisposals = 0;
    var materialDisposals = 0;

    function update(input) {
      if (released) return snapshot();
      input = input || {};
      opacity = clamp(input.opacity, 0, 1, 0);
      activePoints = opacity > 0.01 ? pointCount(input, capacity) : 0;
      var position = positionValues(input.position);
      var scale = clamp(input.scale, 0.2, 3, 1);
      points.position.set(position[0], position[1], position[2]);
      points.scale.setScalar(scale);
      points.visible = activePoints > 0;
      geometry.setDrawRange(0, activePoints);
      material.uniforms.uTime.value = Math.max(0, finite(input.time, 0));
      material.uniforms.uOpacity.value = opacity;
      material.uniforms.uEnergy.value = clamp(input.energy, 0, 1, opacity);
      material.uniforms.uColor.value.set(String(input.color || '#ffffff'));
      return snapshot();
    }

    function snapshot() {
      return {
        capacity: released ? 0 : capacity,
        points: released ? 0 : activePoints,
        visible: released ? false : !!points.visible,
        opacity: released ? 0 : opacity,
        geometryDisposals: geometryDisposals,
        materialDisposals: materialDisposals,
        released: released,
      };
    }

    function release() {
      if (released) return;
      released = true;
      activePoints = 0;
      opacity = 0;
      if (points && points.parent && typeof points.parent.remove === 'function') points.parent.remove(points);
      if (geometry && typeof geometry.dispose === 'function') {
        geometry.dispose();
        geometryDisposals += 1;
      }
      if (material && typeof material.dispose === 'function') {
        material.dispose();
        materialDisposals += 1;
      }
    }

    return {
      update: update,
      snapshot: snapshot,
      release: release,
    };
  }

  return {
    createClassicSparkField: createClassicSparkField,
  };
});
