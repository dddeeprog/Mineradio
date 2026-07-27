(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricMineradio3D = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function createMineradio3DRenderer(options) {
    options = options || {};
    var document = null;
    var released = false;

    return {
      kind: 'three',
      mount: function() {
        released = false;
        if (typeof options.setVisible === 'function') options.setVisible(true);
      },
      setDocument: function(nextDocument) {
        document = nextDocument || null;
      },
      update: function(frame) {
        if (!released && typeof options.update === 'function') options.update(frame, document);
      },
      resize: function(viewport) {
        if (typeof options.resize === 'function') options.resize(viewport);
      },
      release: function(reason) {
        released = true;
        if (typeof options.setVisible === 'function') options.setVisible(false);
        if (typeof options.clear === 'function') options.clear(reason);
      },
      resume: function() {
        released = false;
        if (typeof options.setVisible === 'function') options.setVisible(true);
      },
      destroy: function() {
        document = null;
        if (typeof options.setVisible === 'function') options.setVisible(false);
      },
      captureTransition: function() {
        return typeof options.captureTransition === 'function' ? options.captureTransition() : null;
      },
      snapshot: function() {
        var snapshot = typeof options.snapshot === 'function' ? options.snapshot() || {} : {};
        return Object.assign({ domNodes: 0, canvases: 0, cacheEntries: 0, cacheBytes: 0 }, snapshot);
      },
    };
  }

  return {
    createMineradio3DRenderer: createMineradio3DRenderer,
  };
});
