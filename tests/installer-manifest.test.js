const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createInstallerManifest,
  generateInstallerManifest,
  renderNsisDeleteInclude,
  sha256File,
} = require('../build/generate-installer-manifest.js');

const tempDirectories = new Set();

function tempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

test.after(() => {
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureTree() {
  const root = tempDir('mineradio-installer-manifest-');
  fs.mkdirSync(path.join(root, 'resources', 'app', 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Mineradio.exe'), 'exe-fixture');
  fs.writeFileSync(path.join(root, 'resources', 'app', 'server.js'), 'server-fixture');
  fs.writeFileSync(path.join(root, 'resources', 'app', 'server', 'route.js'), 'route-fixture');
  return root;
}

function options(appOutDir) {
  return {
    appOutDir,
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    version: '1.1.0',
    channel: 'stable',
    commit: 'd61cc2e',
    buildId: 'fixture-build',
  };
}

test('generates a complete deterministic manifest from the packaged app directory', () => {
  const appOutDir = fixtureTree();
  const first = createInstallerManifest(options(appOutDir));
  const second = createInstallerManifest(options(appOutDir));

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.productName, 'Mineradio');
  assert.equal(first.appId, 'com.mineradio.desktop');
  assert.equal(first.channel, 'stable');
  assert.match(first.manifestSha256, /^[A-F0-9]{64}$/);
  assert.deepEqual(
    first.files.map((entry) => entry.path),
    [
      '.mineradio-install-owner.json',
      'Mineradio.exe',
      'resources\\app\\server.js',
      'resources\\app\\server\\route.js',
      'Uninstall Mineradio.exe',
      'uninstallerIcon.ico',
    ],
  );
  assert.deepEqual(first.directories, [
    'resources',
    'resources\\app',
    'resources\\app\\server',
  ]);
  const packaged = first.files.filter((entry) => entry.source === 'package');
  const generated = first.files.filter((entry) => entry.source === 'installer');
  assert.ok(packaged.every((entry) => Number.isInteger(entry.size) && entry.size >= 0));
  assert.ok(packaged.every((entry) => /^[A-F0-9]{64}$/.test(entry.sha256)));
  assert.ok(generated.every((entry) => entry.size === null && entry.sha256 === null));
});

test('renders allowlisted NSIS cleanup without recursive installation-directory removal', () => {
  const manifest = createInstallerManifest(options(fixtureTree()));
  const include = renderNsisDeleteInclude(manifest);

  assert.match(include, /Delete "\$INSTDIR\\Mineradio\.exe"/);
  assert.match(include, /Delete "\$INSTDIR\\resources\\app\\server\\route\.js"/);
  assert.match(include, /RMDir "\$INSTDIR\\resources\\app\\server"/);
  assert.doesNotMatch(include, /RMDir\s+\/r/i);
  assert.doesNotMatch(include, /RMDir\s+"\$INSTDIR"\s*$/im);
  assert.ok(
    include.indexOf('resources\\app\\server"') < include.indexOf('resources\\app"'),
    'nested directories must be removed before their parents',
  );
  assert.ok(
    include.lastIndexOf('RMDir ') < include.lastIndexOf('.mineradio-install-owner.json'),
    'the ownership marker must be the final managed entry deleted',
  );
  assert.match(
    include,
    /Delete "\$INSTDIR\\\.mineradio-install-owner\.json"\n!macroend\n$/,
  );
});

test('writes JSON and NSIS output files from one manifest snapshot', () => {
  const appOutDir = fixtureTree();
  const outputDir = tempDir('mineradio-installer-output-');
  const result = generateInstallerManifest({
    ...options(appOutDir),
    jsonPath: path.join(outputDir, 'installer-manifest.json'),
    nsisPath: path.join(outputDir, 'installer-files.nsh'),
  });

  const writtenManifest = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
  const writtenInclude = fs.readFileSync(result.nsisPath, 'utf8');
  assert.deepEqual(writtenManifest, result.manifest);
  assert.equal(writtenInclude, renderNsisDeleteInclude(result.manifest));
});

test('hashes packaged files with a bounded reusable read buffer', () => {
  const root = tempDir('mineradio-installer-hash-');
  const filePath = path.join(root, 'large.bin');
  const contents = Buffer.alloc(1024 * 1024 + 17, 0x5A);
  fs.writeFileSync(filePath, contents);
  let largestRead = 0;
  const fsApi = {
    openSync: fs.openSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    readSync(fd, buffer, offset, length, position) {
      largestRead = Math.max(largestRead, length);
      return fs.readSync(fd, buffer, offset, length, position);
    },
  };

  assert.equal(
    sha256File(filePath, { fsApi, bufferSize: 64 * 1024 }),
    crypto.createHash('sha256').update(contents).digest('hex').toUpperCase(),
  );
  assert.ok(largestRead <= 64 * 1024);
});

test('rejects traversal and unsafe NSIS path syntax in generated entries', () => {
  const validMarker = {
    path: '.mineradio-install-owner.json',
    size: null,
    sha256: null,
    source: 'installer',
  };
  assert.throws(
    () => renderNsisDeleteInclude({
      files: [
        validMarker,
        { path: '..\\sentinel.txt', size: 1, sha256: 'A'.repeat(64) },
      ],
      directories: [],
    }),
    /relative install entry/i,
  );
  assert.throws(
    () => renderNsisDeleteInclude({
      files: [
        validMarker,
        { path: 'bad$\\entry.txt', size: 1, sha256: 'A'.repeat(64) },
      ],
      directories: [],
    }),
    /unsupported nsis/i,
  );
  for (const wildcard of ['*.keep', 'unknown?.txt']) {
    assert.throws(
      () => renderNsisDeleteInclude({
        files: [
          validMarker,
          { path: wildcard, size: 1, sha256: 'A'.repeat(64) },
        ],
        directories: [],
      }),
      /windows path|unsupported nsis/i,
    );
  }
  for (const alias of [
    '.mineradio-install-owner.json.',
    'CON',
    'dir\\AUX.txt',
    'file.txt:stream',
  ]) {
    assert.throws(
      () => renderNsisDeleteInclude({
        files: [
          validMarker,
          { path: alias, size: 1, sha256: 'A'.repeat(64) },
        ],
        directories: [],
      }),
      /windows path/i,
      alias,
    );
  }
});

test('requires an absolute traversal-free packaged app root', () => {
  const appOutDir = fixtureTree();
  const relativeRoot = path.relative(process.cwd(), appOutDir);
  const parent = path.dirname(appOutDir);
  const traversalRoot = `${parent}${path.sep}unused${path.sep}..${path.sep}${path.basename(appOutDir)}`;

  assert.throws(
    () => createInstallerManifest(options(relativeRoot)),
    /absolute/i,
  );
  assert.throws(
    () => createInstallerManifest(options(traversalRoot)),
    /traversal/i,
  );
  if (process.platform === 'win32') {
    const rootRelative = appOutDir.slice(path.parse(appOutDir).root.length - 1);
    assert.match(rootRelative, /^\\/);
    assert.throws(
      () => createInstallerManifest(options(rootRelative)),
      /fully qualified|absolute/i,
    );
  }
});

test('rejects unsafe metadata before rendering NSIS defines', () => {
  const manifest = createInstallerManifest(options(fixtureTree()));
  for (const [field, value] of [
    ['manifestSha256', 'not-a-digest'],
    ['channel', 'stable"\n!error injected'],
    ['version', '1.1.0"\n!error injected'],
  ]) {
    assert.throws(
      () => renderNsisDeleteInclude({ ...manifest, [field]: value }),
      /nsis|sha256/i,
      field,
    );
  }
});

test('rejects a packaged app root that is itself a symlink or junction', (t) => {
  const target = fixtureTree();
  const parent = tempDir('mineradio-installer-link-');
  const linkedRoot = path.join(parent, 'linked-app');
  try {
    fs.symlinkSync(target, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }

  assert.throws(
    () => createInstallerManifest(options(linkedRoot)),
    /reparse point/i,
  );
});

test('always emits exactly one ownership marker and rejects malformed rendered manifests', () => {
  const appOutDir = fixtureTree();
  const manifest = createInstallerManifest({
    ...options(appOutDir),
    installerFiles: [],
  });
  assert.equal(
    manifest.files.filter(
      (entry) => entry.path.toLowerCase() === '.mineradio-install-owner.json',
    ).length,
    1,
  );

  assert.throws(
    () => renderNsisDeleteInclude({ ...manifest, files: [] }),
    /ownership marker/i,
  );
  assert.throws(
    () => renderNsisDeleteInclude({
      ...manifest,
      files: [
        ...manifest.files,
        {
          path: '.MINERADIO-INSTALL-OWNER.JSON',
          size: null,
          sha256: null,
          source: 'installer',
        },
      ],
    }),
    /ownership marker/i,
  );
});

test('adds parent directories for nested installer-generated files', () => {
  const manifest = createInstallerManifest({
    ...options(fixtureTree()),
    installerFiles: ['generated\\nested\\payload.dat'],
  });

  assert.ok(manifest.files.some(
    (entry) => entry.path === 'generated\\nested\\payload.dat',
  ));
  assert.ok(manifest.directories.includes('generated'));
  assert.ok(manifest.directories.includes('generated\\nested'));
});
