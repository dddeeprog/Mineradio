(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioWeatherLivelyUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function clampPercent(value, fallback) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback == null ? 0 : fallback;
    return Math.max(0, Math.min(100, n));
  }

  function createWeatherLivelyUi(context) {
    context = context || {};
    var doc = context.document || (typeof document !== 'undefined' ? document : null);
    var visuals = context.visuals || null;

    function qs(selector) {
      return doc && doc.querySelector ? doc.querySelector(selector) : null;
    }

    function qsa(selector) {
      return doc && doc.querySelectorAll ? Array.prototype.slice.call(doc.querySelectorAll(selector)) : [];
    }

    function decorateDashboard(state) {
      state = state || {};
      var dashboard = qs('.home-weather-dashboard');
      var graph = qs('#home-weather-curve');
      var curveCard = qs('.home-weather-curve-card');
      var daily = qs('#home-weather-daily');
      var metrics = qs('#home-weather-metrics');
      if (dashboard) dashboard.classList.add('weather-lively-dashboard');
      if (graph) graph.classList.add('weather-lively-graph');
      if (curveCard) curveCard.classList.add('weather-lively-panel');
      if (daily) daily.classList.add('weather-lively-daily');
      if (metrics) metrics.classList.add('weather-lively-metrics');
      qsa('.home-weather-day').forEach(function(el) { el.classList.add('weather-lively-day'); });
      qsa('.home-weather-metric').forEach(function(el) { el.classList.add('weather-lively-metric'); });
      if (dashboard && state.fields && state.fields.accent) dashboard.style.setProperty('--weather-lively-accent', state.fields.accent);
      return !!dashboard;
    }

    function syncGraphModel(curve, opts) {
      curve = curve || {};
      opts = opts || {};
      var graph = qs('#home-weather-curve');
      if (!graph) return null;
      var selected = opts.selectedPoint || curve.selectedPoint || null;
      graph.classList.add('weather-lively-graph');
      graph.dataset.metricKey = String(curve.metricKey || opts.metricKey || 'temperature');
      graph.dataset.scopeLabel = String(curve.scopeLabel || '未来 12 小时');
      graph.style.setProperty('--weather-lively-selected-x', clampPercent(selected && selected.x, 0) + '%');
      graph.style.setProperty('--weather-lively-baseline', clampPercent(curve.baselineY, 82) + '%');
      graph.toggleAttribute('data-has-selection', !!selected);
      return {
        metricKey: graph.dataset.metricKey,
        scopeLabel: graph.dataset.scopeLabel,
        selectedX: graph.style.getPropertyValue('--weather-lively-selected-x'),
      };
    }

    function syncMetricCards() {
      qsa('.home-weather-metric').forEach(function(el) { el.classList.add('weather-lively-metric'); });
    }

    function fallbackLayers(kind) {
      if (kind === 'rain') return [{ type: 'mist', intensity: 0.32 }, { type: 'rain', intensity: 0.74 }];
      if (kind === 'snow') return [{ type: 'glow', intensity: 0.24 }, { type: 'snow', intensity: 0.58 }];
      if (kind === 'fog') return [{ type: 'mist', intensity: 0.74 }, { type: 'haze', intensity: 0.46 }];
      if (kind === 'storm') return [{ type: 'rain', intensity: 0.68 }, { type: 'flash', intensity: 0.42 }];
      if (kind === 'cloud') return [{ type: 'mist', intensity: 0.40 }, { type: 'cloud', intensity: 0.52 }];
      return [{ type: 'glow', intensity: 0.38 }, { type: 'particles', intensity: 0.22 }];
    }

    function syncWeatherVisual(scene) {
      scene = scene || {};
      if (!visuals && typeof MineradioWeatherLivelyVisuals !== 'undefined' && MineradioWeatherLivelyVisuals.initWeatherVisuals) {
        visuals = MineradioWeatherLivelyVisuals.initWeatherVisuals({ document: doc, root: qs('#home-weather-scene') });
      }
      var profile = scene.visualProfile || {
        key: scene.key || 'clear-day',
        kind: scene.base || 'clear',
        daylight: scene.daylight || 'day',
        visualClass: 'weather-lively-visual-' + (scene.base || 'clear') + '-' + (scene.daylight || 'day'),
        layers: scene.layers || fallbackLayers(scene.base || 'clear'),
        ambient: { kind: scene.base || 'clear', defaultEnabled: false },
      };
      if (visuals && typeof visuals.applyWeatherVisualProfile === 'function') return visuals.applyWeatherVisualProfile(profile);
      return profile;
    }

    return {
      decorateDashboard: decorateDashboard,
      syncGraphModel: syncGraphModel,
      syncMetricCards: syncMetricCards,
      syncWeatherVisual: syncWeatherVisual,
    };
  }

  return {
    init: createWeatherLivelyUi,
  };
});
