import {
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  screen,
  shell,
  WebContentsView,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents
} from 'electron'
import { APP_NAME, TAB_BAR_HEIGHT } from '../shared/constants'
import type { AuthReason, ServerProfile, TabInfo, TabStatus } from '../shared/types'
import { closeAuthWindow, hasAuthWindow, openAuthWindow } from './auth-window'
import {
  AuthRequiredError,
  NavigationError,
  resolveServerNavigation
} from './connection'
import type { ConfigStore } from './config-store'
import { logError, logInfo } from './logger'
import { hideManager, showManager } from './manager-window'
import { appIconFile, preloadFile } from './paths'
import { loadRenderer } from './renderer-loader'
import { partitionFor, SessionManager } from './session-manager'
import { redactUrl, sameOrigin } from './url-tools'
import { attachBoundsPersistence, restoredBounds } from './window-bounds'
import { setWindowContext } from './window-registry'
import { clampShellWidth, defaultShellSize } from './window-size'

const SHELL_BOUNDS_KEY = 'shell-v2'
const NAVIGATION_TIMEOUT_MS = 30_000

export interface TabManagerDeps {
  store: ConfigStore
  sessions: SessionManager
  onServersChanged: () => void
}

interface TabEntry {
  server: ServerProfile
  view: WebContentsView
  status: TabStatus
  pending?: Promise<void>
}

/**
 * One shell window, one tab bar (the shell's own local renderer), and one
 * WebContentsView per open server. Remote views sit below the tab bar and are
 * shown/hidden as tabs change; each view keeps its own persistent session.
 */
export class TabManager {
  private shell: BrowserWindow | null = null
  private readonly tabs = new Map<string, TabEntry>()
  private order: string[] = []
  private activeId: string | null = null
  private readonly watchedSessions = new WeakSet<Session>()
  private readonly lastAuthPrompt = new Map<string, number>()
  private persistTimer: NodeJS.Timeout | undefined

  constructor(private readonly deps: TabManagerDeps) {}

  getShellWindow(): BrowserWindow | null {
    return this.shell && !this.shell.isDestroyed() ? this.shell : null
  }

  hasTabs(): boolean {
    return this.order.length > 0
  }

  activeServerId(): string | undefined {
    return this.activeId ?? undefined
  }

  listTabs(): TabInfo[] {
    return this.order.map((id) => {
      const entry = this.tabs.get(id)
      const server = this.deps.store.getServer(id) ?? entry?.server
      return {
        id,
        name: server?.name ?? 'DSH',
        url: server?.baseUrl ?? '',
        status: entry?.status ?? 'error',
        active: id === this.activeId
      }
    })
  }

  async open(server: ServerProfile): Promise<void> {
    try {
      const existing = this.tabs.get(server.id)
      if (existing) {
        this.activate(server.id)
        this.showShell()
        if (existing.status !== 'online' && existing.status !== 'loading') {
          await this.navigate(server, existing, server.baseUrl)
        }
        hideManager()
        return
      }

      await this.deps.sessions.applyProxy(server)
      const entry = this.ensureTab(server)
      this.activate(server.id)
      this.showShell()
      await this.navigate(server, entry, server.baseUrl)
      hideManager()
    } catch (error) {
      if (!this.tabs.has(server.id)) return
      if (error instanceof AuthRequiredError) {
        this.promptAuth(server.id, 'first')
        return
      }
      await this.showNavigationError(server, error)
    }
  }

  async openWithLaunchUrl(server: ServerProfile, launchUrl: string): Promise<void> {
    const navigation = resolveServerNavigation(server, launchUrl)
    const existing = this.tabs.get(server.id)
    if (!existing) await this.deps.sessions.applyProxy(server)
    const entry = this.ensureTab(server)
    this.activate(server.id)
    this.showShell()
    await this.navigate(server, entry, navigation.url)
    hideManager()
  }

  async retry(server: ServerProfile): Promise<void> {
    const entry = this.tabs.get(server.id)
    if (!entry) {
      await this.open(server)
      return
    }
    this.activate(server.id)
    this.showShell()
    await this.navigate(server, entry, server.baseUrl)
  }

  activate(serverId: string): void {
    const entry = this.tabs.get(serverId)
    if (!entry) return
    this.activeId = serverId
    for (const [id, candidate] of this.tabs) {
      candidate.view.setVisible(id === serverId)
    }
    const shellWindow = this.getShellWindow()
    if (shellWindow) {
      shellWindow.setTitle(`${APP_NAME} — ${entry.server.name}`)
      if (!shellWindow.isVisible()) shellWindow.show()
    }
    this.sendTabs()
    this.schedulePersist()
    try {
      entry.view.webContents.focus()
    } catch {
      // View may be closing.
    }
  }

  focus(serverId: string): boolean {
    if (!this.tabs.has(serverId)) return false
    this.activate(serverId)
    this.showShell()
    return true
  }

  show(): void {
    this.showShell()
  }

  /**
   * Apply a fixed width, or the automatic 85% width when `requested` is null.
   * Keeps the current height and clamps the window into the current display.
   */
  applyWindowWidth(requested?: number | null): void {
    const shellWindow = this.getShellWindow()
    if (!shellWindow) return

    const bounds = shellWindow.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const targetWidth = clampShellWidth(
      requested,
      workArea,
      defaultShellSize(workArea).width
    )
    if (shellWindow.isMaximized()) shellWindow.unmaximize()

    const maxX = Math.max(workArea.x, workArea.x + workArea.width - targetWidth)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height)
    shellWindow.setBounds(
      {
        x: Math.min(Math.max(bounds.x, workArea.x), maxX),
        y: Math.min(Math.max(bounds.y, workArea.y), maxY),
        width: targetWidth,
        height: bounds.height
      },
      false
    )
    this.layout()
  }

  close(serverId: string): void {
    const entry = this.tabs.get(serverId)
    if (!entry) return

    const index = this.order.indexOf(serverId)
    this.order = this.order.filter((id) => id !== serverId)
    this.tabs.delete(serverId)
    closeAuthWindow(serverId)
    this.destroyView(entry.view)
    this.lastAuthPrompt.delete(serverId)

    if (this.activeId === serverId) {
      const next = this.order[index] ?? this.order[index - 1] ?? this.order[0]
      this.activeId = next ?? null
      if (this.activeId) {
        const nextEntry = this.tabs.get(this.activeId)
        for (const [id, candidate] of this.tabs) {
          candidate.view.setVisible(id === this.activeId)
        }
        const shellWindow = this.getShellWindow()
        if (shellWindow && nextEntry) {
          shellWindow.setTitle(`${APP_NAME} — ${nextEntry.server.name}`)
        }
      }
    }

    this.sendTabs()
    this.schedulePersist()

    if (this.order.length === 0) {
      this.activeId = null
      showManager()
      this.destroyShell()
    }
  }

  closeAll(): void {
    for (const entry of this.tabs.values()) {
      this.destroyView(entry.view)
    }
    this.tabs.clear()
    this.order = []
    this.activeId = null
    this.destroyShell()
  }

  reload(serverId: string): void {
    const entry = this.tabs.get(serverId)
    if (!entry) return
    entry.status = 'loading'
    this.sendTabs()
    entry.view.webContents.reload()
  }

  reloadActive(): void {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused !== this.getShellWindow()) return
    if (this.activeId) this.reload(this.activeId)
  }

  openInBrowser(serverId: string): void {
    const server = this.deps.store.getServer(serverId)
    if (server) void shell.openExternal(server.baseUrl)
  }

  async refreshServer(server: ServerProfile): Promise<void> {
    const entry = this.tabs.get(server.id)
    if (!entry) return
    const oldBaseUrl = entry.server.baseUrl
    const oldProxyMode = entry.server.proxyMode
    entry.server = server
    this.sendTabs()
    if (oldBaseUrl !== server.baseUrl || oldProxyMode !== server.proxyMode) {
      await this.deps.sessions.applyProxy(server)
      this.activate(server.id)
      await this.navigate(server, entry, server.baseUrl)
    }
  }

  showAddMenu(): void {
    const shellWindow = this.getShellWindow()
    const servers = this.deps.store.getSettings().servers
    if (!shellWindow) {
      showManager()
      return
    }

    const items: MenuItemConstructorOptions[] = servers.map((server) => ({
      label: server.name,
      type: 'checkbox' as const,
      checked: this.tabs.has(server.id),
      click: () => {
        void this.open(server)
      }
    }))
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({
      label: servers.length > 0 ? '服务器管理…' : '添加服务器…',
      click: () => showManager()
    })

    Menu.buildFromTemplate(items).popup({ window: shellWindow })
  }

  showTabMenu(serverId: string): void {
    const shellWindow = this.getShellWindow()
    const server = this.deps.store.getServer(serverId)
    if (!shellWindow || !server) return

    const menu = Menu.buildFromTemplate([
      {
        label: '重新加载',
        click: () => this.reload(serverId)
      },
      {
        label: '在浏览器中打开',
        click: () => this.openInBrowser(serverId)
      },
      {
        label: '复制服务器地址',
        click: () => clipboard.writeText(server.baseUrl)
      },
      { type: 'separator' },
      {
        label: '清除登录状态…',
        click: async () => {
          const result = await dialog.showMessageBox(shellWindow, {
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
          await this.deps.sessions.clear(serverId)
          const entry = this.tabs.get(serverId)
          if (entry) {
            this.activate(serverId)
            await this.navigate(server, entry, server.baseUrl).catch(() => undefined)
          }
        }
      },
      { type: 'separator' },
      {
        label: '关闭标签页',
        click: () => this.close(serverId)
      }
    ])
    menu.popup({ window: shellWindow })
  }

  private ensureTab(server: ServerProfile): TabEntry {
    const existing = this.tabs.get(server.id)
    if (existing) return existing

    const shellWindow = this.ensureShell()

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionFor(server.id),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        spellcheck: true
      }
    })
    view.setBackgroundColor('#111318')
    view.setVisible(false)
    view.setBounds(this.viewBounds())
    shellWindow.contentView.addChildView(view)

    const entry: TabEntry = {
      server,
      view,
      status: 'loading'
    }
    this.tabs.set(server.id, entry)
    this.order.push(server.id)
    this.configureRemote(server)
    this.configureSession(server)
    this.attachShortcuts(view.webContents)
    this.sendTabs()
    return entry
  }

  private ensureShell(): BrowserWindow {
    const existing = this.getShellWindow()
    if (existing) return existing

    const workArea = screen.getPrimaryDisplay().workArea
    const fallback = defaultShellSize(workArea)
    const saved = restoredBounds(this.deps.store, SHELL_BOUNDS_KEY, fallback)
    const width = clampShellWidth(
      this.deps.store.getSettings().shellWidth,
      workArea,
      saved.width
    )
    const shellWindow = new BrowserWindow({
      ...saved,
      width,
      minWidth: 900,
      minHeight: 560,
      show: false,
      title: APP_NAME,
      icon: appIconFile(),
      backgroundColor: '#0f1117',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadFile(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    this.shell = shellWindow
    setWindowContext(shellWindow.webContents.id, { view: 'tabs' })
    attachBoundsPersistence(this.deps.store, SHELL_BOUNDS_KEY, shellWindow)

    shellWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          void shell.openExternal(url)
        }
      } catch {
        // Deny malformed URLs.
      }
      return { action: 'deny' }
    })
    shellWindow.webContents.on('will-navigate', (event, url) => {
      const current = shellWindow.webContents.getURL()
      if (current && url.split('#')[0] === current.split('#')[0]) return
      event.preventDefault()
    })
    shellWindow.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      shellWindow.setTitle(this.shellTitle())
    })
    shellWindow.webContents.on('did-finish-load', () => {
      this.sendTabs()
    })
    this.attachShortcuts(shellWindow.webContents)

    shellWindow.on('resize', () => this.layout())
    shellWindow.on('enter-full-screen', () => this.layout())
    shellWindow.on('leave-full-screen', () => this.layout())
    shellWindow.once('ready-to-show', () => {
      this.layout()
      if (!shellWindow.isDestroyed()) shellWindow.show()
    })
    shellWindow.on('closed', () => {
      if (this.shell === shellWindow) this.shell = null
      for (const entry of this.tabs.values()) this.destroyView(entry.view)
      this.tabs.clear()
      this.order = []
      this.activeId = null
    })

    void loadRenderer(shellWindow, { view: 'tabs' }).catch((error) => {
      logError('Failed to load tab bar renderer', error)
    })
    return shellWindow
  }

  private configureRemote(server: ServerProfile): void {
    const entry = this.tabs.get(server.id)
    if (!entry) return
    const view = entry.view
    const contents = view.webContents

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        const secureInApp = target.protocol === 'https:' || sameOrigin(url, server.baseUrl)
        if (secureInApp) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: this.getShellWindow() ?? undefined,
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
        // Deny malformed targets.
      }
      return { action: 'deny' }
    })

    const blockUnsafeNavigation = (event: Electron.Event, url: string): void => {
      try {
        const target = new URL(url)
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    }
    contents.on('will-navigate', blockUnsafeNavigation)
    contents.on('will-redirect', blockUnsafeNavigation)

    contents.on('did-navigate', (_event, _url, httpResponseCode) => {
      if (httpResponseCode === 401) {
        entry.status = 'auth-required'
        this.sendTabs()
        this.promptAuth(server.id, 'expired')
      }
    })

    contents.on('render-process-gone', (_event, details) => {
      logError(`Tab renderer gone for ${server.id}: ${details.reason}`)
      entry.status = 'error'
      this.sendTabs()
      void dialog.showMessageBox({
        type: 'error',
        title: APP_NAME,
        message: `${server.name} 的页面进程已退出`,
        detail: details.reason,
        buttons: ['重新加载', '关闭标签页'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
        if (result.response === 0) this.reload(server.id)
        else this.close(server.id)
      })
    })
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

  private navigate(server: ServerProfile, entry: TabEntry, url: string): Promise<void> {
    if (entry.pending) return entry.pending

    entry.status = 'loading'
    this.sendTabs()

    const pending = new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        finish(new NavigationError('连接超时，请检查服务器地址和网络。'))
      }, NAVIGATION_TIMEOUT_MS)
      const contents = entry.view.webContents

      const cleanup = (): void => {
        clearTimeout(timer)
        contents.removeListener('did-navigate', onNavigate)
        contents.removeListener('did-fail-load', onFail)
        contents.removeListener('destroyed', onDestroyed)
        if (entry.pending === pending) entry.pending = undefined
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
          entry.status = 'online'
          void this.deps.store.markUsed(server.id).catch(() => undefined)
          void this.deps.sessions
            .get(server)
            .cookies.flushStore()
            .catch(() => undefined)
          logInfo(`Connected to ${server.baseUrl}`)
          this.sendTabs()
          finish()
          return
        }
        if (httpResponseCode === 401) {
          entry.status = 'auth-required'
          this.sendTabs()
          finish(new AuthRequiredError(server.id))
          return
        }
        entry.status = 'error'
        this.sendTabs()
        finish(
          httpResponseCode === 403
            ? new NavigationError('没有权限访问这个服务器。', 403)
            : new NavigationError(`服务器返回 HTTP ${httpResponseCode}`, httpResponseCode)
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
        entry.status = 'error'
        this.sendTabs()
        finish(new NavigationError(errorDescription || '页面加载失败', undefined, errorCode))
      }

      const onDestroyed = (): void => {
        finish(new NavigationError('标签页已关闭'))
      }

      contents.on('did-navigate', onNavigate)
      contents.on('did-fail-load', onFail)
      contents.once('destroyed', onDestroyed)

      void contents.loadURL(url).catch((error: unknown) => {
        if (settled) return
        const raw = error instanceof Error ? error.message : String(error)
        const message = redactUrl(raw)
        if (message.includes('ERR_ABORTED')) return
        entry.status = 'error'
        this.sendTabs()
        finish(new NavigationError(message))
      })
    })

    entry.pending = pending
    return pending
  }

  private promptAuth(serverId: string, reason: AuthReason): void {
    if (hasAuthWindow(serverId)) return
    const now = Date.now()
    const last = this.lastAuthPrompt.get(serverId) ?? 0
    if (now - last < 1500) return
    this.lastAuthPrompt.set(serverId, now)

    const server = this.deps.store.getServer(serverId)
    if (!server) return
    const entry = this.tabs.get(serverId)
    if (entry) {
      entry.status = 'auth-required'
      this.sendTabs()
    }
    this.activate(serverId)
    this.showShell()
    openAuthWindow(this.deps.store, serverId, reason, this.getShellWindow() ?? undefined)
  }

  private async showNavigationError(server: ServerProfile, error: unknown): Promise<void> {
    const message = redactUrl(error instanceof Error ? error.message : String(error))
    logError(`Failed to open ${server.baseUrl}`, error)
    this.showShell()

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
      void this.retry(server).catch(() => undefined)
    } else if (result.response === 1) {
      void shell.openExternal(server.baseUrl)
    } else {
      showManager()
    }
  }

  private attachShortcuts(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = process.platform === 'darwin' ? input.meta : input.control
      if (!mod) return
      const key = input.key.toLowerCase()

      if (key === 'w') {
        if (this.activeId) {
          event.preventDefault()
          this.close(this.activeId)
        }
        return
      }
      if (key === 't') {
        event.preventDefault()
        this.showAddMenu()
        return
      }
      if (key === 'r') {
        event.preventDefault()
        this.reloadActive()
        return
      }
      if (/^[1-9]$/.test(key)) {
        const id = this.order[Number(key) - 1]
        if (id) {
          event.preventDefault()
          this.activate(id)
        }
      }
    })
  }

  private showShell(): void {
    const shellWindow = this.getShellWindow()
    if (!shellWindow) return
    if (shellWindow.isMinimized()) shellWindow.restore()
    this.layout()
    shellWindow.show()
    shellWindow.focus()
  }

  private layout(): void {
    const shellWindow = this.getShellWindow()
    if (!shellWindow) return
    const { width, height } = shellWindow.getContentBounds()
    const tabHeight = Math.min(TAB_BAR_HEIGHT, Math.max(0, height))
    const remoteHeight = Math.max(0, height - tabHeight)
    for (const entry of this.tabs.values()) {
      entry.view.setBounds({ x: 0, y: tabHeight, width, height: remoteHeight })
    }
  }

  private viewBounds(): { x: number; y: number; width: number; height: number } {
    const shellWindow = this.getShellWindow()
    if (!shellWindow) {
      const fallback = defaultShellSize(screen.getPrimaryDisplay().workArea)
      return {
        x: 0,
        y: TAB_BAR_HEIGHT,
        width: fallback.width,
        height: fallback.height - TAB_BAR_HEIGHT
      }
    }
    const { width, height } = shellWindow.getContentBounds()
    return {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: Math.max(0, height - TAB_BAR_HEIGHT)
    }
  }

  private shellTitle(): string {
    const server = this.activeId ? this.deps.store.getServer(this.activeId) : undefined
    return server ? `${APP_NAME} — ${server.name}` : APP_NAME
  }

  private sendTabs(): void {
    const shellWindow = this.getShellWindow()
    if (!shellWindow || shellWindow.webContents.isDestroyed()) return
    shellWindow.webContents.send('tabs:changed', this.listTabs())
    shellWindow.setTitle(this.shellTitle())
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      void this.deps.store
        .setOpenTabs(this.order, this.activeId ?? undefined)
        .catch((error) => logError('Failed to persist tab state', error))
    }, 150)
  }

  private destroyView(view: WebContentsView): void {
    const shellWindow = this.getShellWindow()
    try {
      if (shellWindow) shellWindow.contentView.removeChildView(view)
    } catch {
      // Already detached.
    }
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      // Already destroyed.
    }
  }

  private destroyShell(): void {
    const shellWindow = this.getShellWindow()
    this.shell = null
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.destroy()
  }
}