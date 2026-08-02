# Mineradio 发布归属

## 正式发布仓库

- 正式发布仓库：`English-worse/Mineradio`
- Release 页面：`https://github.com/English-worse/Mineradio/releases`
- 当前版本：`1.1.0`
- 当前维护分支：`develop/mineradio-maintenance`

本维护分支以当前 git remote `origin` 为发布归属来源。`package.json` 中的 `build.publish` 和 `mineradio.update` 必须同时指向 `English-worse/Mineradio`，避免安装包发布源与应用内更新源分裂。

`XxHuberrr` 仍保留在 README 的作者与版权说明中；作者署名不等于 GitHub Release 托管仓库。

## 版本源

- `package.json` 的 `version` 是构建和安装包命名的主版本源。
- `package-lock.json` 根包版本必须与 `package.json` 一致。
- README 的“当前版本”和 CHANGELOG 的最新发布标题必须与发布版本一致。
- Release tag 在正式发布提交上创建，格式为 `v<package.json version>`，例如 `v1.1.0`。
- 当前维护 HEAD 没有 release tag 时，不应把普通维护提交视为已发布版本。

## 更新通道

当前应用内更新策略仍使用 GitHub Releases latest API：

- provider：`github`
- owner：`English-worse`
- repo：`Mineradio`
- 资产托管：GitHub Releases
- 镜像加速：仅作为下载完整安装包资产时的可选 fallback

发布前必须确认 latest release 不会让旧客户端误拉不兼容包。若后续改为 signed manifest JSON，应先在 `server/update.js` 中完成签名、digest 和 rollback 校验，再切换 `mineradio.update` 配置。

## 发布检查

正式打包前至少执行：

```powershell
npm pkg get version build.publish mineradio.update
git remote -v
git tag --points-at HEAD
npm run check
npm test
```

如果 `git tag --points-at HEAD` 为空，说明当前提交还不是发布提交。只有在发布提交完成验证后，才创建对应版本 tag。
