; FrameCut Studio installer hooks (electron-builder NSIS, assisted installer).
;
; One folder holds everything: the app files and, beside them, data\ with settings, AI models, caches
; and (by default) projects. So:
;   * install per user, never elevated, into a folder the user can write to;
;   * updates replace the app files and never touch data\;
;   * uninstall offers Standard (keep projects & media) or Complete removal (projects only after a
;     separate confirmation). Projects stored outside the folder are never touched.
;
; Silent use: Setup.exe /S [/D=path]   Uninstall.exe /S [--complete [--delete-projects]]

!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

; Always "just for me": no install-mode page, no administrator prompt.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ---------------------------------------------------------------------------------------------------
; Shared: is $0 the same as, or inside, folder $1? Result in $2 ("1"/"0").
!ifndef BUILD_UNINSTALLER
Function fcIsUnder
  StrCpy $2 "0"
  ${If} $1 == ""
    Return
  ${EndIf}
  StrLen $3 $1
  StrCpy $4 $0 $3
  ${If} $4 == $1
    StrCpy $4 $0 1 $3
    ${If} $4 == ""
    ${OrIf} $4 == "\"
      StrCpy $2 "1"
    ${EndIf}
  ${EndIf}
FunctionEnd

Var fcDirProblem

; Sets $fcDirProblem to "" when $INSTDIR is usable, otherwise to an explanation.
Function fcCheckInstallDir
  StrCpy $fcDirProblem ""
  StrCpy $0 $INSTDIR
  ReadEnvStr $5 "ProgramData"
  ReadEnvStr $6 "ProgramW6432"
  ${ForEach} $7 1 6 + 1
    ${If} $7 == 1
      StrCpy $1 $PROGRAMFILES32
    ${ElseIf} $7 == 2
      StrCpy $1 $PROGRAMFILES64
    ${ElseIf} $7 == 3
      StrCpy $1 $6
    ${ElseIf} $7 == 4
      StrCpy $1 $WINDIR
    ${ElseIf} $7 == 5
      StrCpy $1 $5
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    Call fcIsUnder
    ${If} $2 == "1"
      StrCpy $fcDirProblem "$INSTDIR is a protected Windows folder."
      Return
    ${EndIf}
  ${Next}
  ; A real write test: FrameCut must be able to create files here without administrator rights.
  StrCpy $8 "0"
  ${IfNot} ${FileExists} "$INSTDIR\*.*"
    StrCpy $8 "1"
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $9 "$INSTDIR\.framecut-write-test" w
  ${If} ${Errors}
    StrCpy $fcDirProblem "You don't have permission to create files in $INSTDIR."
  ${Else}
    FileClose $9
    Delete "$INSTDIR\.framecut-write-test"
  ${EndIf}
  ${If} $8 == "1"
    RMDir "$INSTDIR"
  ${EndIf}
FunctionEnd

; Shown after the folder page only when the chosen folder can't be used; Next stays disabled.
Function fcDirPagePre
  Call fcCheckInstallDir
  ${If} $fcDirProblem == ""
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Choose a different folder" "FrameCut Studio can't be installed here."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 100% "$fcDirProblem$\r$\n$\r$\nFrameCut Studio keeps its settings, AI models and projects inside its own folder, so it must be installed somewhere you can write to without administrator rights. Protected folders such as Program Files and Windows can't be used, and FrameCut won't change their permissions.$\r$\n$\r$\nClick Back and choose a folder in your user profile (the default, $LOCALAPPDATA\Programs\${PRODUCT_NAME}) or on another drive, for example D:\Apps\${PRODUCT_NAME}."
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

!macro customPageAfterChangeDir
  Page custom fcDirPagePre
!macroend

; electron-builder keeps a copy of the installer in %LOCALAPPDATA%\<name>-updater for electron-updater.
; FrameCut doesn't use an updater, and nothing may live outside the install folder, so drop it.
!macro fcDropInstallerCopy
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$LOCALAPPDATA\${APP_FILENAME}-updater"
  RMDir "$LOCALAPPDATA\framecut-studio-updater"
!macroend

Var fcOldDir

; Reinstalling into a different folder: electron-builder removes the old copy's app files but leaves its
; data\ behind. Bring that data (settings, models, projects) along so nothing is stranded or downloaded
; twice: rename on the same drive, otherwise copy and remove the original only after a complete copy.
Function fcMoveOldData
  ${If} $fcOldDir == ""
  ${OrIfNot} ${FileExists} "$fcOldDir\data\*.*"
  ${OrIf} ${FileExists} "$INSTDIR\data\*.*"
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR
  StrCpy $1 $fcOldDir
  Call fcIsUnder
  ${If} $2 == "1"
    Return
  ${EndIf}
  StrCpy $0 $fcOldDir
  StrCpy $1 $INSTDIR
  Call fcIsUnder
  ${If} $2 == "1"
    Return
  ${EndIf}
  DetailPrint "Moving your FrameCut data from $fcOldDir\data"
  ClearErrors
  Rename "$fcOldDir\data" "$INSTDIR\data"
  ${If} ${Errors}
    ClearErrors
    CreateDirectory "$INSTDIR\data"
    CopyFiles /SILENT "$fcOldDir\data\*.*" "$INSTDIR\data"
    ${If} ${Errors}
      DetailPrint "Could not copy all of $fcOldDir\data; the original was left in place."
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "FrameCut Studio couldn't move all of your data from$\r$\n$fcOldDir\data$\r$\n$\r$\nThe original folder was left untouched. Close any program using it and move its contents into$\r$\n$INSTDIR\data"
      ${EndIf}
      Return
    ${EndIf}
    RMDir /r "$fcOldDir\data"
    ${If} ${FileExists} "$fcOldDir\data\*.*"
      nsExec::Exec '"$SYSDIR\cmd.exe" /c rd /s /q "\\?\$fcOldDir\data"'
      Pop $0
    ${EndIf}
  ${EndIf}
  RMDir "$fcOldDir"
FunctionEnd

!macro customInstall
  !insertmacro fcDropInstallerCopy
  Call fcMoveOldData
  ; The previous copy's uninstaller ran in place during the update and can't delete itself.
  ${If} $fcOldDir != ""
  ${AndIf} $fcOldDir != $INSTDIR
    Delete "$fcOldDir\Uninstall ${PRODUCT_FILENAME}.exe"
    Delete "$fcOldDir\uninstallerIcon.ico"
    RMDir "$fcOldDir"
  ${EndIf}
!macroend

!macro customInit
  ; Where an existing per-user installation lives (empty on a first install).
  ReadRegStr $fcOldDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $fcOldDir == $INSTDIR
    StrCpy $fcOldDir ""
  ${EndIf}
  ; Silent installs skip the pages, so check the folder here.
  ${If} ${Silent}
    Call fcCheckInstallDir
    ${If} $fcDirProblem != ""
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
!macroend
!endif

; ---------------------------------------------------------------------------------------------------
!ifdef BUILD_UNINSTALLER

Var fcUpdated        ; "1" = run by a newer installer during an update: keep data\ untouched
Var fcComplete       ; "1" = Complete removal
Var fcDeleteUser     ; "1" = also delete projects, recordings and library media inside the folder
Var fcRadioStandard
Var fcRadioComplete
Var fcHasUserFiles

; Does folder $R5 contain any file at any depth? Result in $R6 ("1"/"0").
Function un.fcHasFiles
  Push $R0
  Push $R1
  StrCpy $R6 "0"
  FindFirst $R0 $R1 "$R5\*.*"
  fcLoop:
    StrCmp $R1 "" fcDone
    StrCmp $R1 "." fcNext
    StrCmp $R1 ".." fcNext
    IfFileExists "$R5\$R1\*.*" fcDir
    StrCpy $R6 "1"
    Goto fcDone
  fcDir:
    Push $R5
    StrCpy $R5 "$R5\$R1"
    Call un.fcHasFiles
    Pop $R5
    StrCmp $R6 "1" fcDone
  fcNext:
    FindNext $R0 $R1
    Goto fcLoop
  fcDone:
  FindClose $R0
  Pop $R1
  Pop $R0
FunctionEnd

; Projects (including recently deleted ones), recordings, library media or saved templates inside data\?
Function un.fcDetectUserFiles
  StrCpy $fcHasUserFiles "0"
  ${ForEach} $R7 1 3 + 1
    ${If} $R7 == 1
      StrCpy $R5 "$INSTDIR\data\projects"
    ${ElseIf} $R7 == 2
      StrCpy $R5 "$INSTDIR\data\media"
    ${Else}
      StrCpy $R5 "$INSTDIR\data\templates"
    ${EndIf}
    Call un.fcHasFiles
    ${If} $R6 == "1"
      StrCpy $fcHasUserFiles "1"
    ${EndIf}
  ${Next}
FunctionEnd

!macro customUnInit
  StrCpy $fcUpdated "0"
  ${If} ${isUpdated}
    StrCpy $fcUpdated "1"
  ${EndIf}
  StrCpy $fcComplete "0"
  StrCpy $fcDeleteUser "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--complete" $R1
  ${IfNot} ${Errors}
    StrCpy $fcComplete "1"
    ClearErrors
    ${GetOptions} $R0 "--delete-projects" $R1
    ${IfNot} ${Errors}
      StrCpy $fcDeleteUser "1"
    ${EndIf}
  ${EndIf}
  ClearErrors
!macroend

Function un.fcModePre
  ${If} $fcUpdated == "1"
    Abort
  ${EndIf}
  Call un.fcDetectUserFiles
  !insertmacro MUI_HEADER_TEXT "Uninstall ${PRODUCT_NAME}" "Choose what to remove from $INSTDIR"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "&Standard uninstall"
  Pop $fcRadioStandard
  ${NSD_CreateLabel} 12u 13u -12u 34u "Removes the app, its AI models and engines, settings, caches and Windows shortcuts. Your projects, recordings and downloaded library media in $INSTDIR\data are kept."
  Pop $0
  ${NSD_CreateRadioButton} 0 52u 100% 12u "&Complete removal"
  Pop $fcRadioComplete
  ${NSD_CreateLabel} 12u 65u -12u 34u "Removes everything FrameCut manages in $INSTDIR. If projects or media are stored there, you'll be asked separately before they are deleted."
  Pop $0
  ${NSD_CreateLabel} 0 104u 100% 30u "Projects stored in other folders, your original media and exported videos are never touched."
  Pop $0
  ${NSD_Check} $fcRadioStandard
  nsDialogs::Show
FunctionEnd

Function un.fcModeLeave
  ${NSD_GetState} $fcRadioComplete $0
  StrCpy $fcComplete "0"
  StrCpy $fcDeleteUser "0"
  ${If} $0 == ${BST_CHECKED}
    StrCpy $fcComplete "1"
    ${If} $fcHasUserFiles == "1"
      MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also delete your projects, recordings and downloaded library media?$\r$\n$\r$\nThey are stored in:$\r$\n$INSTDIR\data$\r$\n$\r$\nYes: permanently delete them as well. This cannot be undone.$\r$\nNo: keep them and remove everything else." IDYES fcYes IDNO fcNo
      Abort
      fcYes:
        StrCpy $fcDeleteUser "1"
      fcNo:
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customUnWelcomePage
  UninstPage custom un.fcModePre un.fcModeLeave
!macroend

; Remove file or folder $R5, retrying for up to ~5 s while it is busy (antivirus scans of freshly written
; files, a process still exiting). Folders go through cmd's rd with a \\?\ path as well, because the
; Python and PyTorch trees run past the classic 260-character limit that RMDir can't handle.
; $R6 = "1": leave anything still locked for removal at the next restart. Sets the error flag if $R5 remains.
Function un.fcRemovePath
  StrCpy $R7 0
  fcTry:
  ${If} ${FileExists} "$R5\*.*"
    RMDir /r "$R5"
    ${If} ${FileExists} "$R5\*.*"
      nsExec::Exec '"$SYSDIR\cmd.exe" /c rd /s /q "\\?\$R5"'
      Pop $R8
    ${EndIf}
  ${ElseIf} ${FileExists} "$R5"
    Delete "$R5"
  ${EndIf}
  ClearErrors
  ${If} ${FileExists} "$R5"
    IntOp $R7 $R7 + 1
    ${If} $R7 < 10
      Sleep 500
      Goto fcTry
    ${EndIf}
    ${If} $R6 == "1"
      RMDir /r /REBOOTOK "$R5"
      Delete /REBOOTOK "$R5"
    ${EndIf}
    SetErrors
  ${EndIf}
FunctionEnd

!macro FC_REMOVE ITEM
  StrCpy $R5 "$INSTDIR\${ITEM}"
  StrCpy $R6 "1"
  Call un.fcRemovePath
!macroend

Function un.fcRemoveAppFiles
  ; Everything at the top level except data\ (and, during an update, the running uninstaller).
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  ${DoWhile} $R1 != ""
    ${If} $R1 != "."
    ${AndIf} $R1 != ".."
    ${AndIf} $R1 != "data"
      ${If} $fcUpdated == "1"
        ${If} $R1 != "Uninstall ${PRODUCT_FILENAME}.exe"
          StrCpy $R5 "$INSTDIR\$R1"
          StrCpy $R6 "0"
          Call un.fcRemovePath
          ${If} ${Errors}
            FindClose $R0
            Abort "FrameCut Studio is still in use ($INSTDIR\$R1). Close it and run the installer again."
          ${EndIf}
        ${EndIf}
      ${Else}
        !insertmacro FC_REMOVE "$R1"
      ${EndIf}
    ${EndIf}
    FindNext $R0 $R1
  ${Loop}
  FindClose $R0
FunctionEnd

!macro customRemoveFiles
  SetOutPath $TEMP
  Call un.fcRemoveAppFiles
  ${If} $fcUpdated != "1"
    ; Settings, models and engines, caches, logs and temp files: always removed on uninstall.
    !insertmacro FC_REMOVE "data\profile"
    !insertmacro FC_REMOVE "data\engines"
    !insertmacro FC_REMOVE "data\cache"
    !insertmacro FC_REMOVE "data\temp"
    !insertmacro FC_REMOVE "data\logs"
    !insertmacro FC_REMOVE "data\preferences.json"
    !insertmacro FC_REMOVE "data\framecut-config.json"
    !insertmacro FC_REMOVE "data\README.txt"
    ; Leftover installer copy from electron-builder (see fcDropInstallerCopy), if any.
    Delete "$LOCALAPPDATA\framecut-studio-updater\installer.exe"
    RMDir "$LOCALAPPDATA\framecut-studio-updater"
    Delete "$INSTDIR\data\*.tmp"
    ${If} $fcDeleteUser == "1"
      DetailPrint "Removing projects and media in $INSTDIR\data"
      !insertmacro FC_REMOVE "data"
    ${Else}
      ; With no projects, media or templates left, the remaining index files and imported fonts/LUTs
      ; have nothing to serve, so they go too.
      Call un.fcDetectUserFiles
      ${If} $fcHasUserFiles == "0"
        !insertmacro FC_REMOVE "data"
      ${EndIf}
    ${EndIf}
    RMDir "$INSTDIR\data"
    RMDir "$INSTDIR"
    ${If} ${FileExists} "$INSTDIR\data\*.*"
      DetailPrint "Kept your projects and media in $INSTDIR\data"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION "Your projects, recordings and library media were kept in:$\r$\n$INSTDIR\data$\r$\n$\r$\nReinstall FrameCut Studio into the same folder to keep using them, or delete that folder yourself when you no longer need it."
      ${EndIf}
    ${EndIf}
    ${If} ${RebootFlag}
      DetailPrint "Some files were in use and will be removed when Windows restarts."
    ${EndIf}
  ${EndIf}
!macroend
!endif
