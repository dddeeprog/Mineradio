# Folia 七种歌词效果原生融合实施计划

> 执行要求：逐批采用 TDD；每批完成后运行定向测试、`npm run check`、`npm test` 与 `git diff --check`。

## 目标

将 Folia 的七种歌词视觉移植为 Mineradio 原生渲染器，最终不依赖 React、Framer Motion 或 Folia iframe。Mineradio 继续负责播放、歌词源、主题、音频分析和设置；原生歌词层只消费标准化歌词文档和播放帧。

固定模式：

- `mineradio-3d`：Mineradio 原有 3D 歌词，保留扫光、辉光和粒子效果，移除回环位移。
- `classic`：流光。
- `cadenza`：心象。
- `partita`：云阶。
- `tilt`：倾诉。
- `monet`：莫奈。
- `cappella`：群唱。
- `fume`：浮名。

## 架构约束

- `NativeLyricDocument` 只在切歌、歌词源或歌词内容变化时重建。
- `NativeLyricFrame` 每帧只传播放时钟、当前行、音频数据引用、主题、视口和性能档。
- 渲染器统一实现 `mount / setDocument / update / resize / release / destroy`。
- 所有模式由 Mineradio 现有主动画循环驱动，禁止渲染器常驻独立 RAF。
- 配置键为 `mineradio-native-lyric-visualizer-v1`，用户方案使用 archive schema 2。
- 改编自 Folia 的文件保留来源 commit `baa5e846b7404f1893e8b7812bca79e959f21d3f` 和 AGPL-3.0 声明。

## 批次

### 1. 基础运行时

- 新增配置、歌词文档、布局、注册表和生命周期模块。
- 本地打包 `@chenglou/pretext` 0.0.7 IIFE，记录许可证、SHA256 和 Vendor Manifest。
- 移植 grapheme timing、render hints、CJK 语义拆分和句子排版逻辑。

验收：配置迁移、逐字时序、短句/微短句、注册表、错误回退、释放与单实例测试通过。

### 2. 3D 适配与设置迁移

- 默认模式保持 `mineradio-3d`，通过统一注册表适配现有 Three.js 歌词。
- “预设”显示八种歌词模式；“歌词”只显示当前模式专属参数。
- 迁移 `cappella / partita / cover / auto / minimal` 和 `nativeLyricEffect` 旧值；已退役的 `claddagh-orbit` 回落到 `hybrid`。
- 用户方案升级为 schema 2，只导出素材 ID。

### 3. 群唱

- 最多 20 条消息，稳定发送者、左右交替、逐字渐入、头像、时间戳和表情消息。
- 内置头像与表情迁入本地素材目录并保留 README；自定义素材使用 IndexedDB 和可回收对象 URL。

### 4. 流光、云阶、倾诉

- 流光：稳定随机词布局、三态、逐字辉光、副歌涟漪和呼吸。
- 云阶：语义分块、错位列、引导线、预热和有界布局缓存。
- 倾诉：一至四行拆分、斜体强调、字符交错、脉冲和自适应缩放。

### 5. 莫奈

- 海报构图、封面背景、人物图、歌曲信息、上下文歌词轨与翻译。
- 按字符真实宽度扫光、辉光尾迹和关键词着色。
- 复用 Mineradio 现有频谱绘制音频柱线，不创建 AudioContext。

### 6. 心象与浮名

- 心象：预排版、Canvas 主文字、DOM 辉光层、光束、涟漪和拖尾。
- 浮名：整首文章、多栏、主句块、逐字印刷、镜头跟随和结尾总览。
- 浮名静态块使用有数量及内存上限的 Canvas 快照缓存。

### 7. 性能、回退与退役

- 切换时旧模式转为 340ms 静态过渡层，运行实例立即销毁。
- 加载、挂载或更新异常自动回退 3D，提示一次且不中断播放。
- 后台释放 DOM、对象 URL、Canvas 和模式缓存。
- 性能快照增加模式、渲染类型、DOM/Canvas、缓存、帧耗时、布局耗时和回退次数。
- 七模式通过截图、性能和资源释放验收后，移除 iframe 舞台及 Bridge 视觉通道；保留多源歌词和 AI 主题路由。

## 最终验收

- 固定歌词夹具覆盖中文、英文、混排、emoji、长句、翻译、无歌词、本地和在线歌曲。
- `960x540`、`1366x768`、`1920x1080` 完成八模式截图；4K 完成性能验收。
- 1080p 平衡档目标 60FPS，4K 高质量档目标 60FPS，省电档 30FPS。
- 连续切换 20 次后只有一个运行渲染器；静置后 heap 增长不超过 20MB。
- 最终执行 `npm run check`、`npm test`、`npm run verify:artifacts`、`npm run build:win:dir` 和 `git diff --check`。

## 边界

- 以 `codex/develop-local-library-migration` 为底座并保留当前设置页未提交改动。
- 不迁移 Folia 的播放器、音乐库、平台导航、账户和设置框架。
- 旧计划 `2026-07-08-folia-native-3d-lyrics-fusion.md` 仅保留为历史记录。
