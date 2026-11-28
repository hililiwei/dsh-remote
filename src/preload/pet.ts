import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DshPetApi, PetSnapshot } from '../shared/pet'

const api: DshPetApi = {
  getSnapshot: () => ipcRenderer.invoke('pet:snapshot') as Promise<PetSnapshot>,
  getDetails: () => ipcRenderer.invoke('pet:details') as Promise<PetSnapshot>,
  onSnapshot: (callback) => {
    const listener = (_event: IpcRendererEvent, snapshot: PetSnapshot): void => {
      callback(snapshot)
    }
    ipcRenderer.on('pet:snapshot', listener)
    return () => ipcRenderer.removeListener('pet:snapshot', listener)
  },
  focusServer: (serverId) => ipcRenderer.invoke('pet:focus-server', serverId) as Promise<void>,
  focusSession: (serverId, sessionId) =>
    ipcRenderer.invoke('pet:focus-session', serverId, sessionId) as Promise<void>,
  hide: () => ipcRenderer.invoke('pet:hide') as Promise<void>,
  openManager: () => ipcRenderer.invoke('pet:open-manager') as Promise<void>,
  getPack: () => ipcRenderer.invoke('pet:pack') as Promise<import('../shared/pet').PetPackInfo>,
  openPackDir: () => ipcRenderer.invoke('pet:open-pack-dir') as Promise<void>,
  setIgnoreMouseEvents: (ignore) =>
    ipcRenderer.invoke('pet:ignore-mouse', ignore) as Promise<void>,
  setExpanded: (expanded) => ipcRenderer.invoke('pet:set-expanded', expanded) as Promise<void>,
  setCompact: (compact) => ipcRenderer.invoke('pet:set-compact', compact) as Promise<void>,
  setCardBounds: (bounds) => ipcRenderer.send('pet:card-bounds', bounds),
  beginDrag: () => ipcRenderer.send('pet:drag-start'),
  dragTo: (screenX, screenY) => ipcRenderer.send('pet:drag-move', screenX, screenY),
  endDrag: () => ipcRenderer.send('pet:drag-end')
}

contextBridge.exposeInMainWorld('dshPet', api)