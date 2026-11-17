import { useEffect } from 'react'
import type { TabStatus } from '@shared/types'
import { api } from '../api'
import { useTabs } from '../hooks/useTabs'
import Logo from './Logo'
import { StatusDot } from './StatusBadge'
import type { UiServerStatus } from '../hooks/useServers'

function statusForTab(status: TabStatus): UiServerStatus {
  switch (status) {
    case 'online':
      return 'online'
    case 'auth-required':
      return 'auth-required'
    case 'loading':
      return 'testing'
    default:
      return 'error'
  }
}

export default function TabsView() {
  const { tabs, error, activate, close, add, reload, menu, dismissError } = useTabs()

  useEffect(() => {
    document.body.classList.add('tabs-mode')
    document.title = 'DSH Remote'
    return () => document.body.classList.remove('tabs-mode')
  }, [])

  return (
    <div className="tabbar" data-testid="tabbar">
      <div className="tabbar__brand" title="DSH Remote">
        <Logo size={15} />
      </div>

      <div className="tabbar__strip" role="tablist" aria-label="打开的服务器">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.active ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab.active}
            tabIndex={tab.active ? 0 : -1}
            title={`${tab.name}\n${tab.url}`}
            data-testid={`tab-${tab.id}`}
            onClick={() => activate(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) close(tab.id)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              menu(tab.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activate(tab.id)
              }
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault()
                close(tab.id)
              }
            }}
          >
            <StatusDot status={statusForTab(tab.status)} />
            <span className="tab__name">{tab.name}</span>
            <button
              type="button"
              className="tab__close"
              aria-label={`关闭 ${tab.name}`}
              title="关闭标签页"
              data-testid={`tab-close-${tab.id}`}
              onClick={(event) => {
                event.stopPropagation()
                close(tab.id)
              }}
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          className="tabbar__add"
          data-testid="tab-add"
          title="新建标签页"
          aria-label="新建标签页"
          onClick={add}
        >
          +
        </button>
      </div>

      <div className="tabbar__right">
        {error ? (
          <button
            type="button"
            className="tabbar__error"
            title={error}
            onClick={dismissError}
            data-testid="tab-error"
          >
            !
          </button>
        ) : null}
        <button
          type="button"
          className="tabbar__manage"
          data-testid="tab-manager"
          title="服务器管理"
          onClick={() => void api.openManager()}
        >
          管理
        </button>
        <button
          type="button"
          className="tabbar__manage tabbar__reload"
          data-testid="tab-reload"
          title="重新加载当前标签页"
          onClick={() => {
            const active = tabs.find((tab) => tab.active)
            if (active) reload(active.id)
          }}
        >
          ↻
        </button>
      </div>
    </div>
  )
}