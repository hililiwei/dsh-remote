import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppInfo,
  AppSettings,
  AuthSubmitResult,
  DshRemoteApi,
  SaveServerResult,
  ServerProfile,
  ServerInput,
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
  openExternal: (url: string) =>
    ipcRenderer.invoke('app:open-external', url) as Promise<void>,
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