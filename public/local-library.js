(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MineradioLocalLibrary = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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

  function normalizePath(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/');
  }

  function recordPath(record) {
    return normalizePath(record && (
      record.relativePath ||
      record.webkitRelativePath ||
      record.fullPath ||
      record.filePath ||
      record.path ||
      record.name
    ));
  }

  function recordName(record) {
    var filePath = recordPath(record);
    var slash = filePath.lastIndexOf('/');
    return slash >= 0 ? filePath.slice(slash + 1) : (filePath || String((record && record.name) || ''));
  }

  function stripExt(name) {
    return String(name || '').replace(/\.[^.\/\\]+$/, '');
  }

  function extName(name) {
    var match = String(name || '').toLowerCase().match(/\.([^.\/\\]+)$/);
    return match ? match[1] : '';
  }

  function recordParts(record) {
    var filePath = recordPath(record);
    var slash = filePath.lastIndexOf('/');
    var name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
    return {
      path: filePath,
      dir: (slash >= 0 ? filePath.slice(0, slash) : '').toLowerCase(),
      name: name,
      base: stripExt(name).toLowerCase(),
      ext: extName(name),
    };
  }

  function localLibraryPathKey(record) {
    return recordPath(record).toLowerCase();
  }

  function localLibraryFileSignature(record) {
    return [
      localLibraryPathKey(record),
      Number(record && record.size) || 0,
      Number(record && record.lastModified) || 0,
    ].join(':');
  }

  function filePath(record) {
    return String((record && (record.fullPath || record.filePath || record.path || record.localFilePathAbsolute)) || '');
  }

  function fileUrl(record) {
    return String((record && (record.url || record.localUrl || record.src)) || '');
  }

  function findAdjacentAssets(audioRecord, assets) {
    var audio = recordParts(audioRecord);
    var result = {
      lyricFile: null,
      lyricCandidates: [],
      coverFile: null,
    };
    var legacyTxtFile = null;
    var bestCoverRank = Infinity;
    (Array.isArray(assets) ? assets : []).forEach(function(asset) {
      var info = recordParts(asset);
      if (!info.name) return;
      var isExplicitSameDirectory = !!audio.dir && !!info.dir && info.dir === audio.dir;
      if (isExplicitSameDirectory && LYRIC_EXTS[info.ext] && info.base === audio.base && lyricFileState) {
        var candidate = lyricFileState.normalizeLocalLyricCandidate({
          audioPath: audio.path,
          lyricPath: info.path,
          name: info.name,
          enhanced: !!asset.enhanced,
        });
        if (candidate) result.lyricCandidates.push({ asset: asset, candidate: candidate });
        return;
      }
      if (isExplicitSameDirectory && info.ext === 'txt' && info.base === audio.base && !legacyTxtFile) {
        legacyTxtFile = asset;
        return;
      }
      if (!COVER_EXTS[info.ext]) return;
      if (info.dir !== audio.dir) return;
      var rank = Infinity;
      if (info.base === audio.base) rank = 0;
      else if (Object.prototype.hasOwnProperty.call(COVER_BASENAME_PRIORITY, info.base)) rank = COVER_BASENAME_PRIORITY[info.base];
      if (rank < bestCoverRank) {
        bestCoverRank = rank;
        result.coverFile = asset;
      }
    });
    result.lyricCandidates.sort(function(left, right) {
      var preferred = lyricFileState.selectPreferredLocalLyric([left.candidate, right.candidate]);
      if (preferred === left.candidate && preferred !== right.candidate) return -1;
      if (preferred === right.candidate && preferred !== left.candidate) return 1;
      return String(left.candidate.lyricPath).localeCompare(String(right.candidate.lyricPath));
    });
    result.lyricCandidates = result.lyricCandidates.map(function(item) { return item.asset; });
    result.lyricFile = result.lyricCandidates[0] || legacyTxtFile;
    return result;
  }

  function recordToLocalSong(record, scanResult) {
    scanResult = scanResult || {};
    var adjacent = findAdjacentAssets(record, scanResult.assets);
    var signature = localLibraryFileSignature(record);
    var name = String((record && (record.title || record.name)) || recordName(record) || '本地音乐');
    name = stripExt(name) || '本地音乐';
    var url = fileUrl(record);
    return {
      type: 'local',
      source: 'local-library',
      provider: 'local',
      name: name,
      artist: String((record && record.artist) || '本地文件'),
      album: String((record && record.album) || ''),
      duration: Number(record && record.duration) || 0,
      cover: String((record && record.cover) || ''),
      localKey: 'library:' + signature,
      localUrl: url,
      url: url,
      localFile: record,
      localFileName: String((record && record.name) || recordName(record)),
      localFilePath: filePath(record),
      localLibraryFolderPath: String(scanResult.folderPath || ''),
      localLibraryPathKey: localLibraryPathKey(record),
      localLibraryFileSignature: signature,
      localAdjacentLyricFile: adjacent.lyricFile || null,
      localAdjacentLyricCandidates: adjacent.lyricCandidates || [],
      localAdjacentCoverFile: adjacent.coverFile || null,
    };
  }

  function buildLocalLibrarySongs(scanResult) {
    if (!scanResult || scanResult.ok === false || !Array.isArray(scanResult.files)) return [];
    return scanResult.files.map(function(record) {
      return recordToLocalSong(record, scanResult);
    });
  }

  function snapshotFileRecord(record) {
    return {
      name: String((record && record.name) || recordName(record) || ''),
      pathKey: localLibraryPathKey(record),
      signature: localLibraryFileSignature(record),
    };
  }

  function createLocalLibrarySnapshot(scanResult, options) {
    options = options || {};
    if (!scanResult || scanResult.ok === false || !Array.isArray(scanResult.files) || !scanResult.folderPath) return null;
    var maxRecords = Math.max(1, Number(options.maxRecords) || 5000);
    var files = scanResult.files.map(snapshotFileRecord).filter(function(file) {
      return file.pathKey && file.signature;
    });
    var storedFiles = files.slice(0, maxRecords);
    return {
      version: 1,
      folderPath: String(scanResult.folderPath || ''),
      updatedAt: Number(options.now) || Date.now(),
      fileCount: files.length,
      assetCount: Array.isArray(scanResult.assets) ? scanResult.assets.length : 0,
      scanTruncated: !!scanResult.truncated,
      snapshotTruncated: files.length > storedFiles.length,
      files: storedFiles,
    };
  }

  function normalizeLocalLibrarySnapshot(raw) {
    if (!raw) return null;
    var parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); }
      catch (_e) { return null; }
    }
    if (!parsed || parsed.version !== 1 || !parsed.folderPath || !Array.isArray(parsed.files)) return null;
    var files = parsed.files.map(function(file) {
      return {
        name: String((file && file.name) || ''),
        pathKey: String((file && file.pathKey) || '').toLowerCase(),
        signature: String((file && file.signature) || ''),
      };
    }).filter(function(file) {
      return file.pathKey && file.signature;
    });
    return {
      version: 1,
      folderPath: String(parsed.folderPath || ''),
      updatedAt: Math.max(0, Number(parsed.updatedAt) || 0),
      fileCount: Math.max(0, Number(parsed.fileCount) || files.length),
      assetCount: Math.max(0, Number(parsed.assetCount) || 0),
      scanTruncated: !!parsed.scanTruncated,
      snapshotTruncated: !!parsed.snapshotTruncated,
      files: files,
    };
  }

  function fileMap(files) {
    var map = {};
    (Array.isArray(files) ? files : []).forEach(function(file) {
      if (file && file.pathKey) map[file.pathKey] = file;
    });
    return map;
  }

  function compareLocalLibrarySnapshot(previousSnapshot, scanResult, options) {
    var previous = normalizeLocalLibrarySnapshot(previousSnapshot);
    var nextSnapshot = createLocalLibrarySnapshot(scanResult, options);
    var prevMap = fileMap(previous && previous.files);
    var nextMap = fileMap(nextSnapshot && nextSnapshot.files);
    var added = 0;
    var missing = 0;
    var changed = 0;
    var stable = 0;
    Object.keys(nextMap).forEach(function(key) {
      if (!prevMap[key]) {
        added++;
      } else if (prevMap[key].signature !== nextMap[key].signature) {
        changed++;
      } else {
        stable++;
      }
    });
    Object.keys(prevMap).forEach(function(key) {
      if (!nextMap[key]) missing++;
    });
    return {
      added: added,
      missing: missing,
      changed: changed,
      stable: stable,
      previousFileCount: previous ? previous.fileCount : 0,
      nextFileCount: nextSnapshot ? nextSnapshot.fileCount : 0,
      folderChanged: !!(previous && nextSnapshot && previous.folderPath !== nextSnapshot.folderPath),
      previousSnapshot: previous,
      nextSnapshot: nextSnapshot,
    };
  }

  function localLibraryStatusText(snapshot) {
    snapshot = normalizeLocalLibrarySnapshot(snapshot) || (snapshot && snapshot.folderPath ? snapshot : null);
    if (!snapshot) return '';
    var parts = [snapshot.fileCount + ' 首'];
    if (snapshot.assetCount) parts.push(snapshot.assetCount + ' 个素材');
    if (snapshot.scanTruncated) parts.push('扫描已截断');
    if (snapshot.snapshotTruncated) parts.push('快照已截断');
    parts.push(snapshot.folderPath);
    return parts.join(' · ');
  }

  return {
    buildLocalLibrarySongs: buildLocalLibrarySongs,
    recordToLocalSong: recordToLocalSong,
    findAdjacentAssets: findAdjacentAssets,
    localLibraryPathKey: localLibraryPathKey,
    localLibraryFileSignature: localLibraryFileSignature,
    createLocalLibrarySnapshot: createLocalLibrarySnapshot,
    normalizeLocalLibrarySnapshot: normalizeLocalLibrarySnapshot,
    compareLocalLibrarySnapshot: compareLocalLibrarySnapshot,
    localLibraryStatusText: localLibraryStatusText,
  };
});
