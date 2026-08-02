# Mineradio 发布归属

## 正式发布仓库

- 正式发布仓库：`dddeeprog/Mineradio`
- Release 页面：`https://github.com/dddeeprog/Mineradio/releases`
- 当前版本：`1.3.0`
- 当前维护分支：`master`

`package.json` 中的 `build.publish`、`mineradio.update` 和 `mineradioBuild` 必须同时指向 `dddeeprog/Mineradio`，避免安装包发布源与应用内更新源分裂。

`XxHuberrr` 仍保留在作者、版权和改编来源说明中；作者署名不等于 GitHub Release 托管仓库。

## 版本与更新通道

- `package.json` 的 `version` 是构建和安装包命名的主版本源。
- `package-lock.json` 根包版本必须与 `package.json` 一致。
- README 的当前版本必须与发布版本一致。
- Release tag 在正式发布提交上创建，格式为 `v<package.json version>`，例如 `v1.3.0`。
- 稳定通道使用 GitHub Releases latest；Beta 通道使用 `beta` 发布筛选，两者共享 `dddeeprog/Mineradio` 仓库但使用独立应用标识和用户数据目录。

## 发布检查

正式打包前至少执行：

```powershell
npm run check
npm test
npm run build:win
npm run verify:artifacts
git tag --points-at HEAD
```

只有发布提交通过验证后，才创建对应版本标签与 GitHub Release。
