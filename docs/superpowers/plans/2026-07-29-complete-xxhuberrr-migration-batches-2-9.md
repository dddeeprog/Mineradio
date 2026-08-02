# XxHuberrr Mineradio Batches 2-9 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every behavior change uses `superpowers:test-driven-development`; every task receives spec-compliance review and code-quality review before the next task starts.

**Goal:** Complete the remaining approved capabilities from `XxHuberrr/Mineradio@4abaa190de42c632365ae4244e041bad16443224` on top of `codex/unified-player`, while preserving Mineradio's Folia lyrics, local library, security model, update ownership, and current visual language.

**Architecture:** New behavior is implemented as small CommonJS or UMD modules with pure cores and thin runtime adapters. Existing playback, desktop, Folia, search, and cache systems remain authoritative; platform writes, login, playback transactions, AutoMix, Sonic Topography, desktop lifecycle, and resource governance plug into them through explicit contracts. Release-blocking installer safety is fixed first, then feature work follows dependency order.

**Tech Stack:** Node.js/CommonJS, browser UMD JavaScript, Electron 42, Web Audio API, Canvas2D, existing Three.js r128, NSIS/electron-builder, Node Test, Playwright.

---

## Rules and Baseline

- Base: `codex/unified-player` at `d61cc2e`.
- Work branch: `codex/complete-xxhuberrr-migration`.
- Do not copy upstream `server.js`, `public/index.html`, or `desktop/main.js` wholesale.
- Do not add Kugou, Qishui, or Spotify playback/write operations.
- Spotify uses a public client ID plus PKCE. Remove the current `client_secret`/`client_credentials` dependency.
- Never expose Cookie, Token, OAuth code, verifier, refresh token, or complete account fingerprints in logs, responses, UI storage, diagnostics, or listen records.
- Every adapted file keeps an XxHuberrr source header with the fixed commit and GPL-3.0-only notice.
- Every task ends with:

```powershell
npm run check
npm test
git diff --check
```

- UI tasks also run a focused Playwright fixture.
- Release checks fail closed for stale, wrong-version, unbound, or unreadable-signature artifacts. Signing acceptance follows the existing explicit release policy; do not silently strengthen ownership policy.

## Audited Starting State

| Area | State at `d61cc2e` | Remaining work |
| --- | --- | --- |
| Five-platform search | Complete | Preserve; make actions capability-driven |
| Capability snapshot | Partial | Close mutable implementation enable-list boundary |
| Account cache/context | Pure cores only | Wire real login, logout, writes, source resolution |
| Credential store | Encrypted core only | Wire Electron; stop desktop plaintext cookies |
| Login | Netease/QQ partial | Five-platform center, secure import, PKCE, unified logout |
| Netease writes | Missing | Album detail/collect, playlist subscribe, comment like/create |
| Home/lists | Partial | Real list windows, MP4 lifecycle, action feedback |
| Playback | Partial fade and ad hoc fallback | Transaction, rollback, graph restore, output, gapless |
| Listen reporting | Missing | Idempotent local journal and supported-provider reports |
| Cuefield AutoMix | Missing | Core, planner, executor, cancellation, settings |
| Sonic Topography | Missing | Shared-audio visual, Folia coexistence |
| Desktop/Wallpaper | Partial WorkerW only | Complete desktop, icon layer, WE property bridge, recovery |
| Performance/memory | Partial helpers | System memory, unified budgets, complete restore |
| Installer/release | Unsafe/partial | Ownership marker, path guard, allowlisted cleanup, hard gates |

### Task 1: Block Unsafe Installation, Upgrade, Uninstall, and Release

**Files:**
- Create: `build/installer-safety.js`
- Create: `build/generate-installer-manifest.js`
- Create: `tests/installer-manifest.test.js`
- Create: `tests/installer-safety.test.js`
- Modify: `build/installer.nsh`
- Modify: `build/verify-release-artifacts.js`
- Modify: `tests/release-artifacts.test.js`
- Modify: `tests/smoke.test.js`
- Modify: `package.json`

- [ ] Write failing tests for root/system/user/UNC/reparse-point path rejection; ownership-marker validation; generated file-manifest completeness; normal and interrupted upgrades; stable/beta marker mismatch; unknown-file preservation; no recursive `$INSTDIR` removal; legacy uninstaller suppression; and fail-closed artifact verification.
- [ ] Run `node --test tests/installer-safety.test.js tests/installer-manifest.test.js tests/release-artifacts.test.js tests/smoke.test.js` and confirm RED.
- [ ] Implement `normalizeInstallPath`, `classifyInstallPath`, `createOwnershipMarker`, `validateOwnershipMarker`, `partitionInstallEntries`, and `canRemoveInstallTree`.
- [ ] Generate a per-build JSON manifest and NSIS delete include from the actual packaged `appOutDir`; never maintain the packaged file list by hand.
- [ ] Add NSIS `customUnInstallCheck`, `customInstall`, directory leave validation, and `customRemoveFiles`. Never execute an untrusted legacy uninstall command and never use `RMDir /r $INSTDIR`.
- [ ] Write `.mineradio-install-owner.json` only after install success. Delete generated-manifest files one by one, remove directories non-recursively after they are empty, preserve unknown files, and retain the containing directory.
- [ ] Make artifact verification require current version/product/commit/build metadata, packaged notices, freshness when requested, and readable Authenticode status. Apply the existing explicit signed/unsigned release policy; `Unavailable` never passes.
- [ ] Run GREEN, full gates, and commit `fix: make installer ownership and release checks fail closed`.

### Task 2: Close Capability Registration and Add Central Feature Gates

**Files:**
- Create: `server/platform/implementation-registry.js`
- Create: `server/platform/feature-flags.js`
- Create: `tests/platform-implementation-registry.test.js`
- Modify: `server/platform/capabilities.js`
- Modify: `server/routes/platform.js`
- Modify: `tests/platform-capabilities.test.js`
- Modify: `tests/platform-routes.test.js`
- Modify: `package.json`

- [ ] Write failing tests proving request/plain objects cannot enable server capabilities, only registered implementations become available, and login still gates authenticated operations.
- [ ] Run focused tests and confirm RED.
- [ ] Implement a private registry with `register`, `unregister`, `has`, and safe `snapshot`; recognize valid registries through an internal identity, not `options.enabledCapabilities`.
- [ ] Add central flags: `platformWrites`, `spotifyPkce`, `enhancedPlayback`, `listenReporting`, `cuefield`, `sonicTopography`, `desktopWallpaper`, and `resourceGovernor`.
- [ ] Ensure flags can disable an implementation but cannot invent platform support.
- [ ] Run GREEN, full gates, and commit `refactor: close platform capability registration`.

### Task 3: Establish Stable Data Paths, Then Wire Encrypted Credentials and Atomic Account Context

**Files:**
- Create: `server/platform/credential-session.js`
- Create: `tests/platform-credential-session.test.js`
- Create: `desktop/data-migration-journal.js`
- Create: `desktop/data-migration-journal.test.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/app-paths.js`
- Modify: `desktop/app-paths.test.js`
- Modify: `server.js`
- Modify: `server/platform/account-context.js`
- Modify: `server/routes/netease.js`
- Modify: `server/routes/qq.js`
- Modify: `desktop/credential-store.test.js`
- Modify: `tests/platform-account-cache.test.js`
- Modify: `tests/electron-security.test.js`
- Modify: `package.json`

- [ ] Write failing tests for stable owned subdirectories, crash-resumable allowlisted migration, encrypted hydration before first renderer request, no desktop `.cookie`/`.qq-cookie` writes, explicit `safeStorage` downgrade status, user-only fallback permissions, atomic account switch, ordered logout cleanup, rollback, and secret redaction.
- [ ] Run focused tests and confirm RED.
- [ ] Before starting the server or creating any credential/cache store, create stable credentials, platform-cache, lyrics, beatmap, update, local-metadata, and journal directories; remove the default `D:\MineradioCache\beatmaps` and complete or resume the owned-file migration journal.
- [ ] Implement an in-memory credential session with `hydrate`, `replace`, `clear`, `read`, `subscribe`, and value-free diagnostics.
- [ ] Create the `safeStorage` credential store after Electron is ready, attach a narrow sink to the in-process server, and expose set/clear/status IPC only. If encryption is unavailable, publish `memory-only` by default and write no file; any explicitly enabled compatibility fallback must use user-only file permissions and publish `restricted-file`. Never expose credential read-back IPC.
- [ ] Treat legacy plaintext files as import-only in secure desktop mode; delete them after encrypted persistence succeeds.
- [ ] Create one real account-scoped cache and account context in `server.js`; route login, QR completion, import, switch, and logout through it.
- [ ] Refresh capability state after each successful login/logout and invalidate only the affected account scope.
- [ ] Run GREEN, full gates, and commit `feat: wire encrypted platform credential lifecycle`.

### Task 4: Implement Five-Platform Login and Spotify PKCE

**Files:**
- Create: `desktop/platform-login-window.js`
- Create: `desktop/spotify-pkce.js`
- Create: `public/platform-login-state.js`
- Create: `public/platform-login-ui.js`
- Create: `tests/spotify-pkce.test.js`
- Create: `tests/platform-login-state.test.js`
- Create: `tests/platform-login-ui.test.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/navigation-guard.js`
- Modify: `server/routes/platform.js`
- Modify: `server/platform/providers/spotify-search.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/electron-security.test.js`
- Modify: `tests/platform-search-providers.test.js`
- Modify: `package.json`

- [ ] Write failing tests for verifier/challenge, one-time state, expiry, loopback callback, minimal scopes, refresh, cancellation, and absence of `client_secret` and `client_credentials`.
- [ ] Write failing UI tests proving provider/auth-method rows come from the capability snapshot and metadata-only login never implies playback.
- [ ] Run focused tests and confirm RED.
- [ ] Extract generic login-window policy with dedicated partitions, strict host/path allowlists, `will-navigate`/`will-redirect` guards, denied permission requests, no Node, isolation, and sandbox.
- [ ] Derive Spotify scopes from the exact `/me` and search calls, test the allowlist, and request only `user-read-private` if profile identity is required; omit `user-read-email` and every write scope. Store tokens through Task 3.
- [ ] Replace Spotify search's client-secret token path with the encrypted PKCE access token. When not logged in, return provider-local `AUTH_REQUIRED` without breaking other search providers.
- [ ] Replace the two-platform modal with five first-level provider rows and capability-driven methods: Netease QR/Cookie/window; QQ Cookie/window; Kugou Cookie/window; Qishui Token/Cookie/window; Spotify PKCE/window.
- [ ] Add per-provider logout and manual-import validation. Unknown providers must never fall back to Netease.
- [ ] Run GREEN, Playwright login fixture, full gates, and commit `feat: add capability-driven multi-platform login`.

### Task 5: Add Netease Album and Community Writes

**Files:**
- Create: `server/platform/providers/netease-library.js`
- Create: `tests/netease-library.test.js`
- Create: `public/platform-actions-state.js`
- Create: `tests/platform-actions-state.test.js`
- Modify: `server.js`
- Modify: `server/routes/netease.js`
- Modify: `server/security.js`
- Modify: `server/platform/implementation-registry.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/server-modules.test.js`
- Modify: `tests/security.test.js`
- Modify: `package.json`

- [ ] Write failing tests for normalized public album detail, collect/uncollect, subscribe/unsubscribe, comment like/unlike, comment create, typed errors, auth/CSRF/method checks, bounded content, account-cache invalidation, optimistic rollback, and duplicate-submit protection.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the adapter with shipped APIs `album`, `album_detail_dynamic`, `album_sub`, `playlist_subscribe`, `comment_like`, and `comment_new`; never return complete upstream bodies.
- [ ] Register `albumDetail`, `albumCollect`, `playlistSubscribe`, `commentsLike`, and `commentsCreate` only after routes are wired. Keep album detail public; require an active Netease account for writes.
- [ ] Add capability-driven album, playlist, and comment controls. Unsupported controls are absent; unavailable authenticated controls open login guidance.
- [ ] Run GREEN, album/comment Playwright fixture, full gates, and commit `feat: add netease album and community writes`.

### Task 6: Complete Home, MP4, Playlist, and Bounded Lists

**Files:**
- Create: `public/content-list-controller.js`
- Create: `tests/content-list-controller.test.js`
- Modify: `public/content-shelf-state.js`
- Modify: `public/playlist-state.js`
- Modify: `public/local-media-assets.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/content-shelf-state.test.js`
- Modify: `tests/playlist-state.test.js`
- Modify: `tests/platform-search-page-integration.test.js`
- Modify: `package.json`

- [ ] Write failing tests for true visible-window recycling across search/recommendation/playlist/album/comment lists; focus and scroll anchors; selected-row retention; partial page failure; and bounded node count.
- [ ] Write failing MP4 tests for IndexedDB restore, object-URL replacement/revocation, decode failure fallback, background release, and resume.
- [ ] Run focused tests and confirm RED.
- [ ] Implement one reusable bounded-list controller with overscan, stable keys, page loading, and row disposal. Preserve the current home dashboard; do not build a second homepage.
- [ ] Integrate current MP4/WebM/MOV support as the home visual source while preserving the existing global background option.
- [ ] Ensure playlist route errors are not rendered as empty success and subscription/collection feedback rolls back correctly.
- [ ] Run GREEN, long-list/MP4 screenshots, full gates, and commit `perf: bound home search and playlist content`.

### Task 7: Add Transactional Playback and Audio Enhancements

**Files:**
- Create: `public/playback-transaction.js`
- Create: `public/audio-output-state.js`
- Create: `public/gapless-playback-state.js`
- Create: `tests/playback-transaction.test.js`
- Create: `tests/audio-output-state.test.js`
- Create: `tests/gapless-playback-state.test.js`
- Modify: `public/playback-session-state.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/playback-session-state.test.js`
- Modify: `package.json`

- [ ] Write failing tests for snapshot/commit/rollback of queue, index, song, progress, volume, UI, lyrics, beat state, and audio graph; stale-attempt cancellation; capability-filtered candidates; metadata catalog source; and all-source failure retention.
- [ ] Write failing tests for graph reconstruction, `setSinkId` support/fallback, device disappearance, two-element preload, cancellation, gapless handoff, and bounded crossfade.
- [ ] Run focused tests and confirm RED.
- [ ] Implement `idle -> snapshot -> resolving -> preparing -> confirming -> committed`, with `rolling-back`, `rolled-back`, and `cancelled`.
- [ ] Keep the existing analyser/gain graph authoritative. Reconnect interrupted/closed graphs without creating duplicate `AudioContext`.
- [ ] Use two media elements only during next-track preload. Disable crossfade for seek, manual retry, unsupported streams, local analysis, and reduced-resource mode; immediately release standby media on cancellation.
- [ ] Replace hard-coded Netease/QQ fallback choice with providers whose current capability snapshot allows playback.
- [ ] Run GREEN, failure-injection browser fixture, full gates, and commit `feat: make playback switching transactional`.

### Task 8: Add Cross-Platform Listening Statistics and Idempotent Reporting

**Files:**
- Create: `server/platform/listen-journal.js`
- Create: `server/platform/listen-reporter.js`
- Create: `server/routes/listen.js`
- Create: `public/listen-session-state.js`
- Create: `tests/listen-journal.test.js`
- Create: `tests/listen-reporter.test.js`
- Create: `tests/listen-routes.test.js`
- Create: `tests/listen-session-state.test.js`
- Modify: `server.js`
- Modify: `server/security.js`
- Modify: `server/platform/implementation-registry.js`
- Modify: `public/index.html`
- Modify: `package.json`

- [ ] Write failing tests for `sessionId`, `catalogProvider`, `playbackProvider`, `resolutionMode`, `completeness`, source IDs, durations, and completion; reject search-only records; use `matched-provider`; deduplicate pause/resume/retry; redact secrets.
- [ ] Write failing journal tests for atomic writes, schema migration, byte/count bounds, truncated-temp recovery, compaction, and exponential retry.
- [ ] Run focused tests and confirm RED.
- [ ] Implement local statistics as always available with `complete`, `partial`, or `unsupported`.
- [ ] Report only to the real playback provider when its implementation registry exposes `recentPlayReport` or `listenDurationReport`. Use supported Netease APIs only with valid input; failed provider writes remain local and retry safely.
- [ ] Start a listen session only after confirmed playback; close on song switch/end/unload and submit through a CSRF-protected route.
- [ ] Run GREEN, full gates, and commit `feat: add idempotent cross-platform listening reports`.

### Task 9: Implement Cuefield AutoMix

**Files:**
- Create: `cuefield/core.js`
- Create: `cuefield/analysis-adapter.js`
- Create: `cuefield/transition-planner.js`
- Create: `cuefield/timeline-executor.js`
- Create: `public/cuefield-runtime.js`
- Create: `tests/cuefield-core.test.js`
- Create: `tests/cuefield-transition-planner.test.js`
- Create: `tests/cuefield-timeline-executor.test.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `package.json`

- [ ] Write failing deterministic tests for BPM compatibility, half/double tempo, phrase/downbeat boundaries, confidence, energy arcs, missing analysis, and key compatibility.
- [ ] Write failing executor tests for cancellation on manual skip, seek, pause, source failure, track replacement, background release, and feature disable.
- [ ] Run focused tests and confirm RED.
- [ ] Reuse existing beatmap/local tempo data; do not create another decoder or permanent worker when analysis exists.
- [ ] Keep planning pure. Execute through Task 7's audio owner with one cancellation token; failure restores ordinary transactional switching.
- [ ] Add off/subtle/balanced/club intensity to the existing Settings hierarchy and archive schema.
- [ ] Run GREEN, timeline fixture, full gates, and commit `feat: integrate cuefield automix`.

### Task 10: Add Sonic Topography Without Replacing Folia

**Files:**
- Create: `public/sonic-topography-state.js`
- Create: `public/sonic-topography-renderer.js`
- Create: `tests/sonic-topography-state.test.js`
- Create: `tests/sonic-topography-renderer.test.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `public/folia-native/config.js`
- Modify: `tests/folia-native-config.test.js`
- Modify: `package.json`

- [ ] Write failing tests for deterministic terrain sampling, bounded history, quality tiers, pause decay, resize, context loss, release/restore, reduced motion, and archive migration.
- [ ] Run focused tests and confirm RED.
- [ ] Consume the existing frequency/time-domain buffers and main animation loop; do not create an `AudioContext` or permanent independent RAF.
- [ ] Prefer the existing Three.js host/material pool and use Canvas2D only as context-loss fallback.
- [ ] Mount Sonic as a stage/background layer. Preserve all eight Folia renderers, glass material, frame ownership, and release behavior.
- [ ] Add settings and archive migration with bounded values.
- [ ] Run GREEN, Sonic plus eight-Folia-mode screenshots, full gates, and commit `feat: add sonic topography visual layer`.

### Task 11: Complete Desktop, Icon Layer, WorkerW, and Wallpaper Engine

**Files:**
- Create: `desktop/wallpaper-runtime.js`
- Create: `desktop/wallpaper-properties.js`
- Create: `desktop/desktop-icon-state.js`
- Create: `desktop/wallpaper-diagnostics.js`
- Create: `desktop/wallpaper-runtime.test.js`
- Create: `desktop/wallpaper-properties.test.js`
- Create: `desktop/desktop-icon-state.test.js`
- Create: `public/desktop-icon-layer.js`
- Create: `tests/wallpaper-page.test.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/overlay-preload.js`
- Modify: `desktop/ipc-auth.js`
- Modify: `public/wallpaper.html`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `tests/electron-security.test.js`
- Modify: `package.json`

- [ ] Write failing tests for one-window lifecycle, WorkerW attach/fallback/retry, Explorer restart, display/lock/power events, full-desktop enable/disable, icon layout/hit testing, property validation, failure-state rollback, and cleanup.
- [ ] Run focused tests and confirm RED.
- [ ] Extract current WorkerW behavior into `wallpaper-runtime.js` with injected native adapters and state-only diagnostics.
- [ ] Add the complete-desktop visual mode and desktop icon layer without replacing the real Windows shell or touching arbitrary desktop files.
- [ ] Add a Wallpaper Engine-compatible `wallpaperPropertyListener.applyUserProperties` bridge for preset, opacity, FPS tier, cover, particle density, pause, and audio input. Keep this distinct from Mineradio's self-hosted WorkerW mode.
- [ ] Route every new IPC through current sender authorization; reject arbitrary paths, URLs, and properties.
- [ ] Propagate initialization failure to the UI so toggles revert and the main player remains unchanged.
- [ ] Run GREEN, optional Windows diagnostics, full gates, and commit `feat: complete desktop and wallpaper lifecycle`.

### Task 12: Unify Performance, System Memory, Caches, and Background Release

**Files:**
- Create: `public/resource-governor.js`
- Create: `desktop/system-memory-state.js`
- Create: `tests/resource-governor.test.js`
- Create: `desktop/system-memory-state.test.js`
- Modify: `public/performance.js`
- Modify: `public/memory-cache-state.js`
- Modify: `public/index.html`
- Modify: `public/folia-native/runtime.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `tests/performance-helpers.test.js`
- Modify: `tests/memory-cache-state.test.js`
- Modify: `package.json`

- [ ] Write failing tests for foreground/background/hidden/locked states, system memory pressure, FPS tiers, byte/count cache budgets, hysteresis, one frame owner, ordered release, and idempotent restoration.
- [ ] Add full round-trip tests for all eight Folia modes, open/clickable 3D playlist and album shelves, Sonic, AutoMix, standby media, complete desktop, and wallpaper.
- [ ] Run focused tests and confirm RED.
- [ ] Implement one governor consuming visibility, focus, power, memory pressure, frame cost, and active features; output quality tier, target FPS, cache budgets, release set, and restore set.
- [ ] Route decisions into existing animation and cache systems; do not add a competing scheduler.
- [ ] Give each owned cache count and approximate byte limits. Background release cancels AutoMix, removes standby media, releases Sonic/Folia, lowers wallpaper FPS, and trims cover/beat/comment/layout caches.
- [ ] Extend `window.__mineradioPerfSnapshot()` with non-secret resource state, percentiles, counts, and release/restore counters.
- [ ] Run GREEN, memory soak, full gates, and commit `perf: unify runtime resource governance`.

### Task 13: Finish Beta Build, Licensing, Release Ownership, and Cleanup

**Files:**
- Create: `build/electron-builder.beta.json`
- Create: `build/desktop-diagnostics.js`
- Create: `tests/beta-build-config.test.js`
- Modify: `tests/release-ownership.test.js`
- Modify: `package.json`
- Modify: `NOTICE.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/VENDOR_MANIFEST.md`
- Modify: `tests/release-artifacts.test.js`
- Modify: `tests/smoke.test.js`
- Modify: `public/index.html`

- [ ] Write failing tests for beta isolation, `English-worse/Mineradio` publish/update ownership, packaged licenses/source notices, source headers, and complete release gates.
- [ ] Run focused tests and confirm RED.
- [ ] Add isolated beta `appId`, product name, user-data root, uninstall key, update channel, and artifact suffix.
- [ ] Assert package metadata, update configuration, beta configuration, and packaged build metadata retain `English-worse/Mineradio` as the canonical release owner/repository.
- [ ] Include `LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, `docs/VENDOR_MANIFEST.md`, and Folia/pretext license/source acquisition material in artifacts.
- [ ] Move newly touched search/login/playback assembly out of `public/index.html`; remove the unused dual-provider score code only after callers migrate. Keep legacy endpoints still used by artist, lyric, or source-match flows.
- [ ] Run GREEN, full gates, and commit `build: finish beta release ownership and license packaging`.

### Task 14: Full Closure Audit

**Files:**
- Create: `docs/audits/2026-07-29-xxhuberrr-migration-closure.md`
- Modify: the existing Chinese modification log under `docs/`
- Modify only when findings require fixes: Task 1-13 files

- [ ] Run `npm run check`, `npm test`, `git diff --check`, and `npm run audit:prod`.
- [ ] Run a loopback real-service smoke for capability snapshots, five searches with partial failure, unauthorized writes, PKCE state rejection, album detail, listen idempotency, and secret-free responses/logs.
- [ ] Run Playwright at `390x844`, `720x1280`, `960x540`, `1366x768`, and `1920x1080` for search, login, album/comments, long lists, playback rollback, AutoMix, Sonic with all Folia modes, desktop controls, settings transitions, and background restore.
- [ ] Run desktop soak: one audio graph, one Folia renderer, one wallpaper window, twenty source/mode switches, output-device disappearance, lock/sleep/resume, Explorer restart, display change, and bounded heap/cache growth.
- [ ] Build stable and beta directories, then run artifact verification with `--fresh` and the repository-configured signing policy; unreadable signature state must fail.
- [ ] Run installer sandbox acceptance with a sentinel unknown file: fresh install; normal and interrupted upgrade; no legacy uninstaller execution; stable/beta cross-marker rejection; known-file cleanup; sentinel preservation; marker/path rejection; containing directory retained when unknown content remains.
- [ ] Dispatch a spec-compliance review against `docs/superpowers/specs/2026-07-28-xxhuberrr-capability-migration-design.md`, fix all findings, and re-review.
- [ ] Dispatch a whole-branch code-quality/security/release review, fix all findings, and re-review.
- [ ] After every review fix, rerun the complete static/unit/service/visual/desktop-soak/installer/artifact sequence above before writing the closure audit.
- [ ] Write the closure audit mapping every requirement to implementation, tests, runtime evidence, fallback, and external limits.
- [ ] Append the existing Chinese modification log under `docs/` with exact changed files and line references.
- [ ] Commit `docs: close xxhuberrr migration audit`; final worktree must be clean.

## Acceptance Matrix

- [ ] Five-platform search stays fail-soft; metadata-only platforms never expose playback commands.
- [ ] Five-platform login is capability-driven; Spotify uses PKCE without a client secret.
- [ ] Desktop credentials are encrypted; account cache state never crosses accounts.
- [ ] Netease album detail/collect, playlist subscribe, comment like/create work with rollback.
- [ ] Home, search, album, playlist, and comment lists keep bounded DOM and MP4 resources release correctly.
- [ ] Playback failures restore queue, song, progress, UI, lyrics, gain, and audio graph.
- [ ] Output device, gapless, crossfade, AutoMix, Sonic, desktop, and wallpaper can disable independently and recover base playback.
- [ ] Listen events distinguish catalog/playback providers and are idempotent.
- [ ] Sonic coexists with all Folia modes and never owns a second audio graph or frame loop.
- [ ] Resource governance releases/restores Folia, shelves, Sonic, AutoMix, desktop, wallpaper, media, and caches.
- [ ] Installer/uninstaller only touch owned allowlisted content.
- [ ] Stable and beta builds are isolated and package every required license/source notice.
- [ ] Unit, visual, security, service, desktop, memory, installer, artifact, spec, and quality reviews all close.
