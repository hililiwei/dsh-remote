# DSH Remote — Electron 跨端桌面客户端设计

**日期：** 2026-11-17  
**状态：** 已由用户确认方向（Electron、Windows + macOS、macOS 接受未签名包），进入实现  
**目标仓库：** `D:\code\deepseekUI`

## 1. 意图与背景

用户已经在远程服务器上运行 `dsh web`，目前通过浏览器访问。浏览器标签页不够像桌面软件，用户希望有一个安装后可直接打开的客户端，能够保存和切换多个远程 DSH 后端，体验接近 OpenCode Desktop。用户同时使用 Windows 和 macOS，因此不能采用 Windows 专属的 WPF/WebView2 方案。

本客户端不复制 DSH 前端，也不在本地启动 DSH 后端；它只负责：

1. 管理远程服务器连接配置；
2. 首次连接时接收 `dsh web` 启动打印的带 token URL；
3. 用持久 cookie 保持登录态；
4. 在主窗口的多个标签页中加载远程 DSH Web UI；
5. 提供桌面壳应有的菜单、托盘、窗口记忆、下载/外链/证书/代理处理；
6. 产出 Windows 安装包和可构建的 macOS 未签名包。

## 2. 已确认的现状

- 官方 DeepSeek Harness Desktop 已安装在 `D:\Programs\DeepSeek Harness`（0.2.2-rc.1），但它的 Electron 主进程会启动本地 `dsh` Host，且与其他 DSH 实例互斥；没有远程地址配置。因此不能通过修改官方 Desktop 配置实现需求。
- `dsh web` 启动时打印形如 `dsh web: https://host/?token=...` 的 URL。该 token 是进程启动令牌，只用于换取签名 cookie；cookie 的签名密钥持久化，默认有效期以天计。因此客户端只需在首次/失效时接收 token URL，之后依赖持久 cookie。
- 远程访问受 Host/Origin fence、反向代理、TLS 和公司代理影响。用户机器上存在 `公司代理`，`ProxyOverride` 已覆盖 `127.0.0.1`、`10.*` 等内网地址。
- 用户机器有 .NET 9 和 WebView2，但跨端要求排除 WPF。
- 这台机器只能构建和验证 Windows 产物；macOS 产物需要 macOS 或 CI，且不做签名/公证。

## 3. 目标、非目标、反目标

### 目标

- Windows 10/11 x64 安装后可从开始菜单/桌面启动。
- macOS（Intel + Apple Silicon，universal）可构建未签名 DMG/zip；首次打开按 Gatekeeper 常规方式放行。
- 多个服务器配置：新增、编辑、删除、设默认、测试连通。
- 首次连接支持粘贴带 token 的 `dsh web:` URL；解析后只保存干净的 base URL，不保存 token。
- 连接成功后 cookie 持久化；同一服务器重启客户端一般无需再次粘贴 token。
- 登录态失效（HTTP 401）时给出明确的重连入口。
- 主窗口直接加载远程 DSH UI，不复制前端资源，不绑定 DSH 版本。
- 桌面体验：单主窗口多标签页、菜单、托盘、窗口位置记忆、单实例、外链走系统浏览器、下载可用。
- 每个服务器隔离 session/cookie；支持系统代理/直连切换；支持显式信任自签名证书。

### 非目标

- 不在客户端内启动、安装或管理本地 DSH 后端。
- 不实现 DSH 的账号体系、密码登录或 token 刷新协议。
- 不内置 SSH 隧道、VPN 或反向代理。
- v1 不做自动更新、代码签名、公证、Mac App Store 分发。
- 不支持 Linux。
- 不实现 DSH 前端的任何定制或注入。

### 反目标

- 为了“跨端”引入两套 UI 代码或两套业务逻辑。
- 把远程页面放进带 Node 权限的 renderer，或给远程页面暴露 IPC bridge。
- 在配置文件、日志、窗口标题中保存或展示启动 token。
- 依赖 DSH 的具体版本或打包其前端资源。

## 4. 方案比较

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| WPF + WebView2 | 原生、体积小、启动快 | 仅 Windows，直接违背跨端要求 | 排除 |
| Tauri 2 | 体积最小，系统 WebView | 当前机器无 Rust/MSVC；macOS 需 Xcode；session/证书/代理/下载 API 需要 Rust 封装 | 不选 |
| .NET MAUI / Avalonia | C# 一套代码 | macOS WebView 集成和打包不成熟；仍需 Mac 构建 | 不选 |
| Electron + TS + React | 一套代码两端打包；session/cookie/证书/代理/下载 API 成熟；官方 Desktop 同技术；Windows 可完整验证 | 安装体积大（约 250MB）；macOS 仍需 Mac/CI 构建 | **选用** |

## 5. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Electron main process (Node)                                │
│  - app lifecycle / single instance / menus / tray           │
│  - server config store (JSON, atomic write)                 │
│  - Session per server (persist:dsh-remote-<id>)             │
│  - BrowserWindow manager / auth / remote server windows     │
│  - certificate, proxy, permissions, downloads, external URL │
└───────────────┬─────────────────────────────┬───────────────┘
                │ IPC (validated)             │ loadURL
┌───────────────▼──────────────┐   ┌──────────▼───────────────┐
│ Local renderer (React)       │   │ Remote DSH Web UI        │
│ manager + auth windows       │   │ no preload, no Node      │
│ contextIsolation + sandbox   │   │ persistent cookie        │
└──────────────────────────────┘   └──────────────────────────┘
```

### 5.1 进程与窗口

- **Manager window**：本地 React 页面，负责服务器列表、表单、设置、首次引导。`preload` 通过 `contextBridge` 暴露最小 API；`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- **Auth window**：复用同一个 renderer，通过 `?view=auth&serverId=...&reason=...` 进入认证视图。提交后由 main 校验并连接。
- **Tab shell**：一个 `BrowserWindow` 承载本地 Tab 栏；每个服务器对应一个 `WebContentsView`（`loadURL(baseUrl)`），无 preload、无 Node、`sandbox: true`。远程页面不能访问任何本地能力。
  - Tab 栏是 shell 自己的本地 renderer（`?view=tabs`），remote view 从 `TAB_BAR_HEIGHT`（44px）以下布局。
  - `TabManager` 管理 tab 顺序、active、状态、session、401/认证和持久化的 `openTabs` / `activeTabId`。
  - 关闭最后一个 tab 时显示服务器管理窗口；菜单/托盘切换 tab；`Ctrl/Cmd+T/W/1..9` 为标签快捷键。
- **Tray**：服务器管理入口、服务器列表、退出。macOS 使用 template image。

### 5.2 服务器配置

存储于 `app.getPath('userData')/servers.json`，原子写入。

```ts
type ProxyMode = 'system' | 'direct'

interface ServerProfile {
  id: string                 // crypto.randomUUID()
  name: string
  baseUrl: string            // 无 token，path 以 / 结尾
  proxyMode: ProxyMode
  allowInvalidCertificate: boolean
  createdAt: string
  lastUsedAt?: string
}

interface AppSettings {
  version: 1
  servers: ServerProfile[]
  defaultServerId?: string
  autoConnect: boolean       // 默认 true
  closeToTray: boolean       // 默认 false
  theme: 'system' | 'light' | 'dark'
  windowBounds: Record<string, WindowBounds>
}
```

- partition 由 id 派生：`persist:dsh-remote-<id>`；删除服务器时清理该 partition 的存储。
- 不保存 token；只在连接瞬间使用。

### 5.3 URL 与 token 规则

输入解析（`src/main/url-tools.ts`）：

- 只接受 `http:` / `https:`；拒绝 `file:`、`javascript:`、带用户名密码的 URL。
- 若含 `token` query 参数：
  - 提取 token；
  - 从 base URL 移除 `token` 和 hash；
  - 保留 origin + pathname，path 为空则 `/`，确保尾斜杠；
  - token 只用于构造一次性的 `${baseUrl}?token=${encodeURIComponent(token)}`。
- 若不含 token：视为普通 base URL，直接连接（依赖已有 cookie）。
- 日志、错误信息、窗口标题不得出现 token；统一用 `redactUrl()`。
- 认证 URL 的 host 必须与已保存服务器的 host 一致，否则拒绝，防止把 token 发到别的服务器。

DSH 的 token exchange 只在根路径 `/` 生效（`authorizeIndex` 要求 `url.pathname === "/"`）。因此 UI 提示用户使用反向代理剥离前缀后的根地址；若 base path 不是 `/`，仍允许保存但显示警告。

### 5.4 连接流程

1. 用户选择服务器，点击连接，或启动时自动连接默认服务器。
2. main 创建/复用 `session.fromPartition(partition)`，设置 proxy、权限、下载、证书策略。
3. 若有 token URL：`loadURL(tokenUrl)`；DSH 返回 303 + `Set-Cookie`，重定向到干净地址。
4. 无 token：`loadURL(baseUrl)`。
5. `did-navigate`：
   - HTTP 200：连接成功，更新 `lastUsedAt`，显示窗口。
   - HTTP 401：打开 Auth window，提示粘贴新的 `dsh web:` URL。
   - 其他 4xx/5xx：错误对话框，提供重试/在浏览器打开/编辑。
6. `did-fail-load`：按错误码提示；证书错误若未信任，提供“信任此服务器证书”入口。
7. 远程页面加载后，`session.webRequest.onCompleted` 监听 `/api` 的 401；去抖后打开 Auth window，成功后 `reload()`。

连接 Promise 在首个主框架 200/401/失败时 settle，供 Auth window 判断成功/失败。

### 5.5 认证与 cookie

- DSH 的启动 token 仅用于换取 cookie；cookie 存在对应 partition 中。
- 首次连接必须拿到一次 token URL。UI 说明：在远程服务器执行 `dsh web`，复制 `dsh web:` 那行完整 URL。
- token 不写盘、不写日志；如果用户粘贴的是带 token 的 URL 作为新服务器地址，保存时只保留 base URL。
- 服务器重启后 cookie 一般仍有效（签名密钥持久化）；若失效则显示 401 重连。客户端不尝试自动读取远程终端输出。
- 认证失败、token 缺失、host 不匹配分别给出明确中文错误。

### 5.6 代理与 TLS

- 每个服务器可设 `proxyMode`：
  - `system`：Chromium 使用系统代理（默认）；
  - `direct`：`session.setProxy({ mode: 'direct' })`，用于公司代理误拦内网地址的情况。
- 每个服务器可设 `allowInvalidCertificate`：
  - 默认 false；
  - 仅对该服务器 origin 的证书错误放行，并在 UI 显示风险提示；
  - 其他 origin 仍拒绝。
- 代理设置变更后 `closeAllConnections()` 并重新加载。
- 不支持客户端证书（v1 文档注明）。

### 5.7 安全边界

- 远程页面：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、无 preload、`webSecurity: true`。
- Windows 受管/Insider 环境的兼容例外：Electron 的 Chromium 沙箱可能在应用启动前被系统终止（`STATUS_BREAKPOINT`）。因此 Windows 快捷方式带 `--no-sandbox`。这只关闭 OS 级 Chromium 沙箱，不改变 Node/preload/IPC 边界；用户可在沙箱可用的机器上移除该参数。
- `setWindowOpenHandler`：同源/认证流程允许应用内子窗口并复用 partition；其他 `http(s)` 外链交给系统浏览器；其余协议拒绝。
- `will-navigate`：只允许 `http:`/`https:`；拒绝 `file:`、`javascript:`、`data:` 顶层导航。
- IPC：所有入参做类型和范围校验；不暴露任意 `shell`、`fs`、`exec`。
- 权限：只对已配置服务器的 origin 允许剪贴板、通知、麦克风；其他来源拒绝。麦克风首次请求用原生对话框确认。
- 下载：交给 Electron 默认下载流程，保存到系统下载目录；完成后通知。
- 证书：只按服务器配置放行，默认拒绝。
- 本地 renderer CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`。

### 5.8 桌面行为

- 单实例：第二次启动聚焦已有窗口；支持 `--server=<id>` 直接打开。
- 启动：有 `defaultServerId` 且 `autoConnect` 为 true 时直接打开默认服务器；否则显示 Manager。
- Manager 连接成功后隐藏；菜单/托盘可重新打开。
- 菜单：服务器列表（Cmd/Ctrl+1..9）、管理服务器、重载、在浏览器打开、缩放、全屏、开发者工具（dev）。
- 窗口位置/大小按服务器记忆，恢复前校验是否在可见屏幕内。
- 关闭最后一个窗口：Windows 默认退出（可设置关闭到托盘）；macOS 保持应用运行，Dock 点击重新打开 Manager。
- 托盘：管理服务器、服务器列表、退出。

## 6. 跨端打包

### Windows

- `electron-builder` + NSIS，one-click / per-user，无需管理员。
- 安装到 `%LOCALAPPDATA%\Programs\DSH Remote`。
- 开始菜单 + 桌面快捷方式；Apps & Features 可卸载。
- 未签名，SmartScreen 可能提示。
- 受管 Windows 环境可能拦截所有 NSIS 生成的 exe；额外提供 `win-unpacked` ZIP + `install.cmd`/`install.ps1`，不依赖 NSIS。

### macOS

- `electron-builder` 目标：`dmg` + `zip`，`universal`（x64 + arm64）。
- 不签名、不公证：`identity: null`、`hardenedRuntime: false`、`gatekeeperAssess: false`、`notarize: false`。
- 构建需在 macOS 或 GitHub Actions `macos-latest` 上执行；本仓库提供脚本和工作流。
- 安装说明：右键“打开”，或 `xattr -dr com.apple.quarantine "/Applications/DSH Remote.app"`。
- 若要后续签名，只需在 CI 注入 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` 等 secrets，不改代码。

### CI

`.github/workflows/build.yml`：

- `windows-latest`：`npm ci` → `npm run test:unit` → `npm run dist:win` → 上传 artifact。
- `macos-latest`：`npm ci` → `npm run test:unit` → `npm run dist:mac` → 上传 artifact。
- macOS 构建显式关闭签名自动发现，避免无证书失败。

## 7. 验收标准

### 功能

- [ ] 首次启动显示 Manager；可粘贴带 token 的 `dsh web:` URL 新增服务器。
- [ ] 保存后配置文件只含干净 base URL，不含 token。
- [ ] 首次连接完成 token exchange，远程 DSH UI 正常加载。
- [ ] 关闭并重启客户端（远程后端未重启）可直接进入，无需再次粘贴 token。
- [ ] 远程后端重启/ cookie 失效时显示 401 重连入口，可粘贴新 token URL 恢复。
- [ ] 可保存多个服务器，切换时 cookie 相互隔离。
- [ ] 可编辑、删除、设默认、测试连通；删除后对应 session 数据清理。
- [ ] 自签名证书默认拒绝；显式信任后仅该服务器放行。
- [ ] 系统代理/直连切换对目标服务器生效。
- [ ] 外部链接在系统浏览器打开；下载可用；窗口位置记忆；单实例生效。
- [ ] Windows NSIS 安装/卸载可用；macOS 构建脚本/CI 可产出未签名包。

### 质量

- [ ] URL/token 解析、配置存储、状态判断有单元测试，且都先失败后通过。
- [ ] 用假 DSH 服务器跑通“401 → token → cookie → 200”的 Electron 集成测试。
- [ ] 至少用一次真实 `dsh web` 做手工联调（本地临时端口）。
- [ ] `npm run test:unit`、`npm run build`、`npm run test:e2e` 全绿。
- [ ] Windows 安装包实际安装、启动、卸载验证。
- [ ] README 说明远程启动、token、反代/trusted-host、Mac 未签名安装。

## 8. 已做的决定（builder 可直接执行）

- 产品名：`DSH Remote`；包名 `dsh-remote`；appId `com.dshremote.app`。
- UI 语言：中文为主；技术名词保留英文。
- 技术栈：Electron 45、electron-vite 6、Vite 8、React 19、TypeScript 5、Vitest 5、Playwright 1.65、electron-builder 26。
- 不引入 UI 组件库；用 CSS 变量和手写组件，减少依赖和体积。
- 不使用 `electron-store`；自写 JSON 存储，便于测试和原子写。
- 不使用 `electron-updater`；v1 手动更新。
- 图标自制，不直接使用官方 DSH 商标资源。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 公司代理拦截远程/本地地址 | 每服务器 `direct` 模式；默认 system；文档说明 |
| 远程 DSH 在反向代理后 Host/Origin fence 拒绝 | 文档要求 `--public-url` + `--trusted-host`；客户端只加载用户已验证可用的 URL |
| 自签名证书 | 显式 per-server 信任开关；默认拒绝 |
| cookie 失效后无法自动取新 token | 明确 401 重连流程；未来可加 SSH/命令抓取 |
| macOS 无签名被 Gatekeeper 拦截 | 文档给出右键打开/xattr；CI 预留签名 secrets |
| Electron 包体积大 | 接受；相比跨端维护成本更划算 |
| 远程页面本身要求浏览器特性 | Electron Chromium 与官方 Desktop 同源，兼容性风险低 |
| token 泄漏 | 不落盘、不写日志、不显示；错误信息统一 redact |

## 10. 后续可扩展（不在 v1）

- 自动更新（electron-updater）。
- macOS 签名/公证。
- 通过 SSH 命令自动获取启动 URL。
- 每个服务器的自定义请求头/客户端证书。
- 多窗口平铺/标签页。
- 服务器分组、搜索、导入导出配置。
