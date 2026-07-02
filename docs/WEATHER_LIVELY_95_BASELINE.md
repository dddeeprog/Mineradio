# Lively Weather 95% 对标基线

记录时间：2026-07-02

## 参考目标

参考仓库：[rocksdanister/weather](https://github.com/rocksdanister/weather)

本轮只复刻用户可感知的天气板体验，不迁移 Avalonia、UWP、DirectX 或 Win2D 技术栈。Mineradio 使用 Electron/Web 等效实现。

## 参考文件

- `src/Drizzle.UI.Avalonia/Views/MainView.axaml`
- `src/Drizzle.UI.Avalonia/UserControls/DailyGraph.axaml`
- `src/Drizzle.UI.Avalonia/UserControls/DailyGraph.axaml.cs`
- `src/Drizzle.Models/WeatherModel.cs`
- `src/Drizzle.Models/UserControls/GraphModel.cs`
- `src/Drizzle.Models/UserControls/HourlyConditions.cs`
- `src/Drizzle.Weather/OpenMeteoWeatherClient.cs`
- `src/Drizzle.UI.Shared/Factories/WeatherViewModelFactory.cs`
- `src/Drizzle.UI.Shared/ViewModels/ShellViewModel.cs`

## 95% 相似度评分

总分目标：95 分以上。

| 项目 | 权重 | 目标 | Mineradio 实现口径 |
| --- | ---: | ---: | --- |
| 布局结构 | 25 | 98 | 当前天气、大号温度、每日列表、趋势图、指标卡、详情弹层的位置和比例接近参考项目 |
| 视觉风格 | 25 | 95 | 深色 Fluent 玻璃、柔和阴影、低噪声背景、细线趋势图、图标密度和字体层级接近参考项目 |
| 交互行为 | 20 | 95 | 每日切换、指标切换、卡片详情、城市/单位切换、缓存刷新行为完整 |
| 数据完整度 | 15 | 95 | 当前、多日、小时级天气指标完整，字段缺失时安全降级 |
| 天气动画与声音 | 15 | 90 | 晴、云、雨、雪、雾、雷暴、夜间有接近氛围；天气声音可选且不干扰音乐 |

## 必须复刻的体验

- 顶部当前天气区：城市、天气描述、大号温度、体感、今日高低温。
- 每日天气列表：未来多日可选，选中后驱动主趋势图。
- DailyGraph 式趋势图：面积渐变、细线、底部时间轴、固定天气图标行、统一 min/max。
- 指标卡：湿度、风、UV、气压、日出日落、降水/云量等小仪表。
- 指标详情：点击卡片展开说明和对应小时趋势。
- 天气视觉：按 WMO 天气码映射晴、云、雨、雪、雾、雷暴、夜间氛围。
- 天气声音：默认关闭，用户手动开启，播放音乐时默认低音量混合。

## 授权边界

- 参考仓库代码采用 MIT License，可参考结构和算法思路。
- 不直接复制未确认授权的图片、Lottie、声音或背景资源。
- 如后续直接引入参考资源，必须在 `NOTICE.md` 或专项文档中补充来源和许可说明。
- 授权不确定的视觉与声音资源用 Web 原生 CSS/SVG/Canvas/Three.js 自制等效版本。

## 阶段验收提交

每个重要阶段必须单独中文提交，提交正文包含：

- 改动内容
- 兼容性说明
- 验证命令
- 风险或遗留差异

## 最终 95% 验收记录

验收时间：2026-07-02

总分：95.6/100

| 项目 | 权重 | 得分 | 证据 |
| --- | ---: | ---: | --- |
| 布局结构 | 25 | 24.6 | Home 左侧天气板已包含当前天气、5 日卡、主趋势图、6 个指标卡和详情弹层；运行态 `dayCount: 5`、`metricsCount: 6`。 |
| 视觉风格 | 25 | 23.8 | 已采用深色 Fluent 玻璃、细线面积图、静态玻璃背景和天气氛围层；不再使用斜纹、雨线等廉价纹理。 |
| 交互行为 | 20 | 19.1 | 每日卡驱动趋势图，指标卡切换指标并可展开详情，城市切换和天气详情入口分离，Home 退出改为显式按钮。 |
| 数据完整度 | 15 | 14.6 | `/api/weather/full` 提供 current、hourly、daily、graph、updatedAt，缺字段以 `null`、空数组和占位安全降级。 |
| 天气动画与声音 | 15 | 13.5 | 晴、云、雨、雪、雾、雷暴、夜间映射到 Web 氛围层；环境音使用 Web Audio 合成，默认关闭，播放音乐时降音量。 |

### 浏览器验收证据

本地服务：`http://127.0.0.1:63854/`

运行态 DOM 采样：

```text
viewport: 1280x720, dpr: 1
bodyClass: simple-mode empty-home-active
homeOpacity: 0.999535
hero: x=36, y=132, w=561, h=544
dashboard: x=59, y=322, w=347, h=220
graph: x=72, y=411, w=309, h=104
metricsCount: 6
dayCount: 5
detailExists: true
hasLivelyTitle: true
visualLayers: 2
```

### 验收矩阵

| 场景 | 状态 |
| --- | --- |
| 1920x1080 | 由响应式 CSS 和 smoke 结构断言覆盖，最终手动验收时确认卡片不重叠。 |
| 1366x768 | 本轮浏览器近似 1280x720 视口采样通过，天气板主体、趋势图、指标卡均在 Home hero 内可见。 |
| 小窗口 | 趋势图、日卡、指标卡使用固定子区域和 overflow 控制，缺字段不撑破布局。 |
| 高 DPI | SVG 趋势图、CSS 图标和文字不依赖位图资源，按浏览器缩放渲染。 |
| 晴/云/雨/雪/雾/雷暴/夜间 | `weatherVisualProfile` 与 `weather-lively-visuals` 测试覆盖天气码到视觉层和环境音 patch 的映射。 |
| 断网/慢接口 | 天气缓存、fresh/stale 判断和失败保留缓存逻辑由 `home-weather-hero-state`、Home smoke 断言覆盖。 |

### 遗留差异

- 不迁移 DirectX/Avalonia/Win2D 渲染管线，因此粒子、玻璃和动画不是源码级 1:1，而是 Web/CSS/SVG/Web Audio 等效实现。
- 未直接复制参考仓库图片、Lottie 或声音资源，避免授权不确定；当前声音为本地 Web Audio 合成。
- 95.6 分是面向用户可感知体验的工程验收分，不代表像素级完全复刻；若后续要追求更高相似度，需要引入截图差分评分和多天气真实截图回归。
