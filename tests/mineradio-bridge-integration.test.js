const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

test('primary Electron wiring owns exactly one bridge lifecycle', () => {
  const main = readProjectFile('desktop', 'main.js');
  const lifecycle = readProjectFile('desktop', 'eisland-bridge-lifecycle.js');

  assert.match(main, /createEislandBridgeLifecycle/);
  assert.match(main, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(main, /if \(!gotSingleInstanceLock\) \{[\s\S]*?app\.quit\(\);[\s\S]*?\} else \{/);
  assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?createEislandBridgeLifecycle\([\s\S]*?\.start\(\{ createWindow \}\)/);
  assert.match(lifecycle, /LISTEN_ATTEMPTS\s*=\s*3/);
  assert.match(lifecycle, /LISTEN_RETRY_DELAY_MS\s*=\s*100/);
  assert.match(lifecycle, /SHUTDOWN_TIMEOUT_MS\s*=\s*1_500/);
});

test('bridge IPC stays guarded and second instance only focuses', () => {
  const main = readProjectFile('desktop', 'main.js');
  const ipcAuth = readProjectFile('desktop', 'ipc-auth.js');
  const secondInstanceStart = main.indexOf("app.on('second-instance'");
  const secondInstanceEnd = main.indexOf("app.whenReady()", secondInstanceStart);
  const secondInstanceBlock = main.slice(secondInstanceStart, secondInstanceEnd);

  for (const channel of [
    'mineradio-eisland-bridge-state',
    'mineradio-eisland-bridge-heartbeat',
    'mineradio-eisland-bridge-command-complete',
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.on\\('${channel}'`));
    assert.match(main, new RegExp(`assertAllowedIpcSender\\(event, '${channel}', mainServerPort\\)`));
    assert.match(ipcAuth, new RegExp(`'${channel}'`));
  }
  assert.match(secondInstanceBlock, /focusMainWindow\(\)/);
  assert.doesNotMatch(secondInstanceBlock, /createWindow\(/);
});

test('window startup stops promptly after quit begins', () => {
  const main = readProjectFile('desktop', 'main.js');

  assert.match(main, /const port = await findOpenPort\(3000\);\s*if \(appQuitting\) return null;/);
  assert.match(main, /await waitForServer\(localServer\);\s*if \(appQuitting\) return null;/);
  assert.match(main, /mainWindow\.once\('ready-to-show', \(\) => \{\s*if \(appQuitting \|\| !mainWindow \|\| mainWindow\.isDestroyed\(\)\) return;/);
  assert.match(main, /await mainWindow\.loadURL\(`http:\/\/127\.0\.0\.1:\$\{port\}`\);\s*if \(appQuitting\) \{/);
});
