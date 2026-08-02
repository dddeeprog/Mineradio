'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  WallpaperEngineLibrary,
  parseByteRange,
} = require('./wallpaper-engine-library');

test('indexes a manually imported Wallpaper Engine video without copying its media', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-we-library-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({
    title: 'Test Wallpaper',
    type: 'video',
    file: 'scene.mp4',
    preview: 'preview.png',
  }));
  fs.writeFileSync(path.join(projectRoot, 'scene.mp4'), Buffer.from([0, 1, 2, 3, 4, 5]));
  fs.writeFileSync(path.join(projectRoot, 'preview.png'), Buffer.from([137, 80, 78, 71]));

  const library = new WallpaperEngineLibrary({
    userDataPath: root,
    configPath: path.join(root, 'wallpaper-library.json'),
    autoDiscover: false,
  });
  t.after(() => library.dispose());

  const snapshot = await library.addManualRoot(projectRoot);

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.projects[0].title, 'Test Wallpaper');
  assert.equal(snapshot.projects[0].playable, true);
  assert.equal(snapshot.projects[0].enginePlayable, false);
  assert.match(snapshot.mediaToken, /^[a-f0-9]{48}$/);

  const response = await library.mediaResponse(new Request(
    `mineradio-wallpaper://media/${snapshot.projects[0].id}?token=${snapshot.mediaToken}`,
    { headers: { Range: 'bytes=1-3' } }
  ));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 1-3/6');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test('normalizes bounded byte ranges for Wallpaper Engine media', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=20-30', 10), { invalid: true });
});
