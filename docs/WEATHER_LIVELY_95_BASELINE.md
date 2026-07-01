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
