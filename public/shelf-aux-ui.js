(function(root) {
'use strict';

var RECORD_TOOLBAR_LAYOUTS = {
  horizontal: {
    name: 'horizontal',
    canvasW: 140,
    canvasH: 78,
    worldW: 0.56,
    worldH: 0.30,
    shell: { x: 8, y: 8, w: 124, h: 62, r: 24 },
    actions: [
      { key: 'back', label: '返回', x: 19, y: 16, w: 102, h: 46 },
    ]
  },
  vertical: {
    name: 'vertical',
    canvasW: 124,
    canvasH: 76,
    worldW: 0.48,
    worldH: 0.30,
    shell: { x: 8, y: 8, w: 108, h: 60, r: 22 },
    actions: [
      { key: 'back', label: '返回', x: 14, y: 14, w: 96, h: 48 },
    ]
  }
};

function cloneAction(action) {
  var out = {};
  Object.keys(action || {}).forEach(function(key) { out[key] = action[key]; });
  return out;
}
function cloneSpec(spec) {
  var out = {};
  Object.keys(spec || {}).forEach(function(key) {
    if (key === 'actions') return;
    var value = spec[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      var nested = {};
      Object.keys(value).forEach(function(nestedKey) { nested[nestedKey] = value[nestedKey]; });
      out[key] = nested;
    } else {
      out[key] = value;
    }
  });
  out.actions = (spec.actions || []).map(cloneAction);
  return out;
}
function getRecordToolbarLayouts() {
  return {
    horizontal: cloneSpec(RECORD_TOOLBAR_LAYOUTS.horizontal),
    vertical: cloneSpec(RECORD_TOOLBAR_LAYOUTS.vertical),
  };
}

root.MineradioShelfAuxUi = {
  getRecordToolbarLayouts: getRecordToolbarLayouts,
};
if (typeof window !== 'undefined') window.MineradioShelfAuxUi = root.MineradioShelfAuxUi;
})(typeof window !== 'undefined' ? window : globalThis);
