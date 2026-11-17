import { app } from 'electron'
import { join } from 'node:path'

export function applyUserDataOverride(): void {
  const override = process.env.DSH_REMOTE_USER_DATA
  if (override && override.trim() !== '') {
    app.setPath('userData', override)
  }
}

export function configFile(): string {
  return join(app.getPath('userData'), 'servers.json')
}

export function logFile(): string {
  return join(app.getPath('userData'), 'logs', 'main.log')
}

export function preloadFile(): string {
  return join(__dirname, '../preload/index.js')
}

export function rendererIndexFile(): string {
  return join(__dirname, '../renderer/index.html')
}

export function appIconFile(): string {
  if (app.isPackaged) return process.execPath
  const name =
    process.platform === 'win32'
      ? 'icon.ico'
      : process.platform === 'darwin'
        ? 'icon.icns'
        : 'icon.png'
  return join(app.getAppPath(), 'build', name)
}

export function trayIconFile(): string {
  const name = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'build', name)
}