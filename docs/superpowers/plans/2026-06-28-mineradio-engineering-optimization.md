# Mineradio 工程优化实施计划

> **给 agentic workers：**执行本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项推进。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：**在不破坏 Mineradio 现有视觉身份的前提下，把它从一个可运行的 Electron 原型式工程，推进为更可维护、更安全、可测试的 Windows 桌面应用。

**架构策略：**分层优化：先增加验证脚本和安全护栏，再明确发布/更新归属，最后从现有大文件中抽取纯逻辑模块。第一轮仍保留当前 `Electron + 本地 Node 服务 + 单页 renderer` 的形态；不重写视觉系统，也不切换前端框架。

**技术栈：**Electron、Node.js HTTP server、原生 HTML/CSS/JavaScript renderer、Three.js r128 vendor bundle、GSAP、NeteaseCloudMusicApi、electron-builder NSIS。

---

## 概览

Mineradio 目前主要集中在三个大文件中：

- `public/index.html`：renderer UI、播放状态、视觉引擎、歌词、3D 歌单架、存储、API 调用。
- `server.js`：本地 API 服务、音乐平台 API、天气、代理、更新、补丁、cookie。
- `desktop/main.js`：Electron 生命周期、窗口、登录流程、桌面歌词、壁纸、IPC。

优化必须渐进。第一个工程里程碑不是做新功能，而是让后续改动更安全。

## 优先处理的当前风险

- 本地 API 信任边界过松：`server.js` 默认监听 `0.0.0.0`，CORS 宽松，多个改变状态的接口接受 GET。
- 代理接口接受任意 `http(s)` URL，存在 SSRF 和本地网络探测风险。
- Electron 主窗口拦截了新窗口，但没有完全阻止导航到远程页面；远程页面仍可能看到 preload API。
- 发布归属不一致：本地 remote 是 `English-worse/Mineradio`，应用更新配置指向 `XxHuberrr/Mineradio`，包版本是 `1.1.0`，HEAD tag 是 `v1.2.0`。
- 没有 `npm test`、`npm run check` 或 CI 风格的发布验证脚本。
- 大文件会放大回归风险；应先从纯工具逻辑抽取开始，再做视觉/UI 重构。

## 文件职责规划

计划执行后的目标文件布局：

- 修改 `package.json`：增加验证、发布、审计脚本。
- 修改 `server.js`：第一阶段仍作为组合/路由入口，后续逐步迁出纯逻辑。
- 新建 `server/security.js`：本地 API Origin/token/method/URL 校验工具。
- 新建 `server/update.js`：更新元数据、下载、补丁校验、补丁应用工具。
- 新建 `server/proxy.js`：封面/音频/播客 URL 校验和代理工具。
- 新建 `server/cookies.js`：cookie 规范化和存储工具。
- 新建 `server/music/netease.js` 和 `server/music/qq.js`：平台映射和 API wrapper。
- 新建 `server/weather.js`：天气、地理编码、电台相关工具。
- 修改 `desktop/main.js`：保留生命周期入口，后续抽取窗口和 IPC。
- 新建 `desktop/navigation-guard.js`：允许的 URL 和协议检查。
- 新建 `desktop/ipc-auth.js`：sender URL 和窗口角色校验。
- 新建 `public/api-client.js`：renderer API wrapper，包含超时和错误处理。
- 新建 `public/storage.js`：debounced localStorage 工具。
- 新建 `public/actions.js`：事件委托门面，用于逐步替代 inline handler。
- 新建 `docs/DEVELOPMENT_CONTEXT.md`：当前仓库、分支、发布源、构建假设。
- 新建 `docs/VENDOR_MANIFEST.md`：vendor 库版本、来源、许可证、hash。
- 在 `tests/` 下使用 Node 内置 `node:test` 新增测试。

在安全和测试护栏建立前，不要拆完整 renderer 视觉引擎。

## 阶段 1：维护基线

**目标：**让仓库在改行为前具备稳定验证入口。

**文件：**

- 修改：`package.json`
- 新建：`docs/DEVELOPMENT_CONTEXT.md`
- 新建：`tests/`

- [ ] **步骤 1：增加基线脚本**

增加 scripts：

```json
{
  "check": "node --check server.js && node --check desktop/main.js && node --check desktop/preload.js && node --check desktop/overlay-preload.js && node --check dj-analyzer.js",
  "audit:prod": "npm audit --omit=dev",
  "test": "node --test tests/*.test.js",
  "verify:release": "npm run check && npm run test && npm run audit:prod && npm run build:win:dir"
}
```

- [ ] **步骤 2：增加开发上下文文档**

记录：

- 当前工作仓库根目录：`C:\Users\TomatoK\Documents\Playground\Mineradio`
- 当前维护分支：`develop/mineradio-maintenance`
- 旧的 `E:\桌面\...` 路径只作为历史参考，除非在当前机器上重新验证存在。
- 正式发布仓库尚未确定，发布前必须先决定。

- [ ] **步骤 3：增加 smoke test 脚手架**

创建 `tests/smoke.test.js`。在纯 helper 抽出前，只保留一个最小 Node 测试，用来确认测试 runner 可以正常运行。

- [ ] **步骤 4：验证**

运行：

```powershell
npm run check
npm test
git diff --check
```

预期：

- `npm run check` exit 0。
- `npm test` exit 0。
- `git diff --check` 不报告空白错误。

- [ ] **步骤 5：提交**

```powershell
git add package.json docs/DEVELOPMENT_CONTEXT.md tests
git commit -m "chore: add maintenance verification baseline"
```

## 阶段 2：本地 API 安全护栏

**目标：**在任何功能开发前，先阻止本地服务暴露和跨源状态修改。

**文件：**

- 修改：`server.js`
- 新建：`server/security.js`
- 测试：`tests/security.test.js`

- [ ] **步骤 1：默认只监听 loopback**

把 `HOST` 默认值从 `0.0.0.0` 改为 `127.0.0.1`。

只有显式设置类似 `MINERADIO_ALLOW_LAN=1` 的环境变量时，才允许非 loopback 监听。

- [ ] **步骤 2：增加 URL 目标校验**

创建 helper：

- `isAllowedRemoteMediaUrl(value)`
- `rejectsLocalNetworkUrl(value)`
- `assertHttpUrl(value)`

规则：

- 只允许 `http:` 和 `https:`。
- 拒绝 loopback、私有 IPv4、link-local、multicast、IPv6 loopback 和常见 metadata IP。
- 应用于 `/api/audio`、`/api/cover`、`/api/podcast/dj-beatmap`。

- [ ] **步骤 3：增加 method guard**

改变状态的路由必须拒绝非 POST，并返回 405：

- `/api/update/download`
- `/api/update/patch`
- `/api/logout`
- `/api/qq/logout`
- `/api/login/cookie`
- `/api/qq/login/cookie`
- `/api/song/like`
- `/api/playlist/create`
- `/api/playlist/add-song`
- `/api/beatmap/cache` 写入路径

- [ ] **步骤 4：限制 CORS**

停止对所有 JSON 响应返回 `Access-Control-Allow-Origin: *`。

只接受：

- 来自本地应用 fetch、没有 Origin header 的请求，或
- `http://127.0.0.1:<active-port>`，或
- 如果明确支持 localhost，则允许 `http://localhost:<active-port>`。

- [ ] **步骤 5：增加测试**

测试用例：

- `HOST` 默认是 `127.0.0.1`。
- private/local URL 被拒绝。
- 正常音乐/CDN HTTPS URL 被接受。
- 对改变状态路由发 GET 返回 405。
- 恶意 Origin 返回 403。

- [ ] **步骤 6：验证**

运行：

```powershell
npm run check
npm test
node server.js
```

手工检查：

```powershell
Invoke-WebRequest "http://127.0.0.1:3000/api/app/version"
```

预期：

- 本机请求可用。
- 除非显式启用，另一台主机不能访问。

- [ ] **步骤 7：提交**

```powershell
git add server.js server/security.js tests/security.test.js package.json
git commit -m "fix: harden local api boundaries"
```

## 阶段 3：Electron 导航和 IPC 边界

**目标：**确保 preload 和 IPC 能力只对本地应用页面可用。

**文件：**

- 修改：`desktop/main.js`
- 新建：`desktop/navigation-guard.js`
- 新建：`desktop/ipc-auth.js`
- 测试：`tests/electron-security.test.js`

- [ ] **步骤 1：增加 URL allowlist helper**

创建 helper：

- `isAllowedAppUrl(url, port)`
- `isSafeExternalUrl(url)`
- `isAllowedLoginUrl(url, provider)`

规则：

- 主窗口只能导航到 `http://127.0.0.1:<port>/...`。
- `shell.openExternal` 默认只接受 `https:`。
- 登录窗口只能加载已知平台 host。

- [ ] **步骤 2：阻止主窗口导航**

为主窗口增加 `will-navigate` / `did-start-navigation` guard。

外部 URL 应通过安全外链路径打开，或直接拒绝。

- [ ] **步骤 3：校验 IPC sender**

为敏感 handler 包装 sender 检查：

- 重启应用
- 打开更新安装包
- 导入/导出 JSON
- 打开/清除登录
- 桌面歌词和壁纸控制
- 全局快捷键

sender 必须是可信应用 URL；根据 channel 不同，必要时还要匹配正确的 overlay URL。

- [ ] **步骤 4：收紧外部打开行为**

用 `openSafeExternal(url)` 替换直接的 `shell.openExternal(url)` 调用。

拒绝：

- `file:`
- 自定义协议
- malformed URL
- 除非明确需要，否则拒绝非 HTTPS 远程协议

- [ ] **步骤 5：增加测试**

测试用例：

- `https://example.com` 是安全外链。
- `file:///C:/Windows/System32/calc.exe` 被拒绝。
- `https://music.163.com.evil.test` 作为网易登录 URL 被拒绝。
- `http://127.0.0.1:<port>/` 对主应用允许。
- `https://example.com` 对主应用导航被拒绝。

- [ ] **步骤 6：验证**

运行：

```powershell
npm run check
npm test
npm start
```

手工检查：

- 尝试 `window.open("https://example.com")`：只有被允许时才打开浏览器。
- 尝试主窗口 `location.href = "https://example.com"`：导航被阻止。

- [ ] **步骤 7：提交**

```powershell
git add desktop/main.js desktop/navigation-guard.js desktop/ipc-auth.js tests/electron-security.test.js
git commit -m "fix: restrict electron navigation and ipc senders"
```

## 阶段 4：发布和更新归属

**目标：**让版本、发布源、更新源、安装包预期全部明确。

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`README.md`
- 修改：`RELEASE.md`
- 修改：`CHANGELOG.md`
- 新建：`docs/RELEASE_OWNERSHIP.md`
- 新建：`docs/VENDOR_MANIFEST.md`

- [ ] **步骤 1：决定正式发布仓库**

二选一：

- `English-worse/Mineradio`
- `XxHuberrr/Mineradio`

决定后同步：

- git remote 文档
- `build.publish`
- `mineradio.update`
- README release 链接
- RELEASE workflow

- [ ] **步骤 2：统一版本源**

让以下内容一致：

- `package.json` version
- `package-lock.json` version
- README 当前版本
- CHANGELOG 最新标题
- Git tag 策略
- Release artifact 命名

- [ ] **步骤 3：明确更新通道**

只选择一种主更新策略：

- GitHub Releases latest API，或
- `latest.yml`，或
- signed manifest JSON。

推荐默认：signed manifest JSON 作为应用更新元数据，GitHub Releases 只负责托管资产。

- [ ] **步骤 4：记录 vendor 库**

对 `public/vendor/` 下每个文件记录：

- library name
- version
- upstream URL
- license
- local file hash

运行：

```powershell
Get-FileHash public\vendor\* -Algorithm SHA256
```

- [ ] **步骤 5：验证**

运行：

```powershell
npm pkg get version build.publish mineradio.update
git remote -v
git tag --points-at HEAD
npm run check
```

- [ ] **步骤 6：提交**

```powershell
git add package.json package-lock.json README.md RELEASE.md CHANGELOG.md docs/RELEASE_OWNERSHIP.md docs/VENDOR_MANIFEST.md
git commit -m "docs: align release ownership and update channel"
```

## 阶段 5：更新和补丁可靠性

**目标：**让更新和快速补丁失败时安全关闭，避免半更新状态。

**文件：**

- 修改：`server.js`
- 新建：`server/update.js`
- 测试：`tests/update.test.js`

- [ ] **步骤 1：抽取更新 helper**

把纯函数移动到 `server/update.js`：

- version normalize/compare
- release asset picking
- patch asset picking
- digest normalization
- update filename sanitization
- patch relative path validation

- [ ] **步骤 2：镜像下载要求 digest**

镜像下载必须有预期 digest。

直连下载缺少 digest 时可以警告；生产更新通道应拒绝未签名/无 digest 的补丁包。

- [ ] **步骤 3：补丁应用事务化**

补丁流程：

- parse and validate patch
- validate every target path
- validate every file hash
- write all temp files first
- backup existing files
- replace files
- if any replace fails, restore backups

- [ ] **步骤 4：不向 renderer 暴露本地绝对路径**

更新任务状态不应暴露本地绝对文件路径。需要打开文件时，应通过已经校验更新目录的 Electron IPC 完成。

- [ ] **步骤 5：增加测试**

测试用例：

- version comparison edge cases
- patch rejects `..`, executable extensions, absolute paths
- patch rejects hash mismatch
- patch rollback restores original files
- missing digest is rejected for patch package

- [ ] **步骤 6：验证**

运行：

```powershell
npm run check
npm test
```

可选本地 manifest 验证：

```powershell
$env:MINERADIO_UPDATE_MANIFEST = "C:\path\to\local-manifest.json"
npm start
```

- [ ] **步骤 7：提交**

```powershell
git add server.js server/update.js tests/update.test.js
git commit -m "fix: make update patching fail closed"
```

## 阶段 6：服务端模块抽取

**目标：**在不改变行为的前提下缩小 `server.js`。

**文件：**

- 修改：`server.js`
- 新建：`server/music/netease.js`
- 新建：`server/music/qq.js`
- 新建：`server/weather.js`
- 新建：`server/proxy.js`
- 新建：`server/cookies.js`
- 测试：`tests/server-modules.test.js`

- [ ] **步骤 1：抽取 cookie helper**

移动：

- cookie parsing
- cookie normalization
- QQ cookie normalization
- Netease cookie login checks

在行为被测试覆盖前，存储路径 wiring 仍留在 `server.js`。

- [ ] **步骤 2：抽取 proxy helper**

移动：

- audio content type detection
- audio proxy headers
- target URL validation
- size/timeout constants

- [ ] **步骤 3：抽取 weather helper**

移动：

- Open-Meteo URL building
- geocode handling
- weather fallback logic
- weather mood mapping

- [ ] **步骤 4：抽取音乐平台映射**

分别移动 Netease 和 QQ 的 mapping/wrapper 函数。

此阶段不要改变 API response shape。

- [ ] **步骤 5：逐步替换路由长链**

在模块稳定前，保留现有 `if (pn === ...)` 结构。

测试通过后，优先给低风险 GET endpoint 引入小型 route table：

- `/api/app/version`
- `/api/login/status`
- `/api/qq/login/status`
- `/api/weather/ip-location`

- [ ] **步骤 6：验证**

运行：

```powershell
npm run check
npm test
npm start
```

手工 smoke：

- app loads
- search works
- login status endpoints respond
- cover/audio proxy still works for normal song playback

- [ ] **步骤 7：提交**

```powershell
git add server.js server tests
git commit -m "refactor: extract server utility modules"
```

## 阶段 7：视觉重构前的 Renderer 护栏

**目标：**在保留当前视觉效果的同时降低 renderer 风险。

**文件：**

- 修改：`public/index.html`
- 新建：`public/api-client.js`
- 新建：`public/storage.js`
- 新建：`public/actions.js`

- [ ] **步骤 1：增加 API client wrapper**

创建 `public/api-client.js`，包含：

- default timeout
- `AbortController`
- `res.ok` handling
- JSON content-type fallback
- normalized error return shape

在 `window.MineradioApi` 上暴露兼容 API。

- [ ] **步骤 2：替换 renderer 内部 `apiJson` 实现**

保留 `index.html` 中现有函数名 `apiJson`，但委托给 `window.MineradioApi.request`。

此阶段不要一次性更新所有调用点。

- [ ] **步骤 3：增加 debounced storage helper**

创建 `public/storage.js`，包含：

- safe get/set JSON
- debounce writes
- flush on `pagehide` and `beforeunload`

第一批只迁移高频 slider 写入。

- [ ] **步骤 4：增加 action delegation facade**

创建 `public/actions.js`，暴露 `window.MineradioActions`。

后续新改到的 UI 优先使用 `data-action`；不要在一个提交里大规模替换所有 inline `onclick`。

- [ ] **步骤 5：验证**

运行：

```powershell
npm run check
npm start
```

手工 smoke：

- search
- playback
- queue
- visual controls
- lyric controls
- user FX archive save/apply

- [ ] **步骤 6：提交**

```powershell
git add public/index.html public/api-client.js public/storage.js public/actions.js
git commit -m "refactor: add renderer api and storage guardrails"
```

## 阶段 8：Renderer 性能优化

**目标：**在不改变视觉设计的前提下降低卡顿。

**文件：**

- 修改：`public/index.html`
- 可选修改：`public/storage.js`

- [ ] **步骤 1：把 mousemove 工作移到 rAF**

mousemove handler 只记录 pointer state。

由一个 rAF consumer 处理：

- shelf hover
- UI peek state
- panel hit testing
- particle interaction state

- [ ] **步骤 2：缓存 layout rect**

缓存稳定面板的 `getBoundingClientRect()` 结果。

在以下情况刷新缓存：

- resize
- fullscreen changes
- panel open/close
- mode class changes

- [ ] **步骤 3：缓存歌词查找**

替换重复线性扫描：

- 正常向前播放用 current index cursor
- seek 时用 binary search fallback

- [ ] **步骤 4：缓存重型纹理**

缓存：

- lyric mask/glow textures by text/font/color key
- 3D shelf card textures by card data/theme/cover state key

避免为了音频呼吸反复重画 canvas；优先使用 mesh scale/uniform。

- [ ] **步骤 5：验证**

运行：

```powershell
npm run check
npm start
```

手工性能检查：

- app idle on Home
- playing a normal song
- opening/scrolling playlist panel
- desktop lyrics enabled
- 3D shelf open

只有当用户认可结果时，才把 CPU/GPU 前后观察记录到 `docs/PROJECT_MEMORY.md`。

- [ ] **步骤 6：提交**

```powershell
git add public/index.html public/storage.js
git commit -m "perf: reduce renderer hot path work"
```

## 阶段 9：依赖和打包硬化

**目标：**降低发布期意外和供应链风险。

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`build/after-pack.js`
- 修改：`SECURITY.md`
- 修改：`RELEASE.md`

- [ ] **步骤 1：处理生产依赖 audit 风险**

调查 `NeteaseCloudMusicApi` 依赖链的处理方案：

- 对 `music-metadata` / `file-type` 做非破坏性 override
- 上游 issue/fork
- 替换受影响 API 使用
- 只有证明 API 兼容后才考虑降级

不要在未测试登录/搜索/播放的情况下运行 `npm audit fix --force`。

- [ ] **步骤 2：移除 mutable builder-cache fallback**

修改 `build/after-pack.js`，优先使用项目内 `node_modules/rcedit`。

如果仍保留 electron-builder cache fallback，必须固定预期 hash，hash 不匹配时失败。

- [ ] **步骤 3：决定 ASAR 和补丁权衡**

如果因为快速补丁需要保留 `asar: false`，必须记录威胁模型。

如果移除快速补丁，或加入 signed manifest，则重新评估 `asar: true`。

- [ ] **步骤 4：增加 release artifact 验证**

记录并脚本化：

```powershell
Get-AuthenticodeSignature dist\Mineradio-*-Setup.exe
Get-FileHash dist\Mineradio-*-Setup.exe -Algorithm SHA256
```

- [ ] **步骤 5：验证**

运行：

```powershell
npm ci
npm run verify:release
```

预期：

- directory build succeeds
- audit result is documented if not fully clean
- installer signing/hash status is explicit

- [ ] **步骤 6：提交**

```powershell
git add package.json package-lock.json build/after-pack.js SECURITY.md RELEASE.md
git commit -m "chore: harden packaging and dependency checks"
```

## 验收标准

当满足以下条件时，本优化路线可以认为达到阶段目标：

- `npm run check` 存在并通过。
- `npm test` 存在，并覆盖 security/update 纯 helper。
- `server.js` 不再默认暴露到 LAN。
- 跨源请求和 GET 触发的状态修改被阻止。
- Electron 主窗口不能带着 preload API 导航到任意远程页面。
- 更新/发布归属已文档化，且内部一致。
- 第一批 server 模块已抽出，且 API response shape 不变。
- Renderer API/storage 护栏已存在，且没有视觉回归。
- Release 验证命令已文档化并可运行。

## 明确的非目标

- 本优化路线中不把应用重写成 React/Vue/Svelte。
- 不重新设计 UI，也不改变已认可的玻璃/视觉风格。
- 在测试和 API 护栏建立前，不重写 3D 歌单架或歌词 renderer。
- 在版本源和更新源对齐前，不发布 release。
- 不把 `npm audit fix --force` 当作无人值守修复方案。

## 推荐执行顺序

1. 阶段 1
2. 阶段 2
3. 阶段 3
4. 阶段 4
5. 阶段 5
6. 阶段 6
7. 阶段 7
8. 阶段 8
9. 阶段 9

如果时间有限，先完成阶段 1 到阶段 3。这三步用最小的产品行为变化降低最高的运行风险。
