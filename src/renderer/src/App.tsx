import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppInfo,
  AppSettings,
  ServerProfile,
  ServerStatus,
  TestResult
} from '@shared/types'
import { api, describeError } from './api'
import { useServers } from './hooks/useServers'
import type { UiServerStatus } from './hooks/useServers'
import AuthView from './components/AuthView'
import EmptyState from './components/EmptyState'
import HelpDialog from './components/HelpDialog'
import Logo from './components/Logo'
import ServerDetails from './components/ServerDetails'
import type { ServerBusyAction, ServerConfirmAction } from './components/ServerDetails'
import ServerForm from './components/ServerForm'
import type { ServerFormIntent, ServerFormValues } from './components/ServerForm'
import ServerList from './components/ServerList'
import SettingsPanel from './components/SettingsPanel'
import TabsView from './components/TabsView'
import type { SettingsPatch } from './components/SettingsPanel'
import { parseWindowView } from './utils'

type MainView =
  | { kind: 'details' }
  | { kind: 'form'; server: ServerProfile | null }
  | { kind: 'settings' }

interface Banner {
  kind: 'error' | 'warning' | 'success' | 'info'
  text: string
}

interface PendingAction {
  id: string
  action: ServerBusyAction
}

interface ConfirmAction {
  kind: ServerConfirmAction
  serverId: string
}

interface BannerAlertProps {
  kind: Banner['kind']
  testId: string
  children: ReactNode
  items?: string[]
  onDismiss: () => void
  action?: ReactNode
}

function BannerAlert({ kind, testId, children, items, onDismiss, action }: BannerAlertProps) {
  return (
    <div
      className={`alert alert--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={testId}
    >
      <div className="alert__content">
        <span>{children}</span>
        {items && items.length > 0 ? (
          <ul className="alert__list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {action}
      <button type="button" className="alert__close" onClick={onDismiss} aria-label="关闭提示">
        ×
      </button>
    </div>
  )
}

function LoadingPane() {
  return (
    <div className="loading-pane" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>正在加载服务器…</span>
    </div>
  )
}

function testResultMessage(status: ServerStatus, result: TestResult): string {
  if (result.message) return result.message

  switch (status) {
    case 'forbidden':
      return '服务器拒绝了访问（HTTP 403），请检查账号权限或反向代理配置。'
    case 'offline':
      return '无法连接服务器，请检查地址、网络或代理设置。'
    case 'auth-required':
      return '服务器可访问，但需要登录。点击“连接”后粘贴 dsh web 启动地址。'
    case 'error':
      return result.httpStatus
        ? `服务器返回 HTTP ${result.httpStatus}。`
        : '测试失败，请重试。'
    default:
      return result.httpStatus ? `服务器返回 HTTP ${result.httpStatus}。` : '测试失败，请重试。'
  }
}

function ManagerApp() {
  const {
    settings,
    servers,
    defaultServerId,
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
  } = useServers()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mainView, setMainView] = useState<MainView>({ kind: 'details' })
  const [helpOpen, setHelpOpen] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  const selectedServer = servers.find((server) => server.id === selectedId) ?? null
  const previewMode = !desktopAvailable

  useEffect(() => {
    document.title = 'DSH Remote'

    void (async () => {
      try {
        const info = await api.getAppInfo()
        if (info) setAppInfo(info)
      } catch {
        // Version metadata is optional for the manager UI.
      }
    })()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  useEffect(() => {
    if (mainView.kind === 'form') return
    if (selectedId && servers.some((server) => server.id === selectedId)) return

    const fallback = servers.find((server) => server.id === defaultServerId) ?? servers[0]
    setSelectedId(fallback ? fallback.id : null)
  }, [mainView.kind, servers, defaultServerId, selectedId])

  useEffect(() => {
    if (!banner) return
    if (banner.kind !== 'success' && banner.kind !== 'info') return

    const timer = window.setTimeout(() => setBanner(null), 5000)
    return () => window.clearTimeout(timer)
  }, [banner])

  useEffect(() => {
    if (pending && !servers.some((server) => server.id === pending.id)) {
      setPending(null)
    }
  }, [pending, servers])

  useEffect(() => {
    setTestResults((current) => {
      const ids = new Set(servers.map((server) => server.id))
      const entries = Object.entries(current).filter(([id]) => ids.has(id))
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries)
    })
  }, [servers])

  function openAddForm() {
    setBanner(null)
    setFormError(null)
    setSaveWarnings([])
    setSelectedId(null)
    setMainView({ kind: 'form', server: null })
  }

  function openEditForm(server: ServerProfile) {
    setBanner(null)
    setFormError(null)
    setSaveWarnings([])
    setMainView({ kind: 'form', server })
  }

  function cancelForm() {
    setFormError(null)
    setMainView({ kind: 'details' })
  }

  function selectServer(id: string) {
    setBanner(null)
    setSelectedId(id)
    setMainView({ kind: 'details' })
  }

  function toggleSettings() {
    setMainView((current) =>
      current.kind === 'settings' ? { kind: 'details' } : { kind: 'settings' }
    )
  }

  async function runConnect(server: ServerProfile, tokenUrl?: string) {
    if (pending) return

    setPending({ id: server.id, action: 'connect' })
    setBanner(null)

    try {
      await api.connectServer(server.id, tokenUrl)
      markStatus(server.id, 'online')
      setBanner({ kind: 'success', text: `正在打开 ${server.name}…` })
    } catch (cause) {
      const message = describeError(cause)
      if (/401|登录|认证|token/i.test(message)) {
        setBanner({ kind: 'warning', text: message })
      } else {
        markStatus(server.id, 'error')
        setBanner({ kind: 'error', text: message })
      }
    } finally {
      setPending(null)
    }
  }

  async function runTest(server: ServerProfile) {
    if (pending) return

    setPending({ id: server.id, action: 'test' })
    setBanner(null)
    markStatus(server.id, 'testing')

    try {
      const result = await api.testServer({
        id: server.id,
        url: server.baseUrl,
        proxyMode: server.proxyMode,
        allowInvalidCertificate: server.allowInvalidCertificate
      })

      const status: UiServerStatus = result?.status ?? 'error'
      markStatus(server.id, status)
      if (result) {
        setTestResults((current) => ({ ...current, [server.id]: result }))
      }

      if (status === 'online') {
        setBanner({
          kind: 'success',
          text: `连接正常（HTTP ${result?.httpStatus ?? 200}）。`
        })
      } else if (status === 'auth-required') {
        setBanner({
          kind: 'warning',
          text: '服务器可访问，但需要登录。点击“连接”后粘贴 dsh web 启动地址。'
        })
      } else if (result) {
        setBanner({ kind: 'error', text: testResultMessage(status, result) })
      } else {
        setBanner({ kind: 'error', text: '测试失败，请重试。' })
      }
    } catch (cause) {
      markStatus(server.id, 'error')
      setBanner({ kind: 'error', text: describeError(cause) })
    } finally {
      setPending(null)
    }
  }

  async function handleFormSubmit(values: ServerFormValues, intent: ServerFormIntent) {
    if (formSubmitting) return

    const editing = mainView.kind === 'form' ? mainView.server : null
    setFormSubmitting(true)
    setFormError(null)
    setSaveWarnings([])

    try {
      const result = await api.saveServer({
        ...(editing ? { id: editing.id } : {}),
        name: values.name,
        url: values.url,
        proxyMode: values.proxyMode,
        allowInvalidCertificate: values.allowInvalidCertificate
      })

      upsertServer(result.server)
      setSelectedId(result.server.id)
      setMainView({ kind: 'details' })
      markStatus(result.server.id, 'unknown')
      setSaveWarnings(result.warnings ?? [])

      if (result.inputHadToken) {
        setBanner(
          intent === 'save-and-connect'
            ? { kind: 'info', text: '服务器已保存，正在使用启动地址连接…' }
            : {
                kind: 'warning',
                text: '服务器已保存。启动 token 不会被保存，首次连接时需要重新粘贴 dsh web 启动地址。'
              }
        )
      } else {
        setBanner({ kind: 'success', text: '服务器已保存。' })
      }

      if (intent === 'save-and-connect') {
        await runConnect(
          result.server,
          result.inputHadToken ? values.url : undefined
        )
      }
    } catch (cause) {
      setFormError(describeError(cause))
    } finally {
      setFormSubmitting(false)
    }
  }

  async function handleSetDefault(server: ServerProfile) {
    if (pending) return

    setPending({ id: server.id, action: 'default' })

    try {
      const next = await api.setDefaultServer(server.id)
      applySettings(next)
      setBanner({ kind: 'success', text: `已将 ${server.name} 设为默认服务器。` })
    } catch (cause) {
      setBanner({ kind: 'error', text: describeError(cause) })
    } finally {
      setPending(null)
    }
  }

  async function handleCopyUrl(server: ServerProfile) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(server.baseUrl)
      setBanner({ kind: 'success', text: '已复制服务器地址。' })
    } catch {
      setBanner({ kind: 'error', text: '复制失败，请手动选择地址复制。' })
    }
  }

  async function handleConfirmAction() {
    if (!confirm || pending) return

    const server = servers.find((item) => item.id === confirm.serverId)
    if (!server) {
      setConfirm(null)
      return
    }

    const action: ServerBusyAction =
      confirm.kind === 'delete' ? 'delete' : 'clear-session'
    setPending({ id: server.id, action })

    try {
      if (confirm.kind === 'delete') {
        await api.deleteServer(server.id)
        removeServer(server.id)
        setConfirm(null)
        setBanner({ kind: 'success', text: `已删除 ${server.name}，本机登录状态已清理。` })
      } else {
        await api.clearServerSession(server.id)
        markStatus(server.id, 'unknown')
        setTestResults((current) => {
          const next = { ...current }
          delete next[server.id]
          return next
        })
        setConfirm(null)
        setBanner({
          kind: 'success',
          text: `已清除 ${server.name} 的登录状态。下次连接需要重新粘贴启动地址。`
        })
      }
    } catch (cause) {
      setBanner({ kind: 'error', text: describeError(cause) })
    } finally {
      setPending(null)
    }
  }

  function handleSettingsChange(patch: SettingsPatch) {
    if (savingSettings) return

    const previous = settings
    const optimistic = { ...settings, ...patch }
    if (patch.shellWidth === null) {
      const { shellWidth: _ignored, ...withoutWidth } = optimistic
      applySettings(withoutWidth)
    } else {
      applySettings(optimistic as AppSettings)
    }
    setSavingSettings(true)

    void (async () => {
      try {
        const next = await api.updateSettings(patch)
        applySettings(next)
      } catch (cause) {
        applySettings(previous)
        setBanner({ kind: 'error', text: describeError(cause) })
      } finally {
        setSavingSettings(false)
      }
    })()
  }

  const busyAction: ServerBusyAction | null =
    selectedServer && pending && pending.id === selectedServer.id ? pending.action : null
  const confirmKind: ServerConfirmAction | null =
    selectedServer && confirm && confirm.serverId === selectedServer.id ? confirm.kind : null
  const selectedTestResult = selectedServer ? testResults[selectedServer.id] : undefined

  return (
    <div className="app" data-testid="manager-root">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Logo size={17} />
          </span>
          <span className="brand-name">DSH Remote</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-subtitle">服务器管理</span>
        </div>

        <div className="app-header__actions">
          {previewMode ? (
            <span className="chip chip--warning" title="未检测到本地主进程桥接，界面处于预览模式">
              预览模式
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setHelpOpen(true)}
          >
            帮助
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <ServerList
            servers={servers}
            selectedId={selectedId}
            defaultServerId={defaultServerId}
            statuses={statuses}
            settingsActive={mainView.kind === 'settings'}
            version={appInfo?.version}
            onSelect={selectServer}
            onAdd={openAddForm}
            onOpenSettings={toggleSettings}
            onOpenHelp={() => setHelpOpen(true)}
          />
        </aside>

        <main className="main">
          <div className="main-banners">
            {error ? (
              <BannerAlert
                kind="error"
                testId="manager-error"
                onDismiss={dismissError}
                action={
                  <button type="button" className="btn btn--sm" onClick={() => void reload()}>
                    重试
                  </button>
                }
              >
                {error}
              </BannerAlert>
            ) : null}

            {saveWarnings.length > 0 ? (
              <BannerAlert
                kind="warning"
                testId="save-warnings"
                items={saveWarnings}
                onDismiss={() => setSaveWarnings([])}
              >
                服务器已保存，请注意：
              </BannerAlert>
            ) : null}

            {banner ? (
              <BannerAlert
                kind={banner.kind}
                testId={banner.kind === 'error' ? 'error-banner' : 'toast'}
                onDismiss={() => setBanner(null)}
              >
                {banner.text}
              </BannerAlert>
            ) : null}
          </div>

          <div className="main-scroll">
            {loading && servers.length === 0 ? (
              <LoadingPane />
            ) : mainView.kind === 'settings' ? (
              <SettingsPanel
                settings={settings}
                appInfo={appInfo}
                desktopAvailable={desktopAvailable}
                saving={savingSettings}
                onChange={handleSettingsChange}
              />
            ) : mainView.kind === 'form' ? (
              <ServerForm
                key={mainView.server?.id ?? 'new'}
                server={mainView.server}
                submitting={formSubmitting}
                error={formError}
                onSubmit={(values, intent) => void handleFormSubmit(values, intent)}
                onCancel={cancelForm}
                onOpenHelp={() => setHelpOpen(true)}
              />
            ) : selectedServer ? (
              <ServerDetails
                server={selectedServer}
                isDefault={selectedServer.id === defaultServerId}
                status={statuses[selectedServer.id] ?? 'unknown'}
                testMessage={selectedTestResult?.message}
                busyAction={busyAction}
                confirm={confirmKind}
                onConnect={(server) => void runConnect(server)}
                onTest={(server) => void runTest(server)}
                onEdit={openEditForm}
                onSetDefault={(server) => void handleSetDefault(server)}
                onRequestClearSession={(server) =>
                  setConfirm({ kind: 'clear-session', serverId: server.id })
                }
                onRequestDelete={(server) =>
                  setConfirm({ kind: 'delete', serverId: server.id })
                }
                onCopyUrl={(server) => void handleCopyUrl(server)}
                onConfirm={() => void handleConfirmAction()}
                onCancelConfirm={() => setConfirm(null)}
                onOpenHelp={() => setHelpOpen(true)}
              />
            ) : (
              <EmptyState
                hasServers={servers.length > 0}
                onAdd={openAddForm}
                onOpenHelp={() => setHelpOpen(true)}
              />
            )}
          </div>
        </main>
      </div>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

export default function App() {
  const windowView = useMemo(() => parseWindowView(window.location.search), [])

  if (windowView.view === 'auth') {
    return <AuthView serverId={windowView.serverId} reason={windowView.reason} />
  }
  if (windowView.view === 'tabs') {
    return <TabsView />
  }

  return <ManagerApp />
}