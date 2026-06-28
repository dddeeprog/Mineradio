const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function findSetupInstallers(distDir) {
  if (!fs.existsSync(distDir)) return [];
  return fs.readdirSync(distDir)
    .filter(function(fileName) { return /^Mineradio-.+-Setup\.exe$/i.test(fileName); })
    .map(function(fileName) { return path.join(distDir, fileName); })
    .filter(function(filePath) { return fs.statSync(filePath).isFile(); })
    .sort();
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function buildArtifactVerificationCommand(installerPath) {
  var escaped = escapePowerShellSingleQuoted(installerPath);
  return [
    "$artifact = '" + escaped + "'",
    'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    'Get-AuthenticodeSignature -LiteralPath $artifact | Select-Object Status, StatusMessage, Path',
    'Get-FileHash -LiteralPath $artifact -Algorithm SHA256 | Select-Object Algorithm, Hash, Path'
  ].join('; ');
}

function buildAuthenticodeStatusCommand(installerPath) {
  var escaped = escapePowerShellSingleQuoted(installerPath);
  return [
    "$artifact = '" + escaped + "'",
    'Import-Module Microsoft.PowerShell.Security -ErrorAction Stop',
    'Get-AuthenticodeSignature -LiteralPath $artifact | Select-Object Status, StatusMessage, Path | ConvertTo-Json -Compress'
  ].join('; ');
}

function sha256File(filePath) {
  var hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

function processErrorText(error) {
  var parts = [];
  if (error && error.stderr) parts.push(Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr));
  if (error && error.stdout) parts.push(Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : String(error.stdout));
  if (parts.length === 0 && error && error.message) parts.push(error.message);
  return parts.join('\n').trim() || 'Authenticode status could not be read.';
}

function readAuthenticodeStatus(installerPath, execFileSyncImpl) {
  var runner = execFileSyncImpl || execFileSync;
  try {
    var output = runner('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      buildAuthenticodeStatusCommand(installerPath)
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return output.trim();
  } catch (error) {
    return JSON.stringify({
      Status: 'Unavailable',
      StatusMessage: processErrorText(error),
      Path: installerPath
    });
  }
}

function verifyReleaseArtifacts(options) {
  var repoDir = options && options.repoDir ? options.repoDir : path.resolve(__dirname, '..');
  var distDir = options && options.distDir ? options.distDir : path.join(repoDir, 'dist');
  var installers = findSetupInstallers(distDir);

  if (installers.length === 0) {
    throw new Error('No Mineradio setup installer was found. Run npm run build:win before verifying release artifacts.');
  }

  return installers.map(function(installerPath) {
    return {
      path: installerPath,
      sha256: sha256File(installerPath),
      authenticode: readAuthenticodeStatus(installerPath),
      command: buildArtifactVerificationCommand(installerPath)
    };
  });
}

if (require.main === module) {
  try {
    var results = verifyReleaseArtifacts();
    results.forEach(function(result) {
      console.log('Artifact: ' + result.path);
      console.log('Authenticode: ' + result.authenticode);
      console.log('SHA256: ' + result.sha256);
      console.log('PowerShell: ' + result.command);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildAuthenticodeStatusCommand,
  buildArtifactVerificationCommand,
  findSetupInstallers,
  readAuthenticodeStatus,
  sha256File,
  verifyReleaseArtifacts
};
