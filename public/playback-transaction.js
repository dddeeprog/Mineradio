/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlaybackTransaction = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var TRANSITIONS = Object.freeze({
    idle: Object.freeze(['snapshot']),
    snapshot: Object.freeze(['resolving', 'cancelled']),
    resolving: Object.freeze(['preparing', 'rolling-back', 'cancelled']),
    preparing: Object.freeze(['confirming', 'rolling-back', 'cancelled']),
    confirming: Object.freeze(['committed', 'rolling-back', 'cancelled']),
    committed: Object.freeze([]),
    'rolling-back': Object.freeze(['rolled-back']),
    'rolled-back': Object.freeze([]),
    cancelled: Object.freeze([]),
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;
    var clone = {};
    Object.keys(value).forEach(function(key) {
      clone[key] = cloneValue(value[key]);
    });
    return clone;
  }

  function cloneAudioGraph(graph) {
    graph = isRecord(graph) ? graph : {};
    return {
      context: graph.context || null,
      source: graph.source || null,
      analyser: graph.analyser || null,
      beatAnalyser: graph.beatAnalyser || null,
      gainNode: graph.gainNode || null,
      media: graph.media || null,
    };
  }

  function capturePlaybackState(state) {
    state = isRecord(state) ? state : {};
    return {
      queue: cloneValue(Array.isArray(state.queue) ? state.queue : []),
      index: Number.isFinite(Number(state.index)) ? Number(state.index) : -1,
      song: cloneValue(state.song || null),
      progress: cloneValue(state.progress || {}),
      volume: cloneValue(state.volume || {}),
      ui: cloneValue(state.ui || {}),
      lyrics: cloneValue(state.lyrics || {}),
      beat: cloneValue(state.beat || {}),
      audioGraph: cloneAudioGraph(state.audioGraph),
    };
  }

  function restorePlaybackState(target, snapshot) {
    target = isRecord(target) ? target : {};
    snapshot = capturePlaybackState(snapshot);
    target.queue = cloneValue(snapshot.queue);
    target.index = snapshot.index;
    target.song = cloneValue(snapshot.song);
    target.progress = cloneValue(snapshot.progress);
    target.volume = cloneValue(snapshot.volume);
    target.ui = cloneValue(snapshot.ui);
    target.lyrics = cloneValue(snapshot.lyrics);
    target.beat = cloneValue(snapshot.beat);
    target.audioGraph = cloneAudioGraph(snapshot.audioGraph);
    return target;
  }

  function sourceProvider(song) {
    song = isRecord(song) ? song : {};
    return String(
      song.catalogProvider
      || song.provider
      || song.source
      || song.type
      || ''
    ).trim().toLowerCase();
  }

  function sourceId(song) {
    song = isRecord(song) ? song : {};
    var value = song.catalogSourceId;
    if (value == null || value === '') value = song.sourceId;
    if (value == null || value === '') value = song.id;
    if (value == null || value === '') value = song.mid;
    if (value == null || value === '') value = song.songmid;
    if (value == null || value === '') value = song.hash;
    return value == null ? '' : String(value);
  }

  function playbackSourceId(song, provider) {
    song = isRecord(song) ? song : {};
    provider = String(provider || sourceProvider(song)).trim().toLowerCase();
    var providerFields = {
      kugou: ['hash', 'id'],
      netease: ['neteaseId', 'id'],
      qq: ['mid', 'songmid', 'qqId', 'id'],
      qishui: ['trackId', 'id'],
      spotify: ['spotifyId', 'id', 'uri'],
    };
    var fields = providerFields[provider] || ['id', 'mid', 'songmid', 'hash'];
    var value = '';
    for (var index = 0; index < fields.length; index++) {
      value = song[fields[index]];
      if (value != null && value !== '') break;
    }
    if (value == null || value === '') value = song.sourceId;
    if (
      (value == null || value === '')
      && String(song.playbackProvider || '').trim().toLowerCase() === provider
    ) {
      value = song.playbackSourceId;
    }
    return value == null ? '' : String(value);
  }

  function playbackProviderCandidates(song, capabilitySnapshot, options) {
    song = isRecord(song) ? song : {};
    capabilitySnapshot = isRecord(capabilitySnapshot) ? capabilitySnapshot : {};
    options = isRecord(options) ? options : {};
    var catalogProvider = sourceProvider(song);
    var catalogSourceId = sourceId(song);
    var excluded = Array.isArray(options.excludeProviders)
      ? options.excludeProviders.map(function(value) { return String(value); })
      : [];
    var seen = Object.create(null);
    var available = [];
    (Array.isArray(capabilitySnapshot.providers) ? capabilitySnapshot.providers : [])
      .forEach(function(item, index) {
        if (!isRecord(item)) return;
        var provider = String(item.provider || '').trim().toLowerCase();
        if (!provider || seen[provider] || excluded.indexOf(provider) >= 0) return;
        if (!isRecord(item.capabilities) || item.capabilities.playback !== true) return;
        if (!isRecord(item.availability) || item.availability.playback !== true) return;
        seen[provider] = true;
        available.push({
          provider: provider,
          index: index,
          direct: provider === catalogProvider,
        });
      });
    available.sort(function(left, right) {
      if (left.direct !== right.direct) return left.direct ? -1 : 1;
      return left.index - right.index;
    });
    return available.map(function(item) {
      return Object.freeze({
        catalogProvider: catalogProvider,
        catalogSourceId: catalogSourceId,
        playbackProvider: item.provider,
        resolutionMode: item.direct ? 'catalog' : 'matched-provider',
      });
    });
  }

  function applyPlaybackResolution(catalogSong, candidate, playbackSong) {
    var resolved = cloneValue(isRecord(catalogSong) ? catalogSong : {});
    candidate = isRecord(candidate) ? candidate : {};
    playbackSong = isRecord(playbackSong) ? playbackSong : {};
    resolved.catalogProvider = String(
      candidate.catalogProvider || resolved.catalogProvider || sourceProvider(resolved)
    );
    resolved.catalogSourceId = String(
      candidate.catalogSourceId || resolved.catalogSourceId || sourceId(resolved)
    );
    resolved.playbackProvider = String(
      candidate.playbackProvider || playbackSong.provider || sourceProvider(playbackSong)
    );
    resolved.playbackSourceId = playbackSourceId(playbackSong, resolved.playbackProvider);
    resolved.resolutionMode = String(
      candidate.resolutionMode
      || (resolved.playbackProvider === resolved.catalogProvider ? 'catalog' : 'matched-provider')
    );
    return resolved;
  }

  function transactionError(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function createPlaybackTransactionManager(options) {
    options = isRecord(options) ? options : {};
    var capture = typeof options.capture === 'function'
      ? options.capture
      : function() { return null; };
    var restore = typeof options.restore === 'function'
      ? options.restore
      : function() {};
    var serial = 0;
    var latestRequestId = 0;
    var active = null;
    var executionTail = Promise.resolve();

    function transition(attempt, next) {
      if (!attempt || attempt.state === next) return;
      var allowed = TRANSITIONS[attempt.state] || [];
      if (allowed.indexOf(next) < 0) {
        throw transactionError(
          'PLAYBACK_TRANSACTION_STATE_INVALID',
          'Invalid playback transaction transition: ' + attempt.state + ' -> ' + next
        );
      }
      attempt.state = next;
      attempt.history.push(next);
    }

    function releaseAttempt(attempt, reason) {
      if (!attempt || attempt.released) return;
      if (attempt.prepared == null) return;
      attempt.released = true;
      if (attempt.spec && typeof attempt.spec.release === 'function') {
        try {
          attempt.spec.release(attempt.prepared, reason || 'cancelled');
        } catch (_) {}
      }
    }

    function interruptiblePhase(attempt, phasePromise, onLateValue) {
      var settled = false;
      var observed = Promise.resolve(phasePromise).then(function(value) {
        settled = true;
        return value;
      }, function(error) {
        settled = true;
        throw error;
      });
      var cancelled = attempt.cancelPromise.then(function() {
        if (!settled && typeof onLateValue === 'function') {
          observed.then(onLateValue, function() {});
        }
        throw transactionError(
          'PLAYBACK_TRANSACTION_CANCELLED',
          'Playback transaction cancelled'
        );
      });
      return Promise.race([observed, cancelled]);
    }

    function cancelAttempt(attempt, reason) {
      if (!attempt || attempt.terminal) return false;
      if (attempt.state === 'rolling-back') return false;
      attempt.cancelReason = reason || 'superseded';
      if (attempt.state !== 'cancelled') transition(attempt, 'cancelled');
      attempt.terminal = true;
      attempt.resolveCancellation();
      releaseAttempt(attempt, attempt.cancelReason);
      return true;
    }

    function cancel(reason) {
      if (!active) return false;
      var cancelled = cancelAttempt(active, reason || 'cancelled');
      if (active && active.terminal) active = null;
      return cancelled;
    }

    async function staleResult(attempt) {
      if (!attempt.terminal) cancelAttempt(attempt, 'superseded');
      if (attempt.commitStarted && !attempt.cancelRestored) {
        attempt.cancelRestored = true;
        try {
          await restore(
            attempt.snapshot,
            transactionError('PLAYBACK_TRANSACTION_CANCELLED', 'Playback transaction cancelled')
          );
        } catch (restoreError) {
          attempt.restoreError = restoreError;
        }
      }
      if (active === attempt) active = null;
      var result = {
        ok: false,
        stale: true,
        retained: true,
        state: 'cancelled',
        history: attempt.history.slice(),
        reason: attempt.cancelReason || 'superseded',
      };
      if (attempt.restoreError) result.restoreError = attempt.restoreError;
      return result;
    }

    async function runAttempt(spec, requestId) {
      spec = isRecord(spec) ? spec : {};
      var resolveCancellation;
      var attempt = {
        id: requestId,
        state: 'idle',
        history: ['idle'],
        spec: spec,
        snapshot: null,
        prepared: null,
        terminal: false,
        released: false,
        commitStarted: false,
        cancelRestored: false,
        cancelPromise: new Promise(function(resolve) {
          resolveCancellation = resolve;
        }),
        resolveCancellation: function() {
          if (!resolveCancellation) return;
          var resolve = resolveCancellation;
          resolveCancellation = null;
          resolve();
        },
      };
      active = attempt;

      try {
        transition(attempt, 'snapshot');
        attempt.snapshot = capture();
        if (active !== attempt || attempt.terminal) return staleResult(attempt);

        transition(attempt, 'resolving');
        var resolved = await interruptiblePhase(
          attempt,
          spec.resolve({
            id: attempt.id,
            isCurrent: function() { return active === attempt && !attempt.terminal; },
          })
        );
        if (active !== attempt || attempt.terminal) return staleResult(attempt);

        transition(attempt, 'preparing');
        attempt.prepared = await interruptiblePhase(
          attempt,
          spec.prepare(resolved, {
            id: attempt.id,
            isCurrent: function() { return active === attempt && !attempt.terminal; },
            whenCancelled: attempt.cancelPromise,
            registerPrepared: function(prepared) {
              if (prepared == null) return false;
              if (attempt.prepared != null && attempt.prepared !== prepared) {
                throw transactionError(
                  'PLAYBACK_PREPARED_RESOURCE_INVALID',
                  'Playback prepare registered more than one resource'
                );
              }
              attempt.prepared = prepared;
              if (attempt.terminal) {
                releaseAttempt(attempt, attempt.cancelReason || 'cancelled');
              }
              return true;
            },
          }),
          function(prepared) {
            attempt.prepared = prepared;
            releaseAttempt(attempt, attempt.cancelReason || 'superseded');
          }
        );
        if (active !== attempt || attempt.terminal) return staleResult(attempt);

        transition(attempt, 'confirming');
        var confirmed = await interruptiblePhase(
          attempt,
          spec.confirm(attempt.prepared, {
            id: attempt.id,
            isCurrent: function() { return active === attempt && !attempt.terminal; },
          })
        );
        if (active !== attempt || attempt.terminal) return staleResult(attempt);
        if (confirmed === false) {
          throw transactionError(
            'PLAYBACK_CONFIRMATION_FAILED',
            'Playback confirmation failed'
          );
        }

        attempt.commitStarted = true;
        var value = await spec.commit(attempt.prepared, {
          id: attempt.id,
          isCurrent: function() { return active === attempt && !attempt.terminal; },
          whenCancelled: attempt.cancelPromise,
        });
        if (active !== attempt || attempt.terminal) return staleResult(attempt);
        transition(attempt, 'committed');
        attempt.terminal = true;
        if (active === attempt) active = null;
        var result = {
          ok: true,
          state: attempt.state,
          history: attempt.history.slice(),
          value: value,
        };
        if (typeof spec.finalize === 'function') {
          try {
            await spec.finalize(value, attempt.prepared, {
              id: attempt.id,
              isCurrent: function() { return attempt.state === 'committed'; },
            });
          } catch (finalizeError) {
            result.finalizeError = finalizeError;
          }
        }
        return result;
      } catch (error) {
        if (active !== attempt || attempt.state === 'cancelled') return staleResult(attempt);
        transition(attempt, 'rolling-back');
        try {
          await restore(attempt.snapshot, error);
        } catch (restoreError) {
          error.restoreError = restoreError;
        }
        transition(attempt, 'rolled-back');
        attempt.terminal = true;
        releaseAttempt(attempt, 'rolled-back');
        if (active === attempt) active = null;
        return {
          ok: false,
          retained: true,
          state: attempt.state,
          history: attempt.history.slice(),
          error: error,
        };
      }
    }

    function cancelledBeforeStart(spec) {
      if (spec && typeof spec.release === 'function') {
        try { spec.release(null, 'superseded-before-start'); } catch (_) {}
      }
      return {
        ok: false,
        stale: true,
        retained: true,
        state: 'cancelled',
        history: ['idle', 'cancelled'],
        reason: 'superseded',
      };
    }

    function execute(spec) {
      spec = isRecord(spec) ? spec : {};
      var requestId = ++serial;
      latestRequestId = requestId;
      if (active) cancelAttempt(active, 'superseded');
      var queued = executionTail.then(function() {
        if (requestId !== latestRequestId) return cancelledBeforeStart(spec);
        return runAttempt(spec, requestId);
      });
      executionTail = queued.then(function() {}, function() {});
      return queued;
    }

    function snapshot() {
      return active
        ? {
          id: active.id,
          state: active.state,
          history: active.history.slice(),
        }
        : { id: 0, state: 'idle', history: ['idle'] };
    }

    return Object.freeze({
      cancel: cancel,
      execute: execute,
      snapshot: snapshot,
    });
  }

  return {
    PLAYBACK_TRANSACTION_TRANSITIONS: TRANSITIONS,
    applyPlaybackResolution: applyPlaybackResolution,
    capturePlaybackState: capturePlaybackState,
    createPlaybackTransactionManager: createPlaybackTransactionManager,
    playbackProviderCandidates: playbackProviderCandidates,
    restorePlaybackState: restorePlaybackState,
  };
});
