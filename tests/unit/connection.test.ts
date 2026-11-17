import { describe, expect, it } from 'vitest'
import { AuthInputError, resolveServerNavigation } from '../../src/main/connection'
import type { ServerProfile } from '../../src/shared/types'

const server: ServerProfile = {
  id: 'one',
  name: 'One',
  baseUrl: 'https://dsh.example.com/',
  proxyMode: 'system',
  allowInvalidCertificate: false,
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('resolveServerNavigation', () => {
  it('uses the clean base URL when no launch URL is supplied', () => {
    expect(resolveServerNavigation(server).url).toBe('https://dsh.example.com/')
  })

  it('builds a token URL on the saved server origin', () => {
    const result = resolveServerNavigation(server, 'https://dsh.example.com/?token=abc')

    expect(result.url).toBe('https://dsh.example.com/?token=abc')
    expect(result.usedToken).toBe(true)
  })

  it('encodes special characters in the token', () => {
    const result = resolveServerNavigation(server, 'https://dsh.example.com/?token=a%20b%26c')

    expect(result.url).toBe('https://dsh.example.com/?token=a+b%26c')
  })

  it('rejects a launch URL for a different origin', () => {
    expect(() =>
      resolveServerNavigation(server, 'https://evil.example.com/?token=abc')
    ).toThrow(AuthInputError)
  })

  it('rejects a URL without a token', () => {
    expect(() => resolveServerNavigation(server, 'https://dsh.example.com/')).toThrow(
      AuthInputError
    )
  })

  it('rejects a malformed URL', () => {
    expect(() => resolveServerNavigation(server, 'not a url')).toThrow(AuthInputError)
  })
})