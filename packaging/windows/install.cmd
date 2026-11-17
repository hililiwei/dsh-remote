@echo off
setlocal
powershell -noProfile -Sta -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed or was cancelled. See the message above.
  pause
)
endlocal