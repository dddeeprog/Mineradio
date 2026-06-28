const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appName = context.packager.appInfo.productFilename || 'Mineradio';
  const exePath = path.join(context.appOutDir, `${appName}.exe`);
  const iconPath = path.join(context.packager.info.buildResourcesDir, 'icon.ico');
  const rceditPath = resolveRceditExecutable(context.packager.projectDir);

  if (!fs.existsSync(exePath)) throw new Error(`Mineradio executable was not found: ${exePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Mineradio icon was not found: ${iconPath}`);

  const version = context.packager.appInfo.version;
  console.log(`  • injecting Mineradio resources  rcedit=${rceditPath}`);
  execFileSync(rceditPath, buildRceditArgs({ exePath, iconPath, appName, version }), { stdio: 'inherit' });
}

afterPack.buildRceditArgs = buildRceditArgs;
afterPack.projectRceditCandidates = projectRceditCandidates;
afterPack.resolveRceditExecutable = resolveRceditExecutable;

module.exports = afterPack;
