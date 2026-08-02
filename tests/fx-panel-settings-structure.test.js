const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const appCss = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

function readFxPanelHomeItems() {
  const match = indexHtml.match(/var\s+FX_PANEL_HOME_ITEMS\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(match, 'FX_PANEL_HOME_ITEMS should define the settings home entries');
  const context = {};
  vm.runInNewContext(`items = ${match[1]}`, context);
  return context.items;
}

test('visual settings home exposes one-column entries in Mineradio order', () => {
  const items = Array.from(readFxPanelHomeItems());

  assert.deepEqual(items.map((item) => item.id), [
    'presets',
    'appearance',
    'lyrics',
    'motion',
    'advanced',
  ]);
  assert.deepEqual(items.map((item) => item.label), [
    '预设',
    '外观',
    '歌词',
    '动态',
    '高级',
  ]);
  assert.deepEqual(items.map((item) => item.icon), [
    'sliders',
    'palette',
    'lyrics',
    'motion',
    'advanced',
  ]);
});

test('visual settings panel has a home view and back navigation hook', () => {
  readFxPanelHomeItems();

  assert.match(indexHtml, /className\s*=\s*'fx-panel-home'/);
  assert.match(indexHtml, /function\s+showFxPanelHome\s*\(/);
  assert.match(indexHtml, /function\s+setFxPanelTab\s*\(\s*tab\s*,\s*opts\s*\)/);
});

test('visual settings panel animates between home and category pages', () => {
  assert.match(indexHtml, /function\s+setFxPanelTransition\s*\(\s*panel\s*,\s*direction\s*\)/);
  assert.match(indexHtml, /setFxPanelTransition\s*\(\s*panel\s*,\s*'back'\s*\)/);
  assert.match(indexHtml, /setFxPanelTransition\s*\(\s*panel\s*,\s*'forward'\s*\)/);

  assert.match(appCss, /#fx-panel\.fx-view-forward\s+\.fx-tab-page\.active/);
  assert.match(appCss, /#fx-panel\.fx-view-back\s+\.fx-panel-home\.active/);
  assert.match(appCss, /@keyframes\s+fxPanelPageIn/);
  assert.match(appCss, /prefers-reduced-motion:\s*reduce/);
});

test('visual settings sticky header completely owns the panel top while scrolling', () => {
  assert.match(appCss, /#fx-panel\{[^}]*isolation:isolate[^}]*padding:0 18px 20px/);
  assert.match(appCss, /#fx-panel > \.fx-head\{[^}]*top:0[^}]*z-index:20[^}]*margin:0 -18px 16px[^}]*background:rgb\(10,12,15\)/);
  assert.match(appCss, /\.fx-panel-home\{display:none;position:relative;z-index:0\}/);
  assert.match(appCss, /\.fx-tab-page\{display:none;position:relative;z-index:0\}/);
  assert.match(appCss, /body\.desktop-shell\.diy-mode #fx-panel\{[^}]*padding:0 14px 14px/);
  assert.match(appCss, /body\.desktop-shell\.diy-mode #fx-panel > \.fx-head\{margin:0 -14px 14px/);
});

test('visual settings home renders icon card rows with staggered motion', () => {
  assert.match(indexHtml, /function\s+fxPanelHomeIconSvg\s*\(\s*icon\s*\)/);
  assert.match(indexHtml, /className\s*=\s*'fx-panel-home-icon'/);
  assert.match(indexHtml, /className\s*=\s*'fx-panel-home-copy'/);
  assert.match(indexHtml, /className\s*=\s*'fx-panel-home-arrow'/);
  assert.match(indexHtml, /style\.setProperty\s*\(\s*'--fx-home-index'\s*,\s*idx\s*\)/);

  assert.match(appCss, /\.fx-panel-home-icon/);
  assert.match(appCss, /\.fx-panel-home-copy/);
  assert.match(appCss, /\.fx-panel-home-arrow/);
  assert.match(appCss, /@keyframes\s+fxPanelHomeCardIn/);
  assert.match(appCss, /animation-delay:calc\(var\(--fx-home-index\)\s*\*\s*28ms\)/);
});
