# Third Party Notices

本文件记录随 Mineradio 仓库一并分发的第三方源码、资源和重要许可证义务。

## Folia / folia-major

- 项目名称：Folia
- 上游仓库：`https://github.com/chthollyphile/folia-major`
- 引入位置：`third_party/folia-major/`
- 固定 commit：`baa5e846b7404f1893e8b7812bca79e959f21d3f`
- 引入方式：从上游仓库复制源码树，排除 `.git`、依赖目录和本地构建输出目录。
- 许可证：GNU Affero General Public License v3.0，见 `third_party/folia-major/LICENSE`。
- 当前修改状态：已在 `src/mineradioBridge/` 增加 Mineradio Bridge 接入层，并调整 `src/App.tsx` 让 Folia bridge mode 消费 Mineradio 传入的播放状态、歌词和 DIY 舞台效果配置；`public/folia-native/` 继续以原生 JavaScript 改编歌词时序、语义排版和七种视觉效果，改编文件保留来源头；未改变 Folia 原始项目的许可证。

Mineradio 后续若复制、修改、链接、组合或分发 Folia 代码，必须保留 Folia 原始许可证、作者声明和本通知，并按 AGPL-3.0 及 GPL-3.0 兼容组合要求提供对应源码获取方式。

## @chenglou/pretext

- 项目名称：pretext
- 上游仓库：`https://github.com/chenglou/pretext`
- 版本：`0.0.7`
- 本地文件：`public/vendor/pretext-0.0.7.iife.min.js`、`public/vendor/pretext-0.0.7.LICENSE`
- 引入方式：使用 `build/vendor-pretext.js` 从 Folia 固定依赖树生成浏览器 IIFE。
- 许可证：MIT，完整文本见随包许可证文件。

## XxHuberrr / Mineradio

- 项目名称：Mineradio
- 上游仓库：`https://github.com/XxHuberrr/Mineradio`
- 固定 commit：`4abaa190de42c632365ae4244e041bad16443224`
- 改编位置：`desktop/main.js`、`desktop/wallpaper-runtime.js`、`desktop/wallpaper-properties.js`、`desktop/desktop-icon-state.js`、`desktop/wallpaper-diagnostics.js`、`server.js`、`server/platform/`、`server/routes/platform-search.js`、`public/platform-search-state.js`、`public/platform-search-ui.js`、`public/sonic-topography-state.js`、`public/sonic-topography-renderer.js`、`public/wallpaper.html`、`public/desktop-icon-layer.js`。
- 改编范围：稳定用户数据目录、平台能力与账号隔离模型、酷狗/汽水/Spotify 的只读目录搜索适配、基于 `public/sonic-topography-preset.js` 公开行为重新设计的有界 Sonic Topography 状态和渲染生命周期，以及 WorkerW/Progman 回退、Explorer 重启恢复、Wallpaper Engine 属性桥接和不接管真实 Windows Shell 的受限桌面图标视觉。
- 许可证：GNU General Public License v3.0 only，完整文本见仓库根目录 `LICENSE`。
- 功能边界：新增搜索适配仅返回公开目录元数据，不移植上游的音频解密、本地会话发现、账号写入或播放绕过逻辑；完整桌面只管理 Mineradio 壁纸窗口与视觉图标，不读取任意桌面文件、不替换 Explorer、不持有真实 Shell 图标。

## yin-yizhen / Sonic Topography

- 上游仓库：`https://github.com/yin-yizhen/sonic-topography`
- 固定参考：`1.1.1`，commit `3ff303e`。
- 参考关系：`XxHuberrr/Mineradio@4abaa19` 的 `public/sonic-topography-preset.js` 声明其视觉算法来源于该项目。
- 许可证：Non-Commercial Learning License，仅允许学习、研究和个人非商业使用；商业使用或分发衍生作品需要版权所有者明确授权。
- 本地边界：本仓库没有复制该项目的源文件、播放器或着色器；`public/sonic-topography-state.js` 与 `public/sonic-topography-renderer.js` 根据公开视觉行为、Mineradio 既有音频帧合同和现有 Three.js 宿主独立重写。任何改变该边界的后续迁移都必须重新完成许可证审查。

## 发布包注意事项

- 发布安装包或压缩包前，必须确认包含或明确提供 Mineradio 与 Folia 对应源码获取方式。
- 如果 Folia 源码发生修改，必须在本文件或相邻变更日志中记录修改范围、日期和对应 commit。
- 如果仅作为本地私有实验使用且不分发，仍建议保留本通知，避免后续误将实验包发布。
