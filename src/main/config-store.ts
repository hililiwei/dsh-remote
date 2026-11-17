import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CONFIG_VERSION } from '../shared/constants'
import type {
  AppSettings,
  ProxyMode,
  ServerInput,
  ServerProfile,
  ThemeMode,
  WindowBounds
} from '../shared/types'
import { defaultNameForUrl, parseConnectionInput, UrlInputError } from './url-tools'

export class ConfigStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigStoreError'
  }
}

const THEMES: ThemeMode[] = ['system', 'light', 'dark']
const PROXY_MODES: ProxyMode[] = ['system', 'direct']

function defaults(): AppSettings {
  return {
    version: 1,
    servers: [],
    openTabs: [],
    autoConnect: true,
    closeToTray: false,
    theme: 'system',
    windowBounds: {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function validateBounds(value: unknown): WindowBounds | undefined {
  if (!isRecord(value)) return undefined
  const width = value.width
  const height = value.height
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
    return undefined
  }
  const bounds: WindowBounds = {
    width: Math.round(width),
    height: Math.round(height)
  }
  if (typeof value.x === 'number' && Number.isFinite(value.x)) bounds.x = Math.round(value.x)
  if (typeof value.y === 'number' && Number.isFinite(value.y)) bounds.y = Math.round(value.y)
  if (typeof value.maximized === 'boolean') bounds.maximized = value.maximized
  return bounds
}

function validateServer(value: unknown): ServerProfile | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || value.id.trim() === '') return undefined
  if (typeof value.name !== 'string') return undefined
  if (typeof value.baseUrl !== 'string') return undefined

  let baseUrl: string
  try {
    baseUrl = parseConnectionInput(value.baseUrl).baseUrl
  } catch {
    return undefined
  }

  const proxyMode = PROXY_MODES.includes(value.proxyMode as ProxyMode)
    ? (value.proxyMode as ProxyMode)
    : 'system'
  const allowInvalidCertificate =
    typeof value.allowInvalidCertificate === 'boolean' ? value.allowInvalidCertificate : false
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt !== ''
      ? value.createdAt
      : new Date().toISOString()

  return {
    id: value.id,
    name: value.name.trim() === '' ? defaultNameForUrl(baseUrl) : value.name.trim(),
    baseUrl,
    proxyMode,
    allowInvalidCertificate,
    createdAt,
    ...(typeof value.lastUsedAt === 'string' && value.lastUsedAt !== ''
      ? { lastUsedAt: value.lastUsedAt }
      : {})
  }
}

function sanitize(raw: unknown): AppSettings {
  const settings = defaults()
  if (!isRecord(raw)) return settings

  if (Array.isArray(raw.servers)) {
    const seen = new Set<string>()
    for (const candidate of raw.servers) {
      const server = validateServer(candidate)
      if (!server || seen.has(server.baseUrl)) continue
      seen.add(server.baseUrl)
      settings.servers.push(server)
    }
  }

  if (typeof raw.defaultServerId === 'string') {
    settings.defaultServerId = settings.servers.some(
      (server) => server.id === raw.defaultServerId
    )
      ? raw.defaultServerId
      : undefined
  }

  if (Array.isArray(raw.openTabs)) {
    const known = new Set(settings.servers.map((server) => server.id))
    for (const id of raw.openTabs) {
      if (typeof id !== 'string' || !known.has(id) || settings.openTabs.includes(id)) continue
      settings.openTabs.push(id)
    }
  }
  if (typeof raw.activeTabId === 'string' && settings.openTabs.includes(raw.activeTabId)) {
    settings.activeTabId = raw.activeTabId
  }

  if (typeof raw.autoConnect === 'boolean') settings.autoConnect = raw.autoConnect
  if (typeof raw.closeToTray === 'boolean') settings.closeToTray = raw.closeToTray
  if (THEMES.includes(raw.theme as ThemeMode)) settings.theme = raw.theme as ThemeMode

  if (isRecord(raw.windowBounds)) {
    for (const [key, value] of Object.entries(raw.windowBounds)) {
      const bounds = validateBounds(value)
      if (bounds) settings.windowBounds[key] = bounds
    }
  }

  return settings
}

export class ConfigStore {
  private settings: AppSettings = defaults()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.settings = sanitize(JSON.parse(raw))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        await this.backupCorruptFile()
      }
      this.settings = defaults()
    }
    this.loaded = true
    return this.getSettings()
  }

  getSettings(): AppSettings {
    return clone(this.settings)
  }

  getServer(id: string): ServerProfile | undefined {
    const server = this.settings.servers.find((item) => item.id === id)
    return server ? clone(server) : undefined
  }

  async saveServer(input: ServerInput): Promise<{
    server: ServerProfile
    inputHadToken: boolean
    warnings: string[]
  }> {
    await this.ensureLoaded()

    let parsed: ReturnType<typeof parseConnectionInput>
    try {
      parsed = parseConnectionInput(input.url)
    } catch (error) {
      if (error instanceof UrlInputError) throw new ConfigStoreError(error.message)
      throw error
    }

    const name = input.name.trim() || defaultNameForUrl(parsed.baseUrl)
    const proxyMode = input.proxyMode ?? 'system'
    const allowInvalidCertificate = input.allowInvalidCertificate ?? false

    if (!PROXY_MODES.includes(proxyMode)) {
      throw new ConfigStoreError('代理模式无效。')
    }

    let server: ServerProfile
    if (input.id) {
      const existing = this.settings.servers.find((item) => item.id === input.id)
      if (!existing) throw new ConfigStoreError('服务器不存在或已被删除。')
      const duplicate = this.settings.servers.find(
        (item) => item.id !== input.id && item.baseUrl === parsed.baseUrl
      )
      if (duplicate) throw new ConfigStoreError('这个服务器地址已经存在。')
      existing.name = name
      existing.baseUrl = parsed.baseUrl
      existing.proxyMode = proxyMode
      existing.allowInvalidCertificate = allowInvalidCertificate
      server = existing
    } else {
      if (this.settings.servers.some((item) => item.baseUrl === parsed.baseUrl)) {
        throw new ConfigStoreError('这个服务器地址已经存在。')
      }
      server = {
        id: randomUUID(),
        name,
        baseUrl: parsed.baseUrl,
        proxyMode,
        allowInvalidCertificate,
        createdAt: new Date().toISOString()
      }
      this.settings.servers.push(server)
    }

    await this.persist()
    return {
      server: clone(server),
      inputHadToken: parsed.hadToken,
      warnings: parsed.warnings
    }
  }

  async deleteServer(id: string): Promise<void> {
    await this.ensureLoaded()
    const index = this.settings.servers.findIndex((server) => server.id === id)
    if (index === -1) return
    this.settings.servers.splice(index, 1)
    if (this.settings.defaultServerId === id) delete this.settings.defaultServerId
    this.settings.openTabs = this.settings.openTabs.filter((tabId) => tabId !== id)
    if (this.settings.activeTabId === id) delete this.settings.activeTabId
    delete this.settings.windowBounds[id]
    await this.persist()
  }

  async setOpenTabs(ids: string[], activeTabId?: string): Promise<AppSettings> {
    await this.ensureLoaded()
    const known = new Set(this.settings.servers.map((server) => server.id))
    const next: string[] = []
    for (const id of ids) {
      if (!known.has(id) || next.includes(id)) continue
      next.push(id)
    }
    this.settings.openTabs = next
    if (activeTabId && next.includes(activeTabId)) {
      this.settings.activeTabId = activeTabId
    } else {
      delete this.settings.activeTabId
    }
    await this.persist()
    return this.getSettings()
  }

  async setDefaultServer(id: string | null): Promise<AppSettings> {
    await this.ensureLoaded()
    if (id === null) {
      delete this.settings.defaultServerId
    } else {
      if (!this.settings.servers.some((server) => server.id === id)) {
        throw new ConfigStoreError('服务器不存在或已被删除。')
      }
      this.settings.defaultServerId = id
    }
    await this.persist()
    return this.getSettings()
  }

  async markUsed(id: string): Promise<void> {
    await this.ensureLoaded()
    const server = this.settings.servers.find((item) => item.id === id)
    if (!server) return
    server.lastUsedAt = new Date().toISOString()
    await this.persist()
  }

  async updateSettings(
    patch: Partial<Pick<AppSettings, 'autoConnect' | 'closeToTray' | 'theme'>>
  ): Promise<AppSettings> {
    await this.ensureLoaded()
    if (typeof patch.autoConnect === 'boolean') this.settings.autoConnect = patch.autoConnect
    if (typeof patch.closeToTray === 'boolean') this.settings.closeToTray = patch.closeToTray
    if (THEMES.includes(patch.theme as ThemeMode)) this.settings.theme = patch.theme as ThemeMode
    await this.persist()
    return this.getSettings()
  }

  async rememberBounds(key: string, bounds: WindowBounds): Promise<void> {
    await this.ensureLoaded()
    const validated = validateBounds(bounds)
    if (!validated) return
    this.settings.windowBounds[key] = validated
    await this.persist()
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.settings, null, 2)
    const run = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temp, snapshot, 'utf8')
      try {
        await rename(temp, this.filePath)
      } catch {
        await rm(this.filePath, { force: true })
        await rename(temp, this.filePath)
      }
    }
    this.writeQueue = this.writeQueue.then(run, run)
    await this.writeQueue
  }

  private async backupCorruptFile(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
    } catch {
      // A missing/unreadable file is already handled by loading defaults.
    }
  }
}