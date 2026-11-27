export type PetSize = 'small' | 'medium' | 'large'

export const PET_SIZE_VALUES = ['small', 'medium', 'large'] as const

export function isPetSize(value: unknown): value is PetSize {
  return value === 'small' || value === 'medium' || value === 'large'
}

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

export interface PetAnimationCategory {
  id: string
  weight: number
  actions: string[]
}

export interface PetAnimationManifest {
  idle: string[]
  clicks: string[]
  categories: PetAnimationCategory[]
  workStatus: string[]
}

export interface PetPackInfo {
  manifest: PetAnimationManifest
  source: 'bundled' | 'external'
  baseUrl: string
  files: string[]
  portrait: string | null
}

export interface PetSnapshot {
  servers: PetServerSnapshot[]
  openTabs: PetOpenTab[]
  counts: PetCounts
  petSize: PetSize
  updatedAt: number
}

export interface DshSessionSummary {
  sessionId: string
  updatedAt?: number
  running?: boolean
  agentAvailable?: boolean
  pendingInput?: Array<'approval' | 'question' | 'other'>
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

export interface PetCardBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DshPetApi {
  getSnapshot(): Promise<PetSnapshot>
  onSnapshot(callback: (snapshot: PetSnapshot) => void): () => void
  focusServer(serverId: string): Promise<void>
  focusSession(serverId: string, sessionId: string): Promise<void>
  hide(): Promise<void>
  openManager(): Promise<void>
  getPack(): Promise<PetPackInfo>
  openPackDir(): Promise<void>
  setIgnoreMouseEvents(ignore: boolean): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
  setCompact(compact: boolean): Promise<void>
  setCardBounds(bounds: PetCardBounds | null): void
  beginDrag(): void
  dragTo(screenX: number, screenY: number): void
  endDrag(): void
}