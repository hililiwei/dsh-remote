$ErrorActionPreference = 'SilentlyContinue'

# This helper is embedded in the NSIS setup. It removes a previous DSH Remote
# installed by the ZIP install script; NSIS installations are left to
# electron-builder's own uninstallOldVersion logic.
$roots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH Remote.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Remote.lnk'

foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
    $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if ($props.DisplayName -notlike 'DSH Remote*') { continue }
    if ($props.UninstallString -notmatch 'uninstall\.ps1') { continue }

    $oldDir = $props.InstallLocation
    Write-Host "Removing previous DSH Remote install at $oldDir"
    if ($oldDir) {
      Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($oldDir, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 300
      if (Test-Path $oldDir) {
        Remove-Item -Recurse -Force $oldDir -ErrorAction SilentlyContinue
      }
    }
    Remove-Item -Recurse -Force $key.PSPath -ErrorAction SilentlyContinue
    Remove-Item -Force $startMenu, $desktop -ErrorAction SilentlyContinue
  }
}