import type { DshWorkspaceBaseline, DshWorkspaceItem } from './types'

export interface WorkspaceState {
  items: DshWorkspaceItem[]
  archivedSessionIds: string[]
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = Object.freeze({
  items: [],
  archivedSessionIds: []
})

function normalizeWorkspace(value: unknown): DshWorkspaceItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.workspaceId !== 'string' || record.workspaceId === '') return undefined
  return {
    workspaceId: record.workspaceId,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
    sessionIds: Array.isArray(record.sessionIds)
      ? record.sessionIds.filter((id): id is string => typeof id === 'string')
      : []
  }
}

function normalizeBaseline(value: unknown): WorkspaceState {
  if (typeof value !== 'object' || value === null) return EMPTY_WORKSPACE_STATE
  const record = value as Partial<DshWorkspaceBaseline>
  return {
    items: Array.isArray(record.items)
      ? record.items.flatMap((item) => {
          const workspace = normalizeWorkspace(item)
          return workspace ? [workspace] : []
        })
      : [],
    archivedSessionIds: Array.isArray(record.archivedSessionIds)
      ? record.archivedSessionIds.filter((id): id is string => typeof id === 'string')
      : []
  }
}

function replaceWorkspace(items: DshWorkspaceItem[], next: DshWorkspaceItem): DshWorkspaceItem[] {
  const index = items.findIndex((item) => item.workspaceId === next.workspaceId)
  if (index === -1) return [...items, next]
  return items.map((item, position) => (position === index ? next : item))
}

export function applyWorkspaceFrame(state: WorkspaceState, frame: unknown): WorkspaceState {
  if (typeof frame !== 'object' || frame === null) return state
  const record = frame as Record<string, unknown>
  switch (record.type) {
    case 'baseline':
    case 'replace':
      return normalizeBaseline(record.value)
    case 'upsert': {
      const workspace = normalizeWorkspace(record.workspace)
      return workspace ? { ...state, items: replaceWorkspace(state.items, workspace) } : state
    }
    case 'remove': {
      if (typeof record.workspaceId !== 'string') return state
      return {
        ...state,
        items: state.items.filter((item) => item.workspaceId !== record.workspaceId)
      }
    }
    case 'order': {
      if (!Array.isArray(record.workspaceIds)) return state
      const rank = new Map<string, number>()
      record.workspaceIds.forEach((id, index) => {
        if (typeof id === 'string') rank.set(id, index)
      })
      return {
        ...state,
        items: [...state.items].sort(
          (left, right) =>
            (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER)
        )
      }
    }
    case 'archived':
      return {
        ...state,
        archivedSessionIds: Array.isArray(record.archivedSessionIds)
          ? record.archivedSessionIds.filter((id): id is string => typeof id === 'string')
          : state.archivedSessionIds
      }
    case 'pinned':
      return state
    default:
      return state
  }
}