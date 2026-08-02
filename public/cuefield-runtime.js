/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Source references: cuefield/adapter-mineradio.js,
 * public/js/modules/05-playback/16-cuefield-automix-core.js, and
 * public/js/modules/05-playback/17-cuefield-timeline-executor.js.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioCuefield = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var INTENSITIES = Object.freeze({
    off: true,
    subtle: true,
    balanced: true,
    club: true,
  });
  var COMPRESSED_COMBOS = ['', 'downbeat', 'push', 'drop', 'rebound', 'accent'];
  var MAJOR_CAMELOT = Object.freeze({
    B: 1,
    'F#': 2,
    GB: 2,
    'C#': 3,
    DB: 3,
    'G#': 4,
    AB: 4,
    'D#': 5,
    EB: 5,
    'A#': 6,
    BB: 6,
    F: 7,
    C: 8,
    G: 9,
    D: 10,
    A: 11,
    E: 12,
  });
  var MINOR_CAMELOT = Object.freeze({
    'G#': 1,
    AB: 1,
    'D#': 2,
    EB: 2,
    'A#': 3,
    BB: 3,
    F: 4,
    C: 5,
    G: 6,
    D: 7,
    A: 8,
    E: 9,
    B: 10,
    'F#': 11,
    GB: 11,
    'C#': 12,
    DB: 12,
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finiteNumber(value, min)));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits == null ? 4 : digits);
    return Math.round(finiteNumber(value, 0) * factor) / factor;
  }

  function average(values) {
    var usable = (Array.isArray(values) ? values : []).filter(function(value) {
      return isFinite(value);
    });
    if (!usable.length) return 0;
    return usable.reduce(function(sum, value) { return sum + value; }, 0) / usable.length;
  }

  function median(values) {
    var usable = (Array.isArray(values) ? values : []).filter(function(value) {
      return isFinite(value);
    }).slice().sort(function(a, b) { return a - b; });
    if (!usable.length) return 0;
    var middle = Math.floor(usable.length / 2);
    return usable.length % 2
      ? usable[middle]
      : (usable[middle - 1] + usable[middle]) / 2;
  }

  function normalizeIntensity(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    return INTENSITIES[normalized] ? normalized : 'off';
  }

  function normalizeTempoPair(sourceBpm, targetBpm, options) {
    options = isRecord(options) ? options : {};
    sourceBpm = finiteNumber(sourceBpm, 0);
    targetBpm = finiteNumber(targetBpm, 0);
    var maxRelativeDiff = clamp(options.maxRelativeDiff == null ? 0.06 : options.maxRelativeDiff, 0, 0.5);
    if (sourceBpm <= 0 || targetBpm <= 0) {
      return {
        valid: false,
        compatible: false,
        sourceBpm: sourceBpm,
        targetBpm: targetBpm,
        matchedTargetBpm: 0,
        targetScale: 1,
        ratio: 0,
        relativeDiff: 1,
        maxRelativeDiff: maxRelativeDiff,
      };
    }
    var candidates = [1, 2, 0.5].map(function(scale) {
      var matched = targetBpm * scale;
      return {
        matched: matched,
        scale: scale,
        relativeDiff: Math.abs(matched - sourceBpm) / sourceBpm,
      };
    }).sort(function(a, b) {
      return a.relativeDiff - b.relativeDiff || Math.abs(1 - a.scale) - Math.abs(1 - b.scale);
    });
    var best = candidates[0];
    return {
      valid: true,
      compatible: best.relativeDiff <= maxRelativeDiff,
      sourceBpm: round(sourceBpm, 3),
      targetBpm: round(targetBpm, 3),
      matchedTargetBpm: round(best.matched, 3),
      targetScale: best.scale,
      ratio: round(targetBpm / sourceBpm, 4),
      relativeDiff: round(best.relativeDiff, 4),
      maxRelativeDiff: maxRelativeDiff,
    };
  }

  function normalizeNote(value) {
    return String(value || '')
      .trim()
      .replace(/\u266f/g, '#')
      .replace(/\u266d/g, 'b')
      .toUpperCase();
  }

  function parseCamelot(value) {
    var text = String(value == null ? '' : value).trim();
    var direct = text.toUpperCase().match(/^(1[0-2]|[1-9])\s*([AB])$/);
    if (direct) {
      return {
        number: Number(direct[1]),
        mode: direct[2],
        code: String(Number(direct[1])) + direct[2],
      };
    }
    var musical = text.match(/^([A-Ga-g])\s*([#b\u266f\u266d]?)\s*(major|minor|maj|min|m)$/i);
    if (!musical) return null;
    var note = normalizeNote(musical[1] + musical[2]);
    var suffix = musical[3].toLowerCase();
    var minor = suffix === 'minor' || suffix === 'min' || suffix === 'm';
    var number = (minor ? MINOR_CAMELOT : MAJOR_CAMELOT)[note];
    if (!number) return null;
    var mode = minor ? 'A' : 'B';
    return { number: number, mode: mode, code: String(number) + mode };
  }

  function wheelDistance(left, right) {
    var distance = Math.abs(left - right);
    return Math.min(distance, 12 - distance);
  }

  function scoreKeyCompatibility(source, target) {
    var left = parseCamelot(source);
    var right = parseCamelot(target);
    if (!left || !right) return null;
    var distance = wheelDistance(left.number, right.number);
    if (distance === 0 && left.mode === right.mode) return 1;
    if (distance === 1 && left.mode === right.mode) return 0.92;
    if (distance === 0 && left.mode !== right.mode) return 0.86;
    if (distance === 1 && left.mode !== right.mode) return 0.68;
    return round(Math.max(0.18, 0.58 - distance * 0.09 - (left.mode === right.mode ? 0 : 0.08)), 2);
  }

  function durationSeconds(value) {
    value = Math.max(0, finiteNumber(value, 0));
    return value > 10000 ? value * 0.001 : value;
  }

  function stepSeconds(value, fallback) {
    value = finiteNumber(value, fallback == null ? 0 : fallback);
    return value > 10 ? value * 0.001 : value;
  }

  function beatTimeScale(map, rawBeats) {
    var maximum = 0;
    (Array.isArray(rawBeats) ? rawBeats : []).forEach(function(raw) {
      var value = Array.isArray(raw)
        ? finiteNumber(raw[0], 0)
        : (typeof raw === 'number' ? raw : finiteNumber(raw && raw.time, 0));
      maximum = Math.max(maximum, value);
    });
    if (finiteNumber(map && map.gridStep, 0) > 10) return 0.001;
    if (maximum > 10000) return 0.001;
    var mapDuration = durationSeconds(map && map.duration);
    if (mapDuration > 0 && maximum > Math.max(10, mapDuration * 1.25)) return 0.001;
    return 1;
  }

  function normalizeBeat(raw, index, timeScale, gridStep) {
    var time;
    var strength;
    var confidence;
    var impact;
    var low;
    var body;
    var snap;
    var combo = '';
    var downbeat = false;
    var phrase = false;
    if (Array.isArray(raw)) {
      time = finiteNumber(raw[0], NaN);
      strength = finiteNumber(raw[1], 0.5);
      confidence = finiteNumber(raw[2], 0.5);
      impact = finiteNumber(raw[3], strength);
      low = finiteNumber(raw[4], finiteNumber(raw[9], 0));
      body = finiteNumber(raw[5], 0);
      snap = finiteNumber(raw[6], finiteNumber(raw[10], 0));
      combo = COMPRESSED_COMBOS[Math.max(0, Math.round(finiteNumber(raw[7], 0)))] || '';
      downbeat = combo === 'downbeat';
    } else if (typeof raw === 'number') {
      time = raw;
      strength = 0.5;
      confidence = 0.5;
      impact = 0.5;
      low = 0;
      body = 0;
      snap = 0;
    } else {
      time = finiteNumber(raw && raw.time, NaN);
      strength = finiteNumber(raw && raw.strength, 0.5);
      confidence = finiteNumber(raw && raw.confidence, 0.5);
      impact = finiteNumber(raw && raw.impact, strength);
      low = finiteNumber(raw && raw.low, 0);
      body = finiteNumber(raw && raw.body, 0);
      snap = finiteNumber(raw && raw.snap, 0);
      combo = String(raw && raw.combo || '');
      downbeat = !!(raw && raw.downbeat) || combo === 'downbeat';
      phrase = !!(raw && raw.phrase);
    }
    if (!isFinite(time) || time < 0) return null;
    return {
      index: index,
      time: round(time * timeScale),
      strength: clamp01(strength),
      confidence: clamp01(confidence),
      impact: clamp01(impact),
      low: clamp01(low),
      body: clamp01(body),
      snap: clamp01(snap),
      energy: round(clamp01(Math.max(impact, strength, low, body, snap))),
      combo: combo,
      downbeat: downbeat,
      phrase: phrase,
      step: round(stepSeconds(Array.isArray(raw)
        ? raw[11]
        : raw && raw.step, gridStep)),
    };
  }

  function dedupeBeats(beats) {
    var byTime = Object.create(null);
    beats.forEach(function(beat) {
      if (!beat) return;
      var key = String(Math.round(beat.time * 1000));
      var previous = byTime[key];
      if (!previous || beat.confidence > previous.confidence) byTime[key] = beat;
    });
    return Object.keys(byTime).map(function(key) { return byTime[key]; }).sort(function(a, b) {
      return a.time - b.time;
    }).map(function(beat, index) {
      return Object.assign({}, beat, { index: index });
    });
  }

  function boundaryRecord(beat) {
    return {
      time: beat.time,
      confidence: round(Math.max(beat.confidence, beat.strength)),
      energy: beat.energy,
    };
  }

  function uniqueBoundaries(boundaries) {
    var seen = Object.create(null);
    return boundaries.filter(function(boundary) {
      if (!boundary || !isFinite(boundary.time)) return false;
      var key = String(Math.round(boundary.time * 1000));
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function(a, b) { return a.time - b.time; });
  }

  function adaptBeatMap(input) {
    input = isRecord(input) ? input : {};
    var track = isRecord(input.track) ? input.track : {};
    var map = isRecord(input.map) ? input.map : {};
    var rawBeats = Array.isArray(map.cameraBeats)
      ? map.cameraBeats
      : (Array.isArray(map.beats) ? map.beats : (Array.isArray(map.kicks) ? map.kicks : []));
    var timeScale = beatTimeScale(map, rawBeats);
    var rawGridStep = finiteNumber(map.gridStep, 0);
    var scaledGridStep = stepSeconds(rawGridStep, 0);
    var beats = dedupeBeats(rawBeats.map(function(raw, index) {
      return normalizeBeat(raw, index, timeScale, scaledGridStep);
    }));
    var duration = Math.max(
      durationSeconds(track.duration),
      durationSeconds(map.duration),
      beats.length ? beats[beats.length - 1].time + Math.max(scaledGridStep, 0) : 0
    );
    var intervals = [];
    for (var index = 1; index < beats.length; index += 1) {
      var delta = beats[index].time - beats[index - 1].time;
      if (delta >= 0.18 && delta <= 2) intervals.push(delta);
    }
    var gridStep = scaledGridStep > 0 ? scaledGridStep : median(intervals);
    var explicitDownbeats = beats.filter(function(beat) { return beat.downbeat; });
    var explicitPhrases = beats.filter(function(beat) { return beat.phrase; });
    var hasExplicitMeter = beats.some(function(beat) {
      return beat.downbeat || beat.phrase || !!beat.combo;
    });
    var downbeats = explicitDownbeats.length
      ? explicitDownbeats
      : (hasExplicitMeter
        ? explicitPhrases
        : beats.filter(function(_, beatIndex) { return beatIndex % 4 === 0; }));
    var phraseBoundaries = uniqueBoundaries(
      downbeats.filter(function(_, downbeatIndex) { return downbeatIndex % 4 === 0; }).map(boundaryRecord)
        .concat(explicitPhrases.map(boundaryRecord))
    );
    var intervalDeviation = gridStep > 0
      ? median(intervals.map(function(interval) { return Math.abs(interval - gridStep); })) / gridStep
      : 1;
    var tempoStability = clamp01(1 - intervalDeviation / 0.14);
    var beatConfidence = clamp01(average(beats.map(function(beat) { return beat.confidence; })));
    var downbeatIntervals = [];
    for (var downbeatIndex = 1; downbeatIndex < downbeats.length; downbeatIndex += 1) {
      downbeatIntervals.push(downbeats[downbeatIndex].time - downbeats[downbeatIndex - 1].time);
    }
    var expectedBar = gridStep > 0 ? gridStep * 4 : 0;
    var downbeatError = expectedBar > 0 && downbeatIntervals.length
      ? median(downbeatIntervals.map(function(interval) {
        return Math.abs(interval - expectedBar) / expectedBar;
      }))
      : 1;
    var downbeatStability = clamp01(1 - downbeatError / 0.2);
    var sampleConfidence = clamp01(beats.length / 48);
    var partial = map.partial === true;
    var dataConfidence = clamp01((
      tempoStability * 0.34
      + beatConfidence * 0.26
      + downbeatStability * 0.22
      + sampleConfidence * 0.18
    ) * (partial ? 0.72 : 1));
    var musicalKey = String(input.musicalKey || map.musicalKey || '').trim();
    var explicitCamelot = String(input.camelot || map.camelot || '').trim();
    var parsedKey = parseCamelot(explicitCamelot || musicalKey);
    return {
      track: {
        id: String(track.id == null ? '' : track.id),
        title: String(track.title || track.name || ''),
        artist: String(track.artist || ''),
        duration: round(duration),
      },
      duration: round(duration),
      beats: beats,
      downbeats: downbeats.map(boundaryRecord),
      phraseBoundaries: phraseBoundaries,
      energyCurve: beats.map(function(beat) {
        return { time: beat.time, value: beat.energy };
      }),
      gridStep: round(gridStep),
      bpm: gridStep > 0 ? round(60 / gridStep, 2) : 0,
      camelot: parsedKey ? parsedKey.code : '',
      musicalKey: musicalKey,
      tempoStability: round(tempoStability),
      beatConfidence: round(beatConfidence),
      downbeatStability: round(downbeatStability),
      dataConfidence: round(dataConfidence),
      partial: partial,
    };
  }

  var PLAN_POLICIES = Object.freeze({
    subtle: Object.freeze({
      crossfadeMs: 480,
      maxTempoDiff: 0.035,
      minConfidence: 0.66,
      minKeyScore: 0.86,
      maxEntrySec: 12,
      energyFloor: 0.48,
      mode: 'crossfade',
    }),
    balanced: Object.freeze({
      crossfadeMs: 820,
      maxTempoDiff: 0.065,
      minConfidence: 0.58,
      minKeyScore: 0.68,
      maxEntrySec: 20,
      energyFloor: 0.36,
      mode: 'beat-crossfade',
    }),
    club: Object.freeze({
      crossfadeMs: 1200,
      maxTempoDiff: 0.105,
      minConfidence: 0.48,
      minKeyScore: 0.35,
      maxEntrySec: 32,
      energyFloor: 0.24,
      mode: 'beat-crossfade',
    }),
  });

  function ordinaryPlan(reason) {
    return {
      mode: 'ordinary',
      reason: reason,
      triggerAtSec: null,
      entryAtSec: 0,
      crossfadeMs: 0,
      confidence: 0,
      tempo: null,
      key: null,
      energy: null,
    };
  }

  function normalizeBoundaryList(value) {
    return (Array.isArray(value) ? value : []).map(function(boundary) {
      if (typeof boundary === 'number') {
        return { time: boundary, confidence: 0.5, energy: 0.5 };
      }
      return {
        time: finiteNumber(boundary && boundary.time, NaN),
        confidence: clamp01(boundary && boundary.confidence == null ? 0.5 : boundary.confidence),
        energy: clamp01(boundary && boundary.energy == null ? 0.5 : boundary.energy),
      };
    }).filter(function(boundary) {
      return isFinite(boundary.time) && boundary.time >= 0;
    }).sort(function(a, b) { return a.time - b.time; });
  }

  function transitionBoundaries(analysis) {
    var byTime = Object.create(null);
    normalizeBoundaryList(
      (Array.isArray(analysis && analysis.downbeats) ? analysis.downbeats : [])
        .concat(Array.isArray(analysis && analysis.phraseBoundaries)
          ? analysis.phraseBoundaries
          : [])
    ).forEach(function(boundary) {
      var key = String(Math.round(boundary.time * 1000));
      var previous = byTime[key];
      if (!previous || boundary.confidence > previous.confidence) byTime[key] = boundary;
    });
    return Object.keys(byTime).map(function(key) { return byTime[key]; }).sort(function(left, right) {
      return left.time - right.time;
    });
  }

  function energyAt(analysis, time) {
    var curve = (Array.isArray(analysis && analysis.energyCurve) ? analysis.energyCurve : [])
      .map(function(point) {
        return {
          time: finiteNumber(point && point.time, NaN),
          value: clamp01(point && point.value),
        };
      }).filter(function(point) { return isFinite(point.time); })
      .sort(function(a, b) { return a.time - b.time; });
    if (!curve.length) return 0.5;
    var chosen = curve[0];
    for (var index = 0; index < curve.length; index += 1) {
      if (curve[index].time > time) break;
      chosen = curve[index];
    }
    return chosen.value;
  }

  function chooseEntryBoundary(to, policy, exitEnergy, intensity) {
    var candidates = transitionBoundaries(to).filter(function(boundary) {
      return boundary.time <= policy.maxEntrySec;
    });
    if (!candidates.length) return null;
    if (intensity === 'subtle') return candidates[0];
    return candidates.slice().sort(function(left, right) {
      var leftEnergy = energyAt(to, left.time);
      var rightEnergy = energyAt(to, right.time);
      var leftScore = Math.abs(leftEnergy - exitEnergy) - left.confidence * 0.08;
      var rightScore = Math.abs(rightEnergy - exitEnergy) - right.confidence * 0.08;
      return leftScore - rightScore || left.time - right.time;
    })[0];
  }

  function analysisConfidence(analysis) {
    return clamp01(average([
      finiteNumber(analysis && analysis.dataConfidence, 0),
      finiteNumber(analysis && analysis.tempoStability, 0),
      finiteNumber(analysis && analysis.beatConfidence, 0),
      finiteNumber(analysis && analysis.downbeatStability, 0),
    ]));
  }

  function planTransition(options) {
    options = isRecord(options) ? options : {};
    var intensity = normalizeIntensity(options.intensity);
    if (intensity === 'off') return ordinaryPlan('disabled');
    var from = isRecord(options.from) ? options.from : null;
    var to = isRecord(options.to) ? options.to : null;
    if (!from || !to || finiteNumber(from.duration, 0) <= 0 || finiteNumber(to.duration, 0) <= 0) {
      return ordinaryPlan('missing-analysis');
    }
    var policy = PLAN_POLICIES[intensity];
    var tempo = normalizeTempoPair(from.bpm, to.bpm, { maxRelativeDiff: policy.maxTempoDiff });
    if (!tempo.valid) return ordinaryPlan('missing-tempo');
    if (!tempo.compatible) return ordinaryPlan('tempo-incompatible');
    var crossfadeMs = Math.min(1200, policy.crossfadeMs);
    var currentTimeSec = Math.max(0, finiteNumber(options.currentTimeSec, 0));
    var minimumExit = currentTimeSec + Math.max(1.5, crossfadeMs / 1000 + 0.35);
    var maximumExit = Math.max(0, finiteNumber(from.duration, 0) - 0.05);
    var exits = transitionBoundaries(from).filter(function(boundary) {
      return boundary.time >= minimumExit && boundary.time <= maximumExit;
    });
    var exit = exits.length ? exits[exits.length - 1] : null;
    if (!exit) return ordinaryPlan('no-safe-boundary');
    var exitEnergy = energyAt(from, exit.time);
    var entry = chooseEntryBoundary(to, policy, exitEnergy, intensity);
    if (!entry) return ordinaryPlan('no-entry-boundary');
    var entryEnergy = energyAt(to, entry.time);
    var energyScore = clamp01(1 - Math.abs(entryEnergy - exitEnergy));
    var keyScore = scoreKeyCompatibility(from.camelot || from.musicalKey, to.camelot || to.musicalKey);
    if (keyScore != null && keyScore < policy.minKeyScore) {
      return ordinaryPlan('key-incompatible');
    }
    var keyContribution = keyScore == null ? 0.74 : keyScore;
    var tempoScore = clamp01(1 - tempo.relativeDiff / Math.max(0.001, policy.maxTempoDiff));
    var gridScore = average([analysisConfidence(from), analysisConfidence(to)]);
    var confidence = clamp01(
      gridScore * 0.42
      + tempoScore * 0.23
      + keyContribution * 0.15
      + energyScore * 0.20
    );
    if (energyScore < policy.energyFloor || confidence < policy.minConfidence) {
      return ordinaryPlan(energyScore < policy.energyFloor ? 'energy-mismatch' : 'low-confidence');
    }
    return {
      mode: policy.mode,
      reason: intensity === 'subtle' ? 'safe-fade' : 'aligned-boundary',
      triggerAtSec: round(exit.time - crossfadeMs / 1000),
      entryAtSec: round(entry.time),
      crossfadeMs: crossfadeMs,
      confidence: round(confidence),
      tempo: tempo,
      key: {
        from: parseCamelot(from.camelot || from.musicalKey),
        to: parseCamelot(to.camelot || to.musicalKey),
        score: keyScore,
      },
      energy: {
        exit: round(exitEnergy),
        entry: round(entryEnergy),
        score: round(energyScore),
        direction: entryEnergy > exitEnergy + 0.04
          ? 'rise'
          : (entryEnergy < exitEnergy - 0.04 ? 'release' : 'level'),
      },
    };
  }

  function createTimelineExecutor(options) {
    options = isRecord(options) ? options : {};
    var generation = 0;
    var active = null;
    var state = 'idle';
    var lastReason = 'idle';

    function operationIsCurrent(operation) {
      return !!(
        operation
        && !operation.cancelled
        && operation.generation === generation
      );
    }

    function contextIsCurrent(operation) {
      if (!operationIsCurrent(operation)) return false;
      if (typeof options.isCurrent !== 'function') return true;
      try {
        return options.isCurrent(operation.context, operation.plan) !== false;
      } catch (_) {
        return false;
      }
    }

    function releaseOnce(operation, value, reason) {
      if (!operation || value == null || operation.ownershipTransferred) return false;
      if (operation.released.indexOf(value) >= 0) return false;
      operation.released.push(value);
      if (typeof options.release === 'function') {
        try {
          options.release(value, reason || operation.cancelReason || 'released');
        } catch (error) {
          operation.releaseError = error;
        }
      }
      return true;
    }

    function clearOperation(operation, reason) {
      if (active !== operation) return false;
      active = null;
      state = 'idle';
      lastReason = reason || lastReason;
      return true;
    }

    function cancel(reason) {
      reason = String(reason || 'cancelled');
      var operation = active;
      if (!operation || state === 'idle') return false;
      operation.cancelled = true;
      operation.cancelReason = reason;
      generation += 1;
      if (operation.prepared && !operation.ownershipTransferred) {
        releaseOnce(operation, operation.prepared, reason);
      }
      clearOperation(operation, reason);
      return true;
    }

    async function prepare(plan, context) {
      plan = isRecord(plan) ? plan : {};
      context = isRecord(context) ? context : {};
      if (active) cancel('replaced');
      var operation = {
        generation: ++generation,
        plan: plan,
        context: context,
        prepared: null,
        claimed: null,
        released: [],
        ownershipTransferred: false,
        fallbackUsed: false,
        cancelled: false,
        cancelReason: '',
        releaseError: null,
      };
      active = operation;
      state = 'preparing';
      lastReason = 'preparing';
      try {
        var prepared = typeof options.prepare === 'function'
          ? await options.prepare({ plan: plan, context: context, operation: operation })
          : null;
        operation.prepared = prepared;
        if (!contextIsCurrent(operation)) {
          releaseOnce(operation, prepared, operation.cancelReason || lastReason || 'stale');
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale' };
        }
        if (!prepared) {
          clearOperation(operation, 'prepare-failed');
          return { status: 'prepare-failed' };
        }
        state = 'armed';
        lastReason = 'armed';
        return { status: 'armed', plan: plan, prepared: prepared };
      } catch (error) {
        if (!contextIsCurrent(operation)) {
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale', error: error };
        }
        clearOperation(operation, 'prepare-error');
        return { status: 'error', error: error };
      }
    }

    async function runFallback(operation, error, fallbackOptions) {
      fallbackOptions = isRecord(fallbackOptions) ? fallbackOptions : {};
      var allowContextChange = fallbackOptions.allowContextChange === true;
      if (
        !operationIsCurrent(operation)
        || (!allowContextChange && !contextIsCurrent(operation))
        || operation.fallbackUsed
        || typeof options.fallback !== 'function'
      ) return { status: 'failed', error: error };
      operation.fallbackUsed = true;
      var result;
      try {
        result = await options.fallback({
          plan: operation.plan,
          context: operation.context,
          error: error,
          operation: operation,
          allowContextChange: allowContextChange,
        });
      } catch (fallbackError) {
        return { status: 'failed', error: fallbackError };
      }
      if (!operationIsCurrent(operation)) return { status: 'stale' };
      if (result && result.ok) return { status: 'fallback-complete', result: result };
      if (!allowContextChange && !contextIsCurrent(operation)) {
        return { status: 'stale', result: result };
      }
      return { status: 'failed', result: result, error: error };
    }

    async function tick(frame) {
      frame = isRecord(frame) ? frame : {};
      var operation = active;
      if (!operation || state === 'idle') return { status: 'idle' };
      if (state === 'preparing') return { status: 'preparing' };
      if (state === 'handing-off') return { status: 'handing-off' };
      if (!contextIsCurrent(operation)) {
        cancel('track-replacement');
        return { status: 'stale' };
      }
      if (finiteNumber(frame.currentTimeSec, 0) < finiteNumber(operation.plan.triggerAtSec, Infinity)) {
        return { status: 'waiting' };
      }
      state = 'handing-off';
      lastReason = 'handing-off';
      try {
        var claimed = typeof options.claim === 'function'
          ? await options.claim({
            prepared: operation.prepared,
            plan: operation.plan,
            context: operation.context,
            operation: operation,
          })
          : operation.prepared;
        operation.claimed = claimed;
        if (!contextIsCurrent(operation)) {
          releaseOnce(operation, claimed, operation.cancelReason || 'stale-claim');
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale' };
        }
        if (!claimed) {
          var missingClaim = new Error('Cuefield prepared playback is no longer available');
          missingClaim.code = 'CUEFIELD_CLAIM_FAILED';
          releaseOnce(operation, operation.prepared, 'claim-failed');
          var claimFallback = await runFallback(operation, missingClaim);
          clearOperation(operation, claimFallback.status);
          return claimFallback;
        }
        var handoffPending;
        try {
          handoffPending = typeof options.handoff === 'function'
            ? options.handoff({
            claimed: claimed,
            plan: operation.plan,
            context: operation.context,
            operation: operation,
          })
            : { ok: true };
        } catch (handoffInvokeError) {
          releaseOnce(operation, claimed, 'handoff-not-accepted');
          var invokeFallback = await runFallback(operation, handoffInvokeError);
          clearOperation(operation, invokeFallback.status);
          return invokeFallback;
        }
        operation.ownershipTransferred = true;
        var handoff = await handoffPending;
        if (!operationIsCurrent(operation)) {
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale', result: handoff };
        }
        if (handoff && handoff.ok) {
          clearOperation(operation, 'complete');
          return { status: 'complete', result: handoff };
        }
        var rolledBack = !!(
          handoff
          && handoff.retained === true
          && handoff.state === 'rolled-back'
        );
        if (!rolledBack && !contextIsCurrent(operation)) {
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale', result: handoff };
        }
        var handoffError = handoff && handoff.error
          ? handoff.error
          : new Error('Cuefield transactional handoff failed');
        var handoffFallback = await runFallback(operation, handoffError, {
          allowContextChange: rolledBack,
        });
        clearOperation(operation, handoffFallback.status);
        return handoffFallback;
      } catch (error) {
        if (!operationIsCurrent(operation)) {
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale', error: error };
        }
        if (!contextIsCurrent(operation)) {
          if (!operation.ownershipTransferred) {
            releaseOnce(
              operation,
              operation.claimed || operation.prepared,
              operation.claimed ? 'stale-handoff' : 'stale-claim'
            );
          }
          if (active === operation) clearOperation(operation, 'stale');
          return { status: 'stale', error: error };
        }
        if (!operation.ownershipTransferred) {
          releaseOnce(
            operation,
            operation.claimed || operation.prepared,
            operation.claimed ? 'handoff-not-accepted' : 'claim-error'
          );
        }
        var fallback = await runFallback(operation, error);
        clearOperation(operation, fallback.status);
        return fallback;
      }
    }

    function snapshot() {
      return {
        state: state,
        lastReason: lastReason,
        generation: generation,
        planId: active && active.plan && active.plan.id || '',
        identity: active && active.context && active.context.identity || '',
        fallbackUsed: !!(active && active.fallbackUsed),
      };
    }

    function release(reason) {
      return cancel(reason || 'release');
    }

    return Object.freeze({
      cancel: cancel,
      prepare: prepare,
      release: release,
      snapshot: snapshot,
      tick: tick,
    });
  }

  function createBrowserRuntime(options) {
    options = isRecord(options) ? options : {};
    var intensity = 'off';
    var identity = '';
    var planningGeneration = 0;
    var planningPromise = null;
    var armingPromise = null;
    var scheduled = null;
    var retryAfterMs = 0;
    var retryCount = 0;
    var lastPlan = null;
    var lastStatus = 'disabled';
    var retryDelayMs = Math.max(250, finiteNumber(options.retryDelayMs, 1200));
    var maxRetryDelayMs = Math.max(
      retryDelayMs,
      finiteNumber(options.maxRetryDelayMs, 30000)
    );
    var maxLateTriggerSec = clamp(
      options.maxLateTriggerSec == null ? 0.35 : options.maxLateTriggerSec,
      0,
      5
    );
    var preloadLeadSec = clamp(
      options.preloadLeadSec == null ? 10 : options.preloadLeadSec,
      2,
      30
    );

    function browserContextIsCurrent(context, plan) {
      if (!context || context.identity !== identity || intensity === 'off') return false;
      if (typeof options.isCurrent !== 'function') return true;
      try {
        return options.isCurrent(context, plan) !== false;
      } catch (_) {
        return false;
      }
    }

    var executor = createTimelineExecutor({
      prepare: options.prepare,
      claim: options.claim,
      handoff: options.handoff,
      fallback: options.fallback,
      release: options.release,
      isCurrent: browserContextIsCurrent,
    });

    function publish(status, detail) {
      lastStatus = status;
      if (typeof options.onStatus === 'function') {
        try {
          options.onStatus(status, detail || null);
        } catch (_) {}
      }
    }

    function scheduleRetry(nowMs) {
      retryCount += 1;
      retryAfterMs = nowMs + Math.min(
        maxRetryDelayMs,
        retryDelayMs * Math.pow(2, Math.min(8, retryCount - 1))
      );
    }

    function resetRetry() {
      retryAfterMs = 0;
      retryCount = 0;
    }

    function preparationNeedsRetry(result) {
      return !!(
        result
        && (result.status === 'prepare-failed' || result.status === 'error' || result.status === 'failed')
      );
    }

    function cancel(reason) {
      reason = String(reason || 'cancelled');
      var hadPlanning = !!(planningPromise || armingPromise);
      var hadScheduled = !!scheduled;
      var generationBumped = hadPlanning || hadScheduled;
      if (generationBumped) planningGeneration += 1;
      planningPromise = null;
      armingPromise = null;
      scheduled = null;
      var cancelled = executor.cancel(reason);
      if (cancelled && !generationBumped) planningGeneration += 1;
      var didCancel = hadPlanning || hadScheduled || cancelled;
      if (didCancel && typeof options.onCancel === 'function') {
        try {
          options.onCancel(reason);
        } catch (_) {}
      }
      if (hadPlanning || hadScheduled || cancelled || lastStatus !== reason) publish(reason);
      return didCancel;
    }

    function setIntensity(value) {
      var next = normalizeIntensity(value);
      if (next === intensity) return intensity;
      var previous = intensity;
      if (previous !== 'off') {
        cancel(next === 'off' ? 'feature-disabled' : 'intensity-changed');
      }
      intensity = next;
      resetRetry();
      if (intensity !== 'off') publish('waiting');
      return intensity;
    }

    function armScheduled(nowMs) {
      if (!scheduled || armingPromise) return null;
      var item = scheduled;
      var generation = planningGeneration;
      scheduled = null;
      publish('preparing', item.plan);
      armingPromise = Promise.resolve(executor.prepare(item.plan, item.context)).then(function(result) {
        if (generation === planningGeneration) {
          if (preparationNeedsRetry(result)) scheduleRetry(nowMs);
          else if (result && result.status === 'armed') resetRetry();
          publish(result.status, item.plan);
        }
        return result;
      }).catch(function(error) {
        if (generation === planningGeneration) {
          scheduleRetry(nowMs);
          publish('prepare-error', error);
        }
        return { status: 'error', error: error };
      }).finally(function() {
        if (generation === planningGeneration) armingPromise = null;
      });
      return armingPromise;
    }

    function beginPlanning(frame, nowMs) {
      if (planningPromise || typeof options.resolveContext !== 'function') return;
      var generation = ++planningGeneration;
      var expectedIdentity = identity;
      publish('planning');
      planningPromise = Promise.resolve().then(function() {
        return options.resolveContext(frame, {
          generation: generation,
          identity: expectedIdentity,
          isCurrent: function() {
            return generation === planningGeneration && expectedIdentity === identity && intensity !== 'off';
          },
        });
      }).then(function(resolved) {
        if (generation !== planningGeneration || expectedIdentity !== identity || intensity === 'off') return null;
        resolved = isRecord(resolved) ? resolved : {};
        var from = resolved.fromAnalysis || adaptBeatMap({
          track: resolved.fromTrack,
          map: resolved.fromMap,
          camelot: resolved.fromCamelot,
          musicalKey: resolved.fromMusicalKey,
        });
        var to = resolved.toAnalysis || adaptBeatMap({
          track: resolved.toTrack,
          map: resolved.toMap,
          camelot: resolved.toCamelot,
          musicalKey: resolved.toMusicalKey,
        });
        var plan = planTransition({
          intensity: intensity,
          currentTimeSec: frame.currentTimeSec,
          from: from,
          to: to,
        });
        lastPlan = plan;
        if (plan.mode === 'ordinary') {
          scheduleRetry(nowMs);
          publish('ordinary', plan);
          return { status: 'ordinary', plan: plan };
        }
        plan = Object.assign({
          id: expectedIdentity + '@' + String(plan.triggerAtSec) + ':' + intensity,
        }, plan);
        lastPlan = plan;
        var context = Object.assign({}, resolved.context || {}, frame.context || {}, {
          identity: expectedIdentity,
          frame: frame,
          from: from,
          to: to,
        });
        if (plan.triggerAtSec - Math.max(0, finiteNumber(frame.currentTimeSec, 0)) > preloadLeadSec) {
          scheduled = { plan: plan, context: context };
          resetRetry();
          publish('scheduled', plan);
          return { status: 'scheduled', plan: plan };
        }
        return executor.prepare(plan, context).then(function(result) {
          if (generation === planningGeneration) {
            if (preparationNeedsRetry(result)) scheduleRetry(nowMs);
            else if (result && result.status === 'armed') resetRetry();
            publish(result.status, plan);
          }
          return result;
        });
      }).catch(function(error) {
        if (generation === planningGeneration) {
          scheduleRetry(nowMs);
          publish('planning-error', error);
        }
        return { status: 'error', error: error };
      }).finally(function() {
        if (generation === planningGeneration) planningPromise = null;
      });
    }

    function tick(frame) {
      frame = isRecord(frame) ? frame : {};
      var nowMs = Math.max(0, finiteNumber(frame.nowMs, 0));
      var nextIdentity = String(frame.identity || '');
      if (nextIdentity !== identity) {
        cancel('track-replacement');
        identity = nextIdentity;
        resetRetry();
      }
      if (intensity === 'off' || !identity) return snapshot();
      if (frame.backgroundRelease === true) {
        cancel('background-release');
        return snapshot();
      }
      if (frame.playing === false) {
        cancel('pause');
        return snapshot();
      }
      var currentTimeSec = Math.max(0, finiteNumber(frame.currentTimeSec, 0));
      if (scheduled) {
        if (!browserContextIsCurrent(scheduled.context, scheduled.plan)) {
          cancel('track-replacement');
          return snapshot();
        }
        var scheduledTriggerAtSec = finiteNumber(scheduled.plan.triggerAtSec, Infinity);
        if (currentTimeSec > scheduledTriggerAtSec + maxLateTriggerSec) {
          scheduleRetry(nowMs);
          cancel('expired');
          return snapshot();
        }
        if (currentTimeSec >= scheduledTriggerAtSec - preloadLeadSec) armScheduled(nowMs);
        return snapshot();
      }
      var executorState = executor.snapshot().state;
      if (executorState === 'armed') {
        var triggerAtSec = finiteNumber(lastPlan && lastPlan.triggerAtSec, Infinity);
        if (currentTimeSec > triggerAtSec + maxLateTriggerSec) {
          scheduleRetry(nowMs);
          cancel('expired');
          return snapshot();
        }
        if (currentTimeSec < triggerAtSec) return snapshot();
        var executionGeneration = planningGeneration;
        var executionIdentity = identity;
        Promise.resolve(executor.tick({ currentTimeSec: frame.currentTimeSec })).then(function(result) {
          if (
            executionGeneration !== planningGeneration
            || executionIdentity !== identity
            || intensity === 'off'
          ) return result;
          if (preparationNeedsRetry(result)) scheduleRetry(nowMs);
          publish(result.status, result);
          return result;
        }).catch(function(error) {
          if (
            executionGeneration === planningGeneration
            && executionIdentity === identity
            && intensity !== 'off'
          ) {
            scheduleRetry(nowMs);
            publish('execution-error', error);
          }
          return { status: 'error', error: error };
        });
      } else if (
        executorState === 'idle'
        && !planningPromise
        && !armingPromise
        && nowMs >= retryAfterMs
      ) {
        beginPlanning(frame, nowMs);
      }
      return snapshot();
    }

    function settle() {
      return planningPromise || armingPromise || Promise.resolve(null);
    }

    function snapshot() {
      return {
        intensity: intensity,
        identity: identity,
        status: lastStatus,
        planning: !!(planningPromise || armingPromise),
        scheduled: !!scheduled,
        retryAfterMs: retryAfterMs,
        retryCount: retryCount,
        plan: lastPlan,
        executor: executor.snapshot(),
      };
    }

    function destroy() {
      cancel('destroy');
      identity = '';
      lastPlan = null;
      resetRetry();
    }

    return Object.freeze({
      cancel: cancel,
      destroy: destroy,
      setIntensity: setIntensity,
      settle: settle,
      snapshot: snapshot,
      tick: tick,
    });
  }

  return Object.freeze({
    analysisAdapter: Object.freeze({
      adaptBeatMap: adaptBeatMap,
    }),
    core: Object.freeze({
      normalizeIntensity: normalizeIntensity,
      normalizeTempoPair: normalizeTempoPair,
      parseCamelot: parseCamelot,
      scoreKeyCompatibility: scoreKeyCompatibility,
    }),
    createBrowserRuntime: createBrowserRuntime,
    timelineExecutor: Object.freeze({
      createTimelineExecutor: createTimelineExecutor,
    }),
    transitionPlanner: Object.freeze({
      planTransition: planTransition,
    }),
  });
});
