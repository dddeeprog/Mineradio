# 流光 Three.js 视觉重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前按单字跳变、固定字体和假辉光的 Three.js 流光重建为按语义词组依次弹出的浅景深歌词，并保留 Mineradio 共享渲染器、同模式 DOM 后备和货架交互。

**Architecture:** 在现有 `ThreeLyricHost` 上增加两个专用 `GlyphBatch`（清晰正文与柔光）、一个可控的受管换句层，以及纯函数语义分组和绝对时间弹簧求解器。`classic-three-state.js` 只组合布局与运动状态，`classic-three.js` 负责图集租约、批次、字体/视差注入、性能降级和生命周期；不创建第二个 WebGLRenderer、Canvas、RAF 或 AudioContext。

**Tech Stack:** 原生 JavaScript UMD、Three.js r128、Canvas2D 字形图集、Node Test、Playwright、Electron/Chromium。

---

## Scope And Guardrails

设计依据：`docs/superpowers/specs/2026-07-11-classic-three-visual-rebuild-design.md`。

当前工作分支是 `codex/develop-local-library-migration`，且已有大量未提交的 Folia 原生运行时改动。本计划必须在当前工作区继续，保留所有既有修改；不能从 `HEAD` 创建会丢失未提交依赖的干净 worktree，也不能清理或回退用户改动。

本批只重建 `classic`（流光）的 Three 主实现：

- `mineradio-3d` 及其余六种 Folia 模式保持当前后端和行为。
- 公共模式 ID 仍为 `classic`；Three 异常时仍在该模式内切到现有 DOM 流光。
- 不恢复已删除的回环效果。
- 不引入 React、Framer Motion、Folia iframe、第二个可见 Canvas、私有 RAF 或新 AudioContext。
- 逐字时钟来自 `NativeLyricFrame.now`；只允许呼吸、换句层和受限视差使用主循环 `rafDeltaMs`。
- Folia 改编文件保留固定 commit `baa5e846b7404f1893e8b7812bca79e959f21d3f` 与 AGPL-3.0-or-later 来源头。
- 下列 commit checkpoint 只是建议。当前工作区未获用户授权前，不执行 `git add` 或 `git commit`。

## File Map

### New Focused Modules

- Create `public/folia-native/classic-three-groups.js`: 将 Folia post-parser layout units 转成 Mineradio 2-4 字语义词组和 word 内视觉切片。
- Create `public/folia-native/classic-three-motion.js`: 端点归一化解析弹簧、active/passed 连续姿态、逐字扫光和换句退出曲线。
- Create `tests/folia-native-classic-three-groups.test.js`: 语义分组、标点、fallback、5/7/9/10 字切片和时间边界。
- Create `tests/folia-native-classic-three-motion.test.js`: profile 时间缩放、连续性、seek、暂停和独立换句配置。

### Existing State And Rendering

- Modify `public/folia-native/layout.js`: 移植可复用的 `buildPostLyricLayoutUnits()` 与 `buildWordGraphemeTimings()`。
- Modify `public/folia-native/dom-state.js`: 导出现有 Classic render profile 和 active-end 规则，DOM 后备行为不变。
- Rewrite `public/folia-native/classic-three-state.js`: 输出词组、词组内局部字形、安全边界和解析帧。
- Modify `public/folia-native/renderers/classic-three.js`: 两批次绘制、字体、翻译、视差、换句层、降级和诊断。

### Shared Three Primitives

- Modify `public/folia-native/three/glyph-atlas.js`: 合法 CSS 字体栈、glow padding、采样边界和缓存键。
- Modify `public/folia-native/three/glyph-batch.js`: 增加受限采样属性并维持批次容量复用。
- Modify `public/folia-native/three/material-pool.js`: 独立 body 与 9/5/3-tap glow shader 变体。
- Modify `public/folia-native/three/host.js`: 为换句提供可更新且可立即释放的受管 RenderTarget 层。
- Modify `tests/helpers/fake-three.js` only if controllable transition shader tests need missing fake fields.

### Integration And Acceptance

- Modify `public/index.html`: 按依赖顺序加载新模块，并注入 Mineradio 字体、字重、字距和受限视差。
- Modify `package.json`: 将新生产模块加入 `npm run check`。
- Modify `tests/folia-native-classic-three.test.js`.
- Modify `tests/folia-native-three-atlas.test.js`.
- Modify `tests/folia-native-three-primitives.test.js`.
- Modify `tests/folia-native-three-host.test.js`.
- Modify `tests/folia-native-page-integration.test.js`.
- Modify `tests/visual/folia-native.spec.js`.
- Modify `docs/修改日志.md` only after final verification.

## Task 0: Record The Dirty Baseline

**Files:** None.

- [ ] **Step 1: Record branch and pre-existing changes**

Run:

```powershell
git status --short --branch
```

Expected: branch is `codex/develop-local-library-migration`; existing modified, deleted, and untracked Folia files remain present. Save the output in task notes and do not clean it.

- [ ] **Step 2: Run the static and Node baseline**

Run:

```powershell
npm run check
npm test
git diff --check
```

Expected: all commands pass. The previously observed Node baseline was 393 tests, but use and record the actual current count if concurrent edits changed it.

- [ ] **Step 3: Run the current visual baseline**

Run:

```powershell
npm run test:visual
```

Expected: the existing eight Playwright tests pass. Preserve the current Classic screenshots as before-state evidence; do not treat their nonblank pixels as visual approval.

## Task 1: Port Layout Utilities And Build Deterministic Semantic Groups

**Files:**

- Modify: `public/folia-native/layout.js`
- Modify: `public/folia-native/dom-state.js`
- Create: `public/folia-native/classic-three-groups.js`
- Create: `tests/folia-native-classic-three-groups.test.js`
- Modify: `tests/folia-native-document-layout.test.js`

- [ ] **Step 1: Write failing Folia utility tests**

Add focused assertions to `tests/folia-native-document-layout.test.js`:

```js
const {
  buildPostLyricLayoutUnits,
  buildWordGraphemeTimings,
} = require('../public/folia-native/layout');

test('post-lyric units preserve parser timing while sticking contractions', () => {
  const words = [
    { text: 'It', startTime: 1, endTime: 1.2 },
    { text: '’', startTime: 1.2, endTime: 1.25 },
    { text: 's', startTime: 1.25, endTime: 1.4 },
    { text: 'time', startTime: 1.5, endTime: 2 },
  ];
  const units = buildPostLyricLayoutUnits({ fullText: 'It’s time', words }, {
    semantic: true,
    sticky: true,
  });
  assert.equal(units[0].text, 'It’s');
  assert.deepEqual(units[0].words, words.slice(0, 3));
  assert.equal(units[0].startTime, 1);
  assert.equal(units[0].endTime, 1.4);
});

test('word grapheme timings prefer syllables and remain bounded', () => {
  const timings = buildWordGraphemeTimings({
    text: '流光', startTime: 2, endTime: 2.8,
    syllables: [
      { text: '流', startTime: 2, endTime: 2.3 },
      { text: '光', startTime: 2.3, endTime: 2.8 },
    ],
  });
  assert.deepEqual(timings.map(item => [item.char, item.startTime, item.endTime]), [
    ['流', 2, 2.3], ['光', 2.3, 2.8],
  ]);
});
```

- [ ] **Step 2: Write failing group and visual-slice tests**

Create `tests/folia-native-classic-three-groups.test.js` with direct, frozen line fixtures. Cover CJK, Latin, mixed text, emoji and punctuation. The long-word table is mandatory:

```js
const { buildClassicThreeGroups } = require('../public/folia-native/classic-three-groups');

for (const [text, expected] of [
  ['一二三四五', [3, 2]],
  ['一二三四五六七', [4, 3]],
  ['一二三四五六七八九', [3, 3, 3]],
  ['一二三四五六七八九十', [4, 3, 3]],
]) {
  test(`splits one ${Array.from(text).length}-grapheme parser word deterministically`, () => {
    const groups = buildClassicThreeGroups({
      index: 0,
      fullText: text,
      startTime: 1,
      endTime: 3,
      words: [{ text, startTime: 1, endTime: 3 }],
    });
    assert.deepEqual(groups.map(group => group.bodyGraphemeCount), expected);
    assert.equal(groups.map(group => group.text).join(''), text);
    assert.equal(groups.every((group, index) => (
      index === 0 || group.startTime >= groups[index - 1].endTime
    )), true);
    assert.equal(groups[0].startTime, 1);
    assert.equal(groups.at(-1).endTime, 3);
  });
}
```

Also assert:

- a single CJK unit merges forward only when the gap is `<= 0.12s` and the result is at most four body graphemes;
- a multi-word CJK semantic unit longer than four body graphemes splits only at parser-word boundaries when every word is at most four graphemes, and produces balanced groups such as five one-character words becoming `3+2`;
- a five-character parser word followed by a two-character word produces standalone sizes `3+2+2`; neither visual slice may absorb the following word or extend its own slice interval;
- sentence punctuation attaches backward and does not count toward the four-character body limit;
- a gap over `0.12s` is never crossed;
- a sticky Latin contraction is one display group;
- disabling/injecting an unavailable word segmenter still produces deterministic 2-4 character CJK groups;
- the input `NativeLyricDocument` line and its words are not mutated.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
node --test tests/folia-native-document-layout.test.js tests/folia-native-classic-three-groups.test.js
```

Expected: FAIL because the exported Folia helpers and Classic group module do not exist.

- [ ] **Step 4: Port the reusable Folia helpers**

In `layout.js`, adapt only the parser-preserving parts of the pinned Folia files:

- `src/utils/lyrics/graphemeTiming.ts`
- `src/utils/lyrics/cjkSemanticLayout.ts`

Keep the module UMD and add the AGPL source header. Export these stable APIs:

```js
buildWordGraphemeTimings(word, wordIndex)
buildLineGraphemeTimeline(line)
buildPostLyricLayoutUnits(line, options)
buildDisplayWordsFromLayoutUnits(units)
```

`buildPostLyricLayoutUnits()` must accept an optional `segmentWords` function for tests. When absent, it uses `Intl.Segmenter`; when the platform has no Segmenter or alignment fails, it returns one parser word per unit instead of guessing.

- [ ] **Step 5: Expose Classic timing rules without changing DOM output**

In `dom-state.js`, rename/export the existing private helpers while retaining their current call sites:

```js
resolveClassicLineRenderProfile: classicRenderProfile,
getClassicWordActiveEndTime: classicWordActiveEnd,
```

Run the existing DOM test immediately:

```powershell
node --test tests/folia-native-dom-modes.test.js
```

Expected: all existing DOM fallback tests pass unchanged.

- [ ] **Step 6: Implement the approved group algorithm**

`classic-three-groups.js` consumes `layout.buildPostLyricLayoutUnits(line, { semantic: true, sticky: true })` and returns immutable planning objects. Use this exact long-unit split:

```js
function balancedSliceSizes(count, maxSize) {
  var slices = Math.ceil(count / maxSize);
  var base = Math.floor(count / slices);
  var remainder = count % slices;
  return Array.from({ length: slices }, function(_, index) {
    return base + (index < remainder ? 1 : 0);
  });
}
```

Each returned group has:

```js
{
  key,
  text,
  words,
  graphemes,
  startTime,
  endTime,
  bodyGraphemeCount,
  isCjk,
  isSticky,
  isVisualSlice,
}
```

For a word-internal visual slice, use its first and last grapheme timing as the group interval. If syllable timing is invalid or absent, divide the original word interval proportionally by grapheme count. Clamp every value into the original word interval and enforce monotonic start/end values.

Before the single-character merge pass, split every oversized multi-word CJK semantic unit with this exact parser-boundary procedure:

1. Convert each parser word of at most four body graphemes to a token. A parser word over four graphemes is converted to the word-internal visual slices above, and every resulting visual slice is emitted as a standalone hard-boundary group. It is excluded from both parser-word partitioning and the later single-character merge pass; only an immediately following zero-body punctuation token may attach to the final slice.
2. End the current token run whenever the gap to the next parser word exceeds `0.12s` or the current token ends in sentence punctuation. These hard boundaries are never crossed.
3. For each run, use memoized dynamic programming over parser-token indices to generate contiguous partitions whose group body count is at most four. For group sizes `sizes`, select the lexicographically smallest score `[groupCount, maxSize - minSize, squaredDeviationFromMean, ...sizes.map(size => -size)]`. The negative size suffix deterministically prefers the larger group earlier when all prior fields tie. This makes five one-character parser words `3+2`, while preserving indivisible parser words and avoiding exponential rescans.
4. Attach zero-body punctuation tokens to the preceding selected group and use the first/last contained timing as the group interval.

After those partitions are built, perform one deterministic single-CJK merge pass: prefer merging a one-body-grapheme group forward; at sentence end, try backward; require `gap <= 0.12` and combined body count `<= 4`. Never merge across punctuation boundaries or explicit larger gaps.

- [ ] **Step 7: Run group tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-document-layout.test.js tests/folia-native-classic-three-groups.test.js tests/folia-native-dom-modes.test.js
```

Expected: all tests pass, including `10 -> 4+3+3` and fallback segmentation.

- [ ] **Step 8: Review the optional commit checkpoint**

Proposed message: `feat: add semantic classic lyric groups`

Do not stage or commit without explicit authorization.

## Task 2: Implement The Absolute-Time Motion Solver

**Files:**

- Create: `public/folia-native/classic-three-motion.js`
- Create: `tests/folia-native-classic-three-motion.test.js`

- [ ] **Step 1: Write failing spring-profile tests**

Cover the three entry windows and endpoint-normalized curve:

```js
const {
  resolveClassicMotionProfile,
  evaluateClassicEntryProgress,
} = require('../public/folia-native/classic-three-motion');

for (const [mode, durationMs, lookahead] of [
  ['normal', 420, 0.15],
  ['fast', 240, 0.08],
  ['instant', 120, 0.03],
]) {
  test(`${mode} entry uses an absolute endpoint-normalized spring`, () => {
    const profile = resolveClassicMotionProfile({ wordRevealMode: mode });
    assert.equal(profile.entryDurationMs, durationMs);
    assert.equal(profile.lookahead, lookahead);
    assert.equal(evaluateClassicEntryProgress(durationMs / 1000, profile), 1);
    assert.ok(Math.abs(
      evaluateClassicEntryProgress((durationMs - 1) / 1000, profile) - 1
    ) <= 0.005);
  });
}
```

Add a sampled assertion that normal has a mild overshoot but never exceeds `1.04`.

- [ ] **Step 2: Write failing continuity, seek and line-exit tests**

Create a short group whose `activeEndTime` occurs before its entry window settles. Assert position, scale, Z and opacity at `activeEndTime - 1e-6`, `activeEndTime`, and `activeEndTime + 1e-6` differ only within epsilon.

Also cover:

- two calls at the same `now` but different simulated RAF histories return deep-equal poses;
- seeking directly to passed time returns the final analytic state without replay;
- fixed playback `now` freezes entry and sweep even when ambient time changes;
- `lineTransitionMode=normal/fast/none` returns 300/160/120ms independently of `wordRevealMode`;
- reduced motion removes overshoot, depth and drift but retains a 120ms fade.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
node --test tests/folia-native-classic-three-motion.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the endpoint-normalized spring**

Use the exact analytic response approved in the spec:

```js
function springStep(time) {
  return 1 - Math.exp(-10 * time) * (
    Math.cos(10 * time) + Math.sin(10 * time)
  );
}

var SPRING_END = springStep(0.42);

function evaluateClassicEntryProgress(elapsedSeconds, profile) {
  var duration = profile.entryDurationMs / 1000;
  var u = clamp(elapsedSeconds / duration, 0, 1, 0);
  if (u >= 1) return 1;
  return springStep(u * 0.42) / SPRING_END;
}
```

Do not integrate velocity across frames. The only inputs are playback time, group timing, render profile and reduced-motion flag.

- [ ] **Step 5: Implement continuous entry-to-passed poses**

Expose:

```js
resolveClassicMotionProfile(renderProfile)
resolveClassicGroupPose(group, now, renderProfile, options)
resolveClassicGraphemeVisual(grapheme, group, now, renderProfile, strength)
resolveClassicLineExit(lineTransitionMode, elapsedMs, reducedMotion)
```

`resolveClassicGroupPose()` must:

1. start entry at `group.startTime - lookahead`;
2. evaluate waiting-to-active with the analytic spring;
3. compute `entryBoundaryPose` at `getClassicWordActiveEndTime()`;
4. interpolate from that exact boundary pose to passed pose with smoothstep over 500/240/120ms;
5. return theme-color falloff separately over 800/240/120ms;
6. cap passed drift at `3deg` over five seconds.

`resolveClassicLineExit()` returns this exact contract:

```js
{ progress, opacity, scale, blurPx, done, durationMs }
```

Use max scale/blur `(1.04, 12px)` for normal, `(1.02, 6px)` for fast and `(1, 0)` for none. Reduced motion always follows the `none` geometry.

- [ ] **Step 6: Implement bounded grapheme light envelopes**

Return `{ highlight, glow }` for each grapheme. Use its own timing as the peak source; normal keeps a bounded tail, fast shortens it, instant caps the full peak/tail window at 120ms. Values are always in `[0, 1]`, already-passed characters are not replayed after seek, and no whole word receives permanent glow.

- [ ] **Step 7: Run motion tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-classic-three-motion.test.js
```

Expected: all fixed-timestamp tests pass without real timers.

- [ ] **Step 8: Review the optional commit checkpoint**

Proposed message: `feat: add analytic classic lyric motion`

## Task 3: Rebuild The Classic Three Line Model Around Rigid Groups

**Files:**

- Modify: `public/folia-native/classic-three-state.js`
- Modify: `tests/folia-native-classic-three.test.js`

- [ ] **Step 1: Replace failing per-glyph depth assertions with group invariants**

Update the beginning of `tests/folia-native-classic-three.test.js` to assert the new public shape:

```js
const model = buildClassicThreeModel(line, buildOptions());
assert.ok(model.groups.length >= 2);
for (const group of model.groups) {
  assert.equal(group.localGlyphs.every(glyph => glyph.z === 0), true);
  assert.equal(Math.abs(group.basePose.z) <= 0.08, true);
  assert.equal(Math.abs(group.basePose.rotation) <= Math.PI / 90, true);
}
```

For one two-character group, compare the local glyph distance before entry, during active and after passed. The local distance and local Z must remain identical; only the parent group pose may change.

- [ ] **Step 2: Add failing sequential-entry and safe-layout tests**

Use three groups spaced by at least 500ms. At fixed timestamps assert only the expected group is in its entry window. Add cases for:

- a short group crossing `activeEndTime` continuously;
- mixed Chinese/Latin and a family emoji grapheme;
- 390x844 and 1920x1080 safe areas;
- active envelope scale `<= 1.08` and total width `<= 92%` of available safe width;
- main and translation projected bounds do not overlap;
- cache key changes for font stack, weight, viewport, safe area, text and glow padding tier.

- [ ] **Step 3: Run the state tests and verify RED**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js
```

Expected: FAIL because the current model exposes per-glyph random depth and 1.4x status jumps.

- [ ] **Step 4: Rebuild `buildClassicThreeModel()`**

Compose `buildClassicThreeGroups()` and the exported DOM render profile. Each model group must contain:

```js
{
  key,
  text,
  startTime,
  endTime,
  activeEndTime,
  basePose,
  entryPose,
  activePose,
  passedPose,
  localGlyphs,
  projectedBounds,
}
```

Measure with the injected complete CSS font stack and weight. Place groups in a centered deterministic row with bounded seeded Y, rotation and Z. Calculate fit using every group's 1.08 active envelope plus configured word spacing; fit the envelope into 92% of safe width before converting pixels to world units.

Each `localGlyph` stores only local X/Y, zero local Z, size, timing and source indices. Its key must remain stable for the same line/group/grapheme.

- [ ] **Step 5: Rebuild translation and cache metadata**

Keep translation as a block descriptor beneath the complete main-line envelope. Include translation gap and bounds in the cache key. The cache key also includes:

```text
fontFamily | fontWeight | fontSize | letterSpacing | dprBucket | glowPaddingTier
viewport | safeArea | worldPerPixel | classic tuning | line identity
```

Do not include playback `now` or RAF delta.

- [ ] **Step 6: Rebuild `resolveClassicThreeFrame()`**

For each group, call `resolveClassicGroupPose()` once, then return its unchanged `localGlyphs` plus per-grapheme `{ highlight, glow }`. Compute final flattened glyph transforms from the same group pose for compatibility with the director; body and glow consumers must receive the same pose data.

Use `options.ambientTime` only for the bounded six-pixel-equivalent line breathing. Use playback `now` for entry, sweep, passed state and ripple.

- [ ] **Step 7: Remove obsolete visual assumptions**

Delete tests and implementation paths that require:

- per-glyph seeded Z;
- waiting scale `0.5`;
- active scale `1.4`;
- per-glyph independent rotation;
- hard status jumps.

Keep no-orbit assertions, deterministic layout, emoji integrity, chorus ripple and reduced-motion coverage.

- [ ] **Step 8: Run state and fallback tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js tests/folia-native-classic-three-motion.test.js tests/folia-native-classic-three-groups.test.js tests/folia-native-dom-modes.test.js
```

Expected: all model, motion, grouping and unchanged DOM fallback tests pass.

- [ ] **Step 9: Review the optional commit checkpoint**

Proposed message: `refactor: rebuild classic lyrics around rigid groups`

## Task 4: Add Padded Atlas Cells And Separate Body/Glow Materials

**Files:**

- Modify: `public/folia-native/three/glyph-atlas.js`
- Modify: `public/folia-native/three/glyph-batch.js`
- Modify: `public/folia-native/three/material-pool.js`
- Modify: `tests/folia-native-three-atlas.test.js`
- Modify: `tests/folia-native-three-primitives.test.js`
- Modify: `tests/helpers/fake-three.js` only if required by the test.

- [ ] **Step 1: Write failing font-stack and padded-cell tests**

Add an atlas test that acquires a glyph with:

```js
{
  fontFamily: '"Noto Serif SC","Source Han Serif SC",serif',
  weight: 850,
  size: 64,
  glowPadding: 10,
  dpr: 1.5,
}
```

Assert the fake canvas receives a legal font string beginning with `850 96.00px "Noto Serif SC",...`, not one quoted giant family name. Assert the entry exposes:

```js
entry.uv
entry.sampleUv
entry.sampleClampUv
entry.sampleWidth
entry.sampleHeight
entry.glowPadding
```

and that `sampleUv` contains `uv` while staying inside the allocated cell.

The test must also establish the unit contract: `width`, `height`, `sampleWidth`, `sampleHeight` and `glowPadding` are CSS-pixel values after dividing raster measurements by style DPR; UV fields remain normalized texture coordinates. At DPR 2, ten CSS pixels of glow padding therefore occupy twenty raster pixels but still report `entry.glowPadding === 10`.

- [ ] **Step 2: Write failing shader-variant and attribute tests**

In `tests/folia-native-three-primitives.test.js`, acquire `body`, `glow-9`, `glow-5`, and `glow-3` variants. Assert:

- body uses normal blending and one sharp alpha sample;
- glow variants use additive blending and their declared tap counts;
- the shader clamps every offset sample to the per-instance sample bounds;
- `glyph-batch.js` uploads `aUvRect`, `aUvClamp`, `aTint`, `aOpacity`, `aGlow`, and `aProgress`;
- body and glow descriptors can reuse byte-identical matrix arrays.

- [ ] **Step 3: Run primitive tests and verify RED**

Run:

```powershell
node --test tests/folia-native-three-atlas.test.js tests/folia-native-three-primitives.test.js
```

Expected: FAIL because the atlas wraps the full stack in quotes and has no padded sampling contract.

- [ ] **Step 4: Extend normalized atlas styles**

Add `glowPadding` to `normalizeStyle()` and `styleKey()`. Build the canvas font as:

```js
var font = style.weight + ' ' + rasterSize.toFixed(2) + 'px ' + style.fontFamily;
```

The default family must already be valid CSS (for example `"Noto Sans SC","Microsoft YaHei",sans-serif`). Do not strip commas or wrap the complete stack again.

Treat input `glowPadding` as CSS pixels and calculate `rasterGlowPadding = ceil(glowPadding * dpr)`. Inflate the content box symmetrically by that raster value, then add the existing allocator gap outside the sample rectangle. Keep `uv` as the content rectangle; add normalized `sampleUv`/`sampleClampUv`. Return `width`, `height`, `sampleWidth`, `sampleHeight` and `glowPadding` in CSS pixels (`rasterValue / dpr`). The content center and sample center are identical, so no bearing offset is introduced. Page count, bytes, leases and LRU limits remain unchanged.

- [ ] **Step 5: Add bounded per-instance sample data**

`glyph-batch.js` adds `aUvClamp`. A descriptor uses `sampleUv` for `aUvRect` and `sampleClampUv` for the clamp attribute. The texture dimensions become material uniforms so one texel offset is well-defined.

Do not allocate new typed arrays if a page/variant record still has enough capacity.

- [ ] **Step 6: Replace the faux brightening shader**

Create explicit material variants:

```text
body
glow-9
glow-5
glow-3
```

The body fragment shader samples the atlas alpha once and writes `vTint`; remove the existing unconditional gold addition based on `vProgress`. Glow shaders sample alpha at bounded offsets, multiply by `vGlow`, and use additive blending. `uGlobalOpacity`, `depthWrite=false`, `depthTest=true`, render order and material lease/retirement behavior remain intact.

- [ ] **Step 7: Run primitive tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-atlas.test.js tests/folia-native-three-primitives.test.js tests/folia-native-three-host.test.js
```

Expected: all atlas, shader, pooling and host ownership tests pass; disposal counts remain exact.

- [ ] **Step 8: Review the optional commit checkpoint**

Proposed message: `feat: add bounded classic lyric glow materials`

## Task 5: Make Three Transitions Controllable For Line Changes

**Files:**

- Modify: `public/folia-native/three/host.js`
- Modify: `tests/folia-native-three-host.test.js`
- Modify: `tests/helpers/fake-three.js` only if required.

- [ ] **Step 1: Write a failing controllable-transition test**

Add beside the existing transition capture test:

```js
test('ThreeLyricHost exposes a bounded controllable line transition', () => {
  const { host } = createHostFixture();
  const scope = host.createModeScope('classic');
  const transition = host.captureTransition(scope, { purpose: 'line' });

  transition.setVisualState({ opacity: 0.4, scale: 1.03, blurPx: 8 });
  assert.deepEqual(transition.snapshot(), {
    purpose: 'line', opacity: 0.4, scale: 1.03, blurPx: 8, released: false,
  });
  host.updateAnchor({ viewport: { width: 1366, height: 768, dpr: 1 } });
  assert.equal(transition.snapshot().scale, 1.03);
  transition.release();
  transition.release();
  assert.equal(transition.disposeCount(), 1);
});
```

Also verify opacity clamps to `[0,1]`, scale to `[1,1.1]`, blur to `[0,20]`, and mode-switch callers that never call `setVisualState()` still get the current static transition behavior.

- [ ] **Step 2: Run host tests and verify RED**

Run:

```powershell
node --test tests/folia-native-three-host.test.js tests/folia-native-runtime.test.js
```

Expected: FAIL because the managed handle has only `release()`.

- [ ] **Step 3: Replace the transition plane material**

Use a small host-owned `ShaderMaterial` for the captured RenderTarget plane. Uniforms:

```js
uMap
uOpacity
uBlurPx
uTexelSize
```

Use a bounded five-tap blur for line transitions; `blurPx=0` reduces to the center sample. The transition RenderTarget pixel cap and renderer state save/restore remain unchanged.

- [ ] **Step 4: Implement idempotent visual-state updates**

Return:

```js
{
  kind: 'managed-three-transition',
  setVisualState(next),
  snapshot(),
  release(),
  disposeCount(),
}
```

Store visual scale separately from the camera-anchor scale. `updateAnchor()` must reapply the latest transition visual state after anchoring so a camera update cannot reset an in-progress line fade. `release()` removes mesh, geometry, material and target exactly once.

- [ ] **Step 5: Run host/runtime tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-host.test.js tests/folia-native-runtime.test.js
```

Expected: all transition ownership tests pass, including existing 340ms runtime cleanup.

- [ ] **Step 6: Review the optional commit checkpoint**

Proposed message: `feat: add managed three line transitions`

## Task 6: Refactor The Classic Director To Two Batches

**Files:**

- Modify: `public/folia-native/renderers/classic-three.js`
- Modify: `tests/folia-native-classic-three.test.js`

- [ ] **Step 1: Upgrade the fake host and write failing batch tests**

Change `fakeClassicHost()` to retain every created glyph batch. Assert one mount creates exactly two batches named or ordered as body and glow. After one update:

```js
assert.equal(host.batches.length, 2);
const body = host.batches[0].updates.at(-1);
const glow = host.batches[1].updates.at(-1);
assert.ok(body.length > 0);
assert.equal(glow.length, body.length);
assert.deepEqual(glow.map(item => item.matrix), body.map(item => item.matrix));
assert.equal(body.every(item => item.variant === 'body'), true);
assert.equal(glow.every(item => item.variant === 'glow-5'), true);
```

At degradation level 3 or `wordGlow=0`, assert glow instances become empty while body color sweep remains.

- [ ] **Step 2: Write failing typography, translation and parallax tests**

Construct the director with:

```js
getTypography: () => ({
  fontFamily: '"Noto Serif SC",SimSun,serif',
  fontWeight: 850,
  letterSpacing: 0.04,
  key: 'song|850|0.04',
}),
getParallax: () => ({ x: 0.02, y: -0.01, rotationX: 0.008, rotationY: -0.01 }),
```

Assert atlas acquire styles, model cache keys and translation canvas font use that typography. Assert the scope group receives bounded X/Y and X/Y rotation, then assert battery and reduced-motion frames zero the parallax.

Render once, change only the typography key/weight, and render again. Assert every lease from the first layout record is released before the first acquire for the new style; the old records must not wait for three-entry LRU eviction.

- [ ] **Step 3: Write failing line-change lifecycle tests**

Render line 0, then line 1. Assert the director captures line 0 before replacing instances, uses line 0's `lineTransitionMode`, updates the handle from `rafDeltaMs`, and releases it at 300/160/120ms.

Explicitly cover `lineTransitionMode=normal + wordRevealMode=instant`: old line remains on a 300ms exit while each new group completes its own entry within 120ms. Starting another line change releases the previous handle before creating one replacement. `release()` and `destroy()` release any outstanding handle.

- [ ] **Step 4: Run director tests and verify RED**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js
```

Expected: FAIL because the current director has one batch, a fixed Noto font and no line transition controller.

- [ ] **Step 5: Acquire two scope-owned batches**

Replace `glyphBatch` with `bodyBatch` and `glowBatch`. Both are created under the same `scope.group`; use render order 38 for body and 37 for glow. Translation remains under the same group so it inherits breathing and parallax but never group-specific word transforms.

Release and null both batches on background release/destroy. Do not dispose shared atlas or material-pool resources from the director.

- [ ] **Step 6: Build one shared matrix list per frame**

For every resolved glyph, expand its content-plane width and height by `entry.sampleWidth / entry.width` and `entry.sampleHeight / entry.height`. Because atlas padding is symmetric and all entry dimensions are CSS pixels, the expanded plane remains centered on the original content box at every DPR. Calculate that padded matrix once from the rigid parent-group pose, then reuse the exact matrix object/array for body and glow descriptors. Both variants sample `entry.sampleUv`; body sees transparent padding around one sharp center mask, while glow uses the same quad for outward taps. Compute body tint on CPU by interpolating theme primary/highlight with the glyph's `highlight` value; do not keep highlight baked into the shader.

Select glow variants:

```text
quality -> glow-9
balanced -> glow-5
battery -> glow-3
degradation 1 -> one lower tier and shorter tail
degradation 2 -> no parallax, 50% group depth
degradation 3 -> no glow batch
```

- [ ] **Step 7: Inject typography and redraw translation**

Call `getTypography(frame)` before model lookup. Include its key in the line record key and pass the complete values to model measurement and atlas style. Wrap the injected style-aware measurement callback as `config.measureText = text => options.measureText(text, typography, fontSizeFor(frame))`; do not fall back to grapheme-count approximation when that callback is available. Use the same CSS stack and a derived readable weight for translation; remove every hardcoded `Noto Sans SC` occurrence from the Classic director.

Track a `layoutEnvironmentKey` containing typography key, font size, letter spacing, viewport/DPR, safe area, translation mode, glow-padding tier and all Classic layout tuning. Before acquiring the current record, compare it with the previous frame; on any change, call `clearModelCache()` immediately so every old atlas lease is released before new styled glyphs are acquired. Document change and `resize()` continue to clear immediately as they do now. The three-record LRU only limits current/next/recent lines inside one unchanged environment.

- [ ] **Step 8: Add ambient clock and bounded parallax**

Maintain a director-local `ambientTime += rafDeltaMs / 1000` for line breathing only. Pass playback `frame.now` unchanged to the motion solver. Apply injected parallax to `scope.group`, clamped to `0.03` world units and `0.7deg`; force zero for reduced motion, battery quality, shelf conflict or degradation level 2+.

- [ ] **Step 9: Implement the line transition controller**

Before replacing a rendered line, call `host.captureTransition(scope, { purpose: 'line' })`. Store outgoing `lineTransitionMode` and elapsed milliseconds. Each main-loop update calls `resolveClassicLineExit()`, forwards the visual state to the handle and releases it when `done` or after a hard 340ms cap.

This controller uses no timer and no RAF. Mode-switch capture remains the runtime's existing responsibility.

- [ ] **Step 10: Extend diagnostics without copying full lyrics**

Expose through `snapshot()` and `scope.group.userData.nativeLyricSnapshot`:

```text
bodyInstances | glowInstances | bodyDrawBatches | glowDrawBatches
groupCount | groupStates | activeGroupKeys
fontFamily | fontWeight | glowVariant | parallax
lineTransitionActive | cachedLines | degradationLevel
```

Keep host totals (`glyphInstances`, `drawBatches`, atlas bytes, leases, retired materials) valid by summing both batches.

- [ ] **Step 11: Run director and performance tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js tests/folia-native-three-performance.test.js tests/folia-native-adaptive-three.test.js
```

Expected: all director lifecycle, same-mode fallback and budget tests pass.

- [ ] **Step 12: Review the optional commit checkpoint**

Proposed message: `feat: rebuild classic three lyric director`

## Task 7: Wire Mineradio Typography And Camera Signals

**Files:**

- Modify: `public/index.html`
- Modify: `package.json`
- Modify: `tests/folia-native-page-integration.test.js`

- [ ] **Step 1: Write failing loader and injection assertions**

In `tests/folia-native-page-integration.test.js`, require this Classic dependency order:

```text
folia-native/layout.js (already eager)
folia-native/dom-state.js
folia-native/classic-three-groups.js
folia-native/classic-three-motion.js
folia-native/classic-three-state.js
folia-native/renderers/shared-dom.js
folia-native/renderers/classic.js
folia-native/renderers/adaptive-three.js
folia-native/renderers/classic-three.js
```

Assert exactly one public `classic` registration and injected `getTypography`/`measureText`/`getParallax` callbacks. Assert the renderer source no longer contains a hardcoded Classic atlas family.

- [ ] **Step 2: Run page tests and verify RED**

Run:

```powershell
node --test tests/folia-native-page-integration.test.js
```

Expected: FAIL because the new modules and callbacks are absent.

- [ ] **Step 3: Add syntax checks and lazy dependencies**

Add both new production files to `npm run check`. Load them before `classic-three-state.js` in the lazy Classic list. Do not add package dependencies or a second mode ID.

- [ ] **Step 4: Inject the current Mineradio typography**

Add:

```js
function nativeClassicLyricTypography() {
  var fontSize = innerWidth < 640 ? 42 : innerWidth < 1000 ? 56 : 72;
  return {
    fontFamily: lyricFontStackForKey(fx && fx.lyricFont),
    fontWeight: lyricFontWeightValue(),
    letterSpacing: lyricLetterSpacingPx(fontSize) / Math.max(1, fontSize),
    key: lyricTextureStyleKey(),
  };
}
```

Pass it as `getTypography`. Do not duplicate the font map in the renderer.

Add one reusable offscreen measurement canvas and inject this style-aware callback:

```js
var nativeClassicLyricMeasureCanvas = null;
function nativeClassicLyricMeasureText(text, typography, fontSize) {
  if (!nativeClassicLyricMeasureCanvas) nativeClassicLyricMeasureCanvas = document.createElement('canvas');
  var context = nativeClassicLyricMeasureCanvas.getContext('2d');
  if (!context) return String(text || '').length * fontSize * 0.65;
  context.font = typography.fontWeight + ' ' + fontSize + 'px ' + typography.fontFamily;
  var split = window.MineradioNativeLyricLayout && window.MineradioNativeLyricLayout.splitGraphemes;
  var graphemes = split ? split(text) : Array.from(String(text || ''));
  var width = graphemes.reduce(function(total, grapheme) { return total + context.measureText(grapheme).width; }, 0);
  return width + Math.max(0, graphemes.length - 1) * typography.letterSpacing * fontSize;
}
```

Pass it as `measureText`. Unit/page tests must prove a serif stack and changed weight alter measured model widths and trigger immediate cache/lease release.

- [ ] **Step 5: Inject bounded camera-relative parallax**

Add one pure callback that reads only camera/orbit state, never audio bands:

```js
function nativeClassicLyricParallax(frame) {
  var safeArea = nativeLyricSafeArea(frame);
  var common = frame && frame.config && frame.config.common || {};
  if (frame && frame.reducedMotion || common.performanceMode === 'battery' || safeArea.shelfOpen || !orbit || orbit.centerLocked || orbit.focus && orbit.focus.active) {
    return { x:0, y:0, rotationX:0, rotationY:0 };
  }
  var yaw = clampRange(shortestAngleDelta(orbit.baselineTheta, orbit.userTheta) / 0.12, -1, 1);
  var pitch = clampRange((orbit.userPhi - orbit.baselinePhi) / 0.10, -1, 1);
  return {
    x: yaw * 0.03,
    y: -pitch * 0.018,
    rotationX: pitch * 0.7 * Math.PI / 180,
    rotationY: -yaw * 0.7 * Math.PI / 180,
  };
}
```

Pass it as `getParallax`. `orbit.userTheta/userPhi` contain direct user orbit only; never read `orbit.theta/phi`, `cineTheta/cinePhi`, `beatCam`, audio bands or the composed camera shake. Keep the host's camera-facing anchor unchanged.

- [ ] **Step 6: Run integration and syntax checks and verify GREEN**

Run:

```powershell
node --test tests/folia-native-page-integration.test.js tests/folia-native-classic-three.test.js
npm run check
```

Expected: page integration, Classic unit tests and all syntax checks pass.

- [ ] **Step 7: Review the optional commit checkpoint**

Proposed message: `feat: connect classic lyrics to mineradio typography`

## Task 8: Replace Static Classic Acceptance With Motion Acceptance

**Files:**

- Modify: `tests/visual/folia-native.spec.js`
- Modify: `playwright.folia.config.js` only if the current project matrix cannot run a required viewport or GC flag.

- [ ] **Step 1: Add a dedicated three-group Classic fixture**

Do not infer motion from the generic two-word fixture. Add a Classic-only document with three explicit groups at least 500ms apart, for example:

```js
{
  t: 1,
  duration: 3.5,
  text: '流光 穿过 夜色',
  translation: 'Light crosses the night',
  words: [
    { text: '流光', t: 1.0, d: 0.45 },
    { text: '穿过', t: 2.0, d: 0.45 },
    { text: '夜色', t: 3.0, d: 0.45 },
  ],
}
```

Provide a helper that submits a frame at an exact playback timestamp and explicit `rafDeltaMs` without waiting for real audio.

- [ ] **Step 2: Extend diagnostics for body/glow and group poses**

Collect the renderer snapshot plus:

```text
bodyInstances | glowInstances | glowVariant
groupStates | activeGroupKeys | lineTransitionActive
fontFamily | fontWeight | parallax
body/glow instance matrices
mainBounds | translationBounds
```

Keep `sampleActiveLayer()` for nonblank pixel evidence, but do not use it as the motion assertion.

- [ ] **Step 3: Write the failing sequential-entry test**

At exact keyframes assert:

1. before `0.85s`, all three groups wait;
2. during the first spring, only the first group moves;
3. after the first settles, the second and third remain waiting;
4. during the second spring, the third still waits;
5. body and glow matrices for each glyph are equal;
6. no frame causes all groups to begin at the same timestamp.

This test is the direct regression for the user's observed “整句弹出”.

- [ ] **Step 4: Write pause, seek and line-transition tests**

- Submit the same playback `now` twice with 500ms ambient RAF time and assert instance matrices, highlight and glow are stable; ignore the bounded parent breathing transform.
- Seek directly from before the line to the second group and assert the analytic target state appears in one update without catch-up animation.
- Switch lines under normal/fast/none profiles and assert old-layer duration, blur and release independently of new `wordRevealMode`.
- Set reduced motion and assert no depth/parallax/overshoot while text still fades in.

- [ ] **Step 5: Write typography and quality-tier assertions**

Change Mineradio's lyric font setting to a serif option and weight, render one frame, and assert the Classic snapshot reports the exact injected stack/weight. For quality/balanced/battery assert 9/5/3-tap variants; at forced degradation level 3 assert no glow instances.

- [ ] **Step 6: Run focused motion acceptance**

Run:

```powershell
npm run test:visual -- --grep "Classic semantic groups|Classic pause seek|Classic line transition|Classic typography"
```

Expected: all focused assertions pass after Tasks 1-7. These are post-integration acceptance checks, so RED is not required here; if any assertion fails, return to the owning production task rather than weakening timing checks to accept simultaneous entry.

- [ ] **Step 7: Keep all viewport and shelf regressions**

At `390x844`, `960x540`, `1366x768`, and `1920x1080`, assert:

- main and translation bounds stay inside the safe area and do not intersect;
- text is readable and not flattened or independently skewed per character;
- body and glow are distinct batches;
- existing real stage/side shelf projection clicks still work;
- shared canvas pointer events remain enabled.

Save keyframe screenshots for first-group spring, second-group spring, passed state and line exit at `1366x768`; keep one final screenshot for every supported viewport.

- [ ] **Step 8: Run the complete visual suite and inspect images**

Run:

```powershell
npm run test:visual
```

Expected: all Playwright tests pass. Manually inspect the generated Classic images for sequential groups, crisp body text, soft but bounded glow, shallow depth, translation spacing and unobstructed shelves.

- [ ] **Step 9: Re-run switch, resource and heap acceptance**

After twenty mode switches require:

```text
activeRenderers=1
transitionLayers=0
backend=three
backendFallbackCount=0
atlasBytes<=32MB
retiredGlyphMaterials=0
heapGrowth<20MB (when measurable)
```

Forced WebGL loss must still report `mode=classic`, `backend=2d-fallback`, unchanged saved mode and uninterrupted playback.

- [ ] **Step 10: Capture physical-GPU evidence**

On the reference Windows machine, warm for two seconds and sample fifteen seconds per profile. Record WebGL renderer, average FPS, RAF p95, long tasks, atlas bytes, body/glow draw batches and heap growth in `screenshots/folia-native/classic-three-reference-performance.json`.

Acceptance remains:

- 1080p balanced: average `>=57FPS`, p95 `<=22ms`.
- 4K quality: average `>=57FPS`, p95 `<=22ms`.
- battery: average `>=29FPS`, p95 `<=40ms`.

SwiftShader results are functional evidence only and cannot sign off hardware FPS.

- [ ] **Step 11: Review the optional commit checkpoint**

Proposed message: `test: verify classic lyric motion quality`

## Task 9: Full Verification And Handoff

**Files:**

- Modify: `docs/修改日志.md`
- Verify: every file listed in this plan.

- [ ] **Step 1: Run the complete static and Node suite**

Run:

```powershell
npm run check
npm test
git diff --check
```

Expected: all pass; record the exact Node test count. `git diff --check` prints nothing.

- [ ] **Step 2: Run all Playwright acceptance**

Run:

```powershell
npm run test:visual
```

Expected: all visual tests pass and the final screenshots visibly match the approved shallow-depth direction.

- [ ] **Step 3: Verify release artifacts and Windows build**

Run:

```powershell
npm run verify:artifacts
npm run build:win:dir
```

Expected: artifact verification and unpacked Windows build pass. Existing unchanged signing/asar warnings may remain.

- [ ] **Step 4: Verify lifecycle ownership manually**

Confirm background release removes both Classic batches, translation, ripple, pending line transition and all line-record leases. Resume creates one fresh scope and two fresh batches. Host destroy disposes shared pages/materials exactly once while `stageLyrics.group` and shelf roots remain owned by Mineradio.

- [ ] **Step 5: Update the Chinese changelog with measured facts**

Add one dated entry describing semantic group entry, analytic spring, body/glow split, Mineradio typography, managed line exits, fallback preservation and exact verification results. Do not claim the other Folia modes were rebuilt.

- [ ] **Step 6: Review the final diff without touching unrelated work**

Run:

```powershell
git status --short
git diff --stat
git diff -- public/folia-native public/index.html package.json tests docs/修改日志.md
```

Expected: planned changes appear alongside acknowledged pre-existing work. There is no unrelated refactor, asset deletion, branch cleanup or metadata churn.

- [ ] **Step 7: Optional final commit only after explicit authorization**

Before any commit, review `git diff --cached` and ensure no pre-existing user changes were accidentally staged. Proposed message:

```powershell
git commit -m "feat: rebuild classic three lyric visuals"
```

## Exit Criteria

Implementation is complete only when all statements are true:

- Chinese lyrics normally enter as deterministic 2-4 character semantic groups at their own real timings; unsafe boundaries may remain single-character groups.
- A 10-character single parser word deterministically becomes `4+3+3`, with independent monotonic slice intervals.
- One group is a rigid shallow-depth unit: member glyphs are coplanar, spacing is stable and body/glow matrices match.
- Entry is absolute-time and continuous; instant reaches the normalized active endpoint at 120ms, and active-to-passed has no boundary jump.
- Body text is crisp, glow is a separate bounded additive layer, and passed glyphs return to theme color.
- Mineradio font stack/weight are used by atlas, measurement and translation; no complete CSS stack is incorrectly quoted as one family.
- Line exit mode and word reveal mode remain independent.
- Reduced motion, quality tiers, degradation, same-mode DOM fallback and background release behave as specified.
- Main/translation bounds, stage/side shelf clicks, shared canvas pointer handling and all seven untouched lyric modes have no regression.
- Full Node, Playwright, artifact and Windows build verification passes.
