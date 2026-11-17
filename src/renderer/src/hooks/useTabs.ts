import { useCallback, useEffect, useState } from 'react'
import type { TabInfo } from '@shared/types'
import { api, describeError } from '../api'

export interface TabsController {
  tabs: TabInfo[]
  error: string | null
  activate: (id: string) => void
  close: (id: string) => void
  add: () => void
  reload: (id: string) => void
  menu: (id: string) => void
  dismissError: () => void
}

export function useTabs(): TabsController {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    const load = async (): Promise<void> => {
      try {
        const next = await api.listTabs()
        if (alive && Array.isArray(next)) setTabs(next)
      } catch (cause) {
        if (alive) setError(describeError(cause))
      }
    }

    void load()
    const unsubscribe = api.onTabsChanged((next) => {
      if (Array.isArray(next)) setTabs(next)
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const run = useCallback((action: () => Promise<void>) => {
    void action().catch((cause) => setError(describeError(cause)))
  }, [])

  return {
    tabs,
    error,
    activate: (id) => run(() => api.activateTab(id)),
    close: (id) => run(() => api.closeTab(id)),
    add: () => run(() => api.addTab()),
    reload: (id) => run(() => api.reloadTab(id)),
    menu: (id) => run(() => api.showTabMenu(id)),
    dismissError: () => setError(null)
  }
}