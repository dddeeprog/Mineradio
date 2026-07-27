/*
 * Classic three-character lyric motion adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.MineradioNativeLyricClassicThreeMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var PROFILES = Object.freeze({
    normal: Object.freeze({ wordRevealMode: 'normal', lookahead: 0.15, entryDurationMs: 420, passedDurationMs: 500, colorReturnDurationMs: 800 }),
    fast: Object.freeze({ wordRevealMode: 'fast', lookahead: 0.08, entryDurationMs: 240, passedDurationMs: 240, colorReturnDurationMs: 240 }),
    instant: Object.freeze({ wordRevealMode: 'instant', lookahead: 0.03, entryDurationMs: 120, passedDurationMs: 120, colorReturnDurationMs: 120 }),
  });
  var POSE_DEFAULTS = { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotation: 0, scale: 1, opacity: 1 };
  var POSE_CHANNELS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotation', 'scale', 'opacity'];

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1, 0);
    return value * value * (3 - 2 * value);
  }

  function springStep(time) {
    return 1 - Math.exp(-10 * time) * (
      Math.cos(10 * time) + Math.sin(10 * time)
    );
  }

  var SPRING_END = springStep(0.42);

  function resolveClassicMotionProfile(renderProfile) {
    if (renderProfile === PROFILES.normal || renderProfile === PROFILES.fast || renderProfile === PROFILES.instant) {
      return renderProfile;
    }
    var requested = typeof renderProfile === 'string'
      ? renderProfile
      : renderProfile && renderProfile.wordRevealMode;
    var mode = requested === 'fast' || requested === 'instant' ? requested : 'normal';
    return PROFILES[mode];
  }

  function evaluateClassicEntryProgress(elapsedSeconds, profile) {
    profile = profile && profile.entryDurationMs
      ? profile
      : resolveClassicMotionProfile(profile);
    var duration = Math.max(0.001, finite(profile.entryDurationMs, 420) / 1000);
    var u = clamp(finite(elapsedSeconds, 0) / duration, 0, 1, 0);
    if (u >= 1) return 1;
    return springStep(u * 0.42) / SPRING_END;
  }

  function poseValue(pose, channel, fallback) {
    return finite(pose && pose[channel], fallback);
  }

  function entryProgressAt(now, trigger, profile, reducedMotion) {
    var elapsed = now - trigger;
    if (reducedMotion) return smoothstep(elapsed / 0.12);
    return evaluateClassicEntryProgress(elapsed, profile);
  }

  function resolveClassicGroupPose(group, now, renderProfile, options) {
    group = group || {};
    options = options || {};
    var profile = resolveClassicMotionProfile(renderProfile);
    var reducedMotion = Boolean(options.reducedMotion);
    var startTime = finite(group.startTime, 0);
    var endTime = Math.max(startTime, finite(group.endTime, startTime));
    var activeEnd = Number(group.activeEndTime);
    var trigger = startTime - profile.lookahead;
    var passedStart = Math.max(trigger, isFinite(activeEnd) ? activeEnd : endTime);
    var currentTime = finite(now, 0);
    var entryPose = group.entryPose || {};
    var activePose = group.activePose || {};
    var passedPose = group.passedPose || {};
    var pose = {};
    var phase;
    var entryProgress;
    var passedProgress = 0;

    if (currentTime < trigger) {
      phase = 'waiting';
      entryProgress = 0;
    } else if (currentTime < passedStart) {
      entryProgress = entryProgressAt(currentTime, trigger, profile, reducedMotion);
      phase = entryProgress >= 1 ? 'active' : 'entering';
    } else {
      entryProgress = entryProgressAt(passedStart, trigger, profile, reducedMotion);
      var passedDurationMs = reducedMotion ? 120 : profile.passedDurationMs;
      passedProgress = smoothstep((currentTime - passedStart) * 1000 / passedDurationMs);
      phase = 'passed';
    }

    POSE_CHANNELS.forEach(function(channel) {
      var entryValue = poseValue(entryPose, channel, POSE_DEFAULTS[channel]);
      if (phase === 'waiting') {
        pose[channel] = entryValue;
        return;
      }
      var activeValue = poseValue(activePose, channel, POSE_DEFAULTS[channel]);
      var boundaryValue = entryValue + (activeValue - entryValue) * entryProgress;
      if (phase !== 'passed') {
        pose[channel] = boundaryValue;
        return;
      }
      var passedValue = poseValue(passedPose, channel, activeValue);
      pose[channel] = boundaryValue + (passedValue - boundaryValue) * passedProgress;
    });

    if (!reducedMotion && phase === 'passed' && passedProgress >= 1) {
      var driftLimit = clamp(group.driftRotation, -3, 3, 0);
      var driftElapsed = Math.max(0, currentTime - passedStart - profile.passedDurationMs / 1000);
      pose.rotation += driftLimit * clamp(driftElapsed / 5, 0, 1, 0);
    }

    if (reducedMotion) {
      pose.z = 0;
      pose.rotationX = 0;
      pose.rotationY = 0;
      pose.rotation = 0;
    }

    var colorDurationMs = reducedMotion ? 120 : profile.colorReturnDurationMs;
    var colorReturn = currentTime < passedStart
      ? 0
      : smoothstep((currentTime - passedStart) * 1000 / colorDurationMs);

    pose.phase = phase;
    pose.status = phase;
    pose.entryProgress = clamp(entryProgress, 0, 1.04, 0);
    pose.colorReturn = colorReturn;
    return pose;
  }

  function resolveClassicGraphemeVisual(grapheme, group, now, renderProfile, strength) {
    grapheme = grapheme || {};
    group = group || {};
    var profile = resolveClassicMotionProfile(renderProfile);
    var groupStart = finite(group.startTime, 0);
    var groupEnd = Math.max(groupStart, finite(group.endTime, groupStart));
    var startTime = finite(grapheme.startTime, groupStart);
    var endTime = Math.max(startTime, finite(grapheme.endTime, groupEnd));
    var baseAttackSeconds = profile.wordRevealMode === 'instant' ? 0.04
      : profile.wordRevealMode === 'fast' ? 0.05 : 0.08;
    var tailSeconds = profile.wordRevealMode === 'instant' ? 0.08
      : profile.wordRevealMode === 'fast' ? 0.12 : 0.24;
    if (profile.wordRevealMode === 'instant') endTime = Math.min(endTime, startTime + 0.04);
    var durationSeconds = endTime - startTime;
    if (durationSeconds <= 0) return { highlight: 0, glow: 0 };
    var attackSeconds = Math.min(baseAttackSeconds, durationSeconds);
    var currentTime = finite(now, 0);
    var highlight = 0;

    if (currentTime >= startTime && currentTime < endTime + tailSeconds) {
      if (currentTime < endTime) {
        highlight = smoothstep((currentTime - startTime) / attackSeconds);
      } else {
        highlight = 1 - smoothstep((currentTime - endTime) / tailSeconds);
      }
    }

    highlight = clamp(highlight, 0, 1, 0);
    return {
      highlight: highlight,
      glow: clamp(highlight * clamp(strength, 0, 1, 0), 0, 1, 0),
    };
  }

  function resolveClassicLineExit(lineTransitionMode, elapsedMs, reducedMotion) {
    var mode = reducedMotion ? 'none' : String(lineTransitionMode || 'normal');
    if (mode !== 'fast' && mode !== 'none') mode = 'normal';
    var durationMs = mode === 'normal' ? 300 : mode === 'fast' ? 160 : 120;
    var maxScale = mode === 'normal' ? 1.04 : mode === 'fast' ? 1.02 : 1;
    var maxBlur = mode === 'normal' ? 12 : mode === 'fast' ? 6 : 0;
    var safeElapsed = Math.max(0, finite(elapsedMs, 0));
    var progress = smoothstep(safeElapsed / durationMs);
    return {
      progress: progress,
      opacity: 1 - progress,
      scale: 1 + (maxScale - 1) * progress,
      blurPx: maxBlur * progress,
      done: safeElapsed >= durationMs,
      durationMs: durationMs,
    };
  }

  return {
    resolveClassicMotionProfile: resolveClassicMotionProfile,
    evaluateClassicEntryProgress: evaluateClassicEntryProgress,
    resolveClassicGroupPose: resolveClassicGroupPose,
    resolveClassicGraphemeVisual: resolveClassicGraphemeVisual,
    resolveClassicLineExit: resolveClassicLineExit,
  };
});
