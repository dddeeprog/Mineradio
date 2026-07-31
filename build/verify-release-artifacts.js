const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  createProductionDependencyProof,
  resolveSourceIdentity,
} = require('./source-identity.js');

const ATTESTATION_SUFFIX = '.mineradio-attestation.json';
const RELEASE_MATERIALS = Object.freeze([
  Object.freeze({ sourcePath: 'LICENSE', packagedPath: 'resources/app/LICENSE' }),
  Object.freeze({ sourcePath: 'NOTICE.md', packagedPath: 'resources/app/NOTICE.md' }),
  Object.freeze({
    sourcePath: 'THIRD_PARTY_NOTICES.md',
    packagedPath: 'resources/app/THIRD_PARTY_NOTICES.md',
  }),
  Object.freeze({
    sourcePath: 'docs/VENDOR_MANIFEST.md',
    packagedPath: 'resources/app/docs/VENDOR_MANIFEST.md',
  }),
  Object.freeze({
    sourcePath: 'third_party/folia-major/LICENSE',
    packagedPath: 'resources/app/third_party/folia-major/LICENSE',
  }),
  Object.freeze({
    sourcePath: 'third_party/folia-major/README.md',
    packagedPath: 'resources/app/third_party/folia-major/README.md',
  }),
  Object.freeze({
    sourcePath: 'public/vendor/pretext-0.0.7.LICENSE',
    packagedPath: 'resources/app/public/vendor/pretext-0.0.7.LICENSE',
  }),
]);
const WINDOWS_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const TEXT_FILE_LIMITS = Object.freeze({
  installerManifest: 8 * 1024 * 1024,
  attestation: 2 * 1024 * 1024,
  releaseNotes: 1 * 1024 * 1024,
  packageJson: 1 * 1024 * 1024,
});
const SYSTEM_SECURITY_MODULE_IMPORT = [
  "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
  'Import-Module -Name $securityModule -Force -ErrorAction Stop',
];
const ALLOWED_BUILDER_TOP_LEVEL_OUTPUTS = Object.freeze(new Set([
  'win-unpacked',
  'builder-effective-config.yaml',
  'builder-debug.yml',
]));

function findSetupInstallers(distDir) {
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter((fileName) => /^Mineradio-.+-Setup\.exe$/i.test(fileName))
    .map((fileName) => path.join(distDir, fileName))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort();
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function buildArtifactVerificationCommand(installerPath) {
  const escaped = escapePowerShellSingleQuoted(installerPath);
  return [
    `$artifact = '${escaped}'`,
    ...SYSTEM_SECURITY_MODULE_IMPORT,
    'Get-AuthenticodeSignature -LiteralPath $artifact | Select-Object Status, StatusMessage, Path',
    '$hashStream = [System.IO.File]::Open($artifact, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)',
    'try { $hasher = [System.Security.Cryptography.SHA256]::Create(); try { $hashBytes = $hasher.ComputeHash($hashStream) } finally { $hasher.Dispose() }; [pscustomobject]@{ Algorithm = "SHA256"; Hash = [System.BitConverter]::ToString($hashBytes).Replace("-", ""); Path = $artifact } } finally { $hashStream.Dispose() }',
  ].join('; ');
}

function buildAuthenticodeStatusCommand(installerPath) {
  const escaped = escapePowerShellSingleQuoted(installerPath);
  return [
    `$artifact = '${escaped}'`,
    ...SYSTEM_SECURITY_MODULE_IMPORT,
    'Get-AuthenticodeSignature -LiteralPath $artifact | Select-Object Status, StatusMessage, Path | ConvertTo-Json -Compress',
  ].join('; ');
}

function buildWindowsMetadataCommand(installerPath) {
  const escaped = escapePowerShellSingleQuoted(installerPath);
  return [
    `$artifact = '${escaped}'`,
    ...SYSTEM_SECURITY_MODULE_IMPORT,
    '$stream = [System.IO.File]::Open($artifact, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)',
    'try {',
    '  $signature = Get-AuthenticodeSignature -LiteralPath $artifact',
    '  $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($artifact)',
    '  $hasher = [System.Security.Cryptography.SHA256]::Create()',
    '  try { $hashBytes = $hasher.ComputeHash($stream) } finally { $hasher.Dispose() }',
    "  $artifactSha256 = [System.BitConverter]::ToString($hashBytes).Replace('-', '')",
    '  $signerCertificate = if ($null -eq $signature.SignerCertificate) { $null } else { [pscustomobject]@{ Subject = [string]$signature.SignerCertificate.Subject; Thumbprint = [string]$signature.SignerCertificate.Thumbprint } }',
    '  $result = [pscustomobject]@{ ArtifactSha256 = [string]$artifactSha256; Signature = [pscustomobject]@{ Status = [string]$signature.Status; StatusMessage = [string]$signature.StatusMessage; Path = [string]$signature.Path; SignerCertificate = $signerCertificate }; VersionInfo = [pscustomobject]@{ ProductName = [string]$versionInfo.ProductName; ProductVersion = [string]$versionInfo.ProductVersion; FileVersion = [string]$versionInfo.FileVersion } }',
    '  $result | ConvertTo-Json -Compress -Depth 4',
    '} finally {',
    '  $stream.Dispose()',
    '}',
  ].join('\n');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256Descriptor(descriptor, options) {
  const input = options || {};
  const fsApi = input.fsApi || fs;
  const bufferSize = Number.isInteger(input.bufferSize) && input.bufferSize > 0
    ? input.bufferSize
    : 256 * 1024;
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(bufferSize);
  let position = 0;
  while (true) {
    const bytesRead = fsApi.readSync(
      descriptor,
      buffer,
      0,
      buffer.length,
      position,
    );
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex').toUpperCase();
}

function sha256File(filePath, options) {
  const input = options || {};
  const fsApi = input.fsApi || fs;
  const descriptor = fsApi.openSync(filePath, 'r');
  try {
    return sha256Descriptor(descriptor, input);
  } finally {
    fsApi.closeSync(descriptor);
  }
}

function processErrorText(error) {
  const parts = [];
  if (error && error.stderr) {
    parts.push(Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr));
  }
  if (error && error.stdout) {
    parts.push(Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : String(error.stdout));
  }
  if (parts.length === 0 && error && error.message) parts.push(error.message);
  return parts.join('\n').trim() || 'Authenticode status could not be read.';
}

function runPowerShell(command, execFileSyncImpl) {
  const runner = execFileSyncImpl || execFileSync;
  return runner('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', command,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readAuthenticodeStatus(installerPath, execFileSyncImpl) {
  try {
    return runPowerShell(
      buildAuthenticodeStatusCommand(installerPath),
      execFileSyncImpl,
    ).trim();
  } catch (error) {
    return JSON.stringify({
      Status: 'Unavailable',
      StatusMessage: processErrorText(error),
      Path: installerPath,
    });
  }
}

function readWindowsArtifactMetadata(installerPath, execFileSyncImpl) {
  try {
    const output = runPowerShell(
      buildWindowsMetadataCommand(installerPath),
      execFileSyncImpl,
    );
    return JSON.parse(String(output).trim());
  } catch (error) {
    return {
      artifactSha256: sha256File(installerPath),
      signature: {
        Status: 'Unavailable',
        StatusMessage: processErrorText(error),
        Path: installerPath,
      },
      versionInfo: null,
    };
  }
}

function resolveReadLimit(options, key) {
  const readLimits = options && options.readLimits;
  if (readLimits !== undefined && !isRecord(readLimits)) {
    throw new Error('Release readLimits must be an object.');
  }
  const maxBytes = readLimits
    && Object.prototype.hasOwnProperty.call(readLimits, key)
    ? readLimits[key]
    : TEXT_FILE_LIMITS[key];
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`Release ${key} read limit must be a positive safe integer.`);
  }
  return maxBytes;
}

function readBoundedTextFile(filePath, label, options) {
  const input = options || {};
  const fsApi = input.fsApi || fs;
  const maxBytes = input.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${label} read limit must be a positive safe integer.`);
  }

  let initialStat;
  try {
    initialStat = fsApi.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${filePath}`);
  }
  if (
    !initialStat
    || typeof initialStat.isSymbolicLink !== 'function'
    || initialStat.isSymbolicLink()
  ) {
    throw new Error(`${label} must not be a symbolic link: ${filePath}`);
  }
  if (typeof initialStat.isFile !== 'function' || !initialStat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  if (!Number.isSafeInteger(initialStat.size) || initialStat.size < 0) {
    throw new Error(`${label} has an invalid file size: ${filePath}`);
  }
  if (initialStat.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte size limit: ${filePath}`);
  }

  let descriptor;
  try {
    descriptor = fsApi.openSync(filePath, 'r');
  } catch (error) {
    throw new Error(`${label} is unreadable: ${filePath}`);
  }

  try {
    const descriptorStat = fsApi.fstatSync(descriptor);
    if (!descriptorStat || typeof descriptorStat.isFile !== 'function' || !descriptorStat.isFile()) {
      throw new Error(`${label} descriptor is not a regular file: ${filePath}`);
    }
    if (
      String(descriptorStat.dev) !== String(initialStat.dev)
      || String(descriptorStat.ino) !== String(initialStat.ino)
    ) {
      throw new Error(`${label} identity changed while it was opened: ${filePath}`);
    }
    if (!Number.isSafeInteger(descriptorStat.size) || descriptorStat.size < 0) {
      throw new Error(`${label} has an invalid descriptor file size: ${filePath}`);
    }
    if (descriptorStat.size > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte size limit: ${filePath}`);
    }
    if (
      descriptorStat.size !== initialStat.size
      || descriptorStat.mtimeMs !== initialStat.mtimeMs
    ) {
      throw new Error(`${label} changed while it was opened: ${filePath}`);
    }

    const blockSize = Math.min(64 * 1024, maxBytes + 1);
    const block = Buffer.allocUnsafe(blockSize);
    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const remaining = (maxBytes + 1) - totalBytes;
      const bytesRead = fsApi.readSync(
        descriptor,
        block,
        0,
        Math.min(block.length, remaining),
        null,
      );
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(block.subarray(0, bytesRead)));
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new Error(`${label} exceeds the ${maxBytes}-byte size limit: ${filePath}`);
      }
    }

    const finalStat = fsApi.fstatSync(descriptor);
    let finalPathStat;
    try {
      finalPathStat = fsApi.lstatSync(filePath);
    } catch (error) {
      throw new Error(`${label} path changed or disappeared while read: ${filePath}`);
    }
    if (
      !finalStat
      || typeof finalStat.isFile !== 'function'
      || !finalStat.isFile()
      || String(finalStat.dev) !== String(descriptorStat.dev)
      || String(finalStat.ino) !== String(descriptorStat.ino)
      || finalStat.size !== descriptorStat.size
      || finalStat.mtimeMs !== descriptorStat.mtimeMs
      || totalBytes !== descriptorStat.size
    ) {
      throw new Error(`${label} changed and was not stable while read: ${filePath}`);
    }
    if (
      !finalPathStat
      || typeof finalPathStat.isFile !== 'function'
      || !finalPathStat.isFile()
      || typeof finalPathStat.isSymbolicLink !== 'function'
      || finalPathStat.isSymbolicLink()
      || !sameStableFileMetadata(descriptorStat, finalPathStat)
    ) {
      throw new Error(`${label} path identity changed or was replaced while read: ${filePath}`);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } finally {
    fsApi.closeSync(descriptor);
  }
}
function readJsonFile(filePath, label, options) {
  const contents = readBoundedTextFile(filePath, label, options);
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is malformed JSON: ${filePath}`);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing or malformed.`);
  }
  return value.trim();
}

function requireExactString(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${label} is missing or not exact.`);
  }
  return value;
}

function normalizeSignerThumbprint(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing or malformed.`);
  const normalized = value.replace(/[\s:]/g, '').toUpperCase();
  if (!/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(normalized)) {
    throw new Error(`${label} must be a 40- or 64-character hexadecimal thumbprint.`);
  }
  return normalized;
}

function requireIsoTimestamp(value, label) {
  const normalized = requireString(value, label);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new Error(`${label} is not a canonical ISO timestamp.`);
  }
  return normalized;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
  }
}

function normalizeInstallPath(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function assertInstallerUninstallerEntry(manifest, productFilename) {
  if (!isRecord(manifest) || !Array.isArray(manifest.files)) {
    throw new Error('Installer manifest files are missing or malformed.');
  }
  const expectedPath = `Uninstall ${requireString(
    productFilename,
    'Package product filename',
  )}.exe`;
  const uninstallers = manifest.files.filter((entry) => (
    isRecord(entry)
    && entry.source === 'installer'
    && /^uninstall [^\\/]+\.exe$/i.test(String(entry.path || ''))
  ));
  if (uninstallers.length !== 1) {
    throw new Error('Installer manifest must contain exactly one generated uninstaller entry.');
  }
  const [uninstaller] = uninstallers;
  assertEqual(
    normalizeInstallPath(uninstaller.path),
    normalizeInstallPath(expectedPath),
    'Installer manifest uninstaller filename',
  );
  if (uninstaller.size !== null || uninstaller.sha256 !== null) {
    throw new Error('Installer manifest uninstaller metadata is malformed.');
  }
}

function installerManifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.manifestSha256;
  return sha256Buffer(`${JSON.stringify(copy)}\n`);
}

function readInstallerManifest(repoDir, options) {
  const manifestPath = path.join(repoDir, 'build', '.generated', 'installer-manifest.json');
  const manifest = readJsonFile(manifestPath, 'Generated installer manifest', {
    maxBytes: resolveReadLimit(options, 'installerManifest'),
  });
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Generated installer manifest has an unsupported or malformed schema.');
  }
  for (const key of [
    'productName',
    'appId',
    'version',
    'channel',
    'commit',
    'buildId',
    'createdAt',
    'manifestSha256',
  ]) {
    requireString(manifest[key], `Installer manifest ${key}`);
  }
  requireIsoTimestamp(manifest.createdAt, 'Installer manifest createdAt');
  assertEqual(
    String(manifest.manifestSha256).toUpperCase(),
    installerManifestDigest(manifest),
    'Installer manifest SHA256',
  );
  return { manifest, manifestPath };
}

function mergePackagedMetadata(pkg, extraMetadata) {
  const extra = isRecord(extraMetadata) ? extraMetadata : {};
  const baseMineradio = isRecord(pkg.mineradio) ? pkg.mineradio : {};
  const extraMineradio = isRecord(extra.mineradio) ? extra.mineradio : {};
  return {
    ...pkg,
    ...extra,
    mineradioBuild: {
      ...(isRecord(pkg.mineradioBuild) ? pkg.mineradioBuild : {}),
      ...(isRecord(extra.mineradioBuild) ? extra.mineradioBuild : {}),
    },
    mineradio: {
      ...baseMineradio,
      ...extraMineradio,
      update: {
        ...(isRecord(baseMineradio.update) ? baseMineradio.update : {}),
        ...(isRecord(extraMineradio.update) ? extraMineradio.update : {}),
      },
    },
  };
}

function firstGithubPublisher(buildConfig) {
  const publishers = Array.isArray(buildConfig.publish)
    ? buildConfig.publish
    : [buildConfig.publish];
  return publishers.find((publisher) => isRecord(publisher) && publisher.provider === 'github')
    || null;
}

function expandArtifactName(template, version) {
  const result = requireString(template, 'Setup artifact template')
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{ext\}/g, 'exe');
  if (/\$\{[^}]+\}/.test(result) || !/^Mineradio-.+-Setup\.exe$/i.test(result)) {
    throw new Error(`Setup artifact template is unsupported: ${template}.`);
  }
  return result;
}

function readPackageReleaseConfig(repoDir, options) {
  const input = options || {};
  const packagePath = path.join(repoDir, 'package.json');
  const pkg = readJsonFile(packagePath, 'package.json', {
    maxBytes: resolveReadLimit(input, 'packageJson'),
  });
  const declaredChannel = input.channel
    || (input.beta === true ? 'beta' : '')
    || (pkg.mineradioBuild && pkg.mineradioBuild.channel)
    || 'stable';
  const channel = requireString(declaredChannel, 'Package build channel');
  if (!['stable', 'beta'].includes(channel)) {
    throw new Error(`Unsupported package build channel: ${channel}.`);
  }

  let buildConfig = pkg.build;
  let metadata = pkg;
  if (channel === 'beta') {
    const betaPath = path.join(repoDir, 'build', 'electron-builder.beta.json');
    if (fs.existsSync(betaPath)) {
      const beta = readJsonFile(betaPath, 'Beta electron-builder configuration', {
        maxBytes: resolveReadLimit(input, 'packageJson'),
      });
      buildConfig = beta;
      metadata = mergePackagedMetadata(pkg, beta.extraMetadata);
    }
  }
  if (!isRecord(buildConfig)) throw new Error(`${channel} build configuration is missing.`);

  const productName = requireString(
    buildConfig.productName || metadata.productName,
    'Package product name',
  );
  const productFilename = requireString(
    buildConfig.win && buildConfig.win.executableName || productName,
    'Package product filename',
  );
  const appId = requireString(buildConfig.appId, 'Package app ID');
  const version = requireString(pkg.version, 'Package version');
  const release = pkg.mineradio && pkg.mineradio.release;
  if (!isRecord(release)) throw new Error('Package release policy is missing.');
  const signingPolicy = requireString(release.signingPolicy, 'Release signing policy');
  if (!['allow-unsigned', 'require-signed'].includes(signingPolicy)) {
    throw new Error(`Unsupported release signing policy: ${signingPolicy}.`);
  }
  if (!Array.isArray(release.trustedSignerThumbprints)) {
    throw new Error('Release trustedSignerThumbprints allowlist is missing or malformed.');
  }
  const trustedSignerThumbprints = release.trustedSignerThumbprints.map(
    (thumbprint, index) => normalizeSignerThumbprint(
      thumbprint,
      `Trusted signer thumbprint ${index + 1}`,
    ),
  );
  const freshnessMaxAgeMinutes = Number(release.freshnessMaxAgeMinutes);
  if (!Number.isFinite(freshnessMaxAgeMinutes) || freshnessMaxAgeMinutes <= 0) {
    throw new Error('Release freshnessMaxAgeMinutes must be positive.');
  }
  const declaredBuild = isRecord(metadata.mineradioBuild) ? metadata.mineradioBuild : {};
  const update = metadata.mineradio && metadata.mineradio.update;
  if (!isRecord(update)) throw new Error('Package update ownership is missing.');
  const publisher = firstGithubPublisher(buildConfig);
  const owner = requireString(
    publisher && publisher.owner || declaredBuild.releaseOwner || update.owner,
    'Release owner',
  );
  const repo = requireString(
    publisher && publisher.repo || declaredBuild.releaseRepo || update.repo,
    'Release repository',
  );
  for (const [value, label] of [
    [declaredBuild.releaseOwner, 'Build release owner'],
    [declaredBuild.releaseRepo, 'Build release repository'],
    [update.owner, 'Update release owner'],
    [update.repo, 'Update release repository'],
  ]) {
    if (value !== undefined) {
      assertEqual(value, label.includes('owner') ? owner : repo, label);
    }
  }
  const expectedUpdateChannel = channel === 'beta' ? 'beta' : 'latest';
  assertEqual(
    requireString(update.channel || declaredBuild.updateChannel, 'Update channel'),
    expectedUpdateChannel,
    'Update channel',
  );
  if (declaredBuild.channel !== undefined) {
    assertEqual(declaredBuild.channel, channel, 'Package build channel');
  }
  if (declaredBuild.appId !== undefined) assertEqual(declaredBuild.appId, appId, 'Package app ID');
  if (declaredBuild.productName !== undefined) {
    assertEqual(declaredBuild.productName, productName, 'Package product name');
  }
  const artifactName = requireString(
    buildConfig.nsis && buildConfig.nsis.artifactName
      || declaredBuild.artifactName
      || `Mineradio-${'${version}'}-Setup.${'${ext}'}`,
    'Setup artifact template',
  );
  return {
    appId,
    artifactName,
    buildFiles: Array.isArray(buildConfig.files) ? buildConfig.files : [],
    channel,
    freshnessMaxAgeMinutes,
    owner,
    outputDirectory: buildConfig.directories && buildConfig.directories.output
      || declaredBuild.outputDirectory
      || (channel === 'beta' ? 'dist-beta' : 'dist'),
    pkg,
    productFilename,
    productName,
    repo,
    signingPolicy,
    trustedSignerThumbprints,
    version,
  };
}

function resolveExpectedBuildIdentity(options) {
  const input = options || {};
  const env = input.env || process.env;
  const version = requireString(input.version, 'Build version');
  const channel = requireString(
    input.channel
      || env.MINERADIO_BUILD_CHANNEL
      || (/(?:^|[-.])beta(?:[.-]|$)/i.test(version) ? 'beta' : 'stable'),
    'Build channel',
  );
  if (!['stable', 'beta'].includes(channel)) {
    throw new Error(`Unsupported build channel: ${channel}.`);
  }
  const sourceIdentity = resolveSourceIdentity({
    repoDir: input.repoDir,
    env,
    buildFiles: input.buildFiles,
    gitRunner: input.gitRunner,
  });

  const buildId = requireString(
    env.MINERADIO_BUILD_ID
      || `${channel}-${version}-${sourceIdentity.commit.slice(0, 12)}`,
    'Build ID',
  );
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(buildId)) {
    throw new Error('Build ID is malformed.');
  }

  let createdAt = null;
  if (env.SOURCE_DATE_EPOCH !== undefined) {
    const epochSeconds = Number(env.SOURCE_DATE_EPOCH);
    if (!Number.isInteger(epochSeconds) || epochSeconds < 0) {
      throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer.');
    }
    createdAt = new Date(epochSeconds * 1000).toISOString();
  }
  return { buildId, channel, ...sourceIdentity, createdAt };
}

function assertBuildIdentity(manifest, releaseConfig, identity) {
  assertEqual(manifest.productName, releaseConfig.productName, 'Build product name');
  assertEqual(manifest.appId, releaseConfig.appId, 'Build app ID');
  assertEqual(manifest.version, releaseConfig.version, 'Build version');
  assertEqual(manifest.channel, identity.channel, 'Build channel');
  assertEqual(manifest.commit, identity.commit, 'Build commit');
  assertEqual(manifest.buildId, identity.buildId, 'Build ID');
  if (identity.createdAt) {
    assertEqual(manifest.createdAt, identity.createdAt, 'Build createdAt');
  }
  assertInstallerUninstallerEntry(manifest, releaseConfig.productFilename);
}

function assertDependencyProof(actual, expected, label) {
  if (!isRecord(actual) || !isRecord(expected)) {
    throw new Error(`${label} is missing or malformed.`);
  }
  assertEqual(
    JSON.stringify(actual),
    JSON.stringify(expected),
    label,
  );
}

function locatePackagedApp(distDir) {
  const preferred = path.join(distDir, 'win-unpacked');
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) return preferred;
  if (!fs.existsSync(distDir)) {
    throw new Error(`Packaged app directory is missing: ${preferred}`);
  }
  const candidates = fs.readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^win(?:-.+)?-unpacked$/i.test(entry.name))
    .map((entry) => path.join(distDir, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Exactly one packaged Windows app directory is required in ${distDir}.`);
  }
  return candidates[0];
}

function githubRepositoryIdentity(repository) {
  const value = typeof repository === 'string'
    ? repository
    : (isRecord(repository) ? repository.url : '');
  const match = String(value || '').match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  if (!match) throw new Error('Packaged repository ownership is missing or malformed.');
  return { owner: match[1], repo: match[2] };
}

function readPackagedReleaseIdentity(appOutDir, expected, options) {
  const input = options || {};
  const expectedIdentity = isRecord(expected) ? expected : {};
  const packagePath = path.join(appOutDir, 'resources', 'app', 'package.json');
  const pkg = readJsonFile(packagePath, 'Packaged package.json', {
    maxBytes: resolveReadLimit(input, 'packageJson'),
  });
  const build = isRecord(pkg.mineradioBuild) ? pkg.mineradioBuild : {};
  const update = pkg.mineradio && pkg.mineradio.update;
  if (!isRecord(update)) throw new Error('Packaged update ownership is missing.');
  const repository = githubRepositoryIdentity(pkg.repository);
  const identity = {
    appId: requireString(build.appId, 'Packaged app ID'),
    channel: requireString(build.channel, 'Packaged build channel'),
    owner: requireString(build.releaseOwner, 'Packaged release owner'),
    productName: requireString(build.productName || pkg.productName, 'Packaged product name'),
    repo: requireString(build.releaseRepo, 'Packaged release repository'),
    version: requireString(pkg.version, 'Packaged version'),
  };

  for (const key of ['appId', 'channel', 'owner', 'productName', 'repo', 'version']) {
    assertEqual(identity[key], requireString(expectedIdentity[key], `Expected packaged ${key}`), `Packaged ${key}`);
  }
  assertEqual(repository.owner, identity.owner, 'Packaged repository owner');
  assertEqual(repository.repo, identity.repo, 'Packaged repository name');
  assertEqual(update.owner, identity.owner, 'Packaged update owner');
  assertEqual(update.repo, identity.repo, 'Packaged update repository');
  assertEqual(
    update.channel,
    identity.channel === 'beta' ? 'beta' : 'latest',
    'Packaged update channel',
  );

  if (isRecord(input.manifest) && Array.isArray(input.manifest.files)) {
    const manifestEntry = input.manifest.files.find(
      (entry) => normalizeInstallPath(entry && entry.path) === 'resources\\app\\package.json',
    );
    if (!isRecord(manifestEntry)) {
      throw new Error('Installer manifest is missing packaged package.json identity metadata.');
    }
    const packageStat = fs.statSync(packagePath);
    assertEqual(manifestEntry.source, 'package', 'Packaged package.json manifest source');
    assertEqual(manifestEntry.size, packageStat.size, 'Packaged package.json manifest size');
    assertEqual(
      String(manifestEntry.sha256 || '').toUpperCase(),
      sha256File(packagePath),
      'Packaged package.json manifest SHA256',
    );
  }
  return identity;
}

function collectReleaseMaterials(repoDir, appOutDir, manifest) {
  const manifestFiles = new Map(
    manifest.files.map((entry) => [normalizeInstallPath(entry.path), entry]),
  );
  return RELEASE_MATERIALS.map((material) => {
    const sourceFile = path.join(repoDir, ...material.sourcePath.split('/'));
    const packagedFile = path.join(appOutDir, ...material.packagedPath.split('/'));
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      throw new Error(`Release material is missing: ${material.sourcePath}.`);
    }
    if (!fs.existsSync(packagedFile) || !fs.statSync(packagedFile).isFile()) {
      throw new Error(`Packaged release material is missing: ${material.packagedPath}.`);
    }
    const sourceSha256 = sha256File(sourceFile);
    const packagedSha256 = sha256File(packagedFile);
    assertEqual(packagedSha256, sourceSha256, `${material.sourcePath} packaged SHA256`);
    const packagedStat = fs.statSync(packagedFile);
    const manifestEntry = manifestFiles.get(normalizeInstallPath(material.packagedPath));
    if (!isRecord(manifestEntry)) {
      throw new Error(`Installer manifest is missing release material ${material.packagedPath}.`);
    }
    assertEqual(manifestEntry.source, 'package', `${material.sourcePath} manifest source`);
    assertEqual(manifestEntry.size, packagedStat.size, `${material.sourcePath} manifest size`);
    assertEqual(
      String(manifestEntry.sha256 || '').toUpperCase(),
      sourceSha256,
      `${material.sourcePath} manifest SHA256`,
    );
    return {
      sourcePath: material.sourcePath,
      packagedPath: material.packagedPath,
      size: packagedStat.size,
      sha256: sourceSha256,
    };
  });
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeFileAtomic(filePath, contents) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx' });
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return absolutePath;
}

function attestationPathFor(installerPath) {
  return `${installerPath}${ATTESTATION_SUFFIX}`;
}

function loadBuildContext(repoDir, distDir, options) {
  const { manifest, manifestPath } = readInstallerManifest(repoDir, options);
  const releaseConfig = readPackageReleaseConfig(repoDir, {
    ...(options || {}),
    channel: manifest.channel,
  });
  const appOutDir = options && options.appOutDir
    ? options.appOutDir
    : locatePackagedApp(distDir);
  const dependencies = createProductionDependencyProof({
    appDir: path.join(appOutDir, 'resources', 'app'),
    packageLockPath: path.join(repoDir, 'package-lock.json'),
  });
  const identity = resolveExpectedBuildIdentity({
    buildFiles: releaseConfig.buildFiles,
    channel: manifest.channel,
    env: options && options.env,
    gitRunner: options && options.gitRunner,
    repoDir,
    version: releaseConfig.version,
  });
  assertBuildIdentity(manifest, releaseConfig, identity);
  assertDependencyProof(
    manifest.dependencies,
    dependencies,
    'Installer manifest production dependency proof',
  );
  const releaseIdentity = readPackagedReleaseIdentity(appOutDir, {
    appId: releaseConfig.appId,
    channel: identity.channel,
    owner: releaseConfig.owner,
    productName: releaseConfig.productName,
    repo: releaseConfig.repo,
    version: releaseConfig.version,
  }, {
    ...(options || {}),
    manifest,
  });
  const materials = collectReleaseMaterials(repoDir, appOutDir, manifest);
  return {
    appOutDir,
    dependencies,
    identity,
    manifest,
    manifestPath,
    materials,
    releaseConfig,
    releaseIdentity,
  };
}

function inspectBuildTargets(buildResult) {
  if (!isRecord(buildResult)) {
    throw new Error('electron-builder build result is missing or malformed.');
  }
  if (!(buildResult.platformToTargets instanceof Map) || buildResult.platformToTargets.size === 0) {
    throw new Error('electron-builder platformToTargets target map is missing or malformed.');
  }

  let targetCount = 0;
  let hasNsis = false;
  let dirOnly = true;
  for (const [platform, targets] of buildResult.platformToTargets) {
    if (!isRecord(platform) || !(targets instanceof Map)) {
      throw new Error('electron-builder platformToTargets target map is malformed.');
    }
    const isWindows = platform.nodeName === 'win32'
      || platform.buildConfigurationKey === 'win'
      || platform.name === 'windows';
    for (const [targetName, target] of targets) {
      if (typeof targetName !== 'string' || !targetName || !isRecord(target)) {
        throw new Error('electron-builder platformToTargets target map is malformed.');
      }
      if (target.name !== undefined && target.name !== targetName) {
        throw new Error('electron-builder target map name does not match its target.');
      }
      targetCount += 1;
      if (targetName === 'dir') continue;
      dirOnly = false;
      if (targetName === 'nsis' && isWindows) {
        hasNsis = true;
        continue;
      }
      throw new Error(`Unsupported release build target: ${targetName}. Only dir and Windows nsis are allowed.`);
    }
  }
  if (targetCount === 0) {
    // electron-builder intentionally omits the synthetic `dir` target from the
    // inner map after a successful directory-only build.
    return { dirOnly: true, hasNsis: false };
  }
  return { dirOnly, hasNsis };
}

function normalizeAbsolutePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameFileIdentity(left, right) {
  return Boolean(left)
    && Boolean(right)
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino);
}

function sameStableFileMetadata(left, right) {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function openStableArtifactFile(filePath, label) {
  const absolutePath = path.resolve(filePath);
  const initialStat = fs.lstatSync(absolutePath);
  if (initialStat.isSymbolicLink() || !initialStat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${absolutePath}.`);
  }
  if (normalizeAbsolutePath(fs.realpathSync(absolutePath)) !== normalizeAbsolutePath(absolutePath)) {
    throw new Error(`${label} resolves through a symlink or reparse point: ${absolutePath}.`);
  }

  const descriptor = fs.openSync(absolutePath, 'r');
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile() || !sameStableFileMetadata(initialStat, descriptorStat)) {
      throw new Error(`${label} changed identity while it was opened: ${absolutePath}.`);
    }
    return {
      descriptor,
      filePath: absolutePath,
      label,
      stat: descriptorStat,
    };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function assertStableArtifactFile(handle) {
  const pathStat = fs.lstatSync(handle.filePath);
  const descriptorStat = fs.fstatSync(handle.descriptor);
  if (
    pathStat.isSymbolicLink()
    || !pathStat.isFile()
    || !descriptorStat.isFile()
    || !sameStableFileMetadata(handle.stat, pathStat)
    || !sameStableFileMetadata(handle.stat, descriptorStat)
    || normalizeAbsolutePath(fs.realpathSync(handle.filePath))
      !== normalizeAbsolutePath(handle.filePath)
  ) {
    throw new Error(`${handle.label} changed identity or contents during verification: ${handle.filePath}.`);
  }
}

function isReleaseLikeOutputName(fileName) {
  return (
    /\.exe$/i.test(fileName)
    || /\.blockmap$/i.test(fileName)
    || /^latest.*\.ya?ml$/i.test(fileName)
    || fileName.toLowerCase().endsWith(ATTESTATION_SUFFIX)
    || /sha256sums/i.test(fileName)
    || /\.sha256$/i.test(fileName)
  );
}

function assertNoUnexpectedReleaseOutputs(distDir, allowedArtifacts) {
  const resolvedDistDir = path.resolve(distDir);
  let distStat;
  try {
    distStat = fs.lstatSync(resolvedDistDir);
  } catch (error) {
    throw new Error(`electron-builder outDir is missing or unreadable: ${resolvedDistDir}.`);
  }
  if (distStat.isSymbolicLink()) {
    throw new Error(`electron-builder outDir must not be a symlink or reparse point: ${resolvedDistDir}.`);
  }
  if (!distStat.isDirectory()) {
    throw new Error(`electron-builder outDir is not a directory: ${resolvedDistDir}.`);
  }
  const realDistDir = normalizeAbsolutePath(fs.realpathSync(resolvedDistDir));
  if (realDistDir !== normalizeAbsolutePath(resolvedDistDir)) {
    throw new Error(`electron-builder outDir resolves through a symlink or reparse point: ${resolvedDistDir}.`);
  }

  const allowedPaths = new Set(
    (allowedArtifacts || []).map((filePath) => normalizeAbsolutePath(filePath)),
  );
  for (const allowedPath of allowedPaths) {
    if (normalizeAbsolutePath(path.dirname(allowedPath)) !== normalizeAbsolutePath(resolvedDistDir)) {
      throw new Error(`Release output allowlist entry is not top-level inside outDir: ${allowedPath}.`);
    }
  }
  for (const entry of fs.readdirSync(resolvedDistDir, { withFileTypes: true })) {
    const normalizedName = entry.name.toLowerCase();
    const outputPath = path.join(resolvedDistDir, entry.name);
    const normalizedOutputPath = normalizeAbsolutePath(outputPath);
    let expectedType = null;
    if (allowedPaths.has(normalizedOutputPath)) {
      expectedType = 'file';
    } else if (normalizedName === 'win-unpacked') {
      expectedType = 'directory';
    } else if (ALLOWED_BUILDER_TOP_LEVEL_OUTPUTS.has(normalizedName)) {
      expectedType = 'file';
    }
    if (expectedType === null) {
      throw new Error(
        `Unexpected top-level release output is not in the current version publish allowlist: ${outputPath}.`,
      );
    }

    const outputStat = fs.lstatSync(outputPath);
    if (entry.isSymbolicLink() || outputStat.isSymbolicLink()) {
      throw new Error(`Release output must not be a symlink or reparse point: ${outputPath}.`);
    }
    if (expectedType === 'file' && !outputStat.isFile()) {
      throw new Error(`Release output must be a regular file: ${outputPath}.`);
    }
    if (expectedType === 'directory' && !outputStat.isDirectory()) {
      throw new Error(`Release output ${entry.name} must be a directory: ${outputPath}.`);
    }
    if (normalizeAbsolutePath(fs.realpathSync(outputPath)) !== normalizedOutputPath) {
      throw new Error(`Release output resolves through a symlink or reparse point: ${outputPath}.`);
    }
  }
}
function selectSetupArtifact(buildResult, targetSummary) {
  if (!Array.isArray(buildResult.artifactPaths)) {
    throw new Error('electron-builder artifactPaths is missing or malformed.');
  }
  if (buildResult.artifactPaths.some((filePath) => typeof filePath !== 'string')) {
    throw new Error('electron-builder artifactPaths must contain only file paths.');
  }
  const installers = buildResult.artifactPaths
    .filter((filePath) => /^Mineradio-.+-Setup\.exe$/i.test(path.basename(filePath)))
    .sort();

  if (targetSummary.dirOnly) {
    if (installers.length !== 0) {
      throw new Error('A dir-only build must not contain a Setup artifact.');
    }
    return null;
  }
  if (!targetSummary.hasNsis || installers.length !== 1) {
    throw new Error(
      `An NSIS build must contain exactly one Setup artifact; received ${installers.length}.`,
    );
  }
  if (typeof buildResult.outDir !== 'string' || !buildResult.outDir.trim()) {
    throw new Error('electron-builder outDir is missing or malformed.');
  }

  const installerPath = path.resolve(installers[0]);
  const distDir = path.resolve(buildResult.outDir);
  if (normalizeAbsolutePath(path.dirname(installerPath)) !== normalizeAbsolutePath(distDir)) {
    throw new Error('Setup artifact must be a top-level file inside electron-builder outDir.');
  }
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
    throw new Error(`Setup artifact is missing or not a file: ${installerPath}.`);
  }
  const realInstallerParent = normalizeAbsolutePath(path.dirname(fs.realpathSync(installerPath)));
  const realDistDir = normalizeAbsolutePath(fs.realpathSync(distDir));
  if (realInstallerParent !== realDistDir) {
    throw new Error('Setup artifact resolves outside electron-builder outDir.');
  }
  return installerPath;
}

function createArtifactAttestations(buildResult, options) {
  const targetSummary = inspectBuildTargets(buildResult);
  const installerPath = selectSetupArtifact(buildResult, targetSummary);
  if (typeof buildResult.outDir !== 'string' || !buildResult.outDir.trim()) {
    throw new Error('electron-builder outDir is missing or malformed.');
  }
  const distDir = path.resolve(buildResult.outDir);
  assertNoUnexpectedReleaseOutputs(
    distDir,
    installerPath === null ? [] : [installerPath],
  );
  if (installerPath === null) return [];
  const installers = [installerPath];

  const input = options || {};
  const repoDir = input.repoDir || path.resolve(__dirname, '..');
  const context = loadBuildContext(repoDir, distDir, input);
  const expectedName = expandArtifactName(
    context.releaseConfig.artifactName,
    context.releaseConfig.version,
  );
  const generatedAt = requireIsoTimestamp(
    new Date((input.now || (() => new Date()))()).toISOString(),
    'Attestation generatedAt',
  );
  if (Date.parse(generatedAt) < Date.parse(context.manifest.createdAt)) {
    throw new Error('Attestation generatedAt precedes build createdAt.');
  }
  const manifestFileSha256 = sha256File(context.manifestPath);

  const sidecarPaths = installers.map((installerPath) => {
    assertEqual(path.basename(installerPath), expectedName, 'Setup artifact current version');
    const installerStat = fs.statSync(installerPath);
    const attestation = {
      schemaVersion: 1,
      artifact: {
        fileName: path.basename(installerPath),
        size: installerStat.size,
        sha256: sha256File(installerPath),
      },
      build: {
        productName: context.manifest.productName,
        appId: context.manifest.appId,
        version: context.manifest.version,
        channel: context.manifest.channel,
        owner: context.releaseIdentity.owner,
        repo: context.releaseIdentity.repo,
        commit: context.manifest.commit,
        sourceTree: context.identity.sourceTree,
        buildId: context.manifest.buildId,
        createdAt: context.manifest.createdAt,
      },
      installerManifest: {
        path: 'build/.generated/installer-manifest.json',
        sha256: context.manifest.manifestSha256,
        fileSha256: manifestFileSha256,
      },
      dependencies: context.dependencies,
      materials: context.materials,
      generatedAt,
    };
    const sidecarPath = attestationPathFor(installerPath);
    writeFileAtomic(sidecarPath, serializeJson(attestation));
    return sidecarPath;
  });
  return sidecarPaths;
}

function parseWindowsMetadata(value) {
  let metadata = value;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (error) {
      throw new Error('Windows artifact metadata is malformed JSON.');
    }
  }
  if (!isRecord(metadata)) throw new Error('Windows artifact metadata is malformed.');
  const signature = metadata.signature || metadata.Signature;
  const versionInfo = metadata.versionInfo || metadata.VersionInfo;
  if (!isRecord(signature) || !isRecord(versionInfo)) {
    throw new Error('Windows artifact metadata is malformed: signature and VersionInfo are required.');
  }
  const artifactSha256 = requireExactString(
    metadata.artifactSha256 || metadata.ArtifactSha256,
    'Windows artifact SHA256',
  ).toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(artifactSha256)) {
    throw new Error('Windows artifact SHA256 is malformed.');
  }
  let signerCertificate = null;
  if (signature.SignerCertificate !== null && signature.SignerCertificate !== undefined) {
    if (!isRecord(signature.SignerCertificate)) {
      throw new Error('Authenticode signer certificate metadata is malformed.');
    }
    signerCertificate = {
      Subject: requireExactString(signature.SignerCertificate.Subject, 'Signer certificate subject'),
      Thumbprint: normalizeSignerThumbprint(
        signature.SignerCertificate.Thumbprint,
        'Signer certificate thumbprint',
      ),
    };
  }
  return {
    artifactSha256,
    signature: {
      Status: requireExactString(signature.Status, 'Authenticode signature status'),
      StatusMessage: typeof signature.StatusMessage === 'string' ? signature.StatusMessage : '',
      Path: requireExactString(signature.Path, 'Authenticode signature path'),
      SignerCertificate: signerCertificate,
    },
    versionInfo: {
      ProductName: requireExactString(versionInfo.ProductName, 'Windows ProductName'),
      ProductVersion: requireExactString(versionInfo.ProductVersion, 'Windows ProductVersion'),
      FileVersion: requireExactString(versionInfo.FileVersion, 'Windows FileVersion'),
    },
  };
}

function isAcceptedWindowsVersion(actual, expected) {
  if (actual === expected) return true;
  if (!/^\d+\.\d+\.\d+$/.test(expected)) return false;
  return actual === `${expected}.0`;
}

function assertUnsignedSigningMarker(releaseNotes, version) {
  const markerPrefix = '<!-- mineradio-release-signing:';
  const markerOffsets = [];
  let searchFrom = 0;
  while (true) {
    const markerOffset = releaseNotes.indexOf(markerPrefix, searchFrom);
    if (markerOffset === -1) break;
    markerOffsets.push(markerOffset);
    searchFrom = markerOffset + markerPrefix.length;
  }
  if (markerOffsets.length !== 1) {
    throw new Error('Current release notes must contain exactly one release signing marker.');
  }

  const markerEnd = releaseNotes.indexOf('-->', markerOffsets[0] + markerPrefix.length);
  if (markerEnd === -1) {
    throw new Error('Current release signing marker is malformed.');
  }
  const marker = releaseNotes.slice(markerOffsets[0], markerEnd + 3);
  const match = /^<!-- mineradio-release-signing:(\{[^\r\n]*\}) -->$/.exec(marker);
  if (!match) throw new Error('Current release signing marker is malformed.');

  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    throw new Error('Current release signing marker contains malformed JSON.');
  }
  const keys = isRecord(payload) ? Object.keys(payload).sort() : [];
  if (keys.length !== 2 || keys[0] !== 'status' || keys[1] !== 'version') {
    throw new Error('Current release signing marker must contain only version and status.');
  }
  if (payload.version !== version) {
    throw new Error(`Release signing marker must target current version ${version}.`);
  }
  if (payload.status !== 'unsigned') {
    throw new Error('Release signing marker status must be unsigned for a NotSigned artifact.');
  }
}

function assertUnsignedDeclaration(repoDir, version, options) {
  const releaseNotesPath = path.join(repoDir, 'docs', `RELEASE_NOTES_v${version}.md`);
  const releaseNotes = readBoundedTextFile(releaseNotesPath, 'Current release notes', {
    maxBytes: resolveReadLimit(options, 'releaseNotes'),
  });
  assertUnsignedSigningMarker(releaseNotes, version);
  const explicitUnsigned = /\u672a\u7b7e\u540d|\u672a(?:\u8fdb\u884c|\u5b8c\u6210)?\u4ee3\u7801\u7b7e\u540d|\bnot\s+(?:code[- ]?)?signed\b/i;
  if (!explicitUnsigned.test(releaseNotes)) {
    throw new Error('Current release notes must explicitly declare the installer unsigned.');
  }
}

function assertSignaturePolicy(signature, releaseConfig, repoDir, options) {
  if (signature.Status === 'Valid') {
    if (!signature.SignerCertificate) {
      throw new Error('A Valid Authenticode signature must include a signer certificate.');
    }
    if (releaseConfig.trustedSignerThumbprints.length === 0) {
      throw new Error('A Valid Authenticode signature cannot pass without a trusted signer allowlist.');
    }
    if (!releaseConfig.trustedSignerThumbprints.includes(signature.SignerCertificate.Thumbprint)) {
      throw new Error(
        `Authenticode signer thumbprint is not trusted: ${signature.SignerCertificate.Thumbprint}.`,
      );
    }
    return;
  }
  if (
    signature.Status === 'NotSigned'
    && releaseConfig.signingPolicy === 'allow-unsigned'
  ) {
    assertUnsignedDeclaration(repoDir, releaseConfig.version, options);
    return;
  }
  throw new Error(
    `Authenticode signature status ${signature.Status} is not accepted by ${releaseConfig.signingPolicy}.`,
  );
}

function assertAttestation(
  attestation,
  context,
  installerPath,
  artifactSha256,
  installerStat,
) {
  if (!isRecord(attestation) || attestation.schemaVersion !== 1) {
    throw new Error('Artifact attestation has an unsupported or malformed schema.');
  }
  if (!isRecord(attestation.artifact) || !isRecord(attestation.build)) {
    throw new Error('Artifact attestation is malformed.');
  }
  assertEqual(attestation.artifact.fileName, path.basename(installerPath), 'Attestation artifact name');
  assertEqual(attestation.artifact.size, installerStat.size, 'Attestation artifact size');
  assertEqual(attestation.artifact.sha256, artifactSha256, 'Attestation artifact SHA256');

  for (const key of ['productName', 'appId', 'version', 'channel', 'commit', 'buildId', 'createdAt']) {
    assertEqual(attestation.build[key], context.manifest[key], `Attestation build ${key}`);
  }
  assertEqual(attestation.build.owner, context.releaseIdentity.owner, 'Attestation build owner');
  assertEqual(attestation.build.repo, context.releaseIdentity.repo, 'Attestation build repository');
  assertEqual(
    attestation.build.sourceTree,
    context.identity.sourceTree,
    'Attestation source tree',
  );
  requireIsoTimestamp(attestation.build.createdAt, 'Attestation build createdAt');

  if (!isRecord(attestation.installerManifest)) {
    throw new Error('Artifact attestation installer manifest metadata is malformed.');
  }
  assertEqual(
    attestation.installerManifest.path,
    'build/.generated/installer-manifest.json',
    'Attestation installer manifest path',
  );
  assertEqual(
    attestation.installerManifest.sha256,
    context.manifest.manifestSha256,
    'Attestation installer manifest SHA256',
  );
  assertEqual(
    attestation.installerManifest.fileSha256,
    sha256File(context.manifestPath),
    'Attestation installer manifest file SHA256',
  );
  assertEqual(
    JSON.stringify(attestation.materials),
    JSON.stringify(context.materials),
    'Attestation release materials',
  );
  assertDependencyProof(
    attestation.dependencies,
    context.dependencies,
    'Attestation production dependency proof',
  );
  requireIsoTimestamp(attestation.generatedAt, 'Attestation generatedAt');
}

function assertFreshness(options) {
  const nowMs = new Date(options.now()).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Freshness verification clock is invalid.');
  const maxAgeMs = options.maxAgeMinutes * 60 * 1000;
  const timestamps = [
    ['Build createdAt', Date.parse(options.createdAt)],
    ['Attestation generatedAt', Date.parse(options.generatedAt)],
    ['Setup artifact mtime', options.installerMtimeMs],
    ['Attestation mtime', fs.statSync(options.attestationPath).mtimeMs],
  ];
  for (const [label, timestamp] of timestamps) {
    if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid.`);
    if (timestamp > nowMs + WINDOWS_TIMESTAMP_TOLERANCE_MS) {
      throw new Error(`${label} is in the future and cannot pass fresh verification.`);
    }
    if (nowMs - timestamp > maxAgeMs) {
      throw new Error(`${label} is stale and cannot pass fresh verification.`);
    }
  }

  const createdAtMs = timestamps[0][1];
  const generatedAtMs = timestamps[1][1];
  const installerMtimeMs = timestamps[2][1];
  const attestationMtimeMs = timestamps[3][1];
  if (generatedAtMs < createdAtMs) {
    throw new Error('Attestation generatedAt precedes build createdAt.');
  }
  if (installerMtimeMs + WINDOWS_TIMESTAMP_TOLERANCE_MS < createdAtMs) {
    throw new Error('Setup artifact mtime predates the build createdAt timestamp.');
  }
  if (installerMtimeMs > generatedAtMs + WINDOWS_TIMESTAMP_TOLERANCE_MS) {
    throw new Error('Setup artifact mtime is newer than its attestation.');
  }
  if (Math.abs(attestationMtimeMs - generatedAtMs) > WINDOWS_TIMESTAMP_TOLERANCE_MS) {
    throw new Error('Attestation mtime does not match its generatedAt timestamp.');
  }
}

function verifyReleaseArtifacts(options) {
  const input = options || {};
  const repoDir = input.repoDir || path.resolve(__dirname, '..');
  const releaseConfig = readPackageReleaseConfig(repoDir, {
    ...input,
    channel: input.channel || (input.beta === true ? 'beta' : undefined),
  });
  const distDir = input.distDir || path.join(repoDir, releaseConfig.outputDirectory);
  const expectedName = expandArtifactName(releaseConfig.artifactName, releaseConfig.version);
  const expectedInstallerPath = path.join(distDir, expectedName);
  assertNoUnexpectedReleaseOutputs(distDir, [
    expectedInstallerPath,
    attestationPathFor(expectedInstallerPath),
  ]);
  const installers = findSetupInstallers(distDir);
  if (installers.length === 0) {
    throw new Error('No Mineradio setup installer was found. Run npm run build:win before verifying release artifacts.');
  }
  if (installers.length !== 1) {
    throw new Error('Exactly one current-version Mineradio setup installer is required; remove unexpected setup artifacts.');
  }
  const installerPath = installers[0];
  assertEqual(path.basename(installerPath), expectedName, 'Setup artifact current version');

  const context = loadBuildContext(repoDir, distDir, input);
  const sidecarPath = attestationPathFor(installerPath);
  const attestation = readJsonFile(sidecarPath, 'Artifact attestation', {
    maxBytes: resolveReadLimit(input, 'attestation'),
  });
  const expectedSidecarSha256 = sha256Buffer(
    Buffer.from(serializeJson(attestation), 'utf8'),
  );
  const sidecarHandle = openStableArtifactFile(sidecarPath, 'Artifact attestation');
  let installerHandle = null;
  try {
    const sidecarSha256 = sha256Descriptor(sidecarHandle.descriptor);
    assertEqual(
      sidecarSha256,
      expectedSidecarSha256,
      'Artifact attestation canonical SHA256',
    );
    assertStableArtifactFile(sidecarHandle);

    installerHandle = openStableArtifactFile(installerPath, 'Setup artifact');
    const artifactSha256 = sha256Descriptor(installerHandle.descriptor);
    assertStableArtifactFile(installerHandle);
    assertAttestation(
      attestation,
      context,
      installerPath,
      artifactSha256,
      installerHandle.stat,
    );
    assertStableArtifactFile(installerHandle);

    const metadataReader = input.readWindowsMetadata || readWindowsArtifactMetadata;
    const metadata = parseWindowsMetadata(metadataReader(installerPath));
    assertEqual(
      metadata.artifactSha256,
      artifactSha256,
      'Authenticode metadata artifact SHA256',
    );
    assertEqual(
      path.resolve(metadata.signature.Path).toLowerCase(),
      path.resolve(installerPath).toLowerCase(),
      'Authenticode signature path',
    );
    assertEqual(metadata.versionInfo.ProductName, releaseConfig.productName, 'Windows product name');
    if (!isAcceptedWindowsVersion(metadata.versionInfo.ProductVersion, releaseConfig.version)) {
      throw new Error(`Windows product version mismatch: expected ${releaseConfig.version}, received ${metadata.versionInfo.ProductVersion}.`);
    }
    if (!isAcceptedWindowsVersion(metadata.versionInfo.FileVersion, releaseConfig.version)) {
      throw new Error(`Windows file version mismatch: expected ${releaseConfig.version}, received ${metadata.versionInfo.FileVersion}.`);
    }
    assertSignaturePolicy(metadata.signature, releaseConfig, repoDir, input);
    assertStableArtifactFile(installerHandle);

    if (input.fresh) {
      assertFreshness({
        now: input.now || (() => new Date()),
        maxAgeMinutes: releaseConfig.freshnessMaxAgeMinutes,
        createdAt: context.manifest.createdAt,
        generatedAt: attestation.generatedAt,
        installerMtimeMs: installerHandle.stat.mtimeMs,
        attestationPath: sidecarPath,
      });
      assertStableArtifactFile(installerHandle);
    }
    assertEqual(
      sha256Descriptor(installerHandle.descriptor),
      artifactSha256,
      'Setup artifact stable SHA256',
    );
    assertStableArtifactFile(installerHandle);
    assertEqual(
      sha256Descriptor(sidecarHandle.descriptor),
      sidecarSha256,
      'Artifact attestation stable SHA256',
    );
    assertStableArtifactFile(sidecarHandle);

    return [{
      path: installerPath,
      publishableArtifacts: [installerPath, sidecarPath],
      sha256: artifactSha256,
      authenticode: metadata.signature,
      versionInfo: metadata.versionInfo,
      attestationPath: sidecarPath,
      command: buildArtifactVerificationCommand(installerPath),
    }];
  } finally {
    if (installerHandle) fs.closeSync(installerHandle.descriptor);
    fs.closeSync(sidecarHandle.descriptor);
  }
}

function parseCliArguments(args) {
  const input = Array.isArray(args) ? args : [];
  let beta = false;
  let fresh = false;
  for (const argument of input) {
    if (argument === '--beta' && !beta) {
      beta = true;
      continue;
    }
    if (argument === '--fresh' && !fresh) {
      fresh = true;
      continue;
    }
    throw new Error(`Unknown or duplicate release verification argument: ${argument}.`);
  }
  return { beta, fresh };
}

function afterAllArtifactBuild(buildResult) {
  return createArtifactAttestations(buildResult);
}

Object.assign(afterAllArtifactBuild, {
  ATTESTATION_SUFFIX,
  RELEASE_MATERIALS,
  TEXT_FILE_LIMITS,
  assertInstallerUninstallerEntry,
  assertNoUnexpectedReleaseOutputs,
  attestationPathFor,
  buildAuthenticodeStatusCommand,
  buildArtifactVerificationCommand,
  buildWindowsMetadataCommand,
  collectReleaseMaterials,
  createArtifactAttestations,
  findSetupInstallers,
  inspectBuildTargets,
  isReleaseLikeOutputName,
  parseCliArguments,
  readBoundedTextFile,
  readPackagedReleaseIdentity,
  selectSetupArtifact,
  readAuthenticodeStatus,
  readWindowsArtifactMetadata,
  resolveExpectedBuildIdentity,
  sha256File,
  verifyReleaseArtifacts,
});

if (require.main === module) {
  try {
    const cliOptions = parseCliArguments(process.argv.slice(2));
    const results = verifyReleaseArtifacts(cliOptions);
    for (const result of results) {
      console.log(`Artifact: ${result.path}`);
      console.log(`Authenticode: ${JSON.stringify(result.authenticode)}`);
      console.log(`VersionInfo: ${JSON.stringify(result.versionInfo)}`);
      console.log(`SHA256: ${result.sha256}`);
      console.log(`Attestation: ${result.attestationPath}`);
      console.log(`PowerShell: ${result.command}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = afterAllArtifactBuild;
