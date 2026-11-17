import { BrowserWindow } from 'electron'
import { AUTH_SIZE, APP_NAME } from '../shared/constants'
import type { AuthReason } from '../shared/types'
import type { ConfigStore } from './config-store'
import { getManagerWindow } from './manager-window'
import { appIconFile, preloadFile } from './paths'
import { loadRenderer } from './renderer-loader'
import { setWindowContext } from './window-registry'

const authWindows = new Map<string, BrowserWindow>()

export function hasAuthWindow(serverId: string): boolean {
  const win = authWindows.get(serverId)
  return Boolean(win && !win.isDestroyed())
}

export function openAuthWindow(
  store: ConfigStore,
  serverId: string,
  reason: AuthReason
): BrowserWindow {
  const existing = authWindows.get(serverId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  const server = store.getServer(serverId)
  if (!server) throw new Error('Server not found')

  const parent = getManagerWindow()
  const win = new BrowserWindow({
    width: AUTH_SIZE.width,
    height: AUTH_SIZE.height,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: `${APP_NAME} — 连接 ${server.name}`,
    icon: appIconFile(),
    backgroundColor: '#0f1117',
    ...(parent && parent.isVisible() ? { parent } : {}),
    webPreferences: {
      preload: preloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  authWindows.set(serverId, win)
  setWindowContext(win.webContents.id, { view: 'auth', serverId, reason })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  win.on('closed', () => {
    if (authWindows.get(serverId) === win) authWindows.delete(serverId)
  })

  void loadRenderer(win, { view: 'auth', serverId, reason }).catch(() => undefined)
  return win
}

export function closeAuthWindow(serverId: string): void {
  const win = authWindows.get(serverId)
  if (win && !win.isDestroyed()) win.close()
  authWindows.delete(serverId)
}

export function closeAllAuthWindows(): void {
  for (const win of authWindows.values()) {
    if (!win.isDestroyed()) win.close()
  }
  authWindows.clear()
}

export function authWindowCount(): number {
  return authWindows.size
}