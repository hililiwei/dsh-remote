import { BrowserWindow } from 'electron'
import type { AppSettings, ServerProfile } from '../../shared/types'
import type { PetServerSnapshot, PetServerStatus, PetSnapshot } from '../../shared/pet'
import type { ConfigStore } from '../config-store'
import { logError, logInfo, logWarn } from '../logger'
import type { SessionManager } from '../session-manager'
import type { TabManager } from '../tab-manager'
import { advanceCompletionState, aggregateServerSnapshot, mergePetSnapshots } from './aggregate'
import { HeadlessDshClient, type HeadlessServerSnapshot } from './headless-client'
import { createPetWindow, type PetWindowController } from './pet-window'

interface ServerState {
  status: PetServerStatus
  message?: string
  sessions: HeadlessServerSnapshot['sessions']
  workspaces: HeadlessServerSnapshot['workspaces']
  archivedSessionIds: string[]
}

export interface PetManagerDeps {
  store: ConfigStore
  sessions: SessionManager
  tabs: TabManager
  onChanged: () => void
}

export class PetManager {
  private readonly clients = new Map<string, HeadlessDshClient>()
  private readonly states = new Map<string, ServerState>()
  private readonly previousRunning = new Map<string, Map<string, boolean>>()
  private readonly done = new Map<string, Set<string>>()
  private window: PetWindowController | null = null
  private settings: AppSettings
  private enabled = false
  private snapshot: PetSnapshot = {
    servers: [],
    openTabs: [],
    counts: { needsYou: 0, running: 0, done: 0, idle: 0, total: 0 },
    petSize: 'medium',
    updatedAt: Date.now()
  }
  

  constructor(private readonly deps: PetManagerDeps) {
    this.settings = deps.store.getSettings()
    this.snapshot.petSize = this.settings.pet.size
  }

  start(): void {
    this.apply(this.settings)
  }

  apply(settings: AppSettings): void {
    const wasEnabled = this.enabled
    this.settings = settings
    this.enabled = settings.pet.enabled
    if (this.enabled && !this.window) {
      this.window = createPetWindow(this.deps.store)
      this.window.setAlwaysOnTop(settings.pet.alwaysOnTop)
    }
    if (this.window) {
      this.window.setAlwaysOnTop(settings.pet.alwaysOnTop)
      this.window.setPetSize(settings.pet.size)
    }
    if (this.enabled) {
      this.ensureWindowShown()
      this.reconcileServers()
    } else if (wasEnabled) {
      this.stopAll()
      this.window?.destroy()
      this.window = null
    }
    this.publish()
  }

  async setEnabled(enabled: boolean): Promise<AppSettings> {
    const settings = await this.deps.store.updateSettings({ pet: { enabled } })
    this.apply(settings)
    this.deps.onChanged()
    return settings
  }

  async setAlwaysOnTop(enabled: boolean): Promise<AppSettings> {
    const settings = await this.deps.store.updateSettings({ pet: { alwaysOnTop: enabled } })
    this.apply(settings)
    this.deps.onChanged()
    return settings
  }

  async toggle(): Promise<void> {
    await this.setEnabled(!this.enabled)
  }

  getSnapshot(): PetSnapshot {
    return this.snapshot
  }

  isPetWindow(win: BrowserWindow): boolean {
    return Boolean(this.window?.isPetWindow(win))
  }

  isVisible(): boolean {
    return Boolean(this.window?.isVisible())
  }

  hide(): Promise<AppSettings> {
    return this.setEnabled(false)
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.window?.setIgnoreMouseEvents(ignore)
  }

  setExpanded(expanded: boolean): void {
    this.window?.setExpanded(expanded)
  }

  setCardBounds(bounds: Parameters<PetWindowController['setCardBounds']>[0]): void {
    this.window?.setCardBounds(bounds)
  }

  beginDrag(): void {
    this.window?.beginDrag()
  }

  dragTo(screenX: number, screenY: number): void {
    this.window?.dragTo(screenX, screenY)
  }

  endDrag(): void {
    this.window?.endDrag()
  }

  async focusServer(serverId: string): Promise<void> {
    const server = this.deps.store.getServer(serverId)
    if (!server) return
    this.done.set(serverId, new Set())
    await this.deps.tabs.open(server).catch((error) => {
      logWarn(`Pet failed to focus server ${serverId}: ${String(error)}`)
    })
    this.recompute(server)
    this.publish()
  }

  /** Restart one server after a fresh login/cookie exchange. */
  async refreshServer(serverId: string): Promise<void> {
    this.settings = this.deps.store.getSettings()
    const server = this.deps.store.getServer(serverId)
    if (!server) {
      await this.removeServer(serverId)
      return
    }
    await this.stopClient(serverId)
    await this.startClient(server)
  }

  async refreshServers(): Promise<void> {
    this.settings = this.deps.store.getSettings()
    await this.reconcileServers()
  }

  /** Called by the tab bar after a tab opens, closes, or becomes active. */
handleTabsChanged(): void {
    this.publish()
  }

  /** Destroy the pet when no ordinary app window remains, so quitting behaves normally. */
  handleWindowClosed(): void {
    if (!this.window) return
    const others = BrowserWindow.getAllWindows().filter((win) => !this.window?.isPetWindow(win))
    if (others.length === 0) {
      this.window.destroy()
      this.window = null
    }
  }

  async destroy(): Promise<void> {
    this.stopAll()
    this.window?.destroy()
    this.window = null
  }

  private ensureWindowShown(): void {
    if (!this.window) return
    this.window.show()
    this.window.send(this.snapshot)
  }

  private async reconcileServers(): Promise<void> {
    if (!this.enabled) return
    const servers = new Map(this.settings.servers.map((server) => [server.id, server]))
    for (const id of [...this.clients.keys()]) {
      if (!servers.has(id)) await this.removeServer(id)
    }
    for (const server of servers.values()) {
      if (!this.clients.has(server.id)) await this.startClient(server)
    }
  }

  private async startClient(server: ServerProfile): Promise<void> {
    if (!this.enabled || this.clients.has(server.id)) return
    await this.deps.sessions.applyProxy(server)
    const state: ServerState = {
      status: 'connecting',
      sessions: [],
      workspaces: [],
      archivedSessionIds: []
    }
    this.states.set(server.id, state)
    this.publish()
    const client = new HeadlessDshClient(server, this.deps.sessions.get(server), {
      onSnapshot: (snapshot) => this.handleSnapshot(server, snapshot),
      onStatus: (status, message) => this.handleStatus(server, status, message)
    })
    this.clients.set(server.id, client)
    try {
      await client.start()
    } catch (error) {
      logError(`Pet client failed to start for ${server.name}`, error)
      this.handleStatus(server, 'error', error instanceof Error ? error.message : String(error))
    }
  }

  private async stopClient(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    this.clients.delete(serverId)
    if (client) await client.stop()
  }

  private async removeServer(serverId: string): Promise<void> {
    await this.stopClient(serverId)
    this.states.delete(serverId)
    this.previousRunning.delete(serverId)
    this.done.delete(serverId)
    this.publish()
  }

  private handleStatus(server: ServerProfile, status: PetServerStatus, message?: string): void {
    const state = this.states.get(server.id)
    if (!state) return
    state.status = status
    if (message) state.message = message
    else delete state.message
    this.recompute(server)
    this.publish()
  }

  private handleSnapshot(server: ServerProfile, snapshot: HeadlessServerSnapshot): void {
    const state = this.states.get(server.id)
    if (!state) return
    state.sessions = snapshot.sessions
    state.workspaces = snapshot.workspaces
    state.archivedSessionIds = snapshot.archivedSessionIds
    this.recompute(server)
    this.publish()
  }

  private recompute(server: ServerProfile): void {
    const state = this.states.get(server.id)
    if (!state) return
    const previous = this.previousRunning.get(server.id) ?? new Map<string, boolean>()
    const done = advanceCompletionState({
      previousRunning: previous,
      sessions: state.sessions,
      doneIds: this.done.get(server.id) ?? new Set(),
      serverViewed: this.isServerViewed(server.id)
    })
    this.done.set(server.id, done)
    const nextRunning = new Map<string, boolean>()
    for (const session of state.sessions) {
      if (session.running === true) nextRunning.set(session.sessionId, true)
    }
    this.previousRunning.set(server.id, nextRunning)
  }

  private isServerViewed(serverId: string): boolean {
    if (this.deps.tabs.activeServerId() !== serverId) return false
    const shell = this.deps.tabs.getShellWindow()
    if (!shell || shell.isDestroyed() || !shell.isVisible() || shell.isMinimized()) return false
    return BrowserWindow.getFocusedWindow() === shell
  }

  private publish(): void {
    const servers: PetServerSnapshot[] = []
    for (const [id, state] of this.states) {
      const server = this.deps.store.getServer(id)
      if (!server) continue
      servers.push(
        aggregateServerSnapshot({
          server,
          status: state.status,
          ...(state.message ? { message: state.message } : {}),
          sessions: state.sessions,
          workspaces: state.workspaces,
          archivedSessionIds: state.archivedSessionIds,
          doneIds: this.done.get(id) ?? new Set()
        })
      )
    }
    const openTabs = this.deps.tabs.listTabs().map((tab) => ({
      id: tab.id,
      name: tab.name,
      active: tab.active
    }))
    this.snapshot = mergePetSnapshots(servers, openTabs, this.settings.pet.size)
    this.window?.send(this.snapshot)
  }

  private stopAll(): void {
    for (const client of this.clients.values()) {
      void client.stop()
    }
    this.clients.clear()
  }
}