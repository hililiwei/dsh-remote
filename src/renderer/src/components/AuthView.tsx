import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AuthReason, ServerProfile } from '@shared/types'
import { api, describeError, isDesktopAvailable } from '../api'
import { extractLaunchUrl, hostOf, originOf } from '../utils'
import HelpDialog from './HelpDialog'
import Logo from './Logo'

interface AuthViewProps {
  serverId?: string
  reason: AuthReason
}

export default function AuthView({ serverId, reason }: AuthViewProps) {
  const [server, setServer] = useState<ServerProfile | null>(null)
  const [serverLoading, setServerLoading] = useState(true)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const desktopAvailable = isDesktopAvailable()

  useEffect(() => {
    document.title = '登录 · DSH Remote'
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const servers = await api.listServers()
        if (!cancelled && Array.isArray(servers)) {
          setServer(servers.find((item) => item.id === serverId) ?? null)
        }
      } catch {
        // The auth window still works without the profile; main validates on submit.
      } finally {
        if (!cancelled) setServerLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [serverId])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const cancel = useCallback(async () => {
    if (busy || succeeded) return

    if (!isDesktopAvailable()) {
      window.close()
      return
    }

    try {
      await api.cancelAuth()
    } catch {
      // The main process may already be closing the window.
    }
  }, [busy, succeeded])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || helpOpen) return
      event.preventDefault()
      void cancel()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel, helpOpen])

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (busy || succeeded) return

    const launchUrl = extractLaunchUrl(value)
    if (launchUrl === '') {
      setError('请粘贴 dsh web 启动时打印的完整地址。')
      textareaRef.current?.focus()
      return
    }

    let parsed: URL
    try {
      parsed = new URL(launchUrl)
    } catch {
      setError('地址格式不正确，应以 http:// 或 https:// 开头。')
      textareaRef.current?.focus()
      return
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('只支持 http:// 或 https:// 地址。')
      return
    }
    if (parsed.username || parsed.password) {
      setError('地址中不能包含用户名或密码。')
      return
    }
    if (!parsed.searchParams.get('token')?.trim()) {
      setError('地址中没有找到 token，请复制终端中完整的 dsh web: 地址（包含 token 参数）。')
      return
    }

    const serverOrigin = originOf(server?.baseUrl)
    if (server && serverOrigin && parsed.origin !== serverOrigin) {
      setError(
        `该地址属于 ${parsed.host}，与当前服务器 ${hostOf(server.baseUrl)} 不一致。请粘贴此服务器的启动地址。`
      )
      return
    }

    setError(null)
    setBusy(true)

    try {
      const result = await api.submitAuth(launchUrl)
      if (!result || !result.ok) {
        setError(result?.message ?? '登录失败，请确认地址是否仍然有效。')
        setBusy(false)
        return
      }

      setSucceeded(true)
      setBusy(false)
    } catch (cause) {
      setError(describeError(cause))
      setBusy(false)
    }
  }

  function onTextareaKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  const reasonText =
    reason === 'expired'
      ? '此服务器的登录状态已过期。粘贴新的 dsh web 启动地址即可重新登录。'
      : '首次连接需要 dsh web 启动时打印的 token 地址。'

  return (
    <div className="auth" data-testid="auth-root">
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-mark">
              <Logo size={16} />
            </span>
            <span className="auth-brand__name">DSH Remote</span>
            <span className="auth-brand__sep" aria-hidden="true" />
            <span className="auth-brand__muted">远程登录</span>
          </div>

          <h1 id="auth-title" className="auth-title">
            {server ? `连接到 ${server.name}` : '连接远程 DSH'}
          </h1>
          <p className="auth-reason">{reasonText}</p>

          <div className="auth-server">
            <span className="auth-server__label">服务器</span>
            <code className="auth-server__value">
              {server
                ? server.baseUrl
                : serverLoading
                  ? '正在读取服务器信息…'
                  : serverId
                    ? '无法读取服务器信息'
                    : '未指定服务器'}
            </code>
          </div>

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="launch-url">启动 URL</label>
            <textarea
              id="launch-url"
              ref={textareaRef}
              className="mono-input"
              data-testid="auth-url-input"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={onTextareaKeyDown}
              placeholder="dsh web: https://dsh.example.com/?token=…"
              rows={4}
              spellCheck={false}
              autoFocus
              disabled={busy || succeeded}
            />
            <p className="hint">
              粘贴完整的 <code>dsh web:</code> 启动地址；token 仅用于换取登录 cookie，不会被保存。
            </p>

            <div className="auth-links">
              <button
                type="button"
                className="link-button"
                onClick={() => setHelpOpen(true)}
              >
                如何获取启动地址？
              </button>
              <span className="auth-shortcut">Ctrl/⌘ + Enter 连接</span>
            </div>

            {succeeded ? (
              <div className="alert alert--success" role="status">
                验证成功，正在打开服务器…
              </div>
            ) : error ? (
              <div className="alert alert--error" role="alert" data-testid="auth-error">
                {error}
              </div>
            ) : null}

            <div className="auth-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void cancel()}
                disabled={busy || succeeded}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                data-testid="auth-connect"
                disabled={busy || succeeded}
              >
                {busy ? '验证中…' : '连接'}
              </button>
            </div>
          </form>

          {!desktopAvailable ? (
            <p className="auth-preview-note">
              本地主进程未就绪：当前是界面预览，提交将在主进程可用后生效。
            </p>
          ) : null}
        </section>
      </main>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}