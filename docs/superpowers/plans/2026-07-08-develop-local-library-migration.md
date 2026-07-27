# Develop Local Library Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use `develop/mineradio-maintenance` as the base branch and migrate the local-library capabilities from `codex/merge-two-projects` in small, testable batches.

**Architecture:** Keep the `develop` branch architecture as authoritative: modular `server/`, existing `tests/`, desktop IPC/security boundaries, release verification, Folia work, and weather work stay in place. Treat `codex/merge-two-projects` as a source branch for selected local-library features only; do not accept whole-file replacements for `public/index.html`, `server.js`, `desktop/main.js`, or `package.json`.

**Tech Stack:** Electron, Node.js, plain browser JavaScript, existing Mineradio renderer in `public/index.html`, `node:test`, existing `npm run check` / `npm run test` / release verification scripts.

---

## Branch And Merge Policy

- Base branch: `develop/mineradio-maintenance`.
- Source branch: `codex/merge-two-projects`.
- Create a new implementation branch from `develop/mineradio-maintenance`, for example `codex/develop-local-library-migration`.
- Do not run `git merge codex/merge-two-projects`.
- Do not replace `server.js`, `public/index.html`, `desktop/main.js`, or `package.json` wholesale.
- Do not delete `server/`, `tests/`, `desktop/ipc-auth.js`, `desktop/navigation-guard.js`, Folia files, weather files, or release verification scripts.
- Every batch must pass checks before the next batch starts.

## Target File Map

Create or migrate from `codex/merge-two-projects`:

- `desktop/local-assets.js`
- `desktop/local-assets.test.js`
- `public/local-media-assets.js`
- `public/local-media-assets.test.js`
- `public/local-library.js`
- `public/local-library.test.js`
- `public/local-beat-cache.js`
- `public/local-beat-cache.test.js`
- `public/source-navigation.js`
- `public/source-navigation.test.js`
- Optional, only if needed for online entry cleanup: `public/online-entry.js`, `public/online-entry.test.js`

Modify in `develop/mineradio-maintenance`:

- `desktop/main.js`: add local library IPC and local file protocol through the existing safe desktop patterns.
- `desktop/preload.js`: expose local library APIs to the renderer.
- `public/index.html`: load helpers and wire local library UI/playback/beat analysis using small local edits.
- `package.json`: keep existing scripts and add any new test files to the existing check/test flow only if needed.

Must not migrate from `codex/merge-two-projects`:

- The monolithic `server.js` rewrite.
- Deletions of `server/routes/*`, `server/music/*`, `server/security.js`, `server/update.js`, or `server/weather.js`.
- Deletions of `tests/*.test.js`.
- Removal of `npm run check`, `npm run test`, `verify:release`, or dependency overrides from `package.json`.
- Removal of Folia, weather, release ownership, or vendor documentation from `develop`.

## Batch 0: Baseline Lock

- [ ] Create a branch from `develop/mineradio-maintenance`.

Run:

```powershell
git switch develop/mineradio-maintenance
git switch -c codex/develop-local-library-migration
```

- [ ] Record current baseline status.

Run:

```powershell
git status --short --branch
npm run check
npm run test
git diff --check
```

Expected:

- Worktree starts clean.
- `npm run check` passes.
- `npm run test` passes.
- `git diff --check` reports no whitespace errors.

- [ ] Inspect source files from `codex/merge-two-projects` without switching branches.

Run:

```powershell
git show codex/merge-two-projects:desktop/local-assets.js
git show codex/merge-two-projects:public/local-media-assets.js
git show codex/merge-two-projects:public/local-library.js
git show codex/merge-two-projects:public/local-beat-cache.js
```

## Batch 1: Local File Security And Protocol

Purpose: add a safe local file access layer before exposing any local music UI.

- [ ] Add `desktop/local-assets.test.js` from the source branch and adapt imports only if `develop` paths differ.
- [ ] Run the new test and confirm it fails because `desktop/local-assets.js` is missing.

Run:

```powershell
node --test desktop/local-assets.test.js
```

Expected:

- Failure caused by missing `./local-assets`.

- [ ] Add `desktop/local-assets.js`.
- [ ] Preserve these behaviors:
  - Remember authorized music roots.
  - Reject paths outside remembered roots.
  - Scan MP3/FLAC files in deterministic order.
  - Detect adjacent `.lrc` and image assets.
  - Return app-protocol URLs, not `file://`.
  - Read bounded byte ranges for local audio.
  - Read bounded image files as data URLs.

- [ ] Integrate into `desktop/main.js` using the existing `develop` IPC guard style.
- [ ] Register or reuse a safe local protocol such as `mineradio-local://`.
- [ ] Add preload methods in `desktop/preload.js`:
  - `chooseLocalMusicFolder()`
  - `scanLocalMusicFolder(folderPath, options)`
  - `refreshLocalMusicFileEntries(folderPath, snapshotOrFiles)`
  - `readLocalFileRange(filePath, start, end)`
  - `readLocalFileDataUrl(filePath)`

- [ ] Run verification.

Run:

```powershell
node --test desktop/local-assets.test.js
npm run check
npm run test
git diff --check
```

Acceptance:

- Unauthorized sibling paths are rejected.
- Valid local music files resolve only after their root has been remembered.
- Local file proxy URLs do not start with `file:`.
- Existing desktop window, IPC, navigation, and release tests still pass.

Commit:

```powershell
git add desktop/local-assets.js desktop/local-assets.test.js desktop/main.js desktop/preload.js
git commit -m "feat: add safe local music file access"
```

## Batch 2: Local Media Parsing And Library Model

Purpose: migrate pure renderer helpers before touching the main UI.

- [ ] Add `public/local-media-assets.test.js`.
- [ ] Run it and confirm it fails because `public/local-media-assets.js` is missing.

Run:

```powershell
node --test public/local-media-assets.test.js
```

- [ ] Add `public/local-media-assets.js`.
- [ ] Preserve support for:
  - MP3 ID3 title, artist, album.
  - MP3 embedded APIC cover extraction.
  - FLAC Vorbis comments.
  - FLAC embedded lyrics.
  - FLAC embedded picture extraction.
  - Adjacent same-name lyrics and cover assets.

- [ ] Add `public/local-library.test.js`.
- [ ] Run it and confirm it fails because `public/local-library.js` is missing.

Run:

```powershell
node --test public/local-library.test.js
```

- [ ] Add `public/local-library.js`.
- [ ] Preserve this normalized local song shape:

```js
{
  type: 'local',
  source: 'local',
  id: '<stable local key>',
  name: '<track title>',
  artist: '<artist or 本地文件>',
  album: '<album>',
  duration: <seconds>,
  localKey: '<library-derived key>',
  localUrl: '<mineradio-local://...>',
  localFilePath: '<absolute path from desktop scan>',
  localAdjacentLyricFile: '<absolute lrc path or null>',
  localAdjacentCoverFile: '<absolute image path or null>'
}
```

- [ ] Add script tags to `public/index.html` near existing helper scripts:

```html
<script src="local-media-assets.js"></script>
<script src="local-library.js"></script>
```

- [ ] Run verification.

Run:

```powershell
node --test public/local-media-assets.test.js public/local-library.test.js
npm run check
npm run test
git diff --check
```

Acceptance:

- Helper tests pass independently.
- Existing `public/index.html` still parses under `npm run check`.
- No local library UI appears yet unless explicitly wired in Batch 3.

Commit:

```powershell
git add public/local-media-assets.js public/local-media-assets.test.js public/local-library.js public/local-library.test.js public/index.html
git commit -m "feat: add local media and library helpers"
```

## Batch 3: Local Library UI And Playback

Purpose: expose the local library in the existing player without disturbing online playback.

- [ ] Add failing tests around renderer integration where feasible. If the code stays in `public/index.html`, use the existing source-inspection style used by current renderer tests.
- [ ] Add local library state in `public/index.html`:
  - Selected folder path.
  - Last scan snapshot.
  - Current local song list.
  - Import/refresh loading state.
  - Last import error.

- [ ] Add local library UI entry points:
  - Import folder button.
  - Refresh library button.
  - Empty state for no imported folder.
  - Count/status label for imported tracks.

- [ ] Implement import flow:
  - Call `window.desktopWindow.chooseLocalMusicFolder()`.
  - Convert scan result through `MineradioLocalLibrary.buildLocalLibrarySongs`.
  - Persist a lightweight snapshot under `mineradio-local-library-state-v1`.
  - Render local songs through existing queue/search/list UI patterns.

- [ ] Implement refresh flow:
  - Call `window.desktopWindow.refreshLocalMusicFileEntries(folderPath, snapshotOrFiles)`.
  - Compare snapshot changes.
  - Update UI without clearing online queue state.

- [ ] Implement local playback:
  - Local tracks must enter the same queue/playback path as online songs.
  - `audio.src` must use the local proxy URL, not `file://`.
  - Local embedded/adjacent metadata should update title, artist, album, lyrics, and cover after playback starts.
  - Failure to parse local metadata must not fail playback.

- [ ] Run verification.

Run:

```powershell
npm run check
npm run test
git diff --check
```

Manual Electron acceptance:

- Start the app with `npm start`.
- Import a folder containing at least one MP3 and one FLAC.
- Play a local MP3.
- Play a local FLAC.
- Confirm adjacent `.lrc` is loaded when present.
- Confirm adjacent cover or embedded cover is loaded when present.
- Confirm online search and online playback still work.

Commit:

```powershell
git add public/index.html desktop/main.js desktop/preload.js
git commit -m "feat: add local library import and playback"
```

## Batch 4: Local Beat Cache And Unified Beat Analysis

Purpose: make local music use the same MR beat analysis route as online music.

- [ ] Add `public/local-beat-cache.test.js`.
- [ ] Run it and confirm it fails because `public/local-beat-cache.js` is missing.

Run:

```powershell
node --test public/local-beat-cache.test.js
```

- [ ] Add `public/local-beat-cache.js`.
- [ ] Add script tag to `public/index.html`:

```html
<script src="local-beat-cache.js"></script>
```

- [ ] Add local beat cache integration:
  - Generate beat keys from `localKey`.
  - Store MR/DJ entries separately.
  - Prefer the user's last selected local beat mode when available.

- [ ] Change local playback scheduling:
  - Do not open a separate local beat modal by default.
  - After `playAudio()` succeeds, schedule local beat analysis through the existing MR scheduler.
  - If cache exists, reuse it immediately.
  - If analysis fails, show a beat-analysis error only; do not stop audio.

- [ ] Add or migrate renderer source tests for scheduling order:
  - Local queue playback schedules beat analysis only after playback success.
  - Dropped local files schedule beat analysis only after playback success.
  - Local scheduler delegates to the online MR scheduler.

- [ ] Run verification.

Run:

```powershell
node --test public/local-beat-cache.test.js
npm run check
npm run test
git diff --check
```

Manual Electron acceptance:

- Play local track.
- Confirm playback starts before beat analysis.
- Confirm beat analysis cache hit is reused on replay.
- Confirm beat analysis failure does not break local playback.
- Confirm online beat analysis still works.

Commit:

```powershell
git add public/local-beat-cache.js public/local-beat-cache.test.js public/index.html
git commit -m "feat: unify local beat analysis with playback"
```

## Batch 5: Source Navigation And Online Entry Cleanup

Purpose: make online, playlists, and local library coexist clearly.

- [ ] Add `public/source-navigation.test.js`.
- [ ] Run it and confirm it fails because `public/source-navigation.js` is missing.

Run:

```powershell
node --test public/source-navigation.test.js
```

- [ ] Add `public/source-navigation.js`.
- [ ] Add script tag to `public/index.html`:

```html
<script src="source-navigation.js"></script>
```

- [ ] Wire source navigation:
  - Online source when search is active.
  - Playlist source when playlist panel is active.
  - Local source when local library is active or local track is playing.
  - Local badge count from persisted local library snapshot.

- [ ] If online entry behavior is currently inconsistent, add `public/online-entry.js` and `public/online-entry.test.js`.
- [ ] Keep all existing online features from `develop`.
- [ ] Do not hide online entry behind local-only logic.

- [ ] Run verification.

Run:

```powershell
node --test public/source-navigation.test.js
npm run check
npm run test
git diff --check
```

Manual Electron acceptance:

- Online search entry is visible and usable.
- Playlist entry is visible and usable.
- Local library entry is visible after import.
- Current source indicator follows online/local playback.

Commit:

```powershell
git add public/source-navigation.js public/source-navigation.test.js public/index.html
git commit -m "feat: add local source navigation"
```

## Batch 6: Desktop Experience Enhancements

Purpose: selectively migrate useful desktop-shell features without weakening `develop` security.

- [ ] Review these `codex/merge-two-projects` areas before editing:
  - Tray menu and close-to-tray settings.
  - Startup setting.
  - Desktop lyrics state signature/deduplication.
  - UI state backup/restore for online-safe keys.

- [ ] Add or reuse focused tests:
  - Desktop shell settings normalization.
  - Persistent UI state allowlist.
  - Desktop lyrics payload signature stability.

- [ ] Integrate into `desktop/main.js` using existing `develop` IPC guard patterns.
- [ ] Integrate into `desktop/preload.js` only through explicit, narrow APIs.
- [ ] Keep Folia stage, wallpaper, and desktop lyrics payloads compatible.
- [ ] Do not persist local-only state in online-safe UI backup unless intentionally allowlisted.

- [ ] Run verification.

Run:

```powershell
npm run check
npm run test
git diff --check
```

Manual Electron acceptance:

- Close-to-tray works.
- Restore from tray works.
- Startup toggle works on Windows.
- Desktop lyrics still update.
- Wallpaper mode still updates.
- Folia stage still receives expected state.

Commit:

```powershell
git add desktop/main.js desktop/preload.js public/index.html tests
git commit -m "feat: integrate desktop shell local library enhancements"
```

## Final Verification

- [ ] Run the complete local verification suite.

Run:

```powershell
npm run check
npm run test
npm run verify:release
git diff --check
```

- [ ] Run full manual smoke test in Electron:
  - App launches.
  - Online search works.
  - Online playback works.
  - QQ/NetEase login windows still open safely.
  - Imported local MP3 plays.
  - Imported local FLAC plays.
  - Local lyrics and cover load.
  - Local beat analysis runs after playback starts.
  - Replaying the same local song reuses beat cache.
  - Playlists still open.
  - 3D playlist shelf still works.
  - Folia stage still opens.
  - Weather panel still works.
  - Desktop lyrics still works.
  - Wallpaper mode still works.
  - Build verification still passes.

- [ ] Confirm no forbidden regressions.

Run:

```powershell
git diff --name-status develop/mineradio-maintenance..HEAD
```

Expected:

- No deletion of `server/`, `tests/`, Folia modules, weather modules, or release verification scripts.
- `package.json` still contains `check`, `test`, and `verify:release`.
- New local library files are present.

## Risk Controls

- If `public/index.html` conflict becomes too large, stop and extract more helper logic instead of expanding inline edits.
- If local playback fails with `NotSupportedError`, inspect the protocol URL first; do not revert to `file://`.
- If beat analysis slows playback start, ensure analysis is scheduled only after successful `audio.play()`.
- If tests fail in Folia/weather/release areas, treat it as a regression from the migration, not as unrelated noise.
- If a `codex` snippet deletes or bypasses `develop` security helpers, reject that snippet and port only the feature logic.

## Recommended Commit Order

1. `feat: add safe local music file access`
2. `feat: add local media and library helpers`
3. `feat: add local library import and playback`
4. `feat: unify local beat analysis with playback`
5. `feat: add local source navigation`
6. `feat: integrate desktop shell local library enhancements`

## Success Criteria

- `develop/mineradio-maintenance` remains the architectural base.
- Local library import and playback work for MP3 and FLAC.
- Local lyrics, local covers, and local beat analysis work without breaking online playback.
- Online source, playlist source, and local source coexist in the UI.
- Existing Folia, weather, desktop lyrics, wallpaper, security, tests, and release verification remain intact.
- The final branch is mergeable without replacing the maintainable `develop` structure.
