(function(root, factory) {
  var atlas = root && root.MineradioNativeLyricGlyphAtlas;
  var materials = root && root.MineradioNativeLyricThreeMaterials;
  var glyphBatch = root && root.MineradioNativeLyricGlyphBatch;
  var blockPlane = root && root.MineradioNativeLyricBlockPlane;
  if (typeof module === 'object' && module.exports) {
    atlas = require('./glyph-atlas');
    materials = require('./material-pool');
    glyphBatch = require('./glyph-batch');
    blockPlane = require('./block-plane');
  }
  var api = factory(atlas, materials, glyphBatch, blockPlane);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricThreeHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(atlasApi, materialApi, glyphBatchApi, blockPlaneApi) {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function boundedFinite(value, minimum, maximum, fallback) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function copyVector(target, value) {
    if (!target || value == null) return;
    if (Array.isArray(value)) target.set(finite(value[0], 0), finite(value[1], 0), finite(value[2], 0));
    else if (typeof target.copy === 'function') target.copy(value);
  }

  function copyQuaternion(target, value) {
    if (!target || value == null) return;
    if (Array.isArray(value)) target.set(finite(value[0], 0), finite(value[1], 0), finite(value[2], 0), finite(value[3], 1));
    else if (typeof target.copy === 'function') target.copy(value);
  }

  var transitionVertexShader = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');

  var transitionFragmentShader = [
    'uniform sampler2D uMap;',
    'uniform float uOpacity;',
    'uniform float uBlurPx;',
    'uniform vec2 uTexelSize;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 centerUv = clamp(vUv, vec2(0.0), vec2(1.0));',
    '  vec2 blurOffset = uTexelSize * uBlurPx;',
    '  vec4 color =',
    '    texture2D(uMap, clamp(centerUv + blurOffset * vec2(0.0, 0.0), vec2(0.0), vec2(1.0))) * 0.4 +',
    '    texture2D(uMap, clamp(centerUv + blurOffset * vec2(-1.0, 0.0), vec2(0.0), vec2(1.0))) * 0.15 +',
    '    texture2D(uMap, clamp(centerUv + blurOffset * vec2(1.0, 0.0), vec2(0.0), vec2(1.0))) * 0.15 +',
    '    texture2D(uMap, clamp(centerUv + blurOffset * vec2(0.0, -1.0), vec2(0.0), vec2(1.0))) * 0.15 +',
    '    texture2D(uMap, clamp(centerUv + blurOffset * vec2(0.0, 1.0), vec2(0.0), vec2(1.0))) * 0.15;',
    '  gl_FragColor = vec4(color.rgb * uOpacity, color.a * uOpacity);',
    '}',
  ].join('\n');

  function createThreeLyricHost(options) {
    options = options || {};
    var THREE = options.THREE;
    var scene = options.scene;
    var camera = options.camera;
    var renderer = options.renderer;
    if (!THREE || !scene || !camera || !renderer) throw new Error('Three lyric host requires THREE, scene, camera and renderer');
    if (!atlasApi || !materialApi || !glyphBatchApi || !blockPlaneApi) throw new Error('Three lyric host dependencies are missing');
    var createCanvas = options.createCanvas || function(width, height) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    var createTexture = options.createTexture || function(canvas) {
      var texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      return texture;
    };
    var transitionMaxPixels = Math.max(65536, finite(options.transitionMaxPixels, 1920 * 1080));
    var foliaRoot = new THREE.Group();
    var transitionRoot = new THREE.Group();
    foliaRoot.name = 'MineradioFoliaThreeLyrics';
    transitionRoot.name = 'MineradioFoliaThreeTransitions';
    foliaRoot.renderOrder = 38;
    transitionRoot.renderOrder = 39;
    scene.add(foliaRoot);
    scene.add(transitionRoot);
    var atlas = null;
    var materialPool = null;
    var activeScope = null;
    var transitions = new Set();
    var contextSubscribers = new Set();
    var latestViewport = { width: 1280, height: 720, dpr: 1 };
    var latestAnchor = null;
    var suspended = false;
    var resourcesValid = true;
    var destroyed = false;

    function createSharedResources() {
      materialPool = materialApi.createThreeLyricMaterialPool({ THREE: THREE });
      try {
        atlas = atlasApi.createGlyphAtlas({
          pageSize: Math.max(256, Math.round(finite(options.atlasPageSize, 1024))),
          maxPages: Math.max(1, Math.round(finite(options.atlasMaxPages, 4))),
          maxBytes: Math.max(1048576, finite(options.atlasMaxBytes, 32 * 1024 * 1024)),
          createCanvas: createCanvas,
          createTexture: createTexture,
          onDisposePage: function(pageId) { materialPool.evictGlyphPage(pageId); },
        });
      } catch (error) {
        materialPool.destroy();
        materialPool = null;
        throw error;
      }
    }

    function destroySharedResources() {
      if (atlas) atlas.clear({ force: true });
      if (materialPool) materialPool.destroy();
      atlas = null;
      materialPool = null;
    }

    createSharedResources();

    function createModeScope(mode) {
      if (destroyed) throw new Error('Three lyric host is destroyed');
      if (!resourcesValid) throw new Error('Three lyric host resources are unavailable');
      if (activeScope) activeScope.release();
      var group = new THREE.Group();
      group.name = 'FoliaThreeMode:' + String(mode || 'unknown');
      group.renderOrder = 38;
      foliaRoot.add(group);
      var resources = [];
      var scopeReleased = false;
      var scope = {
        mode: String(mode || ''),
        group: group,
        track: function(resource) {
          if (scopeReleased) {
            if (resource && typeof resource.release === 'function') resource.release();
            return resource;
          }
          resources.push(resource);
          return resource;
        },
        release: function() {
          if (scopeReleased) return;
          scopeReleased = true;
          for (var index = resources.length - 1; index >= 0; index -= 1) {
            var resource = resources[index];
            if (resource && typeof resource.release === 'function') resource.release();
          }
          resources.length = 0;
          if (group.parent) group.parent.remove(group);
          if (activeScope === scope) activeScope = null;
        },
        released: function() { return scopeReleased; },
      };
      activeScope = scope;
      return scope;
    }

    function assertScope(scope) {
      if (!scope || scope !== activeScope || scope.released()) throw new Error('Three lyric mode scope is not active');
    }

    function createGlyphBatch(scope, input) {
      assertScope(scope);
      input = input || {};
      return scope.track(glyphBatchApi.createGlyphBatch({
        THREE: THREE,
        materialPool: materialPool,
        parent: input.parent || scope.group,
        renderOrder: input.renderOrder,
      }));
    }

    function createBlockPlane(scope, input) {
      assertScope(scope);
      input = input || {};
      return scope.track(blockPlaneApi.createBlockPlane({
        THREE: THREE,
        materialPool: materialPool,
        parent: input.parent || scope.group,
        width: input.width,
        height: input.height,
        renderOrder: input.renderOrder,
        createCanvas: input.createCanvas || createCanvas,
        createTexture: input.createTexture || createTexture,
      }));
    }

    function applyAnchor(target, anchor) {
      if (!target || !anchor) return;
      copyVector(target.position, anchor.position);
      copyQuaternion(target.quaternion, anchor.quaternion);
      if (anchor.scale != null && target.scale) {
        if (typeof anchor.scale === 'number' && target.scale.setScalar) target.scale.setScalar(anchor.scale);
        else copyVector(target.scale, anchor.scale);
      }
    }

    function updateAnchor(frame) {
      frame = frame || {};
      if (frame.viewport) latestViewport = Object.assign({}, latestViewport, frame.viewport);
      latestAnchor = typeof options.getAnchor === 'function' ? options.getAnchor(frame) : latestAnchor;
      if (latestAnchor) {
        applyAnchor(foliaRoot, latestAnchor);
        transitions.forEach(function(record) {
          applyAnchor(record.mesh, {
            position: latestAnchor.position,
            quaternion: latestAnchor.quaternion,
            scale: 1,
          });
          record.applyVisualState();
        });
      }
      return latestAnchor;
    }

    function rendererState() {
      var color = new THREE.Color();
      var viewport = THREE.Vector4 ? new THREE.Vector4() : {};
      var scissor = THREE.Vector4 ? new THREE.Vector4() : {};
      return {
        target: renderer.getRenderTarget ? renderer.getRenderTarget() : null,
        clearColor: renderer.getClearColor ? renderer.getClearColor(color) : color,
        clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1,
        viewport: renderer.getViewport ? renderer.getViewport(viewport) : null,
        scissor: renderer.getScissor ? renderer.getScissor(scissor) : null,
        scissorTest: renderer.getScissorTest ? renderer.getScissorTest() : false,
        autoClear: renderer.autoClear,
        cameraLayerMask: camera.layers && camera.layers.mask,
      };
    }

    function restoreRendererState(state) {
      if (renderer.setRenderTarget) renderer.setRenderTarget(state.target);
      if (renderer.setClearColor) renderer.setClearColor(state.clearColor, state.clearAlpha);
      if (renderer.setViewport && state.viewport) renderer.setViewport(state.viewport.x, state.viewport.y, state.viewport.z, state.viewport.w);
      if (renderer.setScissor && state.scissor) renderer.setScissor(state.scissor.x, state.scissor.y, state.scissor.z, state.scissor.w);
      if (renderer.setScissorTest) renderer.setScissorTest(state.scissorTest);
      renderer.autoClear = state.autoClear;
      if (camera.layers && state.cameraLayerMask != null) camera.layers.mask = state.cameraLayerMask;
    }

    function captureTransition(scope, transitionOptions) {
      if (!scope || scope.released() || destroyed || !resourcesValid) return null;
      transitionOptions = transitionOptions || {};
      var purpose = transitionOptions.purpose == null || transitionOptions.purpose === ''
        ? 'mode-switch'
        : String(transitionOptions.purpose);
      var width = Math.max(1, Math.round(finite(latestViewport.width, 1280) * finite(latestViewport.dpr, 1)));
      var height = Math.max(1, Math.round(finite(latestViewport.height, 720) * finite(latestViewport.dpr, 1)));
      var scale = Math.min(1, Math.sqrt(transitionMaxPixels / Math.max(1, width * height)));
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
      var target = null;
      var geometry = null;
      var material = null;
      var mesh = null;
      var record = null;
      var disposed = false;
      var disposeCount = 0;
      var visualState = { opacity: 1, scale: 1, blurPx: 0 };
      function applyVisualState() {
        if (!material || !mesh) return;
        material.uniforms.uOpacity.value = visualState.opacity;
        material.uniforms.uBlurPx.value = visualState.blurPx;
        if (mesh.scale && typeof mesh.scale.setScalar === 'function') mesh.scale.setScalar(visualState.scale);
        else if (mesh.scale) mesh.scale.set(visualState.scale, visualState.scale, visualState.scale);
      }
      function setVisualState(next) {
        if (disposed) return;
        next = next || {};
        visualState.opacity = boundedFinite(next.opacity, 0, 1, visualState.opacity);
        visualState.scale = boundedFinite(next.scale, 1, 1.1, visualState.scale);
        visualState.blurPx = boundedFinite(next.blurPx, 0, 20, visualState.blurPx);
        applyVisualState();
      }
      function transitionSnapshot() {
        return {
          purpose: purpose,
          opacity: visualState.opacity,
          scale: visualState.scale,
          blurPx: visualState.blurPx,
          released: disposed,
        };
      }
      function releaseTransition() {
        if (disposed) return;
        disposed = true;
        disposeCount += 1;
        if (record) transitions.delete(record);
        if (mesh && mesh.parent) mesh.parent.remove(mesh);
        if (geometry && geometry.dispose) geometry.dispose();
        if (material && material.dispose) material.dispose();
        if (target && target.dispose) target.dispose();
      }
      try {
        target = new THREE.WebGLRenderTarget(width, height, {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: false,
          stencilBuffer: false,
        });
        var captureScene = new THREE.Scene();
        var captureRoot = foliaRoot.clone(false);
        captureRoot.add(scope.group.clone(true));
        captureScene.add(captureRoot);
        var state = rendererState();
        try {
          renderer.setRenderTarget(target);
          renderer.setViewport(0, 0, width, height);
          if (renderer.setScissorTest) renderer.setScissorTest(false);
          if (renderer.setClearColor) renderer.setClearColor(0x000000, 0);
          renderer.autoClear = true;
          if (renderer.clear) renderer.clear(true, true, true);
          renderer.render(captureScene, camera);
        } finally {
          restoreRendererState(state);
        }

        var distance = Math.max(1, finite(latestAnchor && latestAnchor.distance, 4.85));
        var viewHeight = camera && camera.fov ? 2 * Math.tan(camera.fov * Math.PI / 360) * distance : 4;
        var viewWidth = viewHeight * Math.max(0.2, finite(camera && camera.aspect, latestViewport.width / Math.max(1, latestViewport.height)));
        geometry = new THREE.PlaneGeometry(viewWidth, viewHeight);
        var texelSize = THREE.Vector2
          ? new THREE.Vector2(1 / target.width, 1 / target.height)
          : { x: 1 / target.width, y: 1 / target.height };
        material = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: target.texture },
            uOpacity: { value: 1 },
            uBlurPx: { value: 0 },
            uTexelSize: { value: texelSize },
          },
          vertexShader: transitionVertexShader,
          fragmentShader: transitionFragmentShader,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        });
        mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 39;
        applyAnchor(mesh, latestAnchor && {
          position: latestAnchor.position,
          quaternion: latestAnchor.quaternion,
          scale: 1,
        });
        applyVisualState();
        transitionRoot.add(mesh);
        record = { mesh: mesh, applyVisualState: applyVisualState, release: releaseTransition };
        transitions.add(record);
        return {
          kind: 'managed-three-transition',
          width: width,
          height: height,
          setVisualState: setVisualState,
          snapshot: transitionSnapshot,
          release: releaseTransition,
          disposeCount: function() { return disposeCount; },
        };
      } catch (error) {
        releaseTransition();
        throw error;
      }
    }

    function sampleActiveLayer(input) {
      input = input || {};
      if (!activeScope || activeScope.released() || destroyed || !resourcesValid) return null;
      if (typeof renderer.readRenderTargetPixels !== 'function') return null;
      var width = Math.max(1, Math.min(1024, Math.round(finite(input.width, 320))));
      var height = Math.max(1, Math.min(1024, Math.round(finite(input.height, 180))));
      var maxPixels = Math.max(1024, finite(input.maxPixels, 262144));
      var scale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, width * height)));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      var target = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      var captureScene = new THREE.Scene();
      var captureRoot = foliaRoot.clone(false);
      captureRoot.add(activeScope.group.clone(true));
      captureScene.add(captureRoot);
      var pixels = new Uint8Array(width * height * 4);
      var state = rendererState();
      try {
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, width, height);
        if (renderer.setScissorTest) renderer.setScissorTest(false);
        if (renderer.setClearColor) renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        if (renderer.clear) renderer.clear(true, true, true);
        renderer.render(captureScene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      } finally {
        restoreRendererState(state);
        if (target.dispose) target.dispose();
      }
      var alphaThreshold = Math.max(0, Math.min(1, finite(input.alphaThreshold, 0.05))) * 255;
      var visiblePixels = 0;
      for (var index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > alphaThreshold) visiblePixels += 1;
      }
      return {
        width: width,
        height: height,
        visiblePixels: visiblePixels,
        visibleRatio: visiblePixels / Math.max(1, width * height),
      };
    }

    function releaseTransitions() {
      Array.from(transitions).forEach(function(record) {
        if (record.release) record.release();
        else if (record.mesh && record.mesh.parent) record.mesh.parent.remove(record.mesh);
      });
      transitions.clear();
    }

    function notifyContext(type) {
      contextSubscribers.forEach(function(listener) {
        try { listener({ type: type }); } catch (error) {}
      });
    }

    function onContextLost(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      resourcesValid = false;
      releaseTransitions();
      notifyContext('lost');
    }

    function onContextRestored() {
      if (activeScope) activeScope.release();
      destroySharedResources();
      createSharedResources();
      resourcesValid = true;
      notifyContext('restored');
    }

    if (renderer.domElement && renderer.domElement.addEventListener) {
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
    }

    function subscribeContext(listener) {
      if (typeof listener !== 'function') return function() {};
      contextSubscribers.add(listener);
      var removed = false;
      return function() {
        if (removed) return;
        removed = true;
        contextSubscribers.delete(listener);
      };
    }

    function suspend() {
      suspended = true;
      foliaRoot.visible = false;
      transitionRoot.visible = false;
    }

    function resume() {
      if (destroyed) return false;
      suspended = false;
      foliaRoot.visible = true;
      transitionRoot.visible = true;
      return true;
    }

    function trim(level) {
      level = Math.max(0, Math.min(3, Math.round(finite(level, 0))));
      var keepPages = Math.max(1, Math.round(finite(options.atlasMaxPages, 4)) - level);
      return atlas ? atlas.trim({ maxPages: keepPages }) : 0;
    }

    function snapshot() {
      var atlasSnapshot = atlas ? atlas.snapshot() : {};
      var materialSnapshot = materialPool ? materialPool.snapshot() : {};
      var glyphInstances = 0;
      var drawBatches = 0;
      if (activeScope && activeScope.group) {
        (function collect(node) {
          if (!node) return;
          if (node.userData && node.userData.nativeLyricSnapshot) {
            glyphInstances += Number(node.userData.nativeLyricSnapshot.instances) || 0;
            drawBatches += Number(node.userData.nativeLyricSnapshot.drawBatches) || 0;
          }
          (node.children || []).forEach(collect);
        })(activeScope.group);
      }
      return {
        activeScopes: activeScope && !activeScope.released() ? 1 : 0,
        transitionLayers: transitions.size,
        atlasPages: Number(atlasSnapshot.pages) || 0,
        atlasBytes: Number(atlasSnapshot.bytes) || 0,
        atlasEntries: Number(atlasSnapshot.entries) || 0,
        glyphMaterials: Number(materialSnapshot.glyphMaterials) || 0,
        retiredGlyphMaterials: Number(materialSnapshot.retiredGlyphMaterials) || 0,
        materialLeases: Number(materialSnapshot.materialLeases) || 0,
        glyphInstances: glyphInstances,
        drawBatches: drawBatches,
        resourcesValid: resourcesValid,
        suspended: suspended,
        destroyed: destroyed,
      };
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (activeScope) activeScope.release();
      releaseTransitions();
      if (renderer.domElement && renderer.domElement.removeEventListener) {
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      }
      contextSubscribers.clear();
      destroySharedResources();
      if (foliaRoot.parent) foliaRoot.parent.remove(foliaRoot);
      if (transitionRoot.parent) transitionRoot.parent.remove(transitionRoot);
    }

    return {
      createModeScope: createModeScope,
      updateAnchor: updateAnchor,
      createGlyphBatch: createGlyphBatch,
      createBlockPlane: createBlockPlane,
      captureTransition: captureTransition,
      sampleActiveLayer: sampleActiveLayer,
      subscribeContext: subscribeContext,
      suspend: suspend,
      resume: resume,
      trim: trim,
      snapshot: snapshot,
      getRoot: function() { return foliaRoot; },
      getAtlas: function() { return atlas; },
      getMaterialPool: function() { return materialPool; },
      destroy: destroy,
    };
  }

  return {
    createThreeLyricHost: createThreeLyricHost,
  };
});
