# Mineradio 多分支统一整合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将四条开发线的有效能力收敛到唯一开发分支 `codex/unified-player`，最终只保留一个开发工作树以及 `master`、`develop/mineradio-maintenance` 两条基线。

**Architecture:** 以 `codex/develop-local-library-migration` 和其当前未提交的 `public/folia-native/` 原生歌词运行时为唯一底座。其他分支不执行完整 merge，只通过失败测试证明缺口后迁移纯逻辑、窄接线和必要素材；删除前使用归档标签与可验证 Git bundle 保留完整恢复路径。

**Tech Stack:** Git worktree/bundle、Electron、Node.js、原生 JavaScript、CSS、Three.js、Canvas2D、`node:test`、Playwright、electron-builder。

**Design:** `docs/superpowers/specs/2026-07-28-mineradio-branch-consolidation-design.md`

---

## 固定名称

```text
最终分支：codex/unified-player
整合工作树：C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player
备份目录：C:\Users\TomatoK\Documents\Playground\Mineradio-backups
归档文件：C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle

归档标签：
archive/pre-unify-main-20260728
archive/pre-unify-cappella-20260728
archive/pre-unify-visual-20260728
archive/pre-unify-merge-two-20260728
```

## 权威文件映射

| 领域 | 最终权威文件 | 来源分支只用于 |
| --- | --- | --- |
| 在线、本地、播放 | `public/index.html`, `public/local-*.js`, `public/source-navigation.js`, `server/routes/`, `desktop/` | 行为对照与缺口测试 |
| 原生歌词 | `public/folia-native/`, `public/styles/folia-native.css` | Cappella 与旧视觉行为对照 |
| 配置迁移 | `public/folia-native/config.js` | 旧预设值映射 |
| 本地歌词 | 新增 `public/local-lyric-file-state.js`，修改本地扫描与播放接线 | 视觉参考分支的 TTML 能力 |
| 调色板 | 新增 `public/palette-helpers.js` | `merge-two-projects` 的纯函数和测试 |
| 整合证据 | 新增 `docs/BRANCH_CONSOLIDATION_AUDIT.md` | 记录分支、测试、bundle、功能结论 |

禁止整文件替换：

- `public/index.html`
- `public/styles/app.css`
- `package.json`
- `server.js`
- `desktop/main.js`
- `desktop/preload.js`

禁止恢复：

- `public/folia-bridge-state.js`
- `public/folia-stage-ui.js`
- `build/folia-stage.js`
- `public/folia-native-stage-state.js`
- `public/folia-native-stage-renderers.js`
- `public/folia-native-stage-ui.js`

---

### Task 1: 固化当前主线检查点

**Files:**
- Preserve: current tracked changes under `C:\Users\TomatoK\Documents\Playground\Mineradio`
- Preserve: `public/folia-native/`
- Preserve: `tests/folia-native-*.test.js`
- Exclude: `.superpowers/`
- Exclude: `test-results/`

- [ ] **Step 1: 确认当前工作树和分支**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo branch --show-current
git -C $repo status --short
git -C $repo worktree list
```

Expected:

- 当前分支为 `codex/develop-local-library-migration`。
- `.superpowers/` 与 `test-results/` 不进入后续暂存。
- 三个现存工作树均列出。

- [ ] **Step 2: 运行当前主线检查点测试**

Run:

```powershell
npm run check
npm test
git diff --check
```

Expected: 全部通过；如有失败，先记录并修复当前主线回归，不得把基线失败带进统一分支。

- [ ] **Step 3: 只暂存源码、测试、文档和合法素材**

Run:

```powershell
git add -u
git add build/pretext-entry.js build/vendor-pretext.js
git add docs/superpowers/plans docs/superpowers/specs
git add playwright.folia.config.js
git add public/folia-native public/styles/folia-native.css
git add public/vendor/pretext-0.0.7.LICENSE public/vendor/pretext-0.0.7.iife.min.js
git add tests/folia-native-*.test.js tests/fx-panel-settings-structure.test.js tests/helpers tests/visual
git diff --cached --name-status
```

Expected:

- 不包含 `.superpowers/`。
- 不包含 `test-results/`。
- 包含当前所有原生歌词运行时、测试、vendor 许可和相关删除。

- [ ] **Step 4: 创建当前主线检查点提交**

Run:

```powershell
git commit -m "checkpoint: preserve native lyric integration"
```

Expected: 工作树只剩明确排除的临时目录；源码状态干净。

---

### Task 2: 固化 Cappella 工作树检查点

**Files:**
- Preserve: `.worktrees/folia-cappella-native-stage/public/folia-native-stage-*.js`
- Preserve: `.worktrees/folia-cappella-native-stage/public/folia-native-assets/`
- Preserve: `.worktrees/folia-cappella-native-stage/tests/folia-native-stage-*.test.js`

- [ ] **Step 1: 记录 Cappella 未提交状态**

Run:

```powershell
$cappella = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-cappella-native-stage'
git -C $cappella branch --show-current
git -C $cappella status --short
```

Expected: 分支为 `codex/folia-cappella-native-stage`，当前约 8 个状态项被完整列出。

- [ ] **Step 2: 运行 Cappella 定向测试并记录结果**

Run:

```powershell
node --test tests/folia-native-stage-state.test.js tests/folia-native-stage-renderers.test.js tests/smoke.test.js
git diff --check
```

Working directory: `.worktrees/folia-cappella-native-stage`

Expected: 测试通过；若旧分支本身失败，将完整输出记录到后续审计文档，但检查点仍需保存。

- [ ] **Step 3: 创建 Cappella 检查点提交**

Run:

```powershell
git add -u
git add public/folia-native-assets
git diff --cached --name-status
git commit -m "checkpoint: preserve cappella stage worktree"
```

Expected: Cappella 工作树干净，所有原有未提交源码和素材均进入检查点。

---

### Task 3: 固化视觉参考工作树检查点

**Files:**
- Preserve: `.worktrees/folia-native-visual-reference/public/local-lyric-file-state.js`
- Preserve: `.worktrees/folia-native-visual-reference/public/lyric-visual-presets.js`
- Preserve: `.worktrees/folia-native-visual-reference/public/folia-inspired-*.js`
- Preserve: matching tests and documentation

- [ ] **Step 1: 记录视觉参考未提交状态**

Run:

```powershell
$visual = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-native-visual-reference'
git -C $visual branch --show-current
git -C $visual status --short
```

Expected: 分支为 `codex/folia-native-visual-reference`，当前约 25 个状态项被完整列出。

- [ ] **Step 2: 运行视觉参考定向测试并记录结果**

Run:

```powershell
node --test tests/local-lyric-file-state.test.js tests/lyric-visual-presets.test.js tests/folia-inspired-theme-state.test.js tests/folia-inspired-visual-state.test.js tests/folia-theme-state.test.js tests/folia-theme-routes.test.js
git diff --check
```

Working directory: `.worktrees/folia-native-visual-reference`

Expected: 测试通过；若旧分支存在基线失败，记录后继续保存检查点。

- [ ] **Step 3: 创建视觉参考检查点提交**

Run:

```powershell
git add -u
git add docs/MINERADIO_FOLIA_NATIVE_VISUAL_INTEGRATION_PLAN.md
git add tests/lyric-visual-presets.test.js
git diff --cached --name-status
git commit -m "checkpoint: preserve folia visual reference worktree"
```

Expected: 视觉参考工作树干净，所有原有未提交源码、测试和文档均进入检查点。

---

### Task 4: 创建可恢复归档

**Files:**
- Create outside repo: `C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle`
- Later record: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 创建四个归档标签**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo tag -a archive/pre-unify-main-20260728 codex/develop-local-library-migration -m "Pre-unification main checkpoint"
git -C $repo tag -a archive/pre-unify-cappella-20260728 codex/folia-cappella-native-stage -m "Pre-unification Cappella checkpoint"
git -C $repo tag -a archive/pre-unify-visual-20260728 codex/folia-native-visual-reference -m "Pre-unification visual checkpoint"
git -C $repo tag -a archive/pre-unify-merge-two-20260728 codex/merge-two-projects -m "Pre-unification merge-two checkpoint"
```

Expected: 四个标签分别指向对应分支最新提交。

- [ ] **Step 2: 创建包含来源分支和归档标签的 Git bundle**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
$backup = 'C:\Users\TomatoK\Documents\Playground\Mineradio-backups'
$bundle = Join-Path $backup 'Mineradio-pre-unify-2026-07-28.bundle'
New-Item -ItemType Directory -Path $backup -Force | Out-Null
git -C $repo bundle create $bundle `
  refs/heads/codex/develop-local-library-migration `
  refs/heads/codex/folia-cappella-native-stage `
  refs/heads/codex/folia-native-visual-reference `
  refs/heads/codex/merge-two-projects `
  refs/tags/archive/pre-unify-main-20260728 `
  refs/tags/archive/pre-unify-cappella-20260728 `
  refs/tags/archive/pre-unify-visual-20260728 `
  refs/tags/archive/pre-unify-merge-two-20260728
```

Expected: bundle 文件成功生成且非空。

- [ ] **Step 3: 验证 bundle 和 SHA256**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
$bundle = 'C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle'
git -C $repo bundle verify $bundle
git -C $repo bundle list-heads $bundle
Get-FileHash -Algorithm SHA256 -LiteralPath $bundle | Format-List
```

Expected:

- `git bundle verify` 成功。
- `list-heads` 显示四个来源分支和四个归档标签。
- 记录完整 SHA256，后续写入审计文档。

---

### Task 5: 创建统一分支和独立工作树

**Files:**
- Create worktree: `.worktrees/unified-player`
- Create: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 从当前主线检查点创建统一分支**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
$unified = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
git -C $repo worktree add -b codex/unified-player $unified codex/develop-local-library-migration
```

Expected: `codex/unified-player` 在独立工作树中检出，主工作树仍停留在旧主线。

- [ ] **Step 2: 验证统一分支基线**

Run:

```powershell
$unified = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
if ((git -C $unified branch --show-current) -ne 'codex/unified-player') {
  throw 'Unified worktree is not on codex/unified-player'
}
git -C $unified status --short --branch
npm run check
npm test
git diff --check
```

Working directory: `.worktrees/unified-player`

Expected: 当前分支明确为 `codex/unified-player`，全部测试通过，工作树干净。

- [ ] **Step 3: 创建整合审计文档**

Collect the exact values first:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo rev-parse codex/develop-local-library-migration
git -C $repo rev-parse codex/folia-cappella-native-stage
git -C $repo rev-parse codex/folia-native-visual-reference
git -C $repo rev-parse codex/merge-two-projects
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle'
```

Create `docs/BRANCH_CONSOLIDATION_AUDIT.md` with:

```markdown
# Mineradio 分支统一审计

## 检查点

| 来源 | 分支提交 | 归档标签 | 工作树测试 |
| --- | --- | --- | --- |
| 当前主线 | `使用 rev-parse 的完整输出` | `archive/pre-unify-main-20260728` | `填写 Task 1 实际结果` |
| Cappella | `使用 rev-parse 的完整输出` | `archive/pre-unify-cappella-20260728` | `填写 Task 2 实际结果` |
| 视觉参考 | `使用 rev-parse 的完整输出` | `archive/pre-unify-visual-20260728` | `填写 Task 3 实际结果` |
| 两项目整合 | `使用 rev-parse 的完整输出` | `archive/pre-unify-merge-two-20260728` | clean source |

## Bundle

- 路径：`C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle`
- SHA256：`填写 Get-FileHash 的完整输出`
- `git bundle verify`：通过

## 能力结论

| 能力 | 权威实现 | 来源能力 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 群唱 | `public/folia-native/` | Cappella 舞台 | 待审计 | 待填 |
| 同目录歌词 | 当前本地库 | 视觉参考 | 待迁移 TTML | 待填 |
| 旧视觉预设 | `folia-native/config.js` | 视觉参考 | 待映射 | 待填 |
| 在线入口 | `source-navigation.js` | merge-two | 当前等价 | 待填 |
| 本地库 | `local-*.js` | merge-two | 当前等价 | 待填 |
| 桌面能力 | `desktop/` | merge-two | 当前等价 | 待填 |
| 节奏缓存 | `local-beat-cache.js` | merge-two | 当前等价 | 待填 |
| 调色板 | `public/index.html` | merge-two helper | 待提取 | 待填 |
```

- [ ] **Step 4: 提交统一分支基线审计**

Run:

```powershell
$unified = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
if ((git -C $unified branch --show-current) -ne 'codex/unified-player') {
  throw 'Refusing to commit outside codex/unified-player'
}
git -C $unified add docs/BRANCH_CONSOLIDATION_AUDIT.md
git -C $unified commit -m "docs: record branch consolidation baseline"
```

---

## Task 6-11 统一工作目录守卫

Task 6 至 Task 11 的所有文件修改、Node 命令和 Git 提交都必须在以下目录执行：

```text
C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player
```

每个 Task 开始时先运行：

```powershell
$unified = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
if ((git -C $unified branch --show-current) -ne 'codex/unified-player') {
  throw 'Refusing to modify a non-unified branch'
}
if (git -C $unified status --porcelain) {
  throw 'Unified worktree must start each task clean'
}
Set-Location -LiteralPath $unified
```

Expected: 分支为 `codex/unified-player`，工作树干净；否则停止，不得继续。

### Task 6: 审计并关闭 Cappella 分支缺口

**Files:**
- Inspect source: `public/folia-native-stage-state.js`
- Inspect source: `public/folia-native-stage-renderers.js`
- Modify only if a tested gap exists: `public/folia-native/cappella-state.js`
- Modify only if a tested gap exists: `public/folia-native/renderers/cappella.js`
- Modify only if a tested gap exists: `public/styles/folia-native.css`
- Test: `tests/folia-native-cappella.test.js`
- Test: `tests/folia-native-page-integration.test.js`
- Test: `tests/visual/folia-native.spec.js`
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 运行现有群唱行为合同**

Run:

```powershell
node --test tests/folia-native-cappella.test.js tests/folia-native-page-integration.test.js
node third_party/folia-major/node_modules/playwright/cli.js test --config=playwright.folia.config.js --grep "Cappella|群唱"
```

Expected:

- 气泡宽度在逐字出现时不变化。
- 歌词只占一行或两行。
- 头像节点为 `SPAN`，图片头像数量为 0。
- 左右气泡和头像均为 Mineradio 玻璃材质。
- 新歌词出现时复用既有节点并整体上移，不整页闪烁。

- [ ] **Step 2: 对照旧舞台测试建立缺口表**

Run:

```powershell
git show archive/pre-unify-cappella-20260728:tests/folia-native-stage-state.test.js
git show archive/pre-unify-cappella-20260728:tests/folia-native-stage-renderers.test.js
git diff --no-index `
  public/folia-native/cappella-state.js `
  ..\folia-cappella-native-stage\public\folia-native-stage-state.js
```

Expected: 把每条旧测试标记为“当前已覆盖”“已被新设计取代”或“真实缺口”；不得直接复制旧舞台文件。

- [ ] **Step 3: 对每个真实缺口先写失败测试**

Example for a missing stable-layout behavior:

```js
test('Cappella keeps existing message keys stable when the next line activates', () => {
  const doc = documentWithLines([
    { t: 0, duration: 1, text: '第一句' },
    { t: 1, duration: 1, text: '第二句' },
  ]);
  const model = buildCappellaModel(doc, { seed: 'stable-scroll' });
  const before = resolveCappellaFrame(model, buildNativeLyricFrame(doc, {
    now: 0.9,
    lineIndex: 0,
    playing: true,
  }));
  const after = resolveCappellaFrame(model, buildNativeLyricFrame(doc, {
    now: 1.1,
    lineIndex: 1,
    playing: true,
  }));
  assert.equal(after.messages.some(message =>
    before.messages.some(previous => previous.key === message.key)
  ), true);
});
```

Run:

```powershell
node --test tests/folia-native-cappella.test.js
```

Expected: 只有真实缺口测试失败；如果 Step 1 已覆盖全部能力，不新增无意义测试或实现。

- [ ] **Step 4: 最小迁移真实缺口**

Rules:

- 状态逻辑进入 `cappella-state.js`。
- DOM 差量更新进入 `renderers/cappella.js`。
- 视觉只进入 `folia-native.css`。
- 不加载 `folia-native-stage-*`。
- 不恢复图片头像。

- [ ] **Step 5: 运行群唱回归并记录结论**

Run:

```powershell
node --test tests/folia-native-cappella.test.js tests/folia-native-page-integration.test.js
npm run test:visual
git diff --check
```

Expected: 全部通过。更新审计文档群唱行为映射和证据。

- [ ] **Step 6: 将群唱视觉测试输出移出工作树**

Run:

```powershell
$unified = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player')
$generated = [IO.Path]::GetFullPath((Join-Path $unified 'test-results'))
$backupRoot = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio-backups')
$destination = Join-Path $backupRoot 'task6-cappella-test-results-20260728'
if (-not $generated.StartsWith($unified + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Generated-output path escaped the unified worktree'
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $generated) {
  if (Test-Path -LiteralPath $destination) { throw 'Task 6 test-results backup already exists' }
  Move-Item -LiteralPath $generated -Destination $destination
}
```

- [ ] **Step 7: 提交**

Run:

```powershell
git add public/folia-native/cappella-state.js public/folia-native/renderers/cappella.js public/styles/folia-native.css
git add tests/folia-native-cappella.test.js tests/folia-native-page-integration.test.js tests/visual/folia-native.spec.js
git add docs/BRANCH_CONSOLIDATION_AUDIT.md
git commit -m "test: close cappella branch parity"
git status --porcelain
```

If no implementation changed, stage only the audit evidence and use:

```powershell
git commit -m "docs: confirm cappella parity"
```

Expected: commit succeeds and final status has no output.

---

### Task 7: 迁移同目录 TTML 歌词

**Files:**
- Create: `public/local-lyric-file-state.js`
- Create: `tests/local-lyric-file-state.test.js`
- Modify: `desktop/local-assets.js`
- Modify: `desktop/local-assets.test.js`
- Modify: `public/local-library.js`
- Modify: `public/local-library.test.js`
- Modify: `public/index.html`
- Modify: `package.json`
- Modify: `tests/smoke.test.js`
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 复制并适配视觉参考分支的纯状态测试**

Add tests covering:

```js
test('builds same-directory TTML before LRC candidates', () => {
  const candidates = buildSameDirectoryLyricCandidates('D:/Music/Album/song.flac');
  assert.deepEqual(candidates.map(item => item.name), ['song.ttml', 'song.lrc']);
});

test('rejects a local lyric candidate outside the audio directory', () => {
  assert.equal(normalizeLocalLyricCandidate({
    audioPath: 'D:/Music/song.flac',
    lyricPath: 'D:/Other/song.ttml',
  }), null);
});

test('prefers TTML over enhanced and plain LRC', () => {
  assert.equal(selectPreferredLocalLyric([
    { format: 'lrc', enhanced: true, exists: true, name: 'song.lrc' },
    { format: 'ttml', enhanced: true, exists: true, name: 'song.ttml' },
  ]).format, 'ttml');
});
```

- [ ] **Step 2: 添加扫描与队列失败测试**

Add scanner and queue assertions:

```js
const {
  LOCAL_LIBRARY_ASSET_EXTS,
  LOCAL_LIBRARY_MIME,
} = require('../desktop/local-assets');

assert.equal(LOCAL_LIBRARY_ASSET_EXTS.has('.ttml'), true);
assert.equal(LOCAL_LIBRARY_MIME['.ttml'], 'application/ttml+xml');
assert.equal(song.localAdjacentLyricFile.name, 'song.ttml');
```

Add the browser wiring contract to `tests/smoke.test.js` before implementation:

```js
test('same-directory TTML is loaded before local-library wiring and uses the TTML parser', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const stateScript = html.indexOf('<script src="local-lyric-file-state.js"></script>');
  const libraryScript = html.indexOf('<script src="local-library.js"></script>');
  assert.notEqual(stateScript, -1);
  assert.ok(stateScript < libraryScript);
  assert.match(
    html,
    /function parseLocalImportedLyricText[\s\S]{0,1600}parseFoliaTtmlLyricText/
  );
  assert.ok(
    (html.match(/parseLocalImportedLyricText\(localImport\.lyricText,\s*localImport\.adjacent/g) || []).length >= 2
  );
});
```

Run:

```powershell
node --test tests/local-lyric-file-state.test.js desktop/local-assets.test.js public/local-library.test.js tests/smoke.test.js
```

Expected: FAIL because当前扫描只支持 `.lrc/.txt`、优先级模型不存在、页面未加载新状态模块且本地播放仍直接调用 `parseCustomLyricText`。

- [ ] **Step 3: 迁移纯状态模块**

Implement and export:

```js
{
  buildSameDirectoryLyricCandidates,
  normalizeLocalLyricCandidate,
  selectPreferredLocalLyric,
  normalizeParsedLocalLyrics,
}
```

Preserve:

- 只允许音频同目录。
- 只接受 `.ttml` 与 `.lrc`。
- 拒绝路径穿越和不同文件名 stem。
- 优先级 `TTML > enhanced LRC > plain LRC`。

- [ ] **Step 4: 扩展桌面扫描和本地库选择**

Modify:

- `desktop/local-assets.js`: 增加 `.ttml` MIME 与资产扩展。
- `public/local-library.js`: 将 TTML 纳入相邻歌词，并通过优先级选择而不是依赖扫描顺序。
- `public/index.html`: 在 `local-library.js` 之前加载 `local-lyric-file-state.js`。
- `public/index.html`: 新增 `parseLocalImportedLyricText(text, sourceFile)`；内容以 `<tt` 开头或来源扩展名为 `.ttml` 时复用 `parseFoliaTtmlLyricText`，LRC 继续使用 `parseCustomLyricText`。
- `public/index.html`: 两处本地播放接线都必须把 `localImport.adjacent.lyricFile` 传给 `parseLocalImportedLyricText`；FLAC 内嵌歌词没有文件扩展名时依赖内容检测。
- `package.json`: 将 `public/local-lyric-file-state.js` 加入 `npm run check`。

- [ ] **Step 5: 运行定向测试**

Run:

```powershell
node --test tests/local-lyric-file-state.test.js desktop/local-assets.test.js public/local-library.test.js tests/smoke.test.js
```

Expected: 全部通过；本地 TTML 使用现有 TTML 解析路径并进入统一歌词文档，已有的行级或逐字时间信息按解析结果保留。

- [ ] **Step 6: 提交**

Run:

```powershell
git add public/local-lyric-file-state.js tests/local-lyric-file-state.test.js
git add desktop/local-assets.js desktop/local-assets.test.js
git add public/local-library.js public/local-library.test.js public/index.html package.json tests/smoke.test.js
git add docs/BRANCH_CONSOLIDATION_AUDIT.md
git commit -m "feat: add same-directory TTML lyrics"
```

---

### Task 8: 合并旧视觉预设配置

**Files:**
- Modify: `public/folia-native/config.js`
- Modify: `tests/folia-native-config.test.js`
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 写旧视觉预设迁移失败测试**

Add:

```js
test('migrates visual-reference presets into the eight native modes', () => {
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'classic',
  }).mode, 'classic');
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'partita',
  }).mode, 'partita');
  assert.equal(migrateLegacyNativeLyricConfig(null, {
    foliaInspiredVisual: true,
    foliaInspiredPreset: 'monet',
  }).mode, 'monet');
});
```

Run:

```powershell
node --test tests/folia-native-config.test.js
```

Expected: FAIL because当前迁移只读取 `visualMode`。

- [ ] **Step 2: 最小扩展配置迁移**

Rules:

- `visualMode` 明确存在时优先。
- 否则读取 `foliaInspiredPreset`。
- 只接受 `classic | partita | monet`。
- `foliaInspiredVisual === false` 回落 `mineradio-3d`。
- 不引入 `lyric-visual-presets.js` 第二套注册表。

- [ ] **Step 3: 运行配置和设置接线测试**

Run:

```powershell
node --test tests/folia-native-config.test.js tests/folia-native-page-integration.test.js tests/fx-panel-settings-structure.test.js
git diff --check
```

Expected: 全部通过。

- [ ] **Step 4: 提交**

Run:

```powershell
git add public/folia-native/config.js tests/folia-native-config.test.js
git add docs/BRANCH_CONSOLIDATION_AUDIT.md
git commit -m "feat: migrate legacy visual presets"
```

---

### Task 9: 提取并统一调色板纯函数

**Files:**
- Create: `public/palette-helpers.js`
- Create: `public/palette-helpers.test.js`
- Modify: `public/index.html`
- Modify: `package.json`
- Modify: `tests/smoke.test.js`
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 从归档提交移植调色板测试**

Preserve tests for:

- `normalizeHexColor`
- `rgbToHexColor`
- `lyricPaletteFromHex`
- `effectiveLyricPalette`
- `lyricPaletteFromImageData`
- `coverPickerSwatchColors`
- `desktopOverlayColors`

Add the integration assertion:

```js
test('index loads palette helpers before the main inline script', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const helperIndex = html.indexOf('<script src="palette-helpers.js"></script>');
  const firstInlineIndex = html.indexOf('<script>');
  assert.notEqual(helperIndex, -1);
  assert.notEqual(firstInlineIndex, -1);
  assert.ok(helperIndex < firstInlineIndex);
  assert.match(html, /window\.MineradioPaletteHelpers/);
});
```

- [ ] **Step 2: 运行测试并验证失败**

Run:

```powershell
node --test public/palette-helpers.test.js
```

Expected: FAIL because `public/palette-helpers.js` 尚不存在。

- [ ] **Step 3: 迁移纯函数模块**

Port from `archive/pre-unify-merge-two-20260728:public/palette-helpers.js`, preserving UMD export:

```js
if (typeof module === 'object' && module.exports) {
  module.exports = factory();
} else {
  root.MineradioPaletteHelpers = factory();
}
```

Do not add DOM access, storage access, animation, timers, audio or renderer ownership to this module.

- [ ] **Step 4: 让主页面委托给 helper**

Modify `public/index.html` narrowly:

- Load `palette-helpers.js` before the main inline script.
- Bind `var paletteHelpers = window.MineradioPaletteHelpers || {};`.
- Delegate cover palette extraction,歌词配色、取色器色板和桌面歌词颜色。
- 删除的只能是已经由 helper 覆盖的同名纯函数；Three.js 颜色转换和 shader 代码保持原位。

- [ ] **Step 5: 加入检查脚本并运行回归**

Run:

```powershell
npm run check
node --test public/palette-helpers.test.js tests/smoke.test.js tests/renderer-helpers.test.js
git diff --check
```

Expected: 全部通过，封面取色和自定义歌词色行为不变。

- [ ] **Step 6: 提交**

Run:

```powershell
git add public/palette-helpers.js public/palette-helpers.test.js
git add public/index.html package.json tests/smoke.test.js
git add docs/BRANCH_CONSOLIDATION_AUDIT.md
git commit -m "refactor: extract shared palette helpers"
```

---

### Task 10: 证明 merge-two 其余能力已等价覆盖

**Files:**
- Create: `tests/branch-consolidation-contract.test.js`
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`
- Modify only if a real gap is found: focused current modules

- [ ] **Step 1: 添加统一能力合同**

Create:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const pkg = require('../package.json');

test('unified player keeps online, local and playlist sources', () => {
  assert.match(html, /source-nav-online/);
  assert.match(html, /source-nav-local/);
  assert.match(html, /source-nav-playlists/);
  assert.match(html, /\/api\/song\/url/);
  assert.match(html, /\/api\/qq\/song\/url/);
});

test('unified player keeps local library and beat helpers', () => {
  for (const file of [
    'public/local-library.js',
    'public/local-media-assets.js',
    'public/local-beat-cache.js',
    'desktop/local-assets.js',
    'desktop/shell-state.js',
    'desktop/overlay-state.js',
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
});

test('unified player has one native lyric runtime and no retired stage', () => {
  assert.equal(fs.existsSync(path.join(root, 'public/folia-native/runtime.js')), true);
  assert.doesNotMatch(html, /folia-native-stage-(?:state|renderers|ui)\.js/);
  assert.equal(fs.existsSync(path.join(root, 'build/folia-stage.js')), false);
});

test('unified package keeps verification gates', () => {
  for (const name of ['check', 'test', 'test:visual', 'verify:artifacts', 'build:win:dir']) {
    assert.equal(typeof pkg.scripts[name], 'string', name);
  }
});
```

- [ ] **Step 2: 运行领域测试**

Run:

```powershell
node --test tests/branch-consolidation-contract.test.js
node --test public/local-library.test.js public/local-media-assets.test.js public/local-beat-cache.test.js public/source-navigation.test.js
node --test desktop/local-assets.test.js desktop/shell-state.test.js desktop/overlay-state.test.js desktop/shell-integration.test.js
node --test tests/server-modules.test.js tests/security.test.js tests/electron-security.test.js
```

Expected: 全部通过。

- [ ] **Step 3: 对照 merge-two 独有提交**

Run:

```powershell
git log --reverse --oneline --parents master..archive/pre-unify-merge-two-20260728
git diff --name-status master..archive/pre-unify-merge-two-20260728
git cherry -v codex/unified-player archive/pre-unify-merge-two-20260728
```

Expected: 列出 `merge-two-projects` 从 `master` 分叉后的全部独有提交和文件，而不是只查看末端提交。

在审计文档中逐提交记录短 SHA、主题和以下结论之一：

- 当前等价实现。
- 已在 Task 7/8/9 迁移。
- 非产品审计/计划文件。
- 真实缺口。

Commit the complete per-commit classification before starting any gap:

```powershell
git add tests/branch-consolidation-contract.test.js docs/BRANCH_CONSOLIDATION_AUDIT.md
git commit -m "test: establish unified capability contract"
git status --porcelain
```

Expected: classification is committed and the worktree is clean.

- [ ] **Step 4: 对每个真实缺口执行独立红绿循环**

Before each gap:

```powershell
if (git status --porcelain) {
  throw 'Start each real-gap cycle from a clean unified worktree'
}
```

Write one focused failing test in the owning test file or
`tests/branch-consolidation-contract.test.js`.

Run the exact test and verify the intended failure:

```powershell
$owningTest = '填写本轮实际测试文件路径'
node --test $owningTest
```

Expected: FAIL for the missing behavior, not because of syntax, imports or fixture errors.

Implement the smallest change in the current authoritative module, then run:

```powershell
node --test $owningTest
npm run check
npm test
git diff --check
```

Expected: all pass.

Stage every implementation and test file from the clean worktree without staging generated output:

```powershell
git add -u
git add public desktop server tests build package.json package-lock.json
git add docs/BRANCH_CONSOLIDATION_AUDIT.md
git diff --cached --name-status
git diff --cached --name-only | Select-String -Pattern '^(test-results|\.superpowers)(/|$)'
```

Expected: the last command has no matches. Commit each gap separately:

```powershell
$capability = '填写本轮能力短名称'
git commit -m "feat: close $capability consolidation gap"
```

After each commit, `git status --porcelain` must be empty except for generated test output, which is handled in Task 11.

- [ ] **Step 5: 更新审计文档**

Expected conclusions:

- 本地库：当前等价且更新。
- 在线入口：当前 `source-navigation.js` 等价且支持网易云/QQ。
- 桌面壳层：当前等价且保留更严格安全边界。
- 节奏缓存：当前等价。
- 调色板：已由 Task 9 迁移。
- 审计工具和旧计划：不进入运行时。

- [ ] **Step 6: 提交合同与最终审计结论**

Run:

```powershell
git add tests/branch-consolidation-contract.test.js docs/BRANCH_CONSOLIDATION_AUDIT.md
git diff --cached --name-status
git commit -m "test: verify unified player capability parity"
```

---

### Task 11: 全量验证和实际体验验收

**Files:**
- Modify only for regressions: files implicated by failing tests
- Modify: `docs/BRANCH_CONSOLIDATION_AUDIT.md`

- [ ] **Step 1: 运行完整工程检查**

Run:

```powershell
npm run check
npm test
git diff --check
```

Expected: 0 failures。

- [ ] **Step 2: 运行登录状态、评论、缓存和安全合同**

Run:

```powershell
node --test tests/server-modules.test.js tests/electron-security.test.js tests/comment-barrage-state.test.js tests/folia-lyrics-routes.test.js
node --test tests/memory-cache-state.test.js tests/folia-native-three-performance.test.js tests/performance-helpers.test.js
```

Expected:

- 网易云与 QQ Cookie/登录状态归一化通过。
- 登录窗口只允许平台所属域名。
- 网易云与 QQ 评论端点选择、清洗和展示合同通过。
- 媒体缓存、列表窗口、Three.js 性能降级和帧合并边界通过。

- [ ] **Step 3: 运行八模式视觉测试**

Run:

```powershell
npm run test:visual
```

Expected:

- 8 模式在固定视口通过。
- Cappella 无闪烁、固定气泡宽度、玻璃头像。
- 流光 3D、设置页、歌单架和唱片架交互通过。
- 连续切换后只有一个活动渲染器。

- [ ] **Step 4: 在指定参考硬件门槛下验证 1080p、4K、缓存和 heap**

Run:

```powershell
$env:MINERADIO_REFERENCE_HARDWARE = '1'
try {
  node third_party/folia-major/node_modules/playwright/cli.js test `
    --config=playwright.folia.config.js `
    --grep "4K warmed renderers stay bounded through twenty switches"
} finally {
  Remove-Item Env:MINERADIO_REFERENCE_HARDWARE -ErrorAction SilentlyContinue
}
$evidencePath = 'screenshots\folia-native\classic-three-reference-performance.json'
$evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
if (-not $evidence.performanceTargetsValidated) {
  throw "Reference performance was not validated: $($evidence.targetValidation)"
}
if ($evidence.targets.'1080p-balanced'.averageFps -ne 57) { throw '1080p balanced target changed' }
if ($evidence.targets.'4k-quality'.averageFps -ne 57) { throw '4K quality target changed' }
if ($evidence.targets.'1080p-battery'.averageFps -ne 29) { throw 'Battery target changed' }
if (-not $evidence.heapMeasured) { throw 'Heap measurement evidence is required' }
if ($evidence.heapGrowth -ge 20MB) { throw 'Heap growth exceeded 20MB' }
```

Expected:

- `performanceTargetsValidated` 为 `true`。
- 1080p 平衡、4K 高质量和 1080p 省电实测达到计划目标。
- 20 次切换后一个运行渲染器、零过渡残留。
- 字形 atlas 不超过 32MB。
- 可测 heap 增长小于 20MB。
- 如果当前机器不是声明的参考硬件，本步骤必须在匹配机器补跑，不能以 functional-only 结果删除来源分支。

- [ ] **Step 5: 运行桌面构建与产物验证**

Run:

```powershell
npm run build:win:dir
npm run verify:artifacts
```

Expected: 构建成功；若 Authenticode 因机器环境不可用，只记录环境错误，不掩盖其他产物校验。

- [ ] **Step 6: 实际 Electron 验收**

Run:

```powershell
npm start
```

Verify manually:

- 网易云与 QQ 搜索、播放、歌词和歌单。
- 网易云与 QQ 登录状态能正确读取；登录窗口域名正确，退出后状态刷新。
- 分别为一首网易云和 QQ 在线歌曲打开评论，确认内容能够加载。
- 本地 MP3、FLAC 导入与播放。
- 同目录 LRC 与 TTML。
- 本地和在线节奏分析。
- 八种歌词模式切换、暂停、seek、切歌和翻译。
- 群唱固定宽度、单/双行、玻璃头像和整体上移。
- 歌单架、唱片架、设置页和底部播放条。
- 桌面歌词、托盘、窗口关闭与恢复。

- [ ] **Step 7: 完成审计文档并提交全部回归修复**

Record:

- 所有命令及结果。
- bundle SHA256。
- 各分支能力结论。
- 手工验收结果。
- 已知环境限制。

Run:

```powershell
git add -u
git add public desktop server tests build docs/BRANCH_CONSOLIDATION_AUDIT.md package.json package-lock.json
git diff --cached --name-status
git diff --cached --name-only | Select-String -Pattern '^(test-results|\.superpowers)(/|$)'
git commit -m "fix: complete branch consolidation validation"
```

Expected:

- 所有回归修复、对应测试和审计文档都被提交。
- 暂存区不包含 `test-results/` 或 `.superpowers/`。

- [ ] **Step 8: 将统一工作树生成的测试输出移到备份目录**

Run:

```powershell
$unified = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player')
$generated = [IO.Path]::GetFullPath((Join-Path $unified 'test-results'))
$backupRoot = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio-backups')
$destination = Join-Path $backupRoot 'unified-test-results-20260728'
if (-not $generated.StartsWith($unified + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Generated-output path escaped the unified worktree'
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $generated) {
  if (Test-Path -LiteralPath $destination) { throw 'Test-results backup destination already exists' }
  Move-Item -LiteralPath $generated -Destination $destination
}
git -C $unified status --porcelain
```

Expected: 统一工作树状态无输出。

---

### Task 12: 收口为一个开发分支和工作树

**Files:**
- Remove worktrees only after verification
- Keep tags and external bundle

- [ ] **Step 1: 创建统一分支验收标签**

Run:

```powershell
$unified = 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
if ((git -C $unified branch --show-current) -ne 'codex/unified-player') {
  throw 'Unified worktree is not on the accepted branch'
}
git -C $unified tag -a archive/unified-player-accepted-20260728 codex/unified-player -m "Accepted unified Mineradio player"
```

- [ ] **Step 2: 再次验证可恢复归档**

Run:

```powershell
$bundle = 'C:\Users\TomatoK\Documents\Playground\Mineradio-backups\Mineradio-pre-unify-2026-07-28.bundle'
git bundle verify $bundle
git bundle list-heads $bundle
Get-FileHash -Algorithm SHA256 -LiteralPath $bundle | Format-List
```

Expected: 结果与 Task 4 记录完全一致。

- [ ] **Step 3: 将主工作树明确排除的临时目录移到备份区**

Run:

```powershell
$repo = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio')
$backupRoot = [IO.Path]::GetFullPath('C:\Users\TomatoK\Documents\Playground\Mineradio-backups')
$moves = @(
  @{ Source = (Join-Path $repo '.superpowers'); Destination = (Join-Path $backupRoot 'main-superpowers-20260728') },
  @{ Source = (Join-Path $repo 'test-results'); Destination = (Join-Path $backupRoot 'main-test-results-20260728') }
)
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($move in $moves) {
  $source = [IO.Path]::GetFullPath($move.Source)
  if (-not $source.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to move path outside the main worktree: $source"
  }
  if (Test-Path -LiteralPath $source) {
    if (Test-Path -LiteralPath $move.Destination) {
      throw "Backup destination already exists: $($move.Destination)"
    }
    Move-Item -LiteralPath $source -Destination $move.Destination
  }
}
git -C $repo status --porcelain
```

Expected: 临时目录已保存在仓库外，主工作树状态无输出。

- [ ] **Step 4: 确认主工作树和三个辅助工作树全部干净**

Run:

```powershell
git -C 'C:\Users\TomatoK\Documents\Playground\Mineradio' status --porcelain
git -C 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-cappella-native-stage' status --porcelain
git -C 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-native-visual-reference' status --porcelain
git -C 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player' status --porcelain
```

Expected: 四条命令均无输出。任何非空输出都会阻止删除。

- [ ] **Step 5: 移除两个来源工作树**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo worktree remove -- 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-cappella-native-stage'
git -C $repo worktree remove -- 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\folia-native-visual-reference'
```

- [ ] **Step 6: 移除统一分支的临时整合工作树**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo worktree remove -- 'C:\Users\TomatoK\Documents\Playground\Mineradio\.worktrees\unified-player'
```

Expected: `codex/unified-player` 不再被任何辅助工作树占用。

- [ ] **Step 7: 将主工作目录切换到统一分支**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo switch codex/unified-player
git -C $repo status --short --branch
```

Expected: 主目录位于 `codex/unified-player` 且干净。

- [ ] **Step 8: 删除四条旧开发分支**

Only after all previous checks pass:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo branch -D -- codex/folia-cappella-native-stage
git -C $repo branch -D -- codex/folia-native-visual-reference
git -C $repo branch -D -- codex/merge-two-projects
git -C $repo branch -D -- codex/develop-local-library-migration
git -C $repo worktree prune
```

Recovery:

- 来源提交仍由 `archive/pre-unify-*` 标签保留。
- 外部 bundle 可在标签意外删除后恢复。

- [ ] **Step 9: 最终结构核验**

Run:

```powershell
$repo = 'C:\Users\TomatoK\Documents\Playground\Mineradio'
git -C $repo worktree list
git -C $repo branch -vv
git -C $repo tag --list 'archive/*20260728'
```

Expected:

```text
工作树：
C:\Users\TomatoK\Documents\Playground\Mineradio [codex/unified-player]

本地分支：
codex/unified-player
develop/mineradio-maintenance
master
```

归档标签保留，不计入开发分支数量。

---

## 最终停止条件

出现以下任一情况时，不得删除来源分支或工作树：

- 任一来源工作树仍有未提交文件。
- bundle 校验失败或 SHA256 与审计记录不一致。
- 当前线上、本地或桌面能力没有测试证据。
- 八种歌词模式或群唱关键行为失败。
- `codex/unified-player` 尚未完整提交。
- 主工作目录无法干净切换到统一分支。

## 最终完成定义

- `codex/unified-player` 是唯一开发分支。
- 主工作目录是唯一开发工作树。
- 两条基线 `master`、`develop/mineradio-maintenance` 保留。
- 三条来源开发线的独有用户能力均已迁移或有测试证明被新实现覆盖。
- 在线、本地、桌面、歌词、设置、歌单架、唱片架与构建均通过验收。
- 旧 Bridge、iframe 和 `folia-native-stage-*` 不在运行时。
- 四个来源归档标签与可验证 Git bundle 可恢复删除前状态。
