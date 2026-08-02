'use strict';

/**
 * State-only wallpaper diagnostics. Raw HWNDs, paths, URLs, song metadata,
 * native stdout, and native stderr are intentionally excluded.
 * Designed for the XxHuberrr/Mineradio wallpaper lifecycle adapted from
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 */

const DEFAULT_MAX_EVENTS = 32;

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function diagnosticCode(value, fallback = '') {
  const text = String(value || '').toUpperCase();
  const match = text.match(/(?:WALLPAPER|FULL_DESKTOP)_[A-Z0-9_]+/);
  return match ? match[0].slice(0, 96) : fallback;
}

function sanitizeStatus(status = {}) {
  return {
    enabled: status.enabled === true,
    active: status.active === true,
    phase: String(status.phase || '').slice(0, 32),
    parentKind: status.parentKind === 'progman' ? 'progman' : status.parentKind === 'workerw' ? 'workerw' : '',
    fallback: status.fallback === true,
    fullDesktop: status.fullDesktop === true,
    desktopIcons: status.desktopIcons !== false,
    systemPaused: status.systemPaused === true,
    generation: boundedInteger(status.generation, 0, 1000000000, 0),
    windowCount: boundedInteger(status.windowCount, 0, 1, 0),
    attachAttempts: boundedInteger(status.attachAttempts, 0, 16, 0),
    retryCount: boundedInteger(status.retryCount, 0, 15, 0),
    lastError: diagnosticCode(status.lastError || status.error),
  };
}

function createWallpaperDiagnostics(options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const maxEvents = boundedInteger(options.maxEvents, 4, 128, DEFAULT_MAX_EVENTS);
  const events = [];
  let sequence = 0;

  return {
    record(type, status) {
      const event = {
        sequence: ++sequence,
        at: boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER, 0),
        type: String(type || 'state').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'state',
        state: sanitizeStatus(status),
      };
      events.push(event);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
      return event;
    },
    snapshot(current) {
      return {
        version: 1,
        current: sanitizeStatus(current),
        events: events.map(event => ({ ...event, state: { ...event.state } })),
      };
    },
    clear() {
      events.length = 0;
    },
  };
}

module.exports = {
  createWallpaperDiagnostics,
  diagnosticCode,
  sanitizeStatus,
};
