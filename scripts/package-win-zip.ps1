$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'dist\win-unpacked'
$zipPath = Join-Path $root 'dist\DSH-Remote-0.1.0-win-x64-portable.zip'

if (-not (Test-Path (Join-Path $appDir 'DSH Remote.exe'))) {
  throw "dist\win-unpacked\DSH Remote.exe not found. Run 'npm run dist:win' first."
}

$payload = Join-Path $root 'packaging\windows'
Copy-Item -Path (Join-Path $payload '*') -Destination $appDir -Force

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Write-Host 'Creating' $zipPath
Compress-Archive -Path (Join-Path $appDir '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Host 'Created' $zipPath