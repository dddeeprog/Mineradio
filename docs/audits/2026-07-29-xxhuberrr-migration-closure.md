# XxHuberrr 能力迁移闭环审计

- 审计日期：2026-08-01（Asia/Shanghai）
- 仓库：Mineradio
- 分支：`codex/complete-xxhuberrr-migration`
- 唯一功能底座：`codex/unified-player`
- 固定上游来源：`XxHuberrr/Mineradio@4abaa190de42c632365ae4244e041bad16443224`
- Task 14 起点：`18d72944069d4a9f10632c78c24703c82f34950d`（`build: finish beta release ownership and license packaging`）
- 修复后验收 HEAD：`1b0c3fdc6138a4441cc1d5681bc9e7e607bc0f25`
- 审查范围：`18d7294..1b0c3fd`，24 个提交、62 个文件、4,035 行新增、503 行删除
- 规格：`docs/superpowers/specs/2026-07-28-xxhuberrr-capability-migration-design.md`
- 执行计划：`docs/superpowers/plans/2026-07-29-complete-xxhuberrr-migration-batches-2-9.md`

## 结论

Task 1–13 的迁移功能与 Task 14 中成立的安全、隐私、登录真实性、生命周期、安装和发布发现均已闭环。最终全量静态、Node、Playwright、生产依赖审计、stable/Beta 构建、fresh 产物验证、NSIS 沙箱和桌面/resource 回归全部通过。

本审计不作两项超出证据的声明：

1. Windows 产物的 Authenticode 状态为 `NotSigned`，仅因仓库 1.1.0 明确配置并声明 `allow-unsigned` 才通过；不等同于已签名。
2. 本机 Playwright 使用 SwiftShader，性能结果按仓库门禁只能记为 `software functional-only`；不等同于参考 NVIDIA 硬件帧率或主线程负载认证。

两次额外的 unpacked EXE 编排均不是仓库正式验收入口，且未形成完整、隔离、可重复的证据，明确记为无效，不计入通过项。

## 最终实现状态

| 规格能力 | 最终状态 | 主要证据 |
| --- | --- | --- |
| 五平台搜索及部分失败 | 完成 | 全量 Node 1486/1486；真实 loopback 冒烟覆盖五平台部分失败 |
| 能力驱动登录与凭据保护 | 完成 | 网易云、酷狗、汽水真实会话验证；Spotify PKCE；IPC 白名单与凭据生命周期测试 |
| 账号维度收藏、会员、音源缓存 | 完成 | `server/platform/account-cache.js` 已接入生产调用；A/B 隔离、delete/clear 测试 |
| 网易云专辑、收藏、订阅和评论写入 | 完成 | 能力、登录态、归属及回滚测试；未订阅歌单入口可达 |
| 事务播放、音源回退和版本匹配 | 完成 | 队列/进度/音频图回滚；Live/Remix/Acoustic/伴奏限定词匹配 |
| 收听统计与幂等 | 完成 | 持久 outbox/journal 不保存稳定账号 HMAC；账号切换和重启拒绝误报 |
| Cuefield、Sonic、资源治理 | 完成 | 中央功能快照；唯一音频图、renderer 和帧循环；release/restore 测试 |
| 完整桌面与 Wallpaper | 完成 | 主进程防御性开关；锁屏、挂起、Explorer、显示器变化和幂等释放测试 |
| stable/Beta 隔离 | 完成 | appId、产品名、用户目录、安装目录、卸载身份和更新通道均隔离 |
| 安装、来源、许可证、依赖证明 | 完成 | 51/51 安装沙箱；179 个生产依赖、6 个 vendor、7 个发布材料进入证明链 |

## 审查发现闭环矩阵

以下 24 个提交按审查项分组。每个成立项均先由 focused RED 固定当前缺口，再做最小实现并进入最终全量回归。

| 编号 | 发现与判断 | 修复、驳回或延期理由 | 对应提交 | 可复核验证 |
| --- | --- | --- | --- | --- |
| C-01 | 视觉测试会把运行态写回源码目录：成立 | 将 Playwright 可写状态隔离到测试输出，避免测试污染仓库 | `bd77820` | `tests/playwright-runtime-isolation.test.js`；Stage A 61/61 |
| C-02 | electron-builder `dir` 目标返回值会被 hook 当作错误产物：成立 | 验证器接受目录目标的空产物结果，同时保持 NSIS fail-closed | `5b2a8f7` | `tests/release-artifacts.test.js`；stable/Beta dir 构建通过 |
| R-01 | Beta updater 忽略 channel：成立 | 运行时从打包身份解析 `latest`/`beta`，manifest 与 GitHub release 路径一致 | `9e4ae3` | `server/update-channel.js`、`tests/beta-build-config.test.js`；Beta identity=`beta` |
| R-02 | 新增登录、凭据、本地音乐 IPC 未授权：成立 | 补入集中式许可列表，不开放任意 IPC | `6b04822` | `tests/ipc-auth.test.js`、`tests/electron-security.test.js` |
| R-03 | 退出或换号后旧 Spotify refresh 可能回写：成立 | credential session 使用版本化条件写入，失效 refresh 被拒绝 | `59e1546` | `tests/platform-credential-session.test.js`、`tests/platform-search-providers.test.js` |
| R-04 | 损坏凭据文件会阻断窗口创建：成立 | 初始化降级为显式 memory-only 状态，保留损坏文件供恢复且 Promise 可完成 | `2b5d549` | `desktop/platform-credential-runtime.test.js`、`tests/electron-security.test.js` |
| R-05 | `reportingBinding` 会进入 outbox/journal：成立 | 持久层删除稳定账号 HMAC；会话证明与当前 credential 快照绑定，旧账号离线事件在重启/切 B 后不会按 B 上报 | `5dc8829` | `tests/listen-session-state.test.js`、`tests/listen-reporter.test.js` |
| R-06 | 网易云校验失败仍发布 `pendingProfile` 登录：成立 | 远端账号验证失败即未登录，不能持久化或发布伪登录态 | `f6d4346` | `tests/platform-login-ui.test.js`、`tests/server-modules.test.js` |
| R-07 | 酷狗只按字段形状登录：成立 | 用现有账号端点校验响应用户 ID 与凭据一致；401、错误码、缺失或不一致 ID 均 fail closed | `9a1d305` | `tests/platform-search-providers.test.js`、`tests/electron-security.test.js` |
| R-08 | 汽水只按 token/cookie 形状登录：成立 | 复用 `/luna/pc/me` 只读会话验证；无 `userId` 或错误响应不得持久化 | `440e16e` | `tests/platform-search-providers.test.js`、固定上游来源说明 |
| R-09 | 跨平台匹配会把 Live/Remix 播成原版：成立 | 独立匹配模块保留中英文括号内版本限定词，并要求规范化歌手集合一致 | `792aef3` | `tests/playback-source-match-state.test.js` |
| R-10 | 中央开关只真正约束 Cuefield：成立 | 浏览器侧统一约束 enhanced playback、Sonic、resource governor；禁用时不创建运行时或自动换源 | `8b932fc` | `tests/runtime-feature-state.test.js`、`tests/visual/playback-transaction.spec.js` |
| R-11 | desktop wallpaper 缺少主进程防御：成立 | 主进程在快照禁用时不创建 runtime、不注册系统监听；默认发布行为仍启用 | `207c420` | `desktop/runtime-feature-gate.test.js`、`tests/wallpaper-page.test.js` |
| R-12 | 打包来源证明未覆盖生产 `node_modules`：成立 | package-lock 生产闭包与 packaged app 双向对照，证明 path/name/version/integrity 和目录摘要 | `b71066b` | `tests/production-dependency-proof.test.js`、179 个 packaged production dependencies |
| R-13 | 网易云未订阅歌单隐藏“订阅”：成立 | 由写能力、登录态、归属和订阅态决定订阅/取消订阅；失败回滚 | `8df166e` | `tests/playlist-state.test.js`、`tests/platform-actions-state.test.js` |
| R-14 | `accountScopedCache` 仅有 `clearScope`：成立 | 补齐生产 get/set/delete，收藏、会员、音源三类键按 provider+account 隔离 | `b852e1b` | `tests/platform-account-cache.test.js` 的 A/B 切换、delete/clear 边界 |
| R-15 | stable/Beta 默认安装目录碰撞：成立 | stable 保留既有 `D:\Mineradio` 升级路径；Beta 使用独立 `D:\Mineradio Beta` 与独立身份 | `0f767fa` | `tests/beta-build-config.test.js`、`tests/installer-nsis-integration.test.js` |
| R-16 | 安装目录测试与实际宏不一致：成立（测试缺口） | 将断言对齐通道隔离后的实际 NSIS 宏，不扩大安装机制 | `1359808` | 安装四文件套件 51/51 |
| R-17 | manifest 硬编码 stable 卸载器：成立 | 由 packaged product filename 生成并验证卸载器名，stable 兼容保留 | `dfb5617` | stable=`Uninstall Mineradio.exe`；Beta=`Uninstall MineradioBeta.exe` |
| R-18 | loopback 写请求缺 Origin 会放行：成立 | 无 Origin 写请求拒绝；Electron 主进程显式携带当前 loopback Origin | `f081a11` | `tests/security.test.js`、`tests/listen-routes.test.js`、`tests/electron-security.test.js` |
| R-19 | 先探测端口再 listen 存在竞态：成立 | 由 HTTP server 原子监听首选端口，`EADDRINUSE` 有界重试并返回实际端口 | `002a7ab` | `tests/server-listener.test.js` 3/3；B2 desktop/resource 套件通过 |
| R-20 | 发布脚本遗漏关键 Playwright：成立 | stable/Beta 正式 release 接入同一 15 项关键浏览器验收，完整视觉矩阵仍可独立执行 | `30a9106` | `tests/beta-build-config.test.js`、`tests/smoke.test.js` |
| R-21 | Vendor Manifest/music-tempo 未机器校验：成立 | 对声明条目、许可证、来源/版本、SHA256 和 packaged 文件建立证明链 | `467897b` | `tests/release-artifacts.test.js`；6 vendor、7 release materials |
| R-22 | Cuefield 与中央开关契约需补强：成立（测试缺口） | 固定 controls/runtime 都跟随 release feature snapshot | `1b0c3fd` | `tests/cuefield-page-integration.test.js` 7 项契约；Stage A 全量通过 |

## 结构审查：非阻断、延期重构

审查提出 `public/index.html` 仍很大，四个 `cuefield/*.js` wrapper 仍共同指向 1,204 行 `public/cuefield-runtime.js`。该事实成立，但没有形成发布阻断缺陷。

- 迁移前基线 `e1f80f7^` 的 `public/index.html` 为 29,876 行、1,382,746 UTF-8 bytes；Task 14 起点 `18d7294` 为 33,222 行；修复后 `1b0c3fd` 为 33,272 行。大文件首先是既有结构，整个迁移净增 3,396 行；Task 14 审查修复只净增 50 行。
- 规格“模块边界”明确允许 `public/index.html` 保留“现有尚未拆分逻辑”，硬性要求是本次触及的新功能优先进入独立文件。搜索、登录、播放事务、版本匹配、runtime feature state、playlist state、Cuefield、Sonic、resource governor、desktop runtime 均已有独立可测试模块。
- Task 13 的明确承诺是迁出“新触及的 search/login/playback assembly”，不是按行数拆完整页面，也没有要求把 1,204 行 Cuefield runtime 在收尾阶段重写。
- `tests/cuefield-page-integration.test.js` 固定单一 runtime、共享 Task 7 preload/transaction、无 `AudioContext`/decoder/Worker/`requestAnimationFrame`/`setInterval`、完整取消和中央开关；timeline executor 测试覆盖迟到资源只释放一次与幂等 `destroy`。
- Stage A 1486/1486 与 61/61、B2 132/132 与 5/5 均未复现重复 RAF、重复实例、释放失败、功能开关失效或不可独立测试。

因此该项记为“非阻断、延期重构”。后续可在独立分支按 core/adapter/planner/executor 分离浏览器 bundle 与 Node entry，并逐批减少 inline assembly；不得在发布收尾时以文件行数为目标重写运行时。

## 阶段 A：全量源码与浏览器验收

环境：Windows NT 10.0.26200.0、Node 24.11.1、npm 11.6.2、Electron 42.4.1、Playwright 1.59.1、Chromium revision 1217。

| 门禁 | 结果 | 精确耗时 |
| --- | --- | --- |
| `npm run check` | PASS | 12.100 s |
| 完整 `npm test` | 1486/1486，失败 0 | Node 28.177 s；墙钟 28.924 s |
| 完整 `npm run test:visual` | 61/61，失败 0，单 worker | Playwright 4.6 min；墙钟 281.366 s |
| `npm run audit:prod` | 0 vulnerabilities | 3.342 s |
| `git diff --check` / `git status --short` | 0 / 0 行 | PASS |

真实 loopback 服务冒烟另行覆盖 capability snapshot、五平台搜索部分失败、未授权写入、PKCE state 拒绝、网易云专辑详情、listen 幂等和 secret-free 响应/日志；结果 PASS。该手工服务冒烟没有 TAP 聚合计数，故不与 1486 个 Node 测试重复计数。

## 阶段 B1：fresh 构建与产物证明

旧 `dist`、`dist-beta` 和 `build/.generated` 被移动到独立临时备份后再构建，本表只记录本轮新产物。

| 构建 | 命令 | 结果与墙钟 |
| --- | --- | --- |
| stable dir | `npm run build:win:dir` | PASS，20.472 s；初始 2,513 files / 411,352,278 bytes |
| Beta dir | `npm run build:win:beta:dir` | PASS，18.351 s；初始 2,513 files / 411,352,316 bytes |
| stable NSIS | `npm run build:win` | PASS，178.953 s |
| Beta NSIS | `npm run build:win:beta` | PASS，168.291 s |

NSIS 重新打包后的 stable 目录为 2,515 files / 411,459,916 bytes，Beta 为 2,515 files / 411,459,973 bytes。

| 产物 | bytes | SHA256 |
| --- | ---: | --- |
| `dist/win-unpacked/Mineradio.exe` | 232,300,032 | `665AEF56DC30C32291DEA4BDC7BEB1240419B38F15E05F891F239DB45554CAA3` |
| `dist-beta/win-unpacked/MineradioBeta.exe` | 232,300,032 | `B95D5E6D91537BFE00AF9B0CDF86E6E9350FC9B1FB7EF668FBD154D41AD455AD` |
| `dist/Mineradio-1.1.0-Setup.exe` | 106,396,010 | `F19E78BE456782FF276196EAEF121CF497B33116BAB6FB621A22C290861C9DC9` |
| `dist-beta/Mineradio-Beta-1.1.0-Setup.exe` | 106,422,501 | `FA20FC46730D2BBA32A93251D1947C114667F9BF396C2B9C1F60E47F7A4F7838` |
| stable attestation | 65,336 | `6C8828B5C6671B168EA8CD7F9C66B909999F67A750433095780B7459F321DC4B` |
| Beta attestation | 65,347 | `18C492243155BEA264FE7CAEE13438A4EDCBF812F9DB849CD53B25E4CB484B85` |

身份核对：stable=`Mineradio` / `com.mineradio.desktop` / `stable` / update `latest`；Beta=`Mineradio Beta` / `com.mineradio.desktop.beta` / `beta` / update `beta`。证明链包含 179 个生产依赖、6 个 vendor 材料、7 个发布材料；music-tempo bundle 与 license 的记录摘要分别为 `292785…CBD76`、`12B4E…48CF`，Pretext license 为 `E9355…98846`。

- `npm run verify:artifacts -- --fresh`：PASS，3.131 s。
- `npm run verify:artifacts -- --beta --fresh`：PASS，2.978 s。
- 签名负向测试：4/4，墙钟 2.121 s；Unavailable、损坏 metadata、错误 artifact path 均 fail closed。
- 两个 installer 的 Authenticode 均为 `NotSigned`。通过只来自 `package.json` 中当前 1.1.0 的 `allow-unsigned` 机器策略及对应人工发布声明；若策略改为要求签名，当前产物必须失败。

## 阶段 B2：安装沙箱与桌面 soak

### 安装沙箱

正式入口为四文件 Node/NSIS 沙箱：`tests/installer-safety.test.js`、`tests/installer-nsis-runtime.test.js`、`tests/installer-nsis-integration.test.js`、`tests/installer-manifest.test.js`。

- 51/51 PASS，失败 0、跳过 0。
- Node duration 7,685.954 ms；墙钟 7.765 s。
- 3 个 Windows NSIS runtime 测试实际执行，未跳过。
- 覆盖 fresh install、正常/中断升级预留、损坏 manifest 拒绝、stable/Beta cross-marker、正确卸载器、known-file cleanup、junction/reparse 拒绝、sentinel 保留、未知内容时保留包含目录及临时 HKCU 测试键清理。
- 没有运行真实 stable/Beta installer，没有污染现有系统安装。

### 桌面与资源回归

- `npm run diagnostics:desktop`：PASS，0.753 s；stable/Beta appId、productName、userDataRoot、uninstallKey、updateChannel、artifactName、outputDirectory 均不同。
- 桌面/resource 聚焦套件：132/132 PASS，失败/跳过 0；Node duration 634.205 ms，墙钟 0.711 s。
- 覆盖并发端口、音频输出设备消失、单一音频图、播放切换/回滚、锁屏/挂起/恢复、Explorer restart、显示变化、Wallpaper 单窗口、Sonic/context loss、缓存预算、帧调度和 release/restore。
- 最终 B2 `npm run check`：PASS，13.020 s；`git diff --check`=0；`git status --short`=0 行。

### 原定时长 Playwright soak

5/5 PASS，失败/跳过 0，单 worker；Playwright 报告 1.6 min，墙钟 100.314 s。包含 resource governor 八模式 round-trip、强制 WebGL loss 后播放存活、4K 预热后 20 次切换、完整桌面/壁纸双 viewport 和设置布局。

- 每个性能档保持原定 2 s 预热和 15 s 采样，没有缩短。
- 20 次切换最大 228 ms；transition drain 525/3000 ms。
- JS heap 8,162,664 → 8,545,564 bytes，增长 382,900 bytes（低于 20 MiB 门限）。
- `activeRenderers=1`、`transitionLayers=0`、`retiredGlyphMaterials=0`、atlas=8,388,608 bytes、最终 buffer=467,856 pixels。

| 档位 | 实际采样 | rAF samples | avg FPS | p95 frame | long tasks / max | heap growth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1080p balanced | 15,732.8 ms | 249 | 15.83 | 700 ms | 20 / 801 ms | 880,816 B |
| 4K quality | 16,332.7 ms | 80 | 4.90 | 2,750 ms | 8 / 3,132 ms | 223,176 B |
| 1080p battery | 15,316.1 ms | 244 | 15.93 | 700 ms | 18 / 811 ms | 310,200 B |

WebGL renderer 为 `ANGLE ... SwiftShader Device (Subzero)`，分类为 software。上述数据只证明功能、生命周期、内存和资源边界；参考硬件 FPS/p95 目标与“无持续主线程满载”不能由该环境认证，必须在显式 `MINERADIO_REFERENCE_HARDWARE=1` 且匹配参考 GPU 的环境另行判定。

## 两次额外 packaged 编排：无效证据

协调阶段尝试过两次不入库的 stable/Beta unpacked EXE 编排，均不得写成通过：

1. 第一次因嵌套 PowerShell 没有传播内部失败状态，约 5 秒即返回；未形成启动、端口、时长或退出证据。
2. 第二次约 21 秒失败。检查发现 Electron 的 Windows Known Folder 没有被子进程 `APPDATA` 环境隔离；Beta 实际使用真实 Roaming userData，stable 还可能与早于本轮存在的开发版 `electron.exe` 单实例锁交互。因此没有继续采样，也没有修改生产代码来迎合临时编排。

清理结果：仅终止第二次明确创建的 Beta 根 PID 180492 及五个子 PID；对应 3001 listener、全部已知 PID、两处临时 AppData 和 NSIS 测试注册子键均为 0 残留。预先存在的开发版 `electron.exe` PID 77552 / port 3000 保持运行，未被终止或清理。真实用户数据未执行删除操作。正式 B2 证据仅由 51/51、132/132 和 5/5 三组仓库入口组成。

## 外部限制与发布条件

- 上游在线 API、登录 Cookie/Token、Spotify OAuth 配置、系统音频设备、Explorer/WorkerW 和显卡驱动仍是外部运行条件；对应失败路径均为 fail-soft 或 fail-closed，不得伪造能力。
- 酷狗、汽水和 Spotify 保持 metadata-only，不因登录成功获得未声明播放或写入能力。
- 未签名发布只适用于仓库当前 1.1.0 的明确策略。未来版本必须重新生成 fresh attestation 并重新确认签名策略。
- SwiftShader 视觉通过不得用于市场或发布说明中的硬件性能承诺。
- `public/index.html`/Cuefield 的进一步拆分是后续维护工作，不是本次发布阻断项；拆分时必须保持现有单实例、无第二 RAF/音频图、取消与资源释放测试。

## 最终判定

截至 `1b0c3fd`，Task 14 的代码审查发现、正式测试、stable/Beta 构建、fresh 产物证明、安装沙箱和功能生命周期验收已经闭环。允许进入最终独立核验；本文件不替代协调任务的最终复核，也不关闭目标。
