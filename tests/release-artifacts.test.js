const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Platform } = require('electron-builder');

const artifactVerifier = require('../build/verify-release-artifacts.js');
const sourceIdentity = require('../build/source-identity.js');
const windowsTest = process.platform === 'win32' ? test : test.skip;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-artifacts-'));
}

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const SOURCE_TREE = '89abcdef0123456789abcdef0123456789abcdef';
const TRUSTED_THUMBPRINT = 'A'.repeat(40);
const CREATED_AT = '2026-07-29T08:00:00.000Z';
const GENERATED_AT = '2026-07-29T08:05:00.000Z';
const CANONICAL_OWNER = 'English-worse';
const CANONICAL_REPO = 'Mineradio';
const MATERIALS = [
  ['LICENSE', 'resources/app/LICENSE'],
  ['NOTICE.md', 'resources/app/NOTICE.md'],
  ['THIRD_PARTY_NOTICES.md', 'resources/app/THIRD_PARTY_NOTICES.md'],
  ['docs/VENDOR_MANIFEST.md', 'resources/app/docs/VENDOR_MANIFEST.md'],
  ['third_party/folia-major/LICENSE', 'resources/app/third_party/folia-major/LICENSE'],
  ['third_party/folia-major/README.md', 'resources/app/third_party/folia-major/README.md'],
  ['public/vendor/pretext-0.0.7.LICENSE', 'resources/app/public/vendor/pretext-0.0.7.LICENSE'],
];
const BUILD_FILES = [
  'desktop/**/*',
  'public/**/*',
  'build/**/*',
  '!build/.generated/**/*',
  'server.js',
  'server/**/*',
  'dj-analyzer.js',
  'LICENSE',
  'NOTICE.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/VENDOR_MANIFEST.md',
  'third_party/folia-major/LICENSE',
  'third_party/folia-major/README.md',
  'public/vendor/pretext-0.0.7.LICENSE',
  'package.json',
  '!public/index.*.html',
  'public/index.html',
];

function signingMarker(version, status = 'unsigned') {
  return `<!-- mineradio-release-signing:${JSON.stringify({ version, status })} -->`;
}

function writeJson(filePath, value) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function manifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.manifestSha256;
  return sha256(`${JSON.stringify(copy)}\n`);
}

function platformTargets(...targetNames) {
  return new Map([
    [
      Platform.WINDOWS,
      new Map(targetNames.map((targetName) => [
        targetName,
        { name: targetName },
      ])),
    ],
  ]);
}

function buildFixture(options = {}) {
  const repoDir = makeTempDir();
  const distDir = path.join(repoDir, 'dist');
  const appOutDir = path.join(distDir, 'win-unpacked');
  const version = options.version || '1.1.0';
  const productName = options.productName || 'Mineradio';
  const appId = options.appId || 'com.mineradio.desktop';
  const channel = options.channel || 'stable';
  const commit = options.commit || COMMIT;
  const buildId = options.buildId || `${channel}-${version}-${commit.slice(0, 12)}`;
  const createdAt = options.createdAt || CREATED_AT;
  const installerName = options.installerName || `Mineradio-${version}-Setup.exe`;
  const installerPath = path.join(distDir, installerName);
  const installerContents = options.installerContents || 'installer fixture';
  const signingPolicy = options.signingPolicy || 'allow-unsigned';
  const trustedSignerThumbprints = options.trustedSignerThumbprints
    || (signingPolicy === 'require-signed' ? [TRUSTED_THUMBPRINT] : []);

  const packageMetadata = {
    name: 'mineradio',
    version,
    productName,
    repository: {
      type: 'git',
      url: `https://github.com/${CANONICAL_OWNER}/${CANONICAL_REPO}.git`,
    },
    mineradioBuild: {
      channel,
      appId,
      productName,
      userDataRoot: channel === 'beta' ? 'Mineradio Beta' : 'Mineradio',
      updateChannel: channel === 'beta' ? 'beta' : 'latest',
      releaseOwner: CANONICAL_OWNER,
      releaseRepo: CANONICAL_REPO,
    },
    mineradio: {
      update: {
        provider: 'github',
        owner: CANONICAL_OWNER,
        repo: CANONICAL_REPO,
        channel: channel === 'beta' ? 'beta' : 'latest',
      },
      release: {
        signingPolicy,
        freshnessMaxAgeMinutes: 240,
        trustedSignerThumbprints,
      },
    },
    build: {
      appId,
      files: BUILD_FILES,
      productName,
    },
  };
  writeJson(path.join(repoDir, 'package.json'), packageMetadata);
  writeJson(path.join(repoDir, 'package-lock.json'), {
    name: 'mineradio',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'mineradio',
        version,
      },
    },
  });
  writeFile(
    path.join(repoDir, 'docs', `RELEASE_NOTES_v${version}.md`),
    options.releaseNotes === undefined
      ? `# Release\n\n${signingMarker(version)}\n\n当前官方安装包未签名，使用 SHA256 校验。\n`
      : options.releaseNotes,
  );

  const manifestFiles = [];
  for (const [sourceRelative, packagedRelative] of MATERIALS) {
    const contents = `${sourceRelative} fixture\n`;
    writeFile(path.join(repoDir, sourceRelative), contents);
    const packagedPath = path.join(appOutDir, ...packagedRelative.split('/'));
    writeFile(packagedPath, contents);
    manifestFiles.push({
      path: packagedRelative.replace(/\//g, '\\'),
      size: Buffer.byteLength(contents),
      sha256: sha256(contents),
      source: 'package',
    });
  }

  const packagedPackagePath = path.join(appOutDir, 'resources', 'app', 'package.json');
  const packagedPackageContents = `${JSON.stringify(packageMetadata, null, 2)}\n`;
  writeFile(packagedPackagePath, packagedPackageContents);
  manifestFiles.push({
    path: 'resources\\app\\package.json',
    size: Buffer.byteLength(packagedPackageContents),
    sha256: sha256(packagedPackageContents),
    source: 'package',
  });

  const dependencies = sourceIdentity.createProductionDependencyProof({
    appDir: path.join(appOutDir, 'resources', 'app'),
    packageLockPath: path.join(repoDir, 'package-lock.json'),
  });
  const manifest = {
    schemaVersion: 1,
    productName,
    appId,
    version,
    channel,
    commit,
    buildId,
    createdAt,
    dependencies,
    files: manifestFiles,
    directories: ['resources', 'resources\\app', 'resources\\app\\docs'],
  };
  manifest.manifestSha256 = manifestDigest(manifest);
  const manifestPath = path.join(repoDir, 'build', '.generated', 'installer-manifest.json');
  writeJson(manifestPath, manifest);
  writeFile(installerPath, installerContents);
  const artifactTime = new Date(options.artifactMtime || '2026-07-29T08:04:00.000Z');
  fs.utimesSync(installerPath, artifactTime, artifactTime);

  return {
    appOutDir,
    appId,
    buildId,
    channel,
    commit,
    sourceTree: options.sourceTree || SOURCE_TREE,
    createdAt,
    distDir,
    installerPath,
    manifest,
    manifestPath,
    productName,
    repoDir,
    version,
  };
}

function addProductionDependencyProofFixture(fixture) {
  const packagePaths = [
    path.join(fixture.repoDir, 'package.json'),
    path.join(fixture.appOutDir, 'resources', 'app', 'package.json'),
  ];
  for (const packagePath of packagePaths) {
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    metadata.dependencies = { alpha: '1.0.0' };
    writeJson(packagePath, metadata);
  }

  const alphaIntegrity = `sha512-${crypto.createHash('sha512')
    .update('alpha-1.0.0')
    .digest('base64')}`;
  writeJson(path.join(fixture.repoDir, 'package-lock.json'), {
    name: 'mineradio',
    version: fixture.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'mineradio',
        version: fixture.version,
        dependencies: { alpha: '1.0.0' },
      },
      'node_modules/alpha': {
        version: '1.0.0',
        integrity: alphaIntegrity,
      },
    },
  });
  const alphaDir = path.join(
    fixture.appOutDir,
    'resources',
    'app',
    'node_modules',
    'alpha',
  );
  writeJson(path.join(alphaDir, 'package.json'), { name: 'alpha', version: '1.0.0' });
  writeFile(path.join(alphaDir, 'index.js'), "module.exports = 'alpha';\n");

  const packagedPackagePath = packagePaths[1];
  const packagedPackageContents = fs.readFileSync(packagedPackagePath);
  const packageManifestEntry = fixture.manifest.files.find(
    (entry) => entry.path === 'resources\\app\\package.json',
  );
  packageManifestEntry.size = packagedPackageContents.length;
  packageManifestEntry.sha256 = sha256(packagedPackageContents);
  for (const fileName of ['package.json', 'index.js']) {
    const filePath = path.join(alphaDir, fileName);
    const contents = fs.readFileSync(filePath);
    fixture.manifest.files.push({
      path: `resources\\app\\node_modules\\alpha\\${fileName}`,
      size: contents.length,
      sha256: sha256(contents),
      source: 'package',
    });
  }
  fixture.manifest.directories.push(
    'resources\\app\\node_modules',
    'resources\\app\\node_modules\\alpha',
  );
  const proof = sourceIdentity.createProductionDependencyProof({
    appDir: path.join(fixture.appOutDir, 'resources', 'app'),
    packageLockPath: path.join(fixture.repoDir, 'package-lock.json'),
  });
  fixture.manifest.dependencies = proof;
  fixture.manifest.manifestSha256 = manifestDigest(fixture.manifest);
  writeJson(fixture.manifestPath, fixture.manifest);
  return proof;
}

function fakeGit(commit = COMMIT, ignoredPaths = []) {
  return (command, args) => {
    assert.equal(command, 'git');
    if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return `${commit}\n`;
    if (args.join(' ') === 'rev-parse --verify HEAD^{tree}') return `${SOURCE_TREE}\n`;
    if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') return '';
    if (args.join(' ') === 'ls-files -v -z') return 'H package.json\0';
    if (args[0] === 'ls-files') return ignoredPaths.length ? `${ignoredPaths.join('\0')}\0` : '';
    throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
  };
}

function windowsMetadata(fixture, status = 'NotSigned') {
  return {
    artifactSha256: sha256(fs.readFileSync(fixture.installerPath)),
    signature: {
      Status: status,
      StatusMessage: status === 'Valid' ? 'Signature verified.' : 'Not signed.',
      Path: fixture.installerPath,
      SignerCertificate: status === 'Valid'
        ? {
            Subject: 'CN=Mineradio Release Test',
            Thumbprint: TRUSTED_THUMBPRINT,
          }
        : null,
    },
    versionInfo: {
      ProductName: fixture.productName,
      ProductVersion: fixture.version,
      FileVersion: fixture.version,
    },
  };
}

async function attest(fixture, options = {}) {
  return artifactVerifier.createArtifactAttestations({
    artifactPaths: options.artifactPaths || [fixture.installerPath],
    outDir: fixture.distDir,
    platformToTargets: options.platformToTargets || platformTargets('nsis'),
  }, {
    repoDir: fixture.repoDir,
    env: options.env || {},
    gitRunner: options.gitRunner || fakeGit(fixture.commit),
    now: options.now || (() => new Date(GENERATED_AT)),
  });
}

function verify(fixture, options = {}) {
  return artifactVerifier.verifyReleaseArtifacts({
    repoDir: fixture.repoDir,
    distDir: fixture.distDir,
    env: options.env || {},
    gitRunner: options.gitRunner || fakeGit(fixture.commit),
    now: options.now || (() => new Date('2026-07-29T08:10:00.000Z')),
    fresh: Boolean(options.fresh),
    readLimits: options.readLimits,
    readWindowsMetadata: options.readWindowsMetadata
      || (() => windowsMetadata(fixture, options.signatureStatus || 'NotSigned')),
  });
}

test('release artifact verifier only targets Mineradio setup installers', () => {
  const distDir = makeTempDir();
  const expected = [
    path.join(distDir, 'Mineradio-1.1.0-Setup.exe'),
    path.join(distDir, 'Mineradio-1.1.1-beta-Setup.exe')
  ];
  expected.forEach((filePath) => writeFile(filePath));
  writeFile(path.join(distDir, 'Mineradio-1.1.0.exe'));
  writeFile(path.join(distDir, 'latest.yml'));

  assert.deepEqual(artifactVerifier.findSetupInstallers(distDir), expected.sort());
});

test('release artifact verifier records signature and SHA256 commands', () => {
  const installer = 'C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe';
  const command = artifactVerifier.buildArtifactVerificationCommand(installer);

  assert.match(command, /Join-Path \$PSHOME .*Microsoft\.PowerShell\.Security\.psd1/);
  assert.match(command, /Import-Module -Name \$securityModule -Force -ErrorAction Stop/);
  assert.match(command, /Get-AuthenticodeSignature/);
  assert.match(command, /System\.Security\.Cryptography\.SHA256/);
  assert.match(command, /ComputeHash\(\$hashStream\)/);
  assert.doesNotMatch(command, /Get-FileHash/);
  assert.match(command, /Mineradio-1\.1\.0-Setup\.exe/);
});

test('release artifact verifier imports the Authenticode module before querying signature status', () => {
  const command = artifactVerifier.buildAuthenticodeStatusCommand('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe');

  assert.match(command, /Join-Path \$PSHOME .*Microsoft\.PowerShell\.Security\.psd1/);
  assert.match(command, /Import-Module -Name \$securityModule -Force -ErrorAction Stop/);
  assert.match(command, /Get-AuthenticodeSignature/);
});

test('release artifact verifier records unavailable signature status when PowerShell cannot load Authenticode', () => {
  const status = JSON.parse(artifactVerifier.readAuthenticodeStatus('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe', () => {
    const error = new Error('Import-Module failed');
    error.stderr = Buffer.from('Microsoft.PowerShell.Security could not be loaded');
    throw error;
  }));

  assert.equal(status.Status, 'Unavailable');
  assert.match(status.StatusMessage, /Microsoft\.PowerShell\.Security could not be loaded/);
  assert.equal(status.Path, 'C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe');
});

test('release artifact verifier captures PowerShell stderr without duplicating command failure text', () => {
  let runnerOptions;
  const status = JSON.parse(artifactVerifier.readAuthenticodeStatus('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe', (command, args, options) => {
    runnerOptions = options;
    const error = new Error('Command failed: noisy duplicate');
    error.stderr = Buffer.from('PowerShell module load failed');
    throw error;
  }));

  assert.deepEqual(runnerOptions.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(status.StatusMessage, 'PowerShell module load failed');
});

test('release artifact module is an electron-builder hook and dir builds return no artifacts', async () => {
  assert.equal(typeof artifactVerifier, 'function');
  assert.deepEqual(await artifactVerifier({
    artifactPaths: [],
    outDir: makeTempDir(),
    platformToTargets: platformTargets('dir'),
  }), []);

  assert.deepEqual(await artifactVerifier({
    artifactPaths: [],
    outDir: makeTempDir(),
    platformToTargets: new Map([[Platform.WINDOWS, new Map()]]),
  }), []);

  const distDir = makeTempDir();
  await assert.rejects(
    async () => artifactVerifier({
      artifactPaths: [],
      outDir: distDir,
      platformToTargets: platformTargets('nsis'),
    }),
    /exactly one setup artifact/i,
  );
});

test('afterAllArtifactBuild validates the electron-builder target map and NSIS artifact set', async (t) => {
  await t.test('missing target map', async () => {
    assert.throws(
      () => artifactVerifier({ artifactPaths: [], outDir: makeTempDir() }),
      /platformToTargets|target map/i,
    );
  });

  await t.test('non-Map target map', async () => {
    assert.throws(
      () => artifactVerifier({
        artifactPaths: [],
        outDir: makeTempDir(),
        platformToTargets: { windows: ['dir'] },
      }),
      /platformToTargets|target map/i,
    );
  });

  await t.test('non-Map Windows targets', async () => {
    assert.throws(
      () => artifactVerifier({
        artifactPaths: [],
        outDir: makeTempDir(),
        platformToTargets: new Map([[Platform.WINDOWS, ['dir']]]),
      }),
      /platformToTargets|target map/i,
    );
  });

  await t.test('unsupported target cannot return empty', async () => {
    assert.throws(
      () => artifactVerifier({
        artifactPaths: [],
        outDir: makeTempDir(),
        platformToTargets: platformTargets('zip'),
      }),
      /unsupported|dir|nsis/i,
    );
  });

  await t.test('multiple setup artifacts', async () => {
    const fixture = buildFixture();
    const duplicatePath = path.join(
      fixture.distDir,
      'duplicate',
      path.basename(fixture.installerPath),
    );
    writeFile(duplicatePath, 'duplicate installer');

    await assert.rejects(
      () => attest(fixture, {
        artifactPaths: [fixture.installerPath, duplicatePath],
      }),
      /exactly one setup artifact/i,
    );
  });

  await t.test('setup artifact path escapes outDir', async () => {
    const fixture = buildFixture();
    const outsidePath = path.join(
      fixture.repoDir,
      path.basename(fixture.installerPath),
    );
    writeFile(outsidePath, 'outside installer');

    await assert.rejects(
      () => attest(fixture, { artifactPaths: [outsidePath] }),
      /outDir|outside|top-level/i,
    );
  });

  await t.test('setup artifact name must match the current exact version', async () => {
    const fixture = buildFixture({ installerName: 'Mineradio-1.0.0-Setup.exe' });

    await assert.rejects(
      () => attest(fixture),
      /current version|Mineradio-1\.1\.0-Setup\.exe/i,
    );
  });
});

test('hook rejects unexpected top-level outputs and returns only the new sidecar path', async (t) => {
  const staleFileNames = [
    'Mineradio-1.0.0-Setup.exe',
    'AnotherProduct-1.1.0-Setup.exe',
    'Mineradio-1.1.0-Setup.exe.blockmap',
    'latest.yml',
    'latest-beta.yml',
    'Mineradio-1.0.0-Setup.exe.mineradio-attestation.json',
    'Mineradio-1.0.0-SHA256SUMS.txt',
    'Mineradio-1.0.0-Setup.exe.sha256',
    'ForeignInstaller.msi',
    'release.zip',
    'release.7z',
    'release.nupkg',
    'notes.txt',
    'scratch.tmp',
  ];

  for (const staleFileName of staleFileNames) {
    await t.test(`rejects ${staleFileName}`, async () => {
      const fixture = buildFixture();
      writeFile(path.join(fixture.distDir, staleFileName), 'stale release output');

      await assert.rejects(
        () => attest(fixture),
        /stale|unexpected|release output|allowlist|top-level|remove/i,
      );
    });
  }

  await t.test('allows unpacked output and explicit diagnostics', async () => {
    const fixture = buildFixture();
    writeFile(path.join(fixture.distDir, 'builder-debug.yml'), 'debug');
    writeFile(path.join(fixture.distDir, 'builder-effective-config.yaml'), 'config');

    assert.deepEqual(await attest(fixture), [
      `${fixture.installerPath}.mineradio-attestation.json`,
    ]);
    assert.doesNotThrow(() => verify(fixture));
  });

  await t.test('rejects an unknown top-level directory', async () => {
    const fixture = buildFixture();
    fs.mkdirSync(path.join(fixture.distDir, 'foreign-output'));

    await assert.rejects(
      () => attest(fixture),
      /unexpected|allowlist|top-level|directory/i,
    );
  });

  await t.test('rejects a diagnostic name masquerading as a directory', async () => {
    const fixture = buildFixture();
    fs.mkdirSync(path.join(fixture.distDir, 'builder-debug.yml'));

    await assert.rejects(
      () => attest(fixture),
      /regular file|type|diagnostic|allowlist/i,
    );
  });

  await t.test('rejects win-unpacked masquerading as a file', async () => {
    const fixture = buildFixture();
    fs.rmSync(fixture.appOutDir, { recursive: true });
    writeFile(fixture.appOutDir, 'not a directory');

    await assert.rejects(
      () => attest(fixture),
      /win-unpacked|directory|type/i,
    );
  });

  await t.test('rejects an allowed diagnostic name that is a symlink or reparse point', async () => {
    const fixture = buildFixture();
    const targetDir = path.join(fixture.repoDir, 'diagnostic-target');
    const diagnosticPath = path.join(fixture.distDir, 'builder-effective-config.yaml');
    fs.mkdirSync(targetDir);
    fs.symlinkSync(
      targetDir,
      diagnosticPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await assert.rejects(
      () => attest(fixture),
      /symlink|reparse|regular file|type/i,
    );
  });

  await t.test('rejects a pre-existing current sidecar before hook generation', async () => {
    const fixture = buildFixture();
    writeFile(
      `${fixture.installerPath}.mineradio-attestation.json`,
      'stale current sidecar',
    );

    await assert.rejects(
      () => attest(fixture),
      /unexpected|allowlist|sidecar|attestation|top-level/i,
    );
  });
});

test('verifier rejects stale top-level release outputs', async (t) => {
  for (const staleFileName of [
    'AnotherProduct-1.1.0-Setup.exe',
    'Mineradio-1.1.0-Setup.exe.blockmap',
    'latest.yml',
    'Mineradio-1.0.0-Setup.exe.mineradio-attestation.json',
    'Mineradio-1.0.0-SHA256SUMS.txt',
    'ForeignInstaller.msi',
    'release.zip',
    'release.7z',
    'release.nupkg',
    'notes.txt',
    'scratch.tmp',
  ]) {
    await t.test(`rejects ${staleFileName}`, async () => {
      const fixture = buildFixture();
      await attest(fixture);
      writeFile(path.join(fixture.distDir, staleFileName), 'stale release output');

      assert.throws(
        () => verify(fixture),
        /stale|unexpected|release output|allowlist|top-level|remove/i,
      );
    });
  }

  await t.test('rejects an unknown top-level directory', async () => {
    const fixture = buildFixture();
    await attest(fixture);
    fs.mkdirSync(path.join(fixture.distDir, 'foreign-output'));

    assert.throws(
      () => verify(fixture),
      /unexpected|allowlist|top-level|directory/i,
    );
  });
});

test('afterAllArtifactBuild writes an atomic attestation bound to the installer and packaged notices', async () => {
  const fixture = buildFixture();
  const newArtifactPaths = await attest(fixture);
  const expectedSidecar = `${fixture.installerPath}.mineradio-attestation.json`;

  assert.deepEqual(newArtifactPaths, [expectedSidecar]);
  const attestation = JSON.parse(fs.readFileSync(expectedSidecar, 'utf8'));
  const installerStat = fs.statSync(fixture.installerPath);
  assert.equal(attestation.schemaVersion, 1);
  assert.deepEqual(attestation.artifact, {
    fileName: path.basename(fixture.installerPath),
    size: installerStat.size,
    sha256: sha256(fs.readFileSync(fixture.installerPath)),
  });
  assert.deepEqual(attestation.build, {
    productName: fixture.productName,
    appId: fixture.appId,
    version: fixture.version,
    channel: fixture.channel,
    owner: CANONICAL_OWNER,
    repo: CANONICAL_REPO,
    commit: fixture.commit,
    sourceTree: fixture.sourceTree,
    buildId: fixture.buildId,
    createdAt: fixture.createdAt,
  });
  assert.equal(attestation.installerManifest.sha256, fixture.manifest.manifestSha256);
  assert.equal(attestation.materials.length, MATERIALS.length);
  assert.equal(attestation.generatedAt, GENERATED_AT);
  assert.equal(
    fs.readdirSync(fixture.distDir).filter((name) => name.endsWith('.tmp')).length,
    0,
  );
});

test('artifact attestation binds the packaged production dependency proof', async () => {
  const fixture = buildFixture();
  const expectedProof = addProductionDependencyProofFixture(fixture);
  await attest(fixture);

  const attestation = JSON.parse(fs.readFileSync(
    `${fixture.installerPath}.mineradio-attestation.json`,
    'utf8',
  ));
  assert.deepEqual(attestation.dependencies, expectedProof);
});

test('artifact attestation rejects a packaged dependency outside package-lock', async () => {
  const fixture = buildFixture();
  addProductionDependencyProofFixture(fixture);
  const rogueDir = path.join(
    fixture.appOutDir,
    'resources',
    'app',
    'node_modules',
    'rogue',
  );
  writeJson(path.join(rogueDir, 'package.json'), { name: 'rogue', version: '6.6.6' });
  writeFile(path.join(rogueDir, 'index.js'), "module.exports = 'rogue';\n");

  await assert.rejects(
    () => attest(fixture),
    /extra|rogue|package-lock|production dependency/i,
  );
});

test('valid current unsigned artifact passes only under the explicit unsigned policy', async () => {
  const fixture = buildFixture();
  await attest(fixture);

  const results = verify(fixture);
  assert.equal(results.length, 1);
  assert.equal(results[0].sha256, sha256(fs.readFileSync(fixture.installerPath)));
  assert.equal(results[0].authenticode.Status, 'NotSigned');
  assert.deepEqual(results[0].publishableArtifacts, [
    fixture.installerPath,
    `${fixture.installerPath}.mineradio-attestation.json`,
  ]);
});

test('beta artifact uses the isolated builder identity and canonical release owner', async () => {
  const fixture = buildFixture({
    appId: 'com.mineradio.desktop.beta',
    channel: 'beta',
    installerName: 'Mineradio-Beta-1.1.0-Setup.exe',
    productName: 'Mineradio Beta',
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(fixture.repoDir, 'package.json'), 'utf8'));
  writeJson(path.join(fixture.repoDir, 'build', 'electron-builder.beta.json'), {
    appId: fixture.appId,
    productName: fixture.productName,
    directories: { output: 'dist-beta' },
    files: BUILD_FILES,
    nsis: { artifactName: 'Mineradio-Beta-${version}-Setup.${ext}' },
    publish: [{
      provider: 'github',
      owner: CANONICAL_OWNER,
      repo: CANONICAL_REPO,
      channel: 'beta',
    }],
    extraMetadata: {
      mineradioBuild: pkg.mineradioBuild,
      mineradio: { update: pkg.mineradio.update },
    },
  });

  await attest(fixture);
  const attestation = JSON.parse(fs.readFileSync(
    `${fixture.installerPath}.mineradio-attestation.json`,
    'utf8',
  ));
  assert.equal(attestation.artifact.fileName, 'Mineradio-Beta-1.1.0-Setup.exe');
  assert.equal(attestation.build.channel, 'beta');
  assert.equal(attestation.build.owner, CANONICAL_OWNER);
  assert.equal(attestation.build.repo, CANONICAL_REPO);
});

test('verification rejects an additional setup installer or a setup for another version', async (t) => {
  await t.test('additional setup', async () => {
    const fixture = buildFixture();
    await attest(fixture);
    writeFile(path.join(fixture.distDir, 'Mineradio-1.0.0-Setup.exe'));
    assert.throws(() => verify(fixture), /exactly one|current version|unexpected setup/i);
  });

  await t.test('wrong version setup', async () => {
    const fixture = buildFixture();
    await attest(fixture);
    const staleInstaller = path.join(fixture.distDir, 'Mineradio-1.0.0-Setup.exe');
    fs.renameSync(fixture.installerPath, staleInstaller);
    assert.throws(() => verify(fixture), /current version|Mineradio-1\.1\.0-Setup\.exe/i);
  });
});

test('verification rejects wrong Windows product or version metadata', async (t) => {
  const fixture = buildFixture();
  await attest(fixture);

  await t.test('product', () => {
    const metadata = windowsMetadata(fixture);
    metadata.versionInfo.ProductName = 'Another Product';
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /product/i,
    );
  });

  await t.test('version', () => {
    const metadata = windowsMetadata(fixture);
    metadata.versionInfo.ProductVersion = '1.0.0';
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /version/i,
    );
  });

  await t.test('Windows four-part normalization', () => {
    const metadata = windowsMetadata(fixture);
    metadata.versionInfo.ProductVersion = '1.1.0.0';
    metadata.versionInfo.FileVersion = '1.1.0.0';
    assert.doesNotThrow(() => verify(fixture, { readWindowsMetadata: () => metadata }));
  });

  await t.test('product whitespace is not normalized', () => {
    const metadata = windowsMetadata(fixture);
    metadata.versionInfo.ProductName = ` ${fixture.productName}`;
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /product/i,
    );
  });
});

test('verification rejects a build from another commit or build id', async (t) => {
  const fixture = buildFixture();
  await attest(fixture);

  await t.test('commit', () => {
    assert.throws(
      () => verify(fixture, {
        gitRunner: fakeGit('fedcba9876543210fedcba9876543210fedcba98'),
      }),
      /commit/i,
    );
  });

  await t.test('build id', () => {
    assert.throws(
      () => verify(fixture, {
        env: { MINERADIO_BUILD_ID: 'stable-1.1.0-different' },
      }),
      /build id/i,
    );
  });
});

test('verification rejects an installer changed after attestation', async () => {
  const fixture = buildFixture();
  await attest(fixture);
  fs.appendFileSync(fixture.installerPath, 'tampered');

  assert.throws(() => verify(fixture), /SHA256|size|changed|attestation/i);
});

test('verification binds Authenticode metadata to the exact hashed installer bytes', async () => {
  const fixture = buildFixture({ signingPolicy: 'require-signed' });
  await attest(fixture);
  const originalContents = fs.readFileSync(fixture.installerPath);
  const originalStat = fs.statSync(fixture.installerPath);
  const replacementContents = Buffer.alloc(originalContents.length, 0x5a);

  assert.throws(
    () => verify(fixture, {
      readWindowsMetadata(installerPath) {
        fs.writeFileSync(installerPath, replacementContents);
        const replacementMetadata = windowsMetadata(fixture, 'Valid');
        fs.writeFileSync(installerPath, originalContents);
        fs.utimesSync(installerPath, originalStat.atime, originalStat.mtime);
        return replacementMetadata;
      },
    }),
    /hash|sha256|changed|identity|replace/i,
  );
});

test('verification rehashes the held installer after external metadata inspection', async () => {
  const fixture = buildFixture({ signingPolicy: 'require-signed' });
  await attest(fixture);
  const originalContents = fs.readFileSync(fixture.installerPath);
  const originalStat = fs.statSync(fixture.installerPath);
  const replacementContents = Buffer.alloc(originalContents.length, 0x41);

  assert.throws(
    () => verify(fixture, {
      readWindowsMetadata(installerPath) {
        const originalMetadata = windowsMetadata(fixture, 'Valid');
        fs.writeFileSync(installerPath, replacementContents);
        fs.utimesSync(installerPath, originalStat.atime, originalStat.mtime);
        return originalMetadata;
      },
    }),
    /hash|sha256|changed|contents|replace/i,
  );
});

test('verification keeps the published sidecar bound through metadata inspection', async () => {
  const fixture = buildFixture();
  await attest(fixture);
  const sidecarPath = `${fixture.installerPath}.mineradio-attestation.json`;
  const sidecarStat = fs.statSync(sidecarPath);
  const sidecarContents = fs.readFileSync(sidecarPath);

  assert.throws(
    () => verify(fixture, {
      readWindowsMetadata() {
        const metadata = windowsMetadata(fixture);
        fs.writeFileSync(sidecarPath, Buffer.alloc(sidecarContents.length, 0x20));
        fs.utimesSync(sidecarPath, sidecarStat.atime, sidecarStat.mtime);
        return metadata;
      },
    }),
    /attestation|sidecar|hash|sha256|changed|contents|identity/i,
  );
});

test('verification rejects missing or changed release materials', async (t) => {
  await t.test('missing packaged notice', async () => {
    const fixture = buildFixture();
    await attest(fixture);
    fs.rmSync(path.join(fixture.appOutDir, 'resources', 'app', 'NOTICE.md'));
    assert.throws(() => verify(fixture), /NOTICE\.md|material|packaged/i);
  });

  await t.test('changed source notice', async () => {
    const fixture = buildFixture();
    await attest(fixture);
    fs.appendFileSync(path.join(fixture.repoDir, 'THIRD_PARTY_NOTICES.md'), 'changed');
    assert.throws(() => verify(fixture), /THIRD_PARTY_NOTICES\.md|material|SHA256/i);
  });
});

test('release verifier covers Folia and Pretext source acquisition materials', () => {
  assert.deepEqual(
    artifactVerifier.RELEASE_MATERIALS.map(material => material.sourcePath),
    MATERIALS.map(material => material[0]),
  );
});

test('packaged metadata must retain build identity and canonical release ownership', () => {
  const fixture = buildFixture();
  const expected = {
    appId: fixture.appId,
    channel: fixture.channel,
    owner: CANONICAL_OWNER,
    productName: fixture.productName,
    repo: CANONICAL_REPO,
    version: fixture.version,
  };

  assert.deepEqual(
    artifactVerifier.readPackagedReleaseIdentity(fixture.appOutDir, expected),
    expected,
  );

  const packagedPackagePath = path.join(
    fixture.appOutDir,
    'resources',
    'app',
    'package.json',
  );
  const packagedPackage = JSON.parse(fs.readFileSync(packagedPackagePath, 'utf8'));
  packagedPackage.mineradioBuild.releaseOwner = 'foreign-owner';
  writeJson(packagedPackagePath, packagedPackage);
  assert.throws(
    () => artifactVerifier.readPackagedReleaseIdentity(fixture.appOutDir, expected),
    /owner|ownership|repository/i,
  );
});

test('fresh verification rejects stale build, sidecar, and artifact timestamps', async () => {
  const fixture = buildFixture({
    createdAt: '2026-07-28T00:00:00.000Z',
    artifactMtime: '2026-07-28T00:05:00.000Z',
  });
  await attest(fixture, { now: () => new Date('2026-07-28T00:06:00.000Z') });
  const staleTime = new Date('2026-07-28T00:06:00.000Z');
  fs.utimesSync(
    `${fixture.installerPath}.mineradio-attestation.json`,
    staleTime,
    staleTime,
  );

  assert.throws(
    () => verify(fixture, {
      fresh: true,
      now: () => new Date('2026-07-29T08:10:00.000Z'),
    }),
    /stale|fresh|age/i,
  );
});

test('signature verification fails closed for unavailable and malformed metadata', async (t) => {
  const fixture = buildFixture();
  await attest(fixture);

  await t.test('Unavailable', () => {
    assert.throws(
      () => verify(fixture, { signatureStatus: 'Unavailable' }),
      /Unavailable|signature|Authenticode/i,
    );
  });

  await t.test('malformed metadata', () => {
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => ({ broken: true }) }),
      /malformed|metadata|signature|VersionInfo/i,
    );
  });

  await t.test('signature path for another artifact', () => {
    const metadata = windowsMetadata(fixture);
    metadata.signature.Path = path.join(fixture.distDir, 'Another-Setup.exe');
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /signature path|Authenticode path/i,
    );
  });
});

test('signature policy accepts Valid and rejects unauthorized NotSigned artifacts', async (t) => {
  await t.test('Valid under require-signed', async () => {
    const fixture = buildFixture({ signingPolicy: 'require-signed' });
    await attest(fixture);
    assert.doesNotThrow(() => verify(fixture, { signatureStatus: 'Valid' }));
  });

  await t.test('Valid with an untrusted signer', async () => {
    const fixture = buildFixture({ signingPolicy: 'require-signed' });
    await attest(fixture);
    const metadata = windowsMetadata(fixture, 'Valid');
    metadata.signature.SignerCertificate.Thumbprint = 'B'.repeat(40);
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /signer|thumbprint|trusted/i,
    );
  });

  await t.test('Valid without a signer certificate', async () => {
    const fixture = buildFixture({ signingPolicy: 'require-signed' });
    await attest(fixture);
    const metadata = windowsMetadata(fixture, 'Valid');
    metadata.signature.SignerCertificate = null;
    assert.throws(
      () => verify(fixture, { readWindowsMetadata: () => metadata }),
      /signer certificate|thumbprint/i,
    );
  });

  await t.test('Valid under allow-unsigned still requires a trusted signer', async () => {
    const fixture = buildFixture({
      signingPolicy: 'allow-unsigned',
      trustedSignerThumbprints: [],
    });
    await attest(fixture);
    assert.throws(
      () => verify(fixture, { signatureStatus: 'Valid' }),
      /allowlist|signer|trusted/i,
    );
  });

  await t.test('NotSigned under require-signed', async () => {
    const fixture = buildFixture({ signingPolicy: 'require-signed' });
    await attest(fixture);
    assert.throws(
      () => verify(fixture, { signatureStatus: 'NotSigned' }),
      /NotSigned|unsigned|policy|signature/i,
    );
  });

  await t.test('NotSigned without a current release-note declaration', async () => {
    const fixture = buildFixture({
      signingPolicy: 'allow-unsigned',
      releaseNotes: '# Release\n\nSHA256 is published.\n',
    });
    await attest(fixture);
    assert.throws(
      () => verify(fixture, { signatureStatus: 'NotSigned' }),
      /release note|未签名|unsigned/i,
    );
  });
});

test('allow-unsigned requires one current-version machine marker and a human declaration', async (t) => {
  await t.test('valid marker and human declaration', async () => {
    const fixture = buildFixture({
      releaseNotes: [
        '# Release',
        '',
        signingMarker('1.1.0'),
        '',
        '当前官方安装包未签名，Windows 可能显示安全提示。',
        '',
      ].join('\n'),
    });
    await attest(fixture);

    assert.doesNotThrow(() => verify(fixture));
  });

  const rejectedReleaseNotes = [
    {
      name: 'missing marker',
      contents: '# Release\n\n当前官方安装包未签名，Windows 可能显示安全提示。\n',
    },
    {
      name: 'duplicate marker',
      contents: [
        '# Release',
        '',
        signingMarker('1.1.0'),
        signingMarker('1.1.0'),
        '',
        '当前官方安装包未签名，Windows 可能显示安全提示。',
        '',
      ].join('\n'),
    },
    {
      name: 'marker for another version',
      contents: [
        '# Release',
        '',
        signingMarker('1.0.0'),
        '',
        '当前官方安装包未签名，Windows 可能显示安全提示。',
        '',
      ].join('\n'),
    },
    {
      name: 'signed status',
      contents: [
        '# Release',
        '',
        signingMarker('1.1.0', 'signed'),
        '',
        '当前官方安装包未签名，Windows 可能显示安全提示。',
        '',
      ].join('\n'),
    },
    {
      name: 'only an old unsigned marker while the current version claims signed',
      contents: [
        '# Release',
        '',
        signingMarker('1.0.0'),
        '',
        'v1.0.0 安装包未签名；当前 v1.1.0 安装包已完成代码签名。',
        '',
      ].join('\n'),
    },
    {
      name: 'marker without a human declaration',
      contents: `# Release\n\n${signingMarker('1.1.0')}\n`,
    },
    {
      name: 'marker with extra metadata',
      contents: [
        '# Release',
        '',
        '<!-- mineradio-release-signing:{"version":"1.1.0","status":"unsigned","note":"trust me"} -->',
        '',
        '当前官方安装包未签名，Windows 可能显示安全提示。',
        '',
      ].join('\n'),
    },
  ];

  for (const scenario of rejectedReleaseNotes) {
    await t.test(`rejects ${scenario.name}`, async () => {
      const fixture = buildFixture({ releaseNotes: scenario.contents });
      await attest(fixture);

      assert.throws(
        () => verify(fixture),
        /release signing marker|release notes|current version|unsigned declaration/i,
      );
    });
  }
});

test('structured release inputs use bounded regular-file reads', async (t) => {
  await t.test('declares per-input default limits', () => {
    assert.deepEqual(artifactVerifier.TEXT_FILE_LIMITS, {
      installerManifest: 8 * 1024 * 1024,
      attestation: 2 * 1024 * 1024,
      releaseNotes: 1 * 1024 * 1024,
      packageJson: 1 * 1024 * 1024,
    });
  });

  for (const limitName of [
    'packageJson',
    'installerManifest',
    'attestation',
    'releaseNotes',
  ]) {
    await t.test(`rejects ${limitName} before reading beyond its configured limit`, async () => {
      const fixture = buildFixture();
      await attest(fixture);

      assert.throws(
        () => verify(fixture, { readLimits: { [limitName]: 1 } }),
        /size|limit|large|bytes/i,
      );
    });
  }

  function regularStat(overrides = {}) {
    return {
      dev: 1,
      ino: 2,
      mtimeMs: 1000,
      size: 0,
      isFile: () => true,
      isSymbolicLink: () => false,
      ...overrides,
    };
  }

  await t.test('counts UTF-8 bytes and never calls readFileSync', () => {
    const inputPath = path.join(makeTempDir(), 'utf8.txt');
    writeFile(inputPath, '你');
    let closeCount = 0;
    let openCount = 0;
    const fsApi = {
      lstatSync: fs.lstatSync,
      fstatSync: fs.fstatSync,
      readSync: fs.readSync,
      openSync(filePath, flags) {
        openCount += 1;
        return fs.openSync(filePath, flags);
      },
      closeSync(descriptor) {
        closeCount += 1;
        fs.closeSync(descriptor);
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.equal(
      artifactVerifier.readBoundedTextFile(
        inputPath,
        'UTF-8 input',
        { maxBytes: 3, fsApi },
      ),
      '你',
    );
    assert.equal(openCount, 1);
    assert.equal(closeCount, 1);
    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        inputPath,
        'UTF-8 input',
        { maxBytes: 2, fsApi },
      ),
      /size|limit|large|bytes/i,
    );
  });

  for (const scenario of [
    {
      name: 'symlink',
      stat: regularStat({ isSymbolicLink: () => true }),
      pattern: /symbolic link|symlink/i,
    },
    {
      name: 'non-regular file',
      stat: regularStat({ isFile: () => false }),
      pattern: /regular file/i,
    },
  ]) {
    await t.test(`rejects a ${scenario.name} before opening`, () => {
      let openCalled = false;
      const fsApi = {
        lstatSync: () => scenario.stat,
        openSync() {
          openCalled = true;
          throw new Error('openSync must not be called');
        },
        readFileSync() {
          throw new Error('readFileSync must never be called');
        },
      };

      assert.throws(
        () => artifactVerifier.readBoundedTextFile(
          'virtual-release-input',
          'Virtual release input',
          { maxBytes: 16, fsApi },
        ),
        scenario.pattern,
      );
      assert.equal(openCalled, false);
    });
  }

  await t.test('rejects descriptor identity changes and closes it', () => {
    let closeCount = 0;
    const fsApi = {
      lstatSync: () => regularStat({ size: 1 }),
      openSync: () => 42,
      fstatSync: () => regularStat({ ino: 3, size: 1 }),
      readSync() {
        throw new Error('readSync must not be called');
      },
      closeSync() {
        closeCount += 1;
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 16, fsApi },
      ),
      /identity|replaced|changed/i,
    );
    assert.equal(closeCount, 1);
  });

  await t.test('reads at most maxBytes + 1 when a file grows and closes it', () => {
    const contents = Buffer.from('abcde');
    let offset = 0;
    let closeCount = 0;
    let bytesRead = 0;
    const requestedLengths = [];
    const stableStat = regularStat({ size: 4 });
    const fsApi = {
      lstatSync: () => stableStat,
      openSync: () => 42,
      fstatSync: () => stableStat,
      readSync(descriptor, buffer, bufferOffset, length) {
        requestedLengths.push(length);
        const count = Math.min(length, contents.length - offset);
        contents.copy(buffer, bufferOffset, offset, offset + count);
        offset += count;
        bytesRead += count;
        return count;
      },
      closeSync() {
        closeCount += 1;
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 4, fsApi },
      ),
      /size|limit|large|bytes/i,
    );
    assert.equal(bytesRead, 5);
    assert.ok(requestedLengths.every((length) => length <= 5));
    assert.equal(closeCount, 1);
  });

  await t.test('closes a descriptor when fstat reports an oversized file', () => {
    let closeCount = 0;
    let fstatCount = 0;
    const fsApi = {
      lstatSync: () => regularStat({ size: 16 }),
      openSync: () => 42,
      fstatSync() {
        fstatCount += 1;
        return regularStat({ size: 17 });
      },
      readSync() {
        throw new Error('readSync must not be called');
      },
      closeSync() {
        closeCount += 1;
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 16, fsApi },
      ),
      /size|limit|large|bytes/i,
    );
    assert.equal(fstatCount, 1);
    assert.equal(closeCount, 1);
  });

  await t.test('closes a descriptor when reading fails', () => {
    let closeCount = 0;
    const stableStat = regularStat({ size: 1 });
    const fsApi = {
      lstatSync: () => stableStat,
      openSync: () => 42,
      fstatSync: () => stableStat,
      readSync() {
        throw new Error('simulated read failure');
      },
      closeSync() {
        closeCount += 1;
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 16, fsApi },
      ),
      /simulated read failure/i,
    );
    assert.equal(closeCount, 1);
  });

  await t.test('rejects size or mtime changes during a read', () => {
    let closeCount = 0;
    let fstatCount = 0;
    let consumed = false;
    const fsApi = {
      lstatSync: () => regularStat({ size: 1 }),
      openSync: () => 42,
      fstatSync() {
        fstatCount += 1;
        return fstatCount === 1
          ? regularStat({ size: 1 })
          : regularStat({ size: 2, mtimeMs: 2000 });
      },
      readSync(descriptor, buffer) {
        if (consumed) return 0;
        consumed = true;
        buffer[0] = 0x61;
        return 1;
      },
      closeSync() {
        closeCount += 1;
      },
      readFileSync() {
        throw new Error('readFileSync must never be called');
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 16, fsApi },
      ),
      /changed|stable|size|mtime/i,
    );
    assert.equal(fstatCount, 2);
    assert.equal(closeCount, 1);
  });

  await t.test('rejects path replacement after descriptor reading and closes it', () => {
    let closeCount = 0;
    let lstatCount = 0;
    let consumed = false;
    const openedStat = regularStat({ size: 1 });
    const replacementStat = regularStat({ ino: 3, size: 1 });
    const fsApi = {
      lstatSync() {
        lstatCount += 1;
        return lstatCount === 1 ? openedStat : replacementStat;
      },
      openSync: () => 42,
      fstatSync: () => openedStat,
      readSync(descriptor, buffer) {
        if (consumed) return 0;
        consumed = true;
        buffer[0] = 0x61;
        return 1;
      },
      closeSync() {
        closeCount += 1;
      },
    };

    assert.throws(
      () => artifactVerifier.readBoundedTextFile(
        'virtual-release-input',
        'Virtual release input',
        { maxBytes: 16, fsApi },
      ),
      /path|identity|replaced|changed/i,
    );
    assert.equal(lstatCount, 2);
    assert.equal(closeCount, 1);
  });
});

test('release artifact hashing uses bounded reads', () => {
  const fixturePath = path.join(makeTempDir(), 'large-setup.exe');
  writeFile(fixturePath, Buffer.alloc(1024 * 1024 + 17, 0x5a));
  const readSizes = [];
  const fsApi = {
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    readFileSync() {
      throw new Error('unbounded readFileSync must not be used');
    },
    readSync(descriptor, buffer, offset, length, position) {
      readSizes.push(length);
      return fs.readSync(descriptor, buffer, offset, length, position);
    },
  };

  assert.equal(
    artifactVerifier.sha256File(fixturePath, { fsApi, bufferSize: 64 * 1024 }),
    sha256(fs.readFileSync(fixturePath)),
  );
  assert.ok(readSizes.length > 1);
  assert.ok(readSizes.every((size) => size <= 64 * 1024));
});

test('CLI argument parser accepts beta and freshness gates once each', () => {
  assert.deepEqual(artifactVerifier.parseCliArguments([]), { beta: false, fresh: false });
  assert.deepEqual(
    artifactVerifier.parseCliArguments(['--beta', '--fresh']),
    { beta: true, fresh: true },
  );
  assert.throws(
    () => artifactVerifier.parseCliArguments(['--force']),
    /unknown|unsupported|--force/i,
  );
});

test('release artifact verifier imports Authenticode and reads Windows VersionInfo', () => {
  const installer = 'C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe';
  const metadataCommand = artifactVerifier.buildWindowsMetadataCommand(installer);

  assert.match(metadataCommand, /Join-Path \$PSHOME .*Microsoft\.PowerShell\.Security\.psd1/);
  assert.match(
    metadataCommand,
    /Import-Module -Name \$securityModule -Force -ErrorAction Stop/,
  );
  assert.match(metadataCommand, /Get-AuthenticodeSignature/);
  assert.match(metadataCommand, /System\.Security\.Cryptography\.SHA256/);
  assert.match(metadataCommand, /ComputeHash\(\$stream\)/);
  assert.doesNotMatch(metadataCommand, /Get-FileHash/);
  assert.match(metadataCommand, /FileShare.*Read/i);
  assert.match(metadataCommand, /ArtifactSha256/);
  assert.match(metadataCommand, /VersionInfo/);
  assert.match(metadataCommand, /ProductName/);
  assert.match(metadataCommand, /ProductVersion/);
  assert.match(metadataCommand, /FileVersion/);
  assert.match(metadataCommand, /SignerCertificate/);
  assert.match(metadataCommand, /Subject/);
  assert.match(metadataCommand, /Thumbprint/);
});

windowsTest('Windows metadata reader uses the system Security module under inherited module paths', () => {
  const metadata = artifactVerifier.readWindowsArtifactMetadata(process.execPath);
  const signature = metadata.Signature || metadata.signature;
  const versionInfo = metadata.VersionInfo || metadata.versionInfo;
  const artifactSha256 = metadata.ArtifactSha256 || metadata.artifactSha256;

  assert.notEqual(signature.Status, 'Unavailable', signature.StatusMessage);
  assert.equal(path.resolve(signature.Path), path.resolve(process.execPath));
  assert.match(artifactSha256, /^[A-F0-9]{64}$/);
  assert.ok(versionInfo);
  assert.equal(typeof versionInfo.ProductName, 'string');
  assert.notEqual(versionInfo.ProductName, '');
});

test('allow-unsigned accepts the repository current-version wording for no code signature', async () => {
  const fixture = buildFixture({
    releaseNotes: [
      '# Release',
      '',
      signingMarker('1.1.0'),
      '',
      '当前安装包暂未进行代码签名，Windows 可能显示安全提示。',
      '',
    ].join('\n'),
  });
  await attest(fixture);

  assert.doesNotThrow(() => verify(fixture, { signatureStatus: 'NotSigned' }));
});

test('afterAllArtifactBuild rejects release material mismatches before writing a sidecar', async (t) => {
  await t.test('packaged notice differs from source', async () => {
    const fixture = buildFixture();
    fs.appendFileSync(
      path.join(fixture.appOutDir, 'resources', 'app', 'NOTICE.md'),
      'packaged-only change',
    );

    await assert.rejects(() => attest(fixture), /NOTICE\.md|packaged SHA256/i);
    assert.equal(fs.existsSync(`${fixture.installerPath}.mineradio-attestation.json`), false);
  });

  await t.test('manifest notice hash differs from packaged notice', async () => {
    const fixture = buildFixture();
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
    const noticeEntry = manifest.files.find((entry) => entry.path === 'resources\\app\\NOTICE.md');
    noticeEntry.sha256 = 'A'.repeat(64);
    manifest.manifestSha256 = manifestDigest(manifest);
    writeJson(fixture.manifestPath, manifest);

    await assert.rejects(() => attest(fixture), /NOTICE\.md|manifest SHA256/i);
    assert.equal(fs.existsSync(`${fixture.installerPath}.mineradio-attestation.json`), false);
  });
});

test('verification rejects tampered sidecar manifest metadata', async () => {
  const fixture = buildFixture();
  await attest(fixture);
  const sidecarPath = `${fixture.installerPath}.mineradio-attestation.json`;
  const attestation = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  attestation.installerManifest.path = 'build/.generated/foreign-manifest.json';
  writeJson(sidecarPath, attestation);

  assert.throws(
    () => verify(fixture),
    /attestation installer manifest path|manifest metadata/i,
  );
});

test('verification rejects a tampered source tree in the sidecar', async () => {
  const fixture = buildFixture();
  await attest(fixture);
  const sidecarPath = `${fixture.installerPath}.mineradio-attestation.json`;
  const attestation = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  attestation.build.sourceTree = 'f'.repeat(40);
  writeJson(sidecarPath, attestation);

  assert.throws(
    () => verify(fixture),
    /source tree|sourceTree/i,
  );
});

test('hook and verifier reject ignored files selected by package build inputs', async (t) => {
  await t.test('hook', async () => {
    const fixture = buildFixture();

    await assert.rejects(
      () => attest(fixture, {
        gitRunner: fakeGit(fixture.commit, ['public/.env']),
      }),
      /ignored|package|build\.files|source/i,
    );
    assert.equal(
      fs.existsSync(`${fixture.installerPath}.mineradio-attestation.json`),
      false,
    );
  });

  await t.test('verifier', async () => {
    const fixture = buildFixture();
    await attest(fixture);

    assert.throws(
      () => verify(fixture, {
        gitRunner: fakeGit(fixture.commit, ['server/a.log']),
      }),
      /ignored|package|build\.files|source/i,
    );
  });
});
