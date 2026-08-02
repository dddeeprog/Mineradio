/**
 * Sonic Topography renderer for Mineradio.
 * Independently rewritten from the behavior of XxHuberrr/Mineradio
 * public/sonic-topography-preset.js at 4abaa190de42c632365ae4244e041bad16443224
 * (GPL-3.0-only). That upstream file references yin-yizhen/sonic-topography
 * 1.1.1 at 3ff303e under its Non-Commercial Learning License. No shader or
 * player source from that nested project is copied here.
 */
(function(root, factory) {
  var stateApi = typeof module === 'object' && module.exports
    ? require('./sonic-topography-state')
    : root && root.MineradioSonicTopographyState;
  var api = factory(stateApi || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioSonicTopographyRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(stateApi) {
  'use strict';

  var TAU = Math.PI * 2;
  var DEFAULT_VIEWPORT = { width: 1280, height: 720, dpr: 1 };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function normalizeViewport(input) {
    input = input && typeof input === 'object' ? input : {};
    return {
      width: Math.max(1, Math.round(finite(input.width, DEFAULT_VIEWPORT.width))),
      height: Math.max(1, Math.round(finite(input.height, DEFAULT_VIEWPORT.height))),
      dpr: clamp(input.dpr, 0.5, 2, DEFAULT_VIEWPORT.dpr),
    };
  }

  function safeHex(value, fallback) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }

  function themeColors(frame, config) {
    var theme = frame && frame.theme || {};
    var cover = theme.coverColors || theme.wordColors || [];
    var useCover = config.palette === 'cover' && Array.isArray(cover) && cover.length;
    var primary = useCover ? cover[0] : (theme.primary || theme.accent || theme.highlight || theme.word || theme.wordColors && theme.wordColors[0]);
    var secondary = useCover ? cover[1] : (theme.secondary || theme.warm || theme.wordColors && theme.wordColors[1]);
    var background = useCover ? cover[2] : (theme.background || theme.base || theme.dark);
    return {
      primary: safeHex(primary, '#58d9ff'),
      secondary: safeHex(secondary, '#ff7d67'),
      background: safeHex(background, '#05070c'),
    };
  }

  function vertexShader() {
    return [
      'precision highp float;',
      'varying vec2 vUv;',
      'varying float vHeight;',
      'void main(){',
      '  vUv=uv;',
      '  vHeight=max(0.0,position.y+2.45);',
      '  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
      '}',
    ].join('\n');
  }

  function fragmentShader() {
    return [
      'precision highp float;',
      'uniform vec3 uPrimary;',
      'uniform vec3 uSecondary;',
      'uniform vec3 uBackground;',
      'uniform vec2 uGrid;',
      'uniform float uOpacity;',
      'uniform float uEnergy;',
      'uniform float uTime;',
      'varying vec2 vUv;',
      'varying float vHeight;',
      'void main(){',
      '  float gx=pow(0.5+0.5*cos(vUv.x*uGrid.x*6.2831853),18.0);',
      '  float gy=pow(0.5+0.5*cos(vUv.y*uGrid.y*6.2831853),18.0);',
      '  float grid=max(gx,gy);',
      '  float heightGlow=clamp(vHeight/2.8,0.0,1.0);',
      '  float pulse=0.92+0.08*sin(uTime*1.7+vUv.y*9.0);',
      '  vec3 color=mix(uPrimary,uSecondary,clamp(heightGlow+vUv.x*0.22,0.0,1.0));',
      '  color=mix(uBackground,color,0.58+heightGlow*0.42);',
      '  color*=pulse*(0.82+uEnergy*0.42);',
      '  float edgeFade=smoothstep(0.0,0.08,vUv.x)*smoothstep(0.0,0.08,1.0-vUv.x);',
      '  float depthFade=1.0-smoothstep(0.58,1.0,vUv.y);',
      '  float alpha=(0.055+grid*0.43+heightGlow*0.17)*edgeFade*depthFade*uOpacity;',
      '  gl_FragColor=vec4(color,alpha);',
      '}',
    ].join('\n');
  }

  function createSonicTopographyRenderer(options) {
    options = options || {};
    var THREE = options.THREE;
    var scene = options.scene;
    var mainRenderer = options.renderer;
    var host = options.host || null;
    if (!THREE || !scene || !mainRenderer) throw new Error('Sonic renderer requires THREE, scene and renderer');
    if (typeof stateApi.createSonicTopographyState !== 'function') throw new Error('Sonic state module is unavailable');

    var createCanvas = options.createCanvas || function() { return document.createElement('canvas'); };
    var canvasRoot = options.canvasRoot || null;
    var state = (options.stateFactory || stateApi.createSonicTopographyState)({ seed: options.seed || 'mineradio-sonic-stage' });
    var config = stateApi.normalizeSonicTopographyConfig(options.config);
    var viewport = normalizeViewport(options.viewport);
    var mountRoot = host && typeof host.getRoot === 'function' ? host.getRoot() : scene;
    var group = null;
    var mesh = null;
    var geometry = null;
    var material = null;
    var profileKey = '';
    var fallbackCanvas = null;
    var fallbackContext = null;
    var unsubscribeContext = null;
    var directContextHandlers = null;
    var mounted = false;
    var enabled = false;
    var released = false;
    var destroyed = false;
    var contextLost = false;
    var backend = 'three';
    var rebuildCount = 0;
    var releaseCount = 0;
    var restoreCount = 0;
    var fallbackCount = 0;
    var lastSnapshot = state.snapshot();
    var lastColors = themeColors(null, config);

    function disposeThreeResources() {
      if (group && group.parent) group.parent.remove(group);
      if (geometry && typeof geometry.dispose === 'function') geometry.dispose();
      if (material && typeof material.dispose === 'function') material.dispose();
      group = null;
      mesh = null;
      geometry = null;
      material = null;
      profileKey = '';
    }

    function buildGeometry(tier) {
      var columns = tier.columns;
      var rows = tier.rows;
      var positions = new Float32Array(columns * rows * 3);
      var uvs = new Float32Array(columns * rows * 2);
      var indices = new Uint16Array((columns - 1) * (rows - 1) * 6);
      var positionIndex = 0;
      var uvIndex = 0;
      var indexIndex = 0;
      for (var row = 0; row < rows; row += 1) {
        var depth = rows <= 1 ? 0 : row / (rows - 1);
        for (var column = 0; column < columns; column += 1) {
          var across = columns <= 1 ? 0 : column / (columns - 1);
          positions[positionIndex++] = (across - 0.5) * 14.5;
          positions[positionIndex++] = -2.45;
          positions[positionIndex++] = 1.1 - depth * 18.5;
          uvs[uvIndex++] = across;
          uvs[uvIndex++] = depth;
        }
      }
      for (var y = 0; y < rows - 1; y += 1) {
        for (var x = 0; x < columns - 1; x += 1) {
          var topLeft = y * columns + x;
          var bottomLeft = topLeft + columns;
          indices[indexIndex++] = topLeft;
          indices[indexIndex++] = bottomLeft;
          indices[indexIndex++] = topLeft + 1;
          indices[indexIndex++] = topLeft + 1;
          indices[indexIndex++] = bottomLeft;
          indices[indexIndex++] = bottomLeft + 1;
        }
      }
      var next = new THREE.BufferGeometry();
      var positionAttribute = new THREE.BufferAttribute(positions, 3);
      if (positionAttribute.setUsage && THREE.DynamicDrawUsage != null) positionAttribute.setUsage(THREE.DynamicDrawUsage);
      next.setAttribute('position', positionAttribute);
      next.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      next.setIndex(new THREE.BufferAttribute(indices, 1));
      return next;
    }

    function buildMaterial(tier) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uPrimary: { value: new THREE.Color(lastColors.primary) },
          uSecondary: { value: new THREE.Color(lastColors.secondary) },
          uBackground: { value: new THREE.Color(lastColors.background) },
          uGrid: { value: { x: tier.columns - 1, y: tier.rows - 1 } },
          uOpacity: { value: config.opacity },
          uEnergy: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: vertexShader(),
        fragmentShader: fragmentShader(),
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
    }

    function ensureThreeResources(quality, reducedMotion) {
      if (destroyed || released || contextLost) return false;
      var tier = stateApi.resolveSonicQualityTier(quality, reducedMotion);
      var nextKey = tier.name + ':' + tier.columns + ':' + tier.rows;
      if (group && profileKey === nextKey) return false;
      disposeThreeResources();
      geometry = buildGeometry(tier);
      material = buildMaterial(tier);
      mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'MineradioSonicTerrain';
      mesh.frustumCulled = false;
      mesh.renderOrder = -24;
      group = new THREE.Group();
      group.name = 'MineradioSonicTopography';
      group.renderOrder = -24;
      group.visible = enabled;
      group.add(mesh);
      mountRoot.add(group);
      profileKey = nextKey;
      rebuildCount += 1;
      backend = 'three';
      return true;
    }

    function resizeFallback() {
      if (!fallbackCanvas) return;
      var width = Math.max(1, Math.round(viewport.width * viewport.dpr));
      var height = Math.max(1, Math.round(viewport.height * viewport.dpr));
      if (fallbackCanvas.width !== width) fallbackCanvas.width = width;
      if (fallbackCanvas.height !== height) fallbackCanvas.height = height;
      fallbackCanvas.style.width = viewport.width + 'px';
      fallbackCanvas.style.height = viewport.height + 'px';
      if (fallbackContext && typeof fallbackContext.setTransform === 'function') {
        fallbackContext.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      }
    }

    function ensureFallbackCanvas() {
      if (fallbackCanvas) {
        resizeFallback();
        return fallbackCanvas;
      }
      fallbackCanvas = createCanvas();
      fallbackCanvas.className = 'sonic-topography-fallback';
      fallbackCanvas.style.pointerEvents = 'none';
      fallbackCanvas.style.position = 'absolute';
      fallbackCanvas.style.inset = '0';
      fallbackContext = fallbackCanvas.getContext && fallbackCanvas.getContext('2d');
      resizeFallback();
      if (canvasRoot && typeof canvasRoot.appendChild === 'function') canvasRoot.appendChild(fallbackCanvas);
      fallbackCount += 1;
      return fallbackCanvas;
    }

    function removeFallbackCanvas() {
      if (!fallbackCanvas) return;
      if (fallbackContext && typeof fallbackContext.clearRect === 'function') {
        fallbackContext.clearRect(0, 0, viewport.width, viewport.height);
      }
      if (fallbackCanvas.parentNode) fallbackCanvas.parentNode.removeChild(fallbackCanvas);
      fallbackCanvas = null;
      fallbackContext = null;
    }

    function fallbackRgba(hex, alpha) {
      var value = parseInt(String(hex || '#ffffff').slice(1), 16);
      var red = value >> 16 & 255;
      var green = value >> 8 & 255;
      var blue = value & 255;
      return 'rgba(' + red + ',' + green + ',' + blue + ',' + alpha + ')';
    }

    function drawFallback(terrain, snapshot) {
      ensureFallbackCanvas();
      var context = fallbackContext;
      if (!context || !terrain.length) return false;
      var width = viewport.width;
      var height = viewport.height;
      var columns = snapshot.columns;
      var rows = snapshot.rows;
      context.clearRect(0, 0, width, height);
      if (context.save) context.save();
      context.lineWidth = Math.max(0.55, Math.min(1.5, viewport.dpr));
      context.globalCompositeOperation = 'lighter';
      for (var row = rows - 1; row >= 0; row -= 1) {
        var depth = rows <= 1 ? 0 : row / (rows - 1);
        var perspectiveWidth = width * (0.34 + (1 - depth) * 0.56);
        var left = (width - perspectiveWidth) * 0.5;
        var baseline = height * (0.47 + depth * 0.49);
        context.beginPath();
        for (var column = 0; column < columns; column += 1) {
          var across = columns <= 1 ? 0 : column / (columns - 1);
          var sample = terrain[row * columns + column] || 0;
          var x = left + across * perspectiveWidth;
          var y = baseline - sample * height * 0.16 * (1 - depth * 0.48);
          if (column === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = fallbackRgba(row % 3 === 0 ? lastColors.secondary : lastColors.primary, config.opacity * (0.08 + (1 - depth) * 0.38));
        context.stroke();
      }
      if (context.restore) context.restore();
      return true;
    }

    function updateThree(terrain, snapshot, frame) {
      ensureThreeResources(frame.quality, frame.reducedMotion);
      if (!geometry || !material || !group) return false;
      var position = geometry.getAttribute('position');
      if (!position || position.count !== terrain.length) return false;
      for (var index = 0; index < terrain.length; index += 1) {
        position.array[index * 3 + 1] = -2.45 + terrain[index] * 2.75;
      }
      position.needsUpdate = true;
      material.uniforms.uOpacity.value = config.opacity;
      material.uniforms.uEnergy.value = snapshot.energy;
      material.uniforms.uTime.value = snapshot.motionTime;
      material.uniforms.uPrimary.value.set(lastColors.primary);
      material.uniforms.uSecondary.value.set(lastColors.secondary);
      material.uniforms.uBackground.value.set(lastColors.background);
      group.visible = enabled;
      group.rotation.y = frame.reducedMotion ? 0 : Math.sin(snapshot.motionTime * 0.16) * 0.055;
      return true;
    }

    function onContextEvent(event) {
      var type = event && event.type || '';
      if (type === 'lost' || type === 'webglcontextlost') {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (contextLost) return;
        contextLost = true;
        backend = 'canvas2d';
        disposeThreeResources();
        if (!released && (enabled || config.enabled)) ensureFallbackCanvas();
        return;
      }
      if (type === 'restored' || type === 'webglcontextrestored') {
        if (!contextLost) return;
        contextLost = false;
        backend = 'three';
        restoreCount += 1;
        removeFallbackCanvas();
        if (mounted && !released && (enabled || config.enabled)) ensureThreeResources(lastSnapshot.quality, lastSnapshot.reducedMotion);
      }
    }

    function bindContextLifecycle() {
      if (unsubscribeContext || directContextHandlers) return;
      if (host && typeof host.subscribeContext === 'function') {
        unsubscribeContext = host.subscribeContext(onContextEvent);
        return;
      }
      var canvas = mainRenderer.domElement;
      if (!canvas || typeof canvas.addEventListener !== 'function') return;
      var lost = function(event) { onContextEvent(event); };
      var restored = function(event) { onContextEvent(event); };
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      directContextHandlers = { canvas: canvas, lost: lost, restored: restored };
    }

    function unbindContextLifecycle() {
      if (unsubscribeContext) unsubscribeContext();
      unsubscribeContext = null;
      if (directContextHandlers) {
        directContextHandlers.canvas.removeEventListener('webglcontextlost', directContextHandlers.lost);
        directContextHandlers.canvas.removeEventListener('webglcontextrestored', directContextHandlers.restored);
      }
      directContextHandlers = null;
    }

    function mount() {
      if (destroyed) return false;
      if (mounted) return false;
      mounted = true;
      released = false;
      bindContextLifecycle();
      if (config.enabled) ensureThreeResources('balanced', false);
      return true;
    }

    function update(frame) {
      if (destroyed || released) return false;
      if (!mounted) mount();
      frame = frame || {};
      if (frame.viewport) resize(frame.viewport);
      config = stateApi.normalizeSonicTopographyConfig(frame.config || config);
      var nextEnabled = config.enabled === true;
      lastColors = themeColors(frame, config);
      if (!nextEnabled) {
        if (enabled || group || fallbackCanvas) {
          state.release();
          lastSnapshot = state.snapshot();
          disposeThreeResources();
          removeFallbackCanvas();
        }
        enabled = false;
        return false;
      }
      if (!enabled && state.snapshot().released) state.restore();
      enabled = true;
      if (fallbackCanvas) fallbackCanvas.style.display = 'block';
      state.update({
        dt: frame.dt,
        playing: frame.playing,
        reducedMotion: frame.reducedMotion,
        quality: frame.quality,
        audio: frame.audio,
        config: config,
      });
      lastSnapshot = state.snapshot();
      var terrain = state.sampleTerrain();
      if (contextLost) return drawFallback(terrain, lastSnapshot);
      backend = 'three';
      return updateThree(terrain, lastSnapshot, frame);
    }

    function resize(nextViewport) {
      viewport = normalizeViewport(nextViewport);
      resizeFallback();
      return viewport;
    }

    function release() {
      if (destroyed || released) return false;
      released = true;
      releaseCount += 1;
      state.release();
      lastSnapshot = state.snapshot();
      disposeThreeResources();
      if (fallbackCanvas) {
        if (fallbackContext && fallbackContext.clearRect) fallbackContext.clearRect(0, 0, viewport.width, viewport.height);
        fallbackCanvas.width = 1;
        fallbackCanvas.height = 1;
        if (fallbackCanvas.parentNode) fallbackCanvas.parentNode.removeChild(fallbackCanvas);
      }
      fallbackCanvas = null;
      fallbackContext = null;
      return true;
    }

    function restore() {
      if (destroyed || !released) return false;
      released = false;
      state.restore();
      if (config.enabled && contextLost) ensureFallbackCanvas();
      else if (config.enabled) ensureThreeResources(lastSnapshot.quality || 'balanced', lastSnapshot.reducedMotion);
      return true;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      released = true;
      unbindContextLifecycle();
      state.release();
      disposeThreeResources();
      removeFallbackCanvas();
      mounted = false;
    }

    function snapshot() {
      var position = geometry && geometry.getAttribute && geometry.getAttribute('position');
      var stateSnapshot = state.snapshot();
      return {
        backend: contextLost ? 'canvas2d' : backend,
        mounted: mounted,
        enabled: enabled,
        released: released,
        destroyed: destroyed,
        contextLost: contextLost,
        usesHostRoot: mountRoot !== scene,
        width: viewport.width,
        height: viewport.height,
        dpr: viewport.dpr,
        vertices: position ? position.count : 0,
        canvases: fallbackCanvas && fallbackCanvas.parentNode ? 1 : 0,
        rebuildCount: rebuildCount,
        fallbackCount: fallbackCount,
        releaseCount: releaseCount,
        restoreCount: restoreCount,
        historyRows: stateSnapshot.historyRows,
        cacheEntries: stateSnapshot.cacheEntries,
        cacheBytes: stateSnapshot.cacheBytes,
        energy: stateSnapshot.energy,
        quality: stateSnapshot.quality,
      };
    }

    return {
      mount: mount,
      update: update,
      resize: resize,
      release: release,
      restore: restore,
      destroy: destroy,
      snapshot: snapshot,
    };
  }

  return {
    createSonicTopographyRenderer: createSonicTopographyRenderer,
  };
});
