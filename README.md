# Mineradio

Mineradio 是一款 Windows 桌面沉浸式音乐播放器。它将在线音乐、本地音乐库、动态歌词、3D 视觉、天气电台和 Wallpaper Engine 背景放在同一个播放体验里。

当前发布版本：`1.3.0`

## 主要功能

- 五平台统一搜索：网易云音乐、QQ 音乐、酷狗音乐、汽水音乐与 Spotify
- 平台能力声明：界面会根据平台和登录状态显示搜索、播放、收藏、评论、歌单写入等可用操作
- 多平台登录中心：支持登录引导、外部登录窗口、Cookie 手动导入和安全退出；收藏、会员与音源缓存按账号隔离
- 网易云音乐增强：专辑详情、专辑收藏、歌单订阅、评论点赞与评论发布
- 本地音乐库：扫描本地目录，管理本地歌曲、封面、歌词、媒体素材和节奏分析缓存
- 原生歌词舞台：Mineradio 3D 与流光、心象、云阶、倾诉、莫奈、群唱、浮名七种歌词视觉均在应用内原生渲染
- 视觉与桌面体验：歌词舞台、粒子效果、3D 歌单架、评论弹幕、天气电台、桌面歌词和完整桌面模式
- Wallpaper Engine：可将受支持的 Workshop 或本地项目作为播放器内部动态背景，也保留独立的 Windows 壁纸模式
- 性能保护：资源管理器会在窗口隐藏、最小化、失焦或系统压力较高时释放不必要的渲染和背景资源；前台仍按 VSync 运行
- eIsland 桥接：通过本机受认证的回环通道与浏览器端音乐桥接协作，不向外部暴露播放控制接口

## 下载与安装

请从 [Mineradio Releases](https://github.com/dddeeprog/Mineradio/releases) 下载 Windows 安装包。

正式分发使用 Release 中的 `Mineradio-<version>-Setup.exe`。安装包会创建桌面和开始菜单快捷方式。

## 开发运行

```bash
npm install
npm start
```

常用校验与打包命令：

```bash
npm run check
npm test
npm run build:win
npm run verify:artifacts
```

`npm run build:win` 会生成 Windows NSIS 安装包，产物位于 `dist/`。

## 使用说明

在线音乐功能会遵循各平台的能力声明和账号状态。资源可播放性、音质、收藏、评论和歌单写入等能力取决于平台接口、用户账号及资源版权状态。

Wallpaper Engine 背景需要已安装 Wallpaper Engine，并在设置的外观页面中导入或选择项目。该背景运行在 Mineradio 播放器中；Windows 系统桌面壁纸模式是独立功能。

## 隐私与第三方平台

Mineradio 不是任何音乐平台的官方客户端，也不提供绕过付费、会员、音质限制或重新分发音乐内容的能力。请遵守各平台的用户协议、版权规则和会员权益规则。

登录凭据、搜索历史、自定义封面、歌词、节奏缓存和 Wallpaper Engine 素材均应留在本机用户数据目录，不应提交到仓库。详情见 [PRIVACY.md](./PRIVACY.md)。

## 致谢与授权

Mineradio 由 XxHuberrr 主要设计与打造。感谢所有参与早期体验、测试和视觉设计反馈的贡献者。

本项目采用 [GPL-3.0](./LICENSE) 授权；第三方代码、素材与服务遵循各自授权和服务条款，详见 [NOTICE.md](./NOTICE.md) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
