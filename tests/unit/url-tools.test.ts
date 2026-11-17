import { describe, expect, it } from 'vitest'
import {
  buildTokenUrl,
  normalizeBaseUrl,
  parseConnectionInput,
  redactUrl,
  sameOrigin,
  UrlInputError
} from '../../src/main/url-tools'

describe('parseConnectionInput', () => {
  it('extracts the token from a DSH launch URL and keeps a clean root base URL', () => {
    const parsed = parseConnectionInput('https://dsh.example.com/?token=abc')

    expect(parsed.baseUrl).toBe('https://dsh.example.com/')
    expect(parsed.token).toBe('abc')
    expect(parsed.hadToken).toBe(true)
    expect(parsed.warnings).toEqual([])
  })

  it('accepts a clean base URL without a token', () => {
    const parsed = parseConnectionInput('  https://dsh.example.com  ')

    expect(parsed.baseUrl).toBe('https://dsh.example.com/')
    expect(parsed.token).toBeUndefined()
    expect(parsed.hadToken).toBe(false)
  })

  it('keeps unrelated query parameters while removing the token', () => {
    const parsed = parseConnectionInput('https://dsh.example.com/team/?token=abc&x=1')

    expect(parsed.baseUrl).toBe('https://dsh.example.com/team/?x=1')
    expect(parsed.token).toBe('abc')
    expect(parsed.warnings.join(' ')).toContain('根路径')
  })

  it('rejects a URL with more than one token', () => {
    expect(() => parseConnectionInput('https://h/?token=a&token=b')).toThrow(UrlInputError)
  })

  it('rejects an empty token', () => {
    expect(() => parseConnectionInput('https://h/?token=')).toThrow(UrlInputError)
  })

  it.each(['ftp://h/', 'javascript:alert(1)', 'file:///tmp/x', 'mailto:a@b.c'])(
    'rejects unsupported protocol %s',
    (input) => {
      expect(() => parseConnectionInput(input)).toThrow(UrlInputError)
    }
  )

  it('rejects credentials embedded in the URL', () => {
    expect(() => parseConnectionInput('https://user:pass@h/')).toThrow(UrlInputError)
  })

  it('rejects an empty string', () => {
    expect(() => parseConnectionInput('   ')).toThrow(UrlInputError)
  })

  it('rejects a malformed URL', () => {
    expect(() => parseConnectionInput('not a url')).toThrow(UrlInputError)
  })
})

describe('buildTokenUrl', () => {
  it('adds an encoded token and keeps the base path', () => {
    const built = buildTokenUrl('https://h/team/', 'a b&c')

    expect(built).toBe('https://h/team/?token=a+b%26c')
  })
})

describe('normalizeBaseUrl', () => {
  it('adds a trailing slash', () => {
    expect(normalizeBaseUrl('https://h')).toBe('https://h/')
  })
})

describe('redactUrl', () => {
  it('removes the token value from a valid URL', () => {
    const redacted = redactUrl('https://h/?token=super-secret&x=1')

    expect(redacted).not.toContain('super-secret')
    expect(redacted).toContain('token=***')
    expect(redacted).toContain('x=1')
  })

  it('redacts token-like text even when the URL cannot be parsed', () => {
    expect(redactUrl('garbage token=secret&a=1')).not.toContain('secret')
  })

  it('never throws', () => {
    expect(() => redactUrl('%%%')).not.toThrow()
  })
})

describe('sameOrigin', () => {
  it('compares protocol, host and port', () => {
    expect(sameOrigin('https://h:443/a', 'https://h/b')).toBe(true)
    expect(sameOrigin('http://h/a', 'https://h/a')).toBe(false)
    expect(sameOrigin('https://h:8443/a', 'https://h/a')).toBe(false)
  })

  it('returns false for invalid input', () => {
    expect(sameOrigin('nope', 'https://h/')).toBe(false)
  })
})