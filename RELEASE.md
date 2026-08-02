# 发布流程

## 发布归属

- 正式发布仓库：`dddeeprog/Mineradio`
- Release 页面：`https://github.com/dddeeprog/Mineradio/releases`
- `package.json` 的 `build.publish`、`mineradio.update` 与 `mineradioBuild` 必须指向同一仓库。

作者署名和版权说明继续保留原始来源信息；正式安装包和应用内更新检查以 `dddeeprog/Mineradio` 为准。

## v1.3.0 发布门禁

- 确认 `package.json` 与 `package-lock.json` 的版本号一致。
- 确认稳定版、Beta 版发布配置和更新配置都指向 `dddeeprog/Mineradio`。
- 确认工作树干净，且 `.cookie`、`.qq-cookie`、`updates/`、`node_modules/` 与历史 `dist/` 没有进入 git。
- 使用干净依赖树：`npm ci`。
- 运行 `npm run check`、`npm test`、`npm run build:win` 和 `npm run verify:artifacts -- --fresh`。
- 正式发布前还必须运行完整门禁：`npm run verify:release`。
- Windows 构建脚本必须固定使用 `--publish never`；构建和验证阶段不得自动上传产物。
- 确认生产审计结果已处理。当前依赖覆盖为 `NeteaseCloudMusicApi -> music-metadata@11.13.0`；如审计未通过，必须在 Release 中记录风险、影响、补偿控制和处理计划。

## 安装包验证

正式上传前记录安装包签名状态和 SHA256：

```powershell
Get-AuthenticodeSignature dist\Mineradio-*-Setup.exe
Get-FileHash dist\Mineradio-*-Setup.exe -Algorithm SHA256
npm run verify:artifacts -- --fresh
```

验证脚本会检查当前源码身份、安装包 SHA256、Windows 版本信息、签名策略和 installer manifest。未生成安装包或任一检查失败时不得发布。

## GitHub Release

在已验证的发布提交上创建 `v<version>` 标签，并在 `dddeeprog/Mineradio` 建立同名 GitHub Release。构建命令只生成资产；验证完成后，仅由发布负责人进行人工上传当前版本安装包及其验证脚本要求的 sidecar 文件。1.3.0 上传的资产为：

- `dist/Mineradio-1.3.0-Setup.exe`
- `dist/Mineradio-1.3.0-Setup.exe.mineradio-attestation.json`

不要上传历史构建产物或与当前版本不匹配的资产。

如果安装包未签名，Release 正文必须明确标注未签名状态和 SHA256。
