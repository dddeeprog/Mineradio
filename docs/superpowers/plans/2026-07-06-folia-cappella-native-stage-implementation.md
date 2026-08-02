# Folia Cappella Native Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Mineradio-native Cappella lyric stage that fully replaces the existing single-line 3D lyric when the user selects `歌词视觉增强 -> 声部 / Cappella`.

**Architecture:** Keep Mineradio as the only playback, lyric, theme, DIY, and audio-analysis owner. Add a DOM/CSS native Cappella stage renderer that consumes Mineradio lyric frames and crossfades with the existing 3D lyric layer. First-phase scope is Cappella only; other Folia-style presets must not pretend to be complete native-stage replicas.

**Tech Stack:** Plain browser JavaScript UMD modules, DOM/CSS renderer, existing Mineradio `public/index.html` integration points, Node built-in test runner, existing `npm run check` / `npm test` verification.

---

## Implementation Notes

- The current worktree may already contain uncommitted Folia/weather changes. Do not revert unrelated changes. Stage only the files required by each task.
- Every important stage must be committed with a detailed Chinese commit message.
- Prefer modifying the already introduced native Folia files instead of adding more large blocks to `public/index.html`.
- The standalone Folia iframe entry may remain as a temporary reference path, but this plan does not depend on it and must not route the user into Folia as a platform.
- Cappella is the only first-phase preset that should use the new replacement stage. `classic / partita / monet / fume / tilt` may keep existing Mineradio-enhancement behavior until their own renderer phases exist.

## File Structure

- Modify: `public/folia-native-stage-state.js`
  - Owns pure state conversion from Mineradio playback/lyrics into native stage frames.
  - Add Cappella-specific message model details: lane, avatar, timestamp, sticker, active emphasis, stable key.

- Modify: `public/folia-native-stage-renderers.js`
  - Owns DOM string rendering and patch helpers.
  - Upgrade Cappella renderer from a lightweight demo into the canonical first native stage renderer.

- Modify: `public/folia-native-stage-ui.js`
  - Owns mount lifecycle, frame transitions, ghost frames, and show/hide state.
  - Must avoid clearing the whole stage during same-line word progress updates.

- Modify: `public/lyric-visual-presets.js`
  - Add/adjust a helper or profile contract so only Cappella selects the native replacement stage in phase 1.
  - Other Folia-inspired presets continue using the existing Mineradio enhancement path.

- Modify: `public/index.html`
  - Keep integration edits small.
  - Route Cappella frames to native stage.
  - Hide/suppress the original 3D lyric while Cappella native stage is active.
  - Restore original lyric when switching away from Cappella.

- Modify: `public/styles/app.css`
  - Implement final Cappella visual language: message flow, active bubble, avatar, timestamp, sticker, responsive sizing, crossfade states.

- Modify: `tests/folia-native-stage-state.test.js`
  - Add state-model tests for Cappella frames, active message, keys, avatars, stickers, seek safety.

- Modify or create: `tests/folia-native-stage-renderers.test.js`
  - Test renderer output strings and stable DOM hooks if the file does not exist.

- Modify: `tests/lyric-visual-presets.test.js`
  - Test that only Cappella selects native replacement stage in this phase.

- Modify: `tests/smoke.test.js`
  - Assert Cappella is wired as replacement stage and original 3D lyric path is suppressed while active.

## Task 0: Baseline Guard

**Files:**
- Read only: current worktree.

- [ ] **Step 1: Inspect current dirty state**

Run:

```bash
git status --short
```

Expected: existing unrelated dirty files may be present. Do not revert them.

- [ ] **Step 2: Run baseline checks**

Run:

```bash
npm run check
npm test
git diff --check
```

Expected: ideally all pass. If a pre-existing failure appears, record it before starting and keep later fixes scoped to this plan.

- [ ] **Step 3: Commit only if a baseline fix is required**

If the baseline is already passing, do not commit. If a baseline-only fix is needed, stage only those files and commit:

```bash
git add <baseline-files>
git commit -m "chore: 修正 Cappella 舞台实现前的基线问题" -m "说明基线失败原因、修复范围和验证命令结果。"
```

## Task 1: Cappella State Model

**Files:**
- Modify: `public/folia-native-stage-state.js`
- Modify: `tests/folia-native-stage-state.test.js`

- [ ] **Step 1: Write failing tests for a full Cappella frame**

Add tests that describe the desired frame shape:

```js
test('builds a complete Cappella message frame with active, context, avatars and stickers', () => {
  const frame = buildFoliaNativeStageFrame({
    preset: 'cappella',
    currentTime: 12.4,
    song: {
      id: 42,
      name: 'Would you still love me',
      artist: 'Artist',
      coverUrl: 'https://img.test/cover.jpg',
    },
    lines: [
      { t: 8, text: 'And we lost it all today' },
      { t: 12, text: 'Would you still love me the same?', words: [
        { t: 12, d: 0.4, text: 'Would' },
        { t: 12.4, d: 0.3, text: 'you' },
      ] },
      { t: 16, text: 'If I showed you my flaws' },
    ],
  });

  assert.equal(frame.enabled, true);
  assert.equal(frame.preset, 'cappella');
  assert.equal(frame.stageObjects.kind, 'cappella-conversation');
  assert.equal(frame.stageObjects.messages.some((m) => m.role === 'active'), true);
  const active = frame.stageObjects.messages.find((m) => m.role === 'active');
  assert.equal(active.text, 'Would you still love me the same?');
  assert.equal(active.avatar.coverUrl, 'https://img.test/cover.jpg');
  assert.equal(active.words.some((w) => w.state === 'active'), true);
  assert.equal(frame.stageObjects.stickers.length > 0, true);
});
```

- [ ] **Step 2: Write failing tests for phase-1 native-stage selection**

If the helper lives in `public/folia-native-stage-state.js`, test it there. If it lives in `public/lyric-visual-presets.js`, put this test in `tests/lyric-visual-presets.test.js`.

```js
test('uses native replacement stage only for Cappella in phase one', () => {
  assert.equal(shouldUseFoliaNativeStage({ enabled: true, preset: 'cappella' }), true);
  assert.equal(shouldUseFoliaNativeStage({ enabled: true, preset: 'classic' }), false);
  assert.equal(shouldUseFoliaNativeStage({ enabled: true, preset: 'partita' }), false);
  assert.equal(shouldUseFoliaNativeStage({ enabled: false, preset: 'cappella' }), false);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
node --test tests/folia-native-stage-state.test.js
node --test tests/lyric-visual-presets.test.js
```

Expected: fail because frame fields or selection behavior do not exist yet.

- [ ] **Step 4: Implement Cappella frame fields**

Update `public/folia-native-stage-state.js`:

- Extend `sourceContext()` to accept song key and lyric source without leaking private fields.
- Extend `cappellaMessageFromLine()` to include:
  - `avatar: { key, side, coverUrl, label, color }`
  - `emphasis: 'active' | 'context'`
  - `placement: { side, lane, order }`
  - `timestamp`
  - `text`
  - `words`
  - `progress`
- Extend `buildCappellaStageObjects()` to include:
  - `messages`
  - `stickers`
  - `activeMessageKey`
  - `layoutVersion: 2`
- Keep `buildFoliaNativeStageObjectKey()` stable across renders for the same song, lyric source, start time, end time, and text.

Suggested helper shape:

```js
function cappellaAvatarForLine(line, side, context) {
  var coverUrl = cleanText(context && context.coverUrl);
  var label = cleanText(context && context.artist) || cleanText(context && context.songTitle) || 'Mineradio';
  return {
    key: coverUrl ? 'cover:' + hashString(coverUrl) : 'theme:' + hashString(label + ':' + side),
    side: side,
    coverUrl: coverUrl,
    label: label,
    color: context && context.accentColor || '',
  };
}
```

- [ ] **Step 5: Restrict native stage to Cappella**

Update `shouldUseFoliaNativeStage(fx)` so phase 1 returns true only when:

```js
fx && fx.enabled !== false && normalizeFoliaNativePreset(fx.preset) === 'cappella'
```

Do not remove profile data for other presets; keep it for future phases.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/folia-native-stage-state.test.js
node --test tests/lyric-visual-presets.test.js
```

Expected: pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add public/folia-native-stage-state.js tests/folia-native-stage-state.test.js tests/lyric-visual-presets.test.js
git commit -m "feat: 建立 Cappella 原生歌词舞台状态模型" -m "补充 Cappella 消息帧、头像、贴纸、逐字状态和稳定 key，并将第一阶段原生替代舞台限定为 Cappella 预设。"
```

## Task 2: Cappella Renderer Contract

**Files:**
- Modify: `public/folia-native-stage-renderers.js`
- Modify or create: `tests/folia-native-stage-renderers.test.js`
- Modify: `package.json` if a new test file needs no script change, no change required; if a new source file is created, add it to `check`.

- [ ] **Step 1: Write failing renderer tests**

If `tests/folia-native-stage-renderers.test.js` does not exist, create it.

Test requirements:

```js
test('renders Cappella messages with stable keys, avatars, timestamps and active bubble hooks', () => {
  const html = renderScene({
    preset: 'cappella',
    profile: { className: 'folia-native-cappella', layout: 'voice-bubbles' },
    stageObjects: {
      kind: 'cappella-conversation',
      activeMessageKey: 'active-1',
      messages: [{
        key: 'active-1',
        lineKey: 'line-1',
        role: 'active',
        side: 'right',
        timestamp: '0:12',
        text: 'Would you still love me?',
        avatar: { key: 'cover:a', coverUrl: 'https://img.test/a.jpg', label: 'Artist' },
        words: [{ key: 'w1', text: 'Would', state: 'active', progress: 0.5 }],
      }],
      stickers: [{ key: 's1', lineKey: 'line-1', side: 'left', glyph: '♪', progress: 0.5 }],
    },
  });

  assert.match(html, /folia-native-cappella-thread/);
  assert.match(html, /data-message-key="active-1"/);
  assert.match(html, /folia-native-message active right/);
  assert.match(html, /folia-native-avatar/);
  assert.match(html, /0:12/);
  assert.match(html, /data-word-key="w1"/);
  assert.match(html, /folia-native-sticker/);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test tests/folia-native-stage-renderers.test.js
```

Expected: fail if renderer lacks required hooks or file does not exist.

- [ ] **Step 3: Implement renderer markup**

Update `public/folia-native-stage-renderers.js`:

- Make `renderCappellaScene(frame)` the first-class renderer for Cappella.
- Ensure each message has:
  - `data-message-key`
  - `data-line-key`
  - `data-role`
  - `data-side`
  - avatar element with `data-avatar-key`
  - timestamp element
  - bubble element
  - bubble text element
- If `avatar.coverUrl` exists, render it as a CSS custom property:

```html
style="--avatar-image:url('...')"
```

Escape URLs and text safely. If URL escaping is awkward, store `data-cover-url` and let CSS fallback handle color-only avatars in this phase.

- [ ] **Step 4: Improve patch semantics**

Update `patchCappellaFrame(scene, frame)`:

- If active message still exists, patch only its word nodes.
- If active message key changed, return `false` so UI can do a crossfade/re-render.
- Do not remove the whole stage during word progress updates.

- [ ] **Step 5: Run focused renderer tests**

Run:

```bash
node --test tests/folia-native-stage-renderers.test.js
```

Expected: pass.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add public/folia-native-stage-renderers.js tests/folia-native-stage-renderers.test.js package.json
git commit -m "feat: 实现 Cappella 原生歌词舞台渲染器" -m "升级 Cappella renderer 的消息、头像、时间戳、贴纸和逐字 patch DOM 合约，为后续无感切换提供稳定节点。"
```

## Task 3: Native Stage UI Lifecycle and 3D Lyric Replacement

**Files:**
- Modify: `public/folia-native-stage-ui.js`
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write smoke assertions for mutual exclusion**

Add smoke tests that assert the wiring expresses the replacement rule.

Suggested assertions:

```js
test('Cappella native stage replaces the default 3D lyric layer', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(repoRoot, 'public', 'folia-native-stage-ui.js'), 'utf8');

  assert.match(html, /shouldUseFoliaNativeStageRuntime\(\)/);
  assert.match(html, /clearFoliaNativeStage\(/);
  assert.match(html, /updateFoliaNativeStageFrame\(/);
  assert.match(html, /showStageLine\(/);
  assert.match(ui, /folia-native-stage/);
  assert.match(ui, /mode === 'crossfade'/);
});
```

This test does not fully prove runtime behavior, but it guards the intended integration points.

- [ ] **Step 2: Run smoke test and verify expected failure**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: fail until wiring or UI lifecycle strings exist.

- [ ] **Step 3: Upgrade native stage UI lifecycle**

Update `public/folia-native-stage-ui.js`:

- Keep one root `#folia-native-stage`.
- Add `rootEl.classList.toggle('active', frame.enabled)`.
- Add a clear data state:
  - `data-preset="cappella"`
  - `data-mode="enter|update|crossfade|exit"`
- On `transition.mode === 'update'`, call `patchLiveFrame()` and avoid `innerHTML` reset.
- On `crossfade`, move old scene to ghost layer, render new scene to current layer, remove ghost after `keepPreviousMs`.
- On `exit`, fade out current scene before clearing.

Do not add clickable UI here; `pointer-events` should stay off.

- [ ] **Step 4: Route Cappella frame from Mineradio**

Update `public/index.html` near the existing lyric update path:

- In the function that decides whether to use native stage, ensure it reads the current `foliaInspiredFx` and returns true only for enabled Cappella.
- When native stage is active:
  - build frame with current song, current time, lyrics lines, active line, progress, cover URL, and theme token.
  - call `updateFoliaNativeStageFrame(frame, reason)`.
  - do not call `showStageLine(...)` for the same lyric frame.
- When native stage is inactive:
  - call `clearFoliaNativeStage('disabled-or-preset-change')`.
  - restore normal `showStageLine(...)` behavior.

The integration should be small and should reuse existing helper functions such as `currentFoliaInspiredLyricProfile()`, `currentLyricSong()`, and lyric timing helpers instead of duplicating lyric search logic.

- [ ] **Step 5: Ensure old 3D lyric is hidden while Cappella is active**

If old meshes can remain visible after switching to Cappella, add a targeted cleanup call at the switch boundary:

```js
if (foliaNativeActive) {
  clearStageLyricMeshesForNativeStage('folia-cappella');
}
```

If no such helper exists, create a tiny helper in `public/index.html` that only fades/clears current `stageLyrics` meshes and does not affect background particles.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/smoke.test.js
node --test tests/folia-native-stage-state.test.js
node --test tests/folia-native-stage-renderers.test.js
```

Expected: pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add public/folia-native-stage-ui.js public/index.html tests/smoke.test.js
git commit -m "feat: 接入 Cappella 歌词舞台无感切换" -m "让 Cappella 原生舞台在启用时替代 Mineradio 原 3D 歌词，并通过 update/crossfade/exit 生命周期减少切句、seek 和切预设闪烁。"
```

## Task 4: Cappella Visual Polish

**Files:**
- Modify: `public/styles/app.css`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Add smoke assertions for required CSS hooks**

Add assertions:

```js
test('Cappella native stage has complete visual hooks', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(css, /\.folia-native-cappella-thread/);
  assert.match(css, /\.folia-native-message\.active/);
  assert.match(css, /\.folia-native-avatar/);
  assert.match(css, /\.folia-native-sticker/);
  assert.match(css, /@keyframes folia-native-message-enter/);
  assert.match(css, /@media\s*\(max-width:720px\)/);
});
```

- [ ] **Step 2: Run smoke test and verify failure if hooks are missing**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: fail until CSS hooks are complete.

- [ ] **Step 3: Upgrade CSS visual system**

Update `public/styles/app.css` Cappella section:

- Stage root:
  - fixed inset overlay.
  - no pointer events.
  - safe z-index below top chrome and bottom controls.
- Thread:
  - width: `min(900px, 82vw)`.
  - max-height leaving bottom bar space.
  - vertical message rhythm.
- Message:
  - left/right alignment.
  - previous/upcoming smaller and translucent.
  - active larger and centered/focused.
- Bubble:
  - glass white/gray bubble similar to Folia.
  - long lines wrap.
  - current bubble has stronger shadow and glow.
- Avatar:
  - circular.
  - cover image when available.
  - generated gradient fallback.
- Sticker:
  - small floating musical reaction.
  - tied visually near active bubble but not covering text.
- Responsive:
  - below 720px, reduce bubble width and font size.
  - avoid bottom player overlap.
- Reduced motion:
  - if body or settings indicate reduce motion, shorten or disable translations and blur.

- [ ] **Step 4: Run smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add public/styles/app.css tests/smoke.test.js
git commit -m "polish: 优化 Cappella 歌词舞台视觉细节" -m "完善 Cappella 消息流、气泡、头像、贴纸、响应式和动效样式，使其明显区别于原单行 3D 歌词。"
```

## Task 5: Full Verification and Manual Acceptance

**Files:**
- Modify only if verification reveals a scoped issue.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
npm run check
```

Expected: exit 0.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run HTML inline script parse check**

Run:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('public/index.html','utf8');const scripts=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\\s\\S]*?)<\\/script>/g)].map(m=>m[1]).filter(s=>s.trim());scripts.forEach((s,i)=>{try{new Function(s)}catch(e){console.error('inline script',i,e.message);process.exit(1)}});console.log('inline scripts ok:',scripts.length);"
```

Expected: `inline scripts ok: 2` or the current script count with exit 0.

- [ ] **Step 4: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: exit 0.

- [ ] **Step 5: Manual browser acceptance**

Run app:

```bash
npm start
```

Manual checklist:

- Play a song with line-level lyrics.
- Open `DIY -> 歌词视觉增强`.
- Enable enhanced lyric layer.
- Select `声部 / Cappella`.
- Confirm original Mineradio single-line 3D lyric is gone.
- Confirm Cappella bubbles show previous/current/upcoming lyrics.
- Confirm active bubble has word highlighting.
- Seek to another lyric line.
- Switch to another song.
- Switch from Cappella to a non-Folia visual preset and back.
- Resize window smaller.
- Confirm bottom player is not covered.

- [ ] **Step 6: Commit final verification notes if code changed**

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: 完成 Cappella 歌词舞台验收修正" -m "记录验收中发现的问题、修复范围和最终验证命令。"
```

If no fixes were needed, no final commit is required.

## Task 6: Handoff Notes

**Files:**
- Modify: `docs/修改日志.md` if the project log is being maintained for this feature.

- [ ] **Step 1: Record implementation summary**

If implementation changes are made, append a short Chinese summary:

```markdown
## 2026-07-06 Cappella 原生歌词舞台

- Cappella 预设改为 Mineradio 原生 DOM/CSS 歌词舞台。
- 启用 Cappella 时完全替代原 3D 动态歌词。
- 增加消息气泡、头像、时间戳、贴纸和逐字高亮。
- 增强切句、seek、切歌和切预设的无感过渡。
```

- [ ] **Step 2: Commit log if edited**

Run:

```bash
git add docs/修改日志.md
git commit -m "docs: 记录 Cappella 原生歌词舞台改动" -m "补充 Cappella 原生舞台实现范围、交互变化和验证结果。"
```

## Final Verification Checklist

Before claiming completion:

- [ ] `npm run check` exits 0.
- [ ] `npm test` exits 0.
- [ ] HTML inline script parse check exits 0.
- [ ] `git diff --check` exits 0.
- [ ] Manual Cappella acceptance has been completed.
- [ ] Each implementation stage has a separate Chinese git commit.

## Execution Recommendation

Use subagent-driven execution if available:

- Worker 1: Task 1 state model.
- Worker 2: Task 2 renderer contract after Task 1 lands.
- Worker 3: Task 4 CSS polish after Task 2 lands.
- Main agent: Task 3 integration and final verification, because it touches `public/index.html` and requires tight review.

If executing inline, follow tasks sequentially and do not combine commits.
