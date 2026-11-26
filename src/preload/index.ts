import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppInfo,
  AppSettings,
  AuthSubmitResult,
  DshRemoteApi,
  SaveServerResult,
  ServerProfile,
  ServerInput,
  TabInfo,
  TestResult,
  TestServerInput,
  WindowContext
} from '../shared/types'

const api: DshRemoteApi = {
  getWindowContext: () => ipcRenderer.invoke('window:context') as Promise<WindowContext>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  listServers: () => ipcRenderer.invoke('servers:list') as Promise<ServerProfile[]>,
  saveServer: (input: ServerInput) =>
    ipcRenderer.invoke('servers:save', input) as Promise<SaveServerResult>,
  deleteServer: (id: string) => ipcRenderer.invoke('servers:delete', id) as Promise<void>,
  setDefaultServer: (id: string | null) =>
    ipcRenderer.invoke('servers:set-default', id) as Promise<AppSettings>,
  testServer: (input: TestServerInput) =>
    ipcRenderer.invoke('servers:test', input) as Promise<TestResult>,
  connectServer: (id: string, tokenUrl?: string) =>
    ipcRenderer.invoke('servers:connect', id, tokenUrl) as Promise<void>,
  submitAuth: (tokenUrl: string) =>
    ipcRenderer.invoke('auth:submit', tokenUrl) as Promise<AuthSubmitResult>,
  cancelAuth: () => ipcRenderer.invoke('auth:cancel') as Promise<void>,
  clearServerSession: (id: string) =>
    ipcRenderer.invoke('app:clear-session', id) as Promise<void>,
  updateSettings: (patch) =>
    ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>,
  openManager: () => ipcRenderer.invoke('app:open-manager') as Promise<void>,
  openPetPackDir: () => ipcRenderer.invoke('app:open-pet-pack') as Promise<void>,
  openExternal: (url: string) =>
    ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  listTabs: () => ipcRenderer.invoke('tabs:list') as Promise<TabInfo[]>,
  activateTab: (id: string) => ipcRenderer.invoke('tabs:activate', id) as Promise<void>,
  closeTab: (id: string) => ipcRenderer.invoke('tabs:close', id) as Promise<void>,
  addTab: () => ipcRenderer.invoke('tabs:add') as Promise<void>,
  reloadTab: (id: string) => ipcRenderer.invoke('tabs:reload', id) as Promise<void>,
  showTabMenu: (id: string) => ipcRenderer.invoke('tabs:menu', id) as Promise<void>,
  onTabsChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, tabs: TabInfo[]): void => {
      callback(tabs)
    }
    ipcRenderer.on('tabs:changed', listener)
    return () => ipcRenderer.removeListener('tabs:changed', listener)
  },
  onServersChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, servers: ServerProfile[]): void => {
      callback(servers)
    }
    ipcRenderer.on('servers:changed', listener)
    return () => ipcRenderer.removeListener('servers:changed', listener)
  },
  onSettingsChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, settings: AppSettings): void => {
      callback(settings)
    }
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
}

contextBridge.exposeInMainWorld('dshRemote', api)