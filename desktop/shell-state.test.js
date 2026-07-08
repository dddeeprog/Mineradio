const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ONLINE_SAFE_UI_STATE_KEYS,
  filterPersistentUiStatePatch,
  normalizeDesktopShellSettings,
  mergeDesktopShellSettings,
  normalizePersistentUiState,
} = require('./shell-state');

test('normalizeDesktopShellSettings defaults close-to-tray on', () => {
  assert.deepEqual(normalizeDesktopShellSettings({}), { closeToTray: true });
});

test('mergeDesktopShellSettings accepts only boolean closeToTray', () => {
  assert.deepEqual(
    mergeDesktopShellSettings({ closeToTray: true }, { closeToTray: false, extra: true }),
    { closeToTray: false },
  );
  assert.deepEqual(
    mergeDesktopShellSettings({ closeToTray: false }, { closeToTray: 'yes' }),
    { closeToTray: false },
  );
});

test('filterPersistentUiStatePatch keeps online-safe keys', () => {
  const patch = filterPersistentUiStatePatch({
    'apex-player-volume': '0.42',
    'mineradio-hotkey-settings-v1': '{"playPause":"Space"}',
  });
  assert.deepEqual(patch, {
    'apex-player-volume': '0.42',
    'mineradio-hotkey-settings-v1': '{"playPause":"Space"}',
  });
});

test('filterPersistentUiStatePatch excludes local-library-only keys', () => {
  const patch = filterPersistentUiStatePatch({
    'mineradio-local-library-state-v1': '{"folderPath":"D:/Music"}',
    'mineradio-playback-session-v1': '{"local":true}',
    'mineradio-local-beatmaps-v1': '{"D:/Music/a.mp3":{}}',
    'mineradio-local-beatmap-prefs-v1': '{"D:/Music/a.mp3":"mr"}',
    'mineradio-diy-player-mode-v1': '1',
  });
  assert.deepEqual(patch, { 'mineradio-diy-player-mode-v1': '1' });
});

test('normalizePersistentUiState drops non-allowlisted stored values', () => {
  const state = normalizePersistentUiState({
    schema: 1,
    values: {
      'mineradio-free-camera-v1': '{"x":1}',
      unknown: 'bad',
    },
    updatedAt: 123,
  });
  assert.equal(state.schema, 1);
  assert.equal(state.updatedAt, 123);
  assert.deepEqual(state.values, { 'mineradio-free-camera-v1': '{"x":1}' });
});

test('ONLINE_SAFE_UI_STATE_KEYS documents excluded local state keys', () => {
  assert.equal(ONLINE_SAFE_UI_STATE_KEYS.has('mineradio-local-library-state-v1'), false);
  assert.equal(ONLINE_SAFE_UI_STATE_KEYS.has('mineradio-playback-session-v1'), false);
  assert.equal(ONLINE_SAFE_UI_STATE_KEYS.has('mineradio-local-beatmaps-v1'), false);
  assert.equal(ONLINE_SAFE_UI_STATE_KEYS.has('mineradio-local-beatmap-prefs-v1'), false);
});
