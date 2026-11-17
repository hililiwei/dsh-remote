import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  type MenuItemConstructorOptions
} from 'electron'
import { APP_NAME } from '../shared/constants'
import type { ConfigStore } from './config-store'
import { logError } from './logger'
import { showManager } from './manager-window'
import { partitionFor } from './session-manager'
import type { ServerWindowManager } from './server-window'

export interface MenuDeps {
  store: ConfigStore
  serverWindows: ServerWindowManager
}

function focusedServerId(serverWindows: ServerWindowManager): string | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  return focused ? serverWindows.serverIdForWindow(focused) : undefined
}

function helpDialog(): void {
  void dialog.showMessageBox({
    type: 'info',
    title: APP_NAME,
    message: '连接远程 DeepSeek Harness',
    detail:
      '1. 在远程服务器启动 dsh web。\n2. 复制终端里 `dsh web:` 开头、带 token 的完整 URL。\n3. 在“服务器管理”中添加服务器并粘贴这个 URL。\n\n首次成功后客户端会保存登录 cookie；如果服务器重启后失效，重新粘贴新的启动 URL 即可。',
    buttons: ['知道了'],
    noLink: true
  })
}

export function installMenu(deps: MenuDeps): void {
  const isMac = process.platform === 'darwin'
  const settings = deps.store.getSettings()

  const openServer = (id: string): void => {
    const server = deps.store.getServer(id)
    if (!server) return
    void deps.serverWindows.open(server).catch((error) => {
      logError(`Menu failed to open server ${id}`, error)
    })
  }

  const serverItems: MenuItemConstructorOptions[] = settings.servers.map((server, index) => ({
    label: server.name,
    accelerator: index < 9 ? `CmdOrCtrl+${index + 1}` : undefined,
    click: () => openServer(server.id)
  }))

  const currentServerId = (): string | undefined => focusedServerId(deps.serverWindows)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: '服务器管理…',
                accelerator: 'Cmd+,',
                click: () => showManager()
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: '服务器',
      submenu: [
        {
          label: '服务器管理…',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => showManager()
        },
        { type: 'separator' },
        ...(serverItems.length > 0 ? serverItems : [{ label: '还没有服务器', enabled: false }]),
        { type: 'separator' },
        {
          label: '在浏览器中打开当前服务器',
          click: () => {
            const id = currentServerId()
            if (id) deps.serverWindows.openInBrowser(id)
          }
        },
        {
          label: '重新加载当前服务器',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const id = currentServerId()
            if (id) deps.serverWindows.reload(id)
          }
        },
        {
          label: '清除当前服务器登录状态…',
          click: async () => {
            const id = currentServerId()
            if (!id) return
            const server = deps.store.getServer(id)
            if (!server) return
            const result = await dialog.showMessageBox({
              type: 'warning',
              title: APP_NAME,
              message: `清除 ${server.name} 的登录状态？`,
              detail: '这会删除该服务器的 cookie 和缓存，下次连接需要重新粘贴启动 URL。',
              buttons: ['清除', '取消'],
              defaultId: 1,
              cancelId: 1,
              noLink: true
            })
            if (result.response !== 0) return
            const target = session.fromPartition(partitionFor(server.id))
            await target.clearStorageData()
            await target.clearCache()
            await target.closeAllConnections()
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },
    {
      label: '帮助',
      submenu: [{ label: '使用说明', click: () => helpDialog() }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}