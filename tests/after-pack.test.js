const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const afterPack = require('../build/after-pack.js');

const COMMIT = 'd61cc2e0123456789abcdef0123456789abcdef0';
const SOURCE_TREE = 'a61cc2e0123456789abcdef0123456789abcdef0';
const BUILD_FILES = [
  'public/**/*',
  '!public/index.*.html',
  'public/index.html',
];

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

test('after-pack resolves build.files from packager config or package.json', () => {
  const projectDir = makeTempProject();
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    build: { files: BUILD_FILES },
  }));

  assert.deepEqual(afterPack.resolvePackagedFileRules({
    packager: {
      projectDir,
      config: { files: ['desktop/**/*'] },
    },
  }), ['desktop/**/*']);
  assert.deepEqual(afterPack.resolvePackagedFileRules({
    packager: {
      projectDir,
      config: {},
    },
  }), BUILD_FILES);
});

test('after-pack generates installer manifests only after executable resources are final', async () => {
  const projectDir = makeTempProject();
  const appOutDir = path.join(projectDir, 'dist', 'win-unpacked');
  const buildResourcesDir = path.join(projectDir, 'build');
  const rceditPath = path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  touch(rceditPath);
  touch(path.join(appOutDir, 'Mineradio.exe'));
  touch(path.join(buildResourcesDir, 'icon.ico'));
  const events = [];

  const result = await afterPack({
    electronPlatformName: 'win32',
    appOutDir,
    packager: {
      projectDir,
      config: { files: [{ filter: BUILD_FILES }] },
      appInfo: {
        id: 'com.mineradio.desktop',
        productFilename: 'Mineradio',
        productName: 'Mineradio',
        version: '1.1.0',
      },
      info: { buildResourcesDir },
    },
  }, {
    env: {
      MINERADIO_BUILD_COMMIT: COMMIT,
      MINERADIO_BUILD_ID: 'fixture-build',
      SOURCE_DATE_EPOCH: '1785283200',
    },
    execFileSync(executable) {
      assert.equal(executable, rceditPath);
      events.push('rcedit');
    },
    gitRunner(command, args) {
      assert.equal(command, 'git');
      if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return `${COMMIT}\n`;
      if (args.join(' ') === 'rev-parse --verify HEAD^{tree}') return `${SOURCE_TREE}\n`;
      if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') return '';
      if (args[0] === 'ls-files') return '';
      throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
    },
    generateInstallerManifest(options) {
      events.push('manifest');
      assert.equal(options.appOutDir, appOutDir);
      assert.equal(options.productName, 'Mineradio');
      assert.equal(options.appId, 'com.mineradio.desktop');
      assert.equal(options.version, '1.1.0');
      assert.equal(options.channel, 'stable');
      assert.equal(options.commit, COMMIT);
      assert.equal(options.buildId, 'fixture-build');
      assert.equal(options.createdAt, '2026-07-29T00:00:00.000Z');
      assert.equal(
        options.jsonPath,
        path.join(buildResourcesDir, '.generated', 'installer-manifest.json'),
      );
      assert.equal(
        options.nsisPath,
        path.join(buildResourcesDir, '.generated', 'installer-files.nsh'),
      );
      return { manifest: { manifestSha256: 'A'.repeat(64) } };
    },
  });

  assert.deepEqual(events, ['rcedit', 'manifest']);
  assert.equal(result.manifest.manifestSha256, 'A'.repeat(64));
});

test('after-pack resolves stable build identity without accepting unsafe metadata', () => {
  assert.deepEqual(afterPack.resolveInstallerBuildIdentity({
    version: '1.1.0',
    projectDir: 'C:\\repo',
    buildFiles: BUILD_FILES,
    env: {
      MINERADIO_BUILD_COMMIT: COMMIT,
      MINERADIO_BUILD_ID: 'ci-100',
      SOURCE_DATE_EPOCH: '1785283200',
    },
    gitRunner(command, args) {
      if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return `${COMMIT}\n`;
      if (args.join(' ') === 'rev-parse --verify HEAD^{tree}') return `${SOURCE_TREE}\n`;
      if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') return '';
      if (args[0] === 'ls-files') return '';
      throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
    },
  }), {
    channel: 'stable',
    commit: COMMIT,
    sourceTree: SOURCE_TREE,
    buildId: 'ci-100',
    createdAt: '2026-07-29T00:00:00.000Z',
  });

  assert.throws(
    () => afterPack.resolveInstallerBuildIdentity({
      version: '1.1.0',
      projectDir: 'C:\\repo',
      buildFiles: BUILD_FILES,
      env: { MINERADIO_BUILD_COMMIT: 'bad"\ncommit' },
      gitRunner(command, args) {
        if (args.includes('HEAD^{commit}')) return `${COMMIT}\n`;
        if (args.includes('HEAD^{tree}')) return `${SOURCE_TREE}\n`;
        return '';
      },
    }),
    /build commit/i,
  );
});
