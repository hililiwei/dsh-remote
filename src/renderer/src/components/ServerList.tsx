import type { ServerProfile } from '@shared/types'
import { hostOf } from '../utils'
import { StatusDot } from './StatusBadge'
import type { UiServerStatus } from '../hooks/useServers'

interface ServerListProps {
  servers: ServerProfile[]
  selectedId: string | null
  defaultServerId: string | null
  statuses: Record<string, UiServerStatus>
  settingsActive: boolean
  version?: string
  onSelect: (id: string) => void
  onAdd: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

export default function ServerList({
  servers,
  selectedId,
  defaultServerId,
  statuses,
  settingsActive,
  version,
  onSelect,
  onAdd,
  onOpenSettings,
  onOpenHelp
}: ServerListProps) {
  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">服务器</span>
        <span className="count-chip" aria-label={`${servers.length} 个服务器`}>
          {servers.length}
        </span>
        <button
          type="button"
          className="btn btn--primary btn--sm sidebar-add"
          onClick={onAdd}
          data-testid="add-server"
          title="添加服务器"
        >
          + 添加
        </button>
      </div>

      <nav className="server-list" aria-label="服务器列表" data-testid="server-list">
        {servers.map((server) => {
          const active = server.id === selectedId
          const status = statuses[server.id] ?? 'unknown'
          const isDefault = server.id === defaultServerId

          return (
            <button
              key={server.id}
              type="button"
              className={`server-item${active ? ' is-active' : ''}`}
              onClick={() => onSelect(server.id)}
              aria-current={active ? 'true' : undefined}
              data-testid={`server-row-${server.id}`}
            >
              <StatusDot status={status} />
              <span className="server-item__text">
                <span className="server-item__name">{server.name}</span>
                <span className="server-item__host">{hostOf(server.baseUrl)}</span>
              </span>
              {isDefault ? <span className="badge badge--default">默认</span> : null}
            </button>
          )
        })}

        {servers.length === 0 ? <p className="sidebar-empty">还没有服务器</p> : null}
      </nav>

      <footer className="sidebar-footer">
        <button
          type="button"
          className={`btn btn--ghost btn--sm${settingsActive ? ' is-active' : ''}`}
          onClick={onOpenSettings}
          aria-pressed={settingsActive}
        >
          设置
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenHelp}>
          帮助
        </button>
        {version ? <span className="sidebar-version">v{version}</span> : null}
      </footer>
    </>
  )
}