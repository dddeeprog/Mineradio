# Mineradio v1.3.0

Mineradio 1.3.0 是在线播放、本地音乐库、原生歌词舞台和桌面视觉能力合并后的正式发布版本。

<!-- mineradio-release-signing:{"version":"1.3.0","status":"unsigned"} -->

## 主要更新

- 接入网易云音乐、QQ 音乐、酷狗音乐、汽水音乐和 Spotify 的统一搜索与平台能力声明。
- 增强网易云专辑详情、专辑收藏、歌单订阅、评论点赞和评论发布；账号收藏、会员和音源缓存按账号隔离。
- 完善多平台登录中心、外部登录窗口、Cookie 手动导入、退出流程和跨平台收听统计。
- 本地音乐库支持目录扫描、歌词与素材关联、本地封面、节奏分析缓存和安全本地媒体访问。
- 原生歌词舞台包含 Mineradio 3D 以及流光、心象、云阶、倾诉、莫奈、群唱、浮名七种视觉效果。
- Wallpaper Engine 项目可作为播放器内部背景使用；完整桌面、桌面歌词、3D 歌单架、天气电台和资源管理策略同步整合。
- 新增 eIsland 本机认证桥接，浏览器端协作仅通过受限的本地回环通道进行。

## 下载

- Windows 安装包：`Mineradio-1.3.0-Setup.exe`
- 构建证明：`Mineradio-1.3.0-Setup.exe.mineradio-attestation.json`

## 安装与校验

1. 下载并运行 `Mineradio-1.3.0-Setup.exe`。
2. 如需校验完整性，请核对 attestation sidecar 中记录的 SHA256。
3. Wallpaper Engine 背景需要已安装 Wallpaper Engine；该播放器背景与 Windows 系统桌面壁纸模式相互独立。

> 当前官方安装包未签名，Windows 可能显示安全提示。请仅从 `dddeeprog/Mineradio` 的 GitHub Release 下载，并结合 SHA256 进行校验。
