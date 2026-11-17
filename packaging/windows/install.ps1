param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\DSH Remote')
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot

$target = [Environment]::ExpandEnvironmentVariables($InstallDir).Trim()
if ([string]::IsNullOrWhiteSpace($target)) {
  throw '安装路径不能为空。'
}
if (-not [IO.Path]::IsPathRooted($target)) {
  $target = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $target
}
$target = [IO.Path]::GetFullPath($target).TrimEnd('\')

$pathRoot = [IO.Path]::GetPathRoot($target).TrimEnd('\')
if ($target -eq $pathRoot) {
  throw '不能直接安装到磁盘根目录，请选择一个子目录。'
}
$systemRoot = [IO.Path]::GetFullPath($env:SystemRoot).TrimEnd('\')
if ($target.StartsWith($systemRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw '不能安装到 Windows 系统目录，请选择当前用户可写的目录。'
}
foreach ($programFiles in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
  if ($programFiles -and $target.StartsWith(
      [IO.Path]::GetFullPath($programFiles).TrimEnd('\') + '\',
      [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Program Files 需要管理员权限，请选择当前用户可写目录（例如 LocalAppData 或 D:\Apps）。'
  }
}
if ($target.Equals([IO.Path]::GetFullPath($source).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
  throw '安装目录不能与当前解压目录相同，请换一个目录。'
}

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

if (-not (Test-Path $appExe)) {
  throw "安装文件不完整：找不到 $appExe"
}

Write-Host 'Installed. Launching DSH Remote...'
try {
  Start-Process -FilePath $appExe -ArgumentList '--no-sandbox' -WorkingDirectory $target
} catch {
  Write-Warning "安装已完成，但自动启动失败：$($_.Exception.Message)。请从开始菜单或桌面快捷方式启动。"
}