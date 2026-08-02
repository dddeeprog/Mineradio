# Folia DIY 配置接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Folia 歌词舞台的可调效果收敛到 Mineradio 的 DIY 面板中配置，并通过 Mineradio -> Folia bridge 实时推送给 Folia 舞台应用。

**Architecture:** Mineradio 仍然是播放器与设置中心，Folia 仍然作为独立 iframe 舞台运行。新增 `foliaFx` 配置状态，Mineradio DIY 面板负责编辑和持久化，`MineradioFoliaBridge` 负责随播放状态一起推送，Folia 的 bridge mode 负责消费并映射到自己的 visualizer、歌词、主题和性能参数。

**Tech Stack:** Mineradio renderer plain HTML/CSS/JS、UMD helper、`postMessage` bridge、Node test runner、Folia React/Vite/TypeScript、Vitest。

---

## Scope

本计划只做 Folia 效果配置接入，不重新设计 Folia 舞台，不让 Folia 接管播放，也不新增音乐平台登录能力。

必须保持：

- Mineradio 控制播放、队列、歌词来源和主设置。
- Folia 只消费 Mineradio 推送的 `song`、`playback`、`lyrics`、`audio`、`theme`、`foliaFx`。
- Folia 舞台在 Mineradio 内打开时不再要求连接网易云。
- DIY 调整参数时实时更新 Folia，不重载 iframe、不重新拉歌词、不重新播放。
- 没有构建 Folia 舞台或 Folia bridge mode 出错时，Mineradio 原歌词和播放器继续可用。

## File Structure

### Mineradio 侧

- Create: `public/folia-fx-state.js`
  - 负责 Folia DIY 配置的默认值、归一化、clamp、局部 patch、持久化对象清洗、bridge payload 生成。
- Modify: `public/folia-bridge-state.js`
  - 在 bridge snapshot 中加入 `foliaFx`，并纳入 snapshot key。
- Modify: `public/index.html`
  - 在 DIY 面板新增 Folia 舞台配置区。
  - 读取/保存 `mineradio-folia-fx-v1`。
  - 绑定滑杆/分段控件/开关。
  - 在控件变化时调用 `pushFoliaPlaybackBridge('folia-fx-state', { force:true })`。
- Modify: `public/styles/app.css`
  - 添加 Folia DIY 卡片样式，复用现有 `fx-section-label`、`fx-mini-btn`、`fx-seg`、玻璃按钮风格。
- Modify: `package.json`
  - `check` 加入 `node --check public/folia-fx-state.js`。
- Modify: `tests/folia-bridge-state.test.js`
  - 覆盖 bridge snapshot 中的 `foliaFx`。
- Create: `tests/folia-fx-state.test.js`
  - 覆盖默认值、clamp、patch、持久化安全、bridge payload。
- Modify: `tests/smoke.test.js`
  - 覆盖新增脚本、DIY 控件、bridge 推送、Folia stage 配置字段。

### Folia 侧

- Create: `third_party/folia-major/src/mineradioBridge/types.ts`
  - 定义 `MineradioBridgeMessage`、`MineradioBridgeSnapshot`、`MineradioFoliaFx`。
- Create: `third_party/folia-major/src/mineradioBridge/foliaFx.ts`
  - 负责 Folia 侧配置归一化和 Mineradio `foliaFx` 到 Folia visualizer props 的映射。
- Create: `third_party/folia-major/src/mineradioBridge/useMineradioBridge.ts`
  - 监听 `message`，只接受 `mineradio:folia-playback-state`，维护 bridge snapshot。
- Modify: `third_party/folia-major/src/App.tsx`
  - 检测 Mineradio bridge mode。
  - bridge mode 下跳过 Folia 原始平台连接/网易云入口。
  - 将 `foliaFx` 映射到 `VisualizerRenderer`、歌词字体、背景模式、透明度、性能模式。
- Modify: `third_party/folia-major/src/components/visualizer/VisualizerRenderer.tsx`
  - 如果当前 props 不足以表达 `foliaFx`，新增最小 props，不重写 visualizer。
- Create or Modify: `third_party/folia-major/src/mineradioBridge/__tests__/foliaFx.test.ts`
  - 使用 Folia 现有 Vitest 测试配置覆盖映射逻辑。

### Build / Docs

- Modify: `build/folia-stage.js`
  - 保持现有构建流程；如需要注入 `VITE_MINERADIO_BRIDGE_MODE=true`，在 `buildFoliaStageEnvironment()` 中集中处理。
- Modify: `THIRD_PARTY_NOTICES.md`
  - 记录本阶段修改了 Folia 源码的范围和目的。
- Modify: `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`
  - 增补 Folia DIY 配置阶段说明。

---

## Configuration Model

新增 Mineradio 配置 key：

```js
const FOLIA_FX_KEY = 'mineradio-folia-fx-v1';
```

新增配置结构：

```js
{
  enabled: true,
  stageMode: 'overlay',          // overlay | fullscreen
  idleBehavior: 'wait',          // wait | keep-last | blank
  lyricScale: 1,
  lyricWeight: 0.7,
  lineSpacing: 1,
  wordHighlight: 0.85,
  currentLineFocus: 0.75,
  translationMode: 'auto',       // off | auto | always
  romanizationMode: 'off',       // off | auto | always
  entryMotion: 0.6,
  visualMode: 'auto',            // auto | cappella | partita | cover | minimal
  backgroundMode: 'theme',       // theme | cover | transparent | dark
  glow: 0.55,
  blur: 0.35,
  particleAmount: 0.65,
  beatMotion: 0.45,
  cameraMotion: 0.35,
  themeMode: 'mineradio-theme',  // mineradio-theme | cover | manual
  accentColor: '',
  performanceMode: 'balanced',   // quality | balanced | battery
  reduceMotion: false
}
```

Bridge snapshot 增加：

```js
{
  bridge: 'mineradio-folia',
  song,
  playback,
  lyrics,
  audio,
  theme,
  foliaFx
}
```

---

### Task 1: Folia FX Pure State Helper

**Files:**
- Create: `public/folia-fx-state.js`
- Create: `tests/folia-fx-state.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for defaults and clamp**

Create `tests/folia-fx-state.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_FOLIA_FX,
  normalizeFoliaFx,
  patchFoliaFx,
  foliaFxToBridgePayload,
} = require('../public/folia-fx-state');

test('normalizes Folia FX defaults safely', () => {
  const fx = normalizeFoliaFx({});
  assert.equal(fx.enabled, true);
  assert.equal(fx.stageMode, 'overlay');
  assert.equal(fx.performanceMode, 'balanced');
  assert.equal(fx.visualMode, 'auto');
});

test('clamps Folia FX numeric ranges', () => {
  const fx = normalizeFoliaFx({
    lyricScale: 9,
    wordHighlight: -1,
    particleAmount: 3,
    beatMotion: Infinity,
  });
  assert.equal(fx.lyricScale, 1.8);
  assert.equal(fx.wordHighlight, 0);
  assert.equal(fx.particleAmount, 1);
  assert.equal(fx.beatMotion, DEFAULT_FOLIA_FX.beatMotion);
});

test('patches existing Folia FX without losing unknown-safe defaults', () => {
  const fx = patchFoliaFx({ lyricScale: 1.2 }, { glow: 0.9 });
  assert.equal(fx.lyricScale, 1.2);
  assert.equal(fx.glow, 0.9);
  assert.equal(fx.enabled, true);
});

test('builds bridge payload without private or invalid fields', () => {
  const payload = foliaFxToBridgePayload({
    accentColor: '#7dd3fc',
    performanceMode: 'battery',
    extra: 'drop-me',
  });
  assert.equal(payload.accentColor, '#7dd3fc');
  assert.equal(payload.performanceMode, 'battery');
  assert.equal(payload.extra, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-fx-state.test.js
```

Expected: FAIL because `public/folia-fx-state.js` does not exist.

- [ ] **Step 3: Implement `public/folia-fx-state.js`**

Create UMD module:

```js
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaFxState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_FOLIA_FX = {
    enabled: true,
    stageMode: 'overlay',
    idleBehavior: 'wait',
    lyricScale: 1,
    lyricWeight: 0.7,
    lineSpacing: 1,
    wordHighlight: 0.85,
    currentLineFocus: 0.75,
    translationMode: 'auto',
    romanizationMode: 'off',
    entryMotion: 0.6,
    visualMode: 'auto',
    backgroundMode: 'theme',
    glow: 0.55,
    blur: 0.35,
    particleAmount: 0.65,
    beatMotion: 0.45,
    cameraMotion: 0.35,
    themeMode: 'mineradio-theme',
    accentColor: '',
    performanceMode: 'balanced',
    reduceMotion: false,
  };

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function oneOf(value, allowed, fallback) {
    value = String(value || '').trim();
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function color(value) {
    value = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '';
  }

  function normalizeFoliaFx(input) {
    input = input || {};
    return {
      enabled: input.enabled !== false,
      stageMode: oneOf(input.stageMode, ['overlay', 'fullscreen'], DEFAULT_FOLIA_FX.stageMode),
      idleBehavior: oneOf(input.idleBehavior, ['wait', 'keep-last', 'blank'], DEFAULT_FOLIA_FX.idleBehavior),
      lyricScale: clamp(input.lyricScale, 0.65, 1.8, DEFAULT_FOLIA_FX.lyricScale),
      lyricWeight: clamp(input.lyricWeight, 0, 1, DEFAULT_FOLIA_FX.lyricWeight),
      lineSpacing: clamp(input.lineSpacing, 0.75, 1.6, DEFAULT_FOLIA_FX.lineSpacing),
      wordHighlight: clamp(input.wordHighlight, 0, 1, DEFAULT_FOLIA_FX.wordHighlight),
      currentLineFocus: clamp(input.currentLineFocus, 0, 1, DEFAULT_FOLIA_FX.currentLineFocus),
      translationMode: oneOf(input.translationMode, ['off', 'auto', 'always'], DEFAULT_FOLIA_FX.translationMode),
      romanizationMode: oneOf(input.romanizationMode, ['off', 'auto', 'always'], DEFAULT_FOLIA_FX.romanizationMode),
      entryMotion: clamp(input.entryMotion, 0, 1, DEFAULT_FOLIA_FX.entryMotion),
      visualMode: oneOf(input.visualMode, ['auto', 'cappella', 'partita', 'cover', 'minimal'], DEFAULT_FOLIA_FX.visualMode),
      backgroundMode: oneOf(input.backgroundMode, ['theme', 'cover', 'transparent', 'dark'], DEFAULT_FOLIA_FX.backgroundMode),
      glow: clamp(input.glow, 0, 1, DEFAULT_FOLIA_FX.glow),
      blur: clamp(input.blur, 0, 1, DEFAULT_FOLIA_FX.blur),
      particleAmount: clamp(input.particleAmount, 0, 1, DEFAULT_FOLIA_FX.particleAmount),
      beatMotion: clamp(input.beatMotion, 0, 1, DEFAULT_FOLIA_FX.beatMotion),
      cameraMotion: clamp(input.cameraMotion, 0, 1, DEFAULT_FOLIA_FX.cameraMotion),
      themeMode: oneOf(input.themeMode, ['mineradio-theme', 'cover', 'manual'], DEFAULT_FOLIA_FX.themeMode),
      accentColor: color(input.accentColor),
      performanceMode: oneOf(input.performanceMode, ['quality', 'balanced', 'battery'], DEFAULT_FOLIA_FX.performanceMode),
      reduceMotion: input.reduceMotion === true,
    };
  }

  function patchFoliaFx(current, patch) {
    return normalizeFoliaFx(Object.assign({}, normalizeFoliaFx(current || {}), patch || {}));
  }

  function foliaFxToBridgePayload(input) {
    return normalizeFoliaFx(input || {});
  }

  return {
    DEFAULT_FOLIA_FX: DEFAULT_FOLIA_FX,
    normalizeFoliaFx: normalizeFoliaFx,
    patchFoliaFx: patchFoliaFx,
    foliaFxToBridgePayload: foliaFxToBridgePayload,
  };
});
```

- [ ] **Step 4: Add script checks**

Modify `package.json` `check` script to include:

```bash
node --check public/folia-fx-state.js
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/folia-fx-state.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/folia-fx-state.js tests/folia-fx-state.test.js package.json
git commit -m "feat: 增加 Folia DIY 配置状态模型" -m "新增 Folia FX 默认值、归一化、范围限制、局部 patch 和 bridge payload 清洗能力，为 DIY 面板接入 Folia 舞台效果做准备。"
```

---

### Task 2: Bridge Snapshot Carries Folia FX

**Files:**
- Modify: `public/index.html`
- Modify: `public/folia-bridge-state.js`
- Modify: `tests/folia-bridge-state.test.js`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing bridge tests**

Update `tests/folia-bridge-state.test.js`:

```js
test('includes sanitized Folia FX state in bridge snapshots', () => {
  const snapshot = createFoliaBridgeSnapshot({
    foliaFx: {
      lyricScale: 9,
      glow: 0.8,
      performanceMode: 'battery',
    },
  });

  assert.equal(snapshot.foliaFx.lyricScale, 1.8);
  assert.equal(snapshot.foliaFx.glow, 0.8);
  assert.equal(snapshot.foliaFx.performanceMode, 'battery');
  assert.match(foliaBridgeSnapshotKey(snapshot), /battery/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-bridge-state.test.js
```

Expected: FAIL because `foliaFx` is not in bridge snapshot yet.

- [ ] **Step 3: Load script in `public/index.html`**

Add before `folia-bridge-state.js`:

```html
<script src="folia-fx-state.js"></script>
```

- [ ] **Step 4: Extend `public/folia-bridge-state.js`**

Add optional require:

```js
var nodeFoliaFxApi = null;
if (typeof require === 'function') {
  try { nodeFoliaFxApi = require('./folia-fx-state'); } catch (_err) {}
}
```

Add:

```js
function foliaFxApi() {
  return nodeFoliaFxApi || (root && root.MineradioFoliaFxState) || null;
}

function normalizeFoliaFxPayload(input) {
  var api = foliaFxApi();
  if (api && typeof api.foliaFxToBridgePayload === 'function') {
    return api.foliaFxToBridgePayload(input || {});
  }
  return input || {};
}
```

In `createFoliaBridgeSnapshot(state)` add:

```js
foliaFx: normalizeFoliaFxPayload(state.foliaFx || {}),
```

In `foliaBridgeSnapshotKey(snapshot)` include:

```js
var foliaFx = snapshot.foliaFx || {};
foliaFx.enabled,
foliaFx.visualMode,
foliaFx.performanceMode,
foliaFx.lyricScale,
foliaFx.glow,
foliaFx.particleAmount,
foliaFx.beatMotion,
```

- [ ] **Step 5: Add Mineradio bridge payload source**

In `public/index.html`, near `foliaBridgeThemePayload()` add:

```js
function foliaBridgeFxPayload() {
  var api = window.MineradioFoliaFxState || {};
  return api && typeof api.foliaFxToBridgePayload === 'function'
    ? api.foliaFxToBridgePayload(foliaFx)
    : (foliaFx || {});
}
```

In `createFoliaPlaybackBridgeSnapshot(reason)` add:

```js
foliaFx: foliaBridgeFxPayload()
```

- [ ] **Step 6: Update smoke test**

In `tests/smoke.test.js`, assert:

```js
assert.match(html, /<script src="folia-fx-state\.js"><\/script>/);
assert.match(pkg.scripts.check, /node --check public\/folia-fx-state\.js/);
assert.match(html, /foliaBridgeFxPayload/);
assert.match(html, /foliaFx: foliaBridgeFxPayload\(\)/);
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/folia-bridge-state.test.js tests/smoke.test.js
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/folia-bridge-state.js tests/folia-bridge-state.test.js tests/smoke.test.js
git commit -m "feat: 通过 Folia Bridge 推送 DIY 配置" -m "Bridge snapshot 新增 foliaFx 字段，并纳入节流 key，保证 DIY 调整能够实时推送到 Folia 舞台。"
```

---

### Task 3: Mineradio DIY Panel Controls

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test**

Add to `tests/smoke.test.js`:

```js
test('Folia DIY controls are wired into Mineradio visual panel', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /id="folia-fx-card"/);
  assert.match(html, /id="folia-fx-enabled"/);
  assert.match(html, /id="folia-fx-visual-mode"/);
  assert.match(html, /id="folia-fx-lyric-scale"/);
  assert.match(html, /id="folia-fx-glow"/);
  assert.match(html, /id="folia-fx-particle-amount"/);
  assert.match(html, /id="folia-fx-beat-motion"/);
  assert.match(html, /id="folia-fx-performance-mode"/);
  assert.match(html, /function syncFoliaFxControls\(/);
  assert.match(html, /function updateFoliaFxFromControl\(/);
  assert.match(html, /pushFoliaPlaybackBridge\('folia-fx-state', \{ force: true \}\)/);
  assert.match(css, /\.folia-fx-card/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL because controls do not exist.

- [ ] **Step 3: Add state variables**

In `public/index.html`, near Folia theme constants:

```js
var FOLIA_FX_KEY = 'mineradio-folia-fx-v1';
var foliaFx = readFoliaFxSettings();
```

Add functions:

```js
function foliaFxApi() { return window.MineradioFoliaFxState || {}; }
function readFoliaFxSettings() { ... }
function saveFoliaFxSettings() { ... }
function applyFoliaFxPatch(patch, reason) { ... }
function syncFoliaFxControls() { ... }
function updateFoliaFxFromControl(key, value) { ... }
function resetFoliaFxSettings() { ... }
```

`applyFoliaFxPatch()` must:

- patch and normalize via `MineradioFoliaFxState.patchFoliaFx`
- save to localStorage
- update controls
- call `pushFoliaPlaybackBridge('folia-fx-state', { force: true })`
- not reload iframe

- [ ] **Step 4: Add DIY controls**

Place after `Folia AI 主题` block or before it:

```html
<div class="fx-section-label">Folia 舞台效果</div>
<div class="folia-fx-card" id="folia-fx-card">
  <div class="folia-fx-head">
    <div><b>舞台 DIY</b><span id="folia-fx-status">实时推送到 Folia iframe</span></div>
    <button class="fx-mini-btn ghost" type="button" onclick="resetFoliaFxSettings()">重置</button>
  </div>
  <label class="fx-check"><input id="folia-fx-enabled" type="checkbox" onchange="updateFoliaFxFromControl('enabled', this.checked)">启用 Folia 舞台效果</label>
  <div class="fx-section-label">舞台模式</div>
  <div class="fx-seg" id="folia-fx-visual-mode">
    <button type="button" data-folia-fx="visualMode" data-value="auto" onclick="updateFoliaFxFromControl('visualMode','auto')">自动</button>
    <button type="button" data-folia-fx="visualMode" data-value="cappella" onclick="updateFoliaFxFromControl('visualMode','cappella')">Cappella</button>
    <button type="button" data-folia-fx="visualMode" data-value="partita" onclick="updateFoliaFxFromControl('visualMode','partita')">Partita</button>
    <button type="button" data-folia-fx="visualMode" data-value="minimal" onclick="updateFoliaFxFromControl('visualMode','minimal')">极简</button>
  </div>
  <label>歌词大小<input id="folia-fx-lyric-scale" type="range" min="0.65" max="1.8" step="0.01" oninput="updateFoliaFxFromControl('lyricScale', this.value)"></label>
  <label>逐字高亮<input id="folia-fx-word-highlight" type="range" min="0" max="1" step="0.01" oninput="updateFoliaFxFromControl('wordHighlight', this.value)"></label>
  <label>光晕<input id="folia-fx-glow" type="range" min="0" max="1" step="0.01" oninput="updateFoliaFxFromControl('glow', this.value)"></label>
  <label>粒子<input id="folia-fx-particle-amount" type="range" min="0" max="1" step="0.01" oninput="updateFoliaFxFromControl('particleAmount', this.value)"></label>
  <label>鼓点响应<input id="folia-fx-beat-motion" type="range" min="0" max="1" step="0.01" oninput="updateFoliaFxFromControl('beatMotion', this.value)"></label>
  <div class="fx-section-label">性能</div>
  <div class="fx-seg" id="folia-fx-performance-mode">
    <button type="button" data-folia-fx="performanceMode" data-value="quality" onclick="updateFoliaFxFromControl('performanceMode','quality')">高质量</button>
    <button type="button" data-folia-fx="performanceMode" data-value="balanced" onclick="updateFoliaFxFromControl('performanceMode','balanced')">平衡</button>
    <button type="button" data-folia-fx="performanceMode" data-value="battery" onclick="updateFoliaFxFromControl('performanceMode','battery')">省电</button>
  </div>
</div>
```

- [ ] **Step 5: Sync controls during DIY bind**

In `bindFxPanel()` call:

```js
syncFoliaFxControls();
```

- [ ] **Step 6: Add CSS**

In `public/styles/app.css`:

```css
.folia-fx-card{display:grid;gap:10px;padding:12px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.045)}
.folia-fx-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.folia-fx-head b{display:block;font-size:12px}
.folia-fx-head span{display:block;margin-top:3px;color:rgba(255,255,255,.48);font-size:10px}
.folia-fx-card label{display:grid;gap:5px;color:rgba(255,255,255,.72);font-size:11px;font-weight:700}
.folia-fx-card input[type="range"]{width:100%;accent-color:var(--home-accent)}
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/smoke.test.js
npm run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/styles/app.css tests/smoke.test.js
git commit -m "feat: 在 DIY 面板加入 Folia 舞台效果配置" -m "新增 Folia 舞台效果配置卡，支持舞台模式、歌词大小、逐字高亮、光晕、粒子、鼓点响应和性能模式，并实时推送 bridge。"
```

---

### Task 4: Folia Bridge Mode Listener

**Files:**
- Create: `third_party/folia-major/src/mineradioBridge/types.ts`
- Create: `third_party/folia-major/src/mineradioBridge/foliaFx.ts`
- Create: `third_party/folia-major/src/mineradioBridge/useMineradioBridge.ts`
- Create: `third_party/folia-major/src/mineradioBridge/__tests__/foliaFx.test.ts`
- Modify: `third_party/folia-major/src/App.tsx`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Write failing Folia-side tests**

Create `third_party/folia-major/src/mineradioBridge/__tests__/foliaFx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeMineradioFoliaFx, mapMineradioFoliaFxToVisualizer } from '../foliaFx';

describe('Mineradio Folia FX mapping', () => {
  it('normalizes unsafe payloads', () => {
    const fx = normalizeMineradioFoliaFx({ lyricScale: 9, particleAmount: -1, performanceMode: 'battery' });
    expect(fx.lyricScale).toBe(1.8);
    expect(fx.particleAmount).toBe(0);
    expect(fx.performanceMode).toBe('battery');
  });

  it('maps Mineradio settings to visualizer props', () => {
    const props = mapMineradioFoliaFxToVisualizer({
      visualMode: 'minimal',
      glow: 0.2,
      particleAmount: 0.4,
      beatMotion: 0.7,
      performanceMode: 'battery',
    });
    expect(props.visualizerMode).toBe('minimal');
    expect(props.effects.glow).toBeCloseTo(0.2);
    expect(props.effects.particles).toBeCloseTo(0.4);
    expect(props.effects.beatMotion).toBeCloseTo(0.7);
    expect(props.performance.maxQuality).toBe('battery');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --prefix third_party/folia-major -- src/mineradioBridge/__tests__/foliaFx.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Add types**

Create `third_party/folia-major/src/mineradioBridge/types.ts`:

```ts
export type MineradioBridgeMessage = {
  type: 'mineradio:folia-playback-state';
  payload: MineradioBridgeSnapshot;
};

export type MineradioBridgeSnapshot = {
  bridge: 'mineradio-folia';
  reason?: string;
  song?: unknown;
  playback?: unknown;
  lyrics?: unknown;
  audio?: unknown;
  theme?: unknown;
  foliaFx?: Partial<MineradioFoliaFx>;
};

export type MineradioFoliaFx = {
  enabled: boolean;
  stageMode: 'overlay' | 'fullscreen';
  idleBehavior: 'wait' | 'keep-last' | 'blank';
  lyricScale: number;
  lyricWeight: number;
  lineSpacing: number;
  wordHighlight: number;
  currentLineFocus: number;
  translationMode: 'off' | 'auto' | 'always';
  romanizationMode: 'off' | 'auto' | 'always';
  entryMotion: number;
  visualMode: 'auto' | 'cappella' | 'partita' | 'cover' | 'minimal';
  backgroundMode: 'theme' | 'cover' | 'transparent' | 'dark';
  glow: number;
  blur: number;
  particleAmount: number;
  beatMotion: number;
  cameraMotion: number;
  themeMode: 'mineradio-theme' | 'cover' | 'manual';
  accentColor: string;
  performanceMode: 'quality' | 'balanced' | 'battery';
  reduceMotion: boolean;
};
```

- [ ] **Step 4: Add mapping helper**

Create `third_party/folia-major/src/mineradioBridge/foliaFx.ts` with:

- defaults matching Mineradio
- clamp helpers
- `normalizeMineradioFoliaFx(input)`
- `mapMineradioFoliaFxToVisualizer(input)`

Mapping rules:

```ts
visualizerMode:
  auto -> existing Folia default
  cappella -> cappella
  partita -> partita
  cover -> cover
  minimal -> minimal

effects:
  glow -> visual glow/lighting strength
  particleAmount -> particle density multiplier
  beatMotion -> audio reactive motion
  blur -> background blur/intensity
  cameraMotion -> camera animation intensity

lyrics:
  lyricScale -> lyricsFontScale multiplier
  wordHighlight -> word highlight opacity/intensity
  currentLineFocus -> active line focus scale/opacity
  lineSpacing -> lyric layout spacing

performance:
  quality -> full visualizer
  balanced -> current default
  battery -> reduced particles, reduced blur, reduced fps-heavy effects
```

- [ ] **Step 5: Add bridge hook**

Create `third_party/folia-major/src/mineradioBridge/useMineradioBridge.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import type { MineradioBridgeMessage, MineradioBridgeSnapshot } from './types';
import { normalizeMineradioFoliaFx } from './foliaFx';

export function useMineradioBridge() {
  const [snapshot, setSnapshot] = useState<MineradioBridgeSnapshot | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as Partial<MineradioBridgeMessage> | undefined;
      if (!data || data.type !== 'mineradio:folia-playback-state') return;
      const payload = data.payload;
      if (!payload || payload.bridge !== 'mineradio-folia') return;
      setSnapshot({
        ...payload,
        foliaFx: normalizeMineradioFoliaFx(payload.foliaFx),
      });
    }
    window.addEventListener('message', onMessage);
    window.parent?.postMessage({ type: 'mineradio:folia-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return useMemo(() => ({
    bridgeMode: true,
    snapshot,
    foliaFx: normalizeMineradioFoliaFx(snapshot?.foliaFx),
  }), [snapshot]);
}
```

Implementation note: replace unconditional `bridgeMode: true` with a URL/env guard if Folia is also used standalone:

```ts
const bridgeMode = new URLSearchParams(window.location.search).get('mineradioBridge') === '1'
  || window.parent !== window;
```

- [ ] **Step 6: Integrate `App.tsx`**

Modify `third_party/folia-major/src/App.tsx`:

- import `useMineradioBridge`
- import `mapMineradioFoliaFxToVisualizer`
- derive:

```ts
const mineradioBridge = useMineradioBridge();
const mineradioFxModel = useMemo(
  () => mapMineradioFoliaFxToVisualizer(mineradioBridge.foliaFx),
  [mineradioBridge.foliaFx],
);
```

- When `mineradioBridge.bridgeMode`:
  - current song comes from bridge snapshot.
  - lyrics come from bridge snapshot.
  - current time comes from bridge playback payload.
  - playback controls that require Folia-owned playback are hidden/disabled.
  - NetEase connection empty state is replaced with “等待 Mineradio 播放状态”.
  - `VisualizerRenderer` receives mapped props.

- [ ] **Step 7: Update third-party notice**

Modify `THIRD_PARTY_NOTICES.md`:

```md
### Mineradio modifications to Folia

- Added Mineradio bridge mode files under `src/mineradioBridge/`.
- Modified `src/App.tsx` to consume Mineradio playback snapshots and Folia DIY settings when embedded.
- No upstream platform login or playback ownership is required in Mineradio bridge mode.
```

- [ ] **Step 8: Run Folia tests**

Run:

```bash
npm test --prefix third_party/folia-major -- src/mineradioBridge/__tests__/foliaFx.test.ts
npm run folia:build
```

Expected: PASS and `public/folia-stage/index.html` generated.

- [ ] **Step 9: Commit**

```bash
git add third_party/folia-major/src/mineradioBridge third_party/folia-major/src/App.tsx THIRD_PARTY_NOTICES.md public/folia-stage
git commit -m "feat: 让 Folia 舞台消费 Mineradio DIY 配置" -m "新增 Mineradio bridge mode 配置监听和 Folia FX 映射，Folia 内嵌时不再要求连接网易云，而是消费 Mineradio 推送的播放、歌词、主题和舞台效果。"
```

Note: if `public/folia-stage/` remains ignored, commit Folia source changes and do not stage generated files. In that case commit body must state build output is generated and ignored.

---

### Task 5: Runtime Robustness and No-Reload Live Updates

**Files:**
- Modify: `public/folia-stage-ui.js`
- Modify: `public/index.html`
- Modify: `tests/folia-stage-ui.test.js`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing tests**

Update `tests/folia-stage-ui.test.js`:

```js
test('Folia stage requests bridge mode and does not reload for FX updates', async () => {
  const { controller, doc, bridge } = createControllerFixture({ stageExists: true });
  await controller.open();
  const frame = doc._nodes['folia-stage-frame'];
  assert.match(frame.src, /mineradioBridge=1/);

  const firstSrc = frame.src;
  bridge.push('folia-fx-state', { force: true });
  assert.equal(frame.src, firstSrc);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-stage-ui.test.js
```

Expected: FAIL because iframe URL does not include bridge mode query yet.

- [ ] **Step 3: Add bridge mode query**

Modify `public/folia-stage-ui.js`:

```js
var DEFAULT_STAGE_SRC = 'folia-stage/index.html?mineradioBridge=1';
```

If preserving existing constant, build URL with:

```js
function stageSrcWithBridgeMode(src) {
  return src.indexOf('?') >= 0 ? src + '&mineradioBridge=1' : src + '?mineradioBridge=1';
}
```

- [ ] **Step 4: Ensure FX changes only push bridge**

In `public/index.html`, `applyFoliaFxPatch()` must not call `closeFoliaStage()`, `toggleFoliaStage()`, set iframe `src`, or rebuild Folia stage.

Add smoke assertions:

```js
assert.doesNotMatch(html, /applyFoliaFxPatch[\s\S]*folia-stage-frame[\s\S]*src/);
assert.doesNotMatch(html, /applyFoliaFxPatch[\s\S]*toggleFoliaStage/);
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/folia-stage-ui.test.js tests/smoke.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/folia-stage-ui.js public/index.html tests/folia-stage-ui.test.js tests/smoke.test.js
git commit -m "fix: Folia DIY 调整时保持舞台热更新" -m "Folia iframe 使用 Mineradio bridge mode 打开，DIY 参数变化只通过 bridge 推送，不重载 iframe、不重新连接平台、不重启播放。"
```

---

### Task 6: Full Verification and Manual Acceptance

**Files:**
- Modify: `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`
- Optional Modify: `docs/修改日志.md`

- [ ] **Step 1: Update docs**

Add a new section to `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`:

```md
### 阶段 8：Folia DIY 配置接入

目标：把 Folia 舞台效果配置纳入 Mineradio DIY 面板，由 Mineradio 保存和推送，Folia 只消费配置并渲染。

验证：
- DIY 调整 Folia 参数时 iframe 不重载。
- Folia 不再要求连接网易云。
- 无播放时显示等待 Mineradio 播放状态。
- 播放、暂停、seek、切歌后 Folia 舞台和设置同步。
```

- [ ] **Step 2: Run all verification**

Run:

```bash
npm run check
npm test
npm test --prefix third_party/folia-major -- src/mineradioBridge/__tests__/foliaFx.test.ts
npm run folia:build
node --check public/folia-fx-state.js
git diff --check
```

Expected:

- Mineradio checks pass.
- Mineradio tests pass.
- Folia bridge tests pass.
- Folia build succeeds.
- No whitespace errors.

- [ ] **Step 3: Manual acceptance**

Manual scenario:

1. Run `npm start`.
2. Play a NetEase song in Mineradio.
3. Open Folia stage.
4. Confirm Folia does not ask to connect NetEase.
5. Confirm Folia shows Mineradio song title, cover and lyrics.
6. Drag `Folia 舞台效果 -> 歌词大小`.
7. Confirm Folia lyric size changes without iframe reload.
8. Drag `光晕`, `粒子`, `鼓点响应`.
9. Confirm visual effect changes live.
10. Switch `性能` to `省电`.
11. Confirm Folia reduces heavy effects.
12. Switch song.
13. Confirm Folia keeps current DIY settings and updates song/lyrics.
14. Close Folia stage.
15. Confirm Mineradio playback continues.

- [ ] **Step 4: Commit**

```bash
git add docs/FOLIA_SOURCE_FUSION_UPGRADE.md docs/修改日志.md
git commit -m "docs: 补充 Folia DIY 配置接入验收说明" -m "记录 Folia DIY 配置接入阶段、验证命令和手动验收场景，明确 Folia 内嵌时由 Mineradio 统一保存和推送舞台效果。"
```

---

## Risks and Guardrails

- **Folia 原始 App 强依赖平台连接：** bridge mode 必须在 UI 层短路原网易云连接空态，不能只隐藏按钮。
- **配置字段过多导致 UI 拥挤：** 第一版只暴露 8-10 个高价值参数，其余保留在 state helper 中。
- **Folia visualizer props 不匹配：** 优先映射已有 props；缺失能力只加小型 props，不大改 visualizer。
- **DIY 滑杆频繁触发 postMessage：** `pushFoliaPlaybackBridge` 已有节流，`foliaFx` 强制推送仍需避免每帧保存 localStorage。可使用 80-120ms debounce 保存，但即时更新内存。
- **AGPL 合规：** 修改 Folia 源码后必须更新 `THIRD_PARTY_NOTICES.md`。
- **构建产物忽略：** `public/folia-stage/` 如果被 `.gitignore` 忽略，不要强行提交生成物；发布前运行 `npm run folia:build`。

## Commit Sequence

1. `feat: 增加 Folia DIY 配置状态模型`
2. `feat: 通过 Folia Bridge 推送 DIY 配置`
3. `feat: 在 DIY 面板加入 Folia 舞台效果配置`
4. `feat: 让 Folia 舞台消费 Mineradio DIY 配置`
5. `fix: Folia DIY 调整时保持舞台热更新`
6. `docs: 补充 Folia DIY 配置接入验收说明`

每个提交正文必须写明：

- 修改了哪些边界。
- 如何保持 Mineradio 主播放器不被 Folia 接管。
- 验证命令及结果。
- 如涉及 Folia 源码，说明 AGPL 第三方声明已同步。

