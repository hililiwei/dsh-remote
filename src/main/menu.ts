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
import type { TabManager } from './tab-manager'

export interface MenuDeps {
  store: ConfigStore
  tabs: TabManager
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
    void deps.tabs.open(server).catch((error) => {
      logError(`Menu failed to open server ${id}`, error)
    })
  }

  const serverItems: MenuItemConstructorOptions[] = settings.servers.map((server) => ({
    label: server.name,
    click: () => openServer(server.id)
  }))

  const currentServerId = (): string | undefined => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused || focused !== deps.tabs.getShellWindow()) return undefined
    return deps.tabs.activeServerId()
  }

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
          label: '新建标签页…',
          accelerator: 'CmdOrCtrl+T',
          click: () => deps.tabs.showAddMenu()
        },
        {
          label: '关闭当前标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const id = currentServerId()
            if (id) deps.tabs.close(id)
          }
        },
        { type: 'separator' },
        {
          label: '服务器管理…',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => showManager()
        },
        { type: 'separator' },
        ...(serverItems.length > 0 ? serverItems : [{ label: '还没有服务器', enabled: false }]),
        { type: 'separator' },
        {
          label: '在浏览器中打开当前标签页',
          click: () => {
            const id = currentServerId()
            if (id) deps.tabs.openInBrowser(id)
          }
        },
        {
          label: '重新加载当前标签页',
          accelerator: 'CmdOrCtrl+R',
          click: () => deps.tabs.reloadActive()
        },
        {
          label: '清除当前标签页登录状态…',
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
            deps.tabs.reload(server.id)
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
        {
          label: '重新加载当前标签页',
          accelerator: 'CmdOrCtrl+R',
          click: () => deps.tabs.reloadActive()
        },
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
          : [])
      ]
    },
    {
      label: '帮助',
      submenu: [{ label: '使用说明', click: () => helpDialog() }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}