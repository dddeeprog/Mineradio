'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../../third_party/folia-major/node_modules/@playwright/test');
const { PNG } = require('../../third_party/folia-major/node_modules/pngjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const screenshotRoot = path.join(repoRoot, 'screenshots', 'wallpaper');
const viewports = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1366x768', width: 1366, height: 768 },
];

function iconLayout(width, height) {
  const entries = [
    ['player', '正在播放', 'play', 'focus-player'],
    ['library', '音乐库', 'music', 'open-library'],
    ['playlists', '歌单', 'list', 'open-playlists'],
    ['settings', '设置', 'settings', 'open-settings'],
  ];
  return {
    visible: true,
    locked: false,
    items: entries.map((entry, index) => ({
      id: entry[0],
      label: entry[1],
      glyph: entry[2],
      action: entry[3],
      bounds: {
        x: 18,
        y: 18 + index * 114,
        width: Math.min(94, width - 36),
        height: Math.min(102, height - 36),
      },
    })),
  };
}

function analyzePixels(buffer) {
  const image = PNG.sync.read(buffer);
  const step = Math.max(1, Math.floor((image.width * image.height) / 30000));
  let sum = 0;
  let square = 0;
  let colorful = 0;
  let count = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel += step) {
    const offset = pixel * 4;
    const channels = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    const light = (channels[0] + channels[1] + channels[2]) / 3;
    sum += light;
    square += light * light;
    if (Math.max(...channels) - Math.min(...channels) > 8) colorful += 1;
    count += 1;
  }
  const mean = sum / count;
  return {
    mean,
    deviation: Math.sqrt(Math.max(0, square / count - mean * mean)),
    colorfulRatio: colorful / count,
  };
}

test('wallpaper and complete desktop render across desktop and narrow viewports', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/wallpaper.html', { waitUntil: 'networkidle' });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(layout => {
      window.__wallpaperAction = null;
      window.addEventListener('mineradio-wallpaper-icon-action', event => {
        window.__wallpaperAction = event.detail;
      }, { once: true });
      window.applyState({
        enabled: true,
        fullDesktop: true,
        desktopIcons: true,
        playing: true,
        preset: 4,
        opacity: 0.92,
        frameRate: 30,
        particleDensity: 1.1,
        hostKind: 'wallpaper-engine',
        iconLayout: layout,
        colors: { primary: '#7fd8ff', secondary: '#9cffdf', highlight: '#fff0b8', glow: '#62d5ff' },
      });
      window.wallpaperPropertyListener.applyUserProperties({
        fpstier: { value: 'high' },
        particles: { value: 125 },
        audioinput: { value: true },
      });
    }, iconLayout(viewport.width, viewport.height));
    await page.waitForTimeout(600);

    const icons = page.locator('.desktop-icon-item');
    await expect(icons).toHaveCount(4);
    await icons.first().click();
    await expect.poll(() => page.evaluate(() => window.__wallpaperAction && window.__wallpaperAction.action)).toBe('focus-player');
    const snapshot = await page.evaluate(() => window.__mineradioWallpaperSnapshot());
    expect(snapshot.frameRate).toBe(60);
    expect(snapshot.particleDensity).toBe(1.25);
    expect(snapshot.particles).toBeGreaterThanOrEqual(120);
    expect(snapshot.particles).toBeLessThanOrEqual(900);

    fs.mkdirSync(screenshotRoot, { recursive: true });
    const buffer = await page.screenshot({ path: path.join(screenshotRoot, `task11-${viewport.name}.png`) });
    const pixels = analyzePixels(buffer);
    expect(pixels.mean).toBeGreaterThan(3);
    expect(pixels.deviation).toBeGreaterThan(2);
    expect(pixels.colorfulRatio).toBeGreaterThan(0.01);
  }

  await page.evaluate(layout => window.applyState({ hostKind: 'mineradio-workerw', iconLayout: layout }), iconLayout(390, 844));
  const locked = await page.evaluate(() => ({
    ariaHidden: document.getElementById('desktop-icon-layer').getAttribute('aria-hidden'),
    disabled: [...document.querySelectorAll('.desktop-icon-item')].every(node => node.disabled),
  }));
  expect(locked).toEqual({ ariaHidden: 'true', disabled: true });
  expect(errors).toEqual([]);
});

test('settings expose complete desktop controls without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.organizeFxPanel === 'function' && typeof window.setFxPanelTab === 'function');
  await page.evaluate(() => {
    const splash = document.getElementById('splash');
    if (splash) splash.style.display = 'none';
    document.body.classList.remove('splash-active');
    window.applyDiyMode(true, { save: false });
    window.organizeFxPanel();
    window.setFxPanelTab('motion');
    const panel = document.getElementById('fx-panel');
    panel.classList.remove('peek', 'closing');
    panel.classList.add('show');
    const fold = document.getElementById('fx-overlay-fold');
    fold.classList.add('open');
    panel.scrollTop = Math.max(0, fold.offsetTop - 20);
    document.getElementById('fx-wallpaperparticles').scrollIntoView({ block: 'center' });
  });

  const ids = ['t-wallpaperMode', 't-fullDesktopMode', 't-wallpaperDesktopIcons', 'wallpaper-fps-seg', 'fx-wallpaperparticles'];
  for (const id of ids) await expect(page.locator('#' + id)).toHaveCount(1);
  await expect(page.locator('#fx-wallpaperparticles')).toBeVisible({ timeout: 5000 });
  const layout = await page.evaluate(controlIds => {
    const panel = document.getElementById('fx-panel').getBoundingClientRect();
    return controlIds.map(id => {
      const target = document.getElementById(id);
      const rect = target.getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, panelLeft: panel.left, panelRight: panel.right };
    });
  }, ids);
  for (const rect of layout) {
    expect(rect.right).toBeGreaterThan(rect.left);
    expect(rect.bottom).toBeGreaterThan(rect.top);
    expect(rect.left).toBeGreaterThanOrEqual(rect.panelLeft - 1);
    expect(rect.right).toBeLessThanOrEqual(rect.panelRight + 1);
  }
  fs.mkdirSync(screenshotRoot, { recursive: true });
  await page.screenshot({ path: path.join(screenshotRoot, 'task11-settings-1366x768.png') });
});
