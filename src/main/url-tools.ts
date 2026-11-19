import { TOKEN_QUERY } from '../shared/constants'

export class UrlInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlInputError'
  }
}

export interface ParsedConnection {
  baseUrl: string
  token?: string
  hadToken: boolean
  warnings: string[]
}

const SECRET_QUERY_KEYS = ['token', 'access_token', 'api_key']

function asHttpUrl(input: string): URL {
  const raw = input.trim()
  if (!raw) throw new UrlInputError('请输入服务器地址。')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UrlInputError('地址格式不正确，请包含 http:// 或 https://。')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlInputError('只支持 http:// 或 https:// 地址。')
  }
  if (url.username || url.password) {
    throw new UrlInputError('地址中不能包含用户名或密码。')
  }
  return url
}

/**
 * Parse either a clean server URL or the tokenized URL printed by `dsh web`.
 * The returned base URL never contains the launch token.
 */
export function parseConnectionInput(input: string): ParsedConnection {
  const url = asHttpUrl(input)
  const tokens = url.searchParams.getAll(TOKEN_QUERY)

  if (tokens.length > 1) {
    throw new UrlInputError('URL 中包含多个 token 参数，请粘贴 dsh web 启动时打印的完整地址。')
  }

  const token = tokens[0]
  if (token !== undefined && token.trim() === '') {
    throw new UrlInputError('URL 中的 token 为空，请重新复制 dsh web 启动时打印的地址。')
  }

  url.hash = ''
  url.searchParams.delete(TOKEN_QUERY)

  let pathname = url.pathname || '/'
  if (!pathname.endsWith('/')) pathname += '/'
  url.pathname = pathname

  const warnings: string[] = []
  if (pathname !== '/') {
    warnings.push(
      'DSH 的启动 token 只在根路径 / 生效；当前地址包含子路径，首次连接可能失败，建议使用剥离前缀后的根地址。'
    )
  }

  return {
    baseUrl: url.toString(),
    token,
    hadToken: token !== undefined,
    warnings
  }
}

export function normalizeBaseUrl(input: string): string {
  return parseConnectionInput(input).baseUrl
}

export function buildTokenUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set(TOKEN_QUERY, token)
  return url.toString()
}

export function redactUrl(input: string): string {
  try {
    const url = new URL(input)
    for (const key of SECRET_QUERY_KEYS) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***')
    }
    return url.toString()
  } catch {
    return input.replace(
      /((?:token|access_token|api_key)=)[^&\s]*/gi,
      '$1***'
    )
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function transportFamily(protocol: string): string {
  if (protocol === 'wss:') return 'https:'
  if (protocol === 'ws:') return 'http:'
  return protocol
}

/**
 * Certificates are verified for both the HTTPS page and its WSS connection.
 * The two URLs differ in scheme, so compare the transport family plus the
 * exact host:port instead of the serialized origin.
 */
export function sameServerAuthority(a: string, b: string): boolean {
  try {
    const first = new URL(a)
    const second = new URL(b)
    return (
      transportFamily(first.protocol) === transportFamily(second.protocol) &&
      first.host === second.host
    )
  } catch {
    return false
  }
}

export function defaultNameForUrl(input: string): string {
  try {
    const url = new URL(input)
    return url.host || url.hostname || 'DSH 服务器'
  } catch {
    return 'DSH 服务器'
  }
}