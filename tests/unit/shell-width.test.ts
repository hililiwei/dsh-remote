import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../../src/main/config-store'

async function makeStore(): Promise<{ file: string; store: ConfigStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-width-'))
  const file = join(dir, 'servers.json')
  return { file, store: new ConfigStore(file) }
}

describe('ConfigStore shell width', () => {
  it('leaves the width unset by default', async () => {
    const { store } = await makeStore()
    const settings = await store.load()
    expect(settings.shellWidth).toBeUndefined()
  })

  it('persists a fixed width and can clear it back to auto', async () => {
    const { file, store } = await makeStore()
    await store.load()

    const updated = await store.updateSettings({ shellWidth: 1600 })
    expect(updated.shellWidth).toBe(1600)

    const reloaded = new ConfigStore(file)
    expect((await reloaded.load()).shellWidth).toBe(1600)

    const cleared = await reloaded.updateSettings({ shellWidth: null })
    expect(cleared.shellWidth).toBeUndefined()
  })

  it('ignores an out-of-range width', async () => {
    const { store } = await makeStore()
    await store.load()
    const settings = await store.updateSettings({ shellWidth: 100 })
    expect(settings.shellWidth).toBeUndefined()
  })
})
