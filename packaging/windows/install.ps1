$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $env:LOCALAPPDATA 'Programs\DSH Remote'
$appExe = Join-Path $target 'DSH Remote.exe'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH Remote.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Remote.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DSHRemote'

Write-Host 'Installing DSH Remote to' $target

Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($target, [StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -Path $source -Force |
  Where-Object { $_.Name -notin @('install.cmd', 'install.ps1', 'README.txt') } |
  Copy-Item -Destination $target -Recurse -Force

$shell = New-Object -ComObject WScript.Shell
foreach ($linkPath in @($startMenu, $desktop)) {
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = $appExe
  $link.Arguments = '--no-sandbox'
  $link.WorkingDirectory = $target
  $link.IconLocation = "$appExe,0"
  $link.Description = 'DSH Remote - remote DeepSeek Harness client'
  $link.Save()
}

$uninstallScript = Join-Path $target 'uninstall.ps1'
@'
$ErrorActionPreference = 'SilentlyContinue'
$target = $PSScriptRoot
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH Remote.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Remote.lnk'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DSHRemote'
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($target, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
Start-Sleep -Milliseconds 500
Remove-Item -Force $startMenu, $desktop -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $uninstallKey -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$target`""
'@ | Set-Content -Path $uninstallScript -Encoding UTF8

New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name DisplayName -Value 'DSH Remote'
Set-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value '0.1.0'
Set-ItemProperty -Path $uninstallKey -Name Publisher -Value 'DSH Remote'
Set-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $target
Set-ItemProperty -Path $uninstallKey -Name DisplayIcon -Value $appExe
Set-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallScript`""
Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -Type DWord

Write-Host 'Installed. Launching DSH Remote...'
Start-Process -FilePath $appExe -ArgumentList '--no-sandbox' -WorkingDirectory $target