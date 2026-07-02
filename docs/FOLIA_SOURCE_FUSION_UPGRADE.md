# Mineradio 融合 Folia 源码功能升级计划

## 目标

将 Folia 的沉浸式歌词舞台、多源歌词匹配、AI 主题生成和视觉模式能力，以源码融合方式加入 Mineradio。

本方案不是重新实现 Folia，而是直接引入 Folia 源码，并通过独立子应用 + 状态桥接的方式接入 Mineradio。

## 许可证前提

- Mineradio 当前为 GPL-3.0。
- Folia 为 AGPL-3.0。
- GPLv3 与 AGPLv3 可以组合，但组合后需要遵守 AGPLv3 相关义务。
- 发布安装包时必须保留 Folia 许可证、来源说明、修改说明，并提供对应源码获取方式。

## 阶段 1：引入 Folia 源码

- 新增 `third_party/folia-major/`。
- 固定引入 Folia 指定 commit。
- 保留 Folia 原始 `LICENSE`、README、作者声明。
- 新增 `THIRD_PARTY_NOTICES.md`，记录来源、许可证和修改范围。

提交信息：

```text
chore: 引入 Folia 源码并补充 AGPL 合规声明
```

## 阶段 2：构建隔离

- 保留 Folia 自己的 React/Vite/TypeScript 构建链。
- Mineradio 不直接改写 Folia React 组件。
- Folia 构建产物输出到 Mineradio 可加载目录。
- Mineradio 通过 iframe、Electron BrowserView 或独立页面加载 Folia 舞台。

提交信息：

```text
build: 接入 Folia 独立舞台构建流程
```

## 阶段 3：播放器状态桥接

Mineradio 向 Folia 提供：

- 当前歌曲标题、歌手、专辑。
- 封面 URL。
- 播放状态。
- 当前播放时间。
- 总时长。
- 当前歌词。
- 音频能量或节拍数据。

Folia 只作为视觉层消费状态，不接管 Mineradio 播放器。

提交信息：

```text
feat: 打通 Mineradio 与 Folia 歌词舞台状态桥接
```

## 阶段 4：接入 Folia 歌词舞台

- 在 Mineradio 动态歌词页增加 Folia 模式入口。
- 支持切换 Folia 的歌词动画模式。
- 保留 Mineradio 原有歌词页，避免一次性替换。
- Folia 舞台异常时自动回退到 Mineradio 原歌词页。

提交信息：

```text
feat: 增加 Folia 沉浸式歌词舞台入口
```

## 阶段 5：融合多源歌词匹配

引入 Folia 的歌词匹配能力：

- 网易云当前歌词优先。
- 支持 AMLL TTML。
- 支持 QQ 歌词。
- 支持酷狗歌词。
- 根据歌名、歌手、专辑、时长评分。
- 请求必须有超时和降级。

新增 UI：

- 一键匹配最佳歌词。
- 手动选择歌词版本。
- 当前歌词来源展示。

提交信息：

```text
feat: 融合 Folia 多源歌词匹配能力
```

## 阶段 6：融合 AI 歌曲主题

- 引入 Folia 的 AI 主题生成链路。
- Mineradio 新增 API Key 设置。
- 输入歌曲名、歌手、歌词、封面色。
- 输出视觉主题、歌词样式、粒子氛围和评论配色。
- 无 API Key 时降级为封面取色。

提交信息：

```text
feat: 融合 Folia AI 歌曲主题生成
```

## 阶段 7：重构 Home 左侧主卡

- Home 左侧不再做复杂天气板。
- 改为歌词舞台入口和当前播放状态。
- 天气保留为小胶囊和天气电台入口。
- 主视觉回到音乐、歌词和沉浸式舞台。

提交信息：

```text
feat: 将 Home 左侧升级为歌词舞台入口
```

## 测试计划

每阶段执行：

```bash
npm run check
npm test
git diff --check
```

额外验收：

- Folia 构建产物可加载。
- Mineradio 播放状态能同步到 Folia。
- 切歌后 Folia 舞台刷新。
- seek 后歌词动画同步。
- 无歌词、纯音乐、本地歌安全降级。
- Folia 子应用崩溃不影响 Mineradio 主播放器。
- 发布包包含 Folia 许可证和源码获取说明。

## 风险

- 技术栈差异较大，不能直接把 Folia React 组件塞进 Mineradio 主页面。
- AGPL 合规要求会影响发布说明和源码提供方式。
- Folia 功能较多，第一版必须先做“舞台可用”，不要一次性融合全部能力。
- AI 主题和多源歌词匹配涉及外部接口，必须有超时、缓存和降级。

## 默认决策

- 采用源码融合，不重新实现。
- Folia 作为独立歌词舞台子应用接入。
- Mineradio 保持主播放器身份。
- Folia 负责歌词动画、主题和歌词匹配增强。
- 第一版只追求稳定接入，不追求完全替换 Mineradio 原视觉系统。
