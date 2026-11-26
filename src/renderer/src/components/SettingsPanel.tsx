import { useEffect, useState } from 'react'
import type { AppInfo, AppSettings, AppSettingsPatch, ThemeMode } from '@shared/types'
import type { PetSize } from '@shared/pet'

export type SettingsPatch = AppSettingsPatch

interface SettingsPanelProps {
  settings: AppSettings
  appInfo: AppInfo | null
  desktopAvailable: boolean
  saving: boolean
  onChange: (patch: SettingsPatch) => void
}

const PET_SIZE_OPTIONS: { value: PetSize; label: string; testId: string }[] = [
  { value: 'small', label: '小', testId: 'settings-pet-size-small' },
  { value: 'medium', label: '中', testId: 'settings-pet-size-medium' },
  { value: 'large', label: '大', testId: 'settings-pet-size-large' }
]

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
  const [customWidth, setCustomWidth] = useState(
    settings.shellWidth ? String(settings.shellWidth) : ''
  )

  useEffect(() => {
    setCustomWidth(settings.shellWidth ? String(settings.shellWidth) : '')
  }, [settings.shellWidth])

  const applyCustomWidth = (): void => {
    const value = Number(customWidth)
    if (!Number.isFinite(value) || value < 900 || value > 4000) return
    onChange({ shellWidth: Math.round(value) })
  }

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
              应用启动后直接打开默认服务器的标签页；没有默认服务器时显示本页面。
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

        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__title">显示桌面宠物</span>
            <span className="setting-row__desc">
              在右下角显示一个始终置顶的宠物，汇总所有已连接服务器的运行、完成和待确认状态。
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.pet.enabled}
              onChange={(event) => onChange({ pet: { enabled: event.target.checked } })}
              disabled={saving}
              aria-label="显示桌面宠物"
              data-testid="settings-pet-enabled"
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__title">宠物始终置顶</span>
            <span className="setting-row__desc">
              关闭后宠物仍会显示，但可能被其他应用窗口遮挡；切换标签页不会让它消失。
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.pet.alwaysOnTop}
              onChange={(event) => onChange({ pet: { alwaysOnTop: event.target.checked } })}
              disabled={saving || !settings.pet.enabled}
              aria-label="宠物始终置顶"
              data-testid="settings-pet-always-on-top"
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>

        <div className="setting-row setting-row--stack">
          <div className="setting-row__text">
            <span className="setting-row__title">宠物尺寸</span>
            <span className="setting-row__desc">
              小 / 中 / 大；切换后宠物窗口会立即调整，并记住下次启动的大小。
            </span>
          </div>
          <div
            className="segmented"
            role="group"
            aria-label="宠物尺寸"
            data-testid="settings-pet-size"
          >
            {PET_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={settings.pet.size === option.value}
                onClick={() => onChange({ pet: { size: option.value } })}
                disabled={saving || !settings.pet.enabled}
                data-testid={option.testId}
              >
                {option.label}
              </button>
            ))}
          </div>
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

        <div className="setting-row setting-row--stack">
          <div className="setting-row__text">
            <span className="setting-row__title">主窗口宽度</span>
            <span className="setting-row__desc">
              “自适应”按屏幕约 85% 开窗；也可以固定为 1280 / 1440 / 1600 / 1920，
              或输入 900–4000 的像素值。修改会立即调整已打开的主窗口。
            </span>
          </div>
          <div className="width-control">
            <div
              className="segmented"
              role="group"
              aria-label="主窗口宽度"
              data-testid="settings-width"
            >
              <button
                type="button"
                aria-pressed={settings.shellWidth == null}
                onClick={() => onChange({ shellWidth: null })}
                disabled={saving}
                data-testid="settings-width-auto"
              >
                自适应
              </button>
              {[1280, 1440, 1600, 1920].map((widthValue) => (
                <button
                  key={widthValue}
                  type="button"
                  aria-pressed={settings.shellWidth === widthValue}
                  onClick={() => onChange({ shellWidth: widthValue })}
                  disabled={saving}
                  data-testid={`settings-width-${widthValue}`}
                >
                  {widthValue}
                </button>
              ))}
            </div>
            <div className="width-custom">
              <input
                type="number"
                min={900}
                max={4000}
                step={10}
                value={customWidth}
                onChange={(event) => setCustomWidth(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyCustomWidth()
                }}
                placeholder="自定义 px"
                aria-label="自定义主窗口宽度"
                disabled={saving}
                data-testid="settings-width-input"
              />
              <button
                type="button"
                className="btn btn--sm"
                onClick={applyCustomWidth}
                disabled={saving}
                data-testid="settings-width-apply"
              >
                应用
              </button>
            </div>
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
          页面在主窗口标签页中加载，无 Node 权限。
        </p>
      </div>
    </section>
  )
}



