import { BrowserWindow, dialog, shell, type Session } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { AuthReason, ServerProfile } from '../shared/types'
import { hasAuthWindow, openAuthWindow } from './auth-window'
import {
  AuthRequiredError,
  NavigationError,
  resolveServerNavigation
} from './connection'
import type { ConfigStore } from './config-store'
import { logError, logInfo } from './logger'
import { hideManager, showManager } from './manager-window'
import { appIconFile } from './paths'
import { partitionFor, SessionManager } from './session-manager'
import { redactUrl, sameOrigin } from './url-tools'
import { attachBoundsPersistence, restoredBounds } from './window-bounds'

const SERVER_WINDOW_SIZE = { width: 1280, height: 840 }
const NAVIGATION_TIMEOUT_MS = 30_000

export interface ServerWindowDeps {
  store: ConfigStore
  sessions: SessionManager
  onServersChanged: () => void
}

interface PendingNavigation {
  serverId: string
}

export class ServerWindowManager {
  private readonly windows = new Map<string, BrowserWindow>()
  private readonly watchedSessions = new WeakSet<Session>()
  private readonly lastAuthPrompt = new Map<string, number>()
  private readonly pending = new Map<string, PendingNavigation>()

  constructor(private readonly deps: ServerWindowDeps) {}

  getWindow(serverId: string): BrowserWindow | undefined {
    const win = this.windows.get(serverId)
    return win && !win.isDestroyed() ? win : undefined
  }

  serverIdForWindow(win: BrowserWindow): string | undefined {
    for (const [id, candidate] of this.windows) {
      if (candidate === win) return id
    }
    return undefined
  }

  async open(server: ServerProfile): Promise<void> {
    try {
      await this.openInternal(server)
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        this.promptAuth(server.id, 'first')
        return
      }
      await this.showNavigationError(server, error)
      throw error
    }
  }

  async openWithLaunchUrl(server: ServerProfile, launchUrl: string): Promise<void> {
    const navigation = resolveServerNavigation(server, launchUrl)
    await this.deps.sessions.applyProxy(server)
    const win = this.getWindow(server.id) ?? this.createWindow(server)
    await this.navigate(server, win, navigation.url)
    win.show()
    win.focus()
    hideManager()
  }

  async retry(server: ServerProfile): Promise<void> {
    const win = this.getWindow(server.id)
    if (!win) {
      await this.open(server)
      return
    }
    await this.navigate(server, win, server.baseUrl)
    win.show()
    win.focus()
  }

  focus(serverId: string): boolean {
    const win = this.getWindow(serverId)
    if (!win) return false
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return true
  }

  reload(serverId: string): boolean {
    const win = this.getWindow(serverId)
    if (!win) return false
    win.webContents.reload()
    return true
  }

  close(serverId: string): void {
    const win = this.getWindow(serverId)
    if (win) win.close()
    this.windows.delete(serverId)
    this.pending.delete(serverId)
  }

  closeAll(): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy()
    }
    this.windows.clear()
    this.pending.clear()
  }

  openInBrowser(serverId: string): void {
    const server = this.deps.store.getServer(serverId)
    if (server) void shell.openExternal(server.baseUrl)
  }

  private async openInternal(server: ServerProfile): Promise<void> {
    await this.deps.sessions.applyProxy(server)
    const existing = this.getWindow(server.id)
    if (existing) {
      if (!existing.isVisible()) {
        await this.navigate(server, existing, server.baseUrl)
      }
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return
    }

    const win = this.createWindow(server)
    await this.navigate(server, win, server.baseUrl)
    win.show()
    win.focus()
    hideManager()
  }

  private createWindow(server: ServerProfile): BrowserWindow {
    const key = `server:${server.id}`
    const bounds = restoredBounds(this.deps.store, key, SERVER_WINDOW_SIZE)
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 760,
      minHeight: 520,
      show: false,
      title: server.name,
      icon: appIconFile(),
      backgroundColor: '#111318',
      autoHideMenuBar: false,
      webPreferences: {
        partition: partitionFor(server.id),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: true
      }
    })

    this.windows.set(server.id, win)
    this.configureSession(server)
    attachBoundsPersistence(this.deps.store, key, win)

    win.on('closed', () => {
      if (this.windows.get(server.id) === win) this.windows.delete(server.id)
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        const secureInApp =
          target.protocol === 'https:' || sameOrigin(url, server.baseUrl)
        if (secureInApp) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: win,
              width: 1100,
              height: 760,
              webPreferences: {
                partition: partitionFor(server.id),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
              }
            }
          }
        }
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          void shell.openExternal(url)
        }
      } catch {
        // Malformed target: deny.
      }
      return { action: 'deny' }
    })

    const blockUnsafeNavigation = (event: Electron.Event, url: string): void => {
      try {
        const target = new URL(url)
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          event.preventDefault()
          return
        }
      } catch {
        event.preventDefault()
      }
    }
    win.webContents.on('will-navigate', blockUnsafeNavigation)
    win.webContents.on('will-redirect', blockUnsafeNavigation)

    win.webContents.on('did-navigate', (_event, _url, httpResponseCode) => {
      if (httpResponseCode === 401) {
        win.hide()
        this.promptAuth(server.id, 'expired')
      }
    })

    win.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      win.setTitle(server.name)
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      logError(`Server renderer gone for ${server.id}: ${details.reason}`)
      void dialog.showMessageBox({
        type: 'error',
        title: APP_NAME,
        message: `${server.name} 的页面进程已退出`,
        detail: details.reason,
        buttons: ['重新加载', '关闭'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
        if (result.response === 0 && !win.isDestroyed()) win.webContents.reload()
      })
    })

    return win
  }

  private configureSession(server: ServerProfile): void {
    const target = this.deps.sessions.get(server)

    target.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const current = this.deps.store.getServer(server.id)
      if (!current || !sameOrigin(details.requestingUrl, current.baseUrl)) {
        callback(false)
        return
      }
      if (permission === 'media') {
        void dialog
          .showMessageBox({
            type: 'question',
            title: APP_NAME,
            message: `${current.name} 请求使用麦克风/摄像头`,
            detail: '远程 DSH 页面请求媒体权限。只在你信任这个服务器时允许。',
            buttons: ['允许', '拒绝'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
          })
          .then((result) => callback(result.response === 0))
        return
      }
      callback(
        permission === 'clipboard-read' ||
          permission === 'clipboard-sanitized-write' ||
          permission === 'notifications' ||
          permission === 'fullscreen' ||
          permission === 'pointerLock'
      )
    })

    target.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      const current = this.deps.store.getServer(server.id)
      if (!current || !sameOrigin(requestingOrigin, current.baseUrl)) return false
      return (
        permission === 'clipboard-read' ||
        permission === 'clipboard-sanitized-write' ||
        permission === 'notifications' ||
        permission === 'media' ||
        permission === 'fullscreen' ||
        permission === 'pointerLock'
      )
    })

    if (!this.watchedSessions.has(target)) {
      this.watchedSessions.add(target)
      target.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
        if (details.statusCode !== 401) return
        if (details.resourceType === 'mainFrame') return
        const current = this.deps.store.getServer(server.id)
        if (!current) return
        try {
          const origin = new URL(details.url).origin
          if (origin !== new URL(current.baseUrl).origin) return
        } catch {
          return
        }
        this.promptAuth(server.id, 'expired')
      })
    }
  }

  private navigate(
    server: ServerProfile,
    win: BrowserWindow,
    url: string
  ): Promise<void> {
    if (this.pending.has(server.id)) {
      this.pending.delete(server.id)
    }
    this.pending.set(server.id, { serverId: server.id })

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const key = server.id
      const timer = setTimeout(() => {
        finish(new NavigationError('连接超时，请检查服务器地址和网络。'))
      }, NAVIGATION_TIMEOUT_MS)

      const cleanup = (): void => {
        clearTimeout(timer)
        win.webContents.removeListener('did-navigate', onNavigate)
        win.webContents.removeListener('did-fail-load', onFail)
        win.removeListener('closed', onClosed)
        if (this.pending.get(key)?.serverId === key) this.pending.delete(key)
      }

      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }

      const onNavigate = (
        _event: Electron.Event,
        _url: string,
        httpResponseCode: number
      ): void => {
        if (httpResponseCode === 0) return
        if (httpResponseCode >= 200 && httpResponseCode < 400) {
          void this.deps.store.markUsed(server.id).catch(() => undefined)
          void this.deps.sessions
            .get(server)
            .cookies.flushStore()
            .catch(() => undefined)
          logInfo(`Connected to ${server.baseUrl}`)
          finish()
          return
        }
        if (httpResponseCode === 401) {
          win.hide()
          finish(new AuthRequiredError(server.id))
          return
        }
        if (httpResponseCode === 403) {
          win.hide()
          finish(new NavigationError('没有权限访问这个服务器。', 403))
          return
        }
        win.hide()
        finish(
          new NavigationError(`服务器返回 HTTP ${httpResponseCode}`, httpResponseCode)
        )
      }

      const onFail = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean
      ): void => {
        if (!isMainFrame || errorCode === -3) return
        win.hide()
        finish(new NavigationError(errorDescription || '页面加载失败', undefined, errorCode))
      }

      const onClosed = (): void => {
        finish(new NavigationError('窗口已关闭'))
      }

      win.webContents.on('did-navigate', onNavigate)
      win.webContents.on('did-fail-load', onFail)
      win.once('closed', onClosed)

      void win.loadURL(url).catch((error: unknown) => {
        if (settled) return
        const raw = error instanceof Error ? error.message : String(error)
        const message = redactUrl(raw)
        if (message.includes('ERR_ABORTED')) return
        finish(new NavigationError(message))
      })
    })
  }

  private promptAuth(serverId: string, reason: AuthReason): void {
    if (hasAuthWindow(serverId)) return
    const now = Date.now()
    const last = this.lastAuthPrompt.get(serverId) ?? 0
    if (now - last < 1500) return
    this.lastAuthPrompt.set(serverId, now)

    const server = this.deps.store.getServer(serverId)
    if (!server) return
    showManager()
    const win = this.getWindow(serverId)
    if (win) win.hide()
    openAuthWindow(this.deps.store, serverId, reason)
  }

  private async showNavigationError(server: ServerProfile, error: unknown): Promise<void> {
    const message = redactUrl(error instanceof Error ? error.message : String(error))
    logError(`Failed to open ${server.baseUrl}`, error)
    showManager()

    const result = await dialog.showMessageBox({
      type: 'error',
      title: APP_NAME,
      message: `无法打开 ${server.name}`,
      detail: message,
      buttons: ['重试', '在浏览器中打开', '管理服务器'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })

    if (result.response === 0) {
      void this.open(server).catch(() => undefined)
    } else if (result.response === 1) {
      void shell.openExternal(server.baseUrl)
    }
  }
}