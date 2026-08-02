const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('NeteaseCloudMusicApi metadata parser is overridden to the audited-safe line', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const override = pkg.overrides && pkg.overrides.NeteaseCloudMusicApi;
  const installed = lock.packages['node_modules/music-metadata'];
  const fileType = lock.packages['node_modules/file-type'];

  assert.equal(override && override['music-metadata'], '11.13.0');
  assert.ok(installed, 'music-metadata must remain installed for NeteaseCloudMusicApi cloud upload');
  assert.match(installed.version, /^11\./);
  assert.ok(fileType, 'file-type must remain installed through music-metadata');
  assert.ok(Number(fileType.version.split('.')[0]) >= 21);
});

test('overridden music-metadata remains CommonJS-loadable for NeteaseCloudMusicApi cloud upload', () => {
  const musicMetadata = require('music-metadata');

  assert.equal(typeof musicMetadata.parseBuffer, 'function');
});
