import type { WindowContext } from '../shared/types'

const contexts = new Map<number, WindowContext>()

export function setWindowContext(webContentsId: number, context: WindowContext): void {
  contexts.set(webContentsId, context)
}

export function getWindowContext(webContentsId: number): WindowContext | undefined {
  return contexts.get(webContentsId)
}

export function clearWindowContext(webContentsId: number): void {
  contexts.delete(webContentsId)
}