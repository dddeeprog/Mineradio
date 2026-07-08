const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

test('desktop shell helpers and checks are wired', () => {
  const main = readProjectFile('desktop', 'main.js');
  const preload = readProjectFile('desktop', 'preload.js');
  const index = readProjectFile('public', 'index.html');
  const hotkeys = readProjectFile('public', 'hotkeys-ui.js');
  const packageJson = readProjectFile('package.json');

  assert.match(main, /require\('\.\/shell-state'\)/);
  assert.match(main, /require\('\.\/overlay-state'\)/);
  assert.match(packageJson, /node --check desktop\/shell-state\.js/);
  assert.match(packageJson, /node --check desktop\/overlay-state\.js/);

  assert.match(preload, /restorePersistentUiState\(\)/);
  assert.match(preload, /getTraySettings:\s*\(\) => ipcRenderer\.invoke\('mineradio-tray-get-settings'\)/);
  assert.match(preload, /setCloseToTray:\s*\(enabled\) => ipcRenderer\.invoke\('mineradio-tray-set-close-to-tray'/);
  assert.match(preload, /setStartupEnabled:\s*\(enabled\) => ipcRenderer\.invoke\('mineradio-startup-set-enabled'/);
  assert.match(preload, /backupUiState:\s*\(patch\) => ipcRenderer\.invoke\('mineradio-ui-state-write'/);

  const persistentStart = index.indexOf('var PERSISTENT_UI_STATE_KEYS = [');
  const persistentBlock = index.slice(persistentStart, index.indexOf('];', persistentStart) + 2);
  assert.notEqual(persistentStart, -1);
  assert.doesNotMatch(persistentBlock, /LOCAL_BEATMAP_STORE_KEY/);
  assert.match(index, /desktop-close-to-tray-btn/);
  assert.match(index, /desktop-startup-btn/);
  assert.match(index, /bindDesktopShellSettings\(\)/);
  assert.match(hotkeys, /window\.MineradioBackupUiState/);
});

test('desktop shell ipc handlers use guarded main-window channels', () => {
  const main = readProjectFile('desktop', 'main.js');
  const ipcAuth = readProjectFile('desktop', 'ipc-auth.js');

  for (const channel of [
    'mineradio-tray-get-settings',
    'mineradio-tray-set-close-to-tray',
    'mineradio-startup-set-enabled',
    'mineradio-ui-state-write',
  ]) {
    assert.match(main, new RegExp(`handleIpc\\('${channel}'`));
    assert.match(ipcAuth, new RegExp(`'${channel}'`));
    assert.doesNotMatch(main, new RegExp(`ipcMain\\.handle\\('${channel}'`));
  }

  assert.match(main, /ipcMain\.on\('mineradio-ui-state-read-sync'/);
  assert.match(main, /assertAllowedIpcSender\(event, 'mineradio-ui-state-read-sync', mainServerPort\)/);
  assert.match(ipcAuth, /'mineradio-ui-state-read-sync'/);
});

test('desktop lyrics update path is deduplicated by stable signatures', () => {
  const main = readProjectFile('desktop', 'main.js');

  assert.match(main, /desktopLyricsStateSignature\(desktopLyricsState\)/);
  assert.match(main, /signature === desktopLyricsLastStateSignature/);
  assert.match(main, /normalizeDesktopLyricsOpacity\(value\)/);
});
