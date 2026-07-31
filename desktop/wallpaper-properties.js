'use strict';

/**
 * Wallpaper state and Wallpaper Engine property normalization.
 * Adapted from XxHuberrr/Mineradio wallpaper-mode-runtime.js at
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * The property bridge and strict allowlist are Mineradio-local rewrites.
 */

const DEFAULT_COLORS = Object.freeze({
  primary: '#d6f8ff',
  secondary: '#9cffdf',
  highlight: '#fff0b8',
  glow: '#9cffdf',
});

const DEFAULT_WALLPAPER_STATE = Object.freeze({
  enabled: false,
  fullDesktop: false,
  desktopIcons: true,
  title: 'Mineradio',
  artist: '',
  cover: '',
  showCover: true,
  playing: false,
  preset: 0,
  opacity: 1,
  frameRate: 30,
  particleDensity: 1,
  paused: false,
  audioInput: true,
  colors: DEFAULT_COLORS,
});

const WALLPAPER_PROPERTY_KEYS = Object.freeze([
  'preset',
  'opacity',
  'fpstier',
  'cover',
  'particles',
  'pause',
  'audioinput',
]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function normalizeWallpaperFrameRate(value) {
  const number = finite(value, 30);
  if (number <= 26) return 24;
  if (number <= 45) return 30;
  return 60;
}

function normalizeHexColor(value, fallback) {
  let color = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    color = '#' + color.slice(1).split('').map(part => part + part).join('');
  }
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function normalizeCoverSource(value, fallback = '') {
  const source = String(value || '').trim();
  if (!source) return '';
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(source)) return fallback;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(source)) {
    return source.length <= 524288 ? source : fallback;
  }
  if (/^\/(?!\/)/.test(source) && !/(?:^|\/)\.\.(?:\/|$)/.test(source)) {
    return source.length <= 2048 ? source : fallback;
  }
  try {
    const parsed = new URL(source);
    if (parsed.username || parsed.password) return fallback;
    if (!['http:', 'https:', 'mineradio-local-file:'].includes(parsed.protocol)) return fallback;
    return source.length <= 4096 ? source : fallback;
  } catch (_) {
    return fallback;
  }
}

function own(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeWallpaperState(previous, payload, enabledOverride) {
  const current = previous && typeof previous === 'object' ? previous : DEFAULT_WALLPAPER_STATE;
  const source = payload && typeof payload === 'object' ? payload : {};
  const currentColors = current.colors && typeof current.colors === 'object'
    ? current.colors
    : DEFAULT_COLORS;
  const sourceColors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  const enabled = typeof enabledOverride === 'boolean'
    ? enabledOverride
    : own(source, 'enabled')
      ? source.enabled === true
      : current.enabled === true;
  return {
    enabled,
    fullDesktop: own(source, 'fullDesktop') ? source.fullDesktop === true : current.fullDesktop === true,
    desktopIcons: own(source, 'desktopIcons') ? source.desktopIcons !== false : current.desktopIcons !== false,
    title: String(own(source, 'title') ? source.title : current.title || 'Mineradio').slice(0, 160),
    artist: String(own(source, 'artist') ? source.artist : current.artist || '').slice(0, 160),
    cover: normalizeCoverSource(own(source, 'cover') ? source.cover : current.cover, current.cover || ''),
    showCover: own(source, 'showCover') ? source.showCover !== false : current.showCover !== false,
    playing: own(source, 'playing') ? source.playing === true : current.playing === true,
    preset: Math.round(clamp(own(source, 'preset') ? source.preset : current.preset, 0, 7, 0)),
    opacity: clamp(own(source, 'opacity') ? source.opacity : current.opacity, 0.35, 1, 1),
    frameRate: normalizeWallpaperFrameRate(own(source, 'frameRate') ? source.frameRate : current.frameRate),
    particleDensity: clamp(
      own(source, 'particleDensity') ? source.particleDensity : current.particleDensity,
      0.25,
      1.5,
      1,
    ),
    paused: own(source, 'paused') ? source.paused === true : current.paused === true,
    audioInput: own(source, 'audioInput') ? source.audioInput !== false : current.audioInput !== false,
    colors: {
      primary: normalizeHexColor(sourceColors.primary || currentColors.primary, DEFAULT_COLORS.primary),
      secondary: normalizeHexColor(sourceColors.secondary || currentColors.secondary, DEFAULT_COLORS.secondary),
      highlight: normalizeHexColor(sourceColors.highlight || currentColors.highlight, DEFAULT_COLORS.highlight),
      glow: normalizeHexColor(sourceColors.glow || currentColors.glow, DEFAULT_COLORS.glow),
    },
  };
}

function propertyValue(properties, key) {
  const property = properties && properties[key];
  if (property && typeof property === 'object' && own(property, 'value')) return property.value;
  return property;
}

function propertyBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'on') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false' || String(value).toLowerCase() === 'off') return false;
  return fallback;
}

function propertyFrameRate(value) {
  const tier = String(value || '').toLowerCase();
  if (tier === 'low' || tier === 'battery' || tier === '24') return 24;
  if (tier === 'high' || tier === 'quality' || tier === '60') return 60;
  if (tier === 'balanced' || tier === 'medium' || tier === '30') return 30;
  return normalizeWallpaperFrameRate(value);
}

function normalizeWallpaperPropertyPatch(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  const patch = {};
  if (own(properties, 'preset')) patch.preset = Math.round(clamp(propertyValue(properties, 'preset'), 0, 7, 0));
  if (own(properties, 'opacity')) {
    let value = finite(propertyValue(properties, 'opacity'), 100);
    if (value > 1) value /= 100;
    patch.opacity = clamp(value, 0.35, 1, 1);
  }
  if (own(properties, 'fpstier')) patch.frameRate = propertyFrameRate(propertyValue(properties, 'fpstier'));
  if (own(properties, 'cover')) patch.showCover = propertyBoolean(propertyValue(properties, 'cover'), true);
  if (own(properties, 'particles')) {
    let value = finite(propertyValue(properties, 'particles'), 100);
    if (value > 2) value /= 100;
    patch.particleDensity = clamp(value, 0.25, 1.5, 1);
  }
  if (own(properties, 'pause')) patch.paused = propertyBoolean(propertyValue(properties, 'pause'), false);
  if (own(properties, 'audioinput')) patch.audioInput = propertyBoolean(propertyValue(properties, 'audioinput'), true);
  return patch;
}

function createWallpaperPropertyBridge(options = {}) {
  const target = options.target || globalThis;
  const onPatch = typeof options.onPatch === 'function' ? options.onPatch : () => {};
  const previous = target.wallpaperPropertyListener;
  let disposed = false;
  const listener = {
    applyUserProperties(properties) {
      if (previous && typeof previous.applyUserProperties === 'function') {
        previous.applyUserProperties.call(previous, properties);
      }
      const patch = normalizeWallpaperPropertyPatch(properties);
      onPatch(patch);
      return patch;
    },
  };
  target.wallpaperPropertyListener = listener;
  return {
    listener,
    dispose() {
      if (disposed) return false;
      disposed = true;
      if (target.wallpaperPropertyListener === listener) target.wallpaperPropertyListener = previous;
      return true;
    },
  };
}

module.exports = {
  DEFAULT_WALLPAPER_STATE,
  WALLPAPER_PROPERTY_KEYS,
  createWallpaperPropertyBridge,
  normalizeCoverSource,
  normalizeWallpaperFrameRate,
  normalizeWallpaperPropertyPatch,
  normalizeWallpaperState,
};
