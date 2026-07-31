'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DESKTOP_ICONS,
  createDesktopIconState,
  hitTestDesktopIcons,
  layoutDesktopIcons,
  normalizeDesktopIconItems,
} = require('./desktop-icon-state');

test('desktop icons are a fixed action allowlist without filesystem paths or URLs', () => {
  const normalized = normalizeDesktopIconItems([
    ...DEFAULT_DESKTOP_ICONS,
    { id: 'unsafe', label: 'Unsafe', action: 'open-path', path: 'C:\\private', url: 'file:///private' },
  ]);

  assert.equal(normalized.length <= 12, true);
  assert.equal(normalized.some(item => item.id === 'unsafe'), false);
  assert.equal(JSON.stringify(normalized).includes('C:\\private'), false);
  assert.equal(JSON.stringify(normalized).includes('file:'), false);
});

test('desktop icon layout is deterministic, column-major, and avoids reserved controls', () => {
  const viewport = { x: -1920, y: 0, width: 960, height: 540 };
  const reserved = [{ x: 18, y: 18, width: 110, height: 116 }];
  const first = layoutDesktopIcons(viewport, DEFAULT_DESKTOP_ICONS, { reserved });
  const second = layoutDesktopIcons(viewport, DEFAULT_DESKTOP_ICONS, { reserved });

  assert.deepEqual(first, second);
  assert.equal(first.items.length, DEFAULT_DESKTOP_ICONS.length);
  assert.equal(first.items[0].bounds.y >= 134, true);
  assert.equal(first.items.every(item => item.bounds.x >= 0 && item.bounds.y >= 0), true);
  assert.equal(first.items.every(item => item.bounds.x + item.bounds.width <= viewport.width), true);
  assert.equal(first.items.every(item => item.bounds.y + item.bounds.height <= viewport.height), true);
});

test('desktop icon hit testing respects visibility, lock state, and exact bounds', () => {
  const layout = layoutDesktopIcons({ width: 1280, height: 720 }, DEFAULT_DESKTOP_ICONS);
  const target = layout.items[0];
  const point = {
    x: target.bounds.x + target.bounds.width / 2,
    y: target.bounds.y + target.bounds.height / 2,
  };

  assert.equal(hitTestDesktopIcons(layout, point).id, target.id);
  assert.equal(hitTestDesktopIcons({ ...layout, visible: false }, point), null);
  assert.equal(hitTestDesktopIcons({ ...layout, locked: true }, point), null);
  assert.equal(hitTestDesktopIcons(layout, { x: -1, y: -1 }), null);
});

test('desktop icon state releases layout and restores one bounded snapshot', () => {
  const state = createDesktopIconState({
    viewport: { width: 1366, height: 768 },
    visible: true,
    items: DEFAULT_DESKTOP_ICONS,
  });
  assert.equal(state.snapshot().items.length > 0, true);
  assert.equal(state.hitTest({ x: 40, y: 40 }) != null, true);

  assert.equal(state.release(), true);
  assert.equal(state.snapshot().items.length, 0);
  assert.equal(state.hitTest({ x: 40, y: 40 }), null);
  assert.equal(state.release(), false);

  assert.equal(state.restore(), true);
  assert.equal(state.snapshot().items.length > 0, true);
  assert.equal(state.restore(), false);
});
