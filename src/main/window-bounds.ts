import { screen, type BrowserWindow } from 'electron'
import type { WindowBounds } from '../shared/types'
import type { ConfigStore } from './config-store'

interface FallbackSize {
  width: number
  height: number
}

function visibleOnSomeDisplay(bounds: WindowBounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapX = Math.min(bounds.x! + bounds.width, area.x + area.width) - Math.max(bounds.x!, area.x)
    const overlapY = Math.min(bounds.y! + bounds.height, area.y + area.height) - Math.max(bounds.y!, area.y)
    return overlapX >= 120 && overlapY >= 80
  })
}

export function restoredBounds(
  store: ConfigStore,
  key: string,
  fallback: FallbackSize
): { width: number; height: number; x?: number; y?: number } {
  const saved = store.getSettings().windowBounds[key]
  if (!saved) return { ...fallback }
  const width = Math.max(fallback.width, saved.width)
  const height = Math.max(fallback.height, saved.height)
  if (visibleOnSomeDisplay({ ...saved, width, height })) {
    return { width, height, x: saved.x, y: saved.y }
  }
  return { width, height }
}

export function snapshotBounds(win: BrowserWindow): WindowBounds {
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    ...(win.isMaximized() ? { maximized: true } : {})
  }
}

export function attachBoundsPersistence(
  store: ConfigStore,
  key: string,
  win: BrowserWindow
): void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    if (win.isDestroyed()) return
    void store.rememberBounds(key, snapshotBounds(win)).catch(() => undefined)
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}