import type { AuthReason, ProxyMode, WindowView } from '@shared/types'

export interface ParsedWindowView {
  view: WindowView
  serverId?: string
  reason: AuthReason
}

/**
 * The local renderer is shared by the manager and auth windows; the main
 * process picks the view through the query string.
 */
export function parseWindowView(search: string): ParsedWindowView {
  const params = new URLSearchParams(search)
  const requested = params.get('view')
  const view: WindowView =
    requested === 'auth' ? 'auth' : requested === 'tabs' ? 'tabs' : 'manager'

  const rawServerId = params.get('serverId')
  const serverId = rawServerId && rawServerId.trim() !== '' ? rawServerId.trim() : undefined

  const rawReason = params.get('reason')
  const reason: AuthReason = rawReason === 'expired' ? 'expired' : 'first'

  return { view, serverId, reason }
}

export function hostOf(url: string | undefined | null): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function isRootBaseUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname
    return pathname === '/' || pathname === ''
  } catch {
    return true
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

export function formatDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return dateTimeFormatter.format(date)
}

export function formatRelativeTime(value?: string): string {
  if (!value) return '从未使用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const diff = Date.now() - date.getTime()
  if (diff < 45_000) return '刚刚'

  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天前`

  return formatDateTime(value)
}

function cleanCandidate(value: string): string {
  return value
    .replace(/^[\s`"'<]+/, '')
    .replace(/[\s`"'>.,;，。；]+$/, '')
    .trim()
}

/**
 * Accepts a URL pasted on its own or the whole `dsh web: https://...` line
 * printed by the remote server, and returns the URL without surrounding noise.
 * The token (when present) is intentionally preserved.
 */
export function extractLaunchUrl(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const candidates: string[] = []
  for (const line of lines) {
    candidates.push(cleanCandidate(line))
    const withoutPrefix = line.replace(/^dsh\s+web\s*:\s*/i, '').trim()
    if (withoutPrefix !== line) candidates.push(cleanCandidate(withoutPrefix))
  }

  const match = candidates.find((candidate) => /^https?:\/\//i.test(candidate))
  return match ?? candidates[0] ?? ''
}

export function proxyLabel(mode: ProxyMode): string {
  return mode === 'direct' ? '直连' : '跟随系统代理'
}