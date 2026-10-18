!macro customPageAfterChangeDir
  Page custom AppInstallSummary
  Function AppInstallSummary
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      !insertmacro MUI_HEADER_TEXT "Upgrade" "An existing installation was found in the selected folder."
      ${NSD_CreateLabel} 0 10u 100% 60u "Upgrade Data Generator && File Processing to ${VERSION}. Your saved application settings will be retained."
      Pop $0
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:Upgrade"
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Install" "Set up Data Generator && File Processing on this computer."
      ${NSD_CreateLabel} 0 10u 100% 60u "Install Data Generator && File Processing ${VERSION} in the selected folder."
      Pop $0
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"
    ${EndIf}
    nsDialogs::Show
  FunctionEnd
!macroend
