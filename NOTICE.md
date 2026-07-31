# NOTICE

Mineradio 使用了以下第三方项目或服务。各项目版权归其原作者所有。

## Third-party Libraries

- Electron
- Three.js
- GSAP
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder
- Folia / folia-major (AGPL-3.0, source imported under `third_party/folia-major/`)

更完整的第三方源码、许可证和引入 commit 记录见 `THIRD_PARTY_NOTICES.md`。

## Upstream Reference Adaptations

- [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)，固定参考 commit `4abaa190de42c632365ae4244e041bad16443224`，许可证为 GPL-3.0-only。
  本批参考其 `desktop/main.js`、`server.js`、`build/installer.nsh`、`build/after-pack.js`、`cuefield/adapter-mineradio.js`、`public/js/modules/05-playback/16-cuefield-automix-core.js`、`public/js/modules/05-playback/17-cuefield-timeline-executor.js` 与 `public/sonic-topography-preset.js`，改编了稳定用户数据目录、平台能力模型、账号隔离概念、Cuefield 节拍适配与过渡生命周期、Sonic Topography 视觉行为，以及安装器视觉/资源注入流程；音频所有权、事务回退、Sonic 状态/渲染器、安装归属、危险路径、生成式清单、事务恢复与卸载保护由本地重写实现。

- XxHuberrr 的 Sonic 文件声明其视觉来源参考 [yin-yizhen/sonic-topography](https://github.com/yin-yizhen/sonic-topography) `1.1.1@3ff303e`。该项目采用 Non-Commercial Learning License。Mineradio 本地实现仅依据公开行为独立重写，没有复制其着色器、播放器或源文件；完整来源边界见 `THIRD_PARTY_NOTICES.md`。

## Third-party Services

Mineradio 可能与网易云音乐、QQ 音乐等第三方音乐服务进行用户自有账号相关的本地客户端交互。

Mineradio 不是任何音乐平台的官方客户端，也不隶属于网易云音乐、QQ 音乐或腾讯音乐娱乐集团。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。

## Original Design

Mineradio 名称、MR Logo、界面视觉设计、启动动画方向、粒子视觉体验和电影镜头系统的产品表达属于作者原创设计。

emily 作为 Mineradio 早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。
