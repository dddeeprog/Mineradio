(function(root, factory) {
  var shared = root && root.MineradioNativeLyricSharedDom;
  if (typeof module === 'object' && module.exports) shared = require('./shared-dom');
  var api = factory(shared);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricTilt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(shared) {
  'use strict';
  return { createTiltRenderer: function(context) { return shared.createDomRenderer('tilt', context); } };
});
