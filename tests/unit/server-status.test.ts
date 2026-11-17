import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkServer, type FetchLikeSession } from '../../src/main/server-status'

let server: Server | undefined

async function startServer(): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === '/slow') {
      setTimeout(() => {
        res.writeHead(200)
        res.end('slow')
      }, 300)
      return
    }
    if (req.url === '/auth') {
      res.writeHead(401)
      res.end('auth required')
      return
    }
    if (req.url === '/forbidden') {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.url === '/error') {
      res.writeHead(500)
      res.end('boom')
      return
    }
    res.writeHead(200)
    res.end('ok')
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function session(): FetchLikeSession {
  return {
    fetch: (input, init) => fetch(input, init)
  }
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

describe('checkServer', () => {
  it('reports online for a successful response', async () => {
    const base = await startServer()
    const result = await checkServer(session(), `${base}/`)

    expect(result).toEqual({ status: 'online', httpStatus: 200 })
  })

  it('reports auth-required for 401', async () => {
    const base = await startServer()
    const result = await checkServer(session(), `${base}/auth`)

    expect(result).toEqual({ status: 'auth-required', httpStatus: 401 })
  })

  it('reports forbidden for 403', async () => {
    const base = await startServer()
    const result = await checkServer(session(), `${base}/forbidden`)

    expect(result).toEqual({ status: 'forbidden', httpStatus: 403 })
  })

  it('reports a generic error for other statuses', async () => {
    const base = await startServer()
    const result = await checkServer(session(), `${base}/error`)

    expect(result.status).toBe('error')
    expect(result.httpStatus).toBe(500)
  })

  it('reports offline for an unreachable port', async () => {
    const result = await checkServer(session(), 'http://127.0.0.1:1/')

    expect(result.status).toBe('offline')
    expect(result.message).toBeTruthy()
  })

  it('reports offline on timeout', async () => {
    const base = await startServer()
    const result = await checkServer(session(), `${base}/slow`, 30)

    expect(result.status).toBe('offline')
    expect(result.message).toContain('超时')
  })

  it('never throws for a malformed URL', async () => {
    const result = await checkServer(session(), 'not a url')

    expect(result.status).toBe('offline')
  })
})