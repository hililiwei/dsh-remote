import { BrowserWindow, shell } from 'electron'
import { APP_NAME, MANAGER_SIZE } from '../shared/constants'
import type { ConfigStore } from './config-store'
import { logError } from './logger'
import { appIconFile, preloadFile } from './paths'
import { loadRenderer } from './renderer-loader'
import { setWindowContext } from './window-registry'
import { attachBoundsPersistence, restoredBounds } from './window-bounds'

let managerWindow: BrowserWindow | null = null
let storeRef: ConfigStore | null = null

export function initManagerWindow(store: ConfigStore): void {
  storeRef = store
}

export function getManagerWindow(): BrowserWindow | null {
  return managerWindow && !managerWindow.isDestroyed() ? managerWindow : null
}

export function createManagerWindow(): BrowserWindow {
  const existing = getManagerWindow()
  if (existing) return existing
  if (!storeRef) throw new Error('Manager window used before initialization')

  const bounds = restoredBounds(storeRef, 'manager', MANAGER_SIZE)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    icon: appIconFile(),
    backgroundColor: '#0f1117',
    autoHideMenuBar: false,
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  managerWindow = win
  setWindowContext(win.webContents.id, { view: 'manager' })
  attachBoundsPersistence(storeRef, 'manager', win)

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
    }
  })

  win.on('closed', () => {
    if (managerWindow === win) managerWindow = null
  })

  void loadRenderer(win, { view: 'manager' }).catch((error) => {
    logError('Failed to load manager renderer', error)
  })

  return win
}

export function showManager(): BrowserWindow {
  const win = createManagerWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

export function hideManager(): void {
  if (process.env.DSH_REMOTE_KEEP_MANAGER === '1') return
  const win = getManagerWindow()
  if (win && win.isVisible()) win.hide()
}