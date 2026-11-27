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
}

const ACTIVE_REFRESH_MS = 3000
const IDLE_REFRESH_MS = 10_000

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
    try {
      const result = await this.ctx.remote.session.list({})
      if (!result?.ok) {
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

      const pending: DshSessionSummary[] = []
      for (const session of this.sessions) {
        const cached = this.stateCache.get(session.sessionId)
        const needsState =
          session.running === true ||
          session.agentAvailable === true ||
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
            if (state?.ok && Array.isArray(state.value?.pendingInput)) {
              const values = state.value.pendingInput.filter(
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
          } catch {
            // Approval state is a best-effort enrichment; session.list remains authoritative.
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, () => worker())
      )

      if (this.status !== 'online') this.setStatus('online')
      this.emitSnapshot()
    } catch (error) {
      if (this.stopped) return
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
    const active = this.sessions.some(
      (session) =>
        session.running === true ||
        session.agentAvailable === true ||
        session.pendingInput?.some(
          (input) => input === 'approval' || input === 'question'
        ) === true
    )
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        void this.refreshSessions()
      },
      active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS
    )
  }

  private startWorkspaceFollow(): void {
    if (!this.ctx || this.stopped) return
    void (async () => {
      try {
        const stream = this.ctx.remote.workspace.follow(this.abort.signal)
        for await (const frame of stream) {
          if (this.stopped) break
          const next = applyWorkspaceFrame(this.workspace, frame)
          if (next === this.workspace) continue
          this.workspace = next
          this.emitSnapshot()
        }
      } catch (error) {
        if (this.stopped || this.abort.signal.aborted) return
        this.setStatus(isAuthError(error) ? 'auth-required' : 'offline', errorText(error))
        logWarn(`Pet workspace stream failed for ${this.server.baseUrl}: ${errorText(error)}`)
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
