import { describe, expect, it } from 'vitest'
import {
  advanceCompletionState,
  aggregateServerSnapshot,
  countSessions,
  mergePetSnapshots,
  sessionTitle
} from '../../src/main/pet/aggregate'
import type { DshSessionSummary, PetSession } from '../../src/main/pet/types'

function summary(patch: Partial<DshSessionSummary> = {}): DshSessionSummary {
  return {
    sessionId: 's1',
    updatedAt: 100,
    running: false,
    blank: false,
    projections: { values: { title: '任务一' } },
    ...patch
  }
}

describe('pet aggregate', () => {
  it('filters blank, subagent and archived sessions', () => {
    const snapshot = aggregateServerSnapshot({
      server: { id: 'server-1', name: '本地', baseUrl: 'http://127.0.0.1:3080/' },
      status: 'online',
      sessions: [
        summary({ sessionId: 'visible' }),
        summary({ sessionId: 'blank', blank: true }),
        summary({ sessionId: 'child', origin: 'subagent' }),
        summary({ sessionId: 'archived' })
      ],
      workspaces: [{ workspaceId: 'w1', title: '工作区', sessionIds: ['visible', 'blank', 'child', 'archived'] }],
      archivedSessionIds: ['archived'],
      doneIds: new Set()
    })

    expect(snapshot.sessions.map((session) => session.id)).toEqual(['visible'])
    expect(snapshot.counts).toEqual({ needsYou: 0, running: 0, done: 0, idle: 1, total: 1 })
  })

  it('ranks needs-you above running, done and idle', () => {
    const snapshot = aggregateServerSnapshot({
      server: { id: 's', name: 'S', baseUrl: 'http://localhost/' },
      status: 'online',
      sessions: [
        summary({ sessionId: 'idle', updatedAt: 1 }),
        summary({ sessionId: 'running', running: true, updatedAt: 2 }),
        summary({ sessionId: 'done', updatedAt: 3 }),
        summary({
          sessionId: 'needs',
          updatedAt: 4,
          projections: { values: { userQuestions: { active: [{ id: 'q' }] } } }
        })
      ],
      workspaces: [],
      archivedSessionIds: [],
      doneIds: new Set(['done'])
    })

    expect(snapshot.sessions.map((session) => session.state)).toEqual([
      'needs-you',
      'done',
      'running',
      'idle'
    ])
    expect(snapshot.counts).toEqual({
      needsYou: 1,
      running: 1,
      done: 1,
      idle: 1,
      total: 4
    })
  })

  it('maps sessions to workspaces and puts unassigned rows in 其他', () => {
    const snapshot = aggregateServerSnapshot({
      server: { id: 's', name: 'S', baseUrl: 'http://localhost/' },
      status: 'online',
      sessions: [
        summary({ sessionId: 'a', updatedAt: 1 }),
        summary({ sessionId: 'b', updatedAt: 2 }),
        summary({ sessionId: 'orphan', updatedAt: 3 })
      ],
      workspaces: [
        {
          workspaceId: 'w1',
          title: '项目甲',
          path: 'D:\\code\\alpha',
          sessionIds: ['a', 'b']
        }
      ],
      archivedSessionIds: [],
      doneIds: new Set()
    })

    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual(['w1', '__other__'])
    expect(snapshot.sessions.find((session) => session.id === 'a')?.workspaceTitle).toBe('项目甲')
    expect(snapshot.sessions.find((session) => session.id === 'orphan')?.workspaceTitle).toBe('其他')
  })

  it('derives a stable title and counts rows', () => {
    const session: PetSession = {
      id: 's1',
      serverId: 's',
      serverName: 'S',
      title: '标题',
      workspaceId: 'w',
      workspaceTitle: 'W',
      state: 'idle',
      updatedAt: 1
    }
    expect(countSessions([session, { ...session, id: 's2', state: 'running' }])).toMatchObject({
      running: 1,
      idle: 1,
      total: 2
    })
    expect(sessionTitle({ sessionId: 's1', projections: { values: { title: '项目标题' } } })).toBe(
      '项目标题'
    )
  })

  it('marks a running-to-idle transition as done and keeps the mark', () => {
    const sessions = [summary({ sessionId: 'a', running: false })]
    const previous = new Map([['a', true]])
    expect(advanceCompletionState({ previousRunning: previous, sessions, doneIds: new Set() })).toEqual(new Set(['a']))
    expect(advanceCompletionState({ previousRunning: previous, sessions, doneIds: new Set(['a']) })).toEqual(new Set(['a']))
  })

  it('reports one completed and one still running after a two-task transition', () => {
    const sessions = [
      summary({ sessionId: 'finished', running: false, updatedAt: 2 }),
      summary({ sessionId: 'working', running: true, updatedAt: 1 })
    ]
    const done = advanceCompletionState({
      previousRunning: new Map([
        ['finished', true],
        ['working', true]
      ]),
      sessions,
      doneIds: new Set()
    })
    const snapshot = aggregateServerSnapshot({
      server: { id: 's', name: 'S', baseUrl: 'http://localhost/' },
      status: 'online',
      sessions,
      workspaces: [],
      archivedSessionIds: [],
      doneIds: done
    })
    expect(snapshot.counts).toMatchObject({ running: 1, done: 1, total: 2 })
    expect(snapshot.sessions.map((session) => session.state)).toEqual(['done', 'running'])
  })

  it('merges server snapshots into one sorted summary', () => {
    const merged = mergePetSnapshots([
      {
        serverId: 'b',
        serverName: '乙',
        baseUrl: 'http://b/',
        status: 'online',
        workspaces: [],
        sessions: [],
        counts: { needsYou: 0, running: 1, done: 0, idle: 0, total: 1 }
      },
      {
        serverId: 'a',
        serverName: '甲',
        baseUrl: 'http://a/',
        status: 'online',
        workspaces: [],
        sessions: [],
        counts: { needsYou: 1, running: 0, done: 0, idle: 0, total: 1 }
      }
    ])
    expect(merged.servers.map((server) => server.serverName)).toEqual(['甲', '乙'])
    expect(merged.counts.total).toBe(2)
    expect(merged.counts.needsYou).toBe(1)
  })
})
