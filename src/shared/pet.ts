export type PetSessionState = 'needs-you' | 'running' | 'done' | 'idle'

export type PetServerStatus =
  | 'connecting'
  | 'online'
  | 'auth-required'
  | 'offline'
  | 'error'

export interface PetCounts {
  needsYou: number
  running: number
  done: number
  idle: number
  total: number
}

export interface PetWorkspace {
  id: string
  title: string
  pathLabel?: string
}

export interface PetSession {
  id: string
  serverId: string
  serverName: string
  title: string
  workspaceId: string
  workspaceTitle: string
  state: PetSessionState
  updatedAt: number
}

export interface PetServerSnapshot {
  serverId: string
  serverName: string
  baseUrl: string
  status: PetServerStatus
  message?: string
  workspaces: PetWorkspace[]
  sessions: PetSession[]
  counts: PetCounts
}

export interface PetOpenTab {
  id: string
  name: string
  active: boolean
}

export interface PetSnapshot {
  servers: PetServerSnapshot[]
  openTabs: PetOpenTab[]
  counts: PetCounts
  updatedAt: number
}

export interface DshSessionSummary {
  sessionId: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
  origin?: string
  cwd?: string
  title?: string
  displayTitle?: string
  projections?: {
    kind?: string
    asOfSeq?: number
    values?: Record<string, unknown>
  }
}

export interface DshWorkspaceItem {
  workspaceId: string
  title?: string
  path?: string
  sessionIds?: string[]
}

export interface DshWorkspaceBaseline {
  items: DshWorkspaceItem[]
  archivedSessionIds: string[]
}

export const EMPTY_COUNTS: PetCounts = Object.freeze({
  needsYou: 0,
  running: 0,
  done: 0,
  idle: 0,
  total: 0
})

export function addCounts(left: PetCounts, right: PetCounts): PetCounts {
  return {
    needsYou: left.needsYou + right.needsYou,
    running: left.running + right.running,
    done: left.done + right.done,
    idle: left.idle + right.idle,
    total: left.total + right.total
  }
}

export interface DshPetApi {
  getSnapshot(): Promise<PetSnapshot>
  onSnapshot(callback: (snapshot: PetSnapshot) => void): () => void
  focusServer(serverId: string): Promise<void>
  hide(): Promise<void>
  openManager(): Promise<void>
  setIgnoreMouseEvents(ignore: boolean): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
  beginDrag(): void
  dragTo(screenX: number, screenY: number): void
  endDrag(): void
}