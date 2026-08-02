# Third Party Notices

本文件记录随 Mineradio 仓库一并分发的第三方源码、资源和重要许可证义务。

## Folia / folia-major

- 项目名称：Folia
- 上游仓库：`https://github.com/chthollyphile/folia-major`
- 引入位置：`third_party/folia-major/`
- 固定 commit：`baa5e846b7404f1893e8b7812bca79e959f21d3f`
- 引入方式：从上游仓库复制源码树，排除 `.git`、依赖目录和本地构建输出目录。
- 许可证：GNU Affero General Public License v3.0，见 `third_party/folia-major/LICENSE`。
- 源码获取：发布包包含 `third_party/folia-major/README.md`、固定 commit 与上游仓库地址；对应完整源码可从上述上游仓库按固定 commit 获取。
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
- 改编位置：`desktop/app-paths.js`、`desktop/main.js`、`desktop/system-memory-state.js`、`desktop/wallpaper-engine-library.js`、`desktop/wallpaper-engine-runtime.js`、桌面壁纸与图标模块、`server.js`、`server/platform/`、平台路由、`public/application-assembly.js`、`public/platform-*-state.js`、`public/platform-*-ui.js`、`public/playback-transaction.js`、`public/resource-governor.js`、Sonic Topography 与完整桌面相关模块。
- 改编范围：稳定/Beta 数据目录、平台能力与账号隔离模型、多平台目录搜索、酷狗与汽水只读远端会话验证、应用装配、播放事务、资源治理、有界 Sonic Topography 生命周期，以及 WorkerW/Progman 回退、Explorer 重启恢复、Wallpaper Engine 属性桥接、本地项目索引、受控媒体协议、原生 Scene 会话捕获与播放器内背景连接，以及不接管真实 Windows Shell 的受限桌面图标视觉。
- 许可证：GNU General Public License v3.0 only，完整文本见仓库根目录 `LICENSE`。
- 功能边界：新增搜索适配仅返回公开目录元数据；酷狗登录以只读歌单接口核对会话返回的用户 ID，汽水 Cookie 登录以只读 `/luna/pc/me` 接口取得唯一账号 ID，验证通过后才交由本地账号生命周期保存。现有汽水 Token 内容接口不能证明账号身份时失败关闭。未移植上游的音频解密、本地会话发现、账号写入或播放绕过逻辑；完整桌面只管理 Mineradio 壁纸窗口与视觉图标，不读取任意桌面文件、不替换 Explorer、不持有真实 Shell 图标。

## yin-yizhen / Sonic Topography

- 上游仓库：`https://github.com/yin-yizhen/sonic-topography`
- 固定参考：`1.1.1`，commit `3ff303e`。
- 参考关系：`XxHuberrr/Mineradio@4abaa19` 的 `public/sonic-topography-preset.js` 声明其视觉算法来源于该项目。
- 许可证：Non-Commercial Learning License，仅允许学习、研究和个人非商业使用；商业使用或分发衍生作品需要版权所有者明确授权。
- 本地边界：本仓库没有复制该项目的源文件、播放器或着色器；`public/sonic-topography-state.js` 与 `public/sonic-topography-renderer.js` 根据公开视觉行为、Mineradio 既有音频帧合同和现有 Three.js 宿主独立重写。任何改变该边界的后续迁移都必须重新完成许可证审查。

## 发布包注意事项

- 发布安装包或压缩包前，必须包含根目录 `LICENSE`、`NOTICE.md`、本文件、`docs/VENDOR_MANIFEST.md`、`third_party/folia-major/LICENSE`、`third_party/folia-major/README.md` 与 `public/vendor/pretext-0.0.7.LICENSE`，并明确提供 Mineradio 与 Folia 对应源码获取方式。
- 如果 Folia 源码发生修改，必须在本文件或相邻变更日志中记录修改范围、日期和对应 commit。
- 如果仅作为本地私有实验使用且不分发，仍建议保留本通知，避免后续误将实验包发布。
