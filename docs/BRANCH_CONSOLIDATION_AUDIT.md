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
| 同目录歌词 | 当前本地库 | 视觉参考 | 待迁移 TTML。需保留本地扫描边界并先补齐目标测试。 |
| 旧视觉预设 | `public/folia-native/config.js` | 视觉参考 | 待映射。只迁移确认缺失的配置键和值。 |
| 在线入口 | 当前 `public/source-navigation.js` | merge-two | 当前实现等价，待审计。 |
| 本地库 | 当前 `public/local-library.js` 与 `public/local-*.js` | merge-two | 当前实现等价，待审计。 |
| 桌面能力 | 当前 `desktop/` | merge-two | 当前实现等价，待审计。 |
| 节奏缓存 | 当前 `public/local-beat-cache.js` | merge-two | 当前实现等价，待审计。 |
| 调色板 | `public/index.html` | merge-two helper | 待提取；后续迁移为独立、可测试的纯函数。 |

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

## 迁移纪律

1. 每项能力必须先确认当前实现、来源证据和最小回归测试，再做单一能力迁移。
2. 归档分支和 bundle 仅作为审计、对比与恢复依据，不作为整文件覆盖来源。
3. 本提交只记录审计基线；没有执行功能代码迁移。
