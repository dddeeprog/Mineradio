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

## 发布包注意事项

- 发布安装包或压缩包前，必须确认包含或明确提供 Mineradio 与 Folia 对应源码获取方式。
- 如果 Folia 源码发生修改，必须在本文件或相邻变更日志中记录修改范围、日期和对应 commit。
- 如果仅作为本地私有实验使用且不分发，仍建议保留本通知，避免后续误将实验包发布。
