(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricBlockPlane = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function createBlockPlane(options) {
    options = options || {};
    var THREE = options.THREE;
    var materialPool = options.materialPool;
    var parent = options.parent;
    if (!THREE || !THREE.MeshBasicMaterial || !THREE.Mesh) throw new Error('Block plane requires THREE');
    if (!materialPool || typeof materialPool.getBlockGeometry !== 'function') throw new Error('Block plane requires a material pool');
    if (!parent || typeof parent.add !== 'function') throw new Error('Block plane requires a parent');
    var width = Math.max(1, Math.round(Number(options.width) || 1024));
    var height = Math.max(1, Math.round(Number(options.height) || 256));
    var createCanvas = options.createCanvas || function() { return document.createElement('canvas'); };
    var createTexture = options.createTexture || function(canvas) { return new THREE.CanvasTexture(canvas); };
    var canvas = createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext && canvas.getContext('2d');
    if (!context) throw new Error('Block plane requires a 2D canvas context');
    var texture = createTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    var material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    var mesh = new THREE.Mesh(materialPool.getBlockGeometry(), material);
    mesh.renderOrder = Number(options.renderOrder) || 37;
    parent.add(mesh);
    var contentKey = '';
    var redraws = 0;
    var released = false;

    function setContent(key, draw) {
      if (released) return false;
      key = String(key == null ? '' : key);
      if (key === contentKey) return false;
      contentKey = key;
      if (typeof context.clearRect === 'function') context.clearRect(0, 0, width, height);
      if (typeof draw === 'function') draw(context, canvas);
      texture.needsUpdate = true;
      redraws += 1;
      return true;
    }

    function release() {
      if (released) return;
      released = true;
      if (mesh.parent) mesh.parent.remove(mesh);
      if (material && typeof material.dispose === 'function') material.dispose();
      if (texture && typeof texture.dispose === 'function') texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    }

    return {
      setContent: setContent,
      setVisible: function(value) { mesh.visible = !!value; },
      setOpacity: function(value) { material.opacity = Math.max(0, Math.min(1, Number(value) || 0)); },
      getMesh: function() { return mesh; },
      snapshot: function() {
        return {
          redraws: redraws,
          bytes: released ? 0 : width * height * 4,
          released: released,
        };
      },
      release: release,
    };
  }

  return {
    createBlockPlane: createBlockPlane,
  };
});
