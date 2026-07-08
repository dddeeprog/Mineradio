const ONLINE_SAFE_UI_STATE_KEYS = new Set([
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
]);

function normalizeDesktopShellSettings(settings) {
  return {
    closeToTray: typeof settings?.closeToTray === 'boolean' ? settings.closeToTray : true,
  };
}

function mergeDesktopShellSettings(current, patch) {
  const next = normalizeDesktopShellSettings(current);
  if (typeof patch?.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
  return next;
}

function filterPersistentUiStatePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, value] of Object.entries(patch)) {
    if (!ONLINE_SAFE_UI_STATE_KEYS.has(key)) continue;
    out[key] = value == null ? null : String(value);
  }
  return out;
}

function normalizePersistentUiState(state) {
  const values = {};
  const rawValues = state && typeof state.values === 'object' ? state.values : {};
  for (const [key, value] of Object.entries(rawValues)) {
    if (!ONLINE_SAFE_UI_STATE_KEYS.has(key)) continue;
    if (value != null) values[key] = String(value);
  }
  return {
    schema: 1,
    values,
    updatedAt: Number(state?.updatedAt) || 0,
  };
}

module.exports = {
  ONLINE_SAFE_UI_STATE_KEYS,
  filterPersistentUiStatePatch,
  normalizeDesktopShellSettings,
  mergeDesktopShellSettings,
  normalizePersistentUiState,
};
