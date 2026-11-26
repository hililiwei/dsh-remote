import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from '../../src/main/config-store'

async function makeStore(): Promise<{ file: string; store: ConfigStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-pet-size-'))
  const file = join(dir, 'servers.json')
  return { file, store: new ConfigStore(file) }
}

describe('ConfigStore pet size', () => {
  it('defaults to medium and persists a new size', async () => {
    const { file, store } = await makeStore()
    expect((await store.load()).pet.size).toBe('medium')

    const updated = await store.updateSettings({ pet: { size: 'large' } })
    expect(updated.pet.size).toBe('large')

    const reloaded = new ConfigStore(file)
    expect((await reloaded.load()).pet.size).toBe('large')
  })

  it('ignores an invalid size', async () => {
    const { store } = await makeStore()
    await store.load()
    const updated = await store.updateSettings({ pet: { size: 'huge' as never } })
    expect(updated.pet.size).toBe('medium')
  })
})


