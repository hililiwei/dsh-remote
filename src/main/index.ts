import { app, nativeTheme } from 'electron'
import { APP_ID, APP_NAME } from '../shared/constants'
import type { ThemeMode } from '../shared/types'
import { closeAllAuthWindows } from './auth-window'
import { ConfigStore } from './config-store'
import { installMenu } from './menu'
import { registerIpc } from './ipc'
import { initLogger, logError, logInfo, logWarn } from './logger'
import { initManagerWindow, showManager } from './manager-window'
import { applyUserDataOverride, configFile, logFile } from './paths'
import { configureAppSecurity } from './security'
import { SessionManager } from './session-manager'
import { TabManager } from './tab-manager'
import { PetManager } from './pet/pet-manager'
import {
  ensurePetPackDir,
  registerPetPackProtocol,
  registerPetPackScheme,
  startPetPackWatcher
} from './pet/pet-pack'
import { destroyTray, isTrayReady, refreshTray, setupTray } from './tray'

applyUserDataOverride()
registerPetPackScheme()
app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

let store: ConfigStore | null = null
let sessions: SessionManager | null = null
let tabs: TabManager | null = null
let pet: PetManager | null = null
let stopPetPackWatcher: (() => void) | null = null
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
  if (!store || !tabs) return
  const server = store.getServer(id)
  if (!server) {
    showManager()
    return
  }
  await tabs.open(server)
}

function refreshChrome(): void {
  if (!store || !tabs || !pet) return
  const deps = { store, tabs, pet }
  installMenu(deps)
  refreshTray(deps)
}

function afterServersChanged(): void {
  refreshChrome()
}

async function bootstrap(): Promise<void> {
  initLogger(logFile())
  logInfo(`${APP_NAME} ${app.getVersion()} starting on ${process.platform}`)

  store = new ConfigStore(configFile())
  await store.load()
  applyTheme(store.getSettings().theme)

  sessions = new SessionManager()
  tabs = new TabManager({
    store,
    sessions,
    onServersChanged: afterServersChanged,
    onTabsChanged: () => pet?.handleTabsChanged()
  })
  pet = new PetManager({
    store,
    sessions,
    tabs,
    onChanged: refreshChrome
  })
  initManagerWindow(store)
  configureAppSecurity(store, afterServersChanged)

  const deps = { store, tabs, pet }
  setupTray(deps)
  installMenu(deps)
  registerIpc({
    store,
    sessions,
    tabs,
    pet,
    applyTheme,
    refreshMenu: () => installMenu(deps),
    refreshTray: () => refreshTray(deps)
  })
  ensurePetPackDir()
  registerPetPackProtocol()
  pet.start()
  stopPetPackWatcher = startPetPackWatcher(() => pet?.reloadPack())

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

  if (settings.autoConnect) {
    const saved = settings.openTabs
      .map((id) => store!.getServer(id))
      .filter((server): server is NonNullable<typeof server> => Boolean(server))
    const restored = saved.length > 0
    const toOpen = restored
      ? saved
      : settings.defaultServerId
        ? [store.getServer(settings.defaultServerId)].filter(
            (server): server is NonNullable<typeof server> => Boolean(server)
          )
        : []

    if (toOpen.length > 0) {
      try {
        await Promise.all(
          toOpen.map((server) =>
            tabs!.open(server).catch((error) => {
              logWarn(`Auto-connect failed for ${server.name}: ${String(error)}`)
            })
          )
        )
        const active =
          restored && settings.activeTabId && store!.getServer(settings.activeTabId)
            ? settings.activeTabId
            : toOpen[0].id
        tabs!.activate(active)
        return
      } catch (error) {
        logWarn(`Auto-connect failed: ${String(error)}`)
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
      if (tabs?.hasTabs()) {
        tabs.show()
      } else {
        showManager()
      }
    })
  })

  app.on('activate', () => {
    if (tabs?.hasTabs()) {
      tabs.show()
      return
    }
    showManager()
  })

  app.on('browser-window-created', (_event, win) => {
    win.on('closed', () => {
      pet?.handleWindowClosed()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopPetPackWatcher?.()
    stopPetPackWatcher = null
    void pet?.destroy()
    closeAllAuthWindows()
    tabs?.closeAll()
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
}