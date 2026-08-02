# Security Policy

## Supported Versions

当前只维护最新公开版本。

## Installer Safety Notice

`v1.0.10` 及更早旧安装包不再建议继续安装或传播。请将旧 `.exe` 安装包视为不可信历史产物并隔离保留；需要安装 Mineradio 时，请使用 `v1.1.0` 或更新版本的 GitHub Release 安装包。

`v1.1.0` 不作为 `v1.0.10` 的软件内本地更新包发布。旧版本用户请手动下载新版安装包，卸载旧版本后进行纯净安装。

## Reporting a Vulnerability

如果你发现安全问题，请通过 GitHub Issues 或仓库作者主页联系作者。

请不要在公开 Issue 中直接贴出 Cookie、Token、账号信息、私密链接或可复现的敏感数据。

## Sensitive Data

Mineradio 不应收集或上传用户 Cookie。用户登录状态应保存在本地用户数据目录中。

如果你要提交问题反馈，请先确认没有附带：

- `.cookie`
- `.qq-cookie`
- 本地音乐文件
- 用户账号截图
- 调试日志中的 Cookie、Token 或隐私路径

## ASAR 与快速补丁威胁模型

当前 Windows 打包配置保留 `asar: false`，因为项目仍需要对 `resources/app` 进行可审计的发布复核，并保留以后做小范围快速补丁的可能。这个取舍会让本地安装目录中的 JavaScript、HTML、CSS 和资源文件更容易被本机管理员、恶意软件或被篡改的分发包替换；因此安装包来源和文件完整性必须作为发布安全边界的一部分处理。

`v1.1.0` 不发布 `v1.0.10 -> v1.1.0` 快速补丁，也不把旧版本客户端引到新版 `latest.yml`。用户应通过 GitHub Release 下载完整安装包，并用发布页记录的 SHA256 校验安装包完整性。

如果后续恢复快速补丁或镜像下载，必须同时满足：

- manifest 使用 signed manifest，签名校验失败时拒绝更新。
- 每个补丁文件都带 SHA256 digest，digest 缺失或 hash mismatch 时拒绝应用。
- 补丁路径必须经过 allowlist 和路径穿越检查，不能写出应用目录。
- 补丁应用必须可回滚；失败时不能留下半更新状态。
- 补丁发布前必须重新评估是否能改回 `asar: true`。

## 依赖审计策略

不要直接运行 `npm audit fix --force` 处理生产依赖漏洞。`NeteaseCloudMusicApi` 的自动修复建议可能降级到旧的大版本，必须先验证登录、搜索、播放和云盘上传等路径。

当前依赖硬化采用精确 override：`NeteaseCloudMusicApi -> music-metadata@11.13.0`，用于修复 `music-metadata` / `file-type` 的 ASF 解析无限循环风险。发布前必须重新执行 `npm ci`、`npm run audit:prod` 和完整测试；如果 audit 仍有 high/critical，必须在 Release 记录 advisory、依赖路径、影响面、临时接受理由、补偿控制、负责人和到期日期，否则不得发布。
