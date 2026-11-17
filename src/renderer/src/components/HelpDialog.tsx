import { useEffect, useRef } from 'react'
import Logo from './Logo'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        data-testid="help-dialog"
      >
        <header className="modal-header">
          <div className="modal-heading">
            <span className="brand-mark brand-mark--sm">
              <Logo size={15} />
            </span>
            <h2 id="help-title">如何连接远程 DSH</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          <ol className="help-steps">
            <li>
              <h3>在远程服务器启动 DSH</h3>
              <p>
                登录远程机器后执行 <code>dsh web</code>，可按需指定端口。
              </p>
            </li>
            <li>
              <h3>复制启动地址</h3>
              <p>
                终端会打印一行以 <code>dsh web:</code> 开头的 URL：
              </p>
              <pre className="code-block">
                <code>dsh web: https://dsh.example.com/?token=…</code>
              </pre>
            </li>
            <li>
              <h3>粘贴并连接</h3>
              <p>
                把整行地址粘贴到 DSH Remote。客户端只保留干净的服务器地址，启动 token
                不会被写入配置或日志。
              </p>
            </li>
            <li>
              <h3>登录状态会被记住</h3>
              <p>
                首次换取 cookie 成功后，重启客户端通常无需再次粘贴。若出现 401
                或登录过期，重新执行 <code>dsh web</code> 并粘贴新的地址即可。
              </p>
            </li>
          </ol>

          <div className="help-note">
            <h3>使用反向代理时</h3>
            <p>
              请确保根路径 <code>/</code> 可访问，并按 DSH 文档配置{' '}
              <code>--public-url</code> 与 <code>--trusted-host</code>，否则 token 换取和登录
              cookie 可能被拒绝。
            </p>
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            知道了
          </button>
        </footer>
      </section>
    </div>
  )
}