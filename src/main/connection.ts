import type { ServerProfile } from '../shared/types'
import { buildTokenUrl, parseConnectionInput, sameOrigin, UrlInputError } from './url-tools'

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthInputError'
  }
}

export class AuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED'

  constructor(public readonly serverId: string) {
    super('需要 DSH 启动令牌')
    this.name = 'AuthRequiredError'
  }
}

export class NavigationError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
    public readonly errorCode?: number
  ) {
    super(message)
    this.name = 'NavigationError'
  }
}

export interface ServerNavigation {
  url: string
  usedToken: boolean
}

/**
 * Decide where a server window should navigate. A pasted launch URL is only
 * accepted when its origin matches the saved server, so a token can never be
 * sent to another host.
 */
export function resolveServerNavigation(
  server: ServerProfile,
  launchUrl?: string
): ServerNavigation {
  if (!launchUrl || launchUrl.trim() === '') {
    return { url: server.baseUrl, usedToken: false }
  }

  let parsed: ReturnType<typeof parseConnectionInput>
  try {
    parsed = parseConnectionInput(launchUrl)
  } catch (error) {
    if (error instanceof UrlInputError) throw new AuthInputError(error.message)
    throw error
  }

  if (!parsed.token) {
    throw new AuthInputError(
      '粘贴的地址里没有 token，请复制 dsh web 启动时打印的完整 URL。'
    )
  }
  if (!sameOrigin(parsed.baseUrl, server.baseUrl)) {
    throw new AuthInputError('这个启动 URL 属于另一个服务器，请检查是否复制错了。')
  }

  return {
    url: buildTokenUrl(server.baseUrl, parsed.token),
    usedToken: true
  }
}