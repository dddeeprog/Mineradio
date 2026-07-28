# Vendor Manifest

本文件记录 `public/vendor/` 下随仓库分发的浏览器端第三方文件。更新 vendor 文件时必须同步版本、来源、许可证和 SHA256。

| 本地文件 | 库 | 版本 | 上游来源 | 许可证 | SHA256 |
| --- | --- | --- | --- | --- | --- |
| `public/vendor/gsap.min.js` | GSAP | 3.15.0 | `https://github.com/greensock/GSAP` / `https://gsap.com` | GSAP Standard "no charge" license (`https://gsap.com/standard-license`) | `92BB9A96476F983D212A2BC4F54C889039C1696DD4461D40A736860938570FBB` |
| `public/vendor/music-tempo.min.js` | music-tempo | 1.0.3 | `https://github.com/killercrush/music-tempo` | MIT | `2927859A8E81E8874A95DC7AF3A2A06FEDD306826F774B7378E26AD5FA9CBD76` |
| `public/vendor/music-tempo.LICENCE` | music-tempo license text | 1.0.3 | `https://github.com/killercrush/music-tempo` | MIT | `12B4E069F64AE9A2660C1F5FE788E548487EC8385960BDA0A0BFE177C95348CF` |
| `public/vendor/pretext-0.0.7.iife.min.js` | @chenglou/pretext | 0.0.7 | `https://github.com/chenglou/pretext` | MIT | `9692D5FCE4EA18A116C96956E74C21E4C70EF4CD377C3316EAB6D502B16A71C0` |
| `public/vendor/pretext-0.0.7.LICENSE` | @chenglou/pretext license text | 0.0.7 | `https://github.com/chenglou/pretext` | MIT | `E9355CB16457E81ACD97DAC2E50F2F8BBF2A9A464025F9C46DB3680CF9598846` |
| `public/vendor/three.r128.min.js` | Three.js | r128 / 0.128.0 | `https://github.com/mrdoob/three.js` / `https://threejs.org/` | MIT | `9274BBCEC8D96168626C732B5D31C775AA8CFB7EAA0599BEC0C175908A2C1CE2` |

## 上游源码改编记录

此表记录没有直接复制到 `public/vendor/`、但实现时参考并改编了其源码的上游项目。

| 上游项目 | 固定 commit | 参考文件 | 本地改编范围 | 许可证 |
| --- | --- | --- | --- | --- |
| `https://github.com/XxHuberrr/Mineradio` | `4abaa19` | `desktop/main.js`、`server.js` | 稳定用户数据目录、平台能力模型、账号隔离概念 | GPL-3.0-only |

## 更新流程

1. 从上游发布源获取新文件，不从未知 CDN 复制。
2. 保留或补充对应许可证文件。
3. 运行：

```powershell
Get-FileHash public\vendor\* -Algorithm SHA256
```

4. 更新本 manifest，并运行 `npm test` 确认清单覆盖所有 vendor 文件。
