# Mineradio 分支统一审计

## 审计范围

本记录锁定分支统一前的来源检查点和能力归属。统一分支从当前主线检查点建立，并额外包含 Vendor 许可证 EOL 稳定性修复 `6d7dddccb05768fb42ee571afbd3dbe5aef4e435`；该修复只保证跨工作树的 SHA256 一致，不迁移任何产品能力。

本审计是能力级迁移审计，后续只能按已验证的能力、函数和测试逐项迁移，**禁止整文件合并**。

## 检查点

| 来源 | 分支提交 | 归档标签 | 实际测试结果 |
| --- | --- | --- | --- |
| 当前主线 | `da658a73f4ac054e2802d4a7ccbf2752fe949faf` | `archive/pre-unify-main-20260728` | Task 1：`npm run check` 通过，`npm test` 525/525，`git diff --check` 通过。 |
| Cappella | `8d48fc2090e9276e701f7c12b685d60620da7052` | `archive/pre-unify-cappella-20260728` | Task 2：56/56 通过。 |
| 视觉参考 | `3e1319b5c7ded68e4746dfc363f19238fe190ed5` | `archive/pre-unify-visual-20260728` | Task 3：24/24 通过。 |
| 两项目整合 | `7ec1fb32f0d4f47c895dee6754163b02a87c893f` | `archive/pre-unify-merge-two-20260728` | clean source/reference，待能力审计。 |

## 统一分支基线

- 分支：`codex/unified-player`
- 基础检查点：`da658a73f4ac054e2802d4a7ccbf2752fe949faf`
- Vendor EOL 修复提交：`6d7dddccb05768fb42ee571afbd3dbe5aef4e435`
- 当前验证：`npm run check` 通过，`npm test` 526/526，`git diff --check` 通过。
- 许可证工作树字节已固定为 LF，`public/vendor/pretext-0.0.7.LICENSE` 的 SHA256 保持为清单中的规范值 `E9355CB16457E81ACD97DAC2E50F2F8BBF2A9A464025F9C46DB3680CF9598846`。

## Bundle

- 路径：外部归档目录中的 `Mineradio-pre-unify-2026-07-28.bundle`（归档根目录不随仓库提交）
- SHA256：`CF494BF244F41572C0BBB56B802343AE71EBDFB71149E2546F87A73A4148F211`
- `git bundle verify`：通过，bundle 记录完整历史。
- 已核对 bundle 的 8 个 ref：

| ref | 对象 |
| --- | --- |
| `refs/heads/codex/develop-local-library-migration` | `da658a73f4ac054e2802d4a7ccbf2752fe949faf` |
| `refs/heads/codex/folia-cappella-native-stage` | `8d48fc2090e9276e701f7c12b685d60620da7052` |
| `refs/heads/codex/folia-native-visual-reference` | `3e1319b5c7ded68e4746dfc363f19238fe190ed5` |
| `refs/heads/codex/merge-two-projects` | `7ec1fb32f0d4f47c895dee6754163b02a87c893f` |
| `refs/tags/archive/pre-unify-main-20260728` | `cc450fe15cd597c78bc34e3a57e52e4b5b0f0f17` |
| `refs/tags/archive/pre-unify-cappella-20260728` | `9d3652447fa31f1bc65af59e6ea33ab5f05c5505` |
| `refs/tags/archive/pre-unify-visual-20260728` | `7ff8cded2581a216b53aa9e47f82d5b5dc120a67` |
| `refs/tags/archive/pre-unify-merge-two-20260728` | `b7d523776a7c9c23b79f6040fb16ffb95ec6c0d4` |

归档标签是注释标签；检查点表中的提交值为对应标签解引用后的 commit。

## 能力结论

| 能力 | 当前权威实现或目标位置 | 来源能力 | 结论 |
| --- | --- | --- | --- |
| 群唱 | `public/folia-native/` | Cappella | Task 6 已审计：旧舞台 22 条测试中 7 条当前已覆盖、15 条已被原生 Mineradio 设计取代、0 条真实缺口。以当前群唱合同和视觉行为为准，不整文件导入、不恢复图片头像；详见 Task 6 记录。 |
| 同目录歌词 | 当前本地库与 `public/index.html` | 视觉参考 | Task 7 已迁移：仅通过现有授权根与受限文件读取加载同目录、同 stem 的 TTML/LRC 候选；候选按 TTML、增强 LRC、普通 LRC 固定排序。页面按顺序解析，空内容、读取失败或无有效行的 TTML 自动继续回退 LRC，最终才使用既有 FLAC 内嵌歌词流程；未恢复旧 `mineradioLocalLyrics` bridge。 |
| 旧视觉预设 | `public/folia-native/config.js` | 视觉参考 | Task 8 已迁移：归档 `archive/pre-unify-visual-20260728:public/lyric-visual-presets.js` 的 `classic`、`partita`、`monet` 预设映射到现有原生模式；显式 `visualMode` 保持优先，显式 `false`、无效或缺失 preset 安全回退 `mineradio-3d`。定点验证：`node --test tests/folia-native-config.test.js tests/folia-native-page-integration.test.js tests/fx-panel-settings-structure.test.js`（31/31 通过）。 |
| 在线入口 | 当前 `public/source-navigation.js` | merge-two | 当前实现等价，待审计。 |
| 本地库 | 当前 `public/local-library.js` 与 `public/local-*.js` | merge-two | 当前实现等价，待审计。 |
| 桌面能力 | 当前 `desktop/` | merge-two | 当前实现等价，待审计。 |
| 节奏缓存 | 当前 `public/local-beat-cache.js` | merge-two | 当前实现等价，待审计。 |
| 调色板 | `public/palette-helpers.js` 与 `public/index.html` | merge-two helper | Task 9 已迁移：归档纯函数模块以 UMD 形式提供颜色规范化、歌词调色板、封面取色、取色器色板和桌面歌词覆盖层颜色；页面仅保留状态与 Three.js 写入。 |

## Task 6 - 群唱能力审计（2026-07-28）

### 证据与合同

- 源行为/源码证据：`archive/pre-unify-cappella-20260728:tests/folia-native-stage-state.test.js`（14 条）、`archive/pre-unify-cappella-20260728:tests/folia-native-stage-renderers.test.js`（8 条）、`archive/pre-unify-cappella-20260728:public/folia-native-stage-state.js` 和 `archive/pre-unify-cappella-20260728:public/folia-native-stage-renderers.js`；当前对应文件为 `public/folia-native/cappella-state.js` 与 `public/folia-native/renderers/cappella.js`。
- 可复现检查：用 `git show archive/pre-unify-cappella-20260728:<path>` 查看归档证据；以下命令直接比较归档 blob 与当前 `HEAD` blob：`git diff archive/pre-unify-cappella-20260728:public/folia-native-stage-state.js HEAD:public/folia-native/cappella-state.js`，以及 `git diff archive/pre-unify-cappella-20260728:public/folia-native-stage-renderers.js HEAD:public/folia-native/renderers/cappella.js`。差异确认当前实现是独立的原生文档/DOM 渲染架构，而不是旧舞台文件的恢复。
- `node --test tests/folia-native-cappella.test.js tests/folia-native-page-integration.test.js`：`22/22` 通过。
- `node third_party/folia-major/node_modules/playwright/cli.js test --config=playwright.folia.config.js --grep "Cappella|群唱"`：首次因统一工作树缺少被忽略的 `third_party/folia-major/node_modules` 而报 `MODULE_NOT_FOUND`；执行 `npm run folia:install` 补齐锁定测试依赖后，以相同命令重跑，`1/1` 通过。
- 补充定点见证通过：长曲目 `t: 1200` 保持秒单位并显示 `20:00`，标点/空格逐字保留，重复构建的消息键稳定。

当前合同覆盖的目标行为为：逐字显现期间气泡尺寸不变、歌词气泡仅一或两行、头像为 `SPAN` 而非 `IMG`、左右气泡/头像保留 Mineradio 玻璃质感，以及新歌词到来时复用节点并整体上移而不整页闪烁。

### 旧测试缺口表

| 旧测试 | 分类 | 审计结论 |
| --- | --- | --- |
| state: complete frame with active/context/avatars/stickers | 已被新设计取代 | 当前使用不可变歌词文档和 DOM 节点；不再输出旧 `stageObjects`、封面头像或贴纸。 |
| state: alternate active side by lyric order | 当前已覆盖 | `folia-native-cappella.test.js` 覆盖 TTML sender 与备用行的稳定左右分配。 |
| state: agents plus history around active line | 已被新设计取代 | 保留稳定 sender；可见窗口改为高度受限的历史/当前对话，不强制注入 future 行。 |
| state: per-character lyric reveal | 当前已覆盖 | 当前合同覆盖 seek 后 grapheme 时序。 |
| state: punctuation and spacing per character | 当前已覆盖 | 原生歌词文档的 grapheme 时间线保留显示文本，补充见证已验证。 |
| state: focused context at most ten with upcoming line | 已被新设计取代 | 当前采用动态高度窗口和最多 20 条消息，以无闪烁的对话上移为目标。 |
| state: native avatar and emoji metadata | 已被新设计取代 | emoji 仍使用原生资源；头像已明确改为玻璃 `SPAN`，不再携带图片元数据。 |
| state: stable keys for same song/source/timing/text | 当前已覆盖 | 当前 model 的确定性键与节点复用已由单元/视觉合同和补充见证覆盖。 |
| state: no local file path in frame context or keys | 已被新设计取代 | 当前 Cappella 不生成可序列化的旧 stage frame，也不渲染封面头像；生产链路仅传入标准歌词文档。 |
| state: no local cover path in context or avatar | 已被新设计取代 | 玻璃头像不加载封面或本地图片。 |
| state: hash local lyric source paths | 已被新设计取代 | 旧 frame context 已取消；当前渲染不向 DOM 暴露歌词来源。 |
| state: detect prefixed local paths | 已被新设计取代 | 同上，旧输入清洗边界不再是当前 Cappella 的序列化接口。 |
| state: long-track timestamps remain seconds | 当前已覆盖 | 当前 `t` 为秒，`tMs` 才是毫秒；补充见证验证 `1200 -> 20:00`。 |
| state: only Cappella replaces the stage in phase one | 已被新设计取代 | 当前原生歌词已是八模式架构，旧 phase-one 限制不适用。 |
| renderer: stable-key message HTML/avatar/timestamp/bubble/sticker hooks | 已被新设计取代 | 当前 renderer 维护真实 DOM 节点，头像为玻璃节点且不再有旧 HTML/sticker hook。 |
| renderer: Folia motion CSS variables | 已被新设计取代 | 当前采用角色 CSS 与列表 FLIP 上移动画，不再使用旧标量样式变量。 |
| renderer: builtin avatars as background images | 已被新设计取代 | 明确禁止恢复图片头像，当前合同要求 `SPAN`。 |
| renderer: emoji reactions as images | 当前已覆盖 | 当前 interlude 仍创建原生 emoji 图片节点并使用确定性资源。 |
| renderer: escape text/avatar/cover in HTML output | 已被新设计取代 | 当前使用 `textContent` 和 DOM 属性 API，不再拼接旧 HTML 字符串。 |
| renderer: waiting words hidden until reveal | 已被新设计取代 | 当前为更细粒度的字符 `SPAN` 显隐和专用歌词 live region，而非旧 word patch 协议。 |
| renderer: patch only active words with unchanged key | 当前已覆盖 | 当前键控 `Map` 复用消息节点；Playwright 合同验证旧对话不闪烁并整体上移。 |
| renderer: false when old patch target is absent | 已被新设计取代 | 已取消 `patchCappellaFrame` API，当前 `update` 直接维护键控 DOM 生命周期。 |

结论：`7` 条当前已覆盖，`15` 条已被新设计取代，`0` 条真实缺口。未写 RED/GREEN 测试，原因是没有需要修复的生产行为；没有加载、复制或恢复 `public/folia-native-stage-*`，也没有恢复图片头像。

### 最终验证与视觉测试预算边界

- 分类结论保持为：`7` 条当前已覆盖、`15` 条已被新设计取代、`0` 条真实缺口。
- `node --test tests/folia-native-cappella.test.js tests/folia-native-page-integration.test.js`：`22/22` 通过；定向 `Cappella|群唱` Playwright：`1/1` 通过。
- 默认全量视觉测试曾以通用 `120000ms` 截断八模式截图/深度诊断用例；所有 `page.evaluate` 和等待最终均可返回，故根因是该重型用例的总预算，而非群唱或渲染器死锁。
- `tests/visual/folia-native.spec.js` 仅为 `eight native modes render at ${viewport.name}` 设置 `300000ms` 局部预算；全局 `120000ms` 及 `4K warmed renderers` 的 20 次切换性能合同保持不变。默认配置下 `390x844` 定向用例 `1/1` 通过（`2.5m`），最终 `npm run test:visual`：`16/16` 通过（`11.8m`）。

## Task 9 - 调色板纯函数提取（2026-07-28）

### 证据与结论

- 来源源码：`archive/pre-unify-merge-two-20260728:public/palette-helpers.js`。当前 `public/palette-helpers.js` 与归档 blob 的 `git hash-object` 均为 `5f59a552dda46270988746bb0997497e1e803043`。
- 当前模块为纯 UMD：CommonJS 导出与浏览器 `window.MineradioPaletteHelpers` 暴露同一组颜色函数；模块不读取 DOM、storage、timer、audio 或 renderer 状态。
- `public/index.html` 在首个内联脚本前加载模块，并在主内联脚本中声明 `var paletteHelpers = window.MineradioPaletteHelpers || {};`。现有 `normalizeHexColor`、`rgbToHexColor`、`hexToRgb`、`lyricPaletteFromHex`、`effectiveLyricPalette`、封面像素调色板、取色器色板与桌面歌词覆盖层颜色入口均优先委托给该模块；本地歌词状态、网格和 Three.js/shader 写入继续留在页面。
- `package.json` 仅在 `npm run check` 中新增 `node --check public/palette-helpers.js`。
- RED 证据（恢复前已有）：`node --test public/palette-helpers.test.js` 因 `./palette-helpers` 缺失报 `MODULE_NOT_FOUND`。
- 实际 GREEN/回归证据：`node --test public/palette-helpers.test.js` 为 `9/9`；`npm run check` 通过；`node --test public/palette-helpers.test.js tests/smoke.test.js tests/renderer-helpers.test.js` 为 `61/61`；`npm test` 为 `569/569`；`git diff --check` 通过。

结论：Task 9 已将归档调色板帮助函数按原 blob 迁入可测试模块，并以局部页面包装函数接入；没有整文件替换 `public/index.html`，也没有迁移页面专属渲染所有权。

## Task 10 - merge-two 归档全量能力分类（2026-07-28）

本节覆盖 `master..archive/pre-unify-merge-two-20260728` 中的每一个提交。分类以当前统一分支的真实能力、代码位置和回归合同为准；本 Task 只建立审计与合同，不迁移产品行为。

| 归档提交 | 分类 | 审计结论 |
| --- | --- | --- |
| `d628697`、`9931afa`、`42394bc`、`0ce5b7e`、`8968c90`、`d3f4b67`、`1380efa`、`40b19e3`、`f13785d`、`3d377f5`、`f7b555c`、`d6f4c0a`、`2d072d5`、`8e269d2`、`67c009f`、`8a7c76b`、`db37605`、`f09dccf`、`da5a018`、`cc108ea`、`b58c6d9` | 审计、文档、chore 或 test-only；无需产品迁移 | 它们只建立审计、计划、分类器或批次记录；`42394bc` 的 `.worktrees` 忽略规则已在当前分支迁入。 |
| `027da04`、`d18da77`、`94ff4dc`、`bb35735`、`8f48927`、`fef347a` | 桌面 shell、IPC、控制与状态已更早迁入 | 当前 `desktop/shell-state.js`、`desktop/overlay-state.js`、main/preload 连接及现有桌面测试覆盖该能力。 |
| `5e2acf2`、`b913567` | 本地资产 API 已更早迁入并加强 | 当前 `desktop/local-assets.js` 维持受授权根目录、协议 URL 和受限读取边界。 |
| `a9a9a4c` | 本地媒体/歌词资产能力已迁入，且有刻意安全加固 | 归档允许裸名称 direct `FileList` 条目按同 stem 关联歌词；当前要求经过验证的非空同目录路径。带真实相对路径的文件夹导入仍保留该功能。这是安全加固，不是迁移缺口。 |
| `9bf71e7`、`aa5c967`、`f9ed0fb`、`38f7a8f` | merge-only | 仅合并前序已分类能力，没有独立产品行为需要迁移。 |
| `2788df9`、`c337444`、`85a542e` | 本地媒体库/状态/节奏缓存已更早迁入 | 当前 `public/local-library.js`、`public/local-media-assets.js`、`public/local-beat-cache.js` 及其测试保留能力。 |
| `bd790db`、`351019b`、`92514c4` | 已迁入或当前等价 | 在线入口、来源导航和调色板帮助能力分别由当前导航、页面路由与 `public/palette-helpers.js` 覆盖。 |
| `5ff55d8`、`ee637d0`、`7ec1fb3` | merge-only | 仅合并已分类的在线入口、来源导航和调色板能力。 |
| `39a1ade` | 唯一真实当前对等缺口 | 桌面覆盖层 renderer/control 行为尚未完整迁入：多行/对齐 payload 与 renderer、锁定控制、壁纸启用 UI。此 Task 只记录缺口，不实施。 |

Task 10 合同测试锁定以下当前能力：在线/歌单/本地来源导航和 QQ/通用在线 URL 路由；本地库、媒体资产、节奏缓存、桌面本地资产、shell 与 overlay state 模块；`public/folia-native/runtime.js` 存在且已退役的 `build/folia-stage.js` 不存在；`check`、`test`、`test:visual`、`verify:artifacts`、`build:win:dir` 脚本可用。

## 迁移纪律

1. 每项能力必须先确认当前实现、来源证据和最小回归测试，再做单一能力迁移。
2. 归档分支和 bundle 仅作为审计、对比与恢复依据，不作为整文件覆盖来源。
3. 本提交只记录审计基线；没有执行功能代码迁移。
