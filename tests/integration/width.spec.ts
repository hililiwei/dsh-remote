import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startFakeDsh } from '../helpers/fake-dsh-server'
import { launchApp, managerPage, tabsPage } from './helpers'

let app: ElectronApplication
let userData: string
let fake: Awaited<ReturnType<typeof startFakeDsh>>

async function shellBounds(application: ElectronApplication) {
  return application.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('view=tabs')
    )
    return shell ? shell.getBounds() : null
  })
}

test.beforeEach(async () => {
  fake = await startFakeDsh()
  userData = await mkdtemp(join(process.cwd(), '.tmp-e2e-'))
  app = await launchApp(userData)
})

test.afterEach(async () => {
  await app.close()
  await fake.close()
  await rm(userData, { recursive: true, force: true })
})

test('applies and persists a fixed main-window width', async () => {
  const manager = await managerPage(app)
  await manager.getByTestId('add-server').click()
  await manager.getByTestId('url-input').fill(fake.tokenUrl)
  await manager.getByTestId('name-input').fill('Width Test')
  await manager.getByTestId('save-and-connect').click()
  await tabsPage(app)

  const initialWorkArea = await app.evaluate(
    ({ screen }) => screen.getPrimaryDisplay().workArea.width
  )
  const initialExpected = Math.min(1800, Math.max(900, Math.round(initialWorkArea * 0.85)))
  await expect
    .poll(async () => (await shellBounds(app))?.width, { timeout: 10_000 })
    .toBe(initialExpected)

  await manager.getByRole('button', { name: '设置' }).click()
  await expect(manager.getByTestId('settings-panel')).toBeVisible()
  await manager.getByTestId('settings-width-1600').click()

  await expect.poll(async () => (await shellBounds(app))?.width, { timeout: 10_000 }).toBe(1600)

  const config = JSON.parse(await (await import('node:fs/promises')).readFile(
    join(userData, 'servers.json'),
    'utf8'
  ))
  expect(config.shellWidth).toBe(1600)

  await manager.getByTestId('settings-width-auto').click()
  const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.width)
  const expected = Math.min(1800, Math.max(900, Math.round(workArea * 0.85)))
  await expect.poll(async () => (await shellBounds(app))?.width, { timeout: 10_000 }).toBe(expected)
})
