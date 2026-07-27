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
});

test('findAdjacentLocalAssets retains bare-name cover selection for direct imports', () => {
  const audio = fakeFile('Track.flac', Uint8Array.of(1), 'audio/flac');
  const cover = fakeFile('Track.jpg', Uint8Array.of(1), 'image/jpeg');
  assert.equal(localMedia.findAdjacentLocalAssets(audio, [cover]).coverFile, cover);
});
