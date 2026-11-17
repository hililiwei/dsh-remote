import Logo from './Logo'

interface EmptyStateProps {
  hasServers: boolean
  onAdd: () => void
  onOpenHelp: () => void
}

export default function EmptyState({ hasServers, onAdd, onOpenHelp }: EmptyStateProps) {
  return (
    <section className="empty" data-testid="empty-state">
      <div className="empty__mark">
        <Logo size={40} />
      </div>

      <h2 className="empty__title">{hasServers ? '选择一个服务器' : '还没有服务器'}</h2>
      <p className="empty__lead">
        {hasServers
          ? '从左侧选择服务器查看详情，或添加一个新的远程 DSH 后端。'
          : '添加远程 dsh web 服务器，DSH Remote 会用它换取登录状态，并在顶部标签页中打开 DSH。'}
      </p>

      {!hasServers ? (
        <ol className="empty-steps">
          <li>
            <span className="empty-steps__num">1</span>
            <span>
              在远程服务器运行 <code>dsh web</code>
            </span>
          </li>
          <li>
            <span className="empty-steps__num">2</span>
            <span>
              复制终端打印的 <code>dsh web:</code> 启动地址
            </span>
          </li>
          <li>
            <span className="empty-steps__num">3</span>
            <span>把地址粘贴到添加服务器表单</span>
          </li>
        </ol>
      ) : null}

      <div className="empty__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onAdd}
          data-testid="empty-add-server"
        >
          添加服务器
        </button>
        <button type="button" className="btn btn--ghost" onClick={onOpenHelp}>
          如何获取启动地址？
        </button>
      </div>

      <p className="empty__footnote">
        启动 token 只用于换取登录 cookie，不会被保存到配置文件。
      </p>
    </section>
  )
}