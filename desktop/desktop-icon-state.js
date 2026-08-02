'use strict';

/**
 * Bounded visual desktop-icon state.
 * Inspired by XxHuberrr/Mineradio desktop icon runtimes at
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only), but intentionally
 * owns no Explorer process, filesystem path, shell item, or native icon state.
 */

const MAX_DESKTOP_ICONS = 12;
const SAFE_ACTIONS = new Set([
  'focus-player',
  'open-library',
  'open-playlists',
  'open-settings',
]);

const DEFAULT_DESKTOP_ICONS = Object.freeze([
  Object.freeze({ id: 'player', label: '正在播放', glyph: 'play', action: 'focus-player' }),
  Object.freeze({ id: 'library', label: '音乐库', glyph: 'music', action: 'open-library' }),
  Object.freeze({ id: 'playlists', label: '歌单', glyph: 'list', action: 'open-playlists' }),
  Object.freeze({ id: 'settings', label: '设置', glyph: 'settings', action: 'open-settings' }),
]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function normalizeViewport(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    x: Math.round(clamp(value.x, -32768, 32768, 0)),
    y: Math.round(clamp(value.y, -32768, 32768, 0)),
    width: Math.max(1, Math.round(clamp(value.width, 1, 16384, 1280))),
    height: Math.max(1, Math.round(clamp(value.height, 1, 16384, 720))),
  };
}

function normalizeRect(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    x: Math.round(finite(value.x, 0)),
    y: Math.round(finite(value.y, 0)),
    width: Math.max(0, Math.round(finite(value.width, 0))),
    height: Math.max(0, Math.round(finite(value.height, 0))),
  };
}

function intersects(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function normalizeDesktopIconItems(items) {
  const source = Array.isArray(items) ? items : DEFAULT_DESKTOP_ICONS;
  const seen = new Set();
  const normalized = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim().toLowerCase();
    const action = String(item.action || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id) || seen.has(id) || !SAFE_ACTIONS.has(action)) continue;
    const glyph = /^[a-z][a-z0-9-]{0,23}$/.test(String(item.glyph || '')) ? String(item.glyph) : 'music';
    normalized.push({
      id,
      label: String(item.label || id).replace(/\s+/g, ' ').trim().slice(0, 32),
      glyph,
      action,
    });
    seen.add(id);
    if (normalized.length >= MAX_DESKTOP_ICONS) break;
  }
  return normalized;
}

function layoutDesktopIcons(viewportValue, itemsValue, options = {}) {
  const viewport = normalizeViewport(viewportValue);
  const items = normalizeDesktopIconItems(itemsValue);
  const margin = Math.round(clamp(options.margin, 12, 48, 18));
  const cellWidth = Math.round(clamp(options.cellWidth, 76, 128, 94));
  const cellHeight = Math.round(clamp(options.cellHeight, 84, 132, 102));
  const gapX = Math.round(clamp(options.gapX, 4, 32, 12));
  const gapY = Math.round(clamp(options.gapY, 4, 32, 12));
  const reserved = (Array.isArray(options.reserved) ? options.reserved : [])
    .slice(0, 8)
    .map(normalizeRect)
    .filter(rect => rect.width > 0 && rect.height > 0);
  const rows = Math.max(1, Math.floor((viewport.height - margin * 2 + gapY) / (cellHeight + gapY)));
  const columns = Math.max(1, Math.floor((viewport.width - margin * 2 + gapX) / (cellWidth + gapX)));
  const output = [];
  let slot = 0;
  const slotLimit = Math.max(items.length * 4, rows * columns);
  for (const item of items) {
    let bounds = null;
    while (slot < slotLimit) {
      const row = slot % rows;
      const column = Math.floor(slot / rows);
      slot += 1;
      if (column >= columns) break;
      const candidate = {
        x: margin + column * (cellWidth + gapX),
        y: margin + row * (cellHeight + gapY),
        width: Math.min(cellWidth, viewport.width - margin - (margin + column * (cellWidth + gapX))),
        height: Math.min(cellHeight, viewport.height - margin - (margin + row * (cellHeight + gapY))),
      };
      if (candidate.width <= 0 || candidate.height <= 0) continue;
      if (reserved.some(rect => intersects(candidate, rect))) continue;
      bounds = candidate;
      break;
    }
    if (!bounds) break;
    output.push({ ...item, bounds });
  }
  return {
    viewport,
    visible: options.visible !== false,
    locked: options.locked === true,
    rows,
    columns,
    items: output,
  };
}

function hitTestDesktopIcons(layout, point) {
  if (!layout || layout.visible === false || layout.locked === true || !Array.isArray(layout.items)) return null;
  const x = finite(point && point.x, Number.NaN);
  const y = finite(point && point.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (let index = layout.items.length - 1; index >= 0; index -= 1) {
    const item = layout.items[index];
    const bounds = item.bounds;
    if (x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height) {
      return { id: item.id, action: item.action, label: item.label };
    }
  }
  return null;
}

function createDesktopIconState(options = {}) {
  let viewport = normalizeViewport(options.viewport);
  let items = normalizeDesktopIconItems(options.items);
  let visible = options.visible !== false;
  let locked = options.locked === true;
  let reserved = Array.isArray(options.reserved) ? options.reserved.slice(0, 8) : [];
  let released = false;
  let layout = layoutDesktopIcons(viewport, items, { visible, locked, reserved });

  function rebuild() {
    layout = released
      ? { viewport, visible: false, locked, rows: 0, columns: 0, items: [] }
      : layoutDesktopIcons(viewport, items, { visible, locked, reserved });
    return layout;
  }

  return {
    configure(next = {}) {
      if (next.viewport) viewport = normalizeViewport(next.viewport);
      if (next.items) items = normalizeDesktopIconItems(next.items);
      if (Object.hasOwn(next, 'visible')) visible = next.visible !== false;
      if (Object.hasOwn(next, 'locked')) locked = next.locked === true;
      if (Array.isArray(next.reserved)) reserved = next.reserved.slice(0, 8);
      return rebuild();
    },
    resize(nextViewport) {
      viewport = normalizeViewport(nextViewport);
      return rebuild();
    },
    hitTest(point) {
      return hitTestDesktopIcons(layout, point);
    },
    release() {
      if (released) return false;
      released = true;
      rebuild();
      return true;
    },
    restore() {
      if (!released) return false;
      released = false;
      rebuild();
      return true;
    },
    snapshot() {
      return JSON.parse(JSON.stringify({ ...layout, released }));
    },
  };
}

module.exports = {
  DEFAULT_DESKTOP_ICONS,
  MAX_DESKTOP_ICONS,
  createDesktopIconState,
  hitTestDesktopIcons,
  layoutDesktopIcons,
  normalizeDesktopIconItems,
};
