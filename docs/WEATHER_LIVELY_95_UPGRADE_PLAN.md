# Mineradio 天气板 95% 复刻 Lively Weather 升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Mineradio 天气板升级为与 `rocksdanister/weather` 的 Lively Weather 在用户可感知体验上达到至少 95% 相似。

**Architecture:** 保持 Mineradio 现有 Electron/Web 架构，不迁移 Avalonia/UWP/DirectX/Win2D。新增独立天气数据、图表、UI、视觉和声音模块，逐步替换当前 Home 天气板。

**Tech Stack:** Node.js、本地 HTTP API、Open-Meteo、Electron、HTML/CSS/SVG/Canvas、Three.js、Web Audio、Node test。

---

## 1. 验收口径

95% 相似度按最终用户可感知体验评分，不要求源码、渲染技术或底层动画实现一致。

| 项目 | 权重 | 目标 | 验收方式 |
| --- | ---: | ---: | --- |
| 布局结构 | 25 | >= 98 | 当前天气、每日列表、主趋势图、指标卡、详情弹层的位置和比例对照参考截图 |
| 视觉风格 | 25 | >= 95 | 深色 Fluent 玻璃、圆角、阴影、字体层级、曲线、图标、卡片密度对照参考截图 |
| 交互行为 | 20 | >= 95 | 每日切换、指标切换、详情弹层、城市/单位切换、缓存刷新逐项手测 |
| 数据完整度 | 15 | >= 95 | 当前、多日、小时级指标完整，缺字段安全降级 |
| 天气动画与声音 | 15 | >= 90 | 晴、云、雨、雪、雾、雷暴、夜间氛围和可选环境音完整 |

## 2. 文件边界

### 计划新增

- `docs/WEATHER_LIVELY_95_BASELINE.md`：参考项目对标基线、相似度评分和授权边界。
- `server/routes/weather-full.js`：完整天气接口路由，独立于天气电台。
- `public/weather-lively-state.js`：天气数据归一化、选择状态、指标模型、天气码映射。
- `public/weather-lively-graph.js`：Web 版 DailyGraph 渲染。
- `public/weather-lively-ui.js`：完整天气仪表盘 DOM 控制器。
- `public/weather-lively-visuals.js`：天气动画、天气环境音和性能降级。
- `public/styles/weather-lively.css`：天气仪表盘独立样式。
- `tests/weather-lively-state.test.js`：天气状态和图表模型测试。
- `tests/weather-lively-graph.test.js`：趋势图路径和坐标测试。

### 计划修改

- `server/weather.js`：扩展 Open-Meteo 字段、完整天气数据归一化 helper。
- `server.js`：注册完整天气路由。
- `public/index.html`：加载新脚本和样式，挂载天气仪表盘入口。
- `package.json`：`check` 加入新增 JS 文件。
- `tests/server-modules.test.js`：覆盖新天气接口路由和数据归一化。
- `tests/smoke.test.js`：覆盖 UI 接线、脚本加载和结构存在性。

### 不纳入本轮

- 不重做播放器、歌词、评论弹幕和歌单架。
- 不迁移 Avalonia/UWP/DirectX/Win2D。
- 不直接复制未确认授权的图片、Lottie、声音或背景资源。

## 3. 阶段 0：对标基线与授权清单

**Files:**

- Create: `docs/WEATHER_LIVELY_95_BASELINE.md`

- [ ] **Step 1: 建立参考项目对标清单**

记录参考仓库中需要对标的文件：

- `MainView.axaml`
- `DailyGraph.axaml`
- `DailyGraph.axaml.cs`
- `WeatherModel.cs`
- `GraphModel.cs`
- `HourlyConditions.cs`
- `OpenMeteoWeatherClient.cs`
- `WeatherViewModelFactory.cs`
- `ShellViewModel.cs`

- [ ] **Step 2: 写入 95% 相似度评分表**

评分项必须包含：

- 布局结构
- 视觉风格
- 交互行为
- 数据完整度
- 天气动画与声音

- [ ] **Step 3: 写入授权边界**

明确：

- MIT 代码可参考。
- 资源文件不能无审计直接复制。
- 资源不确定时使用 Web 自制等效实现。

- [ ] **Step 4: 验证文档空白**

Run:

```bash
git diff --check -- docs/WEATHER_LIVELY_95_BASELINE.md
```

Expected: no output.

- [ ] **Step 5: 中文提交**

```bash
git add docs/WEATHER_LIVELY_95_BASELINE.md
git commit -m "docs: 建立 Lively Weather 天气板 95% 对标基线" \
  -m "改动内容：新增天气板 95% 对标基线文档，记录参考仓库关键文件、相似度评分口径、必须复刻的体验和资源授权边界。" \
  -m "兼容性说明：仅新增文档，不影响运行时代码、现有天气电台或 Home 天气板。" \
  -m "验证命令：已执行 git diff --check，文档无空白错误。" \
  -m "风险说明：参考仓库包含图片、Lottie、声音等资源，后续如直接引入必须逐项确认授权。"
```

## 4. 阶段 1：完整天气数据接口

**Files:**

- Create: `server/routes/weather-full.js`
- Modify: `server/weather.js`
- Modify: `server.js`
- Modify: `tests/server-modules.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试，要求完整天气路由存在**

在 `tests/server-modules.test.js` 中添加测试：

- `createWeatherFullRoutes` 能处理 `/api/weather/full`。
- `city`、`lat`、`lon`、`timezone` 参数能透传。
- 成功时返回 `{ ok: true, weather }`。
- 失败时返回 `{ ok: false, weather: null }`。

Run:

```bash
node --test tests/server-modules.test.js
```

Expected: FAIL，提示 `createWeatherFullRoutes` 不存在。

- [ ] **Step 2: 实现 `server/routes/weather-full.js`**

路由只负责完整天气，不返回天气电台歌曲。

接口：

```text
GET /api/weather/full?city=上海
GET /api/weather/full?lat=31.2&lon=121.5&timezone=Asia/Shanghai
```

返回：

```js
{
  ok: true,
  weather: {
    provider: 'open-meteo',
    location: {},
    current: {},
    daily: [],
    hourly: [],
    graph: {},
    updatedAt: 0
  }
}
```

- [ ] **Step 3: 扩展 Open-Meteo 字段**

`server/weather.js` 的 forecast 请求包含：

- current：温度、体感、湿度、天气码、云量、风速、阵风、风向、气压、降水、昼夜。
- hourly：温度、体感、湿度、气压、风速、风向、天气码、云量、降水概率、UV、能见度。
- daily：天气码、高低温、日出日落、UV、最大降水概率、风速、风向、阵风。

- [ ] **Step 4: 实现完整天气归一化 helper**

新增或扩展 helper：

- `normalizeOpenMeteoFullWeather(body, location, date)`
- `buildWeatherGraphModels(weather)`
- `weatherVisualKeyFromCode(code, isDay)`

要求：

- 保留 `normalizeOpenMeteoWeather` 给天气电台兼容使用。
- 新完整天气结构不破坏 `/api/weather/radio`。
- 缺字段返回 `null` 或空数组，不抛异常。

- [ ] **Step 5: 注册路由并加入语法检查**

修改：

- `server.js` 注册 `weatherFullRoutes`。
- `package.json` 的 `check` 加入 `node --check server/routes/weather-full.js`。

- [ ] **Step 6: 验证**

Run:

```bash
node --test tests/server-modules.test.js
npm run check
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 7: 中文提交**

```bash
git add server/weather.js server/routes/weather-full.js server.js package.json tests/server-modules.test.js
git commit -m "feat: 增加完整天气数据接口" \
  -m "改动内容：新增 /api/weather/full 完整天气接口，扩展 Open-Meteo 当前、多日和小时级字段，并新增完整天气归一化结构。" \
  -m "兼容性说明：保留 /api/weather/radio 天气电台接口，旧 Home 天气缓存和天气电台逻辑不受影响。" \
  -m "验证命令：node --test tests/server-modules.test.js、npm run check、npm test、git diff --check 均通过。" \
  -m "风险说明：不同城市可能缺少部分 Open-Meteo 字段，已用 null、空数组和安全占位降级。"
```

## 5. 阶段 2：Lively 风格趋势图

**Files:**

- Create: `public/weather-lively-state.js`
- Create: `public/weather-lively-graph.js`
- Create: `tests/weather-lively-state.test.js`
- Create: `tests/weather-lively-graph.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试，定义图表数据契约**

测试 `buildLivelyWeatherGraph(weather, selection)`：

- 默认取当前小时开始未来 12 个小时。
- 点击未来日期时取该日代表 12 个小时。
- 同一指标跨日期使用稳定 min/max。
- 空数据、恒定值、极端值生成安全路径。
- 天气图标行固定，不随曲线 y 值漂移。

Run:

```bash
node --test tests/weather-lively-state.test.js tests/weather-lively-graph.test.js
```

Expected: FAIL，提示模块不存在。

- [ ] **Step 2: 实现 `weather-lively-state.js`**

导出：

- `normalizeWeatherSelection(state)`
- `resolveWeatherSelection(state, action)`
- `buildWeatherMetricOptions()`
- `buildWeatherMetricCards(weather, selectedDay)`
- `buildLivelyWeatherGraph(weather, selection)`
- `weatherIconKey(code, isDay, label)`
- `weatherVisualProfile(weather)`

- [ ] **Step 3: 实现 `weather-lively-graph.js`**

导出：

- `buildSmoothPath(points)`
- `buildAreaPath(points, baselineY)`
- `projectGraphPoints(rows, metric, bounds)`
- `buildGraphLayers(model)`

图表规则：

- 曲线 y 值限制在 30 到 70。
- 面积基线固定在 82。
- 图标行固定在 94。
- 主线线宽由 CSS 控制为 1 到 1.5px。
- hover/click 只显示一个轻量数值提示。

- [ ] **Step 4: 加入 `package.json` 检查**

`npm run check` 加入：

```bash
node --check public/weather-lively-state.js
node --check public/weather-lively-graph.js
```

- [ ] **Step 5: 验证**

Run:

```bash
node --test tests/weather-lively-state.test.js tests/weather-lively-graph.test.js
npm run check
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 6: 中文提交**

```bash
git add public/weather-lively-state.js public/weather-lively-graph.js tests/weather-lively-state.test.js tests/weather-lively-graph.test.js package.json
git commit -m "feat: 实现 Lively 风格天气趋势图" \
  -m "改动内容：新增 Web 版 DailyGraph 数据和渲染模块，实现面积渐变、细线曲线、固定时间轴、固定天气图标行和多指标切换。" \
  -m "交互变化：支持未来日期切换趋势图，支持温度、体感、湿度、风速、气压、UV、降水和云量等指标。" \
  -m "验证命令：node --test tests/weather-lively-state.test.js tests/weather-lively-graph.test.js、npm run check、npm test、git diff --check 均通过。" \
  -m "风险说明：图表实际观感依赖后续 UI 样式和截图验收，本阶段先锁定数据契约和渲染层。"
```

## 6. 阶段 3：完整天气仪表盘 UI

**Files:**

- Create: `public/weather-lively-ui.js`
- Create: `public/styles/weather-lively.css`
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写失败 smoke 测试**

测试要求：

- `index.html` 加载 `weather-lively-state.js`、`weather-lively-graph.js`、`weather-lively-ui.js`。
- `index.html` 加载 `styles/weather-lively.css`。
- Home 天气板存在完整仪表盘结构。
- 存在每日列表、主趋势图、指标卡、指标详情弹层。

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL，提示新脚本或新结构不存在。

- [ ] **Step 2: 实现天气仪表盘 DOM**

结构：

- 顶部：城市、天气、大号温度、体感、今日高低温。
- 中部：每日天气列表 + 主趋势图。
- 底部：2x3 指标卡。
- 弹层：指标详情图表和说明。

- [ ] **Step 3: 实现 UI 控制器**

`window.MineradioWeatherLivelyUi.init(context)` 接收：

- `apiFetch`
- `showToast`
- `getWeatherState`
- `loadFullWeather`
- `openWeatherRadio`
- `dismissHomePage`

控制器负责：

- 渲染当前天气。
- 渲染每日列表。
- 渲染趋势图。
- 渲染指标卡。
- 处理城市和单位切换。
- 处理每日卡和指标卡交互。

- [ ] **Step 4: 接入 Home**

要求：

- Home 天气板使用新 UI。
- 右上角天气胶囊打开天气详情。
- 天气电台按钮继续可用。
- 进入动态歌词按钮继续显式退出 Home。
- Home 内部点击不误退出。

- [ ] **Step 5: 验证**

Run:

```bash
node --test tests/smoke.test.js
npm run check
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 6: 中文提交**

```bash
git add public/index.html public/weather-lively-ui.js public/styles/weather-lively.css package.json tests/smoke.test.js
git commit -m "feat: 升级 Home 天气仪表盘" \
  -m "改动内容：将 Home 天气板升级为 Lively Weather 风格仪表盘，加入每日列表、主趋势图、2x3 指标卡和指标详情弹层。" \
  -m "交互变化：点击每日天气切换趋势图，点击指标卡切换指标并展开详情，城市和单位切换保留。" \
  -m "兼容性说明：天气电台入口、右上角天气胶囊、进入动态歌词按钮继续可用。" \
  -m "验证命令：node --test tests/smoke.test.js、npm run check、npm test、git diff --check 均通过。" \
  -m "风险说明：该阶段 UI 改动较大，需要在阶段 5 用浏览器截图继续精修。"
```

## 7. 阶段 4：天气动画与环境音

**Files:**

- Create: `public/weather-lively-visuals.js`
- Modify: `public/weather-lively-state.js`
- Modify: `public/weather-lively-ui.js`
- Modify: `public/styles/weather-lively.css`
- Modify: `tests/weather-lively-state.test.js`
- Modify: `tests/smoke.test.js`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试，定义天气视觉映射**

测试：

- 晴天返回 clear/day visual profile。
- 雨天返回 rain visual profile。
- 雪天返回 snow visual profile。
- 雾天返回 fog visual profile。
- 雷暴返回 storm visual profile。
- 夜间返回 night variant。
- 减少动态效果时返回 reduced profile。

Run:

```bash
node --test tests/weather-lively-state.test.js
```

Expected: FAIL，提示 visual helper 不完整。

- [ ] **Step 2: 实现天气动画层**

`weather-lively-visuals.js` 导出：

- `initWeatherVisuals(context)`
- `applyWeatherVisualProfile(profile)`
- `setWeatherVisualReducedMotion(enabled)`
- `disposeWeatherVisuals()`

动画类型：

- 晴：柔光、轻粒子。
- 云：雾化云层。
- 雨：细雨粒子。
- 雪：慢速雪点。
- 雾：低对比雾化。
- 雷暴：偶发弱闪光。
- 夜间：深色月光氛围。

- [ ] **Step 3: 实现天气环境音**

默认策略：

- 默认关闭。
- 用户手动开启。
- 播放音乐时默认降低天气音量。
- 环境音资源必须确认授权；未确认前使用占位开关和自制合成轻音，不打包第三方音频。

设置项：

- 开关
- 音量
- 跟随天气
- 播放音乐时自动降低音量

- [ ] **Step 4: 验证**

Run:

```bash
node --test tests/weather-lively-state.test.js
node --test tests/smoke.test.js
npm run check
npm test
git diff --check
```

Expected: all pass.

- [ ] **Step 5: 中文提交**

```bash
git add public/weather-lively-visuals.js public/weather-lively-state.js public/weather-lively-ui.js public/styles/weather-lively.css package.json tests/weather-lively-state.test.js tests/smoke.test.js
git commit -m "feat: 增加天气动画和环境音" \
  -m "改动内容：新增天气码到视觉氛围和环境音的映射，支持晴、云、雨、雪、雾、雷暴和夜间状态。" \
  -m "体验策略：天气环境音默认关闭，播放音乐时默认降低音量，减少动态效果和性能模式可降级动画。" \
  -m "验证命令：node --test tests/weather-lively-state.test.js、node --test tests/smoke.test.js、npm run check、npm test、git diff --check 均通过。" \
  -m "风险说明：直接引入第三方声音或动画资源前必须确认授权；授权不明确时使用自制 Web 等效效果。"
```

## 8. 阶段 5：95% 视觉抛光与验收

**Files:**

- Modify: `public/styles/weather-lively.css`
- Modify: `public/weather-lively-ui.js`
- Modify: `docs/WEATHER_LIVELY_95_BASELINE.md`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: 建立截图验收矩阵**

验收尺寸：

- 1920x1080
- 1366x768
- 小窗口
- 高 DPI

天气类型：

- 晴
- 雨
- 雪
- 雾
- 雷暴
- 夜间

- [ ] **Step 2: 浏览器截图检查**

使用浏览器或 Playwright 截图检查：

- 字体不溢出。
- 卡片不重叠。
- 趋势图时间轴清楚。
- 指标卡仪表可读。
- 玻璃首帧不闪。
- 天气动画不遮挡歌词、评论弹幕、歌单架。

- [ ] **Step 3: 更新相似度评分**

在 `docs/WEATHER_LIVELY_95_BASELINE.md` 追加最终评分：

- 布局结构得分。
- 视觉风格得分。
- 交互行为得分。
- 数据完整度得分。
- 天气动画与声音得分。
- 遗留差异。

- [ ] **Step 4: 完整验证**

Run:

```bash
npm run check
npm test
git diff --check
```

手动验收：

- 打开 Home。
- 切换城市。
- 点击每日天气。
- 切换趋势指标。
- 点击指标卡。
- 开关天气动画。
- 开关天气环境音。
- 断网重启检查缓存。

- [ ] **Step 5: 中文提交**

```bash
git add public/styles/weather-lively.css public/weather-lively-ui.js docs/WEATHER_LIVELY_95_BASELINE.md tests/smoke.test.js
git commit -m "polish: 完成天气板 95% 相似度验收" \
  -m "改动内容：完成天气板视觉抛光、响应式修正、截图验收和 95% 相似度评分记录。" \
  -m "验收结果：布局、视觉、交互、数据、天气动画与声音按评分表达到 95% 总分目标。" \
  -m "验证命令：npm run check、npm test、git diff --check 均通过，并完成多尺寸、多天气类型手动验收。" \
  -m "遗留差异：如存在 DirectX/Avalonia 无法在 Web 中 1:1 复刻的细节，在文档中记录等效实现说明。"
```

## 9. 最终验收清单

- [ ] 天气板整体体验与 Lively Weather 达到 95% 相似。
- [ ] 当前天气、未来每日、小时趋势、指标卡完整。
- [ ] 点击未来日期后趋势图真实变化。
- [ ] 点击指标卡后趋势图切换到对应指标。
- [ ] 指标详情弹层可用。
- [ ] 城市切换和单位切换可用。
- [ ] 天气缓存和断网降级可用。
- [ ] 玻璃质感首帧稳定。
- [ ] 晴、云、雨、雪、雾、雷暴、夜间氛围完整。
- [ ] 天气环境音默认关闭且不干扰音乐播放。
- [ ] 播放器、歌词、评论弹幕、歌单架和天气电台未被破坏。

## 10. 执行原则

- 先写测试，再写实现。
- 每个阶段独立验证、独立中文提交。
- 不把多个阶段混进一次提交。
- 不为达到视觉目标破坏已有播放器核心体验。
- 不直接复制授权不明确的图片、Lottie、声音或背景资源。
- 不回退用户认可的 SVG 玻璃质感。
