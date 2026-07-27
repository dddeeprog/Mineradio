(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MineradioLocalMediaAssets = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  var DEFAULT_ID3_MAX_BYTES = 32 * 1024 * 1024;
  var DEFAULT_FLAC_MAX_BYTES = 32 * 1024 * 1024;
  var LIGHT_FLAC_MAX_BYTES = 2 * 1024 * 1024;
  var DEFAULT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
  var LYRIC_EXTS = { lrc: true, ttml: true };
  var lyricFileState = (typeof globalThis !== 'undefined' && globalThis.MineradioLocalLyricFileState) ||
    (typeof require === 'function' ? require('./local-lyric-file-state') : null);
  var COVER_EXTS = { jpg: true, jpeg: true, png: true, webp: true };
  var COVER_BASENAME_PRIORITY = {
    cover: 1,
    folder: 2,
    front: 3,
    album: 4,
  };

  function normalizeOptions(options) {
    if (!options) return {};
    if (typeof options.readLocalFileRange === 'function' || typeof options.readLocalFileDataUrl === 'function') {
      return { api: options };
    }
    return options;
  }

  function getFilePath(file) {
    return file && (file.fullPath || file.filePath || file.path || file.localFilePathAbsolute || '');
  }

  function getFileDisplayPath(file) {
    return String(
      (file && (file.webkitRelativePath || file.relativePath || file.fullPath || file.filePath || file.path || file.name)) || ''
    ).replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function getFileName(file) {
    var displayPath = getFileDisplayPath(file);
    var parts = displayPath.split('/');
    return parts[parts.length - 1] || String((file && file.name) || '');
  }

  function getExtFromName(name) {
    var match = String(name || '').toLowerCase().match(/\.([^.\/\\]+)$/);
    return match ? match[1] : '';
  }

  function getExt(file) {
    return getExtFromName(getFileDisplayPath(file) || getFileName(file));
  }

  function stripExt(name) {
    return String(name || '').replace(/\.[^.\/\\]+$/, '');
  }

  function pathParts(file) {
    var filePath = getFileDisplayPath(file);
    var slash = filePath.lastIndexOf('/');
    var name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
    return {
      path: filePath,
      dir: slash >= 0 ? filePath.slice(0, slash).toLowerCase() : '',
      name: name,
      base: stripExt(name).toLowerCase(),
      ext: getExtFromName(name),
    };
  }

  function hasTextDecoder(label) {
    if (typeof TextDecoder !== 'function') return false;
    try {
      new TextDecoder(label);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function decodeBytes(bytes, label) {
    if (!bytes || !bytes.length) return '';
    if (typeof Buffer !== 'undefined') {
      try {
        return Buffer.from(bytes).toString(label === 'latin1' ? 'latin1' : label);
      } catch (_e) {}
    }
    if (typeof TextDecoder === 'function' && hasTextDecoder(label)) {
      return new TextDecoder(label).decode(bytes);
    }
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return text;
  }

  function decodeUtf16be(bytes) {
    var swapped = new Uint8Array(bytes.length);
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      swapped[i] = bytes[i + 1];
      swapped[i + 1] = bytes[i];
    }
    return decodeBytes(swapped, 'utf16le');
  }

  function decodeTextByEncoding(bytes, encoding) {
    if (!bytes || !bytes.length) return '';
    if (encoding === 1) {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeBytes(bytes.slice(2), 'utf16le');
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16be(bytes.slice(2));
      return decodeBytes(bytes, 'utf16le');
    }
    if (encoding === 2) return decodeUtf16be(bytes);
    if (encoding === 3) return decodeBytes(bytes, 'utf8');
    return decodeBytes(bytes, 'latin1');
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/\u0000+/g, ' / ')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\s+\/\s+$/g, '');
  }

  function bytesToBase64(bytes) {
    if (!bytes || !bytes.length) return '';
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var binary = '';
    var chunkSize = 0x8000;
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var chunk = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
      binary += String.fromCharCode.apply(null, Array.prototype.slice.call(chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    if (!base64) return new Uint8Array();
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(base64, 'base64'));
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToDataUrl(bytes, mime) {
    return 'data:' + (mime || detectImageMime(bytes) || 'application/octet-stream') + ';base64,' + bytesToBase64(bytes);
  }

  function ascii(bytes, start, end) {
    var text = '';
    for (var i = start || 0; i < (end == null ? bytes.length : end); i++) text += String.fromCharCode(bytes[i]);
    return text;
  }

  function u24be(bytes, offset) {
    return ((bytes[offset] || 0) << 16) | ((bytes[offset + 1] || 0) << 8) | (bytes[offset + 2] || 0);
  }

  function u32be(bytes, offset) {
    return (((bytes[offset] || 0) * 0x1000000) + (((bytes[offset + 1] || 0) << 16) | ((bytes[offset + 2] || 0) << 8) | (bytes[offset + 3] || 0))) >>> 0;
  }

  function u32le(bytes, offset) {
    return ((bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) | ((bytes[offset + 2] || 0) << 16) | ((bytes[offset + 3] || 0) << 24)) >>> 0;
  }

  function synchsafe(bytes, offset) {
    return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
  }

  function detectImageMime(bytes) {
    if (!bytes || bytes.length < 4) return '';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
    return '';
  }

  function imageMimeFromFile(file) {
    var ext = getExt(file);
    if (file && /^image\//.test(file.type || '')) return file.type;
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return '';
  }

  async function readLocalFileBytes(file, start, end, options) {
    var opts = normalizeOptions(options);
    var api = opts.api || null;
    var from = Math.max(0, Number(start) || 0);
    var to = end == null ? (file && Number.isFinite(Number(file.size)) ? Number(file.size) : undefined) : Math.max(from, Number(end) || 0);
    var filePath = getFilePath(file);
    if (api && typeof api.readLocalFileRange === 'function' && filePath) {
      var result = await api.readLocalFileRange(filePath, from, to);
      if (result && result.base64) return base64ToBytes(result.base64);
    }
    if (file && typeof file.slice === 'function') {
      var blob = file.slice(from, to);
      if (blob && typeof blob.arrayBuffer === 'function') {
        return new Uint8Array(await blob.arrayBuffer());
      }
    }
    if (file && typeof file.arrayBuffer === 'function') {
      var all = new Uint8Array(await file.arrayBuffer());
      return all.slice(from, to == null ? all.length : to);
    }
    throw new Error('LOCAL_FILE_BYTES_UNAVAILABLE');
  }

  async function readLocalHeadBytes(file, maxBytes, options) {
    var size = file && Number.isFinite(Number(file.size)) ? Number(file.size) : maxBytes;
    return readLocalFileBytes(file, 0, Math.min(size, maxBytes), options);
  }

  async function readTextFile(file, options) {
    var opts = normalizeOptions(options);
    var maxBytes = Math.max(1, Number(opts.maxBytes) || DEFAULT_TEXT_MAX_BYTES);
    var bytes = await readLocalHeadBytes(file, maxBytes, opts);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeBytes(bytes.slice(3), 'utf8');
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeBytes(bytes.slice(2), 'utf16le');
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16be(bytes.slice(2));
    return decodeBytes(bytes, 'utf8');
  }

  async function readImageFileDataUrl(file, options) {
    var opts = normalizeOptions(options);
    var api = opts.api || null;
    var filePath = getFilePath(file);
    if (api && typeof api.readLocalFileDataUrl === 'function' && filePath) {
      var result = await api.readLocalFileDataUrl(filePath);
      if (result && result.dataUrl) return result.dataUrl;
    }
    var bytes = await readLocalFileBytes(file, 0, file && file.size, opts);
    return bytesToDataUrl(bytes, imageMimeFromFile(file) || detectImageMime(bytes));
  }

  async function readId3Tag(file, options) {
    var opts = normalizeOptions(options);
    var head = await readLocalHeadBytes(file, 10, opts);
    if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return null;
    var tagSize = synchsafe(head, 6);
    var maxBytes = Math.max(10, Number(opts.maxBytes) || DEFAULT_ID3_MAX_BYTES);
    var total = Math.min(10 + tagSize, maxBytes);
    var bytes = await readLocalHeadBytes(file, total, opts);
    if (bytes.length < 10) return null;
    return {
      version: bytes[3],
      bytes: bytes.slice(10, Math.min(bytes.length, 10 + tagSize)),
    };
  }

  function parseId3Frames(tag) {
    var frames = [];
    if (!tag || !tag.bytes) return frames;
    var bytes = tag.bytes;
    var offset = 0;
    while (offset + 10 <= bytes.length) {
      var id = ascii(bytes, offset, offset + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      var size = tag.version === 4 ? synchsafe(bytes, offset + 4) : u32be(bytes, offset + 4);
      if (!size || offset + 10 + size > bytes.length) break;
      frames.push({ id: id, body: bytes.slice(offset + 10, offset + 10 + size) });
      offset += 10 + size;
    }
    return frames;
  }

  function decodeId3TextFrame(body) {
    if (!body || !body.length) return '';
    return cleanText(decodeTextByEncoding(body.slice(1), body[0]));
  }

  function findTextTerminator(bytes, start, encoding) {
    var i;
    if (encoding === 1 || encoding === 2) {
      for (i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return { index: i, length: 2 };
      }
      return { index: bytes.length, length: 0 };
    }
    for (i = start; i < bytes.length; i++) {
      if (bytes[i] === 0) return { index: i, length: 1 };
    }
    return { index: bytes.length, length: 0 };
  }

  function parseApicFrame(body) {
    if (!body || body.length < 5) return null;
    var encoding = body[0];
    var mimeEnd = body.indexOf ? body.indexOf(0, 1) : -1;
    if (mimeEnd < 0) return null;
    var mime = ascii(body, 1, mimeEnd).toLowerCase() || 'image/jpeg';
    var typeOffset = mimeEnd + 1;
    var descStart = typeOffset + 1;
    if (descStart >= body.length) return null;
    var descEnd = findTextTerminator(body, descStart, encoding);
    var imageStart = descEnd.index + descEnd.length;
    if (imageStart >= body.length) return null;
    return {
      mime: mime === 'image/jpg' ? 'image/jpeg' : mime,
      bytes: body.slice(imageStart),
    };
  }

  async function extractMp3LocalMetadata(file, options) {
    var tag = await readId3Tag(file, options);
    var frames = parseId3Frames(tag);
    var meta = {};
    var textFrameMap = {
      TIT2: 'title',
      TPE1: 'artist',
      TALB: 'album',
      TDRC: 'year',
      TYER: 'year',
      TRCK: 'track',
    };
    frames.forEach(function(frame) {
      var field = textFrameMap[frame.id];
      if (!field || meta[field]) return;
      var value = decodeId3TextFrame(frame.body);
      if (value) meta[field] = value;
    });
    return compactMetadata(meta);
  }

  async function extractMp3EmbeddedCoverDataUrl(file, options) {
    var tag = await readId3Tag(file, options);
    var frames = parseId3Frames(tag);
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].id !== 'APIC') continue;
      var picture = parseApicFrame(frames[i].body);
      if (picture && picture.bytes && picture.bytes.length) return bytesToDataUrl(picture.bytes, picture.mime);
    }
    return '';
  }

  async function readFlacBlocks(file, options) {
    var opts = normalizeOptions(options);
    var maxBytes = Math.max(4, Number(opts.maxBytes) || (opts.light ? LIGHT_FLAC_MAX_BYTES : DEFAULT_FLAC_MAX_BYTES));
    var bytes = await readLocalHeadBytes(file, maxBytes, opts);
    if (bytes.length < 4 || ascii(bytes, 0, 4) !== 'fLaC') return [];
    var blocks = [];
    var offset = 4;
    while (offset + 4 <= bytes.length) {
      var header = bytes[offset];
      var last = !!(header & 0x80);
      var type = header & 0x7f;
      var length = u24be(bytes, offset + 1);
      var start = offset + 4;
      var end = start + length;
      if (end > bytes.length) break;
      blocks.push({ type: type, data: bytes.slice(start, end) });
      offset = end;
      if (last) break;
    }
    return blocks;
  }

  function parseVorbisCommentBlock(data) {
    var out = {};
    var lyrics = '';
    if (!data || data.length < 8) return { tags: out, lyrics: lyrics };
    var offset = 0;
    var vendorLength = u32le(data, offset);
    offset += 4 + vendorLength;
    if (offset + 4 > data.length) return { tags: out, lyrics: lyrics };
    var count = u32le(data, offset);
    offset += 4;
    for (var i = 0; i < count && offset + 4 <= data.length; i++) {
      var length = u32le(data, offset);
      offset += 4;
      if (offset + length > data.length) break;
      var text = decodeBytes(data.slice(offset, offset + length), 'utf8');
      offset += length;
      var eq = text.indexOf('=');
      if (eq <= 0) continue;
      var key = text.slice(0, eq).toUpperCase();
      var value = cleanText(text.slice(eq + 1));
      if (!value) continue;
      if (!out[key]) out[key] = value;
      if (!lyrics && (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'UNSYNCED LYRICS')) lyrics = value;
    }
    return { tags: out, lyrics: lyrics };
  }

  function parseFlacPictureBlock(data) {
    if (!data || data.length < 32) return null;
    var offset = 0;
    offset += 4;
    var mimeLength = u32be(data, offset);
    offset += 4;
    if (offset + mimeLength > data.length) return null;
    var mime = ascii(data, offset, offset + mimeLength).toLowerCase();
    offset += mimeLength;
    var descLength = u32be(data, offset);
    offset += 4 + descLength;
    if (offset + 20 > data.length) return null;
    offset += 16;
    var imageLength = u32be(data, offset);
    offset += 4;
    if (offset + imageLength > data.length) return null;
    var imageBytes = data.slice(offset, offset + imageLength);
    return {
      mime: mime || detectImageMime(imageBytes) || 'image/jpeg',
      bytes: imageBytes,
    };
  }

  async function extractFlacLocalMetadata(file, options) {
    var blocks = await readFlacBlocks(file, options);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type !== 4) continue;
      var parsed = parseVorbisCommentBlock(blocks[i].data);
      return compactMetadata({
        title: parsed.tags.TITLE,
        artist: parsed.tags.ARTIST || parsed.tags.ALBUMARTIST,
        album: parsed.tags.ALBUM,
        year: parsed.tags.DATE,
        track: parsed.tags.TRACKNUMBER,
      });
    }
    return {};
  }

  async function extractFlacEmbeddedLyricsText(file, options) {
    var blocks = await readFlacBlocks(file, options);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type !== 4) continue;
      return parseVorbisCommentBlock(blocks[i].data).lyrics || '';
    }
    return '';
  }

  async function extractFlacEmbeddedCoverDataUrl(file, options) {
    var blocks = await readFlacBlocks(file, options);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type !== 6) continue;
      var picture = parseFlacPictureBlock(blocks[i].data);
      if (picture && picture.bytes && picture.bytes.length) return bytesToDataUrl(picture.bytes, picture.mime);
    }
    return '';
  }

  function compactMetadata(meta) {
    var out = {};
    Object.keys(meta || {}).forEach(function(key) {
      var value = cleanText(meta[key]);
      if (value) out[key] = value;
    });
    return out;
  }

  async function extractLocalMetadata(file, options) {
    var ext = getExt(file);
    if (ext === 'mp3') return extractMp3LocalMetadata(file, options);
    if (ext === 'flac') return extractFlacLocalMetadata(file, options);
    return {};
  }

  async function extractEmbeddedCoverDataUrl(file, options) {
    var ext = getExt(file);
    if (ext === 'mp3') return extractMp3EmbeddedCoverDataUrl(file, options);
    if (ext === 'flac') return extractFlacEmbeddedCoverDataUrl(file, options);
    return '';
  }

  function findAdjacentLocalAssets(audioFile, files) {
    var audio = pathParts(audioFile);
    var result = {
      lyricFile: null,
      lyricCandidates: [],
      coverFile: null,
    };
    var legacyTxtFile = null;
    var bestCoverRank = Infinity;
    Array.prototype.slice.call(files || []).forEach(function(file) {
      if (!file || file === audioFile) return;
      var info = pathParts(file);
      if (!info.name) return;
      var isExplicitSameDirectory = !!audio.dir && !!info.dir && info.dir === audio.dir;
      if (isExplicitSameDirectory && LYRIC_EXTS[info.ext] && info.base === audio.base && lyricFileState) {
        var candidate = lyricFileState.normalizeLocalLyricCandidate({
          audioPath: audio.path,
          lyricPath: info.path,
          name: info.name,
          enhanced: !!file.enhanced,
        });
        if (candidate) result.lyricCandidates.push({ file: file, candidate: candidate });
        return;
      }
      if (isExplicitSameDirectory && info.ext === 'txt' && info.base === audio.base && !legacyTxtFile) {
        legacyTxtFile = file;
        return;
      }
      if (!COVER_EXTS[info.ext]) return;
      if (info.dir !== audio.dir) return;
      var rank = Infinity;
      if (info.base === audio.base) rank = 0;
      else if (Object.prototype.hasOwnProperty.call(COVER_BASENAME_PRIORITY, info.base)) rank = COVER_BASENAME_PRIORITY[info.base];
      if (rank < bestCoverRank) {
        bestCoverRank = rank;
        result.coverFile = file;
      }
    });
    result.lyricCandidates.sort(function(left, right) {
      var preferred = lyricFileState.selectPreferredLocalLyric([left.candidate, right.candidate]);
      if (preferred === left.candidate && preferred !== right.candidate) return -1;
      if (preferred === right.candidate && preferred !== left.candidate) return 1;
      return String(left.candidate.lyricPath).localeCompare(String(right.candidate.lyricPath));
    });
    result.lyricCandidates = result.lyricCandidates.map(function(item) { return item.file; });
    result.lyricFile = result.lyricCandidates[0] || legacyTxtFile;
    return result;
  }

  return {
    readLocalFileBytes: readLocalFileBytes,
    readTextFile: readTextFile,
    readImageFileDataUrl: readImageFileDataUrl,
    extractLocalMetadata: extractLocalMetadata,
    extractMp3LocalMetadata: extractMp3LocalMetadata,
    extractFlacLocalMetadata: extractFlacLocalMetadata,
    extractEmbeddedCoverDataUrl: extractEmbeddedCoverDataUrl,
    extractMp3EmbeddedCoverDataUrl: extractMp3EmbeddedCoverDataUrl,
    extractFlacEmbeddedCoverDataUrl: extractFlacEmbeddedCoverDataUrl,
    extractFlacEmbeddedLyricsText: extractFlacEmbeddedLyricsText,
    findAdjacentLocalAssets: findAdjacentLocalAssets,
  };
});
