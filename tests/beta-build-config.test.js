'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

test('stable and beta installers use separate defaults without changing upgrade identity', () => {
  const pkg = readJson('package.json');
  const beta = readJson('build/electron-builder.beta.json');
  const installer = readText('build/installer.nsh');

  assert.equal(`D:\\${pkg.build.productName}`, 'D:\\Mineradio');
  assert.equal(`D:\\${beta.productName}`, 'D:\\Mineradio Beta');
  assert.notEqual(pkg.build.appId, beta.appId);
  assert.notEqual(pkg.mineradioBuild.uninstallKey, beta.extraMetadata.mineradioBuild.uninstallKey);
  assert.notEqual(pkg.mineradioBuild.updateChannel, beta.extraMetadata.mineradioBuild.updateChannel);
  assert.match(installer, /StrCpy \$INSTDIR "D:\\\$\{PRODUCT_NAME\}"/);
  assert.match(installer, /StrCpy \$0 "\$0\\\$\{PRODUCT_NAME\}"/);
  assert.match(installer, /StrCpy \$0 "\$0\$\{PRODUCT_NAME\}"/);
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

test('stable and beta release gates run one critical Playwright acceptance pass', () => {
  const scripts = readJson('package.json').scripts;
  const criticalUiGate = scripts['test:visual:release'];

  assert.equal(typeof criticalUiGate, 'string');
  assert.match(criticalUiGate, /^npm run test:visual -- --grep /);
  for (const requiredFlow of [
    'search, playlist, album, comment',
    'home video persists',
    'platform login fixture is usable',
    'album and comment actions are usable',
    'disabled browser runtime flags',
    'all-source failure retains',
    'commit-stage failure restores listen',
    'Sonic Topography coexists',
    'resource governor round-trips',
    'Cuefield balanced mode',
    'Cuefield setting migrates',
    'wallpaper and complete desktop',
    'settings expose complete desktop controls',
  ]) {
    assert.match(criticalUiGate, new RegExp(requiredFlow));
  }

  assert.doesNotMatch(scripts['test:visual'], /--grep/);
  for (const releaseScript of ['verify:release', 'verify:release:beta']) {
    const steps = scripts[releaseScript].split('&&').map(step => step.trim());
    assert.equal(
      steps.filter(step => step === 'npm run test:visual:release').length,
      1,
      `${releaseScript} must run the critical UI gate exactly once`,
    );
    assert.equal(steps.includes('npm run test:visual'), false);
    assert.ok(
      steps.indexOf('npm run test') < steps.indexOf('npm run test:visual:release'),
      `${releaseScript} must run the UI gate after Node tests`,
    );
    assert.ok(
      steps.indexOf('npm run test:visual:release') < steps.indexOf('npm run audit:prod'),
      `${releaseScript} must run the UI gate before building`,
    );
  }

  assert.doesNotMatch(scripts['build:win'], /test:visual/);
  assert.doesNotMatch(scripts['build:win:beta'], /test:visual/);
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
