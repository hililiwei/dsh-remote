import type {
  AppInfo,
  AppSettings,
  SaveServerResult,
  ServerInput,
  ServerProfile,
  TabInfo,
  TestResult,
  TestServerInput,
  WindowContext,
  DshRemoteApi
} from '@shared/types'

/**
 * The preload bridge is the only way the local renderer talks to Electron.
 * During development the main/preload processes may not be ready yet, so every
 * method is looked up at call time instead of assuming the bridge exists.
 */
type Bridge = Partial<DshRemoteApi>

export class DesktopUnavailableError extends Error {
  constructor(method: string) {
    super(`本地主进程尚未就绪（缺少 ${method} 接口）。请稍后重试，或重新启动 DSH Remote。`)
    this.name = 'DesktopUnavailableError'
  }
}

export function emptySettings(): AppSettings {
  return {
    version: 1,
    servers: [],
    openTabs: [],
    autoConnect: true,
    closeToTray: false,
    theme: 'system',
    windowBounds: {}
  }
}

function bridge(): Bridge | undefined {
  const candidate = (window as unknown as { dshRemote?: unknown }).dshRemote
  if (typeof candidate !== 'object' || candidate === null) return undefined
  return candidate as Bridge
}

export function isDesktopAvailable(): boolean {
  return bridge() !== undefined
}

function requireMethod<K extends keyof DshRemoteApi>(method: K): DshRemoteApi[K] {
  const source = bridge()
  if (!source) throw new DesktopUnavailableError(String(method))

  const value = source[method]
  if (typeof value !== 'function') throw new DesktopUnavailableError(String(method))

  return value.bind(source) as DshRemoteApi[K]
}

export const api = {
  isDesktopAvailable,

  getWindowContext(): Promise<WindowContext> {
    const source = bridge()
    if (typeof source?.getWindowContext === 'function') return source.getWindowContext()
    return Promise.resolve({ view: 'manager' })
  },

  getAppInfo(): Promise<AppInfo | null> {
    const source = bridge()
    if (typeof source?.getAppInfo === 'function') return source.getAppInfo()
    return Promise.resolve(null)
  },

  getSettings(): Promise<AppSettings> {
    const source = bridge()
    if (typeof source?.getSettings === 'function') return source.getSettings()
    return Promise.resolve(emptySettings())
  },

  listServers(): Promise<ServerProfile[]> {
    const source = bridge()
    if (typeof source?.listServers === 'function') return source.listServers()
    return Promise.resolve([])
  },

  saveServer(input: ServerInput): Promise<SaveServerResult> {
    return requireMethod('saveServer')(input)
  },

  deleteServer(id: string): Promise<void> {
    return requireMethod('deleteServer')(id)
  },

  setDefaultServer(id: string | null): Promise<AppSettings> {
    return requireMethod('setDefaultServer')(id)
  },

  testServer(input: TestServerInput): Promise<TestResult> {
    return requireMethod('testServer')(input)
  },

  connectServer(id: string, tokenUrl?: string): Promise<void> {
    return requireMethod('connectServer')(id, tokenUrl)
  },

  submitAuth(tokenUrl: string) {
    return requireMethod('submitAuth')(tokenUrl)
  },

  cancelAuth(): Promise<void> {
    return requireMethod('cancelAuth')()
  },

  clearServerSession(id: string): Promise<void> {
    return requireMethod('clearServerSession')(id)
  },

  updateSettings(
    patch: Partial<Pick<AppSettings, 'autoConnect' | 'closeToTray' | 'theme'>> & {
      shellWidth?: number | null
    }
  ): Promise<AppSettings> {
    return requireMethod('updateSettings')(patch)
  },

  openManager(): Promise<void> {
    return requireMethod('openManager')()
  },

  openExternal(url: string): Promise<void> {
    return requireMethod('openExternal')(url)
  },

  listTabs(): Promise<TabInfo[]> {
    const source = bridge()
    if (typeof source?.listTabs === 'function') return source.listTabs()
    return Promise.resolve([])
  },

  activateTab(id: string): Promise<void> {
    return requireMethod('activateTab')(id)
  },

  closeTab(id: string): Promise<void> {
    return requireMethod('closeTab')(id)
  },

  addTab(): Promise<void> {
    return requireMethod('addTab')()
  },

  reloadTab(id: string): Promise<void> {
    return requireMethod('reloadTab')(id)
  },

  showTabMenu(id: string): Promise<void> {
    return requireMethod('showTabMenu')(id)
  },

  onTabsChanged(callback: (tabs: TabInfo[]) => void): () => void {
    const source = bridge()
    if (typeof source?.onTabsChanged !== 'function') return () => undefined
    const unsubscribe = source.onTabsChanged(callback)
    return typeof unsubscribe === 'function' ? unsubscribe : () => undefined
  },

  onServersChanged(callback: (servers: ServerProfile[]) => void): () => void {
    const source = bridge()
    if (typeof source?.onServersChanged !== 'function') return () => undefined

    const unsubscribe = source.onServersChanged(callback)
    return typeof unsubscribe === 'function' ? unsubscribe : () => undefined
  },

  onSettingsChanged(callback: (settings: AppSettings) => void): () => void {
    const source = bridge()
    if (typeof source?.onSettingsChanged !== 'function') return () => undefined

    const unsubscribe = source.onSettingsChanged(callback)
    return typeof unsubscribe === 'function' ? unsubscribe : () => undefined
  }
}

/**
 * Turn IPC failures into text that is safe and useful in the UI. Main-process
 * errors arrive wrapped like `Error invoking remote method 'x': Error: ...`.
 */
export function describeError(error: unknown): string {
  if (error instanceof DesktopUnavailableError) return error.message

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const raw = (error as { message: unknown }).message
    if (typeof raw === 'string' && raw.trim() !== '') {
      const cleaned = raw
        .trim()
        .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
        .trim()
      if (cleaned !== '') return cleaned
    }
  }

  if (typeof error === 'string' && error.trim() !== '') return error.trim()
  return '操作失败，请重试。'
}
