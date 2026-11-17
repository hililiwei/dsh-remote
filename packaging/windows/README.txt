DSH Remote — Windows 便携包
============================

这个目录是 DSH Remote 的完整 Windows 应用，不需要 NSIS 安装器。

安装（当前用户，无需管理员）：
  安装前会自动检测并移除旧的 DSH Remote（包括 NSIS 安装的版本），
  保留 %APPDATA%\DSH Remote 中的服务器配置和登录 cookie。
  双击 install.cmd，会弹出输入框让你确认/修改安装路径（默认已填好）
  或：
  powershell -NoProfile -Sta -ExecutionPolicy Bypass -File install.ps1
  powershell -NoProfile -Sta -ExecutionPolicy Bypass -File install.ps1 -InstallDir "D:\Apps\DSH Remote"

默认安装位置：%LOCALAPPDATA%\Programs\DSH Remote
会创建开始菜单和桌面快捷方式，并在“设置 → 应用”里注册卸载项。
安装路径不能是磁盘根目录、Windows 系统目录或 Program Files（需要管理员权限）。

直接运行：
  "DSH Remote.exe" --no-sandbox

注意：当前企业 Windows 环境可能阻止 NSIS 安装器/便携包，此时用本目录的
install.cmd 安装。快捷方式已带 --no-sandbox；直接双击 exe 时如遇启动失败，
请从快捷方式启动或手动加 --no-sandbox。