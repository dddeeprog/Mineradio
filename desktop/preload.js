const { contextBridge, ipcRenderer } = require('electron');

const PERSISTENT_UI_STATE_KEYS = [
  'apex-player-volume',
  'mineradio-custom-covers',
  'mineradio-custom-lyrics-v1',
  'mineradio-custom-lyric-prefs-v1',
  'mineradio-lyric-layout-v1',
  'mineradio-playback-quality-v1',
  'mineradio-upload-tip-seen',
  'mineradio-diy-player-mode-v1',
  'mineradio-playlist-panel-pinned-v1',
  'mineradio-user-capsule-auto-hide-v1',
  'mineradio-fx-fab-auto-hide-v1',
  'mineradio-controls-auto-hide-v1',
  'mineradio-free-camera-v1',
  'mineradio-hotkey-settings-v1',
  'mineradio-visual-guide-seen-v2',
];

function restorePersistentUiState() {
  try {
    const values = ipcRenderer.sendSync('mineradio-ui-state-read-sync') || {};
    PERSISTENT_UI_STATE_KEYS.forEach((key) => {
      if (typeof values[key] !== 'string') return;
      if (window.localStorage.getItem(key) != null) return;
      window.localStorage.setItem(key, values[key]);
    });
  } catch (_e) {}
}

restorePersistentUiState();

contextBridge.exposeInMainWorld('eislandBridge', {
  publishState: (snapshot) => ipcRenderer.send('mineradio-eisland-bridge-state', snapshot || {}),
  publishHeartbeat: (snapshot) => ipcRenderer.send('mineradio-eisland-bridge-heartbeat', snapshot || {}),
  onCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, command) => callback(command || {});
    ipcRenderer.on('mineradio-eisland-bridge-command', listener);
    return () => ipcRenderer.removeListener('mineradio-eisland-bridge-command', listener);
  },
  completeCommand: (receipt) => ipcRenderer.send(
    'mineradio-eisland-bridge-command-complete',
    receipt || {},
  ),
});

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('desktop-window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop-window-toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop-window-toggle-fullscreen'),
  exitFullscreenWindowed: () => ipcRenderer.invoke('desktop-window-exit-fullscreen-windowed'),
  getState: () => ipcRenderer.invoke('desktop-window-get-state'),
  close: () => ipcRenderer.invoke('desktop-window-close'),
  openNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-open-login'),
  clearNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-clear-login'),
  openQQMusicLogin: () => ipcRenderer.invoke('qq-music-open-login'),
  clearQQMusicLogin: () => ipcRenderer.invoke('qq-music-clear-login'),
  openPlatformMusicLogin: (provider, options) => ipcRenderer.invoke('platform-music-open-login', provider, options || {}),
  clearPlatformMusicLogin: (provider) => ipcRenderer.invoke('platform-music-clear-login', provider),
  setPlatformCredential: (provider, credential) => ipcRenderer.invoke('mineradio-credential-set', provider, credential),
  clearPlatformCredential: (provider) => ipcRenderer.invoke('mineradio-credential-clear', provider),
  getPlatformCredentialStatus: () => ipcRenderer.invoke('mineradio-credential-status'),
  openUpdateInstaller: (filePath) => ipcRenderer.invoke('mineradio-open-update-installer', filePath),
  restartApp: () => ipcRenderer.invoke('mineradio-restart-app'),
  configureGlobalHotkeys: (bindings) => ipcRenderer.invoke('mineradio-hotkeys-configure-global', bindings || []),
  getTraySettings: () => ipcRenderer.invoke('mineradio-tray-get-settings'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('mineradio-tray-set-close-to-tray', !!enabled),
  setStartupEnabled: (enabled) => ipcRenderer.invoke('mineradio-startup-set-enabled', !!enabled),
  backupUiState: (patch) => ipcRenderer.invoke('mineradio-ui-state-write', patch || {}),
  exportJsonFile: (payload) => ipcRenderer.invoke('mineradio-export-json-file', payload || {}),
  importJsonFile: () => ipcRenderer.invoke('mineradio-import-json-file'),
  chooseLocalMusicFolder: () => ipcRenderer.invoke('mineradio-local-music-choose-folder'),
  scanLocalMusicFolder: (folderPath, options) => ipcRenderer.invoke('mineradio-local-music-scan-folder', folderPath, options || {}),
  refreshLocalMusicFileEntries: (folderPath, snapshotOrFiles) => ipcRenderer.invoke('mineradio-local-music-refresh-entries', folderPath, snapshotOrFiles || {}),
  readLocalFileRange: (filePath, start, end) => ipcRenderer.invoke('mineradio-local-file-read-range', filePath, start, end),
  readLocalFileDataUrl: (filePath) => ipcRenderer.invoke('mineradio-local-file-read-data-url', filePath),
  onGlobalHotkey: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-global-hotkey', listener);
    return () => ipcRenderer.removeListener('mineradio-global-hotkey', listener);
  },
  setDesktopLyricsEnabled: (enabled, payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-enabled', !!enabled, payload || {}),
  updateDesktopLyrics: (payload) => ipcRenderer.invoke('mineradio-desktop-lyrics-update', payload || {}),
  onDesktopLyricsLockState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-lock-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-lock-state', listener);
  },
  onDesktopLyricsEnabledState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-desktop-lyrics-enabled-state', listener);
    return () => ipcRenderer.removeListener('mineradio-desktop-lyrics-enabled-state', listener);
  },
  setWallpaperMode: (enabled, payload) => ipcRenderer.invoke('mineradio-wallpaper-set-enabled', !!enabled, payload || {}),
  updateWallpaperMode: (payload) => ipcRenderer.invoke('mineradio-wallpaper-update', payload || {}),
  getWallpaperStatus: () => ipcRenderer.invoke('mineradio-wallpaper-get-status'),
  listWallpaperEngineProjects: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-list', payload || {}),
  chooseWallpaperEngineDirectory: () => ipcRenderer.invoke('mineradio-wallpaper-engine-choose-directory'),
  chooseWallpaperEngineProjectFile: () => ipcRenderer.invoke('mineradio-wallpaper-engine-choose-project-file'),
  removeWallpaperEngineDirectory: (rootId) => ipcRenderer.invoke('mineradio-wallpaper-engine-remove-directory', rootId),
  getWallpaperEngineRuntimeStatus: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-runtime-status', payload || {}),
  startWallpaperEngineScene: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-start-scene', payload || {}),
  parkWallpaperEngineScene: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-park-scene', payload || {}),
  stopWallpaperEngineScene: (payload) => ipcRenderer.invoke('mineradio-wallpaper-engine-stop-scene', payload || {}),
  getSystemResourceState: () => ipcRenderer.invoke('mineradio-system-resource-get-state'),
  onWallpaperRuntimeState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-wallpaper-runtime-state', listener);
    return () => ipcRenderer.removeListener('mineradio-wallpaper-runtime-state', listener);
  },
  onSystemResourceState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('mineradio-system-resource-state', listener);
    return () => ipcRenderer.removeListener('mineradio-system-resource-state', listener);
  },
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-window-state', listener);
    return () => ipcRenderer.removeListener('desktop-window-state', listener);
  },
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
});
