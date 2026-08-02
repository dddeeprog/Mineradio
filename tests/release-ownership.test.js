const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const canonicalOwner = 'English-worse';
const canonicalRepo = 'Mineradio';
const canonicalRepoSlug = `${canonicalOwner}/${canonicalRepo}`;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relativePath))).digest('hex').toUpperCase();
}

test('release owner is consistent across package metadata and docs', () => {
  const pkg = readJson('package.json');
  const beta = readJson('build/electron-builder.beta.json');
  const lock = readJson('package-lock.json');
  const publish = Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish;
  const betaPublish = Array.isArray(beta.publish) ? beta.publish[0] : beta.publish;
  const releaseOwnership = readText('docs/RELEASE_OWNERSHIP.md');
  const readme = readText('README.md');

  assert.deepEqual(pkg.repository, {
    type: 'git',
    url: 'https://github.com/English-worse/Mineradio.git',
  });
  assert.equal(pkg.homepage, 'https://github.com/English-worse/Mineradio');
  assert.equal(publish.owner, canonicalOwner);
  assert.equal(publish.repo, canonicalRepo);
  assert.equal(betaPublish.owner, canonicalOwner);
  assert.equal(betaPublish.repo, canonicalRepo);
  assert.equal(beta.extraMetadata.mineradio.update.owner, canonicalOwner);
  assert.equal(beta.extraMetadata.mineradio.update.repo, canonicalRepo);
  assert.equal(pkg.mineradio.update.owner, canonicalOwner);
  assert.equal(pkg.mineradio.update.repo, canonicalRepo);
  assert.equal(pkg.mineradioBuild.releaseOwner, canonicalOwner);
  assert.equal(pkg.mineradioBuild.releaseRepo, canonicalRepo);
  assert.equal(beta.extraMetadata.mineradioBuild.releaseOwner, canonicalOwner);
  assert.equal(beta.extraMetadata.mineradioBuild.releaseRepo, canonicalRepo);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(readme, new RegExp(`https://github\\.com/${canonicalOwner}/${canonicalRepo}/releases`));
  assert.match(releaseOwnership, new RegExp(canonicalRepoSlug.replace('/', '\\/')));
  assert.match(releaseOwnership, new RegExp(`当前版本：\`${pkg.version}\``));
});

test('adapted runtime entry points retain fixed XxHuberrr provenance headers', () => {
  const adaptedFiles = [
    'desktop/app-paths.js',
    'desktop/system-memory-state.js',
    'public/application-assembly.js',
    'public/platform-actions-state.js',
    'public/platform-login-state.js',
    'public/platform-login-ui.js',
    'public/platform-search-state.js',
    'public/platform-search-ui.js',
    'public/resource-governor.js',
    'public/playback-transaction.js',
  ];

  for (const relativePath of adaptedFiles) {
    const header = readText(relativePath).slice(0, 900);
    assert.match(header, /XxHuberrr\/Mineradio/i, relativePath);
    assert.match(header, /4abaa190de42c632365ae4244e041bad16443224/, relativePath);
    assert.match(header, /GPL-3\.0-only/, relativePath);
  }
});

test('source notices enumerate packaged Folia and Pretext acquisition records', () => {
  const notice = readText('NOTICE.md');
  const thirdParty = readText('THIRD_PARTY_NOTICES.md');
  const vendor = readText('docs/VENDOR_MANIFEST.md');

  for (const source of [notice, thirdParty, vendor]) {
    assert.match(source, /baa5e846b7404f1893e8b7812bca79e959f21d3f/);
    assert.match(source, /third_party\/folia-major\/LICENSE/);
    assert.match(source, /public\/vendor\/pretext-0\.0\.7\.LICENSE/);
  }
  assert.match(thirdParty, /安装包|发布包/);
  assert.match(thirdParty, /源码获取|source acquisition/i);
});

test('vendor manifest records every vendored browser bundle', () => {
  const manifest = readText('docs/VENDOR_MANIFEST.md');

  for (const fileName of [
    'gsap.min.js',
    'music-tempo.LICENCE',
    'music-tempo.min.js',
    'pretext-0.0.7.LICENSE',
    'pretext-0.0.7.iife.min.js',
    'three.r128.min.js',
  ]) {
    assert.match(manifest, new RegExp(fileName.replace('.', '[.]')));
  }

  assert.match(manifest, /92BB9A96476F983D212A2BC4F54C889039C1696DD4461D40A736860938570FBB/);
  assert.match(manifest, /9274BBCEC8D96168626C732B5D31C775AA8CFB7EAA0599BEC0C175908A2C1CE2/);
  assert.match(manifest, new RegExp(sha256('public/vendor/pretext-0.0.7.iife.min.js')));
  assert.match(manifest, new RegExp(sha256('public/vendor/pretext-0.0.7.LICENSE')));
});

test('Pretext vendor license has an explicit LF checkout rule', () => {
  const attributes = readText('.gitattributes');

  assert.match(
    attributes,
    /^public\/vendor\/pretext-0\.0\.7\.LICENSE text eol=lf$/m,
  );
});

test('release and security docs describe packaging hardening gates', () => {
  const release = readText('RELEASE.md');
  const security = readText('SECURITY.md');

  assert.match(release, /npm ci/);
  assert.match(release, /npm run verify:release/);
  assert.match(release, /npm run verify:artifacts/);
  assert.match(release, /Get-AuthenticodeSignature/);
  assert.match(release, /Get-FileHash/);
  assert.match(release, /NeteaseCloudMusicApi -> music-metadata@11\.13\.0/);

  assert.match(security, /ASAR/);
  assert.match(security, /快速补丁/);
  assert.match(security, /signed manifest/);
  assert.match(security, /SHA256/);
});
