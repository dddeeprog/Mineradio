/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioGaplessPlaybackState = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var MIN_CROSSFADE_MS = 80;
  var MAX_CROSSFADE_MS = 1200;
  var DEFAULT_CROSSFADE_MS = 420;

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clamp(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }

  function shouldUseCrossfade(options) {
    options = isRecord(options) ? options : {};
    return !(
      options.seek === true
      || options.manualRetry === true
      || options.supportedStream === false
      || options.localAnalysis === true
      || options.reducedResource === true
    );
  }

  function boundedCrossfadeMs(value) {
    if (value == null || value === '') value = DEFAULT_CROSSFADE_MS;
    return Math.round(clamp(value, MIN_CROSSFADE_MS, MAX_CROSSFADE_MS));
  }

  function equalPowerCrossfade(progress) {
    progress = clamp(progress, 0, 1);
    if (progress <= 0) return { outgoing: 1, incoming: 0 };
    if (progress >= 1) return { outgoing: 0, incoming: 1 };
    var angle = progress * Math.PI * 0.5;
    return {
      outgoing: Math.cos(angle),
      incoming: Math.sin(angle),
    };
  }

  function explicitStreamSupport(value) {
    if (value === true || value === false) return value;
    if (typeof value !== 'string') return null;
    var normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'supported') return true;
    if (normalized === 'false' || normalized === 'unsupported') return false;
    return null;
  }

  function streamMimeType(resolved) {
    var data = isRecord(resolved.data) ? resolved.data : {};
    var value = resolved.mimeType
      || resolved.contentType
      || data.mimeType
      || data.mime_type
      || data.contentType
      || data.content_type
      || '';
    value = String(value).split(';')[0].trim().toLowerCase();
    if (value) return value;
    var format = String(
      resolved.format
      || data.format
      || data.encodeType
      || data.encode_type
      || ''
    ).trim().toLowerCase();
    var byFormat = {
      aac: 'audio/aac',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      mp3: 'audio/mpeg',
      oga: 'audio/ogg',
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      wav: 'audio/wav',
      webm: 'audio/webm',
    };
    return byFormat[format] || '';
  }

  function decodedStreamUrl(resolved) {
    var data = isRecord(resolved.data) ? resolved.data : {};
    var value = resolved.sourceUrl || data.url || resolved.mediaUrl || '';
    value = String(value).trim().toLowerCase();
    try { value = decodeURIComponent(value); } catch (_) {}
    return value;
  }

  function inferStreamSupport(resolved, media) {
    resolved = isRecord(resolved) ? resolved : {};
    var data = isRecord(resolved.data) ? resolved.data : {};
    var explicitValues = [
      resolved.streamSupported,
      resolved.supportedStream,
      data.streamSupported,
      data.supportedStream,
    ];
    for (var index = 0; index < explicitValues.length; index++) {
      var explicit = explicitStreamSupport(explicitValues[index]);
      if (explicit !== null) return explicit;
    }
    if (
      resolved.live === true
      || resolved.isLive === true
      || data.live === true
      || data.isLive === true
    ) return false;

    var mimeType = streamMimeType(resolved);
    if (
      mimeType === 'application/dash+xml'
      || mimeType === 'application/vnd.apple.mpegurl'
      || mimeType === 'application/x-mpegurl'
    ) return false;
    if (mimeType) {
      if (media && typeof media.canPlayType === 'function') {
        return !!media.canPlayType(mimeType);
      }
      return /^(audio\/(?:aac|flac|mp4|mpeg|ogg|opus|wav|wave|webm|x-m4a|x-wav))$/.test(mimeType);
    }

    var url = decodedStreamUrl(resolved);
    if (!url) return false;
    if (/\.(?:m3u8|mpd)(?:$|[?#])/.test(url)) return false;
    return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)(?:$|[?#])/.test(url);
  }

  function defaultRelease(media) {
    if (!media) return;
    try { media.pause(); } catch (_) {}
    try { media.removeAttribute('src'); } catch (_) {}
    try { media.load(); } catch (_) {}
  }

  function createGaplessPlaybackCoordinator(options) {
    options = isRecord(options) ? options : {};
    if (typeof options.createMedia !== 'function') {
      throw new TypeError('createMedia is required');
    }
    var prepare = typeof options.prepare === 'function'
      ? options.prepare
      : function() { return Promise.resolve(true); };
    var crossfade = typeof options.crossfade === 'function'
      ? options.crossfade
      : null;
    var releaseMedia = typeof options.release === 'function'
      ? options.release
      : defaultRelease;
    var current = null;
    var standby = null;
    var inFlightHandoff = null;
    var deferredOutgoing = null;
    var serial = 0;

    function releaseRecord(record, reason) {
      if (!record || record.released) return;
      record.released = true;
      releaseMedia(record.media, reason || 'released');
    }

    function cancel(reason) {
      serial += 1;
      var cancelled = false;
      if (inFlightHandoff) {
        var operation = inFlightHandoff;
        inFlightHandoff = null;
        operation.cancelled = true;
        operation.cancelReason = reason || 'cancelled';
        operation.resolveCancellation();
        current = operation.outgoing;
        releaseRecord(operation.record, operation.cancelReason);
        cancelled = true;
      }
      if (standby) {
        var record = standby;
        standby = null;
        releaseRecord(record, reason || 'cancelled');
        cancelled = true;
      }
      return cancelled;
    }

    function setCurrent(media) {
      if (current === media) return current;
      current = media || null;
      return current;
    }

    async function preload(candidate, policy) {
      candidate = isRecord(candidate) ? candidate : {};
      policy = isRecord(policy) ? policy : {};
      if (inFlightHandoff) {
        return { ok: false, disabled: true, reason: 'handoff-in-flight' };
      }
      if (deferredOutgoing) {
        return { ok: false, disabled: true, reason: 'handoff-pending-finalize' };
      }
      cancel('preload-replaced');
      if (!candidate.src || policy.unsupportedStream === true) {
        return { ok: false, disabled: true, reason: 'unsupported-stream' };
      }
      var generation = ++serial;
      var media = options.createMedia(candidate);
      var record = {
        generation: generation,
        key: String(candidate.key || candidate.src),
        media: media,
        ready: false,
        released: false,
      };
      standby = record;
      try {
        media.preload = 'auto';
        media.src = String(candidate.src);
        var ready = await prepare(media, candidate, policy);
        if (standby !== record || generation !== serial || record.released) {
          return { ok: false, cancelled: true, reason: 'stale-preload' };
        }
        if (ready === false) throw new Error('Gapless preload failed');
        record.ready = true;
        return {
          ok: true,
          media: media,
          key: record.key,
        };
      } catch (error) {
        if (standby === record) standby = null;
        releaseRecord(record, 'preload-failed');
        return {
          ok: false,
          error: error,
          reason: 'preload-failed',
        };
      }
    }

    async function handoff(policy) {
      policy = isRecord(policy) ? policy : {};
      if (!standby || !standby.ready || standby.released) {
        return { ok: false, reason: 'standby-not-ready' };
      }
      var record = standby;
      standby = null;
      serial += 1;
      var outgoing = current;
      var incoming = record.media;
      var resolveCancellation;
      var operation = {
        record: record,
        outgoing: outgoing,
        incoming: incoming,
        cancelled: false,
        cancelReason: '',
        cancellation: new Promise(function(resolve) {
          resolveCancellation = resolve;
        }),
        resolveCancellation: function() {
          if (!resolveCancellation) return;
          var resolve = resolveCancellation;
          resolveCancellation = null;
          resolve();
        },
      };
      inFlightHandoff = operation;
      try {
        if (outgoing && crossfade && shouldUseCrossfade(policy)) {
          var crossfadePromise = Promise.resolve(crossfade(
            outgoing,
            incoming,
            boundedCrossfadeMs(policy.crossfadeMs),
            {
              whenCancelled: operation.cancellation,
              isCancelled: function() { return operation.cancelled; },
            }
          ));
          await Promise.race([
            crossfadePromise,
            operation.cancellation.then(function() {
              var error = new Error('Gapless handoff cancelled');
              error.code = 'GAPLESS_HANDOFF_CANCELLED';
              throw error;
            }),
          ]);
        }
        if (operation.cancelled || inFlightHandoff !== operation) {
          var staleError = new Error('Gapless handoff cancelled');
          staleError.code = 'GAPLESS_HANDOFF_CANCELLED';
          throw staleError;
        }
        inFlightHandoff = null;
        current = incoming;
        var result = {
          ok: true,
          media: incoming,
          outgoing: outgoing,
          crossfaded: !!(outgoing && crossfade && shouldUseCrossfade(policy)),
          outgoingReleased: false,
        };
        if (outgoing && outgoing !== incoming) {
          if (policy.deferOutgoingRelease === true) {
            deferredOutgoing = outgoing;
          } else {
            releaseMedia(outgoing, 'handoff-complete');
            result.outgoingReleased = true;
          }
        }
        return result;
      } catch (error) {
        if (inFlightHandoff === operation) inFlightHandoff = null;
        current = outgoing;
        releaseRecord(record, operation.cancelReason || 'handoff-failed');
        if (operation.cancelled || error.code === 'GAPLESS_HANDOFF_CANCELLED') {
          return {
            ok: false,
            cancelled: true,
            error: error,
            reason: 'handoff-cancelled',
          };
        }
        return {
          ok: false,
          error: error,
          reason: 'handoff-failed',
        };
      }
    }

    function finalizeHandoff(result) {
      if (
        !result
        || !result.ok
        || result.outgoingReleased
        || !result.outgoing
        || result.outgoing !== deferredOutgoing
      ) {
        return false;
      }
      var outgoing = deferredOutgoing;
      deferredOutgoing = null;
      releaseMedia(outgoing, 'handoff-committed');
      result.outgoingReleased = true;
      return true;
    }

    function claim(key) {
      key = String(key || '');
      if (inFlightHandoff) return null;
      if (!standby || !standby.ready || standby.released) return null;
      if (key && standby.key !== key) return null;
      var media = standby.media;
      standby = null;
      serial += 1;
      return media;
    }

    function snapshot() {
      var media = new Set();
      if (current) media.add(current);
      if (standby && standby.media) media.add(standby.media);
      if (inFlightHandoff) {
        if (inFlightHandoff.outgoing) media.add(inFlightHandoff.outgoing);
        if (inFlightHandoff.incoming) media.add(inFlightHandoff.incoming);
      }
      if (deferredOutgoing) media.add(deferredOutgoing);
      return {
        currentId: current && current.id != null ? String(current.id) : '',
        standbyKey: standby ? standby.key : '',
        standbyReady: !!(standby && standby.ready),
        handoffInFlight: !!inFlightHandoff,
        handoffOutgoingId: inFlightHandoff && inFlightHandoff.outgoing && inFlightHandoff.outgoing.id != null
          ? String(inFlightHandoff.outgoing.id)
          : '',
        handoffIncomingId: inFlightHandoff && inFlightHandoff.incoming && inFlightHandoff.incoming.id != null
          ? String(inFlightHandoff.incoming.id)
          : '',
        mediaCount: media.size,
      };
    }

    function release() {
      cancel('coordinator-release');
      if (current) {
        releaseMedia(current, 'coordinator-release');
        current = null;
      }
      if (deferredOutgoing) {
        releaseMedia(deferredOutgoing, 'coordinator-release-deferred');
        deferredOutgoing = null;
      }
    }

    return Object.freeze({
      cancel: cancel,
      claim: claim,
      finalizeHandoff: finalizeHandoff,
      handoff: handoff,
      preload: preload,
      release: release,
      setCurrent: setCurrent,
      snapshot: snapshot,
    });
  }

  return {
    DEFAULT_CROSSFADE_MS: DEFAULT_CROSSFADE_MS,
    MAX_CROSSFADE_MS: MAX_CROSSFADE_MS,
    MIN_CROSSFADE_MS: MIN_CROSSFADE_MS,
    boundedCrossfadeMs: boundedCrossfadeMs,
    createGaplessPlaybackCoordinator: createGaplessPlaybackCoordinator,
    equalPowerCrossfade: equalPowerCrossfade,
    inferStreamSupport: inferStreamSupport,
    shouldUseCrossfade: shouldUseCrossfade,
  };
});
