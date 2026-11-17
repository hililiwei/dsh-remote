@echo off
chcp 65001 >nul
setlocal
set "DEFAULT=%LOCALAPPDATA%\Programs\DSH Remote"
set "TARGET="
set /p "TARGET=安装路径（直接回车使用默认 %DEFAULT%）: "
set "TARGET=%TARGET:"=%"
if not defined TARGET set "TARGET=%DEFAULT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -InstallDir "%TARGET%"
if errorlevel 1 (
  echo.
  echo Installation failed. See the messages above.
  pause
)
endlocal