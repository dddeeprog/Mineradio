const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build']);
const DEFAULT_ALLOWED_FILES = new Set(['server.js', 'dj-analyzer.js', 'package.json', 'package-lock.json']);
const BLOCKED_PATCH_EXTENSIONS = /\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i;

function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}

function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}

function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

function downloadUrlsForAsset(asset, opts) {
  const downloadUrl = asset && asset.browser_download_url || '';
  const fn = opts && typeof opts.downloadUrlsFor === 'function'
    ? opts.downloadUrlsFor
    : (url) => (url ? [url] : []);
  return fn(downloadUrl);
}

function pickReleaseAsset(assets, opts) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: downloadUrlsForAsset(preferred, opts),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}

function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}

function pickPatchAsset(assets, currentVersion, latestVersion, opts) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || '');
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: downloadUrlsForAsset(preferred, opts),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}

function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `Mineradio-${version || ''}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `Mineradio-${version || ''}.exe`;
}

function toSet(value, fallback) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return fallback;
}

function safePatchRelativePath(value, opts) {
  const options = opts || {};
  let rel = String(value || '').replace(/\\/g, '/').trim();
  if (!rel || rel.includes('\0')) return '';
  if (/^[A-Za-z]:/.test(rel) || rel.includes(':')) return '';
  rel = rel.replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  rel = parts.join('/');
  const allowedFiles = toSet(options.allowedFiles, DEFAULT_ALLOWED_FILES);
  if (allowedFiles.has(rel)) return rel;
  const allowedRoots = toSet(options.allowedRoots, DEFAULT_ALLOWED_ROOTS);
  if (!allowedRoots.has(parts[0])) return '';
  if (BLOCKED_PATCH_EXTENSIONS.test(rel)) return '';
  return rel;
}

function patchTargetPath(rel, rootDir, opts) {
  const safeRel = safePatchRelativePath(rel, opts);
  if (!safeRel) return null;
  const root = path.resolve(rootDir || process.cwd());
  const target = path.resolve(root, safeRel);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodePatchFileContent(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}

function assertPatchPackageDigest(patch) {
  const sha256 = normalizeDigest(patch && patch.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(patch && patch.sha512 || '', 'sha512');
  if (!sha256 && !sha512) {
    const err = new Error('PATCH_DIGEST_MISSING');
    err.code = 'PATCH_DIGEST_MISSING';
    throw err;
  }
  return { sha256, sha512 };
}

function normalizePatchPayload(payload, opts) {
  const options = opts || {};
  const currentVersion = normalizeVersion(options.currentVersion || '');
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || (currentVersion && compareVersions(from, currentVersion) !== 0)) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || (currentVersion && compareVersions(to, currentVersion) <= 0)) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired !== false };
}

function preparePatchFile(file, opts) {
  const options = opts || {};
  const rootDir = options.rootDir || process.cwd();
  const rel = safePatchRelativePath(file && (file.path || file.name), options);
  const target = rel ? patchTargetPath(rel, rootDir, options) : null;
  const content = decodePatchFileContent(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > (options.maxBytes || 12 * 1024 * 1024)) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = normalizeDigest(file.sha256 || '', 'sha256').toLowerCase();
  if (!expected) throw new Error('PATCH_FILE_HASH_REQUIRED:' + rel);
  const actual = sha256Hex(content);
  if (expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  return { rel, target, content, sha256: expected, tmp: '' };
}

function removeFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function restorePatchTargets(replaced) {
  for (let i = replaced.length - 1; i >= 0; i--) {
    const item = replaced[i];
    try {
      if (item.existed) {
        fs.copyFileSync(item.backup, item.target);
      } else if (fs.existsSync(item.target)) {
        fs.unlinkSync(item.target);
      }
    } catch (_) {}
  }
}

function applyPatchFiles(files, opts) {
  const options = opts || {};
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const backupDir = path.resolve(options.backupDir || path.join(rootDir, 'updates', 'backups', 'patches'));
  const replaceFile = typeof options.replaceFile === 'function'
    ? options.replaceFile
    : (tmp, target) => fs.renameSync(tmp, target);
  const prepared = (Array.isArray(files) ? files : []).map(file => preparePatchFile(file, { ...options, rootDir }));
  const stamp = `${Date.now()}-${process.pid}`;
  const tmpFiles = [];
  const replaced = [];
  try {
    prepared.forEach((item, index) => {
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      item.tmp = item.target + `.mineradio-patch-${stamp}-${index}`;
      fs.writeFileSync(item.tmp, item.content);
      tmpFiles.push(item.tmp);
      if (sha256Hex(fs.readFileSync(item.tmp)) !== item.sha256) throw new Error('PATCH_TEMP_VERIFY_FAILED:' + item.rel);
    });
    for (const item of prepared) {
      const existed = fs.existsSync(item.target);
      const backup = path.join(backupDir, item.rel);
      if (existed) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(item.target, backup);
      }
      replaceFile(item.tmp, item.target, item);
      item.tmp = '';
      replaced.push({ target: item.target, backup, existed });
      if (sha256Hex(fs.readFileSync(item.target)) !== item.sha256) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + item.rel);
    }
    return prepared.map(item => item.rel);
  } catch (err) {
    restorePatchTargets(replaced);
    prepared.forEach(item => removeFileIfExists(item.tmp));
    tmpFiles.forEach(removeFileIfExists);
    throw err;
  }
}

module.exports = {
  applyPatchFiles,
  assertPatchPackageDigest,
  assetDigestInfo,
  compareVersions,
  normalizeDigest,
  normalizePatchPayload,
  normalizeVersion,
  patchAssetVersions,
  patchTargetPath,
  pickPatchAsset,
  pickReleaseAsset,
  safePatchRelativePath,
  safeUpdateFileName,
  sha256Hex,
};
