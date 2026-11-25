import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, ServerProfile, ServerStatus } from '@shared/types'
import { api, describeError, emptySettings, isDesktopAvailable } from '../api'

export type UiServerStatus = ServerStatus | 'unknown' | 'testing'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSettings(value: AppSettings | null | undefined): AppSettings {
  const fallback = emptySettings()
  if (!value || typeof value !== 'object') return fallback

  return {
    version: 1,
    servers: Array.isArray(value.servers) ? value.servers : [],
    ...(typeof value.defaultServerId === 'string'
      ? { defaultServerId: value.defaultServerId }
      : {}),
    openTabs: Array.isArray(value.openTabs)
      ? value.openTabs.filter((id): id is string => typeof id === 'string')
      : [],
    ...(typeof value.activeTabId === 'string' ? { activeTabId: value.activeTabId } : {}),
    ...(typeof value.shellWidth === 'number' && Number.isFinite(value.shellWidth)
      ? { shellWidth: value.shellWidth }
      : {}),
    autoConnect: typeof value.autoConnect === 'boolean' ? value.autoConnect : fallback.autoConnect,
    closeToTray:
      typeof value.closeToTray === 'boolean' ? value.closeToTray : fallback.closeToTray,
    theme:
      value.theme === 'dark' || value.theme === 'light' || value.theme === 'system'
        ? value.theme
        : 'system',
    pet: isRecord(value.pet)
      ? {
          enabled:
            typeof value.pet.enabled === 'boolean' ? value.pet.enabled : fallback.pet.enabled,
          alwaysOnTop:
            typeof value.pet.alwaysOnTop === 'boolean'
              ? value.pet.alwaysOnTop
              : fallback.pet.alwaysOnTop
        }
      : fallback.pet,
    windowBounds: isRecord(value.windowBounds)
      ? (value.windowBounds as AppSettings['windowBounds'])
      : {}
  }
}

export interface ServersController {
  settings: AppSettings
  servers: ServerProfile[]
  defaultServerId: string | null
  loading: boolean
  desktopAvailable: boolean
  error: string | null
  statuses: Record<string, UiServerStatus>
  reload: () => Promise<void>
  dismissError: () => void
  applySettings: (next: AppSettings) => void
  upsertServer: (server: ServerProfile) => void
  removeServer: (id: string) => void
  markStatus: (id: string, status: UiServerStatus) => void
}

export function useServers(): ServersController {
  const [settings, setSettings] = useState<AppSettings>(emptySettings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<Record<string, UiServerStatus>>({})
  const [desktopAvailable, setDesktopAvailable] = useState<boolean>(() => isDesktopAvailable())

  const applySettings = useCallback((next: AppSettings) => {
    setSettings(normalizeSettings(next))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [settingsResult, serversResult] = await Promise.all([
        api.getSettings(),
        api.listServers()
      ])
      const next = normalizeSettings(settingsResult)
      if (Array.isArray(serversResult)) next.servers = serversResult
      setSettings(next)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setLoading(false)
      setDesktopAvailable(isDesktopAvailable())
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const offServers = api.onServersChanged((servers) => {
      if (!Array.isArray(servers)) return
      setSettings((current) => ({ ...current, servers }))
    })
    const offSettings = api.onSettingsChanged((next) => {
      setSettings(normalizeSettings(next))
    })

    return () => {
      offServers()
      offSettings()
    }
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const upsertServer = useCallback((server: ServerProfile) => {
    setSettings((current) => {
      const exists = current.servers.some((item) => item.id === server.id)
      return {
        ...current,
        servers: exists
          ? current.servers.map((item) => (item.id === server.id ? server : item))
          : [...current.servers, server]
      }
    })
  }, [])

  const removeServer = useCallback((id: string) => {
    setSettings((current) => {
      const servers = current.servers.filter((item) => item.id !== id)
      const defaultServerId =
        current.defaultServerId === id ? undefined : current.defaultServerId
      return {
        ...current,
        servers,
        ...(defaultServerId ? { defaultServerId } : {})
      }
    })
  }, [])

  const markStatus = useCallback((id: string, status: UiServerStatus) => {
    setStatuses((current) => ({ ...current, [id]: status }))
  }, [])

  return {
    settings,
    servers: settings.servers,
    defaultServerId: settings.defaultServerId ?? null,
    loading,
    desktopAvailable,
    error,
    statuses,
    reload,
    dismissError,
    applySettings,
    upsertServer,
    removeServer,
    markStatus
  }
}
