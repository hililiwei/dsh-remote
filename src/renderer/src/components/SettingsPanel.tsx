import type { AppInfo, AppSettings, ThemeMode } from '@shared/types'

export type SettingsPatch = Partial<
  Pick<AppSettings, 'autoConnect' | 'closeToTray' | 'theme'>
>

interface SettingsPanelProps {
  settings: AppSettings
  appInfo: AppInfo | null
  desktopAvailable: boolean
  saving: boolean
  onChange: (patch: SettingsPatch) => void
}

const THEME_OPTIONS: { value: ThemeMode; label: string; testId: string }[] = [
  { value: 'system', label: '跟随系统', testId: 'settings-theme-system' },
  { value: 'light', label: '浅色', testId: 'settings-theme-light' },
  { value: 'dark', label: '深色', testId: 'settings-theme-dark' }
]

function platformLabel(platform: string | undefined): string {
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return '—'
  }
}

export default function SettingsPanel({
  settings,
  appInfo,
  desktopAvailable,
  saving,
  onChange
}: SettingsPanelProps) {
  return (
    <section className="settings" data-testid="settings-panel">
      <header className="settings-header">
        <h2 className="settings-title">偏好设置</h2>
        <p className="settings-lead">这些设置保存在本机，并应用于所有服务器。</p>
      </header>

      <div className="settings-group">
        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__title">启动时自动连接默认服务器</span>
            <span className="setting-row__desc">
              应用启动后直接打开默认服务器的窗口；没有默认服务器时显示本页面。
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.autoConnect}
              onChange={(event) => onChange({ autoConnect: event.target.checked })}
              disabled={saving}
              aria-label="启动时自动连接默认服务器"
              data-testid="settings-auto-connect"
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__title">关闭窗口时最小化到托盘</span>
            <span className="setting-row__desc">
              关闭管理窗口后继续在后台运行，可从托盘菜单重新打开。
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(event) => onChange({ closeToTray: event.target.checked })}
              disabled={saving}
              aria-label="关闭窗口时最小化到托盘"
              data-testid="settings-close-to-tray"
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>

        <div className="setting-row setting-row--stack">
          <div className="setting-row__text">
            <span className="setting-row__title">界面主题</span>
            <span className="setting-row__desc">
              “跟随系统”会随操作系统外观自动切换。
            </span>
          </div>
          <div
            className="segmented"
            role="group"
            aria-label="界面主题"
            data-testid="settings-theme"
          >
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={settings.theme === option.value}
                onClick={() => onChange({ theme: option.value })}
                disabled={saving}
                data-testid={option.testId}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-group settings-group--about">
        <h3 className="section-title">关于</h3>
        <dl className="about-grid">
          <div>
            <dt>应用</dt>
            <dd>DSH Remote</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{appInfo ? appInfo.version : '—'}</dd>
          </div>
          <div>
            <dt>平台</dt>
            <dd>{platformLabel(appInfo?.platform)}</dd>
          </div>
          <div>
            <dt>主进程</dt>
            <dd>{desktopAvailable ? '已连接' : '预览模式'}</dd>
          </div>
        </dl>
        <p className="settings-note">
          DSH Remote 只保存服务器地址与偏好，不保存启动 token。远程 DSH
          页面在独立、无 Node 权限的窗口中加载。
        </p>
      </div>
    </section>
  )
}