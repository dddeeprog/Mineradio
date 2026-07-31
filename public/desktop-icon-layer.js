/**
 * Bounded visual desktop icon layer for Mineradio wallpaper surfaces.
 * Inspired by XxHuberrr/Mineradio complete-desktop icon behavior at
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * It owns DOM presentation only and never reads shell items or filesystem data.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioDesktopIconLayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MAX_DESKTOP_ICONS = 12;
  var SAFE_ACTIONS = ['focus-player', 'open-library', 'open-playlists', 'open-settings'];
  var GLYPHS = {
    play: '\u25b6',
    music: '\u266b',
    list: '\u2637',
    settings: '\u2699',
  };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function safeText(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalizeBounds(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      x: Math.round(Math.max(0, finite(value.x, 0))),
      y: Math.round(Math.max(0, finite(value.y, 0))),
      width: Math.round(Math.max(44, Math.min(160, finite(value.width, 94)))),
      height: Math.round(Math.max(54, Math.min(160, finite(value.height, 102)))),
    };
  }

  function normalizeLayout(value) {
    value = value && typeof value === 'object' ? value : {};
    var seen = Object.create(null);
    var items = [];
    (Array.isArray(value.items) ? value.items : []).slice(0, MAX_DESKTOP_ICONS).forEach(function(item) {
      item = item && typeof item === 'object' ? item : {};
      var id = safeText(item.id, 32).toLowerCase();
      var action = safeText(item.action, 32).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || seen[id] || SAFE_ACTIONS.indexOf(action) < 0) return;
      seen[id] = true;
      items.push({
        id: id,
        action: action,
        label: safeText(item.label || id, 32),
        glyph: GLYPHS[item.glyph] || GLYPHS.music,
        bounds: normalizeBounds(item.bounds),
      });
    });
    return {
      visible: value.visible !== false,
      locked: value.locked === true,
      items: items,
    };
  }

  function hitTestIconLayout(layout, point) {
    layout = normalizeLayout(layout);
    if (!layout.visible || layout.locked) return null;
    var x = finite(point && point.x, NaN);
    var y = finite(point && point.y, NaN);
    if (!isFinite(x) || !isFinite(y)) return null;
    for (var index = layout.items.length - 1; index >= 0; index -= 1) {
      var item = layout.items[index];
      var bounds = item.bounds;
      if (x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height) {
        return { id: item.id, action: item.action, label: item.label };
      }
    }
    return null;
  }

  function createDesktopIconLayer(options) {
    options = options || {};
    var rootElement = options.root;
    if (!rootElement || typeof rootElement.appendChild !== 'function') throw new Error('DESKTOP_ICON_ROOT_REQUIRED');
    var onAction = typeof options.onAction === 'function' ? options.onAction : function() {};
    var nodes = Object.create(null);
    var layout = normalizeLayout({ visible: false, items: [] });
    var destroyed = false;

    function removeNode(id) {
      var node = nodes[id];
      if (!node) return;
      if (node.parentNode) node.parentNode.removeChild(node);
      delete nodes[id];
    }

    function createNode(item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'desktop-icon-item';
      button.dataset.desktopIconId = item.id;
      var glyph = document.createElement('span');
      glyph.className = 'desktop-icon-glyph';
      var label = document.createElement('span');
      label.className = 'desktop-icon-label';
      button.appendChild(glyph);
      button.appendChild(label);
      button.addEventListener('click', function(event) {
        if (layout.locked || !layout.visible) {
          event.preventDefault();
          return;
        }
        var current = layout.items.find(function(entry) { return entry.id === item.id; });
        if (current) onAction({ id: current.id, action: current.action, label: current.label });
      });
      rootElement.appendChild(button);
      nodes[item.id] = button;
      return button;
    }

    function update(nextLayout) {
      if (destroyed) return false;
      layout = normalizeLayout(nextLayout);
      var retained = Object.create(null);
      layout.items.forEach(function(item) {
        retained[item.id] = true;
        var node = nodes[item.id] || createNode(item);
        node.style.left = item.bounds.x + 'px';
        node.style.top = item.bounds.y + 'px';
        node.style.width = item.bounds.width + 'px';
        node.style.height = item.bounds.height + 'px';
        node.dataset.action = item.action;
        node.title = item.label;
        node.querySelector('.desktop-icon-glyph').textContent = item.glyph;
        node.querySelector('.desktop-icon-label').textContent = item.label;
        node.tabIndex = layout.locked ? -1 : 0;
        node.disabled = layout.locked;
      });
      Object.keys(nodes).forEach(function(id) {
        if (!retained[id]) removeNode(id);
      });
      rootElement.classList.toggle('is-visible', layout.visible && layout.items.length > 0);
      rootElement.classList.toggle('is-locked', layout.locked);
      rootElement.setAttribute('aria-hidden', layout.visible && !layout.locked ? 'false' : 'true');
      return true;
    }

    function release() {
      if (destroyed) return false;
      Object.keys(nodes).forEach(removeNode);
      layout = normalizeLayout({ visible: false, items: [] });
      rootElement.classList.remove('is-visible', 'is-locked');
      rootElement.setAttribute('aria-hidden', 'true');
      return true;
    }

    function destroy() {
      if (destroyed) return false;
      release();
      destroyed = true;
      return true;
    }

    function snapshot() {
      return {
        visible: layout.visible,
        locked: layout.locked,
        items: layout.items.length,
        destroyed: destroyed,
      };
    }

    return {
      update: update,
      release: release,
      destroy: destroy,
      hitTest: function(point) { return hitTestIconLayout(layout, point); },
      snapshot: snapshot,
    };
  }

  return {
    MAX_DESKTOP_ICONS: MAX_DESKTOP_ICONS,
    createDesktopIconLayer: createDesktopIconLayer,
    hitTestIconLayout: hitTestIconLayout,
    normalizeLayout: normalizeLayout,
  };
});
