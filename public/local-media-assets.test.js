const test = require('node:test');
const assert = require('node:assert/strict');

const localMedia = require('./local-media-assets');

function bytesFromString(text) {
  return Uint8Array.from(Buffer.from(text, 'utf8'));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function fakeFile(name, bytes, type) {
  const raw = Uint8Array.from(bytes);
  return {
    name,
    type: type || '',
    size: raw.length,
    lastModified: 1234,
    slice(start, end) {
      const part = raw.slice(start || 0, end == null ? raw.length : end);
      return {
        async arrayBuffer() {
          return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
        },
      };
    },
  };
}

function synchsafe(size) {
  return Uint8Array.of((size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f);
}

function u32be(value) {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function u24be(value) {
  return Uint8Array.of((value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function u32le(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function id3TextFrame(id, text) {
  const body = concatBytes([Uint8Array.of(3), bytesFromString(text)]);
  return concatBytes([bytesFromString(id), u32be(body.length), Uint8Array.of(0, 0), body]);
}

function id3ApicFrame(imageBytes) {
  const body = concatBytes([
    Uint8Array.of(3),
    bytesFromString('image/jpeg'),
    Uint8Array.of(0, 3),
    bytesFromString('cover'),
    Uint8Array.of(0),
    imageBytes,
  ]);
  return concatBytes([bytesFromString('APIC'), u32be(body.length), Uint8Array.of(0, 0), body]);
}

function makeMp3File() {
  const frames = concatBytes([
    id3TextFrame('TIT2', 'Local Title'),
    id3TextFrame('TPE1', 'Local Artist'),
    id3TextFrame('TALB', 'Local Album'),
    id3ApicFrame(Uint8Array.of(1, 2, 3, 4)),
  ]);
  const header = concatBytes([bytesFromString('ID3'), Uint8Array.of(3, 0, 0), synchsafe(frames.length)]);
  return fakeFile('track.mp3', concatBytes([header, frames, Uint8Array.of(0xff, 0xfb)]), 'audio/mpeg');
}

function flacBlock(type, payload, last) {
  return concatBytes([Uint8Array.of((last ? 0x80 : 0) | type), u24be(payload.length), payload]);
}

function vorbisCommentBlock(comments) {
  const vendor = bytesFromString('Mineradio');
  const parts = [u32le(vendor.length), vendor, u32le(comments.length)];
  comments.forEach((comment) => {
    const data = bytesFromString(comment);
    parts.push(u32le(data.length), data);
  });
  return concatBytes(parts);
}

function pictureBlock(imageBytes) {
  const mime = bytesFromString('image/png');
  const desc = bytesFromString('');
  return concatBytes([
    u32be(3),
    u32be(mime.length),
    mime,
    u32be(desc.length),
    desc,
    u32be(64),
    u32be(64),
    u32be(24),
    u32be(0),
    u32be(imageBytes.length),
    imageBytes,
  ]);
}

function makeFlacFile() {
  const comments = vorbisCommentBlock([
    'TITLE=Flac Title',
    'ARTIST=Flac Artist',
    'ALBUM=Flac Album',
    'LYRICS=[00:00.00]hello flac',
  ]);
  const picture = pictureBlock(Uint8Array.of(9, 8, 7));
  return fakeFile('song.flac', concatBytes([
    bytesFromString('fLaC'),
    flacBlock(4, comments, false),
    flacBlock(6, picture, true),
  ]), 'audio/flac');
}

test('extractLocalMetadata reads MP3 ID3 title, artist, and album', async () => {
  const meta = await localMedia.extractLocalMetadata(makeMp3File());
  assert.deepEqual(meta, {
    title: 'Local Title',
    artist: 'Local Artist',
    album: 'Local Album',
  });
});

test('extractEmbeddedCoverDataUrl reads MP3 APIC image data', async () => {
  const cover = await localMedia.extractEmbeddedCoverDataUrl(makeMp3File());
  assert.equal(cover, 'data:image/jpeg;base64,AQIDBA==');
});

test('extractLocalMetadata and FLAC helpers read Vorbis comments, lyrics, and picture', async () => {
  const file = makeFlacFile();
  assert.deepEqual(await localMedia.extractLocalMetadata(file), {
    title: 'Flac Title',
    artist: 'Flac Artist',
    album: 'Flac Album',
  });
  assert.equal(await localMedia.extractFlacEmbeddedLyricsText(file), '[00:00.00]hello flac');
  assert.equal(await localMedia.extractEmbeddedCoverDataUrl(file), 'data:image/png;base64,CQgH');
});

test('findAdjacentLocalAssets matches same-name lyrics and covers', () => {
  const audio = fakeFile('Album/Track 01.flac', Uint8Array.of(1), 'audio/flac');
  const lrc = fakeFile('Album/Track 01.lrc', bytesFromString('[00:00]line'), 'text/plain');
  const cover = fakeFile('Album/Track 01.jpg', Uint8Array.of(1, 2), 'image/jpeg');
  const unrelated = fakeFile('Album/Other.lrc', bytesFromString('[00:00]no'), 'text/plain');
  const assets = localMedia.findAdjacentLocalAssets(audio, [unrelated, cover, lrc]);
  assert.equal(assets.lyricFile, lrc);
  assert.equal(assets.coverFile, cover);
});

test('findAdjacentLocalAssets ranks a same-directory TTML ahead of LRC regardless of input order', () => {
  const audio = fakeFile('Album/Track.flac', Uint8Array.of(1), 'audio/flac');
  const lrc = fakeFile('Album/Track.lrc', bytesFromString('[00:00]line'), 'text/plain');
  const ttml = fakeFile('Album/Track.ttml', bytesFromString('<tt></tt>'), 'application/ttml+xml');
  const assets = localMedia.findAdjacentLocalAssets(audio, [lrc, ttml]);
  assert.equal(assets.lyricFile, ttml);
  assert.deepEqual(assets.lyricCandidates, [ttml, lrc]);
});

test('findAdjacentLocalAssets stabilizes same-priority case-only lyric path conflicts', () => {
  const audio = fakeFile('Album/Track.flac', Uint8Array.of(1), 'audio/flac');
  const upper = fakeFile('Album/Track.LRC', bytesFromString('[00:00]upper'), 'text/plain');
  const lower = fakeFile('album/track.lrc', bytesFromString('[00:00]lower'), 'text/plain');
  function orderedPaths(files) {
    return localMedia.findAdjacentLocalAssets(audio, files).lyricCandidates.map((file) => file.name);
  }
  assert.deepEqual(orderedPaths([upper, lower]), ['Album/Track.LRC', 'album/track.lrc']);
  assert.deepEqual(orderedPaths([lower, upper]), ['Album/Track.LRC', 'album/track.lrc']);
});

test('findAdjacentLocalAssets does not infer same-directory matches from bare File names', () => {
  const audio = fakeFile('Track.flac', Uint8Array.of(1), 'audio/flac');
  const ttml = fakeFile('Track.ttml', bytesFromString('<tt></tt>'), 'application/ttml+xml');
  const assets = localMedia.findAdjacentLocalAssets(audio, [ttml]);
  assert.equal(assets.lyricFile, null);
  assert.deepEqual(assets.lyricCandidates, []);
});

test('findAdjacentLocalAssets retains legacy TXT only as a fallback outside lyricCandidates', () => {
  const audio = fakeFile('Album/Track.flac', Uint8Array.of(1), 'audio/flac');
  const legacyTxt = fakeFile('Album/Track.txt', bytesFromString('line'), 'text/plain');
  const lrc = fakeFile('Album/Track.lrc', bytesFromString('[00:00]line'), 'text/plain');
  const txtFallback = localMedia.findAdjacentLocalAssets(audio, [legacyTxt]);
  const preferredLrc = localMedia.findAdjacentLocalAssets(audio, [legacyTxt, lrc]);
  assert.equal(txtFallback.lyricFile, legacyTxt);
  assert.deepEqual(txtFallback.lyricCandidates, []);
  assert.equal(preferredLrc.lyricFile, lrc);
  assert.deepEqual(preferredLrc.lyricCandidates, [lrc]);
  assert.equal(preferredLrc.legacyTxtFile, legacyTxt);
});

test('findAdjacentLocalAssets rejects traversal-path TTML, LRC and legacy TXT candidates', () => {
  const audio = fakeFile('Album/../Other/Track.flac', Uint8Array.of(1), 'audio/flac');
  const ttml = fakeFile('Album/../Other/Track.ttml', bytesFromString('<tt></tt>'), 'application/ttml+xml');
  const lrc = fakeFile('Album/../Other/Track.lrc', bytesFromString('[00:00]line'), 'text/plain');
  const legacyTxt = fakeFile('Album/../Other/Track.txt', bytesFromString('line'), 'text/plain');
  const assets = localMedia.findAdjacentLocalAssets(audio, [ttml, lrc, legacyTxt]);
  assert.equal(assets.lyricFile, null);
  assert.deepEqual(assets.lyricCandidates, []);
});

test('findAdjacentLocalAssets retains bare-name cover selection for direct imports', () => {
  const audio = fakeFile('Track.flac', Uint8Array.of(1), 'audio/flac');
  const cover = fakeFile('Track.jpg', Uint8Array.of(1), 'image/jpeg');
  assert.equal(localMedia.findAdjacentLocalAssets(audio, [cover]).coverFile, cover);
});

function createMediaHarness(initialRecord) {
  let record = initialRecord || null;
  let putError = null;
  let nextUrl = 0;
  const revoked = [];
  const fallback = [];
  const listeners = new Map();
  const media = {
    src: '',
    paused: true,
    loadCount: 0,
    playCount: 0,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
    load() {
      this.loadCount += 1;
    },
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      this.playCount += 1;
      return Promise.resolve();
    },
    emit(type) {
      const listener = listeners.get(type);
      if (listener) listener({ type });
    },
  };
  const store = {
    async get() {
      return record;
    },
    async put(id, blob, meta) {
      if (putError) throw putError;
      record = { id, blob, meta };
    },
    async delete() {
      record = null;
    },
  };
  const runtime = localMedia.createStoredVideoRuntime({
    id: 'home-visual',
    maxBytes: 300,
    store,
    urlApi: {
      createObjectURL() {
        nextUrl += 1;
        return 'blob:media-' + nextUrl;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    onFallback(reason) {
      fallback.push(reason);
    },
  });
  return {
    fallback,
    getRecord: () => record,
    media,
    revoked,
    runtime,
    setPutError(error) {
      putError = error;
    },
  };
}

function videoFile(name, type, size = 120) {
  return { name, type, size };
}

test('stored video runtime validates MP4, WebM, and MOV before IndexedDB storage', async () => {
  const harness = createMediaHarness();
  for (const [name, type] of [
    ['home.mp4', 'video/mp4'],
    ['home.webm', 'video/webm'],
    ['home.mov', 'video/quicktime'],
  ]) {
    const result = await harness.runtime.save(videoFile(name, type));
    assert.equal(result.ok, true);
    assert.equal(harness.getRecord().meta.name, name);
  }
  await assert.rejects(
    harness.runtime.save(videoFile('home.avi', 'video/x-msvideo')),
    error => error && error.code === 'VIDEO_TYPE_UNSUPPORTED',
  );
  await assert.rejects(
    harness.runtime.save(videoFile('huge.mp4', 'video/mp4', 301)),
    error => error && error.code === 'VIDEO_TOO_LARGE',
  );
});

test('stored video runtime restores from storage and revokes replaced object URLs', async () => {
  const harness = createMediaHarness({
    id: 'home-visual',
    blob: videoFile('restored.mp4', 'video/mp4'),
    meta: { name: 'restored.mp4', type: 'video/mp4', size: 120 },
  });

  assert.equal((await harness.runtime.resume(harness.media)).ok, true);
  assert.equal(harness.media.src, 'blob:media-1');
  await harness.runtime.save(videoFile('replacement.webm', 'video/webm'));
  assert.equal((await harness.runtime.attach(harness.media)).ok, true);
  assert.equal(harness.media.src, 'blob:media-2');
  assert.deepEqual(harness.revoked, ['blob:media-1']);
});

test('stored video runtime falls back on decode failure and can resume after release', async () => {
  const harness = createMediaHarness({
    id: 'home-visual',
    blob: videoFile('visual.mov', 'video/quicktime'),
    meta: { name: 'visual.mov', type: 'video/quicktime', size: 120 },
  });

  await harness.runtime.resume(harness.media);
  harness.media.emit('error');
  assert.equal(harness.media.src, '');
  assert.equal(harness.runtime.snapshot().decodeFailed, true);
  assert.deepEqual(harness.fallback, ['VIDEO_DECODE_FAILED']);
  assert.deepEqual(harness.revoked, ['blob:media-1']);

  harness.runtime.release();
  assert.equal(harness.runtime.snapshot().released, true);
  const blocked = await harness.runtime.attach(harness.media);
  assert.equal(blocked.reason, 'BACKGROUND_RELEASED');

  const resumed = await harness.runtime.resume(harness.media);
  assert.equal(resumed.ok, true);
  assert.equal(harness.media.src, 'blob:media-2');
  assert.equal(harness.runtime.snapshot().released, false);
});

test('stored video runtime keeps the current attachment when replacement storage fails', async () => {
  const harness = createMediaHarness({
    id: 'home-visual',
    blob: videoFile('current.mp4', 'video/mp4'),
    meta: { name: 'current.mp4', type: 'video/mp4', size: 120 },
  });
  await harness.runtime.resume(harness.media);
  harness.setPutError(new Error('quota exceeded'));

  await assert.rejects(
    harness.runtime.save(videoFile('replacement.webm', 'video/webm')),
    /quota exceeded/,
  );

  assert.equal(harness.media.src, 'blob:media-1');
  assert.equal(harness.runtime.snapshot().attached, true);
  assert.deepEqual(harness.revoked, []);
});
