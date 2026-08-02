/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioAudioOutputState = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function supportsSetSinkId(media) {
    return !!(media && typeof media.setSinkId === 'function');
  }

  var MEDIA_EVENT_HANDLER_KEYS = Object.freeze([
    'onabort',
    'oncanplay',
    'oncanplaythrough',
    'ondurationchange',
    'onemptied',
    'onended',
    'onerror',
    'onloadeddata',
    'onloadedmetadata',
    'onloadstart',
    'onpause',
    'onplay',
    'onplaying',
    'onprogress',
    'onratechange',
    'onseeked',
    'onseeking',
    'onstalled',
    'onsuspend',
    'ontimeupdate',
    'onvolumechange',
    'onwaiting',
  ]);

  function readMediaSource(media) {
    if (!media) return '';
    if (typeof media.getAttribute === 'function') {
      var attribute = media.getAttribute('src');
      if (attribute != null) return String(attribute);
    }
    return String(media.currentSrc || media.src || '');
  }

  function captureMediaElementState(media, options) {
    media = media || {};
    options = isRecord(options) ? options : {};
    var handlers = {};
    MEDIA_EVENT_HANDLER_KEYS.forEach(function(key) {
      handlers[key] = media[key] || null;
    });
    var identity = {};
    (Array.isArray(options.identityKeys) ? options.identityKeys : []).forEach(function(key) {
      identity[key] = media[key];
    });
    return {
      src: readMediaSource(media),
      currentTime: isFinite(Number(media.currentTime)) ? Number(media.currentTime) : 0,
      paused: media.paused !== false,
      volume: isFinite(Number(media.volume)) ? Number(media.volume) : 1,
      muted: !!media.muted,
      playbackRate: isFinite(Number(media.playbackRate)) ? Number(media.playbackRate) : 1,
      defaultPlaybackRate: isFinite(Number(media.defaultPlaybackRate))
        ? Number(media.defaultPlaybackRate)
        : 1,
      preload: String(media.preload || ''),
      crossOrigin: media.crossOrigin == null ? null : String(media.crossOrigin),
      loop: !!media.loop,
      autoplay: !!media.autoplay,
      handlers: handlers,
      identity: identity,
    };
  }

  function applyMediaElementState(media, state) {
    if (!media || !isRecord(state)) return media;
    try {
      if (typeof media.setAttribute === 'function') media.setAttribute('src', state.src || '');
      else media.src = state.src || '';
    } catch (_) {}
    try { media.preload = state.preload; } catch (_) {}
    try { media.crossOrigin = state.crossOrigin; } catch (_) {}
    try { media.loop = state.loop; } catch (_) {}
    try { media.autoplay = state.autoplay; } catch (_) {}
    try { media.volume = state.volume; } catch (_) {}
    try { media.muted = state.muted; } catch (_) {}
    try { media.defaultPlaybackRate = state.defaultPlaybackRate; } catch (_) {}
    try { media.playbackRate = state.playbackRate; } catch (_) {}
    try { media.paused = state.paused; } catch (_) {}
    Object.keys(state.handlers || {}).forEach(function(key) {
      try { media[key] = state.handlers[key]; } catch (_) {}
    });
    Object.keys(state.identity || {}).forEach(function(key) {
      try { media[key] = state.identity[key]; } catch (_) {}
    });
    function applyCurrentTime() {
      try { media.currentTime = state.currentTime; } catch (_) {}
    }
    applyCurrentTime();
    if (
      state.currentTime > 0
      && typeof media.addEventListener === 'function'
      && (!isFinite(Number(media.currentTime)) || Math.abs(Number(media.currentTime) - state.currentTime) > 0.05)
    ) {
      try { media.addEventListener('loadedmetadata', applyCurrentTime, { once: true }); } catch (_) {}
    }
    return media;
  }

  function transferMediaElementState(sourceMedia, targetMedia, options) {
    var state = captureMediaElementState(sourceMedia, options);
    applyMediaElementState(targetMedia, state);
    return state;
  }

  function normalizedDeviceId(value) {
    value = String(value == null ? '' : value).trim();
    return value === 'default' ? '' : value;
  }

  function normalizeAudioOutputDevices(devices) {
    var output = [{
      deviceId: '',
      label: '系统默认输出',
      isDefault: true,
    }];
    var seen = { '': true };
    (Array.isArray(devices) ? devices : []).forEach(function(device, index) {
      if (!isRecord(device)) return;
      if (device.kind && device.kind !== 'audiooutput') return;
      var deviceId = normalizedDeviceId(device.deviceId);
      if (!deviceId || seen[deviceId]) return;
      seen[deviceId] = true;
      output.push({
        deviceId: deviceId,
        label: String(device.label || ('音频输出 ' + (index + 1))),
        isDefault: false,
      });
    });
    return output;
  }

  function reconcileAudioOutputSelection(requestedId, devices) {
    requestedId = normalizedDeviceId(requestedId);
    var normalized = normalizeAudioOutputDevices(devices);
    var exists = !requestedId || normalized.some(function(device) {
      return device.deviceId === requestedId;
    });
    return {
      sinkId: exists ? requestedId : '',
      disappeared: !!requestedId && !exists,
      fallback: !!requestedId && !exists,
      devices: normalized,
    };
  }

  async function applyAudioOutputDevice(media, requestedId, devices) {
    if (!supportsSetSinkId(media)) {
      return {
        ok: false,
        supported: false,
        fallback: true,
        disappeared: false,
        sinkId: '',
        reason: 'unsupported',
      };
    }
    var selection = reconcileAudioOutputSelection(requestedId, devices);
    try {
      await media.setSinkId(selection.sinkId);
      return {
        ok: true,
        supported: true,
        fallback: selection.fallback,
        disappeared: selection.disappeared,
        sinkId: selection.sinkId,
        reason: selection.disappeared ? 'device-disappeared' : '',
      };
    } catch (error) {
      if (selection.sinkId) {
        try {
          await media.setSinkId('');
          return {
            ok: false,
            supported: true,
            fallback: true,
            disappeared: selection.disappeared,
            sinkId: '',
            reason: 'set-sink-failed',
            error: error,
          };
        } catch (_) {}
      }
      return {
        ok: false,
        supported: true,
        fallback: true,
        disappeared: selection.disappeared,
        sinkId: '',
        reason: 'set-sink-failed',
        error: error,
      };
    }
  }

  async function applyAuthoritativeAudioOutput(options) {
    options = isRecord(options) ? options : {};
    var context = options.context || null;
    var media = options.media || null;
    var graphActive = options.graphActive === true;
    var contextResult = await applyAudioOutputDevice(
      context,
      options.requestedId,
      options.devices
    );
    var mediaResult = await applyAudioOutputDevice(
      media,
      options.requestedId,
      options.devices
    );
    if (graphActive) {
      if (!contextResult.supported) {
        return {
          ok: false,
          supported: !!mediaResult.supported,
          fallback: true,
          disappeared: !!mediaResult.disappeared,
          sinkId: mediaResult.sinkId || '',
          reason: 'graph-output-unsupported',
          authoritativeTarget: 'context',
          contextResult: contextResult,
          mediaResult: mediaResult,
        };
      }
      return Object.assign({}, contextResult, {
        authoritativeTarget: 'context',
        contextResult: contextResult,
        mediaResult: mediaResult,
      });
    }
    var authoritative = mediaResult.supported ? mediaResult : contextResult;
    return Object.assign({}, authoritative, {
      authoritativeTarget: mediaResult.supported ? 'media' : 'context',
      contextResult: contextResult,
      mediaResult: mediaResult,
    });
  }

  function createAudioOutputArbiter(options) {
    options = isRecord(options) ? options : {};
    if (typeof options.apply !== 'function') {
      throw new TypeError('apply is required');
    }
    var generation = 0;
    var appliedGeneration = 0;
    var appliedSinkId = '';
    var applying = false;
    var pending = null;

    function staleResult(entry, reason) {
      return {
        ok: false,
        stale: true,
        generation: entry.generation,
        sinkId: entry.request.sinkId || '',
        reason: reason || 'superseded',
      };
    }

    async function drain() {
      if (applying) return;
      applying = true;
      while (pending) {
        var entry = pending;
        pending = null;
        var result;
        try {
          result = await options.apply(entry.request, {
            generation: entry.generation,
            isCurrent: function() {
              return entry.generation === generation;
            },
          });
        } catch (error) {
          result = {
            ok: false,
            sinkId: entry.request.sinkId || '',
            reason: 'apply-failed',
            error: error,
          };
        }
        var stale = entry.generation !== generation;
        if (!stale && result && result.ok) {
          appliedGeneration = entry.generation;
          appliedSinkId = String(result.sinkId == null ? entry.request.sinkId || '' : result.sinkId);
        }
        entry.resolve(Object.assign({}, result || {}, {
          generation: entry.generation,
          stale: stale,
        }));
      }
      applying = false;
    }

    function request(requestValue) {
      var requestRecord = isRecord(requestValue)
        ? Object.assign({}, requestValue)
        : { sinkId: normalizedDeviceId(requestValue) };
      requestRecord.sinkId = normalizedDeviceId(requestRecord.sinkId);
      var entry = {
        generation: ++generation,
        request: requestRecord,
        resolve: null,
      };
      var promise = new Promise(function(resolve) {
        entry.resolve = resolve;
      });
      if (pending) pending.resolve(staleResult(pending));
      pending = entry;
      drain();
      return promise;
    }

    function snapshot() {
      return {
        applying: applying,
        appliedGeneration: appliedGeneration,
        appliedSinkId: appliedSinkId,
        generation: generation,
        pendingSinkId: pending ? pending.request.sinkId : '',
      };
    }

    return Object.freeze({
      request: request,
      snapshot: snapshot,
    });
  }

  function createAudioGraphRuntime(options) {
    options = isRecord(options) ? options : {};
    if (typeof options.createContext !== 'function') {
      throw new TypeError('createContext is required');
    }
    var context = null;
    var analyser = null;
    var beatAnalyser = null;
    var gainNode = null;
    var sources = new Map();
    var boundMedia = typeof WeakSet === 'function' ? new WeakSet() : new Set();
    var replacements = typeof WeakMap === 'function' ? new WeakMap() : new Map();
    var generation = 0;

    function disconnectNode(node) {
      if (!node || typeof node.disconnect !== 'function') return;
      try { node.disconnect(); } catch (_) {}
    }

    function clearGraph() {
      sources.forEach(function(record) {
        disconnectNode(record.source);
      });
      sources.clear();
      disconnectNode(analyser);
      disconnectNode(beatAnalyser);
      disconnectNode(gainNode);
      analyser = null;
      beatAnalyser = null;
      gainNode = null;
    }

    function buildGraph() {
      context = options.createContext();
      if (!context) throw new Error('AudioContext is unavailable');
      analyser = context.createAnalyser();
      beatAnalyser = context.createAnalyser();
      gainNode = context.createGain();
      if (typeof options.configure === 'function') {
        options.configure({
          context: context,
          analyser: analyser,
          beatAnalyser: beatAnalyser,
          gainNode: gainNode,
        });
      }
      analyser.connect(gainNode);
      gainNode.connect(context.destination);
      generation += 1;
    }

    function activeMedia(media) {
      var current = media;
      var seen = [];
      while (current && replacements.has(current) && seen.indexOf(current) < 0) {
        seen.push(current);
        current = replacements.get(current);
      }
      return current || media;
    }

    async function replaceBoundMedia(media, reason) {
      if (typeof options.replaceMedia !== 'function') {
        var replacementError = new Error('Previously-bound media requires replacement');
        replacementError.code = 'AUDIO_MEDIA_REPLACEMENT_REQUIRED';
        replacementError.reason = reason || 'already-bound';
        replacementError.media = media;
        throw replacementError;
      }
      var result = await options.replaceMedia(media, {
        reason: reason || 'already-bound',
        context: context,
        generation: generation,
      });
      var replacement = isRecord(result) && result.media ? result.media : result;
      if (!replacement || replacement === media) {
        throw new Error('replaceMedia must return a different media element');
      }
      replacements.set(media, replacement);
      return {
        media: replacement,
        state: isRecord(result) && result.media ? (result.state || null) : null,
      };
    }

    async function ensure(media) {
      if (!media) throw new TypeError('media is required');
      var requestedMedia = media;
      media = activeMedia(media);
      var replacedMedia = media !== requestedMedia ? requestedMedia : null;
      var replacementState = null;
      var createdContext = false;
      if (!context || context.state === 'closed') {
        clearGraph();
        buildGraph();
        createdContext = true;
      }
      if ((context.state === 'suspended' || context.state === 'interrupted')
        && typeof context.resume === 'function') {
        await context.resume();
      }
      var record = sources.get(media);
      var reconnected = false;
      if (!record) {
        if (boundMedia.has(media)) {
          var replacementResult = await replaceBoundMedia(media, createdContext ? 'context-closed' : 'already-bound');
          replacedMedia = media;
          media = replacementResult.media;
          replacementState = replacementResult.state;
        }
        record = {
          source: context.createMediaElementSource(media),
          connected: false,
        };
        boundMedia.add(media);
        sources.set(media, record);
      }
      if (!record.connected) {
        record.source.connect(analyser);
        record.source.connect(beatAnalyser);
        record.connected = true;
        reconnected = !createdContext && record.source != null;
      }
      return {
        context: context,
        source: record.source,
        analyser: analyser,
        beatAnalyser: beatAnalyser,
        gainNode: gainNode,
        media: media,
        replacedMedia: replacedMedia,
        replacementState: replacementState,
        createdContext: createdContext,
        reconnected: reconnected,
        generation: generation,
      };
    }

    function markInterrupted(media) {
      media = activeMedia(media);
      var record = sources.get(media);
      if (!record || !record.connected) return false;
      disconnectNode(record.source);
      record.connected = false;
      return true;
    }

    function release(media) {
      media = activeMedia(media);
      var record = sources.get(media);
      if (!record) return false;
      disconnectNode(record.source);
      sources.delete(media);
      return true;
    }

    function discardReplacement(originalMedia, replacementMedia) {
      if (!originalMedia || !replacementMedia || replacements.get(originalMedia) !== replacementMedia) {
        return false;
      }
      var record = sources.get(replacementMedia);
      if (record) {
        disconnectNode(record.source);
        sources.delete(replacementMedia);
      }
      replacements.delete(originalMedia);
      return true;
    }

    function releaseAll() {
      clearGraph();
      context = null;
    }

    function snapshot() {
      return {
        context: context,
        analyser: analyser,
        beatAnalyser: beatAnalyser,
        gainNode: gainNode,
        generation: generation,
        mediaCount: sources.size,
      };
    }

    return Object.freeze({
      discardReplacement: discardReplacement,
      ensure: ensure,
      markInterrupted: markInterrupted,
      release: release,
      releaseAll: releaseAll,
      snapshot: snapshot,
    });
  }

  return {
    applyAuthoritativeAudioOutput: applyAuthoritativeAudioOutput,
    applyAudioOutputDevice: applyAudioOutputDevice,
    applyMediaElementState: applyMediaElementState,
    captureMediaElementState: captureMediaElementState,
    createAudioOutputArbiter: createAudioOutputArbiter,
    createAudioGraphRuntime: createAudioGraphRuntime,
    normalizeAudioOutputDevices: normalizeAudioOutputDevices,
    reconcileAudioOutputSelection: reconcileAudioOutputSelection,
    supportsSetSinkId: supportsSetSinkId,
    transferMediaElementState: transferMediaElementState,
  };
});
