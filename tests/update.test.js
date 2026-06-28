const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applyPatchFiles,
  assertPatchPackageDigest,
  compareVersions,
  normalizePatchPayload,
  normalizeVersion,
  pickPatchAsset,
  pickReleaseAsset,
  safePatchRelativePath,
  safeUpdateFileName,
  sha256Hex,
} = require('../server/update');

function hash(value) {
  return crypto.createHash('sha256').update(Buffer.from(value)).digest('hex');
}

function patchFile(filePath, content, extra = {}) {
  return {
    path: filePath,
    content,
    sha256: hash(content),
    ...extra,
  };
}

test('version helpers normalize and compare release versions', () => {
  assert.equal(normalizeVersion('v1.2.3-beta.1+build.9'), '1.2.3');
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.2.1'), -1);
});

test('release asset picker prefers installer assets and normalizes digest fields', () => {
  const asset = pickReleaseAsset([
    { name: 'notes.txt', browser_download_url: 'https://example.test/notes.txt' },
    {
      name: 'Mineradio-1.2.0-Setup.exe',
      size: 42,
      content_type: 'application/octet-stream',
      browser_download_url: 'https://example.test/Mineradio.exe',
      digest: 'sha256: ABCD ',
    },
  ], {
    downloadUrlsFor: url => [url, `${url}?mirror=1`],
  });

  assert.equal(asset.name, 'Mineradio-1.2.0-Setup.exe');
  assert.equal(asset.sha256, 'abcd');
  assert.deepEqual(asset.downloadUrls, [
    'https://example.test/Mineradio.exe',
    'https://example.test/Mineradio.exe?mirror=1',
  ]);
});

test('patch asset picker matches current and target versions', () => {
  const patch = pickPatchAsset([
    { name: 'Mineradio-1.0.0-to-1.3.0.patch.json', browser_download_url: 'https://example.test/wrong.patch.json' },
    {
      name: 'Mineradio-1.1.0-to-1.2.0.patch.json',
      browser_download_url: 'https://example.test/right.patch.json',
      sha512: 'sha512: xyz',
    },
  ], '1.1.0', '1.2.0', {
    downloadUrlsFor: url => [url],
  });

  assert.equal(patch.name, 'Mineradio-1.1.0-to-1.2.0.patch.json');
  assert.equal(patch.sha512, 'xyz');
});

test('update filenames and patch paths are fail-closed', () => {
  assert.equal(safeUpdateFileName('Mineradio<>:"/\\|?*.exe', '1.2.0'), 'Mineradio---------.exe');
  assert.equal(safePatchRelativePath('public/app.js'), 'public/app.js');
  assert.equal(safePatchRelativePath('server.js'), 'server.js');
  assert.equal(safePatchRelativePath('../server.js'), '');
  assert.equal(safePatchRelativePath('/public/../server.js'), '');
  assert.equal(safePatchRelativePath('public/tool.exe'), '');
  assert.equal(safePatchRelativePath('unknown/file.js'), '');
});

test('patch payload rejects mismatched versions and missing package digest', () => {
  assert.throws(() => assertPatchPackageDigest({}), /PATCH_DIGEST_MISSING/);
  assert.deepEqual(assertPatchPackageDigest({ sha256: 'sha256: ABCD' }), { sha256: 'abcd', sha512: '' });

  assert.throws(() => normalizePatchPayload({
    type: 'mineradio-resource-patch',
    from: '1.0.0',
    to: '1.2.0',
    files: [patchFile('public/app.js', 'next')],
  }, { currentVersion: '1.1.0' }), /PATCH_VERSION_MISMATCH/);

  assert.throws(() => normalizePatchPayload({
    type: 'mineradio-resource-patch',
    from: '1.1.0',
    to: '1.1.0',
    files: [patchFile('public/app.js', 'next')],
  }, { currentVersion: '1.1.0' }), /PATCH_TARGET_VERSION_INVALID/);
});

test('patch application requires per-file hashes and restores files if replace fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-patch-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'a.txt'), 'old-a');
  fs.writeFileSync(path.join(root, 'public', 'b.txt'), 'old-b');

  assert.throws(() => applyPatchFiles([
    { path: 'public/a.txt', content: 'new-a' },
  ], { rootDir: root, backupDir: path.join(root, '.backup') }), /PATCH_FILE_HASH_REQUIRED/);

  assert.throws(() => applyPatchFiles([
    patchFile('public/a.txt', 'new-a'),
    patchFile('public/b.txt', 'new-b'),
  ], {
    rootDir: root,
    backupDir: path.join(root, '.backup-fail'),
    replaceFile: (tmp, target, item) => {
      if (item.rel === 'public/b.txt') throw new Error('SIMULATED_REPLACE_FAILURE');
      fs.renameSync(tmp, target);
    },
  }), /SIMULATED_REPLACE_FAILURE/);

  assert.equal(fs.readFileSync(path.join(root, 'public', 'a.txt'), 'utf8'), 'old-a');
  assert.equal(fs.readFileSync(path.join(root, 'public', 'b.txt'), 'utf8'), 'old-b');

  const changed = applyPatchFiles([
    patchFile('public/a.txt', 'new-a'),
    patchFile('public/b.txt', 'new-b'),
  ], { rootDir: root, backupDir: path.join(root, '.backup-ok') });

  assert.deepEqual(changed, ['public/a.txt', 'public/b.txt']);
  assert.equal(fs.readFileSync(path.join(root, 'public', 'a.txt'), 'utf8'), 'new-a');
  assert.equal(sha256Hex(fs.readFileSync(path.join(root, 'public', 'b.txt'))), hash('new-b'));
});
