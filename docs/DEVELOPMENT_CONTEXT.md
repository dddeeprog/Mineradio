# Mineradio 开发上下文

## 当前工作区

- 当前仓库根目录：`C:\Users\TomatoK\Documents\Playground\Mineradio`
- 当前维护分支：`develop/mineradio-maintenance`
- 当前任务来源：`docs/superpowers/plans/2026-06-28-mineradio-engineering-optimization.md`

## 目录事实

本仓库是当前维护工作的权威源码目录。历史文档中的 `E:\桌面\播放器软件\Mineradio\resources\app` 属于旧运行版路径或特定机器路径；除非在当前机器上重新验证存在，否则只作为历史参考。

主要入口：

- `public/index.html`：主 renderer、UI、播放、歌词、视觉、3D 歌单架。
- `server.js`：本地 API、音乐源、天气、代理、更新和补丁。
- `desktop/main.js`：Electron 主进程、窗口、IPC、桌面歌词、壁纸。
- `package.json`：脚本、依赖和 electron-builder 配置。

## 发布状态

发布仓库尚未在本维护分支中最终确认。当前观察到的状态：

- 本地 remote：`English-worse/Mineradio`
- 应用内更新配置：`XxHuberrr/Mineradio`
- `package.json` 版本：`1.1.0`
- 当前 HEAD tag：`v1.2.0`

在执行发布、更新配置、版本号调整或打安装包前，必须先完成发布归属统一。

## 基线命令

日常改动后至少运行：

```powershell
npm run check
npm test
git diff --check
```

发布前运行：

```powershell
npm run verify:release
```

如果 `npm run audit:prod` 报告已知上游依赖风险，不要直接运行 `npm audit fix --force`，必须先评估 `NeteaseCloudMusicApi` 兼容性。
