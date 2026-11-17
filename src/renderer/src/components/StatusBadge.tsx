import type { UiServerStatus } from '../hooks/useServers'

export const STATUS_LABELS: Record<UiServerStatus, string> = {
  online: '在线',
  'auth-required': '需要登录',
  forbidden: '无访问权限',
  error: '连接异常',
  offline: '无法连接',
  unknown: '未检测',
  testing: '测试中'
}

interface StatusDotProps {
  status?: UiServerStatus
  className?: string
}

export function StatusDot({ status = 'unknown', className }: StatusDotProps) {
  const label = STATUS_LABELS[status] ?? STATUS_LABELS.unknown
  return (
    <span
      className={`status-dot status-dot--${status}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}

interface StatusBadgeProps {
  status?: UiServerStatus
}

export default function StatusBadge({ status = 'unknown' }: StatusBadgeProps) {
  const label = STATUS_LABELS[status] ?? STATUS_LABELS.unknown
  return (
    <span className={`status-badge status-badge--${status}`} title={label}>
      <span
        className={`status-dot status-dot--${status}${
          status === 'testing' ? ' status-dot--pulse' : ''
        }`}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}