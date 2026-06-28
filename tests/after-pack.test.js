const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const afterPack = require('../build/after-pack.js');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-after-pack-'));
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

test('after-pack resolves the project-local rcedit executable', () => {
  const projectDir = makeTempProject();
  const expectedPath = path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  touch(expectedPath);

  assert.equal(afterPack.resolveRceditExecutable(projectDir), expectedPath);
});

test('after-pack fails closed when project-local rcedit is missing', () => {
  const projectDir = makeTempProject();
  const fakeLocalAppData = path.join(projectDir, 'local-app-data');
  touch(path.join(fakeLocalAppData, 'electron-builder', 'Cache', 'winCodeSign', 'latest', 'rcedit-x64.exe'));

  assert.throws(
    () => afterPack.resolveRceditExecutable(projectDir, { localAppData: fakeLocalAppData }),
    /project-local rcedit executable/
  );
});

test('after-pack rejects a directory masquerading as rcedit', () => {
  const projectDir = makeTempProject();
  fs.mkdirSync(path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'), { recursive: true });

  assert.throws(
    () => afterPack.resolveRceditExecutable(projectDir),
    /project-local rcedit executable/
  );
});

test('after-pack builds deterministic rcedit resource arguments', () => {
  const exePath = 'C:\\app\\Mineradio.exe';
  const iconPath = 'C:\\repo\\build\\icon.ico';

  assert.deepEqual(afterPack.buildRceditArgs({
    exePath,
    iconPath,
    appName: 'Mineradio',
    version: '1.1.0'
  }), [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'FileDescription', 'Mineradio',
    '--set-version-string', 'ProductName', 'Mineradio',
    '--set-version-string', 'CompanyName', 'Mineradio',
    '--set-version-string', 'OriginalFilename', 'Mineradio.exe',
    '--set-file-version', '1.1.0',
    '--set-product-version', '1.1.0'
  ]);
});
