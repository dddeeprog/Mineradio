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
  return [
    options.exePath,
    '--set-icon', options.iconPath,
    '--set-version-string', 'FileDescription', 'Mineradio',
    '--set-version-string', 'ProductName', 'Mineradio',
    '--set-version-string', 'CompanyName', 'Mineradio',
    '--set-version-string', 'OriginalFilename', `${options.appName}.exe`,
    '--set-file-version', options.version,
    '--set-product-version', options.version
  ];
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
  var channel = env.MINERADIO_BUILD_CHANNEL
    || (/(?:^|[-.])beta(?:[.-]|$)/i.test(version) ? 'beta' : 'stable');
  channel = requireBuildIdentity(channel, 'Build channel', /^(?:stable|beta)$/);

  var commit = env.MINERADIO_BUILD_COMMIT;
  if (!commit) {
    var gitRunner = input.gitRunner || execFileSync;
    commit = gitRunner('git', ['rev-parse', 'HEAD'], {
      cwd: input.projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  commit = requireBuildIdentity(commit, 'Build commit', /^[A-Fa-f0-9]{7,64}$/);

  var buildId = env.MINERADIO_BUILD_ID
    || `${channel}-${version}-${commit.slice(0, 12)}`;
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

  return { channel, commit, buildId, createdAt };
}

async function afterPack(context, dependencies) {
  if (context.electronPlatformName !== 'win32') return;
  var deps = dependencies || {};
  var commandRunner = deps.execFileSync || execFileSync;
  var manifestGenerator = deps.generateInstallerManifest || generateInstallerManifest;

  const appName = context.packager.appInfo.productFilename || 'Mineradio';
  const exePath = path.join(context.appOutDir, `${appName}.exe`);
  const iconPath = path.join(context.packager.info.buildResourcesDir, 'icon.ico');
  const rceditPath = resolveRceditExecutable(context.packager.projectDir);

  if (!fs.existsSync(exePath)) throw new Error(`Mineradio executable was not found: ${exePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Mineradio icon was not found: ${iconPath}`);

  const version = context.packager.appInfo.version;
  console.log(`  • injecting Mineradio resources  rcedit=${rceditPath}`);
  commandRunner(
    rceditPath,
    buildRceditArgs({ exePath, iconPath, appName, version }),
    { stdio: 'inherit' },
  );

  const identity = resolveInstallerBuildIdentity({
    version,
    projectDir: context.packager.projectDir,
    env: deps.env,
    gitRunner: deps.gitRunner,
    now: deps.now,
  });
  const generatedDir = path.join(
    context.packager.info.buildResourcesDir,
    '.generated',
  );
  return manifestGenerator({
    appOutDir: context.appOutDir,
    productName: context.packager.appInfo.productName || appName,
    appId: context.packager.appInfo.id,
    version,
    ...identity,
    jsonPath: path.join(generatedDir, 'installer-manifest.json'),
    nsisPath: path.join(generatedDir, 'installer-files.nsh'),
  });
}

afterPack.buildRceditArgs = buildRceditArgs;
afterPack.projectRceditCandidates = projectRceditCandidates;
afterPack.resolveRceditExecutable = resolveRceditExecutable;
afterPack.resolveInstallerBuildIdentity = resolveInstallerBuildIdentity;

module.exports = afterPack;
