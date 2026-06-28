const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const artifactVerifier = require('../build/verify-release-artifacts.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-artifacts-'));
}

function writeFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture');
}

test('release artifact verifier only targets Mineradio setup installers', () => {
  const distDir = makeTempDir();
  const expected = [
    path.join(distDir, 'Mineradio-1.1.0-Setup.exe'),
    path.join(distDir, 'Mineradio-1.1.1-beta-Setup.exe')
  ];
  expected.forEach(writeFile);
  writeFile(path.join(distDir, 'Mineradio-1.1.0.exe'));
  writeFile(path.join(distDir, 'latest.yml'));

  assert.deepEqual(artifactVerifier.findSetupInstallers(distDir), expected.sort());
});

test('release artifact verifier records signature and SHA256 commands', () => {
  const installer = 'C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe';
  const command = artifactVerifier.buildArtifactVerificationCommand(installer);

  assert.match(command, /Import-Module Microsoft\.PowerShell\.Security/);
  assert.match(command, /Get-AuthenticodeSignature/);
  assert.match(command, /Get-FileHash/);
  assert.match(command, /-Algorithm SHA256/);
  assert.match(command, /Mineradio-1\.1\.0-Setup\.exe/);
});

test('release artifact verifier imports the Authenticode module before querying signature status', () => {
  const command = artifactVerifier.buildAuthenticodeStatusCommand('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe');

  assert.match(command, /Import-Module Microsoft\.PowerShell\.Security -ErrorAction Stop/);
  assert.match(command, /Get-AuthenticodeSignature/);
});

test('release artifact verifier records unavailable signature status when PowerShell cannot load Authenticode', () => {
  const status = JSON.parse(artifactVerifier.readAuthenticodeStatus('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe', () => {
    const error = new Error('Import-Module failed');
    error.stderr = Buffer.from('Microsoft.PowerShell.Security could not be loaded');
    throw error;
  }));

  assert.equal(status.Status, 'Unavailable');
  assert.match(status.StatusMessage, /Microsoft\.PowerShell\.Security could not be loaded/);
  assert.equal(status.Path, 'C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe');
});

test('release artifact verifier captures PowerShell stderr without duplicating command failure text', () => {
  let runnerOptions;
  const status = JSON.parse(artifactVerifier.readAuthenticodeStatus('C:\\repo\\dist\\Mineradio-1.1.0-Setup.exe', (command, args, options) => {
    runnerOptions = options;
    const error = new Error('Command failed: noisy duplicate');
    error.stderr = Buffer.from('PowerShell module load failed');
    throw error;
  }));

  assert.deepEqual(runnerOptions.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(status.StatusMessage, 'PowerShell module load failed');
});
