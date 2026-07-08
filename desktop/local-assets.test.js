const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createLocalAssetsManager,
  createLocalFileProxyUrl,
  localFilePathFromProxyUrl,
  parseLocalFileRangeHeader,
} = require('./local-assets');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-local-assets-'));
}

function cleanup(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

test('authorized roots allow only files inside remembered music folders', () => {
  const root = makeTempRoot();
  const sibling = `${root}-sibling`;
  try {
    fs.mkdirSync(sibling);
    const inside = path.join(root, 'song.mp3');
    const outside = path.join(sibling, 'song.mp3');
    fs.writeFileSync(inside, 'inside');
    fs.writeFileSync(outside, 'outside');

    const manager = createLocalAssetsManager();
    assert.equal(manager.rememberLocalMusicRoot(root), path.resolve(root));
    assert.equal(manager.resolveAuthorizedLocalFile(inside), path.resolve(inside));
    assert.throws(
      () => manager.resolveAuthorizedLocalFile(outside),
      /LOCAL_FILE_NOT_AUTHORIZED/,
    );
    assert.throws(
      () => manager.resolveAuthorizedLocalFile(path.join(root, '..', path.basename(sibling), 'song.mp3')),
      /LOCAL_FILE_NOT_AUTHORIZED/,
    );
  } finally {
    cleanup(root);
    cleanup(sibling);
  }
});

test('scanLocalMusicFolder returns sorted audio records and adjacent asset records', async () => {
  const root = makeTempRoot();
  try {
    fs.mkdirSync(path.join(root, 'disc'));
    fs.writeFileSync(path.join(root, 'disc', 'b.flac'), 'flac');
    fs.writeFileSync(path.join(root, 'disc', 'a.mp3'), 'mp3');
    fs.writeFileSync(path.join(root, 'disc', 'cover.jpg'), 'jpg');
    fs.writeFileSync(path.join(root, 'disc', 'a.lrc'), '[00:00]hello');
    fs.writeFileSync(path.join(root, 'disc', 'ignore.doc'), 'doc');

    const manager = createLocalAssetsManager({
      proxyUrlForFile(filePath) {
        return `local://${path.basename(filePath)}`;
      },
    });
    const result = await manager.scanLocalMusicFolder(root);

    assert.equal(result.ok, true);
    assert.equal(result.folderPath, path.resolve(root));
    assert.deepEqual(result.files.map((file) => file.name), ['a.mp3', 'b.flac']);
    assert.deepEqual(result.files.map((file) => file.url), ['local://a.mp3', 'local://b.flac']);
    assert.deepEqual(result.assets.map((file) => file.name), ['a.lrc', 'cover.jpg']);
    assert.equal(result.files[0].relativePath.replace(/\\/g, '/'), `${path.basename(root)}/disc/a.mp3`);
    assert.ok(result.directories.some((dir) => dir.relativePath === 'disc'));
  } finally {
    cleanup(root);
  }
});

test('createLocalFileProxyUrl uses the app protocol instead of file URLs', () => {
  const root = makeTempRoot();
  try {
    const file = path.join(root, 'song.mp3');
    const url = createLocalFileProxyUrl(file);

    assert.match(url, /^mineradio-local:\/\/file\/\?path=/);
    assert.equal(url.startsWith('file:'), false);
    assert.equal(localFilePathFromProxyUrl(url), path.resolve(file));
  } finally {
    cleanup(root);
  }
});

test('readAuthorizedLocalFileRange clamps reads and returns base64 bytes', async () => {
  const root = makeTempRoot();
  try {
    const file = path.join(root, 'song.mp3');
    fs.writeFileSync(file, Buffer.from('abcdef'));
    const manager = createLocalAssetsManager({ maxRangeBytes: 4 });
    manager.rememberLocalMusicRoot(root);

    const middle = await manager.readAuthorizedLocalFileRange(file, 1, 4);
    assert.deepEqual(
      { ok: middle.ok, size: middle.size, start: middle.start, end: middle.end, text: Buffer.from(middle.base64, 'base64').toString('utf8') },
      { ok: true, size: 6, start: 1, end: 4, text: 'bcd' },
    );

    const capped = await manager.readAuthorizedLocalFileRange(file, 0, 100);
    assert.deepEqual(
      { start: capped.start, end: capped.end, text: Buffer.from(capped.base64, 'base64').toString('utf8') },
      { start: 0, end: 4, text: 'abcd' },
    );
  } finally {
    cleanup(root);
  }
});

test('parseLocalFileRangeHeader normalizes common byte range requests', () => {
  assert.deepEqual(parseLocalFileRangeHeader('', 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(parseLocalFileRangeHeader('bytes=10-19', 100), { start: 10, end: 19, partial: true });
  assert.deepEqual(parseLocalFileRangeHeader('bytes=95-', 100), { start: 95, end: 99, partial: true });
  assert.deepEqual(parseLocalFileRangeHeader('bytes=-8', 100), { start: 92, end: 99, partial: true });
  assert.equal(parseLocalFileRangeHeader('items=1-2', 100), null);
  assert.equal(parseLocalFileRangeHeader('bytes=200-220', 100), null);
});

test('readAuthorizedLocalFileDataUrl allows bounded images only', async () => {
  const root = makeTempRoot();
  try {
    const image = path.join(root, 'cover.jpg');
    const text = path.join(root, 'lyric.lrc');
    fs.writeFileSync(image, Buffer.from([1, 2, 3]));
    fs.writeFileSync(text, 'lyric');

    const manager = createLocalAssetsManager({ maxImageBytes: 3 });
    manager.rememberLocalMusicRoot(root);
    assert.equal(
      await manager.readAuthorizedLocalFileDataUrl(image).then((result) => result.dataUrl),
      'data:image/jpeg;base64,AQID',
    );
    assert.rejects(() => manager.readAuthorizedLocalFileDataUrl(text), /LOCAL_FILE_NOT_IMAGE/);

    const strictManager = createLocalAssetsManager({ maxImageBytes: 2 });
    strictManager.rememberLocalMusicRoot(root);
    await assert.rejects(() => strictManager.readAuthorizedLocalFileDataUrl(image), /LOCAL_IMAGE_TOO_LARGE/);
  } finally {
    cleanup(root);
  }
});
