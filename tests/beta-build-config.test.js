'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function fakeApp(appData, calls) {
  return {
    setName(name) {
      calls.push(['setName', name]);
    },
    getPath(name) {
      assert.equal(name, 'appData');
      return appData;
    },
    setPath(name, value) {
      calls.push(['setPath', name, value]);
    },
  };
}

test('stable and beta desktop build profiles are isolated but retain one release owner', () => {
  const pkg = readJson('package.json');
  const beta = readJson('build/electron-builder.beta.json');
  const diagnostics = require('../build/desktop-diagnostics');
  const report = diagnostics.createDesktopBuildDiagnostics(pkg, beta);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.repository.owner, 'English-worse');
  assert.equal(report.repository.repo, 'Mineradio');
  assert.equal(report.profiles.stable.channel, 'stable');
  assert.equal(report.profiles.beta.channel, 'beta');

  for (const key of [
    'appId',
    'productName',
    'userDataRoot',
    'uninstallKey',
    'updateChannel',
    'artifactName',
    'outputDirectory',
  ]) {
    assert.notEqual(
      report.profiles.stable[key],
      report.profiles.beta[key],
      `${key} must be isolated`,
    );
  }

  assert.equal(report.profiles.stable.appId, 'com.mineradio.desktop');
  assert.equal(report.profiles.beta.appId, 'com.mineradio.desktop.beta');
  assert.equal(report.profiles.beta.productName, 'Mineradio Beta');
  assert.equal(report.profiles.beta.userDataRoot, 'Mineradio Beta');
  assert.equal(report.profiles.beta.outputDirectory, 'dist-beta');
  assert.equal(report.profiles.beta.updateChannel, 'beta');
  assert.match(report.profiles.beta.artifactName, /^Mineradio-Beta-/);
  assert.match(report.profiles.beta.uninstallKey, /^[0-9a-f-]{36}$/i);
  assert.equal(report.profiles.beta.publish.owner, 'English-worse');
  assert.equal(report.profiles.beta.publish.repo, 'Mineradio');
  assert.equal(report.profiles.beta.publish.channel, 'beta');
});

test('beta metadata drives a separate runtime data root and application identity', () => {
  const appPaths = require('../desktop/app-paths');
  const pkg = readJson('package.json');
  const beta = readJson('build/electron-builder.beta.json');
  const betaPackage = Object.assign({}, pkg, beta.extraMetadata);
  const appData = path.join('C:', 'Users', 'Tomato', 'AppData', 'Roaming');
  const stableCalls = [];
  const betaCalls = [];

  const stableIdentity = appPaths.resolveDesktopBuildIdentity({ packageMetadata: pkg });
  const betaIdentity = appPaths.resolveDesktopBuildIdentity({ packageMetadata: betaPackage });
  const stablePaths = appPaths.configureStableAppPaths(fakeApp(appData, stableCalls), {
    createDirectory() {},
    identity: stableIdentity,
  });
  const betaPaths = appPaths.configureStableAppPaths(fakeApp(appData, betaCalls), {
    createDirectory() {},
    identity: betaIdentity,
  });

  assert.deepEqual(stableIdentity, {
    channel: 'stable',
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    userDataRoot: 'Mineradio',
  });
  assert.deepEqual(betaIdentity, {
    channel: 'beta',
    productName: 'Mineradio Beta',
    appId: 'com.mineradio.desktop.beta',
    userDataRoot: 'Mineradio Beta',
  });
  assert.equal(stablePaths.userData, path.join(appData, 'Mineradio'));
  assert.equal(betaPaths.userData, path.join(appData, 'Mineradio Beta'));
  assert.notEqual(stablePaths.userData, betaPaths.userData);
  assert.deepEqual(stableCalls[0], ['setName', 'Mineradio']);
  assert.deepEqual(betaCalls[0], ['setName', 'Mineradio Beta']);
});

test('runtime updater resolves GitHub endpoints from the packaged update channel', () => {
  const helperPath = path.join(repoRoot, 'server', 'update-channel.js');
  const updateChannel = fs.existsSync(helperPath) ? require(helperPath) : {};

  assert.equal(typeof updateChannel.createGithubUpdatePlan, 'function');

  const stable = updateChannel.createGithubUpdatePlan({
    owner: 'English-worse',
    repo: 'Mineradio',
    channel: 'latest',
  });
  const beta = updateChannel.createGithubUpdatePlan({
    owner: 'English-worse',
    repo: 'Mineradio',
    channel: 'beta',
  });

  assert.deepEqual(stable, {
    channel: 'latest',
    manifestName: 'latest.yml',
    releaseApiUrl: 'https://api.github.com/repos/English-worse/Mineradio/releases/latest',
    fallbackManifestUrl:
      'https://github.com/English-worse/Mineradio/releases/latest/download/latest.yml',
  });
  assert.deepEqual(beta, {
    channel: 'beta',
    manifestName: 'beta.yml',
    releaseApiUrl: 'https://api.github.com/repos/English-worse/Mineradio/releases?per_page=20',
    fallbackManifestUrl: '',
  });
});

test('stable and beta release commands run complete non-publishing gates', () => {
  const scripts = readJson('package.json').scripts;

  assert.equal(
    scripts['build:win:beta'],
    'electron-builder --config build/electron-builder.beta.json --win nsis --publish never',
  );
  assert.equal(
    scripts['build:win:beta:dir'],
    'electron-builder --config build/electron-builder.beta.json --win dir --publish never',
  );
  assert.match(scripts['verify:release'], /npm run diagnostics:desktop/);
  assert.match(scripts['verify:release:beta'], /npm run diagnostics:desktop/);
  assert.match(scripts['verify:release:beta'], /npm run check/);
  assert.match(scripts['verify:release:beta'], /npm run test/);
  assert.match(scripts['verify:release:beta'], /npm run audit:prod/);
  assert.match(scripts['verify:release:beta'], /npm run build:win:beta/);
  assert.match(scripts['verify:release:beta'], /verify:artifacts -- --beta --fresh/);
  assert.doesNotMatch(scripts['build:win:beta'], /publish (?!never)/);
});

test('every required license and source acquisition record is packaged in both profiles', () => {
  const pkg = readJson('package.json');
  const beta = readJson('build/electron-builder.beta.json');
  const required = [
    'LICENSE',
    'NOTICE.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/VENDOR_MANIFEST.md',
    'third_party/folia-major/LICENSE',
    'third_party/folia-major/README.md',
    'public/vendor/pretext-0.0.7.LICENSE',
  ];

  for (const material of required) {
    assert.ok(pkg.build.files.includes(material), `stable package is missing ${material}`);
    assert.ok(beta.files.includes(material), `beta package is missing ${material}`);
  }
  assert.match(
    fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    /baa5e846b7404f1893e8b7812bca79e959f21d3f/,
  );
});
