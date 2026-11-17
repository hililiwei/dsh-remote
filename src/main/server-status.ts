import type { TestResult } from '../shared/types'

export interface FetchLikeSession {
  fetch(input: string, init?: RequestInit): Promise<Response>
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Classify whether a remote DSH endpoint is reachable. `session.fetch` is used
 * instead of a global fetch so the per-server cookie jar and proxy settings
 * participate in the check.
 */
export async function checkServer(
  session: FetchLikeSession,
  baseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<TestResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await session.fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store'
    })

    if (response.status >= 200 && response.status < 400) {
      return { status: 'online', httpStatus: response.status }
    }
    if (response.status === 401) {
      return { status: 'auth-required', httpStatus: 401 }
    }
    if (response.status === 403) {
      return { status: 'forbidden', httpStatus: 403 }
    }
    return {
      status: 'error',
      httpStatus: response.status,
      message: `服务器返回 HTTP ${response.status}`
    }
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === 'AbortError') ||
      controller.signal.aborted
    return {
      status: 'offline',
      message: timedOut ? '连接超时' : '无法连接服务器'
    }
  } finally {
    clearTimeout(timer)
  }
}