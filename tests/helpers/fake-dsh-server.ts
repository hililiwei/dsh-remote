import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface FakeDshServer {
  readonly baseUrl: string
  readonly tokenUrl: string
  readonly port: number
  rotate(): string
  close(): Promise<void>
}

function randomId(): string {
  return randomBytes(12).toString('hex')
}

export async function startFakeDsh(): Promise<FakeDshServer> {
  let token = randomId()
  let cookie = randomId()

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/' && url.searchParams.get('token') === token) {
      res.writeHead(303, {
        location: './',
        'set-cookie': `dsh-auth=${cookie}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`,
        'cache-control': 'no-store'
      })
      res.end()
      return
    }

    const hasCookie = (req.headers.cookie ?? '').includes(`dsh-auth=${cookie}`)
    if (!hasCookie) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.')
      return
    }

    if (url.pathname === '/api/me') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>Fake DSH</title></head><body><h1>Fake DSH</h1><p data-testid="remote-ready">Ready</p></body></html>'
      )
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  const port = address.port
  const baseUrl = `http://127.0.0.1:${port}/`

  return {
    baseUrl,
    port,
    get tokenUrl(): string {
      return `${baseUrl}?token=${token}`
    },
    rotate(): string {
      token = randomId()
      cookie = randomId()
      return `${baseUrl}?token=${token}`
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    }
  }
}