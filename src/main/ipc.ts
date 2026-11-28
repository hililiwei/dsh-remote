import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_NAME } from '../shared/constants'
import { isPetSize } from '../shared/pet'
import type {
  AppInfo,
  AppSettings,
  AuthSubmitResult,
  ProxyMode,
  SaveServerResult,
  ServerInput,
  ServerProfile,
  TestResult,
  TestServerInput,
  ThemeMode,
  WindowContext
} from '../shared/types'
import type { PetManager } from './pet/pet-manager'
import { getPetPackInfo, openPetPackDir } from './pet/pet-pack'
import { closeAuthWindow } from './auth-window'
import { AuthInputError, AuthRequiredError, NavigationError } from './connection'
import { ConfigStore, ConfigStoreError } from './config-store'
import { logError, logInfo } from './logger'
import { showManager } from './manager-window'
import { petHtmlFile, rendererIndexFile } from './paths'
import { checkServer } from './server-status'
import { SessionManager } from './session-manager'
import { TabManager } from './tab-manager'
import { parseConnectionInput, redactUrl, UrlInputError } from './url-tools'
import { getWindowContext } from './window-registry'

export interface IpcDeps {
  store: ConfigStore
  sessions: SessionManager
  tabs: TabManager
  pet: PetManager
  applyTheme: (theme: ThemeMode) => void
  refreshMenu: () => void
  refreshTray: () => void
}

const CHANNELS = [
  'window:context',
  'app:info',
  'app:open-manager',
  'app:open-external',
  'app:clear-session',
  'settings:get',
  'settings:update',
  'servers:list',
  'servers:save',
  'servers:delete',
  'servers:set-default',
  'servers:test',
  'servers:connect',
  'auth:submit',
  'auth:cancel',
  'tabs:list',
  'tabs:activate',
  'tabs:close',
  'tabs:add',
  'tabs:reload',
  'tabs:menu',
  'pet:snapshot',
  'pet:details',
  'pet:focus-server',
  'pet:focus-session',
  'pet:hide',
  'pet:open-manager',
  'pet:pack',
  'pet:open-pack-dir',
  'app:open-pet-pack',
  'pet:ignore-mouse',
  'pet:set-expanded',
  'pet:set-compact',
  'pet:card-bounds',
  'pet:drag-start',
  'pet:drag-move',
  'pet:drag-end'
] as const

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  const frameUrl = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    try {
      return new URL(frameUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  const expected = pathToFileURL(rendererIndexFile()).toString().split('?')[0]
  const petExpected = pathToFileURL(petHtmlFile()).toString().split('?')[0]
  const normalized = frameUrl.split('?')[0]
  return normalized === expected || normalized === petExpected
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  if (!isTrustedRenderer(event)) {
    throw new Error('拒绝来自非本地页面的请求。')
  }
}

function userMessage(error: unknown): string {
  if (
    error instanceof ConfigStoreError ||
    error instanceof AuthInputError ||
    error instanceof NavigationError ||
    error instanceof UrlInputError
  ) {
    return redactUrl(error.message)
  }
  if (error instanceof AuthRequiredError) {
    return '这个地址需要 DSH 启动令牌，请粘贴 dsh web 启动时打印的完整 URL。'
  }
  return '操作失败，请查看应用日志。'
}

function asSafeError(error: unknown, channel: string): Error {
  if (
    error instanceof ConfigStoreError ||
    error instanceof AuthInputError ||
    error instanceof NavigationError ||
    error instanceof UrlInputError
  ) {
    return new Error(error.message)
  }
  logError(`IPC ${channel} failed`, error)
  return new Error(redactUrl(userMessage(error)))
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigStoreError(`${field}不能为空。`)
  }
  return value
}

function asServerInput(value: unknown): ServerInput {
  if (typeof value !== 'object' || value === null) {
    throw new ConfigStoreError('服务器参数无效。')
  }
  const record = value as Record<string, unknown>
  const input: ServerInput = {
    name: typeof record.name === 'string' ? record.name : '',
    url: requireString(record.url, '服务器地址'),
    proxyMode: record.proxyMode === 'direct' ? 'direct' : 'system',
    allowInvalidCertificate: record.allowInvalidCertificate === true
  }
  if (typeof record.id === 'string' && record.id !== '') input.id = record.id
  return input
}

export function registerIpc(deps: IpcDeps): void {
  const { store, sessions, tabs, pet, applyTheme, refreshMenu, refreshTray } = deps

  const broadcastServers = (): void => {
    const servers = store.getSettings().servers
    for (const win of BrowserWindow.getAllWindows()) {
      const context = getWindowContext(win.webContents.id)
      if (!context || (context.view !== 'manager' && context.view !== 'auth')) continue
      if (!win.isDestroyed()) win.webContents.send('servers:changed', servers)
    }
  }

  const broadcastSettings = (settings: AppSettings): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      const context = getWindowContext(win.webContents.id)
      if (!context || (context.view !== 'manager' && context.view !== 'auth')) continue
      if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
    }
  }

  const afterServersChanged = (): void => {
    broadcastServers()
    broadcastSettings(store.getSettings())
    refreshMenu()
    refreshTray()
  }

  const handle = <T>(
    channel: (typeof CHANNELS)[number],
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrusted(event)
      try {
        return await handler(event, ...args)
      } catch (error) {
        throw asSafeError(error, channel)
      }
    })
  }

  handle('window:context', (event): WindowContext => {
    return getWindowContext(event.sender.id) ?? { view: 'manager' }
  })

  handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      isDev: !app.isPackaged
    }
  })

  handle('app:open-manager', (): boolean => {
    showManager()
    return true
  })

  handle('app:open-external', async (_event, rawUrl): Promise<boolean> => {
    const url = requireString(rawUrl, 'URL')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('外部链接格式无效。')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('只允许打开 http/https 链接。')
    }
    await shell.openExternal(parsed.toString())
    return true
  })

  handle('app:clear-session', async (_event, rawId): Promise<boolean> => {
    const id = requireString(rawId, '服务器 ID')
    if (!store.getServer(id)) throw new ConfigStoreError('服务器不存在或已被删除。')
    await sessions.clear(id)
    tabs.reload(id)
    void pet.refreshServer(id)
    return true
  })

  handle('settings:get', (): AppSettings => store.getSettings())

  handle('settings:update', async (_event, rawPatch): Promise<AppSettings> => {
    const patch = (typeof rawPatch === 'object' && rawPatch !== null
      ? rawPatch
      : {}) as AppSettings & {
      shellWidth?: number | null
      pet?: { enabled?: unknown; alwaysOnTop?: unknown; size?: unknown }
    }
    const hasWidth = Object.prototype.hasOwnProperty.call(patch, 'shellWidth')
    const petPatch =
      typeof patch.pet === 'object' && patch.pet !== null
        ? {
            ...(typeof patch.pet.enabled === 'boolean' ? { enabled: patch.pet.enabled } : {}),
            ...(typeof patch.pet.alwaysOnTop === 'boolean'
              ? { alwaysOnTop: patch.pet.alwaysOnTop }
              : {}),
            ...(isPetSize(patch.pet.size) ? { size: patch.pet.size } : {})
          }
        : undefined
    const settings = await store.updateSettings({
      ...(typeof patch.autoConnect === 'boolean' ? { autoConnect: patch.autoConnect } : {}),
      ...(typeof patch.closeToTray === 'boolean' ? { closeToTray: patch.closeToTray } : {}),
      ...(patch.theme === 'system' || patch.theme === 'light' || patch.theme === 'dark'
        ? { theme: patch.theme }
        : {}),
      ...(petPatch && Object.keys(petPatch).length > 0 ? { pet: petPatch } : {}),
      ...(patch.shellWidth === null
        ? { shellWidth: null }
        : typeof patch.shellWidth === 'number'
          ? { shellWidth: patch.shellWidth }
          : {})
    })
    if (hasWidth) tabs.applyWindowWidth(settings.shellWidth)
    applyTheme(settings.theme)
    pet.apply(settings)
    broadcastSettings(settings)
    refreshMenu()
    refreshTray()
    return settings
  })

  handle('servers:list', (): ServerProfile[] => store.getSettings().servers)

  handle('servers:save', async (_event, rawInput): Promise<SaveServerResult> => {
    const result = await store.saveServer(asServerInput(rawInput))
    void tabs.refreshServer(result.server).catch((error) => {
      logError(`Failed to refresh open tab ${result.server.id}`, error)
    })
    afterServersChanged()
    void pet.refreshServers()
    return result
  })

  handle('servers:delete', async (_event, rawId): Promise<boolean> => {
    const id = requireString(rawId, '服务器 ID')
    tabs.close(id)
    await sessions.clear(id)
    await store.deleteServer(id)
    afterServersChanged()
    void pet.refreshServers()
    return true
  })

  handle('servers:set-default', async (_event, rawId): Promise<AppSettings> => {
    const id = rawId === null ? null : requireString(rawId, '服务器 ID')
    const settings = await store.setDefaultServer(id)
    broadcastSettings(settings)
    refreshMenu()
    refreshTray()
    return settings
  })

  handle('servers:test', async (_event, rawInput): Promise<TestResult> => {
    if (typeof rawInput !== 'object' || rawInput === null) {
      throw new ConfigStoreError('测试参数无效。')
    }
    const input = rawInput as TestServerInput
    if (typeof input.id === 'string' && input.id !== '') {
      const server = store.getServer(input.id)
      if (!server) throw new ConfigStoreError('服务器不存在或已被删除。')
      await sessions.applyProxy(server)
      return checkServer(sessions.get(server), server.baseUrl)
    }

    const url = requireString(input.url, '服务器地址')
    const parsed = parseConnectionInput(url)
    const proxyMode: ProxyMode = input.proxyMode === 'direct' ? 'direct' : 'system'
    return sessions.testDraft(parsed.baseUrl, proxyMode)
  })

  handle('servers:connect', async (_event, rawId, rawTokenUrl): Promise<boolean> => {
    const id = requireString(rawId, '服务器 ID')
    const server = store.getServer(id)
    if (!server) throw new ConfigStoreError('服务器不存在或已被删除。')
    const tokenUrl =
      typeof rawTokenUrl === 'string' && rawTokenUrl.trim() !== '' ? rawTokenUrl : undefined
    if (tokenUrl) {
      await tabs.openWithLaunchUrl(server, tokenUrl)
    } else {
      await tabs.open(server)
    }
    void pet.refreshServer(id)
    return true
  })

  handle('auth:submit', async (event, rawTokenUrl): Promise<AuthSubmitResult> => {
    const context = getWindowContext(event.sender.id)
    if (!context || context.view !== 'auth' || !context.serverId) {
      return { ok: false, message: '认证窗口状态无效，请重新打开。' }
    }
    const server = store.getServer(context.serverId)
    if (!server) return { ok: false, message: '服务器已被删除。' }

    try {
      const tokenUrl = requireString(rawTokenUrl, '启动 URL')
      await tabs.openWithLaunchUrl(server, tokenUrl)
      closeAuthWindow(server.id)
      void pet.refreshServer(server.id)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: userMessage(error) }
    }
  })

  handle('auth:cancel', (event): boolean => {
    const context = getWindowContext(event.sender.id)
    if (context?.view === 'auth' && context.serverId) {
      closeAuthWindow(context.serverId)
    }
    return true
  })

  handle('tabs:list', () => tabs.listTabs())

  handle('tabs:activate', (_event, rawId): boolean => {
    const id = requireString(rawId, '服务器 ID')
    tabs.activate(id)
    return true
  })

  handle('tabs:close', (_event, rawId): boolean => {
    const id = requireString(rawId, '服务器 ID')
    tabs.close(id)
    return true
  })

  handle('tabs:add', (): boolean => {
    tabs.showAddMenu()
    return true
  })

  handle('tabs:reload', (_event, rawId): boolean => {
    const id = requireString(rawId, '服务器 ID')
    tabs.reload(id)
    return true
  })

  handle('tabs:menu', (_event, rawId): boolean => {
    const id = requireString(rawId, '服务器 ID')
    tabs.showTabMenu(id)
    return true
  })

  handle('pet:snapshot', () => pet.getSnapshot())
  handle('pet:details', () => pet.getDetails())

  handle('pet:focus-server', async (_event, rawId): Promise<boolean> => {
    const id = requireString(rawId, '服务器 ID')
    await pet.focusServer(id)
    return true
  })

  handle('pet:focus-session', async (_event, rawServerId, rawSessionId): Promise<boolean> => {
    const serverId = requireString(rawServerId, '服务器 ID')
    const sessionId = requireString(rawSessionId, '会话 ID')
    await pet.focusSession(serverId, sessionId)
    return true
  })

  handle('pet:hide', async (): Promise<boolean> => {
    await pet.hide()
    refreshMenu()
    refreshTray()
    return true
  })

  handle('pet:open-manager', (): boolean => {
    showManager()
    return true
  })

  handle('pet:pack', () => getPetPackInfo())

  handle('pet:open-pack-dir', async (): Promise<boolean> => {
    await openPetPackDir()
    return true
  })

  handle('app:open-pet-pack', async (): Promise<boolean> => {
    await openPetPackDir()
    return true
  })

  handle('pet:ignore-mouse', (_event, rawIgnore): boolean => {
    pet.setIgnoreMouseEvents(rawIgnore === true)
    return true
  })

  handle('pet:set-expanded', (_event, rawExpanded): boolean => {
    pet.setExpanded(rawExpanded === true)
    return true
  })

  handle('pet:set-compact', (_event, rawCompact): boolean => {
    pet.setCompact(rawCompact === true)
    return true
  })

  const isPetSender = (event: IpcMainEvent): boolean => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    return Boolean(sender && pet.isPetWindow(sender))
  }
  ipcMain.removeAllListeners('pet:card-bounds')
  ipcMain.on('pet:card-bounds', (event, rawBounds) => {
    if (!isPetSender(event)) return
    if (rawBounds === null) {
      pet.setCardBounds(null)
      return
    }
    if (typeof rawBounds !== 'object' || rawBounds === null) return
    const value = rawBounds as Record<string, unknown>
    if (
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      typeof value.width !== 'number' ||
      typeof value.height !== 'number'
    ) {
      return
    }
    pet.setCardBounds({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height
    })
  })
  ipcMain.removeAllListeners('pet:drag-start')
  ipcMain.on('pet:drag-start', (event) => {
    if (isPetSender(event)) pet.beginDrag()
  })
  ipcMain.removeAllListeners('pet:drag-move')
  ipcMain.on('pet:drag-move', (event, screenX, screenY) => {
    if (!isPetSender(event)) return
    if (typeof screenX !== 'number' || typeof screenY !== 'number') return
    pet.dragTo(screenX, screenY)
  })
  ipcMain.removeAllListeners('pet:drag-end')
  ipcMain.on('pet:drag-end', (event) => {
    if (isPetSender(event)) pet.endDrag()
  })

  logInfo(`${APP_NAME} IPC registered`)
}

