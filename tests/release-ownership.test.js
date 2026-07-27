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
  const lock = readJson('package-lock.json');
  const publish = Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish;
  const releaseOwnership = readText('docs/RELEASE_OWNERSHIP.md');
  const readme = readText('README.md');

  assert.equal(publish.owner, canonicalOwner);
  assert.equal(publish.repo, canonicalRepo);
  assert.equal(pkg.mineradio.update.owner, canonicalOwner);
  assert.equal(pkg.mineradio.update.repo, canonicalRepo);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(readme, new RegExp(`https://github\\.com/${canonicalOwner}/${canonicalRepo}/releases`));
  assert.match(releaseOwnership, new RegExp(canonicalRepoSlug.replace('/', '\\/')));
  assert.match(releaseOwnership, new RegExp(`当前版本：\`${pkg.version}\``));
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
