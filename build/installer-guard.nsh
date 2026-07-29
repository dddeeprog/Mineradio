; Ownership-safety rewrite informed by XxHuberrr/Mineradio build/installer.nsh
; at 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
; This local implementation replaces legacy marker/deletion behavior with
; exact metadata binding, generated cleanup, and recoverable transactions.

!ifndef MINERADIO_INSTALLER_GUARD_INCLUDED
!define MINERADIO_INSTALLER_GUARD_INCLUDED

Var MineradioGuardResult
Var MineradioGuardInput
Var MineradioGuardOutput
Var MineradioGuardHaystack
!ifndef BUILD_UNINSTALLER
  Var MineradioOwnedUpgrade
  Var MineradioOwnedUpgradePath
  Var MineradioUpgradeModeArgument
  Var MineradioExpectedUninstallSource
  Var MineradioExpectedUninstallMode
  Var MineradioInstallReservationActive
!endif

!macro MineradioDefineGuardFunctions PREFIX
Function ${PREFIX}MineradioPathToJson
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $MineradioGuardOutput ""
  StrLen $1 $MineradioGuardInput
  StrCpy $2 0

  MineradioPathToJsonLoop:
    IntCmp $2 $1 MineradioPathToJsonDone 0 MineradioPathToJsonDone
    StrCpy $3 $MineradioGuardInput 1 $2
    StrCmp $3 "\" 0 MineradioPathToJsonCopy
    StrCpy $MineradioGuardOutput "$MineradioGuardOutput/"
    Goto MineradioPathToJsonNext

  MineradioPathToJsonCopy:
    StrCpy $MineradioGuardOutput "$MineradioGuardOutput$3"

  MineradioPathToJsonNext:
    IntOp $2 $2 + 1
    Goto MineradioPathToJsonLoop

  MineradioPathToJsonDone:
    Pop $3
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

Function ${PREFIX}MineradioValidatePathSegment
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $MineradioGuardResult "0"
  StrLen $0 "$MineradioGuardInput"
  StrCmp $0 "0" MineradioValidatePathSegmentDone

  IntOp $1 $0 - 1
  StrCpy $2 "$MineradioGuardInput" 1 $1
  StrCmp "$2" "." MineradioValidatePathSegmentDone
  StrCmp "$2" " " MineradioValidatePathSegmentDone

  StrCpy $3 ""
  StrCpy $1 0
  MineradioValidatePathSegmentBaseLoop:
    IntCmp $1 $0 MineradioValidatePathSegmentBaseDone 0 MineradioValidatePathSegmentBaseDone
    StrCpy $2 "$MineradioGuardInput" 1 $1
    StrCmp "$2" "." MineradioValidatePathSegmentBaseDone
    StrCpy $3 "$3$2"
    IntOp $1 $1 + 1
    Goto MineradioValidatePathSegmentBaseLoop

  MineradioValidatePathSegmentBaseDone:
    System::Call 'kernel32::lstrcmpiW(w "$3", w "CON") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "PRN") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "AUX") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "NUL") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "CLOCK$$") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "CONIN$$") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone
    System::Call 'kernel32::lstrcmpiW(w "$3", w "CONOUT$$") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentDone

    StrCpy $1 "$3" 3
    System::Call 'kernel32::lstrcmpiW(w "$1", w "COM") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentCheckDigit

    System::Call 'kernel32::lstrcmpiW(w "$1", w "LPT") i .r2'
    StrCmp $2 "0" MineradioValidatePathSegmentCheckDigit
    Goto MineradioValidatePathSegmentValid

  MineradioValidatePathSegmentCheckDigit:
    StrLen $0 "$3"
    StrCmp "$0" "4" 0 MineradioValidatePathSegmentValid
    StrCpy $2 "$3" 1 3
    StrCmp "$2" "1" MineradioValidatePathSegmentDone
    StrCmp "$2" "2" MineradioValidatePathSegmentDone
    StrCmp "$2" "3" MineradioValidatePathSegmentDone
    StrCmp "$2" "4" MineradioValidatePathSegmentDone
    StrCmp "$2" "5" MineradioValidatePathSegmentDone
    StrCmp "$2" "6" MineradioValidatePathSegmentDone
    StrCmp "$2" "7" MineradioValidatePathSegmentDone
    StrCmp "$2" "8" MineradioValidatePathSegmentDone
    StrCmp "$2" "9" MineradioValidatePathSegmentDone
    StrCmp "$2" "¹" MineradioValidatePathSegmentDone
    StrCmp "$2" "²" MineradioValidatePathSegmentDone
    StrCmp "$2" "³" MineradioValidatePathSegmentDone

  MineradioValidatePathSegmentValid:
    StrCpy $MineradioGuardResult "1"

  MineradioValidatePathSegmentDone:
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function ${PREFIX}MineradioValidateInstallPath
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $MineradioGuardResult "0"

  ; Require a drive-qualified path before GetFullPathName can anchor it.
  StrCpy $0 "$INSTDIR" 1 1
  StrCmp $0 ":" 0 MineradioValidateInstallPathDone
  StrCpy $0 "$INSTDIR" 1 2
  StrCmp $0 "\" 0 MineradioValidateInstallPathDone

  ; Reject ambiguous raw segments before Windows can normalize them away.
  StrLen $1 "$INSTDIR"
  StrCpy $2 3
  StrCpy $MineradioGuardInput ""
  MineradioValidateInstallPathRawLoop:
    IntCmp $2 $1 MineradioValidateInstallPathRawDone 0 MineradioValidateInstallPathRawDone
    StrCpy $3 "$INSTDIR" 1 $2
    StrCmp "$3" "\" MineradioValidateInstallPathSegmentDone
    StrCmp "$3" "/" MineradioValidateInstallPathDone
    StrCmp "$3" ":" MineradioValidateInstallPathDone
    StrCmp "$3" "*" MineradioValidateInstallPathDone
    StrCmp "$3" "?" MineradioValidateInstallPathDone
    StrCmp "$3" '$\"' MineradioValidateInstallPathDone
    StrCmp "$3" "<" MineradioValidateInstallPathDone
    StrCmp "$3" ">" MineradioValidateInstallPathDone
    StrCmp "$3" "|" MineradioValidateInstallPathDone
    StrCpy $MineradioGuardInput "$MineradioGuardInput$3"
    Goto MineradioValidateInstallPathRawNext

  MineradioValidateInstallPathSegmentDone:
    StrCmp "$MineradioGuardInput" "" MineradioValidateInstallPathRawNext
    Call ${PREFIX}MineradioValidatePathSegment
    Pop $4
    StrCmp "$4" "1" 0 MineradioValidateInstallPathDone
    StrCpy $MineradioGuardInput ""

  MineradioValidateInstallPathRawNext:
    IntOp $2 $2 + 1
    Goto MineradioValidateInstallPathRawLoop

  MineradioValidateInstallPathRawDone:
    StrCmp "$MineradioGuardInput" "" MineradioValidateInstallPathRawValid
    Call ${PREFIX}MineradioValidatePathSegment
    Pop $4
    StrCmp "$4" "1" 0 MineradioValidateInstallPathDone

  MineradioValidateInstallPathRawValid:
  ClearErrors
  GetFullPathName $0 "$INSTDIR"
  IfErrors MineradioValidateInstallPathDone
  StrCpy $INSTDIR "$0"

  ${GetRoot} "$INSTDIR" $1
  StrCmp "$INSTDIR" "$1" MineradioValidateInstallPathDone

  ; system-directory checks use Windows path-component semantics.
  System::Call 'shlwapi::PathIsPrefixW(w "$WINDIR", w "$INSTDIR") i .r2'
  StrCmp $2 "0" 0 MineradioValidateInstallPathDone
  ${If} "$PROGRAMFILES" != ""
    System::Call 'shlwapi::PathIsPrefixW(w "$PROGRAMFILES", w "$INSTDIR") i .r2'
    StrCmp $2 "0" 0 MineradioValidateInstallPathDone
  ${EndIf}
  ${If} "$PROGRAMFILES64" != ""
    System::Call 'shlwapi::PathIsPrefixW(w "$PROGRAMFILES64", w "$INSTDIR") i .r2'
    StrCmp $2 "0" 0 MineradioValidateInstallPathDone
  ${EndIf}
  System::Call 'kernel32::lstrcmpiW(w "$INSTDIR", w "$PROFILE") i .r2'
  StrCmp $2 "0" MineradioValidateInstallPathDone

  StrCpy $1 "$INSTDIR"
  MineradioValidateReparseLoop:
    System::Call 'kernel32::GetFileAttributesW(w r1) i .r2 ?e'
    Pop $4
    ${If} $2 == -1
      ${If} $4 != 2
      ${AndIf} $4 != 3
        Goto MineradioValidateInstallPathDone
      ${EndIf}
    ${Else}
      IntOp $3 $2 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
      StrCmp $3 "0" 0 MineradioValidateInstallPathDone
    ${EndIf}

    ${GetParent} "$1" $2
    StrCmp "$2" "$1" MineradioValidateInstallPathValid
    StrCpy $1 "$2"
    Goto MineradioValidateReparseLoop

  MineradioValidateInstallPathValid:
    StrCpy $MineradioGuardResult "1"

  MineradioValidateInstallPathDone:
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function ${PREFIX}MineradioInstallDirectoryIsAbsentOrEmpty
  Push $0
  Push $1
  Push $2
  StrCpy $MineradioGuardResult "0"

  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0 ?e'
  Pop $2
  ${If} $0 == -1
    ${If} $2 == 2
    ${OrIf} $2 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
    Goto MineradioInstallDirectoryIsAbsentOrEmptyDone
  ${EndIf}

  IntOp $2 $0 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
  StrCmp $2 "0" MineradioInstallDirectoryIsAbsentOrEmptyDone
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*"
  IfErrors MineradioInstallDirectoryIsAbsentOrEmptyDone

  MineradioInstallDirectoryIsAbsentOrEmptyLoop:
    StrCmp "$1" "." MineradioInstallDirectoryIsAbsentOrEmptyNext
    StrCmp "$1" ".." MineradioInstallDirectoryIsAbsentOrEmptyNext
    Goto MineradioInstallDirectoryIsAbsentOrEmptyClose

  MineradioInstallDirectoryIsAbsentOrEmptyNext:
    ClearErrors
    FindNext $0 $1
    IfErrors 0 MineradioInstallDirectoryIsAbsentOrEmptyLoop
    System::Call 'kernel32::GetLastError() i .r2'
    StrCmp $2 "18" MineradioInstallDirectoryIsAbsentOrEmptyEmpty ; ERROR_NO_MORE_FILES
    Goto MineradioInstallDirectoryIsAbsentOrEmptyClose

  MineradioInstallDirectoryIsAbsentOrEmptyEmpty:
    StrCpy $MineradioGuardResult "1"

  MineradioInstallDirectoryIsAbsentOrEmptyClose:
    FindClose $0

  MineradioInstallDirectoryIsAbsentOrEmptyDone:
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function ${PREFIX}MineradioValidateSelectedOwnership
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  StrCpy $MineradioGuardResult "0"
  IfFileExists "$INSTDIR\.mineradio-install-owner.json" MineradioSelectedOwnershipMarkerPresent
  Call ${PREFIX}MineradioInstallDirectoryIsAbsentOrEmpty
  Pop $MineradioGuardResult
  Goto MineradioSelectedOwnershipDone

  MineradioSelectedOwnershipMarkerPresent:
  ClearErrors
  FileOpen $0 "$INSTDIR\.mineradio-install-owner.json" r
  IfErrors MineradioSelectedOwnershipInvalid
  ClearErrors
  FileRead $0 $MineradioGuardHaystack
  IfErrors MineradioSelectedOwnershipReadFailed
  FileClose $0

  ReadRegDWORD $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema
  StrCmp "$1" "1" 0 MineradioSelectedOwnershipInvalid
  ReadRegDWORD $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller
  StrCmp "$1" "1" 0 MineradioSelectedOwnershipInvalid
  ReadRegStr $2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerProductName
  ReadRegStr $3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerAppId
  ReadRegStr $4 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerChannel
  ReadRegStr $5 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerVersion
  ReadRegStr $6 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerInstallPath
  ReadRegStr $7 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256
  ReadRegStr $8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerCommit
  ReadRegStr $9 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerBuildId
  ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerCreatedAt

  StrCmp "$2" "${MINERADIO_INSTALL_PRODUCT_NAME}" 0 MineradioSelectedOwnershipInvalid
  StrCmp "$3" "${MINERADIO_INSTALL_APP_ID}" 0 MineradioSelectedOwnershipInvalid
  StrCmp "$4" "${MINERADIO_INSTALL_MANIFEST_CHANNEL}" 0 MineradioSelectedOwnershipInvalid
  StrCmp "$5" "" MineradioSelectedOwnershipInvalid
  StrCmp "$6" "$INSTDIR" 0 MineradioSelectedOwnershipInvalid
  StrCmp "$7" "" MineradioSelectedOwnershipInvalid
  StrCmp "$8" "" MineradioSelectedOwnershipInvalid
  StrCmp "$9" "" MineradioSelectedOwnershipInvalid
  StrCmp "$R0" "" MineradioSelectedOwnershipInvalid

  StrCpy $MineradioGuardInput "$INSTDIR"
  Call ${PREFIX}MineradioPathToJson
  StrCpy $1 `{"schemaVersion":1,"productName":"$2","appId":"$3","channel":"$4","version":"$5","installPath":"$MineradioGuardOutput","manifestSha256":"$7","commit":"$8","buildId":"$9","createdAt":"$R0"}`
  StrCmp "$MineradioGuardHaystack" "$1" 0 MineradioSelectedOwnershipInvalid
  StrCpy $MineradioGuardResult "1"
  Goto MineradioSelectedOwnershipDone

  MineradioSelectedOwnershipReadFailed:
    FileClose $0

  MineradioSelectedOwnershipInvalid:
    StrCpy $MineradioGuardResult "0"

  MineradioSelectedOwnershipDone:
    Pop $R0
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function ${PREFIX}MineradioValidateSelectedInstall
  Call ${PREFIX}MineradioValidateInstallPath
  Pop $MineradioGuardResult
  StrCmp $MineradioGuardResult "1" 0 MineradioValidateSelectedInstallDone
  Call ${PREFIX}MineradioValidateSelectedOwnership
  Pop $MineradioGuardResult
  MineradioValidateSelectedInstallDone:
    Push "$MineradioGuardResult"
FunctionEnd

!ifdef BUILD_UNINSTALLER
Function ${PREFIX}MineradioValidateExactOwnership
  Push $0
  Push $1
  Push $2
  StrCpy $MineradioGuardResult "0"

  Call ${PREFIX}MineradioValidateSelectedInstall
  Pop $2
  StrCpy $MineradioGuardResult "0"
  StrCmp $2 "1" 0 MineradioExactOwnershipDone
  IfFileExists "$INSTDIR\.mineradio-install-owner.json" 0 MineradioExactOwnershipDone

  ClearErrors
  FileOpen $0 "$INSTDIR\.mineradio-install-owner.json" r
  IfErrors MineradioExactOwnershipDone
  FileRead $0 $1
  FileClose $0
  StrCpy $MineradioGuardInput "$INSTDIR"
  Call ${PREFIX}MineradioPathToJson
  StrCpy $2 `{"schemaVersion":1,"productName":"${MINERADIO_INSTALL_PRODUCT_NAME}","appId":"${MINERADIO_INSTALL_APP_ID}","channel":"${MINERADIO_INSTALL_MANIFEST_CHANNEL}","version":"${MINERADIO_INSTALL_MANIFEST_VERSION}","installPath":"$MineradioGuardOutput","manifestSha256":"${MINERADIO_INSTALL_MANIFEST_SHA256}","commit":"${MINERADIO_INSTALL_COMMIT}","buildId":"${MINERADIO_INSTALL_BUILD_ID}","createdAt":"${MINERADIO_INSTALL_BUILD_CREATED_AT}"}`
  StrCmp "$1" "$2" 0 MineradioExactOwnershipDone

  ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema
  StrCmp $0 "1" 0 MineradioExactOwnershipDone
  ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller
  StrCmp $0 "1" 0 MineradioExactOwnershipDone
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256
  StrCmp "$0" "${MINERADIO_INSTALL_MANIFEST_SHA256}" 0 MineradioExactOwnershipDone
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerChannel
  StrCmp "$0" "${MINERADIO_INSTALL_MANIFEST_CHANNEL}" 0 MineradioExactOwnershipDone
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerInstallPath
  StrCmp "$0" "$INSTDIR" 0 MineradioExactOwnershipDone
  StrCpy $MineradioGuardResult "1"

  MineradioExactOwnershipDone:
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd
!endif
!macroend

!ifdef BUILD_UNINSTALLER
  !insertmacro MineradioDefineGuardFunctions "un."

Function un.MineradioValidateManagedDirectory
  Push $0
  Push $1
  StrCpy $MineradioGuardResult "0"
  System::Call 'kernel32::GetFileAttributesW(w "$MineradioGuardInput") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 == 2
    ${OrIf} $1 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
    Goto MineradioValidateManagedDirectoryDone
  ${EndIf}
  IntOp $1 $0 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
  StrCmp $1 "0" MineradioValidateManagedDirectoryDone
  IntOp $1 $0 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
  StrCmp $1 "0" 0 MineradioValidateManagedDirectoryDone
  StrCpy $MineradioGuardResult "1"

  MineradioValidateManagedDirectoryDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function un.MineradioRemoveManagedFile
  Push $0
  Push $1
  StrCpy $MineradioGuardResult "0"
  System::Call 'kernel32::GetFileAttributesW(w "$MineradioGuardInput") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 == 2
    ${OrIf} $1 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
    Goto MineradioRemoveManagedFileDone
  ${EndIf}
  IntOp $1 $0 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
  StrCmp $1 "0" 0 MineradioRemoveManagedFileDone
  ClearErrors
  Delete "$MineradioGuardInput"
  IfErrors MineradioRemoveManagedFileDone
  System::Call 'kernel32::GetFileAttributesW(w "$MineradioGuardInput") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 == 2
    ${OrIf} $1 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
  ${EndIf}

  MineradioRemoveManagedFileDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function un.MineradioRemoveManagedDirectory
  Push $0
  Push $1
  StrCpy $MineradioGuardResult "0"
  System::Call 'kernel32::GetFileAttributesW(w "$MineradioGuardInput") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 == 2
    ${OrIf} $1 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
    Goto MineradioRemoveManagedDirectoryDone
  ${EndIf}
  IntOp $1 $0 & 0x10 ; FILE_ATTRIBUTE_DIRECTORY
  StrCmp $1 "0" MineradioRemoveManagedDirectoryDone
  IntOp $1 $0 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
  StrCmp $1 "0" 0 MineradioRemoveManagedDirectoryDone
  ClearErrors
  RMDir "$MineradioGuardInput"
  IfErrors MineradioRemoveManagedDirectoryDone
  System::Call 'kernel32::GetFileAttributesW(w "$MineradioGuardInput") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 == 2
    ${OrIf} $1 == 3
      StrCpy $MineradioGuardResult "1"
    ${EndIf}
  ${EndIf}

  MineradioRemoveManagedDirectoryDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd
!else
  !insertmacro MineradioDefineGuardFunctions ""

Function MineradioPendingOwnershipMatchesRegistry
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  StrCpy $MineradioGuardResult "0"

  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSchema
  StrCmp "$0" "1" 0 MineradioPendingOwnershipMatchesRegistryDone
  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSafeUninstaller
  StrCmp "$0" "1" 0 MineradioPendingOwnershipMatchesRegistryDone
  ReadRegStr $1 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingProductName
  ReadRegStr $2 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingAppId
  ReadRegStr $3 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingChannel
  ReadRegStr $4 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingVersion
  ReadRegStr $5 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  ReadRegStr $6 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingManifestSha256
  ReadRegStr $7 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCommit
  ReadRegStr $8 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingBuildId
  ReadRegStr $9 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCreatedAt

  StrCmp "$1" "${MINERADIO_INSTALL_PRODUCT_NAME}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$2" "${MINERADIO_INSTALL_APP_ID}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$3" "${MINERADIO_INSTALL_MANIFEST_CHANNEL}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$4" "${MINERADIO_INSTALL_MANIFEST_VERSION}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$5" "$INSTDIR" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$6" "${MINERADIO_INSTALL_MANIFEST_SHA256}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$7" "${MINERADIO_INSTALL_COMMIT}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$8" "${MINERADIO_INSTALL_BUILD_ID}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCmp "$9" "${MINERADIO_INSTALL_BUILD_CREATED_AT}" 0 MineradioPendingOwnershipMatchesRegistryDone
  StrCpy $MineradioGuardResult "1"

  MineradioPendingOwnershipMatchesRegistryDone:
    Pop $R0
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioPendingOwnershipMatchesFile
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  StrCpy $MineradioGuardResult "0"

  Call MineradioPendingOwnershipMatchesRegistry
  Pop $0
  StrCmp "$0" "1" 0 MineradioPendingOwnershipMatchesFileDone
  StrCpy $MineradioGuardResult "0"
  ClearErrors
  FileOpen $0 "$MineradioGuardInput" r
  IfErrors MineradioPendingOwnershipMatchesFileDone
  FileRead $0 $MineradioGuardHaystack
  FileClose $0

  ReadRegStr $1 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingProductName
  ReadRegStr $2 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingAppId
  ReadRegStr $3 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingChannel
  ReadRegStr $4 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingVersion
  ReadRegStr $5 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  ReadRegStr $6 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingManifestSha256
  ReadRegStr $7 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCommit
  ReadRegStr $8 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingBuildId
  ReadRegStr $9 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCreatedAt
  StrCpy $MineradioGuardInput "$INSTDIR"
  Call MineradioPathToJson
  StrCpy $R0 `{"schemaVersion":1,"productName":"$1","appId":"$2","channel":"$3","version":"$4","installPath":"$MineradioGuardOutput","manifestSha256":"$6","commit":"$7","buildId":"$8","createdAt":"$9"}`
  StrCmp "$MineradioGuardHaystack" "$R0" 0 MineradioPendingOwnershipMatchesFileDone
  StrCpy $MineradioGuardResult "1"

  MineradioPendingOwnershipMatchesFileDone:
    Pop $R0
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioBeginOwnershipTransaction
  Push $0
  StrCpy $MineradioGuardResult "0"
  ClearErrors
  WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSchema 1
  WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSafeUninstaller 1
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingProductName "${MINERADIO_INSTALL_PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingAppId "${MINERADIO_INSTALL_APP_ID}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingChannel "${MINERADIO_INSTALL_MANIFEST_CHANNEL}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingVersion "${MINERADIO_INSTALL_MANIFEST_VERSION}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingManifestSha256 "${MINERADIO_INSTALL_MANIFEST_SHA256}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCommit "${MINERADIO_INSTALL_COMMIT}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingBuildId "${MINERADIO_INSTALL_BUILD_ID}"
  WriteRegStr SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCreatedAt "${MINERADIO_INSTALL_BUILD_CREATED_AT}"
  WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending 1
  IfErrors MineradioBeginOwnershipTransactionDone
  Call MineradioPendingOwnershipMatchesRegistry
  Pop $MineradioGuardResult

  MineradioBeginOwnershipTransactionDone:
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioClearPendingOwnershipTransaction
  Push $0
  StrCpy $MineradioGuardResult "0"
  ClearErrors
  WriteRegDWORD SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending 0
  IfErrors MineradioClearPendingOwnershipTransactionDone
  ClearErrors
  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  IfErrors MineradioClearPendingOwnershipTransactionDone
  StrCmp "$0" "0" 0 MineradioClearPendingOwnershipTransactionDone

  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSchema
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingSafeUninstaller
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingProductName
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingAppId
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingChannel
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingVersion
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingManifestSha256
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCommit
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingBuildId
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCreatedAt
  DeleteRegValue SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  StrCpy $MineradioGuardResult "1"

  MineradioClearPendingOwnershipTransactionDone:
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioCommitPendingOwnership
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $MineradioGuardResult "0"
  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" 0 MineradioCommitPendingOwnershipDone

  ClearErrors
  ReadRegStr $1 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingProductName
  ReadRegStr $2 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingAppId
  ReadRegStr $3 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingChannel
  ReadRegStr $4 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingVersion
  ReadRegStr $5 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  ReadRegStr $6 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingManifestSha256
  ReadRegStr $7 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCommit
  ReadRegStr $8 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingBuildId
  ReadRegStr $9 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingCreatedAt
  IfErrors MineradioCommitPendingOwnershipDone

  ClearErrors
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema 1
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller 1
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerProductName "$1"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerAppId "$2"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerChannel "$3"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerVersion "$4"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerInstallPath "$5"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerManifestSha256 "$6"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerCommit "$7"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerBuildId "$8"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerCreatedAt "$9"
  IfErrors MineradioCommitPendingOwnershipDone

  Call MineradioValidateSelectedOwnership
  Pop $0
  StrCmp "$0" "1" 0 MineradioCommitPendingOwnershipDone
  Call MineradioClearPendingOwnershipTransaction
  Pop $0
  StrCmp "$0" "1" 0 MineradioCommitPendingOwnershipDone
  Delete "$INSTDIR\.mineradio-install-owner.json.bak"
  Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
  StrCpy $MineradioGuardResult "1"

  MineradioCommitPendingOwnershipDone:
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioRecoverOwnershipTransaction
  Push $0
  Push $1
  StrCpy $MineradioInstallReservationActive "0"
  StrCpy $MineradioGuardResult "1"
  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  StrCmp "$0" "1" 0 MineradioRecoverOwnershipTransactionDone
  StrCpy $MineradioGuardResult "0"

  ReadRegStr $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  StrCmp "$0" "" MineradioRecoverOwnershipTransactionDone
  StrCpy $INSTDIR "$0"
  Call MineradioValidateInstallPath
  Pop $0
  StrCmp "$0" "1" 0 MineradioRecoverOwnershipTransactionDone

  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" MineradioRecoverOwnershipTransactionCommit

  Call MineradioValidateSelectedOwnership
  Pop $0
  StrCmp "$0" "1" MineradioRecoverOwnershipTransactionRollbackPending

  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" MineradioRecoverOwnershipTransactionResumeReservation
  Goto MineradioRecoverOwnershipTransactionTryBackup

  MineradioRecoverOwnershipTransactionResumeReservation:
    IfFileExists "$INSTDIR\.mineradio-install-owner.json" MineradioRecoverOwnershipTransactionDone
    StrCpy $MineradioInstallReservationActive "1"
    StrCpy $MineradioGuardResult "1"
    Goto MineradioRecoverOwnershipTransactionDone

  MineradioRecoverOwnershipTransactionTryBackup:
    IfFileExists "$INSTDIR\.mineradio-install-owner.json" MineradioRecoverOwnershipTransactionDone
    IfFileExists "$INSTDIR\.mineradio-install-owner.json.bak" 0 MineradioRecoverOwnershipTransactionDone
    ClearErrors
    Rename "$INSTDIR\.mineradio-install-owner.json.bak" "$INSTDIR\.mineradio-install-owner.json"
    IfErrors MineradioRecoverOwnershipTransactionDone
    Call MineradioValidateSelectedOwnership
    Pop $0
    StrCmp "$0" "1" 0 MineradioRecoverOwnershipTransactionDone
    Goto MineradioRecoverOwnershipTransactionRollbackPending

  MineradioRecoverOwnershipTransactionCommit:
    Call MineradioCommitPendingOwnership
    Pop $0
    StrCmp "$0" "1" 0 MineradioRecoverOwnershipTransactionDone
    StrCpy $MineradioGuardResult "1"
    Goto MineradioRecoverOwnershipTransactionDone

  MineradioRecoverOwnershipTransactionRollbackPending:
    Call MineradioClearPendingOwnershipTransaction
    Pop $0
    StrCmp "$0" "1" 0 MineradioRecoverOwnershipTransactionDone
    Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
    Delete "$INSTDIR\.mineradio-install-owner.json.bak"
    StrCpy $MineradioGuardResult "1"

  MineradioRecoverOwnershipTransactionDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioCancelInstallReservation
  Push $0
  Push $1
  Push $2
  StrCpy $1 "$INSTDIR"
  StrCpy $2 "0"
  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  StrCmp "$0" "1" 0 MineradioCancelInstallReservationNothing
  ReadRegStr $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  StrCmp "$0" "" MineradioCancelInstallReservationDone
  StrCpy $INSTDIR "$0"
  Call MineradioValidateInstallPath
  Pop $0
  StrCmp "$0" "1" 0 MineradioCancelInstallReservationDone
  IfFileExists "$INSTDIR\.mineradio-install-owner.json" MineradioCancelInstallReservationDone
  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" 0 MineradioCancelInstallReservationDone
  ClearErrors
  Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
  IfErrors MineradioCancelInstallReservationDone
  IfFileExists "$INSTDIR\.mineradio-install-owner.json.tmp" MineradioCancelInstallReservationDone
  Call MineradioClearPendingOwnershipTransaction
  Pop $0
  StrCmp "$0" "1" 0 MineradioCancelInstallReservationDone
  RMDir "$INSTDIR"
  StrCpy $2 "1"
  Goto MineradioCancelInstallReservationDone

  MineradioCancelInstallReservationNothing:
    StrCpy $2 "1"

  MineradioCancelInstallReservationDone:
    StrCpy $INSTDIR "$1"
    StrCpy $MineradioInstallReservationActive "0"
    StrCpy $MineradioGuardResult "$2"
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioValidateInstallCommitTarget
  Push $0
  StrCpy $MineradioGuardResult "0"
  Call MineradioValidateSelectedInstall
  Pop $0
  StrCmp "$0" "1" MineradioValidateInstallCommitTargetValid

  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" MineradioValidateInstallCommitTargetReservation
  StrCmp "$MineradioOwnedUpgradePath" "" MineradioValidateInstallCommitTargetDone
  StrCmp "$MineradioOwnedUpgradePath" "$INSTDIR" MineradioValidateInstallCommitTargetValid
  Goto MineradioValidateInstallCommitTargetDone

  MineradioValidateInstallCommitTargetReservation:
    StrCpy $MineradioInstallReservationActive "1"

  MineradioValidateInstallCommitTargetValid:
    StrCpy $MineradioGuardResult "1"

  MineradioValidateInstallCommitTargetDone:
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioEnsureInstallReservation
  Push $0
  Push $1
  StrCpy $MineradioGuardResult "0"
  Call MineradioValidateInstallCommitTarget
  Pop $0
  StrCmp "$0" "1" 0 MineradioEnsureInstallReservationDone

  ReadRegDWORD $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerTransactionPending
  StrCmp "$0" "1" 0 MineradioEnsureInstallReservationCreate
  ReadRegStr $0 SHELL_CONTEXT "${MINERADIO_PENDING_REGISTRY_KEY}" InstallOwnerPendingInstallPath
  StrCmp "$0" "$INSTDIR" 0 MineradioEnsureInstallReservationMove
  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" 0 MineradioEnsureInstallReservationDone
  StrCpy $MineradioInstallReservationActive "1"
  StrCpy $MineradioGuardResult "1"
  Goto MineradioEnsureInstallReservationDone

  MineradioEnsureInstallReservationMove:
    Call MineradioCancelInstallReservation
    Pop $0
    StrCmp "$0" "1" 0 MineradioEnsureInstallReservationDone

  MineradioEnsureInstallReservationCreate:
    Call MineradioBeginOwnershipTransaction
    Pop $0
    StrCmp "$0" "1" 0 MineradioEnsureInstallReservationFailed
    ClearErrors
    CreateDirectory "$INSTDIR"
    IfErrors MineradioEnsureInstallReservationFailed
    StrCpy $MineradioGuardInput "$INSTDIR"
    Call MineradioPathToJson
    Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
    ClearErrors
    FileOpen $0 "$INSTDIR\.mineradio-install-owner.json.tmp" w
    IfErrors MineradioEnsureInstallReservationFailed
    ClearErrors
    FileWrite $0 `{"schemaVersion":1,"productName":"${MINERADIO_INSTALL_PRODUCT_NAME}","appId":"${MINERADIO_INSTALL_APP_ID}","channel":"${MINERADIO_INSTALL_MANIFEST_CHANNEL}","version":"${MINERADIO_INSTALL_MANIFEST_VERSION}","installPath":"$MineradioGuardOutput","manifestSha256":"${MINERADIO_INSTALL_MANIFEST_SHA256}","commit":"${MINERADIO_INSTALL_COMMIT}","buildId":"${MINERADIO_INSTALL_BUILD_ID}","createdAt":"${MINERADIO_INSTALL_BUILD_CREATED_AT}"}`
    IfErrors MineradioEnsureInstallReservationWriteFailed
    ClearErrors
    FileClose $0
    IfErrors MineradioEnsureInstallReservationFailed
    StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
    Call MineradioPendingOwnershipMatchesFile
    Pop $0
    StrCmp "$0" "1" 0 MineradioEnsureInstallReservationFailed
    StrCpy $MineradioInstallReservationActive "1"
    StrCpy $MineradioGuardResult "1"
    Goto MineradioEnsureInstallReservationDone

  MineradioEnsureInstallReservationWriteFailed:
    FileClose $0

  MineradioEnsureInstallReservationFailed:
    Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
    Call MineradioClearPendingOwnershipTransaction
    Pop $0
    Goto MineradioEnsureInstallReservationDone

  MineradioEnsureInstallReservationDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioVerifyUninstallCommandsSuppressed
  Push $0
  StrCpy $MineradioGuardResult "0"

  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  StrCmp "$0" "" 0 MineradioVerifyUninstallCommandsSuppressedDone
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  StrCmp "$0" "" 0 MineradioVerifyUninstallCommandsSuppressedDone
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    StrCmp "$0" "" 0 MineradioVerifyUninstallCommandsSuppressedDone
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    StrCmp "$0" "" 0 MineradioVerifyUninstallCommandsSuppressedDone
  !endif
  StrCpy $MineradioGuardResult "1"

  MineradioVerifyUninstallCommandsSuppressedDone:
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioVerifyCanonicalUninstallCommands
  Push $0
  Push $1
  Push $2
  StrCpy $MineradioGuardResult "0"
  StrCpy $1 '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $MineradioExpectedUninstallMode'
  StrCpy $2 '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $MineradioExpectedUninstallMode /S'

  ${If} "$MineradioExpectedUninstallSource" == "secondary"
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    StrCmp "$0" "" 0 MineradioVerifyCanonicalUninstallCommandsDone
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    StrCmp "$0" "" 0 MineradioVerifyCanonicalUninstallCommandsDone
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      StrCmp "$0" "$1" 0 MineradioVerifyCanonicalUninstallCommandsDone
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
      StrCmp "$0" "$2" 0 MineradioVerifyCanonicalUninstallCommandsDone
    !else
      Goto MineradioVerifyCanonicalUninstallCommandsDone
    !endif
  ${ElseIf} "$MineradioExpectedUninstallSource" == "primary"
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    StrCmp "$0" "$1" 0 MineradioVerifyCanonicalUninstallCommandsDone
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    StrCmp "$0" "$2" 0 MineradioVerifyCanonicalUninstallCommandsDone
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      StrCmp "$0" "" 0 MineradioVerifyCanonicalUninstallCommandsDone
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
      StrCmp "$0" "" 0 MineradioVerifyCanonicalUninstallCommandsDone
    !endif
  ${Else}
    Goto MineradioVerifyCanonicalUninstallCommandsDone
  ${EndIf}
  StrCpy $MineradioGuardResult "1"

  MineradioVerifyCanonicalUninstallCommandsDone:
    Pop $2
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioPrepareUpgrade
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $MineradioOwnedUpgrade "0"
  StrCpy $MineradioOwnedUpgradePath ""
  StrCpy $2 ""

  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} "$0" != ""
    StrCpy $2 "primary"
  ${Else}
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      ${If} "$0" != ""
        StrCpy $2 "secondary"
      ${EndIf}
    !endif
  ${EndIf}

  ${If} "$2" == ""
    ; Orphaned quiet commands are legacy state and must never survive migration.
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    ${If} "$0" != ""
      Goto MineradioPrepareUpgradeSuppressLegacy
    ${EndIf}
    !ifdef UNINSTALL_REGISTRY_KEY_2
      ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
      ${If} "$0" != ""
        Goto MineradioPrepareUpgradeSuppressLegacy
      ${EndIf}
    !endif
    ; A missing command can be recovered only from a complete owned installation.
    ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller
    ${If} $0 == 1
      StrCpy $2 "primary"
    ${Else}
      Goto MineradioPrepareUpgradeDone
    ${EndIf}
  ${EndIf}

  ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSafeUninstaller
  ${If} $0 != 1
    Goto MineradioPrepareUpgradeSuppressLegacy
  ${EndIf}

  ReadRegStr $3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $4 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerInstallPath
  ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerAppId
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerChannel
  ${If} "$3" == ""
  ${OrIf} "$4" != "$3"
  ${OrIf} "$1" != "${MINERADIO_INSTALL_APP_ID}"
  ${OrIf} "$0" != "${MINERADIO_INSTALL_MANIFEST_CHANNEL}"
    Goto MineradioPrepareUpgradeOwnershipInvalid
  ${EndIf}

  ReadRegDWORD $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallOwnerSchema
  ${If} $0 != 1
    Goto MineradioPrepareUpgradeOwnershipInvalid
  ${EndIf}

  StrCpy $INSTDIR "$3"
  IfFileExists "$INSTDIR\.mineradio-install-owner.json" MineradioPrepareUpgradeMarkerReady
  IfFileExists "$INSTDIR\.mineradio-install-owner.json.bak" 0 MineradioPrepareUpgradeOwnershipInvalid
  ClearErrors
  Rename "$INSTDIR\.mineradio-install-owner.json.bak" "$INSTDIR\.mineradio-install-owner.json"
  IfErrors MineradioPrepareUpgradeOwnershipInvalid

  MineradioPrepareUpgradeMarkerReady:
  Call MineradioValidateSelectedInstall
  Pop $0
  ${If} "$0" != "1"
  ${OrIfNot} ${FileExists} "$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}"
    Goto MineradioPrepareUpgradeOwnershipInvalid
  ${EndIf}

  StrCpy $MineradioOwnedUpgrade "1"
  StrCpy $MineradioOwnedUpgradePath "$INSTDIR"
  StrCpy $1 "$MineradioUpgradeModeArgument"
  Goto MineradioPrepareUpgradeCanonicalize

  MineradioPrepareUpgradeOwnershipInvalid:
    MessageBox MB_ICONSTOP|MB_OK "Existing Mineradio ownership could not be verified. Registry commands were left unchanged."
    Abort

  MineradioPrepareUpgradeSuppressLegacy:
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    !endif
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    Call MineradioVerifyUninstallCommandsSuppressed
    Pop $0
    ${If} "$0" != "1"
      Goto MineradioPrepareUpgradeRegistryMutationFailed
    ${EndIf}
    ClearErrors
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MineradioLegacyUninstallerSuppressed 1
    IfErrors MineradioPrepareUpgradeRegistryMutationFailed
    DetailPrint "Mineradio legacy uninstaller commands suppressed."
    Goto MineradioPrepareUpgradeDone

  MineradioPrepareUpgradeCanonicalize:
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    !endif
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString

    StrCpy $MineradioExpectedUninstallSource "$2"
    StrCpy $MineradioExpectedUninstallMode "$1"
    ClearErrors
    ${If} "$2" == "secondary"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $1'
        WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $1 /S'
      !endif
    ${Else}
      WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $1'
      WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\${MINERADIO_UNINSTALL_FILENAME}" $1 /S'
    ${EndIf}
    IfErrors MineradioPrepareUpgradeRegistryMutationFailed
    Call MineradioVerifyCanonicalUninstallCommands
    Pop $0
    ${If} "$0" != "1"
      Goto MineradioPrepareUpgradeRegistryMutationFailed
    ${EndIf}
    DeleteRegValue SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MineradioLegacyUninstallerSuppressed
    Goto MineradioPrepareUpgradeDone

  MineradioPrepareUpgradeRegistryMutationFailed:
    MessageBox MB_ICONSTOP|MB_OK "Mineradio could not safely repair existing uninstall registry commands."
    Abort

  MineradioPrepareUpgradeDone:
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

Function MineradioValidateInstalledManifest
  Push $0
  Push $1
  StrCpy $MineradioGuardResult "0"
  IfFileExists "$INSTDIR\.mineradio-install-manifest.json" 0 MineradioValidateInstalledManifestDone
  ClearErrors
  ${StdUtils.HashFile} $0 "SHA2-256" "$INSTDIR\.mineradio-install-manifest.json"
  IfErrors MineradioValidateInstalledManifestDone
  System::Call 'kernel32::lstrcmpiW(w "$0", w "${MINERADIO_INSTALL_MANIFEST_FILE_SHA256}") i .r1'
  StrCmp "$1" "0" 0 MineradioValidateInstalledManifestDone
  StrCpy $MineradioGuardResult "1"

  MineradioValidateInstalledManifestDone:
    Pop $1
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

!macro MineradioInstallOwnedManifest
  SetOutPath "$INSTDIR"
  ClearErrors
  Delete "$INSTDIR\.mineradio-install-manifest.json"
  IfErrors MineradioInstallOwnedManifestFailed
  IfFileExists "$INSTDIR\.mineradio-install-manifest.json" MineradioInstallOwnedManifestFailed 0
  ClearErrors
  File /oname=.mineradio-install-manifest.json "${BUILD_RESOURCES_DIR}\.generated\installer-manifest.json"
  IfErrors MineradioInstallOwnedManifestFailed
  Call MineradioValidateInstalledManifest
  Pop $0
  StrCmp "$0" "1" MineradioInstallOwnedManifestDone MineradioInstallOwnedManifestFailed

  MineradioInstallOwnedManifestFailed:
    Delete "$INSTDIR\.mineradio-install-manifest.json"
    MessageBox MB_ICONSTOP|MB_OK "Mineradio installation manifest could not be written or verified. Ownership was not committed."
    Abort

  MineradioInstallOwnedManifestDone:
!macroend

Function MineradioCommitInstalledOwnership
  Push $0
  Call MineradioValidateInstalledManifest
  Pop $0
  StrCmp "$0" "1" 0 MineradioCommitInstalledOwnershipInvalid
  Call MineradioWriteOwnershipMarker
  StrCpy $MineradioGuardResult "1"
  Goto MineradioCommitInstalledOwnershipDone

  MineradioCommitInstalledOwnershipInvalid:
    StrCpy $MineradioGuardResult "0"

  MineradioCommitInstalledOwnershipDone:
    Pop $0
    Push "$MineradioGuardResult"
FunctionEnd

Function MineradioWriteOwnershipMarker
  Push $0
  Push $1
  StrCpy $MineradioGuardInput "$INSTDIR\.mineradio-install-owner.json.tmp"
  Call MineradioPendingOwnershipMatchesFile
  Pop $0
  StrCmp "$0" "1" MineradioWriteOwnershipMarkerWritten
  Goto MineradioWriteOwnershipMarkerCreatePending

  MineradioWriteOwnershipMarkerCreatePending:
  StrCpy $MineradioGuardInput "$INSTDIR"
  Call MineradioPathToJson
  Call MineradioBeginOwnershipTransaction
  Pop $0
  StrCmp "$0" "1" 0 MineradioWriteOwnershipRegistryFailed
  Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
  ClearErrors
  FileOpen $0 "$INSTDIR\.mineradio-install-owner.json.tmp" w
  IfErrors MineradioWriteOwnershipMarkerFailed
  ClearErrors
  FileWrite $0 `{"schemaVersion":1,"productName":"${MINERADIO_INSTALL_PRODUCT_NAME}","appId":"${MINERADIO_INSTALL_APP_ID}","channel":"${MINERADIO_INSTALL_MANIFEST_CHANNEL}","version":"${MINERADIO_INSTALL_MANIFEST_VERSION}","installPath":"$MineradioGuardOutput","manifestSha256":"${MINERADIO_INSTALL_MANIFEST_SHA256}","commit":"${MINERADIO_INSTALL_COMMIT}","buildId":"${MINERADIO_INSTALL_BUILD_ID}","createdAt":"${MINERADIO_INSTALL_BUILD_CREATED_AT}"}`
  IfErrors MineradioWriteOwnershipMarkerWriteFailed
  ClearErrors
  FileClose $0
  IfErrors MineradioWriteOwnershipMarkerFailed
  Goto MineradioWriteOwnershipMarkerWritten

  MineradioWriteOwnershipMarkerWriteFailed:
    FileClose $0
    Delete "$INSTDIR\.mineradio-install-owner.json.tmp"
    Goto MineradioWriteOwnershipMarkerFailed

  MineradioWriteOwnershipMarkerWritten:
  StrCpy $1 "0"
  IfFileExists "$INSTDIR\.mineradio-install-owner.json" 0 MineradioWriteOwnershipMarkerReplace
  Delete "$INSTDIR\.mineradio-install-owner.json.bak"
  IfFileExists "$INSTDIR\.mineradio-install-owner.json.bak" MineradioWriteOwnershipMarkerFailed
  ClearErrors
  Rename "$INSTDIR\.mineradio-install-owner.json" "$INSTDIR\.mineradio-install-owner.json.bak"
  IfErrors MineradioWriteOwnershipMarkerFailed
  StrCpy $1 "1"

  MineradioWriteOwnershipMarkerReplace:
  ClearErrors
  Rename "$INSTDIR\.mineradio-install-owner.json.tmp" "$INSTDIR\.mineradio-install-owner.json"
  IfErrors MineradioWriteOwnershipMarkerRollback
  Goto MineradioWriteOwnershipMarkerReplaced

  MineradioWriteOwnershipMarkerRollback:
    StrCmp "$1" "1" 0 MineradioWriteOwnershipMarkerFailed
    ClearErrors
    Rename "$INSTDIR\.mineradio-install-owner.json.bak" "$INSTDIR\.mineradio-install-owner.json"
    IfErrors MineradioWriteOwnershipMarkerFailed
    Goto MineradioWriteOwnershipMarkerFailed

  MineradioWriteOwnershipMarkerReplaced:
  Call MineradioCommitPendingOwnership
  Pop $0
  StrCmp "$0" "1" 0 MineradioWriteOwnershipRegistryFailed
  Goto MineradioWriteOwnershipMarkerDone

  MineradioWriteOwnershipRegistryFailed:
    ; Keep pending state intact so the next installer start can finish or roll back.
    MessageBox MB_ICONSTOP|MB_OK "Mineradio ownership transaction could not be committed."
    Abort

  MineradioWriteOwnershipMarkerFailed:
    MessageBox MB_ICONSTOP|MB_OK "Mineradio ownership marker could not be written."
    Abort

  MineradioWriteOwnershipMarkerDone:
    Pop $1
    Pop $0
FunctionEnd
!endif

!endif
