# 发布流程

## 发布归属

- 正式发布仓库：`English-worse/Mineradio`
- Release 页面：`https://github.com/English-worse/Mineradio/releases`
- `package.json` 的 `build.publish` 和 `mineradio.update` 必须同时指向该仓库。

作者署名和版权说明继续保留 `XxHuberrr`，但正式安装包和应用内更新检查以 `English-worse/Mineradio` 为准。

## v1.1.0 发布边界

- `v1.1.0` 是纯净安装发布版，从当前 `resources/app` 可信源码重新构建。
- 不复用旧 `dist/`、旧安装包、旧 `node_modules`、旧备份包或任何历史 packaged build。
- 不生成 `v1.0.10 -> v1.1.0` 快速补丁。
- 不把 `v1.1.0` 设置为旧版软件内更新通道的 latest；`v1.0.10` 用户需要手动下载新版安装包并纯净安装。
- GitHub Release 需要明确提示：`v1.0.10` 及更早安装包有风险，请隔离旧 `.exe` 安装包，不要继续安装或转发。
- 安装包样式继续沿用 `docs/INSTALLER_STYLE.md` 的中文极简黑白蓝格式。

## 发布前检查

- 确认 `package.json` 和 `package-lock.json` 版本号正确。
- 确认 `build.publish.owner/repo` 和 `mineradio.update.owner/repo` 都指向 `English-worse/Mineradio`。
- 确认 `.cookie`、`.qq-cookie`、`updates/`、`node_modules/`、旧 `dist/` 没有进入 git。
- 确认 README/SECURITY/CHANGELOG/Release 正文包含 `v1.0.10` 旧安装包隔离说明。
- 确认 `docs/VENDOR_MANIFEST.md` 中的 vendor hash 与 `Get-FileHash public\vendor\* -Algorithm SHA256` 一致。
- 使用干净依赖树：`npm ci`。
- 运行发布门禁：`npm run verify:release`。
- Windows 构建脚本固定传入 `--publish never`；构建和验证阶段不会自动上传任何产物，保留 `build.publish` 仅供 electron-builder 描述目标仓库。
- 确认生产审计为 clean；当前依赖例外处理为 `NeteaseCloudMusicApi -> music-metadata@11.13.0`。如果 `npm run audit:prod` 不为 clean，必须在 Release 记录 advisory、依赖路径、严重级别、运行时可达性、影响面、临时接受理由、补偿控制、负责人和到期日期。
- 运行语法检查：`git diff --check`、`node --check server.js`、前端内联脚本解析。
- 运行 Git 跟踪风险残留检查，确认没有跟踪 `.exe/.dll/.scr/.bat/.cmd/.ps1/.vbs/.jse/.wsf/.hta/.xlsm` 等可执行/脚本残留。
- 从当前源码执行 `npm run build:win` 生成 Windows 安装包。
- 对新生成的安装包和当前源码执行安全扫描。
- 运行安装包验证：`npm run verify:artifacts -- --fresh`。
- 生成并记录新安装包 SHA256、Authenticode 签名状态和安装包路径。

## Release Artifact 验证

正式上传前必须对 `dist\Mineradio-*-Setup.exe` 记录签名状态和 SHA256：

```powershell
Get-AuthenticodeSignature dist\Mineradio-*-Setup.exe
Get-FileHash dist\Mineradio-*-Setup.exe -Algorithm SHA256
```

完成手工交叉检查后，必须运行发布验证门禁：

```powershell
npm run verify:artifacts -- --fresh
```

该命令只接受当前版本的唯一安装包及其 attestation sidecar，校验源码身份、安装包 SHA256、Windows 版本信息、签名策略、发布材料、时间新鲜度，并拒绝 `dist` 顶层残留的发布类产物。未生成安装包或任一检查失败时不得发布。

如果官方安装包暂时未签名，对应 `docs/RELEASE_NOTES_v1.1.0.md` 必须同时包含当前版本的 unsigned 机器标记和面向用户的“未签名”声明，GitHub Release 正文也必须明确披露未签名状态；如果签名失败但未记录接受理由，不得发布。

## GitHub Release

目标仓库：

```text
English-worse/Mineradio
```

Release tag：

```text
v1.1.0
```

Release 标题：

```text
Mineradio v1.1.0 纯净安装版
```

`npm run verify:artifacts -- --fresh` 成功后，仅由发布负责人人工上传以下两个资产：

- `dist/Mineradio-1.1.0-Setup.exe`
- `dist/Mineradio-1.1.0-Setup.exe.mineradio-attestation.json`（sidecar 内含安装包 SHA256，并绑定当前源码与 installer manifest）

构建和验证命令绝不上传产物；除上述两个文件外，本次明确禁止上传其他资产，尤其包括：

- `latest.yml` 及其他 `latest*.yml`
- `v1.0.10 -> v1.1.0` 快速补丁

## 更新检测

应用会请求 GitHub Releases latest。为了避免 `v1.0.10` 旧客户端通过软件内更新直接拉到 `v1.1.0`，本次 GitHub Release 不应设为旧更新通道的 latest。

本地验证更新链路时，可以用临时 manifest。这个示例仅限本地测试，不可用于生产发布：

```json
{
  "latestVersion": "1.1.0-test",
  "release": {
    "name": "Mineradio v1.1.0-test",
    "downloadUrl": "http://127.0.0.1:3144/Mineradio-1.1.0-Setup.exe",
    "sha256": "仅本地测试时填写",
    "signature": "仅本地测试时填写",
    "notes": ["本地在线更新链路测试"]
  }
}
```

生产 manifest 或快速补丁清单必须包含 signed manifest 校验、每个补丁文件的 SHA256 digest、路径 allowlist 和回滚策略。缺少 digest 或 hash mismatch 时必须拒绝更新。
