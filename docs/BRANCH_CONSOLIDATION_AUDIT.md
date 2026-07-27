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
| 群唱 | `public/folia-native/` | Cappella | 待审计。先以现有群唱合同和视觉行为为准，不整文件导入。 |
| 同目录歌词 | 当前本地库 | 视觉参考 | 待迁移 TTML。需保留本地扫描边界并先补齐目标测试。 |
| 旧视觉预设 | `public/folia-native/config.js` | 视觉参考 | 待映射。只迁移确认缺失的配置键和值。 |
| 在线入口 | 当前 `public/source-navigation.js` | merge-two | 当前实现等价，待审计。 |
| 本地库 | 当前 `public/local-library.js` 与 `public/local-*.js` | merge-two | 当前实现等价，待审计。 |
| 桌面能力 | 当前 `desktop/` | merge-two | 当前实现等价，待审计。 |
| 节奏缓存 | 当前 `public/local-beat-cache.js` | merge-two | 当前实现等价，待审计。 |
| 调色板 | `public/index.html` | merge-two helper | 待提取；后续迁移为独立、可测试的纯函数。 |

## 迁移纪律

1. 每项能力必须先确认当前实现、来源证据和最小回归测试，再做单一能力迁移。
2. 归档分支和 bundle 仅作为审计、对比与恢复依据，不作为整文件覆盖来源。
3. 本提交只记录审计基线；没有执行功能代码迁移。
