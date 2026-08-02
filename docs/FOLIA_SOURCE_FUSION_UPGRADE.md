# Mineradio 融合 Folia 源码功能升级计划

> **执行要求：** 本计划只描述升级路线。实现时必须按阶段推进，每个重要阶段完成验证后都要单独提交 Git，提交信息和提交正文使用中文。

## 1. 背景与目标

Mineradio 当前已经具备本地播放器、动态歌词、3D 歌单架、天气电台、评论氛围等能力，但歌词舞台、多源歌词匹配和 AI 主题能力仍偏分散。

Folia Major 的优势集中在：

- 沉浸式歌词舞台。
- 多源歌词匹配与版本选择。
- TTML/逐字歌词体验。
- 面向歌曲的主题与视觉配置。
- 更完整的歌词视觉交互链路。

本计划的目标不是重新实现 Folia，而是以“源码融合”的方式将 Folia 加入 Mineradio：

- Folia 源码作为第三方子项目纳入仓库。
- Folia 保留自己的构建链路和代码边界。
- Mineradio 负责播放、队列、音频、用户设置和主 UI。
- Folia 作为增强歌词舞台和歌词能力提供者。
- 两者通过稳定的状态桥接协议通信。

## 2. 总体架构

采用“独立子应用 + 状态桥接 + 渐进替换”的架构。

```text
Mineradio 主应用
  ├─ 播放器核心
  ├─ 歌单 / 队列 / 本地文件
  ├─ 原动态歌词系统
  ├─ Folia Bridge
  │   ├─ 当前歌曲状态
  │   ├─ 播放时间
  │   ├─ 歌词数据
  │   ├─ 音频能量 / 节拍
  │   └─ 主题状态
  └─ Folia Stage 容器
      └─ Folia Major 构建产物
```

关键原则：

- 不把 Folia React 组件直接塞进 `public/index.html`。
- 不让 Folia 接管 Mineradio 的播放控制。
- 不让 Folia 的依赖污染 Mineradio 主应用依赖。
- Folia 出错时 Mineradio 必须继续可用。
- 优先完成“可用且稳定”的舞台接入，再逐步融合增强能力。

## 3. 许可证与合规

Folia Major 使用 AGPL-3.0，Mineradio 当前使用 GPL-3.0。两者组合发布时必须按 AGPL-3.0 要求处理。

必须落实：

- 保留 Folia 原始许可证。
- 保留 Folia 来源、commit、作者信息。
- 在第三方声明文件中记录 Folia 修改范围。
- 发布安装包时提供对应源码获取方式。
- 如果修改 Folia 源码，必须记录修改说明。

建议新增或维护：

- `THIRD_PARTY_NOTICES.md`
- `NOTICE.md`
- `third_party/README.md`
- `third_party/folia-major/LICENSE`

## 4. 目录规划

```text
third_party/
  folia-major/                 # Folia 原始源码，固定 commit

build/
  folia-stage.js               # Folia 构建产物复制/整理脚本

public/
  folia-stage/                 # Folia 构建产物输出目录，不提交构建产物
  folia-bridge-state.js        # Mineradio -> Folia 状态桥接纯逻辑
  folia-stage-ui.js            # Folia 舞台入口、iframe、错误回退
  folia-lyric-match-state.js   # 多源歌词匹配评分与请求计划
  folia-theme-state.js         # AI 主题与视觉主题状态

server/
  routes/
    folia-lyrics.js            # AMLL / QQ / 酷狗歌词适配路由
    folia-theme.js             # AI 主题生成路由

tests/
  folia-stage-build.test.js
  folia-bridge-state.test.js
  folia-stage-ui.test.js
  folia-lyric-match-state.test.js
  folia-theme-state.test.js
```

## 5. 阶段计划

### 阶段 0：建立文档与合规基线

目标：先把源码融合边界、许可证义务和阶段计划写清楚，避免后续功能做完才补合规。

工作内容：

- 新增本计划文件。
- 新增第三方声明文件。
- 记录 Folia 来源仓库、commit、许可证。
- 标明 Mineradio 与 Folia 的职责边界。

验证：

```bash
git diff --check
```

提交信息：

```text
docs: 增加 Folia 源码融合升级计划
```

提交正文建议说明：

- 为什么选择源码融合。
- AGPL 合规边界。
- 后续阶段和风险控制。

### 阶段 1：引入 Folia 源码

目标：将 Folia Major 源码固定到仓库中，建立可追溯的第三方源码基线。

工作内容：

- 新增 `third_party/folia-major/`。
- 固定 Folia commit，不使用浮动分支。
- 保留原始 README、LICENSE、package 信息。
- 在 `THIRD_PARTY_NOTICES.md` 写入来源和修改状态。
- 在 `.gitattributes` 中标记第三方源码目录，减少语言统计干扰。

验证：

```bash
git diff --check
```

提交信息：

```text
chore: 引入 Folia 源码并补充 AGPL 合规声明
```

提交正文建议说明：

- Folia 来源 URL。
- 固定 commit。
- 许可证处理。
- 本阶段未改 Folia 功能代码。

### 阶段 2：构建隔离

目标：让 Folia 能在 Mineradio 仓库内独立安装、构建和输出，但不影响 Mineradio 主构建。

工作内容：

- 保留 Folia 自己的 Vite/React/TypeScript 构建链。
- 新增 `npm run folia:install`。
- 新增 `npm run folia:build`。
- 新增 `build/folia-stage.js`，将 Folia 构建产物整理到 `public/folia-stage/`。
- `public/folia-stage/` 作为生成目录，不纳入 Git。
- 主应用启动时如果 Folia 产物缺失，应提示构建，而不是崩溃。

验证：

```bash
npm run check
npm test
git diff --check
```

新增测试：

- `tests/folia-stage-build.test.js`
- 断言构建脚本存在。
- 断言 package scripts 存在。
- 断言 Folia 产物目录被忽略。

提交信息：

```text
build: 接入 Folia 独立舞台构建流程
```

提交正文建议说明：

- 新增构建命令。
- 构建产物位置。
- 缺失产物的降级策略。
- 验证命令结果。

### 阶段 3：播放器状态桥接

目标：建立 Mineradio 到 Folia 的稳定通信协议，让 Folia 只消费播放器状态，不接管播放器。

桥接字段：

- 歌曲标题。
- 歌手。
- 专辑。
- 封面。
- 播放状态。
- 当前时间。
- 总时长。
- 歌词行。
- 当前歌词索引。
- 音频能量。
- 鼓点强度。
- 当前主题。

工作内容：

- 新增 `public/folia-bridge-state.js`。
- 暴露 `window.MineradioFoliaBridge`。
- 支持注册多个目标窗口。
- 支持 iframe `postMessage`。
- 切歌、播放、暂停、seek、歌词加载、音频帧都推送状态。
- Folia iframe 不在线时不报错。

验证：

```bash
npm run check
npm test
git diff --check
```

新增测试：

- `tests/folia-bridge-state.test.js`
- 测试歌曲状态归一化。
- 测试播放进度归一化。
- 测试歌词载荷。
- 测试无目标窗口时安全降级。

提交信息：

```text
feat: 打通 Mineradio 与 Folia 歌词舞台状态桥接
```

提交正文建议说明：

- 桥接协议字段。
- 触发推送的播放器事件。
- 降级策略。
- 测试结果。

### 阶段 4：接入 Folia 沉浸式歌词舞台

目标：在 Mineradio 中提供 Folia 舞台入口，用户可以主动进入 Folia 歌词舞台。

工作内容：

- 新增 `public/folia-stage-ui.js`。
- 在底部控制栏增加 `舞` 按钮。
- 新增 Folia iframe overlay。
- iframe 加载 `public/folia-stage/index.html`。
- 缺失构建产物时提示用户运行 `npm run folia:build`。
- Folia 舞台关闭后回到 Mineradio 原界面。
- Folia 子应用异常不影响播放。

验证：

```bash
npm run check
npm test
git diff --check
```

新增测试：

- `tests/folia-stage-ui.test.js`
- 断言舞台按钮、iframe、缺失构建提示和桥接注册逻辑。

提交信息：

```text
feat: 增加 Folia 沉浸式歌词舞台入口
```

提交正文建议说明：

- 入口位置。
- iframe 加载策略。
- 缺失构建时的提示。
- 回退策略。
- 验证结果。

### 阶段 5：融合 Folia 多源歌词匹配

目标：把 Folia 的多源歌词匹配能力接入 Mineradio，提升歌词可用性和版本选择能力。

歌词源优先级：

1. 网易云当前歌词。
2. AMLL TTML。
3. QQ 音乐歌词。
4. 酷狗歌词。

匹配评分维度：

- 歌名相似度。
- 歌手相似度。
- 专辑相似度。
- 时长接近程度。
- 歌词格式质量。
- 是否逐字歌词。
- 是否来自可信源。

工作内容：

- 新增 `public/folia-lyric-match-state.js`。
- 新增 `server/routes/folia-lyrics.js`。
- 接入 AMLL、QQ、酷狗歌词搜索与获取。
- 所有外部请求必须设置超时。
- 单个歌词源失败不能阻断整体匹配。
- 新增“一键匹配最佳歌词”入口。
- 新增手动选择歌词版本弹窗。
- 显示当前歌词来源。
- AMLL TTML 需要可解析或可安全降级。

验证：

```bash
npm run check
npm test
git diff --check
```

新增测试：

- `tests/folia-lyric-match-state.test.js`
- 测试请求计划。
- 测试评分排序。
- 测试超时降级。
- 测试 QQ / AMLL / 酷狗候选归一化。
- 测试 UI 中可以手动选择歌词版本。

提交信息：

```text
feat: 融合 Folia 多源歌词匹配能力
```

提交正文建议说明：

- 支持的歌词源。
- 匹配评分规则。
- 超时和降级策略。
- UI 入口。
- 测试结果。

### 阶段 6：融合 Folia AI 歌曲主题

目标：将 Folia 的 AI 主题生成能力作为 Mineradio 的可选增强，不影响无 API Key 用户。

工作内容：

- 新增 `public/folia-theme-state.js`。
- 新增 `server/routes/folia-theme.js`。
- 新增 AI API Key 设置入口。
- 输入歌曲名、歌手、歌词、封面主色。
- 输出：
  - 歌词字体建议。
  - 歌词颜色。
  - 背景氛围。
  - 评论弹幕颜色。
  - 粒子调色。
  - Folia 舞台主题。
- 无 API Key 时降级为封面取色。
- AI 请求必须手动触发或缓存，不能每次切歌都自动请求。

验证：

```bash
npm run check
npm test
git diff --check
```

新增测试：

- `tests/folia-theme-state.test.js`
- 测试主题输入归一化。
- 测试无 API Key 降级。
- 测试缓存命中。
- 测试 AI 返回字段缺失时安全降级。

提交信息：

```text
feat: 融合 Folia AI 歌曲主题生成
```

提交正文建议说明：

- API Key 保存方式。
- 主题生成输入输出。
- 缓存和降级策略。
- 隐私和外部请求边界。
- 验证结果。

### 阶段 7：重构 Home 左侧主卡

目标：把 Home 左侧从复杂天气板调整为音乐和歌词舞台入口，让主页回到播放器核心体验。

新的 Home 左侧主卡建议：

- 当前播放歌曲大封面。
- 歌曲标题、歌手、专辑。
- 当前歌词摘要。
- Folia 舞台入口。
- 原动态歌词入口。
- 最近使用的歌词版本。
- 天气保留为轻量胶囊和天气电台入口。

工作内容：

- 移除 Home 左侧的大型天气仪表盘。
- 保留右上角天气胶囊。
- 保留天气电台按钮。
- 新增 Folia 舞台主入口。
- 展示当前歌词状态和匹配来源。
- 保持 Home 右侧音乐快捷卡不变。

验证：

```bash
npm run check
npm test
git diff --check
```

提交信息：

```text
feat: 将 Home 左侧升级为歌词舞台入口
```

提交正文建议说明：

- Home 左侧职责变化。
- 天气功能保留位置。
- Folia 舞台入口。
- 兼容旧 Home 交互。
- 验证结果。

### 阶段 8：Folia DIY 配置接入

目标：把 Folia 舞台效果配置纳入 Mineradio DIY 面板，由 Mineradio 负责保存、归一化和实时推送，Folia 内嵌舞台只消费配置并渲染，不接管播放、不重新连接音乐平台。

配置边界：

- Mineradio 新增 `mineradio-folia-fx-v1` 本地配置。
- DIY 面板暴露舞台开关、舞台模式、歌词大小、逐字高亮、光晕、粒子、鼓点响应和性能模式。
- `MineradioFoliaBridge` 在 `song`、`playback`、`lyrics`、`audio`、`theme` 之外同步推送 `foliaFx`。
- Folia bridge mode 监听 `mineradio:folia-playback-state`，将 `foliaFx` 映射到自己的 visualizer、歌词字号、背景透明度和性能参数。
- Folia iframe 默认以 `mineradioBridge=1` 打开，DIY 参数变化只通过 bridge 热更新，不重载 iframe。

验证：

```bash
npm run check
npm test
npm test --prefix third_party/folia-major -- src/mineradioBridge/__tests__/foliaFx.test.ts
npm run folia:build
node --check public/folia-fx-state.js
git diff --check
```

手动验收：

- 打开 Mineradio 并播放歌曲。
- 打开 Folia 舞台，确认 Folia 不再要求连接网易云。
- Folia 显示 Mineradio 当前歌曲、封面和歌词。
- 拖动 `Folia 舞台效果` 中的歌词大小、光晕、粒子、鼓点响应，确认舞台实时变化且 iframe 不重载。
- 切换 `性能` 到省电，确认 Folia 降低重型效果。
- 切歌后 Folia 继续保留当前 DIY 配置，并刷新歌曲、封面和歌词。
- 关闭 Folia 舞台后 Mineradio 播放继续。

提交信息：

```text
docs: 补充 Folia DIY 配置接入验收说明
```

提交正文建议说明：

- Folia DIY 配置由 Mineradio 统一保存和推送。
- Folia bridge mode 不接管播放和平台连接。
- iframe bridge mode 与热更新验证结果。
- 涉及 Folia 源码修改时第三方声明已同步。

## 6. 失败与降级策略

必须保证以下场景不影响 Mineradio 主播放器：

- Folia 依赖安装失败。
- Folia 构建产物缺失。
- Folia iframe 加载失败。
- Folia 子应用运行时报错。
- AMLL / QQ / 酷狗歌词接口超时。
- AI 主题接口失败。
- 用户没有 API Key。
- 本地歌曲没有可匹配元数据。
- 纯音乐没有歌词。

降级顺序：

1. Folia 舞台不可用时，回到 Mineradio 原动态歌词。
2. 多源歌词失败时，使用当前播放器已有歌词。
3. AI 主题失败时，使用封面取色。
4. 所有外部服务失败时，不影响播放。

## 7. 测试总清单

每个阶段提交前必须执行：

```bash
npm run check
npm test
git diff --check
```

需要额外验证：

- HTML 内联脚本解析检查。
- Folia 构建产物可加载。
- Folia iframe 与 Mineradio 状态同步。
- 切歌后 Folia 舞台同步刷新。
- seek 后歌词进度同步。
- 暂停/播放状态同步。
- 无歌词时安全显示。
- 本地歌安全降级。
- 网络失败安全降级。
- Folia 崩溃不影响主播放器。

## 8. 手动验收

验收场景：

- 启动 Mineradio，播放网易云歌曲。
- 进入 Folia 舞台，歌词进度跟随播放。
- 暂停、继续、seek，Folia 舞台同步。
- 切换下一首，Folia 舞台更新标题、封面、歌词。
- 打开多源歌词匹配，选择不同版本歌词。
- 无歌词歌曲进入 Folia 舞台不崩溃。
- 断网后 Folia 舞台和播放器仍可用。
- 未构建 Folia 时有清晰提示。
- 退出 Folia 舞台后播放器状态不丢失。

## 9. 风险

- Folia 技术栈和 Mineradio 当前架构差异大，直接融合 React 组件会显著增加维护风险。
- AGPL 合规会影响发布说明和源码提供方式。
- 多源歌词接口存在稳定性和跨域风险，需要后端代理和超时保护。
- AI 主题涉及隐私和 API Key，需要明确用户触发和缓存策略。
- Folia 功能很丰富，不能一次性替换 Mineradio 原视觉系统。

## 10. 默认决策

- Folia 源码融合，不重新实现。
- Folia 作为独立子应用接入。
- Mineradio 保持播放器主控身份。
- Folia 第一阶段只承担歌词舞台增强。
- 多源歌词、AI 主题、Home 重构按后续阶段渐进加入。
- 每个重要阶段单独提交，中文提交信息和正文。
