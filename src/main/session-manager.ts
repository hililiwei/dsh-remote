import { randomUUID } from 'node:crypto'
import { session as electronSession, type Session } from 'electron'
import { SESSION_PREFIX } from '../shared/constants'
import type { ProxyMode, ServerProfile, TestResult } from '../shared/types'
import { checkServer } from './server-status'

const ID_PATTERN = /^[A-Za-z0-9-]+$/

export function partitionFor(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error('Invalid server id')
  }
  return `${SESSION_PREFIX}${id}`
}

/**
 * Owns one persistent Electron session per server. A partition keeps cookies,
 * cache and proxy decisions isolated, so two DSH backends never share a login.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  get(server: ServerProfile): Session {
    const existing = this.sessions.get(server.id)
    if (existing) return existing

    const created = electronSession.fromPartition(partitionFor(server.id))
    this.sessions.set(server.id, created)
    return created
  }

  async applyProxy(server: ServerProfile): Promise<void> {
    const target = this.get(server)
    await target.setProxy({
      mode: server.proxyMode === 'direct' ? 'direct' : 'system'
    })
    await target.closeAllConnections()
  }

  async clear(serverId: string): Promise<void> {
    const target =
      this.sessions.get(serverId) ?? electronSession.fromPartition(partitionFor(serverId))
    await target.clearStorageData()
    await target.clearCache()
    await target.closeAllConnections()
    this.sessions.delete(serverId)
  }

  /**
   * Check an unsaved draft URL in a throwaway, non-persistent session so a
   * test never writes cookies into a real server partition.
   */
  async testDraft(url: string, proxyMode: ProxyMode = 'system'): Promise<TestResult> {
    const partition = `dsh-remote-test-${randomUUID()}`
    const target = electronSession.fromPartition(partition)
    try {
      await target.setProxy({ mode: proxyMode === 'direct' ? 'direct' : 'system' })
      return await checkServer(target, url)
    } finally {
      await target.clearStorageData().catch(() => undefined)
      await target.clearCache().catch(() => undefined)
      await target.closeAllConnections().catch(() => undefined)
    }
  }
}