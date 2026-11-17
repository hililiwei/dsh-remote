import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigStore, ConfigStoreError } from '../../src/main/config-store'

async function makeStore(): Promise<{ dir: string; file: string; store: ConfigStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-config-'))
  const file = join(dir, 'servers.json')
  return { dir, file, store: new ConfigStore(file) }
}

describe('ConfigStore', () => {
  it('returns defaults when the file does not exist', async () => {
    const { store } = await makeStore()
    const settings = await store.load()

    expect(settings.version).toBe(1)
    expect(settings.servers).toEqual([])
    expect(settings.autoConnect).toBe(true)
    expect(settings.closeToTray).toBe(false)
    expect(settings.theme).toBe('system')
    expect(settings.windowBounds).toEqual({})
  })

  it('saves a server, derives a name and never persists the token', async () => {
    const { file, store } = await makeStore()
    await store.load()

    const result = await store.saveServer({
      name: '',
      url: 'https://dsh.example.com/?token=super-secret'
    })

    expect(result.server.name).toBe('dsh.example.com')
    expect(result.server.baseUrl).toBe('https://dsh.example.com/')
    expect(result.inputHadToken).toBe(true)
    expect(result.warnings).toEqual([])

    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('super-secret')
    expect(JSON.parse(raw).servers[0].baseUrl).toBe('https://dsh.example.com/')
  })

  it('rejects a duplicate base URL', async () => {
    const { store } = await makeStore()
    await store.load()
    await store.saveServer({ name: 'One', url: 'https://dsh.example.com/' })

    await expect(
      store.saveServer({ name: 'Two', url: 'https://dsh.example.com' })
    ).rejects.toBeInstanceOf(ConfigStoreError)
  })

  it('updates an existing server while keeping its id and createdAt', async () => {
    const { store } = await makeStore()
    await store.load()
    const created = await store.saveServer({ name: 'Old', url: 'https://old.example.com/' })

    const updated = await store.saveServer({
      id: created.server.id,
      name: 'New',
      url: 'https://new.example.com/',
      proxyMode: 'direct',
      allowInvalidCertificate: true
    })

    expect(updated.server.id).toBe(created.server.id)
    expect(updated.server.createdAt).toBe(created.server.createdAt)
    expect(updated.server.name).toBe('New')
    expect(updated.server.baseUrl).toBe('https://new.example.com/')
    expect(updated.server.proxyMode).toBe('direct')
    expect(updated.server.allowInvalidCertificate).toBe(true)
  })

  it('deletes a server and clears it as the default', async () => {
    const { store } = await makeStore()
    await store.load()
    const created = await store.saveServer({ name: 'One', url: 'https://one.example.com/' })
    await store.setDefaultServer(created.server.id)

    await store.deleteServer(created.server.id)

    expect(store.getSettings().servers).toEqual([])
    expect(store.getSettings().defaultServerId).toBeUndefined()
  })

  it('backs up a corrupt file and starts from defaults', async () => {
    const { dir, file, store } = await makeStore()
    await writeFile(file, '{ this is not json', 'utf8')

    const settings = await store.load()
    const files = await readdir(dir)

    expect(settings.servers).toEqual([])
    expect(files.some((name) => name.includes('.corrupt-'))).toBe(true)
  })

  it('keeps valid entries when part of the file is invalid', async () => {
    const { file, store } = await makeStore()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: 'good',
            name: 'Good',
            baseUrl: 'https://good.example.com/',
            proxyMode: 'system',
            allowInvalidCertificate: false,
            createdAt: '2026-01-01T00:00:00.000Z'
          },
          { id: 'bad', name: 'Bad', baseUrl: 'not-a-url' }
        ]
      }),
      'utf8'
    )

    const settings = await store.load()

    expect(settings.servers.map((server) => server.id)).toEqual(['good'])
  })

  it('remembers window bounds and reloads them', async () => {
    const { file, store } = await makeStore()
    await store.load()
    await store.rememberBounds('server-1', { x: 10, y: 20, width: 900, height: 700 })

    const reloaded = new ConfigStore(file)
    const settings = await reloaded.load()

    expect(settings.windowBounds['server-1']).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 700
    })
  })

  it('updates only supported settings keys', async () => {
    const { store } = await makeStore()
    await store.load()

    const settings = await store.updateSettings({
      autoConnect: false,
      closeToTray: true,
      theme: 'dark'
    })

    expect(settings.autoConnect).toBe(false)
    expect(settings.closeToTray).toBe(true)
    expect(settings.theme).toBe('dark')
  })
})