import { app, Menu, nativeImage, Tray } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { ConfigStore } from './config-store'
import { logInfo, logWarn } from './logger'
import { showManager } from './manager-window'
import { trayIconFile } from './paths'
import type { TabManager } from './tab-manager'
import type { PetManager } from './pet/pet-manager'

export interface TrayDeps {
  store: ConfigStore
  tabs: TabManager
  pet: PetManager
}

let tray: Tray | null = null

function showApp(deps: TrayDeps): void {
  if (deps.tabs.hasTabs()) deps.tabs.show()
  else showManager()
}

function buildMenu(deps: TrayDeps): Menu {
  const servers = deps.store.getSettings().servers
  return Menu.buildFromTemplate([
    {
      label: '打开 DSH Remote',
      click: () => showApp(deps)
    },
    {
      label: '服务器管理',
      click: () => showManager()
    },
    {
      label: '显示桌面宠物',
      type: 'checkbox',
      checked: deps.store.getSettings().pet.enabled,
      click: () => {
        void deps.pet.toggle()
      }
    },
    { type: 'separator' },
    ...(servers.length > 0
      ? servers.map((server) => ({
          label: server.name,
          click: () => {
            void deps.tabs.open(server).catch(() => undefined)
          }
        }))
      : [{ label: '还没有服务器', enabled: false }]),
    { type: 'separator' },
    {
      label: '退出 DSH Remote',
      click: () => app.quit()
    }
  ])
}

export function setupTray(deps: TrayDeps): void {
  if (tray) return
  const image = nativeImage.createFromPath(trayIconFile())
  if (image.isEmpty()) {
    logWarn(`Tray icon missing at ${trayIconFile()}`)
  } else if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  try {
    tray = new Tray(image)
  } catch (error) {
    logWarn(`Tray unavailable: ${String(error)}`)
    return
  }

  tray.setToolTip(APP_NAME)
  tray.setContextMenu(buildMenu(deps))
  if (process.platform !== 'darwin') {
    tray.on('click', () => showApp(deps))
    tray.on('double-click', () => showApp(deps))
  }
  logInfo('Tray ready')
}

export function refreshTray(deps: TrayDeps): void {
  if (!tray || tray.isDestroyed()) return
  tray.setContextMenu(buildMenu(deps))
}

export function isTrayReady(): boolean {
  return Boolean(tray && !tray.isDestroyed())
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}