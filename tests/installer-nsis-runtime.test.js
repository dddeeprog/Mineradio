'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const guardPath = path.join(repoRoot, 'build', 'installer-guard.nsh');
const stdUtilsIncludePath = path.join(
  repoRoot,
  'node_modules/app-builder-lib/templates/nsis/include/StdUtils.nsh',
);
const runtimeManifestContents = '{"fixture":"mineradio-runtime"}';
const runtimeManifestFileSha256 = crypto.createHash('sha256').update(runtimeManifestContents).digest('hex').toUpperCase();
const tempDirectories = new Set();

function nsisPath(value) {
  assert.doesNotMatch(value, /[$"\r\n]/, `unsafe NSIS fixture path: ${value}`);
  return value.replaceAll('/', '\\');
}

function findMakensis() {
  const configured = process.env.NSIS_MAKENSIS;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const localAppData = process.env.LOCALAPPDATA;
  assert.ok(localAppData, 'LOCALAPPDATA is required to locate electron-builder NSIS');
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache');
  const queue = [{ directory: cacheRoot, depth: 0 }];

  while (queue.length > 0) {
    const { directory, depth } = queue.shift();
    if (!fs.existsSync(directory)) {
      continue;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') {
        return candidate;
      }
      if (entry.isDirectory() && depth < 6) {
        queue.push({ directory: candidate, depth: depth + 1 });
      }
    }
  }

  assert.fail(`makensis.exe was not found under ${cacheRoot}`);
}

function findStdUtilsPluginDirectory() {
  const localAppData = process.env.LOCALAPPDATA;
  assert.ok(localAppData, 'LOCALAPPDATA is required to locate electron-builder NSIS resources');
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache');
  const queue = [{ directory: cacheRoot, depth: 0 }];

  while (queue.length > 0) {
    const { directory, depth } = queue.shift();
    if (!fs.existsSync(directory)) {
      continue;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (
        entry.isFile()
        && entry.name.toLowerCase() === 'stdutils.dll'
        && path.basename(directory).toLowerCase() === 'x86-unicode'
      ) {
        return directory;
      }
      if (entry.isDirectory() && depth < 8) {
        queue.push({ directory: candidate, depth: depth + 1 });
      }
    }
  }

  assert.fail(`StdUtils.dll was not found under ${cacheRoot}`);
}

function runExecutable(executable, args, cwd, diagnosticPath = '') {
  const result = childProcess.spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });

  assert.equal(
    result.error,
    undefined,
    `failed to start ${executable}: ${result.error?.message}`,
  );
  assert.equal(
    result.status,
    0,
    [
      `${path.basename(executable)} exited with ${result.status}`,
      result.stdout,
      result.stderr,
      diagnosticPath && fs.existsSync(diagnosticPath)
        ? `${path.basename(diagnosticPath)}: ${fs.readFileSync(diagnosticPath, 'utf8')}`
        : '',
    ].filter(Boolean).join('\n'),
  );
}

function compileFixture(directory, name, source) {
  const scriptPath = path.join(directory, `${name}.nsi`);
  const executablePath = path.join(directory, `${name}.exe`);
  fs.writeFileSync(scriptPath, source, 'utf8');
  runExecutable(findMakensis(), ['/V2', scriptPath], directory);
  assert.ok(fs.existsSync(executablePath), `${name}.exe was not generated`);
  return executablePath;
}

function createTempDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirectories.add(directory);
  return directory;
}

function registryKey() {
  return [
    'Software',
    'MineradioTests',
    `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  ].join('\\');
}

function cleanupRegistry(key) {
  childProcess.spawnSync(
    'reg.exe',
    ['delete', `HKCU\\${key}`, '/f'],
    { encoding: 'utf8', windowsHide: true },
  );
}

function executableCapability(executable, args) {
  const result = childProcess.spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });

  if (
    result.error
    && ['EACCES', 'EPERM'].includes(result.error.code)
  ) {
    return {
      available: false,
      reason: `${path.basename(executable)} execution was denied (${result.error.code})`,
    };
  }

  assert.equal(
    result.error,
    undefined,
    `failed to probe ${executable}: ${result.error?.message}`,
  );
  assert.equal(
    result.status,
    0,
    `${path.basename(executable)} capability probe exited with ${result.status}`,
  );
  return { available: true };
}

function registryCapability(key) {
  const result = childProcess.spawnSync(
    'reg.exe',
    ['add', `HKCU\\${key}`, '/v', 'Probe', '/t', 'REG_SZ', '/d', 'ok', '/f'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  );

  if (result.error || result.status !== 0) {
    return {
      available: false,
      reason: 'the runtime does not permit disposable HKCU test-key writes',
    };
  }

  cleanupRegistry(key);
  return { available: true };
}

function guardDefines(key) {
  return [
    '!include "LogicLib.nsh"',
    '!include "FileFunc.nsh"',
    `!define INSTALL_REGISTRY_KEY "${key}"`,
    `!define MINERADIO_PENDING_REGISTRY_KEY "${key}.Pending"`,
    `!define UNINSTALL_REGISTRY_KEY "${key}\\Uninstall"`,
    '!define MINERADIO_UNINSTALL_FILENAME "Uninstall Mineradio.exe"',
    `!define MINERADIO_INSTALL_MANIFEST_SHA256 "${'A'.repeat(64)}"`,
    `!define MINERADIO_INSTALL_MANIFEST_FILE_SHA256 "${runtimeManifestFileSha256}"`,
    '!define MINERADIO_INSTALL_MANIFEST_CHANNEL "stable"',
    '!define MINERADIO_INSTALL_MANIFEST_VERSION "1.1.0"',
    '!define MINERADIO_INSTALL_PRODUCT_NAME "Mineradio"',
    '!define MINERADIO_INSTALL_APP_ID "com.mineradio.desktop"',
    '!define MINERADIO_INSTALL_COMMIT "runtime-fixture"',
    '!define MINERADIO_INSTALL_BUILD_ID "runtime-fixture"',
    '!define MINERADIO_INSTALL_BUILD_CREATED_AT "2026-07-29T00:00:00.000Z"',
  ].join('\n');
}

function commonDefines(key) {
  return [
    `!addplugindir /x86-unicode "${nsisPath(findStdUtilsPluginDirectory())}"`,
    `!include "${nsisPath(stdUtilsIncludePath)}"`,
    guardDefines(key),
  ].join('\n');
}

function runtimeOwnerMarker(installRoot, overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    channel: 'stable',
    version: '1.1.0',
    installPath: installRoot.replaceAll('\\', '/'),
    manifestSha256: 'A'.repeat(64),
    commit: 'runtime-fixture',
    buildId: 'runtime-fixture',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  });
}
function reservationFixture({ key, installRoot, resultPath, outputPath }) {
  return `
Unicode true
Name "Mineradio ownership runtime fixture"
OutFile "${nsisPath(outputPath)}"
RequestExecutionLevel user
SilentInstall silent
InstallDir "${nsisPath(installRoot)}"

${commonDefines(key)}
!include "${nsisPath(guardPath)}"
!insertmacro MineradioDefineInstalledManifestValidator

Section
  SetShellVarContext current
  StrCpy $INSTDIR "${nsisPath(installRoot)}"
  StrCpy $MineradioOwnedUpgrade "0"
  StrCpy $MineradioOwnedUpgradePath ""
  StrCpy $MineradioInstallReservationActive "0"

  Call MineradioEnsureInstallReservation
  Pop $0
  StrCmp "$0" "1" 0 ReservationFailed
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 ReservationTmpMissing
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json" ReservationPromotedEarly 0

  FileOpen $1 "$INSTDIR\\payload.txt" w
  IfErrors PayloadWriteFailed
  FileWrite $1 "payload"
  FileClose $1
  Call MineradioValidateInstallPath
  Pop $0
  StrCmp "$0" "1" 0 PathDuringRecoveryInvalid

  StrCpy $MineradioGuardInput "$INSTDIR\\.mineradio-install-owner.json"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "0" 0 FinalMarkerUnexpectedMatch

  Call MineradioValidateSelectedOwnership
  Pop $0
  StrCmp "$0" "0" 0 ExistingOwnershipUnexpected

  StrCpy $MineradioGuardInput "$INSTDIR\\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" 0 PendingMarkerMismatch


  StrCpy $MineradioInstallReservationActive "0"
  Call MineradioRecoverOwnershipTransaction
  Pop $0
  StrCmp "$0" "1" 0 RecoveryFailed
  StrCmp "$MineradioInstallReservationActive" "1" 0 RecoveryInactive
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json" RecoveryPromotedEarly 0
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 RecoveryTmpMissing

  FileOpen $1 "$INSTDIR\\.mineradio-install-manifest.json" w
  IfErrors ManifestWriteFailed
  FileWrite $1 "corrupt"
  IfErrors ManifestWriteFailedOpen
  FileClose $1
  Call MineradioCommitInstalledOwnership
  Pop $0
  StrCmp "$0" "0" 0 CorruptManifestCommitted
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json" CorruptManifestPromoted 0
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 CorruptManifestLostPending

  FileOpen $1 "$INSTDIR\\.mineradio-install-manifest.json" w
  IfErrors ManifestWriteFailed
  FileWrite $1 \`${runtimeManifestContents}\`
  IfErrors ManifestWriteFailedOpen
  FileClose $1
  Call MineradioValidateInstalledManifest
  Pop $0
  StrCmp "$0" "1" 0 ValidManifestRejected
  Call MineradioCommitInstalledOwnership
  Pop $0
  StrCmp "$0" "1" 0 OwnershipCommitFailed
  Call MineradioValidateSelectedOwnership
  Pop $0
  StrCmp "$0" "1" 0 OwnershipInvalid
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json" 0 FinalMarkerMissing
  IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" TmpMarkerRemains 0

  ClearErrors
  ReadRegDWORD $0 SHELL_CONTEXT "\${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  IfErrors PendingCleared
  StrCmp "$0" "1" PendingStillActive

  PendingCleared:
    StrCpy $MineradioOwnedUpgradePath "$INSTDIR"
    Call MineradioEnsureInstallReservation
    Pop $0
    StrCmp "$0" "1" 0 UpgradeReservationFailed
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 UpgradeReservationTmpMissing
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json" 0 UpgradeFinalMissingBeforeUninstall

    ClearErrors
    Delete "$INSTDIR\\.mineradio-install-owner.json"
    IfErrors UpgradeFinalDeleteFailed
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json" UpgradeFinalDeleteFailed 0
    DeleteRegKey SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}"
    ReadRegDWORD $0 SHELL_CONTEXT "\${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
    StrCmp "$0" "1" 0 UpgradePendingLost

    FileOpen $1 "$INSTDIR\\upgrade-partial.txt" w
    IfErrors UpgradePayloadWriteFailed
    FileWrite $1 "partial"
    FileClose $1

    StrCpy $MineradioInstallReservationActive "0"
    StrCpy $MineradioOwnedUpgradePath ""
    Call MineradioRecoverOwnershipTransaction
    Pop $0
    StrCmp "$0" "1" 0 UpgradeRecoveryFailed
    StrCmp "$MineradioInstallReservationActive" "1" 0 UpgradeRecoveryInactive
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json" UpgradePromotedEarly 0
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 UpgradeRecoveryTmpMissing

    FileOpen $1 "$INSTDIR\\.mineradio-install-manifest.json" w
    IfErrors UpgradeManifestWriteFailed
    FileWrite $1 "corrupt-upgrade"
    IfErrors UpgradeManifestWriteFailedOpen
    FileClose $1
    Call MineradioCommitInstalledOwnership
    Pop $0
    StrCmp "$0" "0" 0 UpgradeCorruptManifestCommitted
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json" UpgradeCorruptManifestPromoted 0
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" 0 UpgradeCorruptManifestLostPending

    FileOpen $1 "$INSTDIR\\.mineradio-install-manifest.json" w
    IfErrors UpgradeManifestWriteFailed
    FileWrite $1 \`${runtimeManifestContents}\`
    IfErrors UpgradeManifestWriteFailedOpen
    FileClose $1
    Call MineradioValidateInstalledManifest
    Pop $0
    StrCmp "$0" "1" 0 UpgradeValidManifestRejected
    Call MineradioCommitInstalledOwnership
    Pop $0
    StrCmp "$0" "1" 0 UpgradeOwnershipCommitFailed
    Call MineradioValidateSelectedOwnership
    Pop $0
    StrCmp "$0" "1" 0 UpgradeOwnershipInvalid
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json" 0 UpgradeFinalMarkerMissing
    IfFileExists "$INSTDIR\\.mineradio-install-owner.json.tmp" UpgradeTmpMarkerRemains 0

    ClearErrors
    ReadRegDWORD $0 SHELL_CONTEXT "\${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
    IfErrors UpgradePendingCleared
    StrCmp "$0" "1" UpgradePendingStillActive UpgradePendingCleared

  UpgradePendingCleared:
    FileOpen $0 "${nsisPath(resultPath)}" w
    FileWrite $0 "PASS"
    FileClose $0
    DeleteRegKey SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}"
    DeleteRegKey SHELL_CONTEXT "\${MINERADIO_PENDING_REGISTRY_KEY}"
    SetErrorLevel 0
    Quit


  ReservationFailed:
    StrCpy $9 "reservation-failed"
    Goto FixtureFailed
  ReservationTmpMissing:
    StrCpy $9 "reservation-tmp-missing"
    Goto FixtureFailed
  PendingMarkerMismatch:
    StrCpy $9 "pending-marker-mismatch"
    Goto FixtureFailed
  PathDuringRecoveryInvalid:
    StrCpy $9 "path-during-recovery-invalid"
    Goto FixtureFailed
  FinalMarkerUnexpectedMatch:
    StrCpy $9 "final-marker-unexpected-match"
    Goto FixtureFailed
  ExistingOwnershipUnexpected:
    StrCpy $9 "existing-ownership-unexpected"
    Goto FixtureFailed
  ReservationPromotedEarly:
    StrCpy $9 "reservation-promoted-early"
    Goto FixtureFailed
  PayloadWriteFailed:
    StrCpy $9 "payload-write-failed"
    Goto FixtureFailed
  RecoveryFailed:
    StrCpy $9 "recovery-failed"
    Goto FixtureFailed
  RecoveryInactive:
    StrCpy $9 "recovery-inactive"
    Goto FixtureFailed
  RecoveryPromotedEarly:
    StrCpy $9 "recovery-promoted-early"
    Goto FixtureFailed
  RecoveryTmpMissing:
    StrCpy $9 "recovery-tmp-missing"
    Goto FixtureFailed
  ManifestWriteFailedOpen:
    FileClose $1
  ManifestWriteFailed:
    StrCpy $9 "manifest-write-failed"
    Goto FixtureFailed
  CorruptManifestCommitted:
    StrCpy $9 "corrupt-manifest-committed"
    Goto FixtureFailed
  CorruptManifestPromoted:
    StrCpy $9 "corrupt-manifest-promoted"
    Goto FixtureFailed
  CorruptManifestLostPending:
    StrCpy $9 "corrupt-manifest-lost-pending"
    Goto FixtureFailed
  ValidManifestRejected:
    StrCpy $9 "valid-manifest-rejected"
    Goto FixtureFailed
  OwnershipCommitFailed:
    StrCpy $9 "ownership-commit-failed"
    Goto FixtureFailed
  OwnershipInvalid:
    StrCpy $9 "ownership-invalid"
    Goto FixtureFailed
  FinalMarkerMissing:
    StrCpy $9 "final-marker-missing"
    Goto FixtureFailed
  TmpMarkerRemains:
    StrCpy $9 "tmp-marker-remains"
    Goto FixtureFailed
  PendingStillActive:
    StrCpy $9 "pending-still-active"

  UpgradeReservationFailed:
    StrCpy $9 "upgrade-reservation-failed"
    Goto FixtureFailed
  UpgradeReservationTmpMissing:
    StrCpy $9 "upgrade-reservation-tmp-missing"
    Goto FixtureFailed
  UpgradeFinalMissingBeforeUninstall:
    StrCpy $9 "upgrade-final-missing-before-uninstall"
    Goto FixtureFailed
  UpgradeFinalDeleteFailed:
    StrCpy $9 "upgrade-final-delete-failed"
    Goto FixtureFailed
  UpgradePendingLost:
    StrCpy $9 "upgrade-pending-lost"
    Goto FixtureFailed
  UpgradePayloadWriteFailed:
    StrCpy $9 "upgrade-payload-write-failed"
    Goto FixtureFailed
  UpgradeRecoveryFailed:
    StrCpy $9 "upgrade-recovery-failed"
    Goto FixtureFailed
  UpgradeRecoveryInactive:
    StrCpy $9 "upgrade-recovery-inactive"
    Goto FixtureFailed
  UpgradePromotedEarly:
    StrCpy $9 "upgrade-promoted-early"
    Goto FixtureFailed
  UpgradeRecoveryTmpMissing:
    StrCpy $9 "upgrade-recovery-tmp-missing"
    Goto FixtureFailed
  UpgradeManifestWriteFailedOpen:
    FileClose $1
  UpgradeManifestWriteFailed:
    StrCpy $9 "upgrade-manifest-write-failed"
    Goto FixtureFailed
  UpgradeCorruptManifestCommitted:
    StrCpy $9 "upgrade-corrupt-manifest-committed"
    Goto FixtureFailed
  UpgradeCorruptManifestPromoted:
    StrCpy $9 "upgrade-corrupt-manifest-promoted"
    Goto FixtureFailed
  UpgradeCorruptManifestLostPending:
    StrCpy $9 "upgrade-corrupt-manifest-lost-pending"
    Goto FixtureFailed
  UpgradeValidManifestRejected:
    StrCpy $9 "upgrade-valid-manifest-rejected"
    Goto FixtureFailed
  UpgradeOwnershipCommitFailed:
    StrCpy $9 "upgrade-ownership-commit-failed"
    Goto FixtureFailed
  UpgradeOwnershipInvalid:
    StrCpy $9 "upgrade-ownership-invalid"
    Goto FixtureFailed
  UpgradeFinalMarkerMissing:
    StrCpy $9 "upgrade-final-marker-missing"
    Goto FixtureFailed
  UpgradeTmpMarkerRemains:
    StrCpy $9 "upgrade-tmp-marker-remains"
    Goto FixtureFailed
  UpgradePendingStillActive:
    StrCpy $9 "upgrade-pending-still-active"
    Goto FixtureFailed

  FixtureFailed:
    FileOpen $0 "${nsisPath(resultPath)}" w
    FileWrite $0 "FAIL:$9:$INSTDIR:$MineradioInstallReservationActive"
    FileClose $0
    DeleteRegKey SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}"
    DeleteRegKey SHELL_CONTEXT "\${MINERADIO_PENDING_REGISTRY_KEY}"
    SetErrorLevel 1
    Quit
SectionEnd
`;
}

function cleanupFixture({
  key,
  installRoot,
  outsideSentinel,
  resultPath,
  bootstrapPath,
  uninstallerPath,
}) {
  const currentOwnerMarker = runtimeOwnerMarker(installRoot);
  const foreignOwnerMarker = runtimeOwnerMarker(installRoot, {
    version: '9.9.9',
    manifestSha256: 'B'.repeat(64),
  });
  return `
Unicode true
Name "Mineradio cleanup runtime fixture"
OutFile "${nsisPath(bootstrapPath)}"
RequestExecutionLevel user
SilentInstall silent
InstallDir "${nsisPath(installRoot)}"

${commonDefines(key)}
!define BUILD_UNINSTALLER
!include "${nsisPath(guardPath)}"

Section
  WriteUninstaller "${nsisPath(uninstallerPath)}"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  StrCpy $INSTDIR "${nsisPath(installRoot)}"

  WriteRegDWORD SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerSchema 1
  WriteRegDWORD SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller 1
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerProductName "\${MINERADIO_INSTALL_PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerAppId "\${MINERADIO_INSTALL_APP_ID}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerChannel "\${MINERADIO_INSTALL_MANIFEST_CHANNEL}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerVersion "\${MINERADIO_INSTALL_MANIFEST_VERSION}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerInstallPath "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256 "\${MINERADIO_INSTALL_MANIFEST_SHA256}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerCommit "\${MINERADIO_INSTALL_COMMIT}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerBuildId "\${MINERADIO_INSTALL_BUILD_ID}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerCreatedAt "\${MINERADIO_INSTALL_BUILD_CREATED_AT}"

  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerVersion "9.9.9"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256 "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
  FileOpen $1 "$INSTDIR\\.mineradio-install-owner.json" w
  IfErrors OwnerRewriteFailed
  FileWrite $1 \`${foreignOwnerMarker}\`
  IfErrors OwnerRewriteFailedOpen
  FileClose $1
  Call un.MineradioValidateExactOwnership
  Pop $0
  StrCmp "$0" "0" 0 ForeignOwnershipAccepted

  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerVersion "\${MINERADIO_INSTALL_MANIFEST_VERSION}"
  WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256 "\${MINERADIO_INSTALL_MANIFEST_SHA256}"
  FileOpen $1 "$INSTDIR\\.mineradio-install-owner.json" w
  IfErrors OwnerRewriteFailed
  FileWrite $1 \`${currentOwnerMarker}\`
  IfErrors OwnerRewriteFailedOpen
  FileClose $1
  Call un.MineradioValidateExactOwnership
  Pop $0
  StrCmp "$0" "1" 0 InitialExactOwnershipRejected

  StrCpy $MineradioGuardInput "$INSTDIR\\.mineradio-install-manifest.json"
  Call un.MineradioRemoveManagedFile
  Pop $0
  StrCmp "$0" "1" 0 ManifestCleanupFailed
  IfFileExists "$INSTDIR\\.mineradio-install-manifest.json" ManifestCleanupFailed 0

  StrCpy $MineradioGuardInput "$INSTDIR\\resources"
  Call un.MineradioValidateManagedDirectory
  Pop $0
  StrCmp "$0" "0" 0 JunctionAccepted
  Call un.MineradioRemoveManagedDirectory
  Pop $0
  StrCmp "$0" "0" 0 JunctionRemoved

  StrCpy $MineradioGuardInput "$INSTDIR\\managed"
  Call un.MineradioRemoveManagedDirectory
  Pop $0
  StrCmp "$0" "0" 0 NonEmptyDirectoryRemoved

  Call un.MineradioValidateExactOwnership
  Pop $0
  StrCmp "$0" "1" 0 RetryExactOwnershipRejected

  IfFileExists "$INSTDIR\\.mineradio-install-owner.json" 0 MarkerRemoved
  IfFileExists "${nsisPath(outsideSentinel)}" 0 OutsideSentinelRemoved
  IfFileExists "$INSTDIR\\resources" 0 JunctionMissing
  IfFileExists "$INSTDIR\\managed\\payload.txt" 0 ManagedPayloadMissing

  FileOpen $0 "${nsisPath(resultPath)}" w
  FileWrite $0 "PASS"
  FileClose $0
  SetErrorLevel 0
  Quit

  OwnerRewriteFailedOpen:
    FileClose $1
  OwnerRewriteFailed:
    StrCpy $9 "owner-rewrite-failed"
    Goto CleanupFailed
  ForeignOwnershipAccepted:
    StrCpy $9 "foreign-ownership-accepted"
    Goto CleanupFailed
  InitialExactOwnershipRejected:
    StrCpy $9 "initial-exact-ownership-rejected"
    Goto CleanupFailed
  ManifestCleanupFailed:
    StrCpy $9 "manifest-cleanup-failed"
    Goto CleanupFailed
  RetryExactOwnershipRejected:
    StrCpy $9 "retry-exact-ownership-rejected"
    Goto CleanupFailed
  JunctionAccepted:
    StrCpy $9 "junction-accepted"
    Goto CleanupFailed
  JunctionRemoved:
    StrCpy $9 "junction-removed"
    Goto CleanupFailed
  NonEmptyDirectoryRemoved:
    StrCpy $9 "nonempty-directory-removed"
    Goto CleanupFailed
  MarkerRemoved:
    StrCpy $9 "marker-removed"
    Goto CleanupFailed
  OutsideSentinelRemoved:
    StrCpy $9 "outside-sentinel-removed"
    Goto CleanupFailed
  JunctionMissing:
    StrCpy $9 "junction-missing"
    Goto CleanupFailed
  ManagedPayloadMissing:
    StrCpy $9 "managed-payload-missing"

  CleanupFailed:
    FileOpen $0 "${nsisPath(resultPath)}" w
    FileWrite $0 "FAIL:$9"
    FileClose $0
    SetErrorLevel 1
    Quit
SectionEnd
`;
}

const windowsTest = process.platform === 'win32' ? test : test.skip;

test.after(() => {
  if (process.env.MINERADIO_KEEP_NSIS_FIXTURES === '1') {
    return;
  }
  for (const directory of tempDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

windowsTest('NSIS guard defers plugin calls until electron-builder adds plugin directories', (t) => {
  const directory = createTempDirectory('mineradio-nsis-plugin-order-');
  const compiler = executableCapability(findMakensis(), ['/VERSION']);
  if (!compiler.available) {
    t.skip(compiler.reason);
    return;
  }

  compileFixture(directory, 'plugin-order', `
Unicode true
Name "Mineradio plugin order fixture"
OutFile "plugin-order.exe"
RequestExecutionLevel user
!include "${nsisPath(stdUtilsIncludePath)}"
${guardDefines(registryKey())}
!include "${nsisPath(guardPath)}"
!addplugindir /x86-unicode "${nsisPath(findStdUtilsPluginDirectory())}"
!insertmacro MineradioDefineInstalledManifestValidator
Section
SectionEnd
`);
});

windowsTest('NSIS fresh and upgrade reservations reject corrupt manifests before promotion', (t) => {
  const directory = createTempDirectory('mineradio-nsis-reservation-');
  const key = registryKey();
  const compiler = executableCapability(findMakensis(), ['/VERSION']);
  if (!compiler.available) {
    t.skip(compiler.reason);
    return;
  }
  const registry = registryCapability(key);
  if (!registry.available) {
    t.skip(registry.reason);
    return;
  }

  const installRoot = path.join(directory, 'install');
  const resultPath = path.join(directory, 'result.txt');
  const outputPath = path.join(directory, 'reservation-runtime.exe');

  try {
    const executable = compileFixture(
      directory,
      'reservation-runtime',
      reservationFixture({ key, installRoot, resultPath, outputPath }),
    );
    runExecutable(executable, ['/S'], directory, resultPath);
    assert.equal(fs.readFileSync(resultPath, 'utf8'), 'PASS');
    assert.equal(fs.existsSync(path.join(installRoot, 'payload.txt')), true);
    assert.equal(
      fs.readFileSync(path.join(installRoot, 'upgrade-partial.txt'), 'utf8'),
      'partial',
    );
    assert.equal(
      fs.existsSync(path.join(installRoot, '.mineradio-install-owner.json')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(installRoot, '.mineradio-install-owner.json.tmp')),
      false,
    );
    assert.equal(
      fs.readFileSync(
        path.join(installRoot, '.mineradio-install-manifest.json'),
        'utf8',
      ),
      runtimeManifestContents,
    );
  } finally {
    cleanupRegistry(key);
  }
});

windowsTest('NSIS managed cleanup rejects junctions and preserves evidence on failure', (t) => {
  const directory = createTempDirectory('mineradio-nsis-cleanup-');
  const key = registryKey();
  const compiler = executableCapability(findMakensis(), ['/VERSION']);
  if (!compiler.available) {
    t.skip(compiler.reason);
    return;
  }

  const installRoot = path.join(directory, 'install');
  const outsideRoot = path.join(directory, 'outside');
  const resultPath = path.join(directory, 'result.txt');
  const bootstrapPath = path.join(directory, 'cleanup-bootstrap.exe');
  const uninstallerPath = path.join(directory, 'cleanup-uninstaller.exe');
  const outsideSentinel = path.join(outsideRoot, 'sentinel.txt');
  const expectedOwnerMarker = runtimeOwnerMarker(installRoot);

  fs.mkdirSync(path.join(installRoot, 'managed'), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, '.mineradio-install-owner.json'),
    expectedOwnerMarker,
  );
  fs.writeFileSync(
    path.join(installRoot, '.mineradio-install-manifest.json'),
    runtimeManifestContents,
  );
  fs.writeFileSync(path.join(installRoot, 'managed', 'payload.txt'), 'payload');
  fs.writeFileSync(outsideSentinel, 'outside');
  fs.symlinkSync(outsideRoot, path.join(installRoot, 'resources'), 'junction');

  try {
    const bootstrap = compileFixture(
      directory,
      'cleanup-bootstrap',
      cleanupFixture({
        key,
        installRoot,
        outsideSentinel,
        resultPath,
        bootstrapPath,
        uninstallerPath,
      }),
    );
    runExecutable(bootstrap, ['/S'], directory);
    assert.ok(fs.existsSync(uninstallerPath), 'cleanup uninstaller was not generated');
    runExecutable(
      uninstallerPath,
      ['/S', `_?=${installRoot}`],
      directory,
      resultPath,
    );
    assert.equal(fs.readFileSync(resultPath, 'utf8'), 'PASS');
    assert.equal(fs.readFileSync(outsideSentinel, 'utf8'), 'outside');
    assert.equal(
      fs.readFileSync(
        path.join(installRoot, '.mineradio-install-owner.json'),
        'utf8',
      ),
      expectedOwnerMarker,
    );
    assert.equal(
      fs.existsSync(path.join(installRoot, '.mineradio-install-manifest.json')),
      false,
    );
    assert.equal(
      fs.readFileSync(path.join(installRoot, 'managed', 'payload.txt'), 'utf8'),
      'payload',
    );
  } finally {
    cleanupRegistry(key);
  }
});
