export type ProxyMode = 'system' | 'direct'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ServerStatus = 'online' | 'auth-required' | 'forbidden' | 'error' | 'offline'
export type TabStatus = 'loading' | 'online' | 'auth-required' | 'error'
export type AuthReason = 'first' | 'expired'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface ServerProfile {
  id: string
  name: string
  baseUrl: string
  proxyMode: ProxyMode
  allowInvalidCertificate: boolean
  createdAt: string
  lastUsedAt?: string
}

export interface ServerInput {
  id?: string
  name: string
  url: string
  proxyMode?: ProxyMode
  allowInvalidCertificate?: boolean
}

export interface AppSettings {
  version: 1
  servers: ServerProfile[]
  defaultServerId?: string
  /** Server ids whose tabs were open when the app last quit. */
  openTabs: string[]
  activeTabId?: string
  /** Fixed main-window width in px; undefined means use the saved/automatic width. */
  shellWidth?: number
  autoConnect: boolean
  closeToTray: boolean
  theme: ThemeMode
  windowBounds: Record<string, WindowBounds>
}

export interface TabInfo {
  id: string
  name: string
  url: string
  status: TabStatus
  active: boolean
}

export interface TestResult {
  status: ServerStatus
  httpStatus?: number
  message?: string
}

export interface SaveServerResult {
  server: ServerProfile
  inputHadToken: boolean
  warnings: string[]
}

export interface AppInfo {
  version: string
  platform: string
  isDev: boolean
}

export type WindowView = 'manager' | 'auth' | 'tabs'

export interface WindowContext {
  view: WindowView
  serverId?: string
  reason?: AuthReason
}

export interface AuthSubmitResult {
  ok: boolean
  message?: string
}

export interface TestServerInput {
  id?: string
  url: string
  proxyMode?: ProxyMode
  allowInvalidCertificate?: boolean
}

export interface DshRemoteApi {
  getWindowContext(): Promise<WindowContext>
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<AppSettings>
  listServers(): Promise<ServerProfile[]>
  saveServer(input: ServerInput): Promise<SaveServerResult>
  deleteServer(id: string): Promise<void>
  setDefaultServer(id: string | null): Promise<AppSettings>
  testServer(input: TestServerInput): Promise<TestResult>
  connectServer(id: string, tokenUrl?: string): Promise<void>
  submitAuth(tokenUrl: string): Promise<AuthSubmitResult>
  cancelAuth(): Promise<void>
  clearServerSession(id: string): Promise<void>
  updateSettings(
    patch: Partial<Pick<AppSettings, 'autoConnect' | 'closeToTray' | 'theme'>> & {
      shellWidth?: number | null
    }
  ): Promise<AppSettings>
  openManager(): Promise<void>
  openExternal(url: string): Promise<void>
  listTabs(): Promise<TabInfo[]>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  addTab(): Promise<void>
  reloadTab(id: string): Promise<void>
  showTabMenu(id: string): Promise<void>
  onServersChanged(callback: (servers: ServerProfile[]) => void): () => void
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void
  onTabsChanged(callback: (tabs: TabInfo[]) => void): () => void
}

declare global {
  interface Window {
    dshRemote: DshRemoteApi
  }
}
