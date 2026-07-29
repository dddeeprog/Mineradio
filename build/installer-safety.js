const fs = require('node:fs');
const path = require('node:path');

const MARKER_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[A-F0-9]{64}$/i;
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/iu;

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required.`);
  }
  if (value.includes('\0')) {
    throw new TypeError(`${label} contains a null byte.`);
  }
  return value.trim();
}

function normalizeInstallPath(value) {
  if (typeof value === 'string' && value !== value.trim()) {
    throw new TypeError('Windows path must not have leading or trailing whitespace.');
  }
  const input = requireText(value, 'Install path').replace(/\//g, '\\');
  const isDriveAbsolute = /^[A-Za-z]:\\/.test(input);
  const isNetworkOrDevice = /^\\\\/.test(input);
  if (
    (!isDriveAbsolute && !isNetworkOrDevice)
    || !path.win32.isAbsolute(input)
    || /^[A-Za-z]:[^\\]/.test(input)
  ) {
    throw new TypeError('Install path must be an absolute Windows path.');
  }
  const normalized = path.win32.normalize(input);
  assertSafeWindowsSegments(normalized, path.win32.parse(normalized).root);
  const root = path.win32.parse(normalized).root;
  return pathKey(normalized) === pathKey(root)
    ? root
    : normalized.replace(/\\+$/, '');
}

function assertSafeWindowsSegments(value, root) {
  const relative = root ? value.slice(root.length) : value;
  const segments = relative.split('\\').filter(Boolean);
  for (const segment of segments) {
    if (
      /[. ]$/.test(segment)
      || /[<>:"|?*\u0000-\u001F]/.test(segment)
      || RESERVED_WINDOWS_NAME.test(segment)
    ) {
      throw new TypeError(`Windows path contains an ambiguous or reserved segment: ${segment}`);
    }
  }
}

function pathKey(value) {
  return path.win32.normalize(value).replace(/[\\]+$/, '').toLowerCase();
}

function isSameOrDescendant(candidate, parent) {
  const candidateKey = pathKey(candidate);
  const parentKey = pathKey(parent);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}\\`);
}

function defaultReparsePointCheck(candidate) {
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) return true;
    const resolved = fs.realpathSync.native(candidate);
    return pathKey(resolved) !== pathKey(candidate);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function pathSegments(candidate) {
  const parsed = path.win32.parse(candidate);
  const relative = candidate.slice(parsed.root.length);
  const parts = relative.split('\\').filter(Boolean);
  const segments = [parsed.root];
  let current = parsed.root;
  for (const part of parts) {
    current = path.win32.join(current, part);
    segments.push(current);
  }
  return segments;
}

function unsafePath(reason, normalizedPath, extra) {
  return {
    safe: false,
    reason,
    normalizedPath,
    ...(extra || {}),
  };
}

function classifyInstallPath(value, options) {
  const policy = options || {};
  let normalizedPath;
  try {
    normalizedPath = normalizeInstallPath(value);
  } catch (error) {
    return unsafePath('invalid-path', null, { error: error.message });
  }

  if (/^\\\\/.test(normalizedPath)) {
    return unsafePath(
      normalizedPath.startsWith('\\\\?\\') || normalizedPath.startsWith('\\\\.\\')
        ? 'device-path'
        : 'unc-path',
      normalizedPath,
    );
  }

  const parsed = path.win32.parse(normalizedPath);
  if (!parsed.root || pathKey(parsed.root) === pathKey(normalizedPath)) {
    return unsafePath('drive-root', normalizedPath);
  }

  let systemRoots;
  let userProfile;
  try {
    systemRoots = [
      policy.systemRoot || process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
      ...(Array.isArray(policy.programFiles)
        ? policy.programFiles
        : [
          process.env.ProgramFiles,
          process.env['ProgramFiles(x86)'],
          process.env.ProgramW6432,
        ]),
    ].filter(Boolean).map(normalizeInstallPath);
    userProfile = policy.userProfile || process.env.USERPROFILE;
    if (userProfile) userProfile = normalizeInstallPath(userProfile);
  } catch (error) {
    return unsafePath('invalid-policy', normalizedPath, { error: error.message });
  }

  if (systemRoots.some((root) => isSameOrDescendant(normalizedPath, root))) {
    return unsafePath('system-directory', normalizedPath);
  }

  if (userProfile && pathKey(userProfile) === pathKey(normalizedPath)) {
    return unsafePath('user-root', normalizedPath);
  }

  const isReparsePoint = policy.isReparsePoint || defaultReparsePointCheck;
  try {
    for (const segment of pathSegments(normalizedPath)) {
      if (isReparsePoint(segment)) {
        return unsafePath('reparse-point', normalizedPath, { reparsePath: segment });
      }
    }
  } catch (error) {
    return unsafePath('path-inspection-failed', normalizedPath, { error: error.message });
  }

  return { safe: true, reason: null, normalizedPath };
}

function normalizeSha256(value, label) {
  const normalized = requireText(value, label).toUpperCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a 64-character hexadecimal digest.`);
  }
  return normalized;
}

function createOwnershipMarker(options) {
  const input = options || {};
  const createdAt = requireText(input.createdAt || new Date().toISOString(), 'Created at');
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError('Created at must be an ISO-compatible timestamp.');
  }

  return {
    schemaVersion: MARKER_SCHEMA_VERSION,
    productName: requireText(input.productName, 'Product name'),
    appId: requireText(input.appId, 'App ID'),
    channel: requireText(input.channel, 'Channel'),
    version: requireText(input.version, 'Version'),
    installPath: normalizeInstallPath(input.installPath),
    manifestSha256: normalizeSha256(input.manifestSha256, 'Manifest SHA256'),
    commit: requireText(input.commit, 'Commit'),
    buildId: requireText(input.buildId, 'Build ID'),
    createdAt: new Date(createdAt).toISOString(),
  };
}

function validationResult(reasons) {
  return { valid: reasons.length === 0, reasons };
}

function validateOwnershipMarker(marker, expected) {
  const reasons = [];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return validationResult(['malformed-marker']);
  }
  if (!expected || typeof expected !== 'object') {
    return validationResult(['unbound-expectation']);
  }

  if (marker.schemaVersion !== MARKER_SCHEMA_VERSION) reasons.push('schema-mismatch');
  for (const field of [
    'productName',
    'appId',
    'channel',
    'version',
    'installPath',
    'manifestSha256',
    'commit',
    'buildId',
    'createdAt',
  ]) {
    if (typeof marker[field] !== 'string' || !marker[field].trim()) {
      reasons.push(`missing-${field}`);
    }
  }

  let markerPath = null;
  let markerDigest = null;
  try {
    markerPath = normalizeInstallPath(marker.installPath);
  } catch {
    reasons.push('invalid-install-path');
  }
  try {
    markerDigest = normalizeSha256(marker.manifestSha256, 'Manifest SHA256');
  } catch {
    reasons.push('invalid-manifest-sha256');
  }
  let markerCreatedAt = null;
  try {
    markerCreatedAt = new Date(marker.createdAt).toISOString();
  } catch {
    reasons.push('invalid-created-at');
  }

  const requiredBindings = [
    'productName',
    'appId',
    'channel',
    'version',
    'installPath',
    'manifestSha256',
    'commit',
    'buildId',
    'createdAt',
  ];
  if (requiredBindings.some((field) => expected[field] === undefined || expected[field] === null)) {
    reasons.push('unbound-expectation');
  } else {
    if (marker.productName !== expected.productName) reasons.push('product-name-mismatch');
    if (marker.appId !== expected.appId) reasons.push('app-id-mismatch');
    if (marker.channel !== expected.channel) reasons.push('channel-mismatch');
    if (marker.version !== expected.version) reasons.push('version-mismatch');
    if (marker.commit !== expected.commit) reasons.push('commit-mismatch');
    if (marker.buildId !== expected.buildId) reasons.push('build-id-mismatch');
    let expectedCreatedAt = null;
    try {
      expectedCreatedAt = new Date(expected.createdAt).toISOString();
    } catch {
      reasons.push('expected-created-at-invalid');
    }
    if (markerCreatedAt && expectedCreatedAt) {
      if (markerCreatedAt !== expectedCreatedAt) {
        reasons.push('created-at-mismatch');
      }
    }
    try {
      if (!markerPath || pathKey(markerPath) !== pathKey(normalizeInstallPath(expected.installPath))) {
        reasons.push('install-path-mismatch');
      }
    } catch {
      reasons.push('expected-install-path-invalid');
    }
    try {
      if (!markerDigest || markerDigest !== normalizeSha256(expected.manifestSha256, 'Expected manifest SHA256')) {
        reasons.push('manifest-sha256-mismatch');
      }
    } catch {
      reasons.push('expected-manifest-sha256-invalid');
    }
  }

  return validationResult(Array.from(new Set(reasons)));
}

function normalizeRelativeInstallEntry(value) {
  if (typeof value === 'string' && value !== value.trim()) {
    throw new TypeError('Windows path must not have leading or trailing whitespace.');
  }
  const input = requireText(value, 'Relative install entry').replace(/\//g, '\\');
  if (/\\$/.test(input)) {
    throw new TypeError('Windows path must not end with a directory separator.');
  }
  if (path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw new TypeError('Relative install entry must not be absolute.');
  }
  const normalized = path.win32.normalize(input);
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith('..\\')
    || normalized.includes('\0')
  ) {
    throw new TypeError('Relative install entry must stay inside the installation directory.');
  }
  assertSafeWindowsSegments(normalized, '');
  return normalized;
}

function compareEntries(left, right) {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return leftKey.localeCompare(rightKey, 'en') || left.localeCompare(right, 'en');
}

function partitionInstallEntries(options) {
  const input = options || {};
  if (!Array.isArray(input.entries)) {
    throw new TypeError('Complete install entry enumeration is required.');
  }
  if (!Array.isArray(input.manifests) || input.manifests.length === 0) {
    throw new TypeError('At least one installer manifest is required.');
  }
  const manifests = input.manifests;
  const knownFilesByKey = new Map();
  const knownDirectoriesByKey = new Map();

  for (const manifest of manifests) {
    if (
      !manifest
      || typeof manifest !== 'object'
      || !Array.isArray(manifest.files)
      || !Array.isArray(manifest.directories)
    ) {
      throw new TypeError('Installer manifest entries must contain file and directory arrays.');
    }
    for (const entry of manifest.files) {
      const normalized = normalizeRelativeInstallEntry(
        typeof entry === 'string' ? entry : entry.path,
      );
      knownFilesByKey.set(pathKey(normalized), normalized);
    }
    for (const entry of manifest.directories) {
      const normalized = normalizeRelativeInstallEntry(
        typeof entry === 'string' ? entry : entry.path,
      );
      knownDirectoriesByKey.set(pathKey(normalized), normalized);
    }
  }

  const presentFileKeys = new Set();
  const knownFiles = [];
  const knownDirectories = [];
  const unknownEntries = [];
  for (const entry of input.entries) {
    if (
      !entry
      || typeof entry !== 'object'
      || (entry.type !== 'file' && entry.type !== 'directory')
    ) {
      throw new TypeError('Install entry type must be file or directory.');
    }
    const normalized = normalizeRelativeInstallEntry(entry.path);
    const key = pathKey(normalized);
    const isDirectory = entry.type === 'directory';
    if (!isDirectory && knownFilesByKey.has(key)) {
      knownFiles.push(knownFilesByKey.get(key));
      presentFileKeys.add(key);
    } else if (isDirectory && knownDirectoriesByKey.has(key)) {
      knownDirectories.push(knownDirectoriesByKey.get(key));
    } else {
      unknownEntries.push(normalized);
    }
  }

  const missingFiles = Array.from(knownFilesByKey.entries())
    .filter(([key]) => !presentFileKeys.has(key))
    .map(([, value]) => value);

  return {
    knownFiles: Array.from(new Set(knownFiles)).sort(compareEntries),
    knownDirectories: Array.from(new Set(knownDirectories)).sort(compareEntries),
    unknownEntries: Array.from(new Set(unknownEntries)).sort(compareEntries),
    missingFiles: missingFiles.sort(compareEntries),
  };
}

function canRemoveInstallTree(options) {
  const input = options || {};
  const pathResult = classifyInstallPath(input.installPath, input.pathPolicy);
  const markerResult = validateOwnershipMarker(input.marker, input.expectedMarker);
  let partition;
  const reasons = [];

  try {
    partition = partitionInstallEntries({
      entries: input.entries,
      manifests: input.manifests,
    });
  } catch (error) {
    partition = {
      knownFiles: [],
      knownDirectories: [],
      unknownEntries: [],
      missingFiles: [],
    };
    reasons.push('invalid-install-entry');
  }

  if (!pathResult.safe) reasons.push(`unsafe-install-path:${pathResult.reason}`);
  if (!markerResult.valid) reasons.push('invalid-ownership-marker');
  if (pathResult.safe) {
    try {
      const actualPath = pathKey(pathResult.normalizedPath);
      const markerPath = pathKey(normalizeInstallPath(input.marker.installPath));
      const expectedPath = pathKey(normalizeInstallPath(input.expectedMarker.installPath));
      if (actualPath !== markerPath || actualPath !== expectedPath) {
        reasons.push('install-path-binding-mismatch');
      }
    } catch {
      reasons.push('install-path-binding-mismatch');
    }
  }
  if (partition.unknownEntries.length > 0) reasons.push('unknown-entries');

  return {
    canRemove: reasons.length === 0,
    reasons,
    path: pathResult,
    marker: markerResult,
    partition,
  };
}

module.exports = {
  MARKER_SCHEMA_VERSION,
  canRemoveInstallTree,
  classifyInstallPath,
  createOwnershipMarker,
  normalizeInstallPath,
  normalizeRelativeInstallEntry,
  partitionInstallEntries,
  validateOwnershipMarker,
};
