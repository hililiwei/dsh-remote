import { app, BrowserWindow, nativeTheme } from 'electron'
import { APP_ID, APP_NAME } from '../shared/constants'
import type { ThemeMode } from '../shared/types'
import { closeAllAuthWindows } from './auth-window'
import { ConfigStore } from './config-store'
import { installMenu } from './menu'
import { registerIpc } from './ipc'
import { initLogger, logError, logInfo, logWarn } from './logger'
import { initManagerWindow, showManager } from './manager-window'
import {
  applyUserDataOverride,
  appIconFile,
  configFile,
  logFile
} from './paths'
import { configureAppSecurity } from './security'
import { ServerWindowManager } from './server-window'
import { SessionManager } from './session-manager'
import { destroyTray, isTrayReady, refreshTray, setupTray } from './tray'

applyUserDataOverride()
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)



let store: ConfigStore | null = null
let sessions: SessionManager | null = null
let serverWindows: ServerWindowManager | null = null
let isQuitting = false

function applyTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
}

function requestedServerId(argv: string[]): string | undefined {
  const prefix = '--server='
  const match = argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length).trim() || undefined : undefined
}

async function openRequestedServer(id: string): Promise<void> {
  if (!store || !serverWindows) return
  const server = store.getServer(id)
  if (!server) {
    showManager()
    return
  }
  await serverWindows.open(server)
}

function afterServersChanged(): void {
  if (!store || !serverWindows) return
  const deps = { store, serverWindows }
  installMenu(deps)
  refreshTray(deps)
}

async function bootstrap(): Promise<void> {
  initLogger(logFile())
  logInfo(`${APP_NAME} ${app.getVersion()} starting on ${process.platform}`)

  store = new ConfigStore(configFile())
  await store.load()
  applyTheme(store.getSettings().theme)

  sessions = new SessionManager()
  serverWindows = new ServerWindowManager({
    store,
    sessions,
    onServersChanged: afterServersChanged
  })
  initManagerWindow(store)
  configureAppSecurity(store, afterServersChanged)

  const deps = { store, serverWindows }
  setupTray(deps)
  installMenu(deps)
  registerIpc({
    store,
    sessions,
    serverWindows,
    applyTheme,
    refreshMenu: () => installMenu(deps),
    refreshTray: () => refreshTray(deps)
  })

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'DSH Remote — a remote DeepSeek Harness desktop shell'
  })

  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID)
  }

  const settings = store.getSettings()
  const requested = requestedServerId(process.argv)
  if (requested) {
    await openRequestedServer(requested).catch((error) => {
      logError('Failed to open requested server', error)
    })
    return
  }

  if (settings.autoConnect && settings.defaultServerId) {
    const server = store.getServer(settings.defaultServerId)
    if (server) {
      try {
        await serverWindows.open(server)
        return
      } catch (error) {
        logWarn(`Auto-connect failed: ${String(error)}`)
        showManager()
        return
      }
    }
  }

  showManager()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    void app.whenReady().then(async () => {
      const requested = requestedServerId(argv)
      if (requested) {
        await openRequestedServer(requested).catch((error) => {
          logError('Failed to open second-instance server', error)
        })
        return
      }
      const target = BrowserWindow.getAllWindows().find((win) => win.isVisible())
      if (target) {
        if (target.isMinimized()) target.restore()
        target.show()
        target.focus()
      } else {
        showManager()
      }
    })
  })

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
    if (windows.length === 0) {
      showManager()
      return
    }
    const visible = windows.find((win) => win.isVisible())
    if (visible) {
      visible.focus()
    } else {
      showManager()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    closeAllAuthWindows()
    serverWindows?.closeAll()
  })

  app.on('will-quit', () => {
    destroyTray()
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    if (!isQuitting && store?.getSettings().closeToTray && isTrayReady()) return
    app.quit()
  })

  process.on('uncaughtException', (error) => {
    logError('Uncaught exception', error)
  })
  process.on('unhandledRejection', (reason) => {
    logError('Unhandled rejection', reason)
  })

  void app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      logError('Application bootstrap failed', error)
      app.quit()
    })

  // Keep the icon association available to Windows even before a window exists.
  void appIconFile()
}