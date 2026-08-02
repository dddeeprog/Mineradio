(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioWeatherLivelyVisuals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_SOUND = {
    enabled: false,
    volume: 0.24,
    followWeather: true,
    duckWhenMusicPlays: true,
  };

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeWeatherSoundSettings(input) {
    input = input || {};
    return {
      enabled: input.enabled === true,
      volume: clamp(finiteNumber(input.volume, DEFAULT_SOUND.volume), 0, 1),
      followWeather: input.followWeather !== false,
      duckWhenMusicPlays: input.duckWhenMusicPlays !== false,
    };
  }

  function effectiveWeatherAmbientVolume(settings, state) {
    settings = normalizeWeatherSoundSettings(settings);
    state = state || {};
    if (!settings.enabled) return 0;
    var volume = settings.volume;
    if (settings.duckWhenMusicPlays && state.musicPlaying) volume *= 0.32;
    return Math.round(clamp(volume, 0, 1) * 100) / 100;
  }

  function weatherAmbientPatchForProfile(profile) {
    var kind = String(profile && profile.kind || 'clear');
    if (kind === 'rain') return { kind: 'rain', frequency: 420, noise: 0.72 };
    if (kind === 'snow') return { kind: 'snow', frequency: 260, noise: 0.18 };
    if (kind === 'fog') return { kind: 'fog', frequency: 180, noise: 0.28 };
    if (kind === 'storm') return { kind: 'storm', frequency: 110, noise: 0.86 };
    if (kind === 'cloud') return { kind: 'cloud', frequency: 320, noise: 0.20 };
    return { kind: 'clear', frequency: 520, noise: 0.08 };
  }

  function initWeatherVisuals(context) {
    context = context || {};
    var doc = context.document || (typeof document !== 'undefined' ? document : null);
    var root = context.root || null;
    var reducedMotion = false;
    var profile = { kind: 'clear', daylight: 'day', visualClass: 'weather-lively-visual-clear-day', layers: [] };
    var settings = normalizeWeatherSoundSettings(context.sound);
    var audio = null;

    function weatherRoot() {
      if (root) return root;
      root = doc && doc.getElementById ? doc.getElementById('home-weather-scene') : null;
      return root;
    }

    function ensureLayer(parent, type) {
      if (!parent || !doc) return null;
      var selector = '.weather-lively-layer-' + type;
      var el = parent.querySelector(selector);
      if (!el) {
        el = doc.createElement('span');
        el.className = 'weather-lively-layer weather-lively-layer-' + type;
        el.setAttribute('aria-hidden', 'true');
        parent.appendChild(el);
      }
      return el;
    }

    function renderLayers(nextProfile) {
      var parent = weatherRoot();
      if (!parent) return;
      var layers = Array.isArray(nextProfile.layers) ? nextProfile.layers : [];
      parent.querySelectorAll('.weather-lively-layer').forEach(function(el) {
        el.setAttribute('data-stale', 'true');
      });
      layers.forEach(function(layer) {
        var el = ensureLayer(parent, layer.type || 'glow');
        if (!el) return;
        el.removeAttribute('data-stale');
        el.style.setProperty('--weather-layer-intensity', String(layer.intensity == null ? 0.5 : layer.intensity));
        el.classList.toggle('is-static', layer.animated === false || reducedMotion);
      });
      parent.querySelectorAll('.weather-lively-layer[data-stale="true"]').forEach(function(el) {
        el.remove();
      });
    }

    function applyWeatherVisualProfile(nextProfile) {
      profile = nextProfile || profile;
      var parent = weatherRoot();
      if (parent) {
        Array.prototype.slice.call(parent.classList).forEach(function(name) {
          if (name.indexOf('weather-lively-visual-') === 0) parent.classList.remove(name);
        });
        parent.classList.add(profile.visualClass || ('weather-lively-visual-' + (profile.kind || 'clear') + '-' + (profile.daylight || 'day')));
        parent.classList.toggle('weather-lively-reduced-motion', reducedMotion || profile.reducedMotion === true);
        parent.dataset.weatherVisualKind = String(profile.kind || 'clear');
      }
      renderLayers(profile);
      updateAmbientPlayback({ musicPlaying: context.isMusicPlaying && context.isMusicPlaying() });
      return profile;
    }

    function setWeatherVisualReducedMotion(enabled) {
      reducedMotion = enabled === true;
      applyWeatherVisualProfile(profile);
      return reducedMotion;
    }

    function createAudioGraph() {
      if (audio || typeof AudioContext === 'undefined') return audio;
      var ctx = new AudioContext();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      audio = { ctx: ctx, osc: osc, gain: gain };
      return audio;
    }

    function updateAmbientPlayback(state) {
      var targetVolume = effectiveWeatherAmbientVolume(settings, state);
      if (!targetVolume) {
        if (audio && audio.gain) audio.gain.gain.value = 0;
        return 0;
      }
      var patch = weatherAmbientPatchForProfile(profile);
      var graph = createAudioGraph();
      if (!graph) return 0;
      graph.osc.frequency.value = patch.frequency;
      graph.gain.gain.value = targetVolume * Math.max(0.04, patch.noise);
      return graph.gain.gain.value;
    }

    function setWeatherAmbientSettings(next) {
      settings = normalizeWeatherSoundSettings(Object.assign({}, settings, next || {}));
      updateAmbientPlayback({ musicPlaying: context.isMusicPlaying && context.isMusicPlaying() });
      return settings;
    }

    function disposeWeatherVisuals() {
      var parent = weatherRoot();
      if (parent) {
        parent.querySelectorAll('.weather-lively-layer').forEach(function(el) { el.remove(); });
      }
      if (audio) {
        try { audio.osc.stop(); } catch (e) {}
        try { audio.ctx.close(); } catch (e2) {}
        audio = null;
      }
    }

    return {
      applyWeatherVisualProfile: applyWeatherVisualProfile,
      setWeatherVisualReducedMotion: setWeatherVisualReducedMotion,
      setWeatherAmbientSettings: setWeatherAmbientSettings,
      updateAmbientPlayback: updateAmbientPlayback,
      disposeWeatherVisuals: disposeWeatherVisuals,
    };
  }

  var singleton = null;

  function singletonVisuals() {
    if (!singleton) singleton = initWeatherVisuals({});
    return singleton;
  }

  function applyWeatherVisualProfile(profile) {
    return singletonVisuals().applyWeatherVisualProfile(profile);
  }

  function setWeatherVisualReducedMotion(enabled) {
    return singletonVisuals().setWeatherVisualReducedMotion(enabled);
  }

  function disposeWeatherVisuals() {
    if (!singleton) return;
    singleton.disposeWeatherVisuals();
    singleton = null;
  }

  return {
    applyWeatherVisualProfile: applyWeatherVisualProfile,
    disposeWeatherVisuals: disposeWeatherVisuals,
    effectiveWeatherAmbientVolume: effectiveWeatherAmbientVolume,
    initWeatherVisuals: initWeatherVisuals,
    normalizeWeatherSoundSettings: normalizeWeatherSoundSettings,
    setWeatherVisualReducedMotion: setWeatherVisualReducedMotion,
    weatherAmbientPatchForProfile: weatherAmbientPatchForProfile,
  };
});
