# Classic Visible 3D Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将流光从平面 Three.js 字牌修订为保留 Folia 错落构图、具备可见词组级纵深和 Mineradio 光尘的 3D 歌词效果。

**Architecture:** `classic-three-state.js` 继续负责确定性排版，但扩展为三轴词组姿态和可见深度；`classic-three-motion.js` 继续用播放时间解析所有姿态通道；`classic-three.js` 将完整 3D 矩阵送入现有 glyph batch，并管理一个有界共享光尘对象。现有 Three host、atlas、运行时、DOM 回退和单 RAF 所有权不变。

**Tech Stack:** 原生 JavaScript、Three.js、Node Test、Playwright。

---

### Task 1: 锁定可见空间构图

**Files:**
- Modify: `tests/folia-native-classic-three.test.js`
- Modify: `public/folia-native/classic-three-state.js`

- [x] 先修改模型测试，要求普通模式具备不小于 `0.36` 的稳定深度跨度、确定性的大小差和纵向错落，并要求 entry/active/passed 具有明确前后关系。
- [x] 运行 `node --test tests/folia-native-classic-three.test.js`，确认测试因当前 `MAX_DEPTH=0.08`、单一缩放和弱错位而失败。
- [x] 扩展确定性布局参数，恢复 Folia 风格构图，同时让安全区 fit 使用最大姿态包络。
- [x] 重跑定向测试，确认新模型通过且移动端安全区不回归。

### Task 2: 支持词组三轴姿态

**Files:**
- Modify: `tests/folia-native-classic-three-motion.test.js`
- Modify: `tests/folia-native-classic-three.test.js`
- Modify: `public/folia-native/classic-three-motion.js`
- Modify: `public/folia-native/classic-three-state.js`
- Modify: `public/folia-native/renderers/classic-three.js`

- [x] 先增加 `rotationX/rotationY` 的连续性、seek、暂停和 reduced-motion 失败测试，并验证实例矩阵出现非平面分量。
- [x] 运行定向测试，确认当前姿态通道和矩阵只支持 Z 旋转而失败。
- [x] 以 `M = T(group) * Rxyz * S(group) * T(localGlyph) * S(glyph)` 和 `XYZ` Euler 顺序实现词组共同刚体平面，验证三维距离、共同中心、正文/辉光矩阵一致及正手性。
- [x] 将整句视差上限提高到 `3.2deg/4deg`；正文效果与翻译 billboard 分层，货架冲突、省电和 reduced-motion 仍归零。
- [x] 重跑 motion、state、renderer 定向测试。

### Task 3: 加入 Mineradio 风格有界光尘

**Files:**
- Create: `public/folia-native/three/spark-field.js`
- Create: `tests/folia-native-three-spark-field.test.js`
- Modify: `tests/folia-native-classic-three.test.js`
- Modify: `tests/visual/folia-native.spec.js`
- Modify: `tests/folia-native-page-integration.test.js`
- Modify: `tests/helpers/fake-three.js`
- Modify: `public/folia-native/renderers/classic-three.js`
- Modify: `public/index.html`
- Modify: `package.json`

- [x] 先增加失败测试，要求当前词激活时存在唯一 `ClassicThreeSparkField`，实例数有上限，释放后资源归零。
- [x] 将光尘资源封装为小型独立模块，使用注入的现有 `THREE` 创建单个共享 Points 对象；由 mode scope 跟踪幂等释放，位置、透明度和颜色跟随当前词与主题，不创建独立 RAF、Canvas 或 AudioContext。
- [x] quality/balanced/battery 固定为 `48/32/0` 点，Level 1 减半，Level 2+ 与 reduced-motion 关闭光尘。
- [x] 将脚本顺序、`THREE` 注入、语法检查、resume、重复 release 和资源销毁计数纳入测试。

### Task 4: 动态视觉与完整回归

**Files:**
- Modify: `tests/visual/folia-native.spec.js`
- Modify: `docs/修改日志.md`

- [x] 增加逐帧视觉断言：至少三个词组的投影大小或位置不同、Z 跨度达标、三轴矩阵非平面、翻译正对镜头且光尘数量有界。
- [x] 运行流光定向 Playwright，并检查进入、激活、唱后三张截图。
- [x] 执行 `npm run check`、`npm test`、`npm run test:visual` 和 `git diff --check`。
- [x] 检查 390x844、960x540、1366x768、1920x1080 四个视口的文字、翻译、货架和设置无重叠。
- [x] 将本轮实际代码文件和行号追加到 `docs/修改日志.md`。

### Task 5: 最终评审边界修正

**Files:**
- Modify: `public/folia-native/classic-three-state.js`
- Modify: `public/folia-native/renderers/classic-three.js`
- Modify: `public/folia-native/renderers/adaptive-three.js`
- Modify: `tests/folia-native-classic-three.test.js`
- Modify: `tests/folia-native-adaptive-three.test.js`
- Modify: `tests/visual/folia-native.spec.js`

- [x] 先用失败测试复现 `1.8x` 整体缩放绕过安全区，再将屏幕安全区反算到缩放前的局部排版空间并纳入缓存键。
- [x] 先用状态层和渲染层测试复现 Level 2 只压缩最终 Z 坐标造成的词组形变，再在共同姿态阶段同步缩减中心深度与 X/Y 倾斜。
- [x] 先复现 WebGL 上下文回退建立失败后下一帧静默空白，再将失败保留并交给外层运行时处理。
- [x] 先复现挂载中途失败泄漏上下文监听器，再补齐幂等退订和 scope 释放。
- [x] 通过 Node 联合测试和真实 WebGL 页面测试，验证 `1.8x` 放大、非对称货架安全区与翻译分层。
