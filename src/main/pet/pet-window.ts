import { BaseWindow, BrowserWindow, screen, type Rectangle } from 'electron'
import type { PetCardBounds, PetSize, PetSnapshot } from '../../shared/pet'
import type { WindowBounds } from '../../shared/types'
import { APP_NAME } from '../../shared/constants'
import type { ConfigStore } from '../config-store'
import { logError } from '../logger'
import { petPreloadFile } from '../paths'
import { loadPetRenderer } from '../renderer-loader'
import { setWindowContext } from '../window-registry'

export interface PetDimensions {
  width: number
  height: number
  expandedHeight: number
  buttonWidth: number
  buttonHeight: number
  cardWidth: number
}

export const PET_DIMENSIONS: Record<PetSize, PetDimensions> = {
  small: {
    width: 480,
    height: 360,
    expandedHeight: 820,
    buttonWidth: 400,
    buttonHeight: 240,
    cardWidth: 440
  },
  medium: {
    width: 600,
    height: 430,
    expandedHeight: 960,
    buttonWidth: 500,
    buttonHeight: 300,
    cardWidth: 540
  },
  large: {
    width: 720,
    height: 510,
    expandedHeight: 1120,
    buttonWidth: 600,
    buttonHeight: 360,
    cardWidth: 640
  }
}
const PET_MARGIN = 20

export const PET_SIZE = {
  width: PET_DIMENSIONS.medium.width,
  height: PET_DIMENSIONS.medium.height
}
export const PET_EXPANDED_HEIGHT = PET_DIMENSIONS.medium.expandedHeight

export interface PetWindowController {
  show(): void
  hide(): void
  toggle(): void
  isVisible(): boolean
  send(snapshot: PetSnapshot): void
  setAlwaysOnTop(enabled: boolean): void
  setIgnoreMouseEvents(ignore: boolean): void
  setExpanded(expanded: boolean): void
  setPetSize(size: PetSize): void
  setCardBounds(bounds: PetCardBounds | null): void
  beginDrag(): void
  dragTo(screenX: number, screenY: number): void
  endDrag(): void
  isPetWindow(win: BrowserWindow): boolean
  destroy(): void
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

function defaultBounds(size: PetSize): Rectangle {
  const dims = PET_DIMENSIONS[size]
  const area = screen.getPrimaryDisplay().workArea
  return {
    width: dims.width,
    height: dims.height,
    x: Math.round(area.x + area.width - dims.width - PET_MARGIN),
    y: Math.round(area.y + area.height - dims.height - PET_MARGIN)
  }
}

function restoredPetBounds(store: ConfigStore, size: PetSize): Rectangle {
  const dims = PET_DIMENSIONS[size]
  const saved = store.getSettings().windowBounds.pet
  if (!saved || saved.x === undefined || saved.y === undefined) return defaultBounds(size)
  if (!visibleOnSomeDisplay(saved)) return defaultBounds(size)
  const area = screen.getPrimaryDisplay().workArea
  const x = Math.min(
    Math.max(saved.x, area.x),
    Math.max(area.x, area.x + area.width - dims.width)
  )
  const y = Math.min(
    Math.max(saved.y + saved.height - dims.height, area.y),
    Math.max(area.y, area.y + area.height - dims.height)
  )
  return {
    width: dims.width,
    height: dims.height,
    x,
    y
  }
}

export function createPetWindow(store: ConfigStore): PetWindowController {
  let win: BrowserWindow | null = null
  let latestSnapshot: PetSnapshot | null = null
  let wantedVisible = true
  let forceClose = false
  let alwaysOnTop = store.getSettings().pet.alwaysOnTop
  let petSize = store.getSettings().pet.size
  let saveTimer: NodeJS.Timeout | undefined
  let dragStart: { cursor: { x: number; y: number }; bounds: Rectangle } | null = null
  let expanded = false
  let cardBounds: Rectangle | null = null
  
  const bounds = restoredPetBounds(store, petSize)
  const initialDims = PET_DIMENSIONS[petSize]
  // A hidden owned window keeps the pet out of the Windows taskbar even when
  // Chromium ignores skipTaskbar for a transparent always-on-top window.
  const owner =
    process.platform === 'win32'
      ? new BaseWindow({
          show: false,
          width: 1,
          height: 1,
          frame: false,
          skipTaskbar: true,
          focusable: false
        })
      : null
  win = new BrowserWindow({
    ...bounds,
    ...(owner ? { parent: owner } : {}),
    minWidth: initialDims.width,
    minHeight: initialDims.height,
    maxWidth: initialDims.width,
    maxHeight: initialDims.expandedHeight,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop,
    hasShadow: false,
    show: false,
    title: `${APP_NAME} Pet`,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: petPreloadFile(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  const current = win
  setWindowContext(current.webContents.id, { view: 'pet' })
  current.setSkipTaskbar(true)
  try {
    current.setAlwaysOnTop(alwaysOnTop, 'floating')
  } catch {
    current.setAlwaysOnTop(alwaysOnTop)
  }
  if (process.platform === 'darwin') {
    current.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  current.setFocusable(true)
  current.setIgnoreMouseEvents(true, { forward: true })

  let topGuard: NodeJS.Timeout | undefined
  const startTopGuard = (): void => {
    if (topGuard !== undefined) clearInterval(topGuard)
    topGuard = setInterval(() => {
      if (current.isDestroyed() || !alwaysOnTop) return
      try {
        current.setSkipTaskbar(true)
        if (!current.isAlwaysOnTop()) current.setAlwaysOnTop(true, 'floating')
      } catch {
        // The window may be closing.
      }
    }, 1000)
  }
  const stopTopGuard = (): void => {
    if (topGuard !== undefined) clearInterval(topGuard)
    topGuard = undefined
  }
  if (alwaysOnTop) startTopGuard()

  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  current.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  current.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) logError(`Pet renderer console: ${message}`)
  })
  current.webContents.on('preload-error', (_event, preloadPath, error) => {
    logError(`Pet preload failed (${preloadPath}): ${error.message}`)
  })
  current.webContents.on('did-fail-load', (_event, code, description) => {
    logError(`Pet renderer failed to load (${code}): ${description}`)
  })
  current.webContents.on('did-finish-load', () => {
    current.setSkipTaskbar(true)
    current.setIgnoreMouseEvents(true, { forward: true })
    if (latestSnapshot && !current.isDestroyed()) {
      current.webContents.send('pet:snapshot', latestSnapshot)
    }
    if (latestSnapshot && !current.isVisible() && wantedVisible) {
      current.showInactive()
    }
    })
  current.webContents.on('render-process-gone', (_event, details) => {
    logError(`Pet renderer gone: ${details.reason}`)
    if (!forceClose && !current.isDestroyed()) current.hide()
  })

  current.once('ready-to-show', () => {
    current.setSkipTaskbar(true)
    current.setIgnoreMouseEvents(true, { forward: true })
    if (wantedVisible && !current.isDestroyed()) {
      current.showInactive()
      current.setSkipTaskbar(true)
    }

  })
  current.on('show', () => {
    current.setSkipTaskbar(true)
    current.setIgnoreMouseEvents(true, { forward: true })

  })
  
  

  const scheduleBoundsSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (current.isDestroyed()) return
      const { x, y, width, height } = current.getBounds()
      void store.rememberBounds('pet', { x, y, width, height }).catch(() => undefined)
    }, 500)
  }
  current.on('move', scheduleBoundsSave)
  current.on('resize', scheduleBoundsSave)
  current.on('close', (event) => {
    if (forceClose) return
    event.preventDefault()
    current.hide()
  })
  current.on('closed', () => {
    stopTopGuard()
    if (owner && !owner.isDestroyed()) owner.destroy()
    if (win === current) win = null
  })

  void loadPetRenderer(current).catch((error) => {
    logError('Failed to load pet renderer', error)
  })

  const controller: PetWindowController = {
    show(): void {
      wantedVisible = true
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.setSkipTaskbar(true)
      win.setIgnoreMouseEvents(true, { forward: true })
      win.showInactive()
      win.setSkipTaskbar(true)
    },
    hide(): void {
      wantedVisible = false
        if (!win || win.isDestroyed()) return
      win.hide()
    },
    toggle(): void {
      if (!win || win.isDestroyed()) return
      if (win.isVisible()) controller.hide()
      else controller.show()
    },
    isVisible(): boolean {
      return Boolean(win && !win.isDestroyed() && win.isVisible())
    },
    send(snapshot: PetSnapshot): void {
      latestSnapshot = snapshot
      if (!win || win.isDestroyed()) return
      if (!win.webContents.isDestroyed()) win.webContents.send('pet:snapshot', snapshot)
    },
    setAlwaysOnTop(enabled: boolean): void {
      alwaysOnTop = enabled
      if (!win || win.isDestroyed()) return
      try {
        win.setAlwaysOnTop(enabled, 'floating')
      } catch {
        win.setAlwaysOnTop(enabled)
      }
      win.setSkipTaskbar(true)
      if (enabled) startTopGuard()
      else stopTopGuard()
    },
    setIgnoreMouseEvents(ignore: boolean): void {
      if (!win || win.isDestroyed()) return
      if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
      else win.setIgnoreMouseEvents(false)
    },
    beginDrag(): void {
      if (!win || win.isDestroyed()) return
      dragStart = {
        cursor: screen.getCursorScreenPoint(),
        bounds: win.getBounds()
      }
    },
    dragTo(screenX: number, screenY: number): void {
      if (!win || win.isDestroyed() || !dragStart) return
      const dx = Math.round(screenX - dragStart.cursor.x)
      const dy = Math.round(screenY - dragStart.cursor.y)
      win.setBounds(
        {
          ...dragStart.bounds,
          x: dragStart.bounds.x + dx,
          y: dragStart.bounds.y + dy
        },
        false
      )
    },
    endDrag(): void {
      dragStart = null
      scheduleBoundsSave()
    },
    setExpanded(nextExpanded: boolean): void {
      expanded = nextExpanded
      if (!nextExpanded) cardBounds = null
      if (!win || win.isDestroyed()) return
      const dims = PET_DIMENSIONS[petSize]
      const currentBounds = win.getBounds()
      const workArea = screen.getDisplayMatching(currentBounds).workArea
      const height = nextExpanded
        ? Math.min(dims.expandedHeight, Math.max(dims.height, workArea.height - PET_MARGIN * 2))
        : dims.height
      const bottom = currentBounds.y + currentBounds.height
      const y = Math.max(workArea.y, Math.min(bottom - height, workArea.y + workArea.height - height))
      const x = Math.min(
        Math.max(currentBounds.x, workArea.x),
        Math.max(workArea.x, workArea.x + workArea.width - dims.width)
      )
      win.setBounds({ x, y, width: dims.width, height }, false)
    },
    setPetSize(size: PetSize): void {
      if (size === petSize) return
      petSize = size
      cardBounds = null
      if (!win || win.isDestroyed()) return
      const dims = PET_DIMENSIONS[size]
      win.setMinimumSize(dims.width, dims.height)
      win.setMaximumSize(dims.width, dims.expandedHeight)
      const currentBounds = win.getBounds()
      const workArea = screen.getDisplayMatching(currentBounds).workArea
      const height = expanded
        ? Math.min(dims.expandedHeight, Math.max(dims.height, workArea.height - PET_MARGIN * 2))
        : dims.height
      const bottom = currentBounds.y + currentBounds.height
      const y = Math.max(workArea.y, Math.min(bottom - height, workArea.y + workArea.height - height))
      const x = Math.min(
        Math.max(currentBounds.x, workArea.x),
        Math.max(workArea.x, workArea.x + workArea.width - dims.width)
      )
      win.setBounds({ x, y, width: dims.width, height }, false)
    },
    setCardBounds(bounds: PetCardBounds | null): void {
      if (
        !bounds ||
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height)
      ) {
        cardBounds = null
      } else {
        cardBounds = {
          x: bounds.x,
          y: bounds.y,
          width: Math.max(0, bounds.width),
          height: Math.max(0, bounds.height)
        }
      }
    },
    isPetWindow(candidate: BrowserWindow): boolean {
      return Boolean(win && !win.isDestroyed() && candidate === win)
    },
    destroy(): void {
      forceClose = true
      wantedVisible = false
      stopTopGuard()
        if (saveTimer) clearTimeout(saveTimer)
      if (win && !win.isDestroyed()) win.destroy()
      win = null
      if (owner && !owner.isDestroyed()) owner.destroy()
    }
  }
  return controller
}
