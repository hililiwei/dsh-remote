import type { ServerProfile } from '@shared/types'
import type { UiServerStatus } from '../hooks/useServers'
import {
  formatDateTime,
  formatRelativeTime,
  isRootBaseUrl,
  proxyLabel
} from '../utils'
import StatusBadge from './StatusBadge'

export type ServerBusyAction =
  | 'connect'
  | 'test'
  | 'default'
  | 'clear-session'
  | 'delete'

export type ServerConfirmAction = 'delete' | 'clear-session'

interface ServerDetailsProps {
  server: ServerProfile
  isDefault: boolean
  status: UiServerStatus
  testMessage?: string
  busyAction: ServerBusyAction | null
  confirm: ServerConfirmAction | null
  onConnect: (server: ServerProfile) => void
  onTest: (server: ServerProfile) => void
  onEdit: (server: ServerProfile) => void
  onSetDefault: (server: ServerProfile) => void
  onRequestClearSession: (server: ServerProfile) => void
  onRequestDelete: (server: ServerProfile) => void
  onCopyUrl: (server: ServerProfile) => void
  onConfirm: () => void
  onCancelConfirm: () => void
  onOpenHelp: () => void
}

export default function ServerDetails({
  server,
  isDefault,
  status,
  testMessage,
  busyAction,
  confirm,
  onConnect,
  onTest,
  onEdit,
  onSetDefault,
  onRequestClearSession,
  onRequestDelete,
  onCopyUrl,
  onConfirm,
  onCancelConfirm,
  onOpenHelp
}: ServerDetailsProps) {
  const busy = busyAction !== null
  const rootWarning = !isRootBaseUrl(server.baseUrl)

  return (
    <section className="details" aria-label="服务器详情">
      <header className="details-head">
        <div className="details-heading">
          <h2 className="details-title">{server.name}</h2>
          <div className="details-meta">
            {isDefault ? <span className="badge badge--default">默认</span> : null}
            <span className="details-proxy">{proxyLabel(server.proxyMode)}</span>
            <button
              type="button"
              className="link-button details-help"
              onClick={onOpenHelp}
            >
              连接说明
            </button>
          </div>
        </div>

        <div className="details-primary">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onConnect(server)}
            disabled={busy}
            data-testid="connect-server"
          >
            {busyAction === 'connect' ? '连接中…' : '连接'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onTest(server)}
            disabled={busy}
            data-testid="test-server"
          >
            {busyAction === 'test' ? '测试中…' : '测试'}
          </button>
        </div>
      </header>

      <div className="url-row">
        <code className="url-row__value" title={server.baseUrl}>
          {server.baseUrl}
        </code>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onCopyUrl(server)}
          title="复制服务器地址"
        >
          复制
        </button>
      </div>

      <dl className="info-grid">
        <div className="info-field">
          <dt>状态</dt>
          <dd>
            <StatusBadge status={status} />
            {testMessage ? <span className="info-note">{testMessage}</span> : null}
          </dd>
        </div>
        <div className="info-field">
          <dt>代理模式</dt>
          <dd>{proxyLabel(server.proxyMode)}</dd>
        </div>
        <div className="info-field">
          <dt>证书</dt>
          <dd>
            {server.allowInvalidCertificate ? (
              <span className="text-warning">允许自签名证书</span>
            ) : (
              '校验系统信任证书'
            )}
          </dd>
        </div>
        <div className="info-field">
          <dt>添加时间</dt>
          <dd>{formatDateTime(server.createdAt)}</dd>
        </div>
        <div className="info-field">
          <dt>最近使用</dt>
          <dd>{formatRelativeTime(server.lastUsedAt)}</dd>
        </div>
        <div className="info-field">
          <dt>默认服务器</dt>
          <dd>{isDefault ? '是' : '否'}</dd>
        </div>
      </dl>

      {rootWarning ? (
        <div className="alert alert--warning" role="note">
          服务器地址包含子路径。DSH 的启动 token 只在根路径 <code>/</code> 生效，首次连接可能失败；
          建议使用剥离反向代理前缀后的根地址。
        </div>
      ) : null}

      {server.allowInvalidCertificate ? (
        <div className="alert alert--warning" role="note">
          已允许此服务器的自签名证书。请仅在确认服务器来源可信时使用，存在中间人风险。
        </div>
      ) : null}

      <section className="details-section">
        <h3 className="section-title">服务器操作</h3>
        <div className="button-row">
          <button
            type="button"
            className="btn"
            onClick={() => onEdit(server)}
            disabled={busy}
            data-testid="edit-server"
          >
            编辑
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onSetDefault(server)}
            disabled={busy || isDefault}
            title={isDefault ? '已经是默认服务器' : '设为默认服务器'}
            data-testid="set-default"
          >
            {busyAction === 'default' ? '设置中…' : isDefault ? '已是默认' : '设为默认'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onRequestClearSession(server)}
            disabled={busy}
            title="清除本机保存的登录 cookie"
            data-testid="clear-session"
          >
            {busyAction === 'clear-session' ? '清除中…' : '清除登录状态'}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onRequestDelete(server)}
            disabled={busy}
            data-testid="delete-server"
          >
            {busyAction === 'delete' ? '删除中…' : '删除'}
          </button>
        </div>
      </section>

      {confirm ? (
        <div className="confirm-bar" role="alertdialog" aria-label="确认操作">
          <div className="confirm-bar__text">
            {confirm === 'delete' ? (
              <>
                确定删除 <strong>{server.name}</strong>？服务器配置和本机登录状态都会被清除，且无法撤销。
              </>
            ) : (
              <>
                确定清除 <strong>{server.name}</strong> 的登录状态？下次连接需要重新粘贴{' '}
                <code>dsh web:</code> 启动地址。
              </>
            )}
          </div>
          <div className="confirm-bar__actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={onConfirm}
              disabled={busy}
              data-testid={confirm === 'delete' ? 'confirm-delete' : 'confirm-clear-session'}
            >
              {confirm === 'delete'
                ? busyAction === 'delete'
                  ? '删除中…'
                  : '确认删除'
                : busyAction === 'clear-session'
                  ? '清除中…'
                  : '确认清除'}
            </button>
            <button type="button" className="btn" onClick={onCancelConfirm} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      <p className="details-footnote">
        连接会在独立窗口中加载远程 DSH 页面。远程页面无法访问本机文件或 Node API。
      </p>
    </section>
  )
}