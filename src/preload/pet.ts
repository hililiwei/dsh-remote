import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DshPetApi, PetSnapshot } from '../shared/pet'

const api: DshPetApi = {
  getSnapshot: () => ipcRenderer.invoke('pet:snapshot') as Promise<PetSnapshot>,
  onSnapshot: (callback) => {
    const listener = (_event: IpcRendererEvent, snapshot: PetSnapshot): void => {
      callback(snapshot)
    }
    ipcRenderer.on('pet:snapshot', listener)
    return () => ipcRenderer.removeListener('pet:snapshot', listener)
  },
  focusServer: (serverId) => ipcRenderer.invoke('pet:focus-server', serverId) as Promise<void>,
  hide: () => ipcRenderer.invoke('pet:hide') as Promise<void>,
  openManager: () => ipcRenderer.invoke('pet:open-manager') as Promise<void>,
  setIgnoreMouseEvents: (ignore) =>
    ipcRenderer.invoke('pet:ignore-mouse', ignore) as Promise<void>,
  setExpanded: (expanded) => ipcRenderer.invoke('pet:set-expanded', expanded) as Promise<void>,
  beginDrag: () => ipcRenderer.send('pet:drag-start'),
  dragTo: (screenX, screenY) => ipcRenderer.send('pet:drag-move', screenX, screenY),
  endDrag: () => ipcRenderer.send('pet:drag-end')
}

contextBridge.exposeInMainWorld('dshPet', api)