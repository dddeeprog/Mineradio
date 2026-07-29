const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function functionBody(source, name) {
  const start = source.indexOf(`Function ${name}`);
  assert.notEqual(start, -1, `missing Function ${name}`);
  const end = source.indexOf('FunctionEnd', start);
  assert.notEqual(end, -1, `missing FunctionEnd for ${name}`);
  return source.slice(start, end);
}

function assertOrdered(source, needles) {
  let previous = -1;
  for (const needle of needles) {
    const current = source.indexOf(needle, previous + 1);
    assert.notEqual(current, -1, `missing ordered token: ${needle}`);
    assert.ok(current > previous, `token is out of order: ${needle}`);
    previous = current;
  }
}

test('installer includes generated cleanup and guarded lifecycle macros', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');

  assert.match(installer, /!include "\.generated\\installer-files\.nsh"/);
  assert.match(installer, /!include "installer-guard\.nsh"/);
  assert.match(
    installer,
    /!macro customInit[\s\S]*MineradioValidateInstallCommitTarget[\s\S]*MineradioPrepareUpgrade[\s\S]*MineradioValidateInstallCommitTarget/
  );
  assert.match(installer, /Function MineradioDirectoryLeave[\s\S]*MineradioValidateInstallCommitTarget/);
  assert.match(installer, /!macro customInstall[\s\S]*MineradioInstallOwnedManifest[\s\S]*MineradioCommitInstalledOwnership/);
  assert.match(installer, /!macro customRemoveFiles[\s\S]*MineradioValidateExactOwnership[\s\S]*MineradioRemoveManagedFiles/);
  assert.match(installer, /!macro customUnInstallCheck/);
  assert.match(installer, /!macro customUnInstallCheckCurrentUser/);

  assert.match(guard, /DeleteRegValue[\s\S]*UninstallString/);
  assert.match(guard, /DeleteRegValue[\s\S]*QuietUninstallString/);
  assert.match(guard, /MineradioLegacyUninstallerSuppressed/);
  assert.doesNotMatch(guard, /\bExec(?:Wait)?\b/);
  assert.doesNotMatch(`${installer}\n${guard}`, /RMDir\s+\/r\s+\$INSTDIR/i);
});

test('ownership marker is written atomically after the packaged manifest', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const marker = functionBody(guard, 'MineradioWriteOwnershipMarker');
  const installManifest = installer.indexOf('!insertmacro MineradioInstallOwnedManifest');
  const markerCall = installer.indexOf('Call MineradioCommitInstalledOwnership');
  const temporaryMarker = marker.indexOf('.mineradio-install-owner.json.tmp');
  const markerRename = marker.indexOf(
    'Rename "$INSTDIR\\.mineradio-install-owner.json.tmp" "$INSTDIR\\.mineradio-install-owner.json"'
  );
  const ownerCommit = marker.indexOf('Call MineradioCommitPendingOwnership');

  assert.notEqual(installManifest, -1);
  assert.ok(installManifest < markerCall);
  assert.ok(temporaryMarker < markerRename);
  assert.ok(markerRename < ownerCommit);
  assert.match(marker, /FileWrite[\s\S]*schemaVersion[\s\S]*manifestSha256[\s\S]*createdAt/);
});

test('installed manifest is replaced, hashed, and validated before owner commit', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const validator = functionBody(guard, 'MineradioValidateInstalledManifest');
  const commit = functionBody(guard, 'MineradioCommitInstalledOwnership');
  const manifestMacroMatch = guard.match(
    /!macro MineradioInstallOwnedManifest[\s\S]*?!macroend/,
  );

  assert.ok(manifestMacroMatch, 'missing MineradioInstallOwnedManifest macro');
  assert.match(
    validator,
    /\$\{StdUtils\.HashFile\} \$0 "SHA2-256" "\$INSTDIR\\\.mineradio-install-manifest\.json"/,
  );
  assert.match(validator, /MINERADIO_INSTALL_MANIFEST_FILE_SHA256/);
  assert.match(validator, /lstrcmpiW/);
  assertOrdered(manifestMacroMatch[0], [
    'Delete "$INSTDIR\\.mineradio-install-manifest.json"',
    'IfFileExists "$INSTDIR\\.mineradio-install-manifest.json" MineradioInstallOwnedManifestFailed 0',
    'File /oname=.mineradio-install-manifest.json',
    'IfErrors MineradioInstallOwnedManifestFailed',
    'Call MineradioValidateInstalledManifest',
    'Pop $0',
    'StrCmp "$0" "1" MineradioInstallOwnedManifestDone MineradioInstallOwnedManifestFailed',
  ]);
  assert.match(
    manifestMacroMatch[0],
    /MineradioInstallOwnedManifestFailed:[\s\S]*Abort/,
  );
  assertOrdered(commit, [
    'Call MineradioValidateInstalledManifest',
    'StrCmp "$0" "1"',
    'Call MineradioWriteOwnershipMarker',
  ]);
  assertOrdered(installer, [
    '!insertmacro MineradioInstallOwnedManifest',
    'Call MineradioCommitInstalledOwnership',
  ]);
});

test('selected directories and uninstall reject unsafe or cross-channel ownership', () => {
  const guard = read('build/installer-guard.nsh');

  assert.match(guard, /GetFileAttributesW/);
  assert.match(guard, /FILE_ATTRIBUTE_REPARSE_POINT|0x400/);
  assert.match(guard, /system-directory|不允许安装到系统目录/);
  assert.match(guard, /MINERADIO_INSTALL_MANIFEST_CHANNEL/);
  assert.match(guard, /MineradioValidateSelectedOwnership/);
  assert.match(guard, /MineradioValidateExactOwnership/);
  assert.match(guard, /Abort/);
});

test('uninstall retry keeps exact ownership valid after manifest cleanup', () => {
  const guard = read('build/installer-guard.nsh');
  const exactOwnership = functionBody(
    guard,
    '${PREFIX}MineradioValidateExactOwnership',
  );

  assert.doesNotMatch(
    exactOwnership,
    /IfFileExists "\$INSTDIR\\\.mineradio-install-manifest\.json"/,
  );
  assert.match(
    exactOwnership,
    /IfFileExists "\$INSTDIR\\\.mineradio-install-owner\.json"/,
  );
  assert.match(exactOwnership, /InstallOwnerManifestSha256/);
  assert.match(exactOwnership, /InstallOwnerInstallPath/);
  assertOrdered(exactOwnership, [
    'Call ${PREFIX}MineradioValidateSelectedInstall',
    'Pop $2',
    'StrCpy $MineradioGuardResult "0"',
    'StrCmp $2 "1" 0 MineradioExactOwnershipDone',
  ]);
});
test('uninstall validates managed directories and checks every cleanup operation', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const validateDirectory = functionBody(
    guard,
    'un.MineradioValidateManagedDirectory'
  );
  const removeFile = functionBody(guard, 'un.MineradioRemoveManagedFile');
  const removeDirectory = functionBody(
    guard,
    'un.MineradioRemoveManagedDirectory'
  );

  assertOrdered(installer, [
    'Call un.MineradioValidateExactOwnership',
    '!insertmacro MineradioValidateManagedPaths',
    '!insertmacro MineradioRemoveManagedFiles',
  ]);
  assert.match(validateDirectory, /GetFileAttributesW/);
  assert.match(validateDirectory, /FILE_ATTRIBUTE_REPARSE_POINT|0x400/);
  assert.match(removeFile, /Delete "\$MineradioGuardInput"/);
  assert.match(removeFile, /GetFileAttributesW/);
  assert.match(removeDirectory, /RMDir "\$MineradioGuardInput"/);
  assert.match(removeDirectory, /GetFileAttributesW/);
});

test('selected ownership requires one canonical marker bound to all registry fields', () => {
  const guard = read('build/installer-guard.nsh');
  const selected = functionBody(guard, '${PREFIX}MineradioValidateSelectedOwnership');

  assert.doesNotMatch(guard, /Function \$\{PREFIX\}MineradioContains/);
  assert.doesNotMatch(selected, /MineradioGuardNeedle|Call \$\{PREFIX\}MineradioContains/);
  for (const field of [
    'InstallOwnerSchema',
    'InstallOwnerSafeUninstaller',
    'InstallOwnerProductName',
    'InstallOwnerAppId',
    'InstallOwnerChannel',
    'InstallOwnerVersion',
    'InstallOwnerInstallPath',
    'InstallOwnerManifestSha256',
    'InstallOwnerCommit',
    'InstallOwnerBuildId',
    'InstallOwnerCreatedAt',
  ]) {
    assert.ok(selected.includes(field), `missing registry binding ${field}`);
  }
  assert.match(
    selected,
    /StrCpy \$1 `\{"schemaVersion":1,[^\r\n]*"createdAt":"\$R0"\}`/
  );
  assert.match(selected, /StrCmp "\$MineradioGuardHaystack" "\$1"/);
});

test('unowned install directories must be absent or provably empty', () => {
  const guard = read('build/installer-guard.nsh');
  const selected = functionBody(guard, '${PREFIX}MineradioValidateSelectedOwnership');
  const empty = functionBody(guard, '${PREFIX}MineradioInstallDirectoryIsAbsentOrEmpty');

  assertOrdered(selected, [
    'StrCpy $MineradioGuardResult "0"',
    'IfFileExists "$INSTDIR\\.mineradio-install-owner.json"',
    'Call ${PREFIX}MineradioInstallDirectoryIsAbsentOrEmpty',
    'Pop $MineradioGuardResult',
    'Goto MineradioSelectedOwnershipDone',
  ]);
  assert.match(empty, /GetFileAttributesW/);
  assert.match(empty, /FILE_ATTRIBUTE_DIRECTORY|0x10/);
  assert.match(empty, /FindFirst/);
  assert.match(empty, /FindNext/);
  assert.match(empty, /IfErrors MineradioInstallDirectoryIsAbsentOrEmptyDone/);
  assert.match(empty, /GetLastError/);
  assert.match(empty, /ERROR_NO_MORE_FILES|StrCmp \$2 "18"/);
  assert.doesNotMatch(
    selected,
    /StrCpy \$MineradioGuardResult "1"\s*\n\s*IfFileExists "\$INSTDIR\\\.mineradio-install-owner\.json" 0 MineradioSelectedOwnershipDone/
  );
});

test('generated installer files stay transient and outside packaged app files', () => {
  const gitignore = read('.gitignore');
  const pkg = JSON.parse(read('package.json'));
  const files = pkg.build.files || [];

  assert.match(gitignore, /^build\/\.generated\/$/m);
  assert.ok(files.includes('!build/.generated/**/*'));
});

test('installer adaptations retain fixed upstream provenance and license records', () => {
  const upstreamCommit = '4abaa190de42c632365ae4244e041bad16443224';

  for (const relativePath of [
    'build/installer.nsh',
    'build/installer-guard.nsh',
    'build/after-pack.js',
  ]) {
    const source = read(relativePath);
    assert.match(source, /XxHuberrr\/Mineradio/);
    assert.ok(source.includes(upstreamCommit), `${relativePath} is missing the fixed commit`);
    assert.match(source, /GPL-3\.0-only/);
  }

  const notice = read('NOTICE.md');
  const vendorManifest = read('docs/VENDOR_MANIFEST.md');
  assert.match(notice, /build\/installer\.nsh/);
  assert.match(notice, /build\/after-pack\.js/);
  assert.ok(notice.includes(upstreamCommit));
  assert.match(vendorManifest, /build\/installer\.nsh/);
  assert.match(vendorManifest, /build\/after-pack\.js/);
  assert.ok(vendorManifest.includes(upstreamCommit));
});

test('owned upgrades validate before replacing registry commands with canonical text', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const upgrade = functionBody(guard, 'MineradioPrepareUpgrade');
  const firstUninstallMutation = upgrade.indexOf('DeleteRegValue');

  assert.doesNotMatch(guard, /MineradioGuardSaved(?:Quiet)?Uninstall/);
  assert.doesNotMatch(guard, /\$installMode/);
  assert.doesNotMatch(upgrade, /WriteRegStr[^\r\n]*UninstallString[^\r\n]*\$MineradioGuard/);
  assert.ok(upgrade.includes(
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString \'"$INSTDIR\\${MINERADIO_UNINSTALL_FILENAME}" $1\''
  ));
  assert.ok(upgrade.includes(
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString \'"$INSTDIR\\${MINERADIO_UNINSTALL_FILENAME}" $1 /S\''
  ));
  assert.ok(upgrade.includes(
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString \'"$INSTDIR\\${MINERADIO_UNINSTALL_FILENAME}" $1\''
  ));
  assert.ok(upgrade.includes(
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString \'"$INSTDIR\\${MINERADIO_UNINSTALL_FILENAME}" $1 /S\''
  ));

  assert.notEqual(firstUninstallMutation, -1);
  for (const validation of [
    'InstallOwnerSafeUninstaller',
    'InstallOwnerAppId',
    'InstallOwnerChannel',
    'InstallOwnerInstallPath',
    'IfFileExists "$INSTDIR\\.mineradio-install-owner.json"',
    'Call MineradioValidateSelectedInstall',
    'IfFileExists "$INSTDIR\\${MINERADIO_UNINSTALL_FILENAME}"',
    'Abort',
  ]) {
    assert.ok(
      upgrade.indexOf(validation) < firstUninstallMutation,
      `${validation} must precede uninstall registry mutation`
    );
  }

  assert.match(upgrade, /StrCpy \$2 "secondary"/);
  assert.match(upgrade, /\$\{If\} "\$2" == "secondary"[\s\S]*UNINSTALL_REGISTRY_KEY_2/);
  assert.match(installer, /\$installMode[\s\S]*\/currentuser[\s\S]*\/allusers[\s\S]*MineradioPrepareUpgrade/);
  assert.match(upgrade, /StrCpy \$1 "\$MineradioUpgradeModeArgument"/);
  assert.doesNotMatch(`${installer}\n${guard}`, /\bExec(?:Wait)?\b/);
});

test('owned upgrades retain the verified install directory across installer pages', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const upgrade = functionBody(guard, 'MineradioPrepareUpgrade');
  const preferred = functionBody(installer, 'MineradioUsePreferredInstallDir');

  assert.match(guard, /Var MineradioOwnedUpgrade/);
  assertOrdered(upgrade, [
    'StrCpy $MineradioOwnedUpgrade "0"',
    'Call MineradioValidateSelectedInstall',
    'StrCpy $MineradioOwnedUpgrade "1"',
  ]);
  assertOrdered(preferred, [
    'StrCmp "$MineradioOwnedUpgrade" "1" MineradioUsePreferredInstallDirDone',
    '${GetParameters} $R0',
    'StrCpy $INSTDIR "D:\\Mineradio"',
    'MineradioUsePreferredInstallDirDone:',
  ]);
});

test('all-users upgrades also sanitize the current-user uninstall context', () => {
  const installer = read('build/installer.nsh');
  const init = installer.slice(
    installer.indexOf('!macro customInit'),
    installer.indexOf('!macroend', installer.indexOf('!macro customInit'))
  );

  assertOrdered(init, [
    'Call MineradioPrepareUpgrade',
    '${If} "$installMode" == "all"',
    'Push "$INSTDIR"',
    'Push "$MineradioOwnedUpgrade"',
    'SetShellVarContext current',
    'StrCpy $MineradioUpgradeModeArgument "/currentuser"',
    'Call MineradioPrepareUpgrade',
    'SetShellVarContext all',
    'Pop $MineradioOwnedUpgrade',
    'Pop $INSTDIR',
    'StrCpy $MineradioUpgradeModeArgument "/allusers"',
  ]);
});

test('owned installs with missing uninstall commands are recovered canonically', () => {
  const guard = read('build/installer-guard.nsh');
  const upgrade = functionBody(guard, 'MineradioPrepareUpgrade');
  const noCommand = upgrade.indexOf('${If} "$2" == ""');
  const safeOwner = upgrade.indexOf('InstallOwnerSafeUninstaller', noCommand);
  const recoverSource = upgrade.indexOf('StrCpy $2 "primary"', safeOwner);
  const validateOwner = upgrade.indexOf('Call MineradioValidateSelectedInstall', recoverSource);
  const canonicalize = upgrade.indexOf('MineradioPrepareUpgradeCanonicalize:', validateOwner);

  assert.notEqual(noCommand, -1);
  assert.ok(noCommand < safeOwner);
  assert.ok(safeOwner < recoverSource);
  assert.ok(recoverSource < validateOwner);
  assert.ok(validateOwner < canonicalize);
  assert.doesNotMatch(
    upgrade.slice(noCommand, safeOwner),
    /Goto MineradioPrepareUpgradeDone/
  );
});

test('owned upgrade preparation recovers an interrupted marker backup before validation', () => {
  const guard = read('build/installer-guard.nsh');
  const upgrade = functionBody(guard, 'MineradioPrepareUpgrade');

  assertOrdered(upgrade, [
    'IfFileExists "$INSTDIR\\.mineradio-install-owner.json"',
    'IfFileExists "$INSTDIR\\.mineradio-install-owner.json.bak"',
    'Rename "$INSTDIR\\.mineradio-install-owner.json.bak" "$INSTDIR\\.mineradio-install-owner.json"',
    'IfErrors MineradioPrepareUpgradeOwnershipInvalid',
    'Call MineradioValidateSelectedInstall',
  ]);
});

test('ownership marker and registry commit use a durable recoverable transaction', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const begin = functionBody(guard, 'MineradioBeginOwnershipTransaction');
  const pending = functionBody(guard, 'MineradioPendingOwnershipMatchesRegistry');
  const clear = functionBody(guard, 'MineradioClearPendingOwnershipTransaction');
  const commit = functionBody(guard, 'MineradioCommitPendingOwnership');
  const recover = functionBody(guard, 'MineradioRecoverOwnershipTransaction');
  const marker = functionBody(guard, 'MineradioWriteOwnershipMarker');

  assertOrdered(installer, [
    'Call MineradioUsePreferredInstallDir',
    'Call MineradioRecoverOwnershipTransaction',
    'Pop $0',
    'Call MineradioValidateInstallCommitTarget',
  ]);
  assert.ok(
    installer.split('Call MineradioRecoverOwnershipTransaction').length >= 3,
    'both the selected shell context and all-users HKCU context must recover transactions'
  );

  for (const field of [
    'InstallOwnerPendingSchema',
    'InstallOwnerPendingSafeUninstaller',
    'InstallOwnerPendingProductName',
    'InstallOwnerPendingAppId',
    'InstallOwnerPendingChannel',
    'InstallOwnerPendingVersion',
    'InstallOwnerPendingInstallPath',
    'InstallOwnerPendingManifestSha256',
    'InstallOwnerPendingCommit',
    'InstallOwnerPendingBuildId',
    'InstallOwnerPendingCreatedAt',
  ]) {
    assert.ok(begin.includes(field), `missing pending ownership field ${field}`);
    assert.ok(
      `${pending}\n${commit}`.includes(field),
      `commit validation does not consume ${field}`
    );
  }
  assertOrdered(begin, [
    'WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending 1',
    'Call MineradioPendingOwnershipMatchesRegistry',
  ]);
  assertOrdered(marker, [
    'Call MineradioBeginOwnershipTransaction',
    'FileOpen $0 "$INSTDIR\\.mineradio-install-owner.json.tmp" w',
    'Rename "$INSTDIR\\.mineradio-install-owner.json.tmp" "$INSTDIR\\.mineradio-install-owner.json"',
    'Call MineradioCommitPendingOwnership',
  ]);
  assertOrdered(commit, [
    'Call MineradioPendingOwnershipMatchesFile',
    'WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema',
    'Call MineradioValidateSelectedOwnership',
    'Call MineradioClearPendingOwnershipTransaction',
    'Delete "$INSTDIR\\.mineradio-install-owner.json.bak"',
  ]);
  assertOrdered(clear, [
    'WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending 0',
    'ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending',
  ]);
  assert.match(recover, /InstallOwnerTransactionPending/);
  assert.match(recover, /InstallOwnerPendingInstallPath/);
  assert.match(recover, /Call MineradioValidateInstallPath/);
  assert.match(recover, /Call MineradioPendingOwnershipMatchesFile/);
  assert.match(recover, /Call MineradioCommitPendingOwnership/);
  assert.match(recover, /Rename "\$INSTDIR\\\.mineradio-install-owner\.json\.bak"/);
  assert.match(recover, /Call MineradioValidateSelectedOwnership/);
});

test('pending transactions use a sibling key and bind the exact current build', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const pending = functionBody(guard, 'MineradioPendingOwnershipMatchesRegistry');

  assert.match(
    installer,
    /!define \/ifndef MINERADIO_PENDING_REGISTRY_KEY "\${INSTALL_REGISTRY_KEY}\.Pending"/
  );
  assert.doesNotMatch(
    guard,
    /"\${INSTALL_REGISTRY_KEY}" InstallOwner(?:Pending|TransactionPending)/
  );
  assert.match(
    guard,
    /"\${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending/
  );

  for (const [register, expected] of [
    ['$4', '${MINERADIO_INSTALL_MANIFEST_VERSION}'],
    ['$6', '${MINERADIO_INSTALL_MANIFEST_SHA256}'],
    ['$7', '${MINERADIO_INSTALL_COMMIT}'],
    ['$8', '${MINERADIO_INSTALL_BUILD_ID}'],
    ['$9', '${MINERADIO_INSTALL_BUILD_CREATED_AT}'],
  ]) {
    assert.ok(
      pending.includes(`StrCmp "${register}" "${expected}"`),
      `pending registry does not bind ${expected}`
    );
  }
});

test('pending file validation does not inherit a registry-only match', () => {
  const guard = read('build/installer-guard.nsh');
  const pendingFile = functionBody(guard, 'MineradioPendingOwnershipMatchesFile');

  assertOrdered(pendingFile, [
    'Call MineradioPendingOwnershipMatchesRegistry',
    'Pop $0',
    'StrCmp "$0" "1" 0 MineradioPendingOwnershipMatchesFileDone',
    'StrCpy $MineradioGuardResult "0"',
    'FileOpen $0 "$MineradioGuardInput" r',
  ]);
});

test('fresh installs and upgrades reserve before payload extraction and resume without early ownership', () => {
  const installer = read('build/installer.nsh');
  const guard = read('build/installer-guard.nsh');
  const validateTarget = functionBody(guard, 'MineradioValidateInstallCommitTarget');
  const reserve = functionBody(guard, 'MineradioEnsureInstallReservation');
  const recover = functionBody(guard, 'MineradioRecoverOwnershipTransaction');
  const marker = functionBody(guard, 'MineradioWriteOwnershipMarker');

  assert.match(installer, /\$\{If\} \$\{Silent\}[\s\S]*Call MineradioEnsureInstallReservation/);
  const directoryLeave = functionBody(installer, 'MineradioDirectoryLeave');
  assertOrdered(directoryLeave, [
    'Call MineradioValidateInstallCommitTarget',
    'Call MineradioEnsureInstallReservation',
  ]);
  assert.match(installer, /!macro customInstall[\s\S]*Call MineradioValidateInstallCommitTarget/);

  assert.match(validateTarget, /Call MineradioValidateSelectedInstall/);
  assert.match(validateTarget, /Call MineradioPendingOwnershipMatchesFile/);
  assert.match(validateTarget, /MineradioOwnedUpgradePath/);
  assertOrdered(reserve, [
    'Call MineradioBeginOwnershipTransaction',
    'FileOpen $0 "$INSTDIR\\.mineradio-install-owner.json.tmp" w',
    'FileWrite $0',
    'Call MineradioPendingOwnershipMatchesFile',
  ]);
  assert.doesNotMatch(
    reserve,
    /MineradioEnsureInstallReservationOwned/
  );
  assert.match(recover, /StrCpy \$MineradioInstallReservationActive "1"/);
  const reservationBranch = recover.slice(
    recover.indexOf('MineradioRecoverOwnershipTransactionResumeReservation:'),
    recover.indexOf('MineradioRecoverOwnershipTransactionTryBackup:')
  );
  assert.doesNotMatch(
    reservationBranch,
    /Rename "\$INSTDIR\\\.mineradio-install-owner\.json\.tmp" "\$INSTDIR\\\.mineradio-install-owner\.json"/
  );
  assertOrdered(marker, [
    'Call MineradioPendingOwnershipMatchesFile',
    'MineradioWriteOwnershipMarkerCreatePending:',
    'Call MineradioBeginOwnershipTransaction',
    'MineradioWriteOwnershipMarkerWritten:',
    'Rename "$INSTDIR\\.mineradio-install-owner.json.tmp" "$INSTDIR\\.mineradio-install-owner.json"',
  ]);
});

test('registry command repair is verified before upgrade preparation can continue', () => {
  const guard = read('build/installer-guard.nsh');
  const upgrade = functionBody(guard, 'MineradioPrepareUpgrade');
  const suppressed = functionBody(guard, 'MineradioVerifyUninstallCommandsSuppressed');
  const canonical = functionBody(guard, 'MineradioVerifyCanonicalUninstallCommands');
  const suppressBranch = upgrade.slice(
    upgrade.indexOf('MineradioPrepareUpgradeSuppressLegacy:'),
    upgrade.indexOf('MineradioPrepareUpgradeCanonicalize:')
  );
  const canonicalBranch = upgrade.slice(
    upgrade.indexOf('MineradioPrepareUpgradeCanonicalize:'),
    upgrade.indexOf('MineradioPrepareUpgradeDone:')
  );

  assertOrdered(suppressBranch, [
    'DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString',
    'Call MineradioVerifyUninstallCommandsSuppressed',
    'Pop $0',
    'Goto MineradioPrepareUpgradeRegistryMutationFailed',
    'WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MineradioLegacyUninstallerSuppressed 1',
    'IfErrors MineradioPrepareUpgradeRegistryMutationFailed',
  ]);
  assertOrdered(canonicalBranch, [
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString',
    'WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString',
    'IfErrors MineradioPrepareUpgradeRegistryMutationFailed',
    'Call MineradioVerifyCanonicalUninstallCommands',
    'Pop $0',
    'Goto MineradioPrepareUpgradeRegistryMutationFailed',
  ]);
  assert.match(
    upgrade,
    /MineradioPrepareUpgradeRegistryMutationFailed:[\s\S]*MessageBox[\s\S]*Abort/
  );

  for (const valueName of ['UninstallString', 'QuietUninstallString']) {
    assert.match(suppressed, new RegExp(`ReadRegStr[^\\n]+${valueName}`));
    assert.match(canonical, new RegExp(`ReadRegStr[^\\n]+${valueName}`));
  }
  assert.match(suppressed, /UNINSTALL_REGISTRY_KEY_2/);
  assert.match(canonical, /UNINSTALL_REGISTRY_KEY_2/);
  assert.match(canonical, /MineradioExpectedUninstallSource/);
  assert.match(canonical, /MineradioExpectedUninstallMode/);
});

test('ownership marker replacement preserves recoverable pending state until commit', () => {
  const guard = read('build/installer-guard.nsh');
  const marker = functionBody(guard, 'MineradioWriteOwnershipMarker');
  const commit = functionBody(guard, 'MineradioCommitPendingOwnership');
  const recover = functionBody(guard, 'MineradioRecoverOwnershipTransaction');

  assertOrdered(marker, [
    'Call MineradioBeginOwnershipTransaction',
    'FileWrite $0',
    'IfErrors MineradioWriteOwnershipMarkerWriteFailed',
    'FileClose $0',
    'Delete "$INSTDIR\\.mineradio-install-owner.json.bak"',
    'Rename "$INSTDIR\\.mineradio-install-owner.json" "$INSTDIR\\.mineradio-install-owner.json.bak"',
    'Rename "$INSTDIR\\.mineradio-install-owner.json.tmp" "$INSTDIR\\.mineradio-install-owner.json"',
    'MineradioWriteOwnershipMarkerRollback:',
    'Rename "$INSTDIR\\.mineradio-install-owner.json.bak" "$INSTDIR\\.mineradio-install-owner.json"',
    'MineradioWriteOwnershipMarkerReplaced:',
    'Call MineradioCommitPendingOwnership',
  ]);
  assert.match(marker, /IfErrors MineradioWriteOwnershipMarkerRollback/);
  assert.match(
    marker,
    /MineradioWriteOwnershipMarkerWriteFailed:[\s\S]*FileClose \$0[\s\S]*Goto MineradioWriteOwnershipMarkerFailed/
  );
  assert.match(
    marker,
    /MineradioWriteOwnershipRegistryFailed:[\s\S]*Keep pending state intact[\s\S]*Abort/
  );
  const registryFailure = marker.slice(marker.indexOf('MineradioWriteOwnershipRegistryFailed:'));
  assert.doesNotMatch(
    registryFailure,
    /Delete "\$INSTDIR\\\.mineradio-install-owner\.json"|DeleteRegValue[^\r\n]*InstallOwner/
  );
  assertOrdered(commit, [
    'WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema',
    'Call MineradioValidateSelectedOwnership',
    'Call MineradioClearPendingOwnershipTransaction',
    'Delete "$INSTDIR\\.mineradio-install-owner.json.bak"',
  ]);
  assertOrdered(recover, [
    'Rename "$INSTDIR\\.mineradio-install-owner.json.bak" "$INSTDIR\\.mineradio-install-owner.json"',
    'Call MineradioValidateSelectedOwnership',
    'Call MineradioClearPendingOwnershipTransaction',
  ]);
  assert.match(
    marker,
    /MineradioWriteOwnershipMarkerWriteFailed:[\s\S]*Delete "\$INSTDIR\\\.mineradio-install-owner\.json\.tmp"[\s\S]*Goto MineradioWriteOwnershipMarkerFailed/
  );
  const markerFailure = marker.slice(marker.indexOf('MineradioWriteOwnershipMarkerFailed:'));
  assert.doesNotMatch(
    markerFailure,
    /Delete "\$INSTDIR\\\.mineradio-install-owner\.json\.tmp"/
  );
});

test('NSIS path validation rejects ambiguous Windows segments before normalization', () => {
  const guard = read('build/installer-guard.nsh');
  const validatePath = functionBody(guard, '${PREFIX}MineradioValidateInstallPath');
  const validateSegment = functionBody(guard, '${PREFIX}MineradioValidatePathSegment');

  assert.ok(
    validatePath.indexOf('Call ${PREFIX}MineradioValidatePathSegment')
      < validatePath.indexOf('\n  GetFullPathName'),
    'raw path segments must be checked before GetFullPathName'
  );
  assert.match(validatePath, /StrCpy \$2 3/);
  for (const character of ['/', ':', '*', '?', '<', '>', '|']) {
    assert.ok(
      validatePath.includes(`StrCmp "$3" "${character}"`),
      `missing rejected character ${character}`
    );
  }
  assert.ok(validatePath.includes('StrCmp "$3" \'$\\"\''));
  assert.match(validatePath, /lstrcmpiW/);

  assert.match(validateSegment, /StrCmp "\$2" "\."[\s\S]*StrCmp "\$2" " "/);
  for (const reserved of [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'CLOCK$$',
    'CONIN$$',
    'CONOUT$$',
    'COM',
    'LPT',
    '¹',
    '²',
    '³',
  ]) {
    assert.ok(validateSegment.includes(`"${reserved}"`), `missing reserved name ${reserved}`);
  }
  assert.match(validateSegment, /lstrcmpiW\(w "\$3", w "CON"\)/);
  assert.match(validateSegment, /lstrcmpiW\(w "\$1", w "COM"\)/);
  assert.match(validateSegment, /lstrcmpiW\(w "\$1", w "LPT"\)/);
  assert.match(validateSegment, /"1"[\s\S]*"9"/);
});
