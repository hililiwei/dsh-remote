# DSH Remote 无页面多服务器宠物设计

**日期：** 2026-11-25  
**状态：** 用户已确认采用 headless client 方案，开始实现  
**目标仓库：** `D:\code\deepseekUI`

## 1. 意图与背景

用户希望在 DSH Remote 中看到一个常驻的桌面宠物，它汇总多个远程 DSH 服务器的任务状态：

- 哪些对话正在运行；
- 哪些对话跑完但用户还没看；
- 哪些对话在等用户确认。

早期方案是在 DSH 页面右下角渲染宠物；页面被 DSH Remote 切走后宠物就消失，也无法覆盖在其他应用窗口之上。

用户明确要求：

- 不加载 DSH 页面；
- 不改远程 DSH、不新增远程接口；
- 宠物切换标签/窗口时不消失；
- 宠物始终在最前面，不被其他窗口遮挡。

## 2. 方案

DSH Remote 作为 DSH 的另一个**无页面客户端**，复用每个远程 `dsh web` 已有的认证连接和 Remote 方法：

- `/connect?token=...&interactions=answer` 不在客户端运行；客户端使用 DSH Remote 已保存的服务器 cookie。
- `/api/remote.mux` WebSocket 与 `/api` HTTP RPC 是现有通道，不新增 endpoint。
- 用 DSH 已发布的 client 包挂一个最小 Cordis 客户端树：
  - `@deepseek-ai/dsh-client-connection/client`
  - `@deepseek-ai/dsh-typert-registry/client`
  - `@deepseek-ai/dsh-api-gateway/client`
  - `@deepseek-ai/dsh-api-session-controller/remote`
  - `@deepseek-ai/dsh-api-workspace-controller/remote`
- 调用现有方法：
  - `session.list({})` 获取会话、标题、`running`、`blank`、`origin`、`projections.userQuestions`；
  - `workspace.follow()` 获取工作区基线和增量；
  - 每 3 秒刷新一次 `session.list`，工作区流负责实时导航变化。
- 客户端在 DSH Remote 主进程运行，按服务器聚合为统一快照，发送给独立的宠物窗口。

## 3. 宠物窗口

- Electron `BrowserWindow`：透明、无边框、`alwaysOnTop: true`、`skipTaskbar: true`、`hasShadow: false`、固定小尺寸。
- 独立于标签页生命周期；切换服务器标签不会影响它。
- 默认放在主显示器工作区右下角；位置保存在 `windowBounds.pet`。
- 宠物本体、气泡、卡片使用独立的本地渲染页（不依赖 DSH 页面）。
- 点击宠物展开/收起卡片；卡片按服务器分组显示会话状态；点击会话行先聚焦对应服务器标签页。
- 托盘和应用菜单提供“显示桌面宠物”开关；设置页提供“显示桌面宠物”和“始终置顶”。

## 4. 状态语义

- `running`：`session.list` 行的 `running === true`。
- `needs-you`：`projections.userQuestions.active` 非空，或 `projections.plan.pending === true`。
- `done`：本地观察到该会话 `running` 从 true 变为 false，且用户尚未打开对应服务器；用户激活该服务器标签后清除。
- `idle`：其余。
- 过滤 `blank`、`origin === 'subagent'`、已归档会话。
- 按 `needs-you > running > done > idle` 排序；同一状态按 `updatedAt` 降序。

## 5. 非目标

- 不修改远程 DSH profile、不新增 Remote/HTTP 方法。
- 不实现客户端证书、SSH 隧道、VPN。
- 不在宠物窗口内加载远程页面。
- v1 不实现拖拽移动、会话级深度跳转、点击穿透；位置固定右下角，点击行只聚焦对应服务器。
- 不把 cookie 写入日志或渲染进程。

## 6. 风险与回退

- client 包是 DSH 预发布内部协议，无版本协商。锁定 `0.2.2-rc.5`，只使用 `session.list`/`workspace.follow` 两个稳定面；协议失败时该服务器在宠物中显示离线，不影响主窗口。
- WebSocket 直连；系统代理只由 HTTP `net.fetch` 使用。v1 对需要代理的 WebSocket 服务器可能离线，后续加代理 agent。
- 如果 headless 方案在某个服务器上不可用，保留“只聚焦标签页”的降级，不阻塞主功能。

## 7. 验证

- 单元测试：聚合状态、排序、计数、完成标记、工作区映射。
- 集成验证：用测试 DSH 服务器 token 换取 cookie，headless client 能返回 `session.list` 和 `workspace.follow`；已在 3099 测试服务器验证通过。
- 桌面验证：启动 DSH Remote，宠物窗口出现在右下角，切换标签不消失，覆盖在其他应用窗口之上。