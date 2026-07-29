const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeRelativeInstallEntry } = require('./installer-safety.js');

const DEFAULT_INSTALLER_FILES = [
  '.mineradio-install-owner.json',
  'Uninstall Mineradio.exe',
  'uninstallerIcon.ico',
];
const OWNERSHIP_MARKER_PATH = '.mineradio-install-owner.json';

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(filePath, options) {
  const input = options || {};
  const fsApi = input.fsApi || fs;
  const bufferSize = Number.isInteger(input.bufferSize) && input.bufferSize > 0
    ? input.bufferSize
    : 256 * 1024;
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(bufferSize);
  const descriptor = fsApi.openSync(filePath, 'r');
  try {
    while (true) {
      const bytesRead = fsApi.readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fsApi.closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

function compareEntries(left, right) {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return leftKey.localeCompare(rightKey, 'en') || left.localeCompare(right, 'en');
}

function isFullyQualifiedAppRoot(value) {
  if (process.platform !== 'win32') return path.isAbsolute(value);
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^\\\\[?.]\\/.test(value)) return false;
  return /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value);
}

function collectInstallEntries(appOutDir) {
  if (
    typeof appOutDir !== 'string'
    || !appOutDir.trim()
    || !isFullyQualifiedAppRoot(appOutDir)
  ) {
    throw new TypeError('Packaged app root must be a fully qualified absolute path.');
  }
  if (appOutDir.split(/[\\/]+/).includes('..')) {
    throw new TypeError('Packaged app root must not contain traversal segments.');
  }
  const root = path.resolve(appOutDir);
  const rootLinkStat = fs.lstatSync(root);
  if (rootLinkStat.isSymbolicLink()) {
    throw new Error(`Packaged app root is a reparse point: ${root}`);
  }
  const resolvedRoot = fs.realpathSync.native(root);
  if (path.normalize(resolvedRoot).toLowerCase() !== path.normalize(root).toLowerCase()) {
    throw new Error(`Packaged app root is a reparse point: ${root}`);
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new TypeError(`Packaged app directory is not a directory: ${root}`);

  const files = [];
  const directories = [];

  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareEntries(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativeInstallEntry(path.relative(root, absolutePath));
      const linkStat = fs.lstatSync(absolutePath);
      if (
        entry.isSymbolicLink()
        || linkStat.isSymbolicLink()
        || path.normalize(fs.realpathSync.native(absolutePath)).toLowerCase()
          !== path.normalize(absolutePath).toLowerCase()
      ) {
        throw new Error(`Packaged app contains a reparse point: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        directories.push(relativePath);
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Packaged app contains an unsupported entry: ${relativePath}`);
      }
      const fileStat = fs.statSync(absolutePath);
      files.push({
        path: relativePath,
        size: fileStat.size,
        sha256: sha256File(absolutePath),
        source: 'package',
      });
    }
  }

  walk(root);
  return {
    files: files.sort((left, right) => compareEntries(left.path, right.path)),
    directories: directories.sort(compareEntries),
  };
}

function requireMetadata(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} is required to generate an installer manifest.`);
  }
  return value.trim();
}

function manifestDigestPayload(manifest) {
  const copy = { ...manifest };
  delete copy.manifestSha256;
  return `${JSON.stringify(copy)}\n`;
}

function createInstallerManifest(options) {
  const input = options || {};
  const collected = collectInstallEntries(input.appOutDir);
  const configuredInstallerFiles = Array.isArray(input.installerFiles)
    ? input.installerFiles
    : DEFAULT_INSTALLER_FILES;
  const installerFiles = [
    OWNERSHIP_MARKER_PATH,
    ...configuredInstallerFiles,
  ];
  const fileMap = new Map(collected.files.map((entry) => [entry.path.toLowerCase(), entry]));
  const directoryMap = new Map(
    collected.directories.map((entry) => [entry.toLowerCase(), entry]),
  );

  for (const rawPath of installerFiles) {
    const relativePath = normalizeRelativeInstallEntry(rawPath);
    const key = relativePath.toLowerCase();
    if (!fileMap.has(key)) {
      fileMap.set(key, {
        path: relativePath,
        size: null,
        sha256: null,
        source: 'installer',
      });
    }
    let parent = path.win32.dirname(relativePath);
    while (parent && parent !== '.') {
      directoryMap.set(parent.toLowerCase(), parent);
      parent = path.win32.dirname(parent);
    }
  }

  const manifest = {
    schemaVersion: 1,
    productName: requireMetadata(input.productName, 'Product name'),
    appId: requireMetadata(input.appId, 'App ID'),
    version: requireMetadata(input.version, 'Version'),
    channel: requireMetadata(input.channel, 'Channel'),
    commit: requireMetadata(input.commit, 'Commit'),
    buildId: requireMetadata(input.buildId, 'Build ID'),
    files: Array.from(fileMap.values())
      .sort((left, right) => compareEntries(left.path, right.path)),
    directories: Array.from(directoryMap.values()).sort(compareEntries),
  };
  manifest.manifestSha256 = sha256Buffer(manifestDigestPayload(manifest));
  return manifest;
}

function assertNsisPath(relativePath) {
  const normalized = normalizeRelativeInstallEntry(relativePath);
  if (/[$"*?\r\n]/.test(normalized)) {
    throw new TypeError(`Relative install entry contains unsupported NSIS syntax: ${normalized}`);
  }
  return normalized;
}

function assertNsisDefine(value, label, pattern) {
  const normalized = String(value || '');
  if (!pattern.test(normalized)) {
    throw new TypeError(`${label} contains unsupported NSIS metadata.`);
  }
  return normalized;
}

function quoteNsisPath(relativePath) {
  return `"$INSTDIR\\${assertNsisPath(relativePath)}"`;
}

function renderNsisDeleteInclude(manifest) {
  const files = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  const directories = Array.isArray(manifest && manifest.directories)
    ? manifest.directories
    : [];
  const normalizedFiles = files.map((entry) => assertNsisPath(entry.path));
  const markerPath = OWNERSHIP_MARKER_PATH;
  const markerEntries = normalizedFiles.filter(
    (entry) => entry.toLowerCase() === markerPath,
  );
  if (markerEntries.length !== 1) {
    throw new TypeError('Installer manifest must contain exactly one ownership marker.');
  }
  const manifestSha256 = assertNsisDefine(
    manifest.manifestSha256,
    'Manifest SHA256',
    /^[A-F0-9]{64}$/,
  );
  const channel = assertNsisDefine(
    manifest.channel,
    'Installer channel',
    /^(?:stable|beta)$/,
  );
  const version = assertNsisDefine(
    manifest.version,
    'Installer version',
    /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/,
  );
  const ordinaryFiles = normalizedFiles
    .filter((entry) => entry.toLowerCase() !== markerPath)
    .sort(compareEntries);

  const normalizedDirectories = directories
    .map(assertNsisPath)
    .sort((left, right) => {
      const depthDifference = right.split('\\').length - left.split('\\').length;
      return depthDifference || compareEntries(left, right);
    });

  const lines = [
    '; Generated by build/generate-installer-manifest.js. Do not edit.',
    `!define MINERADIO_INSTALL_MANIFEST_SHA256 "${manifestSha256}"`,
    `!define MINERADIO_INSTALL_MANIFEST_CHANNEL "${channel}"`,
    `!define MINERADIO_INSTALL_MANIFEST_VERSION "${version}"`,
    '',
    '!macro MineradioRemoveManagedFiles',
    '  SetOutPath "$TEMP"',
  ];
  for (const relativePath of ordinaryFiles) {
    lines.push(`  Delete ${quoteNsisPath(relativePath)}`);
  }
  for (const relativePath of normalizedDirectories) {
    lines.push(`  RMDir ${quoteNsisPath(relativePath)}`);
  }
  for (const relativePath of markerEntries) {
    lines.push(`  Delete ${quoteNsisPath(relativePath)}`);
  }
  lines.push('!macroend', '');
  return lines.join('\n');
}

function writeFileAtomic(filePath, contents) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents);
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return absolutePath;
}

function generateInstallerManifest(options) {
  const input = options || {};
  const manifest = createInstallerManifest(input);
  const jsonPath = writeFileAtomic(
    input.jsonPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const nsisPath = writeFileAtomic(
    input.nsisPath,
    renderNsisDeleteInclude(manifest),
  );
  return { manifest, jsonPath, nsisPath };
}

module.exports = {
  DEFAULT_INSTALLER_FILES,
  collectInstallEntries,
  createInstallerManifest,
  generateInstallerManifest,
  renderNsisDeleteInclude,
  sha256File,
};
