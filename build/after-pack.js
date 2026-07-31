/*
 * Adapted from XxHuberrr/Mineradio build/after-pack.js at
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * The local rewrite resolves only project-owned tools and generates the
 * ownership manifest after executable resources are final.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateInstallerManifest } = require('./generate-installer-manifest.js');
const {
  createProductionDependencyProof,
  resolveSourceIdentity,
} = require('./source-identity.js');

function projectRceditCandidates(projectDir) {
  return [
    path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
    path.join(projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit.exe')
  ];
}

function resolveRceditExecutable(projectDir) {
  var candidates = projectRceditCandidates(projectDir);
  var hit = candidates.find(function(candidate) {
    return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
  if (!hit) {
    throw new Error(
      'No project-local rcedit executable was found for Mineradio icon injection. ' +
      'Run npm ci before packaging. Checked: ' + candidates.join(', ')
    );
  }
  return hit;
}

function buildRceditArgs(options) {
  const productName = options.productName || 'Mineradio';
  return [
    options.exePath,
    '--set-icon', options.iconPath,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'CompanyName', 'Mineradio',
    '--set-version-string', 'OriginalFilename', `${options.appName}.exe`,
    '--set-file-version', options.version,
    '--set-product-version', options.version
  ];
}

function readProjectPackageJson(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  const maxBytes = 1024 * 1024;
  const initialStat = fs.lstatSync(packagePath);
  if (initialStat.isSymbolicLink() || !initialStat.isFile()) {
    throw new Error(`Project package.json must be a regular file: ${packagePath}`);
  }
  if (!Number.isSafeInteger(initialStat.size) || initialStat.size < 0 || initialStat.size > maxBytes) {
    throw new Error(`Project package.json exceeds the ${maxBytes}-byte size limit.`);
  }

  const descriptor = fs.openSync(packagePath, 'r');
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    if (!descriptorStat.isFile() || descriptorStat.size !== initialStat.size) {
      throw new Error('Project package.json changed while it was opened.');
    }
    const buffer = Buffer.alloc(descriptorStat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== buffer.length) throw new Error('Project package.json changed while it was read.');
    return JSON.parse(buffer.toString('utf8'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function resolvePackagedFileRules(context) {
  const config = context && context.packager && context.packager.config;
  if (config && config.files !== undefined) return config.files;
  const projectDir = context && context.packager && context.packager.projectDir;
  return readProjectPackageJson(projectDir).build.files;
}

function requireBuildIdentity(value, label, pattern) {
  var normalized = String(value || '').trim();
  if (!pattern.test(normalized)) {
    throw new TypeError(`${label} contains unsupported characters.`);
  }
  return normalized;
}

function resolveInstallerBuildIdentity(options) {
  var input = options || {};
  var env = input.env || process.env;
  var version = String(input.version || '');
  var sourceIdentity = resolveSourceIdentity({
    repoDir: input.projectDir,
    env,
    buildFiles: input.buildFiles,
    gitRunner: input.gitRunner,
  });
  var channel = input.channel
    || env.MINERADIO_BUILD_CHANNEL
    || (/(?:^|[-.])beta(?:[.-]|$)/i.test(version) ? 'beta' : 'stable');
  channel = requireBuildIdentity(channel, 'Build channel', /^(?:stable|beta)$/);

  var buildId = env.MINERADIO_BUILD_ID
    || `${channel}-${version}-${sourceIdentity.commit.slice(0, 12)}`;
  buildId = requireBuildIdentity(
    buildId,
    'Build ID',
    /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/,
  );

  var createdAt;
  if (env.SOURCE_DATE_EPOCH !== undefined) {
    var epochSeconds = Number(env.SOURCE_DATE_EPOCH);
    if (!Number.isInteger(epochSeconds) || epochSeconds < 0) {
      throw new TypeError('SOURCE_DATE_EPOCH must be a non-negative integer.');
    }
    createdAt = new Date(epochSeconds * 1000).toISOString();
  } else {
    var now = input.now || function() { return new Date(); };
    createdAt = new Date(now()).toISOString();
  }

  return { channel, ...sourceIdentity, buildId, createdAt };
}

async function afterPack(context, dependencies) {
  if (context.electronPlatformName !== 'win32') return;
  var deps = dependencies || {};
  var commandRunner = deps.execFileSync || execFileSync;
  var manifestGenerator = deps.generateInstallerManifest || generateInstallerManifest;
  var dependencyProofResolver = deps.createProductionDependencyProof
    || createProductionDependencyProof;

  const appName = context.packager.appInfo.productFilename || 'Mineradio';
  const exePath = path.join(context.appOutDir, `${appName}.exe`);
  const iconPath = path.join(context.packager.info.buildResourcesDir, 'icon.ico');
  const rceditPath = resolveRceditExecutable(context.packager.projectDir);

  if (!fs.existsSync(exePath)) throw new Error(`Mineradio executable was not found: ${exePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Mineradio icon was not found: ${iconPath}`);

  const version = context.packager.appInfo.version;
  const productName = context.packager.appInfo.productName || appName;
  console.log(`  • injecting Mineradio resources  rcedit=${rceditPath}`);
  commandRunner(
    rceditPath,
    buildRceditArgs({ exePath, iconPath, appName, productName, version }),
    { stdio: 'inherit' },
  );

  const buildFiles = resolvePackagedFileRules(context);
  const buildMetadata = context.packager.config
    && context.packager.config.extraMetadata
    && context.packager.config.extraMetadata.mineradioBuild;
  const identity = resolveInstallerBuildIdentity({
    channel: buildMetadata && buildMetadata.channel,
    version,
    projectDir: context.packager.projectDir,
    buildFiles,
    env: deps.env,
    gitRunner: deps.gitRunner,
    now: deps.now,
  });
  const dependencyProof = dependencyProofResolver({
    appDir: path.join(context.appOutDir, 'resources', 'app'),
    packageLockPath: path.join(context.packager.projectDir, 'package-lock.json'),
  });
  const generatedDir = path.join(
    context.packager.info.buildResourcesDir,
    '.generated',
  );
  return manifestGenerator({
    appOutDir: context.appOutDir,
    productName,
    appId: context.packager.appInfo.id,
    version,
    ...identity,
    dependencies: dependencyProof,
    jsonPath: path.join(generatedDir, 'installer-manifest.json'),
    nsisPath: path.join(generatedDir, 'installer-files.nsh'),
  });
}

afterPack.buildRceditArgs = buildRceditArgs;
afterPack.projectRceditCandidates = projectRceditCandidates;
afterPack.resolvePackagedFileRules = resolvePackagedFileRules;
afterPack.resolveRceditExecutable = resolveRceditExecutable;
afterPack.resolveInstallerBuildIdentity = resolveInstallerBuildIdentity;

module.exports = afterPack;
