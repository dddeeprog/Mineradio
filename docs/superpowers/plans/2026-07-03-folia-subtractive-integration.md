# Mineradio 原生 Folia 风格视觉升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有功能继续由 Mineradio 管理，只把 Folia 的歌词舞台视觉表现转化为 Mineradio 原生 DIY 视觉预设。

**Architecture:** Mineradio 负责播放、音乐源、队列、歌单、本地歌词、AI 主题、配置持久化和 UI；Folia 不作为平台、不作为功能模块、不接管数据流。Folia 只作为视觉参考来源：参考其 Classic/Cadenza/Partita/Fume/Monet/Cappella/Tilt 等视觉表现，在 Mineradio 自己的渲染系统中实现可切换预设。

**Tech Stack:** Mineradio renderer plain HTML/CSS/JS、Three.js/Canvas/SVG、Electron main/preload、本地文件只读 IPC、UMD pure helpers、Node test runner。Folia 源码只用于设计参考和行为对标，不作为运行时依赖进入新功能链路。

---

## Scope

这轮不是继续融合 Folia 平台能力，而是把 Folia 从业务链路里拿掉。

必须做到：

- 在线音乐播放由 Mineradio 管。
- 本地音乐库由 Mineradio 管。
- Navidrome 如后续接入，也由 Mineradio 管。
- Now Playing 如后续接入，也由 Mineradio 管。
- 同目录 `.lrc` / 逐字歌词由 Mineradio 原生读取、解析、缓存、选择。
- AI 主题生成由 Mineradio 原生触发、缓存、应用。
- DIY 预设切换由 Mineradio 原生管理。
- Folia 只作为视觉参考，不再被用户感知为可进入的平台。

不做：

- 不新增 Folia 登录入口。
- 不新增 Folia 音乐库入口。
- 不新增 Folia Navidrome 入口。
- 不新增 Folia Now Playing 入口。
- 不把用户操作切到 Folia 平台。
- 不让 Folia iframe 成为唯一视觉实现的长期依赖。

## Final Boundary

| 能力 | 归属 | 实现原则 |
| --- | --- | --- |
| 在线播放 | Mineradio | 现有播放链路不变 |
| 本地音乐 | Mineradio | 现有本地播放链路扩展歌词发现 |
| 歌单 / 队列 | Mineradio | 不引入 Folia 队列 |
| 同目录 `.lrc` | Mineradio | Electron 安全只读 + 原生解析 |
| 逐字歌词 | Mineradio | 原生统一歌词模型，供 Mineradio 视觉层消费 |
| AI 主题 | Mineradio | 原生主题生成器，参考 Folia 主题结构 |
| Folia 视觉风格 | Mineradio 原生预设 | 参考 Folia 视觉，不依赖 Folia 平台 |
| Folia 源码 | 第三方参考 | 保留授权声明，不扩大运行时职责 |

最终用户感知：

```text
我在 Mineradio 的 DIY 里切换歌词视觉预设。
其中一组预设是 Folia 风格。
```

而不是：

```text
我进入了 Folia。
```

## File Structure

### New Mineradio Pure Helpers

- Create: `public/local-lyric-file-state.js`
  - 本地歌词文件候选、同目录同名匹配、格式判断、优先级、解析结果归一化。
- Create: `public/folia-inspired-visual-state.js`
  - Folia 风格视觉预设定义、模式归一化、DIY 配置 clamp、持久化 payload。
- Create: `public/folia-inspired-theme-state.js`
  - Mineradio AI 主题到 Folia 风格视觉参数的映射，不依赖 Folia runtime。

### Mineradio Renderer

- Modify: `public/index.html`
  - DIY 中增加 `Folia 风格歌词视觉` 预设组。
  - 移除或弱化“打开 Folia 平台/舞台”的入口文案。
  - 本地歌曲播放时接入同目录歌词发现。
  - AI 主题入口保持 Mineradio 管理。
- Modify: `public/styles/app.css`
  - Folia 风格预设按钮、参数面板、视觉说明样式。
- Modify: `public/folia-stage-ui.js`
  - 逐步降级为兼容 fallback，不作为主路径。
- Modify: `public/folia-fx-state.js`
  - 如保留，改名语义或只作为兼容旧配置迁移入口。

### Mineradio Visual Runtime

- Modify or Create: `public/lyric-visual-presets.js`
  - 如果已有类似模块则扩展；否则创建。
  - 统一注册 Mineradio 现有歌词视觉与 Folia 风格视觉。
- Modify: `public/comment-barrage-3d.js`
  - 只在需要避让新歌词视觉时调整，不混入 Folia 业务。
- Modify: `public/visual-cover-state.js`
  - 如 Folia 风格预设对封面使用有策略差异，在这里集中管理。

### Electron

- Modify: `desktop/main.js`
  - 安全读取同目录 `.lrc` / `.ttml`。
- Modify: `desktop/preload.js`
  - 暴露本地歌词只读 API。

### Tests

- Create: `tests/local-lyric-file-state.test.js`
- Create: `tests/folia-inspired-visual-state.test.js`
- Create: `tests/folia-inspired-theme-state.test.js`
- Modify: `tests/smoke.test.js`
- Modify: `package.json`

### Docs

- Modify: `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`
- Modify: `THIRD_PARTY_NOTICES.md`

---

## Visual Presets To Recreate Natively

Folia 只作为视觉参考，建议拆成以下 Mineradio 原生预设：

| Mineradio 预设名 | 参考 Folia 风格 | 原生实现方向 |
| --- | --- | --- |
| Folia Classic 风格 | Classic | 大字号中心歌词、逐字高亮、柔和背景流体 |
| Folia Cadenza 风格 | Cadenza | 歌词分层、节奏跟随、轻几何运动 |
| Folia Partita 风格 | Partita | 分栏/分块歌词、逐词进入、舞台化排版 |
| Folia Fume 风格 | Fume | 烟雾/雾化背景、低对比歌词漂浮 |
| Folia Monet 风格 | Monet | 封面色彩场、柔化背景、杂志感排版 |
| Folia Cappella 风格 | Cappella | 多角色/多声部视觉，可先做简化版 |
| Folia Tilt 风格 | Tilt | 倾斜视角、轻 3D 位移、歌词景深 |

第一轮建议优先做：

1. Classic 风格
2. Partita 风格
3. Monet 风格

Cappella / Tilt / Fume / Cadenza 放第二轮，避免一次做太散。

---

## Task 1: 清理 Folia 职责边界与兼容策略

**Files:**

- Modify: `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test**

在 `tests/smoke.test.js` 增加：

```js
test('Folia is treated as a visual reference, not a managed platform', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const plan = fs.readFileSync(path.join(repoRoot, 'docs', 'superpowers', 'plans', '2026-07-03-folia-subtractive-integration.md'), 'utf8');

  assert.match(plan, /Folia 只作为视觉参考/);
  assert.match(plan, /所有功能继续由 Mineradio 管理/);
  assert.doesNotMatch(html, /进入 Folia 平台/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL until UI copy and docs are aligned.

- [ ] **Step 3: Update docs and notices**

In `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`:

- Add section `Folia 视觉参考化`.
- State Folia platform features are not merged.
- State Mineradio owns playback, lyrics, AI theme and settings.

In `THIRD_PARTY_NOTICES.md`:

- Clarify Folia source is retained for existing bridge experiment and visual reference.
- New native visual presets should not copy licensed assets blindly.

- [ ] **Step 4: Rewrite platform-like copy**

In `public/index.html`:

- Replace “进入 Folia / 打开 Folia 平台” with “Folia 风格歌词视觉”.
- Keep existing Folia iframe entry only as temporary compatibility if still needed.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run check
npm test
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add docs/FOLIA_SOURCE_FUSION_UPGRADE.md THIRD_PARTY_NOTICES.md public/index.html tests/smoke.test.js
git commit -m "docs: 明确 Folia 仅作为视觉参考" -m "纠正 Folia 融合边界：播放、歌词、AI 和配置全部由 Mineradio 管理，Folia 只作为歌词视觉表现参考。"
```

---

## Task 2: Mineradio 原生同目录 LRC / 逐字歌词支持

**Files:**

- Create: `public/local-lyric-file-state.js`
- Create: `tests/local-lyric-file-state.test.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `public/index.html`
- Modify: `package.json`

- [ ] **Step 1: Write failing pure helper tests**

Create `tests/local-lyric-file-state.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSameDirectoryLyricCandidates,
  normalizeLocalLyricCandidate,
  selectPreferredLocalLyric,
  normalizeParsedLocalLyrics,
} = require('../public/local-lyric-file-state');

test('builds same-directory lrc and ttml candidates from a local audio path', () => {
  const candidates = buildSameDirectoryLyricCandidates('D:/Music/Album/song.flac');
  assert.deepEqual(candidates.map(item => item.name), ['song.ttml', 'song.lrc']);
});

test('rejects lyric candidates outside the audio directory', () => {
  assert.equal(normalizeLocalLyricCandidate({ audioPath: 'D:/Music/song.flac', lyricPath: 'D:/Other/song.lrc' }), null);
});

test('prefers ttml then enhanced lrc then plain lrc', () => {
  const selected = selectPreferredLocalLyric([
    { format: 'lrc', enhanced: false, exists: true },
    { format: 'ttml', enhanced: true, exists: true },
  ]);
  assert.equal(selected.format, 'ttml');
});

test('normalizes parsed local lyrics into Mineradio lyric model', () => {
  const lyrics = normalizeParsedLocalLyrics({
    source: 'local-lrc',
    lines: [{ time: 1.2, text: 'hello' }],
  });
  assert.equal(lyrics.lines[0].text, 'hello');
  assert.equal(lyrics.timingSource, 'local-lrc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/local-lyric-file-state.test.js
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement `public/local-lyric-file-state.js`**

UMD exports:

- `buildSameDirectoryLyricCandidates(audioPath)`
- `normalizeLocalLyricCandidate(candidate)`
- `selectPreferredLocalLyric(candidates)`
- `normalizeParsedLocalLyrics(parsed)`

Rules:

- Renderer helper does not read filesystem.
- Only `.lrc` and `.ttml`.
- Same basename, same directory.
- No arbitrary path traversal.
- Output is Mineradio lyric model, not Folia model.

- [ ] **Step 4: Add Electron read-only IPC**

In `desktop/main.js`:

- Add IPC handler `local-lyrics:read`.
- Validate audio path and lyric candidate path.
- Ensure lyric path is in same directory as audio file.
- Allow only `.lrc` and `.ttml`.
- Return `{ ok, format, text, path }`.

In `desktop/preload.js`:

- Expose `window.mineradioLocalLyrics.read(audioPath, candidateName)`.

- [ ] **Step 5: Wire into local playback**

In `public/index.html`:

- On local song load, ask `local-lyric-file-state` for candidates.
- Read first valid candidate through preload API.
- Parse using Mineradio parser or existing Folia-inspired parser code if already extracted.
- Set Mineradio lyrics.
- Push lyrics to all visual renderers.

- [ ] **Step 6: Add checks**

Modify `package.json`:

```bash
node --check public/local-lyric-file-state.js
```

- [ ] **Step 7: Run verification**

Run:

```bash
node --test tests/local-lyric-file-state.test.js
npm run check
npm test
git diff --check
```

- [ ] **Step 8: Commit**

```bash
git add public/local-lyric-file-state.js tests/local-lyric-file-state.test.js desktop/main.js desktop/preload.js public/index.html package.json
git commit -m "feat: 增加 Mineradio 原生同目录歌词支持" -m "本地歌曲播放时由 Mineradio 安全读取同目录同名 LRC/TTML，并转换为统一歌词模型；Folia 不参与歌词管理。"
```

---

## Task 3: Folia 风格视觉预设状态模型

**Files:**

- Create: `public/folia-inspired-visual-state.js`
- Create: `tests/folia-inspired-visual-state.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/folia-inspired-visual-state.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeFoliaInspiredPreset,
  normalizeFoliaInspiredFx,
  foliaInspiredPresetList,
} = require('../public/folia-inspired-visual-state');

test('normalizes Folia-inspired preset ids', () => {
  assert.equal(normalizeFoliaInspiredPreset('classic'), 'classic');
  assert.equal(normalizeFoliaInspiredPreset('partita'), 'partita');
  assert.equal(normalizeFoliaInspiredPreset('bad'), 'classic');
});

test('keeps first-wave presets explicit and stable', () => {
  assert.deepEqual(foliaInspiredPresetList().map(item => item.id), ['classic', 'partita', 'monet']);
});

test('clamps Folia-inspired visual parameters', () => {
  const fx = normalizeFoliaInspiredFx({ lyricScale: 5, glow: -1, beatMotion: 9 });
  assert.equal(fx.lyricScale, 1.8);
  assert.equal(fx.glow, 0);
  assert.equal(fx.beatMotion, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-inspired-visual-state.test.js
```

- [ ] **Step 3: Implement state helper**

Create UMD helper:

- `DEFAULT_FOLIA_INSPIRED_FX`
- `normalizeFoliaInspiredPreset(id)`
- `normalizeFoliaInspiredFx(input)`
- `patchFoliaInspiredFx(current, patch)`
- `foliaInspiredPresetList()`

First-wave presets:

- `classic`
- `partita`
- `monet`

Keep `cadenza/fume/cappella/tilt` in roadmap, not first implementation.

- [ ] **Step 4: Add script check**

Modify `package.json`:

```bash
node --check public/folia-inspired-visual-state.js
```

- [ ] **Step 5: Run verification**

Run:

```bash
node --test tests/folia-inspired-visual-state.test.js
npm run check
npm test
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add public/folia-inspired-visual-state.js tests/folia-inspired-visual-state.test.js package.json
git commit -m "feat: 增加 Folia 风格视觉预设状态模型" -m "新增 Mineradio 原生 Folia 风格视觉预设配置，首批支持 Classic、Partita、Monet 三类视觉参考。"
```

---

## Task 4: Mineradio 原生 Folia 风格视觉渲染

**Files:**

- Create or Modify: `public/lyric-visual-presets.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke tests**

Add:

```js
test('Folia-inspired visual presets are rendered by Mineradio native visual runtime', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const visualState = fs.readFileSync(path.join(repoRoot, 'public', 'folia-inspired-visual-state.js'), 'utf8');

  assert.match(html, /Folia 风格歌词视觉/);
  assert.match(html, /data-folia-inspired-preset="classic"/);
  assert.match(html, /data-folia-inspired-preset="partita"/);
  assert.match(html, /data-folia-inspired-preset="monet"/);
  assert.match(visualState, /foliaInspiredPresetList/);
  assert.doesNotMatch(html, /进入 Folia 平台/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/smoke.test.js
```

- [ ] **Step 3: Add DIY preset controls**

In `public/index.html`, add under visual preset/lyrics section:

```html
<div class="fx-section-label">Folia 风格歌词视觉</div>
<div class="fx-seg folia-inspired-preset-seg" id="folia-inspired-preset">
  <button type="button" data-folia-inspired-preset="classic" onclick="setFoliaInspiredPreset('classic')">Classic</button>
  <button type="button" data-folia-inspired-preset="partita" onclick="setFoliaInspiredPreset('partita')">Partita</button>
  <button type="button" data-folia-inspired-preset="monet" onclick="setFoliaInspiredPreset('monet')">Monet</button>
</div>
```

Add controls:

- 歌词大小
- 逐字高亮
- 视觉光晕
- 背景浓度
- 鼓点响应

- [ ] **Step 4: Implement native renderer switch**

In `public/lyric-visual-presets.js` or existing visual runtime:

- Register `folia-classic`.
- Register `folia-partita`.
- Register `folia-monet`.

Each preset consumes Mineradio lyric model:

- Current line.
- Word timing if available.
- Translation if available.
- Audio beat/bass if available.
- Theme colors.

No Folia runtime ownership.

- [ ] **Step 5: Fallback when unsupported**

If browser cannot render a preset:

- fallback to Mineradio default lyric visual.
- show toast once.
- do not stop playback.

- [ ] **Step 6: Run verification**

Run:

```bash
npm run check
npm test
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add public/lyric-visual-presets.js public/index.html public/styles/app.css tests/smoke.test.js
git commit -m "feat: 增加 Mineradio 原生 Folia 风格歌词视觉" -m "参考 Folia 的 Classic、Partita、Monet 表现实现 Mineradio 原生歌词视觉预设，预设切换不进入 Folia 平台、不接管播放。"
```

---

## Task 5: Mineradio 原生 AI 主题生成参考 Folia 风格

**Files:**

- Create: `public/folia-inspired-theme-state.js`
- Create: `tests/folia-inspired-theme-state.test.js`
- Modify: `public/folia-theme-state.js`
- Modify: `server/routes/folia-theme.js`
- Modify: `public/index.html`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `tests/folia-inspired-theme-state.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFoliaInspiredThemeInput,
  mapFoliaInspiredThemeToMineradio,
} = require('../public/folia-inspired-theme-state');

test('builds a Mineradio-owned AI theme input with Folia visual reference', () => {
  const input = buildFoliaInspiredThemeInput({
    song: { title: 'Song', artist: 'Artist' },
    preset: 'partita',
    lyrics: ['line one', 'line two'],
  });

  assert.equal(input.owner, 'mineradio');
  assert.equal(input.visualReference, 'folia-partita');
});

test('maps Folia-inspired theme result to Mineradio theme fields', () => {
  const theme = mapFoliaInspiredThemeToMineradio({
    accentColor: '#38bdf8',
    backgroundColor: '#020617',
    lyricColor: '#f8fafc',
  });

  assert.equal(theme.particleTint, '#38bdf8');
  assert.equal(theme.lyricColor, '#f8fafc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-inspired-theme-state.test.js
```

- [ ] **Step 3: Implement theme helper**

Create `public/folia-inspired-theme-state.js`:

- `buildFoliaInspiredThemeInput(context)`
- `mapFoliaInspiredThemeToMineradio(result)`
- `normalizeFoliaInspiredThemeMode(value)`

Rules:

- Owner is Mineradio.
- Folia only appears as visual reference label.
- No automatic AI request on track switch.
- Missing API key -> cover color fallback.

- [ ] **Step 4: Update theme UI**

In `public/index.html`:

- Rename `Folia AI 主题` to `Folia 风格主题参考`.
- UI copy says “参考 Folia 舞台审美生成 Mineradio 主题”.
- Trigger remains manual.

- [ ] **Step 5: Update backend route wording and payload**

In `server/routes/folia-theme.js`:

- Keep route for compatibility if already used.
- Payload should indicate `owner: 'mineradio'`.
- Prompt should ask for Mineradio theme fields, with Folia visual reference.

- [ ] **Step 6: Add script check**

Modify `package.json`:

```bash
node --check public/folia-inspired-theme-state.js
```

- [ ] **Step 7: Run verification**

Run:

```bash
node --test tests/folia-inspired-theme-state.test.js
npm run check
npm test
git diff --check
```

- [ ] **Step 8: Commit**

```bash
git add public/folia-inspired-theme-state.js tests/folia-inspired-theme-state.test.js public/folia-theme-state.js server/routes/folia-theme.js public/index.html package.json
git commit -m "feat: 增加 Mineradio 原生 Folia 风格 AI 主题" -m "AI 主题由 Mineradio 统一触发、缓存和应用，Folia 只作为视觉参考标签，不参与播放或主题管理。"
```

---

## Task 6: 迁移/降级旧 Folia Bridge 入口

**Files:**

- Modify: `public/folia-stage-ui.js`
- Modify: `public/index.html`
- Modify: `tests/folia-stage-ui.test.js`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing compatibility tests**

Update `tests/folia-stage-ui.test.js`:

```js
test('legacy Folia stage remains fallback only and native presets are preferred', async () => {
  const { init } = require('../public/folia-stage-ui');
  assert.equal(typeof init, 'function');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'folia-stage-ui.js'), 'utf8'), /legacy|fallback|compat/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/folia-stage-ui.test.js
```

- [ ] **Step 3: Mark old iframe stage as compatibility path**

In `public/folia-stage-ui.js`:

- Rename user-facing text to compatibility/fallback.
- Keep code working for old users.
- Do not make it the main route for Folia-style visuals.

In `public/index.html`:

- Move old Folia stage entry out of primary Home/DIY path if present.
- Primary path is native Folia-inspired visual preset selection.

- [ ] **Step 4: Run verification**

Run:

```bash
npm run check
npm test
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add public/folia-stage-ui.js public/index.html tests/folia-stage-ui.test.js tests/smoke.test.js
git commit -m "refactor: 将旧 Folia Bridge 舞台降级为兼容入口" -m "主路径改为 Mineradio 原生 Folia 风格视觉预设，旧 Folia iframe stage 仅作为兼容和回退入口保留。"
```

---

## Task 7: Final Verification and Docs

**Files:**

- Modify: `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Optional Modify: `docs/修改日志.md`

- [ ] **Step 1: Update docs**

In `docs/FOLIA_SOURCE_FUSION_UPGRADE.md`, add:

```md
### 阶段 9：Folia 视觉参考化

目标：所有功能由 Mineradio 管理，Folia 仅作为歌词视觉风格参考。

验收：
- 用户不再进入 Folia 平台。
- Mineradio 原生支持同目录 LRC/TTML。
- Mineradio DIY 可切换 Folia Classic/Partita/Monet 风格预设。
- AI 主题由 Mineradio 触发、缓存和应用。
- 旧 Folia iframe 仅作为兼容路径存在。
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run check
npm test
npm run folia:build
git diff --check
```

Note: `npm run folia:build` remains useful while legacy stage compatibility exists. If future work removes the iframe path completely, this command can be removed from the required checklist.

- [ ] **Step 3: Manual acceptance**

Manual scenario:

1. `npm start`.
2. Play an online song.
3. Open DIY.
4. Switch to `Folia 风格歌词视觉 -> Classic`.
5. Confirm no Folia platform page opens.
6. Switch to `Partita` and `Monet`.
7. Confirm playback continues.
8. Play a local file with same-directory `.lrc`.
9. Confirm Mineradio loads local lyrics.
10. Trigger `Folia 风格主题参考`.
11. Confirm theme applies to Mineradio visuals.
12. Restart app and confirm selected native Folia-inspired preset persists.

- [ ] **Step 4: Commit**

```bash
git add docs/FOLIA_SOURCE_FUSION_UPGRADE.md THIRD_PARTY_NOTICES.md docs/修改日志.md
git commit -m "docs: 记录 Folia 视觉参考化验收说明" -m "明确所有播放、歌词、AI 和配置能力由 Mineradio 管理，Folia 仅作为视觉表现参考；记录验证命令和手动验收场景。"
```

---

## Verification Checklist

每个阶段提交前必须执行：

```bash
npm run check
npm test
git diff --check
```

涉及本地歌词读取：

```bash
node --test tests/local-lyric-file-state.test.js
```

涉及原生 Folia 风格视觉：

```bash
node --test tests/folia-inspired-visual-state.test.js
```

涉及 AI 主题：

```bash
node --test tests/folia-inspired-theme-state.test.js
```

仍保留旧 Folia iframe 兼容路径时：

```bash
npm run folia:build
```

## Commit Sequence

1. `docs: 明确 Folia 仅作为视觉参考`
2. `feat: 增加 Mineradio 原生同目录歌词支持`
3. `feat: 增加 Folia 风格视觉预设状态模型`
4. `feat: 增加 Mineradio 原生 Folia 风格歌词视觉`
5. `feat: 增加 Mineradio 原生 Folia 风格 AI 主题`
6. `refactor: 将旧 Folia Bridge 舞台降级为兼容入口`
7. `docs: 记录 Folia 视觉参考化验收说明`

每个提交正文必须写明：

- 哪些能力继续由 Mineradio 管理。
- Folia 本阶段只参考了什么视觉表现。
- 是否触碰旧 Folia iframe 兼容路径。
- 验证命令与结果。

## Risks and Guardrails

- **不要重回双平台：** 不新增 Folia 平台入口，不新增 Folia 播放链路。
- **不要复制不清楚授权的资源：** 视觉参考可以复刻交互和布局思路，不直接搬不明授权资源。
- **本地文件安全：** 同目录歌词读取必须由 Electron 主进程限制路径。
- **视觉预设热切换：** 切预设不能中断播放、不能重置歌曲、不能重拉平台数据。
- **AI 隐私：** AI 主题必须手动触发或命中缓存，不能切歌自动发送歌词。
- **旧 bridge 兼容：** 如果保留旧 Folia iframe，只能作为 fallback，不作为主体验。

## Final Outcome

完成后定位：

```text
Mineradio = 所有功能和状态管理中心
Folia = 视觉审美参考来源
```

更具体：

```text
播放、歌词、AI、DIY、缓存、队列、歌单、本地文件 = Mineradio 管
Classic / Partita / Monet 等歌词舞台表现 = 参考 Folia，在 Mineradio 原生实现
```

这才是减法：不是把 Folia 接进来继续管一堆东西，而是把它的好看部分学过来，乖乖变成 Mineradio 自己的能力。
