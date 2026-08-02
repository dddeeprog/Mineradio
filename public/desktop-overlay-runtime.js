(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioDesktopOverlayRuntime = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function boundedNumber(value, minimum, maximum, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function normalizeRenderPressureLevel(loadTier, sampledFps) {
    var level = Math.round(boundedNumber(loadTier, 0, 2, 0));
    var fps = Number(sampledFps);
    if (isFinite(fps) && fps > 0 && fps < 24) level = Math.max(level, 2);
    else if (isFinite(fps) && fps > 0 && fps < 42) level = Math.max(level, 1);
    return Math.max(0, Math.min(2, level));
  }

  function desktopOverlaySyncDelay(options) {
    var settings = options || {};
    if (settings.hidden) return 900;
    var pressure = normalizeRenderPressureLevel(settings.pressure, 0);
    if (pressure >= 2) return 620;
    if (pressure >= 1) return 420;
    return 320;
  }

  function desktopLyricsPushInterval(options) {
    var settings = options || {};
    var fps = Number(settings.fps);
    if (!isFinite(fps) || fps <= 0) return 8;
    var interval = Math.max(8, Math.min(42, 1000 / fps));
    if (settings.hidden) return Math.max(interval, 120);
    var pressure = normalizeRenderPressureLevel(settings.pressure, 0);
    if (pressure >= 2) return Math.max(interval * 1.75, 38);
    if (pressure >= 1) return Math.max(interval * 1.25, 26);
    return interval;
  }

  function pointInRect(pointer, rect) {
    if (!pointer || !rect) return false;
    var x = Number(pointer.clientX);
    var y = Number(pointer.clientY);
    var left = Number(rect.left);
    var top = Number(rect.top);
    var right = Number(rect.right);
    var bottom = Number(rect.bottom);
    if (![x, y, left, top, right, bottom].every(isFinite)) return false;
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  function shouldCaptureLockedControl(options) {
    var settings = options || {};
    return !!settings.locked && !!settings.hintVisible && pointInRect(settings.pointer, settings.rect);
  }

  function createOverlayScheduler(options) {
    var settings = options || {};
    var setTimer = typeof settings.setTimeout === 'function' ? settings.setTimeout : setTimeout;
    var clearTimer = typeof settings.clearTimeout === 'function' ? settings.clearTimeout : clearTimeout;
    var isActive = typeof settings.isActive === 'function' ? settings.isActive : function() { return false; };
    var tick = typeof settings.tick === 'function' ? settings.tick : function() {};
    var onInactive = typeof settings.onInactive === 'function' ? settings.onInactive : function() {};
    var getDelay = typeof settings.getDelay === 'function' ? settings.getDelay : function() { return 320; };
    var timer = null;

    function pending() {
      return timer !== null;
    }

    function cancel() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    }

    function schedule(delay) {
      if (!isActive()) {
        cancel();
        onInactive();
        return false;
      }
      if (pending()) return true;
      var timeout = Number(delay);
      if (!isFinite(timeout)) timeout = getDelay();
      timer = setTimer(function() {
        timer = null;
        if (!isActive()) {
          onInactive();
          return;
        }
        tick();
        if (!isActive()) {
          onInactive();
          return;
        }
        schedule(getDelay());
      }, Math.max(0, timeout));
      return true;
    }

    return { schedule: schedule, cancel: cancel, pending: pending };
  }

  return {
    normalizeRenderPressureLevel: normalizeRenderPressureLevel,
    desktopOverlaySyncDelay: desktopOverlaySyncDelay,
    desktopLyricsPushInterval: desktopLyricsPushInterval,
    pointInRect: pointInRect,
    shouldCaptureLockedControl: shouldCaptureLockedControl,
    createOverlayScheduler: createOverlayScheduler,
  };
});
