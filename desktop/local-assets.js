const fs = require('fs');
const path = require('path');

const LOCAL_FILE_PROTOCOL = 'mineradio-local';

const LOCAL_LIBRARY_MIME = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.lrc': 'text/plain',
  '.ttml': 'application/ttml+xml',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

const LOCAL_LIBRARY_AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a']);
const LOCAL_LIBRARY_ASSET_EXTS = new Set(['.lrc', '.ttml', '.txt', '.jpg', '.jpeg', '.png', '.webp']);
const LOCAL_LIBRARY_EXTS = new Set([...LOCAL_LIBRARY_AUDIO_EXTS, ...LOCAL_LIBRARY_ASSET_EXTS]);
const DEFAULT_SCAN_VISIT_LIMIT = 60000;
const DEFAULT_MAX_RANGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_DATA_URL_CACHE_ENTRIES = 24;
const DEFAULT_MAX_DATA_URL_CACHE_BYTES = 96 * 1024 * 1024;

function isPathInsideRoot(root, absPath) {
  const rel = path.relative(root, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function normalizeLocalLibraryRelPath(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function localLibraryRelativePath(root, relPath) {
  return path.join(path.basename(root), relPath).replace(/\\/g, '/');
}

function createLocalFileProxyUrl(filePath) {
  const target = path.resolve(String(filePath || ''));
  return `${LOCAL_FILE_PROTOCOL}://file/?path=${encodeURIComponent(target)}`;
}

function localFilePathFromProxyUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== `${LOCAL_FILE_PROTOCOL}:` || url.hostname !== 'file') throw new Error('LOCAL_FILE_URL_INVALID');
  const filePath = url.searchParams.get('path') || '';
  if (!filePath) throw new Error('LOCAL_FILE_URL_EMPTY');
  return path.resolve(filePath);
}

function parseLocalFileRangeHeader(value, fileSize) {
  const size = Math.max(0, Number(fileSize) || 0);
  const raw = String(value || '').trim();
  if (!raw) return size > 0 ? { start: 0, end: size - 1, partial: false } : { start: 0, end: -1, partial: false };
  const match = raw.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size <= 0) return null;
  const left = match[1];
  const right = match[2];
  if (!left && !right) return null;
  if (!left) {
    const suffix = Number(right);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const length = Math.min(size, Math.floor(suffix));
    return { start: size - length, end: size - 1, partial: true };
  }
  const start = Number(left);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;
  const end = right ? Number(right) : size - 1;
  if (!Number.isFinite(end) || end < start) return null;
  return { start: Math.floor(start), end: Math.min(size - 1, Math.floor(end)), partial: true };
}

function normalizeNonNegativeOption(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  return fallback;
}

function createLocalAssetsManager(options) {
  options = options || {};
  const authorizedLocalMusicRoots = new Set();
  const proxyUrlForFile = typeof options.proxyUrlForFile === 'function' ? options.proxyUrlForFile : createLocalFileProxyUrl;
  const scanVisitLimit = Math.max(1, Number(options.scanVisitLimit) || DEFAULT_SCAN_VISIT_LIMIT);
  const maxRangeBytes = Math.max(0, Number(options.maxRangeBytes) || DEFAULT_MAX_RANGE_BYTES);
  const maxImageBytes = Math.max(0, Number(options.maxImageBytes) || DEFAULT_MAX_IMAGE_BYTES);
  const maxDataUrlCacheEntries = normalizeNonNegativeOption(options.maxDataUrlCacheEntries, DEFAULT_MAX_DATA_URL_CACHE_ENTRIES);
  const maxDataUrlCacheBytes = normalizeNonNegativeOption(options.maxDataUrlCacheBytes, DEFAULT_MAX_DATA_URL_CACHE_BYTES);
  const dataUrlCache = new Map();
  let dataUrlCacheBytes = 0;

  function dataUrlStatKey(stat) {
    return `${stat.size}:${Math.round(Number(stat.mtimeMs) || 0)}`;
  }

  function dropDataUrlCacheRecord(key) {
    const record = dataUrlCache.get(key);
    if (!record) return false;
    dataUrlCacheBytes = Math.max(0, dataUrlCacheBytes - (Number(record.bytes) || 0));
    dataUrlCache.delete(key);
    return true;
  }

  function trimDataUrlCache(entriesLimit, bytesLimit) {
    const keepEntries = Math.max(0, Number(entriesLimit) || 0);
    const keepBytes = Math.max(0, Number(bytesLimit) || 0);
    let dropped = 0;
    while (dataUrlCache.size > keepEntries || dataUrlCacheBytes > keepBytes) {
      const oldest = dataUrlCache.keys().next();
      if (oldest.done) break;
      if (dropDataUrlCacheRecord(oldest.value)) dropped += 1;
      else break;
    }
    return dropped;
  }

  function localAssetCacheStats() {
    return {
      dataUrlEntries: dataUrlCache.size,
      dataUrlBytes: dataUrlCacheBytes,
    };
  }

  function trimLocalAssetCaches(limits) {
    limits = limits || {};
    const dataUrlsDropped = trimDataUrlCache(
      limits.maxDataUrlCacheEntries == null ? maxDataUrlCacheEntries : limits.maxDataUrlCacheEntries,
      limits.maxDataUrlCacheBytes == null ? maxDataUrlCacheBytes : limits.maxDataUrlCacheBytes,
    );
    return {
      dataUrlsDropped,
      ...localAssetCacheStats(),
    };
  }

  function normalizeLocalMusicRoot(folderPath) {
    const resolved = path.resolve(String(folderPath || ''));
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error('LOCAL_LIBRARY_NOT_DIRECTORY');
    return resolved;
  }

  function rememberLocalMusicRoot(folderPath) {
    const root = normalizeLocalMusicRoot(folderPath);
    authorizedLocalMusicRoots.add(root);
    return root;
  }

  function resolveAuthorizedLocalFile(filePath) {
    const target = path.resolve(String(filePath || ''));
    for (const root of authorizedLocalMusicRoots) {
      if (isPathInsideRoot(root, target)) return target;
    }
    throw new Error('LOCAL_FILE_NOT_AUTHORIZED');
  }

  function localLibraryRelPathFromRecord(root, record) {
    if (!record) return '';
    const fullPath = record.fullPath || record.filePath || record.path || record.localFilePathAbsolute || '';
    if (fullPath) {
      const abs = path.resolve(String(fullPath));
      if (isPathInsideRoot(root, abs)) return normalizeLocalLibraryRelPath(path.relative(root, abs));
    }
    let rel = record.relativePath || record.webkitRelativePath || record.name || '';
    rel = normalizeLocalLibraryRelPath(rel);
    const rootBase = normalizeLocalLibraryRelPath(path.basename(root));
    if (rootBase && (rel === rootBase || rel.startsWith(`${rootBase}/`))) rel = rel.slice(rootBase.length).replace(/^\/+/, '');
    if (!rel || rel.split('/').includes('..')) return '';
    return rel;
  }

  function makeLocalLibraryFileRecord(root, item, stat) {
    const webkitRelativePath = localLibraryRelativePath(root, item.rel);
    return {
      ...(item.source || {}),
      fullPath: item.abs,
      filePath: item.abs,
      url: proxyUrlForFile(item.abs),
      name: item.entry.name,
      relativePath: webkitRelativePath,
      webkitRelativePath,
      size: stat.size,
      lastModified: Math.round(stat.mtimeMs),
      type: LOCAL_LIBRARY_MIME[item.ext] || '',
      assetKind: LOCAL_LIBRARY_AUDIO_EXTS.has(item.ext) ? 'audio' : 'asset',
    };
  }

  function makeLocalLibraryDirectoryRecord(root, relPath, stat) {
    const rel = normalizeLocalLibraryRelPath(relPath);
    return {
      fullPath: path.join(root, rel),
      relativePath: rel,
      lastModified: Math.round(stat.mtimeMs),
    };
  }

  function rehydrateLocalLibraryFileRecord(root, record) {
    const rel = normalizeLocalLibraryRelPath(localLibraryRelPathFromRecord(root, record));
    if (!rel) return null;
    const abs = path.resolve(root, rel);
    if (!isPathInsideRoot(root, abs)) return null;
    const ext = path.extname((record && record.name) || abs).toLowerCase();
    if (!LOCAL_LIBRARY_EXTS.has(ext)) return null;
    const statShape = {
      size: Number(record && record.size) || 0,
      mtimeMs: Number(record && record.lastModified) || 0,
    };
    return makeLocalLibraryFileRecord(root, {
      abs,
      rel,
      ext,
      entry: { name: (record && record.name) || path.basename(abs) },
      source: record || {},
    }, statShape);
  }

  async function collectLocalLibraryFolderEntries(root) {
    const files = [];
    const assets = [];
    const directories = [];
    const stack = [''];
    let visited = 0;
    while (stack.length) {
      const relDir = stack.pop();
      const absDir = path.join(root, relDir);
      let dirStat = null;
      try {
        dirStat = await fs.promises.stat(absDir);
      } catch (_e) {
        continue;
      }
      if (!dirStat.isDirectory()) continue;
      directories.push(makeLocalLibraryDirectoryRecord(root, relDir, dirStat));
      let entries = [];
      try {
        entries = await fs.promises.readdir(absDir, { withFileTypes: true });
      } catch (_e) {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
      for (const entry of entries) {
        visited += 1;
        if (visited > scanVisitLimit) break;
        const rel = path.join(relDir, entry.name);
        const abs = path.join(root, rel);
        if (entry.isDirectory()) {
          stack.push(rel);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!LOCAL_LIBRARY_EXTS.has(ext)) continue;
        const bucket = LOCAL_LIBRARY_AUDIO_EXTS.has(ext) ? files : assets;
        bucket.push({ abs, rel, entry, ext, index: bucket.length });
      }
      if (visited > scanVisitLimit) break;
    }
    return { files, assets, directories, truncated: visited > scanVisitLimit };
  }

  async function statLocalLibraryItems(root, items) {
    const records = [];
    for (const item of items) {
      let stat = null;
      try {
        stat = await fs.promises.stat(item.abs);
      } catch (_e) {
        continue;
      }
      if (stat.isFile()) records.push(makeLocalLibraryFileRecord(root, item, stat));
    }
    records.sort((a, b) => String(a.relativePath || '').localeCompare(String(b.relativePath || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
    return records;
  }

  async function scanLocalMusicFolder(folderPath) {
    const root = rememberLocalMusicRoot(folderPath);
    const listed = await collectLocalLibraryFolderEntries(root);
    return {
      ok: true,
      folderPath: root,
      files: await statLocalLibraryItems(root, listed.files),
      assets: await statLocalLibraryItems(root, listed.assets),
      directories: listed.directories,
      truncated: listed.truncated,
      scanMode: 'full',
    };
  }

  async function refreshLocalMusicFileEntries(folderPath, snapshotOrFiles) {
    const root = rememberLocalMusicRoot(folderPath);
    const source = Array.isArray(snapshotOrFiles) ? { files: snapshotOrFiles } : (snapshotOrFiles || {});
    const sourceFiles = Array.isArray(source.files) ? source.files : [];
    const sourceAssets = Array.isArray(source.assets) ? source.assets : [];
    return {
      ok: true,
      folderPath: root,
      files: sourceFiles.map((file) => rehydrateLocalLibraryFileRecord(root, file)).filter(Boolean),
      assets: sourceAssets.map((file) => rehydrateLocalLibraryFileRecord(root, file)).filter(Boolean),
      directories: Array.isArray(source.directories) ? source.directories : [],
      snapshot: true,
      restoredFromSnapshot: true,
    };
  }

  async function readAuthorizedLocalFileRange(filePath, start, end) {
    const target = resolveAuthorizedLocalFile(filePath);
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) throw new Error('LOCAL_FILE_NOT_FOUND');
    const fileSize = stat.size;
    const from = Math.max(0, Math.min(fileSize, Number(start) || 0));
    const requestedEnd = end == null ? fileSize : Number(end);
    const to = Math.max(from, Math.min(fileSize, Number.isFinite(requestedEnd) ? requestedEnd : fileSize));
    const length = Math.min(maxRangeBytes, to - from);
    const handle = await fs.promises.open(target, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, from);
      return {
        ok: true,
        size: fileSize,
        start: from,
        end: from + result.bytesRead,
        base64: buffer.subarray(0, result.bytesRead).toString('base64'),
      };
    } finally {
      await handle.close();
    }
  }

  async function readAuthorizedLocalFileDataUrl(filePath) {
    const target = resolveAuthorizedLocalFile(filePath);
    const ext = path.extname(target).toLowerCase();
    const mime = LOCAL_LIBRARY_MIME[ext] || 'application/octet-stream';
    if (!mime.startsWith('image/')) throw new Error('LOCAL_FILE_NOT_IMAGE');
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) throw new Error('LOCAL_FILE_NOT_FOUND');
    if (stat.size > maxImageBytes) throw new Error('LOCAL_IMAGE_TOO_LARGE');
    const statKey = dataUrlStatKey(stat);
    const cached = dataUrlCache.get(target);
    if (cached && cached.statKey === statKey) {
      dataUrlCache.delete(target);
      dataUrlCache.set(target, cached);
      return { ok: true, dataUrl: cached.dataUrl, cached: true };
    }
    if (cached) dropDataUrlCacheRecord(target);
    const buffer = await fs.promises.readFile(target);
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    if (maxDataUrlCacheEntries > 0 && maxDataUrlCacheBytes > 0 && stat.size <= maxDataUrlCacheBytes) {
      dataUrlCache.set(target, {
        dataUrl,
        statKey,
        bytes: stat.size,
      });
      dataUrlCacheBytes += stat.size;
      trimDataUrlCache(maxDataUrlCacheEntries, maxDataUrlCacheBytes);
    }
    return { ok: true, dataUrl, cached: false };
  }

  return {
    authorizedLocalMusicRoots,
    normalizeLocalMusicRoot,
    rememberLocalMusicRoot,
    resolveAuthorizedLocalFile,
    scanLocalMusicFolder,
    refreshLocalMusicFileEntries,
    readAuthorizedLocalFileRange,
    readAuthorizedLocalFileDataUrl,
    localAssetCacheStats,
    trimLocalAssetCaches,
  };
}

module.exports = {
  createLocalAssetsManager,
  createLocalFileProxyUrl,
  localFilePathFromProxyUrl,
  parseLocalFileRangeHeader,
  isPathInsideRoot,
  LOCAL_FILE_PROTOCOL,
  LOCAL_LIBRARY_AUDIO_EXTS,
  LOCAL_LIBRARY_ASSET_EXTS,
  LOCAL_LIBRARY_EXTS,
  LOCAL_LIBRARY_MIME,
};
