import {
  addCounts,
  EMPTY_COUNTS,
  type DshSessionSummary,
  type DshWorkspaceItem,
  type PetCounts,
  type PetOpenTab,
  type PetServerSnapshot,
  type PetServerStatus,
  type PetSession,
  type PetSessionState,
  type PetSize,
  type PetSkin,
  type PetSnapshot,
  type PetWorkspace
} from './types'

const STATE_RANK: Record<PetSessionState, number> = {
  'needs-you': 0,
  done: 1,
  running: 2,
  idle: 3
}

const OTHER_WORKSPACE_ID = '__other__'

export interface AggregateServerInput {
  server: { id: string; name: string; baseUrl: string }
  status: PetServerStatus
  message?: string
  sessions: readonly DshSessionSummary[]
  workspaces: readonly DshWorkspaceItem[]
  archivedSessionIds: readonly string[]
  doneIds: ReadonlySet<string>
}

export interface CompletionInput {
  previousRunning: ReadonlyMap<string, boolean>
  sessions: readonly DshSessionSummary[]
  doneIds: ReadonlySet<string>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function baseName(path: string | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) ?? ''
}

function projectionValues(summary: DshSessionSummary): Record<string, unknown> {
  return record(summary.projections?.values) ?? {}
}

function activeUserQuestions(values: Record<string, unknown>): boolean {
  const questions = record(values.userQuestions)
  const active = questions?.active
  return Array.isArray(active) && active.length > 0
}

function pendingPlan(values: Record<string, unknown>): boolean {
  return record(values.plan)?.pending === true
}

/** A pending interaction outranks every other state; it is what the user must act on. */
export function hasPendingInteraction(summary: DshSessionSummary): boolean {
  const values = projectionValues(summary)
  return activeUserQuestions(values) || pendingPlan(values)
}

export function sessionTitle(summary: DshSessionSummary): string {
  return (
    stringValue(projectionValues(summary).title) ??
    stringValue(summary.title) ??
    stringValue(summary.displayTitle) ??
    summary.sessionId
  )
}

function initialState(
  summary: DshSessionSummary,
  doneIds: ReadonlySet<string>
): PetSessionState {
  if (hasPendingInteraction(summary)) return 'needs-you'
  if (summary.running === true) return 'running'
  if (doneIds.has(summary.sessionId)) return 'done'
  return 'idle'
}

function isVisible(summary: DshSessionSummary, archived: ReadonlySet<string>): boolean {
  if (!summary.sessionId || summary.blank === true) return false
  if (summary.origin === 'subagent') return false
  return !archived.has(summary.sessionId)
}

function sortSessions(left: PetSession, right: PetSession): number {
  const byState = STATE_RANK[left.state] - STATE_RANK[right.state]
  if (byState !== 0) return byState
  return right.updatedAt - left.updatedAt
}

export function countSessions(sessions: readonly PetSession[]): PetCounts {
  const counts: PetCounts = { ...EMPTY_COUNTS }
  for (const session of sessions) {
    counts.total += 1
    if (session.state === 'needs-you') counts.needsYou += 1
    else if (session.state === 'running') counts.running += 1
    else if (session.state === 'done') counts.done += 1
    else counts.idle += 1
  }
  return counts
}

/**
 * Keep a local completion mark when a session moves from running to idle while
 * the user is elsewhere. Opening the server clears every mark for that server.
 */
export function advanceCompletionState(input: CompletionInput): Set<string> {
  const next = new Set<string>()
  const present = new Set<string>()
  for (const session of input.sessions) {
    present.add(session.sessionId)
    if (session.running === true) continue
    if (input.previousRunning.get(session.sessionId) === true || input.doneIds.has(session.sessionId)) {
      next.add(session.sessionId)
    }
  }
  for (const id of input.doneIds) {
    if (present.has(id)) next.add(id)
  }
  return next
}

export function aggregateServerSnapshot(input: AggregateServerInput): PetServerSnapshot {
  const archived = new Set(input.archivedSessionIds)
  const visible = input.sessions.filter((summary) => isVisible(summary, archived))
  const assigned = new Map<string, DshWorkspaceItem>()
  const workspaces: PetWorkspace[] = []
  const groups: PetWorkspace[] = []

  for (const workspace of input.workspaces) {
    const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
    for (const id of ids) {
      if (assigned.has(id)) continue
      if (!visible.some((summary) => summary.sessionId === id)) continue
      assigned.set(id, workspace)
    }
    if (ids.some((id) => assigned.get(id) === workspace)) {
      const group: PetWorkspace = {
        id: workspace.workspaceId,
        title: workspace.title || baseName(workspace.path) || workspace.workspaceId,
        ...(baseName(workspace.path) ? { pathLabel: baseName(workspace.path) } : {})
      }
      groups.push(group)
      workspaces.push(group)
    }
  }

  const leftovers = visible.filter((summary) => !assigned.has(summary.sessionId))
  if (leftovers.length > 0) {
    const group: PetWorkspace = { id: OTHER_WORKSPACE_ID, title: '其他' }
    groups.push(group)
    workspaces.push(group)
  }

  const sessions: PetSession[] = visible.map((summary) => {
    const workspace = assigned.get(summary.sessionId)
    const group = workspace
      ? groups.find((candidate) => candidate.id === workspace.workspaceId)
      : groups.find((candidate) => candidate.id === OTHER_WORKSPACE_ID)
    return {
      id: summary.sessionId,
      serverId: input.server.id,
      serverName: input.server.name,
      title: sessionTitle(summary),
      workspaceId: group?.id ?? OTHER_WORKSPACE_ID,
      workspaceTitle: group?.title ?? '其他',
      state: initialState(summary, input.doneIds),
      updatedAt: Number.isFinite(summary.updatedAt) ? Number(summary.updatedAt) : 0
    }
  })
  sessions.sort(sortSessions)

  return {
    serverId: input.server.id,
    serverName: input.server.name,
    baseUrl: input.server.baseUrl,
    status: input.status,
    ...(input.message ? { message: input.message } : {}),
    workspaces,
    sessions,
    counts: countSessions(sessions)
  }
}

export function mergePetSnapshots(
  servers: readonly PetServerSnapshot[],
  openTabs: readonly PetOpenTab[] = [],
  petSize: PetSize = 'medium',
  petSkin: PetSkin = 'cartoon'
): PetSnapshot {
  const ordered = [...servers].sort((left, right) =>
    left.serverName.localeCompare(right.serverName, 'zh-CN')
  )
  let counts: PetCounts = { ...EMPTY_COUNTS }
  for (const server of ordered) counts = addCounts(counts, server.counts)
  return {
    servers: ordered,
    openTabs: [...openTabs],
    counts,
    petSize,
    petSkin,
    updatedAt: Date.now()
  }
}

export function emptyPetSnapshot(): PetSnapshot {
  return {
    servers: [],
    openTabs: [],
    counts: { ...EMPTY_COUNTS },
    petSize: 'medium',
    petSkin: 'cartoon',
    updatedAt: Date.now()
  }
}

