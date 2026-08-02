# Mineradio 多分支统一整合设计

## 目标

将以下四条开发线的有效能力收敛到唯一开发分支 `codex/unified-player`：

- `codex/develop-local-library-migration`
- `codex/folia-cappella-native-stage`
- `codex/folia-native-visual-reference`
- `codex/merge-two-projects`

`master` 与 `develop/mineradio-maintenance` 继续作为基线保留，不参与删除。最终只保留一个开发工作树，旧开发线在完成可恢复归档、功能审计和验收后删除。

## 已批准的整合方式

采用“能力级迁移”，不对三条来源分支执行完整 `git merge`，也不按提交号机械地批量 `cherry-pick`。

原因：

- 三条来源分支都修改过 `public/index.html`、`public/styles/app.css`、`package.json` 和歌词状态层。
- Cappella 与视觉参考分支均早于当前本地库、内存优化和原生歌词运行时，完整合并会让当前新增模块表现为大面积删除或冲突。
- `codex/merge-two-projects` 从 `master` 早期基线分叉，其 44 个独有提交与当前主线的本地库、桌面壳层、节奏缓存和在线入口存在功能重复。
- 当前工作树里的 `public/folia-native/` 已经形成统一运行时，旧 `folia-native-stage-*`、Folia iframe 和 Bridge 视觉通道不能重新成为第二套架构。

整合时以用户可感知的能力和自动化测试为迁移单位。每个来源分支只提供行为参考、纯逻辑模块、素材来源或测试用例；最终代码必须落入当前主线的结构。

## 最终权威结构

### 播放与音乐来源

以 `codex/develop-local-library-migration` 为唯一权威：

- 网易云与 QQ 在线搜索、登录、歌单、歌词和播放地址。
- 本地 MP3/FLAC 文件授权、扫描、媒体解析、导入、播放和状态恢复。
- 在线、本地、歌单三种来源导航。
- 本地与在线共用播放队列、歌词、封面和节奏分析入口。

禁止从 `codex/merge-two-projects` 整体覆盖 `server.js`、`desktop/main.js`、`desktop/preload.js` 或 `public/index.html`。

### 原生歌词

以当前工作树的 `public/folia-native/` 为唯一权威：

- `config.js`：统一配置与旧值迁移。
- `state.js`、`layout.js`：标准化歌词文档、播放帧和排版。
- `registry.js`、`runtime.js`：渲染器注册、生命周期、回退和释放。
- `renderers/`：Mineradio 3D、流光、心象、云阶、倾诉、莫奈、群唱和浮名。
- `three/`：共享 Three.js 字形、材质、主机、性能预算和粒子能力。

旧 `folia-native-stage-state.js`、`folia-native-stage-renderers.js` 与 `folia-native-stage-ui.js` 只作为 Cappella 行为参考，不能进入最终加载链。

### 设置与视觉配置

以当前设置页和 `public/folia-native/config.js` 为权威。视觉参考分支中的以下能力只能按缺口迁移：

- 旧视觉预设到新八模式枚举的映射。
- 同目录歌词候选与本地歌词匹配逻辑。
- Folia 风格主题参数中当前仍未覆盖的纯状态计算。

不得恢复旧 Bridge 设置、iframe 舞台入口或第二份歌词模式状态。

### 桌面与性能

以当前主线的模块化结构为权威：

- Electron IPC 鉴权、本地协议与文件授权。
- 托盘、启动设置、桌面歌词和窗口状态。
- 有界媒体缓存、渲染释放预算和性能诊断。
- 模块化 `server/routes/`、`server/music/`、安全、更新、天气和发布校验。

来源分支中的同类功能只有在测试证明当前缺失时才迁移。

## 来源分支职责

| 来源分支 | 可迁移内容 | 不可直接迁移内容 |
| --- | --- | --- |
| `codex/folia-cappella-native-stage` | 群唱状态转换、稳定发送者、左右交替、逐字渐入、消息预排版、无感切换、相关测试和素材许可信息 | 整套旧舞台 UI、旧 CSS 容器、对 `public/index.html` 的大段替换 |
| `codex/folia-native-visual-reference` | 同目录歌词、旧预设兼容、主题纯状态、视觉验收结论 | Folia Bridge、iframe 舞台、旧 `folia-inspired-*` 与新运行时重复的状态层 |
| `codex/merge-two-projects` | 当前确实不存在的纯函数、测试和调色板辅助能力 | 旧版在线入口、本地库、桌面壳层、单体 `server.js`、整文件替换和删除当前模块 |

## 工作树与历史保护

三个现存工作树都有需要保护的内容，其中当前主线、Cappella 和视觉参考工作树均包含未提交改动。

整合前执行以下保护：

1. 分别在三条工作线上创建只包含源码、测试、文档和合法素材的检查点提交。
2. 排除 `test-results/`、临时缓存和工作代理内部目录。
3. 在删除来源分支前，为每条来源线创建不可变归档标签。
4. 将包含来源分支和标签的 Git bundle 保存到仓库同级目录
   `C:\Users\TomatoK\Documents\Playground\Mineradio-backups`。项目规则中原有的
   `E:\桌面\播放器软件\工作区备份` 在当前机器上不存在，不能作为本次整合的依赖。
5. 只有在 bundle 可验证读取、统一分支验收通过后，才删除旧开发工作树和分支。

这样最终只剩一个开发分支，但旧实现仍可通过归档标签和 bundle 恢复。

## 整合流程

### 阶段 1：冻结与检查点

- 记录三个工作树的分支、提交、未提交文件和测试基线。
- 清理不应进入 Git 的测试输出，不删除用户源码。
- 分别创建当前主线、Cappella、视觉参考检查点提交。
- 从当前主线检查点创建 `codex/unified-player` 和独立整合工作树。

### 阶段 2：当前主线稳定化

- 将当前未提交的 Folia 原生运行时作为统一分支初始状态。
- 完成语法、单元测试和歌词视觉测试。
- 修复基线失败后才允许引入来源能力。

### 阶段 3：Cappella 缺口迁移

- 建立群唱行为矩阵，对照新 `cappella-state.js`、`renderers/cappella.js` 与旧舞台测试。
- 先补失败测试，再迁移缺失的纯状态或渲染行为。
- 保留当前毛玻璃气泡、固定宽度、单/双行限制和整体上移；禁止恢复图片头像依赖与整屏闪烁。
- 完成后不加载任何 `folia-native-stage-*` 文件。

### 阶段 4：视觉参考缺口迁移

- 对照本地歌词、预设映射和主题状态。
- 已被 `public/folia-native/config.js` 或当前歌词源逻辑覆盖的能力标记为“等价实现”，不重复迁移。
- 只迁移缺失且可由独立测试证明的能力。
- 确认 Bridge、iframe 和旧视觉状态层保持退役。

### 阶段 5：两项目整合线缺口迁移

- 按本地库、在线入口、桌面、节奏缓存、调色板五个领域建立行为对照。
- 本地库、在线入口、桌面和节奏缓存默认视为当前已有；只有失败测试证明缺口后才迁移。
- 单独审计 `palette-helpers.js`，判断其是否能减少当前重复颜色计算且不引入第二套主题系统。
- 不执行整分支 merge，不恢复来源分支对模块化服务器和测试的删除。

### 阶段 6：全链路验收

- 在线：网易云、QQ 搜索和播放，登录状态，歌单、歌词、评论。
- 本地：MP3/FLAC 导入、播放、同目录歌词、封面、节奏缓存和状态恢复。
- 歌词：八模式切换、seek、暂停、切歌、翻译、减少动效、回退和资源释放。
- UI：设置页、歌单架、唱片架、底部播放条、桌面歌词和窗口行为。
- 性能：连续模式切换、1080p/4K 帧率、缓存上限和静置 heap。
- 工程：语法、单测、视觉测试、构建、产物校验和空白检查。

### 阶段 7：收口

- 创建统一分支验收标签。
- 验证备份 bundle 和来源归档标签。
- 删除两个 Folia 工作树。
- 确认独立整合工作树干净且 `codex/unified-player` 已完整提交，然后移除该整合工作树。
- 在主工作目录中从 `codex/develop-local-library-migration` 切换到 `codex/unified-player`。
- 删除 `codex/folia-cappella-native-stage`、`codex/folia-native-visual-reference`、`codex/merge-two-projects` 与旧 `codex/develop-local-library-migration`。
- 保留 `master` 与 `develop/mineradio-maintenance` 两条基线。
- 最后核对 `git worktree list` 与 `git branch -vv`：只能有一个开发工作树，且开发分支只剩 `codex/unified-player`。

## 冲突处理规则

- 冲突默认选择统一分支版本，再按测试迁移来源行为。
- 禁止使用整文件 `ours` 或 `theirs` 覆盖核心文件。
- `public/index.html` 的接线尽量缩小；纯逻辑优先落入独立模块。
- 来源分支缺少当前文件不代表应删除该文件。
- 任何迁移不得削弱 IPC 鉴权、本地路径边界、代理目标校验或发布验证。
- 任何歌词渲染器不得创建独立常驻 RAF、AudioContext 或重复 Three.js 主机。

## 提交策略

统一分支按能力形成小提交：

1. 当前主线检查点。
2. 统一分支基线稳定化。
3. Cappella 缺口。
4. 本地歌词与预设兼容缺口。
5. 主题或调色板缺口。
6. 全链路回归修复。
7. 分支与工作树收口记录。

每个迁移提交记录来源分支和来源提交号，但不要求保留危险的整分支合并父节点。

## 成功标准

- 只有 `codex/unified-player` 一个开发分支和一个开发工作树。
- `master`、`develop/mineradio-maintenance` 基线保留。
- 在线与本地播放能力均可用，且共用稳定的播放与歌词链路。
- 八种歌词模式只通过 `public/folia-native/` 统一运行时加载。
- 群唱、视觉参考和两项目整合线不存在未审计的独有用户功能。
- 旧 Bridge、iframe 和 `folia-native-stage-*` 不进入运行时。
- 所有自动化、视觉、性能、桌面和打包验收通过。
- 来源分支删除前已生成并验证归档标签和 Git bundle。
