; The assisted installer shows an install-mode page unless we force the
; current-user mode. Forcing it skips that page and goes straight to the
; directory picker; the app is always per-user (no elevation).
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  ; Some Windows corporate/insider environments terminate Electron's Chromium
  ; sandbox before app startup. The installed shortcuts therefore pass
  ; --no-sandbox explicitly. Remote DSH pages still run without Node, preload
  ; or local IPC.
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "--no-sandbox" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}

  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "--no-sandbox" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
!macroend