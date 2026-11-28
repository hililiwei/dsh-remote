import type { Session } from 'electron'
import { WebSocket } from 'ws'
import type { ServerProfile } from '../../shared/types'
import { logError, logInfo, logWarn } from '../logger'
import type {
  DshSessionSummary,
  DshWorkspaceItem,
  PetServerStatus
} from './types'
import {
  applyWorkspaceFrame,
  EMPTY_WORKSPACE_STATE,
  type WorkspaceState
} from './workspace-state'

export interface HeadlessServerSnapshot {
  sessions: DshSessionSummary[]
  workspaces: DshWorkspaceItem[]
  archivedSessionIds: string[]
}

export interface HeadlessClientCallbacks {
  onSnapshot: (snapshot: HeadlessServerSnapshot) => void
  onStatus: (status: PetServerStatus, message?: string) => void
  onCompletion?: (sessionId: string) => void
}

const FOREGROUND_REFRESH_MS = 3_000
const BACKGROUND_REFRESH_MS = 10_000
const INTERACTION_REFRESH_MS = 2_000
const MAX_REFRESH_BACKOFF_MS = 60_000
const WAIT_TIMEOUT_MS = 30_000

function workspaceMembershipSignature(state: {
  items: Array<{ sessionIds?: string[] }>
  archivedSessionIds: string[]
}): string {
  return [
    ...state.items.flatMap((item) => item.sessionIds ?? []),
    ...state.archivedSessionIds
  ].sort().join('\n')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Keep only the projection fields the pet actually reads. */
function slimProjectionValues(values: unknown): Record<string, unknown> {
  const source = record(values)
  if (!source) return {}
  const questions = record(source.userQuestions)
  const active = questions?.active
  const plan = record(source.plan)
  return {
    ...(Array.isArray(active) && active.length > 0
      ? { userQuestions: { active: [true] } }
      : {}),
    ...(plan?.pending === true ? { plan: { pending: true } } : {}),
    ...(typeof source.title === 'string' ? { title: source.title } : {})
  }
}

function slimSession(raw: unknown): DshSessionSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  if (typeof item.sessionId !== 'string') return null
  const projections = record(item.projections)
  const values = slimProjectionValues(projections?.values)
  return {
    sessionId: item.sessionId,
    ...(typeof item.updatedAt === 'number' ? { updatedAt: item.updatedAt } : {}),
    ...(typeof item.running === 'boolean' ? { running: item.running } : {}),
    ...(typeof item.agentAvailable === 'boolean' ? { agentAvailable: item.agentAvailable } : {}),
    ...(typeof item.blank === 'boolean' ? { blank: item.blank } : {}),
    ...(typeof item.origin === 'string' ? { origin: item.origin } : {}),
    ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
    ...(typeof item.title === 'string' ? { title: item.title } : {}),
    ...(typeof item.displayTitle === 'string' ? { displayTitle: item.displayTitle } : {}),
    ...(Object.keys(values).length > 0
      ? {
          projections: {
            ...(typeof projections?.kind === 'string' ? { kind: projections.kind } : {}),
            ...(typeof projections?.asOfSeq === 'number' ? { asOfSeq: projections.asOfSeq } : {}),
            values
          }
        }
      : {})
  }
}

interface DshModules {
  Context: new () => unknown
  installConnection: (ctx: unknown, options: unknown) => void
  typert: { apply: (ctx: unknown) => void }
  gateway: { apply: (ctx: unknown) => void }
  sessionRemote: unknown
  workspaceRemote: unknown
}

let dshModulesPromise: Promise<DshModules> | undefined

function loadDshModules(): Promise<DshModules> {
  dshModulesPromise ??= (async () => {
    const [{ Context }, connection, typert, gateway, sessionRemote, workspaceRemote] =
      await Promise.all([
        import('@deepseek-ai/cordis'),
        import('@deepseek-ai/dsh-client-connection/client'),
        import('@deepseek-ai/dsh-typert-registry/client'),
        import('@deepseek-ai/dsh-api-gateway/client'),
        import('@deepseek-ai/dsh-api-session-controller/remote'),
        import('@deepseek-ai/dsh-api-workspace-controller/remote')
      ])
    return {
      Context: Context as unknown as DshModules['Context'],
      installConnection: connection.installConnection as DshModules['installConnection'],
      typert: typert as unknown as DshModules['typert'],
      gateway: gateway as unknown as DshModules['gateway'],
      sessionRemote: sessionRemote.default,
      workspaceRemote: workspaceRemote.default
    }
  })()
  return dshModulesPromise
}

class WsAdapter {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(private readonly ws: WebSocket) {
    ws.on('open', () => this.emit('open', {}))
    ws.on('message', (data) => this.emit('message', { data: data.toString() }))
    ws.on('close', () => this.emit('close', {}))
    ws.on('error', (error) => this.emit('error', error))
  }

  get readyState(): number {
    return this.ws.readyState
  }

  send(data: string): void {
    this.ws.send(data)
  }

  close(code?: number, reason?: string): void {
    try {
      this.ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }

  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { once?: boolean }
  ): void {
    const set = this.listeners.get(type) ?? new Set()
    this.listeners.set(type, set)
    const wrapped = options?.once
      ? (event: unknown) => {
          set.delete(wrapped)
          listener(event)
        }
      : listener
    set.add(wrapped)
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        listener(event)
      } catch (error) {
        logWarn(`Pet websocket listener failed: ${String(error)}`)
      }
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isAuthError(value: unknown): boolean {
  const text = errorText(value).toLowerCase()
  return text.includes('401') || text.includes('unauthorized') || text.includes('authentication')
}

function joinCookieHeader(cookies: Electron.Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

/**
 * One headless DSH client for one server. It deliberately mounts only the
 * generated session/workspace Remote namespaces, not the browser UI.
 */
export class HeadlessDshClient {
  private ctx: any = null
  private connection: any = null
  private abort = new AbortController()
  private sockets = new Set<WsAdapter>()
  private timer: NodeJS.Timeout | undefined
  private refreshing = false
  private stopped = false
  private workspace: WorkspaceState = EMPTY_WORKSPACE_STATE
  private sessions: DshSessionSummary[] = []
  private disposers: Array<() => Promise<void> | void> = []
  private status: PetServerStatus = 'connecting'
  private lastEmit = 0
  private lastDigest = ''
  private lastRefreshAt = 0
  private refreshBackoff = 0
  private foreground = false
  private readonly watchers = new Map<string, AbortController>()
  private readonly eventWatchers = new Map<string, AbortController>()
  private readonly probeTimers = new Map<string, NodeJS.Timeout>()
  private readonly watcherCooldown = new Map<string, number>()
  private readonly stateCache = new Map<
    string,
    { updatedAt: number | undefined; running: boolean; pendingInput: string[] }
  >()

  constructor(
    private readonly server: ServerProfile,
    private readonly browserSession: Session,
    private readonly callbacks: HeadlessClientCallbacks
  ) {}

  get serverId(): string {
    return this.server.id
  }

  get currentStatus(): PetServerStatus {
    return this.status
  }

  /** Mark the server as the foreground tab so task starts are noticed quickly. */
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return
    this.foreground = foreground
    this.refreshBackoff = 0
    if (foreground) this.refreshNow(true)
    else this.scheduleRefresh()
  }

  /** Ask for a prompt reconciliation after the user interacts with a server. */
  refreshNow(force = false): void {
    if (this.stopped || this.refreshing) return
    const now = Date.now()
    if (!force && now - this.lastRefreshAt < INTERACTION_REFRESH_MS) return
    this.refreshBackoff = 0
    void this.refreshSessions()
  }

  async start(): Promise<void> {
    if (this.server.allowInvalidCertificate) {
      // `session.fetch` does not emit the page-level certificate-error event.
      // This session belongs to one saved server, and the user explicitly
      // trusted that server's certificate, so accept its TLS chain here.
      this.browserSession.setCertificateVerifyProc((_request, callback) => {
        callback(0)
      })
    }
    const cookies = await this.browserSession.cookies.get({ url: this.server.baseUrl })
    if (cookies.length === 0) {
      this.setStatus('auth-required', '没有这个服务器的登录 cookie，请先在标签页里连接一次。')
      return
    }
    const cookie = joinCookieHeader(cookies)
    const origin = new URL(this.server.baseUrl).origin
    const baseUrl = this.server.baseUrl.endsWith('/')
      ? this.server.baseUrl
      : `${this.server.baseUrl}/`

    try {
      const modules = await loadDshModules()
      const ctx = new modules.Context() as any
      this.ctx = ctx
      modules.installConnection(ctx, {
        interactions: 'answer',
        location: { hostname: new URL(baseUrl).hostname },
        transport: {
          streamBaseUrl: baseUrl,
          fetch: this.createFetch(),
          createWebSocket: (url: string) => this.createWebSocket(url, cookie, origin)
        }
      })
      modules.typert.apply(ctx)
      modules.gateway.apply(ctx)
      this.connection = ctx.get('connection')
      const remote = ctx.remote
      this.disposers.push(await remote.$mount(modules.sessionRemote))
      this.disposers.push(await remote.$mount(modules.workspaceRemote))
      await this.waitForGeneration()
      if (this.stopped) return
      this.setStatus('online')
      this.startWorkspaceFollow()
      this.startControlStream()
      await this.refreshSessions()
      logInfo(`Pet headless client connected to ${this.server.baseUrl}`)
    } catch (error) {
      if (this.stopped) return
      this.setStatus(isAuthError(error) ? 'auth-required' : 'error', errorText(error))
      logWarn(`Pet headless client failed for ${this.server.baseUrl}: ${errorText(error)}`)
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const controller of this.watchers.values()) controller.abort()
    for (const controller of this.eventWatchers.values()) controller.abort()
    for (const timer of this.probeTimers.values()) clearTimeout(timer)
    this.watchers.clear()
    this.eventWatchers.clear()
    this.probeTimers.clear()
    this.browserSession.setCertificateVerifyProc(null)
    this.abort.abort()
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
    for (const dispose of this.disposers.reverse()) {
      try {
        await dispose()
      } catch {
        // Already disposed with the context.
      }
    }
    this.disposers = []
    try {
      if (typeof this.ctx?.dispose === 'function') await this.ctx.dispose()
      else if (typeof this.ctx?.scope?.dispose === 'function') await this.ctx.scope.dispose()
    } catch (error) {
      logWarn(`Pet headless client dispose failed: ${errorText(error)}`)
    }
    this.ctx = null
    this.connection = null
  }

  private createFetch(): (input: string | URL, init: RequestInit) => Promise<Response> {
    return async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), this.server.baseUrl).toString()
      return this.browserSession.fetch(url, {
        ...init,
        credentials: 'include'
      } as RequestInit)
    }
  }

  private createWebSocket(url: string, cookie: string, origin: string): WsAdapter {
    const ws = new WebSocket(url, {
      origin,
      headers: { cookie },
      rejectUnauthorized: !this.server.allowInvalidCertificate
    })
    const adapter = new WsAdapter(ws)
    this.sockets.add(adapter)
    ws.on('close', () => this.sockets.delete(adapter))
    ws.on('error', (error) => {
      if (this.stopped) return
      this.setStatus(isAuthError(error) ? 'auth-required' : 'offline', errorText(error))
    })
    return adapter
  }

  private waitForGeneration(): Promise<void> {
    return new Promise((resolve, reject) => {
      const connection = this.connection
      if (!connection) {
        reject(new Error('DSH connection service unavailable'))
        return
      }
      const existing = connection.generation.getSnapshot()
      if (existing) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error('DSH headless connection timed out'))
      }, 15_000)
      const check = (): void => {
        if (connection.generation.getSnapshot()) {
          clearTimeout(timer)
          unsubscribe()
          resolve()
        }
      }
      const unsubscribe = connection.generation.subscribe(check)
      check()
      this.abort.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          unsubscribe()
          reject(new Error('stopped'))
        },
        { once: true }
      )
    })
  }

  private async refreshSessions(): Promise<void> {
    if (this.refreshing || this.stopped || !this.ctx) return
    this.refreshing = true
    this.lastRefreshAt = Date.now()
    try {
      const result = await this.ctx.remote.session.list({})
      if (!result?.ok) {
        this.refreshBackoff = this.refreshBackoff === 0
          ? this.baseRefreshMs() * 2
          : Math.min(MAX_REFRESH_BACKOFF_MS, this.refreshBackoff * 2)
        logWarn(`Pet session list failed for ${this.server.baseUrl}: ${errorText(result?.error)}`)
        this.setStatus(
          isAuthError(result?.error) ? 'auth-required' : 'error',
          errorText(result?.error)
        )
        return
      }
      const items = Array.isArray(result.value?.items) ? result.value.items : []
      this.sessions = (items as unknown[])
        .map((item: unknown): DshSessionSummary | null => slimSession(item))
        .filter((item): item is DshSessionSummary => item !== null)

      const present = new Set(this.sessions.map((session) => session.sessionId))
      for (const id of this.stateCache.keys()) {
        if (!present.has(id)) this.stateCache.delete(id)
      }
      for (const [id, controller] of this.eventWatchers) {
        if (!present.has(id)) {
          controller.abort()
          this.eventWatchers.delete(id)
        }
      }

      const pending: DshSessionSummary[] = []
      for (const session of this.sessions) {
        const cached = this.stateCache.get(session.sessionId)
        const hasWatcher = this.watchers.has(session.sessionId)
        const needsState =
          (!hasWatcher && session.agentAvailable === true) ||
          (cached?.pendingInput.length ?? 0) > 0
        if (needsState) pending.push(session)
      }

      const queue = [...pending]
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          const session = queue.shift()
          if (!session) return
          try {
            const state = await this.ctx.remote.session.state({ sessionId: session.sessionId })
            if (state?.ok && state.value) this.applySessionState(session, state.value)
          } catch {
            // Approval state is a best-effort enrichment; session.list remains authoritative.
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, () => worker())
      )

      this.syncWatchers()
      this.refreshBackoff = 0
      if (this.status !== 'online') this.setStatus('online')
      this.emitSnapshot()
    } catch (error) {
      if (this.stopped) return
      this.refreshBackoff = this.refreshBackoff === 0
        ? this.baseRefreshMs() * 2
        : Math.min(MAX_REFRESH_BACKOFF_MS, this.refreshBackoff * 2)
      this.setStatus(isAuthError(error) ? 'auth-required' : 'offline', errorText(error))
      logError(`Pet session refresh failed for ${this.server.baseUrl}`, error)
    } finally {
      this.refreshing = false
      this.scheduleRefresh()
    }
  }

  private scheduleRefresh(): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        void this.refreshSessions()
      },
      this.refreshBackoff > 0 ? this.refreshBackoff : this.baseRefreshMs()
    )
  }

  private baseRefreshMs(): number {
    return this.foreground ? FOREGROUND_REFRESH_MS : BACKGROUND_REFRESH_MS
  }

  private applySessionState(session: DshSessionSummary, state: any): void {
    if (typeof state.running === 'boolean') session.running = state.running
    if (Array.isArray(state.pendingInput)) {
      const values = state.pendingInput.filter(
        (input: unknown): input is 'approval' | 'question' | 'other' =>
          input === 'approval' || input === 'question' || input === 'other'
      )
      session.pendingInput = values
      this.stateCache.set(session.sessionId, {
        updatedAt: session.updatedAt,
        running: session.running === true,
        pendingInput: values
      })
    }
  }

  private syncWatchers(): void {
    const present = new Set(this.sessions.map((session) => session.sessionId))
    for (const [id, controller] of this.watchers) {
      if (!present.has(id)) {
        controller.abort()
        this.watchers.delete(id)
      }
    }
    for (const session of this.sessions) {
      if (session.running !== true) continue
      if (this.watchers.has(session.sessionId)) continue
      if ((this.watcherCooldown.get(session.sessionId) ?? 0) > Date.now()) continue
      this.startWatcher(session)
    }
  }

  private startWatcher(session: DshSessionSummary): void {
    if (!this.ctx || this.stopped) return
    const sessionId = session.sessionId
    const controller = new AbortController()
    this.watchers.set(sessionId, controller)
    void (async () => {
      try {
        while (!this.stopped && !controller.signal.aborted) {
          const result = await this.ctx.remote.session.wait(
            {
              sessionId,
              timeoutMs: WAIT_TIMEOUT_MS,
              maxMessages: 1
            },
            controller.signal
          )
          if (!result?.ok) break
          const current = this.sessions.find((item) => item.sessionId === sessionId)
          if (!current) break
          if (result.value?.state) {
            this.applySessionState(current, result.value.state)
            this.emitSnapshot()
          }
          if (result.value?.reason === 'idle' || result.value?.reason === 'input-required') {
            break
          }
        }
      } catch {
        // Older Hosts may not expose wait; state reconciliation below remains the fallback.
      } finally {
        this.watchers.delete(sessionId)
        this.watcherCooldown.set(sessionId, Date.now() + WAIT_TIMEOUT_MS)
      }
    })()
  }

  private startWorkspaceFollow(): void {
    if (!this.ctx || this.stopped) return
    void (async () => {
      try {
        const stream = this.ctx.remote.workspace.follow(this.abort.signal)
        for await (const frame of stream) {
          if (this.stopped) break
          const previousSignature = workspaceMembershipSignature(this.workspace)
          const next = applyWorkspaceFrame(this.workspace, frame)
          if (next === this.workspace) continue
          this.workspace = next
          if (workspaceMembershipSignature(next) !== previousSignature) {
            this.refreshNow()
          }
          this.emitSnapshot()
        }
      } catch (error) {
        if (this.stopped || this.abort.signal.aborted) return
        this.setStatus(isAuthError(error) ? 'auth-required' : 'offline', errorText(error))
        logWarn(`Pet workspace stream failed for ${this.server.baseUrl}: ${errorText(error)}`)
      }
    })()
  }

  private startControlStream(): void {
    if (!this.ctx || this.stopped) return
    void (async () => {
      try {
        const stream = this.ctx.remote.session.control(this.abort.signal)
        for await (const frame of stream) {
          if (this.stopped) break
          if (frame?.type !== 'projection' || typeof frame.sessionId !== 'string') continue
          this.startEventWatcher(frame.sessionId)
          this.scheduleProbe(frame.sessionId)
        }
      } catch (error) {
        if (this.stopped || this.abort.signal.aborted) return
        // Older Hosts may not expose the control stream; periodic list remains.
        logWarn(`Pet control stream failed for ${this.server.baseUrl}: ${errorText(error)}`)
      }
    })()
  }

  private scheduleProbe(sessionId: string): void {
    if (this.stopped) return
    const existing = this.probeTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.probeTimers.delete(sessionId)
      void this.probeSession(sessionId)
    }, 500)
    this.probeTimers.set(sessionId, timer)
  }

  private async probeSession(sessionId: string): Promise<void> {
    if (!this.ctx || this.stopped) return
    const current = this.sessions.find((session) => session.sessionId === sessionId)
    if (!current) {
      this.refreshNow(true)
      return
    }
    try {
      const state = await this.ctx.remote.session.state({ sessionId })
      if (state?.ok && state.value) {
        this.applySessionState(current, state.value)
        this.syncWatchers()
        this.emitSnapshot()
      }
    } catch {
      // The regular reconciliation remains the fallback.
    }
  }

  private startEventWatcher(sessionId: string): void {
    if (!this.ctx || this.stopped || this.eventWatchers.has(sessionId)) return
    const controller = new AbortController()
    this.eventWatchers.set(sessionId, controller)
    void (async () => {
      try {
        const stream = this.ctx.remote.session.observeEvent(
          { address: { kind: 'session', sessionId } },
          controller.signal
        )
        for await (const frame of stream) {
          if (this.stopped || controller.signal.aborted) return
          if (frame?.type !== 'event') continue
          const type = frame.event?.type
          const current = this.sessions.find((session) => session.sessionId === sessionId)
          if (type === 'turn/start' && current) {
            current.running = true
            this.emitSnapshot()
          } else if (type === 'turn/end' && current) {
            current.running = false
            current.pendingInput = []
            this.callbacks.onCompletion?.(sessionId)
            this.emitSnapshot()
          } else if (type === 'approval/asked' && current) {
            current.pendingInput = ['approval']
            this.emitSnapshot()
          } else if (type === 'approval/decided' && current) {
            current.pendingInput = []
            this.emitSnapshot()
          }
        }
      } catch {
        // Older Hosts may not expose observeEvent; state/list reconciliation remains.
      } finally {
        this.eventWatchers.delete(sessionId)
      }
    })()
  }

  private setStatus(status: PetServerStatus, message?: string): void {
    if (this.status === status && !message) return
    this.status = status
    this.callbacks.onStatus(status, message)
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    if (this.stopped) return
    const now = Date.now()
    const digest = JSON.stringify({
      status: this.status,
      workspaces: this.workspace.items,
      archived: this.workspace.archivedSessionIds,
      sessions: this.sessions.map((session) => [
        session.sessionId,
        session.updatedAt,
        session.running,
        session.agentAvailable,
        session.pendingInput,
        session.projections?.values?.title,
        session.projections?.values?.userQuestions,
        session.projections?.values?.plan
      ])
    })
    if (digest === this.lastDigest) return
    if (now - this.lastEmit < 150 && this.status === 'online') return
    this.lastDigest = digest
    this.lastEmit = now
    this.callbacks.onSnapshot({
      sessions: this.sessions,
      workspaces: this.workspace.items,
      archivedSessionIds: this.workspace.archivedSessionIds
    })
  }
}
