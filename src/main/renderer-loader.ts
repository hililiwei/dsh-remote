import type { BrowserWindow } from 'electron'
import { rendererIndexFile } from './paths'

export type RendererQuery = Record<string, string | undefined>

/**
 * Load the local renderer in development (Vite dev server) or production
 * (built `out/renderer/index.html`), preserving the view query string.
 */
export function loadRenderer(win: BrowserWindow, query: RendererQuery): Promise<void> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value)
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    url.search = params.toString()
    return win.loadURL(url.toString())
  }

  const search: Record<string, string> = {}
  for (const [key, value] of params.entries()) search[key] = value
  return win.loadFile(rendererIndexFile(), { query: search })
}