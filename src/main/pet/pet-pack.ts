import { app, protocol, shell } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  watch,
  writeFileSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type {
  PetAnimationCategory,
  PetAnimationManifest,
  PetPackInfo
} from '../../shared/pet'
import bundledManifest from '../../renderer/src/pet/animation-manifest.json'
import { logError, logInfo, logWarn } from '../logger'

const PACK_SCHEME = 'dsh-pet-pack'

const bundled = bundledManifest as PetAnimationManifest

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string' && item.trim() !== '')) return null
  return value as string[]
}

function safeActionName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  )
}

function validateCategory(value: unknown): PetAnimationCategory | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  if (typeof value.weight !== 'number' || !Number.isFinite(value.weight)) return null
  const actions = stringList(value.actions)
  if (!actions || actions.length === 0 || !actions.every(safeActionName)) return null
  return { id: value.id, weight: value.weight, actions }
}

function validateManifest(value: unknown): PetAnimationManifest | null {
  if (!isRecord(value)) return null
  const idle = stringList(value.idle)
  const clicks = stringList(value.clicks)
  const workStatus = stringList(value.workStatus)
  if (!idle || idle.length === 0 || !idle.every(safeActionName)) return null
  if (!clicks || clicks.length === 0 || !clicks.every(safeActionName)) return null
  if (!workStatus || workStatus.length < 5 || !workStatus.every(safeActionName)) return null
  if (!Array.isArray(value.categories) || value.categories.length === 0) return null
  const categories: PetAnimationCategory[] = []
  for (const item of value.categories) {
    const category = validateCategory(item)
    if (!category) return null
    categories.push(category)
  }
  return { idle, clicks, categories, workStatus }
}

export function petPackDir(): string {
  return join(app.getPath('userData'), 'pet-pack')
}

export function ensurePetPackDir(): string {
  const dir = petPackDir()
  mkdirSync(join(dir, 'webm'), { recursive: true })
  const readme = join(dir, 'README.txt')
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      [
        'DSH Remote pet pack',
        '',
        'Copy .webm actions into the webm/ directory.',
        'Copy an optional manifest.json into this directory to add/rename actions.',
        'Same-name files override the bundled animation; missing files fall back to bundled.',
        '',
        'manifest.json format:',
        JSON.stringify(bundled, null, 2),
        ''
      ].join('\n'),
      'utf8'
    )
  }
  return dir
}

function externalManifest(): PetAnimationManifest | null {
  try {
    const file = join(petPackDir(), 'manifest.json')
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const manifest = validateManifest(parsed)
    if (!manifest) {
      logWarn(`Pet pack manifest is invalid: ${file}`)
    }
    return manifest
  } catch (error) {
    logWarn(`Pet pack manifest could not be read: ${String(error)}`)
    return null
  }
}

function externalWebmNames(): string[] {
  try {
    const dir = join(petPackDir(), 'webm')
    if (!existsSync(dir)) return []
    return readdirNames(dir)
  } catch {
    return []
  }
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.webm'))
    .map((entry) => entry.name)
}

function externalPortrait(): string | null {
  for (const name of ['portrait.jpg', 'portrait.png']) {
    if (existsSync(join(petPackDir(), name))) return name
  }
  return null
}

export function getPetPackInfo(): PetPackInfo {
  const manifest = externalManifest()
  return {
    manifest: manifest ?? bundled,
    source: manifest ? 'external' : 'bundled',
    baseUrl: `${PACK_SCHEME}://assets`,
    files: externalWebmNames(),
    portrait: externalPortrait()
  }
}

export function registerPetPackScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PACK_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

export function registerPetPackProtocol(): void {
  protocol.handle(PACK_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const [kind, ...rest] = pathname.split('/')
      let file = ''

      if (kind === 'webm' && rest.length === 1 && rest[0].toLowerCase().endsWith('.webm')) {
        if (!safeActionName(rest[0])) return new Response('Not found', { status: 404 })
        file = join(petPackDir(), 'webm', rest[0])
      } else if (
        (kind === 'portrait.jpg' || kind === 'portrait.png') &&
        rest.length === 0
      ) {
        file = join(petPackDir(), kind)
      } else {
        return new Response('Not found', { status: 404 })
      }

      const target = resolve(file)
      const root = resolve(petPackDir())
      if (!target.startsWith(`${root}${sep}`) || !existsSync(target)) {
        return new Response('Not found', { status: 404 })
      }
      const contentType = target.toLowerCase().endsWith('.webm') ? 'video/webm' : 'image/jpeg'
      return new Response(readFileSync(target), {
        headers: { 'content-type': contentType, 'cache-control': 'no-store' }
      })
    } catch (error) {
      logError('Pet pack protocol failed', error)
      return new Response('Not found', { status: 404 })
    }
  })
}

export function startPetPackWatcher(onChange: () => void): () => void {
  ensurePetPackDir()
  let timer: NodeJS.Timeout | undefined
  let closed = false
  const watcher = watch(petPackDir(), { recursive: true }, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!closed) {
        logInfo('Pet pack changed; reloading pet window')
        onChange()
      }
    }, 350)
  })
  watcher.on('error', (error) => logWarn(`Pet pack watcher failed: ${String(error)}`))
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

export async function openPetPackDir(): Promise<void> {
  const dir = ensurePetPackDir()
  const error = await shell.openPath(dir)
  if (error) logError(`Could not open pet pack directory: ${error}`)
}
