import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ProxyMode, ServerProfile } from '@shared/types'
import { extractLaunchUrl } from '../utils'

export interface ServerFormValues {
  name: string
  url: string
  proxyMode: ProxyMode
  allowInvalidCertificate: boolean
}

export type ServerFormIntent = 'save' | 'save-and-connect'

interface ServerFormProps {
  server?: ServerProfile | null
  submitting: boolean
  error: string | null
  onSubmit: (values: ServerFormValues, intent: ServerFormIntent) => void
  onCancel: () => void
  onOpenHelp: () => void
}

export default function ServerForm({
  server,
  submitting,
  error,
  onSubmit,
  onCancel,
  onOpenHelp
}: ServerFormProps) {
  const editing = Boolean(server)
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.baseUrl ?? '')
  const [proxyMode, setProxyMode] = useState<ProxyMode>(server?.proxyMode ?? 'system')
  const [allowInvalidCertificate, setAllowInvalidCertificate] = useState(
    server?.allowInvalidCertificate ?? false
  )
  const [localError, setLocalError] = useState<string | null>(null)
  const [pendingIntent, setPendingIntent] = useState<ServerFormIntent | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) urlInputRef.current?.focus()
  }, [editing])

  const errorText = localError ?? error

  function submit(intent: ServerFormIntent, event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submitting) return

    const launchUrl = extractLaunchUrl(url)
    if (launchUrl === '') {
      setLocalError('请输入服务器地址，或粘贴 dsh web 启动地址。')
      urlInputRef.current?.focus()
      return
    }
    if (!/^https?:\/\//i.test(launchUrl)) {
      setLocalError('服务器地址必须以 http:// 或 https:// 开头。')
      urlInputRef.current?.focus()
      return
    }

    setLocalError(null)
    setPendingIntent(intent)
    onSubmit(
      {
        name: name.trim(),
        url: launchUrl,
        proxyMode,
        allowInvalidCertificate
      },
      intent
    )
  }

  const saveAndConnectLabel = submitting
    ? pendingIntent === 'save-and-connect'
      ? '连接中…'
      : '请稍候…'
    : '保存并连接'
  const saveOnlyLabel = submitting
    ? pendingIntent === 'save'
      ? '保存中…'
      : '请稍候…'
    : '仅保存'

  return (
    <form
      className="form"
      onSubmit={(event) => submit('save-and-connect', event)}
      data-testid="server-form"
      noValidate
    >
      <header className="form-header">
        <h2 className="form-title">{editing ? '编辑服务器' : '添加服务器'}</h2>
        <p className="form-lead">
          {editing
            ? '修改服务器配置。保存后立即生效，登录状态保持不变。'
            : '保存远程 dsh web 服务器。可以粘贴干净的地址，或终端中 dsh web: 开头的完整地址。'}
        </p>
      </header>

      {errorText ? (
        <div className="alert alert--error" role="alert" data-testid="error-banner">
          {errorText}
        </div>
      ) : null}

      <div className="form-field">
        <label htmlFor="server-name">名称</label>
        <input
          id="server-name"
          data-testid="name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：公司内网 DSH"
          autoComplete="off"
          maxLength={64}
          disabled={submitting}
        />
        <p className="hint">留空时使用服务器主机名。</p>
      </div>

      <div className="form-field">
        <label htmlFor="server-url">服务器地址</label>
        <input
          id="server-url"
          ref={urlInputRef}
          data-testid="url-input"
          className="mono-input"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            if (localError) setLocalError(null)
          }}
          placeholder="https://dsh.example.com/ 或 dsh web: https://…?token=…"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!editing}
          disabled={submitting}
        />
        <p className="hint">
          首次连接需要粘贴终端中 <code>dsh web:</code> 打印的完整地址；启动 token 只用于换取登录
          cookie，保存时会自动移除。
        </p>
      </div>

      <div className="form-field">
        <span className="field-label" id="proxy-label">
          代理
        </span>
        <div className="choice-group" role="radiogroup" aria-labelledby="proxy-label">
          <label className={`choice${proxyMode === 'system' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="proxy-mode"
              value="system"
              checked={proxyMode === 'system'}
              onChange={() => setProxyMode('system')}
              disabled={submitting}
            />
            <span className="choice__text">
              <span className="choice__title">跟随系统代理</span>
              <span className="choice__desc">使用操作系统或 Electron 的代理设置（推荐）</span>
            </span>
          </label>

          <label className={`choice${proxyMode === 'direct' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="proxy-mode"
              value="direct"
              checked={proxyMode === 'direct'}
              onChange={() => setProxyMode('direct')}
              disabled={submitting}
            />
            <span className="choice__text">
              <span className="choice__title">直连</span>
              <span className="choice__desc">跳过系统代理，适合内网地址被代理拦截的情况</span>
            </span>
          </label>
        </div>
      </div>

      <div className="form-field">
        <label className={`check-row${allowInvalidCertificate ? ' is-checked' : ''}`}>
          <input
            type="checkbox"
            checked={allowInvalidCertificate}
            onChange={(event) => setAllowInvalidCertificate(event.target.checked)}
            disabled={submitting}
          />
          <span>
            <span className="check-row__title">允许此服务器使用自签名证书</span>
            <span className="check-row__desc">
              仅对该服务器生效。启用后会接受无效 TLS 证书，请确认来源可信。
            </span>
          </span>
        </label>
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          取消
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => submit('save')}
          disabled={submitting}
          data-testid="save-only"
        >
          {saveOnlyLabel}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting}
          data-testid="save-and-connect"
        >
          {saveAndConnectLabel}
        </button>
        <button
          type="button"
          className="link-button form-help"
          onClick={onOpenHelp}
          disabled={submitting}
        >
          如何获取启动地址？
        </button>
      </div>
    </form>
  )
}