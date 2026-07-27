(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricThreeMaterials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var GLYPH_VARIANTS = Object.freeze({
    body: Object.freeze({ tapCount: 1 }),
    'glow-9': Object.freeze({ tapCount: 9 }),
    'glow-5': Object.freeze({ tapCount: 5 }),
    'glow-3': Object.freeze({ tapCount: 3 }),
  });

  var GLOW_OFFSETS = Object.freeze({
    'glow-9': Object.freeze([
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [0, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ]),
    'glow-5': Object.freeze([
      [0, -1], [-1, 0], [0, 0], [1, 0], [0, 1],
    ]),
    'glow-3': Object.freeze([
      [-1, 0], [0, 0], [1, 0],
    ]),
  });

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function normalizeVariant(variant) {
    var normalized = String(variant || 'body');
    if (normalized === 'normal') normalized = 'body';
    if (normalized === 'glow' || normalized === 'additive') normalized = 'glow-9';
    if (!Object.prototype.hasOwnProperty.call(GLYPH_VARIANTS, normalized)) {
      throw new Error('Unknown glyph material variant: ' + normalized);
    }
    return normalized;
  }

  function createThreeLyricMaterialPool(options) {
    options = options || {};
    var THREE = options.THREE;
    if (!THREE || !THREE.PlaneGeometry || !THREE.ShaderMaterial) throw new Error('Three lyric material pool requires THREE');
    var glyphBaseGeometry = new THREE.PlaneGeometry(1, 1);
    var blockGeometry = new THREE.PlaneGeometry(1, 1);
    var glyphMaterials = new Map();
    var materialLeases = 0;
    var destroyed = false;

    function materialKey(pageId, variant) {
      return String(pageId || '') + '|' + variant;
    }

    function textureDimensions(texture) {
      var image = texture && (texture.image || (texture.source && texture.source.data) || texture.canvas || texture);
      return {
        width: Math.max(1, finite(image && image.width, 1)),
        height: Math.max(1, finite(image && image.height, 1)),
      };
    }

    function createTexelSize(texture) {
      var dimensions = textureDimensions(texture);
      var x = 1 / dimensions.width;
      var y = 1 / dimensions.height;
      return THREE.Vector2 ? new THREE.Vector2(x, y) : { x: x, y: y };
    }

    function updateTextureUniforms(material, texture) {
      material.uniforms.uMap.value = texture;
      var dimensions = textureDimensions(texture);
      var value = material.uniforms.uTexelSize.value;
      if (value && typeof value.set === 'function') value.set(1 / dimensions.width, 1 / dimensions.height);
      else {
        value.x = 1 / dimensions.width;
        value.y = 1 / dimensions.height;
      }
    }

    var vertexShader = [
      'attribute vec4 aUvRect;',
      'attribute vec4 aUvClamp;',
      'attribute vec3 aTint;',
      'attribute float aOpacity;',
      'attribute float aGlow;',
      'attribute float aProgress;',
      'varying vec2 vAtlasUv;',
      'varying vec4 vUvClamp;',
      'varying vec3 vTint;',
      'varying float vOpacity;',
      'varying float vGlow;',
      'void main(){',
      '  vAtlasUv = mix(aUvRect.xy, aUvRect.zw, uv);',
      '  vUvClamp = aUvClamp;',
      '  vTint = aTint;',
      '  vOpacity = aOpacity;',
      '  vGlow = aGlow;',
      '  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n');

    function bodyFragmentShader() {
      return [
        'precision highp float;',
        'uniform sampler2D uMap;',
        'uniform float uGlobalOpacity;',
        'varying vec2 vAtlasUv;',
        'varying vec3 vTint;',
        'varying float vOpacity;',
        'void main(){',
        '  float mask = texture2D(uMap, vAtlasUv).a;',
        '  if(mask < 0.01) discard;',
        '  gl_FragColor = vec4(vTint, mask * vOpacity * uGlobalOpacity);',
        '}',
      ].join('\n');
    }

    function glowFragmentShader(variant) {
      var offsets = GLOW_OFFSETS[variant];
      var lines = [
        'precision highp float;',
        'uniform sampler2D uMap;',
        'uniform vec2 uTexelSize;',
        'uniform float uGlobalOpacity;',
        'varying vec2 vAtlasUv;',
        'varying vec4 vUvClamp;',
        'varying vec3 vTint;',
        'varying float vOpacity;',
        'varying float vGlow;',
        'void main(){',
      ];
      offsets.forEach(function(offset, index) {
        lines.push(
          '  float tap' + index + ' = texture2D(uMap, clamp(vAtlasUv + uTexelSize * vec2(' +
          offset[0].toFixed(1) + ', ' + offset[1].toFixed(1) + '), vUvClamp.xy, vUvClamp.zw)).a;'
        );
      });
      lines.push(
        '  float mask = (' + offsets.map(function(offset, index) { return 'tap' + index; }).join(' + ') + ') / ' + offsets.length.toFixed(1) + ';',
        '  if(mask < 0.001) discard;',
        '  float strength = mask * max(0.0, vGlow) * vOpacity * uGlobalOpacity;',
        '  gl_FragColor = vec4(vTint * strength, strength);',
        '}'
      );
      return lines.join('\n');
    }

    function createGlyphMaterial(texture, variant) {
      var additive = variant !== 'body';
      var material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uTexelSize: { value: createTexelSize(texture) },
          uGlobalOpacity: { value: 1 },
        },
        vertexShader: vertexShader,
        fragmentShader: additive ? glowFragmentShader(variant) : bodyFragmentShader(),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        premultipliedAlpha: additive,
      });
      material.userData = material.userData || {};
      material.userData.variant = variant;
      material.userData.tapCount = GLYPH_VARIANTS[variant].tapCount;
      return material;
    }

    function disposeMaterialRecord(key, record) {
      if (!record || record.disposed) return false;
      record.disposed = true;
      if (record.material && typeof record.material.dispose === 'function') record.material.dispose();
      if (glyphMaterials.get(key) === record) glyphMaterials.delete(key);
      return true;
    }

    function acquireGlyphMaterial(pageId, texture, variant) {
      if (destroyed) throw new Error('Three lyric material pool is destroyed');
      var normalizedVariant = normalizeVariant(variant);
      var key = materialKey(pageId, normalizedVariant);
      var record = glyphMaterials.get(key);
      if (!record) {
        record = {
          pageId: String(pageId || ''),
          variant: normalizedVariant,
          material: createGlyphMaterial(texture, normalizedVariant),
          refs: 0,
          retired: false,
          disposed: false,
        };
        glyphMaterials.set(key, record);
      } else if (record.retired) {
        throw new Error('Three lyric atlas page is retired');
      } else if (record.material.uniforms && record.material.uniforms.uMap) {
        updateTextureUniforms(record.material, texture);
      }
      record.refs += 1;
      materialLeases += 1;
      var released = false;
      return {
        material: record.material,
        release: function() {
          if (released) return;
          released = true;
          record.refs = Math.max(0, record.refs - 1);
          materialLeases = Math.max(0, materialLeases - 1);
          if (record.refs === 0 && record.retired) disposeMaterialRecord(key, record);
        },
      };
    }

    function evictGlyphPage(pageId) {
      var normalizedPageId = String(pageId || '');
      var disposed = 0;
      glyphMaterials.forEach(function(record, key) {
        if (record.pageId !== normalizedPageId) return;
        record.retired = true;
        if (record.refs === 0 && disposeMaterialRecord(key, record)) disposed += 1;
      });
      return disposed;
    }

    function snapshot() {
      var retiredGlyphMaterials = 0;
      glyphMaterials.forEach(function(record) { if (record.retired) retiredGlyphMaterials += 1; });
      return {
        glyphMaterials: glyphMaterials.size,
        retiredGlyphMaterials: retiredGlyphMaterials,
        materialLeases: materialLeases,
        destroyed: destroyed,
      };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      glyphMaterials.forEach(function(record, key) { disposeMaterialRecord(key, record); });
      glyphMaterials.clear();
      materialLeases = 0;
      if (glyphBaseGeometry && typeof glyphBaseGeometry.dispose === 'function') glyphBaseGeometry.dispose();
      if (blockGeometry && typeof blockGeometry.dispose === 'function') blockGeometry.dispose();
    }

    return {
      acquireGlyphMaterial: acquireGlyphMaterial,
      evictGlyphPage: evictGlyphPage,
      normalizeVariant: normalizeVariant,
      getGlyphBaseGeometry: function() { return glyphBaseGeometry; },
      getBlockGeometry: function() { return blockGeometry; },
      snapshot: snapshot,
      destroy: destroy,
    };
  }

  return {
    createThreeLyricMaterialPool: createThreeLyricMaterialPool,
    GLYPH_VARIANTS: GLYPH_VARIANTS,
    normalizeVariant: normalizeVariant,
  };
});
